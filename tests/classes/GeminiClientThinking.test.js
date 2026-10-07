// @ts-check

/**
 * @file GeminiClientThinking.test.js
 * Task 7 — planner stream token separation:
 * - `part.thought === true` reasoning parts are emitted via THINKING and are
 *   NEVER appended to the output text (so block/schedule regexes cannot fire
 *   on a reasoning preamble).
 * - Inline reasoning spans (paired think tags) inside an output part are
 *   extracted into `thinking` and stripped from the returned output text.
 */

import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/mocks/server.js";
import GeminiClient, { GeminiClientEvents } from "../../src/classes/GeminiClient.js";
import Logger from "../../src/classes/lib/Logger.js";

/** Reasoning chunk: marked with `thought: true` (Gemini 2.5 / 3.x shape). */
const THOUGHT_CHUNK = {
    candidates: [{
        content: {
            parts: [{ text: "First I should plan the <schedule> with three <block> tags.", thought: true }]
        }
    }]
};

/** Output chunk: plain answer parts carrying the real schedule XML. */
const OUTPUT_CHUNK = {
    candidates: [{
        content: {
            parts: [{
                text: "<schedule><block start=\"14\" end=\"15\"><topic>Chai at the riverfront</topic></block></schedule>"
            }]
        },
        finishReason: "STOP"
    }]
};

/**
 * Registers an SSE handler streaming the given chunk list for one model.
 * @param {string} modelId
 * @param {any[]} chunks
 */
function mockStream(modelId, chunks) {
    server.use(
        http.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelId}\\:streamGenerateContent`,
            () => {
                const body =
                    chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") +
                    "data: [DONE]\n\n";
                return new HttpResponse(body, {
                    headers: { "Content-Type": "text/event-stream" }
                });
            }
        )
    );
}

describe("GeminiClient — thought vs output token separation", () => {
    it("streams reasoning through THINKING, never through TEXT", async () => {
        const modelId = "gemini-2.5-flash";
        mockStream(modelId, [THOUGHT_CHUNK, OUTPUT_CHUNK]);

        const client = new GeminiClient({
            logger: new Logger("Test"),
            apiKey: "AIzaTestUnitKey"
        });

        /** @type {string[]} */
        const textTokens = [];
        /** @type {string[]} */
        const thinkingTokens = [];

        client.events.on(GeminiClientEvents.TEXT, (/** @type {string} */ t) => textTokens.push(t));
        client.events.on(GeminiClientEvents.THINKING, (/** @type {string} */ t) => thinkingTokens.push(t));

        const result = await client.streamGenerate(
            [{ role: "user", content: "Plan the next horizon." }],
            { model: modelId }
        );

        // Reasoning surfaced on its own channel...
        expect(thinkingTokens.join("")).toContain("I should plan the <schedule>");
        expect(textTokens.join("")).not.toContain("I should plan the <schedule>");

        // ...and never leaked into the output text used for block detection.
        expect(result.text).toContain("<schedule>");
        expect(result.text).toContain("Chai at the riverfront");
        expect(result.text).not.toContain("I should plan the <schedule>");

        // The raw reasoning is still available for the thinking inspector.
        expect(result.thoughtText).toContain("I should plan the <schedule>");
        expect(result.thinking).toContain("I should plan the <schedule>");

        // TEXT events map 1:1 onto the returned output.
        expect(textTokens.join("")).toBe(result.text);
    });

    it("extracts inline reasoning tags out of the output text", async () => {
        const modelId = "gemini-2.0-flash";
        const reasoning = "I will now emit the schedule.";
        const schedule =
            "<schedule><block start=\"16\" end=\"17\"><topic>Balcony break</topic></block></schedule>";

        mockStream(modelId, [{
            candidates: [{
                content: {
                    parts: [{ text: `<think>${reasoning}</think>${schedule}` }]
                },
                finishReason: "STOP"
            }]
        }]);

        const client = new GeminiClient({
            logger: new Logger("Test"),
            apiKey: "AIzaTestUnitKey"
        });

        const result = await client.streamGenerate(
            [{ role: "user", content: "Plan the next horizon." }],
            { model: modelId }
        );

        // Output is clean, reasoning moved to the thinking field.
        expect(result.text).toContain("<schedule>");
        expect(result.text).toContain("Balcony break");
        expect(result.text).not.toContain(reasoning);
        expect(result.thinking).toContain(reasoning);
    });
});
