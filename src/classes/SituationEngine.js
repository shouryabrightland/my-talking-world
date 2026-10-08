// @ts-check

/**
 * @file SituationEngine.js
 * Tier-2 Situation & Memory engine (Gemma via Google AI Studio).
 *
 * Runs a distillation pass:
 * - Once immediately at app init / boot
 * - Once immediately whenever the chat session is reset
 * - Periodically when >= 10 messages accumulate OR >= 10 minutes elapse
 *
 * Produces:
 * - A rich <= 500 character stage description detailing the physical location,
 *   active character postures, props, and group dynamics.
 * - Tagged memory records written into the shared UnifiedMemory stack with
 *   per-entry TTLs ('15m', '1h', '24h', 'forever').
 *
 * @typedef {Object} SituationContext
 * @property {string} currentDateTime Simulation date/time string.
 * @property {string} environmentSummary Compact weather/environment summary.
 * @property {string} activeSceneTopic Topic of the currently active block.
 * @property {string} activeSceneGoal Main goal of the currently active block.
 * @property {string} recentDialogue Recent dialogue batch (raw text).
 * @property {string} [location] Specific setting or room label.
 * @property {string} [castStates] Current character moods, postures, and active goals.
 * @property {string} [latestHumanMessage] Fresh human utterance the scene must stay anchored to.
 */

import Storage from "./lib/Storage";
import { PROMPT_AGE_MANDATE } from "../util/prompts";

const SITUATION_STORAGE_KEY = "situation_summary_paragraph";
const SITUATION_MAX_CHARS = 500;
const MESSAGE_THRESHOLD = 10;
const TIME_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Generates an active, clock-aware baseline situation without fixed clichés.
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

        /** @type {string} Current <=500-char situation paragraph. */
        this.situationText = getDefaultSituation();

        /** @type {number} Epoch of the last successful distillation pass. */
        this.lastRunTime = Date.now();

        /** @type {number} Messages observed since the last pass. */
        this.unreadMessagesCount = 0;

        /** @type {boolean} Single-flight guard. */
        this.isProcessing = false;
    }

    /** Hydrates the persisted situation paragraph. @returns {Promise<void>} */
    async init() {
        try {
            const saved = await this.storage.getItem(SITUATION_STORAGE_KEY);
            if (typeof saved === "string" && saved.trim()) {
                this.situationText = saved.trim().slice(0, SITUATION_MAX_CHARS);
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to load situation paragraph:", err);
        }
    }

    /**
     * Resets the situation state and purges the saved paragraph on session reset.
     * @returns {Promise<void>}
     */
    async reset() {
        this.situationText = getDefaultSituation();
        this.unreadMessagesCount = 0;
        this.lastRunTime = Date.now();
        this.isProcessing = false;
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
     * Tier-2 trigger rule: >= 10 unread messages OR >= 10 minutes elapsed.
     * @returns {boolean}
     */
    shouldRun() {
        if (this.isProcessing) return false;
        return (
            this.unreadMessagesCount >= MESSAGE_THRESHOLD ||
            Date.now() - this.lastRunTime >= TIME_THRESHOLD_MS
        );
    }

    /**
     * Executes the Gemma distillation pass when a trigger condition holds or forced.
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
        this.logger.info("Executing Situation & Memory extraction pass via Gemma...");

        // Snapshot of the stack at prompt time: the model references entries
        // for deletion by their position in this snapshot, and we map them
        // back by id so concurrent additions during the await can never
        // mis-target a delete.
        const memSnapshot = [...this.unifiedMemory.entries];
        const numberedStack = memSnapshot
            .map((e, i) => `${i}: [${e.datetime} | tags: ${e.tags.join(", ")}] ${e.data}`)
            .join("\n");

        const prompt = [
            "# Ambient Situation Distiller & Memory Extractor",
            'You are the Scene Director and Observer for "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
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
            "0. PRIORITY: the human's latest message outranks the ambient situation. When one is present, the new situation MUST keep the group anchored on what the human just said — never invent a competing scene focus that pulls characters away from answering the human.",
            "1. Write a vivid, cinematic stage description under 500 characters that captures:",
            "   - The physical location and atmospheric room vibe.",
            "   - Current physical actions and postures of key characters (who is holding what prop, who is sitting, who is pacing).",
            "   - Active emotional friction or group focus, especially regarding what the human user said.",
            "2. Extract any important commitments, secrets, facts, or relationship milestones into memory records with member tags and an expiry ('15m', '1h', '24h', 'forever').",
            "3. Review the numbered memory stack above. Storage must not only grow: DELETE every entry that is stale, contradicted by newer events, expired in spirit, or no longer relevant by listing its index inside <deletions> (e.g. <delete index=\"3\"/>). Prefer deleting stale facts over adding new ones.",
            "4. Do not record trivial chit-chat or temporary physical movements, and never re-add a memory that already exists in the stack verbatim.",
            "5. Apply the <age_factor> block below: describe every character acting exactly at their age band, and only extract memories that fit their life stage (a teen's crush confession is a memory; a teen discussing loan EMIs is a continuity error to avoid).",
            "",
            "## Age Factor",
            PROMPT_AGE_MANDATE,
            "",
            "## Output Format",
            "Output strictly valid XML matching this structure:",
            "<analysis>",
            "  <situation>Vivid scene description under 500 characters detailing setting, character physical postures, props in hand, and active group dynamic.</situation>",
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

            const situationMatch = output.match(/<situation>([\s\S]*?)<\/situation>/i);
            if (situationMatch && situationMatch[1].trim()) {
                this.situationText = situationMatch[1].trim().slice(0, SITUATION_MAX_CHARS);
                await this.storage.setItem(SITUATION_STORAGE_KEY, this.situationText);
            }

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
                `Situation and memories updated successfully (+${addedCount} added, -${deletedCount} deleted).`
            );
            return true;
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Situation extraction pass failed (will retry on next trigger):", err);
            return false;
        } finally {
            this.isProcessing = false;
        }
    }
}