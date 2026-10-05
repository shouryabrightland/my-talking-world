// @ts-check

/**
 * @file GeminiModelResolver.js → GeminiModelPool
 * Dynamic, self-healing Gemini model pool for the Planner (WorldSetter).
 *
 * Responsibilities:
 * - Discovers models from `GET /v1beta/models?key=...` (6h IndexedDB cache).
 * - Keeps only text-generation models (`generateContent`), dropping
 *   embedding / imagen / veo / tts / audio models.
 * - Ranks them by a fully dynamic priority hierarchy (never hardcoded IDs):
 *     Tier 1: Flash          (name has "flash", not "flash-lite")
 *     Tier 2: Flash-Lite     (name has "flash-lite")
 *     Tier 3: Pro            (name has "pro")
 *     Tier 4: Gemma          (name has "gemma")
 *     Tier 5: everything else
 *   Within a tier, higher versions sort first.
 * - Maintains an in-memory `activeStack` and a `cooldownMap`. Models hitting
 *   429 / 503 (or timing out) are ejected for 5 minutes (300s), after which
 *   they are automatically restored. Models hitting a permanent error
 *   (404 Not Found / 400 Invalid Argument) are ejected from the active stack
 *   for the entire session and are never revived.
 *
 * The pool NEVER falls back to another provider: if every Gemini model is
 * cooling down or discovery fails, callers get an empty candidate list and
 * must use their own local fallback generator.
 */

import Storage from "./Storage";
import { getGeminiApiKey, getBlockedGeminiModels } from "../../util/apiKeys";
import { GEMINI_API_BASE_URL } from "../../util/config";

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {Object} GeminiModelEntry
 * @property {string} id Canonical model id (e.g. "gemini-2.5-flash").
 * @property {string} displayName Human-readable name (e.g. "Gemini 2.5 Flash").
 * @property {number} tier Priority tier (1 = highest).
 * @property {number} version Parsed version number used for in-tier sorting.
 * @property {boolean} isFlash Whether the model is a flash variant.
 * @property {boolean} isFlashLite Whether the model is a flash-lite variant.
 * @property {number} outputTokenLimit Maximum output tokens.
 */

/** @readonly @type {number} Cache TTL: 6 hours in milliseconds. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @readonly @type {number} Cooldown window after 429/503/timeout (5 minutes). */
export const MODEL_COOLDOWN_MS = 300_000;

/** @readonly @type {string} Storage key for the cached model ladder. */
const STORAGE_KEY = "gemini_model_pool";

/** @readonly @type {readonly number[]} Transient HTTP statuses that force a 5-minute cooldown. */
const COOLDOWN_STATUSES = Object.freeze([429, 503]);

/** @readonly @type {readonly number[]} Permanent HTTP statuses that eject a model for the whole session. */
export const PERMANENT_EJECT_STATUSES = Object.freeze([400, 404]);

/** Substrings marking non text-generation models. @type {readonly string[]} */
const NON_TEXT_MARKERS = Object.freeze(["embedding", "imagen", "veo", "tts", "audio"]);

/** @readonly @type {readonly string[]} Substrings marking non-text model families. */
const NON_MODEL_MARKERS = NON_TEXT_MARKERS;

/**
 * Computes the dynamic priority tier of a model id.
 * @param {string} id Model id.
 * @returns {number} 1 (Flash) … 5 (unclassified).
 */
export function tierOf(id) {
    const n = String(id || "").toLowerCase();
    if (n.includes("flash-lite") || n.includes("flashlite")) return 2;
    if (n.includes("flash")) return 1;
    if (n.includes("pro")) return 3;
    if (n.includes("gemma")) return 4;
    return 5;
}

/**
 * Extracts the leading version number from a model id.
 * e.g. "gemini-2.5-flash" → 2.5, "gemma-3-27b" → 3
 * @param {string} id Model id.
 * @returns {number} Parsed version (0 when absent).
 */
