// @ts-check

/**
 * @file GroqClient.test.js
 * Verifies TASK 5 transparency requirements:
 * - stream_options.include_usage + tokensIn/tokensOut/finishReason capture
 * - a PromptLogger error card per failed model attempt (correct model + error)
 */

import { describe, it, expect, beforeEach } from "vitest";
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

        const client = new GroqClient({ logger: makeFakeLogger(), defaultModel: "openai/gpt-oss-120b" });
        const text = await client.streamChat([{ role: "user", content: "hello" }], { maxRetries: 0 });

        expect(text).toBe("fallback reply");

        const entries = PromptLogger.getLogsForType("dialogue");
        const errorEntry = entries.find(e => e.status === "error");
        const successEntry = entries.find(e => e.status === "success");

        // The failed attempt is attributed to the model that ACTUALLY failed.
        expect(errorEntry).toBeDefined();
        expect(errorEntry?.model).toBe("openai/gpt-oss-120b");
        expect(errorEntry?.error).toContain("does not exist");

        // The success card names the fallback model that served the response.
        expect(successEntry).toBeDefined();
        expect(successEntry?.model).toBe("llama-3.3-70b-versatile");
        expect(successEntry?.tokensOut).toBe(10);
    });

    it("clears API key state after tests", () => {
        clearApiKey();
        expect(true).toBe(true);
    });
});
