// @ts-check

/**
 * @file ConversationManager.js
 * Central dialogue flow and turn orchestrator.
 *
 * Responsibilities:
 * - Manages the AI turn generation pipeline (streaming SSE via Groq).
 * - Processes incoming XML protocol records (messages, memory operations).
 * - Handles human user interruption with debounced typing detection.
 * - Registers full-XML prompt context (world state, characters, memories, dialogue rules).
 * - **Offline mode**: When offline, skips AI requestTurn entirely but still allows
 *   local message sending. Users can type messages that appear in chat history
 *   but will not receive AI character responses until back online.
 */

/** @typedef {import("./PromptBuilder").default} PromptBuilder */
/** @typedef {import("./types/Protocol.types").ProtocolRecord} ProtocolRecord */
/** @typedef {import("./types/Protocol.types").MessageProtocolRecord} MessageProtocolRecord */
/** @typedef {import("./types/Protocol.types").MemorySetProtocolRecord} MemorySetProtocolRecord */
/** @typedef {import("./types/Protocol.types").MemoryRemoveProtocolRecord} MemoryRemoveProtocolRecord */
/** @typedef {import("./ChatMember").default} ChatMember */

import Chat, { ChatEvents } from "./Chat";
import { ChatMemberEvents } from "./ChatMember";
import EventManager from "./EventManager";
import GroqClient, { GroqClientEvents } from "./GroqClient";
import Message from "./Message";
import TimelineProcessor from "./TimelineProcessor";
import PromptBuilderClass from "./PromptBuilder";
import ProtocolCodec from "./ProtocolCodec";
import Storage from "./lib/Storage";
import UnifiedMemory from "./lib/UnifiedMemory";
import NeedleRouter from "./lib/NeedleRouter";
import SituationEngine from "./SituationEngine";
import World, { WorldEvents } from "./World";
import MemoryExpiryParser from "./lib/MemoryExpiryParser";
import UserInterruptHandler from "./lib/UserInterruptHandler";
import { Members } from "../util/member";
import { DEFAULT_CHAT_MODEL } from "../util/Constants";
import { AmbientAudio } from "../util/sound";
import Logger from "./lib/Logger";

/**
 * Canonical event identifiers emitted across the conversation lifecycle.
 * @readonly
 * @enum {string}
 */
export const ConversationEvents = {
    READY: "conversation:ready",
    ERROR: "conversation:error",
    SCHEDULE_SYNC: "conversation:schedule:sync",
    DIRECTOR_EVENT: "conversation:director:event",
    DIRECTOR_RESPONSE_START: "conversation:director:response:start",
    MEMORY_UPDATE: "conversation:memory:update",
    LOGOUT: "conversation:logout"
};

/**
 * Dialogue Flow & Turn Orchestrator.
 *
 * Coordinates the full AI dialogue pipeline:
 * 1. Builds structured XML context prompts from world state.
 * 2. Streams responses from Groq API (or Gemini as fallback).
 * 3. Parses real-time `<record>` XML tags from the stream.
 * 4. Dispatches parsed records to message, memory, and schedule subsystems.
 *
 * In offline mode, AI turn generation is paused but local messaging works.
 */
export default class ConversationManager {

    /**
     * @param {Object} options
     * @param {Logger} [options.logger] Parent logging instance.
     * @param {ChatMember} options.User The human user participant.
     */
    constructor({ logger, User }) {
        if (!User) {
            throw new TypeError("ConversationManager requires an active human User participant.");
        }

        /** @readonly @type {Logger} */ this.logger = (logger || new Logger("Conversation")).child("Manager");
        /** @readonly @type {EventManager} */ this.events = new EventManager(this.logger);
        /** @readonly @type {ChatMember} */ this.User = User;

        /** @readonly @type {World} */
        this.world = new World({ logger: this.logger, User: this.User });

        /** @readonly @type {Chat} */ this.chat = this.world.chat;

        /**
         * Shared episodic memory stack (Tier 3 query target, Tier 2 writer,
         * Tier 1 planning context). Exposed on the World so WorldSetter can
         * read it when assembling planner prompts.
         * @readonly @type {UnifiedMemory}
         */
        this.unifiedMemory = new UnifiedMemory(this.logger);
        this.world.unifiedMemory = this.unifiedMemory;

        /**
         * Tier-3 Needle query router (Wasm worker + deterministic fallback).
         * @readonly @type {NeedleRouter}
         */
        this.needleRouter = new NeedleRouter();

        /**
         * Tier-2 situation & memory distiller (Gemma). Fed every completed turn.
         * @readonly @type {SituationEngine}
         */
        this.situationEngine = new SituationEngine({
            logger: this.logger,
            geminiClient: this.world.worldSetter ? this.world.worldSetter.geminiClient : null,
            unifiedMemory: this.unifiedMemory
        });

        /** @readonly @type {ProtocolCodec} */ this.codec = new ProtocolCodec({ logger: this.logger });
        /** @readonly @type {TimelineProcessor} */ this.timelineProcessor = new TimelineProcessor(this.chat, Members, this.logger);

        /** @readonly @type {PromptBuilderClass} */ this.promptBuilder = new PromptBuilderClass();
        this.registerPrompt(this.promptBuilder);

        /** @readonly @type {GroqClient} */
        this.client = new GroqClient({
            logger: this.logger,
            defaultModel: DEFAULT_CHAT_MODEL
        });

        /** @type {string} */ this.protocolBuffer = "";
        /** @type {boolean} */ this.initialized = false;
        /** @type {boolean} */ this.requesting = false;
        /** @type {boolean} */ this.#generationActive = false;
        /** @type {number} */ this.consecutiveErrors = 0;
        /** @type {string|null} */ this.pendingDirectorPlot = null;

        /** Last Needle route ("member: kw1, kw2") kept for DevTools inspection. @type {string|null} */
        this.lastNeedleRoute = null;
        /** Last Tier-3 memory lines injected into the prompt (DevTools). @type {string} */
        this.lastRetrievedMemory = "";

        /** @type {ReturnType<typeof setTimeout>|null} */ this.#scheduleNextRequest_TimeOut = null;
        /** @readonly @type {UserInterruptHandler} */ this.#interruptHandler = new UserInterruptHandler({ logger: this.logger });

        this.#bindInternalEvents();
    }

