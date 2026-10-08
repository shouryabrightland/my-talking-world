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
            this.stateMemory = { clear() {} };
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

import ConversationManager, { ConversationEvents } from "../../src/classes/ConversationManager.js";
import Reaction from "../../src/classes/Reaction.js";
import { ChatEvents } from "../../src/classes/Chat.js";
import { ChatMemberEvents } from "../../src/classes/ChatMember.js";
import Logger from "../../src/classes/lib/Logger.js";
import Memory from "../../src/classes/lib/Memory.js";

// ─── Helper: create a real ConversationManager with mocked deps ───

/** Simple ChatMember mock for test instantiation */
function makeMockMember(id, name, isAI) {
    return {
        id, name, isAI,
        isOnline: true, isTyping: false,
        scheduler: { clear() {}, getTimeline() { return []; } },
        stateMemory: { clear() {} },
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
        expect(joined).toContain('<delay ms="3000"/>');
        expect(joined).toContain('<delay ms="60000"/>');
        expect(joined).toContain('<next time="HH:MM"/>');
        expect(joined).toContain('<next time="18:30"/>');
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
        // from the prompt on purpose — the 650-token Groq gate is tight.)
        for (const { name } of Reaction.EMOTION) {
            expect(joined).toContain(name);
        }

        expect(joined).toContain('<msg sender="id" reaction="ReactionName">');
        expect(joined).toContain("Valid reactions (exact): {");
        expect(joined).toMatch(/Use Default if unsure/i);
    });

    it("lists cast ages and the age directive in the message contract", () => {
        const { manager } = createManager();
        const joined = buildSystemParts(manager).join("\n\n");

        // Ages ride inline with the cast ids (fallback cast includes ages too),
        // and the compact Groq prompt carries one age-directive line.
        expect(joined).toMatch(/\(\d{2}\)/);
        expect(joined).toMatch(/Speak each cast member at their listed age/);
    });

    it("drops every legacy heavy block and the <thought> system", () => {
        const { manager } = createManager();
        const joined = buildSystemParts(manager).join("\n\n");

        // <thought> elimination (Zero-Bias migration).
        expect(joined).not.toContain("<thought>");
        expect(joined).not.toContain("thought>");

        // Replaced by the Tier-2 situation paragraph + Tier-3 memory lines.
        expect(joined).not.toContain("<system_directive>");
        expect(joined).not.toContain("<characters>");
        expect(joined).not.toContain("<saved_memories>");
        expect(joined).not.toContain("<language_mandate>");
        expect(joined).not.toContain("<location_diversity_mandate>");
        expect(joined).not.toContain("<task>");
        expect(joined).not.toContain("<rule>");

        // Zero-bias framing: no anti-tags or negative rule language.
        expect(joined).not.toContain("FORBIDDEN");
        expect(joined).not.toContain("ANTI-CLICH");
        expect(joined).not.toContain("NEVER");
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

    it("skips the lookup for autonomous turns (no human utterance)", async () => {
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

        await manager.requestTurn();

        expect(captured.system).not.toContain("## Active Memories");
        expect(captured.system).toContain("## Ambient Setting");
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

    it("stays under 650 tokens for a worst-case dialogue turn", async () => {
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

            // Gate 3: Groq prompt tokens stay under 650 per dialogue turn.
            // The Step-3 prompt documents the raw <msg>/<delay>/<next> XML
            // contract, which costs ~150 tokens over the old 500-token ceiling.
            expect(totalTokens).toBeLessThan(650);
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

        await runTurn(manager, '<delay ms="20000"/>');

        const requestSpy = vi.spyOn(manager, "requestTurn");

        // 5s delivery + 20s delay = 25s total, NOT 20s from stream end.
        await vi.advanceTimersByTimeAsync(24_999);
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
