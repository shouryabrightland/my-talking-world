// @ts-check

/**
 * @file GeminiClient.js
 * Lightweight, Stateless Gemini REST Client with dynamic model capability adaptation.
 */

/** @typedef {import("./lib/Logger").default} Logger */
/** @typedef {import("./PromptBuilder").ChatMessage} ChatMessage */
/** @typedef {import("./lib/PromptLogger").PromptType} PromptType */
/** @typedef {import("./lib/GeminiModelResolver").default} GeminiModelPool */

import {
    getGeminiApiKey,
    GEMINI_API_BASE_URL,
    DEFAULT_GEMINI_MODEL,
    GEMINI_MAX_OUTPUT_TOKENS
} from "../util/Constants";
import EventManager from "./EventManager";
import PromptLogger from "./lib/PromptLogger";
import ProtocolCodec from "./ProtocolCodec";
import CircuitBreaker from "./lib/CircuitBreaker";

export const GeminiClientEvents = {
    TEXT: "text",
    THINKING: "thinking",
    DONE: "done",
    ERROR: "error"
};

/**
 * @typedef {Object} GroundingMetadata
 * @property {string[]} [webSearchQueries] Search queries issued by the model.
 * @property {Array<Record<string, any>>} [groundingChunks] Source chunks with URIs/titles.
 * @property {Array<Record<string, any>>} [groundingSupports] Segment-to-chunk citation supports.
 */

/**
 * @typedef {Object} GeminiResultText
 * @property {string} text Full generated text response (reasoning parts excluded).
 * @property {string} model Model ID used for the response.
 * @property {string|null} thinking Extracted thinking chain if present.
 * @property {string} [thoughtText] Raw reasoning text streamed before the answer.
 * @property {Record<string, any>} [usage] Usage metadata metrics.
 * @property {GroundingMetadata|null} [groundingMetadata] Captured Google Search grounding metadata.
 */

export const PLANNER_THINKING_BUDGET = 512;
export const DEEP_THINKING_BUDGET = 1024;
export const STABILIZER_THINKING_BUDGET = 128;
export const GOOGLE_SEARCH_TOOL = [{ googleSearch: {} }];

const sharedCircuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 45_000,
    successThreshold: 1,
    onStateChange: (newState, oldState) => {
        console.log(`[GeminiClient] Provider Circuit breaker: ${oldState} → ${newState}`);
    }
});

export default class GeminiClient {

    /**
     * @param {Object} options
     * @param {Logger} options.logger Root parent logger.
     * @param {string} [options.defaultModel] Last-resort Gemini model.
     * @param {string|null} [options.apiKey] Optional explicit API key override.
     * @param {GeminiModelPool|null} [options.modelPool] Dynamic model pool.
     */
    constructor({
        logger,
        defaultModel = DEFAULT_GEMINI_MODEL,
        apiKey = null,
        modelPool = null
    }) {
        if (!logger) throw new TypeError("GeminiClient requires a Logger instance.");

        /** @readonly @type {Logger} */ this.logger = logger.child("GeminiClient");
        /** @readonly @type {EventManager} */ this.events = new EventManager(this.logger);
        /** @readonly @type {string} */ this.defaultModel = defaultModel;
        /** @private @type {string|null} */ this._customApiKey = apiKey;
        /** @readonly @type {GeminiModelPool|null} */ this.modelPool = modelPool;

        /** @type {AbortController|null} */ this.abortController = null;
    }

    get apiKey() {
        return this._customApiKey || getGeminiApiKey();
    }

    async resolveModel() {
        if (this.modelPool) {
            try {
                const active = await this.modelPool.getActiveModel();
                if (active) return active;
            } catch (err) {
                this.logger.warn("Gemini model pool resolution failed:", err);
            }
        }
        return this.defaultModel;
    }

    get circuitState() {
        return sharedCircuitBreaker.state;
    }

