// @ts-check

/**
 * @file Storage.js
 * Promise-based asynchronous IndexedDB storage wrapper with corruption recovery.
 *
 * Responsibilities:
 * - Provides a localStorage-like API over IndexedDB (getItem, setItem, removeItem, clear).
 * - Handles database versioning and schema upgrades.
 * - Manages concurrent multi-tab access with onversionchange and onclose handlers.
 * - Recovers gracefully from aborted transactions.
 * - **Corruption recovery**: Detects corrupt data, auto-deletes and rebuilds the database.
 * - **Retry with recovery**: Wraps operations with automatic retry on transient failures.
 */

/** @typedef {import("./Logger").default} Logger */

import {
    STORAGE_DATABASE_NAME,
    STORAGE_DATABASE_VERSION,
    STORAGE_TABLES
} from "../../util/Constants";

import LoggerClass from "./Logger";

/**
 * Maximum number of retry attempts for transient failures.
 * @readonly
 * @type {number}
 */
const MAX_RETRIES = 2;

/**
 * Delay between retry attempts in milliseconds.
 * @readonly
 * @type {number}
 */
const RETRY_DELAY_MS = 500;

/**
 * A Promise-based, asynchronous localStorage replacement built over IndexedDB.
 * Handles database versioning, concurrent multi-tab access anomalies,
 * and recovers gracefully from aborted database transactions.
 */
export default class Storage {

    /**
     * @param {string} table The target object store name. Must be listed in STORAGE_TABLES.
     * @param {Logger} [logger] Optional logging instance.
     */
    constructor(table, logger) {
        if (!STORAGE_TABLES.includes(table)) {
            throw new Error(`Rejected Storage initialization: Unknown table parameter "${table}".`);
        }

        /** @readonly @type {string} */
        this.table = table;

        /** @readonly @type {Logger} */
        this.logger = (logger ?? new LoggerClass("Storage")).child(table);

        /** @type {Promise<IDBDatabase>} */
        this.database = Storage.open(this.logger);
    }

    /**
     * Connects to the shared IndexedDB instance.
     * Prevents duplicate connection allocations by caching the active transaction promise.
     *
     * @param {Logger} logger Target logger to track issues.
     * @returns {Promise<IDBDatabase>}
     */
    static open(logger) {
        // Return existing active promise context if database connection is pending or open
        if (Storage.database) {
            return Storage.database;
        }

        const promise = new Promise((resolve, reject) => {
            let request;

            try {
                request = indexedDB.open(
                    STORAGE_DATABASE_NAME,
                    STORAGE_DATABASE_VERSION
                );
            } catch (/** @type {unknown} */ error) {
                logger.error("Failed to execute indexedDB.open() operation:", error);
                reject(error);
                return;
            }

            // Invoked if database does not exist or version is upgraded
            request.onupgradeneeded = () => {
                try {
                    const db = request.result;

                    for (const table of STORAGE_TABLES) {
                        if (db.objectStoreNames.contains(table)) {
                            continue;
                        }
                        // Create tables cleanly
                        db.createObjectStore(table);
                        logger.debug(`Successfully created database table: ${table}`);
                    }
                } catch (/** @type {unknown} */ error) {
                    logger.error("Error encountered during database schema upgrade:", error);
                    try {
                        request.transaction?.abort();
                    } catch {
                        // Ignore secondary abort failures
                    }
                }
            };

            // Triggers if another browser tab/window is blocking the connection upgrade
            request.onblocked = () => {
                logger.warn("Database connection blocked: Another browser context has an active lock on this database.");
            };

            request.onerror = () => {
                logger.error("Failed to open database connection:", request.error);
                reject(request.error ?? new Error("IndexedDB connection failed to initialize."));
            };

            request.onsuccess = () => {
                const db = request.result;

                // Close database context if an upgrade occurs in another tab to prevent deadlocks
                db.onversionchange = () => {
                    logger.warn("Database version upgrade detected elsewhere. Closing connection to prevent lockups.");
                    db.close();
                    if (Storage.database === promise) {
                        Storage.database = null;
                    }
                };

                // Clear cached connection if browser drops database context unexpectedly
                db.onclose = () => {
                    logger.warn("Database connection dropped unexpectedly.");
                    if (Storage.database === promise) {
                        Storage.database = null;
                    }
                };

                logger.debug("Database transaction opened successfully.");
                resolve(db);
            };
        });

        Storage.database = promise;

        // Clear connection reference if startup promise fails so future transactions can retry
        promise.catch(() => {
            if (Storage.database === promise) {
                Storage.database = null;
            }
        });

        return promise;
    }

