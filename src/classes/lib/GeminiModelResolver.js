// @ts-check

/**
 * @file GeminiModelResolver.js
 * Dynamically resolves the Gemini model fallback ladder by fetching
 * available models from the Google AI Studio REST API.
 *
 * Responsibilities:
 * - Fetches the model list from `GET /v1beta/models?key={apiKey}`.
 * - Filters to text-generation models whose name contains "gemini".
 * - Sorts results: flash models first, then by version number descending.
 * - Caches the resolved ladder in IndexedDB to avoid repeated API calls.
 * - Provides a fast `getLadder()` method for the client to consume.
 */

import Storage from "./Storage";
import { getBlockedGeminiModels } from "../../util/apiKeys";

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {Object} GeminiModelEntry
 * @property {string} id The baseModelId (e.g. "gemini-3.7-flash").
 * @property {string} displayName Human-readable name (e.g. "Gemini 2.5 Flash").
 * @property {boolean} isFlash Whether the model is a flash variant.
 * @property {boolean} isThinking Whether the model supports thinking chains.
 * @property {number} outputTokenLimit Maximum output tokens.
 */

/** @readonly @type {number} Cache TTL: 6 hours in milliseconds. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @readonly @type {string} Storage key for the cached model list. */
const STORAGE_KEY = "gemini_model_ladder";

export default class GeminiModelResolver {

    /** @readonly @type {Logger} */
    logger;

    /** @readonly @type {Storage} */
    storage;

    /**
     * Resolved model ladder (flash-first, version-descending).
     * @type {GeminiModelEntry[]}
     */
    #ladder = [];

    /**
     * Timestamp of last successful fetch.
     * @type {number}
     */
    #fetchedAt = 0;

    /** @type {Promise<void>|null} */
    #pending = null;

    /**
     * @param {Logger} logger Logger instance.
     */
    constructor(logger) {
        if (!logger) throw new TypeError("GeminiModelResolver requires a Logger instance.");

        /** @readonly */ this.logger = logger.child("GeminiModelResolver");
        /** @readonly */ this.storage = new Storage("ModelCache", this.logger);
    }

