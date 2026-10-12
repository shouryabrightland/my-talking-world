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
 * @property {string|number|null} expiry Absolute UTC epoch-millisecond timestamp (canonical), or legacy "15m"/"1h"/"24h"/"forever" directive (converted to epoch ms on write — Task 13). -1 = permanent.
 */

export default class UnifiedMemory {

    /** Character budget before Gemma compression is triggered. @readonly */
    static MAX_CHARACTERS = 20_000;

    /**
     * Hard cap on characters stored per memory record. Every entry — however
     * it is written (manual add, situation pass, environment sync, planner
     * sync, compression output, or a legacy stack loaded from disk) — is
     * clamped to this length, so the 20k budget ≈ 250 capped records.
     * @readonly
     */
    static MAX_RECORD_CHARACTERS = 80;

    /** Maximum relevance lines injected into a single dialogue turn. @readonly */
    static MAX_SEARCH_RESULTS = 2;

    /**
     * Query keywords that unlock `%world%` news retrieval — news items only
     * participate in a search when the query explicitly asks for them.
     * @readonly
     */
    static WORLD_KEYWORDS = [
        "news", "weather", "world", "headline", "headlines",
        "forecast", "mausam", "khabar", "khabrein", "samachar",
        "event", "events", "festival", "festivals", "tyohar", "utsav"
    ];

    /**
     * Hard-clamps a payload to the 80-character per-record limit.
     * @param {string} data Raw payload.
     * @returns {string} Trimmed payload of at most 80 characters.
     */
    static clampRecord(data) {
        const cleaned = String(data || "").trim();
        if (cleaned.length <= UnifiedMemory.MAX_RECORD_CHARACTERS) return cleaned;
        return cleaned.slice(0, UnifiedMemory.MAX_RECORD_CHARACTERS).trim();
    }

