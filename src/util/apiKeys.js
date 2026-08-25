// @ts-check

/**
 * @file apiKeys.js
 * API key management for Groq and Gemini providers.
 * Handles storage, verification, probing, and dual-key enforcement.
 *
 * Responsibilities:
 * - Groq key verification against GET /models.
 * - Gemini key verification + model list fetch + per-model live probe.
 * - Requires at least 3 working Gemini models before permitting entry.
 * - Returns detailed probe results for UI diagnostics.
 */

import {
    GROQ_API_BASE_URL,
    GEMINI_API_BASE_URL,
    STORAGE_API_KEY_NAME,
    STORAGE_GEMINI_API_KEY_NAME
} from "./config";

// =========================================================================
// CONSTANTS
// =========================================================================

/** @readonly @type {number} Minimum number of live Gemini models required. */
export const MIN_GEMINI_MODELS_REQUIRED = 3;

/** @readonly @type {number} Timeout in ms for a single model probe request. */
const PROBE_TIMEOUT_MS = 15_000;

/** @readonly @type {number} Maximum concurrent probe requests. */
const MAX_CONCURRENT_PROBES = 3;

/**
 * Candidate model IDs to probe for live text generation capability.
 * These are the most commonly available Gemini models that support generateContent.
 * @readonly @type {readonly string[]}
 */
export const GEMINI_PROBE_CANDIDATES = Object.freeze([
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.1-pro",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash"
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
 * @property {boolean} valid True if key is valid AND >=3 models are working.
 * @property {string|null} error Error description if verification failed.
 * @property {string[]} models Raw model list from the Gemini API.
 * @property {ModelProbeResult[]} probeResults Per-model probe diagnostics.
 * @property {number} workingModels Count of models that responded successfully.
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
 * Verifies the provided Groq API key against Groq's `/models` endpoint.
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

        const payload = await response.json();
        const models = Array.isArray(payload.data) ? payload.data.map((/** @type {Record<string, unknown>} */ m) => /** @type {string} */ (m.id)) : [];
        return { valid: true, error: null, models };
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
 * Verifies the provided Gemini API key against the `/models` endpoint.
 * Fetches the list of available models but does NOT probe them.
 * For full verification with probing, use `verifyAndProbeGeminiKey`.
 *
 * @param {string} key API key to verify.
 * @returns {Promise<ApiKeyVerificationResult>}
 */
export async function verifyGeminiApiKey(key) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return { valid: false, error: "Gemini API key cannot be empty.", models: [] };

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
            return { valid: false, error: errorMsg, models: [] };
        }

        const payload = await response.json();
        const models = Array.isArray(payload.models)
            ? payload.models
                .map((/** @type {Record<string, unknown>} */ m) => /** @type {string} */ (m.name).replace("models/", ""))
                .filter((/** @type {string} */ name) => name.toLowerCase().includes("gemini"))
            : [];
        return { valid: true, error: null, models };
    } catch (err) {
        const error = /** @type {Error & {message?: string}} */ (err);
        return {
            valid: false,
            error: error.message || "Network error encountered while connecting to Gemini API.",
            models: []
        };
    }
}

// =========================================================================
// GEMINI MODEL PROBING
// =========================================================================

/**
 * Sends a minimal probe request to a single Gemini model to verify live availability.
 * Uses generateContent with a 1-token test prompt.
 *
 * @param {string} modelId Model ID to probe (e.g. "gemini-3.7-flash").
 * @param {string} apiKey Gemini API key.
 * @returns {Promise<ModelProbeResult>}
 */
