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
 * @typedef {import("./lib/PromptLogger").PromptType} PromptType
 */

import GeminiClient from "./GeminiClient";
import GeminiModelPool from "./lib/GeminiModelResolver";
import PromptBuilderClass from "./PromptBuilder";
import Storage from "./lib/Storage";
import ProtocolCodec from "./ProtocolCodec";
import XmlEncoder from "./lib/XmlEncoder";
import { getEnvironmentSnapshot } from "../util/environment";
import {
    DEFAULT_GEMINI_MODEL,
    GEMINI_MAX_OUTPUT_TOKENS,
    PROMPT_SCHEDULER_TASK,
    PROMPT_SCHEDULER_RULES,
    PROMPT_DEMAND_TASK,
    PROMPT_DEMAND_RULES,
    PROMPT_RESTABILIZER_TASK,
    PROMPT_RESTABILIZER_RULES
} from "../util/Constants";

const SCHEDULE_STORAGE_KEY = "world:schedule_v2";

/** @readonly @type {number} Minimum gap between stream progress parses (ms). */
const STREAM_PROGRESS_DEBOUNCE_MS = 150;

/**
 * Planner stream event identifiers emitted during real-time schedule generation.
 * @readonly
 * @enum {string}
 */
export const PlannerStreamEvents = {
    /** Stream generation started. */
    START: "planner:stream:start",
    /** A new raw text chunk arrived from the model. */
    TEXT: "planner:stream:text",
    /** A complete <block> has been parsed from the stream. */
    BLOCK: "planner:stream:block",
    /** The active Gemini model failed and the pool rotated to the next one. */
    FAILOVER: "planner:stream:failover",
    /** The <schedule> generation is complete. */
    DONE: "planner:stream:done",
    /** Stream generation failed. */
    ERROR: "planner:stream:error"
};

