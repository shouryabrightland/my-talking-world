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
import { PROMPT_DIALOGUE_SAFETY_COMPACT } from "../util/prompts";
import { AmbientAudio } from "../util/sound";
import Logger from "./lib/Logger";

/** Cooldown between director twist injections (30s, Phase 6.2). @type {number} */
export const DIRECTOR_COOLDOWN_MS = 30_000;

/**
 * Shared numeric-attribute pattern for `<delay>` tags (Task 7 — seconds-based
 * delay contract): accepts `ms="2000"` (legacy), `sec="2"` and `s="3"`.
 * @type {string}
 */
export const DELAY_ATTR_PATTERN = String.raw`(?:ms|sec|s)=["'](\d+(?:\.\d+)?)["']`;

/** Maximum concurrent active twists (Phase 6.2). @type {number} */
export const MAX_ACTIVE_DIRECTIVES = 5;

/**
 * localStorage key holding the epoch ms wake time of a scheduled `<next>`
 * pause (Phase 3). Survives page reloads so the cast stays asleep until the
 * exact same instant, and is cleared the moment a human interrupts.
 * @type {string}
 */
export const NEXT_WAKE_STORAGE_KEY = "tgf:next_wake_time";

/**
 * A single active director incident managed by the Twist Engine.
 * @typedef {Object} DirectorTwist
 * @property {string} id Unique twist id (crypto.randomUUID).
 * @property {string} title Short incident title (model-written or directive excerpt).
 * @property {string} directive Original director directive text.
 * @property {string} prePlot Immediate shock / inciting action (first turn).
 * @property {string} midPlot Ongoing situation / background tension (later turns).
 * @property {string} postPlot Resolution / aftermath (ending turn).
 * @property {"pre"|"mid"|"ending"} status Lifecycle status.
 */

/**
 * Shared acceptance gate for director injections (UI pre-check + engine).
 * @typedef {Object} DirectorGateResult
 * @property {boolean} ok Whether the operation is allowed.
 * @property {string} [reason] "offline" | "cooldown" | "limit" | "empty" | "locked" | "not-found".
 * @property {number} [waitSeconds] Seconds left on the cooldown (reason "cooldown").
 */

/**
 * Outcome of `injectDirectorPlot()`.
 * @typedef {DirectorGateResult & { twistId?: string, cancelled?: number }} DirectorInjectResult
 */

/**
 * Parsed Gemma twist synthesis output (three-beat plot + cancellations).
 * @typedef {Object} TwistAnalysis
 * @property {string} title Short incident title.
 * @property {string} prePlot Immediate shock / inciting action.
 * @property {string} midPlot Ongoing situation / background tension.
 * @property {string} postPlot Resolution / aftermath.
 * @property {string[]} cancellations Existing twist ids superseded by the new one.
 */

/**
 * Parses Gemma's `<twist_analysis>` XML into structured plots + cancellations.
 * Returns null when either required plot anchor (`<pre_plot>` / `<post_plot>`)
 * is missing so the caller can fall back to a deterministic synthesis.
 *
 * @param {string} xml Raw model output.
 * @returns {TwistAnalysis|null} Parsed analysis or null when unusable.
 */
export function parseTwistAnalysis(xml) {
    const text = String(xml || "");

    const prePlot = /<pre_plot\s*>([\s\S]*?)<\/pre_plot\s*>/i.exec(text)?.[1]?.trim() || "";
    const postPlot = /<post_plot\s*>([\s\S]*?)<\/post_plot\s*>/i.exec(text)?.[1]?.trim() || "";
    if (!prePlot || !postPlot) return null;

    const midPlot = /<mid_plot\s*>([\s\S]*?)<\/mid_plot\s*>/i.exec(text)?.[1]?.trim() || "";
    const title = /<title\s*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1]?.trim() || "";

    /** @type {string[]} */
    const cancellations = [];
    const cancelRe = /<cancel\s+id\s*=\s*"([^"]+)"/gi;
    /** @type {RegExpExecArray|null} */
    let match;
    while ((match = cancelRe.exec(text)) !== null) {
        cancellations.push(match[1]);
    }

    return { title, prePlot, midPlot, postPlot, cancellations };
}

/**
 * Deterministic twist synthesis used when Gemma is unavailable or its output
 * is unparseable — preserves the three-beat contract so prompt feeding and
 * the ending flow never dead-end on a model failure.
 *
 * @param {string} directive Raw director directive.
 * @returns {TwistAnalysis}
 */
function fallbackTwistAnalysis(directive) {
    const clean = directive.trim();
    const title = clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
    return {
        title,
        prePlot: `Right now, the cast is hit by this: ${clean}`,
        midPlot: `The fallout from "${title}" keeps simmering under the conversation.`,
        postPlot: `The incident "${title}" winds down and the group settles back to normal.`,
        cancellations: []
    };
}

