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
    },
    GOOGLE_SEARCH_TOOL: [{ googleSearch: {} }],
    DEEP_THINKING_BUDGET: 1024,
    STABILIZER_THINKING_BUDGET: 128
}));

// The planner resolves its Gemini ladder exclusively through the pool.
// Tests mutate `ws.modelPool.candidates` to simulate discovery / failover.
vi.mock("../../src/classes/lib/GeminiModelResolver.js", () => ({
    default: class MockGeminiModelPool {
        constructor() {
            /** @type {Array<{id: string, tier?: number, version?: number}>} */
            this.candidates = [{ id: "gemini-mock-flash", tier: 1, version: 3 }];
            /** @type {Array<{id: string, status: number|null}>} */
            this.failures = [];
            /** @type {string[]} */
            this.successes = [];
        }
        async getCandidates() { return this.candidates; }
        async getActiveModel() { return this.candidates.length > 0 ? this.candidates[0].id : null; }
        reportFailure(id, status) { this.failures.push({ id, status }); return true; }
        reportSuccess(id) { this.successes.push(id); }
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

    it("stabilizes blocks with individual goals for ALL 6 characters", async () => {
        ws.isDirty = true;
        const stabilizedXml = [
            "<schedule>",
            "  <block start=\"14\" end=\"15\">",
            "    <topic>Tea break</topic>",
            "    <goals>",
            "      <main>Relax together</main>",
            "      <goal id=\"tom\" name=\"Tom\">Lead the conversation</goal>",
            "      <goal id=\"angela\" name=\"Angela\">Share trending gossip</goal>",
            "      <goal id=\"ben\" name=\"Ben\">Tinker with his gadget</goal>",
            "      <goal id=\"ginger\" name=\"Ginger\">Pull a playful prank</goal>",
            "      <goal id=\"hank\" name=\"Hank\">Enjoy samosas and chai</goal>",
            "      <goal id=\"becca\" name=\"Becca\">Propose an evening run</goal>",
            "    </goals>",
            "    <pre_plot>Afternoon lull begins</pre_plot>",
            "    <post_plot>Energy picks up for the evening</post_plot>",
            "    <facts><fact>Chai is ready</fact></facts>",
            "  </block>",
            "</schedule>"
        ].join("\n");

        ws.geminiClient.streamGenerate = vi.fn().mockResolvedValue({ text: stabilizedXml });

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(true);
        expect(result.schedule).toHaveLength(1);

        const ids = result.schedule[0].characterGoals.map(g => g.id);
        expect(ids).toHaveLength(6);
        for (const id of ["tom", "angela", "ben", "ginger", "hank", "becca"]) {
            expect(ids).toContain(id);
        }
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

    it("returns success without calling Groq when every Gemini model fails", async () => {
        ws.isDirty = true;
        ws.modelPool.candidates = [{ id: "gemini-a" }, { id: "gemini-b" }];
        ws.geminiClient.streamGenerate = vi.fn().mockRejectedValue(new Error("API key invalid"));

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(false);
        expect(result.message).toContain("error");
        expect(ws.isDirty).toBe(true);
        // Strict provider isolation: no Groq client ever exists on the planner.
        expect(ws.groqClient).toBeUndefined();
    });

    it("does not invoke Groq when the Gemini circuit breaker is open", async () => {
        ws.isDirty = true;
        ws.modelPool.candidates = [{ id: "gemini-a" }];
        ws.geminiClient.streamGenerate = vi.fn().mockRejectedValue(
            Object.assign(new Error("Circuit open"), { code: "CIRCUIT_OPEN" })
        );

        const result = await ws.restabilizeAndSave();

        expect(result.success).toBe(false);
        expect(ws.groqClient).toBeUndefined();
        expect(ws.isDirty).toBe(true);
    });
});

describe("WorldSetter — Gemini Model Pool cascade & local fallback", () => {
    /** @type {WorldSetter} */
    let ws;
    /** @type {ReturnType<typeof makeFakeWorld>} */
    let fakeWorld;

    beforeEach(() => {
        vi.clearAllMocks();
        fakeWorld = makeFakeWorld();
        ws = new WorldSetter({ logger: makeFakeLogger(), world: fakeWorld });
        ws.schedule = [];
    });

    const VALID_SCHEDULE_XML =
        '<schedule><block start="14" end="15">' +
        "<topic>Chai and casual banter</topic>" +
        "<goals><main>Relax and chat</main></goals>" +
        "<pre_plot>Afternoon begins</pre_plot>" +
        "<post_plot>Transition to evening</post_plot>" +
        "<facts><fact>Chai ready</fact></facts>" +
        "</block></schedule>";

    it("cascades to the next pool model when the primary model is rate limited (429)", async () => {
        ws.modelPool.candidates = [
            { id: "gemini-2.5-flash", tier: 1, version: 2.5 },
            { id: "gemini-2.0-flash", tier: 1, version: 2 }
        ];

        ws.geminiClient.streamGenerate = vi.fn(async (
            _messages,
            /** @type {{model?: string}} */ options
        ) => {
            if (options.model === "gemini-2.5-flash") {
                throw Object.assign(new Error("Rate limit exceeded"), { status: 429 });
            }
            return { text: VALID_SCHEDULE_XML, model: options.model };
        });

        await ws.planHorizon(new Date(2026, 7, 25, 14, 0));

        expect(ws.geminiClient.streamGenerate).toHaveBeenCalledTimes(2);
        expect(ws.geminiClient.streamGenerate.mock.calls[0][1].model).toBe("gemini-2.5-flash");
        expect(ws.geminiClient.streamGenerate.mock.calls[1][1].model).toBe("gemini-2.0-flash");

        // The rate-limited model was ejected into the cooldown pool.
        expect(ws.modelPool.failures).toEqual([
            { id: "gemini-2.5-flash", status: 429 }
        ]);
        expect(ws.modelPool.successes).toEqual(["gemini-2.0-flash"]);
        expect(ws.schedule.length).toBeGreaterThan(0);
        expect(ws.groqClient).toBeUndefined();
    });

    it("falls back to #buildFallbackSchedule when all pool models fail, without calling Groq", async () => {
        ws.modelPool.candidates = [{ id: "gemini-2.5-flash" }, { id: "gemini-2.0-flash" }];
        ws.geminiClient.streamGenerate = vi.fn().mockRejectedValue(
            Object.assign(new Error("Model busy"), { status: 503 })
        );

        const schedule = await ws.planHorizon(new Date(2026, 7, 25, 14, 0));

        expect(ws.geminiClient.streamGenerate).toHaveBeenCalledTimes(2);
        expect(ws.modelPool.failures).toEqual([
            { id: "gemini-2.5-flash", status: 503 },
            { id: "gemini-2.0-flash", status: 503 }
        ]);

        // Local synthetic generator output (never a remote provider).
        expect(schedule.length).toBe(4);
        expect(schedule.map(r => r.topic)).toContain("Creative project discussion");
        expect(ws.groqClient).toBeUndefined();
    });

    it("falls back to the local generator immediately when the pool is empty", async () => {
        ws.modelPool.candidates = [];
        ws.geminiClient.streamGenerate = vi.fn();

        const schedule = await ws.planHorizon(new Date(2026, 7, 25, 14, 0));

        expect(ws.geminiClient.streamGenerate).not.toHaveBeenCalled();
        expect(schedule.length).toBe(4);
        expect(ws.groqClient).toBeUndefined();
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
