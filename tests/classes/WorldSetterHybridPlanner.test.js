// @ts-check

/**
 * @file WorldSetterHybridPlanner.test.js
 * Hybrid 24-Hour Planner (Templates + Deltas):
 * - resolveTodaySchedule priority ladder (specific date > day group > forever)
 * - Non-destructive overrides: existing today blocks beat templates
 * - Gemini generates Delta Blocks ONLY for empty gaps (type "once")
 * - Template library sync when a block's recurrence type changes
 * - Persona edits regenerate upcoming deltas while preserving user blocks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (same harness as WorldSetter.test.js) ───

vi.mock("../../src/classes/lib/Logger.js", () => ({
    default: class MockLogger {
        constructor(name = "Mock") { this.name = name; }
        child(name) { return new MockLogger(`${this.name}:${name}`); }
        info() {}
        warn() {}
        error() {}
        debug() {}
    }
}));

vi.mock("../../src/classes/lib/Storage.js", () => ({
    default: class MockStorage {
        constructor() { this._store = new Map(); }
        async getItem(key) { return this._store.get(key) ?? null; }
        async setItem(key, value) { this._store.set(key, value); }
        async removeItem(key) { this._store.delete(key); }
        async clear() { this._store.clear(); }
    }
}));

vi.mock("../../src/classes/GeminiClient.js", () => ({
    default: class MockGeminiClient {
        constructor() { this.events = { on() { return () => {}; }, emit() {} }; }
        async streamGenerate() { return { text: "", model: "mock" }; }
        async generateText() { return { text: "", model: "mock" }; }
    },
    GOOGLE_SEARCH_TOOL: [{ googleSearch: {} }],
    DEEP_THINKING_BUDGET: 1024,
    STABILIZER_THINKING_BUDGET: 128
}));

vi.mock("../../src/classes/GroqClient.js", () => ({
    default: class MockGroqClient {
        constructor() { this.events = { on() { return () => {}; }, emit() {} }; }
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
        static extractThinkingChain(text) { return { cleanText: text, thinking: null }; }
    }
}));

vi.mock("../../src/classes/lib/XmlEncoder.js", () => ({
    default: { encode(s) { return s; }, decode(s) { return s; } }
}));

vi.mock("../../src/util/environment.js", () => ({
    getEnvironmentSnapshot: async () => ({
        city: "Lucknow", temperature: "32°C", weather: "Sunny",
        humidity: "50%", todayCelebration: "None",
        upcomingFestivals: [], newsHeadlines: [], updatedAt: Date.now()
    })
}));

vi.mock("../../src/util/Constants.js", () => ({
    hasGeminiApiKey: () => false,
    DEFAULT_GEMINI_MODEL: "mock-gemini",
    DEFAULT_CHAT_MODEL: "mock-groq",
    GEMINI_MAX_OUTPUT_TOKENS: 4096,
    PROMPT_DEMAND_TASK: "mock demand task",
    PROMPT_DEMAND_RULES: ["rule1"],
    PROMPT_RESTABILIZER_TASK: "mock restab task",
    PROMPT_RESTABILIZER_RULES: ["rule1"]
}));

// ─── Import after mocks ───

import WorldSetter from "../../src/classes/WorldSetter.js";

function makeMockWorld(now = new Date(2026, 7, 25, 8, 0)) {
    return {
        events: {
            _em: {},
            on(event, handler) {
                if (!this._em[event]) this._em[event] = [];
                this._em[event].push(handler);
                return () => { this._em[event] = this._em[event].filter(h => h !== handler); };
            },
            emit(event, data) {
                for (const h of (this._em[event] || [])) h(data);
            }
        },
        now,
        date: "Tue Aug 25 2026",
        time: "08:00",
        environment: null,
        User: { id: "me", name: "Player" },
        unifiedMemory: { getEntriesForMember: () => [], toTextStack: () => "" },
        members: new Map(),
        tick() {}
    };
}

function makeRecord(startHour, endHour, topic = "Test topic", extra = {}) {
    return {
        id: crypto.randomUUID(),
        startHour,
        endHour,
        timeRange: `${startHour}:00 - ${endHour}:00`,
        topic,
        title: topic,
        mainGoal: "Test goal",
        characterGoals: [],
        facts: [],
        prePlot: "",
        postPlot: "",
        type: "once",
        source: "user",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...extra
    };
}

/** @type {WorldSetter} */
let ws;
/** @type {ReturnType<typeof makeMockWorld>} */
let world;

