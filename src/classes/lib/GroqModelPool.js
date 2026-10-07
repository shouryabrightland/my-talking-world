// @ts-check

/**
 * @file GroqModelPool.js → Dynamic Groq Model Pool for live dialogue.
 *
 * Responsibilities:
 * - Discovers models from `GET /openai/v1/models` (6h IndexedDB cache in
 *   Storage("ModelCache")). The static `CHAT_MODEL_FALLBACK_CHAIN` is only a
 *   last-resort seed when discovery fails.
 * - Filters out safeguard & non-text models (guard / safeguard / whisper /
 *   orpheus / tts / embedding / vision) which crash chat calls with HTTP 400.
 * - Ranks text chat models by a dynamic priority hierarchy:
 *     Tier 1: Fast instant banter  (e.g. llama-3.1-8b-instant, llama-3.2-3b-preview)
 *     Tier 2: Deep conversational  (e.g. llama-3.3-70b-versatile, openai/gpt-oss-120b,
 *             qwen/qwen3.6-27b)
 *     Tier 3: Other text chat models
 *   Within a tier, higher versions sort first.
 * - Self-healing cooldowns driven by REAL server rate-limit timings:
 *   429 / 503 (or timeout) place a model on cooldown until the server's exact
 *   reset time (from `retry-after` / `x-ratelimit-reset-*` headers), while
 *   400 / 404 permanently eject a model for the session.
 *
 * The pool NEVER crosses providers: it only ranks Groq chat models for
 * GroqClient's fallback cascade.
 */

import Storage from "./Storage";
import { getApiKey, GROQ_NON_CHAT_MODEL_MARKERS } from "../../util/apiKeys";
import { GROQ_API_BASE_URL } from "../../util/config";

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {Object} GroqModelEntry
 * @property {string} id Canonical model id (e.g. "llama-3.1-8b-instant").
 * @property {string} displayName Human-readable name (id when absent).
 * @property {number} tier Priority tier (1 = fastest banter first).
 * @property {number} version Parsed version number used for in-tier sorting.
 */

/** @readonly @type {number} Cache TTL: 6 hours in milliseconds. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @readonly @type {number} Default cooldown when the server sends no reset timing (60s). */
export const GROQ_MODEL_COOLDOWN_MS = 60_000;

/** @readonly @type {string} Storage key for the cached model ladder. */
const STORAGE_KEY = "groq_model_pool";

/** @readonly @type {readonly number[]} Transient HTTP statuses that force a cooldown. */
const COOLDOWN_STATUSES = Object.freeze([429, 503]);

/** @readonly @type {readonly number[]} Permanent HTTP statuses that eject a model for the session. */
export const PERMANENT_EJECT_STATUSES = Object.freeze([400, 404]);

/** @readonly @type {readonly string[]} Substrings marking non-chat models. */
const NON_CHAT_MARKERS = GROQ_NON_CHAT_MODEL_MARKERS;

/**
 * Parses a Groq duration / reset header into milliseconds.
 * Accepts: "43s", "1m23s", "6m0s", "1h2m3s", "100ms", "2.5",
 * plain seconds ("2.5"), and HTTP-date values (Retry-After).
 *
 * @param {string|null|undefined} raw Raw header value.
 * @returns {number|null} Duration in ms, or null when unparseable.
 */
export function parseGroqDurationMs(raw) {
    if (raw === null || raw === undefined) return null;
    const value = String(raw).trim();
    if (!value) return null;

    // Plain numeric value → seconds (Retry-After convention).
    if (/^\d+(\.\d+)?$/.test(value)) {
        return Math.round(parseFloat(value) * 1000);
    }

    // Milliseconds first so "100ms" is not read as minutes.
    const msMatch = /^(\d+)ms$/.exec(value);
    if (msMatch) return Number(msMatch[1]);

    // ISO-8601-ish duration: 1h2m3s / 1m23s / 43s / 2.5s
    const durMatch = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
    if (durMatch && (durMatch[1] || durMatch[2] || durMatch[3])) {
        const hours = Number(durMatch[1] || 0);
        const minutes = Number(durMatch[2] || 0);
        const seconds = Number(durMatch[3] || 0);
        return Math.round(hours * 3_600_000 + minutes * 60_000 + seconds * 1000);
    }

    // HTTP-date fallback (Retry-After may be an absolute date).
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());

    return null;
}

/**
 * Computes the dynamic priority tier of a Groq chat model id.
 * @param {string} id Model id.
 * @returns {number} 1 (instant banter) … 3 (other text chat).
 */
