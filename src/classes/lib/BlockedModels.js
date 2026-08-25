// @ts-check

/**
 * @file BlockedModels.js
 * IndexedDB-backed registry of AI model IDs that have been permanently blocked
 * due to availability errors (e.g. "model no longer available").
 *
 * Responsibilities:
 * - Stores blocked model IDs with a timestamp of when they were blocked.
 * - Provides fast in-memory cache for O(1) lookups during fallback resolution.
 * - Persists to IndexedDB "BlockedModels" table for cross-session durability.
 * - Auto-loads blocked models on initialization.
 * - Provides method to unblock models if needed (manual admin action).
 */

import Storage from "./Storage";

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {Object} BlockedModelEntry
 * @property {string} model The model identifier (e.g. "gemini-3.7-flash").
 * @property {number} blockedAt Unix timestamp when the model was blocked.
 * @property {string} reason Human-readable reason for blocking.
 */

/** @readonly @type {string} Single key used to persist the full list. */
const STORAGE_KEY = "__blocked_models__";

export default class BlockedModels {

    /** @readonly @type {Logger} */
    logger;

    /** @readonly @type {Storage} */
    storage;

    /**
     * In-memory cache of blocked model IDs for O(1) lookups.
     * Keys are model IDs, values are BlockedModelEntry objects.
     * @type {Map<string, BlockedModelEntry>}
     */
    #cache = new Map();

    /** @type {Promise<void>} */
    #loaded;

    /**
     * @param {Logger} logger Logger instance.
     */
    constructor(logger) {
        if (!logger) throw new TypeError("BlockedModels requires a Logger instance.");

        /** @readonly */ this.logger = logger.child("BlockedModels");
        /** @readonly */ this.storage = new Storage("BlockedModels", this.logger);

        // Auto-load on construction
        this.#loaded = this.#load();
    }

    /**
     * Waits for the initial load from IndexedDB to complete.
     * Must be awaited before calling has() or getAll().
     *
     * @returns {Promise<void>}
     */
    async ready() {
        await this.#loaded;
    }

    /**
     * Checks if a model ID is blocked.
     *
     * @param {string} modelId The model identifier to check.
     * @returns {boolean} True if the model is blocked.
     */
    has(modelId) {
        return this.#cache.has(modelId);
    }

    /**
     * Returns the blocked entry for a model, or null if not blocked.
     *
     * @param {string} modelId The model identifier to look up.
     * @returns {BlockedModelEntry|null}
     */
    get(modelId) {
        return this.#cache.get(modelId) ?? null;
    }

    /**
     * Returns all blocked model entries.
     *
     * @returns {BlockedModelEntry[]}
     */
    getAll() {
        return [...this.#cache.values()];
    }

    /**
     * Returns only the model ID strings that are blocked.
     * Useful for filtering fallback chains.
     *
     * @returns {string[]}
     */
    getBlockedIds() {
        return [...this.#cache.keys()];
    }

    /**
     * Blocks a model permanently due to an availability error.
     * Persists to IndexedDB immediately.
     *
     * @param {string} modelId The model identifier to block.
     * @param {string} reason Human-readable reason.
     * @returns {Promise<void>}
     */
    async add(modelId, reason = "Model no longer available") {
        if (!modelId || typeof modelId !== "string") {
            throw new TypeError("BlockedModels.add() requires a non-empty model ID string.");
        }

        // Already blocked, skip write
        if (this.#cache.has(modelId)) {
            this.logger.debug(`Model "${modelId}" is already blocked. Skipping.`);
            return;
        }

        /** @type {BlockedModelEntry} */
        const entry = {
            model: modelId,
            blockedAt: Date.now(),
            reason
        };

        this.#cache.set(modelId, entry);
        await this.#persist();

        this.logger.info(`Blocked model "${modelId}": ${reason}`);
    }

    /**
     * Unblocks a previously blocked model.
     * Useful for manual admin recovery or testing.
     *
     * @param {string} modelId The model identifier to unblock.
     * @returns {Promise<void>}
     */
    async remove(modelId) {
        if (!this.#cache.has(modelId)) return;

        this.#cache.delete(modelId);
        await this.#persist();

        this.logger.info(`Unblocked model "${modelId}".`);
    }

    /**
     * Clears all blocked models.
     *
     * @returns {Promise<void>}
     */
    async clear() {
        this.#cache.clear();
        await this.#persist();

        this.logger.info("All blocked models cleared.");
    }

    /**
     * Filters an array of model IDs, removing any that are blocked.
     * Returns a new array with blocked models stripped out.
     *
     * @param {string[]} models Array of model IDs to filter.
     * @returns {string[]} Filtered array without blocked models.
     */
    filter(models) {
        return models.filter(m => !this.#cache.has(m));
    }

    // =========================================================================
    // PRIVATE
    // =========================================================================

    /**
     * Loads the blocked models list from IndexedDB into the in-memory cache.
     * @returns {Promise<void>}
     */
    async #load() {
        try {
            const data = await this.storage.getItem(STORAGE_KEY);

            if (Array.isArray(data)) {
                for (const entry of data) {
                    if (entry && typeof entry === "object" && typeof entry.model === "string") {
                        this.#cache.set(entry.model, /** @type {BlockedModelEntry} */ (entry));
                    }
                }
            }

            if (this.#cache.size > 0) {
                this.logger.info(`Loaded ${this.#cache.size} blocked model(s) from database.`);
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to load blocked models from database:", error);
            // Continue with empty cache — models will be re-blocked on next error
        }
    }

    /**
     * Persists the full blocked list to IndexedDB as a single serialized entry.
     * @returns {Promise<void>}
     */
    async #persist() {
        try {
            await this.storage.setItem(STORAGE_KEY, this.getAll());
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to persist blocked models list:", error);
        }
    }
}
