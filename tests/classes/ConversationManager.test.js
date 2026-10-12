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
            this.events = { on() { return () => {}; }, emit() {} };
        }
        setTransientState() {}
        resetState() {}
    },
    ChatMemberEvents: { TYPING: "typing", READING: "reading", THINKING: "thinking", ACTIVE: "active" }
}));

vi.mock("../../src/classes/World.js", () => ({
    default: class MockWorld {
        constructor() {
            this.members = new Map();
            // Functional world event bus so tests can emit ENVIRONMENT_CHANGE etc.
            const worldListeners = {};
            this.events = {
                on(event, handler) {
                    if (!worldListeners[event]) worldListeners[event] = [];
                    worldListeners[event].push(handler);
                    return () => {
                        worldListeners[event] = (worldListeners[event] || []).filter(h => h !== handler);
                    };
                },
                emit(event, data) {
                    for (const h of (worldListeners[event] || [])) h(data);
                }
            };
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
    WorldEvents: {
        SCHEDULE_CHANGE: "schedule:change",
        BIRTHDAY_TODAY: "world:birthday:today",
        ENVIRONMENT_CHANGE: "world:environment:change"
    }
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
        getLastTime() { return Date.now(); }
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

import ConversationManager, { ConversationEvents, parseTwistAnalysis } from "../../src/classes/ConversationManager.js";
import Reaction from "../../src/classes/Reaction.js";
import { ChatEvents } from "../../src/classes/Chat.js";
import { ChatMemberEvents } from "../../src/classes/ChatMember.js";

// ─── Helper: create a real ConversationManager with mocked deps ───

/** Simple ChatMember mock for test instantiation */
function makeMockMember(id, name, isAI) {
    return {
        id, name, isAI,
        isOnline: true, isTyping: false,
        scheduler: { clear() {}, getTimeline() { return []; } },
        events: { on() { return () => {}; }, emit() {} },
        setTransientState() {},
        resetState() {}
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

        it("does NOT clear member timeline schedulers on logout (catch-up must survive re-login)", () => {
            const member = makeMockMember("tom", "Tom", true);
            member.scheduler.clear = vi.fn();
            manager.chat.getMembers = () => [member];

            manager.logout();

            // Persisted timelines flush past-due messages on the next boot —
            // wiping them here made every queued message vanish forever.
            expect(member.scheduler.clear).not.toHaveBeenCalled();
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

        manager.onStreamToken('<record type="message" id="42" sender="tom"><text>Arre waah!</text></record>');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0].recordType).toBe("message");
        expect(manager.protocolBuffer).toBe("");

        finish();
        await turnPromise;
    });

    it("extracts self-closing <record ... /> tags so they are not trapped in the buffer", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        const spy = vi.spyOn(manager, "handleProtocolRecord");

        manager.onStreamToken('<record type="message" id="7" sender="ben" reaction="Default" />');

        // A self-closing tag is fully consumed from the buffer even when it
        // yields no record (legacy memory-set records no longer exist).
        expect(manager.protocolBuffer).toBe("");
        expect(spy).not.toHaveBeenCalled();

        finish();
        await turnPromise;
    });

    it("extracts Tier-4 <msg sender reaction> banter tags as they complete", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        const spy = vi.spyOn(manager, "handleBanterMessage");

        manager.onStreamToken('<msg sender="tom" reaction="Laughing">Arre yeh toh mast hai!</msg>');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toBe("tom");
        expect(spy.mock.calls[0][1]).toBe("Laughing");
        expect(spy.mock.calls[0][2]).toBe("Arre yeh toh mast hai!");
        expect(manager.protocolBuffer).toBe("");

        finish();
        await turnPromise;
    });

    it("holds a partial <msg> tag in the buffer until its closer arrives", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        const spy = vi.spyOn(manager, "handleBanterMessage");

        manager.onStreamToken('<msg sender="angela" reaction="Happy">Arre suno toh');
        expect(spy).not.toHaveBeenCalled();
        expect(manager.protocolBuffer).toContain("Arre suno toh");

        manager.onStreamToken(' — plan ready hai!</msg>');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][2]).toBe("Arre suno toh — plan ready hai!");
        expect(manager.protocolBuffer).toBe("");

        finish();
        await turnPromise;
    });

    it("captures the <delay ms> pacing tag and skips timeline-derived pacing", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        const timelineSpy = vi.spyOn(manager.timelineProcessor, "getNextLiveRequstTime");

        manager.onStreamToken('<delay ms="2500"/>');
        expect(manager.protocolBuffer).toBe("");

        finish();
        await turnPromise;
        await vi.advanceTimersByTimeAsync(5);

        // The explicit pacing tag replaces the timeline-derived delay.
        expect(timelineSpy).not.toHaveBeenCalled();
    });

    it("arms the inter-message gap when a <delay> immediately follows a <msg>", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        manager.chat.getMember = () => (/** @type {any} */ ({ id: "tom", isAI: true }));
        const addSpy = vi.spyOn(manager.timelineProcessor, "add");

        // Bubble 1 has no gap (nothing precedes it), then a 1500ms pacing gap.
        manager.onStreamToken('<msg sender="tom" reaction="Default">Pehla message</msg><delay ms="1500"/>');
        expect(addSpy).toHaveBeenCalledTimes(1);
        expect(addSpy.mock.calls[0][1]).toBe(0);
        // The delay armed the NEXT bubble's gap.

        manager.onStreamToken('<msg sender="tom" reaction="Default">Doosra message</msg>');
        expect(addSpy).toHaveBeenCalledTimes(2);
        expect(addSpy.mock.calls[1][1]).toBe(1500);

        finish();
        await turnPromise;
    });

    it("lets a trailing <delay> keep arming the next-turn schedule (macro pacing)", async () => {
        const { turnPromise, finish } = await startHangingTurn();
        manager.chat.getMember = () => (/** @type {any} */ ({ id: "tom", isAI: true }));
        const addSpy = vi.spyOn(manager.timelineProcessor, "add");

        manager.onStreamToken('<msg sender="tom" reaction="Default">Last line</msg><delay ms="4000"/>');
        finish();
        await turnPromise;

        // First bubble is un-delayed; the trailing tag became the macro delay
        // (consumed by scheduleNextRequest) rather than a bubble gap.
        expect(addSpy.mock.calls[0][1]).toBe(0);
    });
});

