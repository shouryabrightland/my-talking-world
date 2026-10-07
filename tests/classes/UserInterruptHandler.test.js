// @ts-check

/**
 * @file UserInterruptHandler.test.js
 * Task 3 (send latency bypass) + Task 6 (typing settle deferral):
 * - Explicit submission with the user idle fires onRequestTurn() IMMEDIATELY
 *   (no 750ms debounce, no 3000ms stall).
 * - A submit while the user keeps typing defers until the 800ms cadence emits
 *   TYPING=false, then fires with zero added delay.
 * - A 3000ms safety net guarantees the engine is never stranded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import UserInterruptHandler from "../../src/classes/lib/UserInterruptHandler.js";
import { ChatMemberEvents } from "../../src/classes/ChatMember.js";

/**
 * Minimal human user double. Mirrors ChatMember: the internal listener binds
 * `isTyping` whenever a TYPING event is emitted.
 * @returns {{ isTyping: boolean, events: { on: Function, emit: Function } }}
 */
function makeUser() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();

    const user = {
        isTyping: false,
        events: {
            /** @param {string} event @param {Function} fn */
            on(event, fn) {
                const bucket = listeners.get(event) || [];
                bucket.push(fn);
                listeners.set(event, bucket);
                return () => listeners.set(event, (listeners.get(event) || []).filter(f => f !== fn));
            },
            /** @param {string} event @param {boolean} data */
            emit(event, data) {
                user.isTyping = data; // ChatMember binds isTyping internally
                for (const fn of [...(listeners.get(event) || [])]) fn(data);
            }
        }
    };

    return user;
}

describe("UserInterruptHandler — explicit submit trigger contract", () => {
    /** @type {UserInterruptHandler} */
    let handler;
    /** @type {ReturnType<typeof makeUser>} */
    let user;
    let onRequestTurn;
    let onCancelQueues;
    let abort;

    beforeEach(() => {
        vi.useFakeTimers();
        handler = new UserInterruptHandler({
            logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }
        });
        user = makeUser();
        onRequestTurn = vi.fn();
        onCancelQueues = vi.fn();
        abort = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /**
     * Simulates an explicit Send / Enter submission.
     * @param {boolean} typing
     * @param {boolean} [isExplicitSubmit=true]
     */
    function submit(typing = false, isExplicitSubmit = true) {
        user.isTyping = typing;
        handler.handle({
            user,
            aiMembers: [],
            aiAbortController: { abort },
            onRequestTurn,
            onCancelQueues,
            isExplicitSubmit
        });
    }

    it("fires onRequestTurn IMMEDIATELY on an explicit submit (no 750ms debounce)", () => {
        submit(false);

        // Synchronously — before any timer could run.
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("aborts in-flight AI work and cancels AI queues first", () => {
        submit(false);

        expect(abort).toHaveBeenCalledTimes(1);
        expect(onCancelQueues).toHaveBeenCalledTimes(1);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
    });

    it("defers while the user keeps typing and fires the moment the cadence settles", () => {
        submit(true); // user already typing the follow-up sentence
        expect(onRequestTurn).not.toHaveBeenCalled();

        // Typing continues for a while…
        vi.advanceTimersByTime(700);
        expect(onRequestTurn).not.toHaveBeenCalled();

        // …800ms inactivity cadence flips isTyping → false.
        user.events.emit(ChatMemberEvents.TYPING, false);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0); // no stray timers left behind
    });

    it("uses a 3000ms safety net when typing never settles", () => {
        submit(true);
        expect(onRequestTurn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2_999);
        expect(onRequestTurn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);

        // Late settle must not double-fire.
        user.events.emit(ChatMemberEvents.TYPING, false);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
    });

    it("destroy() cancels a pending deferred turn", () => {
        submit(true);
        handler.destroy();

        vi.advanceTimersByTime(5_000);
        user.events.emit(ChatMemberEvents.TYPING, false);

        expect(onRequestTurn).not.toHaveBeenCalled();
        expect(handler.isActive).toBe(false);
    });

    it("a second submit replaces the previous pending one (no double fire)", () => {
        submit(true);
        submit(true); // rapid follow-up

        user.events.emit(ChatMemberEvents.TYPING, false);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5_000);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
    });

    it("a NON-explicit trigger with the user idle keeps the legacy 750ms debounce", () => {
        submit(false, false);

        // Not synchronous — the settle debounce still applies for non-explicit triggers.
        expect(onRequestTurn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(749);
        expect(onRequestTurn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("the legacy debounce is bypassed entirely by an explicit submit", () => {
        submit(false, true);

        // Synchronous — the flag must clear timers AND fire with zero delay.
        expect(onRequestTurn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
