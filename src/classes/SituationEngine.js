// @ts-check

/**
 * @file SituationEngine.js
 * Tier-2 Situation & Memory engine (Gemma via Google AI Studio).
 *
 * Runs a distillation pass when the conversation accumulates >= 10 new
 * messages OR >= 10 minutes have elapsed since the last pass, and produces:
 * - A single <= 500 character situation paragraph injected into every Tier-4
 *   dialogue prompt.
 * - Tagged memory records written into the shared UnifiedMemory stack with
 *   per-entry TTLs ('15m', '1h', '24h', 'forever').
 *
 * @typedef {Object} SituationContext
 * @property {string} currentDateTime Simulation date/time string.
 * @property {string} environmentSummary Compact weather/environment summary.
 * @property {string} activeSceneTopic Topic of the currently active block.
 * @property {string} activeSceneGoal Main goal of the currently active block.
 * @property {string} recentDialogue Recent dialogue batch (raw text).
 */

import Storage from "./lib/Storage";

const SITUATION_STORAGE_KEY = "situation_summary_paragraph";
const SITUATION_MAX_CHARS = 500;
const MESSAGE_THRESHOLD = 10;
const TIME_THRESHOLD_MS = 10 * 60 * 1000;
const DEFAULT_SITUATION = "Cast is relaxing in the Lucknow garage, sharing casual banter over afternoon chai.";

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
        this.situationText = DEFAULT_SITUATION;

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
     * Executes the Gemma distillation pass when a trigger condition holds.
     * Failures are non-fatal: counters only reset on success so the next
     * eligible turn retries automatically.
     *
     * @param {SituationContext} ctx
     * @returns {Promise<boolean>} Whether the pass ran successfully.
     */
    async executeIfDue(ctx) {
        if (!this.shouldRun()) return false;
        if (!this.geminiClient || !this.unifiedMemory) return false;

        this.isProcessing = true;
        this.logger.info("Executing Situation & Memory extraction pass via Gemma...");

        const prompt = [
            "# Ambient Situation Distiller & Memory Extractor",
            'You are an analytical assistant observing "Tom & Friends" in Lucknow, Uttar Pradesh, India.',
            "",
            "## Inputs",
            `- Time: ${ctx.currentDateTime}`,
            `- Environment: ${ctx.environmentSummary}`,
            `- Active Scene: ${ctx.activeSceneTopic} (Goal: ${ctx.activeSceneGoal})`,
            "",
            "## Recent Dialogue Batch",
            ctx.recentDialogue,
            "",
            "## Instructions",
            "1. Write a single concise situation summary paragraph under 500 characters describing physical location, props in use, and ongoing atmosphere.",
            "2. Extract any important commitments, secrets, facts, or relationship milestones into memory records with member tags and an expiry ('15m', '1h', '24h', 'forever').",
            "3. Do not record trivial chit-chat or temporary physical movements.",
            "",
            "## Output Format",
            "Output strictly valid XML matching this structure:",
            "<analysis>",
            "  <situation>Concise physical atmosphere and situation summary under 500 characters.</situation>",
            "  <new_memories>",
            '    <memory tags="ben, gadget" expiry="forever">Ben completed his solar charging circuit.</memory>',
            "  </new_memories>",
            "</analysis>"
        ].join("\n");

        try {
            const result = await this.geminiClient.streamGenerate(
                [{ role: "user", content: prompt }],
                { model: "gemma-2-27b-it", thinkingBudget: 0, promptType: "situation" }
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
            for (const m of memMatches) {
                const data = (m[3] || "").trim();
                if (!data) continue;
                await this.unifiedMemory.add({
                    tags: (m[1] || "").split(",").map(t => t.trim()).filter(Boolean),
                    expiry: m[2] || "forever",
                    data
                });
            }

            // Tier-3 stack compression once the 20k budget is reached.
            await this.unifiedMemory.compressIfExceeded(this.geminiClient);

            this.unreadMessagesCount = 0;
            this.lastRunTime = Date.now();
            this.logger.info("Situation and memories updated successfully.");
            return true;
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Situation extraction pass failed (will retry on next trigger):", err);
            return false;
        } finally {
            this.isProcessing = false;
        }
    }
}