export async function probeGeminiModel(modelId, apiKey) {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
        const url = `${GEMINI_API_BASE_URL}/models/${modelId}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "Hi" }] }],
                generationConfig: { maxOutputTokens: 1 }
            })
        });

        const latencyMs = Date.now() - startTime;

        if (response.ok) {
            return { model: modelId, working: true, error: null, latencyMs };
        }

        // Parse error for diagnostics
        let errorMsg = `HTTP ${response.status}`;
        try {
            const errData = await response.json();
            errorMsg = errData?.error?.message || errorMsg;
        } catch {}

        // Mark 404 (deprecated) and 400 (invalid model) as non-working
        if (response.status === 404 || response.status === 400) {
            return { model: modelId, working: false, error: `${errorMsg} [deprecated/unavailable]`, latencyMs };
        }

        // Rate limit: treat as non-working during onboarding so exhausted keys
        // cannot falsely count toward MIN_GEMINI_MODELS_REQUIRED
        if (response.status === 429) {
            return { model: modelId, working: false, error: `${errorMsg} [Quota exceeded or Rate Limited]`, latencyMs };
        }

        // Server error — still counts as "working" (transient)
        if (response.status >= 500) {
            return { model: modelId, working: true, error: `${errorMsg} [transient]`, latencyMs };
        }

        return { model: modelId, working: false, error: errorMsg, latencyMs };
    } catch (err) {
        const latencyMs = Date.now() - startTime;
        const error = /** @type {Error} */ (err);
        if (error.name === "AbortError") {
            return { model: modelId, working: false, error: "Probe timed out", latencyMs };
        }
        return { model: modelId, working: false, error: error.message || "Network error", latencyMs };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Probes multiple Gemini models concurrently with controlled parallelism.
 * Returns results for all models, marking each as working or not.
 *
 * @param {string[]} modelIds Array of model IDs to probe.
 * @param {string} apiKey Gemini API key.
 * @returns {Promise<ModelProbeResult[]>}
 */
export async function probeGeminiModels(modelIds, apiKey) {
    /** @type {ModelProbeResult[]} */
    const results = [];

    // Process in batches of MAX_CONCURRENT_PROBES
    for (let i = 0; i < modelIds.length; i += MAX_CONCURRENT_PROBES) {
        const batch = modelIds.slice(i, i + MAX_CONCURRENT_PROBES);
        const batchResults = await Promise.all(
            batch.map(modelId => probeGeminiModel(modelId, apiKey))
        );
        results.push(...batchResults);
    }

    return results;
}

// =========================================================================
// FULL DUAL-KEY VERIFICATION WITH PROBING
// =========================================================================

/**
 * Verifies BOTH Groq and Gemini API keys, probes Gemini models,
 * and enforces the minimum model count requirement.
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

    // Verify both keys in parallel
    const [groqResult, geminiBasicResult] = await Promise.all([
        verifyApiKey(cleanGroq),
        verifyGeminiApiKey(cleanGemini)
    ]);

    if (!groqResult.valid) {
        return {
            groq: groqResult,
            gemini: { ...geminiBasicResult, probeResults: [], workingModels: 0 },
            success: false,
            error: `Groq key verification failed: ${groqResult.error || "Invalid key."}`
        };
    }

    if (!geminiBasicResult.valid) {
        return {
            groq: groqResult,
            gemini: { ...geminiBasicResult, probeResults: [], workingModels: 0 },
            success: false,
            error: `Gemini key verification failed: ${geminiBasicResult.error || "Invalid key."}`
        };
    }

    // Build probe candidate list: merge API-reported models with known candidates
    const apiModels = geminiBasicResult.models;
    const probeCandidates = [...new Set([.../** @type {string[]} */ (GEMINI_PROBE_CANDIDATES), ...apiModels])];

    // Probe models
    const probeResults = await probeGeminiModels(probeCandidates, cleanGemini);
    const workingModels = probeResults.filter(r => r.working).length;

    /** @type {{valid: boolean, error: string|null, models: string[], probeResults: ModelProbeResult[], workingModels: number}} */
    const geminiResult = {
        valid: workingModels >= MIN_GEMINI_MODELS_REQUIRED,
        error: null,
        models: apiModels,
        probeResults,
        workingModels
    };

    if (workingModels < MIN_GEMINI_MODELS_REQUIRED) {
        const failedModels = probeResults.filter(r => !r.working);
        const diagnosticLines = failedModels.map(r => `  • ${r.model}: ${r.error || "failed"}`).join("\n");
        geminiResult.error = `Only ${workingModels}/${probeCandidates.length} Gemini models are responding (need ≥${MIN_GEMINI_MODELS_REQUIRED}).\nFailed models:\n${diagnosticLines}`;
        return {
            groq: groqResult,
            gemini: geminiResult,
            success: false,
            error: `Gemini model verification failed: Only ${workingModels} model(s) responding. Need at least ${MIN_GEMINI_MODELS_REQUIRED} working models.\n\nFailed models:\n${diagnosticLines}`
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
