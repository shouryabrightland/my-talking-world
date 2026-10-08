// @ts-check

/**
 * @file ConversationManager.js
 * Central dialogue flow and turn orchestrator.
 */

/** @typedef {import("./PromptBuilder").default} PromptBuilder */
/** @typedef {import("./types/Protocol.types").ProtocolRecord} ProtocolRecord */
/** @typedef {import("./types/Protocol.types").MessageProtocolRecord} MessageProtocolRecord */
/** @typedef {import("./ChatMember").default} ChatMember */

import Chat, { ChatEvents } from "./Chat";
import { ChatMemberEvents } from "./ChatMember";
import EventManager from "./EventManager";
import GroqClient, { GroqClientEvents } from "./GroqClient";
import Message from "./Message";
import TimelineProcessor from "./TimelineProcessor";
import PromptBuilderClass from "./PromptBuilder";
import ProtocolCodec from "./ProtocolCodec";
import Reaction from "./Reaction";
import Storage from "./lib/Storage";
import UnifiedMemory from "./lib/UnifiedMemory";
import NeedleRouter from "./lib/NeedleRouter";
import SituationEngine from "./SituationEngine";
import World, { WorldEvents } from "./World";
import UserInterruptHandler from "./lib/UserInterruptHandler";
import { Members } from "../util/member";
import { AmbientAudio } from "../util/sound";
import Logger from "./lib/Logger";