    /** @returns {boolean} Whether the manager is fully initialized and ready. */
    get isReady() {
        return this.initialized;
    }

    // Private fields
    /** @type {ReturnType<typeof setTimeout>|null} */ #scheduleNextRequest_TimeOut = null;
    /** @readonly @type {UserInterruptHandler} */ #interruptHandler;
    /** Whether a generation stream is actively being processed. @type {boolean} */ #generationActive;
    /** Whether DIRECTOR_RESPONSE_START was already emitted for this turn. @type {boolean} */ #directorResponseStarted = false;
    /** One-shot subscription waiting for the human typing cadence to settle. @type {Function|null} */ #typingSettleUnsub = null;
    /** Safety-net timer for a typing settle that never resolves. @type {ReturnType<typeof setTimeout>|null} */ #typingSettleTimer = null;
    /** Single-flight boot: concurrent init() calls share ONE boot. @type {Promise<void>|null} */ #initPromise = null;
    /** Text of the most recent human message (Needle routing input). @type {string} */ #lastUserMessageText = "";
    /** Set when the human speaks so the next turn queries UnifiedMemory. @type {boolean} */ #userTurnPending = false;
    /** Needle-matched memory lines injected into the current Context block. @type {string} */ #pendingMemorySnippet = "";
    /** Pacing delay captured from a `<delay ms="…"/>` tag during this turn. @type {number|null} */ #pendingDelayMs = null;
    /** Absolute clock wake-up captured from a `<next time="HH:mm"/>` tag. @type {string|null} */ #pendingNextTime = null;

    /**
     * Closes the active simulation session cleanly on user logout.
     * Aborts pending requests, clears all timers, halts the World heartbeat and
     * resets transient member states — **without destroying the engine**.
     *
     * The World/Chat context (members + message history) is only PAUSED so the
     * Studio can be re-entered later; `world.destroy()` / `chat.destroy()` are
     * reserved for permanent unmounting and would wipe the room to 0 members.
     *
     * @returns {void}
     */
    logout() {
        this.logger.info("User initiated logout. Closing conversation engine...");

        // 1. Abort any in-flight AI request (SSE stream / REST call).
        this.client.abort();

        // 2. Halt the 30s World heartbeat so it cannot tick in the background.
        //    NOTE: pause() — never destroy() — keeps the Chat room context alive.
        this.world.pause();

        // 3. Clear pending turn timers, backoff timers and interrupt handlers.
        if (this.#scheduleNextRequest_TimeOut) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        this.#interruptHandler.destroy();
        this.#clearTypingSettle();

        AmbientAudio.stop();

        // 4. Pause (never destroy) the Chat room: members & messages survive.
        this.chat.pause();

        // 5. Drain character scheduler queues and reset transient visual states.
        for (const member of this.chat.getMembers()) {
            member.scheduler.clear();
            member.setTransientState("isTyping", false, 0);
            member.setTransientState("isReading", false, 0);
            member.setTransientState("isThinking", false, 0);
            member.setTransientState("isActive", false, 0);
            if (member.isAI) {
                member.events.emit(ChatMemberEvents.TYPING, false);
                member.events.emit(ChatMemberEvents.READING, false);
                member.events.emit(ChatMemberEvents.THINKING, false);
                member.events.emit(ChatMemberEvents.ACTIVE, false);
            }
        }

        this.User.isOnline = false;
        this.initialized = false;
        this.protocolBuffer = "";
        this.#generationActive = false;
        this.requesting = false;
        this.consecutiveErrors = 0;
        this.#lastUserMessageText = "";
        this.#userTurnPending = false;
        this.#pendingMemorySnippet = "";
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;
        this.pendingDirectorPlot = null;
        this.#directorResponseStarted = false;

        this.events.emit(ConversationEvents.LOGOUT);
    }

    /**
     * Binds internal event listeners for stream tokens, errors, human messages, and schedule changes.
     * @returns {void}
     */
    #bindInternalEvents() {
        /** Listen for streaming text tokens from the AI client */
        this.client.events.on(
            GroqClientEvents.TEXT,
            /** @param {string} token */ (token) => this.onStreamToken(token),
            "ConversationManager: stream token listener"
        );

        /** Listen for AI client errors and propagate to conversation error event */
        this.client.events.on(
            GroqClientEvents.ERROR,
            /** @param {any} error */ (error) => {
                this.logger.error("Groq client encountered an error:", error);
                this.events.emit(ConversationEvents.ERROR, error);
            },
            "ConversationManager: Groq error listener"
        );

        /** Intercept human messages to trigger interruption handling */
        this.chat.events.on(
            ChatEvents.MESSAGE_ADD,
            /** @param {Message} message */            (message) => {
                if (message && message.sender && !message.sender.isAI) {
                    // Remember the utterance: the next turn routes it through
                    // Needle → UnifiedMemory (Tier 3).
                    this.#lastUserMessageText = message.text || "";
                    this.#userTurnPending = true;
                    this.#handleHumanInterruption();
                }
            },
            "ConversationManager: human message interrupter"
        );

        /** Synchronize dialogue context when schedule segments change */
        this.world.events.on(
            WorldEvents.SCHEDULE_CHANGE,
            () => {
                this.logger.info("Schedule segment updated. Synchronizing dialogue context...");
                this.events.emit(ConversationEvents.SCHEDULE_SYNC, this.world.activeSchedule);
            },
            "ConversationManager: schedule sync listener"
        );
    }

