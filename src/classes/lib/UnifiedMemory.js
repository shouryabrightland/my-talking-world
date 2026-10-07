// @ts-check
import Storage from "./Storage";
import MemoryExpiryParser from "./MemoryExpiryParser";

/**
 * @file UnifiedMemory.js
 * Tier-3/4 episodic memory stack shared by the Needle query router, the
 * ultra-lean Groq banter engine and the Tier-1 macro planner.
 *
 * Responsibilities:
 * - Holds a flat, tag-indexed stack of factual memory entries (<= 20,000 chars).
 * - Deterministic pure-JS relevance scoring for Needle-extracted keywords.
 * - TTL pruning through MemoryExpiryParser ('15m', '1h', '24h', 'forever', ISO).
 * - Gemma-powered compression when the stack exceeds its 20k character budget.
 *
 * @typedef {Object} UnifiedMemoryEntry
 * @property {string} id Unique UUID
 * @property {string} datetime "YYYY-MM-DD HH:mm"
 * @property {string[]} tags e.g. ["tom", "drone", "repair"]
 * @property {string} data The factual memory string
 * @property {string|null} expiry "15m", "1h", "24h", "forever", or ISO string
 */

export default class UnifiedMemory {

    /** Character budget before Gemma compression is triggered. @readonly */
    static MAX_CHARACTERS = 20_000;

    /** Maximum relevance lines injected into a single dialogue turn. @readonly */
    static MAX_SEARCH_RESULTS = 2;

    /** @param {import("./Logger").default} logger */
    constructor(logger) {
        this.logger = logger.child("UnifiedMemory");
        this.storage = new Storage("Memories", this.logger);

        /** @type {UnifiedMemoryEntry[]} */
        this.entries = [];

        /** @type {string} */
        this.storageKey = "unified_memory_stack";

        /** Prevents concurrent compression passes. @type {boolean} */
        this.isCompressing = false;
    }

