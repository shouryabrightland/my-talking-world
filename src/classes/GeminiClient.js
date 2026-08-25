// @ts-check

/**
 * @file GeminiClient.js
 * Lightweight, Stateless Gemini 2.5 Flash REST Client.
 *
 * Responsibilities:
 * - Streams text generation via Gemini's streamGenerateContent REST API.
 * - Executes non-streaming REST text generation with 65K output token capacity.
 * - Circuit breaker protection prevents cascading failures.
 * - Handles HTTP 429/503 with Retry-After header respect.
 * - Extracts `<think>` reasoning chains from model responses.
 * - Converts standard ChatMessage[] to Gemini REST schema.
 */

/** @typedef {import("./lib/Logger").default} Logger */
/** @typedef {import("./PromptBuilder").ChatMessage} ChatMessage */
/** @typedef {import("./lib/PromptLogger").PromptType} PromptType */

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

/**
 * Event identifiers emitted by GeminiClient during streaming.
 * @readonly
 * @enum {string}
 */
export const GeminiClientEvents = {
    TEXT: "text",
    DONE: "done",
    ERROR: "error"
};

/**
 * @typedef {Object} GeminiResultText
 * @property {string} text Full generated text response.
 * @property {string} model Model ID used for the response.
 * @property {string|null} thinking Extracted thinking chain if present.
 * @property {Record<string, any>} [usage] Usage metadata metrics.
 */

/**
 * Shared circuit breaker across all GeminiClient instances.
 * @type {CircuitBreaker}
 */
const sharedCircuitBreaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 45_000,
    successThreshold: 1,
    onStateChange: (newState, oldState) => {
        console.log(`[GeminiClient] Circuit breaker: ${oldState} → ${newState}`);
    }
});

/**
 * Gemini 2.5 Flash REST Client with:
 * - Streaming SSE support via streamGenerateContent
 * - Thinking chain capture for debugging
 * - Circuit breaker for failure protection
 * - Retry-After header handling for 429/503
 * - Full 65K output token capacity
 */
export default class GeminiClient {

    /**
     * @param {Object} options
     * @param {Logger} options.logger Root parent logger.
     * @param {string} [options.defaultModel=DEFAULT_GEMINI_MODEL] Target Gemini Flash model.
     * @param {string|null} [options.apiKey=null] Optional explicit API key override.
     */
    constructor({
        logger,
        defaultModel = DEFAULT_GEMINI_MODEL,
        apiKey = null
    }) {
        if (!logger) throw new TypeError("GeminiClient requires a Logger instance.");

        /** @readonly @type {Logger} */ this.logger = logger.child("GeminiClient");
        /** @readonly @type {EventManager} */ this.events = new EventManager(this.logger);
        /** @readonly @type {string} */ this.defaultModel = defaultModel;
        /** @private @type {string|null} */ this._customApiKey = apiKey;

        /** @type {AbortController|null} */ this.abortController = null;
    }

    /** Dynamically resolves the active Gemini key. @returns {string} */
    get apiKey() {
        return this._customApiKey || getGeminiApiKey();
    }

    /** @returns {string} */
    get circuitState() {
        return sharedCircuitBreaker.state;
    }

    /**
     * Streams text generation via Gemini's streamGenerateContent REST API.
     * Returns a full accumulated response with thinking chain extraction.
     *
     * @param {ChatMessage[]} messages Array of standard role/content messages.
     * @param {Object} [options]
     * @param {number} [options.temperature=0.7]
     * @param {number} [options.maxOutputTokens=GEMINI_MAX_OUTPUT_TOKENS]
     * @param {string} [options.model]
     * @param {PromptType} [options.promptType="scheduler"]
     * @param {number} [options.maxRetries=2]
     * @returns {Promise<GeminiResultText>}
     */
    async streamGenerate(messages, {
        temperature = 0.7,
        maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS,
        model = this.defaultModel,
        promptType = "scheduler",
        maxRetries = 2
    } = {}) {
        this.abort();
        this.abortController = new AbortController();

        const startTime = Date.now();
        const activeKey = this.apiKey;

        if (!activeKey) {
            const error = new Error("Google AI Studio Gemini API key is missing. Please configure your key in Settings.");
            PromptLogger.record({
                type: promptType, model, startTime, requestMessages: messages,
                rawResponse: "", status: "error", error: error.message
            });
            throw error;
        }

        const requestBody = this.#buildRequestBody(messages, temperature, maxOutputTokens);

        try {
            return await sharedCircuitBreaker.execute(async () => {
                return await this.#streamWithRetry(requestBody, model, activeKey, startTime, messages, promptType, maxRetries);
            });
        } finally {
            this.abort();
        }
    }

