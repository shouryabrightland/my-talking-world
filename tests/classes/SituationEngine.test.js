// @ts-check

/**
 * @file SituationEngine.test.js
 * Covers the Tier-2 trigger rules (>=10 messages OR >=10 minutes), the Gemma
 * XML parsing contract (<=500-char situation + tagged memory records) and the
 * non-fatal retry behaviour on failure.
 */

import { describe, it, expect, vi } from "vitest";
import SituationEngine from "../../src/classes/SituationEngine.js";
import UnifiedMemory from "../../src/classes/lib/UnifiedMemory.js";
import Logger from "../../src/classes/lib/Logger.js";

/**
 * Builds an engine wired to a controllable Gemma stub.
 * @returns {{ engine: SituationEngine, geminiClient: { streamGenerate: ReturnType<typeof vi.fn> }, unifiedMemory: UnifiedMemory, ctx: import("../../src/classes/SituationEngine.js").SituationContext }}
 */
function makeEngine() {
    const logger = new Logger("Test");
    const unifiedMemory = new UnifiedMemory(logger);
    unifiedMemory.storageKey = `test_situation_memory_${crypto.randomUUID()}`;

    const geminiClient = { streamGenerate: vi.fn() };
    const engine = new SituationEngine({ logger, geminiClient, unifiedMemory });

    const ctx = {
        currentDateTime: "Tue Oct 07 2026 at 14:30",
        environmentSummary: "32°C, Warm",
        activeSceneTopic: "Rooftop drone repair",
        activeSceneGoal: "Finish the rotor before sunset",
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
});

describe("SituationEngine — Gemma output parsing", () => {
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

describe("SituationEngine — persistence", () => {
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
});
