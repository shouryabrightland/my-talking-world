// @ts-check

/**
 * @file DualKeyLiveProbe.test.js
 * Live network authentication and model discovery tests against real Groq and
 * Google AI Studio endpoints. These tests make actual HTTP requests — they
 * require valid API keys and real network access.
 *
 * Run with:
 *   TEST_LIVE_API=true TEST_GROQ_KEY=<key> TEST_GEMINI_KEY=<key> npx vitest run tests/live/DualKeyLiveProbe.test.js
 *
 * Or use the npm script:
 *   npm run test:live:keys
 */

import { describe, it, expect, beforeAll } from "vitest";

// Live credentials — must be provided via environment variables
const GROQ_KEY = process.env.TEST_GROQ_KEY;
const GEMINI_KEY = process.env.TEST_GEMINI_KEY;

if (!GROQ_KEY || !GEMINI_KEY) {
    console.warn("\n⚠️  DualKeyLiveProbe tests require TEST_GROQ_KEY and TEST_GEMINI_KEY environment variables.");
    console.warn("   Skipping all tests. Set them to run: TEST_LIVE_API=true TEST_GROQ_KEY=<key> TEST_GEMINI_KEY=<key> npm run test:live:keys\n");
}

// Skip all tests if TEST_LIVE_API is not set
const describeLive = process.env.TEST_LIVE_API === "true" ? describe : describe.skip;

// Production model constants
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
const GROQ_FALLBACK_MODELS = ["qwen/qwen3.6-27b", "openai/gpt-oss-20b", "meta-llama/llama-4-scout-17b-16e-instruct"];
const GEMINI_PROBE_CANDIDATES = ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-pro", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const MIN_GEMINI_MODELS_REQUIRED = 3;

// =========================================================================
// GROQ LIVE API TESTS
// =========================================================================

describeLive("Groq Live API — Model Discovery", () => {
    /** @type {Response|null} */
    let modelsResponse = null;
    /** @type {any} */
    let modelsPayload = null;

    beforeAll(async () => {
        modelsResponse = await fetch("https://api.groq.com/openai/v1/models", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json"
            }
        });
        modelsPayload = await modelsResponse.json();
    });

    it("returns 200 OK with valid API key", () => {
        expect(modelsResponse).toBeTruthy();
        expect(modelsResponse.status).toBe(200);
    });

    it("returns a list of available models", () => {
        expect(modelsPayload).toBeTruthy();
        expect(modelsPayload.data).toBeDefined();
        expect(Array.isArray(modelsPayload.data)).toBe(true);
        expect(modelsPayload.data.length).toBeGreaterThan(0);
    });

    it("supports openai/gpt-oss-120b as the primary chat model", () => {
        const modelIds = modelsPayload.data.map(/** @param {any} m */ m => m.id);
        expect(modelIds).toContain(GROQ_DEFAULT_MODEL);
    });

    it("supports at least one fallback model in the chain", () => {
        const modelIds = modelsPayload.data.map(/** @param {any} m */ m => m.id);
        const foundFallbacks = GROQ_FALLBACK_MODELS.filter(f => modelIds.includes(f));
        expect(foundFallbacks.length).toBeGreaterThan(0);
    });

    it("each model entry has required fields (id, object)", () => {
        for (const model of modelsPayload.data) {
            expect(model.id).toBeTruthy();
            expect(model.object).toBe("model");
        }
    });
});

// =========================================================================
// GEMINI LIVE API TESTS
// =========================================================================

