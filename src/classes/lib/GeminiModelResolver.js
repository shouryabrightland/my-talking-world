// @ts-check

/**
 * @file GeminiModelResolver.js → GeminiModelPool
 * Dynamic, self-healing Gemini model pool for the Planner (WorldSetter).
 */

import Storage from "./Storage";
import { getGeminiApiKey, getBlockedGeminiModels } from "../../util/apiKeys";
import { GEMINI_API_BASE_URL } from "../../util/config";

/** @typedef {import("./Logger").default} Logger */

/**
 * @typedef {Object} GeminiModelEntry
 * @property {string} id Canonical model id (e.g. "gemini-2.5-flash-lite").
 * @property {string} displayName Human-readable name.
 * @property {number} tier Priority tier (1 = highest).
 * @property {number} version Parsed version number used for in-tier sorting.
 * @property {boolean} isFlash Whether the model is a flash variant.
 * @property {boolean} isFlashLite Whether the model is a flash-lite variant.
 * @property {number} outputTokenLimit Maximum output tokens.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const MODEL_COOLDOWN_MS = 300_000;
const STORAGE_KEY = "gemini_model_pool";

const COOLDOWN_STATUSES = Object.freeze([429, 503]);
export const PERMANENT_EJECT_STATUSES = Object.freeze([400, 404]);
const NON_TEXT_MARKERS = Object.freeze([
    "embedding",
    "imagen",
    "veo",
    "tts",
    "audio",
    "nano",
    "vision",
    "aqa",
    "learnlm",
    "banana",
    "bison",
    "gecko"
]);

/**
 * @param {string} id
 * @returns {number}
 */
