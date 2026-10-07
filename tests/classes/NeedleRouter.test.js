// @ts-check

/**
 * @file NeedleRouter.test.js
 * Covers the Tier-3 query router: deterministic fallback extraction, the
 * worker round-trip correlation, and the 300ms latency budget fallback.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import NeedleRouter from "../../src/classes/lib/NeedleRouter.js";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("NeedleRouter — deterministic fallback", () => {
    it("extracts up to 3 keywords and the target cast id", async () => {
        const router = new NeedleRouter();
        const result = await router.route("Tom, drone repair ke baare mein kya socha?");

        expect(result.member).toBe("tom");
        expect(result.keywords.length).toBeGreaterThan(0);
        expect(result.keywords.length).toBeLessThanOrEqual(3);
        expect(result.keywords).not.toContain("drone repair ke baare mein kya socha?");
    });

    it("resolves member 'any' when no cast member is named", async () => {
        const router = new NeedleRouter();
        const result = await router.route("aaj ka scene kitna mast hai");

        expect(result.member).toBe("any");
    });

    it("resolves an empty route for blank input without touching a worker", async () => {
        const router = new NeedleRouter();

        await expect(router.route("")).resolves.toEqual({ keywords: [], member: "any" });
        await expect(router.route("   ")).resolves.toEqual({ keywords: [], member: "any" });
        await expect(router.route(/** @type {any} */ (null))).resolves.toEqual({ keywords: [], member: "any" });
    });

    it("never rejects", async () => {
        const router = new NeedleRouter();
        await expect(router.route("becca ke project deadline kya hai")).resolves.toMatchObject({ member: "becca" });
    });
});

describe("NeedleRouter — worker round-trip", () => {
    it("resolves with the worker result correlated by request id", async () => {
        class FakeWorker {
            /** @type {Function[]} */
            listeners = [];
            postMessage(/** @type {{ id: string, type: string }} */ msg) {
                if (msg.type === "EXTRACT_KEYWORDS") {
                    const result = { keywords: ["needle-hit"], member: "becca" };
                    queueMicrotask(() => {
                        for (const handler of this.listeners) handler({ data: { id: msg.id, type: "RESULT", result } });
                    });
                }
            }
            addEventListener(_type, handler) { this.listeners.push(handler); }
            removeEventListener(_type, handler) { this.listeners = this.listeners.filter(h => h !== handler); }
            terminate() {}
        }

        vi.stubGlobal("Worker", FakeWorker);

        const router = new NeedleRouter();
        expect(router.isReady).toBe(true);

        const result = await router.route("becca ke project deadline ke baare mein batao");
        expect(result).toEqual({ keywords: ["needle-hit"], member: "becca" });

        router.destroy();
        expect(router.isReady).toBe(false);
    });

    it("falls back to deterministic extraction after the 300ms budget", async () => {
        vi.useFakeTimers();

        class SilentWorker {
            postMessage() { /* never responds */ }
            addEventListener() {}
            removeEventListener() {}
            terminate() {}
        }

        vi.stubGlobal("Worker", SilentWorker);

        const router = new NeedleRouter();
        expect(router.isReady).toBe(true);

        const pending = router.route("angela ke drone wali kahani sunao");
        await vi.advanceTimersByTimeAsync(310);

        const result = await pending;
        expect(result.member).toBe("angela");
        expect(result.keywords.length).toBeGreaterThan(0);
    });

    it("ignores unrelated worker messages", async () => {
        vi.useFakeTimers();

        class NoisyWorker {
            /** @type {Function[]} */
            listeners = [];
            postMessage() {
                queueMicrotask(() => {
                    for (const handler of this.listeners) handler({ data: { id: "someone-else", type: "RESULT", result: { keywords: ["nope"], member: "nobody" } } });
                });
            }
            addEventListener(_type, handler) { this.listeners.push(handler); }
            removeEventListener(_type, handler) { this.listeners = this.listeners.filter(h => h !== handler); }
            terminate() {}
        }

        vi.stubGlobal("Worker", NoisyWorker);

        const router = new NeedleRouter();
        const pending = router.route("tom ke chai plan ke baare mein bata");
        await vi.advanceTimersByTimeAsync(0);

        // Unrelated ids are ignored; the latency budget still answers.
        await vi.advanceTimersByTimeAsync(310);
        const result = await pending;
        expect(result.member).toBe("tom");
    });
});