    /**
     * Returns the resolved model ladder.
     * Fetches from API on first call or if cache is stale.
     * Falls back to cached data on network failure.
     *
     * @param {string} apiKey Gemini API key.
     * @param {string} [defaultModel] Preferred default model ID.
     * @returns {Promise<string[]>} Ordered array of model IDs (flash first).
     */
    async getLadder(apiKey, defaultModel) {
        // Use cache if fresh
        if (this.#ladder.length > 0 && (Date.now() - this.#fetchedAt) < CACHE_TTL_MS) {
            return this.#toIds(defaultModel);
        }

        // Try loading from IndexedDB cache
        await this.#loadFromCache();

        if (this.#ladder.length > 0 && (Date.now() - this.#fetchedAt) < CACHE_TTL_MS) {
            this.logger.debug("Using cached Gemini model ladder.");
            return this.#toIds(defaultModel);
        }

        // Fetch fresh from API (deduplicate concurrent calls)
        if (!this.#pending) {
            this.#pending = this.#fetchAndCache(apiKey).finally(() => {
                this.#pending = null;
            });
        }

        await this.#pending;

        // If fetch failed, use stale cache
        if (this.#ladder.length === 0) {
            await this.#loadFromCache();
        }

        return this.#toIds(defaultModel);
    }

    /**
     * Forces a refresh of the model ladder.
     * @param {string} apiKey
     * @returns {Promise<string[]>}
     */
    async refresh(apiKey) {
        this.#fetchedAt = 0;
        return this.getLadder(apiKey);
    }

    /**
     * Returns the full model entries (not just IDs).
     * @returns {GeminiModelEntry[]}
     */
    getEntries() {
        return [...this.#ladder];
    }

    // =========================================================================
    // PRIVATE
    // =========================================================================

    /**
     * Converts the internal ladder to an ordered ID array.
     * Puts the defaultModel first if provided and present in the ladder.
     * @param {string} [defaultModel]
     * @returns {string[]}
     */
    #toIds(defaultModel) {
        const ids = this.#ladder.map(m => m.id);

        // Move defaultModel to front if it exists in the ladder
        if (defaultModel) {
            const idx = ids.indexOf(defaultModel);
            if (idx > 0) {
                ids.splice(idx, 1);
                ids.unshift(defaultModel);
            } else if (idx === -1) {
                // Default not in ladder — prepend it
                ids.unshift(defaultModel);
            }
        }

        // Deduplicate while preserving order
        return [...new Set(ids)];
    }

    /**
     * Fetches the model list from the Gemini API, filters/sorts, and caches.
     * @param {string} apiKey
     * @returns {Promise<void>}
     */
    async #fetchAndCache(apiKey) {
        try {
            this.logger.info("Fetching Gemini model list from API...");

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const models = data?.models || [];

            this.#ladder = this.#filterAndSort(models);
            this.#fetchedAt = Date.now();

            // Filter out blocked models from the ladder
            const blockedIds = getBlockedGeminiModels();
            if (blockedIds.length > 0) {
                const beforeCount = this.#ladder.length;
                this.#ladder = this.#ladder.filter(m => !blockedIds.includes(m.id));
                if (this.#ladder.length < beforeCount) {
                    this.logger.info(`Filtered ${beforeCount - this.#ladder.length} blocked Gemini model(s).`);
                }
            }

            this.logger.info(`Resolved ${this.#ladder.length} Gemini text model(s) from API.`);

            // Persist to IndexedDB
            await this.#saveToCache();

        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to fetch Gemini model list:", error);
            // ladder stays empty or from cache — getLadder will fall back
        }
    }

    /**
     * Filters raw API model list to text-generation Gemini models,
     * then sorts: flash first, thinking-enabled next, version descending.
     * @param {any[]} rawModels
     * @returns {GeminiModelEntry[]}
     */
    #filterAndSort(rawModels) {
        /** @type {GeminiModelEntry[]} */
        const filtered = [];

        for (const model of rawModels) {
            const name = (model.name || "").toLowerCase();
            const baseId = model.baseModelId || "";
            const displayName = model.displayName || baseId;

            // Must contain "gemini" in the name
            if (!name.includes("gemini")) continue;

            // Must support generateContent (text generation)
            const methods = model.supportedGenerationMethods || [];
            if (!methods.includes("generateContent")) continue;

            // Skip embedding, image generation, etc.
            if (name.includes("embedding") || name.includes("imagen") || name.includes("veo")) continue;

            const isFlash = name.includes("flash");
            const isThinking = model.thinking === true;
            const outputLimit = model.outputTokenLimit || 8192;

            filtered.push({
                id: baseId,
                displayName,
                isFlash,
                isThinking,
                outputTokenLimit: outputLimit
            });
        }

        // Sort: flash first, then thinking, then by version descending
        filtered.sort((a, b) => {
            // Flash models first
            if (a.isFlash !== b.isFlash) return a.isFlash ? -1 : 1;

            // Thinking models second
            if (a.isThinking !== b.isThinking) return a.isThinking ? -1 : 1;

            // Higher version first (extract last number from id like "gemini-3.7-flash")
            const versionA = this.#extractVersion(a.id);
            const versionB = this.#extractVersion(b.id);

            return versionB - versionA;
        });

        return filtered;
    }

    /**
     * Extracts the version number from a model ID.
     * e.g. "gemini-3.7-flash" → 3.7, "gemini-3.1-pro" → 3.1
     * @param {string} id
     * @returns {number}
     */
    #extractVersion(id) {
        const match = id.match(/(\d+\.\d+)/);
        return match ? parseFloat(match[1]) : 0;
    }

    /**
     * Loads the cached ladder from IndexedDB.
     * @returns {Promise<void>}
     */
    async #loadFromCache() {
        try {
            const data = await this.storage.getItem(STORAGE_KEY);
            if (data && typeof data === "object" && Array.isArray(data.ladder) && typeof data.fetchedAt === "number") {
                this.#ladder = data.ladder;
                this.#fetchedAt = data.fetchedAt;
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to load Gemini model cache:", error);
        }
    }

    /**
     * Persists the current ladder to IndexedDB.
     * @returns {Promise<void>}
     */
    async #saveToCache() {
        try {
            await this.storage.setItem(STORAGE_KEY, {
                ladder: this.#ladder,
                fetchedAt: this.#fetchedAt
            });
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to persist Gemini model cache:", error);
        }
    }
}