/**
 * Hybrid World & Horizon Controller.
 * Uses the dynamic Gemini Model Pool for full-timeline normalization and
 * demand processing. Gemini is the ONLY provider the planner may call — when
 * every pool model fails it degrades to the local synthetic schedule
 * generator instead of crossing over to another provider.
 */
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

        /** Dynamic, self-healing Gemini model pool (discovery + cooldown). */
        this.modelPool = new GeminiModelPool(this.logger);

        /** @readonly @type {GeminiClient} */ this.geminiClient = new GeminiClient({
            logger: this.logger,
            defaultModel: DEFAULT_GEMINI_MODEL,
            modelPool: this.modelPool
        });

        /** @type {ScheduleRecord[]} */ this.schedule = [];
        /** @type {boolean} */ this.isDirty = false;
        /** @type {boolean} */ this.isPlanning = false;
        /** @type {ScheduleProposal | null} */ this.pendingProposal = null;
    }

    /**
     * Throttled stream parsing state. Global regex extraction never runs on
     * individual token chunks — only on a completed `</block>` arrival, a
     * 150ms debounce, or the terminal flush.
     * @type {{ lastEmitAt: number, emittedBlocks: number }}
     */
    #streamProgress = { lastEmitAt: 0, emittedBlocks: 0 };

    /**
     * Executes planner queries by cascading across the dynamic Gemini Model
     * Pool. Groq is NEVER used here — if every pool model fails, the error
     * propagates so callers can drop to `#buildFallbackSchedule()`.
     *
     * @param {import("./PromptBuilder").PromptPayload} promptPayload
     * @param {PromptType} promptType
     * @returns {Promise<string>}
     */
    async #generatePlannerXml(promptPayload, promptType) {
        /** @type {Set<Function>} */ 
        const cleanups = new Set();

        let rawText = "";

        // Internal: hook into the active client TEXT event to parse blocks in real-time
        const onChunk = (/** @type {string} */ chunk) => {
            rawText += chunk;
            this.#emitStreamProgress(rawText, chunk);
        };
        cleanups.add(this.geminiClient.events.on("text", onChunk, "PlannerStream:text"));

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
                    this.logger.debug(`Dispatching "${promptType}" to Gemini model "${model}" (${i + 1}/${candidates.length})...`);

                    const result = await this.geminiClient.streamGenerate(promptPayload.messages, {
                        temperature: 0.7,
                        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
                        promptType,
                        model
                    });

                    rawText = result.text;
                    this.modelPool.reportSuccess(model);
                    return result.text;
                } catch (/** @type {unknown} */ genError) {
                    const err = /** @type {Error & {status?: number, code?: string}} */ (genError);
                    lastError = err;

                    if (err instanceof DOMException && err.name === "AbortError") throw err;

                    // Circuit breaker rejections are provider-wide, not model-specific.
                    const isCircuitOpen = err.code === "CIRCUIT_OPEN";
                    const status = typeof err.status === "number" ? err.status : null;
                    if (!isCircuitOpen) this.modelPool.reportFailure(model, status);

                    const reason = isCircuitOpen
                        ? "Circuit breaker open"
                        : status === null ? "Timed out" : `HTTP ${status}`;
                    const next = candidates[i + 1];

                    this.logger.warn(`Gemini model "${model}" failed (${reason}). ${next ? `Switching to "${next.id}"...` : "No alternate model left."}`);

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

            const message = `All ${candidates.length} Gemini model(s) failed for "${promptType}": ${lastError?.message || lastError || "unknown error"}`;
            this.logger.error(message);
            events.emit(PlannerStreamEvents.ERROR, { promptType, error: message });
            throw new Error(message);
        } finally {
            // Clean up all TEXT listeners
            for (const off of cleanups) off();
            cleanups.clear();
            // Emit final progress to flush any remaining blocks
            this.#emitStreamProgress(rawText, "", true);
            events.emit(PlannerStreamEvents.DONE, { promptType, rawText });
        }
    }

    /**
     * Resolves the current active Gemini model stack from the pool.
     * Never throws — an empty array means "fall back to the local generator".
     *
     * @returns {Promise<import("./lib/GeminiModelResolver").GeminiModelEntry[]>}
     */
    async #resolveModelCandidates() {
        try {
            return await this.modelPool.getCandidates();
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Gemini model pool discovery failed:", err);
            return [];
        }
    }

    /** Resets throttled stream parsing state. @returns {void} */
    #resetStreamProgress() {
        this.#streamProgress = { lastEmitAt: 0, emittedBlocks: 0 };
    }

    /**
     * Parses accumulated stream text for <block> boundaries and emits BLOCK
     * events for each complete block detected.
     *
     * Extraction is throttled: it only runs when a closing `</block>` tag
     * arrives in the chunk, when the 150ms debounce elapses, or on the terminal
     * flush — never on every single token.
     *
     * @param {string} accumulated Full accumulated stream text.
     * @param {string} [chunk=""] Raw chunk that triggered this call.
     * @param {boolean} [force=false] Force a parse/emit (terminal flush).
     */
    #emitStreamProgress(accumulated, chunk = "", force = false) {
        const now = Date.now();
        const closedBlockArrived = /<\/\s*block\s*>/i.test(chunk);
        const debounced = now - this.#streamProgress.lastEmitAt >= STREAM_PROGRESS_DEBOUNCE_MS;

        if (!force && !closedBlockArrived && !debounced) return;
        this.#streamProgress.lastEmitAt = now;

        const events = this.world.events;

        // Emit raw text for consumers that want it (throttled)
        events.emit(PlannerStreamEvents.TEXT, accumulated);

        // Scan for complete <block>...</block> tags (deduped across calls)
        const blockRegex = /<\s*block\b[^>]*>([\s\S]*?)<\/\s*block\s*>/gi;
        let match;
        let matchIndex = 0;

        while ((match = blockRegex.exec(accumulated)) !== null) {
            const rawBlock = match[0];
            const content = match[1];

            // Skip blocks that were already emitted in a previous pass
            if (matchIndex++ < this.#streamProgress.emittedBlocks) continue;
            this.#streamProgress.emittedBlocks++;

            // Parse the block into a ScheduleRecord-like object
            const startAttr = rawBlock.match(/start\s*=\s*["']([^"']+)["']/);
            const endAttr = rawBlock.match(/end\s*=\s*["']([^"']+)["']/);
            const topicMatch = content.match(/<\s*topic\b[^>]*>([\s\S]*?)<\/\s*topic\s*>/i);
            const mainGoalMatch = content.match(/<\s*main\b[^>]*>([\s\S]*?)<\/\s*main\s*>/i);

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

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initializes WorldSetter, restores persisted schedule, and fetches environmental data.
     * @returns {Promise<ScheduleRecord[]>}
     */
    async init() {
        this.logger.info("Initializing WorldSetter and restoring schedule...");

        try {
            const raw = await this.storage.getItem(SCHEDULE_STORAGE_KEY);
            if (Array.isArray(raw)) {
                this.schedule = this.#sanitizeAndSortSchedule(raw.filter(this.#isValidRecord));
                this.logger.info(`Restored ${this.schedule.length} schedule records from storage.`);
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to load schedule from storage:", err);
        }

        try {
            const envSnapshot = await getEnvironmentSnapshot();
            this.world.environment = envSnapshot;
            this.logger.info(`Environmental data loaded: ${envSnapshot.todayCelebration}`);
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to fetch live environment data, using defaults:", err);
        }

        return this.schedule;
    }

    // =========================================================================
    // SCHEDULE HORIZON
    // =========================================================================

    /**
     * Ensures valid schedule records exist covering the next 4 hours.
     * @param {Date} [now=new Date()]
     * @returns {Promise<ScheduleRecord[]>}
     */
    async ensureSchedule(now = new Date()) {
        const currentDecimalHour = now.getHours() + (now.getMinutes() / 60);

        const prevLen = this.schedule.length;
        this.schedule = this.schedule.filter(rec => rec.endHour > currentDecimalHour);
        if (this.schedule.length < prevLen) {
            this.logger.info(`Pruned ${prevLen - this.schedule.length} expired schedule blocks (endHour <= ${currentDecimalHour.toFixed(2)}).`);
        }
        const hasUpcomingCoverage = this.schedule.some(rec => rec.endHour >= currentDecimalHour + 3);

        if (!hasUpcomingCoverage && !this.isPlanning) {
            this.logger.info("Schedule horizon < 3 hours. Generating next horizon...");
            await this.planHorizon(now);
        }

        // Background env refresh (fire-and-forget)
        getEnvironmentSnapshot().then(snapshot => {
            this.world.environment = snapshot;
        }).catch(() => {});

        return this.schedule;
    }

    /**
     * Generates a natural storyline schedule horizon using streaming.
     * @param {Date} date
     * @returns {Promise<ScheduleRecord[]>}
     */
    async planHorizon(date) {
        if (this.isPlanning) return this.schedule;

        this.isPlanning = true;
        this.logger.info(`Generating streaming horizon schedule starting from ${date.toLocaleTimeString()}...`);

        try {
            const promptBuilder = new PromptBuilderClass();
            const startHour = date.getHours();

            promptBuilder.useSystem(() => promptBuilder.part(
                "<scheduler_instruction>\n" +
                `  <task>${PROMPT_SCHEDULER_TASK}</task>\n` +
                "  <rules>\n" +
                PROMPT_SCHEDULER_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
                "  </rules>\n" +
                "  <output_schema>\n" +
                "    <schedule>\n" +
                '      <block start="14.0" end="15.5">\n' +
                "        <topic>Humorous discussion topic in authentic Hinglish</topic>\n" +
                "        <goals>\n" +
                "          <main>Main session objective</main>\n" +
                '          <goal id="tom" name="Tom">Individual motivation for Tom</goal>\n' +
                '          <goal id="angela" name="Angela">Individual motivation for Angela</goal>\n' +
                '          <goal id="ben" name="Ben">Individual motivation for Ben</goal>\n' +
                '          <goal id="ginger" name="Ginger">Individual motivation for Ginger</goal>\n' +
                '          <goal id="hank" name="Hank">Individual motivation for Hank</goal>\n' +
                '          <goal id="becca" name="Becca">Individual motivation for Becca</goal>\n' +
                "        </goals>\n" +
                "        <pre_plot>What led up to this scene</pre_plot>\n" +
                "        <post_plot>What this leads to next</post_plot>\n" +
                "        <facts>\n" +
                "          <fact>Specific active fact or object 1</fact>\n" +
                "          <fact>Specific active fact or object 2</fact>\n" +
                "        </facts>\n" +
                "      </block>\n" +
                "    </schedule>\n" +
                "  </output_schema>\n" +
                "</scheduler_instruction>"
            ));

            const env = this.world.environment;
            if (env) {
                promptBuilder.useSystem(() => promptBuilder.part(
                    "<grounding_context>\n" +
                    `  <location>${XmlEncoder.encode(env.city)}</location>\n` +
                    `  <weather temperature="${XmlEncoder.encode(env.temperature)}">${XmlEncoder.encode(env.weather)}</weather>\n` +
                    `  <occasion>${XmlEncoder.encode(env.todayCelebration)}</occasion>\n` +
                    `  <headlines>${env.newsHeadlines.slice(0, 3).map(h => XmlEncoder.encode(h)).join(" | ")}</headlines>\n` +
                    "</grounding_context>"
                ));
            }

            promptBuilder.useUser(() => promptBuilder.part(
                `<horizon_request date="${XmlEncoder.encode(date.toDateString())}" start_hour="${startHour}:00">` +
                "  Generate exactly 3 to 4 sequential blocks covering the upcoming 4 hours starting from the given hour. " +
                "Do not emit more than 4 blocks.\n" +
                "</horizon_request>"
            ));

            const promptPayload = await promptBuilder.build();
            const xmlResponseText = await this.#generatePlannerXml(promptPayload, "scheduler");

            const parsedRecords = this.#parseXmlScheduleResponse(xmlResponseText, startHour);

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

            await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
            return this.schedule;
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Failed to generate schedule, applying fallbacks:", err);
            const fallbackRecords = this.#buildFallbackSchedule(date.getHours());
            for (const fb of fallbackRecords) {
                if (!this.schedule.some(r => r.startHour === fb.startHour)) {
                    this.schedule.push(fb);
                }
            }
            this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
            await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
            return this.schedule;
        } finally {
            this.isPlanning = false;
        }
    }

    // =========================================================================
    // DEMAND ENGINE
    // =========================================================================

    /**
     * Applies a User Director Demand IN-PLACE with full schedule normalization.
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

        const userMemories = this.world.User.memory.values()
            .filter(k => k.isUsable())
            .map(k => `${k.name}: ${Array.isArray(k.value) ? k.value.join(", ") : String(k.value)}`);

        const existingBlocksXml = this.schedule.map(b => (
            `    <block start="${b.startHour}" end="${b.endHour}">\n` +
            `      <topic>${XmlEncoder.encode(b.topic)}</topic>\n` +
            `      <goals>\n` +
            `        <main>${XmlEncoder.encode(b.mainGoal || "")}</main>\n` +
            (Array.isArray(b.characterGoals) ? b.characterGoals.map(cg =>
                `        <goal id="${XmlEncoder.encode(cg.id)}" name="${XmlEncoder.encode(cg.name)}">${XmlEncoder.encode(cg.goal)}</goal>`
            ).join("\n") : "") + "\n" +
            `      </goals>\n` +
            `      <pre_plot>${XmlEncoder.encode(b.prePlot || "")}</pre_plot>\n` +
            `      <post_plot>${XmlEncoder.encode(b.postPlot || "")}</post_plot>\n` +
            `      <facts>${b.facts.map(f => `<fact>${XmlEncoder.encode(f)}</fact>`).join("")}</facts>\n` +
            `    </block>`
        )).join("\n");

        promptBuilder.useSystem(() => promptBuilder.part(
            "<demand_engine>\n" +
            `  <task>${PROMPT_DEMAND_TASK}</task>\n` +
            "  <rules>\n" +
            PROMPT_DEMAND_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
            "  </rules>\n" +
            "  <output_schema>\n" +
            "    <demand_resolution>\n" +
            "      <summary_line_1>Clear 1-sentence summary of what was scheduled</summary_line_1>\n" +
            "      <summary_line_2>Exact time window and lead-up hook</summary_line_2>\n" +
            "      <schedule>\n" +
            '        <block start="16.0" end="17.0">\n' +
            "          <topic></topic>\n" +
            "          <goals>\n" +
            "            <main></main>\n" +
            '            <goal id="tom" name="Tom"></goal>\n' +
            '            <goal id="angela" name="Angela"></goal>\n' +
            '            <goal id="ben" name="Ben"></goal>\n' +
            '            <goal id="ginger" name="Ginger"></goal>\n' +
            '            <goal id="hank" name="Hank"></goal>\n' +
            '            <goal id="becca" name="Becca"></goal>\n' +
            "          </goals>\n" +
            "          <pre_plot></pre_plot>\n" +
            "          <post_plot></post_plot>\n" +
            "          <facts><fact></fact></facts>\n" +
            "        </block>\n" +
            "      </schedule>\n" +
            "    </demand_resolution>\n" +
            "  </output_schema>\n" +
            "</demand_engine>"
        ));

        if (userMemories.length > 0) {
            promptBuilder.useSystem(() => promptBuilder.part(
                "<user_memories>\n" +
                userMemories.map(m => `  <memory>${XmlEncoder.encode(m)}</memory>`).join("\n") + "\n" +
                "</user_memories>"
            ));
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

        const updatedBlocks = this.#parseXmlScheduleResponse(xmlResponseText, currentHour, cleanDemand);

        const report = this.#parseNarrativeReport(xmlResponseText);

        // Stage proposed changes for approval instead of committing immediately
        const proposal = this.#computeProposal(this.schedule, updatedBlocks);
        proposal.report = report;
        this.pendingProposal = proposal;

        this.isDirty = true;
        this.world.tick(this.world.now);

        return { line1, line2, schedule: this.schedule };
    }


    // =========================================================================
    // PROPOSAL APPROVAL WORKFLOW
    // =========================================================================

    /**
     * Accepts a pending proposal, committing its changes to the schedule.
     * @returns {Promise<ScheduleRecord[]>} Updated schedule.
     */
    async acceptProposal() {
        if (!this.pendingProposal) return this.schedule;
        this.logger.info(`Accepting proposal: ${this.pendingProposal.summary}`);

        for (const change of this.pendingProposal.changes) {
            if (change.action === "add") {
                const exists = this.schedule.some(r => r.id === change.block.id);
                if (!exists) this.schedule.push(change.block);
            }
        }
        for (const change of this.pendingProposal.changes) {
            if (change.action === "remove") {
                this.schedule = this.schedule.filter(r => r.id !== change.block.id);
            }
        }

        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = false;
        this.pendingProposal = null;

        await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
        this.world.tick(this.world.now);
        this.logger.info("Proposal accepted and schedule committed.");
        return this.schedule;
    }

    /**
     * Denies a pending proposal, discarding it without changes.
     * @returns {ScheduleRecord[]} Current schedule (unchanged).
     */
    denyProposal() {
        if (!this.pendingProposal) return this.schedule;
        this.logger.info(`Denying proposal: ${this.pendingProposal.summary}`);
        this.pendingProposal = null;
        this.isDirty = false;
        this.world.tick(this.world.now);
        return this.schedule;
    }

    /**
     * Computes a proposal by diffing current schedule against proposed blocks.
     * @param {ScheduleRecord[]} current Current schedule.
     * @param {ScheduleRecord[]} proposed Proposed new blocks.
     * @returns {ScheduleProposal} Computed proposal with adds and removes.
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
        for (const block of current) {
            const isKept = proposed.some(
                r => r.topic === block.topic && Math.abs(r.startHour - block.startHour) < 0.5
            );
            if (!isKept) changes.push({ action: "remove", block });
        }
        const addCount = changes.filter(c => c.action === "add").length;
        const removeCount = changes.filter(c => c.action === "remove").length;
        const summary = changes.length > 0
            ? `${addCount} new block(s) proposed, ${removeCount} block(s) to remove.`
            : "No changes proposed.";
        return { id: crypto.randomUUID(), changes, summary, createdAt: Date.now() };
    }

    /**
     * Discards any pending manual dirty changes by reverting to last persisted state.
     * @returns {Promise<ScheduleRecord[]>}
     */
    async discardManualChanges() {
        try {
            const raw = await this.storage.getItem(SCHEDULE_STORAGE_KEY);
            if (Array.isArray(raw)) {
                this.schedule = this.#sanitizeAndSortSchedule(raw.filter(this.#isValidRecord));
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to reload schedule from storage:", err);
        }
        this.isDirty = false;
        this.world.tick(this.world.now);
        return this.schedule;
    }

    // =========================================================================
    // STABILIZE & SAVE PIPELINE
    // =========================================================================

    /**
     * Result of a stabilization attempt.
     * @typedef {Object} StabilizationResult
     * @property {boolean} success Whether stabilization and save succeeded.
     * @property {string} message Human-readable status message.
     * @property {ScheduleRecord[]} [schedule] Updated schedule on success.
     * @property {string[]} [errors] Validation errors on failure.
     */

    /**
     * Stabilizes the dirty schedule via AI (Gemini → Groq fallback), validates
     * the returned XML for chronological order and non-overlapping segments,
     * and persists only if validation passes.
     *
     * @returns {Promise<StabilizationResult>}
     */
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
                '  <output_format>Output strictly &lt;schedule&gt;&lt;block start="..." end="..."&gt;...&lt;/block&gt;&lt;/schedule&gt; XML tags. Every block MUST include individual &lt;goal&gt; entries for all 6 characters: &lt;goal id="tom" name="Tom"&gt;, &lt;goal id="angela" name="Angela"&gt;, &lt;goal id="ben" name="Ben"&gt;, &lt;goal id="ginger" name="Ginger"&gt;, &lt;goal id="hank" name="Hank"&gt;, &lt;goal id="becca" name="Becca"&gt;.</output_format>\n' +
                "</restabilizer_instruction>"
            ));

            const blocksXml = this.schedule.map(b => (
                `  <block start=\"${b.startHour}\" end=\"${b.endHour}\">\n` +
                `    <topic>${XmlEncoder.encode(b.topic)}</topic>\n` +
                `    <goals>\n` +
                `      <main>${XmlEncoder.encode(b.mainGoal || "")}</main>\n` +
                (Array.isArray(b.characterGoals) ? b.characterGoals.map(cg =>
                    `      <goal id=\"${XmlEncoder.encode(cg.id)}\" name=\"${XmlEncoder.encode(cg.name)}\">${XmlEncoder.encode(cg.goal)}</goal>`
                ).join("\n") : "") + "\n" +
                `    </goals>\n` +
                `    <pre_plot>${XmlEncoder.encode(b.prePlot || "")}</pre_plot>\n` +
                `    <post_plot>${XmlEncoder.encode(b.postPlot || "")}</post_plot>\n` +
                `    <facts>${b.facts.map(f => `<fact>${XmlEncoder.encode(f)}</fact>`).join("")}</facts>\n` +
                `  </block>`
            )).join("\n");

            promptBuilder.useUser(() => promptBuilder.part(
                `<schedule>\n${blocksXml}\n</schedule>`
            ));

            // #generatePlannerXml emits START / TEXT / BLOCK / DONE for the UI.
            const promptPayload = await promptBuilder.build();
            const xmlResponseText = await this.#generatePlannerXml(promptPayload, "stabilizer");

            // Parse the stabilized schedule
            const startHour = this.schedule.length > 0 ? this.schedule[0].startHour : 0;
            const stabilizedBlocks = this.#parseXmlScheduleResponse(xmlResponseText, startHour);

            // Validate the stabilized output
            const validationErrors = this.#validateStabilizedSchedule(stabilizedBlocks);

            if (validationErrors.length > 0) {
                this.logger.warn(`Stabilization validation failed with ${validationErrors.length} error(s):`, validationErrors);
                return {
                    success: false,
                    message: `AI stabilization produced invalid schedule: ${validationErrors[0]}`,
                    errors: validationErrors
                };
            }

            // Validation passed — commit
            this.schedule = this.#sanitizeAndSortSchedule(stabilizedBlocks);
            this.isDirty = false;
            await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
            this.world.tick(this.world.now);

            this.logger.info(`Stabilization complete. ${this.schedule.length} blocks persisted.`);
            return { success: true, message: `Stabilized and saved ${this.schedule.length} blocks.`, schedule: this.schedule };

        } catch (/** @type {unknown} */ err) {
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
     * Validates a stabilized schedule for chronological order, non-overlapping
     * segments, and presence of pre/post plot transitions.
     * @param {ScheduleRecord[]} blocks Blocks to validate.
     * @returns {string[]} Array of validation error messages (empty = valid).
     */
    #validateStabilizedSchedule(blocks) {
        /** @type {string[]} */
        const errors = [];

        if (!Array.isArray(blocks) || blocks.length === 0) {
            errors.push("Stabilized schedule is empty.");
            return errors;
        }

        // Sort by startHour for validation
        const sorted = [...blocks].sort((a, b) => a.startHour - b.startHour);

        for (let i = 0; i < sorted.length; i++) {
            const block = sorted[i];

            // Check valid time range
            if (block.startHour >= block.endHour) {
                errors.push(`Block "${block.topic}" has invalid time range (${block.startHour} >= ${block.endHour}).`);
            }

            // Check chronological order
            if (i > 0 && block.startHour < sorted[i - 1].startHour) {
                errors.push(`Block "${block.topic}" starts before previous block — not chronological.`);
            }

            // Check for overlap with previous block
            if (i > 0 && block.startHour < sorted[i - 1].endHour) {
                errors.push(`Block "${block.topic}" overlaps with "${sorted[i - 1].topic}" (${block.startHour} < ${sorted[i - 1].endHour}).`);
            }

            // Check for non-empty topic
            if (!block.topic || block.topic.trim().length === 0) {
                errors.push(`Block at ${block.startHour} has empty topic.`);
            }
        }

        return errors;
    }

    /**
     * Directly saves the schedule — only permitted when isDirty is false.
     * Blocks manual persistence of unstable timelines.
     * @returns {Promise<ScheduleRecord[]>}
     */
    async directSave() {
        if (this.isDirty) {
            this.logger.warn("Direct save blocked: schedule is dirty. Use restabilizeAndSave() instead.");
            throw new Error("Schedule has unsaved manual changes. Please use 'Stabilize & Save' to validate and persist.");
        }
        await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
        this.world.tick(this.world.now);
        this.logger.info("Direct save completed (schedule was stable).");
        return this.schedule;
    }

    // =========================================================================
    // ACTIVE RECORD RESOLVER
    // =========================================================================

    /**
     * Resolves the active ScheduleRecord matching the given timestamp.
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
        return this.schedule[0] || null;
    }

    // =========================================================================
    // USER CRUD INTERFACE
    // =========================================================================

    /** @returns {ScheduleRecord[]} */
    getRecords() {
        return [...this.schedule];
    }

    /**
     * Creates and appends a new schedule record.
     * @param {Omit<ScheduleRecord, "id" | "createdAt" | "updatedAt">} recordData
     * @returns {Promise<ScheduleRecord>}
     */
    async createRecord(recordData) {
        const sHour = Math.max(0, Math.min(23.5, Number(recordData.startHour)));
        const eHour = Math.max(sHour + 0.5, Math.min(24, Number(recordData.endHour)));

        /** @type {ScheduleRecord} */
        const newRecord = {
            id: crypto.randomUUID(),
            startHour: sHour,
            endHour: eHour,
            timeRange: this.#formatDecimalRange(sHour, eHour),
            topic: String(recordData.topic || "Casual conversation").trim(),
            mainGoal: String(recordData.mainGoal || "Hang out together").trim(),
            characterGoals: Array.isArray(recordData.characterGoals) ? recordData.characterGoals : [],
            facts: Array.isArray(recordData.facts) ? recordData.facts.map(String).filter(Boolean) : [],
            prePlot: recordData.prePlot || "Friends chatting casually",
            postPlot: recordData.postPlot || "Transitioning to next activity",
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.schedule.push(newRecord);
        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = true;

        await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
        this.world.tick(this.world.now);

        this.logger.info(`User created schedule block: "${newRecord.topic}" [${newRecord.timeRange}]`);
        return newRecord;
    }

    /**
     * Updates an existing schedule record by ID.
     * @param {string} id
     * @param {Partial<Omit<ScheduleRecord, "id" | "createdAt">>} updates
     * @returns {Promise<ScheduleRecord|null>}
     */
    async updateRecord(id, updates) {
        const record = this.schedule.find(r => r.id === id);
        if (!record) return null;

        if (updates.topic !== undefined) record.topic = String(updates.topic).trim();
        if (updates.mainGoal !== undefined) record.mainGoal = String(updates.mainGoal).trim();
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

        record.updatedAt = Date.now();
        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);
        this.isDirty = true;

        await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
        this.world.tick(this.world.now);

        return record;
    }

    /**
     * Deletes a schedule record by ID.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteRecord(id) {
        const initialLen = this.schedule.length;
        this.schedule = this.schedule.filter(r => r.id !== id);

        if (this.schedule.length === initialLen) return false;

        this.isDirty = true;
        await this.storage.setItem(SCHEDULE_STORAGE_KEY, this.schedule);
        this.world.tick(this.world.now);
        return true;
    }

    // =========================================================================
    // PRIVATE: XML SCHEDULE PARSER
    // =========================================================================

    /**
     * Multi-syntax resilient XML Schedule Parser.
     * @param {string} rawResponse
     * @param {number} startHour
     * @param {string} [fallbackTopic]
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
            const mainGoalMatch = content.match(/<\s*main\b[^>]*>([\s\S]*?)<\/\s*main\s*>/i) || content.match(/<\s*goal\b[^>]*>([\s\S]*?)<\/\s*goal\s*>/i);
            const preMatch = content.match(/<\s*pre_plot\b[^>]*>([\s\S]*?)<\/\s*pre_plot\s*>/i);
            const postMatch = content.match(/<\s*post_plot\b[^>]*>([\s\S]*?)<\/\s*post_plot\s*>/i);

            const topic = topicMatch ? topicMatch[1].trim() : (fallbackTopic || "Afternoon chai & hangout");
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

            records.push({
                id: crypto.randomUUID(),
                startHour: sHour,
                endHour: eHour,
                timeRange: this.#formatDecimalRange(sHour, eHour),
                topic: XmlEncoder.decode(topic),
                mainGoal: XmlEncoder.decode(mainGoal),
                characterGoals,
                prePlot: XmlEncoder.decode(prePlot),
                postPlot: XmlEncoder.decode(postPlot),
                facts: facts.length > 0 ? facts : ["Enjoying tea and snacks"],
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            index++;
        }

        if (records.length === 0) {
            this.logger.warn("Zero XML blocks matched. Synthesizing fallback block.");
            const fbEnd = this.#clampHour(startHour + 1);
            records.push({
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
            });
        }

        return records;
    }


    // =========================================================================
    // PRIVATE: NARRATIVE REPORT PARSER
    // =========================================================================

    /**
     * Parses a structured <narrative_report> XML block from the model response.
     * @param {string} rawResponse Full XML response text.
     * @returns {import("./types/World.types").DemandReport} Parsed narrative report.
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

    // =========================================================================
    // PRIVATE: SCHEDULE UTILITIES
    // =========================================================================

    /**
     * @param {ScheduleRecord[]} existing
     * @param {ScheduleRecord[]} modified
     * @returns {ScheduleRecord[]}
     */
    #mergeDemandSchedule(existing, modified) {
        if (!Array.isArray(modified) || modified.length === 0) return existing;
        if (!Array.isArray(existing) || existing.length === 0) return this.#sanitizeAndSortSchedule(modified);

        /** @type {ScheduleRecord[]} */
        const merged = [];
        const minModifiedStart = Math.min(...modified.map(m => m.startHour));
        const maxModifiedEnd = Math.max(...modified.map(m => m.endHour));

        for (const block of existing) {
            if (block.endHour <= minModifiedStart) merged.push(block);
        }
        for (const block of modified) merged.push(block);
        for (const block of existing) {
            if (block.startHour >= maxModifiedEnd) merged.push(block);
        }

        return this.#sanitizeAndSortSchedule(merged);
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
        const fmt = (/** @type {number} */ val) => {
            const h = Math.floor(val);
            const m = Math.round((val - h) * 60);
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        };
        return `${fmt(start)} - ${fmt(end)}`;
    }

    /**
     * Clamps a decimal hour to valid 0-24 range.
     * Hours > 24 wrap: 25 -> 1, 26 -> 2, etc.
     * @param {number} h Raw decimal hour.
     * @returns {number} Clamped hour in [0, 24].
     */
    #clampHour(h) {
        if (!Number.isFinite(h)) return 0;
        let clamped = h % 24;
        if (clamped < 0) clamped += 24;
        clamped = Math.round(clamped * 2) / 2;
        return Math.max(0, Math.min(24, clamped));
    }

    /**
     * @param {number} startHour
     * @returns {ScheduleRecord[]}
     */
    #buildFallbackSchedule(startHour) {
        const topics = [
            { topic: "Creative project discussion", mainGoal: "Brainstorm new concepts", facts: ["Fresh notebook and markers on the table"] },
            { topic: "Snack break & tea", mainGoal: "Relax and discuss local city events", facts: ["Ordered hot samosas"] },
            { topic: "Weekend sports challenge", mainGoal: "Organize teams for outdoor games", facts: ["Checking equipment availability"] },
            { topic: "Evening entertainment session", mainGoal: "Pick a movie or comedy show", facts: ["Setting up screen and snacks"] }
        ];

        /** @type {ScheduleRecord[]} */
        const records = [];

        for (let i = 0; i < 4; i++) {
            const s = this.#clampHour(startHour + i);
            const e = this.#clampHour(s + 1);
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

    // =========================================================================
    // REORDER INTERFACE
    // =========================================================================

    /**
     * Reorders schedule blocks by moving the block at the given index one position
     * in the specified direction. Marks schedule as dirty (unstable) and requires
     * re-stabilization before saving.
     *
     * @param {number} index Current index of the block to move.
     * @param {'up' | 'down'} direction Direction to move the block.
     * @returns {ScheduleRecord[]} Updated schedule after reordering.
     */
    reorderBlocks(index, direction) {
        if (index < 0 || index >= this.schedule.length) return this.schedule;

        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= this.schedule.length) return this.schedule;

        // Swap adjacent blocks
        const temp = this.schedule[index];
        this.schedule[index] = this.schedule[targetIndex];
        this.schedule[targetIndex] = temp;

        // Re-apply time ranges to match new visual order. Durations are
        // preserved; blocks are re-timed sequentially from the earliest block's
        // original start so the swap survives #sanitizeAndSortSchedule (which
        // would otherwise re-sort by the now-stale startHour values and undo
        // the move).
        // Anchor to the true earliest start hour so moving the first block down preserves the original start time
        const anchorStart = Math.min(...this.schedule.map(b => b.startHour));
        const durations = this.schedule.map(b => Math.max(0.5, b.endHour - b.startHour));
        let cursor = anchorStart;
        for (let i = 0; i < this.schedule.length; i++) {
            const start = this.#clampHour(cursor);
            const end = this.#clampHour(Math.min(24, start + durations[i]));
            this.schedule[i].startHour = start;
            this.schedule[i].endHour = end > start ? end : this.#clampHour(Math.min(24, start + 1));
            this.schedule[i].timeRange = this.#formatDecimalRange(this.schedule[i].startHour, this.schedule[i].endHour);
            cursor = this.schedule[i].endHour;
        }

        // Normalize (fills gaps/overlaps without changing order — times are already sequential)
        this.schedule = this.#sanitizeAndSortSchedule(this.schedule);

        // Mark dirty — requires re-stabilization before direct save
        this.isDirty = true;

        this.world.tick(this.world.now);
        this.logger.info(`Reordered block: moved index ${index} ${direction} to index ${targetIndex}.`);

        return this.schedule;
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
