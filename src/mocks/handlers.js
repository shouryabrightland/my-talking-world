// @ts-check

/**
 * @file handlers.js
 * Consolidated MSW v2 request handlers for all external API endpoints.
 *
 * Handlers:
 * 1. Groq  — /chat/completions (streaming + non-streaming), /models
 * 2. Gemini — /models, :generateContent, :streamGenerateContent (SSE)
 * 3. Open-Meteo — /v1/forecast (weather)
 * 4. Calendar Bharat — /calendar/2026.json (festivals)
 * 5. Google News RSS — rss2json.com (headlines)
 *
 * @module mocks/handlers
 */

import { http, HttpResponse, delay } from "msw";

// =========================================================================
// GROQ HANDLERS
// =========================================================================

/** @type {string} Default Groq dialogue response with thinking + record XML. */
const GROQ_DIALOGUE_RESPONSE =
    "<think>The group is chatting casually. I should respond in Hinglish with natural banter.</think>\n" +
    "<record type=\"message\" character=\"tom\" text=\"Arre yaar, aaj ka din bohot interesting raha hai! Main ek naya project idea soch raha hoon.\" />";

/** Groq streaming dialogue SSE payload. */
const GROQ_STREAM_CHUNKS = [
    { choices: [{ delta: { content: "<think>" } }] },
    { choices: [{ delta: { content: "Let me think about what to say..." } }] },
    { choices: [{ delta: { content: "</think>\n" } }] },
    { choices: [{ delta: { content: "<record " } }] },
    { choices: [{ delta: { content: "type=\"message\" " } }] },
    { choices: [{ delta: { content: "character=\"tom\" " } }] },
    { choices: [{ delta: { content: "text=\"Chal yaar, " } }] },
    { choices: [{ delta: { content: "chai peete hain aur baat karte hain!\" />" } }] },
    // Terminal chunks: finish_reason + usage (stream_options.include_usage).
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 210, completion_tokens: 48 } },
];

/**
 * Converts a JSON object to an SSE data line.
 * @param {object} obj
 * @returns {string}
 */
function sseLine(obj) {
    return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Creates an SSE ReadableStream from an array of JSON chunks.
 * @param {object[]} chunks
 * @param {number} [delayMs=10] Delay between chunks in ms.
 * @returns {ReadableStream<Uint8Array>}
 */
function createSSEStream(chunks, delayMs = 10) {
    const encoder = new TextEncoder();
    let index = 0;

    return new ReadableStream({
        async pull(controller) {
            if (index < chunks.length) {
                if (delayMs > 0) await delay(delayMs);
                controller.enqueue(encoder.encode(sseLine(chunks[index])));
                index++;
            } else {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            }
        }
    });
}

export const groqHandlers = [
    /**
     * GET /openai/v1/models — Groq model list.
     */
    http.get("https://api.groq.com/openai/v1/models", ({ request }) => {
        const auth = request.headers.get("Authorization");
        if (!auth || !auth.startsWith("Bearer ")) {
            return HttpResponse.json(
                { error: { message: "Invalid API key", code: "invalid_api_key" } },
                { status: 401 }
            );
        }
        const key = auth.replace("Bearer ", "").trim();
        if (key === "invalid-groq-key" || !key.startsWith("gsk_")) {
            return HttpResponse.json(
                { error: { message: "Invalid API key", code: "invalid_api_key" } },
                { status: 401 }
            );
        }
        return HttpResponse.json({
            data: [
                { id: "llama-3.3-70b-versatile", object: "model" },
                { id: "llama-3.1-8b-instant", object: "model" },
                { id: "mixtral-8x7b-32768", object: "model" },
                // Non-chat models: GroqModelPool MUST filter these out.
                { id: "llama-prompt-guard-2-8b", object: "model" },
                { id: "whisper-large-v3", object: "model" },
                { id: "orpheus-tts", object: "model" },
                { id: "text-embedding-v3", object: "model" }
            ]
        });
    }),

    /**
     * POST /openai/v1/chat/completions — Groq chat (streaming + non-streaming).
     */
    http.post("https://api.groq.com/openai/v1/chat/completions", async ({ request }) => {
        const auth = request.headers.get("Authorization");
        if (!auth || !auth.startsWith("Bearer ")) {
            return HttpResponse.json(
                { error: { message: "Invalid API key", code: "invalid_api_key" } },
                { status: 401 }
            );
        }

        // Mirror the /models contract: reject unknown keys with 401 so the
        // lightweight 1-token verification test can distinguish them.
        const bearerKey = auth.replace("Bearer ", "").trim();
        if (bearerKey === "invalid-groq-key" || !bearerKey.startsWith("gsk_")) {
            return HttpResponse.json(
                { error: { message: "Invalid API key", code: "invalid_api_key" } },
                { status: 401 }
            );
        }

        const body = /** @type {Record<string, unknown>} */ (await request.json());
        const isStreaming = /** @type {Record<string, unknown>} */ (body).stream === true;

        if (isStreaming) {
            const stream = createSSEStream(GROQ_STREAM_CHUNKS, 5);
            return new HttpResponse(stream, {
                headers: { "Content-Type": "text/event-stream" }
            });
        }

        return HttpResponse.json({
            id: "mock-chatcmpl-001",
            object: "chat.completion",
            model: body.model || "llama-3.3-70b-versatile",
            choices: [{
                index: 0,
                message: { role: "assistant", content: GROQ_DIALOGUE_RESPONSE },
                finish_reason: "stop"
            }],
            usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 }
        });
    }),
];

