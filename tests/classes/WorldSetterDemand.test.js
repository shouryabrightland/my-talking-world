// @ts-check

/**
 * @file WorldSetterDemand.test.js
 * Tests for XML parsing of <narrative_report> in WorldSetter and proper fallback if fields are missing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───

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

// The planner resolves its Gemini model ladder exclusively through the pool.
vi.mock("../../src/classes/lib/GeminiModelResolver.js", () => ({
    default: class MockGeminiModelPool {
        constructor() {
            this.candidates = [{ id: "mock-gemini", tier: 1, version: 1 }];
            this.failures = [];
        }
        async getCandidates() { return this.candidates; }
        async getActiveModel() { return this.candidates.length > 0 ? this.candidates[0].id : null; }
        reportFailure(id, status) { this.failures.push({ id, status }); return true; }
        reportSuccess() {}
    }
}));

const promptCapture = vi.hoisted(() => ({
    systems: /** @type {Array<() => unknown>} */ ([]),
    users: /** @type {Array<() => unknown>} */ ([])
}));

vi.mock("../../src/classes/PromptBuilder.js", () => ({
    default: class MockPromptBuilder {
        constructor() {
            promptCapture.systems = [];
            promptCapture.users = [];
        }
        async build() { return { messages: [] }; }
        useSystem(fn) { promptCapture.systems.push(fn); }
        useUser(fn) { promptCapture.users.push(fn); }
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
        city: "Mock City",
        temperature: "25°C",
        weather: "Sunny",
        humidity: "50%",
        todayCelebration: "None",
        upcomingFestivals: [],
        newsHeadlines: [],
        updatedAt: Date.now()
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

function makeMockWorld() {
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
        now: new Date(),
        date: "Sat Aug 25 2026",
        time: "14:00",
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

// ─── Tests ───

describe("WorldSetter — Narrative Report Parsing (via applyUserDemand)", () => {
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
        // The planner is Gemini-only: streamGenerate is the single generation path.
        ws.geminiClient.streamGenerate = async () => ({ text: "", model: "mock" });
    });

    it("parses a complete <narrative_report> from applyUserDemand", async () => {
        const mockXml = `
            <demand_resolution>
                <summary_line_1>Scheduled physics study at 5pm</summary_line_1>
                <summary_line_2>Between snack and games</summary_line_2>
                <narrative_report>
                    <summary>Physics study session at 5pm has been scheduled between snack break and evening games.</summary>
                    <continuity_impact>The afternoon snack block now transitions smoothly into the study session, with Ben offering to help explain concepts.</continuity_impact>
                    <character_shifts>
                        <shift id="tom" name="Tom">Eager to impress by sharing physics facts he Googled</shift>
                        <shift id="angela" name="Angela">Wants to photograph the whiteboard for her notes</shift>
                    </character_shifts>
                    <transition_hooks>Lead-in: Ben mentions he found an interesting article about quantum physics. Lead-out: The group decides to take a break after the intense session.</transition_hooks>
                </narrative_report>
                <schedule>
                    <block start="17.0" end="18.0">
                        <topic>Physics study session</topic>
                        <goals><main>Learn together</main></goals>
                    </block>
                </schedule>
            </demand_resolution>
        `;

        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });
        const result = await ws.applyUserDemand("Study physics at 5pm");

        expect(ws.pendingProposal.report).toBeDefined();
        expect(ws.pendingProposal.report.summary).toBe("Physics study session at 5pm has been scheduled between snack break and evening games.");
        expect(ws.pendingProposal.report.continuityImpact).toBe("The afternoon snack block now transitions smoothly into the study session, with Ben offering to help explain concepts.");
        expect(ws.pendingProposal.report.characterShifts).toHaveLength(2);
        expect(ws.pendingProposal.report.characterShifts[0].id).toBe("tom");
        expect(ws.pendingProposal.report.characterShifts[0].name).toBe("Tom");
        expect(ws.pendingProposal.report.characterShifts[0].motivation).toBe("Eager to impress by sharing physics facts he Googled");
        expect(ws.pendingProposal.report.characterShifts[1].id).toBe("angela");
        expect(ws.pendingProposal.report.characterShifts[1].motivation).toBe("Wants to photograph the whiteboard for her notes");
        expect(ws.pendingProposal.report.transitionHooks).toContain("Lead-in:");
        expect(ws.pendingProposal.report.transitionHooks).toContain("Lead-out:");
    });

    it("returns safe defaults when <narrative_report> is missing entirely", async () => {
        const mockXml = `<demand_resolution><summary_line_1>Done</summary_line_1><schedule><block start="14.0" end="15.0"><topic>Test</topic><goals><main>Goal</main></goals></block></schedule></demand_resolution>`;

        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });
        const result = await ws.applyUserDemand("Test demand");

        expect(ws.pendingProposal.report).toBeDefined();
        expect(ws.pendingProposal.report.summary).toBe("Schedule updated with the requested activity.");
        expect(ws.pendingProposal.report.continuityImpact).toBeUndefined();
        expect(ws.pendingProposal.report.characterShifts).toBeUndefined();
        expect(ws.pendingProposal.report.transitionHooks).toBeUndefined();
    });

    it("handles partial <narrative_report> with only summary", async () => {
        const mockXml = `
            <demand_resolution>
                <summary_line_1>Quick update</summary_line_1>
                <narrative_report>
                    <summary>Added a study block at 5pm.</summary>
                </narrative_report>
                <schedule>
                    <block start="17.0" end="18.0">
                        <topic>Study session</topic>
                        <goals><main>Learn</main></goals>
                    </block>
                </schedule>
            </demand_resolution>
        `;

        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });
        const result = await ws.applyUserDemand("Study at 5pm");

        expect(ws.pendingProposal.report.summary).toBe("Added a study block at 5pm.");
        expect(ws.pendingProposal.report.continuityImpact).toBeUndefined();
        expect(ws.pendingProposal.report.characterShifts).toBeUndefined();
        expect(ws.pendingProposal.report.transitionHooks).toBeUndefined();
    });

    it("handles <character_shifts> with empty list", async () => {
        const mockXml = `
            <demand_resolution>
                <summary_line_1>Quick update</summary_line_1>
                <narrative_report>
                    <summary>Quick update to the schedule.</summary>
                    <character_shifts></character_shifts>
                </narrative_report>
                <schedule>
                    <block start="17.0" end="18.0">
                        <topic>Activity</topic>
                        <goals><main>Goal</main></goals>
                    </block>
                </schedule>
            </demand_resolution>
        `;

        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });
        const result = await ws.applyUserDemand("Do something");

        expect(ws.pendingProposal.report.summary).toBe("Quick update to the schedule.");
        expect(ws.pendingProposal.report.characterShifts).toBeUndefined();
    });

    it("strips <think> tags from the XML before parsing", async () => {
        const mockXml = `
<think>Let me plan the study session carefully...
</think>
            <demand_resolution>
                <summary_line_1>Scheduled study</summary_line_1>
                <narrative_report>
                    <summary>Physics study session scheduled at 5pm.</summary>
                    <continuity_impact>Smooth flow from snack to study.</continuity_impact>
                </narrative_report>
                <schedule>
                    <block start="17.0" end="18.0">
                        <topic>Study</topic>
                        <goals><main>Learn</main></goals>
                    </block>
                </schedule>
            </demand_resolution>
        `;

        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });
        const result = await ws.applyUserDemand("Study physics");

        expect(ws.pendingProposal.report.summary).toBe("Physics study session scheduled at 5pm.");
        expect(ws.pendingProposal.report.continuityImpact).toBe("Smooth flow from snack to study.");
    });

    it("handles empty XML response gracefully", async () => {
        ws.geminiClient.streamGenerate = async () => ({ text: "", model: "mock" });
        const result = await ws.applyUserDemand("Do something");

        expect(ws.pendingProposal.report).toBeDefined();
        expect(ws.pendingProposal.report.summary).toBe("Schedule updated with the requested activity.");
        expect(ws.pendingProposal.report.continuityImpact).toBeUndefined();
        expect(ws.pendingProposal.report.characterShifts).toBeUndefined();
        expect(ws.pendingProposal.report.transitionHooks).toBeUndefined();
    });

    it("returns DemandReport with schedule in applyUserDemand result", async () => {
        const mockXml = `
            <demand_resolution>
                <summary_line_1>Scheduled physics study at 5pm</summary_line_1>
                <summary_line_2>Between snack and games with lead-up hooks</summary_line_2>
                <narrative_report>
                    <summary>Physics study session added at 5pm.</summary>
                    <continuity_impact>Enhances the afternoon flow.</continuity_impact>
                </narrative_report>
                <schedule>
                    <block start="14.0" end="15.0">
                        <topic>Afternoon snack</topic>
                        <goals><main>Relax</main></goals>
                    </block>
                    <block start="17.0" end="18.0">
                        <topic>Physics study session</topic>
                        <goals><main>Learn together</main></goals>
                    </block>
                </schedule>
            </demand_resolution>
        `;

        // Override streamGenerate to return our mock XML
        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });

        const result = await ws.applyUserDemand("I want to study physics at 5pm");

        expect(result.line1).toBe("Scheduled physics study at 5pm");
        expect(result.line2).toBe("Between snack and games with lead-up hooks");
        expect(ws.pendingProposal.report).toBeDefined();
        expect(ws.pendingProposal.report.summary).toBe("Physics study session added at 5pm.");
        expect(ws.pendingProposal.report.continuityImpact).toBe("Enhances the afternoon flow.");
        expect(result.schedule).toBeDefined();
        expect(Array.isArray(result.schedule)).toBe(true);
    });

    it("preserves individual goals for ALL 6 characters in generated schedule blocks", async () => {
        const mockXml = `
            <demand_resolution>
                <summary_line_1>Scheduled evening park outing</summary_line_1>
                <summary_line_2>Leads into the night wind-down block</summary_line_2>
                <schedule>
                    <block start="17.0" end="18.0">
                        <topic>Evening park outing</topic>
                        <goals>
                            <main>Spend the evening outdoors together</main>
                            <goal id="tom" name="Tom">Rally the group for the outing</goal>
                            <goal id="angela" name="Angela">Document the evening on her phone</goal>
                            <goal id="ben" name="Ben">Scout the best spot in the park</goal>
                            <goal id="ginger" name="Ginger">Race everyone to the benches</goal>
                            <goal id="hank" name="Hank">Grab snacks for the group</goal>
                            <goal id="becca" name="Becca">Organize a quick football match</goal>
                        </goals>
                        <pre_plot>The group finishes work and head out</pre_plot>
                        <post_plot>They walk home as the sky darkens</post_plot>
                        <facts><fact>Park gate is open</fact></facts>
                    </block>
                </schedule>
            </demand_resolution>
        `;

        ws.geminiClient.streamGenerate = async () => ({ text: mockXml, model: "mock" });
        await ws.applyUserDemand("Evening outing at the park");

        // Goals are staged in the pending proposal before acceptance.
        const proposedBlocks = ws.pendingProposal.changes
            .filter(c => c.action === "add")
            .map(c => c.block);
        expect(proposedBlocks.length).toBeGreaterThan(0);

        const proposedIds = proposedBlocks[0].characterGoals.map(g => g.id);
        expect(proposedIds).toHaveLength(6);
        for (const id of ["tom", "angela", "ben", "ginger", "hank", "becca"]) {
            expect(proposedIds).toContain(id);
        }

        // After accepting, the committed schedule carries all 6 goals too.
        await ws.acceptProposal();
        const committedIds = ws.schedule[0].characterGoals.map(g => g.id);
        expect(committedIds).toHaveLength(6);
        for (const id of ["tom", "angela", "ben", "ginger", "hank", "becca"]) {
            expect(committedIds).toContain(id);
        }
    });
});

