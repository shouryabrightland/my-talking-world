// @ts-check

/**
 * @file geminiHandlers.js
 * MSW request handlers for mocking Google AI Studio Gemini API endpoints.
 *
 * Handlers:
 * - GET  /v1beta/models              → Returns list of available models
 * - POST /v1beta/models/:id:generateContent → Probes model availability
 * - POST /v1beta/models/:id:streamGenerateContent → Probes streaming availability
 */

import { http, HttpResponse } from "msw";

// =========================================================================
// TEST FIXTURES
// =========================================================================

/** @typedef {{ name: string, displayName: string, baseModelId: string, supportedGenerationMethods: string[] }} MockGeminiModel */

/**
 * Full list of mock Gemini models returned by the API.
 * @type {MockGeminiModel[]}
 */
const MOCK_MODELS = [
    {
        name: "models/gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        baseModelId: "gemini-3.7-flash",
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
    },
    {
        name: "models/gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        baseModelId: "gemini-3.5-flash",
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
    },
    {
        name: "models/gemini-3.1-pro",
        displayName: "Gemini 3.1 Pro",
        baseModelId: "gemini-3.1-pro",
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
    },
    {
        name: "models/gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        baseModelId: "gemini-3.5-flash-lite",
        supportedGenerationMethods: ["generateContent"]
    },
    {
        name: "models/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        baseModelId: "gemini-2.5-flash",
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
    },
    {
        name: "models/text-embedding-004",
        displayName: "Text Embedding 004",
        baseModelId: "text-embedding-004",
        supportedGenerationMethods: ["embedContent"]
    }
];

/**
 * Models that are configured to fail during probing (deprecated/unavailable).
 * @type {Set<string>}
 */
let deprecatedModels = new Set();

/**
 * Models that return 429 rate limit during probing.
 * @type {Set<string>}
 */
let rateLimitedModels = new Set();

// =========================================================================
// HANDLERS
// =========================================================================

export const geminiHandlers = [
    /**
     * GET /v1beta/models — Returns the list of available Gemini models.
     */
    http.get("https://generativelanguage.googleapis.com/v1beta/models", ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");

        if (!key) {
            return HttpResponse.json(
                { error: { message: "Missing API key", code: 400 } },
                { status: 400 }
            );
        }

        if (key === "invalid-key-12345") {
            return HttpResponse.json(
                { error: { message: "API key not valid. Please pass a valid API key.", code: 403 } },
                { status: 403 }
            );
        }

        // Filter out deprecated models from the list
        const availableModels = MOCK_MODELS.filter(m => !deprecatedModels.has(m.baseModelId));

        return HttpResponse.json({
            models: availableModels
        });
    }),

    /**
     * POST /v1beta/models/:modelId:generateContent — Probes a model for availability.
     */
    http.post("https://generativelanguage.googleapis.com/v1beta/models/:modelId\\:generateContent", async ({ params }) => {
        const modelId = /** @type {string} */ (params.modelId);

        // Simulate deprecated/unavailable models
        if (deprecatedModels.has(modelId)) {
            return HttpResponse.json(
                { error: { message: `Model '${modelId}' is not found`, code: 404 } },
                { status: 404 }
            );
        }

        // Simulate rate-limited models
        if (rateLimitedModels.has(modelId)) {
            return HttpResponse.json(
                { error: { message: "Rate limit exceeded", code: 429 } },
                { status: 429 }
            );
        }

        // Success: return minimal response
        return HttpResponse.json({
            candidates: [{
                content: {
                    parts: [{ text: "OK" }],
                    role: "model"
                },
                finishReason: "STOP",
                index: 0
            }],
            usageMetadata: {
                promptTokenCount: 1,
                candidatesTokenCount: 1,
                totalTokenCount: 2
            }
        });
    })
];

// =========================================================================
// TEST HELPERS
// =========================================================================

/**
 * Resets all mock state to defaults.
 * @returns {void}
 */
export function resetGeminiMocks() {
    deprecatedModels.clear();
    rateLimitedModels.clear();
}

/**
 * Configures specific models to return 404 (deprecated/unavailable).
 * @param {string[]} models Model IDs to mark as deprecated.
 * @returns {void}
 */
export function setDeprecatedModels(models) {
    deprecatedModels = new Set(models);
}

/**
 * Configures specific models to return 429 (rate limited).
 * @param {string[]} models Model IDs to mark as rate-limited.
 * @returns {void}
 */
export function setRateLimitedModels(models) {
    rateLimitedModels = new Set(models);
}
