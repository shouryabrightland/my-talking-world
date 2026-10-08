// @ts-check

/**
 * @file GroqModelPool.test.js
 * Task 3 + Task 4 pool introspection:
 * - minCooldownRemaining() → shortest remaining cooldown across cooling models.
 * - allModelsBlocked()     → true only when NO model can serve a request.
 * - listModels()           → DevTools snapshot with healthy/cooling/ejected status.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───

const LADDER = [
    { id: "qwen/qwen3-32b", displayName: "Qwen3 32B", tier: 2, version: 3 },
    { id: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B Versatile", tier: 2, version: 3.3 },
    { id: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B", tier: 2, version: 120 }
];

vi.mock("../../src/classes/lib/Storage.js", () => ({
    default: class MockStorage {
        constructor() { /* no persistence needed */ }
        async getItem() {
            return { ladder: LADDER.map(e => ({ ...e })), fetchedAt: Date.now() };
        }
        async setItem() {}
        async removeItem() {}
        async clear() {}
    }
}));

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

// ─── Import after mocks ───

import GroqModelPool from "../../src/classes/lib/GroqModelPool.js";
import Logger from "../../src/classes/lib/Logger.js";

describe("GroqModelPool — cooldown & snapshot introspection", () => {
    /** @type {GroqModelPool} */
    let pool;

    beforeEach(async () => {
        pool = new GroqModelPool(new Logger("Test"));
        // Populates #entries from the mocked 6h cache.
        const candidates = await pool.getCandidates();
        expect(candidates.length).toBe(LADDER.length);
    });

    it("drops stale sub-12B entries (e.g. allam-2-7b) from a pre-restriction cache", async () => {
        // A cache written by an older build can still hold sub-12B models.
        // Loading it must re-apply the current >=12B filter before the ladder
        // is ever exposed to model selection.
        const stalePool = new GroqModelPool(new Logger("StaleCache"));
        stalePool.storage.getItem = async () => ({
            ladder: [
                { id: "allam-2-7b", displayName: "ALLaM 2 7B", tier: 1, version: 2 },
                { id: "llama-3.1-8b-instant", displayName: "Llama 3.1 8B Instant", tier: 1, version: 3.1 },
                { id: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B Versatile", tier: 2, version: 3.3 }
            ],
            fetchedAt: Date.now()
        });

        const ids = (await stalePool.getCandidates()).map(c => c.id);

        expect(ids).toContain("llama-3.3-70b-versatile");
        expect(ids).not.toContain("allam-2-7b");
        expect(ids).not.toContain("llama-3.1-8b-instant");
        expect(stalePool.activeModelId).toBe("llama-3.3-70b-versatile");
        expect(stalePool.listModels().map(m => m.id)).not.toContain("allam-2-7b");
    });

    it("reports a healthy pool as not blocked with no cooldown", () => {
        expect(pool.allModelsBlocked()).toBe(false);
        expect(pool.minCooldownRemaining()).toBe(null);

        const models = pool.listModels();
        expect(models).toHaveLength(LADDER.length);
        expect(models.every(m => m.status === "healthy")).toBe(true);
        expect(models.every(m => m.isActive)).toBe(true);
        expect(models.every(m => m.cooldownRemainingMs === null)).toBe(true);
    });

    it("minCooldownRemaining returns the SHORTEST remaining cooldown", () => {
        pool.reportFailure("llama-3.3-70b-versatile", 429, 30_000);
        pool.reportFailure("openai/gpt-oss-120b", 503, 5_000);

        const min = pool.minCooldownRemaining();
        expect(min).not.toBeNull();
        expect(min).toBeGreaterThan(0);
        expect(min).toBeLessThanOrEqual(5_000);

        // One model is still free → the pool is not blocked.
        expect(pool.allModelsBlocked()).toBe(false);
    });

    it("allModelsBlocked only flips true when every candidate is unavailable", async () => {
        pool.reportFailure("qwen/qwen3-32b", 429, 10_000);
        expect(pool.allModelsBlocked()).toBe(false);

        pool.reportFailure("llama-3.3-70b-versatile", 429, 10_000);
        expect(pool.allModelsBlocked()).toBe(false);

        pool.reportFailure("openai/gpt-oss-120b", 429, 10_000);
        expect(pool.allModelsBlocked()).toBe(true);
        expect(pool.minCooldownRemaining()).toBeGreaterThan(0);

        // Recovery of any single model unblocks the pool immediately — while
        // the remaining cooldowns keep counting down independently.
        pool.reportSuccess("qwen/qwen3-32b");
        expect(pool.allModelsBlocked()).toBe(false);
        expect(pool.minCooldownRemaining()).toBeGreaterThan(0);

        const active = await pool.getCandidates();
        expect(active.length).toBeGreaterThan(0);
    });

    it("listModels marks cooling models with a remaining cooldown", () => {
        pool.reportFailure("llama-3.3-70b-versatile", 429, 12_000);

        const cooling = pool.listModels().find(m => m.id === "llama-3.3-70b-versatile");
        expect(cooling).toBeDefined();
        expect(cooling?.status).toBe("cooling");
        expect(cooling?.cooldownRemainingMs).toBeGreaterThan(0);
        expect(cooling?.cooldownRemainingMs).toBeLessThanOrEqual(12_000);
        expect(cooling?.isActive).toBe(false);

        const healthy = pool.listModels().find(m => m.id === "qwen/qwen3-32b");
        expect(healthy?.status).toBe("healthy");
        expect(healthy?.isActive).toBe(true);
    });

    it("listModels marks 400/404 models as ejected and never revives them", async () => {
        pool.reportFailure("openai/gpt-oss-120b", 404);

        const ejected = pool.listModels().find(m => m.id === "openai/gpt-oss-120b");
        expect(ejected?.status).toBe("ejected");
        expect(ejected?.isActive).toBe(false);

        // Ejected models never come back — even on success.
        pool.reportSuccess("openai/gpt-oss-120b");
        expect(pool.listModels().find(m => m.id === "openai/gpt-oss-120b")?.status).toBe("ejected");

        const candidates = await pool.getCandidates();
        expect(candidates.some(c => c.id === "openai/gpt-oss-120b")).toBe(false);

        // Ejections are excluded from cooldown math (they never recover):
        // block the pool by cooling the two remaining live models.
        pool.reportFailure("qwen/qwen3-32b", 429, 9_000);
        expect(pool.allModelsBlocked()).toBe(false);

        pool.reportFailure("llama-3.3-70b-versatile", 429, 4_000);
        expect(pool.allModelsBlocked()).toBe(true);
        expect(pool.minCooldownRemaining()).toBeLessThanOrEqual(4_000);
    });
});
