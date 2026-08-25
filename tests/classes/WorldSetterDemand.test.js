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
    }
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
    PROMPT_SCHEDULER_TASK: "mock task",
    PROMPT_SCHEDULER_RULES: ["rule1"],
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
        User: { memory: { values() { return []; } } },
        members: new Map(),
        tick() {}
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
            logger: { child: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
            world
        });
        // Mock generatePlannerXml to return controlled XML
        ws.geminiClient.streamGenerate = async () => ({ text: "", model: "mock" });
        ws.groqClient.streamChat = async () => "";
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

        ws.groqClient.streamChat = async () => mockXml;
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

        ws.groqClient.streamChat = async () => mockXml;
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

        ws.groqClient.streamChat = async () => mockXml;
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

        ws.groqClient.streamChat = async () => mockXml;
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

        ws.groqClient.streamChat = async () => mockXml;
        const result = await ws.applyUserDemand("Study physics");

        expect(ws.pendingProposal.report.summary).toBe("Physics study session scheduled at 5pm.");
        expect(ws.pendingProposal.report.continuityImpact).toBe("Smooth flow from snack to study.");
    });

    it("handles empty XML response gracefully", async () => {
        ws.groqClient.streamChat = async () => "";
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

        // Override streamChat to return our mock XML
        ws.groqClient.streamChat = async () => mockXml;

        const result = await ws.applyUserDemand("I want to study physics at 5pm");

        expect(result.line1).toBe("Scheduled physics study at 5pm");
        expect(result.line2).toBe("Between snack and games with lead-up hooks");
        expect(ws.pendingProposal.report).toBeDefined();
        expect(ws.pendingProposal.report.summary).toBe("Physics study session added at 5pm.");
        expect(ws.pendingProposal.report.continuityImpact).toBe("Enhances the afternoon flow.");
        expect(result.schedule).toBeDefined();
        expect(Array.isArray(result.schedule)).toBe(true);
    });
});