beforeEach(() => {
    world = makeMockWorld();
    ws = new WorldSetter({
        logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
        world
    });
    // Deterministic model path: fixed candidate + controllable streamGenerate.
    vi.spyOn(ws.modelPool, "getCandidates").mockResolvedValue([{
        id: "gemini-2.5-flash-lite", tier: 1, version: 2,
        displayName: "Flash Lite", isFlash: true, isFlashLite: true, outputTokenLimit: 8192
    }]);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("WorldSetter — resolveTodaySchedule priority ladder", () => {
    it("ranks specific date > day group > forever on overlapping windows", async () => {
        // 25 Aug 2026 is a Tuesday → dayType "weekdays", dateKey "25 aug".
        ws.templates = [
            makeRecord(9, 10, "Forever chai hour", { type: "forever" }),
            makeRecord(9.5, 11, "Weekday study block", { type: "weekdays" }),
            makeRecord(9.5, 12, "Independence Day special", { type: "25 aug" })
        ];
        vi.spyOn(ws.geminiClient, "streamGenerate").mockResolvedValue({ text: "" });

        await ws.resolveTodaySchedule(new Date(2026, 7, 25, 8, 0));

        const topics = ws.schedule.map(r => r.topic);
        expect(topics).toContain("Independence Day special");
        expect(topics).not.toContain("Forever chai hour");
        expect(topics).not.toContain("Weekday study block");
    });

    it("keeps templates untouched (non-destructive) when a today block overrides the window", async () => {
        const override = makeRecord(9, 10, "Emergency rooftop meeting", { source: "user" });
        ws.schedule = [override];
        ws.templates = [makeRecord(9, 11, "Forever chai hour", { type: "forever" })];
        vi.spyOn(ws.geminiClient, "streamGenerate").mockResolvedValue({ text: "" });

        await ws.resolveTodaySchedule(new Date(2026, 7, 25, 8, 0));

        // Today keeps the override; the template library is untouched.
        expect(ws.schedule.some(r => r.id === override.id)).toBe(true);
        expect(ws.getTemplates()).toHaveLength(1);
        expect(ws.getTemplates()[0].topic).toBe("Forever chai hour");
    });

    it("places non-overlapping day-group templates into today's timeline", async () => {
        ws.templates = [makeRecord(13, 15, "Weekday tuition block", { type: "weekdays" })];
        vi.spyOn(ws.geminiClient, "streamGenerate").mockResolvedValue({ text: "" });

        await ws.resolveTodaySchedule(new Date(2026, 7, 25, 8, 0));

        const placed = ws.schedule.find(r => r.topic === "Weekday tuition block");
        expect(placed).toBeDefined();
        expect(placed?.type).toBe("weekdays");
    });
});

describe("WorldSetter — delta generation for empty gaps", () => {
    it("fills gaps with Gemini delta blocks (type once, source delta) and stays contiguous", async () => {
        // Noon boot with an empty schedule → one big gap the model partly fills.
        world.now = new Date(2026, 7, 25, 14, 0);
        vi.spyOn(ws.geminiClient, "streamGenerate").mockResolvedValue({
            text: [
                "<schedule>",
                '<block start="15" end="17">',
                "  <topic>Chai stall hangout</topic>",
                "  <dense_paragraph>Steam rising from cutting glasses at the corner stall while the group argues about cricket.</dense_paragraph>",
                "  <main_goal>Refuel and roast each other</main_goal>",
                "  <character_goals></character_goals>",
                "  <pre_plot>Back from the earlier session</pre_plot>",
                "  <post_plot>Head home before dark</post_plot>",
                "  <facts><fact>Corner tea stall</fact></facts>",
                "</block>",
                "</schedule>"
            ].join("\n")
        });

        await ws.resolveTodaySchedule(world.now);

        const modelBlock = ws.schedule.find(r => r.topic === "Chai stall hangout");
        expect(modelBlock).toBeDefined();
        expect(modelBlock?.type).toBe("once");
        expect(modelBlock?.source).toBe("delta");
        expect(modelBlock?.denseParagraph).toContain("cutting glasses");
        expect(modelBlock?.startHour).toBe(15);
        expect(modelBlock?.endHour).toBe(17);

        // Backfilled remainder keeps the resolved timeline contiguous.
        for (let i = 1; i < ws.schedule.length; i++) {
            expect(ws.schedule[i].startHour).toBeGreaterThanOrEqual(ws.schedule[i - 1].endHour - 0.01);
        }
        expect(ws.schedule.every(r => r.source === "delta")).toBe(true);
    });

    it("skips Gemini entirely when there are no gaps to fill", async () => {
        const streamSpy = vi.spyOn(ws.geminiClient, "streamGenerate");
        // Full-day coverage: templates tile the entire 0..24 span.
        ws.templates = [
            makeRecord(0, 12, "Morning forever block", { type: "forever" }),
            makeRecord(12, 24, "Night forever block", { type: "forever" })
        ];

        await ws.resolveTodaySchedule(new Date(2026, 7, 25, 8, 0));

        expect(streamSpy).not.toHaveBeenCalled();
        expect(ws.schedule.map(r => r.topic)).toEqual(["Morning forever block", "Night forever block"]);
    });

    it("backfills deterministically when Gemini fails", async () => {
        vi.spyOn(ws.geminiClient, "streamGenerate").mockRejectedValue(new Error("quota"));

        await ws.resolveTodaySchedule(new Date(2026, 7, 25, 8, 0));

        expect(ws.schedule.length).toBeGreaterThan(0);
        expect(ws.schedule.every(r => r.source === "delta")).toBe(true);
        expect(ws.schedule.every(r => r.type === "once")).toBe(true);
    });
});

describe("WorldSetter — template library sync", () => {
    it("createRecord with a recurrence type registers a template", async () => {
        const record = await ws.createRecord({
            startHour: 17, endHour: 18,
            topic: "Evening rooftop adda",
            denseParagraph: "The sky turns orange over the rooftops as chai arrives.",
            type: "weekends"
        });

        expect(record.type).toBe("weekends");
        expect(record.title).toBe("Evening rooftop adda");
        expect(record.denseParagraph).toContain("rooftops");
        expect(ws.getTemplates()).toHaveLength(1);
        expect(ws.getTemplates()[0].id).toBe(record.id);
    });

    it("updateRecord flips a block into the template library and back out", async () => {
        const record = await ws.createRecord({ startHour: 10, endHour: 11, topic: "Morning walk" });
        expect(ws.getTemplates()).toHaveLength(0);

        await ws.updateRecord(record.id, { type: "weekdays" });
        expect(ws.getTemplates()).toHaveLength(1);
        expect(ws.getTemplates()[0].type).toBe("weekdays");

        await ws.updateRecord(record.id, { type: "once" });
        expect(ws.getTemplates()).toHaveLength(0);
    });

    it("updateTemplate edits the library and today's placed copy", async () => {
        const record = await ws.createRecord({ startHour: 10, endHour: 11, topic: "Morning walk", type: "forever" });

        const updated = await ws.updateTemplate(record.id, { title: "Morning constitution walk" });

        expect(updated?.title).toBe("Morning constitution walk");
        expect(ws.getTemplates()[0].title).toBe("Morning constitution walk");
        expect(ws.schedule.find(r => r.id === record.id)?.title).toBe("Morning constitution walk");
    });

    it("deleteTemplate removes the library entry and its placed copy", async () => {
        const record = await ws.createRecord({ startHour: 10, endHour: 11, topic: "Morning walk", type: "forever" });

        await expect(ws.deleteTemplate(record.id)).resolves.toBe(true);

        expect(ws.getTemplates()).toHaveLength(0);
        expect(ws.schedule.some(r => r.id === record.id)).toBe(false);
    });
});

describe("WorldSetter — persona edits regenerate upcoming deltas", () => {
    it("drops only FUTURE delta blocks and preserves user blocks + past deltas", async () => {
        // Simulate 10:00 with a past delta, a future delta and a user block.
        world.now = new Date(2026, 7, 25, 10, 0);
        const pastDelta = makeRecord(8, 9, "Past delta", { source: "delta" });
        const futureDelta = makeRecord(10, 11, "Future delta", { source: "delta" });
        const userBlock = makeRecord(11, 13, "User planned trip", { source: "user" });
        ws.schedule = [pastDelta, futureDelta, userBlock];

        vi.spyOn(ws.geminiClient, "streamGenerate").mockResolvedValue({ text: "" });

        await ws.regenerateUpcomingDeltas();

        const ids = ws.schedule.map(r => r.id);
        // Past delta and the user block survive; the future delta is replaced
        // by a freshly generated delta in the same window.
        expect(ids).toContain(pastDelta.id);
        expect(ids).toContain(userBlock.id);
        expect(ids).not.toContain(futureDelta.id);
        expect(ws.schedule.some(r => r.source === "delta" && r.startHour === 10 && r.endHour === 11)).toBe(true);
        expect(ws.schedule.find(r => r.id === userBlock.id)?.topic).toBe("User planned trip");
    });
});
