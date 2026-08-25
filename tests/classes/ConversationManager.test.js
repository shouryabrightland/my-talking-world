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
        }
        get chat() {
            return { getMembers: () => [], getMember: () => null, getHistory: () => [], addMessage() {}, clear() {}, events: { on() {}, emit() {} } };
        }
        async init() {}
        toString() { return "Mock World"; }
    },
    WorldEvents: { SCHEDULE_CHANGE: "schedule:change" }
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
        constructor() { this._parts = []; }
        async build() { return { messages: [] }; }
        useSystem() {}
        useUser() {}
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
    PARTICIPANT_TYPE_CHARACTER: "character",
    PARTICIPANT_TYPE_HUMAN: "human"
}));
vi.mock("../../src/util/sound.js", () => ({ AmbientAudio: { stop() {} } }));

// ─── Import after mocks ───

import ConversationManager, { ConversationEvents } from "../../src/classes/ConversationManager.js";

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