export function tierOf(id) {
    const n = String(id || "").toLowerCase();

    // Tier 1: high-RPM, sub-second instant models.
    if (n.includes("instant")) return 1;

    // Mixture-of-experts: total params = experts × experts-per-branch.
    const moe = /(\d+)x(\d+)b/.exec(n);
    if (moe) {
        const total = Number(moe[1]) * Number(moe[2]);
        return total <= 8 ? 1 : 3;
    }

    // Dense parameter size: ≤8B = banter tier, ≥12B = deep conversational.
    const size = /(?:^|\D)(\d+(?:\.\d+)?)b(?:\D|$)/.exec(n);
    if (size) {
        const params = parseFloat(size[1]);
        if (params <= 8) return 1;
        return 2;
    }

    // Known deep conversational families without a size marker.
    if (n.includes("versatile") || n.includes("oss") || n.includes("qwen")) return 2;

    return 3;
}

/**
 * Extracts the leading version number from a model id.
 * e.g. "llama-3.3-70b-versatile" → 3.3, "mixtral-8x7b-32768" → 8
 * @param {string} id Model id.
 * @returns {number} Parsed version (0 when absent).
 */
export function versionOf(id) {
    const match = String(id || "").match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

/**
 * Filters a raw `GET /openai/v1/models` payload down to text chat models and
 * decorates them with tier/version metadata.
 *
 * @param {any[]} rawModels Raw `data[]` payload.
 * @param {string[]} [blockedIds] Model ids that must be dropped.
 * @returns {GroqModelEntry[]} Filtered, decorated entries (unsorted).
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
        if (NON_CHAT_MARKERS.some(marker => lowered.includes(marker))) continue;
        if (blocked.has(id)) continue;

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
 * Sorts entries by the dynamic priority hierarchy: tier ascending,
 * then version descending, then id ascending (stable tie-break).
 *
 * @param {GroqModelEntry[]} entries Entries to sort.
 * @returns {GroqModelEntry[]} New array sorted by priority (best first).
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

    /** @type {Map<string, GroqModelEntry>} Discovered models by id. */
    #entries = new Map();

    /** @type {string[]} Priority-ordered active stack (best first). */
    #stack = [];

    /** @type {Map<string, number>} Model id → cooldown recovery timestamp (failure-driven). */
    #cooldownMap = new Map();

    /**
     * Model id → server rate-window reset timestamp from REAL x-ratelimit-*
     * headers (never cleared by success — only by the clock).
     * @type {Map<string, number>}
     */
    #serverPauseMap = new Map();

    /** @type {Set<string>} Model ids permanently ejected (400/404) for this session. */
    #ejected = new Set();

    /** @type {string|null} Last resolved active model id (sync accessor for DevTools). */
    #activeModelId = null;

    /** @type {number} Timestamp of the last successful discovery. */
    #fetchedAt = 0;

    /** @type {Promise<void>|null} In-flight discovery dedupe. */
    #pending = null;

    /** @param {Logger} logger Logger instance. */
    constructor(logger) {
        if (!logger) throw new TypeError("GroqModelPool requires a Logger instance.");

        /** @readonly */ this.logger = logger.child("GroqModelPool");
        /** @readonly */ this.storage = new Storage("ModelCache", this.logger);
    }

    /**
     * Sync view of the most recently resolved active model id.
     * Null before the first discovery round completes.
     * @returns {string|null}
     */
    get activeModelId() {
        return this.#activeModelId;
    }

    /**
     * Returns the active (non-cooling) model stack, best model first.
     * Triggers discovery when the in-memory/IndexedDB cache is stale.
     *
     * @returns {Promise<GroqModelEntry[]>} Ordered active candidates.
     */
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
     * - HTTP 400 / 404 (invalid argument / not found): permanently ejected.
     * - HTTP 429 / 503 (or a timeout, i.e. `status === null`): cooldown until
     *   the server's exact reset time when `resetMs` is supplied, otherwise
     *   the default GROQ_MODEL_COOLDOWN_MS window.
     * - Any other status is ignored (no cooldown).
     *
     * @param {string} modelId Model that failed.
     * @param {number|null} [status=null] HTTP status, or null for timeout/network errors.
     * @param {number|null} [resetMs=null] Exact server-provided reset delay in ms.
     * @returns {boolean} True when the model was ejected (cooldown or permanent).
     */
    reportFailure(modelId, status = null, resetMs = null) {
        if (!modelId) return false;

        // Permanent errors: eject for the whole session, never revive.
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
     * Records a successful generation against a model (clears any cooldown).
     * Permanently ejected models are never restored, even on success.
     * @param {string} modelId Model that succeeded.
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
     * Applies REAL rate-limit headers from a Groq response to the pool and the
     * shared limiter cadence. When the server reports zero remaining requests
     * or tokens, the model is paused exactly until its reset timestamp.
     *
     * @param {string} modelId Model that answered.
     * @param {Object} rateInfo Parsed `x-ratelimit-*` headers.
     * @param {string|null} [rateInfo.remainingRequests] x-ratelimit-remaining-requests.
     * @param {string|null} [rateInfo.resetRequests] x-ratelimit-reset-requests.
     * @param {string|null} [rateInfo.remainingTokens] x-ratelimit-remaining-tokens.
     * @param {string|null} [rateInfo.resetTokens] x-ratelimit-reset-tokens.
     * @param {string|null} [rateInfo.retryAfter] retry-after.
     * @returns {number|null} Exact reset delay in ms when the window is exhausted, else null.
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
            this.logger.debug(`Groq rate window exhausted on "${modelId}" — pausing ${Math.round(resetMs / 1000)}s (server reset).`);
        }

        return resetMs;
    }

    /**
     * @param {string} modelId Model to look up.
     * @returns {number|null} Remaining cooldown ms, or null when not cooling.
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

    /**
     * Whether EVERY discovered chat model is currently unusable — i.e. the
     * active stack is empty while at least one model is cooling down or
     * server-paused. Lets the UI explain an apparently frozen engine.
     *
     * @returns {boolean} True when no model can serve a request right now.
     */
    allModelsBlocked() {
        this.#restoreRecovered();
        if (this.#coolingIds().length === 0) return false;
        return this.#activeStack().length === 0;
    }

    /**
     * Whether EVERY discovered chat model is literally in cooldown right now
     * (429/503 cooldown map or server-pause map). Stricter than
     * allModelsBlocked(): an empty or partially ejected pool does not count.
     * Lets the UI surface "⚠️ All chat models cooling down" (Task 3.2).
     *
     * @returns {boolean} True when at least one model exists and all of them are cooling.
     */
    allModelsCooling() {
        this.#restoreRecovered();
        if (this.#entries.size === 0) return false;

        for (const id of this.#entries.keys()) {
            if (!this.#cooldownMap.has(id) && !this.#serverPauseMap.has(id)) return false;
        }
        return true;
    }

    /**
     * Shortest remaining cooldown across all cooling models (permanently
     * ejected models are excluded — they never recover).
     *
     * @returns {number|null} Remaining ms until the soonest recovery, or null
     *                         when nothing is cooling down.
     */
    minCooldownRemaining() {
        /** @type {number|null} */ let min = null;
        for (const id of this.#coolingIds()) {
            const remaining = this.cooldownRemaining(id);
            if (remaining === null) continue;
            min = min === null ? remaining : Math.min(min, remaining);
        }
        return min;
    }

    /**
     * Ordered ids of every model currently cooling down / server-paused,
     * excluding permanently ejected ones.
     *
     * @returns {string[]}
     */
    #coolingIds() {
        /** @type {Set<string>} */ const cooling = new Set();
        for (const id of this.#cooldownMap.keys()) cooling.add(id);
        for (const id of this.#serverPauseMap.keys()) cooling.add(id);
        return [...cooling].filter(id => !this.#ejected.has(id));
    }

    /**
     * Full per-model health snapshot for the DevTools State tab.
     *
     * @returns {Array<{ id: string, displayName: string, tier: number, version: number, status: "healthy"|"cooling"|"ejected", cooldownRemainingMs: number|null, isActive: boolean }>}
     */
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
     * Whether a model was permanently ejected this session (400/404).
     * @param {string} modelId Model to look up.
     * @returns {boolean}
     */
    isEjected(modelId) {
        return this.#ejected.has(modelId);
    }

    /**
     * Snapshot of every model currently cooling down.
     * @returns {Record<string, number>} Model id → remaining cooldown ms.
     */
    snapshot() {
        /** @type {Record<string, number>} */
        const cooling = {};
        for (const id of [...this.#cooldownMap.keys(), ...this.#serverPauseMap.keys()]) {
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
        return this.#stack.filter(id => !this.#cooldownMap.has(id) && !this.#serverPauseMap.has(id) && !this.#ejected.has(id));
    }

    /** Moves models whose cooldown elapsed back onto the active stack. @returns {void} */
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

    /**
     * Ensures the pool has a fresh (≤6h) model list.
     * @returns {Promise<void>}
     */
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
     * Fetches, filters, ranks and persists the model list.
     * @param {string} apiKey Groq API key.
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

            this.logger.info(`Discovered ${this.#stack.length} Groq text chat model(s) from API.`);
            await this.#saveToCache();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to fetch Groq model list:", error);
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
                const entries = /** @type {GroqModelEntry[]} */ (data.ladder);
                this.#entries = new Map(entries.map(e => [e.id, e]));
                this.#stack = entries.map(e => e.id).filter(id => !this.#ejected.has(id));
                this.#fetchedAt = data.fetchedAt;
                this.#activeModelId = this.#stack.length > 0 ? this.#stack[0] : this.#activeModelId;
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to load Groq model pool cache:", error);
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
            this.logger.warn("Failed to persist Groq model pool cache:", error);
        }
    }
}
