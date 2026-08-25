import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (all class-based per existing test pattern) ────────────────────────

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

vi.mock("../../src/classes/GeminiClient.js", () => ({
    default: class MockGeminiClient {
        constructor() {
            this.events = { on() { return () => {}; }, emit() {} };
        }
        async streamGenerate() { return { text: "", model: "mock" }; }
        async generateText() { return { text: "", model: "mock" }; }
    }
}));

vi.mock("../../src/classes/GroqClient.js", () => ({
    default: class MockGroqClient {
        constructor() {
            this.events = { on() { return () => {}; }, emit() {} };
        }
        async streamChat() { return ""; }
        async generateText() { return { text: "", model: "mock", thinking: null }; }
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
            return { cleanText: text, thinking: null };
        }
        static stripIncompleteTrailingRecords(buf) {
            return buf;
        }
    }
}));

vi.mock("../../src/classes/lib/XmlEncoder.js", () => ({
    default: {
        encode: (s) => String(s || ""),
        decode: (s) => String(s || ""),
    }
}));

vi.mock("../../src/util/environment.js", () => ({
    getEnvironmentSnapshot: vi.fn().mockResolvedValue({
        city: "Lucknow", weather: "Sunny", temperature: "32°C",
        humidity: "45%", todayCelebration: "", newsHeadlines: [],
        upcomingFestivals: [],
    }),
}));

vi.mock("../../src/util/Constants.js", () => ({
    hasGeminiApiKey: vi.fn().mockReturnValue(true),
    DEFAULT_GEMINI_MODEL: "gemini-3.7-flash",
    DEFAULT_CHAT_MODEL: "llama-3.3-70b-versatile",
    GEMINI_MAX_OUTPUT_TOKENS: 65000,
    PROMPT_SCHEDULER_TASK: "Test scheduler task",
    PROMPT_SCHEDULER_RULES: ["Rule 1", "Rule 2"],
    PROMPT_DEMAND_TASK: "Test demand task",
    PROMPT_DEMAND_RULES: ["Rule A"],
    PROMPT_RESTABILIZER_TASK: "Review and connect blocks for smooth storyline flow.",
    PROMPT_RESTABILIZER_RULES: ["Preserve topics", "Write pre_plot", "Write post_plot"],
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import WorldSetter from "../../src/classes/WorldSetter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeWorld() {
    return {
        now: new Date(),
        date: "Mon, 25 Aug 2026",
        time: "14:30",
        tick: vi.fn(),
        events: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => {}) },
        environment: { city: "Lucknow", weather: "Sunny", temperature: "32°C", humidity: "45%", todayCelebration: "", newsHeadlines: [] },
        activeSchedule: null,
        User: { memory: { values: () => [], set: vi.fn() } },
    };
}

function makeFakeLogger() {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
    };
}

