// @ts-check

/**
 * @file GroqClient.js
 * Unified Groq REST & SSE Streaming Client.
 *
 * Responsibilities:
 * - Streams chat completions via SSE with real-time token emission.
 * - Executes non-streaming REST text generation with prompt logging.
 * - Implements a dynamic model fallback chain backed by GroqModelPool
 *   (discovered from GET /models; static chain only as last-resort seed).
 * - Enforces shared rate limiting guided by real x-ratelimit-* headers.
 * - Circuit breaker protection prevents cascading failures.
 * - Handles HTTP 429/503 with Retry-After header respect.
 * - Extracts `<think>` reasoning chains from model responses.
 * - Resilient JSON extraction from model output.
 */

/** @typedef {import("./lib/Logger").default} Logger */
/** @typedef {import("./PromptBuilder").ChatMessage} ChatMessage */
/** @typedef {import("./PromptBuilder").PromptPayload} PromptPayload */
/** @typedef {import("./lib/PromptLogger").PromptType} PromptType */

import {
    getApiKey,
    GROQ_API_BASE_URL,
    DEFAULT_CHAT_MODEL,
    CHAT_MODEL_FALLBACK_CHAIN
} from "../util/Constants";
import EventManager from "./EventManager";
import PromptLogger from "./lib/PromptLogger";
import ProtocolCodec from "./ProtocolCodec";
import RateLimiter from "./lib/RateLimiter";
import CircuitBreaker from "./lib/CircuitBreaker";
import GroqModelPool, { parseGroqDurationMs } from "./lib/GroqModelPool";

/**
 * Event identifiers emitted by GroqClient during streaming.
 * @readonly
 * @enum {string}
 */
export const GroqClientEvents = {
    CHUNK: "chunk",
    TEXT: "text",
    THINKING: "thinking",
    DONE: "done",
    ERROR: "error"
};

/**
 * @typedef {Object} GroqResultText
 * @property {string} text Full generated text response.
 * @property {string} model Model ID used for the response.
 * @property {string|null} thinking Extracted thinking chain.
 * @property {Record<string, any>} [usage] Usage metrics.
 */

/**
 * @typedef {Object} GroqResultJSON
 * @property {any} output Parsed JSON object.
 * @property {string} rawText Unparsed response string.
 * @property {string} model Model ID used.
 * @property {string|null} thinking Extracted thinking chain.
 */

/**
 * Shared rate limiter across all GroqClient instances.
 * @type {RateLimiter}
 */
const sharedRateLimiter = new RateLimiter({
    maxPerMinute: 10,
    minSpacingMs: 2500,
    maxConcurrent: 3
});

/**
 * Shared circuit breaker across all GroqClient instances.
 * @type {CircuitBreaker}
 */
const sharedCircuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    successThreshold: 2,
    onStateChange: (newState, oldState) => {
        console.log(`[GroqClient] Circuit breaker: ${oldState} → ${newState}`);
    }
});

/**
 * Unified Groq REST & SSE Streaming Client with:
 * - Shared rate limiting across instances
 * - Circuit breaker for cascading failure protection
 * - Retry-After header handling for HTTP 429/503
 * - Model fallback chain
 * - Thinking chain extraction
 */
export default class GroqClient {

    /**
     * @param {Object} options
     * @param {Logger} options.logger Root parent logger.
     * @param {string} [options.defaultModel=DEFAULT_CHAT_MODEL] Preferred primary model.
     * @param {string|null} [options.apiKey=null] Optional explicit API key override.
     * @param {GroqModelPool|null} [options.modelPool=null] Dynamic model pool (created when omitted).
     */
    constructor({
        logger,
        defaultModel = DEFAULT_CHAT_MODEL,
        apiKey = null,
        modelPool = null
    }) {
        if (!logger) throw new TypeError("GroqClient requires a Logger instance.");

        /** @readonly @type {Logger} */ this.logger = logger.child("GroqClient");
        /** @readonly @type {EventManager} */ this.events = new EventManager(this.logger);
        /** @readonly @type {string} */ this.defaultModel = defaultModel;
        /** @private @type {string|null} */ this._customApiKey = apiKey;

        /** @readonly @type {GroqModelPool} Dynamic, self-healing fallback pool. */
        this.modelPool = modelPool || new GroqModelPool(this.logger);

        /** @type {AbortController|null} */ this.abortController = null;
        /** @type {boolean} */ this.isStreaming = false;
    }

