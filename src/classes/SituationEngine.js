// @ts-check

/**
 * @file SituationEngine.js
 * Tier-2 Memory & News engine (Gemma via Google AI Studio).
 *
 * Scope: memory extraction and news summarization ONLY. The macro scene
 * paragraph is no longer rewritten here — it is owned by the Planner's
 * `denseParagraph`, which ConversationManager injects directly into the
 * dialogue prompt.
 *
 * Triggers:
 * - Forced pass at app boot and on session reset.
 * - Immediate pass when >= 6 unread messages accumulate (volume trigger),
 *   which also RESETS the 1-minute periodic timer so the two never collide.
 * - Periodic pass every 1 minute while `unreadMessagesCount > 0`
 *   (driven by the engine-owned ticker and per-turn ticks).
 * - `ingestNews()` distills environment headlines into <=80-char `%world%`
 *   memory records with a 1h TTL.
 *
 * Single-flight: the `isProcessing` flag guarantees at most one Gemma pass
 * (memory or news) runs at any time.
 *
 * @typedef {Object} SituationContext
 * @property {string} currentDateTime Simulation date/time string.
 * @property {string} environmentSummary Compact weather/environment summary.
 * @property {string} activeSceneTopic Topic of the currently active block.
 * @property {string} activeSceneGoal Main goal of the currently active block.
 * @property {string} recentDialogue Recent dialogue batch (raw text).
 * @property {string} [location] Specific setting or room label.
 * @property {string} [castStates] Current character moods, postures, and active goals.
 * @property {string} [latestHumanMessage] Fresh human utterance memories must anchor to.
 */

import Storage from "./lib/Storage";
import { PROMPT_AGE_MANDATE } from "../util/prompts";

const SITUATION_STORAGE_KEY = "situation_summary_paragraph";
const SITUATION_MAX_CHARS = 500;

/** Unread messages that force an immediate pass (volume trigger). */
const VOLUME_THRESHOLD = 6;

/** Periodic cadence once at least one unread message exists. */
const TIMER_INTERVAL_MS = 60_000;

/** Hard per-record cap mirrored from UnifiedMemory. */
const MAX_RECORD_CHARS = 80;

/**
 * Generates an active, clock-aware ambient baseline without fixed clichés.
 * The Planner's denseParagraph provides the real macro scene — this is only
 * the ambient atmosphere line shown in the prompt's Ambient Setting block.
 *
 * @param {Date} [date=new Date()]
 * @param {string} [location="Lucknow"]
 * @returns {string}
 */
export function getDefaultSituation(date = new Date(), location = "Lucknow") {
    const hour = date.getHours();

    if (hour >= 6 && hour < 12) {
        return `Morning in ${location}. The group is starting their day, checking in on each other and talking through upcoming plans.`;
    }
    if (hour >= 12 && hour < 17) {
        return `Afternoon in ${location}. The group is together between activities, sharing stories and bantering casually.`;
    }
    if (hour >= 17 && hour < 22) {
        return `Evening in ${location}. The group is hanging out together, unwinding from the day and catching up.`;
    }
    return `Late night in ${location}. The atmosphere is relaxed and quiet as the group chats and winds down for the night.`;
}

export default class SituationEngine {

    /**
     * @param {Object} options
     * @param {import("./lib/Logger").default} options.logger
     * @param {import("./GeminiClient").default|null} [options.geminiClient]
     * @param {import("./lib/UnifiedMemory").default|null} [options.unifiedMemory]
     */
    constructor({ logger, geminiClient = null, unifiedMemory = null }) {
        this.logger = logger.child("SituationEngine");
        this.geminiClient = geminiClient;
        this.unifiedMemory = unifiedMemory;
        this.storage = new Storage("Memories", this.logger);

        /** @type {string} Ambient <=500-char baseline (never model-written). */
        this.situationText = getDefaultSituation();

        /** @type {number} Epoch of the last pass start/success (1-min timer base). */
        this.lastRunTime = Date.now();

        /** @type {number} Messages observed since the last successful pass. */
        this.unreadMessagesCount = 0;

        /** @type {boolean} Single-flight guard. */
        this.isProcessing = false;

        /**
         * Most recent context handed to a pass — the ticker reuses it so the
         * 1-minute periodic run always has fresh inputs.
         * @type {SituationContext|null}
         */
        this.lastContext = null;

        /**
         * 1-minute periodic ticker handle.
         * @type {ReturnType<typeof setInterval>|null}
         */
        this.ticker = null;
    }