    /**
     * Injects a Director Stage Directive (God Mode) into the dialogue flow.
     * Aborts any in-flight AI requests, injects the plot as a system message,
     * and triggers a new turn request. **No-op in offline mode.**
     *
     * @param {string} plotText The director's plot twist text.
     * @returns {Promise<void>}
     */
    async injectDirectorPlot(plotText) {
        if (!plotText || typeof plotText !== "string" || !plotText.trim()) return;

        // Offline guard: Director mode requires AI, so no-op
        if (!navigator.onLine) {
            this.logger.warn("Director plot injection skipped: App is offline.");
            return;
        }

        const cleanPlot = plotText.trim();
        this.logger.info(`[Director Mode] Injecting Stage Directive: "${cleanPlot}"`);

        this.client.abort();

        for (const member of this.chat.getMembers()) {
            member.scheduler.clear();
            if (member.isAI) {
                member.setTransientState("isTyping", false, 0);
                member.events.emit(ChatMemberEvents.TYPING, false);
            }
        }

        if (this.#scheduleNextRequest_TimeOut) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }

        const directiveMessage = new Message({
            sender: null,
            text: cleanPlot,
            emotion: { name: "Excited" }
        });
        this.chat.addMessage(directiveMessage);

        this.pendingDirectorPlot = cleanPlot;
        this.#directorResponseStarted = false;
        this.events.emit(ConversationEvents.DIRECTOR_EVENT, cleanPlot);

        await this.requestTurn();
        this.pendingDirectorPlot = null;
    }

    /**
     * Delegates to UserInterruptHandler for human interruption logic.
     * Cancels AI queues, waits for typing to settle, then requests a new turn.
     * Human messages originate from an explicit Send / Enter submit, so the
     * handler skips its artificial debounce (Task 3) while still honouring the
     * 800ms typing-settle deferral (Task 6).
     * @returns {void}
     */
    #handleHumanInterruption() {
        // 1. Immediately cancel any pending macro delay / <next> timeout.
        if (this.#scheduleNextRequest_TimeOut !== null) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;

        // 2. Reactivate every AI cast member so they can answer right away.
        for (const member of this.chat.getMembers()) {
            if (member.isAI) {
                member.setTransientState("isActive", true, 4000);
                member.events.emit(ChatMemberEvents.ACTIVE, true);
            }
        }

        // 3. Delegate to interrupt handler.
        this.#interruptHandler.handle({
            user: this.User,
            aiMembers: this.chat.getMembers(),
            aiAbortController: this.client,
            onRequestTurn: () => this.requestTurn(true, this.#lastUserMessageText),
            isExplicitSubmit: true,
            onCancelQueues: () => {
                for (const member of this.chat.getMembers()) {
                    member.scheduler.clear();
                    if (member.isAI) {
                        member.setTransientState("isTyping", false, 0);
                        member.events.emit(ChatMemberEvents.TYPING, false);
                    }
                }
            }
        });
    }

    /**
     * Initializes the manager and boots the simulation.
     * Registers members, loads memories, starts heartbeat, and requests first turn.
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        // Single-flight: a login click racing the reconnect effect (or a
        // StrictMode double-mount) must share ONE boot promise instead of
        // running world.init() twice concurrently.
        if (this.#initPromise) return this.#initPromise;

        this.#initPromise = this.#boot();
        try {
            await this.#initPromise;
        } finally {
            this.#initPromise = null;
        }
    }

    /**
     * Boots the World orchestrator and flips this manager READY.
     * Only ever invoked through init()'s single-flight guard.
     *
     * @returns {Promise<void>}
     */
    async #boot() {
        this.logger.info("Booting ConversationManager and World orchestrator...");

