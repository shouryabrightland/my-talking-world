// @ts-check

/**
 * @file PromptLogger.test.js
 * Verifies token usage and finish-reason capture for the DevTools Prompt Inspector.
 */

import { describe, it, expect, beforeEach } from "vitest";
import PromptLogger from "../../src/classes/lib/PromptLogger.js";

describe("PromptLogger — token metrics & finish reasons", () => {
    beforeEach(() => {
        PromptLogger.clear();
    });

    it("captures tokensIn, tokensOut, and finishReason on a successful record", () => {
        const entry = PromptLogger.record({
            type: "dialogue",
            model: "openai/gpt-oss-120b",
            startTime: Date.now() - 50,
            requestMessages: [{ role: "user", content: "hello" }],
            rawResponse: "Arre yaar!",
            status: "success",
            tokensIn: 1200,
            tokensOut: 340,
            finishReason: "stop"
        });

        expect(entry.tokensIn).toBe(1200);
        expect(entry.tokensOut).toBe(340);
        expect(entry.finishReason).toBe("stop");

        const stored = PromptLogger.getLogsForType("dialogue");
        expect(stored).toHaveLength(1);
        expect(stored[0].tokensIn).toBe(1200);
        expect(stored[0].tokensOut).toBe(340);
        expect(stored[0].finishReason).toBe("stop");
    });

    it("flags truncated responses with finishReason === \"length\"", () => {
        const entry = PromptLogger.record({
            type: "dialogue",
            model: "openai/gpt-oss-120b",
            startTime: Date.now(),
            requestMessages: [],
            rawResponse: "cut off mid-sen",
            status: "success",
            tokensIn: 900,
            tokensOut: 1200,
            finishReason: "length"
        });

        expect(entry.finishReason).toBe("length");
        // DevToolsPromptsTab renders a TRUNCATED warning badge for this value.
        expect(entry.finishReason === "length").toBe(true);
    });

    it("defaults token metrics to null when they are not provided", () => {
        const entry = PromptLogger.record({
            type: "scheduler",
            model: "gemini-3.7-flash",
            startTime: Date.now(),
            requestMessages: [],
            rawResponse: "",
            status: "error",
            error: "HTTP 429"
        });

        expect(entry.tokensIn).toBeNull();
        expect(entry.tokensOut).toBeNull();
        expect(entry.finishReason).toBeNull();
        expect(entry.status).toBe("error");
        expect(entry.error).toBe("HTTP 429");
    });

    it("keeps per-type ring buffers isolated (max 5 entries each)", () => {
        for (let i = 0; i < 7; i++) {
            PromptLogger.record({
                type: "dialogue",
                model: "openai/gpt-oss-120b",
                startTime: Date.now(),
                requestMessages: [],
                rawResponse: `resp-${i}`,
                tokensIn: i,
                tokensOut: i,
                finishReason: "stop"
            });
        }

        const dialogue = PromptLogger.getLogsForType("dialogue");
        expect(dialogue).toHaveLength(PromptLogger.MAX_ENTRIES_PER_TYPE);
        // Newest-first ordering: the newest entry carries the latest metrics.
        expect(dialogue[0].tokensIn).toBe(6);
        expect(PromptLogger.getLogsForType("demand")).toHaveLength(0);
    });
});
