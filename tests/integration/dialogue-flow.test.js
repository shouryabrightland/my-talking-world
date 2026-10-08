import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/mocks/server.js";
import { resetAllMocks } from "../../src/mocks/handlers.js";

// Set a fake API key for GroqClient
localStorage.setItem("tgf:groq_api_key", "gsk_test_integration_key_12345");
localStorage.setItem("tgf:gemini_api_key", "test-gemini-key-12345");

// ─── Mocks for non-API dependencies ─────────────────────────────────────────

vi.mock("../../src/classes/lib/Storage.js", () => ({
    default: class MockStorage {
        constructor() {
            this.getItem = vi.fn().mockResolvedValue(null);
            this.setItem = vi.fn().mockResolvedValue(undefined);
        }
    }
}));

vi.mock("../../src/classes/lib/EventManager.js", () => ({
    default: class MockEventManager {
        constructor() {
            this.emit = vi.fn();
            this.on = vi.fn().mockReturnValue(() => {});
        }
    }
}));

vi.mock("../../src/classes/PromptBuilder.js", () => ({
    default: class MockPromptBuilder {
        constructor() {}
        async build() { return { messages: [] }; }
        useSystem() {}
        useUser() {}
        part(text) { return text; }
    }
}));

vi.mock("../../src/classes/ProtocolCodec.js", () => ({
    default: class MockProtocolCodec {
        static extractThinkingChain(text) {
            const match = text.match(/<think>([\s\S]*?)<\/think>/);
            return { cleanText: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), thinking: match ? match[1].trim() : null };
        }
        static stripIncompleteTrailingRecords(buf) { return buf; }
        static parseRecords(buf) {
            const regex = /<record\s+[^>]*>/g;
            const records = [];
            let m;
            while ((m = regex.exec(buf)) !== null) {
                const tag = m[0];
                const type = tag.match(/type="([^"]*)"/)?.[1] || "message";
                const character = tag.match(/character="([^"]*)"/)?.[1] || "unknown";
                const text = tag.match(/text="([^"]*)"/)?.[1] || "";
                records.push({ type, character, text });
            }
            return records;
        }
    }
}));

vi.mock("../../src/util/environment.js", () => ({
    getEnvironmentSnapshot: vi.fn().mockResolvedValue({
        city: "Lucknow", weather: "Mainly clear", temperature: "32°C",
        humidity: "55%", todayCelebration: "🎉 Onam", upcomingFestivals: ["Diwali"],
        newsHeadlines: ["India GDP grows 7.2%"], updatedAt: Date.now()
    }),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import GroqClient from "../../src/classes/GroqClient.js";
import ConversationManager from "../../src/classes/ConversationManager.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeLogger() {
    return {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
    };
}

function makeFakeWorld() {
    return {
        now: new Date(), date: "Mon, 25 Aug 2026", time: "14:30",
        tick: vi.fn(),
        events: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => {}) },
        environment: { city: "Lucknow", weather: "Sunny", temperature: "32°C", humidity: "55%", todayCelebration: "", newsHeadlines: [], upcomingFestivals: [] },
        activeSchedule: null,
        User: { id: "me", name: "Player" },
        unifiedMemory: { getEntriesForMember: () => [], toTextStack: () => "" },
        getActiveSchedule: () => null,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Dialogue Flow Integration (Groq + MSW)", () => {
    let groqClient;
    const logger = makeFakeLogger();

    beforeEach(() => {
        vi.clearAllMocks();
        resetAllMocks();
        // Ensure API keys are set
        localStorage.setItem("tgf:groq_api_key", "gsk_test_integration_key_12345");
        groqClient = new GroqClient({ logger, defaultModel: "llama-3.3-70b-versatile" });
    });

    afterEach(() => {
        localStorage.removeItem("tgf:groq_api_key");
    });

    it("fetches Groq model list successfully", async () => {
        const models = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { "Authorization": "Bearer gsk_test_key_12345" }
        }).then(r => r.json());

        expect(models.data).toBeDefined();
        expect(models.data.length).toBeGreaterThan(0);
        expect(models.data.some(m => m.id === "llama-3.3-70b-versatile")).toBe(true);
    });

    it("rejects invalid Groq API key", async () => {
        const response = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { "Authorization": "Bearer invalid-groq-key" }
        });
        expect(response.status).toBe(401);
    });

    it("generates non-streaming dialogue with thinking + record XML", async () => {
        const result = await groqClient.generateText([
            { role: "user", content: "Say hello" }
        ], { temperature: 0.7, maxTokens: 500 });

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(0);
        // Should NOT contain <think> tags (they should be stripped)
        expect(result.text).not.toContain("<think>");
    });

    it("streams dialogue tokens via SSE", async () => {
        const chunks = [];
        const fullText = await groqClient.streamChat([
            { role: "user", content: "Say something" }
        ], { temperature: 0.7, maxTokens: 500 });

        expect(fullText).toBeDefined();
        expect(fullText.length).toBeGreaterThan(0);
    });

    it("handles 429 rate limit gracefully", async () => {
        // Override the handler to return 429 for this specific test
        server.use(
            http.post("https://api.groq.com/openai/v1/chat/completions", () => {
                return HttpResponse.json(
                    { error: { message: "Rate limit exceeded", type: "tokens", code: "rate_limit_exceeded" } },
                    { status: 429, headers: { "Retry-After": "1" } }
                );
            })
        );

        await expect(
            groqClient.generateText([
                { role: "user", content: "Test" }
            ], { temperature: 0.7, maxTokens: 100 })
        ).rejects.toThrow();
    });

    it("full dialogue turn with Groq generates record XML", async () => {
        const result = await groqClient.generateText([
            { role: "system", content: "You are Tom. Reply in Hinglish." },
            { role: "user", content: "Kya ho raha hai?" }
        ], { temperature: 0.7, maxTokens: 500 });

        expect(result.text).toBeDefined();
        // The mock response contains <record> XML
        expect(result.text).toContain("<record");
    });
});
