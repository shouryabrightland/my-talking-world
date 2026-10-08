// @ts-check

/**
 * @file WorldSetterReasoning.test.js
 * Task 7 — reasoning must never drive schedule block detection:
 * - THINKING-phase events fire while the model reasons.
 * - A reasoning preamble that merely MENTIONS `<schedule>` / `<block>` emits
 *   ZERO BLOCK events and never appears in a TEXT payload.
 * - Once real `<schedule>` output streams, BLOCK events fire normally.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Controllable Gemini stream script (set per test) ─────────────────────

const streamState = vi.hoisted(() => ({
    /** @type {Array<{ thinking?: string, text?: string }>} */
    script: []
}));

// ─── Mocks ────────────────────────────────────────────────────────────────

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
        constructor() {}
        async getItem() { return null; }
        async setItem() {}
        async removeItem() {}
        async clear() {}
    }
}));

vi.mock("../../src/classes/GeminiClient.js", () => ({
    default: class MockGeminiClient {
        constructor() {
            /** @type {Record<string, Function[]>} */
            const listeners = {};
            this.events = {
                /** @param {string} ev @param {Function} fn */
                on(ev, fn) {
                    (listeners[ev] = listeners[ev] || []).push(fn);
                    return () => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); };
                },
                /** @param {string} ev @param {any} data */
                emit(ev, data) {
                    for (const fn of [...(listeners[ev] || [])]) fn(data);
                }
            };
        }
        async streamGenerate() {
            let fullText = "";
            for (const step of streamState.script) {
                if (step.thinking) this.events.emit("thinking", step.thinking);
                if (step.text) {
                    fullText += step.text;
                    this.events.emit("text", step.text);
                }
            }
            return { text: fullText, model: "mock-gemini" };
        }
        async generateText() { return { text: "", model: "mock-gemini", thinking: null }; }
    },
    GOOGLE_SEARCH_TOOL: [],
    DEEP_THINKING_BUDGET: 1024,
    STABILIZER_THINKING_BUDGET: 128
}));

// The planner resolves its Gemini ladder exclusively through the pool; without
// a key the real pool stays empty and the stream never runs.
vi.mock("../../src/classes/lib/GeminiModelResolver.js", () => ({
    default: class MockGeminiModelPool {
        constructor() {
            /** @type {Array<{id: string, tier?: number, version?: number}>} */
            this.candidates = [{ id: "gemini-mock-flash", tier: 1, version: 3 }];
        }
        async getCandidates() { return this.candidates; }
        async getActiveModel() { return this.candidates.length > 0 ? this.candidates[0].id : null; }
        reportFailure() { return true; }
        reportSuccess() {}
    }
}));

const promptCapture = vi.hoisted(() => ({ systems: [], users: [] }));

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
        static stripIncompleteTrailingRecords(buf) { return buf; }
        static parseRecords() { return []; }
    }
}));

vi.mock("../../src/classes/lib/XmlEncoder.js", () => ({
    default: { encode(s) { return s; }, decode(s) { return s; } }
}));

vi.mock("../../src/util/environment.js", () => ({
    getEnvironmentSnapshot: async () => null
}));

vi.mock("../../src/util/Constants.js", () => ({
    DEFAULT_GEMINI_MODEL: "mock-gemini",
    DEFAULT_CHAT_MODEL: "mock-groq",
    GEMINI_MAX_OUTPUT_TOKENS: 4096,
    PROMPT_DEMAND_TASK: "mock demand task",
    PROMPT_DEMAND_RULES: ["rule1"],
    PROMPT_RESTABILIZER_TASK: "mock restab task",
    PROMPT_RESTABILIZER_RULES: ["rule1"]
}));

// ─── Import after mocks ───────────────────────────────────────────────────

import WorldSetter, { PlannerStreamEvents } from "../../src/classes/WorldSetter.js";

function makeMockWorld() {
    return {
        events: {
            _em: {},
            /** @param {string} event @param {Function} handler */
            on(event, handler) {
                if (!this._em[event]) this._em[event] = [];
                this._em[event].push(handler);
                return () => { this._em[event] = this._em[event].filter(h => h !== handler); };
            },
            /** @param {string} event @param {any} data */
            emit(event, data) {
                for (const h of [...(this._em[event] || [])]) h(data);
            }
        },
        now: new Date(2026, 7, 25, 14, 0, 0),
        date: "Tue Aug 25 2026",
        time: "14:00",
        environment: null,
        User: { id: "me", name: "Player" },
        unifiedMemory: { getEntriesForMember: () => [], toTextStack: () => "" },
        members: new Map(),
        tick() {}
    };
}

const loggerMock = {
    child() { return this; },
    info() {},
    warn() {},
    error() {},
    debug() {}
};