// =========================================================================
// GEMINI HANDLERS
// =========================================================================

/** @type {Array<{ name: string, displayName: string, baseModelId: string, supportedGenerationMethods: string[] }>} */
const GEMINI_MODELS = [
    { name: "models/gemini-3.7-flash", displayName: "Gemini 3.7 Flash", baseModelId: "gemini-3.7-flash", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
    { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", baseModelId: "gemini-3.5-flash", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
    { name: "models/gemini-3.1-pro", displayName: "Gemini 3.1 Pro", baseModelId: "gemini-3.1-pro", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
    { name: "models/gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash Lite", baseModelId: "gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", baseModelId: "gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
    { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", baseModelId: "gemini-2.0-flash", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
    { name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash", baseModelId: "gemini-1.5-flash", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
    { name: "models/gemma-3-27b-it", displayName: "Gemma 3 27B IT", baseModelId: "gemma-3-27b-it", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", displayName: "Text Embedding 004", baseModelId: "text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/imagen-3.0-generate-002", displayName: "Imagen 3", baseModelId: "imagen-3.0-generate-002", supportedGenerationMethods: ["predict"] },
];

/** @type {Set<string>} Models configured to return 404 during probing. */
let deprecatedModels = new Set();

/** @type {Set<string>} Models configured to return 429 during probing. */
let rateLimitedModels = new Set();

/** @type {string|null} Custom response override for next generateContent call. */
let customGenerateResponse = null;

/** Gemini SSE chunks for schedule generation. */
const GEMINI_SCHEDULE_STREAM = [
    { candidates: [{ content: { parts: [{ text: "<schedule>\n  <block start=\"14\" end=\"15\">\n    <topic>Chai and casual banter</topic>\n    <goals><main>Relax and chat</main></goals>\n    <pre_plot>Afternoon begins</pre_plot>\n    <post_plot>Transition to evening</post_plot>\n    <facts><fact>Chai ready</fact></facts>\n  </block>\n</schedule>" }] }, finishReason: "STOP" }] },
];

const GEMINI_STABILIZE_STREAM = [
    { candidates: [{ content: { parts: [{ text: "<schedule>\n  <block start=\"14\" end=\"15\">\n    <topic>Chai and casual banter</topic>\n    <goals><main>Relax and chat</main></goals>\n    <pre_plot>Afternoon begins</pre_plot>\n    <post_plot>Transition to evening</post_plot>\n    <facts><fact>Chai ready</fact></facts>\n  </block>\n</schedule>" }] }, finishReason: "STOP" }] },
];

export const geminiHandlers = [
    /**
     * GET /v1beta/models — Gemini model list.
     */
    http.get("https://generativelanguage.googleapis.com/v1beta/models", ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        if (!key) {
            return HttpResponse.json({ error: { message: "Missing API key", code: 400 } }, { status: 400 });
        }
        if (key === "invalid-key-12345") {
            return HttpResponse.json({ error: { message: "API key not valid.", code: 403 } }, { status: 403 });
        }
        const available = GEMINI_MODELS.filter(m => !deprecatedModels.has(m.baseModelId));
        return HttpResponse.json({ models: available });
    }),

    /**
     * POST /v1beta/models/:modelId\:generateContent — Non-streaming generate.
     */
    http.post("https://generativelanguage.googleapis.com/v1beta/models/:modelId\\:generateContent", async ({ params }) => {
        const modelId = /** @type {string} */ (params.modelId);

        if (deprecatedModels.has(modelId)) {
            return HttpResponse.json({ error: { message: `Model '${modelId}' is not found`, code: 404 } }, { status: 404 });
        }
        if (rateLimitedModels.has(modelId)) {
            return HttpResponse.json({ error: { message: "Rate limit exceeded", code: 429 } }, { status: 429 });
        }

        if (customGenerateResponse) {
            const resp = customGenerateResponse;
            customGenerateResponse = null;
            return HttpResponse.json({
                candidates: [{ content: { parts: [{ text: resp }] }, finishReason: "STOP", index: 0 }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
            });
        }

        return HttpResponse.json({
            candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP", index: 0 }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
        });
    }),

    /**
     * POST /v1beta/models/:modelId\:streamGenerateContent — SSE streaming generate.
     */
    http.post("https://generativelanguage.googleapis.com/v1beta/models/:modelId\\:streamGenerateContent", async ({ params }) => {
        const modelId = /** @type {string} */ (params.modelId);

        if (deprecatedModels.has(modelId)) {
            return HttpResponse.json({ error: { message: `Model '${modelId}' is not found`, code: 404 } }, { status: 404 });
        }
        if (rateLimitedModels.has(modelId)) {
            return HttpResponse.json({ error: { message: "Rate limit exceeded", code: 429 } }, { status: 429 });
        }

        // Determine response based on model or custom override
        const chunks = customGenerateResponse
            ? [{ candidates: [{ content: { parts: [{ text: customGenerateResponse }] }, finishReason: "STOP" }] }]
            : (modelId.includes("2.5-flash") ? GEMINI_SCHEDULE_STREAM : GEMINI_STABILIZE_STREAM);

        if (customGenerateResponse) customGenerateResponse = null;

        const stream = createSSEStream(chunks, 5);
        return new HttpResponse(stream, {
            headers: { "Content-Type": "text/event-stream" }
        });
    }),
];

// =========================================================================
// OPEN-METEO HANDLERS
// =========================================================================

export const openMeteoHandlers = [
    /**
     * GET /v1/forecast — Weather data.
     */
    http.get("https://api.open-meteo.com/v1/forecast", () => {
        return HttpResponse.json({
            current: {
                temperature_2m: 32,
                relative_humidity_2m: 55,
                weather_code: 1
            },
            timezone: "Asia/Kolkata"
        });
    }),
];

// =========================================================================
// CALENDAR BHARAT HANDLERS
// =========================================================================

export const calendarBharatHandlers = [
    /**
     * GET /calendar/2026.json — Festival/holiday calendar.
     */
    http.get("https://jayantur13.github.io/calendar-bharat/calendar/2026.json", () => {
        // Mirrors the live API shape: { "2026": { "Month YYYY": { "Month D, YYYY, Weekday": {event,...} } } }
        return HttpResponse.json({
            "2026": {
                "August 2026": {
                    "August 15, 2026, Saturday": { event: "Independence Day", type: "Government Holiday", extras: "fixed day in Gregorian calendar" },
                    "August 25, 2026, Tuesday": { event: "Onam", type: "Religional Festival", extras: "Chingam 1" },
                    "August 26, 2026, Wednesday": { event: "Onam Celebrations", type: "Religional Festival", extras: "Chingam 2" }
                },
                "October 2026": {
                    "October 2, 2026, Friday": { event: "Gandhi Jayanti", type: "Government Holiday", extras: "fixed day in Gregorian calendar" },
                    "October 20, 2026, Tuesday": { event: "Dussehra", type: "Religional Festival", extras: "Ashwina, Shukla Dashami" },
                    "October 21, 2026, Wednesday": { event: "Madhvacharya Jayanti", type: "Religional Festival", extras: "Ashwina, Shukla Dashami" }
                },
                "November 2026": {
                    "November 8, 2026, Sunday": { event: "Diwali", type: "Religional Festival", extras: "Kartika, Krishna Amavasya" },
                    "November 10, 2026, Tuesday": { event: "Govardhan Puja", type: "Religional Festival", extras: "Kartika, Shukla Pratipada" },
                    "November 11, 2026, Wednesday": { event: "Bhaiya Dooj", type: "Religional Festival", extras: "Kartika, Shukla Dwitiya" }
                }
            }
        });
    }),
];

// =========================================================================
// GOOGLE NEWS RSS HANDLERS
// =========================================================================

export const googleNewsHandlers = [
    /**
     * GET /v1/api.json (rss2json) — Google News RSS headlines.
     */
    http.get("https://api.rss2json.com/v1/api.json", () => {
        return HttpResponse.json({
            status: "ok",
            items: [
                { title: "India GDP growth accelerates to 7.2% in Q2", pubDate: "2026-08-25" },
                { title: "ISRO launches new satellite for weather monitoring", pubDate: "2026-08-25" },
                { title: "Monsoon rainfall exceeds expectations across North India", pubDate: "2026-08-24" },
                { title: "Tech startup ecosystem reaches new milestone in Lucknow", pubDate: "2026-08-24" },
                { title: "Cricket World Cup preparations enter final phase", pubDate: "2026-08-23" }
            ]
        });
    }),
];

// =========================================================================
// GOOGLE 204 CONNECTIVITY PROBE
// =========================================================================

/**
 * GET /generate_204 — Google connectivity probe used by OfflineContext.
 * Returns empty 204 to signal online status.
 */
export const connectivityHandlers = [
    http.get("https://www.google.com/generate_204", () => {
        return new HttpResponse(null, { status: 204 });
    }),
];

// =========================================================================
// COMBINED EXPORT
// =========================================================================

/** All MSW handlers combined for the server. */
export const handlers = [
    ...groqHandlers,
    ...geminiHandlers,
    ...openMeteoHandlers,
    ...calendarBharatHandlers,
    ...googleNewsHandlers,
    ...connectivityHandlers,
];

// =========================================================================
// TEST HELPERS
// =========================================================================

/** Resets all mutable mock state. */
export function resetAllMocks() {
    deprecatedModels.clear();
    rateLimitedModels.clear();
    customGenerateResponse = null;
}

/** Configures specific Gemini models to return 404. @param {string[]} models */
export function setDeprecatedModels(models) {
    deprecatedModels = new Set(models);
}

/** Configures specific Gemini models to return 429. @param {string[]} models */
export function setRateLimitedModels(models) {
    rateLimitedModels = new Set(models);
}

/** Sets a custom response text for the next Gemini generateContent call. @param {string} text */
export function setCustomGenerateResponse(text) {
    customGenerateResponse = text;
}

/** @type {boolean} Whether the network mock should simulate offline. */
let networkOffline = false;

/** @type {boolean} Whether Groq API should return 429 rate limit. */
let groqRateLimited = false;

/** @type {boolean} Whether Open-Meteo should return an error. */
let weatherFail = false;

/** Configures network offline simulation. @param {boolean} offline */
export function setNetworkOffline(offline) {
    networkOffline = offline;
}

/** Configures Groq to return 429 rate limit. @param {boolean} limited */
export function setGroqRateLimited(limited) {
    groqRateLimited = limited;
}

/** Configures Open-Meteo to return errors. @param {boolean} fail */
export function setWeatherFail(fail) {
    weatherFail = fail;
}
