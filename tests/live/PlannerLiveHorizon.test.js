// @ts-check

/**
 * @file PlannerLiveHorizon.test.js
 * Live storyline planning requests against Google AI Studio Gemini API
 * (gemini-3.7-flash with Groq openai/gpt-oss-120b fallback).
 *
 * Validates:
 * - planHorizon(): streaming START/TEXT/BLOCK/DONE events + ScheduleRecord schema
 * - applyUserDemand(): narrative report parsing + staged ScheduleProposal (no auto-commit)
 * - acceptProposal()/denyProposal(): persistence + state transitions
 * - reorderBlocks() → isDirty=true → restabilizeAndSave() schema-validated persistence
 *
 * Run with:
 *   npm run test:live:planner
 */

import { describe, it, expect, beforeAll } from "vitest";
import WorldSetter, { PlannerStreamEvents } from "../../src/classes/WorldSetter.js";

// Live credentials (env override supported)
const GEMINI_KEY = process.env.TEST_GEMINI_KEY || "REDACTED_GEMINI_KEY";
const GROQ_KEY = process.env.TEST_GROQ_KEY || "REDACTED_GROQ_KEY";

// Skip all tests if TEST_LIVE_API is not set
const describeLive = process.env.TEST_LIVE_API === "true" ? describe : describe.skip;

/** Full 6-member cast that characterGoals should cover. */
const CAST_IDS = ["tom", "angela", "ben", "ginger", "hank", "becca"];

/** Long timeout: live LLM horizon generation can take a couple of minutes. */
const LIVE_TIMEOUT = 300_000;

// ─── Harness ─────────────────────────────────────────────────────────────────

function makeFakeLogger() {
    const logs = [];
    /** @type {any} */
    const base = {
        info: (...args) => logs.push(["info", ...args]),
        warn: (...args) => logs.push(["warn", ...args]),
        error: (...args) => logs.push(["error", ...args]),
        debug: () => {},
        child: () => base,
    };
    return base;
}

/**
 * Minimal event bus capturing planner stream lifecycle events.
 * @returns {{ emit: (name: string, data?: unknown) => void, on: (name: string, fn: (d?: unknown) => void) => () => void, captured: Record<string, number>, payloads: Record<string, unknown[]> }}
 */
function makeEventBus() {
    /** @type {Record<string, Array<(d?: unknown) => void>>} */
    const listeners = {};
    /** @type {Record<string, number>} */
    const captured = {};
    /** @type {Record<string, unknown[]>} */
    const payloads = {};
    return {
        captured,
        payloads,
        emit(name, data) {
            captured[name] = (captured[name] || 0) + 1;
            (payloads[name] = payloads[name] || []).push(data);
            for (const fn of listeners[name] || []) fn(data);
        },
        on(name, fn) {
            (listeners[name] = listeners[name] || []).push(fn);
            return () => {
                listeners[name] = (listeners[name] || []).filter(f => f !== fn);
            };
        },
    };
}

