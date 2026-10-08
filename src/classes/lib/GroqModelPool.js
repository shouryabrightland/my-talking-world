// @ts-check

/**
 * @file GroqModelPool.js → 100% Dynamic Groq Model Discovery Pool
 *
 * Responsibilities:
 * - Queries `GET /openai/v1/models` against the user's API key.
 * - Filters out safeguard & non-text models (guard / whisper / tts / embedding / vision).
 * - Filters out any model below 12B parameters (no 8b, 7b, 3b, 1b).
 * - Dynamically ranks discovered models >= 12B by parameter size & quality:
 *     Tier 1: Flagship Models >= 70B (e.g. 120b, 70b)
 *     Tier 2: Mid-range Models 20B - 70B (e.g. 27b, 32b)
 *     Tier 3: 12B - 20B or Mixture-of-Experts (e.g. 8x7b)
 * - Self-healing cooldowns tracking real server reset headers.
 */

import Storage from "./Storage";
import { getApiKey, GROQ_NON_CHAT_MODEL_MARKERS } from "../../util/apiKeys";
import { GROQ_API_BASE_URL } from "../../util/config";

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {Object} GroqModelEntry
 * @property {string} id Canonical model id.
 * @property {string} displayName Human-readable name.
 * @property {number} tier Priority tier (1 = best flagship).
 * @property {number} version Parsed version number.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const GROQ_MODEL_COOLDOWN_MS = 60_000;
const STORAGE_KEY = "groq_model_pool";

const COOLDOWN_STATUSES = Object.freeze([429, 503]);
export const PERMANENT_EJECT_STATUSES = Object.freeze([400, 404]);
const NON_CHAT_MARKERS = GROQ_NON_CHAT_MODEL_MARKERS;

/**
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
export function parseGroqDurationMs(raw) {
    if (raw === null || raw === undefined) return null;
    const value = String(raw).trim();
    if (!value) return null;

    if (/^\d+(\.\d+)?$/.test(value)) {
        return Math.round(parseFloat(value) * 1000);
    }

    const msMatch = /^(\d+)ms$/.exec(value);
    if (msMatch) return Number(msMatch[1]);

    const durMatch = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
    if (durMatch && (durMatch[1] || durMatch[2] || durMatch[3])) {
        const hours = Number(durMatch[1] || 0);
        const minutes = Number(durMatch[2] || 0);
        const seconds = Number(durMatch[3] || 0);
        return Math.round(hours * 3_600_000 + minutes * 60_000 + seconds * 1000);
    }

    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());

    return null;
}

/**
 * Computes priority tier for models >= 12B.
 * @param {string} id Model id.
 * @returns {number} 1 (>=70B flagship), 2 (20B-70B), 3 (12B-20B / MoE).
 */
export function tierOf(id) {
    const n = String(id || "").toLowerCase();

    // Dense parameter extraction
    const size = /(?:^|\D)(\d+(?:\.\d+)?)b(?:\D|$)/.exec(n);
    if (size) {
        const params = parseFloat(size[1]);
        if (params >= 70) return 1;
        if (params >= 20) return 2;
        return 3;
    }

    // Flagship name markers
    if (n.includes("oss") || n.includes("120b") || n.includes("70b") || n.includes("versatile")) return 1;
    if (n.includes("qwen")) return 2;

    return 3;
}

/**
 * @param {string} id
 * @returns {number}
 */
