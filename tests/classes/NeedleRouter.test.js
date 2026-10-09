// @ts-check

/**
 * @file NeedleRouter.test.js
 * Covers the synchronous Tier-3 query router: deterministic keyword/member
 * extraction, stopword filtering, the no-Worker guarantee and the ≤1ms
 * route budget.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import NeedleRouter from "../../src/classes/lib/NeedleRouter.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("NeedleRouter — deterministic extraction", () => {
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

    it("filters English and Hinglish glue words from keywords", async () => {
        const router = new NeedleRouter();
        const result = await router.route("ke baare mein kya socha hai about the project deadline");

        expect(result.keywords).not.toContain("baare");
        expect(result.keywords).not.toContain("kya");
        expect(result.keywords).not.toContain("about");
        expect(result.keywords).not.toContain("mein");
        expect(result.keywords.length).toBeLessThanOrEqual(3);
        expect(result.keywords).toContain("project");
    });

    it("matches cast members on word boundaries only", async () => {
        const router = new NeedleRouter();
        const result = await router.route("thank you for the drone repair");

        // "thank" must never route to hank; "drone repair" carries no cast id.
        expect(result.member).toBe("any");
    });
});

describe("NeedleRouter — synchronous workerless routing", () => {
    it("never instantiates a Web Worker", async () => {
        const workerCtor = vi.fn();
        vi.stubGlobal("Worker", workerCtor);

        const router = new NeedleRouter();
        expect(router.isReady).toBe(true);

        const result = await router.route("tom ke drone plan ke baare mein bata");
        expect(result.member).toBe("tom");
        expect(workerCtor).not.toHaveBeenCalled();

        router.destroy();
        expect(router.isReady).toBe(false);
    });

    it("answers well within the 1ms route budget on average", async () => {
        const router = new NeedleRouter();
        const input = "angela ke drone wali kahani sunao, repair pending hai";

        // Warm-up pass, then measure a large batch to average out timer noise.
        await router.route(input);
        const iterations = 1000;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            await router.route(input);
        }
        const averageMs = (performance.now() - start) / iterations;

        expect(averageMs).toBeLessThan(1);
    });
});
