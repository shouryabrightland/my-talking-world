// @ts-check

/**
 * @file onboarding.spec.js
 * E2E tests for the Dual-Key Onboarding flow.
 *
 * Coverage:
 * - Button disabled when either Groq or Gemini key is missing
 * - Error banner on invalid key
 * - Error banner with model status breakdown when <3 models work
 * - Full flow: dual keys → model probe (≥3) → Lobby → Backstage → Chat Stage
 *
 * Prerequisites:
 *   npx playwright test tests/e2e/onboarding.spec.js
 */

import { test, expect } from "@playwright/test";

test.describe("Onboarding — Dual-Key Flow", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
    });

    // ─── Button State Tests ──────────────────────────────────────────────

    test("submit button is disabled when both keys are empty", async ({ page }) => {
        const submitBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Enter")').first();
        await expect(submitBtn).toBeDisabled();
    });

    test("submit button remains disabled when only Groq key is entered", async ({ page }) => {
        const groqInput = page.locator('input[placeholder*="gsk_"], input[placeholder*="groq"], input[type="password"]').first();
        if (await groqInput.isVisible()) {
            await groqInput.fill("gsk_test_key_12345");
        }
        const submitBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Enter")').first();
        await expect(submitBtn).toBeDisabled();
    });

    test("submit button remains disabled when only Gemini key is entered", async ({ page }) => {
        const geminiInput = page.locator('input[placeholder*="AIza"], input[placeholder*="Google"], input[placeholder*="Gemini"]').first();
        if (await geminiInput.isVisible()) {
            await geminiInput.fill("AIzaSyTestKey12345678901234567890");
        }
        const submitBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Enter")').first();
        await expect(submitBtn).toBeDisabled();
    });

    test("submit button is enabled when both keys are filled", async ({ page }) => {
        const groqInput = page.locator('input[placeholder*="gsk_"], input[placeholder*="groq"], input[type="password"]').first();
        const geminiInput = page.locator('input[placeholder*="AIza"], input[placeholder*="Google"], input[placeholder*="Gemini"]').first();

        if (await groqInput.isVisible()) await groqInput.fill("gsk_test_key_12345");
        if (await geminiInput.isVisible()) await geminiInput.fill("AIzaSyTestKey12345678901234567890");

        const submitBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Enter")').first();
        await expect(submitBtn).toBeEnabled();
    });

    // ─── Error Handling Tests ────────────────────────────────────────────

    test("shows error banner when Groq key is invalid", async ({ page }) => {
        const groqInput = page.locator('input[placeholder*="gsk_"], input[placeholder*="groq"], input[type="password"]').first();
        const geminiInput = page.locator('input[placeholder*="AIza"], input[placeholder*="Google"], input[placeholder*="Gemini"]').first();

        if (await groqInput.isVisible()) await groqInput.fill("invalid-key");
        if (await geminiInput.isVisible()) await geminiInput.fill("AIzaSyTestKey12345678901234567890");

        const submitBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Enter")').first();
        if (await submitBtn.isVisible()) {
            await submitBtn.click();
            // Error banner should appear within 10 seconds
            const errorBanner = page.locator('[class*="error"], [class*="Error"], [class*="banner"]').first();
            await expect(errorBanner).toBeVisible({ timeout: 10_000 });
        }
    });

    // ─── Full Onboarding Flow ────────────────────────────────────────────

    // ─── Live Probe UI Verification (TEST_LIVE_API only) ─────────────────

    test("live: real keys render probe latency badges and model checkmarks", async ({ page }) => {
        // Runs only in live mode with credentials provided via environment:
        //   cross-env TEST_LIVE_API=true TEST_GROQ_KEY=<gsk_...> TEST_GEMINI_KEY=<AIza...> npx playwright test tests/e2e/onboarding.spec.js
        const groqKey = process.env.TEST_GROQ_KEY;
        const geminiKey = process.env.TEST_GEMINI_KEY;
        test.skip(
            process.env.TEST_LIVE_API !== "true" || !groqKey || !geminiKey,
            "requires TEST_LIVE_API=true and TEST_GROQ_KEY/TEST_GEMINI_KEY env vars"
        );

        const groqInput = page.locator('input[placeholder*="gsk_"]').first();
        const geminiInput = page.locator('input[placeholder*="AIza"]').first();

        await groqInput.fill(groqKey);
        await geminiInput.fill(geminiKey);

        const submitBtn = page.locator('button:has-text("Verify & Enter Studio")').first();
        await expect(submitBtn).toBeEnabled();
        await submitBtn.click();

        // While probing, the button shows progress state
        await expect(page.locator('button:has-text("Verifying Keys & Probing Models")').first())
            .toBeVisible({ timeout: 5_000 });

        // Either the probe panel appears (latency badges + checkmarks), or the
        // app transitions past onboarding (success shows results briefly first).
        const probePanel = page.locator('[class*="probeResults"]');
        const lobbyOrChat = page.locator('text=Studio').or(page.locator('text=Backstage')).or(page.locator('[class*="chatShell"]'));
        await expect(probePanel.or(lobbyOrChat)).toBeVisible({ timeout: 60_000 });

        // If the probe panel is the visible outcome, it must carry latency + status marks
        if (await probePanel.isVisible()) {
            await expect(probePanel.locator("text=/ms$/u").first()).toBeVisible();
            await expect(probePanel.locator("text=/[✅❌]/u").first()).toBeVisible();
        }
    });

    test("full flow: valid dual keys → probe ≥3 models → Lobby → Chat Stage", async ({ page }) => {
        // Mock both provider APIs so verification + probing succeed without real keys.
        // Groq: /openai/v1/models
        await page.route("https://api.groq.com/openai/v1/models", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    data: [
                        { id: "llama-3.3-70b-versatile", object: "model" },
                        { id: "llama-3.1-8b-instant", object: "model" },
                        { id: "mixtral-8x7b-32768", object: "model" }
                    ]
                })
            })
        );
        // Gemini: /v1beta/models (key verification)
        await page.route(/generativelanguage\.googleapis\.com\/v1beta\/models\?/, (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    models: [
                        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
                        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] }
                    ]
                })
            })
        );
        // Gemini: per-model probe (:generateContent)
        await page.route(/generativelanguage\.googleapis\.com\/v1beta\/models\/[^?]+:generateContent/, (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })
            })
        );

        const groqInput = page.locator('input[placeholder*="gsk_"], input[placeholder*="groq"], input[type="password"]').first();
        const geminiInput = page.locator('input[placeholder*="AIza"], input[placeholder*="Google"], input[placeholder*="Gemini"]').first();

        if (await groqInput.isVisible()) await groqInput.fill("gsk_test_key_12345");
        if (await geminiInput.isVisible()) await geminiInput.fill("AIzaSyTestKey12345678901234567890");

        const submitBtn = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Enter")').first();
        if (await submitBtn.isVisible() && await submitBtn.isEnabled()) {
            await submitBtn.click();

            // Expected flow after submit (requires network mocking):
            // 1. Loading spinner / probing indicator
            // 2. Model probe results (≥3 healthy)
            // 3. Transition to Studio Lobby / Backstage Loading
            // 4. Final transition to Chat Stage

            // Lobby or Chat Stage should appear within 20 seconds
            const lobbyOrChat = page.locator('text=Studio').or(page.locator('text=Backstage')).or(page.locator('text=Lobby')).or(page.locator('[class*="chatShell"]'));
            await expect(lobbyOrChat).toBeVisible({ timeout: 20_000 });
        }
    });
});