    /**
     * Loads the persisted stack and prunes expired entries on boot.
     * @returns {Promise<void>}
     */
    async init() {
        try {
            const raw = await this.storage.getItem(this.storageKey);
            if (Array.isArray(raw)) {
                this.entries = /** @type {UnifiedMemoryEntry[]} */ (raw);
                await this.clearExpired(new Date());
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to load unified memory stack:", err);
            this.entries = [];
        }
    }

    /**
     * Appends a factual memory entry and persists the stack.
     *
     * @param {Object} entry
     * @param {string} [entry.datetime] "YYYY-MM-DD HH:mm" — defaults to now.
     * @param {string[]} [entry.tags] Target tags (lowercased, deduped).
     * @param {string} entry.data The factual memory string.
     * @param {string} [entry.expiry] TTL directive, defaults to "forever".
     * @returns {Promise<UnifiedMemoryEntry>} The stored entry.
     */
    async add({ datetime, tags, data, expiry = "forever" }) {
        /** @type {UnifiedMemoryEntry} */
        const entry = {
            id: crypto.randomUUID(),
            datetime: datetime || new Date().toISOString().slice(0, 16).replace("T", " "),
            tags: Array.isArray(tags)
                ? [...new Set(tags.map(t => String(t).toLowerCase().trim()).filter(Boolean))]
                : [],
            data: String(data || "").trim(),
            expiry: expiry || "forever"
        };

        if (!entry.data) return entry;

        this.entries.push(entry);
        await this.clearExpired(new Date());
        await this.persist();
        return entry;
    }

    /**
     * Removes a single entry by id.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async remove(id) {
        const before = this.entries.length;
        this.entries = this.entries.filter(e => e.id !== id);
        if (this.entries.length !== before) await this.persist();
    }

    /**
     * Drops every entry whose TTL has elapsed on the given clock.
     * Permanent ('forever' / -1) and unset entries always survive.
     *
     * @param {Date} [now]
     * @returns {Promise<number>} Count of pruned entries.
     */
    async clearExpired(now = new Date()) {
        const initialCount = this.entries.length;
        const nowMs = now.getTime();

        this.entries = this.entries.filter(entry => {
            if (!entry.expiry || entry.expiry === "forever" || entry.expiry === "-1") return true;
            const parsed = MemoryExpiryParser.parse(entry.expiry);
            if (parsed instanceof Date) return parsed.getTime() > nowMs;
            return true;
        });

        if (this.entries.length !== initialCount) {
            const pruned = initialCount - this.entries.length;
            this.logger.info(`Pruned ${pruned} expired unified memories.`);
            await this.persist();
            return pruned;
        }
        return 0;
    }

    /**
     * Renders the whole stack as newline-delimited prompt-ready lines.
     * @returns {string}
     */
    toTextStack() {
        return this.entries
            .map(e => `[${e.datetime} | tags: ${e.tags.join(", ")}] ${e.data}`)
            .join("\n");
    }

    /**
     * @returns {number} Current character footprint of the rendered stack.
     */
    getCharacterCount() {
        return this.toTextStack().length;
    }

    /**
     * Deterministic relevance search executed in pure JS (no model call).
     *
     * @param {string[]} [keywords] Keywords extracted by Needle.
     * @param {string[]} [targetTags] Target member/topic tags extracted by Needle.
     * @returns {string[]} Top 0-2 lines formatted for prompt injection.
     */
    searchDeterministic(keywords = [], targetTags = []) {
        const normKw = keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean);
        const normTags = targetTags.map(t => String(t).toLowerCase().trim()).filter(Boolean);

        if (!normKw.length && !normTags.length) return [];

        const scored = this.entries.map(entry => {
            let score = 0;
            const entryTags = entry.tags.map(t => t.toLowerCase());
            const entryData = entry.data.toLowerCase();

            for (const tag of normTags) {
                if (tag === "any") continue;
                if (entryTags.includes(tag)) score += 3;
                else if (entryTags.some(t => t.includes(tag))) score += 2;
            }
            for (const kw of normKw) {
                if (entryTags.some(t => t.includes(kw))) score += 2;
                if (entryData.includes(kw)) score += 1;
            }
            return { entry, score };
        });

        return scored
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || b.entry.datetime.localeCompare(a.entry.datetime))
            .slice(0, UnifiedMemory.MAX_SEARCH_RESULTS)
            .map(item => `[${item.entry.datetime}] ${item.entry.data}`);
    }

    /**
     * Persists the stack, swallowing (but logging) storage failures.
     * @returns {Promise<void>}
     */
    async persist() {
        try {
            await this.storage.setItem(this.storageKey, this.entries);
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Failed to persist unified memory stack:", err);
        }
    }

    /**
     * Compresses the stack with Gemma once it exceeds the 20,000-char budget.
     * Output is parsed back into tagged entries; on any failure the original
     * stack is left untouched.
     *
     * @param {import("../GeminiClient").default} gemmaClient
     * @returns {Promise<boolean>} Whether a compression pass actually ran.
     */
    async compressIfExceeded(gemmaClient) {
        if (this.getCharacterCount() < UnifiedMemory.MAX_CHARACTERS) return false;
        if (this.isCompressing) return false;
        this.isCompressing = true;

        this.logger.info("Memory stack reached 20,000 characters. Triggering Gemma compression...");

        const prompt = [
            "# Memory Compression Task",
            "Summarize and condense the following episodic memory stack into distinct core memory entries.",
            "Retain all permanent facts, emotional bonds, and major milestones. Combine duplicate and minor events.",
            "Keep the total output under 10,000 characters.",
            "",
            "## Input Memory Stack",
            this.toTextStack(),
            "",
            "## Output Schema",
            "Output ONLY valid XML matching this structure:",
            "<memories>",
            '  <memory tags="tag1, tag2" expiry="forever">Consolidated memory entry</memory>',
            "</memories>"
        ].join("\n");

        try {
            const result = await gemmaClient.streamGenerate(
                [{ role: "user", content: prompt }],
                { model: "gemma-2-27b-it", thinkingBudget: 0 }
            );

            const matches = [
                ...String(result?.text || "").matchAll(
                    /<memory\s+tags="([^"]*)"(?:\s+expiry="([^"]*)")?[^>]*>([\s\S]*?)<\/memory>/gi
                )
            ];

            if (matches.length > 0) {
                const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
                this.entries = matches.map(m => ({
                    id: crypto.randomUUID(),
                    datetime: stamp,
                    tags: (m[1] || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
                    expiry: m[2] || "forever",
                    data: (m[3] || "").trim()
                })).filter(e => e.data.length > 0);

                await this.persist();
                this.logger.info(`Memory stack successfully compressed to ${this.entries.length} items.`);
                return true;
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Failed to compress memory stack:", err);
        } finally {
            this.isCompressing = false;
        }
        return false;
    }
}