    /**
     * Streams text generation via Gemini's streamGenerateContent REST API.
     *
     * @param {ChatMessage[]} messages
     * @param {Object} [options]
     * @param {number} [options.temperature]
     * @param {number} [options.maxOutputTokens]
     * @param {string|null} [options.model]
     * @param {PromptType} [options.promptType]
     * @param {number} [options.maxRetries]
     * @param {any[]|null} [options.tools]
     * @param {number} [options.thinkingBudget]
     */
    async streamGenerate(messages, {
        temperature = 0.7,
        maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS,
        model = null,
        promptType = "scheduler",
        maxRetries = 2,
        tools = null,
        thinkingBudget = PLANNER_THINKING_BUDGET
    } = {}) {
        this.abort();
        this.abortController = new AbortController();

        const startTime = Date.now();
        const activeKey = this.apiKey;
        const targetModel = model || await this.resolveModel();

        if (!activeKey) {
            const error = new Error("Google AI Studio Gemini API key is missing. Please configure your key in Settings.");
            PromptLogger.record({
                type: promptType, model: targetModel, startTime, requestMessages: messages,
                rawResponse: "", status: "error", error: error.message
            });
            throw error;
        }

        const requestBody = this.#buildRequestBody(messages, temperature, maxOutputTokens, { thinkingBudget, tools }, targetModel);

        try {
            return await sharedCircuitBreaker.execute(async () => {
                return await this.#streamWithRetry(requestBody, targetModel, activeKey, startTime, messages, promptType, maxRetries);
            });
        } finally {
            this.abort();
        }
    }

    /**
     * Executes non-streaming REST text generation with 65K max output token capacity.
     *
     * @param {ChatMessage[]} messages
     * @param {Object} [options]
     * @param {number} [options.temperature]
     * @param {number} [options.maxOutputTokens]
     * @param {string|null} [options.model]
     * @param {PromptType} [options.promptType]
     * @param {number} [options.maxRetries]
     * @param {any[]|null} [options.tools]
     * @param {number} [options.thinkingBudget]
     */
    async generateText(messages, {
        temperature = 0.7,
        maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS,
        model = null,
        promptType = "scheduler",
        maxRetries = 2,
        tools = null,
        thinkingBudget = PLANNER_THINKING_BUDGET
    } = {}) {
        this.abort();
        this.abortController = new AbortController();

        const startTime = Date.now();
        const activeKey = this.apiKey;
        const targetModel = model || await this.resolveModel();

        if (!activeKey) {
            const error = new Error("Google AI Studio Gemini API key is missing. Please configure your key in Settings.");
            PromptLogger.record({
                type: promptType, model: targetModel, startTime, requestMessages: messages,
                rawResponse: "", status: "error", error: error.message
            });
            throw error;
        }

        const requestBody = this.#buildRequestBody(messages, temperature, maxOutputTokens, { thinkingBudget, tools }, targetModel);

        try {
            return await sharedCircuitBreaker.execute(async () => {
                return await this.#generateWithRetry(requestBody, targetModel, activeKey, startTime, messages, promptType, maxRetries);
            });
        } finally {
            this.abort();
        }
    }

    // =========================================================================
    // PRIVATE: Streaming with retry & self-healing
    // =========================================================================