export const ConversationEvents = {
    READY: "conversation:ready",
    ERROR: "conversation:error",
    SCHEDULE_SYNC: "conversation:schedule:sync",
    DIRECTOR_EVENT: "conversation:director:event",
    DIRECTOR_RESPONSE_START: "conversation:director:response:start",
    MEMORY_COMPRESS_START: "conversation:memory:compress:start",
    MEMORY_COMPRESS_DONE: "conversation:memory:compress:done",
    MEMORY_COMPRESS_ERROR: "conversation:memory:compress:error",
    LOGOUT: "conversation:logout"
};

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

        /** @readonly @type {UnifiedMemory} */
        this.unifiedMemory = new UnifiedMemory(this.logger);
        this.world.unifiedMemory = this.unifiedMemory;

        /** @readonly @type {NeedleRouter} */
        this.needleRouter = new NeedleRouter();

        /** @readonly @type {SituationEngine} */
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
            logger: this.logger
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

    get isReady() {
        return this.initialized;
    }

    /** @type {ReturnType<typeof setTimeout>|null} */ #scheduleNextRequest_TimeOut = null;
    /** @readonly @type {UserInterruptHandler} */ #interruptHandler;
    /** @type {boolean} */ #generationActive;
    /** @type {boolean} */ #directorResponseStarted = false;
    /** @type {Function|null} */ #typingSettleUnsub = null;
    /** @type {ReturnType<typeof setTimeout>|null} */ #typingSettleTimer = null;
    /** @type {Promise<void>|null} */ #initPromise = null;
    /** @type {string} */ #lastUserMessageText = "";
    /** @type {boolean} */ #userTurnPending = false;
    /** @type {string} */ #pendingMemorySnippet = "";
    /** @type {string} Fresh human utterance for the ACTIVE turn (empty on autonomous turns). */ #activeHumanUtterance = "";
    /** @type {number|null} */ #pendingDelayMs = null;
    /** @type {string|null} */ #pendingNextTime = null;

    logout() {
        this.logger.info("User initiated logout. Closing conversation engine...");

        this.client.abort();
        this.world.pause();

        if (this.#scheduleNextRequest_TimeOut) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        this.#interruptHandler.destroy();
        this.#clearTypingSettle();

        AmbientAudio.stop();
        this.chat.pause();

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
        this.#activeHumanUtterance = "";
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;
        this.pendingDirectorPlot = null;
        this.#directorResponseStarted = false;

        this.events.emit(ConversationEvents.LOGOUT);
    }

    #bindInternalEvents() {
        this.client.events.on(
            GroqClientEvents.TEXT,
            /** @param {string} token */(token) => this.onStreamToken(token),
            "ConversationManager: stream token listener"
        );

        this.client.events.on(
            GroqClientEvents.ERROR,
            /** @param {any} error */(error) => {
                this.logger.error("Groq client encountered an error:", error);
                this.events.emit(ConversationEvents.ERROR, error);
            },
            "ConversationManager: Groq error listener"
        );

        this.chat.events.on(
            ChatEvents.MESSAGE_ADD,
            /** @param {Message} message */(message) => {
                if (message && message.sender && !message.sender.isAI) {
                    this.#lastUserMessageText = message.text || "";
                    this.#userTurnPending = true;
                    this.#handleHumanInterruption();
                }
            },
            "ConversationManager: human message interrupter"
        );

        this.world.events.on(
            WorldEvents.SCHEDULE_CHANGE,
            () => {
                this.logger.info("Schedule segment updated. Synchronizing dialogue context...");
                this.events.emit(ConversationEvents.SCHEDULE_SYNC, this.world.activeSchedule);
            },
            "ConversationManager: schedule sync listener"
        );

        this.world.events.on(
            WorldEvents.READY,
            () => this.#runInitialSituationPass(),
            "ConversationManager: initial situation on world ready"
        );

        this.world.events.on(
            WorldEvents.ENVIRONMENT_CHANGE,
            (/** @type {import("./types/World.types").EnvironmentSnapshot} */ env) => {
                if (env) void this.unifiedMemory.syncEnvironment(env);
            },
            "ConversationManager: sync environment to unified memory"
        );
    }

    /**
     * Injects a Stage Directive from Director Mode into the live conversation.
     *
     * @param {string} plotText
     * @returns {Promise<void>}
     */
    async injectDirectorPlot(plotText) {
        if (!plotText || typeof plotText !== "string" || !plotText.trim()) return;
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

    #handleHumanInterruption() {
        if (this.#scheduleNextRequest_TimeOut !== null) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;

        for (const member of this.chat.getMembers()) {
            if (member.isAI) {
                member.setTransientState("isActive", true, 4000);
                member.events.emit(ChatMemberEvents.ACTIVE, true);
            }
        }

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

    async init() {
        if (this.initialized) return;

        if (this.#initPromise) return this.#initPromise;

        this.#initPromise = this.#boot();
        try {
            await this.#initPromise;
        } finally {
            this.#initPromise = null;
        }
    }

    async #boot() {
        this.logger.info("Booting ConversationManager and World orchestrator...");

        await this.unifiedMemory.init();
        await this.world.init();

        if (this.world.environment) {
            await this.unifiedMemory.syncEnvironment(this.world.environment);
        }

        if (this.situationEngine) {
            await this.situationEngine.init();
            this.#runInitialSituationPass();
        }

        this.User.isOnline = true;
        this.initialized = true;
        this.events.emit(ConversationEvents.READY);

        this.scheduleNextRequest();
        this.logger.info("ConversationManager initialized and READY.");
    }

    /**
     * @param {boolean} [isUserInitiated=false]
     * @param {string} [userMessageText=""]
     * @returns {Promise<void>}
     */
    async requestTurn(isUserInitiated = false, userMessageText = "") {
        if (this.requesting || !this.initialized) return;

        if (!navigator.onLine) {
            this.logger.debug("requestTurn() skipped: App is offline.");
            return;
        }

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
        // Fresh human utterance for THIS turn — captured before the Tier-3
        // lookup consumes #userTurnPending. Drives the prompt's "Human Just
        // Said" priority block and the SituationEngine's scene anchoring.
        this.#activeHumanUtterance = (isUserInitiated || this.#userTurnPending)
            ? String(userMessageText || this.#lastUserMessageText || "").trim()
            : "";
        this.logger.info("Requesting fresh conversational turn from Groq...");

        try {
            // Tier 3: route the live chat (human message first) through Needle → UnifiedMemory.
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
            this.#flushRemainingBuffer();
            this.protocolBuffer = "";
            this.requesting = false;
            this.#pendingMemorySnippet = "";
            this.#activeHumanUtterance = "";
        }

        this.scheduleNextRequest();
    }

    /**
     * Tier-3 lookup: routes the LIVE CHAT through Needle so 0-2
     * relevant UnifiedMemory lines are injected for the active topic.
     * The human's latest message leads the query (highest keyword priority)
     * with the recent chat window supplying conversational context after it;
     * autonomous turns route the recent chat on its own so memory follows
     * the conversation instead of only the user. Never throws — a routing
     * failure silently degrades to an empty snippet.
     *
     * @param {boolean} isUserInitiated Whether this turn answers a human message.
     * @param {string} userMessageText The human utterance to lead the lookup with.
     * @returns {Promise<void>}
     */
    async #resolveMemorySnippet(isUserInitiated, userMessageText) {
        const humanTurn = isUserInitiated || this.#userTurnPending;

        // Consume the flag even when the lookup fails so autonomous turns
        // never keep re-querying with a stale utterance.
        this.#userTurnPending = false;

        // Human turn → their latest words LEAD the query (the deterministic
        // extractors pick keywords in order of appearance, so the user's
        // topic wins); autonomous turn → the recent chat alone drives it.
        const humanText = humanTurn
            ? String(userMessageText || this.#lastUserMessageText || "").trim()
            : "";
        const chatText = this.#getRecentChatHistory();
        const queryText = [humanText, chatText].filter(Boolean).join("\n").trim();
        if (!queryText) return;

        try {
            const { keywords, member } = await this.needleRouter.route(queryText);
            this.lastNeedleRoute = `${member}: ${keywords.join(", ") || "none"}`;

            const matches = this.unifiedMemory.searchDeterministic(keywords, [member]);
            if (matches.length > 0) {
                // Keep the top 1-2 memory lines intact without word truncation
                this.#pendingMemorySnippet = matches.slice(0, 2).join("\n").slice(0, 300);
                this.lastRetrievedMemory = this.#pendingMemorySnippet;
            } else {
                this.#pendingMemorySnippet = "";
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Needle memory routing failed:", err);
            this.#pendingMemorySnippet = "";
        }
    }

    /**
     * @returns {import("./SituationEngine").SituationContext}
     */
    #buildSituationContext() {
        const activeSchedule = this.world.activeSchedule;

        const castSummary = [...this.world.members.values()]
            .filter(m => m.isAI)
            .map(m => {
                const goal = activeSchedule?.characterGoals?.find(cg => cg.id === m.id)?.goal || "hanging out";
                return `${m.name} [Mood: ${m.currentEmotion?.name || "Default"}, Goal: ${goal}]`;
            })
            .join(" · ");

        return {
            currentDateTime: this.world.dateTime,
            environmentSummary: `${this.world.environment?.temperature || "32°C"}, ${this.world.environment?.weather || "Warm"}`,
            location: this.world.environment?.city || "Lucknow Studio",
            activeSceneTopic: activeSchedule?.topic || "Casual hangout",
            activeSceneGoal: activeSchedule?.mainGoal || "Chat naturally",
            castStates: castSummary || "Cast members are hanging out.",
            recentDialogue: this.#getRecentChatHistory(),
            // Fresh human utterance (if any) — the situation must stay
            // anchored on it rather than drifting to its own scene focus.
            latestHumanMessage: this.#activeHumanUtterance
        };
    }

    #runInitialSituationPass() {
        if (!this.situationEngine || !navigator.onLine) return;

        this.logger.info("Triggering ambient situation pass...");
        void this.situationEngine.executeIfDue(this.#buildSituationContext(), true).catch((/** @type {unknown} */ err) => {
            this.logger.warn("Ambient situation pass failed:", err);
        });
    }

    #tickSituationEngine() {
        if (!this.situationEngine) return;
        this.situationEngine.recordMessage();

        void this.situationEngine.executeIfDue(this.#buildSituationContext());
    }

    #deferUntilTypingSettles() {
        if (this.#typingSettleUnsub) return;

        this.logger.debug("Turn deferred: human user is typing. Waiting for the 800ms settle...");

        this.#typingSettleUnsub = this.User.events.on(
            ChatMemberEvents.TYPING,
            /** @param {boolean} isTyping */(isTyping) => {
                if (!isTyping) this.#resolveTypingSettle();
            },
            "ConversationManager: defer turn until typing settles"
        );

        this.#typingSettleTimer = setTimeout(() => {
            this.#resolveTypingSettle(true);
        }, 3_000);
    }

    #resolveTypingSettle(force = false) {
        this.#clearTypingSettle();

        if (!this.initialized) return;
        if (!force && this.User.isTyping) return;

        this.logger.debug("Typing settled. Resuming deferred turn request...");
        void this.requestTurn(true, this.#lastUserMessageText);
    }

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
     * @param {string} token
     * @returns {void}
     */
    onStreamToken(token) {
        if (!token || !this.initialized) return;
        if (!this.#generationActive) return;

        this.protocolBuffer += token;

        if (this.pendingDirectorPlot && !this.#directorResponseStarted) {
            this.#directorResponseStarted = true;
            this.events.emit(ConversationEvents.DIRECTOR_RESPONSE_START, this.pendingDirectorPlot);
        }

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
            this.protocolBuffer = this.protocolBuffer.slice(lastIndex);

            for (const tagBlock of completedTagBlocks) {
                const records = this.codec.parseRecords(tagBlock);
                for (const record of records) {
                    this.logger.info("Generated protocol record:", record);
                    this.handleProtocolRecord(record);
                }
            }
        }

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

        const delayMatch = this.protocolBuffer.match(/<\s*delay\s+ms=["'](\d+)["']\s*\/?>/i);
        if (delayMatch) {
            this.#pendingDelayMs = Math.max(0, Number(delayMatch[1]) || 0);
            this.protocolBuffer = this.protocolBuffer.replace(delayMatch[0], "");
        }

        const nextMatch = this.protocolBuffer.match(/<\s*next\s+time=["'](\d{1,2}:\d{2})["']\s*\/?>/i);
        if (nextMatch) {
            this.#pendingNextTime = nextMatch[1];
            this.protocolBuffer = this.protocolBuffer.replace(nextMatch[0], "");
        }

        if (this.protocolBuffer.length > 16_000) {
            this.logger.warn("Protocol buffer exceeded safety threshold. Pruning leading characters.");
            this.protocolBuffer = this.protocolBuffer.slice(-4_000);
        }
    }

    #flushRemainingBuffer() {
        if (!this.protocolBuffer) return;

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
     * @param {ProtocolRecord} protocol
     * @returns {void}
     */
    handleProtocolRecord(protocol) {
        switch (protocol.recordType) {
            case "message": this.handleMessage(protocol); break;
            default: break;
        }
    }

    /**
     * @param {MessageProtocolRecord} protocol
     * @returns {void}
     */
    handleMessage(protocol) {
        const cleanSender = String(protocol.sender || "").toLowerCase().trim();

        // Guard: AI must NEVER generate messages for the human user ("me")
        if (cleanSender === "me" || cleanSender === this.User.id.toLowerCase()) {
            this.logger.warn(`Rejected AI protocol message impersonating human user ("${protocol.sender}").`);
            return;
        }

        const sender = this.chat.getMember(cleanSender);
        if (!sender || !sender.isAI) {
            this.logger.warn(`Sender "${protocol.sender}" is not an AI character.`);
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
     * @param {string} sender
     * @param {string} reaction
     * @param {string} text
     * @returns {void}
     */
    handleBanterMessage(sender, reaction, text) {
        if (!text) return;

        const cleanSender = String(sender || "").toLowerCase().trim();

        // Guard: AI must NEVER generate messages for the human user ("me")
        if (cleanSender === "me" || cleanSender === this.User.id.toLowerCase()) {
            this.logger.warn(`Rejected AI message impersonating human user ("${sender}").`);
            return;
        }

        const member = this.chat.getMember(cleanSender);
        if (!member || !member.isAI) {
            this.logger.warn(`<msg> sender "${sender}" is not a registered AI character.`);
            return;
        }

        this.timelineProcessor.add(new Message({
            sender: member,
            text,
            emotion: { name: reaction }
        }));
    }

    /**
     * Manually runs the UnifiedMemory Gemma compression pass (Settings →
     * Unified Memory → "Compress Stack") and reports its lifecycle on the
     * conversation event bus so the Background Bar can visualize progress.
     *
     * @returns {Promise<"compressed"|"skipped"|"error"|"busy">} Outcome.
     */
    async compressUnifiedMemory() {
        const memory = this.unifiedMemory;
        if (!memory || memory.isCompressing) return "busy";

        const wasOverBudget = memory.getCharacterCount() >= UnifiedMemory.MAX_CHARACTERS;

        this.events.emit(ConversationEvents.MEMORY_COMPRESS_START, {
            characterCount: memory.getCharacterCount(),
            entryCount: memory.entries.length
        });

        const gemmaClient = this.world?.worldSetter?.geminiClient || null;
        if (!gemmaClient) {
            this.events.emit(ConversationEvents.MEMORY_COMPRESS_ERROR, {
                message: "Gemini client unavailable — start a session first."
            });
            return "error";
        }

        try {
            // Manual button: force a pass even under the 20k budget.
            const compressed = await memory.compressIfExceeded(gemmaClient, true);
            if (compressed) {
                this.events.emit(ConversationEvents.MEMORY_COMPRESS_DONE, {
                    compressed: true,
                    entryCount: memory.entries.length,
                    characterCount: memory.getCharacterCount()
                });
                return "compressed";
            }

            // Over budget but the model could not produce a smaller stack:
            // report an honest failure (original stack kept) instead of "skipped".
            if (wasOverBudget) {
                this.events.emit(ConversationEvents.MEMORY_COMPRESS_ERROR, {
                    message: "Model output was not smaller — the original stack was kept."
                });
                return "error";
            }

            this.events.emit(ConversationEvents.MEMORY_COMPRESS_DONE, {
                compressed: false,
                entryCount: memory.entries.length,
                characterCount: memory.getCharacterCount()
            });
            return "skipped";
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Unified memory compression failed:", err);
            this.events.emit(ConversationEvents.MEMORY_COMPRESS_ERROR, {
                message: err instanceof Error ? err.message : String(err)
            });
            return "error";
        }
    }

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

        const lastMessageDeliveredAt = this.timelineProcessor.getLastTime();
        const now = Date.now();
        let targetTimeMs;

        if (nextTimeStr) {
            const [targetH, targetM] = nextTimeStr.split(":").map(Number);
            const targetDate = new Date(this.world.now);
            targetDate.setHours(targetH || 0, targetM || 0, 0, 0);

            if (targetDate.getTime() <= now) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
            targetTimeMs = targetDate.getTime();

            for (const member of this.chat.getMembers()) {
                if (member.isAI) {
                    member.setTransientState("isActive", false, 0);
                    member.events.emit(ChatMemberEvents.ACTIVE, false);
                }
            }
            this.logger.info(`Turn completed. Cast paused until ${nextTimeStr} (${Math.round((targetTimeMs - now) / 60000)}m wait).`);
        } else if (explicitDelay !== null) {
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + explicitDelay;
            this.logger.info(`Turn completed. Next request scheduled ${explicitDelay / 1000}s AFTER last message delivery.`);
        } else {
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + 4000;
        }

        const waitDurationMs = Math.max(100, targetTimeMs - now);

        this.#scheduleNextRequest_TimeOut = setTimeout(() => {
            this.#scheduleNextRequest_TimeOut = null;
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
     * @param {number} delayMs
     * @returns {void}
     */
    scheduleNextRequestWithDelay(delayMs) {
        this.#pendingDelayMs = Math.max(0, Number(delayMs) || 0);
        this.scheduleNextRequest();
    }

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
        this.#activeHumanUtterance = "";
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;
        this.lastNeedleRoute = null;
        this.lastRetrievedMemory = "";

        this.unifiedMemory.entries = [];
        await this.unifiedMemory.persist();

        await this.chat.clear();
        await new Storage("Scheduler").clear();

        const memoriesStorage = new Storage("Memories");
        for (const member of this.chat.getMembers()) {
            member.resetState();
            if (member.isAI) {
                try {
                    // Purge legacy per-member memory rows (old keyed-memory arch).
                    await memoriesStorage.removeItem(`memory:${member.id}`);
                    await memoriesStorage.removeItem(`state:${member.id}`);
                    member.stateMemory.clear();
                } catch (/** @type {unknown} */ err) {
                    this.logger.warn(`Failed to purge memory for ${member.id}:`, err);
                }
            }
        }

        if (this.situationEngine) {
            await this.situationEngine.reset();
            this.#runInitialSituationPass();
        }

        this.logger.info("Reset complete. Starting clean dialogue session...");
        this.scheduleNextRequest();
    }

    /**
     * Configures clean, modular Markdown sections for Groq dialogue.
     *
     * @param {PromptBuilderClass} builder The prompt builder instance.
     * @returns {void}
     */
    registerPrompt(builder) {
        builder.useSystem(() => {
            // Strictly AI characters only (never "me")
            const aiMembers = [...this.world.members.values()].filter(m => m.isAI);
            const castIds = aiMembers
                .map(m => (Number.isFinite(m.age) && m.age > 0 ? `${m.id} (${m.age})` : m.id))
                .join(", ") || "tom (28), angela (24), ben (19), ginger (17), hank (26), becca (22)";

            const situation = this.situationEngine
                ? this.situationEngine.situationText
                : "The group is gathered together in Lucknow, catching up and chatting naturally.";

            // Isolated markdown block for retrieved memories
            const memorySection = this.#pendingMemorySnippet
                ? `\n## Active Memories\n\`\`\`\n${this.#pendingMemorySnippet}\n\`\`\`\n`
                : "";

            return builder.part([
                "# Live Group Chat: Tom & Friends (Lucknow, India)",
                "",
                "## Cast:",
                castIds,
                "- Speak each cast member at their listed age.",
                "",
                "## Ambient Setting",
                `- Time: ${this.world.dateTime}`,
                `- Atmosphere: ${situation}`,
                memorySection,
                "## Turn Priority",
                "1) The human's LATEST message — answer it first.",
                "2) The recent chat flow.",
                "3) Ambient setting is background only.",
                "",
                "## Dialogue Instructions",
                "- Language: Natural Lucknow Hinglish (Roman/Latin script only).",
                `- Characters: only the AI cast; never answer for the human ("me").`,
                "- Output 1-3 messages:",
                '<msg sender="id" reaction="ReactionName">message text</msg>',
                `- Valid reactions (exact): {${Reaction.EMOTION.map(e => e.name).join(", ")}}. Use Default if unsure.`,
                "- After all messages, output exactly one pacing tag:",
                '  * Banter: <delay ms="3000"/> to <delay ms="5000"/>',
                '  * Thinking / waiting on the human: <delay ms="20000"/> to <delay ms="60000"/>',
                '  * Wrapping up, signing off, or meeting later: <next time="HH:MM"/> (e.g. <next time="18:30"/>). Use <next> (not <delay>) for time jumps.'
            ].filter(Boolean).join("\n"));
        });

        builder.useUser(() => {
            if (this.pendingDirectorPlot) {
                return builder.part(`Stage directive: ${this.pendingDirectorPlot}`);
            }
            return null;
        });

        builder.useUser(() => builder.part([
            "## Recent Chat",
            "```",
            this.#getRecentChatHistory() || "Chat begins now.",
            "```"
        ].join("\n")));

        // Strongest position (end of context): the fresh human utterance,
        // explicitly flagged as the thing to answer first.
        builder.useUser(() => this.#activeHumanUtterance
            ? builder.part([
                "## The Human Just Said — respond to THIS first",
                this.#activeHumanUtterance
            ].join("\n"))
            : null);
    }

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