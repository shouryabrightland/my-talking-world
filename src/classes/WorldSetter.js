// @ts-check

/**
 * @typedef {import("./lib/Logger").default} Logger
 * @typedef {import("./World").default} World
 * @typedef {import("./PromptBuilder").default} PromptBuilder
 * @typedef {import("./ChatMember").default} ChatMember
 * @typedef {import("./types/World.types").ScheduleRecord} ScheduleRecord
 * @typedef {import("./types/World.types").CharacterGoalRecord} CharacterGoalRecord
 * @typedef {import("./types/World.types").EnvironmentSnapshot} EnvironmentSnapshot
 * @typedef {import("./types/World.types").DemandResolutionResult} DemandResolutionResult
 * @typedef {import("./types/World.types").ScheduleProposal} ScheduleProposal
 * @typedef {import("./types/World.types").ProposedChange} ProposedChange
 * @typedef {import("./types/World.types").DemandReport} DemandReport
 * @typedef {import("./lib/PromptLogger").PromptType} PromptType
 */

import GeminiClient, { DEEP_THINKING_BUDGET, STABILIZER_THINKING_BUDGET } from "./GeminiClient";
import GeminiModelPool from "./lib/GeminiModelResolver";
import PromptBuilderClass from "./PromptBuilder";
import Storage from "./lib/Storage";
import ProtocolCodec from "./ProtocolCodec";
import XmlEncoder from "./lib/XmlEncoder";
import { ChatMemberEvents } from "./ChatMember";
import { WorldEvents } from "./World";
import { getEnvironmentSnapshot } from "../util/environment";
import {
    DEFAULT_GEMINI_MODEL,
    GEMINI_MAX_OUTPUT_TOKENS,
    PROMPT_DEMAND_TASK,
    PROMPT_DEMAND_RULES,
    PROMPT_RESTABILIZER_TASK,
    PROMPT_RESTABILIZER_RULES
} from "../util/Constants";
import { PROMPT_AGE_MANDATE, PROMPT_CHILD_SAFETY_MANDATE } from "../util/prompts";

/** Legacy monolithic horizon key — migrated into `world:schedule_today` on boot. */
const SCHEDULE_STORAGE_KEY = "world:schedule_v2";
/** Today's resolved 24-hour timeline (templates placed + delta blocks). */
const TODAY_STORAGE_KEY = "world:schedule_today";
/** Template library: every non-"once" block, protected from today's overrides. */
const TEMPLATES_STORAGE_KEY = "world:schedule_templates";
/** Calendar-day key guarding today's timeline against cross-day restores. */
const TODAY_DATE_KEY = "world:schedule_today_date";
const STREAM_PROGRESS_DEBOUNCE_MS = 150;
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export const PlannerStreamEvents = {
    START: "planner:stream:start",
    THINKING: "planner:stream:thinking",
    TEXT: "planner:stream:text",
    BLOCK: "planner:stream:block",
    FAILOVER: "planner:stream:failover",
    DONE: "planner:stream:done",
    ERROR: "planner:stream:error"
};

export default class WorldSetter {

    /**
     * @param {Object} options
     * @param {Logger} options.logger
     * @param {World} options.world
     */
    constructor({ logger, world }) {
        if (!logger) throw new TypeError("WorldSetter requires a Logger instance.");
        if (!world) throw new TypeError("WorldSetter requires a World instance.");

        /** @readonly @type {Logger} */ this.logger = logger.child("WorldSetter");
        /** @readonly @type {World} */ this.world = world;
        /** @readonly @type {Storage} */ this.storage = new Storage("Memories", this.logger);

        this.modelPool = new GeminiModelPool(this.logger);

        /** @readonly @type {GeminiClient} */ this.geminiClient = new GeminiClient({
            logger: this.logger,
            defaultModel: DEFAULT_GEMINI_MODEL,
            modelPool: this.modelPool
        });

        /** @type {ScheduleRecord[]} */ this.schedule = [];
        /** @type {ScheduleRecord[]} Recurrence template library (non-"once" blocks). */ this.templates = [];
        /** Calendar-day key ("Y-M-D") the current timeline belongs to. @type {string|null} */
        this.scheduleDateKey = null;
        /** Template ids whose TODAY instance was deleted (re-suppressed until midnight). @type {Set<string>} */
        this.suppressedTodayIds = new Set();
        /** @type {boolean} */ this.isDirty = false;
        /** @type {boolean} */ this.isPlanning = false;
        /** @type {ScheduleProposal | null} */ this.pendingProposal = null;
        this.#bindDayRolloverListener();
    }

    #streamProgress = { lastEmitAt: 0, emittedBlocks: 0 };

    /** Whether cast member ABOUT listeners are already bound. @type {boolean} */
    #profilesBound = false;

    /**
     * Strips reasoning spans from a raw model buffer so that block-detection
     * regexes ONLY ever see real schedule output (Task 7).
     *
     * Handles the three shapes reasoning models emit:
     * - `<?think>…` self-delimited Codestral-style preamble
     * - `[…]` self-delimited reasoning preamble
     * - paired `<think>…` and `<thought>…</thought>` spans
     *
     * An unclosed opener swallows the remainder of the buffer, which is exactly
     * right while a model is still reasoning — nothing downstream can fire on a
     * preamble that merely *mentions* "block" or "<schedule>".
     *
     * @param {string} text Raw accumulated text.
     * @returns {string} Output text with all reasoning spans removed.
     */
    static stripReasoningSpans(text) {
        if (!text || typeof text !== "string") return "";
        if (!/<\?think\b|\[\s*think\s*\]|<\s*think\b|<thought\b/i.test(text)) return text;

        let out = text;
        // Self-delimited markers: the opener doubles as the closer (or runs to end-of-stream).
        out = out.replace(/<\?think\b[\s\S]*?(?:<\?think>|$)/gi, "");
        out = out.replace(/\[\s*think\s*\][\s\S]*?(?:\[\s*think\s*\]|$)/gi, "");
        // Paired reasoning tags.
        out = out.replace(/<\s*think\b[^>]*>[\s\S]*?<\/\s*think\s*>/gi, "");
        out = out.replace(/<thought\b[^>]*>[\s\S]*?<\/\s*thought\s*>/gi, "");
        return out;
    }

    /**
     * @param {{ messages: import("./PromptBuilder").ChatMessage[] }} promptPayload
     * @param {PromptType} promptType
     * @returns {Promise<string>}
     */
    async #generatePlannerXml(promptPayload, promptType) {
        /** @type {Set<Function>} */ 
        const cleanups = new Set();
        let rawText = "";

        const onChunk = (/** @type {string} */ chunk) => {
            rawText += chunk;
            this.#emitStreamProgress(rawText, chunk);
        };
        cleanups.add(this.geminiClient.events.on("text", onChunk, "PlannerStream:text"));

        // Reasoning tokens (`part.thought === true`) never reach the output
        // stream — surface them as an explicit THINKING phase instead (Task 7).
        const onThinking = () => this.#emitThinkingProgress();
        cleanups.add(this.geminiClient.events.on("thinking", onThinking, "PlannerStream:thinking"));

        const events = this.world.events;

