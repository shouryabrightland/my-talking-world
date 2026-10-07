// @ts-check

/**
 * @file apiKeys.js
 * API key management for Groq and Gemini providers.
 * Handles storage, lightweight verification, and dual-key enforcement.
 *
 * Responsibilities:
 * - Groq key verification via a single 1-token generation request (proves the
 *   key can actually generate tokens, not merely that it exists).
 * - Gemini key verification via a single GET /models discovery request.
 *   Zero generation tokens are burned during onboarding — no probe loops.
 */

import {
    GROQ_API_BASE_URL,
    GEMINI_API_BASE_URL,
    DEFAULT_CHAT_MODEL,
    STORAGE_API_KEY_NAME,
    STORAGE_GEMINI_API_KEY_NAME
} from "./config";

// =========================================================================
// CONSTANTS
// =========================================================================

/**
 * Substrings marking non text-generation Gemini models (media / embedding).
 * @readonly @type {readonly string[]}
 */
export const NON_TEXT_MODEL_MARKERS = Object.freeze(["embedding", "imagen", "veo", "tts", "audio"]);

/**
 * Substrings marking Groq models that are NOT text chat models. Safeguard /
 * prompt-guard models and audio (whisper / orpheus / tts) models crash chat
 * completions with HTTP 400, so GroqModelPool filters them out at discovery.
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
 * @property {ModelProbeResult[]} probeResults Always empty — onboarding never probes.
 * @property {number} workingModels Count of discovered text-generation models.
 */

/**
 * @typedef {Object} ApiKeyVerificationResult
 * @property {boolean} valid True if the API key was verified by servers.
 * @property {string|null} error Error description if verification failed.
 * @property {string[]} models List of model IDs accessible by this key.
 */

// =========================================================================
// GROQ API KEY HELPERS
// =========================================================================

/**
 * Retrieves the currently active Groq API key from localStorage.
 * @returns {string} Clean API key string or empty string.
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
 * @param {string} key Raw API key string.
 * @returns {boolean} True if successfully saved.
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
 * Verifies the provided Groq API key with a single 1-token generation request.
 *
 * Unlike `GET /models` (which only proves the key exists), this proves the key
 * has active token-generation quota — and it does so in one round trip.
 *
 * @param {string} key API key to verify.
 * @returns {Promise<ApiKeyVerificationResult>}
 */
export async function verifyApiKey(key) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return { valid: false, error: "API key cannot be empty.", models: [] };

    try {
        const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cleanKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: DEFAULT_CHAT_MODEL,
                messages: [{ role: "user", content: "hi" }],
                max_tokens: 1,
                temperature: 0,
                stream: false
            })
        });

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status} ${response.statusText}`;
            try {
                const errData = await response.json();
                errorMsg = errData?.error?.message || errorMsg;
            } catch {}
            return { valid: false, error: errorMsg, models: [] };
        }

        // 200 on a max_tokens:1 generation => key is authentic AND generating.
        return { valid: true, error: null, models: [] };
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
 * @param {string} key Raw API key string.
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
 * Verifies the provided Gemini API key with EXACTLY ONE network request:
 * `GET /v1beta/models?key=...`. No `generateContent` probes are issued, so
 * zero generation tokens are burned and the 15 RPM free-tier quota is left
 * untouched.
 *
 * The key is considered valid when the model list contains at least one
 * text-generation model (`supportedGenerationMethods` includes
 * `generateContent`).
 *
 * @param {string} key API key to verify.
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
// MODEL DISCOVERY FILTERING (shared with GeminiModelPool)
// =========================================================================

/**
 * Extracts usable text-generation model IDs from a raw `GET /v1beta/models`
 * payload. Non-text models (embedding / imagen / veo / tts / audio) and any
 * model without `generateContent` support are discarded.
 *
 * @param {any[]} rawModels Raw `models[]` array from the Gemini REST API.
 * @returns {string[]} Ordered model IDs (without the `models/` prefix).
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
        if (NON_TEXT_MODEL_MARKERS.some(marker => lowered.includes(marker))) continue;

        const methods = Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods
            : [];
        if (!methods.includes("generateContent")) continue;

        ids.push(id);
    }

    return ids;
}

// =========================================================================
// FULL DUAL-KEY VERIFICATION (NO PROBING — ZERO GENERATION TOKENS)
// =========================================================================

/**
 * Verifies BOTH Groq and Gemini API keys with exactly two lightweight
 * requests (1-token Groq generation + Gemini model discovery). No Gemini
 * model is ever probed, so onboarding cannot self-DoS the 15 RPM quota.
 *
 * @param {string} groqKey Groq API key.
 * @param {string} geminiKey Gemini API key.
 * @returns {Promise<{groq: ApiKeyVerificationResult, gemini: GeminiVerificationResult, success: boolean, error: string|null}>}
 */
export async function verifyAndProbeDualKeys(groqKey, geminiKey) {
    const cleanGroq = String(groqKey || "").trim();
    const cleanGemini = String(geminiKey || "").trim();

    // Dual-key enforcement
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

    // Both verifications run in parallel — two lightweight requests total.
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
// BLOCKED MODEL STORAGE (localStorage-based for onboarding)
// =========================================================================

/** @readonly @type {string} localStorage key for blocked models. */
const BLOCKED_MODELS_KEY = "tgf:blocked_gemini_models";

/**
 * Returns blocked Gemini model IDs from localStorage.
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
 * Adds a model to the blocked list in localStorage.
 * @param {string} modelId Model ID to block.
 * @returns {void}
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

/**
 * Clears all blocked models from localStorage.
 * @returns {void}
 */
export function clearBlockedGeminiModels() {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(BLOCKED_MODELS_KEY); } catch {}
}

// =========================================================================
// PER-MODEL HEALTH PROBES (DevTools "Verify" buttons — Task 4)
// =========================================================================

/**
 * @typedef {Object} ModelVerifyResult
 * @property {boolean} ok Whether the model answered the probe.
 * @property {number} ms Wall-clock latency in milliseconds.
 * @property {string} label Inline feedback (e.g. "✓ 182ms" / "✕ HTTP 429").
 * @property {number|null} status HTTP status code (null for network errors).
 * @property {string|null} error Human-readable failure reason.
 */

/**
 * Optional pool interface used to feed probe outcomes back into health state.
 * @typedef {Object} ModelPoolReporter
 * @property {(modelId: string) => void} [reportSuccess]
 * @property {(modelId: string, status?: number|null) => void} [reportFailure]
 */

/**
 * Sends a minimal **1-token** probe to ONE specific Groq chat model and feeds
 * the outcome back into the pool (`reportSuccess` / `reportFailure`).
 * Latency is measured wall-clock around the single round trip.
 *
 * @param {string} modelId Target Groq model id.
 * @param {ModelPoolReporter|null} [pool] Pool to update with the outcome.
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
 * Sends a minimal **1-token** probe to ONE specific Gemini model and feeds the
 * outcome back into the pool (`reportSuccess` / `reportFailure`).
 *
 * @param {string} modelId Target Gemini model id (with or without `models/`).
 * @param {ModelPoolReporter|null} [pool] Pool to update with the outcome.
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