export const ConversationEvents = {
    READY: "conversation:ready",
    ERROR: "conversation:error",
    SCHEDULE_SYNC: "conversation:schedule:sync",
    DIRECTOR_EVENT: "conversation:director:event",
    DIRECTOR_RESPONSE_START: "conversation:director:response:start",
    DIRECTOR_TWIST_CHANGE: "conversation:director:twist:change",
    DIRECTOR_REJECTED: "conversation:director:rejected",
    MEMORY_COMPRESS_START: "conversation:memory:compress:start",
    MEMORY_COMPRESS_DONE: "conversation:memory:compress:done",
    MEMORY_COMPRESS_ERROR: "conversation:memory:compress:error",
    LOGOUT: "conversation:logout"
};

export default class ConversationManager {
    /**
     * Hard character ceiling for a single chat bubble (Task 6 — expanded
     * from 70 to 140 for natural sitcom banter, humor and punchlines;
     * `splitMessageText()` never returns a chunk longer than this).
     * @readonly
     */
    static MAX_BUBBLE_CHARACTERS = 140;

    /**
     * Pacing gap (ms) inserted between consecutive auto-split bubbles of the
     * same message (Phase 6.2) — inside the spec's 1000–1500ms band.
     * @readonly
     */
    static SPLIT_GAP_MS = 1200;

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

        /** @type {DirectorTwist[]} Active director twists (max {@link MAX_ACTIVE_DIRECTIVES}). */
        this.activeDirectives = [];
        /** @type {number} Epoch ms before which a new twist is rejected (30s cooldown). */
        this.directorCooldownUntil = 0;
        /** @type {number} Turn sequence at which ending controls unlock (1-turn lock). */
        this.endLockUntilTurn = 0;

        /** Last Needle route ("member: kw1, kw2") kept for DevTools inspection. @type {string|null} */
        this.lastNeedleRoute = null;
        /** Last Tier-3 memory lines injected into the prompt (DevTools). @type {string} */
        this.lastRetrievedMemory = "";
        /**
         * Full transparency record of the last Tier-3 retrieval for the
         * DevTools inspect tab: extraction method, raw query, routed member,
         * keywords, and how many memory lines matched.
         * @type {{method: string, query: string, member: string, keywords: string[], matchCount: number}|null}
         */
        this.lastNeedleDetails = null;

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
    /**
     * Inter-message pacing gap (ms) applied to the NEXT queued bubble —
     * armed by a `<delay>` that immediately follows a `<msg>` (Phase 6.3).
     * @type {number}
     */
    #interMessageDelayMs = 0;
    /** @type {number} Monotonic completed-turn counter driving the ending lock. */ #turnSequence = 0;

    logout() {
        this.logger.info("User initiated logout. Closing conversation engine...");

        this.client.abort();
        this.world.pause();
        this.situationEngine?.stopTicker();

        if (this.#scheduleNextRequest_TimeOut) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        localStorage.removeItem(NEXT_WAKE_STORAGE_KEY);
        this.#interruptHandler.destroy();
        this.#clearTypingSettle();

        AmbientAudio.stop();
        this.chat.pause();

        // NOTE: member schedulers are intentionally NOT cleared here. Timelines
        // are persisted, and ChatMemberScheduler's reload catch-up flushes
        // past-due events on the next login — wiping them on logout made every
        // queued post-logout message vanish forever.
        for (const member of this.chat.getMembers()) {
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
        this.#interMessageDelayMs = 0;
        this.pendingDirectorPlot = null;
        this.#directorResponseStarted = false;
        this.activeDirectives = [];
        this.directorCooldownUntil = 0;
        this.endLockUntilTurn = 0;

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
                // Publish upcoming planner scenes to Tier-3 memory so the
                // cast can recall future events through Active Memories.
                this.#syncPlannerScenes();
            },
            "ConversationManager: schedule sync listener"
        );

        this.world.events.on(
            WorldEvents.READY,
            () => {
                this.#syncPlannerScenes();
                this.#runInitialSituationPass();
            },
            "ConversationManager: initial situation on world ready"
        );

        this.world.events.on(
            WorldEvents.DEMAND_APPLIED,
            (/** @type {import("./types/World.types").ScheduleRecord} */ block) => {
                this.onDemandApplied(block);
            },
            "ConversationManager: instant demand chat bridge"
        );

        this.world.events.on(
            WorldEvents.ENVIRONMENT_CHANGE,
            (/** @type {import("./types/World.types").EnvironmentSnapshot} */ env) => {
                if (env) void this.unifiedMemory.syncEnvironment(env);
                // Phase 7.1: distill the fresh headline batch (top 50) into
                // <=80-char %world% memories with a 1h TTL so the cast can
                // recall real-world events through Active Memories.
                if (
                    env &&
                    this.situationEngine &&
                    Array.isArray(env.newsHeadlines) &&
                    env.newsHeadlines.length > 0
                ) {
                    void this.situationEngine.ingestNews(env.newsHeadlines);
                }
            },
            "ConversationManager: sync environment to unified memory"
        );
    }

    /**
     * Synchronous injection gate shared by the Director footer UI and
     * `injectDirectorPlot()` so the UI can disable/notify WITHOUT waiting on
     * the Gemma synthesis round-trip.
     *
     * @returns {DirectorGateResult} `ok:false` with a machine-readable reason when blocked.
     */
    directorGate() {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
            return { ok: false, reason: "offline" };
        }

