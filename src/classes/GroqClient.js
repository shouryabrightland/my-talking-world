// @ts-check

/**
 * @file GroqClient.js
 * Unified Groq REST & SSE Streaming Client.
 *
 * Responsibilities:
 * - Dynamically queries GroqModelPool (discovered via GET /models).
 * - Zero hardcoded model fallback chains.
 * - Streams chat completions via SSE with real-time token emission.
 * - Enforces shared rate limiting guided by real x-ratelimit-* headers.
 * - Circuit breaker protection prevents cascading failures.
 * - Handles HTTP 429/503 with exact server-timed cooldowns.
 */

/** @typedef {import("./lib/Logger").default} Logger */
/** @typedef {import("./PromptBuilder").ChatMessage} ChatMessage */
/** @typedef {import("./PromptBuilder").PromptPayload} PromptPayload */
/** @typedef {import("./lib/PromptLogger").PromptType} PromptType */

import { getApiKey, GROQ_API_BASE_URL } from "../util/Constants";
import EventManager from "./EventManager";
import PromptLogger from "./lib/PromptLogger";
import ProtocolCodec from "./ProtocolCodec";
import RateLimiter from "./lib/RateLimiter";
import CircuitBreaker from "./lib/CircuitBreaker";
import GroqModelPool, { parseGroqDurationMs } from "./lib/GroqModelPool";

export const GroqClientEvents = {
    CHUNK: "chunk",
    TEXT: "text",
    THINKING: "thinking",
    DONE: "done",
    ERROR: "error",
    COOLDOWN_ACTIVE: "cooldown_active"
};

/** @type {RateLimiter} */
const sharedRateLimiter = new RateLimiter({
    maxPerMinute: 10,
    minSpacingMs: 2500,
    maxConcurrent: 3
});

/** @type {CircuitBreaker} */
const sharedCircuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    successThreshold: 2,
    onStateChange: (newState, oldState) => {
        console.log(`[GroqClient] Circuit breaker: ${oldState} → ${newState}`);
    }
});

export default class GroqClient {

    /**
     * @param {Object} options
     * @param {Logger} options.logger Root parent logger.
     * @param {string|null} [options.apiKey=null] Optional explicit API key override.
     * @param {GroqModelPool|null} [options.modelPool=null] Dynamic model pool.
     */
    constructor({
        logger,
        apiKey = null,
        modelPool = null
    }) {
        if (!logger) throw new TypeError("GroqClient requires a Logger instance.");

        /** @readonly @type {Logger} */ this.logger = logger.child("GroqClient");
        /** @readonly @type {EventManager} */ this.events = new EventManager(this.logger);
        /** @private @type {string|null} */ this._customApiKey = apiKey;

        /** @readonly @type {GroqModelPool} Dynamic, self-healing model pool. */
        this.modelPool = modelPool || new GroqModelPool(this.logger);

        /** @type {AbortController|null} */ this.abortController = null;
        /** @type {boolean} */ this.isStreaming = false;
    }

    get apiKey() {
        return this._customApiKey || getApiKey();
    }

    get activeModel() {
        return this.modelPool.activeModelId || null;
    }

    async resolveModel() {
        if (this.modelPool) {
            try {
                const active = await this.modelPool.getActiveModel();
                if (active) return active;
            } catch (err) {
                this.logger.warn("Groq model pool resolution failed:", err);
            }
        }
        throw new Error("No Groq chat models (>=12B) discovered from API.");
    }

    get circuitState() {
        return sharedCircuitBreaker.state;
    }

    get rateLimitPauseRemainingMs() {
        return sharedRateLimiter.serverPauseRemaining;
    }

    get isCircuitOpen() {
        return sharedCircuitBreaker.state === "open";
    }