    /**
     * @param {Record<string, any>} requestBody
     * @param {string|null} model
     * @param {string} key
     * @param {number} startTime
     * @param {ChatMessage[]} messages
     * @param {PromptType} promptType
     * @param {number} maxRetries
     * @returns {Promise<GeminiResultText>}
     */
    async #streamWithRetry(requestBody, model, key, startTime, messages, promptType, maxRetries) {
        let lastError = null;
        let attempts = 0;
        const maxAttempts = 1 + maxRetries;
        const cleanModelId = String(model || "").replace(/^models\//, "");

        while (attempts < maxAttempts) {
            attempts++;

            try {
                this.logger.debug(`Executing Gemini stream call on "${cleanModelId}" (attempt ${attempts}/${maxAttempts})...`);

                const url = `${GEMINI_API_BASE_URL}/models/${cleanModelId}:streamGenerateContent?alt=sse&key=${key}`;

                const response = await fetch(url, {
                    method: "POST",
                    signal: this.abortController?.signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errPayload = await response.json().catch(() => ({}));
                    const msg = errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`;

                    // Self-healing: if the model rejected thinkingConfig or tools with HTTP 400, retry once without them
                    if (response.status === 400) {
                        const bodyGen = /** @type {Record<string, any>} */ (requestBody.generationConfig || {});
                        if (bodyGen.thinkingConfig && /thinking/i.test(msg)) {
                            this.logger.warn(`Model "${cleanModelId}" does not support thinkingConfig. Stripping and retrying...`);
                            delete bodyGen.thinkingConfig;
                            continue;
                        }
                        if (requestBody.tools && /tool|search|grounding/i.test(msg)) {
                            this.logger.warn(`Model "${cleanModelId}" does not support search tools. Stripping and retrying...`);
                            delete requestBody.tools;
                            continue;
                        }
                    }

                    const error = /** @type {any} */ (new Error(msg));
                    error.status = response.status;
                    // Model-level 400, 404, or 429 are handled by the GeminiModelPool and MUST NOT trip the provider breaker.
                    if (response.status === 400 || response.status === 404 || response.status === 429) {
                        error.noCircuitTrip = true;
                    }
                    throw error;
                }

                if (!response.body) {
                    this.logger.warn("Gemini stream response has no body. Falling back to non-streaming...");
                    return await this.#generateWithRetry(requestBody, cleanModelId, key, startTime, messages, promptType, 0);
                }

                const { text: rawText, thoughtText, groundingMetadata } = await this.#readSSEStream(response.body);
                const { cleanText, thinking: inlineThinking } = ProtocolCodec.extractThinkingChain(rawText);

                // Prefer reasoning captured from `part.thought === true` parts;
                // fall back to inline <think>/<thought> spans in the output text.
                const thinking = inlineThinking || (thoughtText ? thoughtText.trim() : null);

                PromptLogger.record({
                    type: promptType, model: cleanModelId, startTime, requestMessages: messages,
                    rawResponse: rawText, thinkingChain: thinking, groundingMetadata, status: "success"
                });

                return {
                    text: cleanText, model: cleanModelId, thinking,
                    thoughtText: thoughtText || "", groundingMetadata
                };

            } catch (err) {
                const castErr = /** @type {any} */ (err);
                lastError = castErr;
                if (castErr instanceof DOMException && castErr.name === "AbortError") throw castErr;

                // Mark model-level errors so they do not trip the global breaker
                if (castErr.status === 400 || castErr.status === 404 || castErr.status === 429) {
                    castErr.noCircuitTrip = true;
                }

                // Fast-failover: throw immediately on model-level errors to rotate to the next candidate
                if (castErr.status === 429 || castErr.status === 503 || castErr.status === 404 || castErr.status === 400) {
                    this.logger.warn(`Fast-failover: HTTP ${castErr.status} on "${cleanModelId}". Advancing to next pool model.`);
                    break;
                }

                const retryMs = this.#getRetryDelay(castErr, attempts);
                if (retryMs !== null && attempts < maxAttempts) {
                    this.logger.warn(`Retryable error on "${cleanModelId}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                    await this.#sleep(retryMs);
                    continue;
                }

                break;
            }
        }

        PromptLogger.record({
            type: promptType, model: cleanModelId, startTime, requestMessages: messages,
            rawResponse: "", status: "error", error: lastError?.message || "Gemini generation failed"
        });

        this.logger.error(`Gemini stream generation failed on "${cleanModelId}":`, lastError?.message || lastError);
        throw lastError;
    }

    // =========================================================================
    // PRIVATE: Non-streaming with retry & self-healing
    // =========================================================================

    /**
     * @param {Record<string, any>} requestBody
     * @param {string|null} model
     * @param {string} key
     * @param {number} startTime
     * @param {ChatMessage[]} messages
     * @param {PromptType} promptType
     * @param {number} maxRetries
     * @returns {Promise<GeminiResultText>}
     */
    async #generateWithRetry(requestBody, model, key, startTime, messages, promptType, maxRetries) {
        let lastError = null;
        let attempts = 0;
        const maxAttempts = 1 + maxRetries;
        const cleanModelId = String(model || "").replace(/^models\//, "");

        while (attempts < maxAttempts) {
            attempts++;

            try {
                this.logger.debug(`Executing Gemini REST call on "${cleanModelId}" (attempt ${attempts}/${maxAttempts})...`);

                const url = `${GEMINI_API_BASE_URL}/models/${cleanModelId}:generateContent?key=${key}`;

                const response = await fetch(url, {
                    method: "POST",
                    signal: this.abortController?.signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody)
                });

                if (response.status === 429 || response.status === 503) {
                    const retryMs = this.#getRetryFromResponse(response, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        this.logger.warn(`HTTP ${response.status} on "${cleanModelId}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                        await this.#sleep(retryMs);
                        continue;
                    }
                }

                if (!response.ok) {
                    const errPayload = await response.json().catch(() => ({}));
                    const msg = errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`;

                    if (response.status === 400) {
                        const bodyGen = /** @type {Record<string, any>} */ (requestBody.generationConfig || {});
                        if (bodyGen.thinkingConfig && /thinking/i.test(msg)) {
                            this.logger.warn(`Model "${cleanModelId}" does not support thinkingConfig. Stripping and retrying...`);
                            delete bodyGen.thinkingConfig;
                            continue;
                        }
                        if (requestBody.tools && /tool|search|grounding/i.test(msg)) {
                            this.logger.warn(`Model "${cleanModelId}" does not support search tools. Stripping and retrying...`);
                            delete requestBody.tools;
                            continue;
                        }
                    }

                    const error = /** @type {any} */ (new Error(msg));
                    error.status = response.status;
                    if (response.status === 400 || response.status === 404 || response.status === 429) {
                        error.noCircuitTrip = true;
                    }
                    throw error;
                }

                const data = await response.json();
                const candidates = data?.candidates || [];
                const parts = candidates[0]?.content?.parts || [];
                const groundingMetadata = candidates[0]?.groundingMetadata || null;

                let rawText = "";
                let thoughtText = "";
                for (const part of parts) {
                    if (!part.text) continue;
                    // Gemini 2.5 / 3.x reasoning parts carry `thought: true`.
                    if (part.thought === true) {
                        thoughtText += part.text;
                        continue;
                    }
                    rawText += part.text;
                }

                const { cleanText, thinking: inlineThinking } = ProtocolCodec.extractThinkingChain(rawText);
                const thinking = inlineThinking || (thoughtText ? thoughtText.trim() : null);

                PromptLogger.record({
                    type: promptType, model: cleanModelId, startTime, requestMessages: messages,
                    rawResponse: rawText, thinkingChain: thinking, groundingMetadata, status: "success"
                });

                return {
                    text: cleanText, model: cleanModelId, thinking,
                    thoughtText, usage: data?.usageMetadata, groundingMetadata
                };

            } catch (err) {
                const castErr = /** @type {any} */ (err);
                lastError = castErr;
                if (castErr instanceof DOMException && castErr.name === "AbortError") throw castErr;

                if (castErr.status === 400 || castErr.status === 404 || castErr.status === 429) {
                    castErr.noCircuitTrip = true;
                }

                const retryMs = this.#getRetryDelay(castErr, attempts);
                if (retryMs !== null && attempts < maxAttempts) {
                    this.logger.warn(`Retryable error on "${cleanModelId}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                    await this.#sleep(retryMs);
                    continue;
                }

                break;
            }
        }

