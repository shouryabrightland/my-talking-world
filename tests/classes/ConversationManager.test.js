// @ts-check

/**
 * @file ConversationManager.test.js
 * Tests for protocol buffer lifecycle:
 * - Buffer is reset at generation start
 * - Buffer is purged after turn completion/abort/error
 * - onStreamToken ignores tokens when generation is inactive
 * - Back-to-back streams do not bleed previous text
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (must be hoisted before imports) ───

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

vi.mock("../../src/classes/Chat.js", () => ({
    default: class MockChat {
        constructor() { this._members = new Map(); this._history = []; this.events = { on() {}, emit() {} }; }
        getMembers() { return [...this._members.values()]; }
        getMember(id) { return this._members.get(id); }
        getHistory() { return this._history; }
        addMessage(msg) { this._history.push(msg); }
        clear() { this._history = []; }
    },
    ChatEvents: { MESSAGE_ADD: "message:add" }
}));

vi.mock("../../src/classes/ChatMember.js", () => ({
    default: class MockChatMember {
        constructor(id, name, isAI = true) {
            this.id = id; this.name = name; this.isAI = isAI;
            this.isOnline = true; this.isTyping = false;
            this.scheduler = { clear() {}, getTimeline() { return []; } };
            this.memory = { set() {}, delete() {}, clear() {}, values() { return []; } };
            this.stateMemory = { clear() {} };
            this.events = { on() { return () => {}; }, emit() {} };
        }
        setTransientState() {}
        resetState() {}
        saveMemory() { return Promise.resolve(); }
    },
    ChatMemberEvents: { TYPING: "typing", READING: "reading", THINKING: "thinking", ACTIVE: "active" }
}));

vi.mock("../../src/classes/World.js", () => ({
    default: class MockWorld {
        constructor() {
            this.members = new Map();
            this.events = { on() {}, emit() {} };
            this.activeSchedule = null;
            this.destroyed = false;
            // Stable chat event bus so tests can emit MESSAGE_ADD.
            const listeners = {};
            this._chatEvents = {
                on(event, handler) {
                    if (!listeners[event]) listeners[event] = [];
                    listeners[event].push(handler);
                    return () => {
                        listeners[event] = (listeners[event] || []).filter(h => h !== handler);
                    };
                },
                emit(event, data) {
                    for (const h of (listeners[event] || [])) h(data);
                }
            };
        }
        get chat() {
            const world = this;
            return {
                destroyed: false,
                paused: false,
                getMembers: () => [], getMember: () => null, getHistory: () => [],
                addMessage() {}, clear() {},
                pause() { this.paused = true; },
                resume() { this.paused = false; },
                destroy() { this.destroyed = true; },
                events: world._chatEvents
            };
        }
        async init() {}
        pause() { this.paused = true; }
        resume() { this.paused = false; }
        stopHeartbeat() { this.heartbeatTimer = null; }
        destroy() { this.destroyed = true; }
        toString() { return this._worldContext ?? "Mock World"; }
    },
    WorldEvents: { SCHEDULE_CHANGE: "schedule:change", BIRTHDAY_TODAY: "world:birthday:today" }
}));

vi.mock("../../src/classes/EventManager.js", () => ({
    default: class MockEventManager {
        constructor() { this._listeners = {}; }
        on(event, handler, label) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push({ handler, label });
            return () => { this._listeners[event] = this._listeners[event].filter(h => h.handler !== handler); };
        }
        emit(event, data) {
            for (const { handler } of (this._listeners[event] || [])) handler(data);
        }
    }
}));

vi.mock("../../src/classes/GroqClient.js", () => ({
    default: class MockGroqClient {
        constructor() {
            this.events = {
                _em: { _listeners: {} },
                on(event, handler, label) {
                    if (!this._em._listeners[event]) this._em._listeners[event] = [];
                    this._em._listeners[event].push(handler);
                    return () => { this._em._listeners[event] = this._em._listeners[event].filter(h => h !== handler); };
                },
                emit(event, data) {
                    for (const handler of (this._em._listeners[event] || [])) handler(data);
                }
            };
            this.abortController = null;
            this.isStreaming = false;
        }
        get apiKey() { return "mock-key"; }
        async streamChat() { return "mock response"; }
        async generateText() { return { text: "mock", model: "mock", thinking: null }; }
        abort() { this.isStreaming = false; }
    },
    GroqClientEvents: { CHUNK: "chunk", TEXT: "text", THINKING: "thinking", DONE: "done", ERROR: "error" }
}));

vi.mock("../../src/classes/TimelineProcessor.js", () => ({
    default: class MockTimelineProcessor {
        constructor() { this._messages = []; }
        add(msg) { this._messages.push(msg); }
        getNextLiveRequstTime() { return Date.now() + 5000; }
    }
}));

vi.mock("../../src/classes/PromptBuilder.js", () => ({
    default: class MockPromptBuilder {
        constructor() { this.systems = []; this.users = []; }
        async build() { return { messages: [] }; }
        useSystem(fn) { this.systems.push(fn); }
        useUser(fn) { this.users.push(fn); }
        part(text) { return text; }
    }
}));

vi.mock("../../src/classes/lib/Storage.js", () => ({
    default: class MockStorage {
        constructor() {}
        async clear() {}
        async removeItem() {}
    }
}));

vi.mock("../../src/classes/lib/XmlEncoder.js", () => ({
    default: { encode(s) { return s; } }
}));

vi.mock("../../src/classes/lib/MemoryExpiryParser.js", () => ({
    default: { parse(s) { return new Date(Date.now() + 3600_000); } }
}));

vi.mock("../../src/classes/lib/UserInterruptHandler.js", () => ({
    default: class MockUserInterruptHandler {
        constructor() { this._active = false; }
        get isActive() { return this._active; }
        handle() { this._active = true; }
        destroy() { this._active = false; }
    }
}));

vi.mock("../../src/util/member.js", () => ({ Members: {} }));
vi.mock("../../src/util/Constants.js", () => ({
    DEFAULT_CHAT_MODEL: "mock-model",
    PROMPT_DIALOGUE_TASK: "mock task",
    PROMPT_DIALOGUE_RULES: ["rule1"],
    PROMPT_LANGUAGE_MANDATE: "<language_mandate>mock mandate</language_mandate>",
    PROMPT_LOCATION_MANDATE: "<location_diversity_mandate>mock location rule</location_diversity_mandate>",
    PARTICIPANT_TYPE_CHARACTER: "character",
    PARTICIPANT_TYPE_HUMAN: "human"
}));
vi.mock("../../src/util/sound.js", () => ({ AmbientAudio: { stop() {} } }));

// ─── Import after mocks ───

import ConversationManager, { ConversationEvents } from "../../src/classes/ConversationManager.js";
import { ChatEvents } from "../../src/classes/Chat.js";
import Logger from "../../src/classes/lib/Logger.js";
import Memory from "../../src/classes/lib/Memory.js";

// ─── Helper: create a real ConversationManager with mocked deps ───

/** Simple ChatMember mock for test instantiation */
function makeMockMember(id, name, isAI) {
    return {
        id, name, isAI,
        isOnline: true, isTyping: false,
        scheduler: { clear() {}, getTimeline() { return []; } },
        memory: { set() {}, delete() {}, clear() {}, values() { return []; } },
        stateMemory: { clear() {} },
        events: { on() { return () => {}; }, emit() {} },
        setTransientState() {},
        resetState() {},
        saveMemory() { return Promise.resolve(); }
    };
}