describeLive("Gemini Live API — Model List", () => {
    /** @type {Response|null} */
    let modelsResponse = null;
    /** @type {any} */
    let modelsPayload = null;

    beforeAll(async () => {
        modelsResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`,
            { method: "GET", headers: { "Content-Type": "application/json" } }
        );
        modelsPayload = await modelsResponse.json();
    });

    it("returns 200 OK with valid API key", () => {
        expect(modelsResponse).toBeTruthy();
        expect(modelsResponse.status).toBe(200);
    });

    it("returns a list of Gemini models", () => {
        expect(modelsPayload).toBeTruthy();
        expect(modelsPayload.models).toBeDefined();
        expect(Array.isArray(modelsPayload.models)).toBe(true);
        expect(modelsPayload.models.length).toBeGreaterThan(0);
    });

    it("includes gemini-3.7-flash in the model list", () => {
        const modelNames = modelsPayload.models.map(/** @param {any} m */ m => m.name);
        const hasFlash = modelNames.some(/** @param {string} n */ n => n.includes("gemini-3.7-flash"));
        expect(hasFlash).toBe(true);
    });
});

// =========================================================================
// GEMINI LIVE MODEL PROBING
// =========================================================================

describeLive("Gemini Live API — Model Probing", () => {
    /**
     * Sends a minimal probe request to a single Gemini model.
     * @param {string} modelId
     * @returns {Promise<{model: string, working: boolean, error: string|null, latencyMs: number}>}
     */
    async function probeModel(modelId) {
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_KEY}`;
            const response = await fetch(url, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Hi" }] }],
                    generationConfig: { maxOutputTokens: 1 }
                })
            });

            const latencyMs = Date.now() - startTime;

            if (response.ok) {
                return { model: modelId, working: true, error: null, latencyMs };
            }

            let errorMsg = `HTTP ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData?.error?.message || errorMsg;
            } catch {}

            return {
                model: modelId,
                working: response.status !== 404 && response.status !== 400 && response.status !== 429,
                error: errorMsg,
                latencyMs
            };
        } catch (err) {
            const latencyMs = Date.now() - startTime;
            const error = /** @type {Error} */ (err);
            return {
                model: modelId,
                working: false,
                error: error.name === "AbortError" ? "Probe timed out" : (error.message || "Network error"),
                latencyMs
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    it("probes all candidate models and records results", async () => {
        /** @type {Array<{model: string, working: boolean, error: string|null, latencyMs: number}>} */
        const results = [];

        for (const modelId of GEMINI_PROBE_CANDIDATES) {
            const result = await probeModel(modelId);
            results.push(result);
        }

        // All candidates should be probed
        expect(results.length).toBe(GEMINI_PROBE_CANDIDATES.length);

        // Log results for visibility
        console.log("\n📊 Gemini Model Probe Results:");
        console.log("─".repeat(60));
        for (const r of results) {
            const status = r.working ? "✅" : "❌";
            console.log(`  ${status} ${r.model.padEnd(30)} ${r.latencyMs}ms ${r.error || "OK"}`);
        }
        console.log("─".repeat(60));
        console.log(`  Working: ${results.filter(r => r.working).length}/${results.length}`);
    });

    it("at least 3 models are responding (meets MIN_GEMINI_MODELS_REQUIRED)", async () => {
        /** @type {Array<{model: string, working: boolean, error: string|null, latencyMs: number}>} */
        const results = [];

        for (const modelId of GEMINI_PROBE_CANDIDATES) {
            const result = await probeModel(modelId);
            results.push(result);
        }

        const workingCount = results.filter(r => r.working).length;
        console.log(`\n✅ Working Gemini models: ${workingCount}/${results.length} (need ≥${MIN_GEMINI_MODELS_REQUIRED})`);

        expect(workingCount).toBeGreaterThanOrEqual(MIN_GEMINI_MODELS_REQUIRED);
    });

    it("gemini-3.7-flash responds successfully (primary model)", async () => {
        const result = await probeModel("gemini-3.7-flash");
        console.log(`\n🎯 gemini-3.7-flash: ${result.working ? "✅ WORKING" : "❌ FAILED"} (${result.latencyMs}ms)`);
        if (result.error) console.log(`   Error: ${result.error}`);
        expect(result.working).toBe(true);
    });

    it("records latency for each probe under 15 seconds", async () => {
        for (const modelId of GEMINI_PROBE_CANDIDATES) {
            const result = await probeModel(modelId);
            if (result.working) {
                expect(result.latencyMs).toBeLessThan(15_000);
            }
        }
    });
});

// =========================================================================
// VERIFYANDPROBEDUALKEYS INTEGRATION
// =========================================================================

describeLive("DualKey Verification — Full Integration", () => {
    /**
     * Simplified version of verifyAndProbeDualKeys for live testing.
     * @returns {Promise<{groqValid: boolean, geminiWorking: number, geminiTotal: number, success: boolean}>}
     */
    async function verifyDualKeys() {
        // Step 1: Verify Groq key
        const groqResponse = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { "Authorization": `Bearer ${GROQ_KEY}` }
        });
        const groqValid = groqResponse.ok;

        // Step 2: Verify Gemini key + fetch models
        const geminiModelsResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`
        );
        const geminiModelsPayload = await geminiModelsResponse.json();
        const apiModels = (geminiModelsPayload.models || [])
            .map(/** @param {any} m */ m => (m.name || "").replace("models/", ""))
            .filter(/** @param {string} n */ n => n.includes("gemini"));

        // Step 3: Probe candidates
        const probeCandidates = [...new Set([...GEMINI_PROBE_CANDIDATES, ...apiModels])];
        /** @type {Array<{model: string, working: boolean, latencyMs: number}>} */
        const probeResults = [];

        for (const modelId of probeCandidates) {
            const startTime = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_KEY}`,
                    {
                        method: "POST",
                        signal: controller.signal,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: "Hi" }] }],
                            generationConfig: { maxOutputTokens: 1 }
                        })
                    }
                );
                probeResults.push({
                    model: modelId,
                    working: response.ok,
                    latencyMs: Date.now() - startTime
                });
            } catch {
                probeResults.push({
                    model: modelId,
                    working: false,
                    latencyMs: Date.now() - startTime
                });
            } finally {
                clearTimeout(timeout);
            }
        }

        const workingModels = probeResults.filter(r => r.working).length;
        const success = groqValid && workingModels >= MIN_GEMINI_MODELS_REQUIRED;

        return {
            groqValid,
            geminiWorking: workingModels,
            geminiTotal: probeResults.length,
            success
        };
    }

    it("verifies both API keys and probes all Gemini models", async () => {
        const result = await verifyDualKeys();

        console.log("\n🔐 Dual-Key Verification Results:");
        console.log("─".repeat(50));
        console.log(`  Groq key valid:     ${result.groqValid ? "✅" : "❌"}`);
        console.log(`  Gemini models:      ${result.geminiWorking}/${result.geminiTotal} working`);
        console.log(`  Overall success:    ${result.success ? "✅ PASS" : "❌ FAIL"}`);
        console.log("─".repeat(50));

        expect(result.groqValid).toBe(true);
        expect(result.geminiWorking).toBeGreaterThanOrEqual(MIN_GEMINI_MODELS_REQUIRED);
        expect(result.success).toBe(true);
    });
});