export function versionOf(id) {
    const match = String(id || "").match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

/**
 * Filters a raw `GET /v1beta/models` payload down to text-generation Gemini
 * models and decorates them with tier/version metadata.
 *
 * @param {any[]} rawModels Raw `models[]` payload.
 * @param {string[]} [blockedIds] Model ids that must be dropped.
 * @returns {GeminiModelEntry[]} Filtered, decorated entries (unsorted).
 */
export function normalizeGeminiModels(rawModels, blockedIds = []) {
    if (!Array.isArray(rawModels)) return [];

    /** @type {Set<string>} */
    const blocked = new Set(blockedIds);
    /** @type {GeminiModelEntry[]} */
    const entries = [];

    for (const model of rawModels) {
        if (!model || typeof model !== "object") continue;

        const rawName = typeof model.name === "string" ? model.name : "";
        const id = rawName.replace(/^models\//, "") || String(model.baseModelId || "");
        if (!id) continue;

        const lowered = id.toLowerCase();
        if (NON_MODEL_MARKERS.some(marker => lowered.includes(marker))) continue;
        if (blocked.has(id)) continue;

        const methods = Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods
            : [];
        if (!methods.includes("generateContent")) continue;

        entries.push({
            id,
            displayName: typeof model.displayName === "string" && model.displayName ? model.displayName : id,
            tier: tierOf(id),
            version: versionOf(id),
            isFlash: lowered.includes("flash") && !(lowered.includes("flash-lite") || lowered.includes("flashlite")),
            isFlashLite: lowered.includes("flash-lite") || lowered.includes("flashlite"),
            outputTokenLimit: typeof model.outputTokenLimit === "number" ? model.outputTokenLimit : 8192
        });
    }

    return entries;
}

/**
 * Sorts entries by the dynamic priority hierarchy: tier ascending,
 * then version descending, then id ascending (stable tie-break).
 *
 * @param {GeminiModelEntry[]} entries Entries to sort.
 * @returns {GeminiModelEntry[]} New array sorted by priority (best first).
 */
export function prioritizeGeminiModels(entries) {
    return [...entries].sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        if (a.version !== b.version) return b.version - a.version;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
}

export default class GeminiModelPool {

    /** @readonly @type {Logger} */ logger;
    /** @readonly @type {Storage} */ storage;

    /** @type {Map<string, GeminiModelEntry>} Discovered models by id. */
    #entries = new Map();

    /** @type {string[]} Priority-ordered active stack (best first). */
    #stack = [];

    /** @type {Map<string, number>} Model id → cooldown recovery timestamp. */
    #cooldownMap = new Map();

    /** @type {Set<string>} Model ids permanently ejected (400/404) for this session. */
    #ejected = new Set();

    /** @type {number} Timestamp of the last successful discovery. */
    #fetchedAt = 0;

    /** @type {Promise<void>|null} In-flight discovery dedupe. */
    #pending = null;

    /** @param {Logger} logger Logger instance. */
    constructor(logger) {
        if (!logger) throw new TypeError("GeminiModelPool requires a Logger instance.");

        /** @readonly */ this.logger = logger.child("GeminiModelPool");
        /** @readonly */ this.storage = new Storage("ModelCache", this.logger);
    }

    /**
     * Returns the active (non-cooling) model stack, best model first.
     * Triggers discovery when the in-memory/IndexedDB cache is stale.
     *
     * @returns {Promise<GeminiModelEntry[]>} Ordered active candidates.
     */
    async getCandidates() {
        await this.#ensureLoaded();
        this.#restoreRecovered();

        /** @type {GeminiModelEntry[]} */
        const active = [];
        for (const id of this.#activeStack()) {
            const entry = this.#entries.get(id);
            if (entry) active.push(entry);
        }
        return active;
    }

    /**
     * Convenience: highest-priority active model id, or null when the pool is
     * empty (discovery failed or every model is cooling down).
     *
     * @returns {Promise<string|null>}
     */
    async getActiveModel() {
        const candidates = await this.getCandidates();
        return candidates.length > 0 ? candidates[0].id : null;
    }

    /**
     * Records a failed attempt against a model.
     * - HTTP 400 / 404 (invalid argument / not found): the model is
     *   permanently ejected from the active stack for the entire session.
     * - HTTP 429 / 503 (or a timeout, i.e. `status === null`): the model is
     *   placed on a 5-minute cooldown (MODEL_COOLDOWN_MS).
     * - Any other status is ignored (no cooldown).
     *
     * @param {string} modelId Model that failed.
     * @param {number|null} [status=null] HTTP status, or null for timeout/network errors.
     * @returns {boolean} True when the model was ejected (cooldown or permanent).
     */
    reportFailure(modelId, status = null) {
        if (!modelId || !this.#entries.has(modelId)) return false;

        // Permanent errors: eject for the whole session, never revive.
        if (status !== null && PERMANENT_EJECT_STATUSES.includes(status)) {
            this.#ejected.add(modelId);
            this.#cooldownMap.delete(modelId);
            this.#stack = this.#stack.filter(id => id !== modelId);
            this.logger.warn(`Gemini model "${modelId}" permanently ejected for this session (HTTP ${status}).`);
            return true;
        }

        const shouldCooldown = status === null || COOLDOWN_STATUSES.includes(status);
        if (!shouldCooldown) return false;

        this.#cooldownMap.set(modelId, Date.now() + MODEL_COOLDOWN_MS);
        this.#stack = this.#stack.filter(id => id !== modelId);

        const reason = status === null ? "timeout" : `HTTP ${status}`;
        this.logger.warn(`Gemini model "${modelId}" cooling down for ${MODEL_COOLDOWN_MS / 1000}s (${reason}).`);
        return true;
    }

    /**
     * Records a successful generation against a model (clears any cooldown).
     * Permanently ejected models are never restored, even on success.
     * @param {string} modelId Model that succeeded.
     * @returns {void}
     */
    reportSuccess(modelId) {
        if (!modelId) return;
        if (this.#ejected.has(modelId)) return;
        this.#cooldownMap.delete(modelId);
        if (this.#entries.has(modelId) && !this.#stack.includes(modelId)) {
            this.#stack = prioritizeGeminiModels([...this.#entries.values()]).map(e => e.id).filter(id => !this.#ejected.has(id));
        }
    }

    /**
     * @param {string} modelId Model to look up.
     * @returns {number|null} Remaining cooldown ms, or null when not cooling.
     */
    cooldownRemaining(modelId) {
        const until = this.#cooldownMap.get(modelId);
        if (until === undefined) return null;
        const remaining = until - Date.now();
        if (remaining <= 0) {
            this.#cooldownMap.delete(modelId);
            return null;
        }
        return remaining;
    }

    /**
     * Snapshot of every model currently cooling down.
     * @returns {Record<string, number>} Model id → remaining cooldown ms.
     */
    snapshot() {
        /** @type {Record<string, number>} */
        const cooling = {};
        for (const id of this.#cooldownMap.keys()) {
            const remaining = this.cooldownRemaining(id);
            if (remaining !== null) cooling[id] = remaining;
        }
        return { ...cooling };
    }

    /**
     * Forces a fresh discovery round on the next query.
     * @returns {void}
     */
    invalidate() {
        this.#fetchedAt = 0;
    }

    // =========================================================================
    // PRIVATE
    // =========================================================================

    /**
     * Ordered ids of models that are active (not cooling, not permanently ejected).
     * @returns {string[]}
     */
    #activeStack() {
        this.#restoreRecovered();
        const cooling = this.#cooldownMap;
        return this.#stack.filter(id => !cooling.has(id) && !this.#ejected.has(id));
    }

    /** Moves models whose cooldown elapsed back onto the active stack. @returns {void} */
    #restoreRecovered() {
        if (this.#cooldownMap.size === 0) return;

        const now = Date.now();
        /** @type {string[]} */
        const recovered = [];

        for (const [id, until] of this.#cooldownMap) {
            if (now >= until) {
                this.#cooldownMap.delete(id);
                recovered.push(id);
            }
        }

        if (recovered.length > 0) {
            const order = prioritizeGeminiModels([...this.#entries.values()]).map(e => e.id);
            this.#stack = order.filter(id => this.#entries.has(id) && !this.#ejected.has(id));
            this.logger.info(`Restored ${recovered.length} Gemini model(s) from cooldown.`);
        }
    }

    /**
     * Ensures the pool has a fresh (≤6h) model list.
     * @returns {Promise<void>}
     */
    async #ensureLoaded() {
        if (this.#stack.length > 0 && (Date.now() - this.#fetchedAt) < CACHE_TTL_MS) return;

        await this.#loadFromCache();
        if (this.#stack.length > 0 && (Date.now() - this.#fetchedAt) < CACHE_TTL_MS) return;

        const apiKey = getGeminiApiKey();
        if (!apiKey) {
            if (this.#stack.length === 0) {
                this.logger.warn("No Gemini API key available — model pool stays empty.");
            }
            return;
        }

        if (!this.#pending) {
            this.#pending = this.#fetchAndCache(apiKey).finally(() => { this.#pending = null; });
        }
        await this.#pending;

        if (this.#stack.length === 0) await this.#loadFromCache();
    }

    /**
     * Fetches, filters, ranks and persists the model list.
     * @param {string} apiKey Gemini API key.
     * @returns {Promise<void>}
     */
    async #fetchAndCache(apiKey) {
        try {
            const response = await fetch(`${GEMINI_API_BASE_URL}/models?key=${apiKey}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const blockedIds = getBlockedGeminiModels();
            const entries = normalizeGeminiModels(data?.models || [], blockedIds);
            const ranked = prioritizeGeminiModels(entries);

            this.#entries = new Map(ranked.map(e => [e.id, e]));
            this.#stack = ranked.map(e => e.id).filter(id => !this.#ejected.has(id));
            this.#cooldownMap.clear();
            this.#fetchedAt = Date.now();

            this.logger.info(`Discovered ${this.#stack.length} Gemini text model(s) from API.`);
            await this.#saveToCache();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to fetch Gemini model list:", error);
        }
    }

    /**
     * Loads the cached ladder from IndexedDB.
     * @returns {Promise<void>}
     */
    async #loadFromCache() {
        try {
            const data = await this.storage.getItem(STORAGE_KEY);
            if (
                data && typeof data === "object" &&
                Array.isArray(data.ladder) &&
                typeof data.fetchedAt === "number"
            ) {
                const entries = /** @type {GeminiModelEntry[]} */ (data.ladder);
                this.#entries = new Map(entries.map(e => [e.id, e]));
                this.#stack = entries.map(e => e.id).filter(id => !this.#ejected.has(id));
                this.#fetchedAt = data.fetchedAt;
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to load Gemini model pool cache:", error);
        }
    }

    /**
     * Persists the current ladder to IndexedDB.
     * @returns {Promise<void>}
     */
    async #saveToCache() {
        try {
            await this.storage.setItem(STORAGE_KEY, {
                ladder: [...this.#entries.values()],
                fetchedAt: this.#fetchedAt
            });
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to persist Gemini model pool cache:", error);
        }
    }
}
