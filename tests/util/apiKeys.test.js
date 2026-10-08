// @ts-check

/**
 * @file apiKeys.test.js
 * Unit tests covering the lightweight (probe-free) onboarding verification:
 * - Groq key verification via a single 1-token generation request
 * - Gemini key verification via a single GET /models discovery request
 *   (ZERO generateContent probes — the old 429 self-DoS is gone)
 * - Dual-key enforcement (both keys required)
 * - Dynamic text-model filtering + tiered priority sorting (Flash-Lite →
 *   Flash → Pro → Gemma) used by GeminiModelPool
 * - GeminiModelPool cooldown / self-healing behaviour
 * - Model blocking via localStorage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    verifyApiKey,
    verifyGeminiApiKey,
    verifyAndProbeDualKeys,
    filterTextGenerationModels,
    NON_TEXT_MODEL_MARKERS,
    getBlockedGeminiModels,
    blockGeminiModel,
    clearBlockedGeminiModels,
    getApiKey,
    setApiKey,
    clearApiKey,
    getGeminiApiKey,
    setGeminiApiKey,
    clearGeminiApiKey,
    hasApiKey,
    hasGeminiApiKey
} from "../../src/util/apiKeys.js";
import GeminiModelPool, {
    normalizeGeminiModels,
    prioritizeGeminiModels,
    tierOf,
    versionOf,
    MODEL_COOLDOWN_MS
} from "../../src/classes/lib/GeminiModelResolver.js";
import { resetAllMocks as resetGeminiMocks } from "../../src/mocks/handlers.js";

// The pool only needs getItem/setItem for its 6h ladder cache; jsdom has no
// IndexedDB, so swap in a memory-backed stand-in.
vi.mock("../../src/classes/lib/Storage.js", () => ({
    default: class MockStorage {
        constructor() {
            this._store = {};
        }
        async getItem(key) { return this._store[key] ?? null; }
        async setItem(key, value) { this._store[key] = value; }
        async removeItem(key) { delete this._store[key]; }
    }
}));

/** Logger double accepted by GeminiModelPool. */
function makeFakeLogger() {
    return {
        info() {},
        warn() {},
        error() {},
        debug() {},
        child() { return this; }
    };
}

// =========================================================================
// GROQ KEY VERIFICATION (1-TOKEN GENERATION CHECK)
// =========================================================================

describe("Groq API Key Verification (1-token generation)", () => {
    /** @type {ReturnType<typeof vi.spyOn>} */ let fetchSpy;

    beforeEach(() => {
        clearApiKey();
        fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should reject empty key", async () => {
        const result = await verifyApiKey("");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty");
        expect(result.models).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should reject invalid key format", async () => {
        const result = await verifyApiKey("invalid-groq-key");
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
        expect(result.models).toEqual([]);
    });

    it("should accept a valid key with a single max_tokens:1 generation request", async () => {
        const result = await verifyApiKey("gsk_test_key_12345");

        expect(result.valid).toBe(true);
        expect(result.error).toBeNull();

        // Exactly ONE lightweight request — no /models round trip.
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain("/chat/completions");

        const body = JSON.parse(String(init?.body));
        expect(body.max_tokens).toBe(1);
        expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
        expect(String(init?.headers?.["Authorization"] ?? "")).toContain("gsk_test_key_12345");
    });
});

// =========================================================================
// GEMINI KEY VERIFICATION (SINGLE DISCOVERY REQUEST, NO PROBES)
// =========================================================================

describe("Gemini API Key Verification (single GET /models)", () => {
    /** @type {ReturnType<typeof vi.spyOn>} */ let fetchSpy;

    beforeEach(() => {
        clearGeminiApiKey();
        resetGeminiMocks();
        fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should reject empty key without touching the network", async () => {
        const result = await verifyGeminiApiKey("");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty");
        expect(result.models).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should reject invalid key", async () => {
        const result = await verifyGeminiApiKey("invalid-key-12345");
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
        expect(result.models).toEqual([]);
    });

    it("should issue EXACTLY one request and never call generateContent", async () => {
        const result = await verifyGeminiApiKey("AIzaSyTestValidKey123");

        expect(result.valid).toBe(true);
        expect(result.error).toBeNull();

        // One discovery request total — zero generation tokens burned.
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        const [url] = fetchSpy.mock.calls[0];
        const calledUrl = String(url);
        expect(calledUrl).toContain("/v1beta/models");
        expect(calledUrl).not.toContain("generateContent");

        // No per-model probe diagnostics are produced during onboarding.
        expect(result.probeResults).toEqual([]);
        expect(result.workingModels).toBe(result.models.length);
        expect(result.workingModels).toBeGreaterThan(0);
    });

    it("should only return text-generation models", async () => {
        const result = await verifyGeminiApiKey("AIzaSyTestValidKey123");

        expect(result.models).not.toContain("text-embedding-004");
        expect(result.models).not.toContain("imagen-3.0-generate-002");
        expect(result.models).toContain("gemini-2.5-flash");
    });
});