    /**
     * Normalizes any expiry directive into an absolute UTC epoch-millisecond
     * NUMBER (Task 13) so stored TTLs are immune to local clock shifts and
     * timezone travel. Permanent ("forever", -1) and unset entries return -1;
     * relative strings ("15m", "1h") resolve against Date.now(); garbage
     * degrades to a safe +24h TTL via MemoryExpiryParser (never permanent).
     *
     * @param {string|number|null|undefined} expiry
     * @returns {number} Absolute epoch ms, or -1 for permanent.
     */
    static toUtcEpochExpiry(expiry) {
        if (expiry === null || expiry === undefined) return -1;
        const epoch = MemoryExpiryParser.toEpochMs(expiry);
        return epoch === null ? -1 : epoch;
    }

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
                // Enforce the 80-char record contract on legacy stacks too.
                this.entries = /** @type {UnifiedMemoryEntry[]} */ (raw)
                    .map(entry => ({
                        ...entry,
                        data: UnifiedMemory.clampRecord(entry?.data),
                        // Task 13: legacy relative string TTLs are anchored to
                        // absolute UTC epoch ms on every boot.
                        expiry: UnifiedMemory.toUtcEpochExpiry(entry?.expiry)
                    }))
                    .filter(entry => entry.data);
                await this.clearExpired(new Date());
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to load unified memory stack:", err);
            this.entries = [];
        }
    }

    /**
     * Appends a factual memory entry and persists the stack.
     * The record is hard-capped at 80 characters; empty payloads are rejected.
     *
     * @param {Object} entry
     * @param {string} [entry.datetime] "YYYY-MM-DD HH:mm" — defaults to now.
     * @param {string[]} [entry.tags] Target tags (lowercased, deduped).
     * @param {string} entry.data The factual memory string (max 80 chars).
     * @param {string|number|null} [entry.expiry] TTL directive, defaults to "forever".
     * @returns {Promise<UnifiedMemoryEntry|null>} The stored entry, or null when rejected.
     */
    async add({ datetime, tags, data, expiry = "forever" }) {
        const trimmedData = String(data || "").trim();
        if (!trimmedData) return null;
        const cleanData = trimmedData.length > UnifiedMemory.MAX_RECORD_CHARACTERS
            ? trimmedData.slice(0, UnifiedMemory.MAX_RECORD_CHARACTERS).trim()
            : trimmedData;

        /** @type {UnifiedMemoryEntry} */
        const entry = {
            id: crypto.randomUUID(),
            datetime: datetime || new Date().toISOString().slice(0, 16).replace("T", " "),
            tags: Array.isArray(tags)
                ? [...new Set(tags.map(t => String(t).toLowerCase().trim()).filter(Boolean))]
                : [],
            data: cleanData,
            // Task 13: expiry is stored as an absolute UTC epoch-ms number,
            // never a loose relative string offset.
            expiry: UnifiedMemory.toUtcEpochExpiry((expiry === null || expiry === undefined) ? "forever" : expiry)
        };

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
            if (!entry.expiry || entry.expiry === "forever" || entry.expiry === -1 || entry.expiry === "-1") return true;
            if (typeof entry.expiry === "number") {
                return entry.expiry > nowMs;
            }
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
     * Reference-based per-member query: returns every entry tagged with the
     * given member id (case-insensitive). Replaces the legacy per-character
     * `member.memory` table.
     *
     * @param {string} memberId Lowercase member id (e.g. "tom", "me").
     * @returns {UnifiedMemoryEntry[]} Matching entries (never null).
     */
    getEntriesForMember(memberId) {
        const id = String(memberId || "").toLowerCase().trim();
        if (!id) return [];
        return this.entries.filter(entry => Array.isArray(entry.tags) && entry.tags.includes(id));
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
     * Basic suffix normalization so plural/past/gerund forms compare equal:
     * "drones" → "drone", "repaired" → "repair", "flying" → "fly".
     *
     * @param {string} word
     * @returns {string}
     */
    static normalizeWord(word) {
        let w = String(word || "").toLowerCase();
        if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
        else if (w.length > 3 && w.endsWith("es")) w = w.slice(0, -2);
        else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
        else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
        // De-double the trailing consonant: "repaired" → "repair", "stopped" → "stop".
        if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !/[aeiou]/.test(w[w.length - 1])) {
            w = w.slice(0, -1);
        }
        return w;
    }

    /**
     * Deterministic relevance search executed in pure JS (no model call).
     *
     * Keyword-first scoring (Task 5 — inverted weights):
     * - Content keyword match in the memory text: +5 (primary signal).
     * - Keyword match in the entry's tags: +4.
     * - Member / target tag match: +2 (tie-breaker only).
     * - ELIGIBILITY: a memory must match at least one keyword to be
     *   eligible (member-only lookups with zero keywords keep working).
     * - `%world%` news items participate ONLY when the query explicitly
     *   mentions a news/weather/world keyword.
     * - Constraint: the top-2 results never contain more than one `%world%`
     *   news item, so real memories keep the retrieval slots.
     *
     * @param {string[]} [keywords] Keywords extracted by Needle.
     * @param {string[]} [targetTags] Target member/topic tags extracted by Needle.
     * @returns {string[]} Top 0-2 lines formatted for prompt injection.
     */
    searchDeterministic(keywords = [], targetTags = []) {
        const normKw = [...new Set(
            keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean)
        )];
        const normTags = targetTags
            .map(t => String(t).toLowerCase().trim())
            .filter(t => t && t !== "any");

        if (!normKw.length && !normTags.length) return [];

        // Suffix-normalized keyword stems for comparison ("drones" ≈ "drone").
        const kwStems = normKw.map(k => UnifiedMemory.normalizeWord(k));

        // News is only retrievable when the human explicitly asks about it.
        const wantsWorld = normKw.some(k =>
            UnifiedMemory.WORLD_KEYWORDS.some(w => k.includes(w))
        );

        /** @type {Array<{ entry: UnifiedMemoryEntry, score: number, isWorld: boolean }>} */
        const scored = [];

        for (const entry of this.entries) {
            const entryTags = entry.tags.map(t => t.toLowerCase());
            const entryData = entry.data.toLowerCase();
            const isWorld = entryTags.includes("%world%");
            // Calendar/countdown records are %world%-tagged but must also be
            // reachable by naming the event ("Diwali kab hai?" — Phase 4.2).
            const isCalendar = entryTags.includes("calendar");

            // Gate non-calendar news behind an explicit news query.
            if (isWorld && !isCalendar && !wantsWorld) continue;

            // Task 5: keyword-first scoring — content match +5, tag match +4.
            let score = 0;
            let keywordMatched = false;

            for (let i = 0; i < normKw.length; i++) {
                const kw = normKw[i];
                const stem = kwStems[i];
                const dataHit = entryData.includes(kw) || (stem !== kw && entryData.includes(stem));
                if (dataHit) {
                    score += 5;
                    keywordMatched = true;
                    continue;
                }
                const tagHit = entryTags.some(t => t.includes(kw) || (stem !== kw && t.includes(stem)));
                if (tagHit) {
                    score += 4;
                    keywordMatched = true;
                }
            }

            // Task 5: eligibility gate — at least one keyword must match.
            // Member-only lookups (zero keywords) stay member-tag driven.
            if (normKw.length > 0 && !keywordMatched) continue;

            // Member / target tag match — tie-breaker only (+2).
            for (const tag of normTags) {
                if (entryTags.includes(tag)) score += 2;
            }

            // Calendar + news baseline: eligible %world% rows keep a small
            // floor so an explicit news query still surfaces them.
            if (isWorld && score === 0) {
                if (normKw.length === 0) continue;
                score = 1;
            }

            if (score > 0) scored.push({ entry, score, isWorld });
        }

        scored.sort((a, b) => b.score - a.score || b.entry.datetime.localeCompare(a.entry.datetime));

        // Constraint: at most ONE %world% news item in the top-2 results.
        /** @type {Array<{ entry: UnifiedMemoryEntry, score: number, isWorld: boolean }>} */
        const top = [];
        for (const item of scored) {
            if (item.isWorld && top.some(t => t.isWorld)) continue;
            top.push(item);
            if (top.length >= UnifiedMemory.MAX_SEARCH_RESULTS) break;
        }

        return top.map(item => `[${item.entry.datetime}] ${item.entry.data}`);
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
     * Compresses the stack with Gemma once it exceeds the 20,000-char budget
     * (or immediately when `force` is set from the manual Settings button).
     * The model output is accepted ONLY when it is strictly smaller than the
     * current stack — fewer-or-equal records AND fewer characters — so a
     * model that echoes its input can never grow the record count. On any
     * rejection or failure the original stack is left untouched.
     *
     * @param {import("../GeminiClient").default} gemmaClient
     * @param {boolean} [force=false] Compress even when under the 20k budget.
     * @returns {Promise<boolean>} Whether a compression pass actually ran.
     */
    async compressIfExceeded(gemmaClient, force = false) {
        const beforeChars = this.getCharacterCount();
        const beforeCount = this.entries.length;
        if (!force && beforeChars < UnifiedMemory.MAX_CHARACTERS) return false;
        if (this.isCompressing) return false;
        this.isCompressing = true;

        this.logger.info(
            beforeChars < UnifiedMemory.MAX_CHARACTERS
                ? "Manual compression requested. Running Gemma compression pass..."
                : "Memory stack reached 20,000 characters. Triggering Gemma compression..."
        );

        const prompt = [
            "# Memory Compression Task",
            "Summarize and condense the following episodic memory stack into distinct core memory entries.",
            "Retain all permanent facts, emotional bonds, and major milestones. Combine duplicate and minor events.",
            "The output MUST contain strictly FEWER <memory> records than the input has lines — merge aggressively.",
            "Never echo the schema example or the input lines verbatim.",
            "Keep the total output under 10,000 characters.",
            "",
            "## Input Memory Stack",
            "```",
            this.toTextStack(),
            "```",
            "",
            "## Output Schema",
            "Output ONLY valid XML matching this structure:",
            "<memories>",
            '  <memory tags="tag1, tag2" expiry="forever">Consolidated memory entry</memory>',
            "</memories>"
        ].join("\n");

        try {
            // Zero hardcoded model names: when the client exposes no
            // resolver we pass model: null and let GeminiClient resolve its
            // own configured default (DEFAULT_GEMINI_MODEL via config).
            const targetModel = typeof gemmaClient.resolveGemmaModel === "function"
                ? await gemmaClient.resolveGemmaModel()
                : (typeof gemmaClient.resolveModel === "function"
                    ? await gemmaClient.resolveModel()
                    : null);

            const result = await gemmaClient.streamGenerate(
                [{ role: "user", content: prompt }],
                { model: targetModel, thinkingBudget: 0 }
            );

            const matches = [
                ...String(result?.text || "").matchAll(
                    /<memory\s+tags="([^"]*)"(?:\s+expiry="([^"]*)")?[^>]*>([\s\S]*?)<\/memory>/gi
                )
            ];

            if (matches.length > 0) {
                const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

                /** @type {UnifiedMemoryEntry[]} */
                const candidates = [];
                const seen = new Set();
                for (const m of matches) {
                    const data = UnifiedMemory.clampRecord(m[3]);
                    // Drop empties, duplicate records and echoes of the schema example.
                    if (!data || data === "Consolidated memory entry" || seen.has(data)) continue;
                    seen.add(data);
                    candidates.push({
                        id: crypto.randomUUID(),
                        datetime: stamp,
                        tags: (m[1] || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
                        expiry: UnifiedMemory.toUtcEpochExpiry(m[2] || "forever"),
                        data
                    });
                }

                const afterChars = candidates
                    .map(e => `[${e.datetime} | tags: ${e.tags.join(", ")}] ${e.data}`)
                    .join("\n").length;

                // Acceptance guard: compression may NEVER grow the stack.
                if (candidates.length === 0 || candidates.length > beforeCount || afterChars >= beforeChars) {
                    this.logger.warn(
                        `Compression rejected: model produced ${candidates.length} record(s) / ${afterChars} chars ` +
                        `vs ${beforeCount} record(s) / ${beforeChars} chars — keeping the original stack.`
                    );
                    return false;
                }

                this.entries = candidates;
                await this.persist();
                this.logger.info(
                    `Memory stack compressed: ${beforeCount} → ${candidates.length} records, ` +
                    `${beforeChars} → ${afterChars} chars.`
                );
                return true;
            }
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Failed to compress memory stack:", err);
        } finally {
            this.isCompressing = false;
        }
        return false;
    }

    /**
     * Synchronizes real-world environmental grounding (weather, festivals, GDELT news)
     * into the UnifiedMemory stack. Replaces outdated environment entries to avoid duplicates.
     *
     * @param {import("../types/World.types").EnvironmentSnapshot} env
     * @returns {Promise<void>}
     */
    async syncEnvironment(env) {
        if (!env || typeof env !== "object") return;

        // 1. Purge previous environment and RAW news entries so they don't
        // accumulate. Scope the purge to our own rows ONLY: the %world%
        // distilled digest written by SituationEngine.ingestNews() must
        // survive every sync (it used to be wiped because it also carries
        // the "news" tag — leaving unified memory with zero %world% rows).
        this.entries = this.entries.filter(e => {
            if (e.tags.includes("environment")) return false;
            if (e.tags.includes("calendar")) return false;
            if (e.tags.includes("news") && !e.tags.includes("%world%")) return false;
            return true;
        });

        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

        // 2. Weather & temperature fact (1h TTL)
        if (env.weather) {
            this.entries.push({
                id: crypto.randomUUID(),
                datetime: stamp,
                tags: ["environment", "weather", "lucknow", "temperature"],
                data: UnifiedMemory.clampRecord(
                    `Current weather in ${env.city || "Lucknow"}: ${env.temperature || "32°C"}, ${env.weather} (Humidity: ${env.humidity || "55%"})`
                ),
                expiry: UnifiedMemory.toUtcEpochExpiry("1h")
            });
        }

        // 3. Indian holiday / festival fact (24h TTL)
        if (env.todayCelebration && !env.todayCelebration.toLowerCase().includes("regular day")) {
            this.entries.push({
                id: crypto.randomUUID(),
                datetime: stamp,
                tags: ["environment", "occasion", "festival", "celebration", "lucknow"],
                data: UnifiedMemory.clampRecord(`Today's celebration: ${env.todayCelebration}`),
                expiry: UnifiedMemory.toUtcEpochExpiry("24h")
            });
        }

        // 4. Next-10 calendar events (24h TTL) so the cast can answer
        // "Diwali kab hai?" / "Agla festival kaunsa hai?" via Tier-3 retrieval.
        if (Array.isArray(env.upcomingEvents) && env.upcomingEvents.length > 0) {
            const dayMs = 24 * 60 * 60 * 1000;
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

            for (const evt of env.upcomingEvents.slice(0, 10)) {
                if (!evt?.name || !Number.isFinite(evt.ts)) continue;
                const daysLeft = Math.max(0, Math.ceil((evt.ts - todayStart) / dayMs));
                const eventKeywords = String(evt.name)
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, " ")
                    .split(/\s+/)
                    .filter(w => w.length > 3)
                    .slice(0, 3);

                this.entries.push({
                    id: crypto.randomUUID(),
                    datetime: stamp,
                    tags: [...new Set(["%world%", "event", "calendar", ...eventKeywords])],
                    data: UnifiedMemory.clampRecord(`In ${daysLeft}d: ${evt.name} (${evt.dateStr})`),
                    expiry: UnifiedMemory.toUtcEpochExpiry("24h")
                });
            }
        }

        // 5. Top news headlines — raw GDELT batch (1h TTL, %world%-tagged so
        // a unified-memory search for "%world%" surfaces them). The hourly
        // environment refresh replaces this batch every cycle; the distilled
        // digest from ingestNews() lives alongside under "news_digest".
        if (Array.isArray(env.newsHeadlines)) {
            for (const headline of env.newsHeadlines.slice(0, 10)) {
                const words = String(headline)
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, " ")
                    .split(/\s+/)
                    .filter(w => w.length > 3)
                    .slice(0, 3);

                // Dedupe: a headline mentioning "India" would otherwise repeat
                // the literal "india" tag and break React key uniqueness.
                const tags = [...new Set(["news", "news_raw", "%world%", "india", ...words])];

                this.entries.push({
                    id: crypto.randomUUID(),
                    datetime: stamp,
                    tags,
                    data: UnifiedMemory.clampRecord(`Headlines: ${headline}`),
                    expiry: UnifiedMemory.toUtcEpochExpiry("1h")
                });
            }
        }

        await this.persist();
        this.logger.info("Synchronized real-world environment & news into UnifiedMemory.");
    }

    /**
     * Synchronizes the planner's FUTURE schedule blocks into the UnifiedMemory
     * stack so characters can recall upcoming scenes through Tier-3 retrieval
     * (Needle keyword match → Active Memories). Replaces previous planner
     * entries on every sync to avoid duplicates and skips blocks that have
     * already ended.
     *
     * @param {import("../types/World.types").ScheduleRecord[]} schedule Full planner horizon.
     * @returns {Promise<void>}
     */
    async syncPlannerScenes(schedule) {
        if (!Array.isArray(schedule) || schedule.length === 0) return;

        // 1. Purge previous planner entries so re-syncs never duplicate.
        this.entries = this.entries.filter(e => !e.tags.includes("planner"));

        const now = new Date();
        const decimalHour = now.getHours() + now.getMinutes() / 60;
        const stamp = now.toISOString().slice(0, 16).replace("T", " ");

        /** @param {number} h @returns {string} */
        const fmt = (h) => {
            const hh = Math.floor(h);
            const mm = Math.round((h - hh) * 60);
            return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        };

        let count = 0;
        for (const block of schedule) {
            if (!block || typeof block.startHour !== "number") continue;
            // Scenes already in the past are dead — characters only need what's ahead.
            if (typeof block.endHour === "number" && block.endHour <= decimalHour) continue;

            const time = block.timeRange || `${fmt(block.startHour)}-${fmt(block.endHour)}`;
            const goals = Array.isArray(block.characterGoals) ? block.characterGoals : [];
            // Records are hard-capped at 80 chars — the data line stays a compact
            // scene pointer built from the self-contained dense paragraph, while
            // goal owners travel as retrieval tags below.
            const sceneDescription = block.denseParagraph || block.topic || "Casual hangout";
            const data = UnifiedMemory.clampRecord(
                `Upcoming scene ${time}: ${block.topic || "Casual hangout"} — ${sceneDescription}`
            );

            // Retrieval tags: fixed planner keywords + topic words + goal owners.
            const topicWords = String(block.topic || "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter(w => w.length > 3)
                .slice(0, 3);
            const ownerIds = goals.map(g => String(g.id || "").toLowerCase()).filter(Boolean);
            const tags = [...new Set(["planner", "schedule", "future", "scene", ...topicWords, ...ownerIds])];

            this.entries.push({
                id: crypto.randomUUID(),
                datetime: stamp,
                tags,
                data,
                expiry: UnifiedMemory.toUtcEpochExpiry("24h")
            });
            count++;
        }

        await this.persist();
        this.logger.info(`Synchronized ${count} upcoming planner scene(s) into UnifiedMemory.`);
    }
}