    /** Dynamically resolves the API key on every request. @returns {string} */
    get apiKey() {
        return this._customApiKey || getApiKey();
    }

    /**
     * Most recently resolved active dialogue model from the dynamic pool,
     * falling back to the configured default before the first discovery round.
     * @returns {string}
     */
    get activeModel() {
        return this.modelPool.activeModelId || this.defaultModel;
    }

    /** @returns {string} */
    get circuitState() {
        return sharedCircuitBreaker.state;
    }

    /**
     * Streams a chat completion via SSE, capturing thinking chains and logging to PromptLogger.
     * Includes Retry-After handling for 429/503 responses.
     *
     * @param {ChatMessage[]} messages
     * @param {Object} [options]
     * @param {number} [options.temperature=0.85]
     * @param {number} [options.maxTokens=1500]
     * @param {string} [options.model]
     * @param {PromptType} [options.promptType="dialogue"]
     * @param {number} [options.maxRetries=2] Additional retry attempts on 429/503.
     * @returns {Promise<string>}
     */
    async streamChat(messages, {
        temperature = 0.85,
        maxTokens = 1500,
        model = this.defaultModel,
        promptType = "dialogue",
        maxRetries = 2
    } = {}) {
        this.abort();
        this.abortController = new AbortController();
        this.isStreaming = true;

        const startTime = Date.now();
        const activeKey = this.apiKey;

        if (!activeKey) {
            const error = new Error("Groq API key is missing. Please configure your key in Settings.");
            this.events.emit(GroqClientEvents.ERROR, error);
            this.isStreaming = false;
            PromptLogger.record({
                type: promptType, model, startTime, requestMessages: messages,
                rawResponse: "", status: "error", error: error.message
            });
            throw error;
        }

        const release = await sharedRateLimiter.acquire(this.logger.warn.bind(this.logger));

        try {
            return await sharedCircuitBreaker.execute(async () => {
                return await this.#streamWithFallback(messages, {
                    temperature, maxTokens, model, activeKey, startTime,
                    promptType, maxRetries
                });
            });
        } finally {
            this.isStreaming = false;
            release();
        }
    }

    /**
     * Executes non-streaming REST text generation with prompt logging.
     * Includes Retry-After handling for 429/503 responses.
     *
     * @param {ChatMessage[]} messages
     * @param {Object} [options]
     * @param {number} [options.temperature=0.8]
     * @param {number} [options.maxTokens=2000]
     * @param {string} [options.model]
     * @param {boolean} [options.jsonMode=false]
     * @param {PromptType} [options.promptType="scheduler"]
     * @param {number} [options.maxRetries=2]
     * @returns {Promise<GroqResultText>}
     */
    async generateText(messages, {
        temperature = 0.8,
        maxTokens = 2000,
        model = this.defaultModel,
        jsonMode = false,
        promptType = "scheduler",
        maxRetries = 2
    } = {}) {
        this.abort();
        this.abortController = new AbortController();

        const startTime = Date.now();
        const activeKey = this.apiKey;

        if (!activeKey) {
            const error = new Error("Groq API key is missing. Please configure your key in Settings.");
            PromptLogger.record({
                type: promptType, model, startTime, requestMessages: messages,
                rawResponse: "", status: "error", error: error.message
            });
            throw error;
        }

        const release = await sharedRateLimiter.acquire(this.logger.warn.bind(this.logger));

        try {
            return await sharedCircuitBreaker.execute(async () => {
                return await this.#generateWithFallback(messages, {
                    temperature, maxTokens, model, jsonMode, activeKey,
                    startTime, promptType, maxRetries
                });
            });
        } finally {
            release();
        }
    }

    /**
     * Executes single-shot JSON generation with automatic structured parsing.
     *
     * @param {ChatMessage[]} messages
     * @param {Object} [options]
     * @param {number} [options.temperature=0.7]
     * @param {string} [options.model]
     * @param {PromptType} [options.promptType="scheduler"]
     * @returns {Promise<GroqResultJSON>}
     */
    async generateJSON(messages, {
        temperature = 0.7,
        model = this.defaultModel,
        promptType = "scheduler"
    } = {}) {
        const rawResult = await this.generateText(messages, {
            temperature, model, jsonMode: true, promptType
        });

        return {
            output: this.#extractJSON(rawResult.text),
            rawText: rawResult.text,
            model: rawResult.model,
            thinking: rawResult.thinking
        };
    }

    // =========================================================================
    // PRIVATE: Streaming with model fallback
    // =========================================================================

    /**
     * @param {ChatMessage[]} messages
     * @param {{ temperature: number, maxTokens: number, model: string, activeKey: string, startTime: number, promptType: PromptType, maxRetries: number }} opts
     * @returns {Promise<string>}
     */
    async #streamWithFallback(messages, { temperature, maxTokens, model, activeKey, startTime, promptType, maxRetries }) {
        const candidateModels = await this.#resolveCandidateModels(model);
        let lastError = null;

        for (const targetModel of candidateModels) {
            let attempts = 0;
            const maxAttempts = 1 + maxRetries;
            /** @type {(Error & {status?: number, retryAfter?: string|null, message: string})|null} */
            let attemptError = null;

            while (attempts < maxAttempts) {
                attempts++;

                try {
                    this.logger.debug(`Initiating SSE stream using model: "${targetModel}" (attempt ${attempts}/${maxAttempts})...`);

                    const streamResult = await this.#executeStream(targetModel, messages, temperature, maxTokens, activeKey);
                    this.isStreaming = false;

                    this.modelPool.reportSuccess(targetModel);

                    const { cleanText, thinking } = ProtocolCodec.extractThinkingChain(streamResult.text);

                    PromptLogger.record({
                        type: promptType, model: targetModel, startTime,
                        requestMessages: messages, rawResponse: streamResult.text,
                        thinkingChain: thinking, status: "success",
                        tokensIn: streamResult.usage?.prompt_tokens ?? null,
                        tokensOut: streamResult.usage?.completion_tokens ?? null,
                        finishReason: streamResult.finishReason
                    });

                    this.modelPool.reportSuccess(targetModel);
                    this.events.emit(GroqClientEvents.DONE, cleanText);
                    return cleanText;
                } catch (err) {
                    const castErr = /** @type {Error & {status?: number, retryAfter?: string|null, message: string}} */ (err);
                    lastError = castErr;
                    attemptError = castErr;

                    if (castErr instanceof DOMException && castErr.name === "AbortError") {
                        this.logger.debug("Active stream was cancelled by user action.");
                        this.isStreaming = false;
                        throw castErr;
                    }

                    // Feed REAL server reset timings into the dynamic pool so
                    // 429/503 cool down for the exact window Groq specified.
                    this.modelPool.reportFailure(
                        targetModel,
                        typeof castErr.status === "number" ? castErr.status : null,
                        typeof castErr.rateLimitResetMs === "number" ? castErr.rateLimitResetMs : null
                    );

                    // Handle 429/503 with Retry-After
                    const retryMs = this.#getRetryDelay(castErr, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        this.logger.warn(`HTTP ${castErr.status || '429'} on "${targetModel}". Retrying in ${Math.round(retryMs / 1000)}s (attempt ${attempts}/${maxAttempts})...`);
                        await this.#sleep(retryMs);
                        continue;
                    }

                    // No retry possible, try next model
                    this.logger.warn(`Model "${targetModel}" stream failed: ${castErr.message}. Cascading down fallback chain...`);
                    break;
                }
            }

            // Record an explicit PromptLogger card for THIS model's failure so
            // the inspector never pairs the first model's name with the last
            // model's error.
            if (attemptError) {
                PromptLogger.record({
                    type: promptType, model: targetModel, startTime,
                    requestMessages: messages, rawResponse: "",
                    status: "error", error: attemptError.message || String(attemptError)
                });
            }
        }

        this.isStreaming = false;

        const lastErr = lastError || new Error("All streaming fallback attempts failed.");

        this.events.emit(GroqClientEvents.ERROR, lastErr);
        throw new Error(`All streaming fallback attempts failed. Last error: ${lastErr?.message}`, { cause: lastErr });
    }

    // =========================================================================
    // PRIVATE: REST generation with model fallback
    // =========================================================================

    /**
     * @param {ChatMessage[]} messages
     * @param {{ temperature: number, maxTokens: number, model: string, jsonMode: boolean, activeKey: string, startTime: number, promptType: PromptType, maxRetries: number }} opts
     * @returns {Promise<GroqResultText>}
     */
    async #generateWithFallback(messages, { temperature, maxTokens, model, jsonMode, activeKey, startTime, promptType, maxRetries }) {
        const candidateModels = await this.#resolveCandidateModels(model);
        let lastError = null;

        for (const targetModel of candidateModels) {
            let attempts = 0;
            const maxAttempts = 1 + maxRetries;

            while (attempts < maxAttempts) {
                attempts++;

                try {
                    this.logger.debug(`Executing REST call on "${targetModel}" (JSON: ${jsonMode}, attempt ${attempts}/${maxAttempts})...`);

                    /** @type {Record<string, any>} */
                    const body = {
                        model: targetModel, messages, temperature,
                        max_tokens: maxTokens, stream: false
                    };

                    if (jsonMode) {
                        body.response_format = { type: "json_object" };
                    }

                    const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
                        method: "POST",
                        signal: this.abortController?.signal,
                        headers: {
                            "Authorization": `Bearer ${activeKey}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(body)
                    });

                    // Handle 429/503 with Retry-After
                    if (response.status === 429 || response.status === 503) {
                        const retryMs = this.#getRetryFromResponse(response, attempts);
                        if (retryMs !== null && attempts < maxAttempts) {
                            this.logger.warn(`HTTP ${response.status} on "${targetModel}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                            await this.#sleep(retryMs);
                            continue;
                        }
                    }

                    if (!response.ok) {
                        const errPayload = await response.json().catch(() => ({}));
                        const msg = errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`;
                        const error = new Error(msg);
                        error.status = response.status;
                        error.rateLimitResetMs = this.#exactRateLimitResetMs(response);
                        throw error;
                    }

                    const rateInfo = this.#parseRateLimitHeaders(response);
                    const resetMs = this.modelPool.observeRateLimit(targetModel, rateInfo);
                    if (resetMs) sharedRateLimiter.syncServerLimit(Date.now() + resetMs);

                    const data = await response.json();
                    const rawText = data?.choices?.[0]?.message?.content ?? "";
                    const { cleanText, thinking } = ProtocolCodec.extractThinkingChain(rawText);

                    PromptLogger.record({
                        type: promptType, model: targetModel, startTime,
                        requestMessages: messages, rawResponse: rawText,
                        thinkingChain: thinking, status: "success"
                    });

                    return { text: cleanText, model: targetModel, thinking, usage: data?.usage };
                } catch (err) {
                    const castErr = /** @type {Error & {status?: number, rateLimitResetMs?: number|null, message: string}} */ (err);
                    lastError = castErr;
                    if (castErr instanceof DOMException && castErr.name === "AbortError") throw castErr;

                    // Feed REAL server reset timings into the dynamic pool.
                    this.modelPool.reportFailure(
                        targetModel,
                        typeof castErr.status === "number" ? castErr.status : null,
                        typeof castErr.rateLimitResetMs === "number" ? castErr.rateLimitResetMs : null
                    );

                    // Handle retryable errors
                    const retryMs = this.#getRetryDelay(castErr, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        this.logger.warn(`Retryable error on "${targetModel}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                        await this.#sleep(retryMs);
                        continue;
                    }

                    this.logger.warn(`Model "${targetModel}" request failed: ${castErr.message}. Cascading down fallback chain...`);
                    break;
                }
            }
        }

        PromptLogger.record({
            type: promptType, model, startTime, requestMessages: messages,
            rawResponse: "", status: "error", error: lastError?.message || "Generation failed"
        });

        throw new Error(`All generation attempts failed. Last error: ${lastError?.message}`, { cause: lastError });
    }

    // =========================================================================
    // PRIVATE: SSE stream reader
    // =========================================================================

    /**
     * Internal SSE stream reader separating thinking tokens from text tokens.
     * Captures `usage` (with include_usage) and `finish_reason` from the stream.
     * @param {string} model
     * @param {ChatMessage[]} messages
     * @param {number} temperature
     * @param {number} maxTokens
     * @param {string} key
     * @returns {Promise<{ text: string, usage: { prompt_tokens?: number, completion_tokens?: number }|null, finishReason: string|null }>}
     */
    async #executeStream(model, messages, temperature, maxTokens, key) {
        const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
            method: "POST",
            signal: this.abortController?.signal,
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model, messages, temperature, max_tokens: maxTokens, stream: true,
                stream_options: { include_usage: true }
            })
        });

        // Handle 429/503 by throwing a typed error carrying the EXACT server
        // reset timing from the real rate-limit headers.
        if (response.status === 429 || response.status === 503) {
            const rateInfo = this.#parseRateLimitHeaders(response);
            const error = new Error(`HTTP ${response.status} ${response.statusText}`);
            error.status = response.status;
            error.retryAfter = rateInfo.retryAfter;
            error.rateLimitResetMs = this.#exactRateLimitResetMs(response);
            throw error;
        }

        if (!response.ok) {
            const errPayload = await response.json().catch(() => ({}));
            const error = new Error(errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`);
            error.status = response.status;
            error.rateLimitResetMs = this.#exactRateLimitResetMs(response);
            throw error;
        }

        // Track the live rate-limit window so pauses use exact server timings.
        {
            const rateInfo = this.#parseRateLimitHeaders(response);
            const resetMs = this.modelPool.observeRateLimit(model, rateInfo);
            if (resetMs) sharedRateLimiter.syncServerLimit(Date.now() + resetMs);
        }

        if (!response.body) {
            throw new Error("Response body is empty. SSE streaming unsupported by environment.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullText = "";
        /** @type {{ prompt_tokens?: number, completion_tokens?: number }|null} */
        let usage = null;
        /** @type {string|null} */
        let finishReason = null;

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
                if (payload === "[DONE]") return { text: fullText, usage, finishReason };

                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed?.choices?.[0]?.delta?.content || "";
                    if (delta) {
                        fullText += delta;
                        this.events.emit(GroqClientEvents.TEXT, delta);
                    }

                    // Capture terminal metrics from the final SSE chunks.
                    const chunkFinish = parsed?.choices?.[0]?.finish_reason;
                    if (typeof chunkFinish === "string" && chunkFinish) {
                        finishReason = chunkFinish;
                    }
                    if (parsed?.usage && typeof parsed.usage === "object") {
                        usage = parsed.usage;
                    }
                } catch {
                    // Ignore non-JSON heartbeat lines
                }
            }
        }

        return { text: fullText, usage, finishReason };
    }

    // =========================================================================
    // PRIVATE: Retry-After / backoff helpers
    // =========================================================================

    /**
     * Calculates retry delay from an error's Retry-After header or HTTP status.
     * Returns null if the error should not be retried.
     * @param {any} err
     * @param {number} attempt
     * @returns {number|null} Delay in ms, or null if no retry.
     */
    #getRetryDelay(err, attempt) {
        // Exact server reset timing from the real rate-limit headers
        // (x-ratelimit-reset-requests / x-ratelimit-reset-tokens / retry-after).
        if (typeof err.rateLimitResetMs === "number" && err.rateLimitResetMs > 0) {
            return err.rateLimitResetMs;
        }

        // Check for Retry-After header (set during fetch)
        if (err.retryAfter) {
            const parsed = Number(err.retryAfter);
            if (!Number.isNaN(parsed) && parsed > 0) {
                return parsed * 1000; // Seconds to ms
            }
            // Try parsing as HTTP-date (fallback to exponential backoff)
        }

        // 429 Too Many Requests → always retry with exponential backoff
        if (err.status === 429) {
            return this.#exponentialBackoff(attempt, 5_000, 60_000);
        }

        // 503 Service Unavailable → retry with longer backoff
        if (err.status === 503) {
            return this.#exponentialBackoff(attempt, 10_000, 120_000);
        }

        // 500/502/504 → retry with standard backoff (transient server errors)
        if ([500, 502, 504].includes(err.status)) {
            return this.#exponentialBackoff(attempt, 3_000, 30_000);
        }

        // Network errors (no status) → retry
        if (!err.status && (err.name === "TypeError" || err.message?.includes("fetch"))) {
            return this.#exponentialBackoff(attempt, 2_000, 15_000);
        }

        // AbortError, 400, 401, 403, 404 → do not retry
        return null;
    }

    /**
     * Extracts Retry-After from a Response object.
     * @param {Response} response
     * @param {number} attempt
     * @returns {number|null}
     */
    #getRetryFromResponse(response, attempt) {
        // Prefer the EXACT server-specified reset window over blind backoff.
        const exact = this.#exactRateLimitResetMs(response);
        if (exact !== null && exact > 0) {
            return exact;
        }

        if (response.status === 429) {
            return this.#exponentialBackoff(attempt, 5_000, 60_000);
        }
        if (response.status === 503) {
            return this.#exponentialBackoff(attempt, 10_000, 120_000);
        }

        return null;
    }

    /**
     * Extracts Groq's real rate-limit headers from a response.
     * @param {Response} response
     * @returns {{ remainingRequests: string|null, resetRequests: string|null, remainingTokens: string|null, resetTokens: string|null, retryAfter: string|null }}
     */
    #parseRateLimitHeaders(response) {
        const headers = response.headers;
        return {
            remainingRequests: headers.get("x-ratelimit-remaining-requests"),
            resetRequests: headers.get("x-ratelimit-reset-requests"),
            remainingTokens: headers.get("x-ratelimit-remaining-tokens"),
            resetTokens: headers.get("x-ratelimit-reset-tokens"),
            retryAfter: headers.get("retry-after")
        };
    }

    /**
     * Computes the exact server-specified reset delay in ms.
     * Priority: retry-after → x-ratelimit-reset-requests → x-ratelimit-reset-tokens.
     * @param {Response} response
     * @returns {number|null} Delay in ms, or null when the server sent no usable timing.
     */
    #exactRateLimitResetMs(response) {
        const info = this.#parseRateLimitHeaders(response);
        return (
            parseGroqDurationMs(info.retryAfter) ??
            parseGroqDurationMs(info.resetRequests) ??
            parseGroqDurationMs(info.resetTokens)
        );
    }

    /**
     * Calculates exponential backoff with jitter, capped at maxMs.
     * @param {number} attempt Current attempt number (1-based).
     * @param {number} baseMs Base delay in ms.
     * @param {number} maxMs Maximum delay cap.
     * @returns {number}
     */
    #exponentialBackoff(attempt, baseMs, maxMs) {
        const exponential = baseMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * baseMs * 0.5;
        return Math.min(maxMs, exponential + jitter);
    }

    // =========================================================================
    // PRIVATE: Helpers
    // =========================================================================

    /**
     * Resolves unique model candidates for a request: the explicit primary
     * first, then the dynamic GroqModelPool ladder (discovered, filtered, and
     * tier-ranked from GET /models). The static CHAT_MODEL_FALLBACK_CHAIN is
     * only used as a last-resort seed when discovery yields nothing.
     *
     * @param {string} primary Preferred primary model.
     * @returns {Promise<string[]>}
     */
    async #resolveCandidateModels(primary) {
        /** @type {string[]} */
        let poolIds = [];

        try {
            const candidates = await this.modelPool.getCandidates();
            poolIds = candidates.map(c => c.id);
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Groq model pool discovery failed:", err);
        }

        const seed = poolIds.length > 0 ? poolIds : [...CHAT_MODEL_FALLBACK_CHAIN];
        const chain = [primary, ...seed].filter((m, i, arr) => arr.indexOf(m) === i);

        // Session-permanently-ejected models (400/404) must never be retried.
        return chain.filter(id => !this.modelPool.isEjected(id));
    }

    /**
     * Resilient JSON extractor.
     * @param {string} text
     * @returns {any}
     */
    #extractJSON(text) {
        if (!text || typeof text !== "string") {
            throw new Error("Cannot parse JSON: input text is empty.");
        }

        const clean = text.trim();

        try { return JSON.parse(clean); } catch {}

        const codeMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeMatch && codeMatch[1]) {
            try { return JSON.parse(codeMatch[1].trim()); } catch {}
        }

        const firstBrace = clean.indexOf("{");
        const lastBrace = clean.lastIndexOf("}");
        const firstBracket = clean.indexOf("[");
        const lastBracket = clean.lastIndexOf("]");

        let candidate = "";
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            candidate = clean.slice(firstBrace, lastBrace + 1);
        } else if (firstBracket !== -1 && lastBracket > firstBracket) {
            candidate = clean.slice(firstBracket, lastBracket + 1);
        }

        if (candidate) {
            try { return JSON.parse(candidate); } catch {
                const sanitized = candidate
                    .replace(/,\s*([}\]])/g, "$1")
                    .replace(/[\u201C\u201D]/g, '"');
                return JSON.parse(sanitized);
            }
        }

        throw new Error("Failed to extract valid JSON payload from model response.");
    }

    /**
     * Aborts in-flight operations cleanly.
     * @returns {void}
     */
    abort() {
        if (this.abortController !== null) {
            this.logger.debug("Aborting in-flight Groq fetch operation.");
            this.abortController.abort();
            this.abortController = null;
        }
        this.isStreaming = false;
    }

    /**
     * Promise-based sleep.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    #sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}
