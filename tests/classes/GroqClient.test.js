// @ts-check

/**
 * @file GroqClient.test.js
 * Verifies TASK 5 transparency requirements:
 * - stream_options.include_usage + tokensIn/tokensOut/finishReason capture
 * - a PromptLogger error card per failed model attempt (correct model + error)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/mocks/server.js";
import GroqClient from "../../src/classes/GroqClient.js";
import PromptLogger from "../../src/classes/lib/PromptLogger.js";
import { setApiKey, clearApiKey } from "../../src/util/apiKeys.js";

const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

function makeFakeLogger() {
    return {
        info() {}, warn() {}, error() {}, debug() {},
        child() { return this; }
    };
}

/**
 * Builds an SSE ReadableStream for chat completion chunks.
 * @param {object[]} chunks
 * @returns {ReadableStream<Uint8Array>}
 */
function sseBody(chunks) {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i < chunks.length) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[i])}\n\n`));
                i++;
            } else {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            }
        }
    });
}

describe("GroqClient — streaming metrics & per-attempt logging", () => {
    beforeEach(() => {
        PromptLogger.clear();
        setApiKey("gsk_test_metrics_key");
    });

    it("requests include_usage and records tokensIn/tokensOut/finishReason", async () => {
        /** @type {any} */
        let capturedBody = null;

        server.use(http.post(CHAT_URL, async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(sseBody([
                { choices: [{ delta: { content: "Arre yaar " } }] },
                { choices: [{ delta: { content: "chai peete hain!" } , finish_reason: "stop" }] },
                { choices: [], usage: { prompt_tokens: 120, completion_tokens: 45 } }
            ]), { headers: { "Content-Type": "text/event-stream" } });
        }));

        const client = new GroqClient({ logger: makeFakeLogger(), defaultModel: "openai/gpt-oss-120b" });
        const text = await client.streamChat([{ role: "user", content: "hello" }], { maxTokens: 100 });

        expect(text).toBe("Arre yaar chai peete hain!");
        expect(capturedBody).toBeTruthy();
        expect(capturedBody.stream_options).toEqual({ include_usage: true });
        expect(capturedBody.stream).toBe(true);

        const entries = PromptLogger.getLogsForType("dialogue");
        expect(entries).toHaveLength(1);
        expect(entries[0].status).toBe("success");
        expect(entries[0].tokensIn).toBe(120);
        expect(entries[0].tokensOut).toBe(45);
        expect(entries[0].finishReason).toBe("stop");
    });

    it("records a PromptLogger card for EACH failed model with its own name and error", async () => {
        server.use(http.post(CHAT_URL, async ({ request }) => {
            // Fail the primary model with 404; succeed on fallback models.
            {
                const parsed = await request.clone().json();
                if (parsed.model === "openai/gpt-oss-120b") {
                    return HttpResponse.json(
                        { error: { message: "Model does not exist" } },
                        { status: 404 }
                    );
                }
                return new HttpResponse(sseBody([
                    { choices: [{ delta: { content: "fallback reply" }, finish_reason: "stop" }] },
                    { choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } }
                ]), { headers: { "Content-Type": "text/event-stream" } });
            }
        }));

        const client = new GroqClient({ logger: makeFakeLogger() });
        // Pin the primary model so the 404 → cascade path is deterministic
        // (GroqClient has no defaultModel fallback; the pool ladder ranks
        // other models first).
        const text = await client.streamChat(
            [{ role: "user", content: "hello" }],
            { maxRetries: 0, model: "openai/gpt-oss-120b" }
        );

        expect(text).toBe("fallback reply");

        const entries = PromptLogger.getLogsForType("dialogue");
        const errorEntry = entries.find(e => e.status === "error");
        const successEntry = entries.find(e => e.status === "success");

        // The failed attempt is attributed to the model that ACTUALLY failed.
        expect(errorEntry).toBeDefined();
        expect(errorEntry?.model).toBe("openai/gpt-oss-120b");
        expect(errorEntry?.error).toContain("does not exist");

        // The success card names the fallback model that served the response —
        // the >=12B pool ladder falls through to the tier-1 flagship next.
        expect(successEntry).toBeDefined();
        expect(successEntry?.model).toBe("llama-3.3-70b-versatile");
        expect(successEntry?.tokensOut).toBe(10);
    });

    it("clears API key state after tests", () => {
        clearApiKey();
        expect(true).toBe(true);
    });
});

describe("GroqModelPool — dynamic filtering & tiered ranking", () => {
    it("filters safeguard & audio models and ranks text chat models by tier", async () => {
        const { normalizeGroqModels, prioritizeGroqModels } = await import("../../src/classes/lib/GroqModelPool.js");

        const raw = [
            { id: "llama-prompt-guard-2-8b" },
            { id: "llama-guard-4" },
            { id: "whisper-large-v3" },
            { id: "orpheus-tts" },
            { id: "text-embedding-v3" },
            { id: "llama-3.2-11b-vision-preview" },
            { id: "llama-3.1-8b-instant" },
            { id: "llama-3.2-3b-preview" },
            { id: "llama-3.3-70b-versatile" },
            { id: "openai/gpt-oss-120b" },
            { id: "qwen/qwen3.6-27b" },
            { id: "mixtral-8x7b-32768" }
        ];

        const ranked = prioritizeGroqModels(normalizeGroqModels(raw)).map(e => e.id);

        // Safeguard / non-text models crash chat calls with 400 — never listed.
        // The >=12B restriction additionally drops sub-12B models (8b, 3b,
        // instant) — only 4 of the 12 raw ids survive.
        expect(ranked).toHaveLength(4);
        expect(ranked).toEqual([
            "openai/gpt-oss-120b",
            "llama-3.3-70b-versatile",
            "qwen/qwen3.6-27b",
            "mixtral-8x7b-32768"
        ]);
        for (const bad of [
            "llama-prompt-guard-2-8b",
            "llama-guard-4",
            "whisper-large-v3",
            "orpheus-tts",
            "text-embedding-v3",
            "llama-3.2-11b-vision-preview",
            "llama-3.1-8b-instant",
            "llama-3.2-3b-preview"
        ]) {
            expect(ranked).not.toContain(bad);
        }

        // Tier 1 (>=70B flagship) leads, Tier 2 (20-70B) next, Tier 3 (MoE) last.
        expect(ranked.indexOf("openai/gpt-oss-120b")).toBe(0);
        expect(ranked.indexOf("llama-3.3-70b-versatile")).toBe(1);
        expect(ranked.indexOf("qwen/qwen3.6-27b")).toBeLessThan(ranked.indexOf("mixtral-8x7b-32768"));
        // Tier 3 (other text chat models) sorts last.
        expect(ranked[ranked.length - 1]).toBe("mixtral-8x7b-32768");
    });

    it("discovers filtered, tier-ranked candidates from GET /models end-to-end", async () => {
        setApiKey("gsk_test_pool_discovery_key");

        try {
            const client = new GroqClient({ logger: makeFakeLogger() });
            const candidates = await client.modelPool.getCandidates();
            const ids = candidates.map(c => c.id);

            // Chat models present, non-chat models filtered out.
            expect(ids).toContain("llama-3.3-70b-versatile");
            expect(ids).toContain("mixtral-8x7b-32768");
            expect(ids.some(id => /guard|whisper|orpheus|embedding/.test(id))).toBe(false);

            // The >=12B restriction drops sub-12B models (8b-instant) entirely.
            expect(ids).not.toContain("llama-3.1-8b-instant");

            // The tier-1 flagship leads the ladder & the active model.
            expect(ids[0]).toBe("llama-3.3-70b-versatile");
            expect(client.activeModel).toBe("llama-3.3-70b-versatile");
        } finally {
            clearApiKey();
        }
    });
});

describe("GroqClient — real rate-limit header integration", () => {
    beforeEach(() => {
        PromptLogger.clear();
        setApiKey("gsk_test_ratelimit_key");
    });

    afterEach(() => {
        clearApiKey();
    });

    it("feeds the exact x-ratelimit-reset timing to the pool on 429 (no blind backoff)", async () => {
        let calls = 0;

        server.use(http.post(CHAT_URL, async () => {
            calls++;
            if (calls === 1) {
                return HttpResponse.json(
                    { error: { message: "Rate limit exceeded" } },
                    {
                        status: 429,
                        headers: {
                            "x-ratelimit-remaining-requests": "0",
                            "x-ratelimit-reset-requests": "2.5s"
                        }
                    }
                );
            }
            return new HttpResponse(sseBody([
                { choices: [{ delta: { content: "recovered reply" }, finish_reason: "stop" }] },
                { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
            ]), { headers: { "Content-Type": "text/event-stream" } });
        }));

        const client = new GroqClient({ logger: makeFakeLogger() });
        const reportFailure = vi.spyOn(client.modelPool, "reportFailure");

        // Pin the primary model so the 429 lands on a known pool id.
        const text = await client.streamChat(
            [{ role: "user", content: "hello" }],
            { maxRetries: 0, model: "openai/gpt-oss-120b" }
        );
        expect(text).toBe("recovered reply");

        // The pool receives the EXACT server reset (2.5s), not a blind
        // 5s/30s/5min guess, and the cooldown window reflects it.
        expect(reportFailure).toHaveBeenCalledWith("openai/gpt-oss-120b", 429, 2500);
        const remaining = client.modelPool.cooldownRemaining("openai/gpt-oss-120b");
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(2500);
    });

    it("pauses the exact server window from success-path rate-limit headers", async () => {
        server.use(http.post(CHAT_URL, () => new HttpResponse(sseBody([
            { choices: [{ delta: { content: "window exhausted" }, finish_reason: "stop" }] },
            { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
        ]), {
            headers: {
                "Content-Type": "text/event-stream",
                "x-ratelimit-remaining-requests": "0",
                "x-ratelimit-reset-requests": "1s",
                "x-ratelimit-remaining-tokens": "0",
                "x-ratelimit-reset-tokens": "2s"
            }
        })));

        const client = new GroqClient({ logger: makeFakeLogger() });
        const observe = vi.spyOn(client.modelPool, "observeRateLimit");

        // Pin the primary model so the observed pause lands on a known pool id.
        const text = await client.streamChat(
            [{ role: "user", content: "hello" }],
            { model: "openai/gpt-oss-120b" }
        );
        expect(text).toBe("window exhausted");

        // All five real headers are parsed from the response.
        expect(observe).toHaveBeenCalled();
        const info = observe.mock.calls[0][1];
        expect(info.remainingRequests).toBe("0");
        expect(info.resetRequests).toBe("1s");
        expect(info.remainingTokens).toBe("0");
        expect(info.resetTokens).toBe("2s");

        // Pool holds an EXACT server-timed pause for the requested model.
        const rem = client.modelPool.cooldownRemaining("openai/gpt-oss-120b");
        expect(rem).toBeGreaterThan(0);
        expect(rem).toBeLessThanOrEqual(1000);
    });
});

describe("RateLimiter — server-specified pause windows", () => {
    it("waits exactly until the server's reset timestamp", async () => {
        const { default: RateLimiter } = await import("../../src/classes/lib/RateLimiter.js");
        const limiter = new RateLimiter({ maxPerMinute: 100, minSpacingMs: 0, maxConcurrent: 5 });

        limiter.syncServerLimit(Date.now() + 150);

        const start = Date.now();
        const release = await limiter.acquire();
        const elapsed = Date.now() - start;
        release();

        expect(elapsed).toBeGreaterThanOrEqual(100);
    });
});

describe("GroqClient — thinking (reasoning) options", () => {
    beforeEach(() => {
        PromptLogger.clear();
        setApiKey("gsk_test_thinking_key");
    });

    afterEach(() => {
        clearApiKey();
    });

    /**
     * Builds a minimal pool stub that always serves one fixed model.
     * @param {string} modelId
     * @returns {any}
     */
    function makePool(modelId) {
        return {
            activeModelId: modelId,
            getCandidates: async () => [{ id: modelId, displayName: modelId, tier: 1, version: 1 }],
            getActiveModel: async () => modelId,
            reportSuccess() {},
            reportFailure() { return false; },
            isEjected() { return false; },
            observeRateLimit() { return null; },
            allModelsCooling() { return false; },
            allModelsBlocked() { return false; },
            minCooldownRemaining() { return null; },
            cooldownRemaining() { return null; }
        };
    }

    it("enables thinking with a 512-token budget on reasoning models", async () => {
        /** @type {any} */
        let capturedBody = null;

        server.use(http.post(CHAT_URL, async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(sseBody([
                { choices: [{ delta: { reasoning: "pehle sochta hoon…" } }] },
                { choices: [{ delta: { content: "Answer." }, finish_reason: "stop" }] },
                { choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } }
            ]), { headers: { "Content-Type": "text/event-stream" } });
        }));

        const client = new GroqClient({ logger: makeFakeLogger(), modelPool: makePool("openai/gpt-oss-120b") });
        const text = await client.streamChat([{ role: "user", content: "hello" }], { maxTokens: 100 });

        expect(capturedBody).toBeTruthy();
        expect(capturedBody.model).toBe("openai/gpt-oss-120b");
        expect(capturedBody.reasoning_effort).toBe("low");
        expect(capturedBody.reasoning_format).toBe("parsed");
        // Reply budget (100) stays intact; the 512 thinking budget is on top.
        expect(capturedBody.max_tokens).toBe(100 + 512);
        // Reasoning deltas must never leak into the streamed reply text.
        expect(text).toBe("Answer.");
    });

    it("leaves non-reasoning models completely untouched", async () => {
        /** @type {any} */
        let capturedBody = null;

        server.use(http.post(CHAT_URL, async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(sseBody([
                { choices: [{ delta: { content: "plain reply" }, finish_reason: "stop" }] },
                { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
            ]), { headers: { "Content-Type": "text/event-stream" } });
        }));

        const client = new GroqClient({ logger: makeFakeLogger(), modelPool: makePool("llama-3.3-70b-versatile") });
        await client.streamChat([{ role: "user", content: "hello" }], { maxTokens: 100 });

        expect(capturedBody).toBeTruthy();
        expect(capturedBody.reasoning_effort).toBeUndefined();
        expect(capturedBody.reasoning_format).toBeUndefined();
        expect(capturedBody.max_tokens).toBe(100);
    });

    it("applies thinking options to non-streaming (generateText) requests too", async () => {
        /** @type {any} */
        let capturedBody = null;

        server.use(http.post(CHAT_URL, async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({
                choices: [{ message: { content: "{\"ok\":true}" } }],
                usage: { prompt_tokens: 10, completion_tokens: 5 }
            });
        }));

        const client = new GroqClient({ logger: makeFakeLogger(), modelPool: makePool("openai/gpt-oss-120b") });
        await client.generateText([{ role: "user", content: "hi" }], { maxTokens: 100, jsonMode: true });

        expect(capturedBody).toBeTruthy();
        expect(capturedBody.stream).toBe(false);
        expect(capturedBody.reasoning_effort).toBe("low");
        // reasoning_format "parsed" is also the required format under JSON mode.
        expect(capturedBody.reasoning_format).toBe("parsed");
        expect(capturedBody.response_format).toEqual({ type: "json_object" });
        expect(capturedBody.max_tokens).toBe(100 + 512);
    });

    it("only allowlists Groq-documented reasoning models", async () => {
        const { supportsGroqThinking, applyGroqThinking, GROQ_THINKING_BUDGET_TOKENS } =
            await import("../../src/classes/GroqClient.js");

        expect(GROQ_THINKING_BUDGET_TOKENS).toBe(512);

        expect(supportsGroqThinking("openai/gpt-oss-120b")).toBe(true);
        expect(supportsGroqThinking("openai/gpt-oss-20b")).toBe(true);
        expect(supportsGroqThinking("qwen/qwen3.8-27b")).toBe(true);

        // Safeguard & everything else must never get reasoning params (400 risk).
        expect(supportsGroqThinking("openai/gpt-oss-safeguard-20b")).toBe(false);
        expect(supportsGroqThinking("llama-3.3-70b-versatile")).toBe(false);
        expect(supportsGroqThinking("qwen/qwen3-32b")).toBe(false);
        expect(supportsGroqThinking("qwen/qwen3.6-27b")).toBe(false);
        expect(supportsGroqThinking("")).toBe(false);

        const body = applyGroqThinking({ model: "openai/gpt-oss-120b", max_tokens: 100 });
        expect(body.max_tokens).toBe(612);
        expect(body.reasoning_effort).toBe("low");
        expect(body.reasoning_format).toBe("parsed");

        const plain = applyGroqThinking({ model: "llama-3.3-70b-versatile", max_tokens: 100 });
        expect(plain.max_tokens).toBe(100);
        expect(plain.reasoning_effort).toBeUndefined();
    });
});