        // Tier 3 memory must be hydrated before the planner can read it.
        await this.unifiedMemory.init();
        await this.world.init();

        // Restore the distilled situation (instead of the default garage text).
        if (this.situationEngine) {
            await this.situationEngine.init();
        }

        this.User.isOnline = true;
        this.initialized = true;
        this.events.emit(ConversationEvents.READY);

        this.scheduleNextRequest();
        this.logger.info("ConversationManager initialized and READY.");
    }

    /**
     * Triggers a Groq turn generation via streaming SSE.
     * **Skipped entirely when offline** — local messages still work.
     *
     * When the human user is mid-typing (follow-up message being composed),
     * the turn is deferred until the 800ms typing cadence settles so the AI
     * never answers while the next sentence is still being written.
     *
     * @returns {Promise<void>}
     */
    /**
     * Triggers a Groq banter turn (Tier 4) via streaming SSE.
     * **Skipped entirely when offline** — local messages still work.
     *
     * On human-initiated turns the utterance is first routed through the
     * Needle worker (Tier 3) so 0-2 relevant UnifiedMemory lines can be
     * injected into the lean prompt.
     *
     * When the human user is mid-typing (follow-up message being composed),
     * the turn is deferred until the 800ms typing cadence settles so the AI
     * never answers while the next sentence is still being written.
     *
     * @param {boolean} [isUserInitiated=false] Whether this turn answers a human message.
     * @param {string} [userMessageText=""] The human utterance to route through Needle.
     * @returns {Promise<void>} */
    async requestTurn(isUserInitiated = false, userMessageText = "") {
        if (this.requesting || !this.initialized) return;

        // Offline guard: Skip AI turn generation when offline
        if (!navigator.onLine) {
            this.logger.debug("requestTurn() skipped: App is offline.");
            return;
        }

        // Typing guard (Task 6): never start a turn while the human user is
        // actively typing — wait for the 800ms settle, then run it.
        if (this.User.isTyping) {
            this.#deferUntilTypingSettles();
            return;
        }

        this.requesting = true;
        this.protocolBuffer = "";
        this.#generationActive = true;
        this.#directorResponseStarted = false;
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;
        this.#pendingMemorySnippet = "";
        this.logger.info("Requesting fresh conversational turn from Groq...");

        try {
            // Tier 3: Needle keyword extraction → deterministic memory lookup.
            await this.#resolveMemorySnippet(isUserInitiated, userMessageText);

            const promptPayload = await this.promptBuilder.build({
                includeSystem: true,
                includeUser: true
            });

            await this.client.streamChat(promptPayload.messages, {
                temperature: 0.85,
                maxTokens: 1200,
                promptType: "dialogue"
            });

            this.consecutiveErrors = 0;

            // Tier 2: feed the completed turn to the Situation & Memory engine.
            this.#tickSituationEngine();
        } catch (err) {
            const error = /** @type {Error & {message: string}} */ (err);
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                this.consecutiveErrors++;
                const backoffMs = Math.min(60_000, 3_000 * Math.pow(2, this.consecutiveErrors - 1));
                this.logger.error(`Turn generation failed (failure #${this.consecutiveErrors}). Backing off for ${Math.round(backoffMs / 1000)}s:`, error.message || error);
                this.events.emit(ConversationEvents.ERROR, error);

                if (this.#scheduleNextRequest_TimeOut !== null) {
                    clearTimeout(this.#scheduleNextRequest_TimeOut);
                }
                this.#scheduleNextRequest_TimeOut = setTimeout(() => {
                    this.#scheduleNextRequest_TimeOut = null;
                    this.scheduleNextRequest();
                }, backoffMs);
                return;
            }
        } finally {
            this.#generationActive = false;
            // Flush any remaining complete records before purging stale buffer
            this.#flushRemainingBuffer();
            this.protocolBuffer = "";
            this.requesting = false;
            this.#pendingMemorySnippet = "";
        }

        this.scheduleNextRequest();
    }

    /**
     * Tier-3 lookup: routes the human utterance through the Needle worker and
     * keeps the 0-2 matching UnifiedMemory lines for the prompt's Context block.
     * Never throws — a routing failure silently degrades to an empty snippet.
     *
     * @param {boolean} isUserInitiated
     * @param {string} userMessageText
     * @returns {Promise<void>}
     */
    async #resolveMemorySnippet(isUserInitiated, userMessageText) {
        const wantsLookup = isUserInitiated || this.#userTurnPending;
        if (!wantsLookup) return;

        // Consume the flag even when the lookup fails so autonomous turns
        // never keep re-querying with a stale utterance.
        this.#userTurnPending = false;

        const queryText = String(userMessageText || this.#lastUserMessageText || "").trim();
        if (!queryText) return;

        try {
            const { keywords, member } = await this.needleRouter.route(queryText);
            this.lastNeedleRoute = `${member}: ${keywords.join(", ") || "none"}`;
            const matches = this.unifiedMemory.searchDeterministic(keywords, [member]);
            if (matches.length > 0) {
                // Hard cap keeps the lean prompt inside its prompt-token budget.
                this.#pendingMemorySnippet = matches.join(" | ").slice(0, 80);
                this.lastRetrievedMemory = this.#pendingMemorySnippet;
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Needle memory routing failed:", err);
        }
    }

    /**
     * Tier-2 tick: counts the completed turn toward the SituationEngine
     * trigger and runs a distillation pass when due (>=10 msgs OR >=10 min).
     *
     * @returns {void}
     */
    #tickSituationEngine() {
        if (!this.situationEngine) return;
        this.situationEngine.recordMessage();

        void this.situationEngine.executeIfDue({
            currentDateTime: this.world.dateTime,
            environmentSummary: `${this.world.environment?.temperature || "32°C"}, ${this.world.environment?.weather || "Warm"}`,
            activeSceneTopic: this.world.activeSchedule?.topic || "Casual hangout",
            activeSceneGoal: this.world.activeSchedule?.mainGoal || "Chat naturally",
            recentDialogue: this.#getRecentChatHistory()
        });
    }

    /**
     * Defers the current turn until the human user's typing cadence settles
     * (TYPING → false after the 800ms inactivity window), then re-issues it.
     * A 3s safety net guarantees the engine is never stranded mid-deferral.
     *
     * @returns {void}
     */
    #deferUntilTypingSettles() {
        if (this.#typingSettleUnsub) return; // already waiting

        this.logger.debug("Turn deferred: human user is typing. Waiting for the 800ms settle...");

        this.#typingSettleUnsub = this.User.events.on(
            ChatMemberEvents.TYPING,
            /** @param {boolean} isTyping */ (isTyping) => {
                if (!isTyping) this.#resolveTypingSettle();
            },
            "ConversationManager: defer turn until typing settles"
        );

        this.#typingSettleTimer = setTimeout(() => {
            this.#resolveTypingSettle(true);
        }, 3_000);
    }

    /**
     * Releases a pending typing-settle deferral and re-issues the turn.
     * @param {boolean} [force=false] Fire even if the user is still typing (safety net).
     * @returns {void}
     */
    #resolveTypingSettle(force = false) {
        this.#clearTypingSettle();

        if (!this.initialized) return; // logged out while waiting
        if (!force && this.User.isTyping) return; // still mid-sentence

        this.logger.debug("Typing settled. Resuming deferred turn request...");
        // Pass the human turn parameters so Tier-3 Needle routing still runs.
        void this.requestTurn(true, this.#lastUserMessageText);
    }

    /**
     * Tears down the typing-settle subscription and safety timer.
     * @returns {void}
     */
    #clearTypingSettle() {
        if (this.#typingSettleUnsub) {
            this.#typingSettleUnsub();
            this.#typingSettleUnsub = null;
        }
        if (this.#typingSettleTimer) {
            clearTimeout(this.#typingSettleTimer);
            this.#typingSettleTimer = null;
        }
    }

    /**
     * Processes streaming text chunks, extracting completed `<record>` XML tags in real-time.
     * Each completed record is parsed and dispatched to the appropriate handler.
     *
     * @param {string} token Incoming token chunk from the SSE stream.
     * @returns {void}
     */
    onStreamToken(token) {
        if (!token || !this.initialized) return;
        if (!this.#generationActive) return;

        this.protocolBuffer += token;

        // Director Mode: announce the moment the cast starts reacting to the
        // injected stage directive so BackgroundBar can show live feedback.
        if (this.pendingDirectorPlot && !this.#directorResponseStarted) {
            this.#directorResponseStarted = true;
            this.events.emit(ConversationEvents.DIRECTOR_RESPONSE_START, this.pendingDirectorPlot);
        }

        // Matches BOTH paired <record>…</record> AND self-closing <record ... />
        // tags so autonomous memories never get trapped in protocolBuffer.
        const recordTagRegex = /<\s*record\b([^>]*?)\s*\/\s*>|<\s*record\b([^>]*)>([\s\S]*?)<\/\s*record\s*>/gi;
        let lastIndex = 0;
        let match;
        /** @type {string[]} */
        const completedTagBlocks = [];

        while ((match = recordTagRegex.exec(this.protocolBuffer)) !== null) {
            completedTagBlocks.push(match[0]);
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex > 0) {
            // Do NOT call stripIncompleteTrailingRecords here — in-flight chunks
            // with unclosed <record> tags must remain in the buffer until
            // subsequent chunks complete them. Only strip at terminal teardown
            // (in #flushRemainingBuffer).
            this.protocolBuffer = this.protocolBuffer.slice(lastIndex);

            for (const tagBlock of completedTagBlocks) {
                const records = this.codec.parseRecords(tagBlock);
                for (const record of records) {
                    this.logger.info("Generated protocol record:", record);
                    this.handleProtocolRecord(record);
                }
            }
        }

        // Tier-4 banter tags: <msg sender="…" reaction="…">text</msg> are
        // dispatched the moment they complete so bubbles keep streaming live.
        const msgTagRegex = /<\s*msg\s+([^>]*?)>([\s\S]*?)<\/\s*msg\s*>/gi;
        let msgMatch;
        let msgLastIndex = 0;
        /** @type {string[]} */
        const completedMsgBlocks = [];

        while ((msgMatch = msgTagRegex.exec(this.protocolBuffer)) !== null) {
            completedMsgBlocks.push(msgMatch[0]);
            msgLastIndex = msgMatch.index + msgMatch[0].length;
        }

        if (msgLastIndex > 0) {
            this.protocolBuffer = this.protocolBuffer.slice(msgLastIndex);

            for (const msgBlock of completedMsgBlocks) {
                const attrs = msgBlock.match(/<\s*msg\s+([^>]*?)>/i)?.[1] || "";
                const sender = attrs.match(/sender\s*=\s*["']([^"']+)["']/i)?.[1] || "";
                const reaction = attrs.match(/reaction\s*=\s*["']([^"']+)["']/i)?.[1] || "Default";
                const text = msgBlock
                    .replace(/<\s*msg\s+[^>]*?>/i, "")
                    .replace(/<\/\s*msg\s*>/gi, "")
                    .trim();
                this.handleBanterMessage(sender, reaction, text);
            }
        }

        // Tier-4 macro pacing tags drive the next turn timer.
        const delayMatch = this.protocolBuffer.match(/<\s*delay\s+ms=["'](\d+)["']\s*\/?>/i);
        if (delayMatch) {
            this.#pendingDelayMs = Math.max(0, Number(delayMatch[1]) || 0);
            this.protocolBuffer = this.protocolBuffer.replace(delayMatch[0], "");
        }

        // Absolute clock wake-up: <next time="HH:mm"/>
        const nextMatch = this.protocolBuffer.match(/<\s*next\s+time=["'](\d{1,2}:\d{2})["']\s*\/?>/i);
        if (nextMatch) {
            this.#pendingNextTime = nextMatch[1];
            this.protocolBuffer = this.protocolBuffer.replace(nextMatch[0], "");
        }

        // Safety: Prune buffer if it grows too large
        if (this.protocolBuffer.length > 16_000) {
            this.logger.warn("Protocol buffer exceeded safety threshold. Pruning leading characters.");
            this.protocolBuffer = this.protocolBuffer.slice(-4_000);
        }
    }

    /**
     * Flushes any remaining complete records from the protocol buffer before clearing it.
     * Strips incomplete trailing record tags to avoid stale XML from polluted subsequent turns.
     *
     * @returns {void}
     */
    #flushRemainingBuffer() {
        if (!this.protocolBuffer) return;

        // Strip any incomplete trailing <record> tag from an aborted stream
        const cleanBuffer = ProtocolCodec.stripIncompleteTrailingRecords(this.protocolBuffer);

        if (cleanBuffer.trim()) {
            const records = this.codec.parseRecords(cleanBuffer);
            for (const record of records) {
                this.logger.info("Flushed remaining protocol record:", record);
                this.handleProtocolRecord(record);
            }
        }
    }

    /**
     * Dispatches parsed protocol records to the appropriate subsystem handler.
     * @param {ProtocolRecord} protocol The parsed protocol record.
     * @returns {void}
     */
    handleProtocolRecord(protocol) {
        switch (protocol.recordType) {
            case "message": this.handleMessage(protocol); break;
            case "memory-set": this.handleMemorySet(protocol); break;
            case "memory-remove": this.handleMemoryRemove(protocol); break;
            default: break;
        }
    }

    /**
     * Handles parsed dialogue message records by creating a Message instance
     * and adding it to the timeline processor for pacing and delivery.
     * @param {MessageProtocolRecord} protocol The message protocol record.
     * @returns {void}
     */
    handleMessage(protocol) {
        const sender = this.chat.getMember(protocol.sender);
        if (!sender) {
            this.logger.warn(`Sender "${protocol.sender}" is not registered.`);
            return;
        }

        const message = new Message({
            protocolId: protocol.id == null ? null : String(protocol.id),
            protocolReplyId: protocol.replyToID == null ? null : String(protocol.replyToID),
            sender,
            text: protocol.text,
            emotion: { name: protocol.reaction }
        });

        this.timelineProcessor.add(message);
    }

    /**
     * Handles a Tier-4 `<msg sender reaction>` banter tag by queueing the line
     * on the sender's timeline for paced delivery.
     *
     * @param {string} sender Raw sender id from the tag.
     * @param {string} reaction Reaction name from the tag.
     * @param {string} text Dialogue payload.
     * @returns {void}
     */
    handleBanterMessage(sender, reaction, text) {
        if (!text) return;

        const member = this.chat.getMember(String(sender || "").toLowerCase());
        if (!member) {
            this.logger.warn(`<msg> sender "${sender}" is not registered.`);
            return;
        }

        this.timelineProcessor.add(new Message({
            sender: member,
            text,
            emotion: { name: reaction }
        }));
    }

    /**
     * Handles dynamic memory creation with versatile TTL units.
     * Uses MemoryExpiryParser for consistent expiry parsing ('15m', '2h', 'forever', etc.).
     * @param {MemorySetProtocolRecord} protocol The memory-set protocol record.
     * @returns {void}
     */
    handleMemorySet(protocol) {
        const targetMember = this.chat.getMember(protocol.member) || this.User;
        if (!targetMember) return;

        const expiryDate = MemoryExpiryParser.parse(protocol.expiry);
        targetMember.memory.set(protocol.key, protocol.value, expiryDate);
        void targetMember.saveMemory();

        this.logger.info(`[Dynamic Memory Set] Saved fact for ${targetMember.name}: "${protocol.key}" -> "${protocol.value}" (Expiry: ${protocol.expiry})`);
        this.events.emit(ConversationEvents.MEMORY_UPDATE, { memberId: targetMember.id, key: protocol.key, action: "set" });
    }

    /**
     * Handles autonomous memory deletion for a specific member and key.
     * @param {MemoryRemoveProtocolRecord} protocol The memory-remove protocol record.
     * @returns {void}
     */
    handleMemoryRemove(protocol) {
        const targetMember = this.chat.getMember(protocol.member) || this.User;
        if (!targetMember) return;

        targetMember.memory.delete(protocol.key);
        void targetMember.saveMemory();

        this.logger.info(`[Memory Remove] Deleted fact for ${targetMember.name}: "${protocol.key}"`);
        this.events.emit(ConversationEvents.MEMORY_UPDATE, { memberId: targetMember.id, key: protocol.key, action: "remove" });
    }

    /**
     * Schedules the next autonomous AI turn from the macro-pacing tags the
     * model emitted this turn, anchored to the moment the LAST queued message
     * finishes being delivered/read on screen:
     *
     * - `<next time="HH:mm"/>` → absolute clock wake-up; the cast is marked
     *   inactive for the whole wait and reactivated when the timer fires.
     * - `<delay ms="…"/>`      → relative pause that starts AFTER last delivery.
     * - neither                → default 4s banter pacing after last delivery.
     *
     * @returns {void}
     */
    scheduleNextRequest() {
        if (!this.initialized || this.consecutiveErrors > 0) return;

        if (this.#scheduleNextRequest_TimeOut !== null) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }

        const explicitDelay = this.#pendingDelayMs;
        const nextTimeStr = this.#pendingNextTime;
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;

        // Epoch ms at which the slowest queued typing/reading finishes.
        const lastMessageDeliveredAt = this.timelineProcessor.getLastTime();
        const now = Date.now();
        let targetTimeMs;

        if (nextTimeStr) {
            // Case A: absolute clock time (e.g. <next time="06:00"/>)
            const [targetH, targetM] = nextTimeStr.split(":").map(Number);
            const targetDate = new Date(this.world.now);
            targetDate.setHours(targetH || 0, targetM || 0, 0, 0);

            if (targetDate.getTime() <= now) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
            targetTimeMs = targetDate.getTime();

            // Mark the AI cast inactive for the whole wait — no character acts
            // out a scene while the room is waiting for the future clock time.
            for (const member of this.chat.getMembers()) {
                if (member.isAI) {
                    member.setTransientState("isActive", false, 0);
                    member.events.emit(ChatMemberEvents.ACTIVE, false);
                }
            }
            this.logger.info(`Turn completed. Cast paused until ${nextTimeStr} (${Math.round((targetTimeMs - now) / 60000)}m wait).`);
        } else if (explicitDelay !== null) {
            // Case B: explicit relative delay starts AFTER the last message delivery.
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + explicitDelay;
            this.logger.info(`Turn completed. Next request scheduled ${explicitDelay / 1000}s AFTER last message delivery.`);
        } else {
            // Case C: default banter pacing (4 seconds after last message delivery).
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + 4000;
        }

        const waitDurationMs = Math.max(100, targetTimeMs - now);

        this.#scheduleNextRequest_TimeOut = setTimeout(() => {
            this.#scheduleNextRequest_TimeOut = null;
            // Reactivate the cast the moment the scheduled wait ends.
            for (const member of this.chat.getMembers()) {
                if (member.isAI) {
                    member.setTransientState("isActive", true, 4000);
                    member.events.emit(ChatMemberEvents.ACTIVE, true);
                }
            }
            void this.requestTurn();
        }, waitDurationMs);
    }

    /**
     * Schedules the next autonomous turn after an explicit pacing delay
     * (parsed from the `<delay ms="…"/>` tag emitted by Tier 4).
     *
     * @param {number} delayMs Milliseconds to wait before the next turn.
     * @returns {void}
     */
    scheduleNextRequestWithDelay(delayMs) {
        this.#pendingDelayMs = Math.max(0, Number(delayMs) || 0);
        this.scheduleNextRequest();
    }

    /**
     * Merges committed chat messages with in-flight scheduler queues.
     * Returns the last 7 committed messages (capped at 8 after the merge) for
     * prompt context building — a tight window that keeps the dialogue history
     * small enough for the per-turn token budget.
     * @returns {Message[]} Merged, deduplicated and capped recent messages.
     */
    getRecentMessages() {
        /** @type {Message[]} */
        const committed = this.chat.getHistory(7);
        /** @type {Map<string, Message>} */
        const dedupeMap = new Map();

        for (const msg of committed) dedupeMap.set(msg.id, msg);

        for (const member of this.chat.getMembers()) {
            const timeline = member.scheduler.getTimeline();
            for (const event of timeline) {
                if (event.type === "message" && event.message) {
                    if (!dedupeMap.has(event.message.id)) {
                        dedupeMap.set(event.message.id, event.message);
                    }
                }
            }
        }

        return [...dedupeMap.values()].slice(-8);
    }

    /**
     * Resets dialogue history and character visual states.
     * Clears all messages, memories, scheduler queues, and storage.
     * @returns {Promise<void>}
     */
    async reset() {
        this.logger.info("Executing System Reset...");

        if (this.#scheduleNextRequest_TimeOut) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        this.#interruptHandler.destroy();
        this.#clearTypingSettle();

        this.client.abort();

        this.protocolBuffer = "";
        this.#generationActive = false;
        this.requesting = false;
        this.consecutiveErrors = 0;
        this.#lastUserMessageText = "";
        this.#userTurnPending = false;
        this.#pendingMemorySnippet = "";
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;
        this.lastNeedleRoute = null;
        this.lastRetrievedMemory = "";

        // System reset also wipes the shared Tier-3 episodic stack.
        this.unifiedMemory.entries = [];
        await this.unifiedMemory.persist();

        await this.chat.clear();
        await new Storage("Scheduler").clear();

        const memoriesStorage = new Storage("Memories");
        for (const member of this.chat.getMembers()) {
            member.resetState();
            if (member.isAI) {
                try {
                    await memoriesStorage.removeItem(`memory:${member.id}`);
                    await memoriesStorage.removeItem(`state:${member.id}`);
                    member.memory.clear();
                    member.stateMemory.clear();
                } catch (/** @type {unknown} */ err) {
                    this.logger.warn(`Failed to purge memory for ${member.id}:`, err);
                }
            }
        }

        this.logger.info("Reset complete. Starting clean dialogue session...");
        this.scheduleNextRequest();
    }

    // =========================================================================
    // PROMPT REGISTRATION
    // =========================================================================

    /**
     * Configures full-XML system instructions, character definitions, and protocol rules.
     * Registers multiple system and user prompt blocks that are compiled on each turn request.
     *
     * @param {PromptBuilderClass} builder The prompt builder instance to configure.
     * @returns {void}
     */
    registerPrompt(builder) {
        /**
         * TIER-4 LEAN PROMPT (Tier 4 = Groq Banter Engine).
         *
         * Grounding = Tier-2 situation paragraph + simulation clock + 0-2
         * Needle memory lines + the last 1000 characters of chat. The expected
         * <msg>/<delay>/<next> XML structures are shown as raw tag text (no
         * backtick code fences) and memories sit in their own Markdown block.
         */
        builder.useSystem(() => {
            const castIds = [...this.world.members.keys()].join(", ") || "tom, angela, ben, ginger, hank, becca";
            const situation = this.situationEngine
                ? this.situationEngine.situationText
                : "Cast is hanging out in Lucknow, chatting casually.";
            const memorySection = this.#pendingMemorySnippet
                ? `\n\n## Active Memories\n\`\`\`\n${this.#pendingMemorySnippet}\n\`\`\``
                : "";

            return builder.part([
                "# Live Group Chat: Tom & Friends (Lucknow, India)",
                `Cast: ${castIds}`,
                "",
                "## Ambient Setting",
                `- Time: ${this.world.dateTime}`,
                `- Atmosphere: ${situation}${memorySection}`,
                "",
                "## Dialogue Instructions",
                "- Language: Natural Lucknow Hinglish (Roman/Latin script only).",
                "- When a human user speaks, reply to them directly first. The ambient setting is background atmosphere.",
                "- Output 1 to 3 messages using:",
                '<msg sender="id" reaction="ReactionName">message text</msg>',
                "- After all messages, output exactly one pacing tag:",
                '  * For active banter: <delay ms="3000"/> to <delay ms="5000"/>',
                '  * For thoughtful pause / waiting for user: <delay ms="20000"/> to <delay ms="60000"/>',
                '  * For specific future time: <next time="HH:MM"/> (e.g. <next time="18:30"/>)'
            ].join("\n"));
        });

        /** Director override: injects plot twists as stage directives */
        builder.useUser(() => {
            if (this.pendingDirectorPlot) {
                return builder.part(`Stage directive: ${this.pendingDirectorPlot}`);
            }
            return null;
        });

        /** Recent dialogue history (<= 1000 chars, isolated Markdown block) */
        builder.useUser(() => builder.part([
            "## Recent Chat",
            "```",
            this.#getRecentChatHistory() || "Chat begins now.",
            "```"
        ].join("\n")));
    }

    /**
     * Formats recent dialogue into a plain-text transcript capped at 1000
     * characters (newest lines win). Used for both the Tier-4 prompt window
     * and the Tier-2 distillation batch.
     *
     * @returns {string} Plain-text recent chat block.
     */
    #getRecentChatHistory() {
        const recent = this.getRecentMessages();
        let history = "";

        for (let i = recent.length - 1; i >= 0; i--) {
            const msg = recent[i];
            if (!msg || msg.deleted) continue;

            const senderName = msg.sender?.name || "Me";
            const line = `${senderName}: ${msg.text}\n`;
            if (history.length + line.length > 1000) break;
            history = line + history;
        }

        return history.replace(/\n+$/, "");
    }
}
