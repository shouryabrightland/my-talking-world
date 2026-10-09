// @ts-check

/**
 * @file SituationEngine.test.js
 * Covers the Tier-2 trigger rules (1-minute timer with unread messages,
 * immediate volume trigger at >=6 with timer reset), the Gemma XML parsing
 * contract (<=80-char tagged memory records + index deletions), news
 * distillation via ingestNews(), the non-fatal retry behaviour on failure,
 * reset behavior, and force-run execution.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import SituationEngine from "../../src/classes/SituationEngine.js";
import UnifiedMemory from "../../src/classes/lib/UnifiedMemory.js";
import Logger from "../../src/classes/lib/Logger.js";

/** @type {SituationEngine[]} */
const engines = [];

afterEach(() => {
    for (const engine of engines) engine.stopTicker();
    engines.length = 0;
    vi.useRealTimers();
});

/**
 * Builds an engine wired to a controllable Gemma stub.
 * @returns {{ engine: SituationEngine, geminiClient: { streamGenerate: ReturnType<typeof vi.fn>, resolveGemmaModel: ReturnType<typeof vi.fn>, resolveModel: ReturnType<typeof vi.fn> }, unifiedMemory: UnifiedMemory, ctx: import("../../src/classes/SituationEngine.js").SituationContext }}
 */
function makeEngine() {
    const logger = new Logger("Test");
    const unifiedMemory = new UnifiedMemory(logger);
    unifiedMemory.storageKey = `test_situation_memory_${crypto.randomUUID()}`;

    const geminiClient = {
        streamGenerate: vi.fn(),
        resolveGemmaModel: vi.fn().mockResolvedValue("gemma-3-27b-it"),
        resolveModel: vi.fn().mockResolvedValue("gemini-2.5-flash-lite")
    };
    const engine = new SituationEngine({ logger, geminiClient, unifiedMemory });
    engines.push(engine);

    const ctx = {
        currentDateTime: "Tue Oct 07 2026 at 14:30",
        environmentSummary: "32°C, Warm",
        location: "Gomti Nagar Rooftop",
        activeSceneTopic: "Rooftop drone repair",
        activeSceneGoal: "Finish the rotor before sunset",
        castStates: "Tom [Mood: Excited, Goal: Lead the repair] · Angela [Mood: Default, Goal: Fix rotor]",
        recentDialogue: "Tom: Chai laao yaar\nAngela: Rotor ka screw gayab hai"
    };

    return { engine, geminiClient, unifiedMemory, ctx };
}

const SUCCESS_XML = [
    "```xml",
    "<analysis>",
    "  <new_memories>",
    '    <memory tags="angela, drone" expiry="forever">Angela asked Ben to fetch a replacement rotor.</memory>',
    '    <memory tags="tom" expiry="1h">Tom promised chai in fifteen minutes.</memory>',
    "  </new_memories>",
    "</analysis>",
    "```"
].join("\n");

