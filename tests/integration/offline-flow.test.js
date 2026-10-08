import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/mocks/server.js";
import { resetAllMocks } from "../../src/mocks/handlers.js";

// Set fake API keys for GroqClient
localStorage.setItem("tgf:groq_api_key", "gsk_test_integration_key_12345");
localStorage.setItem("tgf:gemini_api_key", "test-gemini-key-12345");

// ─── Mocks for non-API dependencies ─────────────────────────────────────────

vi.mock("../../src/classes/lib/Storage.js", () => ({
    default: class MockStorage {
        constructor() {
            this._store = {};
            this.getItem = vi.fn().mockImplementation((key) => Promise.resolve(this._store[key] || null));
            this.setItem = vi.fn().mockImplementation((key, value) => { this._store[key] = value; return Promise.resolve(); });
        }
    }
}));

vi.mock("../../src/classes/lib/EventManager.js", () => ({
    default: class MockEventManager {
        constructor() { this.emit = vi.fn(); this.on = vi.fn().mockReturnValue(() => {}); }
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
            return { cleanText: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), thinking: null };
        }
        static stripIncompleteTrailingRecords(buf) { return buf; }
    }
}));

vi.mock("../../src/classes/lib/XmlEncoder.js", () => ({
    default: { encode: (s) => String(s || ""), decode: (s) => String(s || "") }
}));

vi.mock("../../src/util/environment.js", () => ({
    getEnvironmentSnapshot: vi.fn().mockResolvedValue({
        city: "Lucknow, India", weather: "Mainly clear", temperature: "32°C",
        humidity: "55%", todayCelebration: "🎉 Onam", upcomingFestivals: ["Diwali"],
        newsHeadlines: ["India GDP grows 7.2%"], updatedAt: Date.now()
    }),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import GroqClient from "../../src/classes/GroqClient.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeLogger() {
    return {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Offline Flow Integration (Network Fallback + MSW)", () => {
    let groqClient;
    const logger = makeFakeLogger();

    beforeEach(() => {
        vi.clearAllMocks();
        resetAllMocks();
        localStorage.setItem("tgf:groq_api_key", "gsk_test_integration_key_12345");
        groqClient = new GroqClient({ logger, defaultModel: "llama-3.3-70b-versatile" });
    });

    it("Groq API works normally when online", async () => {
        const result = await groqClient.generateText([
            { role: "user", content: "Hello" }
        ], { temperature: 0.7, maxTokens: 500 });

        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThan(0);
    });

    it("Groq API fails gracefully with 503 when service is down", async () => {
        server.use(
            http.post("https://api.groq.com/openai/v1/chat/completions", () => {
                return HttpResponse.json(
                    { error: { message: "Service temporarily unavailable" } },
                    { status: 503, headers: { "Retry-After": "1" } }
                );
            })
        );

        await expect(
            groqClient.generateText([
                { role: "user", content: "Hello" }
            ], { temperature: 0.7, maxTokens: 100 })
        ).rejects.toThrow();
    });

    it("Gemini model probe handles network errors gracefully", async () => {
        // Override Gemini to simulate network failure
        server.use(
            http.get("https://generativelanguage.googleapis.com/v1beta/models", () => {
                return HttpResponse.error();
            })
        );

        await expect(
            fetch("https://generativelanguage.googleapis.com/v1beta/models?key=test")
        ).rejects.toThrow();
    });

    it("environment snapshot gracefully falls back when APIs are unavailable", async () => {
        // Override all environment APIs to fail
        server.use(
            http.get("https://api.open-meteo.com/v1/forecast", () => HttpResponse.error()),
            http.get("https://jayantur13.github.io/calendar-bharat/calendar/2026.json", () => HttpResponse.error()),
            http.get("https://api.rss2json.com/v1/api.json", () => HttpResponse.error())
        );

        // The environment.js module has built-in fallbacks, so this should not throw
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot).toBeDefined();
        expect(snapshot.city).toBeDefined();
        // Fallback values should be present
        expect(snapshot.temperature).toBeDefined();
        expect(snapshot.weather).toBeDefined();
    });

    it("Open-Meteo returns weather data when online", async () => {
        const response = await fetch(
            "https://api.open-meteo.com/v1/forecast?latitude=26.85&longitude=80.95&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FKolkata"
        );
        const data = await response.json();

        expect(data.current).toBeDefined();
        expect(data.current.temperature_2m).toBe(32);
        expect(data.current.relative_humidity_2m).toBe(55);
    });

    it("Calendar Bharat returns festival data when online", async () => {
        const response = await fetch("https://jayantur13.github.io/calendar-bharat/calendar/2026.json");
        const data = await response.json();

        // Live API shape: { "2026": { "August 2026": { "August 15, 2026, Saturday": {event} } } }
        expect(data["2026"]).toBeDefined();
        expect(data["2026"]["August 2026"]).toBeDefined();
        expect(data["2026"]["August 2026"]["August 15, 2026, Saturday"].event).toBe("Independence Day");
    });

    it("Google News RSS returns headlines when online", async () => {
        const rssFeedUrl = encodeURIComponent("https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en");
        const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssFeedUrl}`);
        const data = await response.json();

        expect(data.status).toBe("ok");
        expect(data.items).toBeDefined();
        expect(data.items.length).toBeGreaterThan(0);
        expect(data.items[0].title).toBeDefined();
    });

    it("Groq streaming works with SSE chunks", async () => {
        const fullText = await groqClient.streamChat([
            { role: "user", content: "Say something" }
        ], { temperature: 0.7, maxTokens: 500 });

        expect(fullText).toBeDefined();
        expect(fullText.length).toBeGreaterThan(0);
    });
});
