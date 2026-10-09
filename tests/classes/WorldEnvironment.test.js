// @ts-check

/**
 * @file WorldEnvironment.test.js
 * Phase 7.1 — Environment 1-hour schedule:
 * - refreshEnvironment() force-fetches past the 20-min cache, applies the
 *   snapshot, and emits WorldEvents.ENVIRONMENT_CHANGE
 * - startEnvironmentRefresh() re-fetches on the 1-hour cadence;
 *   pause() halts it and resume() restarts it
 * - A failed fetch keeps the last-known environment intact
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (hoisted before imports) ───

vi.mock("../../src/classes/lib/Logger.js", () => ({
    default: class MockLogger {
        constructor(name = "Mock") { this.name = name; }
        child(name) { return new MockLogger(`${this.name}:${name}`); }
        info() {}
        warn() {}
        error() {}
        debug() {}
    }
}));

vi.mock("../../src/classes/Chat.js", () => ({
    default: class MockChat {
        constructor() { this._members = new Map(); this.events = { on() { return () => {}; }, emit() {} }; }
        init() { return Promise.resolve(); }
        getMember(id) { return this._members.get(id); }
        addMember(m) { this._members.set(m.id, m); }
        getMembers() { return [...this._members.values()]; }
        destroy() {}
    },
    ChatEvents: { MESSAGE_ADD: "message:add" }
}));

vi.mock("../../src/classes/WorldSetter.js", () => ({
    default: class MockWorldSetter {
        constructor() {}
        init() { return Promise.resolve(); }
        async ensureSchedule() { return []; }
        getActiveRecord() { return null; }
    }
}));

vi.mock("../../src/util/member.js", () => ({
    Members: [
        { id: "tom", name: "Tom", birthday: "1998-04-12", isAI: true },
        { id: "angela", name: "Angela", birthday: "2000-08-02", isAI: true }
    ]
}));

vi.mock("../../src/util/environment.js", () => ({
    getEnvironmentSnapshot: vi.fn()
}));

import World, { WorldEvents, ENVIRONMENT_REFRESH_MS } from "../../src/classes/World.js";
import { getEnvironmentSnapshot } from "../../src/util/environment.js";

/** @returns {World} */
function createWorld() {
    const User = { id: "human", name: "Player", birthday: "1999-05-05", isAI: false };
    return new World({ User });
}

describe("World — 1-hour environment schedule (Phase 7.1)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(getEnvironmentSnapshot).mockReset();
        vi.mocked(getEnvironmentSnapshot).mockResolvedValue({
            city: "Lucknow, Uttar Pradesh, India",
            temperature: "30°C",
            weather: "Partly cloudy",
            humidity: "44%",
            todayCelebration: "Regular day in Lucknow",
            upcomingFestivals: ["Diwali"],
            newsHeadlines: ["Big breaking story", "Cricket update"],
            updatedAt: Date.now()
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("refreshEnvironment() force-fetches, applies the snapshot, and emits ENVIRONMENT_CHANGE", async () => {
        const world = createWorld();
        /** @type {import("../../src/classes/types/World.types").EnvironmentSnapshot[]} */
        const emitted = [];
        world.events.on(
            WorldEvents.ENVIRONMENT_CHANGE,
            (/** @type {any} */ env) => emitted.push(env),
            "test: env change"
        );

        await world.refreshEnvironment();

        // Forced refresh bypasses the util's 20-minute in-memory cache.
        expect(vi.mocked(getEnvironmentSnapshot)).toHaveBeenCalledWith(true);
        expect(world.environment?.weather).toBe("Partly cloudy");
        expect(emitted).toHaveLength(1);
        expect(emitted[0].newsHeadlines).toEqual(["Big breaking story", "Cricket update"]);
    });

    it("startEnvironmentRefresh() re-fetches on the exact 1-hour cadence", async () => {
        const world = createWorld();
        world.startEnvironmentRefresh();

        expect(ENVIRONMENT_REFRESH_MS).toBe(3_600_000);

        // Nothing fetches before the first hourly boundary.
        await vi.advanceTimersByTimeAsync(ENVIRONMENT_REFRESH_MS - 1);
        expect(vi.mocked(getEnvironmentSnapshot)).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(vi.mocked(getEnvironmentSnapshot)).toHaveBeenCalledTimes(1);

        // Second hour triggers the second refresh.
        await vi.advanceTimersByTimeAsync(ENVIRONMENT_REFRESH_MS);
        expect(vi.mocked(getEnvironmentSnapshot)).toHaveBeenCalledTimes(2);

        world.stopEnvironmentRefresh();
    });

    it("pause() halts the cycle and resume() restarts it", async () => {
        const world = createWorld();
        world.startEnvironmentRefresh();

        world.pause();
        await vi.advanceTimersByTimeAsync(2 * ENVIRONMENT_REFRESH_MS);
        expect(vi.mocked(getEnvironmentSnapshot)).not.toHaveBeenCalled();

        world.resume();
        await vi.advanceTimersByTimeAsync(ENVIRONMENT_REFRESH_MS);
        expect(vi.mocked(getEnvironmentSnapshot)).toHaveBeenCalledTimes(1);

        world.stopEnvironmentRefresh();
    });

    it("refreshEnvironment() keeps the last snapshot when the fetch fails", async () => {
        const world = createWorld();
        world.environment = /** @type {any} */ ({ city: "Lucknow (last known)" });

        vi.mocked(getEnvironmentSnapshot).mockRejectedValueOnce(new Error("network down"));

        await world.refreshEnvironment();

        expect(world.environment?.city).toBe("Lucknow (last known)");
    });
});