    /**
     * Hydrates the ambient baseline and drops any legacy model-written
     * paragraph — the engine no longer rewrites the macro scene.
     * @returns {Promise<void>}
     */
    async init() {
        this.situationText = getDefaultSituation().slice(0, SITUATION_MAX_CHARS);
        try {
            await this.storage.removeItem(SITUATION_STORAGE_KEY);
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to clear legacy situation paragraph:", err);
        }
    }

    /**
     * Resets the engine state and purges the saved paragraph on session reset.
     * @returns {Promise<void>}
     */
    async reset() {
        this.situationText = getDefaultSituation().slice(0, SITUATION_MAX_CHARS);
        this.unreadMessagesCount = 0;
        this.lastRunTime = Date.now();
        this.isProcessing = false;
        this.lastContext = null;
        try {
            await this.storage.removeItem(SITUATION_STORAGE_KEY);
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to clear saved situation paragraph on reset:", err);
        }
    }

    /** Counts a newly observed conversation message. @returns {void} */
    recordMessage() {
        this.unreadMessagesCount++;
    }

    /**
     * Tier-2 trigger rule:
     * - Immediate when unreadMessagesCount >= 6 (volume trigger).
     * - Otherwise periodic: >0 unread AND >=1 minute since the last pass.
     * @returns {boolean}
     */
    shouldRun() {
        if (this.isProcessing) return false;
        if (this.unreadMessagesCount >= VOLUME_THRESHOLD) return true;
        return (
            this.unreadMessagesCount > 0 &&
            Date.now() - this.lastRunTime >= TIMER_INTERVAL_MS
        );
    }

    /**
     * Starts the 1-minute periodic ticker (idempotent). The ticker only fires
     * a pass when unread messages exist, so an idle chat costs nothing.
     * @returns {void}
     */
    startTicker() {
        if (this.ticker !== null) return;
        this.ticker = setInterval(() => {
            if (this.unreadMessagesCount <= 0) return;
            if (!this.lastContext) return;
            if (!this.shouldRun()) return;
            void this.executeIfDue(this.lastContext);
        }, TIMER_INTERVAL_MS);
    }

    /** Stops the periodic ticker (logout / teardown). @returns {void} */
    stopTicker() {
        if (this.ticker === null) return;
        clearInterval(this.ticker);
        this.ticker = null;
    }

