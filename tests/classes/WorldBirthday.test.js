// @ts-check

/**
 * @file WorldBirthday.test.js
 * Living birthday simulation events (Task 4):
 * - tick() detects calendar-date matches and emits WorldEvents.BIRTHDAY_TODAY
 * - World.toString() injects the <active_celebration> XML context tag
 * - Events fire at most once per calendar day
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

vi.mock("../../src/classes/lib/Memory.js", () => ({
    default: class MockMemory {
        constructor() { this._m = new Map(); }
        set(k, v) { this._m.set(k, v); }
        get(k) { return this._m.get(k); }
        load() { return Promise.resolve(); }
        values() { return [...this._m.values()]; }
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

// Controllable cast: Tom's birthday matches October 6 in tests.
vi.mock("../../src/util/member.js", () => ({
    Members: [
        { id: "tom", name: "Tom", birthday: "2006-10-06", isAI: true },
        { id: "angela", name: "Angela", birthday: "2007-06-22", isAI: true }
    ]
}));

import World, { WorldEvents } from "../../src/classes/World.js";

/** @returns {World} */
function createWorld() {
    const User = { id: "human", name: "Player", birthday: "1999-05-05", isAI: false };
    const world = new World({ User });
    world.registerMembers();
    return world;
}

describe("World — living birthday simulation events", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 6, 9, 0)); // Tuesday, Oct 6 2026, 09:00
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("emits BIRTHDAY_TODAY with celebrant details on the matching date", () => {
        const world = createWorld();
        const spy = vi.fn();
        world.events.on(WorldEvents.BIRTHDAY_TODAY, spy);

        world.tick(new Date(2026, 9, 6, 9, 0));

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatchObject({
            id: "tom",
            name: "Tom",
            turningAge: 20
        });
    });

    it("emits the event at most once per calendar day", () => {
        const world = createWorld();
        const spy = vi.fn();
        world.events.on(WorldEvents.BIRTHDAY_TODAY, spy);

        world.tick(new Date(2026, 9, 6, 9, 0));
        world.tick(new Date(2026, 9, 6, 13, 30));
        world.tick(new Date(2026, 9, 6, 23, 59));

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("injects the <active_celebration> XML tag into world context", () => {
        const world = createWorld();
        world.tick(new Date(2026, 9, 6, 9, 0));

        const xml = world.toString();
        expect(xml).toContain(
            '<active_celebration type="birthday" member="tom" name="Tom" turning_age="20">'
        );
        expect(xml).toContain("Today is Tom's 20th birthday!");
        expect(xml).toContain("plan surprises");
    });

    it("does not celebrate on a non-matching date", () => {
        vi.setSystemTime(new Date(2026, 8, 6, 9, 0)); // Sep 6 2026 — nobody's birthday

        const world = createWorld();
        const spy = vi.fn();
        world.events.on(WorldEvents.BIRTHDAY_TODAY, spy);

        world.tick(new Date(2026, 8, 6, 9, 0));

        expect(spy).not.toHaveBeenCalled();
        expect(world.toString()).not.toContain("<active_celebration");
        expect(world.activeCelebrations).toEqual([]);
    });

    it("clears the celebration when the day rolls over to a non-birthday date", () => {
        const world = createWorld();
        world.tick(new Date(2026, 9, 6, 9, 0));
        expect(world.activeCelebrations).toHaveLength(1);

        world.tick(new Date(2026, 9, 7, 0, 5)); // Oct 7 — no birthday
        expect(world.activeCelebrations).toEqual([]);
        expect(world.toString()).not.toContain("<active_celebration");
    });
});