// =========================================================================
// TEXT-MODEL FILTERING
// =========================================================================

describe("filterTextGenerationModels", () => {
    const RAW = [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
        { name: "models/gemma-3-27b-it", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        { name: "models/imagen-3.0-generate-002", supportedGenerationMethods: ["predict"] },
        { name: "models/veo-2.0", supportedGenerationMethods: ["predictLongRunning"] },
        { name: "models/gemini-audio-preview", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-tts-1", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-no-content", supportedGenerationMethods: ["countTokens"] }
    ];

    it("keeps generateContent models and strips the models/ prefix", () => {
        const ids = filterTextGenerationModels(RAW);
        expect(ids).toContain("gemini-2.5-flash");
        expect(ids).toContain("gemma-3-27b-it");
        expect(ids.every(id => !id.startsWith("models/"))).toBe(true);
    });

    it("removes embedding / imagen / veo / tts / audio models", () => {
        const ids = filterTextGenerationModels(RAW);
        expect(ids).not.toContain("text-embedding-004");
        expect(ids).not.toContain("imagen-3.0-generate-002");
        expect(ids).not.toContain("veo-2.0");
        expect(ids).not.toContain("gemini-audio-preview");
        expect(ids).not.toContain("gemini-tts-1");
        expect(ids.some(id => NON_TEXT_MODEL_MARKERS.some(m => id.includes(m)))).toBe(false);
    });

    it("removes models without generateContent support", () => {
        const ids = filterTextGenerationModels(RAW);
        expect(ids).not.toContain("gemini-no-content");
    });

    it("handles non-array payloads", () => {
        expect(filterTextGenerationModels(/** @type {any} */ (null))).toEqual([]);
        expect(filterTextGenerationModels(/** @type {any} */ ("nope"))).toEqual([]);
    });

    it("rejects nano / vision / banana / aqa / learnlm / bison and non-instruction Gemma checkpoints", () => {
        const ids = filterTextGenerationModels([
            { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-nano", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-1.0-pro-vision", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-experimental-banana", supportedGenerationMethods: ["generateContent"] },
            { name: "models/aqa", supportedGenerationMethods: ["generateContent"] },
            { name: "models/learnlm-1.5-experimental", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-1.5-pro-exp-bison", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemma-2-27b", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemma-3-27b-it", supportedGenerationMethods: ["generateContent"] }
        ]);

        expect(ids).toEqual(["gemini-2.5-flash", "gemma-3-27b-it"]);
    });

    it("keeps only the gemini- / gemma- families", () => {
        const ids = filterTextGenerationModels([
            { name: "models/other-vendor-model", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemma-2-9b-it", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] }
        ]);

        expect(ids).toEqual(["gemma-2-9b-it", "gemini-2.5-flash-lite"]);
    });
});

// =========================================================================
// DYNAMIC PRIORITY SORTING (Flash-Lite → Flash → Pro → Gemma)
// =========================================================================

describe("Gemini model pool — dynamic tiered priority", () => {
    const RAW = [
        { name: "models/gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.7-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.0-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.1-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemma-3-27b-it", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
    ];

    it("assigns tiers: Flash-Lite=1, Flash=2, Pro=3, Gemma=4, other=5", () => {
        expect(tierOf("gemini-2.5-flash-lite")).toBe(1);
        expect(tierOf("gemini-2.5-flash")).toBe(2);
        expect(tierOf("gemini-3.1-pro")).toBe(3);
        expect(tierOf("gemma-3-27b-it")).toBe(4);
        expect(tierOf("some-unknown-model")).toBe(5);
    });

    it("extracts versions for in-tier sorting", () => {
        expect(versionOf("gemini-2.5-flash")).toBe(2.5);
        expect(versionOf("gemini-3.7-flash")).toBe(3.7);
        expect(versionOf("gemma-3-27b-it")).toBe(3);
    });

    it("orders Flash-Lite → Flash → Pro → Gemma and sorts versions descending", () => {
        const ranked = prioritizeGeminiModels(normalizeGeminiModels(RAW)).map(m => m.id);

        expect(ranked).toEqual([
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash-lite",
            "gemini-3.7-flash",
            "gemini-2.5-flash",
            "gemini-1.5-flash",
            "gemini-3.1-pro",
            "gemma-3-27b-it"
        ]);
    });

    it("drops non-text models from the pool", () => {
        const ranked = prioritizeGeminiModels(normalizeGeminiModels(RAW)).map(m => m.id);
        expect(ranked).not.toContain("text-embedding-004");
    });

    it("drops nano / vision / experimental markers and base (non -it) Gemma checkpoints", () => {
        const ranked = normalizeGeminiModels([
            { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-nano", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-1.0-pro-vision", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-experimental-banana", supportedGenerationMethods: ["generateContent"] },
            { name: "models/learnlm-1.5", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemma-2-27b", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemma-2-27b-it", supportedGenerationMethods: ["generateContent"] }
        ]).map(m => m.id);

        expect(ranked).toEqual(["gemini-2.5-flash-lite", "gemma-2-27b-it"]);
    });

    it("drops locally blocked models", () => {
        const ranked = normalizeGeminiModels(RAW, ["gemini-3.7-flash"]).map(m => m.id);
        expect(ranked).not.toContain("gemini-3.7-flash");
    });
});

// =========================================================================
// DUAL-KEY ENFORCEMENT (NO PROBE LOOP)
// =========================================================================

describe("Dual-Key Verification", () => {
    /** @type {ReturnType<typeof vi.spyOn>} */ let fetchSpy;

    beforeEach(() => {
        clearApiKey();
        clearGeminiApiKey();
        resetGeminiMocks();
        fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should reject when Groq key is missing", async () => {
        const result = await verifyAndProbeDualKeys("", "AIzaSyTestValidKey123");
        expect(result.success).toBe(false);
        expect(result.error).toContain("Groq");
        expect(result.groq.valid).toBe(false);
    });

    it("should reject when Gemini key is missing", async () => {
        const result = await verifyAndProbeDualKeys("gsk_test_key_12345", "");
        expect(result.success).toBe(false);
        expect(result.error).toContain("Gemini");
        expect(result.gemini.valid).toBe(false);
    });

    it("should reject when both keys are missing", async () => {
        const result = await verifyAndProbeDualKeys("", "");
        expect(result.success).toBe(false);
        expect(result.error).toContain("Groq");
    });

    it("should reject when Groq key is invalid", async () => {
        const result = await verifyAndProbeDualKeys("invalid-groq-key", "AIzaSyTestValidKey123");
        expect(result.success).toBe(false);
        expect(result.groq.valid).toBe(false);
        expect(result.error).toContain("Groq");
    });

    it("should reject when Gemini key is invalid", async () => {
        const result = await verifyAndProbeDualKeys("gsk_test_key_12345", "invalid-key-12345");
        expect(result.success).toBe(false);
        expect(result.gemini.valid).toBe(false);
        expect(result.error).toContain("Gemini");
    });

    it("should succeed with valid dual keys using exactly two requests (no probe loop)", async () => {
        const result = await verifyAndProbeDualKeys("gsk_test_key_12345", "AIzaSyTestValidKey123");

        expect(result.success).toBe(true);
        expect(result.groq.valid).toBe(true);
        expect(result.gemini.valid).toBe(true);
        expect(result.gemini.workingModels).toBeGreaterThan(0);

        // 1 Groq 1-token generation + 1 Gemini discovery = 2 requests total.
        // Anything more would risk exhausting the 15 RPM free-tier quota.
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        // No generation probes are ever surfaced to the UI.
        expect(result.gemini.probeResults).toEqual([]);
    });
});

// =========================================================================
// GEMINI MODEL POOL — DISCOVERY, COOLDOWN, SELF-HEALING
// =========================================================================

describe("GeminiModelPool", () => {
    beforeEach(() => {
        resetGeminiMocks();
        clearGeminiApiKey();
        clearBlockedGeminiModels();
    });

    afterEach(() => {
        clearGeminiApiKey();
    });

    it("returns an empty ladder when no API key is configured", async () => {
        const pool = new GeminiModelPool(makeFakeLogger());
        expect(await pool.getCandidates()).toEqual([]);
        expect(await pool.getActiveModel()).toBeNull();
        expect(await pool.getGemmaModel()).toBeNull();
    });

    it("discovers and ranks models dynamically (no hardcoded ids)", async () => {
        setGeminiApiKey("AIzaSyTestValidKey123");
        const pool = new GeminiModelPool(makeFakeLogger());

        const candidates = await pool.getCandidates();
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].tier).toBe(1);

        const ids = candidates.map(m => m.id);
        expect(ids).not.toContain("text-embedding-004");
        expect(ids).not.toContain("imagen-3.0-generate-002");
        expect(ids.every(id => typeof id === "string" && id.length > 0)).toBe(true);
        expect(await pool.getActiveModel()).toBe(candidates[0].id);
    });

    it("getGemmaModel() returns the active Gemma model and falls back to the top Gemini model", async () => {
        setGeminiApiKey("AIzaSyTestValidKey123");
        const pool = new GeminiModelPool(makeFakeLogger());

        const candidates = await pool.getCandidates();
        const gemma = candidates.find(c => c.id.toLowerCase().includes("gemma"));
        expect(gemma).toBeTruthy();
        expect(await pool.getGemmaModel()).toBe(gemma && gemma.id);

        // Every Gemma model cooling down → highest-priority active text model.
        pool.reportFailure(String(gemma && gemma.id), 429);
        const remaining = await pool.getCandidates();
        expect(remaining.some(c => c.id.toLowerCase().includes("gemma"))).toBe(false);
        expect(remaining.length).toBeGreaterThan(0);
        // Fallback is the top-ranked Gemini text model (Flash-Lite, tier 1).
        expect(remaining[0].isFlashLite).toBe(true);
        expect(await pool.getGemmaModel()).toBe(remaining[0].id);
    });

    it("ejects a 429 model into cooldown for 5 minutes and restores it after success", async () => {
        setGeminiApiKey("AIzaSyTestValidKey123");
        const pool = new GeminiModelPool(makeFakeLogger());

        const before = await pool.getCandidates();
        expect(before.length).toBeGreaterThan(1);
        const top = before[0].id;

        expect(pool.reportFailure(top, 429)).toBe(true);
        expect(pool.cooldownRemaining(top)).toBeGreaterThan(0);
        expect(pool.cooldownRemaining(top)).toBeLessThanOrEqual(MODEL_COOLDOWN_MS);
        expect(pool.snapshot()).toHaveProperty(top);

        const cooled = await pool.getCandidates();
        expect(cooled.map(m => m.id)).not.toContain(top);

        // Self-healing: a success clears the cooldown immediately.
        pool.reportSuccess(top);
        const restored = await pool.getCandidates();
        expect(restored.map(m => m.id)).toContain(top);
    });

    it("cools down on 503/timeouts, permanently ejects 404/400, and ignores unrelated statuses", async () => {
        setGeminiApiKey("AIzaSyTestValidKey123");
        const pool = new GeminiModelPool(makeFakeLogger());
        const candidates = await pool.getCandidates();
        expect(candidates.length).toBeGreaterThan(4);

        // Transient failures → 5-minute cooldown (self-healing).
        expect(pool.reportFailure(candidates[0].id, 503)).toBe(true);
        expect(pool.cooldownRemaining(candidates[0].id)).toBeGreaterThan(0);

        // Permanent failures → session-long ejection.
        expect(pool.reportFailure(candidates[1].id, 404)).toBe(true);
        expect(pool.reportFailure(candidates[3].id, 400)).toBe(true);

        // Timeout → transient cooldown. Unrelated statuses are ignored.
        expect(pool.reportFailure(candidates[2].id, null)).toBe(true);
        expect(pool.reportFailure(candidates[4].id, 403)).toBe(false);

        const remaining = await pool.getCandidates();
        const remainingIds = remaining.map(m => m.id);
        expect(remainingIds).not.toContain(candidates[0].id);
        expect(remainingIds).not.toContain(candidates[1].id);
        expect(remainingIds).not.toContain(candidates[2].id);
        expect(remainingIds).not.toContain(candidates[3].id);
        expect(remainingIds).toContain(candidates[4].id);

        // Permanently ejected models are NEVER revived — even by a success.
        pool.reportSuccess(candidates[1].id);
        pool.reportSuccess(candidates[3].id);
        const afterSuccess = (await pool.getCandidates()).map(m => m.id);
        expect(afterSuccess).not.toContain(candidates[1].id);
        expect(afterSuccess).not.toContain(candidates[3].id);
    });

    it("reports an empty pool once every model is cooling down", async () => {
        setGeminiApiKey("AIzaSyTestValidKey123");
        const pool = new GeminiModelPool(makeFakeLogger());

        const candidates = await pool.getCandidates();
        expect(candidates.length).toBeGreaterThan(0);
        for (const model of candidates) pool.reportFailure(model.id, 429);

        expect(await pool.getCandidates()).toEqual([]);
        expect(await pool.getActiveModel()).toBeNull();
    });
});

// =========================================================================
// BLOCKED MODEL STORAGE
// =========================================================================

describe("Blocked Model Storage", () => {
    beforeEach(() => {
        clearBlockedGeminiModels();
    });

    it("should store and retrieve blocked models", () => {
        expect(getBlockedGeminiModels()).toEqual([]);

        blockGeminiModel("gemini-3.1-pro");
        const blocked = getBlockedGeminiModels();
        expect(blocked).toContain("gemini-3.1-pro");
        expect(blocked.length).toBe(1);
    });

    it("should not duplicate blocked models", () => {
        blockGeminiModel("gemini-3.1-pro");
        blockGeminiModel("gemini-3.1-pro");
        expect(getBlockedGeminiModels().length).toBe(1);
    });

    it("should clear all blocked models", () => {
        blockGeminiModel("gemini-3.1-pro");
        blockGeminiModel("gemini-3.5-flash");
        clearBlockedGeminiModels();
        expect(getBlockedGeminiModels()).toEqual([]);
    });
});

// =========================================================================
// LOCAL STORAGE KEY HELPERS
// =========================================================================

describe("Key Storage Helpers", () => {
    beforeEach(() => {
        clearApiKey();
        clearGeminiApiKey();
    });

    it("should store and retrieve Groq key", () => {
        expect(hasApiKey()).toBe(false);
        setApiKey("gsk_test_12345");
        expect(hasApiKey()).toBe(true);
        expect(getApiKey()).toBe("gsk_test_12345");
    });

    it("should store and retrieve Gemini key", () => {
        expect(hasGeminiApiKey()).toBe(false);
        setGeminiApiKey("AIzaSyTestKey");
        expect(hasGeminiApiKey()).toBe(true);
        expect(getGeminiApiKey()).toBe("AIzaSyTestKey");
    });

    it("should clear keys", () => {
        setApiKey("gsk_test_12345");
        setGeminiApiKey("AIzaSyTestKey");
        clearApiKey();
        clearGeminiApiKey();
        expect(hasApiKey()).toBe(false);
        expect(hasGeminiApiKey()).toBe(false);
    });

    it("should trim whitespace from keys", () => {
        setApiKey("  gsk_test_12345  ");
        expect(getApiKey()).toBe("gsk_test_12345");
    });
});

// =========================================================================
// CONSTANTS
// =========================================================================

describe("Constants", () => {
    it("should define non-text model markers used by verification and the pool", () => {
        expect(NON_TEXT_MODEL_MARKERS).toBeInstanceOf(Array);
        expect(NON_TEXT_MODEL_MARKERS).toContain("embedding");
        expect(NON_TEXT_MODEL_MARKERS).toContain("imagen");
        expect(NON_TEXT_MODEL_MARKERS).toContain("veo");
        expect(NON_TEXT_MODEL_MARKERS).toContain("tts");
        expect(NON_TEXT_MODEL_MARKERS).toContain("audio");
        expect(NON_TEXT_MODEL_MARKERS).toContain("nano");
        expect(NON_TEXT_MODEL_MARKERS).toContain("vision");
        expect(NON_TEXT_MODEL_MARKERS).toContain("aqa");
        expect(NON_TEXT_MODEL_MARKERS).toContain("learnlm");
        expect(NON_TEXT_MODEL_MARKERS).toContain("banana");
        expect(NON_TEXT_MODEL_MARKERS).toContain("bison");
        expect(NON_TEXT_MODEL_MARKERS).toContain("gecko");
    });

    it("should use a 5 minute self-healing cooldown window", () => {
        expect(MODEL_COOLDOWN_MS).toBe(300_000);
    });
});
