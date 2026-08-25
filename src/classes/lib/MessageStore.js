// @ts-check

/**
 * @file MessageStore.js
 * Persistent message storage layer backed by IndexedDB.
 *
 * Responsibilities:
 * - Handles message writes, deletes, and restores from IndexedDB.
 * - Enforces serial execution on all write tasks via promise chain.
 * - Prevents table bloat with a 1000-message history cap.
 * - Recovers gracefully from individual corrupt database records.
 * - Sorts messages chronologically before restoring from storage.
 */

import Storage from "./Storage";
import Message from "../Message";

/** @typedef {import("../ChatMember").default} ChatMember */
/** @typedef {import("./Logger").default} Logger */

const PREFIX = "message:";
const LIMIT = 1000; // Cap persistent history index to keep loads performing optimally

/**
 * Handles persistent message writes, deletes, and restores from IndexedDB.
 * Enforces serial execution on all write tasks, prevents table bloat,
 * and recovers gracefully from individual corrupt database records.
 */
export default class MessageStore {
    /**
     * @param {Logger} logger Root logging interface.
     */
    constructor(logger) {
        if (!logger) throw new TypeError("MessageStore requires a Logger instance.");

        /** @readonly @type {Logger} */
        this.logger = logger.child("MessageStore");

        /** @readonly @type {Storage} */
        this.storage = new Storage("MessageStore");

        /** 
         * Promise chain ensuring database writes occur sequentially.
         * @type {Promise<void>} 
         */
        this.persistence = Promise.resolve();
    }

    /**
     * Commits a message to persistent storage.
     *
     * @param {Message} message
     * @returns {Promise<void>}
     */
    save(message) {
        if (!(message instanceof Message)) {
            return Promise.reject(new TypeError("MessageStore.save() requires a valid Message instance."));
        }

        // Chain the save transaction to prevent write-order collisions
        return this.#persist(() =>
            this.storage.setItem(
                this.#key(message.id),
                message.toJSON()
            )
        );
    }

    /**
     * Deletes a message from persistent storage.
     *
     * @param {string} id Unique target ID.
     * @returns {Promise<void>}
     */
    remove(id) {
        if (!this.#validId(id)) {
            return Promise.reject(new TypeError("Failed to remove message: Invalid ID string provided."));
        }

        return this.#persist(() =>
            this.storage.removeItem(this.#key(id))
        );
    }

    /**
     * Wipes the message store entirely.
     *
     * @returns {Promise<void>}
     */
    clear() {
        return this.#persist(() => this.storage.clear());
    }

    /**
     * Block execution flow until all queued database transactions are fully committed.
     *
     * @returns {Promise<void>}
     */
    async flush() {
        await this.persistence;
    }

    /**
     * Restores historical conversation messages.
     * Isolates and bypasses corrupt database records safely so the load sequence is uninterrupted.
     *
     * @param {(id: string) => ChatMember|undefined} getMember Member resolver callback.
     * @returns {Promise<Message[]>}
     */
    async load(getMember) {
        if (typeof getMember !== "function") {
            throw new TypeError("MessageStore.load() requires a valid 'getMember' callback function.");
        }

        let entries;
        try {
            entries = await this.storage.entries();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to read message database table entries:", error);
            throw error;
        }

        const records = [];

        for (const [key, value] of entries) {
            if (!key.startsWith(PREFIX)) {
                continue; // Ignore unrecognized keys in table
            }

            if (!this.#validRecord(value)) {
                this.logger.warn(`Bypassed corrupted or malformed database row matching key: "${key}"`);
                continue;
            }

            records.push(value);
        }

        // Sort messages chronologically by timestamp before instantiating
        records.sort((a, b) => this.#time(a.sentAt) - this.#time(b.sentAt));

        const messages = [];
        const messageMap = new Map();

        for (const data of records) {
            try {
                const senderId = typeof data.senderId === "string" ? data.senderId : null;
                const sender = senderId === null ? undefined : getMember(senderId);

                // Reconstruct Message structure from validated JSON
                const message = Message.fromJSON(data, sender ?? null);

                if (messageMap.has(message.id)) {
                    this.logger.warn(`Discarded duplicate message ID detected during load: ${message.id}`);
                    continue;
                }

                // If sender has been deleted, preserve the message content but toggle deletion state
                if (!sender) {
                    message.delete();
                }

                messages.push(message);
                messageMap.set(message.id, message);
            } catch (/** @type {unknown} */ error) {
                // Recoverable: Continue loading history even if a single message instantiator throws
                this.logger.error("Skipped unparseable message row during history restoration loop:", error);
            }
        }

        // Enforce history thresholds defensively to prevent memory bloat on heavy chat sessions
        if (messages.length > LIMIT) {
            const excess = messages.splice(0, messages.length - LIMIT);
            this.logger.warn(`History bounds exceeded. Pruning ${excess.length} oldest message records from table.`);
            await this.#removeMany(excess.map(message => message.id));
        }

        return messages;
    }

    /**
     * Batch deletes multiple message entries.
     *
     * @param {string[]} ids Array of unique identifiers.
     * @returns {Promise<void>}
     */
    async #removeMany(ids) {
        if (!ids.length) return;

        await this.#persist(async () => {
            for (const id of ids) {
                await this.storage.removeItem(this.#key(id));
            }
        });
    }

    /**
     * Appends key prefixes safely.
     *
     * @param {string} id Unique target ID.
     * @returns {string}
     */
    #key(id) {
        return `${PREFIX}${id}`;
    }

    /**
     * Verifies if a string ID is non-empty.
     *
     * @param {unknown} value
     * @returns {value is string}
     */
    #validId(value) {
        return typeof value === "string" && value.trim().length > 0;
    }

    /**
     * Checks if a database record complies with serialization boundaries.
     *
     * @param {any} value
     * @returns {boolean}
     */
    #validRecord(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }

        if (!this.#validId(value.id)) {
            return false;
        }

        if (value.senderId !== null && !this.#validId(value.senderId)) {
            return false;
        }

        if (value.replyId !== null && !this.#validId(value.replyId)) {
            return false;
        }

        if (value.sentAt !== null && typeof value.sentAt !== "string") {
            return false;
        }

        return true;
    }

    /**
     * Parses ISO timestamps securely, returning 0 on fail.
     *
     * @param {string|null} value
     * @returns {number}
     */
    #time(value) {
        if (!value) return 0;
        const time = Date.parse(value);
        return Number.isFinite(time) ? time : 0;
    }

    /**
     * Appends database tasks sequentially to prevent write conflict conditions.
     *
     * @param {() => Promise<void>} operation Database write transaction.
     * @returns {Promise<void>}
     */
    #persist(operation) {
        const next = this.persistence.then(operation, operation);

        this.persistence = next.catch(error => {
            this.logger.error("Sequential persistence transaction encountered an error:", error);
        });

        return next;
    }
}