    /**
     * Executes non-streaming REST text generation with 65K max output token capacity.
     * Used as fallback if streaming is unavailable.
     *
     * @param {ChatMessage[]} messages Array of standard role/content messages.
     * @param {Object} [options]
     * @param {number} [options.temperature=0.7]
     * @param {number} [options.maxOutputTokens=GEMINI_MAX_OUTPUT_TOKENS]
     * @param {string} [options.model]
     * @param {PromptType} [options.promptType="scheduler"]
     * @param {number} [options.maxRetries=2]
     * @returns {Promise<GeminiResultText>}
     */
    async generateText(messages, {
        temperature = 0.7,
        maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS,
        model = this.defaultModel,
        promptType = "scheduler",
        maxRetries = 2
    } = {}) {
        this.abort();
        this.abortController = new AbortController();

        const startTime = Date.now();
        const activeKey = this.apiKey;

        if (!activeKey) {
            const error = new Error("Google AI Studio Gemini API key is missing. Please configure your key in Settings.");
            PromptLogger.record({
                type: promptType, model, startTime, requestMessages: messages,
                rawResponse: "", status: "error", error: error.message
            });
            throw error;
        }

        const requestBody = this.#buildRequestBody(messages, temperature, maxOutputTokens);

        try {
            return await sharedCircuitBreaker.execute(async () => {
                return await this.#generateWithRetry(requestBody, model, activeKey, startTime, messages, promptType, maxRetries);
            });
        } finally {
            this.abort();
        }
    }

    // =========================================================================
    // PRIVATE: Streaming with retry
    // =========================================================================

    /**
     * @param {Record<string, unknown>} requestBody
     * @param {string} model
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

        while (attempts < maxAttempts) {
            attempts++;

            try {
                this.logger.debug(`Executing Gemini stream call on "${model}" (attempt ${attempts}/${maxAttempts})...`);

                const url = `${GEMINI_API_BASE_URL}/models/${model}:streamGenerateContent?alt=sse&key=${key}`;

                const response = await fetch(url, {
                    method: "POST",
                    signal: this.abortController?.signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody)
                });

                // Handle 429/503 with Retry-After
                if (response.status === 429 || response.status === 503) {
                    const retryMs = this.#getRetryFromResponse(response, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        this.logger.warn(`HTTP ${response.status} on "${model}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                        await this.#sleep(retryMs);
                        continue;
                    }
                }

                if (!response.ok) {
                    const errPayload = await response.json().catch(() => ({}));
                    const msg = errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`;
                    const error = new Error(msg);
                    error.status = response.status;
                    throw error;
                }

                if (!response.body) {
                    // Fallback to non-streaming
                    this.logger.warn("Gemini stream response has no body. Falling back to non-streaming...");
                    return await this.#generateWithRetry(requestBody, model, key, startTime, messages, promptType, 0);
                }

                const rawText = await this.#readSSEStream(response.body);
                const { cleanText, thinking } = ProtocolCodec.extractThinkingChain(rawText);

                PromptLogger.record({
                    type: promptType, model, startTime, requestMessages: messages,
                    rawResponse: rawText, thinkingChain: thinking, status: "success"
                });

                return { text: cleanText, model, thinking };

            } catch (err) {
                const castErr = /** @type {Error & {status?: number, message: string}} */ (err);
                lastError = castErr;
                if (castErr instanceof DOMException && castErr.name === "AbortError") throw castErr;