describe("WorldSetter — Demand Engine (Task 4)", () => {
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
    });

    it("enriches the demand prompt with cast personas, environment and the dense_paragraph schema", async () => {
        world.members.set("tom", { id: "tom", name: "Tom", age: 20, about: "Overconfident leader" });
        world.environment = {
            city: "Lucknow", temperature: "34°C", weather: "Sunny", humidity: "60%",
            todayCelebration: "None", upcomingFestivals: [], upcomingEvents: [],
            newsHeadlines: ["Headline one"], updatedAt: Date.now()
        };
        ws.geminiClient.streamGenerate = async () => ({ text: "", model: "mock" });

        await ws.applyUserDemand("Study physics at 5pm");

        const text = promptCapture.systems.map(fn => fn()).filter(t => typeof t === "string").join("\n");
        expect(text).toContain("<cast_profiles>");
        expect(text).toContain('id="tom"');
        expect(text).toContain('age="20"');
        expect(text).toContain("Overconfident leader");
        expect(text).toContain("<environment>");
        expect(text).toContain("34°C");
        expect(text).toContain("Headline one");
        // Task 4.1: the demand XML schema now REQUIRES a dense_paragraph.
        expect(text).toContain("<dense_paragraph>");
    });

    it("smart interval splicing: an accepted demand splits ONLY the overlapping block", async () => {
        const movie = makeRecord(16, 19, "Afternoon movie");
        const night = makeRecord(20, 22, "Night banter");
        ws.schedule = [movie, night];

        ws.geminiClient.streamGenerate = async () => ({
            text: `<demand_resolution><summary_line_1>Study scheduled</summary_line_1><schedule><block start="17" end="18"><topic>Physics study</topic><dense_paragraph>Books out on the table.</dense_paragraph><goals><main>Learn</main></goals></block></schedule></demand_resolution>`,
            model: "mock"
        });

        await ws.applyUserDemand("Study physics at 5pm");
        await ws.acceptProposal();

        const byTopic = ws.schedule.filter(r => r.topic === "Afternoon movie");
        // The overlapping block was SPLIT around the demanded window...
        expect(byTopic).toHaveLength(2);
        expect(byTopic[0].startHour).toBe(16);
        expect(byTopic[0].endHour).toBe(17);
        expect(byTopic[1].startHour).toBe(18);
        expect(byTopic[1].endHour).toBe(19);
        // ...the demanded block sits exactly in the spliced window...
        const study = ws.schedule.find(r => r.topic === "Physics study");
        expect(study?.startHour).toBe(17);
        expect(study?.endHour).toBe(18);
        // ...and unrelated blocks are byte-for-byte untouched.
        expect(night.startHour).toBe(20);
        expect(night.endHour).toBe(22);
        expect(ws.schedule).toHaveLength(4);
    });

    it("removes a block outright when the demanded window fully covers it", async () => {
        const chai = makeRecord(17, 18, "Chai break");
        const night = makeRecord(20, 22, "Night banter");
        ws.schedule = [chai, night];

        ws.geminiClient.streamGenerate = async () => ({
            text: `<demand_resolution><summary_line_1>Study scheduled</summary_line_1><schedule><block start="17" end="18"><topic>Physics study</topic><goals><main>Learn</main></goals></block></schedule></demand_resolution>`,
            model: "mock"
        });

        await ws.applyUserDemand("Study physics at 5pm");
        await ws.acceptProposal();

        expect(ws.schedule.some(r => r.topic === "Chai break")).toBe(false);
        expect(ws.schedule.some(r => r.topic === "Physics study")).toBe(true);
        expect(ws.schedule.some(r => r.topic === "Night banter")).toBe(true);
    });

    it("parses recurrence keywords (daily/weekdays) and registers the block as a template", async () => {
        ws.schedule = [makeRecord(20, 22, "Night banter")];
        ws.geminiClient.streamGenerate = async () => ({
            text: `<demand_resolution><summary_line_1>Daily study scheduled</summary_line_1><schedule><block start="17" end="18"><topic>Daily physics study</topic><goals><main>Learn</main></goals></block></schedule></demand_resolution>`,
            model: "mock"
        });

        await ws.applyUserDemand("Study physics daily at 5pm");
        await ws.acceptProposal();

        const daily = ws.schedule.find(r => r.topic === "Daily physics study");
        expect(daily?.type).toBe("forever");
        // The recurring block is registered into world:schedule_templates.
        expect(ws.getTemplates()).toHaveLength(1);
        expect(ws.getTemplates()[0].topic).toBe("Daily physics study");

        // "weekdays" maps to the weekdays selector too.
        ws.geminiClient.streamGenerate = async () => ({
            text: `<demand_resolution><summary_line_1>Weekday practice</summary_line_1><schedule><block start="7" end="8"><topic>Weekday cricket practice</topic><goals><main>Practice</main></goals></block></schedule></demand_resolution>`,
            model: "mock"
        });
        await ws.applyUserDemand("Cricket practice on weekdays at 7am");
        await ws.acceptProposal();

        const practice = ws.schedule.find(r => r.topic === "Weekday cricket practice");
        expect(practice?.type).toBe("weekdays");
        expect(ws.getTemplates().some(t => t.topic === "Weekday cricket practice")).toBe(true);
    });

    it("instant chat bridge: an accepted demand covering the current hour emits DEMAND_APPLIED", async () => {
        world.now = new Date(2026, 7, 25, 17, 30);
        // Realistic tick: resolve the active record like World.tick() does.
        world.tick = () => { world.activeSchedule = ws.getActiveRecord(world.now); };
        ws.schedule = [makeRecord(16, 19, "Afternoon movie")];

        /** @type {any[]} */
        const applied = [];
        world.events.on("world:demand:applied", b => applied.push(b));

        ws.geminiClient.streamGenerate = async () => ({
            text: `<demand_resolution><summary_line_1>Study scheduled</summary_line_1><schedule><block start="17" end="18"><topic>Physics study</topic><goals><main>Learn</main></goals></block></schedule></demand_resolution>`,
            model: "mock"
        });

        await ws.applyUserDemand("Study physics right now");
        await ws.acceptProposal();

        expect(applied).toHaveLength(1);
        expect(applied[0].topic).toBe("Physics study");
        // world.activeSchedule reflects the new block immediately (tick ran).
        expect(ws.world.activeSchedule?.topic).toBe("Physics study");
    });

    it("does NOT emit DEMAND_APPLIED when the accepted demand is in the future", async () => {
        world.now = new Date(2026, 7, 25, 9, 0);
        ws.schedule = [makeRecord(16, 19, "Afternoon movie")];

        /** @type {any[]} */
        const applied = [];
        world.events.on("world:demand:applied", b => applied.push(b));

        ws.geminiClient.streamGenerate = async () => ({
            text: `<demand_resolution><summary_line_1>Study scheduled</summary_line_1><schedule><block start="17" end="18"><topic>Physics study</topic><goals><main>Learn</main></goals></block></schedule></demand_resolution>`,
            model: "mock"
        });

        await ws.applyUserDemand("Study physics at 5pm");
        await ws.acceptProposal();

        expect(applied).toHaveLength(0);
    });
});