describe("SituationEngine — Tier-2 trigger rules", () => {
    it("stays idle below both thresholds", async () => {
        const { engine, geminiClient } = makeEngine();

        for (let i = 0; i < 5; i++) engine.recordMessage();

        expect(engine.shouldRun()).toBe(false);
        await expect(engine.executeIfDue(/** @type {any} */ ({}))).resolves.toBe(false);
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();
    });

    it("runs immediately once 6 messages have accumulated", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        for (let i = 0; i < 6; i++) engine.recordMessage();

        expect(engine.shouldRun()).toBe(true);
        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);
        expect(geminiClient.streamGenerate).toHaveBeenCalledTimes(1);
        expect(engine.unreadMessagesCount).toBe(0);
        expect(engine.shouldRun()).toBe(false);
    });

    it("runs after the 1-minute window elapses while unread messages exist", () => {
        const { engine } = makeEngine();

        engine.recordMessage();
        engine.lastRunTime = Date.now() - 61_000;

        expect(engine.shouldRun()).toBe(true);
    });

    it("stays idle after the window when no unread messages exist", () => {
        const { engine } = makeEngine();

        engine.lastRunTime = Date.now() - 10 * 60_000;

        expect(engine.shouldRun()).toBe(false);
    });

    it("resets the 1-minute timer when the volume trigger fires", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        for (let i = 0; i < 6; i++) engine.recordMessage();
        engine.lastRunTime = Date.now() - 120_000;

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        // Both triggers fired together — the timer restarts so the next
        // periodic pass waits a full minute instead of colliding.
        engine.recordMessage();
        expect(engine.shouldRun()).toBe(false);
    });

    it("runs immediately when force is true even below thresholds (init / reset)", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        expect(engine.shouldRun()).toBe(false);

        await expect(engine.executeIfDue(ctx, true)).resolves.toBe(true);
        expect(geminiClient.streamGenerate).toHaveBeenCalledTimes(1);
        expect(engine.unreadMessagesCount).toBe(0);
    });

    it("stays idle while a pass is already in flight", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        engine.recordMessage();
        engine.unreadMessagesCount = 10;
        engine.isProcessing = true;

        await expect(engine.executeIfDue(ctx)).resolves.toBe(false);
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();
    });

    it("suppresses a forced pass while one is already in flight (boot double-fire)", async () => {
        // World READY and init() both fire the forced boot pass; overlapping
        // passes used to abort each other's Gemini request (AbortError spam).
        const { engine, geminiClient, ctx } = makeEngine();
        engine.isProcessing = true;

        await expect(engine.executeIfDue(ctx, true)).resolves.toBe(false);
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();
    });

    it("drives the periodic 1-minute ticker while unread messages exist", async () => {
        vi.useFakeTimers();

        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });
        engine.lastContext = ctx;
        engine.recordMessage();

        engine.startTicker();
        engine.startTicker(); // idempotent
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(geminiClient.streamGenerate).toHaveBeenCalledTimes(1);

        // Flush the in-flight pass (model + IndexedDB I/O) to completion.
        await vi.waitFor(() => {
            expect(engine.unreadMessagesCount).toBe(0);
        });

        // Unread counter drained → the ticker stays quiet.
        await vi.advanceTimersByTimeAsync(180_000);
        expect(geminiClient.streamGenerate).toHaveBeenCalledTimes(1);

        engine.stopTicker();
    });
});

describe("SituationEngine — Gemma output parsing", () => {
    it("resolves the Gemma model dynamically instead of hardcoding a checkpoint", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });
        engine.unreadMessagesCount = 10;

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        expect(geminiClient.resolveGemmaModel).toHaveBeenCalledTimes(1);
        expect(geminiClient.streamGenerate).toHaveBeenCalledWith(
            [{ role: "user", content: expect.any(String) }],
            expect.objectContaining({ model: "gemma-3-27b-it", promptType: "situation" })
        );
    });

    it("falls back to resolveModel when no Gemma resolver is exposed", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        const looseClient = /** @type {any} */ (geminiClient);
        looseClient.resolveGemmaModel = null;
        looseClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });
        engine.unreadMessagesCount = 10;

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        expect(geminiClient.resolveModel).toHaveBeenCalledTimes(1);
        expect(geminiClient.streamGenerate).toHaveBeenCalledWith(
            [{ role: "user", content: expect.any(String) }],
            expect.objectContaining({ model: "gemini-2.5-flash-lite" })
        );
    });

    it("writes tagged memories, resets counters and never rewrites the scene", async () => {
        const { engine, geminiClient, unifiedMemory, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });
        engine.unreadMessagesCount = 10;
        engine.situationText = "Clock-aware ambient baseline set at boot.";

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        // Scene paragraphs belong to the Planner now — the engine leaves the
        // ambient baseline untouched even if the model echoes a <situation>.
        expect(engine.situationText).toBe("Clock-aware ambient baseline set at boot.");

        expect(unifiedMemory.entries).toHaveLength(2);
        expect(unifiedMemory.entries[0].tags).toEqual(["angela", "drone"]);
        expect(unifiedMemory.entries[0].expiry).toBe("forever");
        expect(unifiedMemory.entries[1].expiry).toBe("1h");

        await expect(engine.storage.getItem("situation_summary_paragraph")).resolves.toBeNull();
        expect(engine.isProcessing).toBe(false);
    });

    it("hard-caps every extracted memory at 80 characters", async () => {
        const { engine, geminiClient, unifiedMemory, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        const longMemory = "dense fact ".repeat(20).trim(); // 209 chars
        geminiClient.streamGenerate.mockResolvedValue({
            text: `<analysis><new_memories><memory tags="tom" expiry="24h">${longMemory}</memory></new_memories></analysis>`
        });

        await engine.executeIfDue(ctx);

        expect(unifiedMemory.entries).toHaveLength(1);
        expect(unifiedMemory.entries[0].data).toHaveLength(80);
    });

    it("keeps counters usable when the model omits the memory tags", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        engine.situationText = "Custom ambient text";
        geminiClient.streamGenerate.mockResolvedValue({ text: "<analysis>no memories here</analysis>" });

        await engine.executeIfDue(ctx);

        expect(engine.situationText).toBe("Custom ambient text");
        expect(engine.unreadMessagesCount).toBe(0);
    });
});