        const now = Date.now();
        if (now < this.directorCooldownUntil) {
            return {
                ok: false,
                reason: "cooldown",
                waitSeconds: Math.ceil((this.directorCooldownUntil - now) / 1000)
            };
        }

        if (this.activeDirectives.length >= MAX_ACTIVE_DIRECTIVES) {
            return { ok: false, reason: "limit" };
        }

        return { ok: true };
    }

    /**
     * Whether ending twists is locked for 1 turn after an end operation.
     *
     * @returns {boolean} True while the post-plot resolution turn is pending.
     */
    isEndingLocked() {
        return this.#turnSequence < this.endLockUntilTurn;
    }

    /**
     * Aborts any in-flight Groq stream and clears the cast's scheduled
     * activity so a director-driven turn starts immediately.
     *
     * @returns {void}
     */
    #haltScheduledDialogue() {
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
    }

    /**
     * Runs the Gemma Twist Synthesizer for a new director directive:
     * returns conflict cancellations plus the incident's pre/mid/post plots
     * (Phase 6.2). Falls back to a deterministic synthesis when no Gemini
     * client exists or the model output is unusable — injection never dead-ends.
     *
     * @param {string} directive Raw director directive.
     * @returns {Promise<TwistAnalysis>} Analysis to apply.
     */
    async #synthesizeTwist(directive) {
        const client = this.world?.worldSetter?.geminiClient || null;
        if (!client) return fallbackTwistAnalysis(directive);

        const activeRecord = this.world.activeSchedule;
        const scene = activeRecord
            ? `${activeRecord.title || activeRecord.topic}: ${activeRecord.denseParagraph || activeRecord.mainGoal || ""}`
            : "The cast is hanging out in the Lucknow studio apartment.";

        const existing = this.activeDirectives.length > 0
            ? this.activeDirectives.map(t => `- id="${t.id}" title="${t.title}" mid="${t.midPlot}"`).join("\n")
            : "(none — this is the first active incident)";

        const systemInstruction = [
            'You are the Twist Synthesizer for the sitcom group chat "Tom & Friends" (Lucknow, India).',
            "Given the CURRENT SCENE, the ACTIVE INCIDENTS, and a NEW director directive, decide which active incidents the new one cancels and write the new incident's three-beat plot.",
            "Reply with ONLY the XML below — no markdown, no commentary:",
            "<twist_analysis>",
            "  <cancellations>",
            '    <cancel id="twist-id-to-remove" />',
            "  </cancellations>",
            "  <plot>",
            "    <title>Short incident title, max 6 words</title>",
            "    <pre_plot>Immediate shock / inciting action the cast reacts to RIGHT NOW (1-2 sentences)</pre_plot>",
            "    <mid_plot>Ongoing situation / background tension carried across subsequent turns (1-2 sentences)</mid_plot>",
            "    <post_plot>Resolution / aftermath that concludes the incident (1-2 sentences)</post_plot>",
            "  </plot>",
            "</twist_analysis>",
            "Rules:",
            '- Emit <cancel id="..." /> ONLY for an ACTIVE INCIDENT id listed above that the new directive directly makes obsolete or supersedes; keep unrelated incidents untouched. Use an empty <cancellations></cancellations> when nothing is cancelled.',
            "- Plots must be concrete, situational, and playable by the ensemble — never claim a specific cast member's private feelings.",
            "- Keep each beat under 280 characters."
        ].join("\n");

        const userContent = [
            "## Current Scene",
            "```",
            scene,
            "```",
            "",
            "## Active Incidents",
            "```",
            existing,
            "```",
            "",
            "## New Director Directive",
            "```",
            directive,
            "```"
        ].join("\n");

        try {
            const model = typeof client.resolveGemmaModel === "function"
                ? await client.resolveGemmaModel()
                : null;

            const result = await client.generateText(
                [{ role: "user", content: userContent }],
                { model, thinkingBudget: 0, promptType: "situation", temperature: 0.8, maxRetries: 1 }
            );

            const parsed = parseTwistAnalysis(result?.text || "");
            if (parsed) {
                return {
                    ...parsed,
                    title: parsed.title || directive.slice(0, 48),
                    midPlot: parsed.midPlot || parsed.prePlot
                };
            }

            this.logger.warn("Twist synthesis returned unparseable XML — using deterministic fallback.");
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Twist synthesis failed — using deterministic fallback:", err);
        }

        return fallbackTwistAnalysis(directive);
    }

    /**
     * Advances twist lifecycles after a COMPLETED turn (Phase 6.3): "pre"
     * twists flip to "mid" (their pre_plot was just delivered), "ending"
     * twists are pruned (post_plot delivered), and the turn sequence ticks so
     * the one-turn ending lock expires.
     *
     * @returns {void}
     */
    #advanceActiveDirectives() {
        this.#turnSequence++;

        let changed = false;
        /** @type {DirectorTwist[]} */
        const pruned = [];

        this.activeDirectives = this.activeDirectives.filter(twist => {
            if (twist.status === "ending") {
                pruned.push(twist);
                changed = true;
                return false;
            }
            if (twist.status === "pre") {
                twist.status = "mid";
                changed = true;
            }
            return true;
        });

        if (pruned.length > 0) {
            this.logger.info(`Pruned ${pruned.length} ended director twist(es) after the turn.`);
        }
        if (changed) {
            this.events.emit(ConversationEvents.DIRECTOR_TWIST_CHANGE, [...this.activeDirectives]);
        }
    }

    /**
     * Marks the given twists as "ending" (their post_plot leads the next
     * turn), locks ending controls for 1 turn, and triggers that fresh turn
     * immediately (Phase 6.4).
     *
     * @param {string[]} ids Twist ids to end.
     * @returns {DirectorGateResult & { count?: number }} Result with the number of twists ending.
     */
    endTwists(ids) {
        const targets = (Array.isArray(ids) ? ids : []).map(id => String(id));
        if (targets.length === 0) return { ok: false, reason: "empty" };
        if (this.isEndingLocked()) return { ok: false, reason: "locked" };

        let count = 0;
        for (const twist of this.activeDirectives) {
            if (targets.includes(twist.id) && twist.status !== "ending") {
                twist.status = "ending";
                count++;
            }
        }
        if (count === 0) return { ok: false, reason: "not-found" };

        this.endLockUntilTurn = this.#turnSequence + 1;
        this.events.emit(ConversationEvents.DIRECTOR_TWIST_CHANGE, [...this.activeDirectives]);
        this.logger.info(`Ending ${count} director twist(es). Ending locked for 1 turn.`);

        if (typeof navigator === "undefined" || navigator.onLine) {
            this.#haltScheduledDialogue();
            void this.requestTurn();
        }

        return { ok: true, count };
    }

    /**
     * Injects a Stage Directive from Director Mode as an ACTIVE TWIST:
     * validates the 30s cooldown / 5-twist limit (Phase 6.2), synthesizes the
     * incident through Gemma (conflict cancellations + pre/mid/post plots),
     * aborts any in-flight Groq stream, and triggers a fresh turn so the cast
     * reacts to the new incident immediately.
     *
     * @param {string} plotText Raw director directive.
     * @returns {Promise<DirectorInjectResult>} Acceptance or rejection outcome.
     */
    async injectDirectorPlot(plotText) {
        if (!plotText || typeof plotText !== "string" || !plotText.trim()) {
            return { ok: false, reason: "empty" };
        }

        const gate = this.directorGate();
        if (!gate.ok) {
            this.logger.warn(`Director twist REJECTED (${gate.reason}).`);
            this.events.emit(ConversationEvents.DIRECTOR_REJECTED, gate);
            return gate;
        }

        const cleanPlot = plotText.trim();

        // Arm the 30s cooldown BEFORE synthesis (spec ordering 1→4).
        this.directorCooldownUntil = Date.now() + DIRECTOR_COOLDOWN_MS;

        this.logger.info(`[Director Mode] Injecting Stage Directive: "${cleanPlot}"`);

        // Abort the in-flight stream + clear the cast's scheduled activity.
        this.#haltScheduledDialogue();

        const directiveMessage = new Message({
            sender: null,
            text: cleanPlot,
            emotion: { name: "Excited" }
        });
        this.chat.addMessage(directiveMessage);

        this.pendingDirectorPlot = cleanPlot;
        this.#directorResponseStarted = false;
        this.events.emit(ConversationEvents.DIRECTOR_EVENT, cleanPlot);

        // Gemma synthesis → apply cancellations → register the new twist.
        const analysis = await this.#synthesizeTwist(cleanPlot);
        const cancelIds = analysis.cancellations || [];
        const cancelled = this.activeDirectives.filter(t => cancelIds.includes(t.id));
        if (cancelled.length > 0) {
            this.activeDirectives = this.activeDirectives.filter(t => !cancelIds.includes(t.id));
            this.logger.info(`Twist synthesis cancelled ${cancelled.length} conflicting incident(s).`);
        }

        /** @type {DirectorTwist} */
        const twist = {
            id: crypto.randomUUID(),
            title: analysis.title || cleanPlot.slice(0, 48),
            directive: cleanPlot,
            prePlot: analysis.prePlot,
            midPlot: analysis.midPlot,
            postPlot: analysis.postPlot,
            status: "pre"
        };
        this.activeDirectives.push(twist);
        this.events.emit(ConversationEvents.DIRECTOR_TWIST_CHANGE, [...this.activeDirectives]);

        // Fresh turn so the cast reacts to the new incident immediately.
        await this.requestTurn();
        this.pendingDirectorPlot = null;

        return { ok: true, twistId: twist.id, cancelled: cancelled.length };
    }

    /**
     * Task 4 — Instant Chat Bridge: when an accepted Director Demand covers
     * the CURRENT hour, `world.activeSchedule` has already been refreshed by
     * World.tick(); this triggers an in-character cast reaction to the
     * schedule shift on the very next turn.
     *
     * @param {import("./types/World.types").ScheduleRecord} block Newly committed block covering the current hour.
     * @returns {void}
     */
    onDemandApplied(block) {
        if (!block || !this.initialized) return;

        this.logger.info(`Demand bridge: current hour is now "${block.topic}" [${block.timeRange}] — triggering an in-character reaction.`);

        // Surface the schedule shift as a lightweight stage directive so the
        // next prompt's user turn carries the change.
        this.pendingDirectorPlot =
            `The human user just reshaped today's schedule. RIGHT NOW the cast is doing "${block.title || block.topic}" ` +
            `(${block.timeRange}) — ${block.denseParagraph || block.mainGoal || ""} ` +
            "The cast reacts in-character to this sudden change.";
        this.#directorResponseStarted = false;

        if (typeof navigator !== "undefined" && !navigator.onLine) return;

        this.#haltScheduledDialogue();
        void this.requestTurn().finally(() => {
            this.pendingDirectorPlot = null;
        });
    }

    #handleHumanInterruption() {
        if (this.#scheduleNextRequest_TimeOut !== null) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }
        // PHASE 3.3: Human input cancels any persisted sleep window so a
        // reload right after this moment boots live instead of dormant.
        localStorage.removeItem(NEXT_WAKE_STORAGE_KEY);
        this.#pendingDelayMs = null;
        this.#pendingNextTime = null;
        this.#interMessageDelayMs = 0;

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

        // NOTE: the boot-time environment sync + news distillation are owned
        // by the WorldEvents.ENVIRONMENT_CHANGE listener bound in the
        // constructor (World.init() emits it once WorldSetter has loaded the
        // snapshot) — the old explicit syncEnvironment() call here raced that
        // async path and double-wrote raw headline rows.

        if (this.situationEngine) {
            await this.situationEngine.init();
            // 1-minute periodic ticker: runs only while unread messages exist.
            this.situationEngine.startTicker();
            this.#runInitialSituationPass();
        }

        this.User.isOnline = true;
        this.initialized = true;
        this.events.emit(ConversationEvents.READY);

        // PHASE 3.2: Restore a persisted `<next>` sleep window. If the page
        // reloaded mid-pause, keep the cast ducked/inactive and re-arm the
        // wake timer for the remaining duration instead of booting a fresh
        // turn immediately.
        const savedWakeTime = localStorage.getItem(NEXT_WAKE_STORAGE_KEY);
        const wakeMs = savedWakeTime === null ? NaN : Number(savedWakeTime);

        if (Number.isFinite(wakeMs) && Date.now() < wakeMs) {
            const remainingMs = wakeMs - Date.now();

            for (const member of this.chat.getMembers()) {
                if (member.isAI) {
                    member.setTransientState("isActive", false, 0);
                    member.events.emit(ChatMemberEvents.ACTIVE, false);
                }
            }

            this.#armWakeTimer(remainingMs);
            this.logger.info(`Cast asleep until scheduled wake time. Resuming in ${Math.round(remainingMs / 1000)}s.`);
        } else {
            if (savedWakeTime !== null) {
                // Wake time expired while the tab was closed/reloading.
                localStorage.removeItem(NEXT_WAKE_STORAGE_KEY);
            }
            this.scheduleNextRequest();
        }

        this.logger.info("ConversationManager initialized and READY.");
    }

    /**
     * PHASE 3: Arms the single wake timer shared by freshly parsed `<next>`
     * schedules and sleep windows restored after a reload. On fire, clears the
     * persisted wake time, wakes the cast, and requests a fresh turn.
     *
     * @param {number} waitDurationMs Milliseconds to sleep before the next turn.
     * @returns {void}
     */
    #armWakeTimer(waitDurationMs) {
        if (this.#scheduleNextRequest_TimeOut !== null) {
            clearTimeout(this.#scheduleNextRequest_TimeOut);
            this.#scheduleNextRequest_TimeOut = null;
        }

        this.#scheduleNextRequest_TimeOut = setTimeout(() => {
            this.#scheduleNextRequest_TimeOut = null;
            localStorage.removeItem(NEXT_WAKE_STORAGE_KEY);

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
        this.#interMessageDelayMs = 0;
        this.#pendingMemorySnippet = "";
        // Fresh human utterance for THIS turn — captured before the Tier-3
        // lookup consumes #userTurnPending. Drives the prompt's "Human Just
        // Said" priority block and the SituationEngine's scene anchoring.
        this.#activeHumanUtterance = (isUserInitiated || this.#userTurnPending)
            ? String(userMessageText || this.#lastUserMessageText || "").trim()
            : "";
        this.logger.info("Requesting fresh conversational turn from Groq...");

        /** True once this turn's stream completed successfully (drives twist advancement). @type {boolean} */
        let turnCompleted = false;

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
            turnCompleted = true;

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
            // Advance twist lifecycles only on a COMPLETED turn: a failed or
            // aborted turn must keep "pre" (undelivered) and "ending" (post_plot
            // not yet spoken) statuses intact for the retry.
            if (turnCompleted) this.#advanceActiveDirectives();

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

        // Task 5 — query isolation: the user's LATEST MESSAGE IS the query.
        // Chat history only enters the route when the message carries ZERO
        // topical nouns/keywords (e.g. "hello", "acha hai"); autonomous
        // turns still route the recent chat on its own.
        const humanText = humanTurn
            ? String(userMessageText || this.#lastUserMessageText || "").trim()
            : "";
        const chatText = this.#getRecentChatHistory();

        /** @type {string} */
        let queryText;
        if (humanTurn && humanText) {
            const probe = await this.needleRouter.route(humanText);
            queryText = probe.keywords.length > 0
                ? humanText
                : [humanText, chatText].filter(Boolean).join("\n").trim();
        } else {
            queryText = chatText.trim();
        }
        if (!queryText) return;

        try {
            const { keywords, member } = await this.needleRouter.route(queryText);
            this.lastNeedleRoute = `${member}: ${keywords.join(", ") || "none"}`;

            const matches = this.unifiedMemory.searchDeterministic(keywords, [member]);

            // DevTools inspect tab: record exactly HOW the snippet was found —
            // the synchronous deterministic regex extractor (not an LLM call).
            this.lastNeedleDetails = {
                method: this.needleRouter.isReady ? "Deterministic regex (synchronous, ≤1ms)" : "Router destroyed",
                query: queryText.slice(0, 200),
                member,
                keywords: [...keywords],
                matchCount: matches.length
            };

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
            this.lastNeedleDetails = {
                method: "Deterministic regex (synchronous, ≤1ms)",
                query: queryText.slice(0, 200),
                member: "unrouted",
                keywords: [],
                matchCount: 0
            };
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

        this.logger.info("Triggering initial memory extraction pass...");
        void this.situationEngine.executeIfDue(this.#buildSituationContext(), true).catch((/** @type {unknown} */ err) => {
            this.logger.warn("Ambient situation pass failed:", err);
        });
    }

    /**
     * Publishes the planner's upcoming scenes into Tier-3 UnifiedMemory so
     * characters can see future events ("what's scheduled at 17:00?" through
     * Needle → Active Memories). Never throws.
     * @returns {void}
     */
    #syncPlannerScenes() {
        try {
            const records = this.world.worldSetter?.getRecords?.() || [];
            void this.unifiedMemory.syncPlannerScenes(records).catch((/** @type {unknown} */ err) => {
                this.logger.warn("Planner scene sync into UnifiedMemory failed:", err);
            });
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Planner scene sync into UnifiedMemory failed:", err);
        }
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
        /** @type {Array<{ block: string, gap: number }>} */
        const completedMsgs = [];

        while ((msgMatch = msgTagRegex.exec(this.protocolBuffer)) !== null) {
            // Phase 6.3: a <delay> sitting directly before THIS message paces it;
            // otherwise the gap armed by an earlier trailing <delay> applies.
            const before = this.protocolBuffer.slice(0, msgMatch.index);
            const inlineDelay = new RegExp(String.raw`<\s*delay\s+` + DELAY_ATTR_PATTERN + String.raw`\s*\/?>\s*$`, "i").exec(before);
            const gap = inlineDelay
                ? ProtocolCodec.parseDelayToMs(inlineDelay[1])
                : this.#interMessageDelayMs;
            this.#interMessageDelayMs = 0;

            completedMsgs.push({ block: msgMatch[0], gap });
            msgLastIndex = msgMatch.index + msgMatch[0].length;
        }

        if (msgLastIndex > 0) {
            // Everything up to msgLastIndex — the processed msgs AND the inline
            // delays that paced them — leaves the buffer together.
            this.protocolBuffer = this.protocolBuffer.slice(msgLastIndex);

            for (const { block: msgBlock, gap } of completedMsgs) {
                const attrs = msgBlock.match(/<\s*msg\s+([^>]*?)>/i)?.[1] || "";
                const sender = attrs.match(/sender\s*=\s*["']([^"']+)["']/i)?.[1] || "";
                const reaction = attrs.match(/reaction\s*=\s*["']([^"']+)["']/i)?.[1] || "Default";
                const text = msgBlock
                    .replace(/<\s*msg\s+[^>]*?>/i, "")
                    .replace(/<\/\s*msg\s*>/gi, "")
                    .trim();
                this.handleBanterMessage(sender, reaction, text, gap);
            }
        }

        const delayMatch = this.protocolBuffer.match(
            new RegExp(String.raw`<\s*delay\s+` + DELAY_ATTR_PATTERN + String.raw`\s*\/?>`, "i")
        );
        if (delayMatch) {
            const delayMs = ProtocolCodec.parseDelayToMs(delayMatch[1]);
            const beforeDelay = this.protocolBuffer.slice(0, delayMatch.index ?? 0);
            // A trailing/standalone <delay> arms the next-turn schedule; one that
            // follows a </msg> ALSO arms the gap for the message still to come.
            // (A delay at index 0 right after this call consumed a <msg> block
            //  also directly follows that </msg> — the tag was sliced away.)
            const followsMsg = /<\/\s*msg\s*>\s*$/i.test(beforeDelay) ||
                ((delayMatch.index ?? 0) === 0 && msgLastIndex > 0);
            if (followsMsg) {
                this.#interMessageDelayMs = delayMs;
            }
            this.#pendingDelayMs = delayMs;
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
            sender,
            text: protocol.text,
            emotion: { name: protocol.reaction }
        });

        this.timelineProcessor.add(message);
    }

    /**
     * Splits an over-long banter line into bubble-sized chunks (Phase 6.2).
     *
     * - Short single-sentence lines pass through untouched.
     * - Longer lines split first on sentence boundaries (`.`, `!`, `?`),
     *   then on punctuation pauses, then on word boundaries.
     * - No returned sub-chunk ever exceeds {@link MAX_BUBBLE_CHARACTERS}.
     *
     * @param {string} text Raw model output for one `<msg>`.
     * @returns {string[]} Bubble-sized chunks (at least one).
     */
    splitMessageText(text) {
        const clean = String(text || "").trim();
        if (!clean) return [];

        const sentenceCount = (clean.match(/[.!?]+/g) || []).length;
        if (clean.length <= ConversationManager.MAX_BUBBLE_CHARACTERS && sentenceCount <= 1) {
            return [clean];
        }

        /** @type {string[]} */
        const chunks = [];
        const max = ConversationManager.MAX_BUBBLE_CHARACTERS;

        for (const sentence of clean.split(/(?<=[.!?])\s+/).filter(Boolean)) {
            if (sentence.length <= max) {
                chunks.push(sentence);
                continue;
            }
            for (const part of sentence.split(/(?<=[,;:])\s+/).filter(Boolean)) {
                if (part.length <= max) {
                    chunks.push(part);
                    continue;
                }
                let remaining = part;
                while (remaining.length > max) {
                    let cut = remaining.lastIndexOf(" ", max);
                    if (cut <= 0) cut = max;
                    chunks.push(remaining.slice(0, cut).trim());
                    remaining = remaining.slice(cut).trim();
                }
                if (remaining) chunks.push(remaining);
            }
        }

        return chunks.length ? chunks : [clean];
    }

    /**
     * @param {string} sender
     * @param {string} reaction
     * @param {string} text
     * @param {number} [interMessageDelay=0] Pacing gap before this bubble (ms).
     * @returns {void}
     */
    handleBanterMessage(sender, reaction, text, interMessageDelay = 0) {
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

        // Phase 6.2: auto-split over-long lines into consecutive bubbles that
        // share the same author and emotion, with a pacing gap between them.
        const chunks = this.splitMessageText(text);
        chunks.forEach((chunk, index) => {
            const gap = index === 0
                ? Math.max(0, interMessageDelay)
                : ConversationManager.SPLIT_GAP_MS;
            this.timelineProcessor.add(new Message({
                sender: member,
                text: chunk,
                emotion: { name: reaction }
            }), gap);
        });
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
        this.#interMessageDelayMs = 0;

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

            // PHASE 3.1: Persist the wake instant so a reload mid-pause
            // restores the exact same sleep window (see #boot).
            localStorage.setItem(NEXT_WAKE_STORAGE_KEY, String(targetTimeMs));

            for (const member of this.chat.getMembers()) {
                if (member.isAI) {
                    member.setTransientState("isActive", false, 0);
                    member.events.emit(ChatMemberEvents.ACTIVE, false);
                }
            }
            this.logger.info(`Turn completed. Cast paused until ${nextTimeStr} (${Math.round((targetTimeMs - now) / 60000)}m wait).`);
        } else if (explicitDelay !== null) {
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + explicitDelay;
            // PHASE 3.1: An explicit `<delay ms="…"/>` is also a future wake
            // instant — persist it so reloads resume the remaining wait.
            localStorage.setItem(NEXT_WAKE_STORAGE_KEY, String(targetTimeMs));

            // Turn completed — duck the cast below the footer while they wait.
            for (const member of this.chat.getMembers()) {
                if (member.isAI) {
                    member.setTransientState("isActive", false, 0);
                    member.events.emit(ChatMemberEvents.ACTIVE, false);
                }
            }
            this.logger.info(`Turn completed. Next request scheduled ${explicitDelay / 1000}s AFTER last message delivery.`);
        } else {
            // Default fast follow-up — nothing meaningful to restore on reload.
            localStorage.removeItem(NEXT_WAKE_STORAGE_KEY);
            targetTimeMs = Math.max(now, lastMessageDeliveredAt) + 4000;
        }

        const waitDurationMs = Math.max(100, targetTimeMs - now);
        this.#armWakeTimer(waitDurationMs);
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
        localStorage.removeItem(NEXT_WAKE_STORAGE_KEY);
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
        this.#interMessageDelayMs = 0;
        this.lastNeedleRoute = null;
        this.lastRetrievedMemory = "";
        this.lastNeedleDetails = null;
        this.activeDirectives = [];
        this.directorCooldownUntil = 0;
        this.endLockUntilTurn = 0;

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
            // Task 6 — dynamic runtime personas: character blocks are built
            // from the LIVE ChatMember objects (member.age, member.about).
            // Zero hardcoded names or ages anywhere in the prompt path.
            const castLines = aiMembers.length > 0
                ? aiMembers.map(m => {
                    const age = Number.isFinite(m.age) && m.age > 0 ? `(${m.age})` : "";
                    const about = String(m.about || "").trim();
                    return `- ${m.name || m.id} ${age} [id: ${m.id}] — ${about || "No bio available"}`;
                })
                : ["- (cast profiles unavailable)"];

            const situation = this.situationEngine
                ? this.situationEngine.situationText
                : "The group is gathered together in Lucknow, catching up and chatting naturally.";

            // Isolated markdown block for retrieved memories
            const memorySection = this.#pendingMemorySnippet
                ? `\n## Active Memories\n\`\`\`\n${this.#pendingMemorySnippet}\n\`\`\`\n`
                : "";

            // Hybrid planner: inject the ACTIVE block's title + dense scene
            // paragraph so the Groq dialogue model has direct, unambiguous
            // awareness of the current macro scene.
            const worldSetter = this.world.worldSetter;
            const activeRecord = this.world.activeSchedule
                || (worldSetter && typeof worldSetter.getActiveRecord === "function"
                    ? worldSetter.getActiveRecord(this.world.now)
                    : null);
            const sceneLines = activeRecord
                ? [
                    "",
                    `## Current Scene: ${activeRecord.title || activeRecord.topic} (${activeRecord.timeRange})`,
                    "```",
                    activeRecord.denseParagraph || activeRecord.mainGoal || activeRecord.topic,
                    "```"
                ]
                : [];

            // Task 6 — SceneBar & Prompt Alignment: the dialogue prompt sees
            // EXACTLY what the SceneBar displays — weather, temperature,
            // occasion, the active scene topic, its denseParagraph, and the
            // live news headlines.
            const env = this.world.environment;
            const sceneBarLines = [
                "",
                "## Live SceneBar Context",
                "```",
                `- Weather: ${env?.temperature || "32°C"}, ${env?.weather || "Warm"} (Humidity: ${env?.humidity || "55%"})`,
                `- Occasion: ${env?.todayCelebration || "No festival today"}`,
                `- Scene: ${activeRecord ? (activeRecord.title || activeRecord.topic) : "Casual Banter"}${activeRecord ? ` (${activeRecord.timeRange})` : ""}`,
                `- Scene Paragraph: ${activeRecord ? (activeRecord.denseParagraph || activeRecord.mainGoal || activeRecord.topic) : "The cast hangs out together in Lucknow, chatting naturally."}`,
                `- Headlines: ${(env?.newsHeadlines || []).slice(0, 3).join(" | ") || "None"}`,
                "```"
            ];

            // Phase 6.3: feed each active director twist's per-status beat
            // under a dedicated heading. Lifecycle advancement (pre → mid →
            // pruned) happens after the turn completes in requestTurn().
            const beats = this.activeDirectives.map(twist => {
                const beat = twist.status === "pre"
                    ? twist.prePlot
                    : twist.status === "ending" ? twist.postPlot : twist.midPlot;
                return `- [${twist.title}] ${beat}`;
            });
            const directorSection = beats.length > 0
                ? ["", "## Active Director Beats", "Stage incidents in progress — weave these into the dialogue.", "```", ...beats, "```"]
                : [];

            return builder.part([
                "# Live Group Chat: Tom & Friends (Lucknow, India)",
                "",
                // PHASE 5: compact markdown safety block replaces the verbose
                // XML mandate on this token-tight Groq turn (~180-220 tokens
                // saved). Gemini prompts keep the full XML version.
                PROMPT_DIALOGUE_SAFETY_COMPACT,
                "",
                "## Cast:",
                ...castLines,
                "- Speak each character at their exact age. The science-enthusiast member explains concepts using funny cartoon analogies.",
                "",
                "## Ambient Setting",
                "```",
                `- Time: ${this.world.dateTime}`,
                `- Atmosphere: ${situation}`,
                "```",
                memorySection,
                ...sceneLines,
                ...sceneBarLines,
                ...directorSection,
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
                "- BUBBLE LENGTH: every message must be 1-2 short sentences UNDER 140 characters (natural WhatsApp/tweet-style sitcom banter — humor and punchlines welcome). If a character has more to say, split it across 2-3 separate <msg> tags.",
                '- TIMING: put <delay sec="1"/> to <delay sec="2"/> directly after EACH <msg> tag for natural cartoon pacing (SECONDS, not milliseconds).',
                `- Valid reactions (exact): {${Reaction.EMOTION.map(e => e.name).join(", ")}}. Use Default if unsure.`,
                "- After the LAST message, output exactly one end-of-turn pacing tag:",
                '  * Banter: <delay sec="3"/> to <delay sec="5"/>',
                '  * Thinking / waiting on the human: <delay sec="20"/> to <delay sec="60"/>',
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
                "```",
                this.#activeHumanUtterance,
                "```"
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