export function tierOf(id) {
    const n = String(id || "").toLowerCase();
    if (n.includes("flash-lite") || n.includes("flashlite")) return 1;
    if (n.includes("flash")) return 2;
    if (n.includes("pro")) return 3;
    if (n.includes("gemma")) return 4;
    return 5;
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
 * @param {any[]} rawModels
 * @param {string[]} [blockedIds]
 * @returns {GeminiModelEntry[]}
 */
export function normalizeGeminiModels(rawModels, blockedIds = []) {
    if (!Array.isArray(rawModels)) return [];

    /** @type {Set<string>} */
    const blocked = new Set(blockedIds.map(id => String(id).replace(/^models\//, "")));
    /** @type {GeminiModelEntry[]} */
    const entries = [];

    for (const model of rawModels) {
        if (!model || typeof model !== "object") continue;

        const rawName = typeof model.name === "string" ? model.name : "";
        const id = rawName.replace(/^models\//, "") || String(model.baseModelId || "");
        if (!id) continue;

        const lowered = id.toLowerCase();

        // 1. Must be a gemini or gemma family model
        if (!/^(?:gemini|gemma)-/i.test(lowered)) continue;

        // 2. Reject non-text / experimental / media markers
        if (NON_TEXT_MARKERS.some(marker => lowered.includes(marker))) continue;

        // 3. Gemma models must be instruction-tuned (-it)
        if (lowered.includes("gemma") && !lowered.includes("-it")) continue;

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
 * @param {GeminiModelEntry[]} entries
 * @returns {GeminiModelEntry[]}
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

    #entries = new Map();
    /** @type {string[]} */
    #stack = [];
    #cooldownMap = new Map();
    #ejected = new Set();
    #fetchedAt = 0;
    /** @type {Promise<void>|null} */
    #pending = null;

    /** @param {Logger} logger Logger instance. */
    constructor(logger) {
        if (!logger) throw new TypeError("GeminiModelPool requires a Logger instance.");

        /** @readonly */ this.logger = logger.child("GeminiModelPool");
        /** @readonly */ this.storage = new Storage("ModelCache", this.logger);
    }

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

    async getActiveModel() {
        const candidates = await this.getCandidates();
        return candidates.length > 0 ? candidates[0].id : null;
    }

    /**
     * Resolves the best available Gemma model from the active pool.
     * If no Gemma model is supported on the key, or every Gemma model is
     * cooling down, falls back to the top active Gemini text model
     * (e.g. Flash-Lite / Flash).
     *
     * @returns {Promise<string|null>}
     */
    async getGemmaModel() {
        const candidates = await this.getCandidates();

        // Tier 4 is the Gemma tier; the id check covers direct matches too.
        const gemma = candidates.find(c => c.tier === 4 || c.id.toLowerCase().includes("gemma"));
        if (gemma) return gemma.id;

        // Fallback to the highest-priority active text model.
        return candidates.length > 0 ? candidates[0].id : null;
    }

    /**
     * Synchronous active-model accessor for DevTools inspection panels.
     * Never triggers discovery — reflects the last-known healthy stack only.
     *
     * @returns {string|null} Best healthy model id, or null before discovery.
     */
    getActiveModelSync() {
        return this.#activeStack()[0] ?? null;
    }

    /**
     * @param {string} modelId
     * @param {number|null} [status]
     * @returns {boolean}
     */
    reportFailure(modelId, status = null) {
        const cleanId = String(modelId || "").replace(/^models\//, "");
        if (!cleanId || !this.#entries.has(cleanId)) return false;

        if (status !== null && PERMANENT_EJECT_STATUSES.includes(status)) {
            this.#ejected.add(cleanId);
            this.#cooldownMap.delete(cleanId);
            this.#stack = this.#stack.filter(id => id !== cleanId);
            this.logger.warn(`Gemini model "${cleanId}" permanently ejected for this session (HTTP ${status}).`);
            return true;
        }

        const shouldCooldown = status === null || COOLDOWN_STATUSES.includes(status);
        if (!shouldCooldown) return false;

        this.#cooldownMap.set(cleanId, Date.now() + MODEL_COOLDOWN_MS);
        this.#stack = this.#stack.filter(id => id !== cleanId);

        const reason = status === null ? "timeout" : `HTTP ${status}`;
        this.logger.warn(`Gemini model "${cleanId}" cooling down for ${MODEL_COOLDOWN_MS / 1000}s (${reason}).`);
        return true;
    }

    /**
     * @param {string} modelId
     */
    reportSuccess(modelId) {
        const cleanId = String(modelId || "").replace(/^models\//, "");
        if (!cleanId) return;
        if (this.#ejected.has(cleanId)) return;
        this.#cooldownMap.delete(cleanId);
        if (this.#entries.has(cleanId) && !this.#stack.includes(cleanId)) {
            this.#stack = prioritizeGeminiModels([...this.#entries.values()]).map(e => e.id).filter(id => !this.#ejected.has(id));
        }
    }

    /**
     * @param {string} modelId
     * @returns {number|null}
     */
    cooldownRemaining(modelId) {
        const cleanId = String(modelId || "").replace(/^models\//, "");
        const until = this.#cooldownMap.get(cleanId);
        if (until === undefined) return null;
        const remaining = until - Date.now();
        if (remaining <= 0) {
            this.#cooldownMap.delete(cleanId);
            return null;
        }
        return remaining;
    }    snapshot() {
        /** @type {Record<string, number>} */ const cooling = {};
        for (const id of this.#cooldownMap.keys()) {
            const remaining = this.cooldownRemaining(id);
            if (remaining !== null) cooling[id] = remaining;
        }
        return { ...cooling };
    }

    /**
     * Whether EVERY discovered Gemini model is currently unusable.
     * @returns {boolean}
     */
    allModelsBlocked() {
        this.#restoreRecovered();
        if (this.#coolingIds().length === 0) return false;
        return this.#activeStack().length === 0;
    }

    /**
     * Shortest remaining cooldown across cooling models (ejected excluded).
     * @returns {number|null}
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

    /** @returns {string[]} */
    #coolingIds() {
        return [...this.#cooldownMap.keys()].filter(id => !this.#ejected.has(id));
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


    invalidate() {
        this.#fetchedAt = 0;
    }

    #activeStack() {
        this.#restoreRecovered();
        const cooling = this.#cooldownMap;
        return this.#stack.filter(id => !cooling.has(id) && !this.#ejected.has(id));
    }

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
     * @param {string} apiKey
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