describe("SituationEngine — failure handling", () => {
    it("keeps counters for an automatic retry when Gemma fails", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        geminiClient.streamGenerate.mockRejectedValue(new Error("quota exceeded"));

        await expect(engine.executeIfDue(ctx)).resolves.toBe(false);

        expect(engine.unreadMessagesCount).toBe(10);
        expect(engine.shouldRun()).toBe(true);
        expect(engine.isProcessing).toBe(false);
    });

    it("no-ops cleanly when no Gemma client is wired", async () => {
        const logger = new Logger("Test");
        const engine = new SituationEngine({ logger, geminiClient: null, unifiedMemory: null });
        engines.push(engine);
        engine.unreadMessagesCount = 10;

        await expect(engine.executeIfDue(/** @type {any} */ ({}))).resolves.toBe(false);
        expect(engine.isProcessing).toBe(false);
    });
});

describe("SituationEngine — persistence & reset", () => {
    it("drops the legacy model-written paragraph on init()", async () => {
        const { engine } = makeEngine();
        await engine.storage.setItem("situation_summary_paragraph", "Old model paragraph.");

        await engine.init();

        await expect(engine.storage.getItem("situation_summary_paragraph")).resolves.toBeNull();
        expect(engine.situationText).toContain("Lucknow");
    });

    it("resets to the ambient baseline and clears storage on reset()", async () => {
        const { engine } = makeEngine();
        engine.situationText = "Custom situation text";
        engine.unreadMessagesCount = 8;
        await engine.storage.setItem("situation_summary_paragraph", "Custom situation text");

        await engine.reset();
        expect(engine.situationText).toContain("Lucknow");
        expect(engine.unreadMessagesCount).toBe(0);
        await expect(engine.storage.getItem("situation_summary_paragraph")).resolves.toBeNull();
    });
});

describe("SituationEngine — memory deletions & dedupe", () => {
    it("deletes stale entries listed in <deletions> by snapshot index", async () => {
        const { engine, geminiClient, unifiedMemory, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;

        // Two stale entries the model should prune by index.
        unifiedMemory.entries.push(
            { id: "stale-1", datetime: "2026-10-01 09:00", tags: ["tom"], data: "Old fact to delete", expiry: "forever" },
            { id: "keep-1", datetime: "2026-10-02 09:00", tags: ["ben"], data: "Fact to keep", expiry: "forever" }
        );

        geminiClient.streamGenerate.mockResolvedValue({
            text: [
                "<analysis>",
                "  <new_memories>",
                '    <memory tags="angela" expiry="forever">Angela landed the shoot.</memory>',
                "  </new_memories>",
                "  <deletions>",
                '    <delete index="0"/>',
                "  </deletions>",
                "</analysis>"
            ].join("\n")
        });

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        const datas = unifiedMemory.entries.map(e => e.data);
        expect(datas).not.toContain("Old fact to delete");
        expect(datas).toContain("Fact to keep");
        expect(datas).toContain("Angela landed the shoot.");
        expect(unifiedMemory.entries.map(e => e.id)).toContain("keep-1");
    });

    it("ignores out-of-range deletion indices (concurrent stack changes are safe)", async () => {
        const { engine, geminiClient, unifiedMemory, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        unifiedMemory.entries.push({
            id: "only", datetime: "2026-10-01 09:00", tags: ["tom"], data: "Only entry", expiry: "forever"
        });

        geminiClient.streamGenerate.mockResolvedValue({
            text: '<analysis><deletions><delete index="42"/></deletions></analysis>'
        });

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);
        expect(unifiedMemory.entries).toHaveLength(1);
        expect(unifiedMemory.entries[0].id).toBe("only");
    });

    it("never re-adds a memory the stack already holds verbatim", async () => {
        const { engine, geminiClient, unifiedMemory, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        unifiedMemory.entries.push({
            id: "existing", datetime: "2026-10-01 09:00", tags: ["tom"],
            data: "Tom repaired the drone rotor", expiry: "forever"
        });

        geminiClient.streamGenerate.mockResolvedValue({
            text: [
                "<analysis>",
                "  <new_memories>",
                '    <memory tags="tom" expiry="forever">Tom repaired the drone rotor</memory>',
                "  </new_memories>",
                "</analysis>"
            ].join("\n")
        });

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        const matches = unifiedMemory.entries.filter(e => e.data === "Tom repaired the drone rotor");
        expect(matches).toHaveLength(1);
        expect(matches[0].id).toBe("existing");
    });
});

describe("SituationEngine — human-message priority for memory extraction", () => {
    it("feeds the latest human message and the priority rule into the Gemma prompt", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        await expect(
            engine.executeIfDue({ ...ctx, latestHumanMessage: "drone rotor turant theek karo" }, true)
        ).resolves.toBe(true);

        const prompt = String(geminiClient.streamGenerate.mock.calls[0][0][0].content);
        expect(prompt).toContain("Latest Human Message: drone rotor turant theek karo");
        expect(prompt).toContain("PRIORITY: the human's latest message outranks");
        expect(prompt).toContain("80 characters or fewer");
    });

    it("marks an explicit '(none …)' input on autonomous passes", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        await engine.executeIfDue(ctx, true);

        const prompt = String(geminiClient.streamGenerate.mock.calls[0][0][0].content);
        expect(prompt).toContain("Latest Human Message: (none right now");
    });
});