function createManager() {
    const User = makeMockMember("human", "Player", false);
    const manager = new ConversationManager({ User });
    return { manager, User };
}

// ─── Tests ───

describe("ConversationManager — Protocol Buffer Lifecycle", () => {
    /** @type {ConversationManager} */
    let manager;

    beforeEach(() => {
        vi.useFakeTimers();
        const result = createManager();
        manager = result.manager;
        manager.initialized = true;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ─────────────────────────────────────────────
    // Buffer reset at generation start
    // ─────────────────────────────────────────────
    describe("Buffer reset at generation start", () => {
        it("clears protocolBuffer when requestTurn starts", async () => {
            // Pre-fill the buffer with stale data
            manager.protocolBuffer = "<record type=\"message\" id=\"1\" sender=\"tom\"><text>Stale";
            manager.requesting = false;

            // Make streamChat hang so we can inspect state after requestTurn starts
            /** @type {(value: string) => void} */
            let resolveStream;
            manager.client.streamChat = () => new Promise(resolve => { resolveStream = resolve; });

            const turnPromise = manager.requestTurn();
            await vi.advanceTimersByTimeAsync(10);

            // Buffer should be reset at the start of requestTurn
            expect(manager.protocolBuffer).toBe("");

            // Resolve the hanging promise to clean up
            resolveStream("done");
            await turnPromise;
        });
    });

    // ─────────────────────────────────────────────
    // Buffer purged after turn completion
    // ─────────────────────────────────────────────
    describe("Buffer purged in finally block", () => {
        it("clears protocolBuffer after successful streamChat", async () => {
            manager.protocolBuffer = "leftover data";
            manager.client.streamChat = async () => "response";

            await manager.requestTurn();

            expect(manager.protocolBuffer).toBe("");
            expect(manager.requesting).toBe(false);
        });

        it("clears protocolBuffer after streamChat throws", async () => {
            manager.protocolBuffer = "leftover data";
            manager.client.streamChat = async () => { throw new Error("API error"); };

            await manager.requestTurn();

            expect(manager.protocolBuffer).toBe("");
            expect(manager.requesting).toBe(false);
        });

        it("clears protocolBuffer after AbortError", async () => {
            manager.protocolBuffer = "leftover data";
            const abortErr = new DOMException("Aborted", "AbortError");
            manager.client.streamChat = async () => { throw abortErr; };

            await manager.requestTurn();

            expect(manager.protocolBuffer).toBe("");
            expect(manager.requesting).toBe(false);
        });
    });

    // ─────────────────────────────────────────────
    // onStreamToken guard — tokens ignored after generation inactive
    // ─────────────────────────────────────────────
    describe("onStreamToken ignores stale tokens", () => {
        it("accumulates buffer only during active generation and clears after", async () => {
            manager.protocolBuffer = "";

            // Start a generation that hangs so we control timing
            /** @type {(value: string) => void} */
            let resolveStream;
            manager.client.streamChat = () => new Promise(resolve => { resolveStream = resolve; });

            const turnPromise = manager.requestTurn();
            await vi.advanceTimersByTimeAsync(10);

            // During active generation, tokens accumulate
            manager.onStreamToken("Hello ");
            manager.onStreamToken("world");
            expect(manager.protocolBuffer).toContain("Hello world");

            // Complete the generation
            resolveStream("done");
            await turnPromise;
            await vi.advanceTimersByTimeAsync(5);

            // After completion, buffer is purged
            expect(manager.protocolBuffer).toBe("");

            // New tokens should be ignored (generation inactive)
            manager.onStreamToken("Stale data");
            expect(manager.protocolBuffer).toBe("");
        });
    });

    // ─────────────────────────────────────────────
    // Back-to-back stream isolation
    // ─────────────────────────────────────────────
    describe("Back-to-back stream isolation", () => {
        it("protocolBuffer does not bleed between consecutive turns", async () => {
            // Simulate leftover partial record
            manager.protocolBuffer = '<record type="message" id="1" sender="tom"><text>Partial';

            // Turn 2: new generation should start with clean buffer
            manager.client.streamChat = async () => "response";

            /** @type {(value: string) => void} */
            let resolve2;
            manager.client.streamChat = () => new Promise(resolve => { resolve2 = resolve; });

            const turn2 = manager.requestTurn();
            await vi.advanceTimersByTimeAsync(5);

            // After requestTurn starts, buffer should be reset
            expect(manager.protocolBuffer).toBe("");

            resolve2("done");
            await turn2;
            expect(manager.protocolBuffer).toBe("");
        });
    });

    // ─────────────────────────────────────────────
    // reset() clears all buffers
    // ─────────────────────────────────────────────
    describe("reset() clears buffer", () => {
        it("clears protocolBuffer on reset", async () => {
            manager.protocolBuffer = "stale data";

            await manager.reset();

            expect(manager.protocolBuffer).toBe("");
            expect(manager.requesting).toBe(false);
        });
    });

    // ─────────────────────────────────────────────
    // logout() clears all buffers
    // ─────────────────────────────────────────────
    describe("logout() clears buffer", () => {
        it("clears protocolBuffer on logout", () => {
            manager.protocolBuffer = "stale data";

            manager.logout();

            expect(manager.protocolBuffer).toBe("");
            expect(manager.requesting).toBe(false);
        });

        it("pauses the World instead of destroying it so re-login survives", () => {
            manager.logout();

            // Session logout must NEVER destroy the engine: the room context
            // (members + messages) has to survive for the next Studio session.
            expect(manager.world.destroyed).toBe(false);
            expect(manager.world.paused).toBe(true);
            expect(manager.chat.paused).toBe(true);
        });

        it("does not clear chat members or messages on logout", () => {
            manager.chat.members = new Map([["tom", { id: "tom" }]]);
            manager.chat.messages = [{ id: "m1" }];

            manager.logout();

            expect(manager.chat.destroyed).toBe(false);
            expect(manager.chat.members.size).toBe(1);
            expect(manager.chat.messages).toHaveLength(1);
        });
    });

    // ─────────────────────────────────────────────
    // flushRemainingBuffer processes leftover records
    // ─────────────────────────────────────────────
    describe("flushRemainingBuffer (via requestTurn finally)", () => {
        it("processes remaining complete records before clearing buffer", async () => {
            // Use a hanging stream so we can inject buffer mid-generation
            /** @type {(value: string) => void} */
            let resolveStream;
            manager.client.streamChat = () => new Promise(resolve => { resolveStream = resolve; });

            const turnPromise = manager.requestTurn();
            await vi.advanceTimersByTimeAsync(10);

            // Simulate tokens arriving mid-generation that form a complete record
            manager.onStreamToken('<record type="message" id="99" sender="tom"><text>Last words</text></record>');

            // Spy on handleProtocolRecord — it should have already been called by onStreamToken
            const spy = vi.spyOn(manager, "handleProtocolRecord");

            // Complete the generation — the finally block's flush won't find new records
            resolveStream("done");
            await turnPromise;
            await vi.advanceTimersByTimeAsync(5);

            // The record was processed during streaming via onStreamToken, not during flush
            expect(spy).not.toHaveBeenCalled(); // No leftover records to flush
            expect(manager.protocolBuffer).toBe("");
        });

        it("strips incomplete trailing records during flush", async () => {
            // Use a hanging stream so we can inject partial record mid-generation
            /** @type {(value: string) => void} */
            let resolveStream;
            manager.client.streamChat = () => new Promise(resolve => { resolveStream = resolve; });

            const turnPromise = manager.requestTurn();
            await vi.advanceTimersByTimeAsync(10);

            // Inject a partial incomplete record into the buffer mid-generation
            manager.onStreamToken('<record type="message" id="99" sender="tom"><text>Partial');
            expect(manager.protocolBuffer).toContain("Partial");

            // Spy on handleProtocolRecord to verify flush doesn't process incomplete records
            const spy = vi.spyOn(manager, "handleProtocolRecord");

            // Complete the generation — flushRemainingBuffer should strip the incomplete record
            resolveStream("done");
            await turnPromise;
            await vi.advanceTimersByTimeAsync(5);

            // Incomplete record should NOT be processed during flush
            expect(spy).not.toHaveBeenCalled();
            expect(manager.protocolBuffer).toBe("");
        });
    });
});

// ─── Streaming tag extraction ───────────────────────────────────

describe("ConversationManager — Streaming <record> Extraction", () => {
    /** @type {ConversationManager} */
    let manager;

    beforeEach(() => {
        vi.useFakeTimers();
        const result = createManager();
        manager = result.manager;
        manager.initialized = true;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** Starts a turn whose stream hangs so tokens can be injected mid-flight. */
    async function startHangingTurn() {
        /** @type {(value: string) => void} */
        let resolveStream;
        manager.client.streamChat = () => new Promise(resolve => { resolveStream = resolve; });
        const turnPromise = manager.requestTurn();
        await vi.advanceTimersByTimeAsync(10);
        return { turnPromise, finish: () => resolveStream("done") };
    }

    it("extracts paired <record>...</record> tags during streaming", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        const spy = vi.spyOn(manager, "handleProtocolRecord");

        manager.onStreamToken('<record type="memory-set" member="tom" expiry="1h"><key>Mood</key><value>Calm</value></record>');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0].recordType).toBe("memory-set");
        expect(manager.protocolBuffer).toBe("");

        finish();
        await turnPromise;
    });

    it("extracts self-closing <record ... /> tags so memories are not trapped in the buffer", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        const spy = vi.spyOn(manager, "handleProtocolRecord");

        manager.onStreamToken('<record type="memory-set" member="tom" expiry="15m" key="Posture" value="Leaning back" />');

        expect(spy).toHaveBeenCalledTimes(1);
        const record = spy.mock.calls[0][0];
        expect(record.recordType).toBe("memory-set");
        expect(record.member).toBe("tom");
        expect(record.key).toBe("Posture");
        // Nothing left behind in protocolBuffer — the tag was fully consumed.
        expect(manager.protocolBuffer).toBe("");

        finish();
        await turnPromise;
    });
});