function makeWorld() {
    return {
        now: new Date(),
        date: new Date().toDateString(),
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        tick: () => {},
        events: makeEventBus(),
        environment: null,
        activeSchedule: null,
        User: { memory: { values: () => [] } },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describeLive("Planner Live Horizon — planHorizon Streaming", () => {
    /** @type {ReturnType<typeof makeWorld>} */
    let world;
    /** @type {WorldSetter} */
    let ws;

    beforeAll(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem("tgf:gemini_api_key", GEMINI_KEY);
            localStorage.setItem("tgf:groq_api_key", GROQ_KEY);
        }
        world = makeWorld();
        ws = new WorldSetter({ logger: makeFakeLogger(), world });
    });

    it("streams START/TEXT/BLOCK/DONE events and produces valid ScheduleRecords", async () => {
        const blocks = await ws.planHorizon(new Date());

        const ev = world.events.captured;
        expect(ev[PlannerStreamEvents.START]).toBeGreaterThan(0);
        expect(ev[PlannerStreamEvents.TEXT]).toBeGreaterThan(0);
        expect((world.events.payloads[PlannerStreamEvents.TEXT] || []).join("").length).toBeGreaterThan(50);
        expect(ev[PlannerStreamEvents.BLOCK]).toBeGreaterThan(0);
        expect(ev[PlannerStreamEvents.DONE]).toBeGreaterThan(0);

        // Schema validation of every parsed block (ScheduleRecord)
        expect(Array.isArray(blocks)).toBe(true);
        expect(blocks.length).toBeGreaterThan(0);
        for (const b of blocks) {
            expect(typeof b.id).toBe("string");
            expect(typeof b.startHour).toBe("number");
            expect(typeof b.endHour).toBe("number");
            expect(b.endHour).toBeGreaterThan(b.startHour);
            expect(typeof b.topic).toBe("string");
            expect(b.topic.length).toBeGreaterThan(0);
            expect(typeof b.mainGoal).toBe("string");
            expect(Array.isArray(b.characterGoals)).toBe(true);
            expect(Array.isArray(b.facts)).toBe(true);
            expect(typeof b.prePlot).toBe("string");
            expect(typeof b.postPlot).toBe("string");

            // Soft-check cast coverage in characterGoals (log, don't hard-fail — LLM output varies)
            const goalIds = b.characterGoals.map(g => String(g.id || "").toLowerCase());
            const missing = CAST_IDS.filter(id => !goalIds.includes(id));
            if (missing.length > 0) {
                console.log(`  ⚠️ Block "${b.topic}" characterGoals missing cast members: ${missing.join(", ")}`);
            }
        }

        // Chronological, non-overlapping horizon
        const sorted = [...blocks].sort((a, b) => a.startHour - b.startHour);
        for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].startHour).toBeGreaterThanOrEqual(sorted[i - 1].endHour);
        }
        console.log(`\n📅 Horizon generated: ${blocks.length} blocks`);
        for (const b of blocks) console.log(`  • ${b.timeRange} ${b.topic}`);
    }, LIVE_TIMEOUT);
});

describeLive("Director Demand — Narrative Report & Staged Proposal", () => {
    /** @type {WorldSetter} */
    let ws;
    /** @type {ReturnType<typeof makeWorld>} */
    let world;

    beforeAll(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem("tgf:gemini_api_key", GEMINI_KEY);
            localStorage.setItem("tgf:groq_api_key", GROQ_KEY);
        }
        world = makeWorld();
        ws = new WorldSetter({ logger: makeFakeLogger(), world });
    });

    it("applyUserDemand parses narrative report and stages a proposal without auto-commit", async () => {
        ws.schedule = [
            { id: "seed-1", startHour: world.now.getHours(), endHour: world.now.getHours() + 1, timeRange: `${world.now.getHours()}:00 - ${world.now.getHours() + 1}:00`, topic: "Casual afternoon banter", mainGoal: "Relax and chat", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
        ];
        const scheduleBefore = JSON.parse(JSON.stringify(ws.schedule));

        const result = await ws.applyUserDemand("Chai break at 4:30 PM with samosas in Lucknow garage");

        // Human-readable narrative summary returned
        expect(result.line1).toBeTruthy();
        expect(result.line2).toBeTruthy();

        // Structured narrative report attached to the staged proposal
        const proposal = ws.pendingProposal;
        expect(proposal).toBeTruthy();
        expect(Array.isArray(proposal.changes)).toBe(true);
        expect(proposal.changes.length).toBeGreaterThan(0);
        expect(proposal.report).toBeTruthy();
        console.log("\n📝 Narrative Report:");
        console.log(`  Summary: ${proposal.report.summary || "(embedded)"}`);
        console.log(`  Continuity Impact: ${(proposal.report.continuityImpact || "").slice(0, 120)}`);

        // Proposal contains staged additions (+ PROPOSED) and/or removals (− REMOVED)
        const hasAdd = proposal.changes.some(c => c.action === "add");
        expect(hasAdd).toBe(true);

        // NOT auto-committed: seed schedule untouched until acceptProposal
        expect(ws.schedule.map(b => b.id)).toEqual(scheduleBefore.map(b => b.id));
        expect(ws.isDirty).toBe(true);
    }, LIVE_TIMEOUT);

    it("acceptProposal commits changes and persists the schedule", async () => {
        await ws.acceptProposal();
        expect(ws.pendingProposal).toBeNull();
        expect(ws.isDirty).toBe(false);
        expect(ws.schedule.length).toBeGreaterThan(0);

        // Persisted via storage layer (IndexedDB-backed Storage)
        const persisted = await ws.storage.getItem("world:schedule_v2");
        expect(Array.isArray(persisted)).toBe(true);
        expect(/** @type {any[]} */ (persisted).length).toBe(ws.schedule.length);
        console.log(`\n✅ Proposal accepted — ${ws.schedule.length} blocks persisted.`);
    }, LIVE_TIMEOUT);

    it("denyProposal discards staged changes without touching the schedule", async () => {
        const before = JSON.parse(JSON.stringify(ws.schedule));
        await ws.applyUserDemand("Midnight horror movie marathon on the terrace");
        expect(ws.pendingProposal).toBeTruthy();

        ws.denyProposal();
        expect(ws.pendingProposal).toBeNull();
        expect(ws.schedule.map(b => b.id)).toEqual(before.map(b => b.id));
    }, LIVE_TIMEOUT);
});

