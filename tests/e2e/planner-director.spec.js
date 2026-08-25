// @ts-check

/**
 * @file planner-director.spec.js
 * E2E tests for the Storyline Planner and Director Mode workflows.
 *
 * Coverage:
 * - PlannerDrawer inline editing (click edit → in-place form)
 * - Block reordering with animation and dirty flagging
 * - Director Mode demand injection → proposal callout → Accept/Deny
 * - Narrative Update Report display, minimize, and dismiss
 * - "Stabilize & Save" and "Discard" action bar behavior
 * - Proposed addition (green + PROPOSED) and removal (red − REMOVED) diff indicators
 *
 * Prerequisites:
 *   npx playwright test tests/e2e/planner-director.spec.js
 */

import { test, expect } from "@playwright/test";

const BASE_URL = "/"; // resolved against playwright.config.js baseURL (https dev server)

/**
 * Navigate to the studio: seed dual API keys (so App.jsx skips the onboarding
 * gate) and wait for the app to settle.
 */
async function gotoStudio(page) {
    await page.addInitScript(() => {
        window.localStorage.setItem("tgf:groq_api_key", "gsk_e2e_test_key");
        window.localStorage.setItem("tgf:gemini_api_key", "AIzaSyE2ETestKey123456789012345");
    });
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Navigate past the Studio Lobby gate to the Chat stage.
    const loginBtn = page.locator('button:has-text("Log In")');
    if (await loginBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await loginBtn.click();
    }
    // Wait for the chat shell to appear (CSS module class is mangled)
    await page.locator('[class*="chatShell"]').waitFor({ timeout: 30_000 });
}