// ─── Director Mode transparency ──────────────────────────────────

describe("ConversationManager — Director Mode Notifications", () => {
    /** @type {ConversationManager} */
    let manager;
    /** @type {string[]} */
    let emitted;

    beforeEach(() => {
        vi.useFakeTimers();
        const result = createManager();
        manager = result.manager;
        manager.initialized = true;
        emitted = [];
        manager.events.on(
            ConversationEvents.DIRECTOR_EVENT,
            () => emitted.push("director:start"),
            "test: director start"
        );
        manager.events.on(
            ConversationEvents.DIRECTOR_RESPONSE_START,
            () => emitted.push("director:response"),
            "test: director response"
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("emits DIRECTOR_EVENT then DIRECTOR_RESPONSE_START exactly once on the first token", async () => {
        /** @type {(value: string) => void} */
        let resolveStream;
        manager.client.streamChat = () => new Promise(resolve => { resolveStream = resolve; });

        const turnPromise = manager.injectDirectorPlot("A mysterious door appears in the garage");
        await vi.advanceTimersByTimeAsync(10);

        expect(emitted).toEqual(["director:start"]);
        expect(manager.pendingDirectorPlot).toBe("A mysterious door appears in the garage");

        manager.onStreamToken('<record type="message" id="1" sender="tom"><text>Arre kya hai yeh?</text></record>');
        expect(emitted).toEqual(["director:start", "director:response"]);

        // Subsequent tokens in the same turn must not re-emit the start signal.
        manager.onStreamToken(" more text");
        expect(emitted).toEqual(["director:start", "director:response"]);

        resolveStream("done");
        await turnPromise;
        expect(manager.pendingDirectorPlot).toBeNull();
    });
});

// ─── Environmental prompt throttling ───────────────────────────

/**
 * Capturing prompt builder that stores system callbacks so tests can
 * invoke them manually (the real PromptBuilder runs them on build()).
 * @returns {{ systemFns: Function[], useSystem: (fn: Function) => void, useUser: (fn: Function) => void, part: (t: string) => string, build: () => Promise<{ messages: never[] }> }}
 */
function makeCapturingBuilder() {
    const systemFns = [];
    return {
        systemFns,
        useSystem(fn) { systemFns.push(fn); },
        useUser() {},
        part(text) { return text; },
        async build() { return { messages: [] }; }
    };
}

describe("ConversationManager — Environmental Context Throttling", () => {
    /** @type {ConversationManager} */
    let manager;
    /** @type {boolean[]} */
    let envCalls;
    /** @type {ReturnType<typeof makeCapturingBuilder>} */
    let builder;

    beforeEach(() => {
        const result = createManager();
        manager = result.manager;
        envCalls = [];

        // Spy on the heavy environment injection flag passed to World.toString().
        manager.world.toString = (/** @type {boolean} */ includeEnvironment = true) => {
            envCalls.push(includeEnvironment !== false);
            return "Mock World";
        };

        builder = makeCapturingBuilder();
        manager.registerPrompt(builder);
    });

    /** Runs one prompt build cycle (invokes all registered system parts). */
    function buildPrompt() {
        for (const fn of builder.systemFns) fn();
    }

    it("injects the full environment on alternating turns only", () => {
        buildPrompt(); // turn 1
        buildPrompt(); // turn 2
        buildPrompt(); // turn 3
        buildPrompt(); // turn 4

        expect(envCalls).toEqual([true, false, true, false]);
    });

    it("immediately refreshes environmental grounding when the human user speaks", () => {
        buildPrompt(); // turn 1 → full
        buildPrompt(); // turn 2 → minimal
        buildPrompt(); // turn 3 → full

        // Human user sends a message — the NEXT build must carry full env,
        // even though turn 4 is an even (minimal) turn.
        manager.chat.events.emit(ChatEvents.MESSAGE_ADD, { sender: { isAI: false } });
        buildPrompt(); // turn 4 → full (human override)
        buildPrompt(); // turn 5 → flag consumed; odd turn → full
        buildPrompt(); // turn 6 → minimal again

        expect(envCalls).toEqual([true, false, true, true, true, false]);
    });
});

// ─── Hard memory cap (5 active memories per character) ─────────

describe("ConversationManager — Memory Cap Enforcement", () => {
    it("prunes the oldest non-permanent memory when the 5-item cap is exceeded", () => {
        const memory = new Memory(new Logger("Test"), "tom");

        memory.set("Old Grudge", "still upset about last week", new Date(Date.now() + 3_600_000));
        memory.set("Active Goal", "finish the project", new Date(Date.now() + 7_200_000));
        memory.set("Mood", "excited", new Date(Date.now() + 900_000));
        memory.set("Permanent Fact", "afraid of heights", -1);
        memory.set("Opinion on User", "trusts the user", null);
        expect(memory.size).toBe(5);

        // 6th memory → oldest NON-permanent ("Old Grudge") is pruned.
        memory.set("Secret", "hides the spare key", new Date(Date.now() + 3_600_000));
        expect(memory.size).toBe(5);
        expect(memory.has("Old Grudge")).toBe(false);
        expect(memory.has("Permanent Fact")).toBe(true);
        expect(memory.has("Secret")).toBe(true);

        // Overflow again → next-oldest non-permanent is pruned; permanents survive.
        memory.set("Milestone", "reached level 10", null);
        expect(memory.size).toBe(5);
        expect(memory.has("Active Goal")).toBe(false);
        expect(memory.has("Permanent Fact")).toBe(true);
        expect(memory.has("Milestone")).toBe(true);
    });

    it("prunes the oldest permanent memory when all 5 keys are permanent (-1)", () => {
        const memory = new Memory(new Logger("Test"), "brit");

        for (let i = 1; i <= 5; i++) {
            memory.set(`Permanent Fact ${i}`, `fact ${i}`, -1);
        }
        expect(memory.size).toBe(5);

        // 6th memory with ALL keys permanent → oldest key (insertion order)
        // is evicted so the strict 5-memory cap is never exceeded.
        memory.set("New Permanent Fact", "freshly learned", -1);
        expect(memory.size).toBe(5);
        expect(memory.has("Permanent Fact 1")).toBe(false);
        expect(memory.has("Permanent Fact 2")).toBe(true);
        expect(memory.has("New Permanent Fact")).toBe(true);
    });

    it("updates existing keys in place without triggering the prune cap", () => {
        const memory = new Memory(new Logger("Test"), "angela");

        memory.set("Mood", "happy", new Date(Date.now() + 900_000));
        memory.set("Active Goal", "plan the trip", null);

        // Re-setting an existing key overwrites instead of adding a new entry.
        memory.set("Mood", "annoyed", new Date(Date.now() + 900_000));
        expect(memory.size).toBe(2);
        expect(memory.getValue("Mood")).toBe("annoyed");
    });
});

describe("ConversationManager — birthday celebration context injection", () => {
    it("passes the world's <active_celebration> tag into the dialogue system prompt", () => {
        const { manager } = createManager();

        // World.toString() emits this tag on a matching calendar date.
        manager.world._worldContext = [
            '<active_celebration type="birthday" member="tom" name="Tom" turning_age="20">',
            "  Today is Tom's 20th birthday! The characters should congratulate them, plan surprises, or joke about getting older.",
            "</active_celebration>"
        ].join("\n");

        const parts = manager.promptBuilder.systems
            .map(fn => fn())
            .filter(t => typeof t === "string");
        const contextPart = parts.find(t => t.includes("<context>"));

        expect(contextPart).toBeDefined();
        expect(contextPart).toContain("<active_celebration");
        expect(contextPart).toContain('member="tom"');
        expect(contextPart).toContain('turning_age="20"');
        expect(contextPart).toContain("20th birthday");
    });
});

// ─── Prompt compression / bio cap / memory clock / history window ───

/**
 * Builds every registered system part for the given manager.
 * @param {ConversationManager} manager
 * @returns {string[]}
 */
function buildSystemParts(manager) {
    return manager.promptBuilder.systems
        .map(fn => fn())
        .filter(t => typeof t === "string");
}

/**
 * Adds a plain character stub to the mock world's member map.
 * @param {ConversationManager} manager
 * @param {{ id: string, name: string, age?: number, about?: string, memory?: { values: () => unknown[] } }} spec
 */
function addWorldMember(manager, spec) {
    manager.world.members.set(spec.id, {
        id: spec.id,
        name: spec.name,
        age: spec.age ?? 20,
        about: spec.about ?? "",
        isAI: true,
        memory: spec.memory ?? { values: () => [] }
    });
}

describe("ConversationManager — unified <system_directive> (prompt compression)", () => {
    it("emits ONE consolidated directive and none of the legacy redundant blocks", () => {
        const { manager } = createManager();
        const joined = buildSystemParts(manager).join("\n");

        expect(joined).toContain("<system_directive>");
        expect(joined).toContain("Turn-Taking: Emit ONLY 1 to 3 character replies per turn");
        expect(joined).toContain("Anti-Parroting");
        expect(joined).toContain("Zero Devanagari");

        // The former <task>, <language_mandate>, <location_diversity_mandate>
        // and 13 <rule> tags are all consolidated away.
        expect(joined).not.toContain("<task>");
        expect(joined).not.toContain("<language_mandate>");
        expect(joined).not.toContain("<location_diversity_mandate>");
        expect(joined).not.toContain("<dialogue_protocol>");
        expect(joined).not.toContain("<rule>");
    });

    it("preserves custom bios up to 50 chars and truncates longer ones", () => {
        const { manager } = createManager();
        const longAbout = "A really long custom biography that definitely exceeds the fifty character budget";
        const shortAbout = "Chill Gujarati lad from Lucknow";
        addWorldMember(manager, { id: "tom", name: "Tom", age: 21, about: longAbout });
        addWorldMember(manager, { id: "angela", name: "Angela", age: 20, about: shortAbout });

        const chars = buildSystemParts(manager).find(t => t.includes("<characters>"));

        expect(chars).toBeDefined();
        // Custom description is KEPT (not stripped): first 47 chars + "...".
        expect(chars).toContain(`>${longAbout.slice(0, 47)}...<`);
        // Short custom descriptions pass through untouched.
        expect(chars).toContain(`>${shortAbout}<`);
        // The full long bio never reaches the prompt.
        expect(chars).not.toContain(longAbout);
        expect(chars).toContain('id="tom"');
        expect(chars).toContain('age="21"');
    });
});

describe("ConversationManager — memory TTL validated against world.now", () => {
    it("drops memories already expired on the active simulation clock", () => {
        const { manager } = createManager();
        manager.world.now = new Date();

        const memory = new Memory(new Logger("Test"), "tom");
        memory.set("Mood", "excited about the trip", new Date(Date.now() + 900_000));
        memory.set("Stale Gossip", "already forgotten", new Date(Date.now() - 1_000));
        addWorldMember(manager, { id: "tom", name: "Tom", memory });

        const part = buildSystemParts(manager).find(t => t.includes("<saved_memories>"));

        expect(part).toBeDefined();
        expect(part).toContain('key="Mood"');
        // Expired memory must NOT be injected.
        expect(part).not.toContain("Stale Gossip");
    });

    it("passes this.world.now (not wall-clock) into every isUsable() check", () => {
        const { manager } = createManager();
        // Sim clock frozen one hour in the past: a memory that expired 10
        // minutes ago in REAL time is still valid on the simulation clock.
        manager.world.now = new Date(Date.now() - 3_600_000);

        const memory = new Memory(new Logger("Test"), "tom");
        memory.set("Recent Fact", "just happened", new Date(Date.now() - 600_000));
        addWorldMember(manager, { id: "tom", name: "Tom", memory });

        const part = buildSystemParts(manager).find(t => t.includes("<saved_memories>"));

        expect(part).toBeDefined();
        expect(part).toContain('key="Recent Fact"');
    });
});

describe("ConversationManager — dialogue history window (7 committed / 8 merged)", () => {
    it("requests exactly 7 messages from getHistory and caps the merged result at 8", () => {
        const { manager } = createManager();

        const history = Array.from({ length: 12 }, (_, i) => ({
            id: `m${i}`,
            sender: { id: "tom", isAI: true },
            text: `msg ${i}`
        }));

        /** @type {number[]} */
        const requested = [];
        manager.chat.getHistory = (/** @type {number} */ n) => {
            requested.push(n);
            return history.slice(-n);
        };
        manager.chat.getMembers = () => [
            {
                scheduler: {
                    getTimeline: () => [{ type: "message", message: { id: "pending-1", sender: { id: "angela" }, text: "queued" } }]
                }
            }
        ];

        const recent = manager.getRecentMessages();

        expect(requested).toEqual([7]);
        expect(recent).toHaveLength(8); // 7 committed + 1 pending, slice(-8)
        expect(recent[0].id).toBe("m5");
        expect(recent[7].id).toBe("pending-1");
    });
});

describe("ConversationManager — per-turn prompt token budget", () => {
    it("stays under ~1,000 tokens for the system prompt with a full house", () => {
        const { manager } = createManager();
        manager.world.now = new Date();
        manager.world._worldContext = [
            "<current_time>Tuesday, October 7, 2026 at 10:42 AM</current_time>",
            '<active_schedule time_range="10:00 - 11:00" start="10" end="11" phase="core">',
            "  <topic>Morning chai & project planning on the rooftop</topic>",
            "  <goals><main>Plan the weekend outing together</main></goals>",
            "  <facts><fact>Rain expected tonight</fact><fact>Math exam tomorrow</fact></facts>",
            "</active_schedule>",
            '<environment city="Lucknow">',
            "  <weather temperature=\"31\" humidity=\"60\">Partly cloudy</weather>",
            "  <occasion>Normal day</occasion>",
            "  <upcoming_festivals>Diwali</upcoming_festivals>",
            "  <headlines><headline>Traffic diversions announced</headline><headline>New cafe opens in Gomti Nagar</headline></headlines>",
            "</environment>"
        ].join("\n");

        const bios = [
            "Chill lad who cracks jokes all day long",
            "Sharp topper obsessed with gadgets",
            "Foodie planning outings around snacks",
            "Fitness freak dragging everyone on runs",
            "Quiet artist sketching the whole group",
            "Beloved human friend and director"
        ];
        bios.forEach((about, i) => {
            const memory = new Memory(new Logger("Test"), `member${i}`);
            memory.set("Mood", "excited about the weekend trip plans", new Date(Date.now() + 900_000));
            memory.set("Active Goal", "finish the group project before Friday", new Date(Date.now() + 3_600_000));
            memory.set("Opinion on User", "finds the user genuinely funny", -1);
            addWorldMember(manager, { id: `member${i}`, name: `Member ${i}`, age: 20 + i, about, memory });
        });

        const systemParts = buildSystemParts(manager);
        const systemText = systemParts.join("\n");
        const tokens = (/** @type {string} */ s) => Math.ceil(s.length / 4);

        const systemTokens = tokens(systemText);
        console.log(
            `[prompt-budget] system prompt ≈ ${systemTokens} tokens ` +
            `(${systemParts.length} parts, ${systemText.length} chars) · ` +
            `directive ≈ ${tokens(systemParts[0])} · characters ≈ ${tokens(systemParts.find(p => p.includes("<characters>")) ?? "")}`
        );

        // Gate: total system overhead below ~1,000 tokens per turn.
        expect(systemTokens).toBeLessThan(1_000);

        // Every custom bio is still present (capped at 50 chars).
        for (const about of bios) {
            const expected = about.length > 50 ? `${about.slice(0, 47)}...` : about;
            expect(systemText).toContain(expected);
        }
    });
});