    /**
     * Executes the Gemma memory-extraction pass when a trigger condition
     * holds or when forced.
     *
     * @param {SituationContext} ctx
     * @param {boolean} [force=false] Force run regardless of message/time thresholds.
     * @returns {Promise<boolean>} Whether the pass ran successfully.
     */
    async executeIfDue(ctx, force = false) {
        // Single-flight ALWAYS: `force` bypasses the message/time THRESHOLDS,
        // never the in-flight guard. World READY and init() both fire the
        // forced boot pass; overlapping passes used to abort each other's
        // Gemini request via the shared AbortController.
        if (this.isProcessing) return false;
        if (!force && !this.shouldRun()) return false;
        if (!this.geminiClient || !this.unifiedMemory) return false;

        this.isProcessing = true;
        // Reset the 1-minute timer the moment a pass fires (volume trigger
        // included) so both triggers can never collide on the same tick.
        this.lastRunTime = Date.now();
        this.lastContext = ctx;
        this.logger.info("Executing memory extraction pass via Gemma...");

        // Snapshot of the stack at prompt time: the model references entries
        // for deletion by their position in this snapshot, and we map them
        // back by id so concurrent additions during the await can never
        // mis-target a delete.
        const memSnapshot = [...this.unifiedMemory.entries];
        const numberedStack = memSnapshot
            .map((e, i) => `${i}: [${e.datetime} | tags: ${e.tags.join(", ")}] ${e.data}`)
            .join("\n");

        const prompt = [
            "# Dialogue Memory Pass",
            'You are the Memory Keeper for "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
            "",
            "## Inputs",
            `- Clock: ${ctx.currentDateTime}`,
            `- Location & Weather: ${ctx.location || "Lucknow Studio"} (${ctx.environmentSummary})`,
            `- Active Scene: ${ctx.activeSceneTopic} (Goal: ${ctx.activeSceneGoal})`,
            `- Latest Human Message: ${ctx.latestHumanMessage || "(none right now — autonomous scene pass)"}`,
            `- Cast Roster & Ongoing States:`,
            `  ${ctx.castStates || "Cast members are hanging out."}`,
            "",
            "## Recent Dialogue Batch",
            ctx.recentDialogue || "No messages yet. Scene is just beginning.",
            "",
            "## Current Memory Stack (numbered for deletion)",
            numberedStack || "(empty)",
            "",
            "## Instructions",
            "0. PRIORITY: the human's latest message outranks ambient chatter — first record what the human committed to, promised, revealed, or asked for, then the cast's own facts.",
            `1. Extract important commitments, secrets, facts, or relationship milestones into <new_memories> as <memory tags="..." expiry="..."> records. Expiries: '15m', '1h', '24h', 'forever'.`,
            `2. HARD LIMIT: every memory text MUST be ${MAX_RECORD_CHARS} characters or fewer — one dense, self-contained factual sentence. No lists, no explanations, no pronouns without a named subject.`,
            "3. Review the numbered memory stack above. Storage must not only grow: DELETE every entry that is stale, contradicted by newer events, expired in spirit, or no longer relevant by listing its index inside <deletions> (e.g. <delete index=\"3\"/>). Prefer deleting stale facts over adding new ones.",
            "4. Do not record trivial chit-chat or temporary physical movements, and never re-add a memory that already exists in the stack verbatim.",
            "5. Apply the <age_factor> block below: only extract memories that fit each character's life stage (a teen's crush confession is a memory; a teen discussing loan EMIs is a continuity error to avoid).",
            "",
            "## Age Factor",
            PROMPT_AGE_MANDATE,
            "",
            "## Output Format",
            "Output strictly valid XML matching this structure:",
            "<analysis>",
            "  <new_memories>",
            '    <memory tags="ben, gadget" expiry="forever">Ben completed his solar charging circuit.</memory>',
            "  </new_memories>",
            "  <deletions>",
            '    <delete index="3"/>',
            "  </deletions>",
            "</analysis>"
        ].join("\n");

        try {
            const targetModel = typeof this.geminiClient.resolveGemmaModel === "function"
                ? await this.geminiClient.resolveGemmaModel()
                : await this.geminiClient.resolveModel();

            this.logger.info(`Running SituationEngine with model: "${targetModel}"`);

            const result = await this.geminiClient.streamGenerate(
                [{ role: "user", content: prompt }],
                { model: targetModel, thinkingBudget: 0, promptType: "situation" }
            );

            const output = String(result?.text || "");

            const memMatches = [
                ...output.matchAll(/<memory\s+tags="([^"]*)"(?:\s+expiry="([^"]*)")?[^>]*>([\s\S]*?)<\/memory>/gi)
            ];
            const existingData = new Set(this.unifiedMemory.entries.map(e => e.data));
            let addedCount = 0;
            for (const m of memMatches) {
                const data = (m[3] || "").trim();
                // Skip empties and records the stack already holds verbatim.
                if (!data || existingData.has(data)) continue;
                existingData.add(data);
                await this.unifiedMemory.add({
                    tags: (m[1] || "").split(",").map(t => t.trim()).filter(Boolean),
                    expiry: m[2] || "forever",
                    data
                });
                addedCount++;
            }

            // Apply deletions by snapshot index → stable id (see snapshot above).
            const delMatches = [...output.matchAll(/<delete\s+index="(\d+)"\s*\/?>/gi)];
            let deletedCount = 0;
            for (const dm of delMatches) {
                const target = memSnapshot[Number(dm[1])];
                if (!target) continue;
                await this.unifiedMemory.remove(target.id);
                deletedCount++;
            }
            if (deletedCount > 0) {
                this.logger.info(`Pruned ${deletedCount} stale memor${deletedCount === 1 ? "y" : "ies"} from the unified stack.`);
            }

            await this.unifiedMemory.compressIfExceeded(this.geminiClient);

            this.unreadMessagesCount = 0;
            this.lastRunTime = Date.now();
            this.logger.info(
                `Memories updated successfully (+${addedCount} added, -${deletedCount} deleted).`
            );
            return true;
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Situation extraction pass failed (will retry on next trigger):", err);
            return false;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * News distillation: converts raw environment headlines into 3-5 dense,
     * factual records (<=80 chars each) tagged ["%world%", "news", ...] with
     * a 1h TTL, written straight into UnifiedMemory.
     *
     * Shares the engine's single-flight guard with the memory pass.
     *
     * @param {string[]} newsHeadlines Top headlines from environment.js.
     * @returns {Promise<number>} Count of news records stored (0 on skip/failure).
     */
    async ingestNews(newsHeadlines) {
        const headlines = (Array.isArray(newsHeadlines) ? newsHeadlines : [])
            .map(h => String(h || "").trim())
            .filter(Boolean);

        if (!headlines.length) return 0;
        if (!this.geminiClient || !this.unifiedMemory) return 0;
        if (this.isProcessing) return 0;

        this.isProcessing = true;
        this.logger.info(`Distilling ${headlines.length} news headline(s) via Gemma...`);

        const prompt = [
            "# News Distillation Task",
            'You are the world-news updater for "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
            "Condense the headlines below into 3 to 5 dense factual memory records.",
            `Each record MUST be ${MAX_RECORD_CHARS} characters or fewer: one self-contained fact with concrete entities (place, person, event, number).`,
            "No opinions, no predictions, no advice, no duplicated facts, no meta commentary.",
            "Skip anything that is pure entertainment gossip with no local relevance.",
            "",
            "## Headlines",
            headlines.map((h, i) => `${i + 1}. ${h}`).join("\n"),
            "",
            "## Output Format",
            "Output ONLY valid XML matching this structure:",
            "<news_records>",
            `  <record>One dense factual news memory in ${MAX_RECORD_CHARS} characters or fewer.</record>`,
            "</news_records>"
        ].join("\n");

        try {
            const targetModel = typeof this.geminiClient.resolveGemmaModel === "function"
                ? await this.geminiClient.resolveGemmaModel()
                : (typeof this.geminiClient.resolveModel === "function"
                    ? await this.geminiClient.resolveModel()
                    : "gemini-2.5-flash-lite");

            const result = await this.geminiClient.streamGenerate(
                [{ role: "user", content: prompt }],
                { model: targetModel, thinkingBudget: 0, promptType: "situation" }
            );

            const records = [
                ...String(result?.text || "").matchAll(/<record>([\s\S]*?)<\/record>/gi)
            ];

            const existingData = new Set(this.unifiedMemory.entries.map(e => e.data));
            let stored = 0;

            for (const match of records) {
                const raw = (match[1] || "").trim();
                if (!raw) continue;

                // Harden the 80-char contract even if the model ignores it.
                const data = raw.length > MAX_RECORD_CHARS
                    ? raw.slice(0, MAX_RECORD_CHARS).trim()
                    : raw;
                if (!data || existingData.has(data)) continue;
                existingData.add(data);

                // Fixed %world%/news tags + up to 2 topic words for retrieval.
                const topicWords = data
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, " ")
                    .split(/\s+/)
                    .filter(w => w.length > 3 && w !== "news" && w !== "world")
                    .slice(0, 2);

                await this.unifiedMemory.add({
                    tags: ["%world%", "news", ...topicWords],
                    data,
                    expiry: "1h"
                });
                stored++;
            }

            this.logger.info(`News distillation stored ${stored} record(s).`);
            return stored;
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("News distillation failed:", err);
            return 0;
        } finally {
            this.isProcessing = false;
        }
    }
}