                const retryMs = this.#getRetryDelay(castErr, attempts);
                if (retryMs !== null && attempts < maxAttempts) {
                    this.logger.warn(`Retryable error on "${model}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                    await this.#sleep(retryMs);
                    continue;
                }

                break;
            }
        }

        PromptLogger.record({
            type: promptType, model, startTime, requestMessages: messages,
            rawResponse: "", status: "error", error: lastError?.message || "Gemini generation failed"
        });

        this.logger.error(`Gemini stream generation failed on "${model}":`, lastError?.message || lastError);
        throw lastError;
    }

    // =========================================================================
    // PRIVATE: Non-streaming with retry
    // =========================================================================

    /**
     * @param {Record<string, unknown>} requestBody
     * @param {string} model
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

        while (attempts < maxAttempts) {
            attempts++;

            try {
                this.logger.debug(`Executing Gemini REST call on "${model}" (attempt ${attempts}/${maxAttempts})...`);

                const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${key}`;

                const response = await fetch(url, {
                    method: "POST",
                    signal: this.abortController?.signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody)
                });

                // Handle 429/503 with Retry-After
                if (response.status === 429 || response.status === 503) {
                    const retryMs = this.#getRetryFromResponse(response, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        this.logger.warn(`HTTP ${response.status} on "${model}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                        await this.#sleep(retryMs);
                        continue;
                    }
                }

                if (!response.ok) {
                    const errPayload = await response.json().catch(() => ({}));
                    const msg = errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`;
                    const error = new Error(msg);
                    error.status = response.status;
                    throw error;
                }

                const data = await response.json();
                const candidates = data?.candidates || [];
                const parts = candidates[0]?.content?.parts || [];

                let rawText = "";
                for (const part of parts) {
                    if (part.text) rawText += part.text;
                }

                const { cleanText, thinking } = ProtocolCodec.extractThinkingChain(rawText);

                PromptLogger.record({
                    type: promptType, model, startTime, requestMessages: messages,
                    rawResponse: rawText, thinkingChain: thinking, status: "success"
                });

                return { text: cleanText, model, thinking, usage: data?.usageMetadata };

            } catch (err) {
                const castErr = /** @type {Error & {status?: number, message: string}} */ (err);
                lastError = castErr;
                if (castErr instanceof DOMException && castErr.name === "AbortError") throw castErr;

                const retryMs = this.#getRetryDelay(castErr, attempts);
                if (retryMs !== null && attempts < maxAttempts) {
                    this.logger.warn(`Retryable error on "${model}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                    await this.#sleep(retryMs);
                    continue;
                }

                break;
            }
        }

        PromptLogger.record({
            type: promptType, model, startTime, requestMessages: messages,
            rawResponse: "", status: "error", error: lastError?.message || "Gemini generation failed"
        });

        this.logger.error(`Gemini REST generation failed on "${model}":`, lastError?.message || lastError);
        throw lastError;
    }

    // =========================================================================
    // PRIVATE: SSE Stream reader
    // =========================================================================

    /**
     * Reads a Gemini SSE stream and accumulates the full text response.
     * @param {ReadableStream} body
     * @returns {Promise<string>}
     */
    async #readSSEStream(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullText = "";

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
                if (payload === "[DONE]") return fullText;

                try {
                    const parsed = JSON.parse(payload);
                    const candidates = parsed?.candidates || [];
                    const parts = candidates[0]?.content?.parts || [];
                    for (const part of parts) {
                        if (part.text) {
                            fullText += part.text;
                            this.events.emit(GeminiClientEvents.TEXT, part.text);
                        }
                    }
                } catch {
                    // Ignore non-JSON heartbeat lines
                }
            }
        }

        return fullText;
    }

    // =========================================================================
    // PRIVATE: Request body builder
    // =========================================================================

    /**
     * Converts standard ChatMessage[] to Gemini REST schema.
     * @param {ChatMessage[]} messages
     * @param {number} temperature
     * @param {number} maxOutputTokens
     * @returns {Record<string, unknown>}
     */
    #buildRequestBody(messages, temperature, maxOutputTokens) {
        const systemMessage = messages.find(m => m.role === "system");
        const conversationMessages = messages.filter(m => m.role !== "system");

        /** @type {Record<string, any>} */
        const body = {
            contents: conversationMessages.map(msg => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }]
            })),
            generationConfig: {
                temperature,
                maxOutputTokens
            }
        };

        if (systemMessage && systemMessage.content) {
            body.systemInstruction = {
                parts: [{ text: systemMessage.content }]
            };
        }

        return body;
    }

    // =========================================================================
    // PRIVATE: Retry helpers (identical logic to GroqClient)
    // =========================================================================

    /**
     * @param {Error & {status?: number, retryAfter?: string|null}} err
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

    /**
     * Aborts in-flight REST network fetch operations cleanly.
     * @returns {void}
     */
    abort() {
        if (this.abortController !== null) {
            this.logger.debug("Aborting in-flight Gemini REST request.");
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
