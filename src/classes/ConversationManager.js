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
import World, { WorldEvents } from "./World";
import XmlEncoder from "./lib/XmlEncoder";
import MemoryExpiryParser from "./lib/MemoryExpiryParser";
import UserInterruptHandler from "./lib/UserInterruptHandler";
import { Members } from "../util/member";
import {
    DEFAULT_CHAT_MODEL,
    PROMPT_DIALOGUE_TASK,
    PROMPT_DIALOGUE_RULES,
    PARTICIPANT_TYPE_CHARACTER,
    PARTICIPANT_TYPE_HUMAN
} from "../util/Constants";
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
    /** Monotonic prompt-build counter driving alternating environment injection. @type {number} */ #promptTurnIndex = 0;
    /** Set when the human user speaks so the very next prompt carries full environment grounding. @type {boolean} */ #envRefreshRequested = false;

    /**
     * Closes the active simulation session cleanly on user logout.
     * Aborts pending requests, clears all timers, and resets member states.
     *
     * @returns {void}
     */
    logout() {
        this.logger.info("User initiated logout. Closing conversation engine...");

        this.client.abort();

        // Stop the 30s World heartbeat so it cannot leak in the background.
        this.world.destroy();

        if (this.#scheduleNextRequest_TimeOut) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        this.#interruptHandler.destroy();

        AmbientAudio.stop();

        for (const member of this.chat.getMembers()) {
            member.scheduler.clear();
            if (member.isAI) {
                member.setTransientState("isTyping", false, 0);
                member.setTransientState("isReading", false, 0);
                member.setTransientState("isThinking", false, 0);
                member.setTransientState("isActive", false, 0);
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
        this.#promptTurnIndex = 0;
        this.#envRefreshRequested = false;

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
                    // Human messages always get fresh environmental grounding
                    // on the next prompt build, regardless of turn parity.
                    this.#envRefreshRequested = true;
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
     * @returns {void}
     */
    #handleHumanInterruption() {
        this.#interruptHandler.handle({
            user: this.User,
            aiMembers: this.chat.getMembers(),
            aiAbortController: this.client,
            onRequestTurn: () => this.requestTurn(),
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

        this.logger.info("Booting ConversationManager and World orchestrator...");
        await this.world.init();

        this.User.isOnline = true;
        this.initialized = true;
        this.#promptTurnIndex = 0;
        this.#envRefreshRequested = false;
        this.events.emit(ConversationEvents.READY);

        this.scheduleNextRequest();
        this.logger.info("ConversationManager initialized and READY.");
    }

    /**
     * Triggers a Groq turn generation via streaming SSE.
     * **Skipped entirely when offline** — local messages still work.
     *
     * @returns {Promise<void>}
     */
    async requestTurn() {
        if (this.requesting || !this.initialized) return;

        // Offline guard: Skip AI turn generation when offline
        if (!navigator.onLine) {
            this.logger.debug("requestTurn() skipped: App is offline.");
            return;
        }

        this.requesting = true;
        this.protocolBuffer = "";
        this.#generationActive = true;
        this.#directorResponseStarted = false;
        this.logger.info("Requesting fresh conversational turn from Groq...");

        try {
            const promptPayload = await this.promptBuilder.build({
                includeSystem: true,
                includeUser: true
            });

            await this.client.streamChat(promptPayload.messages, {
                temperature: 0.85,
                maxTokens: 2000,
                promptType: "dialogue"
            });

            this.consecutiveErrors = 0;
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
        }

        this.scheduleNextRequest();
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
            thought: protocol.thought,
            emotion: { name: protocol.reaction }
        });

        this.timelineProcessor.add(message);
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
     * Schedules the next autonomous AI turn based on the timeline processor's pacing.
     * Calculates delay from pending message buffer and schedules via setTimeout.
     * @returns {void}
     */
    scheduleNextRequest() {
        if (!this.initialized || this.consecutiveErrors > 0) return;

        if (this.#scheduleNextRequest_TimeOut !== null) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }

        const nextTime = this.timelineProcessor.getNextLiveRequstTime();
        const calculatedDelay = nextTime - Date.now();
        const delay = calculatedDelay <= 0 ? 5_000 : calculatedDelay;

        this.#scheduleNextRequest_TimeOut = setTimeout(() => {
            this.#scheduleNextRequest_TimeOut = null;
            void this.requestTurn();
        }, delay);
    }

    /**
     * Merges committed chat messages with in-flight scheduler queues.
     * Returns the last 20 messages for prompt context building.
     * @returns {Message[]} Merged and deduplicated recent messages.
     */
    getRecentMessages() {
        /** @type {Message[]} */
        const committed = this.chat.getHistory(15);
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

        return [...dedupeMap.values()].slice(-20);
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

        this.client.abort();

        this.protocolBuffer = "";
        this.#generationActive = false;
        this.requesting = false;
        this.consecutiveErrors = 0;

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
        /** Task instruction for the dialogue generation */
        builder.useSystem(() => builder.part(
            `<task>${PROMPT_DIALOGUE_TASK}</task>`
        ));

        /** Hinglish language mandate — prominent placement for strong adherence */
        builder.useSystem(() => builder.part(
            "<language_mandate>\n" +
            "  <primary_language>Natural conversational Hinglish (Hindi in Roman/Latin script, casually mixed with English)</primary_language>\n" +
            "  <script_rule>STRICTLY NO Devanagari script. All Hindi must be transliterated to Latin script.</script_rule>\n" +
            "  <style>Lucknow/Indian casual banter. Real friends talking in a group chat.</style>\n" +
            "  <examples>\n" +
            "    Arre Tom, yeh project kab tak finish hoga?\n" +
            "    Chalo yaar, ab dinner ka time ho gaya hai.\n" +
            "    Nahi nahi, suno toh — maine ek idea socha hai!\n" +
            "    Bahut accha laga yaar, sach mein.\n" +
            "  </examples>\n" +
            "</language_mandate>"
        ));

        /** World context: current time, active schedule, and (throttled) heavy environment block */
        builder.useSystem(() => {
            const turn = ++this.#promptTurnIndex;
            const humanTriggered = this.#envRefreshRequested;
            this.#envRefreshRequested = false;

            // Full environmental grounding (weather, occasions, upcoming
            // festivals, news headlines) is injected on alternating turns and
            // immediately whenever the human user speaks. Interim AI-only
            // banter turns only get <current_time> + the active schedule.
            const includeEnvironment = humanTriggered || turn % 2 === 1;

            return builder.part(
                `<context>\n` +
                `${this.world.toString(includeEnvironment)}\n` +
                `</context>`
            );
        });

        /** Character definitions with bios, ages, and participant types */
        builder.useSystem(() => {
            const chars = [...this.world.members.values()].map(m => {
                const participantType = m.isAI ? PARTICIPANT_TYPE_CHARACTER : PARTICIPANT_TYPE_HUMAN;
                return (
                    `  <character id="${XmlEncoder.encode(m.id)}" name="${XmlEncoder.encode(m.name)}" age="${m.age}" participant_type="${participantType}">\n` +
                    `    ${XmlEncoder.encode(m.about)}\n` +
                    `  </character>`
                );
            }).join("\n");

            return builder.part("<characters>\n" + chars + "\n</characters>");
        });

        /** Dynamic memories with TTL expiry for each member */
        builder.useSystem(() => {
            const memoryBlocks = [...this.world.members.values()]
                .map(m => {
                    const usableKeys = m.memory.values().filter(k => k.isUsable());
                    if (usableKeys.length === 0) return null;

                    const keysXml = usableKeys.map(k => {
                        const val = Array.isArray(k.value) ? k.value.join(", ") : String(k.value);
                        const expStr = k.isForever() ? ' expiry="forever"' : (k.expiry instanceof Date ? ` expiry="${k.expiry.toISOString()}"` : "");
                        return `    <memory key="${XmlEncoder.encode(k.name)}"${expStr}>${XmlEncoder.encode(val)}</memory>`;
                    }).join("\n");

                    return `  <memories member="${XmlEncoder.encode(m.id)}" name="${XmlEncoder.encode(m.name)}">\n${keysXml}\n  </memories>`;
                })
                .filter(Boolean);

            if (memoryBlocks.length > 0) {
                return builder.part("<saved_memories>\n" + memoryBlocks.join("\n") + "\n</saved_memories>");
            }
            return null;
        });

        /** Dialogue protocol rules and output format specification */
        builder.useSystem(() => builder.part(
            "<dialogue_protocol>\n" +
            "  <rules>\n" +
            PROMPT_DIALOGUE_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
            "  </rules>\n" +
            "  <output_format>\n" +
            "    <![CDATA[\n" +
            "    Output strictly valid <record> XML tags:\n\n" +
            "    [1. Message Tag]:\n" +
            '    <record type="message" id="1" reply="null" sender="tom" reaction="Laughing">\n' +
            "      <thought>Internal unspoken reasoning</thought>\n" +
            "      <text>Spoken dialogue text</text>\n" +
            "    </record>\n\n" +
            "    [2. Dynamic Memory Set Tag (Short-term or Permanent)]:\n" +
            '    <record type="memory-set" member="tom" expiry="30m">\n' +
            "      <key>Dynamic Memory Key (e.g. Mood, Active Goal, Opinion on User, Secret)</key>\n" +
            "      <value>Memory description</value>\n" +
            "    </record>\n\n" +
            "    [3. Dynamic Memory Remove Tag]:\n" +
            '    <record type="memory-remove" member="tom">\n' +
            "      <key>Obsolete Key Name</key>\n" +
            "    </record>\n" +
            "    ]]>\n" +
            "  </output_format>\n" +
            "</dialogue_protocol>"
        ));

        /** Director override: injects plot twists as stage directives */
        builder.useUser(() => {
            if (this.pendingDirectorPlot) {
                return builder.part(`<stage_event type="director_override">${XmlEncoder.encode(this.pendingDirectorPlot)}</stage_event>`);
            }
            return null;
        });

        /** Recent dialogue history in semantic XML format */
        builder.useUser(() => builder.part(this.#getRecentDialogueXml()));
    }

    /**
     * Formats recent dialogue history into semantic `<recent_dialogue>` XML.
     * Each message is encoded with sender, reaction, reply references, and text.
     *
     * @returns {string} XML-formatted recent dialogue block.
     */
    #getRecentDialogueXml() {
        const recent = this.getRecentMessages();
        if (recent.length === 0) {
            return "<recent_dialogue>\n  <system_note>Conversation starts now. Jump into the active scene topic naturally!</system_note>\n</recent_dialogue>";
        }

        /** @type {string[]} */
        const xmlRows = ["<recent_dialogue>"];

        for (const msg of recent) {
            if (msg.deleted) continue;

            // Stage directives (no sender) are rendered differently
            if (!msg.sender) {
                xmlRows.push(`  <stage_directive>${XmlEncoder.encode(msg.text)}</stage_directive>`);
                continue;
            }

            const senderId = XmlEncoder.encode(msg.sender.id || "tom");
            const reaction = XmlEncoder.encode(msg.emotion?.name || "Default");
            const msgId = XmlEncoder.encode(msg.protocol?.id || msg.id);

            let replyAttr = "";
            if (msg.reply && msg.reply.protocol?.id) {
                replyAttr = ` reply_to="${XmlEncoder.encode(msg.reply.protocol.id)}"`;
            } else if (msg.protocol?.replyId) {
                replyAttr = ` reply_to="${XmlEncoder.encode(msg.protocol.replyId)}"`;
            }

            xmlRows.push(`  <msg id="${msgId}" sender="${senderId}" reaction="${reaction}"${replyAttr}>${XmlEncoder.encode(msg.text)}</msg>`);
        }

        xmlRows.push("</recent_dialogue>");
        return xmlRows.join("\n");
    }
}
