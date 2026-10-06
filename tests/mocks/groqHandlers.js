// @ts-check

/**
 * @file groqHandlers.js
 * MSW request handlers for mocking the Groq API endpoint.
 */

import { http, HttpResponse } from "msw";

export const groqHandlers = [
    /**
     * GET /openai/v1/models — Returns the list of available Groq models.
     */
    http.get("https://api.groq.com/openai/v1/models", ({ request }) => {
        const authHeader = request.headers.get("Authorization");

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return HttpResponse.json(
                { error: { message: "Invalid API key", code: "invalid_api_key" } },
                { status: 401 }
            );
        }

        const key = authHeader.replace("Bearer ", "").trim();

        if (key === "invalid-groq-key") {
            return HttpResponse.json(
                { error: { message: "Invalid API key", code: "invalid_api_key" } },
                { status: 401 }
            );
        }

        if (!key.startsWith("gsk_")) {
            return HttpResponse.json(
                { error: { message: "Invalid API key format", code: "invalid_api_key" } },
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
    })
];

/**
 * Resets all Groq mock state.
 * @returns {void}
 */
export function resetGroqMocks() {
    // No state to reset
}