// ─── Phase 6.2: programmatic message auto-splitting ─────────────

describe("ConversationManager — message auto-splitting (Phase 6.2)", () => {
    /** Long multi-sentence banter line that exceeds the 70-char bubble cap. */
    const LONG_LINE = "Arre yaar kal ka plan bilkul final hai, hum sab log subah jaldi uthenge aur park mein milke cricket khelenge, phir wapas aake saath nashta karenge.";

    it("keeps a short single-sentence bubble intact", () => {
        const { manager } = createManager();
        expect(manager.splitMessageText("Arre kya baat hai!")).toEqual(["Arre kya baat hai!"]);
    });

    it("never returns a sub-chunk longer than 70 characters", () => {
        const { manager } = createManager();
        const chunks = manager.splitMessageText(LONG_LINE);

        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(70);
        }
        // Nothing is lost in the split.
        expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("cricket khelenge");
    });

    it("splits multiple sentences into separate bubbles", () => {
        const { manager } = createManager();
        const chunks = manager.splitMessageText("Chalo yaar plan set! Ab sab log taiyar ho jao.");

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toBe("Chalo yaar plan set!");
    });

    it("queues each chunk with a pacing gap between consecutive bubbles", () => {
        const { manager } = createManager();
        manager.chat.getMember = () => (/** @type {any} */ ({ id: "tom", isAI: true }));
        const addSpy = vi.spyOn(manager.timelineProcessor, "add");

        manager.handleBanterMessage("tom", "Default", LONG_LINE, 1500);

        expect(addSpy.mock.calls.length).toBeGreaterThan(1);
        // First bubble inherits the stream-supplied gap…
        expect(addSpy.mock.calls[0][1]).toBe(1500);
        // …later chunks get the fixed 1000–1500ms split gap.
        expect(addSpy.mock.calls[1][1]).toBe(ConversationManager.SPLIT_GAP_MS);
        expect(ConversationManager.SPLIT_GAP_MS).toBeGreaterThanOrEqual(1000);
        expect(ConversationManager.SPLIT_GAP_MS).toBeLessThanOrEqual(1500);
    });

    it("rejects human-impersonating senders before splitting", () => {
        const { manager } = createManager();
        const addSpy = vi.spyOn(manager.timelineProcessor, "add");

        manager.handleBanterMessage("me", "Default", LONG_LINE);

        expect(addSpy).not.toHaveBeenCalled();
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

        const turnPromise = manager.injectDirectorPlot("A mysterious door appears on the terrace");
        await vi.advanceTimersByTimeAsync(10);

        expect(emitted).toEqual(["director:start"]);
        expect(manager.pendingDirectorPlot).toBe("A mysterious door appears on the terrace");

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
 * Builds every registered user-turn part for the given manager.
 * @param {ConversationManager} manager
 * @returns {string}
 */
function buildUserParts(manager) {
    return manager.promptBuilder.users
        .map(fn => fn())
        .filter(t => typeof t === "string")
        .join("\n\n");
}

describe("ConversationManager — Tier-4 ultra-lean dialogue prompt", () => {
    it("emits the lean Markdown directive with the <msg>/<delay> output contract", () => {
        const { manager } = createManager();
        const joined = buildSystemParts(manager).join("\n\n");

        expect(joined).toContain("# Live Group Chat: Tom & Friends");
        expect(joined).toContain("Cast:");
        expect(joined).toContain('<msg sender="id" reaction="ReactionName">');
        expect(joined).toContain('<delay sec="4"/>');
        expect(joined).toContain('<delay sec="10"/>');
        expect(joined).toContain('<next time="HH:MM"/>');
        expect(joined).toContain('<next time="22:30"/>');
        // No bedtime framing in the instructions. "Sleeping" itself is a
        // VALID reaction name and must stay in the allow-list.
        expect(joined.toLowerCase()).not.toMatch(/\b(bedtime|sleepy|go to sleep|sleep at|time to sleep|lights out)\b/i);
        expect(joined).toContain("## Ambient Setting");
        expect(joined).toContain("- Atmosphere:");
        expect(joined).toContain("Lucknow Hinglish");
        expect(joined).toContain("Roman/Latin script only");

        // Raw XML structures are provided directly — never fenced in backticks.
        expect(joined).not.toContain("```xml");
    });

    it("lists every valid Reaction.EMOTION name in the message contract", () => {
        const { manager } = createManager();
        const joined = buildSystemParts(manager).join("\n\n");

        // Single source of truth: Reaction.EMOTION. Every valid reaction name
        // must be offered to the model so it never invents reaction values
        // that the avatar layer would silently discard. (Emojis are omitted
        // from the prompt on purpose — the 1200-token Groq gate is tight.)
        for (const { name } of Reaction.EMOTION) {
            expect(joined).toContain(name);
        }

        expect(joined).toContain('<msg sender="id" reaction="ReactionName">');
        expect(joined).toContain("Valid reactions (exact): {");
        expect(joined).toMatch(/Use Default if unsure/i);
    });

    it("lists cast ages and the age directive in the message contract", () => {
        const { manager } = createManager();
        manager.world.members.set("tom", /** @type {any} */ ({ id: "tom", name: "Tom", isAI: true, age: 28, about: "Leader cat" }));
        const joined = buildSystemParts(manager).join("\n\n");

        // Ages ride inline with the live cast members (Task 6 dynamic personas),
        // and the compact Groq prompt carries one age-directive line.
        expect(joined).toMatch(/\(\d{2}\)/);
        expect(joined).toMatch(/Speak each character at their exact age/);
    });

    it("drops every legacy heavy block and the <thought> system", () => {
        const { manager } = createManager();
        const joined = buildSystemParts(manager).join("\n\n");

        // <thought> elimination (Zero-Bias migration).
        expect(joined).not.toContain("<thought>");
        expect(joined).not.toContain("thought>");

        // Phase 5: the compact markdown safety block is injected into every
        // Groq dialogue turn (the verbose XML mandate still ships on the
        // token-rich Gemini prompts).
        expect(joined).toContain("Safety & Ethics (G-Rated CBSE Standard)");
        expect(joined).toContain("Strictly family-friendly");
        expect(joined).not.toContain("<child_safety_mandate>");

        // Replaced by the Tier-2 situation paragraph + Tier-3 memory lines.
        expect(joined).not.toContain("<system_directive>");
        expect(joined).not.toContain("<characters>");
        expect(joined).not.toContain("<saved_memories>");
        expect(joined).not.toContain("<language_mandate>");
        expect(joined).not.toContain("<location_diversity_mandate>");
        expect(joined).not.toContain("<task>");
        expect(joined).not.toContain("<rule>");

        // Zero-bias framing: no anti-tags or negative rule language — the ONLY
        // exception is the compact Phase-5 safety block, which is deliberately
        // packed with "NO …" constraints for the school-safety contract.
        // Scope it out of the zero-bias scan.
        const withoutSafety = joined.replace(
            /## Safety & Ethics \(G-Rated CBSE Standard\):[\s\S]*?(?=\n## |$)/g,
            ""
        );
        expect(withoutSafety).not.toContain("FORBIDDEN");
        expect(withoutSafety).not.toContain("ANTI-CLICH");
        expect(withoutSafety).not.toContain("NEVER");
    });

    it("renders the recent chat window as plain text capped at 1000 chars", () => {
        const { manager } = createManager();
        manager.getRecentMessages = () => Array.from({ length: 40 }, (_, i) => ({
            id: `m${i}`,
            deleted: false,
            sender: { id: "tom", name: "Tom" },
            text: `chatter number ${i} about the plan`
        }));

        const userText = buildUserParts(manager);
        expect(userText).toContain("## Recent Chat");
        expect(userText).toContain("Tom: chatter number 39");
        expect(userText.startsWith("## Recent Chat\n```\n")).toBe(true);

        const history = userText.replace(/^## Recent Chat\n```\n/, "").replace(/\n```$/, "");
        expect(history.length).toBeLessThanOrEqual(1000);
    });
});

// ─── Context block (clock + Tier-2 situation) ─────────

describe("ConversationManager — Context block (clock + Tier-2 situation)", () => {
    it("injects the simulation clock and the situation paragraph", () => {
        const { manager } = createManager();

        manager.world.dateTime = "Mon Oct 07 2026 at 14:30";
        manager.situationEngine.situationText = "Tom is on the rooftop repairing Angela's drone.";

        const contextPart = buildSystemParts(manager).find(t => t.includes("## Ambient Setting"));

        expect(contextPart).toBeDefined();
        expect(contextPart).toContain("- Time: Mon Oct 07 2026 at 14:30");
        expect(contextPart).toContain("- Atmosphere: Tom is on the rooftop repairing Angela's drone.");
    });
});

// ─── Lean prompt / Tier-3 memory injection / history window ───

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


describe("ConversationManager — Tier-3 Needle → UnifiedMemory injection", () => {
    /** Captures the prompt exactly as requestTurn() compiles it. */
    function captureBuildOn(/** @type {ConversationManager} */ manager) {
        /** @type {{ system: string, user: string }} */
        const captured = { system: "", user: "" };
        manager.promptBuilder.build = async () => {
            captured.system = buildSystemParts(manager).join("\n\n");
            captured.user = buildUserParts(manager);
            return { messages: [] };
        };
        return captured;
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("injects 0-2 matching memory lines for human-initiated turns", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.unifiedMemory.entries.push({
            id: crypto.randomUUID(),
            datetime: "2026-10-07 14:00",
            tags: ["tom", "chai"],
            data: "Tom promised the group chai at the Gomti Nagar stall.",
            expiry: "forever"
        });

        const captured = captureBuildOn(manager);

        await manager.requestTurn(true, "tom ke chai wale plan ke baare mein bata");

        expect(captured.system).toContain("## Active Memories");
        expect(captured.system).toContain("Tom promised the group chai");
    });

    it("skips the lookup only when there is nothing to route (no chat, no human)", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.unifiedMemory.entries.push({
            id: crypto.randomUUID(),
            datetime: "2026-10-07 14:00",
            tags: ["tom", "chai"],
            data: "Tom promised the group chai at the Gomti Nagar stall.",
            expiry: "forever"
        });

        manager.unifiedMemory.entries = []; // Ensure stack is totally empty
        manager.recentDialogueBuffer = []; // Ensure buffer is empty


        const captured = captureBuildOn(manager);

        await manager.requestTurn();

        expect(captured.system).not.toContain("## Active Memories\n"); // block heading only — the Turn Priority ladder may reference it
        expect(captured.system).toContain("## Ambient Setting");
    });

    it("routes autonomous turns through the recent chat window (not the user alone)", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.unifiedMemory.entries.push({
            id: crypto.randomUUID(),
            datetime: "2026-10-07 14:00",
            tags: ["tom", "chai"],
            data: "Tom promised the group chai at the Gomti Nagar stall.",
            expiry: "forever"
        });

        // The topic lives ONLY in the recent chat — no human utterance this turn.
        manager.getRecentMessages = () => [
            { id: "m1", deleted: false, sender: { id: "angela", name: "Angela" }, text: "Tom, kal ke chai plan ke baare mein batao na" },
            { id: "m2", deleted: false, sender: { id: "tom", name: "Tom" }, text: "Chai wale plan? Gomti Nagar stall par milte hain" }
        ];

        const captured = captureBuildOn(manager);

        await manager.requestTurn();

        expect(captured.system).toContain("## Active Memories");
        expect(captured.system).toContain("Tom promised the group chai");
    });

    it("isolates the Needle query to the human message — chat history never enters a keyword-bearing query", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        const route = vi.spyOn(manager.needleRouter, "route")
            .mockResolvedValue({ keywords: ["drone", "rotor"], member: "any" });

        manager.getRecentMessages = () => [
            { id: "m1", deleted: false, sender: { id: "angela", name: "Angela" }, text: "Angela: rotor ka screw gayab hai" }
        ];

        await manager.requestTurn(true, "drone ke rotor ke baare mein batao");

        // Task 5: the FINAL route query is the isolated human message.
        const finalQuery = String(route.mock.calls[route.mock.calls.length - 1][0]);
        expect(finalQuery).toContain("drone ke rotor");
        expect(finalQuery).not.toContain("screw gayab");
    });

    it("falls back to chat history only when the human message carries zero topical nouns", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        const route = vi.spyOn(manager.needleRouter, "route")
            .mockResolvedValue({ keywords: [], member: "any" });

        manager.getRecentMessages = () => [
            { id: "m1", deleted: false, sender: { id: "angela", name: "Angela" }, text: "Angela: rotor ka screw gayab hai" }
        ];

        await manager.requestTurn(true, "hello");

        const finalQuery = String(route.mock.calls[route.mock.calls.length - 1][0]);
        expect(finalQuery).toContain("hello");
        expect(finalQuery).toContain("screw gayab");
    });

    it("captures the human utterance from MESSAGE_ADD and routes the next turn through it", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.unifiedMemory.entries.push({
            id: crypto.randomUUID(),
            datetime: "2026-10-07 14:00",
            tags: ["tom", "chai"],
            data: "Tom promised the group chai at the Gomti Nagar stall.",
            expiry: "forever"
        });

        const captured = captureBuildOn(manager);

        manager.chat.events.emit(ChatEvents.MESSAGE_ADD, {
            sender: { isAI: false },
            text: "tom ke chai wale plan ke baare mein batao"
        });

        // No explicit arguments: the pending human utterance drives the lookup.
        await manager.requestTurn();

        expect(captured.system).toContain("## Active Memories");
        expect(captured.system).toContain("Tom promised the group chai");
    });

    it("ranks the human's latest message above the situation (Turn Priority block)", async () => {
        const { manager } = createManager();
        manager.initialized = true;

        const captured = captureBuildOn(manager);
        await manager.requestTurn(true, "aaj ka scene kya hai?");

        // System: explicit priority ladder with the human first.
        expect(captured.system).toContain("## Turn Priority");
        expect(captured.system).toContain("1) The human's LATEST message — answer it first.");
        expect(captured.system).toContain("4) Ambient setting is background only.");

        // User: fresh utterance appended LAST (strongest recency position).
        expect(captured.user).toContain("## The Human Just Said");
        expect(captured.user).toContain("aaj ka scene kya hai?");
        expect(captured.user.indexOf("## The Human Just Said"))
            .toBeGreaterThan(captured.user.indexOf("## Recent Chat"));
    });

    it("omits the human-priority block on autonomous turns", async () => {
        const { manager } = createManager();
        manager.initialized = true;

        const captured = captureBuildOn(manager);
        await manager.requestTurn();

        expect(captured.user).not.toContain("## The Human Just Said");
        // The priority ladder still frames autonomous turns.
        expect(captured.system).toContain("## Turn Priority");
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
    /** Standard ~4 chars/token estimate used across the prompt-budget gates. */
    const estimateTokens = (/** @type {string} */ s) => Math.ceil(s.length / 4);

    it("stays under 1200 tokens for a worst-case dialogue turn", async () => {
        vi.useFakeTimers();
        try {
            const { manager } = createManager();
            manager.initialized = true;
            manager.world.dateTime = "Tue Oct 07 2026 at 10:42";

            // Worst case: full 500-char Tier-2 situation paragraph.
            manager.situationEngine.situationText = (
                "Tom, Angela and Ben are crowded around the rooftop table in Gomti Nagar, " +
                "repairing the drone while Hank narrates tomorrow's physics viva plan. " +
                "Chai glasses are half empty, the sky is turning orange and Ginger keeps " +
                "checking the stairwell door every few minutes for the courier."
            ).slice(0, 500);

            // Worst case: full 1000-char recent chat window.
            manager.getRecentMessages = () => Array.from({ length: 40 }, (_, i) => ({
                id: `m${i}`,
                deleted: false,
                sender: { id: i % 2 ? "angela" : "tom", name: i % 2 ? "Angela" : "Tom" },
                text: `chatter number ${i} about tomorrow's plan and snacks`
            }));

            // Worst case: a matching Tier-3 memory line is present.
            manager.unifiedMemory.entries.push({
                id: crypto.randomUUID(),
                datetime: "2026-10-07 14:00",
                tags: ["tom", "chai"],
                data: "Tom promised the group chai at the Gomti Nagar stall before the viva.",
                expiry: "forever"
            });

            let systemText = "";
            let userText = "";
            manager.promptBuilder.build = async () => {
                systemText = buildSystemParts(manager).join("\n\n");
                userText = buildUserParts(manager);
                return { messages: [] };
            };

            await manager.requestTurn(true, "tom ke chai wale plan ke baare mein bata");

            // The prompt really is the worst case we configured.
            expect(systemText).toContain("## Active Memories");
            expect(systemText).toContain("- Atmosphere:");
            expect(
                userText.replace(/^## Recent Chat\n```\n/, "").replace(/\n```$/, "").length
            ).toBeGreaterThan(900);

            const totalChars = systemText.length + userText.length;
            const totalTokens = estimateTokens("x".repeat(totalChars));
            console.log(`[prompt-budget] dialogue turn ≈ ${totalTokens} tokens (${totalChars} chars)`);

            // Gate 3: Groq prompt tokens stay under 1200 per dialogue turn.
            // The Step-3 prompt documents the raw <msg>/<delay>/<next> XML
            // contract; Phase 8 added triple-backtick data fences plus the
            // 65-char bubble rules; and Phase 5 swaps the full ~420-token
            // <child_safety_mandate> for a compact ~90-token markdown block
            // on this turn. Measured worst case: ~1099 tokens. There is no
            // separate live gate in the app — this test is the budget
            // contract, so keep a real ceiling for future growth.
            expect(totalTokens).toBeLessThan(1200);
        } finally {
            vi.useRealTimers();
            vi.restoreAllMocks();
        }
    });
});

// ─── Macro pacing: <delay> / <next> + human interruption override ───

describe("ConversationManager — macro pacing (<delay> / <next>)", () => {
    /**
     * Runs one full turn whose stream ends with the supplied pacing tag.
     * @param {ConversationManager} manager
     * @param {string|null} tag Pacing tag emitted at the end of the stream.
     * @returns {Promise<void>}
     */
    async function runTurn(manager, tag) {
        let emitted = false;
        manager.client.streamChat = async () => {
            if (tag && !emitted) {
                emitted = true;
                manager.onStreamToken(tag);
            }
            return "ok";
        };
        await manager.requestTurn();
    }

    /**
     * Builds an AI cast stub recording transient-state and event calls.
     * @returns {{ id: string, isAI: boolean, currentEmotion: { name: string }, scheduler: { getTimeline: () => unknown[], clear: () => void }, setTransientState: import("vitest").Mock, setEmotion: import("vitest").Mock, events: { emit: import("vitest").Mock } }}
     */
    function makeCastMember() {
        return {
            id: "tom",
            isAI: true,
            currentEmotion: { name: "Default" },
            scheduler: { getTimeline: () => [], clear() {} },
            setTransientState: vi.fn(),
            setEmotion: vi.fn(),
            events: { emit: vi.fn() }
        };
    }

    beforeEach(() => {
        vi.useFakeTimers({ now: new Date("2026-10-07T23:00:00") });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("<delay ms> starts counting only AFTER the last queued message is delivered", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        // Slowest queue still has 5s of typing/reading left when the stream ends.
        manager.timelineProcessor.getLastTime = () => Date.now() + 5000;

        await runTurn(manager, '<delay ms="10000"/>');

        const requestSpy = vi.spyOn(manager, "requestTurn");

        // 5s delivery + 10s delay = 15s total, NOT 10s from stream end.
        await vi.advanceTimersByTimeAsync(14_999);
        expect(requestSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2);
        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("caps explicit banter delays at 15 seconds so the chat never freezes", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.timelineProcessor.getLastTime = () => Date.now() + 5000;

        await runTurn(manager, '<delay ms="120000"/>');

        const requestSpy = vi.spyOn(manager, "requestTurn");

        // 5s delivery + capped 15s delay = 20s total — NOT the raw 120s.
        await vi.advanceTimersByTimeAsync(19_999);
        expect(requestSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2);
        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("defaults to a 4s banter pause after the last delivery when no tag is emitted", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.timelineProcessor.getLastTime = () => Date.now() + 3000;

        await runTurn(manager, null);

        const requestSpy = vi.spyOn(manager, "requestTurn");

        await vi.advanceTimersByTimeAsync(6_999);
        expect(requestSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2);
        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("<next time> marks the cast inactive for the wait and requests the turn at the target time", async () => {
        const { manager } = createManager();
        manager.initialized = true;

        // Wall clock and simulation clock both sit late at night on Oct 7.
        manager.world.now = new Date("2026-10-07T23:00:00");

        const member = makeCastMember();
        manager.chat.getMembers = () => [member];

        await runTurn(manager, '<next time="06:00"/>');

        // Inactive for the whole wait — no hour-based sleeping emotion involved.
        expect(member.setTransientState).toHaveBeenCalledWith("isActive", false, 0);
        expect(member.events.emit).toHaveBeenCalledWith(ChatMemberEvents.ACTIVE, false);
        expect(member.setEmotion).not.toHaveBeenCalled();

        const requestSpy = vi.spyOn(manager, "requestTurn");

        // Target = 2026-10-08 06:00 → exactly 7h from the fake clock.
        await vi.advanceTimersByTimeAsync(7 * 3600_000 - 1000);
        expect(requestSpy).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);
        expect(requestSpy).toHaveBeenCalledTimes(1);

        // The cast is reactivated the moment the scheduled wait ends.
        expect(member.setTransientState).toHaveBeenCalledWith("isActive", true, 4000);
        expect(member.events.emit).toHaveBeenCalledWith(ChatMemberEvents.ACTIVE, true);
    });

    it("a human message cancels the pending <next> timer and activates the cast", async () => {
        const { manager } = createManager();
        manager.initialized = true;
        manager.world.now = new Date("2026-10-07T23:00:00");

        const member = makeCastMember();
        manager.chat.getMembers = () => [member];

        await runTurn(manager, '<next time="06:00"/>');

        // Cast went inactive for the 7h wait.
        expect(member.setTransientState).toHaveBeenCalledWith("isActive", false, 0);

        const requestSpy = vi.spyOn(manager, "requestTurn");

        manager.chat.events.emit(ChatEvents.MESSAGE_ADD, {
            sender: { isAI: false },
            text: "Arre suno yaar"
        });

        // Human input reactivates every AI cast member immediately.
        expect(member.setTransientState).toHaveBeenCalledWith("isActive", true, 4000);
        expect(member.events.emit).toHaveBeenCalledWith(ChatMemberEvents.ACTIVE, true);

        // The pending 7h timer was cancelled — nothing fires at the old deadline.
        await vi.advanceTimersByTimeAsync(7 * 3600_000);
        expect(requestSpy).not.toHaveBeenCalled();
    });

    it("a deferred turn resumes with the human turn arguments so Needle routing still runs", async () => {
        const { manager, User } = createManager();
        manager.initialized = true;
        manager.client.streamChat = async () => "ok";

        manager.chat.events.emit(ChatEvents.MESSAGE_ADD, {
            sender: { isAI: false },
            text: "chai ke plan ke baare mein batao"
        });

        // Mid-typing: the turn is deferred instead of running immediately.
        User.isTyping = true;
        await manager.requestTurn(true, "chai ke plan ke baare mein batao");

        const requestSpy = vi.spyOn(manager, "requestTurn");

        // 3s safety net resolves the deferral and re-issues the SAME turn args.
        await vi.advanceTimersByTimeAsync(3000);

        expect(requestSpy).toHaveBeenCalledWith(true, "chai ke plan ke baare mein batao");
    });
});

// ─── Director Twist Engine (Phase 6) ──────────────────────────────

describe("ConversationManager — Director Twist Engine", () => {
    /** @type {ConversationManager} */
    let manager;

    beforeEach(() => {
        vi.useFakeTimers();
        const result = createManager();
        manager = result.manager;
        manager.initialized = true;
        manager.client.streamChat = async () => "ok";
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /**
     * Builds a fully-specified active twist.
     * @param {string} id
     * @param {"pre"|"mid"|"ending"} status
     * @param {string} [title]
     */
    function makeTwist(id, status, title = `Twist ${id}`) {
        return {
            id,
            title,
            directive: `directive ${id}`,
            prePlot: `PRE ${id}`,
            midPlot: `MID ${id}`,
            postPlot: `POST ${id}`,
            status
        };
    }

    // ─── 6.1 State & Cooldown ───

    it("directorGate() enforces the 30s cooldown with a waitSeconds hint", () => {
        expect(manager.directorGate().ok).toBe(true);

        manager.directorCooldownUntil = Date.now() + 7_400;
        const gate = manager.directorGate();
        expect(gate.ok).toBe(false);
        expect(gate.reason).toBe("cooldown");
        expect(gate.waitSeconds).toBe(8); // 7.4s remaining rounds up to 8s

        manager.directorCooldownUntil = 0;
        expect(manager.directorGate().ok).toBe(true);
    });

    it("rejects past the 2-twist limit", async () => {
        for (let i = 0; i < 2; i++) {
            manager.directorCooldownUntil = 0;
            const res = await manager.injectDirectorPlot(`Twist ${i}`);
            expect(res.ok).toBe(true);
        }

        manager.directorCooldownUntil = 0;
        const overflow = await manager.injectDirectorPlot("Overflow twist");
        expect(overflow.ok).toBe(false);
        expect(overflow.reason).toBe("limit");
        expect(manager.activeDirectives).toHaveLength(2);
    });

    // ─── 6.2 Gemma Twist Synthesizer ───

    it("injects a twist, arms the cooldown, and rejects inside the window (DIRECTOR_REJECTED)", async () => {
        /** @type {Array<{reason?: string}>} */
        const rejected = [];
        manager.events.on(
            ConversationEvents.DIRECTOR_REJECTED,
            (/** @type {{reason?: string}} */ gate) => rejected.push(gate),
            "test: director rejected"
        );

        const first = await manager.injectDirectorPlot("A mysterious door appears on the terrace");
        expect(first.ok).toBe(true);
        expect(first.cancelled).toBe(0);
        expect(first.twistId).toBeTruthy();
        expect(manager.activeDirectives).toHaveLength(1);
        // The opening turn completed → pre flipped to mid (6.3).
        expect(manager.activeDirectives[0].status).toBe("mid");
        expect(Date.now() < manager.directorCooldownUntil).toBe(true);

        const second = await manager.injectDirectorPlot("Second twist");
        expect(second.ok).toBe(false);
        expect(second.reason).toBe("cooldown");
        expect(manager.activeDirectives).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBe("cooldown");
    });

    it("allows the next twist once the cooldown window closes", async () => {
        await manager.injectDirectorPlot("Twist A");
        manager.directorCooldownUntil = 0;

        const second = await manager.injectDirectorPlot("Twist B");
        expect(second.ok).toBe(true);
        expect(manager.activeDirectives).toHaveLength(2);
    });

    it("applies Gemma cancellations and registers the synthesized three-beat plot", async () => {
        manager.activeDirectives.push(/** @type {any} */ (makeTwist("old-1", "mid", "Old Rivalry")));

        // Stub the Gemini client so synthesis returns a known XML payload.
        manager.world.worldSetter = {
            geminiClient: {
                resolveGemmaModel: async () => "gemma-4-26b",
                generateText: async () => ({
                    text: '<twist_analysis><cancellations><cancel id="old-1" /></cancellations>' +
                        "<plot><title>Mystery Package</title>" +
                        "<pre_plot>A parcel lands on the doorstep.</pre_plot>" +
                        "<mid_plot>Everyone keeps eyeing the package.</mid_plot>" +
                        "<post_plot>The sender is finally revealed.</post_plot>" +
                        "</plot></twist_analysis>"
                })
            }
        };

        const res = await manager.injectDirectorPlot("A mystery package arrives");
        expect(res.ok).toBe(true);
        expect(res.cancelled).toBe(1);
        expect(manager.activeDirectives).toHaveLength(1);
        expect(manager.activeDirectives[0].title).toBe("Mystery Package");
        expect(manager.activeDirectives[0].prePlot).toBe("A parcel lands on the doorstep.");
        expect(manager.activeDirectives[0].status).toBe("mid");
    });

    it("falls back to a deterministic synthesis when the model call fails", async () => {
        manager.world.worldSetter = {
            geminiClient: {
                resolveGemmaModel: async () => "gemma-4-26b",
                generateText: async () => { throw new Error("quota exceeded"); }
            }
        };

        const res = await manager.injectDirectorPlot("The power goes out");
        expect(res.ok).toBe(true);
        expect(manager.activeDirectives).toHaveLength(1);

        const twist = manager.activeDirectives[0];
        expect(twist.prePlot).toContain("The power goes out");
        expect(twist.midPlot.length).toBeGreaterThan(0);
        expect(twist.postPlot.length).toBeGreaterThan(0);
        expect(twist.status).toBe("mid");
    });

    // ─── 6.3 Prompt Feeding Logic ───

    it("feeds each twist's per-status plot under ## Active Director Beats", () => {
        manager.activeDirectives.push(
            /** @type {any} */ (makeTwist("t1", "pre")),
            /** @type {any} */ (makeTwist("t2", "mid")),
            /** @type {any} */ (makeTwist("t3", "ending"))
        );

        const joined = buildSystemParts(manager).join("\n\n");

        expect(joined).toContain("## Active Director Beats");
        expect(joined).toContain("- [Twist t1] PRE t1");
        expect(joined).toContain("- [Twist t2] MID t2");
        expect(joined).toContain("- [Twist t3] POST t3");
        // Each status feeds EXACTLY one beat.
        expect(joined).not.toContain("MID t1");
        expect(joined).not.toContain("PRE t2");
        expect(joined).not.toContain("MID t3");
    });

    it("omits the beats section entirely when no twists are active", () => {
        const joined = buildSystemParts(manager).join("\n\n");
        expect(joined).not.toContain("## Active Director Beats");
    });

    it("advances lifecycles after a completed turn: pre→mid, ending→pruned", async () => {
        manager.activeDirectives.push(
            /** @type {any} */ (makeTwist("end-1", "ending")),
            /** @type {any} */ (makeTwist("pre-1", "pre")),
            /** @type {any} */ (makeTwist("mid-1", "mid"))
        );

        await manager.requestTurn();

        expect(manager.activeDirectives.map(t => t.id)).toEqual(["pre-1", "mid-1"]);
        expect(manager.activeDirectives[0].status).toBe("mid");
        expect(manager.activeDirectives[1].status).toBe("mid");
    });

    it("keeps statuses untouched when the turn fails (post_plot not yet spoken)", async () => {
        manager.activeDirectives.push(/** @type {any} */ (makeTwist("end-1", "ending")));
        manager.client.streamChat = async () => { throw new Error("groq down"); };

        await manager.requestTurn();

        expect(manager.activeDirectives).toHaveLength(1);
        expect(manager.activeDirectives[0].status).toBe("ending");
    });

    // ─── 6.4 Ending flow ───

    it("endTwists(): marks ending, locks for 1 turn, prunes + unlocks after the turn", async () => {
        await manager.injectDirectorPlot("Twist A");
        const id = manager.activeDirectives[0].id;

        const res = manager.endTwists([id]);
        expect(res.ok).toBe(true);
        expect(res.count).toBe(1);
        expect(manager.activeDirectives[0].status).toBe("ending");
        expect(manager.isEndingLocked()).toBe(true);

        // Locked: a second end attempt is rejected until the turn completes.
        const blocked = manager.endTwists([id]);
        expect(blocked.ok).toBe(false);
        expect(blocked.reason).toBe("locked");

        // The fire-and-forget resolution turn prunes the twist + unlocks.
        await vi.advanceTimersByTimeAsync(50);
        expect(manager.activeDirectives).toHaveLength(0);
        expect(manager.isEndingLocked()).toBe(false);
    });

    it("endTwists() rejects unknown ids without arming the lock", () => {
        manager.activeDirectives.push(/** @type {any} */ (makeTwist("known", "mid")));

        const res = manager.endTwists(["ghost"]);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("not-found");
        expect(manager.isEndingLocked()).toBe(false);
        expect(manager.activeDirectives[0].status).toBe("mid");
    });
});

// ─── Twist synthesis XML parser ───────────────────────────────────

describe("parseTwistAnalysis", () => {
    it("extracts title, three plots, and cancellation ids", () => {
        const parsed = parseTwistAnalysis(
            '<twist_analysis><cancellations><cancel id="a1" /><cancel id="b2" /></cancellations>' +
            "<plot><title>Roof Leak</title>" +
            "<pre_plot>Ceiling drips mid-dinner.</pre_plot>" +
            "<mid_plot>Buckets everywhere.</mid_plot>" +
            "<post_plot>Landlord fixes it.</post_plot>" +
            "</plot></twist_analysis>"
        );

        expect(parsed).not.toBeNull();
        expect(parsed.title).toBe("Roof Leak");
        expect(parsed.prePlot).toBe("Ceiling drips mid-dinner.");
        expect(parsed.midPlot).toBe("Buckets everywhere.");
        expect(parsed.postPlot).toBe("Landlord fixes it.");
        expect(parsed.cancellations).toEqual(["a1", "b2"]);
    });

    it("returns null when a required plot anchor is missing", () => {
        expect(parseTwistAnalysis("<pre_plot>only pre</pre_plot>")).toBeNull();
        expect(parseTwistAnalysis("no xml at all")).toBeNull();
        expect(parseTwistAnalysis("")).toBeNull();
    });

    it("tolerates whitespace inside tags", () => {
        const parsed = parseTwistAnalysis(
            "<plot>\n  <pre_plot>  boom  </pre_plot>\n  <post_plot>\n calm \n</post_plot>\n</plot>"
        );
        expect(parsed.prePlot).toBe("boom");
        expect(parsed.postPlot).toBe("calm");
        expect(parsed.cancellations).toEqual([]);
    });

    it("strips markdown fences and <think> blocks and falls back to directive for optional fields (Task 9)", () => {
        const raw = "```xml\n<think>I am reasoning about the plot</think>\n<plot><pre_plot>Power goes out!</pre_plot><post_plot>Power returns!</post_plot></plot>\n```";
        const parsed = parseTwistAnalysis(raw, "Sudden power cut in the evening");
        expect(parsed).not.toBeNull();
        expect(parsed.prePlot).toBe("Power goes out!");
        expect(parsed.postPlot).toBe("Power returns!");
        expect(parsed.title).toBe("Sudden power cut in the evening");
        expect(parsed.midPlot).toBe("Sudden power cut in the evening");
    });
});

// ─── Environment sync (Phase 7.1) ─────────────────────────────────

describe("ConversationManager — Environment → SituationEngine sync", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("distills fresh headlines into SituationEngine + syncs UnifiedMemory on ENVIRONMENT_CHANGE", () => {
        const { manager } = createManager();
        manager.initialized = true;

        const ingestSpy = vi.spyOn(manager.situationEngine, "ingestNews").mockResolvedValue(0);
        const syncSpy = vi.spyOn(manager.unifiedMemory, "syncEnvironment").mockResolvedValue(undefined);

        const headlines = ["Headline one", "Headline two", "Headline three"];
        manager.world.events.emit("world:environment:change", { newsHeadlines: headlines });

        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(syncSpy).toHaveBeenCalledWith({ newsHeadlines: headlines });
        expect(ingestSpy).toHaveBeenCalledTimes(1);
        expect(ingestSpy).toHaveBeenCalledWith(headlines);
    });

    it("skips news ingestion when the snapshot carries no headlines", () => {
        const { manager } = createManager();
        manager.initialized = true;

        const ingestSpy = vi.spyOn(manager.situationEngine, "ingestNews").mockResolvedValue(0);
        vi.spyOn(manager.unifiedMemory, "syncEnvironment").mockResolvedValue(undefined);

        manager.world.events.emit("world:environment:change", { newsHeadlines: [] });

        expect(ingestSpy).not.toHaveBeenCalled();
    });
});