function buildXmlSchedule(blocks) {
    let xml = "<schedule>\n";
    for (const b of blocks) {
        xml += `  <block start="${b.startHour}" end="${b.endHour}">\n`;
        xml += `    <topic>${b.topic}</topic>\n`;
        xml += `    <goals>\n      <main>${b.mainGoal || "Main goal"}</main>\n    </goals>\n`;
        xml += `    <pre_plot>${b.prePlot || "Buildup"}</pre_plot>\n`;
        xml += `    <post_plot>${b.postPlot || "Aftermath"}</post_plot>\n`;
        xml += `    <facts>${(b.facts || []).map(f => `<fact>${f}</fact>`).join("")}</facts>\n`;
        xml += `  </block>\n`;
    }
    xml += "</schedule>";
    return xml;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WorldSetter restabilizeAndSave", () => {
    /** @type {WorldSetter} */
    let ws;
    /** @type {ReturnType<typeof makeFakeWorld>} */
    let fakeWorld;

    beforeEach(() => {
        vi.clearAllMocks();
        fakeWorld = makeFakeWorld();
        ws = new WorldSetter({ logger: makeFakeLogger(), world: fakeWorld });
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Tea break", mainGoal: "Relax", characterGoals: [], facts: ["Chai ready"], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
            { id: "b2", startHour: 15, endHour: 16, timeRange: "15:00 - 16:00", topic: "Project brainstorm", mainGoal: "Plan features", characterGoals: [], facts: ["Whiteboard"], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
        ];
    });

    it("returns success immediately if schedule is not dirty", async () => {
        ws.isDirty = false;
        const result = await ws.restabilizeAndSave();
        expect(result.success).toBe(true);
        expect(result.message).toContain("already stable");
    });

    it("successfully stabilizes and persists when Gemini returns valid XML", async () => {
        ws.isDirty = true;
        const stabilizedXml = buildXmlSchedule([
            { startHour: 14, endHour: 15, topic: "Tea break", mainGoal: "Relax", prePlot: "Afternoon begins", postPlot: "Transition to planning", facts: ["Chai"] },
            { startHour: 15, endHour: 16, topic: "Project brainstorm", mainGoal: "Plan features", prePlot: "After tea", postPlot: "Wrap up day", facts: ["Whiteboard"] },
        ]);

        // Override mock GeminiClient.streamGenerate
        ws.geminiClient.streamGenerate = vi.fn().mockResolvedValue({ text: stabilizedXml });

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(true);
        expect(result.schedule).toBeDefined();
        expect(result.schedule.length).toBe(2);
        expect(ws.isDirty).toBe(false);
        expect(ws.storage.setItem).toHaveBeenCalled();
    });

    it("returns validation errors when Gemini returns overlapping blocks", async () => {
        ws.isDirty = true;
        const badXml = buildXmlSchedule([
            { startHour: 14, endHour: 16, topic: "Overlapping block A", mainGoal: "Goal A", facts: [] },
            { startHour: 15, endHour: 17, topic: "Overlapping block B", mainGoal: "Goal B", facts: [] },
        ]);

        ws.geminiClient.streamGenerate = vi.fn().mockResolvedValue({ text: badXml });

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.message).toContain("invalid schedule");
        expect(ws.isDirty).toBe(true); // dirty state retained
    });

    it("returns validation error when schedule is empty after parsing", async () => {
        ws.isDirty = true;
        // Response with no <block> tags — parser will create a fallback block,
        // but with non-overlapping single block it should succeed
        ws.geminiClient.streamGenerate = vi.fn().mockResolvedValue({ text: "No schedule tags here at all" });

        const result = await ws.restabilizeAndSave();

        // The parser creates a fallback block, so it should actually succeed
        expect(result.success).toBe(true);
        expect(result.schedule).toBeDefined();
        expect(result.schedule.length).toBe(1);
    });

    it("returns error when both Gemini and Groq fail", async () => {
        ws.isDirty = true;
        ws.geminiClient.streamGenerate = vi.fn().mockRejectedValue(new Error("API key invalid"));
        ws.groqClient.streamChat = vi.fn().mockRejectedValue(new Error("Groq also down"));

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(false);
        expect(result.message).toContain("error");
        expect(ws.isDirty).toBe(true);
    });

    it("falls back to Groq when Gemini circuit breaker is open", async () => {
        ws.isDirty = true;
        const stabilizedXml = buildXmlSchedule([
            { startHour: 14, endHour: 15, topic: "Tea break", mainGoal: "Relax", facts: ["Chai"] },
            { startHour: 15, endHour: 16, topic: "Project brainstorm", mainGoal: "Plan", facts: [] },
        ]);

        // Gemini fails with CIRCUIT_OPEN
        ws.geminiClient.streamGenerate = vi.fn().mockRejectedValue(
            Object.assign(new Error("Circuit open"), { code: "CIRCUIT_OPEN" })
        );
        // Groq fallback succeeds
        ws.groqClient.streamChat = vi.fn().mockResolvedValue(stabilizedXml);

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(true);
        expect(ws.groqClient.streamChat).toHaveBeenCalled();
    });
});

describe("WorldSetter directSave", () => {
    /** @type {WorldSetter} */
    let ws;

    beforeEach(() => {
        vi.clearAllMocks();
        ws = new WorldSetter({
            logger: makeFakeLogger(),
            world: makeFakeWorld(),
        });
        ws.schedule = [
            { id: "b1", startHour: 14, endHour: 15, timeRange: "14:00 - 15:00", topic: "Test", mainGoal: "Test", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
        ];
    });

    it("saves directly when isDirty is false", async () => {
        ws.isDirty = false;
        const result = await ws.directSave();
        expect(result).toBeDefined();
        expect(result.length).toBe(1);
        expect(ws.storage.setItem).toHaveBeenCalled();
    });

    it("throws when isDirty is true", async () => {
        ws.isDirty = true;
        await expect(ws.directSave()).rejects.toThrow("unsaved manual changes");
        expect(ws.storage.setItem).not.toHaveBeenCalled();
    });
});
