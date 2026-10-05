// @ts-check

/**
 * @file Memory.js
 * High-level coordinator managing an isolated table of Key memories.
 *
 * Responsibilities:
 * - Abstracts storage-layer operations for key-value memory.
 * - Enforces single-thread serial writes via execution queue.
 * - Supports set/get/delete/has operations with TTL expiry.
 * - Handles serialization/deserialization to IndexedDB.
 * - Provides change tracking for dirty-checking.
 */

import { Key } from "./Key";
import Storage from "./Storage";

/**
 * Hard cap on active memories per character. When exceeded, the oldest
 * non-permanent memory is pruned automatically to prevent prompt bloat.
 * @type {number}
 */
const MAX_ACTIVE_MEMORIES = 5;

/**
 * @typedef {import("./Logger").default} Logger
 * @typedef {import("./io.types").KeyValue} KeyValue
 * @typedef {import("./io.types").KeyStorageJSON} KeyStorageJSON
 * @typedef {import("./io.types").MemoryStorageJSON} MemoryStorageJSON
 */

/**
 * High-level coordinator managing an isolated table of Key memories.
 * abstracts storage-layer operations and enforces single-thread serial writes
 * to keep local database tables consistent.
 */
export default class Memory {

    /**
     * @param {Logger} logger Main logging interface.
     * @param {string} name Isolated identity tag (corresponds to IndexedDB keys).
     */
    constructor(logger, name) {
        if (typeof name !== "string" || !name.trim()) {
            throw new TypeError("Memory container must be initialized with a non-empty name.");
        }

        /** @readonly @type {Logger} */
        this.logger = logger.child(`Memory/${name}`);

        /** @readonly @type {string} */
        this.name = name;

        /** 
         * Local map of runtime Key instances.
         * @type {Map<string, Key>} 
         */
        this.keys = new Map();

        /** 
         * Asynchronous IndexedDB storage connector.
         * @readonly @type {Storage} 
         */
        this.storage = new Storage("Memories", this.logger);

        /** 
         * Queue used to serialize write transactions sequentially.
         * @type {Promise<void>} 
         */
        this.saveQueue = Promise.resolve();
    }

    /**
     * Creates or updates a Key.
     *
     * @param {string} name Unique memory key identifier.
     * @param {KeyValue} value Data payload.
     * @param {Date|null|-1} [expiry=null] Absolute date, forever (-1), or null (unusable).
     * @returns {Key}
     */
    set(name, value, expiry = null) {
        const existing = this.keys.get(name);

        if (existing) {
            existing.update(value, expiry);
            return existing;
        }

        // Enforce the hard memory cap BEFORE inserting the new key so the
        // container never exceeds MAX_ACTIVE_MEMORIES entries.
        this.#enforceMemoryCap();

        const key = new Key(this.logger, {
            name,
            value,
            expiry
        });

        this.keys.set(name, key);
        this.logger.debug(`Successfully created memory key: ${name}`);
        return key;
    }