const REAL_SCHEDULE =
    "<schedule><block start=\"14\" end=\"15\"><topic>Chai at the riverfront</topic><main>Hang out</main></block></schedule>";

describe("WorldSetter — reasoning vs schedule output separation (Task 7)", () => {
    /** @type {any} */
    let world;
    /** @type {WorldSetter} */
    let setter;
    /** @type {string[]} */
    let order;
    /** @type {any[]} */
    let blocks;
    /** @type {string[]} */
    let textPayloads;

    beforeEach(() => {
        streamState.script = [];
        world = makeMockWorld();
        setter = new WorldSetter({ logger: loggerMock, world });

        order = [];
        blocks = [];
        textPayloads = [];

        world.events.on(PlannerStreamEvents.THINKING, () => order.push("thinking"));
        world.events.on(PlannerStreamEvents.TEXT, (/** @type {string} */ t) => {
            order.push("text");
            textPayloads.push(t);
        });
        world.events.on(PlannerStreamEvents.BLOCK, (/** @type {any} */ b) => {
            order.push("block");
            blocks.push(b);
        });
    });

    it("emits a THINKING phase while the model reasons and ZERO blocks", async () => {
        // Reasoning that merely MENTIONS the schedule XML must never count.
        streamState.script = [{
            thinking: "Let me plan. I will write a <schedule> with three <block> tags about Hazratganj."
        }];

        await setter.planHorizon(world.now);

        expect(order).toContain("thinking");
        expect(blocks).toHaveLength(0);
        // Reasoning never lands in a TEXT payload either.
        expect(textPayloads.every(t => !t.includes("I will write a <schedule>"))).toBe(true);
    });

    it("streams THINKING first, then BLOCK once real <schedule> output arrives", async () => {
        streamState.script = [
            { thinking: "I still need to decide the <block> layout before writing anything." },
            { text: REAL_SCHEDULE }
        ];

        await setter.planHorizon(world.now);

        expect(order[0]).toBe("thinking");
        expect(blocks).toHaveLength(1);
        expect(blocks[0].startHour).toBe(14);
        expect(blocks[0].endHour).toBe(15);
        expect(blocks[0].topic).toBe("Chai at the riverfront");

        // The final TEXT payload is reasoning-free output.
        const lastText = textPayloads[textPayloads.length - 1];
        expect(lastText).toContain("<schedule>");
        expect(lastText).not.toContain("I still need to decide");
        expect(order.indexOf("thinking")).toBeLessThan(order.indexOf("block"));
    });

    it("never fires a BLOCK for a prose preamble that mentions the tags (Gemma)", async () => {
        // Gemma-style inline preamble: no thought parts and no think tags, just
        // prose TALKING ABOUT the XML it is about to emit. The complete
        // `<block>...</block>` requirement must keep detection honest.
        streamState.script = [
            { text: "I am only reasoning about <schedule> and <block> structure for now." },
            { text: REAL_SCHEDULE }
        ];

        await setter.planHorizon(world.now);

        // The prose mentions <block> but never closes one → exactly ONE block
        // is emitted, from the real schedule output.
        expect(blocks).toHaveLength(1);
        expect(blocks[0].topic).toBe("Chai at the riverfront");

        // The output XML survives sanitization intact.
        const lastText = textPayloads[textPayloads.length - 1];
        expect(lastText).toContain("<schedule>");
        expect(lastText).toContain("<topic>Chai at the riverfront</topic>");
    });
});

describe("WorldSetter.stripReasoningSpans", () => {
    it("removes paired, self-delimited and thought-tag reasoning spans", () => {
        expect(WorldSetter.stripReasoningSpans("a <think>whatever</think> b")).toBe("a  b");
        expect(WorldSetter.stripReasoningSpans("a <?think>whatever<?think>b")).toBe("a b");
        expect(WorldSetter.stripReasoningSpans("a [think]whatever[think]b")).toBe("a b");
        expect(WorldSetter.stripReasoningSpans("a <thought>x</thought>b")).toBe("a b");
    });

    it("swallows an unclosed reasoning preamble so nothing downstream sees it", () => {
        expect(WorldSetter.stripReasoningSpans("out <?think>still reasoning <schedule><block>")).toBe("out ");
        expect(WorldSetter.stripReasoningSpans("out [think]still reasoning <schedule>")).toBe("out ");
    });

    it("is a no-op for plain schedule XML", () => {
        const xml = "<schedule><block start=\"14\" end=\"15\"><topic>x</topic></block></schedule>";
        expect(WorldSetter.stripReasoningSpans(xml)).toBe(xml);
        expect(WorldSetter.stripReasoningSpans("")).toBe("");
        expect(WorldSetter.stripReasoningSpans(/** @type {any} */ (null))).toBe("");
    });
});