        PromptLogger.record({
            type: promptType, model: cleanModelId, startTime, requestMessages: messages,
            rawResponse: "", status: "error", error: lastError?.message || "Gemini generation failed"
        });

        this.logger.error(`Gemini REST generation failed on "${cleanModelId}":`, lastError?.message || lastError);
        throw lastError;
    }

    /**
     * Reads the `streamGenerateContent?alt=sse` stream, separating reasoning
     * (`part.thought === true`) parts from real output parts.
     *
     * Reasoning tokens are emitted via GeminiClientEvents.THINKING and are
     * NEVER appended to the output text, so downstream `<schedule>`/`<block>`
     * detection cannot fire on a model's preamble (Task 7).
     *
     * @param {ReadableStream<Uint8Array>} body
     * @returns {Promise<{ text: string, thoughtText: string, groundingMetadata: GroundingMetadata|null }>}
     */
    async #readSSEStream(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullText = "";
        let thoughtText = "";
        /** @type {GroundingMetadata|null} */
        let groundingMetadata = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;

                const payload = trimmed.replace(/^data:\s*/, "");
                if (payload === "[DONE]") return { text: fullText, thoughtText, groundingMetadata };

                try {
                    const parsed = JSON.parse(payload);
                    const candidates = parsed?.candidates || [];
                    const parts = candidates[0]?.content?.parts || [];
                    for (const part of parts) {
                        if (!part.text) continue;

                        // Gemini 2.5 / 3.x reasoning: `thought: true` marks a
                        // thought part. Keep it out of the output stream.
                        if (part.thought === true) {
                            thoughtText += part.text;
                            this.events.emit(GeminiClientEvents.THINKING, part.text);
                            continue;
                        }

                        fullText += part.text;
                        this.events.emit(GeminiClientEvents.TEXT, part.text);
                    }
                    if (candidates[0]?.groundingMetadata) {
                        groundingMetadata = candidates[0].groundingMetadata;
                    }
                } catch {
                    // Ignore non-JSON heartbeat lines
                }
            }
        }

        return { text: fullText, thoughtText, groundingMetadata };
    }

    /**
     * @param {ChatMessage[]} messages
     * @param {number} temperature
     * @param {number} maxOutputTokens
     * @param {{ thinkingBudget?: number, tools?: any[]|null }} [options]
     * @param {string} [model]
     * @returns {Record<string, any>}
     */
    #buildRequestBody(messages, temperature, maxOutputTokens, { thinkingBudget = PLANNER_THINKING_BUDGET, tools = null } = {}, model = "") {
        const systemMessage = messages.find(m => m.role === "system");
        const conversationMessages = messages.filter(m => m.role !== "system");

        const cleanModel = String(model || "").replace(/^models\//, "").toLowerCase();
        // Only attach thinkingConfig if the model supports it (Gemini 2.5/3.x, excluding Gemma and older checkpoints)
        const supportsThinking = /gemini-(?:2\.5|3\.)/i.test(cleanModel) && !/gemma/i.test(cleanModel);

        /** @type {Record<string, any>} */
        const generationConfig = {
            temperature,
            maxOutputTokens
        };

        if (supportsThinking && typeof thinkingBudget === "number" && thinkingBudget >= 0) {
            generationConfig.thinkingConfig = { thinkingBudget };
        }

        // Defensive fallback: Gemini API rejects an empty `contents` array (HTTP 400),
        // so if only a system message was provided, promote it to a user turn.
        const contentsPayload = conversationMessages.length > 0
            ? conversationMessages.map(msg => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }]
            }))
            : [{
                role: "user",
                parts: [{ text: systemMessage?.content || "Proceed with generation." }]
            }];

        /** @type {Record<string, any>} */
        const body = {
            contents: contentsPayload,
            generationConfig
        };

        // Only attach tools if provided and the model is not Gemma (Gemma returns 400 on tools)
        if (Array.isArray(tools) && tools.length > 0 && !/gemma/i.test(cleanModel)) {
            body.tools = tools;
        }

        if (systemMessage && systemMessage.content) {
            body.systemInstruction = {
                parts: [{ text: systemMessage.content }]
            };
        }

        return body;
    }

    /**
     * @param {any} err
     * @param {number} attempt
     * @returns {number|null}
     */
    #getRetryDelay(err, attempt) {
        if (err.retryAfter) {
            const parsed = Number(err.retryAfter);
            if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000;
        }

        if (err.status === 429) return this.#exponentialBackoff(attempt, 5_000, 60_000);
        if (err.status === 503) return this.#exponentialBackoff(attempt, 10_000, 120_000);
        if (err.status !== undefined && [500, 502, 504].includes(err.status)) return this.#exponentialBackoff(attempt, 3_000, 30_000);
        if (!err.status && (err.name === "TypeError" || err.message?.includes("fetch"))) {
            return this.#exponentialBackoff(attempt, 2_000, 15_000);
        }

        return null;
    }

    /**
     * @param {Response} response
     * @param {number} attempt
     * @returns {number|null}
     */
    #getRetryFromResponse(response, attempt) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
            const parsed = Number(retryAfter);
            if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000;
        }

        if (response.status === 429) return this.#exponentialBackoff(attempt, 5_000, 60_000);
        if (response.status === 503) return this.#exponentialBackoff(attempt, 10_000, 120_000);

        return null;
    }

    /**
     * @param {number} attempt
     * @param {number} baseMs
     * @param {number} maxMs
     * @returns {number}
     */
    #exponentialBackoff(attempt, baseMs, maxMs) {
        const exponential = baseMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * baseMs * 0.5;
        return Math.min(maxMs, exponential + jitter);
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    #sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    abort() {
        if (this.abortController !== null) {
            this.logger.debug("Aborting in-flight Gemini REST request.");
            this.abortController.abort();
            this.abortController = null;
        }
    }
}