        try {
            const candidates = await this.#resolveModelCandidates();

            if (candidates.length === 0) {
                const message = "No Gemini models available in the active pool.";
                this.logger.error(`Planner "${promptType}" aborted: ${message}`);
                events.emit(PlannerStreamEvents.ERROR, { promptType, error: message });
                throw new Error(message);
            }

            this.#resetStreamProgress();
            events.emit(PlannerStreamEvents.START, { promptType, model: candidates[0].id });

            /** @type {Error|null} */
            let lastError = null;

            for (let i = 0; i < candidates.length; i++) {
                const model = candidates[i].id;
                rawText = "";
                this.#resetStreamProgress();

                try {
                    const tierLabel = candidates[i].tier === 1 ? "Tier 1 (Flash-Lite)" : `Tier ${candidates[i].tier}`;
                    this.logger.debug(`Dispatching "${promptType}" to ${tierLabel} model "${model}" (${i + 1}/${candidates.length})...`);

                    const isStabilizer = promptType === "stabilizer";

                    const result = await this.geminiClient.streamGenerate(promptPayload.messages, {
                        temperature: 0.7,
                        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
                        promptType,
                        model,
                        // Task 1: routine planner/demand calls never attach Google
                        // Search grounding — it burns the free-tier rate limit.
                        tools: null,
                        thinkingBudget: isStabilizer ? STABILIZER_THINKING_BUDGET : DEEP_THINKING_BUDGET
                    });

                    rawText = result.text;
                    this.modelPool.reportSuccess(model);
                    // Strip any residual inline reasoning (<?think> / [think] /
                    // <thought>) before the XML parser sees the response.
                    return WorldSetter.stripReasoningSpans(result.text);
                } catch (/** @type {any} */ genError) {
                    const err = genError;
                    lastError = err;

                    if (err instanceof DOMException && err.name === "AbortError") throw err;

                    const isCircuitOpen = err.code === "CIRCUIT_OPEN";
                    const status = typeof err.status === "number" ? err.status : null;
                    if (!isCircuitOpen) this.modelPool.reportFailure(model, status);

                    const reason = isCircuitOpen
                        ? "Circuit breaker open"
                        : status === null ? "Timed out" : `HTTP ${status}`;
                    const next = candidates[i + 1];
                    const nextTier = next ? (next.tier === 1 ? "Tier 1 (Flash-Lite)" : `Tier ${next.tier}`) : null;

                    this.logger.warn(`Gemini model "${model}" failed (${reason}). ${next ? `Cascading to ${nextTier} "${next.id}"...` : "No alternate model left in pool."}`);

                    events.emit(PlannerStreamEvents.FAILOVER, {
                        promptType,
                        fromModel: model,
                        toModel: next ? next.id : null,
                        status,
                        reason,
                        error: err.message
                    });
                }
            }

            const message = `All ${candidates.length} Gemini model(s) across all tiers failed for "${promptType}": ${lastError?.message || lastError || "unknown error"}`;
            this.logger.error(message);
            events.emit(PlannerStreamEvents.ERROR, { promptType, error: message });
            throw new Error(message);
        } finally {
            for (const off of cleanups) off();
            cleanups.clear();
            this.#emitStreamProgress(WorldSetter.stripReasoningSpans(rawText), "", true);
            events.emit(PlannerStreamEvents.DONE, { promptType, rawText: WorldSetter.stripReasoningSpans(rawText) });
        }
    }

    async #resolveModelCandidates() {
        try {
            return await this.modelPool.getCandidates();
        } catch (err) {
            this.logger.warn("Gemini model pool discovery failed:", err);
            return [];
        }
    }

    #resetStreamProgress() {
        this.#streamProgress = { lastEmitAt: 0, emittedBlocks: 0 };
    }

    /**
     * Emits the debounced "🧠 Thinking & Structuring Scene..." phase while the
     * model is still in its reasoning preamble (before any schedule output).
     * @returns {void}
     */
    #emitThinkingProgress() {
        const now = Date.now();
        if (now - this.#streamProgress.lastEmitAt < STREAM_PROGRESS_DEBOUNCE_MS) return;
        this.#streamProgress.lastEmitAt = now;

        this.world.events.emit(PlannerStreamEvents.THINKING, {});
    }

    /**
     * @param {string} accumulated
     * @param {string} [chunk]
     * @param {boolean} [force]
     */
    #emitStreamProgress(accumulated, chunk = "", force = false) {
        const now = Date.now();

        // (Task 7) Reasoning spans are removed BEFORE any structural analysis:
        // a preamble that mentions "block" or "<schedule>" must never drive
        // block detection or the phase indicator.
        const output = WorldSetter.stripReasoningSpans(accumulated);
        const hasSchedule = /<\s*schedule\b/i.test(output);

        const closedBlockArrived = /<\/\s*block\s*>/i.test(chunk) && hasSchedule;
        const debounced = now - this.#streamProgress.lastEmitAt >= STREAM_PROGRESS_DEBOUNCE_MS;

        if (!force && !closedBlockArrived && !debounced) return;
        this.#streamProgress.lastEmitAt = now;

        const events = this.world.events;
        events.emit(PlannerStreamEvents.TEXT, output);

        // Explicit phase: while no <schedule> XML has actually started streaming,
        // the model is still thinking/structuring — never "Generating block X".
        if (!hasSchedule) {
            events.emit(PlannerStreamEvents.THINKING, {});
        }

        const blockRegex = /<\s*block\b[^>]*>([\s\S]*?)<\/\s*block\s*>/gi;
        let match;
        let matchIndex = 0;

        while ((match = blockRegex.exec(output)) !== null) {
            const rawBlock = match[0];
            const content = match[1];

            if (matchIndex++ < this.#streamProgress.emittedBlocks) continue;
            this.#streamProgress.emittedBlocks++;

            const startAttr = rawBlock.match(/start\s*=\s*["']([^"']+)["']/);
            const endAttr = rawBlock.match(/end\s*=\s*["']([^"']+)["']/);
            const topicMatch = content.match(/<\s*topic\b[^>]*>([\s\S]*?)<\/\s*topic\s*>/i);
            const mainGoalMatch = content.match(/<\s*main\b[^>]*>([\s\S]*?)<\/\s*main\s*>/i)
                || content.match(/<\s*main_goal\b[^>]*>([\s\S]*?)<\/\s*main_goal\s*>/i);

            /** @type {Partial<ScheduleRecord>} */
            const block = {
                id: crypto.randomUUID(),
                startHour: startAttr ? Number(startAttr[1]) : 0,
                endHour: endAttr ? Number(endAttr[1]) : 1,
                topic: topicMatch ? topicMatch[1].trim() : "Generating...",
                mainGoal: mainGoalMatch ? mainGoalMatch[1].trim() : "",
                characterGoals: [],
                facts: [],
                prePlot: "",
                postPlot: "",
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            block.timeRange = `${block.startHour}:00 - ${block.endHour}:00`;

            events.emit(PlannerStreamEvents.BLOCK, block);
        }
    }

    async init() {
        this.logger.info("Initializing WorldSetter and restoring schedule...");

        try {
            // Prefer today's resolved timeline; fall back to the legacy
            // monolithic horizon once (one-time migration).
            const todayRaw = await this.storage.getItem(TODAY_STORAGE_KEY);
            const legacyRaw = Array.isArray(todayRaw)
                ? null
                : await this.storage.getItem(SCHEDULE_STORAGE_KEY);
            const raw = Array.isArray(todayRaw) ? todayRaw : legacyRaw;

            if (Array.isArray(raw)) {
                this.schedule = this.#sanitizeAndSortSchedule(
                    raw.filter(this.#isValidRecord).map(r => this.#withDerivedFields(/** @type {ScheduleRecord} */ (r)))
                );
                if (!Array.isArray(todayRaw)) {
                    await this.#persistToday();
                }
                this.logger.info(`Restored ${this.schedule.length} schedule records from storage.`);
            }
        } catch (err) {
            this.logger.warn("Failed to load schedule from storage:", err);
        }

        try {
            const dayKeyRaw = await this.storage.getItem(TODAY_DATE_KEY);
            this.scheduleDateKey = typeof dayKeyRaw === "string" ? dayKeyRaw : null;
        } catch {
            this.scheduleDateKey = null;
        }

        try {
            const tplRaw = await this.storage.getItem(TEMPLATES_STORAGE_KEY);
            if (Array.isArray(tplRaw)) {
                this.templates = tplRaw
                    .filter(this.#isValidRecord)
                    .map(r => this.#withDerivedFields(/** @type {ScheduleRecord} */ (r)));
                this.logger.info(`Restored ${this.templates.length} recurrence template(s).`);
            }
        } catch (err) {
            this.logger.warn("Failed to load schedule templates from storage:", err);
        }

        try {
            const envSnapshot = await getEnvironmentSnapshot();
            this.world.environment = envSnapshot;
            this.logger.info(`Environmental data loaded: ${envSnapshot.todayCelebration}`);
        } catch (err) {
            this.logger.warn("Failed to fetch live environment data, using defaults:", err);
        }

        this.#bindMemberProfileListeners();
        this.#bindDayRolloverListener();

        return this.schedule;
    }

    /** Whether the DAY_CHANGE rollover listener is bound. @type {boolean} */
    #dayRolloverBound = false;

    /**
     * Binds WorldEvents.DAY_CHANGE so midnight cleanly resolves a fresh
     * 24-hour day from the recurrence template library (Task 2).
     *
     * @returns {void}
     */
    #bindDayRolloverListener() {
        if (this.#dayRolloverBound) return;
        const events = this.world?.events;
        if (!events || typeof events.on !== "function") return;
        this.#dayRolloverBound = true;

        events.on(WorldEvents.DAY_CHANGE, (/** @type {unknown} */ now) => {
            const at = now instanceof Date ? now : new Date();
            void this.#handleDayRollover(at).catch((/** @type {unknown} */ err) => {
                this.logger.warn("Midnight day rollover resolution failed:", err);
            });
        }, "WorldSetter: DAY_CHANGE");
    }

    /**
     * Clears yesterday's timeline and resolves a fresh contiguous 24-hour day
     * from templates + single-pass delta generation.
     *
     * @param {Date} now
     * @returns {Promise<void>}
     */
    async #handleDayRollover(now) {
        this.logger.info("DAY_CHANGE detected — resolving a fresh 24-hour day from templates...");
        this.schedule = [];
        this.pendingProposal = null;
        this.isDirty = false;
        this.suppressedTodayIds.clear();
        this.scheduleDateKey = WorldSetter.#dayKey(now);
        await this.#persistToday();
        await this.resolveTodaySchedule(now);
    }

    /**
     * Stable calendar-day key ("Y-M-D") used to detect day rollovers.
     *
     * @param {Date} now
     * @returns {string}
     */
    static #dayKey(now) {
        return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    }

    /**
     * Tier-1 re-stabilization trigger: any cast member profile (bio) change
     * schedules an immediate 24-hour horizon refresh so the timeline reflects
     * the new character development.
     *
     * @returns {void}
     */
    #bindMemberProfileListeners() {
        if (this.#profilesBound) return;
        if (!(this.world.members instanceof Map)) return;
        this.#profilesBound = true;

        for (const member of this.world.members.values()) {
            if (!member || !member.events || typeof member.events.on !== "function") continue;
            member.events.on(ChatMemberEvents.ABOUT, () => {
                this.logger.info(`Profile changed for ${member.name}. Regenerating upcoming delta scenes...`);
                void this.regenerateUpcomingDeltas().catch((/** @type {unknown} */ err) => {
                    this.logger.warn("Persona-driven delta regeneration failed:", err);
                });
            }, `WorldSetter: ABOUT listener for ${member.id}`);
        }
    }

    #buildBirthdayPromptPart() {
        const celebrations = Array.isArray(this.world?.activeCelebrations)
            ? this.world.activeCelebrations.filter(c => c && c.type === "birthday")
            : [];

        if (celebrations.length === 0) return null;

        return [
            "<active_celebration>",
            ...celebrations.map(c => {
                const age = Number(c.turningAge) || 0;
                return (
                    `  <birthday member="${XmlEncoder.encode(c.id)}" name="${XmlEncoder.encode(c.name)}" turning_age="${age}">` +
                    `Today is ${XmlEncoder.encode(c.name)}'s ${age} birthday. Schedule at least one block that incorporates birthday surprises, outings, or party prep.` +
                    "</birthday>"
                );
            }),
            "</active_celebration>"
        ].join("\n");
    }

    async ensureSchedule(now = new Date()) {
        const currentDecimalHour = now.getHours() + (now.getMinutes() / 60);

        // Task 2: the FULL 24-hour day is preserved — past blocks are NEVER
        // purged mid-day. They are only tagged (past | active | upcoming) so
        // the planner UI can grey them out.
        const dayKey = WorldSetter.#dayKey(now);
        if (this.schedule.length > 0 && this.scheduleDateKey !== null && this.scheduleDateKey !== dayKey) {
            this.logger.info(`Timeline belongs to ${this.scheduleDateKey} but the world rolled to ${dayKey} — resolving a fresh day.`);
            this.schedule = [];
            this.pendingProposal = null;
            this.isDirty = false;
            this.suppressedTodayIds.clear();
        }
        this.scheduleDateKey = dayKey;
        this.#tagScheduleStatus(now);

        const hasUpcomingCoverage = this.schedule.some(rec => rec.endHour >= currentDecimalHour + 3);

        if (!hasUpcomingCoverage && !this.isPlanning) {
            this.logger.info("Schedule horizon < 3 hours. Resolving today's timeline (templates + gap deltas)...");
            await this.resolveTodaySchedule(now);
        }

        getEnvironmentSnapshot().then(snapshot => {
            this.world.environment = snapshot;
        }).catch(() => {});

        return this.schedule;
    }

    /**
     * Tags every block with its lifecycle status relative to `now`:
     * "past" | "active" | "upcoming". Purely derived — the 24-hour day
     * itself is never trimmed (Task 2).
     *
     * @param {Date} now
     * @returns {void}
     */
    #tagScheduleStatus(now) {
        const ref = now instanceof Date ? now : (this.world?.now instanceof Date ? this.world.now : new Date());
        const decimalNow = ref.getHours() + (ref.getMinutes() / 60);
        for (const rec of this.schedule) {
            rec.status = decimalNow >= rec.endHour
                ? "past"
                : (decimalNow >= rec.startHour ? "active" : "upcoming");
        }
    }

    // ─── Hybrid 24-Hour Planner: Templates + Deltas ────────────────────

    /**
     * Applies hybrid-planner default fields (title / type / source /
     * denseParagraph) to a record loaded from storage or built by a legacy
     * path, so every block satisfies the ScheduleRecord contract.
     *
     * @param {ScheduleRecord} record
     * @returns {ScheduleRecord}
     */
    #withDerivedFields(record) {
        if (!record.title) record.title = record.topic;
        if (!record.type) record.type = "once";
        if (!record.source) record.source = "user";
        if (!record.denseParagraph) record.denseParagraph = this.#composeDenseParagraph(record);
        return record;
    }

    /**
     * Default macro scene paragraph for records the model didn't provide one.
     *
     * @param {ScheduleRecord} record
     * @returns {string}
     */
    #composeDenseParagraph(record) {
        const text = [record.topic, record.mainGoal, record.prePlot]
            .filter(Boolean)
            .join(". ")
            .trim();
        if (!text) return "The cast hangs out together in Lucknow, chatting naturally.";
        return text.endsWith(".") ? text : `${text}.`;
    }

    /** Persists today's resolved timeline (+ its calendar-day key). @returns {Promise<void>} */
    async #persistToday() {
        try {
            await this.storage.setItem(TODAY_STORAGE_KEY, this.schedule);
            if (this.scheduleDateKey !== null) {
                await this.storage.setItem(TODAY_DATE_KEY, this.scheduleDateKey);
            }
        } catch (err) {
            this.logger.warn("Failed to persist today's schedule:", err);
        }
    }

    /** Persists the recurrence template library. @returns {Promise<void>} */
    async #persistTemplates() {
        try {
            await this.storage.setItem(TEMPLATES_STORAGE_KEY, this.templates);
        } catch (err) {
            this.logger.warn("Failed to persist schedule templates:", err);
        }
    }

    /**
     * Snapshot of the recurrence template library (non-"once" blocks).
     * @returns {ScheduleRecord[]}
     */
    getTemplates() {
        return [...this.templates];
    }

    /**
     * Resolves today's contiguous 24-hour timeline — Hybrid Templates + Deltas.
     *
     * Priority ladder for template placement:
     *   specific calendar date > day group (weekdays/weekends) > "forever".
     * Existing today blocks (user/demand overrides) always win their window —
     * templates are NEVER mutated here, so an override for today stays
     * non-destructive for future days.
     *
     * Remaining empty gaps in the 0..24 span are filled by Gemini with delta
     * blocks ONLY (`type: "once"`, `source: "delta"`). Gaps fully in the past
     * are left alone — expired blocks are pruned anyway.
     *
     * @param {Date} [now=new Date()]
     * @returns {Promise<ScheduleRecord[]>} The sorted, contiguous schedule.
     */
    async resolveTodaySchedule(now = new Date()) {
        if (this.isPlanning) return this.schedule;
        this.isPlanning = true;

        try {
            const decimalNow = now.getHours() + now.getMinutes() / 60;
            this.scheduleDateKey = WorldSetter.#dayKey(now);

            /** @type {ScheduleRecord[]} */
            const placed = this.schedule.map(r => this.#withDerivedFields(r));
            /** @type {Array<{ start: number, end: number }>} */
            const occupied = placed.map(r => ({ start: r.startHour, end: r.endHour }));

            // 1. Resolution priority: specific date (3) > day group (2) > forever (1).
            const dateKey = `${now.getDate()} ${MONTH_KEYS[now.getMonth()]}`;
            const dayType = (now.getDay() === 0 || now.getDay() === 6) ? "weekends" : "weekdays";
            const rankOf = (/** @type {ScheduleRecord} */ t) =>
                t.type === dateKey ? 3 : (t.type === dayType ? 2 : (t.type === "forever" ? 1 : 0));

            const matched = this.templates
                .filter(t => rankOf(t) > 0)
                .sort((a, b) => rankOf(b) - rankOf(a) || a.createdAt - b.createdAt);

            for (const tpl of matched) {
                if (this.suppressedTodayIds.has(tpl.id)) continue; // today's instance was deleted by the user
                const overlaps = occupied.some(o => tpl.startHour < o.end && tpl.endHour > o.start);
                if (overlaps) continue; // a higher-priority or existing block owns this window
                placed.push({
                    ...tpl,
                    characterGoals: Array.isArray(tpl.characterGoals) ? [...tpl.characterGoals] : [],
                    facts: Array.isArray(tpl.facts) ? [...tpl.facts] : []
                });
                occupied.push({ start: tpl.startHour, end: tpl.endHour });
            }

            // 2. Empty gaps across 0..24 — calculate all missing intervals across today (Task 2).
            const fillable = this.#findGaps(occupied);

            // 3. Gemini generates Delta Blocks for ALL remaining gaps in ONE
            // single-pass prompt call — not one sequential round-trip per gap.
            const deltas = await this.#generateDeltaBlocksForGaps(fillable, now);
            for (const delta of deltas) {
                placed.push(delta);
                occupied.push({ start: delta.startHour, end: delta.endHour });
            }

            this.schedule = this.#sanitizeAndSortSchedule(placed);
            this.#tagScheduleStatus(now);
            this.isDirty = false;
            await this.#persistToday();
            this.world.tick(this.world.now);
            this.logger.info(
                `Resolved today's schedule: ${this.schedule.length} block(s), ${fillable.length} gap(s) filled.`
            );
            return this.schedule;
        } finally {
            this.isPlanning = false;
        }
    }

    /**
     * Removes UPCOMING delta blocks (persona edit hook) and re-resolves today's
     * schedule so fresh deltas reflect the edited bio. Templates, user and
     * demand blocks are preserved untouched.
     *
     * @returns {Promise<ScheduleRecord[]>}
     */
    async regenerateUpcomingDeltas() {
        const now = this.world.now instanceof Date ? this.world.now : new Date();
        const decimalNow = now.getHours() + now.getMinutes() / 60;

        const before = this.schedule.length;
        this.schedule = this.schedule.filter(
            r => !(r.source === "delta" && r.endHour > decimalNow)
        );
        const removed = before - this.schedule.length;
        if (removed > 0) {
            this.logger.info(`Dropped ${removed} upcoming delta block(s) for regeneration.`);
        }

        return this.resolveTodaySchedule(now);
    }

    /**
     * Computes empty spans across the 0..24 day from occupied intervals.
     *
     * @param {Array<{ start: number, end: number }>} occupied
     * @returns {Array<{ start: number, end: number }>}
     */
    #findGaps(occupied) {
        const sorted = [...occupied].sort((a, b) => a.start - b.start);
        /** @type {Array<{ start: number, end: number }>} */
        const gaps = [];
        let cursor = 0;

        for (const o of sorted) {
            if (o.start > cursor + 0.01) gaps.push({ start: cursor, end: o.start });
            cursor = Math.max(cursor, o.end);
        }
        if (cursor < 24 - 0.01) gaps.push({ start: cursor, end: 24 });

        return gaps;
    }

    /**
     * Generates delta blocks (`type: "once"`, `source: "delta"`) for ALL
     * remaining gaps in ONE Gemini prompt call (single-pass, Task 2). Each
     * parsed block is assigned to the gap it overlaps and clipped into it;
     * any remainder inside a gap is backfilled deterministically so the day
     * stays contiguous.
     *
     * @param {Array<{ start: number, end: number }>} gaps
     * @param {Date} now
     * @returns {Promise<ScheduleRecord[]>}
     */
    async #generateDeltaBlocksForGaps(gaps, now) {
        if (!Array.isArray(gaps) || gaps.length === 0) return [];

        const fmt = (/** @type {number} */ val) => {
            let h = Math.floor(val);
            let m = Math.round((val - h) * 60);
            if (m >= 60) { h += 1; m = 0; }
            if (h >= 24) { h = 24; m = 0; }
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        };

        const members = this.world.members instanceof Map
            ? [...this.world.members.values()]
            : [];
        const castLine = members.length > 0
            ? members.map(m => `- **${m.name}** (ID: \`${m.id}\`, Age: ${m.age}y): ${m.about}`).join("\n")
            : "- tom, angela, ben, ginger, hank, becca (cast profiles unavailable)";
        const goalSchema = (members.length > 0
            ? members
            : [{ id: "tom", name: "Tom" }, { id: "angela", name: "Angela" }, { id: "ben", name: "Ben" },
                { id: "ginger", name: "Ginger" }, { id: "hank", name: "Hank" }, { id: "becca", name: "Becca" }]
        ).map(m => `      <goal id="${XmlEncoder.encode(String(m.id))}" name="${XmlEncoder.encode(String(m.name))}">Goal</goal>`).join("\n");

        const gapLines = gaps.map((g, i) => (
            `  <gap index="${i + 1}" start="${g.start}" end="${g.end}">Fill ${fmt(g.start)} - ${fmt(g.end)} (${Math.round((g.end - g.start) * 60)} minutes) with contiguous block(s) that cover it end-to-end.</gap>`
        )).join("\n");

        const promptBuilder = new PromptBuilderClass();
        promptBuilder.useSystem(() => promptBuilder.part([
            "# 24-Hour Planner — Gap Delta Generator (Single Pass)",
            'You are the Assistant Director for "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
            `Fill ALL ${gaps.length} missing time gap(s) below with plausible scene blocks in ONE response — this is a single pass, so never ask for more data.`,
            "",
            "## Gaps To Fill",
            gapLines,
            "",
            "## Cast Profiles",
            castLine,
            "",
            "## Rules",
            "1. Blocks stay strictly inside their own gap: contiguous, non-overlapping.",
            "2. Rotate varied Lucknow settings (Gomti Nagar riverfront, Aliganj markets, university campus, balconies, study rooms, terraces, society parks).",
            "3. The <dense_paragraph> must be a vivid, self-contained 2-4 sentence scene setting describing who is where, atmosphere, and what individual members are actively doing or aiming for, completely independent of chronological order or neighboring blocks.",
            "",
            "## Age Factor",
            PROMPT_AGE_MANDATE,
            "",
            "## Child Safety",
            PROMPT_CHILD_SAFETY_MANDATE,
            "",
            "## Output Schema",
            "Output strictly valid XML matching this structure — one <block> per generated scene:",
            "<schedule>",
            `  <block start="${gaps[0].start}" end="${Math.min(gaps[0].end, gaps[0].start + 2)}">`,
            "    <topic>Scene title</topic>",
            "    <dense_paragraph>2-4 sentence self-contained scene setting showing cast actions and goals, independent of sequence.</dense_paragraph>",
            "    <facts><fact>Concrete item or constraint</fact></facts>",
            "  </block>",
            "</schedule>"
        ].join("\n")));

        promptBuilder.useUser(() => promptBuilder.part(
            `Today is ${now.toDateString()}. Fill ONLY the ${gaps.length} gap(s) declared above — one single generation pass.`
        ));

        /** @type {ScheduleRecord[][]} per-gap generated blocks */
        const perGap = gaps.map(() => []);
        /** @type {ScheduleRecord[]} */
        let parsed = [];
        try {
            const payload = await promptBuilder.build();
            const xml = await this.#generatePlannerXml(payload, "scheduler");
            parsed = this.#parseXmlScheduleResponse(xml, Math.floor(Math.min(...gaps.map(g => g.start))));
        } catch (err) {
            this.logger.warn("Single-pass delta generation failed; backfilling deterministically:", err);
        }

        for (const block of parsed) {
            const gapIdx = gaps.findIndex(g => block.startHour < g.end && block.endHour > g.start);
            if (gapIdx === -1) continue; // outside every gap — the deterministic backfill covers it
            const gap = gaps[gapIdx];
            const s = Math.max(block.startHour, gap.start);
            const e = Math.min(block.endHour, gap.end);
            if (e - s < 0.5) continue;
            perGap[gapIdx].push(this.#withDerivedFields({
                ...block,
                startHour: s,
                endHour: e,
                timeRange: this.#formatDecimalRange(s, e),
                type: "once",
                source: "delta"
            }));
        }

        // Contiguity guarantee: whatever the model skipped inside each gap is
        // backfilled with quiet deterministic blocks.
        /** @type {ScheduleRecord[]} */
        const result = [];
        for (let i = 0; i < gaps.length; i++) {
            result.push(...perGap[i], ...this.#buildDeltaFallback(gaps[i], perGap[i]));
        }
        return result;
    }

    /**
     * Deterministic fallback blocks covering the UNSPECIFIED remainder of a gap.
     *
     * @param {{ start: number, end: number }} gap
     * @param {ScheduleRecord[]} generated Blocks already generated inside the gap.
     * @returns {ScheduleRecord[]}
     */
    #buildDeltaFallback(gap, generated) {
        const covered = [...generated]
            .map(g => ({ start: g.startHour, end: g.endHour }))
            .sort((a, b) => a.start - b.start);

        /** @type {Array<{ start: number, end: number }>} */
        const holes = [];
        let cursor = gap.start;
        for (const c of covered) {
            if (c.start > cursor + 0.01) holes.push({ start: cursor, end: c.start });
            cursor = Math.max(cursor, c.end);
        }
        if (cursor < gap.end - 0.01) holes.push({ start: cursor, end: gap.end });

        const fillerTopics = [
            { topic: "Casual catch-up & chai", mainGoal: "Share the day's updates", facts: ["Chai and biscuits on the table"] },
            { topic: "Focused work & study session", mainGoal: "Make progress on personal goals", facts: ["Books and laptops out"] },
            { topic: "Evening stroll & street food", mainGoal: "Wind down together", facts: ["Snacks from the corner stall"] },
            { topic: "Late-night banter", mainGoal: "Relax and joke around", facts: ["Low light, sleepy vibes"] }
        ];

        /** @type {ScheduleRecord[]} */
        const blocks = [];
        let i = 0;
        for (const hole of holes) {
            let s = hole.start;
            while (s < hole.end - 0.01) {
                const e = Math.min(hole.end, s + 1);
                const t = fillerTopics[i++ % fillerTopics.length];
                blocks.push(this.#withDerivedFields({
                    id: crypto.randomUUID(),
                    startHour: s,
                    endHour: e,
                    timeRange: this.#formatDecimalRange(s, e),
                    topic: t.topic,
                    mainGoal: t.mainGoal,
                    characterGoals: [],
                    facts: t.facts,
                    prePlot: "Friends hanging out in the space",
                    postPlot: "Transitioning to the next activity",
                    type: "once",
                    source: "delta",
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                }));
                s = e;
            }
        }
        return blocks;
    }

    /**
     * Keeps the template library in sync with a record's recurrence type:
     * non-"once" records are (up)serted into the library, "once" records are
     * removed from it. The library copy is always a deep-enough clone so
     * today's overrides never mutate a stored template.
     *
     * @param {ScheduleRecord} record
     * @returns {Promise<void>}
     */
    async #syncTemplateLibrary(record) {
        const idx = this.templates.findIndex(t => t.id === record.id);
        const isTemplate = Boolean(record.type && record.type !== "once");

        if (isTemplate) {
            const clone = {
                ...record,
                characterGoals: Array.isArray(record.characterGoals) ? record.characterGoals.map(cg => ({ ...cg })) : [],
                facts: Array.isArray(record.facts) ? [...record.facts] : []
            };
            if (idx === -1) this.templates.push(clone);
            else this.templates[idx] = clone;
        } else if (idx !== -1) {
            this.templates.splice(idx, 1);
        } else {
            return;
        }

        await this.#persistTemplates();
    }

    /**
     * Applies partial field updates to a record while keeping the hybrid
     * fields (title / denseParagraph / type) in sync.
     *
     * @param {ScheduleRecord} record
     * @param {Partial<ScheduleRecord>} updates
     * @returns {void}
     */
    #applyUpdates(record, updates) {
        if (updates.topic !== undefined) {
            record.topic = String(updates.topic).trim();
            record.title = record.topic;
        }
        if (updates.title !== undefined) {
            record.title = String(updates.title).trim() || record.topic;
            record.topic = record.title;
        }
        if (updates.mainGoal !== undefined) record.mainGoal = String(updates.mainGoal).trim();
        if (updates.denseParagraph !== undefined) record.denseParagraph = String(updates.denseParagraph).trim();
        if (updates.type !== undefined) record.type = String(updates.type).trim() || "once";
        if (updates.characterGoals !== undefined && Array.isArray(updates.characterGoals)) {
            record.characterGoals = updates.characterGoals;
        }
        if (updates.facts !== undefined && Array.isArray(updates.facts)) {
            record.facts = updates.facts.map(String).filter(Boolean);
        }
        if (updates.startHour !== undefined) record.startHour = Number(updates.startHour);
        if (updates.endHour !== undefined) record.endHour = Number(updates.endHour);
        if (updates.prePlot !== undefined) record.prePlot = String(updates.prePlot).trim();
        if (updates.postPlot !== undefined) record.postPlot = String(updates.postPlot).trim();

        if (!record.title) record.title = record.topic;
        if (!record.denseParagraph) record.denseParagraph = this.#composeDenseParagraph(record);
        if (!record.type) record.type = "once";
        record.updatedAt = Date.now();
    }

    /**
     * Updates a template in the library (and its placed copy in today's
     * timeline when the ids match). Returns null when the id is unknown.
     *
     * @param {string} id
     * @param {Partial<ScheduleRecord>} updates
     * @returns {Promise<ScheduleRecord|null>}
     */
    async updateTemplate(id, updates) {
        const template = this.templates.find(t => t.id === id);
        if (!template) return null;

        this.#applyUpdates(template, updates);
        if (template.type === "once") {
            // Recurrence dropped back to one-off — leave the library.
            this.templates = this.templates.filter(t => t.id !== id);
            await this.#persistTemplates();
            return template;
        }

        const placed = this.schedule.find(r => r.id === id);
        if (placed) this.#applyUpdates(placed, updates);

        await this.#persistTemplates();
        await this.#persistToday();
        this.world.tick(this.world.now);
        return template;
    }

    /**
     * Deletes a template from the library and today's placed copy (same id).
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteTemplate(id) {
        const before = this.templates.length;
        this.templates = this.templates.filter(t => t.id !== id);
        if (this.templates.length === before) return false;

        this.schedule = this.schedule.filter(r => r.id !== id);
        await this.#persistTemplates();
        await this.#persistToday();
        this.world.tick(this.world.now);
        return true;
    }

    /**
     * Generates (or re-stabilizes) the contiguous 24-hour macro timeline.
     *
     * @param {Date} date Anchor date for the horizon.
     * @param {string|null} [demandText] Optional Director Demand to integrate.
     * @returns {Promise<ScheduleRecord[]>}
     */
    async planHorizon(date, demandText = null) {
        if (this.isPlanning) return this.schedule;

        this.isPlanning = true;
        this.logger.info(`Generating streaming 24-hour horizon schedule starting from ${date.toLocaleTimeString()}...`);

        try {
            const promptBuilder = new PromptBuilderClass();
            const startHour = date.getHours();
            const currentHour = this.world.now.getHours();
            const env = this.world.environment;
            const unifiedMemory = this.world.unifiedMemory;

            /** @type {ChatMember[]} */
            const members = this.world.members instanceof Map
                ? [...this.world.members.values()]
                : [];

            // Timeline continuity: past/active blocks are locked, future blocks
            // are re-stabilized against new developments.
            const previousPlanMarkdown = this.schedule.length === 0
                ? "No prior schedule. Generate a fresh 24-hour daily timeline."
                : this.schedule.map(b => {
                    const isLocked = b.endHour <= currentHour || (b.startHour <= currentHour && b.endHour > currentHour);
                    return `- [${b.timeRange}] ${b.topic} (${isLocked ? "LOCKED / PAST" : "FUTURE - SUBJECT TO RE-STABILIZATION"})`;
                }).join("\n");

            const memoryStack = unifiedMemory && typeof unifiedMemory.toTextStack === "function"
                ? unifiedMemory.toTextStack()
                : "";

            const goalSchema = (members.length > 0
                ? members
                : [
                    { id: "tom", name: "Tom" },
                    { id: "angela", name: "Angela" },
                    { id: "ben", name: "Ben" },
                    { id: "ginger", name: "Ginger" },
                    { id: "hank", name: "Hank" },
                    { id: "becca", name: "Becca" }
                ]
            ).map(m => `      <goal id="${XmlEncoder.encode(String(m.id))}" name="${XmlEncoder.encode(String(m.name))}">Goal</goal>`).join("\n");

            promptBuilder.useSystem(() => promptBuilder.part([
                "# 24-Hour Storyline Planner & Director Engine",
                'You are the Lead Storyline Director for "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
                "Generate or update a complete, contiguous 24-hour daily schedule for the cast.",
                "",
                "## 1. Environment & Clock",
                `- Simulation Time: ${this.world.date}, ${this.world.time} (Current Hour: ${currentHour}:00)`,
                `- Location: ${env?.city || "Lucknow"}`,
                `- Weather: ${env?.temperature || "32°C"}, ${env?.weather || "Warm"}`,
                `- Occasion: ${env?.todayCelebration || "No festival today"}`,
                `- Headlines: ${(env?.newsHeadlines || []).slice(0, 3).join(" | ") || "None"}`,
                "",
                "## 2. Cast Profiles",
                members.length > 0
                    ? members.map(m => `- **${m.name}** (ID: \`${m.id}\`, Age: ${m.age}y): ${m.about}`).join("\n")
                    : "- Cast profiles unavailable.",
                "",
                "## 3. Active Memories",
                memoryStack || "No active memories stored.",
                "",
                "## 4. Timeline Continuity",
                previousPlanMarkdown,
                "",
                "Directive:",
                `- Blocks before ${currentHour}:00 are locked or in progress. Do not change their topics or timings.`,
                "- Re-align future blocks to smoothly integrate new character developments or demands.",
                "",
                "## 5. Director Demand",
                demandText || "None. Generate natural daily sitcom progression.",
                "",
                "## 6. Age Factor",
                PROMPT_AGE_MANDATE,
                "",
                "## 7. Child Safety",
                PROMPT_CHILD_SAFETY_MANDATE,
                "",
                "## Rules & Constraints",
                "1. Provide a complete, unbroken sequence of blocks covering the full 24-hour cycle.",
                "2. Contiguous start/end times with no overlapping hours.",
                "3. Rotate settings across Lucknow (Gomti Nagar riverfront, Aliganj markets, university campus, balconies, living rooms, terraces).",
                "4. INDEPENDENT SCENES: In each block, the <dense_paragraph> MUST be a 2-4 sentence self-contained scene description showing the setting, atmosphere, and individual cast actions. It must be completely independent of order, preceding blocks, or future scenes — no transitional phrases like 'after the earlier session' or 'preparing for tonight'.",
                "",
                "## Output Schema",
                "Output strictly valid XML matching this structure:",
                `<schedule date="${XmlEncoder.encode(this.world.date)}">`,
                "  <summary>Brief 1-2 sentence overview of the daily arc.</summary>",
                '  <block start="14.0" end="15.5">',
                "    <topic>Scene title</topic>",
                "    <dense_paragraph>2-4 sentence self-contained scene description showing the setting and individual cast actions/goals. Completely independent of time sequence or neighboring blocks.</dense_paragraph>",
                "    <facts><fact>Concrete item or constraint</fact></facts>",
                "  </block>",
                "</schedule>"
            ].join("\n")));

            const birthdayPart = this.#buildBirthdayPromptPart();
            if (birthdayPart) {
                promptBuilder.useSystem(() => promptBuilder.part(birthdayPart));
            }

            // Gemini requires at least one non-system message in `contents`.
            promptBuilder.useUser(() => promptBuilder.part(
                "Please generate the complete 24-hour storyline schedule following the instructions and schema above."
            ));

            const promptPayload = await promptBuilder.build();
            const xmlResponseText = await this.#generatePlannerXml(promptPayload, "scheduler");

            const parsedRecords = this.#parseXmlScheduleResponse(xmlResponseText, startHour)
                .map(r => ({ ...r, type: /** @type {import("./types/World.types").ScheduleType} */ ("once"), source: /** @type {import("./types/World.types").ScheduleSource} */ ("horizon") }));

            for (const newRec of parsedRecords) {
                const existingIdx = this.schedule.findIndex(r => r.startHour === newRec.startHour);
                if (existingIdx !== -1) {
                    this.schedule[existingIdx] = newRec;
                } else {
                    this.schedule.push(newRec);
                }
            }

            this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
            this.isDirty = false;

            await this.#persistToday();
            return this.schedule;
        } catch (err) {
            this.logger.error("Failed to generate schedule, applying fallbacks:", err);
            const fallbackRecords = this.#buildFallbackSchedule(date.getHours());
            for (const fb of fallbackRecords) {
                if (!this.schedule.some(r => r.startHour === fb.startHour)) {
                    this.schedule.push(fb);
                }
            }
            this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
            await this.#persistToday();
            return this.schedule;
        } finally {
            this.isPlanning = false;
        }
    }

    /**
     * @param {string} demandText
     * @returns {Promise<DemandResolutionResult>}
     */
    async applyUserDemand(demandText) {
        const cleanDemand = demandText.trim();
        if (!cleanDemand) throw new Error("Demand text cannot be empty.");

        this.logger.info(`Applying Director Demand In-Place: "${cleanDemand}"`);

        const promptBuilder = new PromptBuilderClass();
        const now = this.world.now;
        const currentHour = now.getHours();

        // Reference-based user memories: tag-indexed UnifiedMemory entries.
        const unifiedMemory = this.world.unifiedMemory;
        const userMemories = unifiedMemory && typeof unifiedMemory.getEntriesForMember === "function"
            ? unifiedMemory.getEntriesForMember(this.world.User.id).map(e => e.data)
            : [];

        const existingBlocksXml = this.schedule.map(b => (
            `    <block start="${b.startHour}" end="${b.endHour}">\n` +
            `      <topic>${XmlEncoder.encode(b.topic)}</topic>\n` +
            `      <dense_paragraph>${XmlEncoder.encode(b.denseParagraph || b.mainGoal || "")}</dense_paragraph>\n` +
            `      <facts>${b.facts.map(f => `<fact>${XmlEncoder.encode(f)}</fact>`).join("")}</facts>\n` +
            `    </block>`
        )).join("\n");

        promptBuilder.useSystem(() => promptBuilder.part(
            "<demand_engine>\n" +
            `  <task>${PROMPT_DEMAND_TASK}</task>\n` +
            "  <rules>\n" +
            PROMPT_DEMAND_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
            "  </rules>\n" +
            `${PROMPT_AGE_MANDATE}\n` +
            "  <output_schema>\n" +
            "    <demand_resolution>\n" +
            "      <summary_line_1>Clear 1-sentence summary of what was scheduled</summary_line_1>\n" +
            "      <summary_line_2>Exact time window and lead-up hook</summary_line_2>\n" +
            "      <schedule>\n" +
            '        <block start="16.0" end="17.0">\n' +
            "          <topic>Scene title</topic>\n" +
            "          <dense_paragraph>2-4 sentence self-contained scene setting detailing the activity and individual character roles without time or sequence dependencies.</dense_paragraph>\n" +
            "          <facts><fact>Concrete context item</fact></facts>\n" +
            "        </block>\n" +
            "      </schedule>\n" +
            "    </demand_resolution>\n" +
            "  </output_schema>\n"+
            "</demand_engine>"
        ));

        if (userMemories.length > 0) {
            promptBuilder.useSystem(() => promptBuilder.part(
                "<user_memories>\n" +
                userMemories.map(m => `  <memory>${XmlEncoder.encode(m)}</memory>`).join("\n") + "\n" +
                "</user_memories>"
            ));
        }

        // Task 4: enrich the demand prompt with FULL cast personas (computed
        // ages + bios) and the live environment context (weather, occasion,
        // headlines) so demanded blocks land in-context.
        const castMembers = this.world.members instanceof Map
            ? [...this.world.members.values()]
            : [];
        if (castMembers.length > 0) {
            promptBuilder.useSystem(() => promptBuilder.part(
                "<cast_profiles>\n" +
                castMembers.map(m => (
                    `  <member id="${XmlEncoder.encode(m.id)}" name="${XmlEncoder.encode(m.name)}" age="${Number(m.age) || 0}">${XmlEncoder.encode(m.about || "")}</member>`
                )).join("\n") +
                "\n</cast_profiles>"
            ));
        }

        const envSnapshot = this.world.environment;
        if (envSnapshot) {
            promptBuilder.useSystem(() => promptBuilder.part(
                "<environment>\n" +
                `  <city>${XmlEncoder.encode(envSnapshot.city || "")}</city>\n` +
                `  <weather temperature="${XmlEncoder.encode(envSnapshot.temperature || "")}">${XmlEncoder.encode(envSnapshot.weather || "")}</weather>\n` +
                `  <occasion>${XmlEncoder.encode(envSnapshot.todayCelebration || "")}</occasion>\n` +
                `  <headlines>${XmlEncoder.encode((envSnapshot.newsHeadlines || []).slice(0, 3).join(" | "))}</headlines>\n` +
                "</environment>"
            ));
        }

        const birthdayPart = this.#buildBirthdayPromptPart();
        if (birthdayPart) {
            promptBuilder.useSystem(() => promptBuilder.part(birthdayPart));
        }

        promptBuilder.useUser(() => promptBuilder.part(
            `<demand_input>\n` +
            `  <text>${XmlEncoder.encode(cleanDemand)}</text>\n` +
            `  <current_time>${XmlEncoder.encode(this.world.date)}, ${XmlEncoder.encode(this.world.time)} (Current Hour: ${currentHour})</current_time>\n` +
            `  <existing_schedule>\n${existingBlocksXml}\n  </existing_schedule>\n` +
            `</demand_input>`
        ));

        const promptPayload = await promptBuilder.build();
        const xmlResponseText = await this.#generatePlannerXml(promptPayload, "demand");

        const line1Match = xmlResponseText.match(/<\s*summary_line_1\b[^>]*>([\s\S]*?)<\/\s*summary_line_1\s*>/i);
        const line2Match = xmlResponseText.match(/<\s*summary_line_2\b[^>]*>([\s\S]*?)<\/\s*summary_line_2\s*>/i);

        const line1 = line1Match ? XmlEncoder.decode(line1Match[1].trim()) : `Scheduled: ${cleanDemand}`;
        const line2 = line2Match ? XmlEncoder.decode(line2Match[1].trim()) : `Timeline updated.`;

        const updatedBlocks = this.#parseXmlScheduleResponse(xmlResponseText, currentHour, cleanDemand)
            .map(b => ({ ...b, type: /** @type {import("./types/World.types").ScheduleType} */ ("once"), source: /** @type {import("./types/World.types").ScheduleSource} */ ("demand") }));

        // Task 4: recurrence keywords in the demand text ("daily",
        // "weekdays", ...) mark the demanded block(s) as recurring — they are
        // registered into the template library when the proposal is accepted.
        const recurrence = WorldSetter.#parseRecurrenceKeyword(cleanDemand);
        if (recurrence) {
            for (const block of updatedBlocks) {
                block.type = recurrence;
            }
        }

        const report = this.#parseNarrativeReport(xmlResponseText);

        const proposal = this.#computeProposal(this.schedule, updatedBlocks);
        proposal.report = report;
        this.pendingProposal = proposal;

        this.isDirty = true;
        this.world.tick(this.world.now);

        return { line1, line2, schedule: this.schedule, report };
    }

    async acceptProposal() {
        if (!this.pendingProposal) return this.schedule;
        this.logger.info(`Accepting proposal: ${this.pendingProposal.summary}`);

        const additions = this.pendingProposal.changes
            .filter(c => c.action === "add")
            .map(c => c.block);
        // Task 4: only blocks FULLY covered by a demanded window are deleted
        // outright — partially overlapping blocks are split/trimmed by the
        // smart splice, preserving the rest of the 24-hour day intact.
        const removalIds = new Set(
            this.pendingProposal.changes
                .filter(c => c.action === "remove")
                .filter(c => additions.some(b => c.block.startHour >= b.startHour && c.block.endHour <= b.endHour))
                .map(c => c.block.id)
        );

        const kept = this.schedule.filter(r => !removalIds.has(r.id));
        this.schedule = additions.length > 0
            ? this.#mergeDemandSchedule(kept, additions)
            : this.#sanitizeAndSortSchedule(kept);

        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.#tagScheduleStatus(this.world?.now instanceof Date ? this.world.now : new Date());

        // Task 4: recurring demands register into the template library.
        for (const block of additions) {
            if (block.type && block.type !== "once") {
                await this.#syncTemplateLibrary(block);
            }
        }

        this.isDirty = false;
        this.pendingProposal = null;

        await this.#persistToday();
        this.world.tick(this.world.now);
        this.logger.info("Proposal accepted and schedule committed.");

        // Task 4: instant chat bridge — when the accepted demand covers the
        // CURRENT hour, world.activeSchedule is already refreshed by tick()
        // above; notify listeners so ConversationManager triggers an
        // in-character cast reaction immediately.
        const nowRef = this.world?.now instanceof Date ? this.world.now : new Date();
        const decimalNow = nowRef.getHours() + nowRef.getMinutes() / 60;
        const activeNow = additions.find(b => b.startHour <= decimalNow && b.endHour > decimalNow);
        if (activeNow && this.world?.events && typeof this.world.events.emit === "function") {
            this.world.events.emit(WorldEvents.DEMAND_APPLIED, activeNow);
        }

        return this.schedule;
    }

    denyProposal() {
        if (!this.pendingProposal) return this.schedule;
        this.logger.info(`Denying proposal: ${this.pendingProposal.summary}`);
        this.pendingProposal = null;
        this.isDirty = false;
        this.world.tick(this.world.now);
        return this.schedule;
    }

    /**
     * @param {ScheduleRecord[]} current
     * @param {ScheduleRecord[]} proposed
     * @returns {ScheduleProposal}
     */
    #computeProposal(current, proposed) {
        /** @type {ProposedChange[]} */
        const changes = [];
        for (const block of proposed) {
            const isExisting = current.some(
                r => r.topic === block.topic && Math.abs(r.startHour - block.startHour) < 0.5
            );
            if (!isExisting) changes.push({ action: "add", block });
        }
        // Task 4: only blocks that actually OVERLAP a demanded window are
        // marked for removal — the rest of the day stays untouched instead of
        // being wholesale deleted whenever the model omits an echo.
        const proposedAdds = changes.filter(c => c.action === "add").map(c => c.block);
        for (const block of current) {
            const isOverlapped = proposedAdds.some(
                b => block.startHour < b.endHour && block.endHour > b.startHour
            );
            if (isOverlapped) changes.push({ action: "remove", block });
        }
        const addCount = changes.filter(c => c.action === "add").length;
        const removeCount = changes.filter(c => c.action === "remove").length;
        const summary = changes.length > 0
            ? `${addCount} new block(s) proposed, ${removeCount} block(s) to remove.`
            : "No changes proposed.";
        return { id: crypto.randomUUID(), changes, summary, createdAt: Date.now() };
    }

    async discardManualChanges() {
        try {
            const raw = await this.storage.getItem(TODAY_STORAGE_KEY);
            if (Array.isArray(raw)) {
                this.schedule = this.#sanitizeAndSortSchedule(
                    raw.filter(this.#isValidRecord).map(r => this.#withDerivedFields(/** @type {ScheduleRecord} */ (r)))
                );
            }
        } catch (err) {
            this.logger.warn("Failed to reload schedule from storage:", err);
        }
        this.isDirty = false;
        this.world.tick(this.world.now);
        return this.schedule;
    }

    async restabilizeAndSave() {
        if (!this.isDirty) {
            return { success: true, message: "Schedule is already stable. Saving directly.", schedule: this.schedule };
        }

        this.logger.info("Starting AI-assisted stabilization...");

        try {
            const promptBuilder = new PromptBuilderClass();

            promptBuilder.useSystem(() => promptBuilder.part(
                "<restabilizer_instruction>\n" +
                `  <task>${PROMPT_RESTABILIZER_TASK}</task>\n` +
                "  <rules>\n" +
                PROMPT_RESTABILIZER_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
                "  </rules>\n" +
                `${PROMPT_AGE_MANDATE}\n` +
                '  <output_format>Output strictly &lt;schedule&gt;&lt;block start="..." end="..."&gt;&lt;topic&gt;...&lt;/topic&gt;&lt;dense_paragraph&gt;...&lt;/dense_paragraph&gt;&lt;facts&gt;...&lt;/facts&gt;&lt;/block&gt;&lt;/schedule&gt; XML tags. Every block MUST include a self-contained &lt;dense_paragraph&gt; independent of other blocks.</output_format>\n' +
                "</restabilizer_instruction>"
            ));

            const blocksXml = this.schedule.map(b => (
                `  <block start=\"${b.startHour}\" end=\"${b.endHour}\">\n` +
                `    <topic>${XmlEncoder.encode(b.topic)}</topic>\n` +
                `    <dense_paragraph>${XmlEncoder.encode(b.denseParagraph || b.mainGoal || "")}</dense_paragraph>\n` +
                `    <facts>${b.facts.map(f => `<fact>${XmlEncoder.encode(f)}</fact>`).join("")}</facts>\n` +
                `  </block>`
            )).join("\n");

            promptBuilder.useUser(() => promptBuilder.part(
                `<schedule>\n${blocksXml}\n</schedule>`
            ));

            const promptPayload = await promptBuilder.build();
            const xmlResponseText = await this.#generatePlannerXml(promptPayload, "stabilizer");

            const startHour = this.schedule.length > 0 ? this.schedule[0].startHour : 0;
            const stabilizedBlocks = this.#parseXmlScheduleResponse(xmlResponseText, startHour)
                .map(r => ({ ...r, source: /** @type {import("./types/World.types").ScheduleSource} */ ("horizon") }));

            const validationErrors = this.#validateStabilizedSchedule(stabilizedBlocks);

            if (validationErrors.length > 0) {
                this.logger.warn(`Stabilization validation failed with ${validationErrors.length} error(s):`, validationErrors);
                return {
                    success: false,
                    message: `AI stabilization produced invalid schedule: ${validationErrors[0]}`,
                    errors: validationErrors
                };
            }

            this.schedule = this.#sanitizeAndSortSchedule(stabilizedBlocks);
            this.isDirty = false;
            await this.#persistToday();
            this.world.tick(this.world.now);

            this.logger.info(`Stabilization complete. ${this.schedule.length} blocks persisted.`);
            return { success: true, message: `Stabilized and saved ${this.schedule.length} blocks.`, schedule: this.schedule };

        } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            this.logger.error("Stabilization failed:", err);
            return {
                success: false,
                message: `Stabilization error: ${errMsg}. Schedule remains unsaved.`,
                errors: [errMsg]
            };
        }
    }

    /**
     * @param {ScheduleRecord[]} blocks
     * @returns {string[]}
     */
    #validateStabilizedSchedule(blocks) {
        /** @type {string[]} */
        const errors = [];

        if (!Array.isArray(blocks) || blocks.length === 0) {
            errors.push("Stabilized schedule is empty.");
            return errors;
        }

        const sorted = [...blocks].sort((a, b) => a.startHour - b.startHour);

        for (let i = 0; i < sorted.length; i++) {
            const block = sorted[i];

            if (block.startHour >= block.endHour) {
                errors.push(`Block "${block.topic}" has invalid time range (${block.startHour} >= ${block.endHour}).`);
            }

            if (i > 0 && block.startHour < sorted[i - 1].startHour) {
                errors.push(`Block "${block.topic}" starts before previous block — not chronological.`);
            }

            if (i > 0 && block.startHour < sorted[i - 1].endHour) {
                errors.push(`Block "${block.topic}" overlaps with "${sorted[i - 1].topic}" (${block.startHour} < ${sorted[i - 1].endHour}).`);
            }

            if (!block.topic || block.topic.trim().length === 0) {
                errors.push(`Block at ${block.startHour} has empty topic.`);
            }
        }

        return errors;
    }

    async directSave() {
        if (this.isDirty) {
            this.logger.warn("Direct save blocked: schedule is dirty. Use restabilizeAndSave() instead.");
            throw new Error("Schedule has unsaved manual changes. Please use 'Stabilize & Save' to validate and persist.");
        }
        await this.#persistToday();
        this.world.tick(this.world.now);
        this.logger.info("Direct save completed (schedule was stable).");
        return this.schedule;
    }

    /**
     * Resolves the block covering the given moment. When no block matches
     * (e.g. 06:30 AM with only night blocks left in the horizon), returns a
     * dynamic ad-hoc block for the CURRENT hour instead of falling back to
     * `schedule[0]` — which could hand a morning scene a 21:00 night block.
     *
     * @param {Date} [date=new Date()]
     * @returns {ScheduleRecord|null}
     */
    getActiveRecord(date = new Date()) {
        const decimalHour = date.getHours() + (date.getMinutes() / 60);
        for (const record of this.schedule) {
            if (decimalHour >= record.startHour && decimalHour < record.endHour) {
                return record;
            }
        }

        // Dynamic ad-hoc block matching the current hour instead of a mismatched block
        const startH = Math.floor(decimalHour);
        const endH = startH + 1;
        return {
            id: "ad-hoc-current",
            startHour: startH,
            endHour: endH,
            timeRange: `${String(startH).padStart(2, "0")}:00 - ${String(endH).padStart(2, "0")}:00`,
            topic: startH < 12 ? "Morning routine & start of day" : "Casual hangout & conversations",
            mainGoal: "Chat naturally",
            characterGoals: [],
            facts: [],
            prePlot: "",
            postPlot: "",
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    getRecords() {
        return [...this.schedule];
    }

    /**
     * @param {Partial<ScheduleRecord>} recordData
     * @returns {Promise<ScheduleRecord>}
     */
    async createRecord(recordData) {
        const sHour = Math.max(0, Math.min(23.5, Number(recordData.startHour)));
        const eHour = Math.max(sHour + 0.5, Math.min(24, Number(recordData.endHour)));

        /** @type {ScheduleRecord} */
        const newRecord = this.#withDerivedFields({
            id: crypto.randomUUID(),
            startHour: sHour,
            endHour: eHour,
            timeRange: this.#formatDecimalRange(sHour, eHour),
            topic: String(recordData.topic || "Casual conversation").trim(),
            title: String(recordData.title || recordData.topic || "Casual conversation").trim(),
            denseParagraph: recordData.denseParagraph ? String(recordData.denseParagraph).trim() : "",
            type: String(recordData.type || "once").trim() || "once",
            source: "user",
            mainGoal: String(recordData.mainGoal || "Hang out together").trim(),
            characterGoals: Array.isArray(recordData.characterGoals) ? recordData.characterGoals : [],
            facts: Array.isArray(recordData.facts) ? recordData.facts.map(String).filter(Boolean) : [],
            prePlot: recordData.prePlot || "Friends chatting casually",
            postPlot: recordData.postPlot || "Transitioning to next activity",
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        this.schedule.push(newRecord);
        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = true;

        await this.#syncTemplateLibrary(newRecord);
        await this.#persistToday();
        this.world.tick(this.world.now);

        this.logger.info(`User created schedule block: "${newRecord.topic}" [${newRecord.timeRange}]`);
        return newRecord;
    }

    /**
     * @param {string} id
     * @param {Partial<ScheduleRecord>} updates
     * @returns {Promise<ScheduleRecord|null>}
     */
    async updateRecord(id, updates) {
        const record = this.schedule.find(r => r.id === id);
        if (!record) return null;

        this.#applyUpdates(record, updates);
        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = true;

        // Recurrence change ⇄ template library (non-destructive for today).
        await this.#syncTemplateLibrary(record);
        await this.#persistToday();
        this.world.tick(this.world.now);

        return record;
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteRecord(id) {
        const initialLen = this.schedule.length;
        this.schedule = this.schedule.filter(r => r.id !== id);

        if (this.schedule.length === initialLen) return false;

        this.isDirty = true;
        await this.#persistToday();
        this.world.tick(this.world.now);
        return true;
    }

    /**
     * Deletes ONLY today's placed instance of a block. When the block is a
     * recurring template rule, the permanent rule in the template library
     * (`world:schedule_templates`) is KEPT — it will re-place itself on
     * future days, but stays suppressed for the remainder of today (Task 3).
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteTodayInstance(id) {
        const isRecurringRule = this.templates.some(t => t.id === id);
        if (isRecurringRule) {
            // Keep the permanent template; suppress only today's placement.
            this.suppressedTodayIds.add(id);
        }

        const removed = await this.deleteRecord(id);
        if (removed) {
            this.logger.info(`Deleted today's instance of "${id}"${isRecurringRule ? " (recurring template rule preserved)" : ""}.`);
        }
        return removed;
    }

    /**
     * @param {string} rawResponse
     * @param {number} startHour
     * @param {string} [fallbackTopic]
     * @returns {ScheduleRecord[]}
     */
    #parseXmlScheduleResponse(rawResponse, startHour, fallbackTopic = "") {
        const { cleanText } = ProtocolCodec.extractThinkingChain(rawResponse);

        /** @type {ScheduleRecord[]} */
        const records = [];
        const blockRegex = /<\s*(?:block|schedule_block|item)\b([^>]*)>([\s\S]*?)<\/\s*(?:block|schedule_block|item)\s*>/gi;
        let match;
        let index = 0;

        while ((match = blockRegex.exec(cleanText)) !== null) {
            const rawAttrs = match[1] || "";
            const content = match[2] || "";

            const startAttr = rawAttrs.match(/(?:start|start_hour|from|startHour)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
            const endAttr = rawAttrs.match(/(?:end|end_hour|to|endHour)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);

            const startTagMatch = content.match(/<\s*(?:start|start_hour|from)\b[^>]*>([\s\S]*?)<\/\s*(?:start|start_hour|from)\s*>/i);
            const endTagMatch = content.match(/<\s*(?:end|end_hour|to)\b[^>]*>([\s\S]*?)<\/\s*(?:end|end_hour|to)\s*>/i);

            const sVal = startAttr ? (startAttr[1] || startAttr[2] || startAttr[3]) : (startTagMatch ? startTagMatch[1].trim() : null);
            const eVal = endAttr ? (endAttr[1] || endAttr[2] || endAttr[3]) : (endTagMatch ? endTagMatch[1].trim() : null);

            const sHourRaw = (sVal !== null && Number.isFinite(Number(sVal))) ? Number(sVal) : (startHour + index);
            const eHourRaw = (eVal !== null && Number.isFinite(Number(eVal))) ? Number(eVal) : sHourRaw + 1;
            const sHour = this.#clampHour(sHourRaw);
            const eHour = this.#clampHour(eHourRaw) > sHour ? this.#clampHour(eHourRaw) : Math.min(24, sHour + 1);

            const topicMatch = content.match(/<\s*(?:topic|title|name)\b[^>]*>([\s\S]*?)<\/\s*(?:topic|title|name)\s*>/i);
            const mainGoalMatch = content.match(/<\s*main\b[^>]*>([\s\S]*?)<\/\s*main\s*>/i)
                || content.match(/<\s*main_goal\b[^>]*>([\s\S]*?)<\/\s*main_goal\s*>/i)
                || content.match(/<\s*goal\b[^>]*>([\s\S]*?)<\/\s*goal\s*>/i);
            const preMatch = content.match(/<\s*pre_plot\b[^>]*>([\s\S]*?)<\/\s*pre_plot\s*>/i);
            const postMatch = content.match(/<\s*post_plot\b[^>]*>([\s\S]*?)<\/\s*post_plot\s*>/i);
            const denseMatch = content.match(/<\s*(?:dense_paragraph|scene_paragraph|scene)\b[^>]*>([\s\S]*?)<\/\s*(?:dense_paragraph|scene_paragraph|scene)\s*>/i);

            const topic = topicMatch ? topicMatch[1].trim() : (fallbackTopic || "Afternoon hangout & plans");
            const mainGoal = mainGoalMatch ? mainGoalMatch[1].trim() : "Banter and share daily news";
            const prePlot = preMatch ? preMatch[1].trim() : "Friends hanging out together";
            const postPlot = postMatch ? postMatch[1].trim() : "Winding down to next activity";

            /** @type {CharacterGoalRecord[]} */
            const characterGoals = [];
            const charGoalRegex = /<\s*goal\s+id="([^"]*)"(?:\s+name="([^"]*)")?[^>]*>([\s\S]*?)<\/\s*goal\s*>/gi;
            let cgMatch;
            while ((cgMatch = charGoalRegex.exec(content)) !== null) {
                const id = cgMatch[1].trim().toLowerCase();
                const name = (cgMatch[2] || id).trim();
                const goal = cgMatch[3].trim();
                if (id && goal) {
                    characterGoals.push({ id, name: XmlEncoder.decode(name), goal: XmlEncoder.decode(goal) });
                }
            }

            /** @type {string[]} */
            const facts = [];
            const factRegex = /<\s*fact\b[^>]*>([\s\S]*?)<\/\s*fact\s*>/gi;
            let factMatch;
            while ((factMatch = factRegex.exec(content)) !== null) {
                const f = factMatch[1].trim();
                if (f) facts.push(XmlEncoder.decode(f));
            }

            records.push(this.#withDerivedFields({
                id: crypto.randomUUID(),
                startHour: sHour,
                endHour: eHour,
                timeRange: this.#formatDecimalRange(sHour, eHour),
                topic: XmlEncoder.decode(topic),
                denseParagraph: denseMatch ? XmlEncoder.decode(denseMatch[1].trim()) : "",
                mainGoal: XmlEncoder.decode(mainGoal),
                characterGoals,
                prePlot: XmlEncoder.decode(prePlot),
                postPlot: XmlEncoder.decode(postPlot),
                facts: facts.length > 0 ? facts : ["Enjoying local snacks together"],
                createdAt: Date.now(),
                updatedAt: Date.now()
            }));

            index++;
        }

        if (records.length === 0) {
            this.logger.warn("Zero XML blocks matched. Synthesizing fallback block.");
            const fbEnd = this.#clampHour(startHour + 1);
            records.push(this.#withDerivedFields({
                id: crypto.randomUUID(),
                startHour,
                endHour: fbEnd,
                timeRange: this.#formatDecimalRange(startHour, fbEnd),
                topic: fallbackTopic || "Daily hangout & conversation",
                mainGoal: "Pursue active goals and conversation",
                characterGoals: [],
                prePlot: "Friends hanging out in the space",
                postPlot: "Transitioning to upcoming project",
                facts: ["Activity in progress"],
                createdAt: Date.now(),
                updatedAt: Date.now()
            }));
        }

        return records;
    }

    /**
     * @param {string} rawResponse
     * @returns {DemandReport}
     */
    #parseNarrativeReport(rawResponse) {
        const { cleanText } = ProtocolCodec.extractThinkingChain(rawResponse);

        const reportMatch = cleanText.match(/<\s*narrative_report\b[^>]*>([\s\S]*?)<\/\s*narrative_report\s*>/i);
        const reportContent = reportMatch ? reportMatch[1] : "";

        const summaryMatch = reportContent.match(/<\s*summary\b[^>]*>([\s\S]*?)<\/\s*summary\s*>/i);
        const summary = summaryMatch
            ? XmlEncoder.decode(summaryMatch[1].trim())
            : "Schedule updated with the requested activity.";

        const continuityMatch = reportContent.match(/<\s*continuity_impact\b[^>]*>([\s\S]*?)<\/\s*continuity_impact\s*>/i);
        const continuityImpact = continuityMatch
            ? XmlEncoder.decode(continuityMatch[1].trim())
            : undefined;

        /** @type {import("./types/World.types").CharacterShiftRecord[]} */
        const characterShifts = [];
        const shiftsBlockMatch = reportContent.match(/<\s*character_shifts\b[^>]*>([\s\S]*?)<\/\s*character_shifts\s*>/i);
        if (shiftsBlockMatch) {
            const shiftRegex = /<\s*shift\s+id="([^"]*)"(?:\s+name="([^"]*)")?[^>]*>([\s\S]*?)<\/\s*shift\s*>/gi;
            let shiftMatch;
            while ((shiftMatch = shiftRegex.exec(shiftsBlockMatch[1])) !== null) {
                const id = shiftMatch[1].trim().toLowerCase();
                const name = (shiftMatch[2] || id).trim();
                const motivation = XmlEncoder.decode(shiftMatch[3].trim());
                if (id && motivation) {
                    characterShifts.push({ id, name, motivation });
                }
            }
        }

        const hooksMatch = reportContent.match(/<\s*transition_hooks\b[^>]*>([\s\S]*?)<\/\s*transition_hooks\s*>/i);
        const transitionHooks = hooksMatch
            ? XmlEncoder.decode(hooksMatch[1].trim())
            : undefined;

        return {
            summary,
            continuityImpact: continuityImpact || undefined,
            characterShifts: characterShifts.length > 0 ? characterShifts : undefined,
            transitionHooks: transitionHooks || undefined
        };
    }

    /**
     * Smart interval splicing (Task 4): inserts demanded blocks into the
     * existing day, splitting or trimming ONLY the overlapping window of an
     * existing block and preserving the rest of the 24-hour day intact.
     *
     * @param {ScheduleRecord[]} existing
     * @param {ScheduleRecord[]} modified Demanded blocks to splice in.
     * @returns {ScheduleRecord[]}
     */
    #mergeDemandSchedule(existing, modified) {
        if (!Array.isArray(modified) || modified.length === 0) return existing;
        if (!Array.isArray(existing) || existing.length === 0) return this.#sanitizeAndSortSchedule(modified);

        /** @type {ScheduleRecord[]} */
        const merged = existing.map(r => ({ ...r }));

        for (const block of modified) {
            /** @type {ScheduleRecord[]} */
            const next = [];

            for (const orig of merged) {
                const overlaps = block.startHour < orig.endHour && block.endHour > orig.startHour;
                if (!overlaps) {
                    next.push(orig);
                    continue;
                }

                // Left remainder: the existing block trimmed to end where the
                // demanded window starts.
                if (orig.startHour < block.startHour - 0.01) {
                    next.push({
                        ...orig,
                        endHour: block.startHour,
                        timeRange: this.#formatDecimalRange(orig.startHour, block.startHour),
                        updatedAt: Date.now()
                    });
                }
                // Right remainder: the existing block trimmed to start where
                // the demanded window ends (fresh id — it is a new record).
                if (orig.endHour > block.endHour + 0.01) {
                    next.push({
                        ...orig,
                        id: crypto.randomUUID(),
                        startHour: block.endHour,
                        timeRange: this.#formatDecimalRange(block.endHour, orig.endHour),
                        updatedAt: Date.now()
                    });
                }
            }

            next.push({ ...block });
            merged.length = 0;
            merged.push(...next);
        }

        return this.#sanitizeAndSortSchedule(merged);
    }

    /**
     * Detects recurrence keywords in raw demand text (Task 4), e.g.
     * "daily", "every day", "weekdays", "weekends".
     *
     * @param {string} demandText
     * @returns {import("./types/World.types").ScheduleType|null} Recurrence type or null for one-off demands.
     */
    static #parseRecurrenceKeyword(demandText) {
        const t = String(demandText || "").toLowerCase();
        if (/\bweekdays?\b|\bmonday|\btuesday|\bwednesday|\bthursday|\bfriday/.test(t)) return "weekdays";
        if (/\bweekends?\b|\bsaturday|\bsunday/.test(t)) return "weekends";
        if (/\bdaily\b|\bevery\s*day\b|\beveryday\b|\brozana\b|\bhamesha\b/.test(t)) return "forever";
        return null;
    }

    /**
     * @param {ScheduleRecord[]} records
     * @returns {ScheduleRecord[]}
     */
    #sanitizeAndSortSchedule(records) {
        if (!Array.isArray(records) || records.length === 0) return [];

        const sorted = [...records].sort((a, b) => a.startHour - b.startHour);
        /** @type {ScheduleRecord[]} */
        const sanitized = [];
        let lastEnd = 0;

        for (const r of sorted) {
            let sHour = this.#clampHour(Math.max(lastEnd, r.startHour));
            let eHour = this.#clampHour(Math.max(sHour + 0.5, r.endHour));
            if (eHour <= sHour) eHour = Math.min(24, sHour + 1);

            r.startHour = sHour;
            r.endHour = eHour;
            r.timeRange = this.#formatDecimalRange(sHour, eHour);

            lastEnd = eHour;
            sanitized.push(r);
        }

        return sanitized;
    }

    /**
     * @param {number} start
     * @param {number} end
     * @returns {string}
     */
    #formatDecimalRange(start, end) {
        // Task 2: minute-overflow safe — 14.999 renders "15:00", never
        // "14:60"; midnight wraps to "24:00", never "00:00"+1.
        const fmt = (/** @type {number} */ val) => {
            let h = Math.floor(val);
            let m = Math.round((val - h) * 60);
            if (m >= 60) { h += 1; m = 0; }
            if (h >= 24) { h = 24; m = 0; }
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        };
        return `${fmt(start)} - ${fmt(end)}`;
    }

    /**
     * Clamps a decimal hour into the [0, 24] day window and rounds it to the
     * nearest half hour. Values past midnight are CLAMPED (24.5 → 24), never
     * wrapped around to the next morning (Task 2 — midnight wrap-around fix).
     *
     * @param {number} h
     * @returns {number}
     */
    #clampHour(h) {
        if (!Number.isFinite(h)) return 0;
        let clamped = Math.max(0, Math.min(24, h));
        return Math.round(clamped * 2) / 2;
    }

    /**
     * @param {number} startHour
     * @returns {ScheduleRecord[]}
     */
    #buildFallbackSchedule(startHour) {
        const topics = [
            { topic: "Creative project discussion", mainGoal: "Brainstorm new concepts", facts: ["Fresh notebook and markers on the table"] },
            { topic: "Evening break & discussion", mainGoal: "Relax and discuss local city events", facts: ["Sharing local street snacks"] },
            { topic: "Weekend sports challenge", mainGoal: "Organize teams for outdoor games", facts: ["Checking equipment availability"] },
            { topic: "Evening entertainment session", mainGoal: "Pick a movie or comedy show", facts: ["Setting up screen and snacks"] }
        ];

        /** @type {ScheduleRecord[]} */
        const records = [];

        for (let i = 0; i < 4; i++) {
            const s = this.#clampHour(startHour + i);
            if (s >= 24) break; // Task 2: never wrap fallback blocks past midnight
            const e = Math.min(24, s + 1);
            const t = topics[i % topics.length];

            records.push({
                id: crypto.randomUUID(),
                startHour: s,
                endHour: e,
                timeRange: this.#formatDecimalRange(s, e),
                topic: t.topic,
                mainGoal: t.mainGoal,
                characterGoals: [],
                prePlot: "Friends chatting casually",
                postPlot: "Transitioning to upcoming activity",
                facts: t.facts,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }

        return records;
    }

    /**
     * Swaps the TIME SLOTS of exactly the affected pair (index & targetIndex).
     * Unrelated afternoon/evening blocks keep their exact times — there is NO
     * cascade re-timing across the whole day (Task 3). Block identity stays
     * bound to `record.id` throughout.
     *
     * @param {number} index
     * @param {'up'|'down'} direction
     * @returns {ScheduleRecord[]}
     */
    reorderBlocks(index, direction) {
        if (index < 0 || index >= this.schedule.length) return this.schedule;

        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= this.schedule.length) return this.schedule;

        const record = this.schedule[index];
        const target = this.schedule[targetIndex];

        // Swap only the two blocks' time slots — every other block is untouched.
        const prevStart = record.startHour;
        const prevEnd = record.endHour;
        record.startHour = target.startHour;
        record.endHour = target.endHour;
        target.startHour = prevStart;
        target.endHour = prevEnd;
        record.timeRange = this.#formatDecimalRange(record.startHour, record.endHour);
        target.timeRange = this.#formatDecimalRange(target.startHour, target.endHour);
        record.updatedAt = Date.now();
        target.updatedAt = Date.now();

        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.#tagScheduleStatus(this.world?.now instanceof Date ? this.world.now : new Date());
        // Free reordering: persisted directly, NO AI stabilizer round-trip.
        this.isDirty = false;
        void this.#persistToday();

        this.world.tick(this.world.now);
        this.logger.info(`Reordered block "${record.id}": swapped time slots with "${target.id}" (index ${index} → ${targetIndex}).`);

        return this.schedule;
    }

    /**
     * Id-addressed reorder (Task 3 — binds reorders strictly to record.id).
     *
     * @param {string} id
     * @param {'up'|'down'} direction
     * @returns {ScheduleRecord[]}
     */
    reorderBlocksById(id, direction) {
        const index = this.schedule.findIndex(r => r.id === id);
        if (index === -1) return this.schedule;
        return this.reorderBlocks(index, direction);
    }

    /**
     * @param {unknown} record
     * @returns {boolean}
     */
    #isValidRecord(record) {
        const r = /** @type {Record<string, unknown>} */ (record);
        return (
            !!r && typeof r === "object" &&
            typeof r.id === "string" &&
            typeof r.startHour === "number" &&
            typeof r.endHour === "number" &&
            typeof r.topic === "string" &&
            typeof r.mainGoal === "string" &&
            Array.isArray(r.facts)
        );
    }
}