describeLive("Timeline Stabilization — Reorder → Restabilize", () => {
    /** @type {WorldSetter} */
    let ws;
    /** @type {ReturnType<typeof makeWorld>} */
    let world;

    beforeAll(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem("tgf:gemini_api_key", GEMINI_KEY);
            localStorage.setItem("tgf:groq_api_key", GROQ_KEY);
        }
        world = makeWorld();
        ws = new WorldSetter({ logger: makeFakeLogger(), world });
        ws.schedule = [
            { id: "r1", startHour: 10, endHour: 11, timeRange: "10:00 - 11:00", topic: "Morning chai", mainGoal: "Wake up chat", characterGoals: [], facts: ["Chai ready"], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
            { id: "r2", startHour: 11, endHour: 12, timeRange: "11:00 - 12:00", topic: "Garage project", mainGoal: "Fix the scooter", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
            { id: "r3", startHour: 12, endHour: 13, timeRange: "12:00 - 13:00", topic: "Lunch break", mainGoal: "Eat together", characterGoals: [], facts: [], prePlot: "", postPlot: "", createdAt: Date.now(), updatedAt: Date.now() },
        ];
    });

    it("reorderBlocks marks schedule dirty", () => {
        const firstTopicBefore = ws.schedule[0].topic;
        ws.reorderBlocks(0, "down");
        expect(ws.isDirty).toBe(true);
        expect(ws.schedule[0].topic).not.toBe(firstTopicBefore);
    });

    it("restabilizeAndSave validates schema before persisting", async () => {
        const result = await ws.restabilizeAndSave();
        if (!result.success) {
            console.log("[DEBUG] stabilization failed:", result.message, result.errors);
        }
        expect(result.success).toBe(true);
        expect(ws.isDirty).toBe(false);
        expect(Array.isArray(result.schedule)).toBe(true);
        expect(result.schedule?.length).toBeGreaterThan(0);

        for (const b of /** @type {any[]} */ (result.schedule)) {
            expect(typeof b.startHour).toBe("number");
            expect(typeof b.endHour).toBe("number");
            expect(b.endHour).toBeGreaterThan(b.startHour);
            expect(typeof b.topic).toBe("string");
            expect(Array.isArray(b.facts)).toBe(true);
        }
        console.log(`\n🔧 Stabilized schedule (${result.schedule?.length} blocks) validated & persisted.`);
    }, LIVE_TIMEOUT);
});