    async streamChat(messages, {
        temperature = 0.85,
        maxTokens = 1200,
        model = null,
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
                type: promptType, model: model || "unknown", startTime, requestMessages: messages,
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

    async generateText(messages, {
        temperature = 0.8,
        maxTokens = 2000,
        model = null,
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
                type: promptType, model: model || "unknown", startTime, requestMessages: messages,
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

                    this.events.emit(GroqClientEvents.DONE, cleanText);
                    return cleanText;
                } catch (err) {
                    const castErr = /** @type {Error & {status?: number, retryAfter?: string|null, message: string, rateLimitResetMs?: number|null}} */ (err);
                    lastError = castErr;
                    attemptError = castErr;

                    if (castErr instanceof DOMException && castErr.name === "AbortError") {
                        this.logger.debug("Active stream was cancelled by user action.");
                        this.isStreaming = false;
                        throw castErr;
                    }

                    this.modelPool.reportFailure(
                        targetModel,
                        typeof castErr.status === "number" ? castErr.status : null,
                        typeof castErr.rateLimitResetMs === "number" ? castErr.rateLimitResetMs : null
                    );
                    this.#emitCooldownIfExhausted();

                    const retryMs = this.#getRetryDelay(castErr, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        this.logger.warn(`HTTP ${castErr.status || '429'} on "${targetModel}". Retrying in ${Math.round(retryMs / 1000)}s...`);
                        await this.#sleep(retryMs);
                        continue;
                    }

                    this.logger.warn(`Model "${targetModel}" stream failed: ${castErr.message}. Cascading to next discovered model...`);
                    break;
                }
            }

            if (attemptError) {
                PromptLogger.record({
                    type: promptType, model: targetModel, startTime,
                    requestMessages: messages, rawResponse: "",
                    status: "error", error: attemptError.message || String(attemptError)
                });
            }
        }