export function versionOf(id) {
    const match = String(id || "").match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

/**
 * Filters raw model list from API strictly to text chat models >= 12B.
 *
 * @param {any[]} rawModels Raw data[] array from GET /openai/v1/models.
 * @param {string[]} [blockedIds]
 * @returns {GroqModelEntry[]}
 */
export function normalizeGroqModels(rawModels, blockedIds = []) {
    if (!Array.isArray(rawModels)) return [];

    /** @type {Set<string>} */
    const blocked = new Set(blockedIds);
    /** @type {GroqModelEntry[]} */
    const entries = [];

    for (const model of rawModels) {
        if (!model || typeof model !== "object") continue;

        const id = typeof model.id === "string" ? model.id.trim() : "";
        if (!id) continue;

        const lowered = id.toLowerCase();

        // 1. Filter non-chat, audio, safeguard, vision, embeddings
        if (NON_CHAT_MARKERS.some(marker => lowered.includes(marker))) continue;
        if (blocked.has(id)) continue;

        // 2. STRICT SIZE FILTER: Exclude any model below 12B
        const moe = /(\d+)x(\d+)b/.exec(lowered);
        if (moe) {
            const totalParams = Number(moe[1]) * Number(moe[2]);
            if (totalParams < 12) continue; // Skip sub-12B MoE
        } else {
            const sizeMatch = /(?:^|\D)(\d+(?:\.\d+)?)b(?:\D|$)/.exec(lowered);
            if (sizeMatch) {
                const params = parseFloat(sizeMatch[1]);
                if (params < 12) continue; // Drops 8b, 7b, 3b, 1b models
            } else if (lowered.includes("instant")) {
                continue; // Instant models are sub-12B
            }
        }

        entries.push({
            id,
            displayName: typeof model.display_name === "string" && model.display_name ? model.display_name : id,
            tier: tierOf(id),
            version: versionOf(id)
        });
    }

    return entries;
}

/**
 * Sorts entries: Tier 1 (>=70B flagship) first, then higher version, then id.
 *
 * @param {GroqModelEntry[]} entries
 * @returns {GroqModelEntry[]}
 */
export function prioritizeGroqModels(entries) {
    return [...entries].sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        if (a.version !== b.version) return b.version - a.version;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
}

export default class GroqModelPool {

    /** @readonly @type {Logger} */ logger;
    /** @readonly @type {Storage} */ storage;

    #entries = new Map();
    /** @type {string[]} */
    #stack = [];
    #cooldownMap = new Map();
    #serverPauseMap = new Map();
    #ejected = new Set();
    /** @type {string|null} */
    #activeModelId = null;
    #fetchedAt = 0;
    /** @type {Promise<void>|null} */
    #pending = null;

    /** @param {Logger} logger */
    constructor(logger) {
        if (!logger) throw new TypeError("GroqModelPool requires a Logger instance.");

        /** @readonly */ this.logger = logger.child("GroqModelPool");
        /** @readonly */ this.storage = new Storage("ModelCache", this.logger);
    }

    get activeModelId() {
        return this.#activeModelId;
    }

    async getCandidates() {
        await this.#ensureLoaded();
        this.#restoreRecovered();

        /** @type {GroqModelEntry[]} */
        const active = [];
        for (const id of this.#activeStack()) {
            const entry = this.#entries.get(id);
            if (entry) active.push(entry);
        }

        this.#activeModelId = active.length > 0 ? active[0].id : this.#activeModelId;
        return active;
    }

    async getActiveModel() {
        const candidates = await this.getCandidates();
        return candidates.length > 0 ? candidates[0].id : null;
    }

    /**
     * Records a failed call for a model, cooling it down or ejecting it.
     *
     * @param {string} modelId
     * @param {number|null} [status=null] HTTP status of the failure, if any.
     * @param {number|null} [resetMs=null] Exact server-provided reset window in ms.
     * @returns {boolean} True when the model was ejected or put on cooldown.
     */
    reportFailure(modelId, status = null, resetMs = null) {
        if (!modelId) return false;

        if (status !== null && PERMANENT_EJECT_STATUSES.includes(status)) {
            this.#ejected.add(modelId);
            this.#cooldownMap.delete(modelId);
            this.#serverPauseMap.delete(modelId);
            this.#stack = this.#stack.filter(id => id !== modelId);
            if (this.#activeModelId === modelId) this.#activeModelId = null;
            this.logger.warn(`Groq model "${modelId}" permanently ejected for this session (HTTP ${status}).`);
            return true;
        }

        const shouldCooldown = status === null || COOLDOWN_STATUSES.includes(status);
        if (!shouldCooldown) return false;

        const cooldownMs = typeof resetMs === "number" && Number.isFinite(resetMs) && resetMs > 0 ? resetMs : GROQ_MODEL_COOLDOWN_MS;
        this.#cooldownMap.set(modelId, Date.now() + cooldownMs);
        this.#stack = this.#stack.filter(id => id !== modelId);
        if (this.#activeModelId === modelId) this.#activeModelId = null;

        const reason = status === null ? "timeout" : `HTTP ${status}`;
        this.logger.warn(`Groq model "${modelId}" cooling down for ${Math.round(cooldownMs / 1000)}s (${reason}, server reset).`);
        return true;
    }

    /**
     * @param {string} modelId
     * @returns {void}
     */
    reportSuccess(modelId) {
        if (!modelId) return;
        if (this.#ejected.has(modelId)) return;
        this.#cooldownMap.delete(modelId);
        if (this.#entries.has(modelId)) {
            this.#activeModelId = modelId;
            if (!this.#stack.includes(modelId)) {
                this.#stack = prioritizeGroqModels([...this.#entries.values()]).map(e => e.id).filter(id => !this.#ejected.has(id));
            }
        }
    }

    /**
     * @param {string} modelId
     * @param {{ remainingRequests: string|null, remainingTokens: string|null, resetRequests: string|null, resetTokens: string|null, retryAfter: string|null }} rateInfo
     * @returns {number|null} Reset window in ms when the rate window is exhausted, else null.
     */
    observeRateLimit(modelId, rateInfo) {
        if (!modelId || !rateInfo) return null;

        const remainingRequests = Number(rateInfo.remainingRequests);
        const remainingTokens = Number(rateInfo.remainingTokens);
        const exhausted =
            (Number.isFinite(remainingRequests) && remainingRequests <= 0) ||
            (Number.isFinite(remainingTokens) && remainingTokens <= 0);

        if (!exhausted) return null;

        const resetMs =
            parseGroqDurationMs(rateInfo.resetRequests) ??
            parseGroqDurationMs(rateInfo.resetTokens) ??
            parseGroqDurationMs(rateInfo.retryAfter);

        if (resetMs !== null && resetMs > 0 && !this.#ejected.has(modelId)) {
            const until = Date.now() + resetMs;
            const existing = this.#serverPauseMap.get(modelId) || 0;
            if (until > existing) this.#serverPauseMap.set(modelId, until);
            this.logger.debug(`Groq rate window exhausted on "${modelId}" — pausing ${Math.round(resetMs / 1000)}s.`);
        }

        return resetMs;
    }

    /**
     * @param {string} modelId
     * @returns {number|null} Remaining cooldown/pause in ms, or null when not cooling.
     */
    cooldownRemaining(modelId) {
        const failureUntil = this.#cooldownMap.get(modelId);
        const serverUntil = this.#serverPauseMap.get(modelId);
        const until = Math.max(failureUntil || 0, serverUntil || 0);
        if (!until) return null;

        const remaining = until - Date.now();
        if (remaining <= 0) {
            this.#cooldownMap.delete(modelId);
            this.#serverPauseMap.delete(modelId);
            return null;
        }
        return remaining;
    }

    allModelsBlocked() {
        this.#restoreRecovered();
        if (this.#coolingIds().length === 0) return false;
        return this.#activeStack().length === 0;
    }

    allModelsCooling() {
        this.#restoreRecovered();
        if (this.#entries.size === 0) return false;

        for (const id of this.#entries.keys()) {
            if (!this.#cooldownMap.has(id) && !this.#serverPauseMap.has(id)) return false;
        }
        return true;
    }

    minCooldownRemaining() {
        /** @type {number|null} */ let min = null;
        for (const id of this.#coolingIds()) {
            const remaining = this.cooldownRemaining(id);
            if (remaining === null) continue;
            min = min === null ? remaining : Math.min(min, remaining);
        }
        return min;
    }

    #coolingIds() {
        /** @type {Set<string>} */ const cooling = new Set();
        for (const id of this.#cooldownMap.keys()) cooling.add(id);
        for (const id of this.#serverPauseMap.keys()) cooling.add(id);
        return [...cooling].filter(id => !this.#ejected.has(id));
    }

    listModels() {
        this.#restoreRecovered();
        const active = new Set(this.#activeStack());

        return [...this.#entries.values()].map(entry => {
            if (this.#ejected.has(entry.id)) {
                return { ...entry, status: "ejected", cooldownRemainingMs: null, isActive: false };
            }

            const cooldownRemainingMs = this.cooldownRemaining(entry.id);
            if (cooldownRemainingMs !== null) {
                return { ...entry, status: "cooling", cooldownRemainingMs, isActive: false };
            }

            return { ...entry, status: "healthy", cooldownRemainingMs: null, isActive: active.has(entry.id) };
        });
    }

    /**
     * @param {string} modelId
     * @returns {boolean}
     */
    isEjected(modelId) {
        return this.#ejected.has(modelId);
    }

    snapshot() {
        /** @type {Record<string, number>} */
        const cooling = {};
        for (const id of [...this.#cooldownMap.keys(), ...this.#serverPauseMap.keys()]) {
            const remaining = this.cooldownRemaining(id);
            if (remaining !== null) cooling[id] = remaining;
        }
        return { ...cooling };
    }

    invalidate() {
        this.#fetchedAt = 0;
    }

    #activeStack() {
        this.#restoreRecovered();
        return this.#stack.filter(id => !this.#cooldownMap.has(id) && !this.#serverPauseMap.has(id) && !this.#ejected.has(id));
    }

    #restoreRecovered() {
        if (this.#cooldownMap.size === 0 && this.#serverPauseMap.size === 0) return;

        const now = Date.now();
        /** @type {string[]} */
        const recovered = [];

        for (const [id, until] of this.#cooldownMap) {
            if (now >= until) {
                this.#cooldownMap.delete(id);
                recovered.push(id);
            }
        }
        for (const [id, until] of this.#serverPauseMap) {
            if (now >= until) {
                this.#serverPauseMap.delete(id);
                recovered.push(id);
            }
        }

        if (recovered.length > 0) {
            const order = prioritizeGroqModels([...this.#entries.values()]).map(e => e.id);
            this.#stack = order.filter(id => this.#entries.has(id) && !this.#ejected.has(id));
            this.logger.info(`Restored ${recovered.length} Groq model(s) from cooldown.`);
        }
    }

    async #ensureLoaded() {
        if (this.#stack.length > 0 && (Date.now() - this.#fetchedAt) < CACHE_TTL_MS) return;

        await this.#loadFromCache();
        if (this.#stack.length > 0 && (Date.now() - this.#fetchedAt) < CACHE_TTL_MS) return;

        const apiKey = getApiKey();
        if (!apiKey) {
            if (this.#stack.length === 0) {
                this.logger.warn("No Groq API key available — model pool stays empty.");
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
     * @param {string} apiKey
     * @returns {Promise<void>}
     */
    async #fetchAndCache(apiKey) {
        try {
            const response = await fetch(`${GROQ_API_BASE_URL}/models`, {
                headers: { "Authorization": `Bearer ${apiKey}` }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const entries = normalizeGroqModels(data?.data || []);
            const ranked = prioritizeGroqModels(entries);

            this.#entries = new Map(ranked.map(e => [e.id, e]));
            this.#stack = ranked.map(e => e.id).filter(id => !this.#ejected.has(id));
            this.#cooldownMap.clear();
            this.#serverPauseMap.clear();
            this.#fetchedAt = Date.now();
            this.#activeModelId = this.#stack.length > 0 ? this.#stack[0] : null;

            this.logger.info(`Discovered ${this.#stack.length} Groq text chat model(s) (>=12B) from API.`);
            await this.#saveToCache();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to fetch Groq model list:", error);
        }
    }

    async #loadFromCache() {
        try {
            const data = await this.storage.getItem(STORAGE_KEY);
            if (
                data && typeof data === "object" &&
                Array.isArray(data.ladder) &&
                typeof data.fetchedAt === "number"
            ) {
                // Re-validate the persisted ladder against the CURRENT filter
                // rules: caches written by older builds may still contain
                // sub-12B models (e.g. allam-2-7b) that must never re-enter
                // the pool. Dropping them here keeps the >=12B guarantee
                // true even for stale caches.
                const cached = /** @type {GroqModelEntry[]} */ (data.ladder);
                /** @type {Map<string, GroqModelEntry>} */
                const cachedById = new Map();
                for (const entry of cached) {
                    if (entry && typeof entry.id === "string") cachedById.set(entry.id, entry);
                }

                const entries = normalizeGroqModels(cached).map(entry => {
                    const prev = cachedById.get(entry.id);
                    return prev && typeof prev.displayName === "string" && prev.displayName
                        ? { ...entry, displayName: prev.displayName }
                        : entry;
                });

                if (entries.length === 0) {
                    this.logger.warn("Persisted Groq model pool cache no longer contains usable (>=12B) models — ignoring it.");
                    return;
                }

                this.#entries = new Map(entries.map(e => [e.id, e]));
                this.#stack = entries.map(e => e.id).filter(id => !this.#ejected.has(id));
                if (this.#activeModelId && !this.#entries.has(this.#activeModelId)) {
                    this.#activeModelId = this.#stack.length > 0 ? this.#stack[0] : null;
                }
                this.#fetchedAt = data.fetchedAt;
                this.#activeModelId = this.#stack.length > 0 ? this.#stack[0] : this.#activeModelId;
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to load Groq model pool cache:", error);
        }
    }

    async #saveToCache() {
        try {
            await this.storage.setItem(STORAGE_KEY, {
                ladder: [...this.#entries.values()],
                fetchedAt: this.#fetchedAt
            });
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to persist Groq model pool cache:", error);
        }
    }
}