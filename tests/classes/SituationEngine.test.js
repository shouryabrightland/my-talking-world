// @ts-check

/**
 * @file SituationEngine.test.js
 * Covers the Tier-2 trigger rules (>=10 messages OR >=10 minutes), the Gemma
 * XML parsing contract (<=500-char situation + tagged memory records), the
 * non-fatal retry behaviour on failure, reset behavior, and force-run execution.
 */

import { describe, it, expect, vi } from "vitest";
import SituationEngine from "../../src/classes/SituationEngine.js";
import UnifiedMemory from "../../src/classes/lib/UnifiedMemory.js";
import Logger from "../../src/classes/lib/Logger.js";

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
    "  <situation>Cast is clustered on the Gomti Nagar rooftop repairing Angela's drone, chai going cold on the ledge.</situation>",
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

        for (let i = 0; i < 9; i++) engine.recordMessage();

        expect(engine.shouldRun()).toBe(false);
        await expect(engine.executeIfDue(/** @type {any} */ ({}))).resolves.toBe(false);
        expect(geminiClient.streamGenerate).not.toHaveBeenCalled();
    });

    it("runs once 10 messages have accumulated", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        for (let i = 0; i < 10; i++) engine.recordMessage();

        expect(engine.shouldRun()).toBe(true);
        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);
        expect(geminiClient.streamGenerate).toHaveBeenCalledTimes(1);
        expect(engine.unreadMessagesCount).toBe(0);
        expect(engine.shouldRun()).toBe(false);
    });

    it("runs immediately when force is true even below thresholds (init / reset)", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        expect(engine.shouldRun()).toBe(false);

        await expect(engine.executeIfDue(ctx, true)).resolves.toBe(true);
        expect(geminiClient.streamGenerate).toHaveBeenCalledTimes(1);
        expect(engine.unreadMessagesCount).toBe(0);
        expect(engine.situationText).toContain("Gomti Nagar rooftop");
    });

    it("runs once the 10-minute window has elapsed", () => {
        const { engine } = makeEngine();

        engine.lastRunTime = Date.now() - 11 * 60 * 1000;

        expect(engine.shouldRun()).toBe(true);
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

    it("updates the situation paragraph, writes tagged memories and resets counters", async () => {
        const { engine, geminiClient, unifiedMemory, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });
        engine.unreadMessagesCount = 10;

        await expect(engine.executeIfDue(ctx)).resolves.toBe(true);

        expect(engine.situationText).toContain("Gomti Nagar rooftop");
        expect(engine.situationText.length).toBeLessThanOrEqual(500);

        expect(unifiedMemory.entries).toHaveLength(2);
        expect(unifiedMemory.entries[0].tags).toEqual(["angela", "drone"]);
        expect(unifiedMemory.entries[0].expiry).toBe("forever");
        expect(unifiedMemory.entries[1].expiry).toBe("1h");

        await expect(engine.storage.getItem("situation_summary_paragraph")).resolves.toBe(engine.situationText);
        expect(engine.isProcessing).toBe(false);
    });

    it("caps the situation paragraph at 500 characters", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        geminiClient.streamGenerate.mockResolvedValue({
            text: `<analysis><situation>${"rambling ".repeat(120)}</situation></analysis>`
        });

        await engine.executeIfDue(ctx);

        expect(engine.situationText).toHaveLength(500);
    });

    it("keeps the previous situation when the model omits the tag", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        engine.unreadMessagesCount = 10;
        const before = engine.situationText;
        geminiClient.streamGenerate.mockResolvedValue({ text: "<analysis>no situation tag</analysis>" });

        await engine.executeIfDue(ctx);

        expect(engine.situationText).toBe(before);
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
        engine.unreadMessagesCount = 10;

        await expect(engine.executeIfDue(/** @type {any} */ ({}))).resolves.toBe(false);
        expect(engine.isProcessing).toBe(false);
    });
});

describe("SituationEngine — persistence & reset", () => {
    it("hydrates the saved situation paragraph on init()", async () => {
        const { engine } = makeEngine();
        await engine.storage.setItem("situation_summary_paragraph", "Restored paragraph from storage.");

        const engine2 = new SituationEngine({
            logger: new Logger("Test"),
            geminiClient: { streamGenerate: vi.fn() },
            unifiedMemory: null
        });
        engine2.storage = engine.storage;

        await engine2.init();

        expect(engine2.situationText).toBe("Restored paragraph from storage.");
    });

    it("resets to DEFAULT_SITUATION and clears storage on reset()", async () => {
        const { engine } = makeEngine();
        engine.situationText = "Custom situation text";
        engine.unreadMessagesCount = 8;
        await engine.storage.setItem("situation_summary_paragraph", "Custom situation text");

        await engine.reset();        expect(engine.situationText).toContain("Lucknow");
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
                "  <situation>Cast is on the rooftop.</situation>",
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
            text: '<analysis><situation>ok.</situation><deletions><delete index="42"/></deletions></analysis>'
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
                "  <situation>Cast is on the rooftop.</situation>",
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

describe("SituationEngine — human-message priority over the situation", () => {
    it("feeds the latest human message and the priority rule into the Gemma prompt", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        await expect(
            engine.executeIfDue({ ...ctx, latestHumanMessage: "drone rotor turant theek karo" }, true)
        ).resolves.toBe(true);

        const prompt = String(geminiClient.streamGenerate.mock.calls[0][0][0].content);
        expect(prompt).toContain("Latest Human Message: drone rotor turant theek karo");
        expect(prompt).toContain("PRIORITY: the human's latest message outranks");
    });

    it("marks an explicit '(none …)' input on autonomous passes", async () => {
        const { engine, geminiClient, ctx } = makeEngine();
        geminiClient.streamGenerate.mockResolvedValue({ text: SUCCESS_XML });

        await engine.executeIfDue(ctx, true);

        const prompt = String(geminiClient.streamGenerate.mock.calls[0][0][0].content);
        expect(prompt).toContain("Latest Human Message: (none right now");
    });
});