describe("SituationEngine — news distillation (ingestNews)", () => {
    it("stores dense %world% records with a 1h expiry and a dedicated prompt", async () => {
        const { engine, geminiClient, unifiedMemory } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({
            text: [
                "<news_records>",
                "  <record>UP Cabinet approves metro extension to Gomti Nagar.</record>",
                "  <record>Lucknow girl wins national chess championship title.</record>",
                "  <record>Heatwave warning issued for western Uttar Pradesh.</record>",
                "</news_records>"
            ].join("\n")
        });

        const stored = await engine.ingestNews([
            "Cabinet clears metro plan",
            "Chess title for city player",
            "Heatwave warning today"
        ]);

        expect(stored).toBe(3);
        expect(unifiedMemory.entries).toHaveLength(3);
        for (const entry of unifiedMemory.entries) {
            expect(entry.tags).toContain("%world%");
            expect(entry.tags).toContain("news");
            expect(entry.expiry).toBe("1h");
            expect(entry.data.length).toBeLessThanOrEqual(80);
        }

        const prompt = String(geminiClient.streamGenerate.mock.calls[0][0][0].content);
        expect(prompt).toContain("Cabinet clears metro plan");
        expect(prompt).toContain("3 to 5 dense factual memory records");
        expect(prompt).toContain("80 characters or fewer");
    });

    it("clamps oversized model records to 80 chars and dedupes on re-ingest", async () => {
        const { engine, geminiClient, unifiedMemory } = makeEngine();
        const bigRecord = "city update ".repeat(15).trim();
        geminiClient.streamGenerate.mockResolvedValue({
            text: `<news_records><record>${bigRecord}</record></news_records>`
        });

        const first = await engine.ingestNews(["City update headline"]);
        expect(first).toBe(1);
        expect(unifiedMemory.entries[0].data).toHaveLength(80);

        const second = await engine.ingestNews(["City update headline"]);
        expect(second).toBe(0);
        expect(unifiedMemory.entries).toHaveLength(1);
    });

    it("returns 0 for empty headlines or a missing client", async () => {
        const { engine, geminiClient } = makeEngine();

        await expect(engine.ingestNews([])).resolves.toBe(0);
        await expect(engine.ingestNews(/** @type {any} */ (null))).resolves.toBe(0);
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();

        const bare = new SituationEngine({ logger: new Logger("Test"), geminiClient: null, unifiedMemory: null });
        engines.push(bare);
        await expect(bare.ingestNews(["Some headline"])).resolves.toBe(0);
    });

    it("shares the single-flight guard with the memory pass", async () => {
        const { engine, geminiClient } = makeEngine();
        engine.isProcessing = true;

        await expect(engine.ingestNews(["Some headline"])).resolves.toBe(0);
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();
    });
});
