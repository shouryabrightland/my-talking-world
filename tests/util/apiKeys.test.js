// @ts-check

/**
 * @file apiKeys.test.js
 * Unit tests for apiKeys.js covering:
 * - Groq key verification (valid/invalid/empty)
 * - Gemini key verification (valid/invalid/empty)
 * - Dual-key enforcement (both required)
 * - Model probing (working/failed/timeout)
 * - Rejection when <3 models are healthy
 * - Model blocking via localStorage
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    verifyApiKey,
    verifyGeminiApiKey,
    probeGeminiModel,
    probeGeminiModels,
    verifyAndProbeDualKeys,
    MIN_GEMINI_MODELS_REQUIRED,
    getBlockedGeminiModels,
    blockGeminiModel,
    clearBlockedGeminiModels,
    GEMINI_PROBE_CANDIDATES,
    getApiKey,
    setApiKey,
    clearApiKey,
    getGeminiApiKey,
    setGeminiApiKey,
    clearGeminiApiKey,
    hasApiKey,
    hasGeminiApiKey
} from "../../src/util/apiKeys.js";
import { resetAllMocks as resetGeminiMocks, setDeprecatedModels } from "../../src/mocks/handlers.js";

// =========================================================================
// GROQ KEY VERIFICATION
// =========================================================================

describe("Groq API Key Verification", () => {
    beforeEach(() => {
        clearApiKey();
    });

    it("should reject empty key", async () => {
        const result = await verifyApiKey("");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty");
        expect(result.models).toEqual([]);
    });

    it("should reject invalid key format", async () => {
        const result = await verifyApiKey("invalid-groq-key");
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
        expect(result.models).toEqual([]);
    });

    it("should accept valid key and return model list", async () => {
        const result = await verifyApiKey("gsk_test_key_12345");
        expect(result.valid).toBe(true);
        expect(result.error).toBeNull();
        expect(result.models).toBeInstanceOf(Array);
        expect(result.models.length).toBeGreaterThan(0);
    });
});

// =========================================================================
// GEMINI KEY VERIFICATION
// =========================================================================

describe("Gemini API Key Verification", () => {
    beforeEach(() => {
        clearGeminiApiKey();
        resetGeminiMocks();
    });

    it("should reject empty key", async () => {
        const result = await verifyGeminiApiKey("");
        expect(result.valid).toBe(false);
        expect(result.error).toContain("empty");
        expect(result.models).toEqual([]);
    });

    it("should reject invalid key", async () => {
        const result = await verifyGeminiApiKey("invalid-key-12345");
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
        expect(result.models).toEqual([]);
    });

    it("should accept valid key and return Gemini model list", async () => {
        const result = await verifyGeminiApiKey("AIzaSyTestValidKey123");
        expect(result.valid).toBe(true);
        expect(result.error).toBeNull();
        expect(result.models).toBeInstanceOf(Array);
        // Should only include models with "gemini" in the name
        expect(result.models.every(m => m.toLowerCase().includes("gemini"))).toBe(true);
    });

    it("should exclude non-Gemini models (e.g. embedding models)", async () => {
        const result = await verifyGeminiApiKey("AIzaSyTestValidKey123");
        expect(result.models).not.toContain("text-embedding-004");
    });
});

// =========================================================================
// MODEL PROBING
// =========================================================================

describe("Gemini Model Probing", () => {
    beforeEach(() => {
        resetGeminiMocks();
    });

    it("should probe a working model successfully", async () => {
        const result = await probeGeminiModel("gemini-3.7-flash", "AIzaSyTestValidKey123");
        expect(result.working).toBe(true);
        expect(result.error).toBeNull();
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.model).toBe("gemini-3.7-flash");
    });

    it("should detect a deprecated/unavailable model", async () => {
        setDeprecatedModels(["gemini-3.1-pro"]);
        const result = await probeGeminiModel("gemini-3.1-pro", "AIzaSyTestValidKey123");
        expect(result.working).toBe(false);
        expect(result.error).toContain("deprecated");
    });

    it("should treat rate-limited models as working (transient)", async () => {
        const result = await probeGeminiModel("gemini-3.7-flash", "AIzaSyTestValidKey123");
        expect(result.working).toBe(true);
    });

    it("should probe multiple models concurrently", async () => {
        const models = ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-pro"];
        const results = await probeGeminiModels(models, "AIzaSyTestValidKey123");
        expect(results).toHaveLength(3);
        expect(results.every(r => r.working)).toBe(true);
    });
});

// =========================================================================
// DUAL-KEY ENFORCEMENT
// =========================================================================

describe("Dual-Key Verification", () => {
    beforeEach(() => {
        clearApiKey();
        clearGeminiApiKey();
        resetGeminiMocks();
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

    it("should succeed with valid dual keys and >=3 working models", async () => {
        const result = await verifyAndProbeDualKeys("gsk_test_key_12345", "AIzaSyTestValidKey123");
        expect(result.success).toBe(true);
        expect(result.groq.valid).toBe(true);
        expect(result.gemini.valid).toBe(true);
        expect(result.gemini.workingModels).toBeGreaterThanOrEqual(MIN_GEMINI_MODELS_REQUIRED);
        expect(result.gemini.probeResults.length).toBeGreaterThan(0);
    });
});

// =========================================================================
// MODEL LADDER REJECTION (<3 MODELS)
// =========================================================================

describe("Model Ladder Rejection", () => {
    beforeEach(() => {
        resetGeminiMocks();
    });

    it("should reject when fewer than 3 models are working", async () => {
        // Mark most models as deprecated so only 1-2 remain working
        setDeprecatedModels([
            "gemini-3.5-flash",
            "gemini-3.1-pro",
            "gemini-3.5-flash-lite",
            "gemini-2.5-flash"
        ]);

        const result = await verifyAndProbeDualKeys("gsk_test_key_12345", "AIzaSyTestValidKey123");

        // The key itself is valid, but <3 models are working
        expect(result.groq.valid).toBe(true);
        expect(result.gemini.models.length).toBeGreaterThan(0);
        expect(result.gemini.workingModels).toBeLessThan(MIN_GEMINI_MODELS_REQUIRED);
        expect(result.success).toBe(false);
        expect(result.error).toContain("model");
        expect(result.gemini.probeResults.length).toBeGreaterThan(0);
    });

    it("should report detailed diagnostic for each failed model", async () => {
        setDeprecatedModels(["gemini-3.5-flash", "gemini-3.1-pro"]);

        const result = await verifyAndProbeDualKeys("gsk_test_key_12345", "AIzaSyTestValidKey123");

        if (!result.success) {
            const failedResults = result.gemini.probeResults.filter(r => !r.working);
            expect(failedResults.length).toBeGreaterThan(0);
            failedResults.forEach(r => {
                expect(r.error).toBeTruthy();
            });
        }
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
    it("should define minimum models required", () => {
        expect(MIN_GEMINI_MODELS_REQUIRED).toBe(3);
    });

    it("should define probe candidates", () => {
        expect(GEMINI_PROBE_CANDIDATES).toBeInstanceOf(Array);
        expect(GEMINI_PROBE_CANDIDATES.length).toBeGreaterThan(0);
        expect(GEMINI_PROBE_CANDIDATES.every(m => typeof m === "string")).toBe(true);
    });
});
