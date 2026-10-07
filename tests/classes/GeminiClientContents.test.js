// @ts-check

/**
 * @file GeminiClientContents.test.js
 * Guards the Google AI Studio `GenerateContentRequest.contents` contract:
 * the API rejects `contents: []` with HTTP 400
 * ("GenerateContentRequest.contents: contents is not specified"), so the
 * client must always send at least one content item — system-only prompts
 * are promoted to a user turn.
 */

import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/mocks/server.js";
import GeminiClient from "../../src/classes/GeminiClient.js";
import Logger from "../../src/classes/lib/Logger.js";

/** @type {any} Body captured from the last intercepted request. */
let capturedBody = null;

/**
 * Registers an msw handler capturing the JSON request body for one model.
 * @param {string} modelId
 */
function mockStreamCapture(modelId) {
    capturedBody = null;
    server.use(
        http.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelId}\\:streamGenerateContent`,
            async ({ request }) => {
                capturedBody = await request.json();
                return new HttpResponse("data: [DONE]\n\n", {
                    headers: { "Content-Type": "text/event-stream" }
                });
            }
        )
    );
}

describe("GeminiClient — contents payload", () => {
    it("promotes a system-only prompt to a user turn so contents is never empty", async () => {
        const modelId = "gemma-2-27b-it";
        mockStreamCapture(modelId);

        const client = new GeminiClient({
            logger: new Logger("Test"),
            apiKey: "AIzaTestUnitKey"
        });

        await client.streamGenerate(
            [{ role: "system", content: "# 24-Hour Storyline Planner" }],
            { model: modelId, promptType: "scheduler" }
        );

        expect(capturedBody).toBeTruthy();
        expect(Array.isArray(capturedBody.contents)).toBe(true);
        expect(capturedBody.contents.length).toBeGreaterThan(0);
        expect(capturedBody.contents[0].role).toBe("user");
        expect(capturedBody.contents[0].parts[0].text).toBe("# 24-Hour Storyline Planner");
        // The system instructions still travel separately.
        expect(capturedBody.systemInstruction.parts[0].text).toBe("# 24-Hour Storyline Planner");
    });

    it("maps conversational messages onto Gemini roles and keeps them in contents", async () => {
        const modelId = "gemma-2-27b-it";
        mockStreamCapture(modelId);

        const client = new GeminiClient({
            logger: new Logger("Test"),
            apiKey: "AIzaTestUnitKey"
        });

        await client.streamGenerate(
            [
                { role: "system", content: "System rules" },
                { role: "user", content: "Human says hello" },
                { role: "assistant", content: "Cast replies" }
            ],
            { model: modelId, promptType: "scheduler" }
        );

        expect(capturedBody.contents).toHaveLength(2);
        expect(capturedBody.contents[0].role).toBe("user");
        expect(capturedBody.contents[1].role).toBe("model");
        expect(capturedBody.contents[1].parts[0].text).toBe("Cast replies");
    });
});