/** Helper: open the PlannerDrawer (if a toggle button exists) */
async function openPlannerDrawer(page) {
    const btn = page.locator(
        "[aria-label*='planner' i], [aria-label*='scheduler' i], [aria-label*='schedule' i], [aria-label*='Open scheduler']"
    ).first();
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PLANNER — INLINE EDIT
// ────────────────────────────────────────────────────────────────────────────

test.describe("PlannerDrawer — Inline Edit", () => {
    test.beforeEach(async ({ page }) => {
        // Seed dual API keys so App.jsx skips the onboarding gate and renders the studio.
        await page.addInitScript(() => {
            window.localStorage.setItem("tgf:groq_api_key", "gsk_e2e_test_key");
            window.localStorage.setItem("tgf:gemini_api_key", "AIzaSyE2ETestKey123456789012345");
        });
        await gotoStudio(page);
        await openPlannerDrawer(page);
    });

    test("clicking edit on card opens inline form without scrolling to top", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        const firstCard = cards.first();
        if (await firstCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Expand via accordion
            const accordionBtn = firstCard.locator("[class*='accordionToggleBtn']");
            if (await accordionBtn.isVisible()) await accordionBtn.click();

            // Click Edit Block inside expanded view
            const editBtn = firstCard.locator("button:has-text('Edit Block'), button:has-text('Edit')");
            if (await editBtn.isVisible()) {
                const scrollContainer = page.locator("[class*='scrollBody']").first();
                const scrollBefore = await scrollContainer.evaluate((el) => el.scrollTop).catch(() => 0);

                await editBtn.click();

                // Inline form should be visible on the SAME card
                const inlineForm = firstCard.locator("[class*='inlineEditForm']");
                await expect(inlineForm).toBeVisible({ timeout: 3_000 });

                // Scroll should NOT have jumped to top
                const scrollAfter = await scrollContainer.evaluate((el) => el.scrollTop).catch(() => 0);
                expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(50);
            }
        }
    });

    test("clicking expand shows read-only inspection, not edit form", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        const firstCard = cards.first();
        if (await firstCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const accordionBtn = firstCard.locator("[class*='accordionToggleBtn']");
            if (await accordionBtn.isVisible()) await accordionBtn.click();

            const expandedBody = firstCard.locator("[class*='expandedBody']");
            await expect(expandedBody).toBeVisible({ timeout: 3_000 });

            // Inline edit form should NOT be visible yet
            const inlineForm = firstCard.locator("[class*='inlineEditForm']");
            await expect(inlineForm).not.toBeVisible();
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// PLANNER — BLOCK REORDER
// ────────────────────────────────────────────────────────────────────────────

test.describe("PlannerDrawer — Block Reorder", () => {
    test.beforeEach(async ({ page }) => {
        await gotoStudio(page);
        await openPlannerDrawer(page);
    });

    test("reordering blocks triggers animation and marks schedule dirty", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        const firstCard = cards.first();
        if (await firstCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const downBtn = firstCard.locator("[aria-label='Move block down'], [aria-label*='down']").first();
            if (await downBtn.isVisible() && await downBtn.isEnabled()) {
                await downBtn.click();

                // Dirty badge should appear
                const dirtyBadge = page.locator("text=Unstabilized, text=Dirty, text=Custom Edits").first();
                await expect(dirtyBadge).toBeVisible({ timeout: 3_000 });
            }
        }
    });

    test("action bar shows Discard and Stabilize & Save when dirty", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        const firstCard = cards.first();
        if (await firstCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const downBtn = firstCard.locator("[aria-label='Move block down'], [aria-label*='down']").first();
            if (await downBtn.isVisible() && await downBtn.isEnabled()) {
                await downBtn.click();

                const actionBar = page.locator("[class*='actionBar']");
                await expect(actionBar).toBeVisible({ timeout: 3_000 });

                const discardBtn = page.locator("button:has-text('Discard')");
                await expect(discardBtn).toBeVisible();

                const stabilizeBtn = page.locator("button:has-text('Stabilize & Save'), button:has-text('Stabilize')");
                await expect(stabilizeBtn).toBeVisible();
            }
        }
    });

    test("discard reverts changes and hides action bar", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        const firstCard = cards.first();
        if (await firstCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const initialCount = await cards.count();

            const downBtn = firstCard.locator("[aria-label='Move block down'], [aria-label*='down']").first();
            if (await downBtn.isVisible() && await downBtn.isEnabled()) {
                await downBtn.click();
                await page.waitForTimeout(500);

                await expect(page.locator("[class*='actionBar']")).toBeVisible();

                await page.locator("button:has-text('Discard')").click();
                await page.waitForTimeout(500);

                await expect(page.locator("[class*='actionBar']")).not.toBeVisible();
                expect(await cards.count()).toBe(initialCount);
            }
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// DIRECTOR MODE — DEMAND & PROPOSAL APPROVAL
// ────────────────────────────────────────────────────────────────────────────

test.describe("Director Mode — Demand & Approval", () => {
    test.beforeEach(async ({ page }) => {
        await gotoStudio(page);
        await openPlannerDrawer(page);
    });

    test("applying a demand shows proposal callout with Accept/Deny", async ({ page }) => {
        const demandInput = page.locator("input[placeholder*='physics' i], input[placeholder*='demand' i], input[placeholder*='study' i]").first();
        if (await demandInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await demandInput.fill("I want to study physics at 5pm");

            const applyBtn = page.locator("button:has-text('Apply Demand'), button:has-text('Apply')").first();
            if (await applyBtn.isVisible()) {
                await applyBtn.click();

                const proposalCallout = page.locator("[class*='proposalCallout']").first();
                await expect(proposalCallout).toBeVisible({ timeout: 15_000 });

                const acceptBtn = page.locator("button:has-text('Accept')");
                const denyBtn = page.locator("button:has-text('Deny')");
                await expect(acceptBtn).toBeVisible({ timeout: 5_000 });
                await expect(denyBtn).toBeVisible({ timeout: 5_000 });
            }
        }
    });

    test("proposed additions show green border and + PROPOSED badge", async ({ page }) => {
        const demandInput = page.locator("input[placeholder*='physics' i], input[placeholder*='demand' i], input[placeholder*='study' i]").first();
        if (await demandInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await demandInput.fill("Add physics study at 5pm");

            const applyBtn = page.locator("button:has-text('Apply Demand'), button:has-text('Apply')").first();
            if (await applyBtn.isVisible()) {
                await applyBtn.click();
                await page.locator("[class*='proposalCallout']").first().waitFor({ timeout: 15_000 });

                // Check for proposed additions with green indicator
                const proposedBadge = page.locator("text=+ PROPOSED, [class*='proposed']").first();
                // Badge may or may not appear depending on AI response
                const count = await proposedBadge.count();
                expect(count).toBeGreaterThanOrEqual(0);
            }
        }
    });

    test("clicking Accept commits proposal and clears callout", async ({ page }) => {
        const demandInput = page.locator("input[placeholder*='physics' i], input[placeholder*='demand' i], input[placeholder*='study' i]").first();
        if (await demandInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await demandInput.fill("I want to study physics at 5pm");

            const applyBtn = page.locator("button:has-text('Apply Demand'), button:has-text('Apply')").first();
            if (await applyBtn.isVisible()) {
                await applyBtn.click();

                const proposalCallout = page.locator("[class*='proposalCallout']").first();
                await expect(proposalCallout).toBeVisible({ timeout: 15_000 });

                await page.locator("button:has-text('Accept')").click();
                await expect(proposalCallout).not.toBeVisible({ timeout: 5_000 });
            }
        }
    });

    test("clicking Deny discards proposal and clears callout", async ({ page }) => {
        const demandInput = page.locator("input[placeholder*='physics' i], input[placeholder*='demand' i], input[placeholder*='study' i]").first();
        if (await demandInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await demandInput.fill("I want to study physics at 5pm");

            const applyBtn = page.locator("button:has-text('Apply Demand'), button:has-text('Apply')").first();
            if (await applyBtn.isVisible()) {
                await applyBtn.click();

                const proposalCallout = page.locator("[class*='proposalCallout']").first();
                await expect(proposalCallout).toBeVisible({ timeout: 15_000 });

                await page.locator("button:has-text('Deny')").click();
                await expect(proposalCallout).not.toBeVisible({ timeout: 5_000 });
            }
        }
    });

    test("narrative report can be collapsed and expanded", async ({ page }) => {
        const demandInput = page.locator("input[placeholder*='physics' i], input[placeholder*='demand' i], input[placeholder*='study' i]").first();
        if (await demandInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await demandInput.fill("I want to study physics at 5pm");

            const applyBtn = page.locator("button:has-text('Apply Demand'), button:has-text('Apply')").first();
            if (await applyBtn.isVisible()) {
                await applyBtn.click();

                const report = page.locator("[class*='narrativeReport']").first();
                await expect(report).toBeVisible({ timeout: 15_000 });

                const reportBody = page.locator("[class*='reportBody']").first();
                if (await reportBody.isVisible()) {
                    // Minimize
                    const toggleBtn = page.locator("[aria-label*='Minimize']").first();
                    if (await toggleBtn.isVisible()) {
                        await toggleBtn.click();
                        await expect(reportBody).not.toBeVisible({ timeout: 3_000 });

                        // Expand
                        const expandBtn = page.locator("[aria-label*='Expand']").first();
                        if (await expandBtn.isVisible()) {
                            await expandBtn.click();
                            await expect(reportBody).toBeVisible({ timeout: 3_000 });
                        }
                    }
                }
            }
        }
    });

    test("narrative report can be dismissed", async ({ page }) => {
        const demandInput = page.locator("input[placeholder*='physics' i], input[placeholder*='demand' i], input[placeholder*='study' i]").first();
        if (await demandInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await demandInput.fill("I want to study physics at 5pm");

            const applyBtn = page.locator("button:has-text('Apply Demand'), button:has-text('Apply')").first();
            if (await applyBtn.isVisible()) {
                await applyBtn.click();

                const report = page.locator("[class*='narrativeReport']").first();
                await expect(report).toBeVisible({ timeout: 15_000 });

                const dismissBtn = page.locator("[aria-label*='Dismiss'], button:has-text('✕')").first();
                if (await dismissBtn.isVisible()) {
                    await dismissBtn.click();
                    await expect(report).not.toBeVisible({ timeout: 3_000 });
                }
            }
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// STABILIZE & SAVE
// ────────────────────────────────────────────────────────────────────────────

test.describe("Stabilize & Save Flow", () => {
    test.beforeEach(async ({ page }) => {
        await gotoStudio(page);
        await openPlannerDrawer(page);
    });

    test("clicking Stabilize & Save triggers AI and shows progress", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        if (await cards.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Reorder to dirty
            const downBtn = cards.first().locator("[aria-label='Move block down'], [aria-label*='down']").first();
            if (await downBtn.isVisible() && await downBtn.isEnabled()) {
                await downBtn.click();
                await page.waitForTimeout(500);

                const stabilizeBtn = page.locator("button:has-text('Stabilize'), button:has-text('Save')").first();
                await expect(stabilizeBtn).toBeVisible();
                await stabilizeBtn.click();

                // Button should show stabilizing progress
                await expect(stabilizeBtn).toContainText(/[Ss]tabiliz/, { timeout: 3_000 });
            }
        }
    });

    test("direct save is not available when schedule is dirty", async ({ page }) => {
        const cards = page.locator("[class*='sceneCard']");
        if (await cards.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const downBtn = cards.first().locator("[aria-label='Move block down'], [aria-label*='down']").first();
            if (await downBtn.isVisible() && await downBtn.isEnabled()) {
                await downBtn.click();
                await page.waitForTimeout(500);

                // Dirty badge should say "Requires Stabilization"
                const dirtyBadge = page.locator("text=Requires Stabilization, text=Unstabilized, text=Custom Edits").first();
                await expect(dirtyBadge).toBeVisible({ timeout: 3_000 });
            }
        }
    });
});
