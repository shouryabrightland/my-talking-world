// @ts-check

/**
 * @file apiKeys.js
 * API key management for Groq and Gemini providers.
 *
 * Responsibilities:
 * - Dynamically searches and verifies model lists directly from provider endpoints.
 * - Enforces models >= 12B for Groq chat generation (sub-12B models are filtered out).
 * - Enforces text-generation models only for Google AI Studio (Gemini/Gemma).
 * - Zero hardcoded model fallback chains or static default models.
 */

import {
    GROQ_API_BASE_URL,
    GEMINI_API_BASE_URL,
    STORAGE_API_KEY_NAME,
    STORAGE_GEMINI_API_KEY_NAME
} from "./config";

// =========================================================================
// CONSTANTS & MARKERS
// =========================================================================

/**
 * Substrings marking non-text or incompatible Gemini models.
 * @readonly @type {readonly string[]}
 */
export const NON_TEXT_MODEL_MARKERS = Object.freeze([
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
 * Substrings marking Groq models that are NOT text chat models.
 * @readonly @type {readonly string[]}
 */
export const GROQ_NON_CHAT_MODEL_MARKERS = Object.freeze([
    "guard",
    "safeguard",
    "whisper",
    "orpheus",
    "tts",
    "embedding",
    "vision"
]);

// =========================================================================
// TYPE DEFINITIONS
// =========================================================================

/**
 * @typedef {Object} ModelProbeResult
 * @property {string} model Model ID that was probed.
 * @property {boolean} working Whether the model responded successfully.
 * @property {string|null} error Error message if probe failed.
 * @property {number} latencyMs Round-trip time in milliseconds.
 */

/**
 * @typedef {Object} GeminiVerificationResult
 * @property {boolean} valid True if key is valid AND >=1 text model discovered.
 * @property {string|null} error Error description if verification failed.
 * @property {string[]} models Text-generation model IDs discovered via GET /models.
 * @property {ModelProbeResult[]} probeResults Always empty (onboarding does not burn tokens).
 * @property {number} workingModels Count of discovered text-generation models.
 */

/**
 * @typedef {Object} ApiKeyVerificationResult
 * @property {boolean} valid True if the API key was verified by servers.
 * @property {string|null} error Error description if verification failed.
 * @property {string[]} models List of model IDs (>=12B) accessible by this key.
 */

// =========================================================================
// GROQ MODEL FILTERING (>= 12B Requirement)
// =========================================================================

/**
 * Filters a raw Groq `data[]` array down to text chat models with >= 12B parameters.
 *
 * @param {any[]} rawModels
 * @returns {string[]} Filtered model IDs.
 */
export function filterGroqChatModels(rawModels) {
    if (!Array.isArray(rawModels)) return [];

    /** @type {string[]} */
    const ids = [];

    for (const model of rawModels) {
        if (!model || typeof model !== "object") continue;

        const id = typeof model.id === "string" ? model.id.trim() : "";
        if (!id) continue;

        const lowered = id.toLowerCase();

        // 1. Exclude safeguard, audio, vision, embedding
        if (GROQ_NON_CHAT_MODEL_MARKERS.some(marker => lowered.includes(marker))) continue;

        // 2. Exclude models below 12B
        const moe = /(\d+)x(\d+)b/.exec(lowered);
        if (moe) {
            const totalParams = Number(moe[1]) * Number(moe[2]);
            if (totalParams < 12) continue; // Skip sub-12B MoE
        } else {
            const size = /(?:^|\D)(\d+(?:\.\d+)?)b(?:\D|$)/.exec(lowered);
            if (size) {
                const params = parseFloat(size[1]);
                if (params < 12) continue; // Skip sub-12B dense models (8b, 7b, 3b, 1b)
            } else if (lowered.includes("instant")) {
                continue; // Instant models are sub-12B
            }
        }

        ids.push(id);
    }

    return ids;
}

// =========================================================================
// GROQ API KEY HELPERS
// =========================================================================

/**
 * Retrieves the currently active Groq API key from localStorage.
 * @returns {string}
 */
export function getApiKey() {
    if (typeof window === "undefined") return "";
    try {
        const saved = localStorage.getItem(STORAGE_API_KEY_NAME);
        if (typeof saved === "string" && saved.trim().length > 0) return saved.trim();
    } catch {}
    return "";
}

/**
 * Persists a Groq API key to localStorage.
 * @param {string} key
 * @returns {boolean}
 */
export function setApiKey(key) {
    if (typeof window === "undefined") return false;
    try {
        const clean = String(key || "").trim();
        if (!clean) {
            localStorage.removeItem(STORAGE_API_KEY_NAME);
            return true;
        }
        localStorage.setItem(STORAGE_API_KEY_NAME, clean);
        return true;
    } catch (/** @type {unknown} */ err) {
        console.error("[ApiKeys] Failed to commit Groq API key to storage:", err);
        return false;
    }
}

/**
 * Removes the stored Groq API key from browser storage.
 * @returns {void}
 */
export function clearApiKey() {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(STORAGE_API_KEY_NAME); } catch {}
}

/**
 * Checks whether a Groq API key is currently saved.
 * @returns {boolean}
 */
export function hasApiKey() {
    return getApiKey().length > 0;
}

/**
 * Verifies the Groq API key by querying the live model list from `GET /openai/v1/models`.
 * Discovers accessible models and validates that at least one chat model >= 12B is present.
 *
 * @param {string} key API key to verify.
 * @returns {Promise<ApiKeyVerificationResult>}
 */
export async function verifyApiKey(key) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return { valid: false, error: "API key cannot be empty.", models: [] };

    try {
        const response = await fetch(`${GROQ_API_BASE_URL}/models`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${cleanKey}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status} ${response.statusText}`;
            try {
                const errData = await response.json();
                errorMsg = errData?.error?.message || errorMsg;
            } catch {}
            return { valid: false, error: errorMsg, models: [] };
        }

        const data = await response.json();
        const models = filterGroqChatModels(Array.isArray(data?.data) ? data.data : []);
        const valid = models.length > 0;

        return {
            valid,
            error: valid ? null : "No chat models (>=12B) are available for this Groq key.",
            models
        };
    } catch (err) {
        const error = /** @type {Error & {message?: string}} */ (err);
        return {
            valid: false,
            error: error.message || "Network error encountered while connecting to Groq API.",
            models: []
        };
    }
}

// =========================================================================
// GEMINI API KEY HELPERS
// =========================================================================

/**
 * Retrieves the currently active Gemini API key.
 * @returns {string}
 */
export function getGeminiApiKey() {
    if (typeof window === "undefined") return "";
    try {
        const saved = localStorage.getItem(STORAGE_GEMINI_API_KEY_NAME);
        if (typeof saved === "string" && saved.trim().length > 0) return saved.trim();
    } catch {}
    return "";
}

/**
 * Persists a Gemini API key to localStorage.
 * @param {string} key
 * @returns {boolean}
 */
export function setGeminiApiKey(key) {
    if (typeof window === "undefined") return false;
    try {
        const clean = String(key || "").trim();
        if (!clean) {
            localStorage.removeItem(STORAGE_GEMINI_API_KEY_NAME);
            return true;
        }
        localStorage.setItem(STORAGE_GEMINI_API_KEY_NAME, clean);
        return true;
    } catch (/** @type {unknown} */ err) {
        console.error("[ApiKeys] Failed to commit Gemini API key to storage:", err);
        return false;
    }
}

/**
 * Removes the stored Gemini API key.
 * @returns {void}
 */
export function clearGeminiApiKey() {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(STORAGE_GEMINI_API_KEY_NAME); } catch {}
}

/**
 * Checks whether a Gemini API key is currently saved.
 * @returns {boolean}
 */
export function hasGeminiApiKey() {
    return getGeminiApiKey().length > 0;
}

/**
 * Extracts usable text-generation model IDs from a raw `GET /v1beta/models` payload.
 *
 * @param {any[]} rawModels
 * @returns {string[]}
 */
export function filterTextGenerationModels(rawModels) {
    if (!Array.isArray(rawModels)) return [];

    /** @type {string[]} */
    const ids = [];

    for (const model of rawModels) {
        if (!model || typeof model !== "object") continue;

        const rawName = typeof model.name === "string" ? model.name : "";
        const id = rawName.replace(/^models\//, "") || String(model.baseModelId || "");
        if (!id) continue;

        const lowered = id.toLowerCase();

        // 1. Must be a gemini or gemma family model
        if (!/^(?:gemini|gemma)-/i.test(lowered)) continue;

        // 2. Filter non-text/media/experimental markers
        if (NON_TEXT_MODEL_MARKERS.some(marker => lowered.includes(marker))) continue;

        // 3. Gemma models must be instruction-tuned (-it)
        if (lowered.includes("gemma") && !lowered.includes("-it")) continue;

        // 4. Must support generateContent
        const methods = Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods
            : [];
        if (!methods.includes("generateContent")) continue;

        ids.push(id);
    }

    return ids;
}

/**
 * Verifies the Gemini API key by discovering accessible models from `GET /models`.
 *
 * @param {string} key
 * @returns {Promise<GeminiVerificationResult>}
 */
export async function verifyGeminiApiKey(key) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) {
        return { valid: false, error: "Gemini API key cannot be empty.", models: [], probeResults: [], workingModels: 0 };
    }

    try {
        const response = await fetch(`${GEMINI_API_BASE_URL}/models?key=${cleanKey}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status} ${response.statusText}`;
            try {
                const errData = await response.json();
                errorMsg = errData?.error?.message || errorMsg;
            } catch {}
            return { valid: false, error: errorMsg, models: [], probeResults: [], workingModels: 0 };
        }

        const payload = await response.json();
        const models = filterTextGenerationModels(Array.isArray(payload.models) ? payload.models : []);
        const valid = models.length > 0;

        return {
            valid,
            error: valid ? null : "No text-generation Gemini models are available for this key.",
            models,
            probeResults: [],
            workingModels: models.length
        };
    } catch (err) {
        const error = /** @type {Error & {message?: string}} */ (err);
        return {
            valid: false,
            error: error.message || "Network error encountered while connecting to Gemini API.",
            models: [],
            probeResults: [],
            workingModels: 0
        };
    }
}

// =========================================================================
// FULL DUAL-KEY VERIFICATION (Dynamic Discovery)
// =========================================================================

/**
 * Verifies BOTH keys in parallel by discovering accessible model lists from both APIs.
 *
 * @param {string} groqKey
 * @param {string} geminiKey
 * @returns {Promise<{groq: ApiKeyVerificationResult, gemini: GeminiVerificationResult, success: boolean, error: string|null}>}
 */
export async function verifyAndProbeDualKeys(groqKey, geminiKey) {
    const cleanGroq = String(groqKey || "").trim();
    const cleanGemini = String(geminiKey || "").trim();

    if (!cleanGroq) {
        return {
            groq: { valid: false, error: "Groq API key is required.", models: [] },
            gemini: { valid: false, error: null, models: [], probeResults: [], workingModels: 0 },
            success: false,
            error: "Groq API key is required for live chat. Please provide a valid Groq key."
        };
    }

    if (!cleanGemini) {
        return {
            groq: { valid: false, error: null, models: [] },
            gemini: { valid: false, error: "Gemini API key is required.", models: [], probeResults: [], workingModels: 0 },
            success: false,
            error: "Gemini API key is required for schedule planning. Please provide a valid Gemini key."
        };
    }

    const [groqResult, geminiResult] = await Promise.all([
        verifyApiKey(cleanGroq),
        verifyGeminiApiKey(cleanGemini)
    ]);

    if (!groqResult.valid) {
        return {
            groq: groqResult,
            gemini: geminiResult,
            success: false,
            error: `Groq key verification failed: ${groqResult.error || "Invalid key."}`
        };
    }

    if (!geminiResult.valid) {
        return {
            groq: groqResult,
            gemini: geminiResult,
            success: false,
            error: `Gemini key verification failed: ${geminiResult.error || "Invalid key."}`
        };
    }

    return {
        groq: groqResult,
        gemini: geminiResult,
        success: true,
        error: null
    };
}

// =========================================================================
// BLOCKED MODEL STORAGE
// =========================================================================

const BLOCKED_MODELS_KEY = "tgf:blocked_gemini_models";

/**
 * @returns {string[]}
 */
export function getBlockedGeminiModels() {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(BLOCKED_MODELS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(m => typeof m === "string") : [];
    } catch { return []; }
}

/**
 * @param {string} modelId
 */
export function blockGeminiModel(modelId) {
    if (typeof window === "undefined") return;
    try {
        const blocked = getBlockedGeminiModels();
        if (!blocked.includes(modelId)) {
            blocked.push(modelId);
            localStorage.setItem(BLOCKED_MODELS_KEY, JSON.stringify(blocked));
        }
    } catch {}
}

export function clearBlockedGeminiModels() {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(BLOCKED_MODELS_KEY); } catch {}
}

// =========================================================================
// PER-MODEL HEALTH PROBES (DevTools)
// =========================================================================

/**
 * @typedef {Object} ModelVerifyResult
 * @property {boolean} ok
 * @property {number} ms
 * @property {string} label
 * @property {number|null} status
 * @property {string|null} error
 */

/**
 * @typedef {Object} ModelPoolReporter
 * @property {(modelId: string) => void} [reportSuccess]
 * @property {(modelId: string, status?: number|null) => void} [reportFailure]
 */

/**
 * Sends a minimal 1-token probe to a specific Groq model.
 *
 * @param {string} modelId
 * @param {ModelPoolReporter|null} [pool]
 * @returns {Promise<ModelVerifyResult>}
 */
export async function probeGroqModel(modelId, pool = null) {
    const id = String(modelId || "").trim();
    if (!id) {
        return { ok: false, ms: 0, label: "✕ No model id", status: null, error: "Missing model id" };
    }

    const key = getApiKey();
    if (!key) {
        return { ok: false, ms: 0, label: "✕ No API key", status: null, error: "Groq API key is not configured." };
    }

    const startedAt = Date.now();
    try {
        const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: id,
                messages: [{ role: "user", content: "hi" }],
                max_tokens: 1,
                temperature: 0,
                stream: false
            })
        });

        const ms = Date.now() - startedAt;

        if (response.ok) {
            if (pool && typeof pool.reportSuccess === "function") pool.reportSuccess(id);
            return { ok: true, ms, label: `✓ ${ms}ms`, status: response.status, error: null };
        }

        if (pool && typeof pool.reportFailure === "function") pool.reportFailure(id, response.status);
        return {
            ok: false,
            ms,
            label: `✕ HTTP ${response.status}`,
            status: response.status,
            error: `HTTP ${response.status} ${response.statusText}`
        };
    } catch (err) {
        const ms = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        if (pool && typeof pool.reportFailure === "function") pool.reportFailure(id, null);
        return { ok: false, ms, label: `✕ ${message}`, status: null, error: message };
    }
}

/**
 * Sends a minimal 1-token probe to a specific Gemini model.
 *
 * @param {string} modelId
 * @param {ModelPoolReporter|null} [pool]
 * @returns {Promise<ModelVerifyResult>}
 */
export async function probeGeminiModel(modelId, pool = null) {
    const id = String(modelId || "").trim().replace(/^models\//, "");
    if (!id) {
        return { ok: false, ms: 0, label: "✕ No model id", status: null, error: "Missing model id" };
    }

    const key = getGeminiApiKey();
    if (!key) {
        return { ok: false, ms: 0, label: "✕ No API key", status: null, error: "Gemini API key is not configured." };
    }

    const startedAt = Date.now();
    try {
        const response = await fetch(
            `${GEMINI_API_BASE_URL}/models/${id}:generateContent?key=${encodeURIComponent(key)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "hi" }] }],
                    generationConfig: { maxOutputTokens: 1, temperature: 0 }
                })
            }
        );

        const ms = Date.now() - startedAt;

        if (response.ok) {
            if (pool && typeof pool.reportSuccess === "function") pool.reportSuccess(id);
            return { ok: true, ms, label: `✓ ${ms}ms`, status: response.status, error: null };
        }

        if (pool && typeof pool.reportFailure === "function") pool.reportFailure(id, response.status);
        return {
            ok: false,
            ms,
            label: `✕ HTTP ${response.status}`,
            status: response.status,
            error: `HTTP ${response.status} ${response.statusText}`
        };
    } catch (err) {
        const ms = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        if (pool && typeof pool.reportFailure === "function") pool.reportFailure(id, null);
        return { ok: false, ms, label: `✕ ${message}`, status: null, error: message };
    }
}