    /**
     * Returns total items stored in the table.
     *
     * @returns {Promise<number>}
     */
    async length() {
        return this.#requestWithRecovery(
            "readonly",
            "length",
            store => store.count()
        );
    }

    /**
     * Recovers a value by key. Returns null if key is missing.
     *
     * @param {string} key Unique identifier.
     * @returns {Promise<any>}
     */
    async getItem(key) {
        if (typeof key !== "string") {
            this.logger.warn("getItem() parameters rejected: key must be a string.");
            return null;
        }

        const value = await this.#requestWithRecovery(
            "readonly",
            "getItem",
            store => store.get(key)
        );

        return value === undefined ? null : value;
    }

    /**
     * Stores a value.
     *
     * @param {string} key Unique identifier.
     * @param {unknown} value Structured-cloneable data value.
     * @returns {Promise<void>}
     */
    async setItem(key, value) {
        if (typeof key !== "string") {
            throw new TypeError("setItem() parameters rejected: key must be a string.");
        }

        await this.#requestWithRecovery(
            "readwrite",
            "setItem",
            store => store.put(value, key)
        );
    }

    /**
     * Removes an entry.
     *
     * @param {string} key Unique identifier.
     * @returns {Promise<void>}
     */
    async removeItem(key) {
        if (typeof key !== "string") {
            this.logger.warn("removeItem() parameters rejected: key must be a string.");
            return;
        }

        await this.#requestWithRecovery(
            "readwrite",
            "removeItem",
            store => store.delete(key)
        );
    }

    /**
     * Wipes the target table clean.
     *
     * @returns {Promise<void>}
     */
    async clear() {
        await this.#requestWithRecovery(
            "readwrite",
            "clear",
            store => store.clear()
        );
    }

    /**
     * Returns an array containing all key-value tuples.
     *
     * @returns {Promise<Array<[string, any]>>}
     */
    async entries() {
        const db = await this.database;

        return new Promise((resolve, reject) => {
            let transaction;

            try {
                transaction = db.transaction(this.table, "readonly");
            } catch (/** @type {unknown} */ error) {
                this.logger.error("Failed to construct transaction block during entries() fetch:", error);
                reject(error);
                return;
            }

            /** @type {Array<[string, any]>} */
            const result = [];

            try {
                const store = transaction.objectStore(this.table);
                const request = store.openCursor();

                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) {
                        return; // Done iterating
                    }

                    result.push([String(cursor.key), cursor.value]);
                    cursor.continue();
                };

                request.onerror = () => {
                    this.logger.error("Cursor transaction failed during entries() loop:", request.error);
                    reject(request.error ?? new Error("IndexedDB Cursor execution failed."));
                };

                transaction.oncomplete = () => {
                    resolve(result);
                };

                transaction.onerror = () => {
                    this.logger.error("Transaction error occurred during entries() loop:", transaction.error);
                    reject(transaction.error ?? new Error("Transaction execution failed."));
                };

                transaction.onabort = () => {
                    this.logger.warn("Entries() loop transaction was aborted.");
                    reject(transaction.error ?? new Error("Transaction aborted."));
                };
            } catch (/** @type {unknown} */ error) {
                this.logger.error("Error occurred while opening database cursor:", error);
                try {
                    transaction.abort();
                } catch {
                    // Ignore abort exceptions
                }
                reject(error);
            }
        });
    }

    /**
     * Recovers the key at a index offset. Returns null if absent.
     *
     * @param {number} index Zero-based table offset.
     * @returns {Promise<string|null>}
     */
    async key(index) {
        if (!Number.isInteger(index) || index < 0) {
            return null;
        }

        const keys = await this.#requestWithRecovery(
            "readonly",
            "key",
            store => store.getAllKeys()
        );

        return keys[index] === undefined ? null : String(keys[index]);
    }

    /**
     * Runs an IndexedDB query with retry and corruption recovery.
     * On first failure: retries once after a short delay.
     * On corruption detection: deletes and rebuilds the database, then retries.
     *
     * @param {IDBTransactionMode} mode
     * @param {string} operationName Logging label.
     * @param {(store: IDBObjectStore) => IDBRequest} operation IndexedDB query function.
     * @returns {Promise<any>}
     */
    async #requestWithRecovery(mode, operationName, operation) {
        let lastError = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await this.#request(mode, operationName, operation);
            } catch (/** @type {unknown} */ error) {
                lastError = error;

                // Detect corruption indicators
                if (this.#isCorruptionError(error)) {
                    this.logger.error(`Corruption detected during "${operationName}". Rebuilding database...`, error);
                    await this.#rebuildDatabase();
                    // After rebuild, retry once more
                    continue;
                }

                // Transient error: retry after delay
                if (attempt < MAX_RETRIES) {
                    this.logger.warn(`Transient error during "${operationName}" (attempt ${attempt + 1}/${MAX_RETRIES}). Retrying...`);
                    await this.#sleep(RETRY_DELAY_MS * (attempt + 1));
                    continue;
                }
            }
        }

        throw lastError;
    }

    /**
     * Runs an IndexedDB query inside a dedicated transaction block.
     * Resolves the returned promise only after the transaction is fully committed.
     *
     * @param {IDBTransactionMode} mode
     * @param {string} operationName Logging label.
     * @param {(store: IDBObjectStore) => IDBRequest} operation IndexedDB query function.
     * @returns {Promise<any>}
     */
    async #request(mode, operationName, operation) {
        const db = await this.database;

        return new Promise((resolve, reject) => {
            /** @type {IDBTransaction|undefined} */
            let transaction;
            /** @type {IDBRequest|undefined} */
            let request;
            let settled = false;

            // Transaction timeout guard — detects hanging ops in backgrounded tabs
            const TRANSACTION_TIMEOUT_MS = 5_000;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    this.logger.warn(`Transaction timeout (${TRANSACTION_TIMEOUT_MS}ms) during "${operationName}". Aborting...`);
                    try { transaction?.abort(); } catch { /* ignore */ }
                    reject(new Error(`IndexedDB transaction timed out during "${operationName}" after ${TRANSACTION_TIMEOUT_MS}ms.`));
                }
            }, TRANSACTION_TIMEOUT_MS);

            try {
                transaction = db.transaction(this.table, mode);
                request = operation(transaction.objectStore(this.table));
            } catch (/** @type {unknown} */ error) {
                settled = true;
                clearTimeout(timer);
                this.logger.error(`Failed to execute operation "${operationName}": Transaction block creation failed.`, error);
                reject(error);
                return;
            }

            /** @type {DOMException|null} */
            let requestError = null;
            /** @type {DOMException|null} */
            let transactionError = null;

            request.onerror = () => {
                requestError = request.error;
                this.logger.error(`Query request failed during operation "${operationName}":`, request.error);
            };

            transaction.onerror = () => {
                transactionError = transaction.error;
                this.logger.error(`Transaction failed during operation "${operationName}":`, transaction.error);
            };

            transaction.onabort = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const error = transaction.error ?? requestError ?? new Error(`IndexedDB transaction aborted during "${operationName}".`);
                this.logger.warn(`Transaction aborted during operation "${operationName}":`, error);
                reject(error);
            };

            transaction.oncomplete = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (requestError || transactionError) {
                    reject(transactionError ?? requestError);
                    return;
                }
                resolve(request.result);
            };
        });
    }

    /**
     * Detects whether an error indicates database corruption.
     *
     * @param {unknown} error The error to inspect.
     * @returns {boolean} True if the error suggests corruption.
     */
    #isCorruptionError(error) {
        if (!error) return false;

        const errObj = /** @type {Record<string, unknown>} */ (error);
        const msg = String(errObj.message || errObj.name || error);
        const lowerMsg = msg.toLowerCase();

        return (
            lowerMsg.includes("corrupt") ||
            lowerMsg.includes("dataerror") ||
            lowerMsg.includes("transactionerror") ||
            lowerMsg.includes("notfounderror") ||
            lowerMsg.includes("invalidstateerror") ||
            (errObj.name === "DataError") ||
            (errObj.name === "InvalidStateError") ||
            (errObj.name === "NotFoundError") ||
            (errObj.name === "TransactionInactiveError")
        );
    }

    /**
     * Rebuilds the database by deleting it and clearing the cached connection.
     * After deletion, the next operation will trigger a fresh connection with schema creation.
     *
     * @returns {Promise<void>}
     */
    async #rebuildDatabase() {
        try {
            // Clear the cached connection
            Storage.database = null;

            // Delete the entire database
            await new Promise((resolve, reject) => {
                const deleteRequest = indexedDB.deleteDatabase(STORAGE_DATABASE_NAME);
                deleteRequest.onsuccess = () => resolve(undefined);
                deleteRequest.onerror = () => reject(deleteRequest.error);
                deleteRequest.onblocked = () => {
                    this.logger.warn("Database deletion blocked by another tab.");
                    resolve(undefined); // Continue anyway
                };
            });

            this.logger.info(`Database "${STORAGE_DATABASE_NAME}" deleted successfully. Rebuilding...`);

            // Force a fresh connection by creating a new Storage instance
            // The next call to this.database will trigger Storage.open() with the fresh DB
            this.database = Storage.open(this.logger);

            this.logger.info("Database rebuilt successfully.");
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to rebuild database:", error);
            throw error;
        }
    }

    /**
     * Promise-based sleep utility.
     * @param {number} ms Milliseconds to sleep.
     * @returns {Promise<void>}
     */
    #sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

/**
 * Cached active database connection promise.
 * @type {Promise<IDBDatabase>|null}
 */
Storage.database = null;
