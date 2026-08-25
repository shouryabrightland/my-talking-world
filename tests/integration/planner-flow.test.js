import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/mocks/server.js";
import { resetAllMocks, setCustomGenerateResponse } from "../../src/mocks/handlers.js";

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
        newsHeadlines: ["India GDP grows 7.2%", "ISRO launches satellite"], updatedAt: Date.now()
    }),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

// Set fake API keys for GeminiClient and GroqClient
localStorage.setItem("tgf:groq_api_key", "gsk_test_integration_key_12345");
localStorage.setItem("tgf:gemini_api_key", "test-gemini-key-12345");

import WorldSetter from "../../src/classes/WorldSetter.js";

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
        environment: { city: "Lucknow, India", weather: "Sunny", temperature: "32°C", humidity: "55%", todayCelebration: "", newsHeadlines: [], upcomingFestivals: [] },
        activeSchedule: null,
        User: { memory: { values: () => [], set: vi.fn() } },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Planner Flow Integration (Gemini + MSW)", () => {
    let ws;
    const logger = makeFakeLogger();
    const fakeWorld = makeFakeWorld();

    beforeEach(() => {
        vi.clearAllMocks();
        resetAllMocks();
        ws = new WorldSetter({ logger, world: fakeWorld });
    });

    it("restabilizeAndSave sends schedule to Gemini and persists valid result", async () => {
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Chai break", mainGoal: "Relax", characterGoals: [], facts: ["Chai"], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() }
        ];
        ws.isDirty = true;

        const result = await ws.restabilizeAndSave();

        // Log result for debugging
        if (!result.success) {
            console.log("[TEST DEBUG] restabilizeAndSave failed:", result.message, result.errors);
        }

        expect(result.success).toBe(true);
        expect(result.schedule).toBeDefined();
        expect(result.schedule.length).toBeGreaterThan(0);
        expect(ws.isDirty).toBe(false);
    });

    it("restabilizeAndSave returns error when Gemini returns garbage", async () => {
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Chai", mainGoal: "Relax", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() }
        ];
        ws.isDirty = true;

        // Override Gemini to return overlapping blocks
        setCustomGenerateResponse(
            '<schedule>\n<block start="14" end="16"><topic>Block A</topic><goals><main>Goal</main></goals><pre_plot>p</pre_plot><post_plot>p</post_plot><facts><fact>f</fact></facts></block>\n<block start="15" end="17"><topic>Block B</topic><goals><main>Goal</main></goals><pre_plot>p</pre_plot><post_plot>p</post_plot><facts><fact>f</fact></facts></block>\n</schedule>'
        );

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(ws.isDirty).toBe(true);
    });

    it("ensureSchedule triggers horizon generation when coverage is low", async () => {
        ws.schedule = [];
        ws.isPlanning = false;

        const schedule = await ws.ensureSchedule(new Date());

        expect(schedule).toBeDefined();
        // Fallback or generated schedule should have blocks
        expect(ws.schedule.length).toBeGreaterThan(0);
    });

    it("acceptProposal commits proposed changes and persists", async () => {
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Existing", mainGoal: "Goal", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() }
        ];

        const newBlock = {
            id: "b-new", startHour: 15, endHour: 16, timeRange: "15:00 - 16:00",
            topic: "New Activity", mainGoal: "Do something", characterGoals: [], facts: [],
            prePlot: "After existing", postPlot: "End of day", createdAt: Date.now(), updatedAt: Date.now()
        };

        ws.pendingProposal = {
            id: "prop-1",
            changes: [{ action: "add", block: newBlock }],
            summary: "Adding new activity",
            createdAt: Date.now()
        };
        ws.isDirty = true;

        const result = await ws.acceptProposal();

        expect(result.length).toBe(2);
        expect(result.some(r => r.topic === "New Activity")).toBe(true);
        expect(ws.isDirty).toBe(false);
        expect(ws.pendingProposal).toBeNull();
    });

    it("denyProposal discards proposal without changes", () => {
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Existing", mainGoal: "Goal", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() }
        ];
        ws.pendingProposal = { id: "prop-1", changes: [], summary: "test", createdAt: Date.now() };
        ws.isDirty = true;

        const result = ws.denyProposal();

        expect(result.length).toBe(1);
        expect(result[0].topic).toBe("Existing");
        expect(ws.pendingProposal).toBeNull();
        expect(ws.isDirty).toBe(false);
    });

    it("directSave works when schedule is stable", async () => {
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Test", mainGoal: "Goal", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() }
        ];
        ws.isDirty = false;

        const result = await ws.directSave();
        expect(result.length).toBe(1);
    });

    it("directSave throws when schedule is dirty", async () => {
        ws.isDirty = true;
        await expect(ws.directSave()).rejects.toThrow("unsaved manual changes");
    });
});