        this.isStreaming = false;
        const lastErr = lastError || new Error("All streaming attempts failed across discovered Groq models.");
        this.events.emit(GroqClientEvents.ERROR, lastErr);
        throw lastErr;
    }

    #emitCooldownIfExhausted() {
        const pool = this.modelPool;
        if (typeof pool?.allModelsCooling !== "function") return;
        if (!pool.allModelsCooling()) return;

        const remainingMs = typeof pool.minCooldownRemaining === "function"
            ? pool.minCooldownRemaining()
            : null;

        this.logger.warn(`All discovered Groq models are cooling down — next attempt in ${remainingMs ?? "?"}ms.`);
        this.events.emit(GroqClientEvents.COOLDOWN_ACTIVE, { remainingMs });
    }

    async #generateWithFallback(messages, { temperature, maxTokens, model, jsonMode, activeKey, startTime, promptType, maxRetries }) {
        const candidateModels = await this.#resolveCandidateModels(model);
        let lastError = null;

        for (const targetModel of candidateModels) {
            let attempts = 0;
            const maxAttempts = 1 + maxRetries;

            while (attempts < maxAttempts) {
                attempts++;

                try {
                    this.logger.debug(`Executing REST call on "${targetModel}" (attempt ${attempts}/${maxAttempts})...`);

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

                    if (response.status === 429 || response.status === 503) {
                        const retryMs = this.#getRetryFromResponse(response, attempts);
                        if (retryMs !== null && attempts < maxAttempts) {
                            await this.#sleep(retryMs);
                            continue;
                        }
                    }

                    if (!response.ok) {
                        const errPayload = await response.json().catch(() => ({}));
                        const msg = errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`;
                        const error = /** @type {any} */ (new Error(msg));
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
                    const castErr = /** @type {any} */ (err);
                    lastError = castErr;
                    if (castErr instanceof DOMException && castErr.name === "AbortError") throw castErr;

                    this.modelPool.reportFailure(
                        targetModel,
                        typeof castErr.status === "number" ? castErr.status : null,
                        typeof castErr.rateLimitResetMs === "number" ? castErr.rateLimitResetMs : null
                    );
                    this.#emitCooldownIfExhausted();

                    const retryMs = this.#getRetryDelay(castErr, attempts);
                    if (retryMs !== null && attempts < maxAttempts) {
                        await this.#sleep(retryMs);
                        continue;
                    }

                    break;
                }
            }
        }

        PromptLogger.record({
            type: promptType, model: model || "unknown", startTime, requestMessages: messages,
            rawResponse: "", status: "error", error: lastError?.message || "Generation failed"
        });

        throw new Error(`All generation attempts failed across discovered Groq models. Last error: ${lastError?.message}`, { cause: lastError });
    }

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

        if (response.status === 429 || response.status === 503) {
            const rateInfo = this.#parseRateLimitHeaders(response);
            const error = /** @type {any} */ (new Error(`HTTP ${response.status} ${response.statusText}`));
            error.status = response.status;
            error.retryAfter = rateInfo.retryAfter;
            error.rateLimitResetMs = this.#exactRateLimitResetMs(response);
            throw error;
        }

        if (!response.ok) {
            const errPayload = await response.json().catch(() => ({}));
            const error = /** @type {any} */ (new Error(errPayload?.error?.message || `HTTP ${response.status} ${response.statusText}`));
            error.status = response.status;
            error.rateLimitResetMs = this.#exactRateLimitResetMs(response);
            throw error;
        }

        {
            const rateInfo = this.#parseRateLimitHeaders(response);
            const resetMs = this.modelPool.observeRateLimit(model, rateInfo);
            if (resetMs) sharedRateLimiter.syncServerLimit(Date.now() + resetMs);
        }

        if (!response.body) {
            throw new Error("Response body is empty. SSE streaming unsupported.");
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

                    const chunkFinish = parsed?.choices?.[0]?.finish_reason;
                    if (typeof chunkFinish === "string" && chunkFinish) {
                        finishReason = chunkFinish;
                    }
                    if (parsed?.usage && typeof parsed.usage === "object") {
                        usage = parsed.usage;
                    }
                } catch {
                    // Ignore non-JSON lines
                }
            }
        }

        return { text: fullText, usage, finishReason };
    }

    #getRetryDelay(err, attempt) {
        if (typeof err.rateLimitResetMs === "number" && err.rateLimitResetMs > 0) {
            return err.rateLimitResetMs;
        }

        if (err.retryAfter) {
            const parsed = Number(err.retryAfter);
            if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000;
        }

        if (err.status === 429) return this.#exponentialBackoff(attempt, 5_000, 60_000);
        if (err.status === 503) return this.#exponentialBackoff(attempt, 10_000, 120_000);
        if ([500, 502, 504].includes(err.status)) return this.#exponentialBackoff(attempt, 3_000, 30_000);
        if (!err.status && (err.name === "TypeError" || err.message?.includes("fetch"))) {
            return this.#exponentialBackoff(attempt, 2_000, 15_000);
        }

        return null;
    }

    #getRetryFromResponse(response, attempt) {
        const exact = this.#exactRateLimitResetMs(response);
        if (exact !== null && exact > 0) return exact;

        if (response.status === 429) return this.#exponentialBackoff(attempt, 5_000, 60_000);
        if (response.status === 503) return this.#exponentialBackoff(attempt, 10_000, 120_000);

        return null;
    }

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

    #exactRateLimitResetMs(response) {
        const info = this.#parseRateLimitHeaders(response);
        return (
            parseGroqDurationMs(info.retryAfter) ??
            parseGroqDurationMs(info.resetRequests) ??
            parseGroqDurationMs(info.resetTokens)
        );
    }

    #exponentialBackoff(attempt, baseMs, maxMs) {
        const exponential = baseMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * baseMs * 0.5;
        return Math.min(maxMs, exponential + jitter);
    }

    /**
     * Resolves candidates strictly from the dynamic pool discovered from the API.
     * @param {string|null} [primary=null]
     * @returns {Promise<string[]>}
     */
    async #resolveCandidateModels(primary = null) {
        /** @type {string[]} */
        let poolIds = [];

        try {
            const candidates = await this.modelPool.getCandidates();
            poolIds = candidates.map(c => c.id);
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Groq model pool discovery failed:", err);
        }

        if (poolIds.length === 0) {
            throw new Error("No Groq chat models available. Failed to discover models (>=12B) from API.");
        }

        const chain = primary ? [primary, ...poolIds] : poolIds;
        const deduped = chain.filter((m, i, arr) => arr.indexOf(m) === i);

        return deduped.filter(id => !this.modelPool.isEjected(id));
    }

    abort() {
        if (this.abortController !== null) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.isStreaming = false;
    }

    #sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}