    /**
     * Prunes keys until the active memory count leaves room for one more
     * entry, guaranteeing the container never exceeds MAX_ACTIVE_MEMORIES.
     * Prefers the oldest non-permanent key; if every key is permanent, it
     * falls back to the oldest key in insertion order to prevent bloat.
     *
     * @returns {void}
     */
    #enforceMemoryCap() {
        while (this.keys.size >= MAX_ACTIVE_MEMORIES) {
            /** @type {string|null} */
            let oldestNonPermanent = null;

            // Map preserves insertion order, so the first non-permanent key
            // encountered is the oldest evictable entry.
            for (const [name, key] of this.keys) {
                if (!key.isForever()) {
                    oldestNonPermanent = name;
                    break;
                }
            }

            // Evict oldest non-permanent; if all keys are permanent, evict the oldest key to prevent prompt bloat
            const keyToPrune = oldestNonPermanent !== null
                ? oldestNonPermanent
                : this.keys.keys().next().value;

            if (!keyToPrune) break;

            this.keys.delete(keyToPrune);
            this.logger.debug(
                `Memory cap (${MAX_ACTIVE_MEMORIES}) reached. Pruned key: ${keyToPrune}`
            );
        }
    }

    /**
     * Recovers a Key instance, or returns null if absent.
     *
     * @param {string} name Unique memory key identifier.
     * @returns {Key|null}
     */
    get(name) {
        return this.keys.get(name) ?? null;
    }

    /**
     * Returns raw value details, or undefined if absent.
     *
     * @param {string} name Unique memory key identifier.
     * @returns {KeyValue|undefined}
     */
    getValue(name) {
        const key = this.keys.get(name);
        return key ? key.value : undefined;
    }

    /**
     * Verifies if a memory key exists.
     *
     * @param {string} name Unique memory key identifier.
     * @returns {boolean}
     */
    has(name) {
        return this.keys.has(name);
    }

    /**
     * Deletes a key from the active memory cache.
     *
     * @param {string} name Unique memory key identifier.
     * @returns {boolean}
     */
    delete(name) {
        const deleted = this.keys.delete(name);
        if (deleted) {
            this.logger.debug(`Removed key from memory cache: ${name}`);
        }
        return deleted;
    }

    /**
     * Returns total active keys.
     * @returns {number}
     */
    get size() {
        return this.keys.size;
    }

    /**
     * Checks if the memory cache is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this.keys.size === 0;
    }

    /**
     * Returns a deep copy of all Key instances.
     * @returns {Key[]}
     */
    values() {
        return [...this.keys.values()];
    }

    /**
     * Returns all expired or uninitialized keys.
     *
     * @param {Date} [date=new Date()]
     * @returns {Key[]}
     */
    getUnusable(date = new Date()) {
        return this.values().filter(key => key.isUnusable(date));
    }

    /**
     * Returns all modified keys.
     * @returns {Key[]}
     */
    getChanged() {
        return this.values().filter(key => key.hasChanged());
    }

    /**
     * Prunes expired keys, returning total pruned elements.
     *
     * @param {Date} [date=new Date()]
     * @returns {number}
     */
    removeExpired(date = new Date()) {
        let removed = 0;

        for (const [name, key] of this.keys) {
            if (key.isUsable(date)) {
                continue;
            }
            this.keys.delete(name);
            removed++;
        }

        if (removed) {
            this.logger.info(`Pruned ${removed} expired keys.`);
        }

        return removed;
    }

    /**
     * Wipes the memory cache completely.
     */
    clear() {
        if (!this.keys.size) {
            return;
        }

        const count = this.keys.size;
        this.keys.clear();
        this.logger.info(`Cleared memory cache. Purged ${count} records.`);
    }

    /**
     * Clears value change logs for all Keys.
     */
    resetHistory() {
        for (const key of this.keys.values()) {
            key.resetHistory();
        }
        this.logger.debug("Change log history cleared.");
    }

    /**
     * Serializes the collection to JSON.
     *
     * @param {boolean} [formatted=false]
     * @returns {any}
     */
    toJSON(formatted = false) {
        return this.values().map(key => formatted ? key.toJSON(true) : key.toJSON(false));
    }

    /**
     * Outputs a human-readable tracing block.
     *
     * @param {boolean} [showExpiry=false]
     * @param {boolean} [showChange=false]
     * @returns {string}
     */
    toString(showExpiry = false, showChange = false) {
        return this.values()
            .map(key => key.toString(showExpiry, showChange))
            .join("\n");
    }

    /**
     * Queues and writes the memory cache to IndexedDB sequentially.
     * Uses a execution queue to guarantee that overlapping writes are executed
     * in absolute chronological order.
     *
     * @returns {Promise<void>}
     */
    save() {
        const operation = this.saveQueue.then(async () => {
            try {
                await this.storage.setItem(this.name, this.toJSON());
                this.logger.debug(`Stored ${this.keys.size} memories successfully.`);
            } catch (/** @type {unknown} */ error) {
                this.logger.error("Failed to commit Memory state write transaction:", error);
                throw error;
            }
        });

        // Intercept promise errors so the saveQueue doesn't lock up on failures
        this.saveQueue = operation.catch(() => {});

        return operation;
    }

    /**
     * Restores memory keys from the database table safely.
     *
     * @returns {Promise<boolean>}
     */
    async load() {
        try {
            const data = await this.storage.getItem(this.name);
            if (data === null) {
                this.logger.debug("Database contains no saved states.");
                return false;
            }

            this.keys = this.#deserialize(data);
            this.logger.info(`Restored ${this.keys.size} memories successfully.`);
            return true;
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to parse persisted database contents:", error);
            throw error;
        }
    }

    /**
     * Deletes the table entry.
     *
     * @returns {Promise<void>}
     */
    async destroy() {
        try {
            await this.storage.removeItem(this.name);
            this.logger.info("Database table dropped cleanly.");
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to drop database table:", error);
            throw error;
        }
    }

    /**
     * Validates and deserializes persisted data array.
     *
     * @param {unknown} data
     * @returns {Map<string, Key>}
     */
    #deserialize(data) {
        if (!Array.isArray(data)) {
            throw new TypeError("Stored data format is corrupt: Expected an Array.");
        }

        const next = new Map();

        for (const item of data) {
            if (item === null || typeof item !== "object" || Array.isArray(item)) {
                throw new TypeError("Stored memory row is not a valid object structure.");
            }

            const stored = /** @type {KeyStorageJSON} */ (item);
            const key = Key.fromJSON(this.logger, stored);

            if (next.has(key.name)) {
                throw new Error(`Corrupted database payload: Duplicate key index detected on name "${key.name}".`);
            }

            next.set(key.name, key);
        }

        return next;
    }
}