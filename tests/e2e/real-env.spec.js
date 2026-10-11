// @ts-check

/**
 * @file real-env.spec.js
 * Real-browser runtime harness for the Phase 1-7 refactor.
 *
 * Runs in a visible Chromium window against the live Vite dev server and
 * verifies real runtime behavior (not mocks):
 *   1. Studio mounts; removed reply/episode features are absent from the DOM.
 *   2. Real IndexedDB integrity: Memories obey the 80-char cap and
 *      MessageStore records deserialize without corrupt fields.
 *   3. Live NeedleRouter keyword extraction + UnifiedMemory lookup.
 *   4. `<next>` / `<delay>` wake timing persists to localStorage and ducks
 *      every avatar below the footer horizon.
 *   5. The wake window survives a full page reload with no rogue Groq request.
 *   6. Human interruption clears the wake lock and pops the cast back up
 *      (plus a live streaming-reply check when TEST_LIVE_API=true with real
 *      keys; otherwise that final sub-check is skipped).
 *
 * Usage:
 *   npm run test:e2e:headed
 *   (or) npx playwright test tests/e2e/real-env.spec.js --headed
 */

import { test, expect } from "@playwright/test";

const GROQ_KEY_STORAGE = "tgf:groq_api_key";
const GEMINI_KEY_STORAGE = "tgf:gemini_api_key";
const WAKE_KEY = "tgf:next_wake_time";

/** The headed harness is a Chromium-only verification run. */
const LIVE_KEYS =
    process.env.TEST_LIVE_API === "true" &&
    Boolean(process.env.TEST_GROQ_KEY) &&
    Boolean(process.env.TEST_GEMINI_KEY);

test.describe.configure({ mode: "serial" });

test.describe("Real environment harness (headed Chromium)", () => {
    /**
     * The headed harness is a desktop-Chromium-only verification run.
     * (Mobile Chrome also reports browserName "chromium", so it must be
     * excluded explicitly via isMobile.)
     */
    test.skip(
        ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
        "headed runtime harness is desktop-Chromium-only"
    );

    /**
     * Seeds API keys and a Groq-fetch counter into localStorage/window BEFORE
     * any app script runs, loads the studio, and logs in through the lobby so
     * the real engine boots against the live dev server.
     *
     * @param {import("@playwright/test").Page} page
     * @returns {Promise<void>}
     */
    async function bootStudio(page) {
        await page.addInitScript(
            ({ groqKey, geminiKey }) => {
                localStorage.setItem("tgf:groq_api_key", groqKey);
                localStorage.setItem("tgf:gemini_api_key", geminiKey);

                // Count real network calls to Groq so the reload test can
                // prove no rogue turn fires while the cast is asleep.
                window.__groqCalls = 0;
                const originalFetch = window.fetch.bind(window);
                window.fetch = (input, init) => {
                    try {
                        const url = typeof input === "string"
                            ? input
                            : (input && typeof input === "object" && "url" in input)
                                ? String(input.url)
                                : String(input);
                        if (url.includes("api.groq.com")) window.__groqCalls += 1;
                    } catch { /* never break fetch on URL sniffing */ }
                    return originalFetch(input, init);
                };
            },
            {
                groqKey: LIVE_KEYS ? process.env.TEST_GROQ_KEY : "gsk_e2e_fake_key_for_dom_checks",
                geminiKey: LIVE_KEYS ? process.env.TEST_GEMINI_KEY : "AIzaSyFakeKeyForDomChecksOnly123456"
            }
        );

        await page.goto("/");
        await page.getByRole("button", { name: /Log In & Enter Studio/i }).click();
        await page.waitForSelector('[class*="chatShell"]', { timeout: 30_000 });
    }

    /**
     * Waits until the engine is booted and no turn is in flight, so timing
     * assertions run against a quiescent scheduler.
     *
     * @param {import("@playwright/test").Page} page
     * @returns {Promise<void>}
     */
    async function waitForEngineIdle(page) {
        await page.waitForFunction(
            () => {
                const conv = window.conv;
                return Boolean(conv && conv.initialized && !conv.requesting);
            },
            undefined,
            { timeout: 30_000 }
        );
    }

    // ─── 1. Studio Mount & No Deleted Elements ──────────────────────────

    test("studio mounts and the pruned reply/episode features are absent from the DOM", async ({ page }) => {
        await bootStudio(page);

        await expect(page.locator('[class*="chatShell"]')).toBeVisible();

        // Reply system fully removed (Phase 2).
        await expect(page.locator('[class*="replyCard"]')).toHaveCount(0);
        await expect(page.locator('[class*="replyBanner"]')).toHaveCount(0);
        await expect(page.locator('[class*="replyAuthor"]')).toHaveCount(0);

        // Episode card fully removed (Phase 1).
        await expect(page.getByText("Today's Episode Card")).toHaveCount(0);
    });

    // ─── 2. Real IndexedDB Integrity Audit ──────────────────────────────

    test("IndexedDB Memories obey the 80-char cap and MessageStore records deserialize cleanly", async ({ page }) => {
        await bootStudio(page);

        const audit = await page.evaluate(async () => {
            /** @param {string} name @returns {Promise<IDBDatabase>} */
            const openDb = (name) => new Promise((resolve, reject) => {
                const req = indexedDB.open(name);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            const db = await openDb("tgf");

            // "Memories" is a key-value store: the unified memory stack lives
            // under the "unified_memory_stack" key as an array of entries
            // (other keys in the same store hold planner snapshots, which are
            // NOT memory records).
            const memories = await new Promise((resolve, reject) => {
                const getReq = db.transaction("Memories", "readonly")
                    .objectStore("Memories")
                    .get("unified_memory_stack");
                getReq.onsuccess = () => resolve(Array.isArray(getReq.result) ? getReq.result : []);
                getReq.onerror = () => reject(getReq.error);
            });

            const messages = await new Promise((resolve, reject) => {
                const getReq = db.transaction("MessageStore", "readonly")
                    .objectStore("MessageStore")
                    .getAll();
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => reject(getReq.error);
            });

            db.close();

            return {
                memoryCount: memories.length,
                oversizedMemories: memories.filter(
                    (e) => typeof e?.data !== "string" || e.data.length > 80
                ).length,
                messageCount: messages.length,
                corruptMessages: messages.filter((m) =>
                    typeof m?.id !== "string" ||
                    typeof m?.text !== "string" ||
                    (m.replyId !== undefined && m.replyId !== null && typeof m.replyId !== "string")
                ).length
            };
        });

        expect(audit.oversizedMemories).toBe(0);
        expect(audit.corruptMessages).toBe(0);

        // Real deserialization path: Chat.messageStore.load() must succeed.
        const restored = await page.evaluate(async () => {
            const conv = window.conv;
            const list = await conv.chat.messageStore.load(
                (/** @type {string} */ id) => conv.chat.members.get(id)
            );
            return Array.isArray(list) ? list.length : -1;
        });
        expect(restored).toBeGreaterThanOrEqual(0);
    });

    // ─── 3. Live Needle Keyword Extraction & Memory Lookup ──────────────

    test("NeedleRouter routes a Hinglish question to Tom and memory lookup returns an array", async ({ page }) => {
        await bootStudio(page);

        const outcome = await page.evaluate(async () => {
            const conv = window.conv;
            const route = await conv.needleRouter.route("Tom kal ka chai plan kya tha");
            const matches = conv.unifiedMemory.searchDeterministic(route.keywords, [route.member]);
            return { route, matchesIsArray: Array.isArray(matches) };
        });

        expect(outcome.route.member).toBe("tom");
        expect(outcome.route.keywords.length).toBeGreaterThan(0);
        expect(outcome.matchesIsArray).toBe(true);
    });

    // ─── 4. `<next>` Tag & Avatar Duck-Down ─────────────────────────────

    test("scheduling a future wake time persists it and ducks every avatar below the footer", async ({ page }) => {
        await bootStudio(page);
        await waitForEngineIdle(page);

        await page.evaluate(() => {
            // A failed boot turn (fake keys) may have latched the error
            // backoff; clear it so the scheduler accepts our explicit delay.
            window.conv.consecutiveErrors = 0;
            window.conv.scheduleNextRequestWithDelay(300000);
        });

        const wake = Number(await page.evaluate((key) => localStorage.getItem(key), WAKE_KEY));
        expect(Number.isFinite(wake)).toBe(true);
        expect(wake).toBeGreaterThan(Date.now() + 240000);

        const transforms = await page.$$eval(
            '[class*="charItem"]',
            (els) => els.map((el) => (/** @type {HTMLElement} */ (el)).style.transform)
        );
        expect(transforms.length).toBeGreaterThan(0);
        for (const transform of transforms) {
            expect(transform).toContain("100%");
        }
    });

    // ─── 5. Page Reload Resistance ──────────────────────────────────────

    test("the wake window survives a reload and no rogue Groq request fires", async ({ page }) => {
        await bootStudio(page);
        await waitForEngineIdle(page);

        await page.evaluate(() => {
            window.conv.consecutiveErrors = 0;
            window.conv.scheduleNextRequestWithDelay(300000);
        });
        expect(await page.evaluate((key) => localStorage.getItem(key), WAKE_KEY)).not.toBeNull();

        // Full reload: the wake timestamp must survive and the cast must boot
        // back asleep (the init script re-seeds keys and resets the counter).
        await page.reload();
        await page.getByRole("button", { name: /Log In & Enter Studio/i }).click();
        await page.waitForSelector('[class*="chatShell"]', { timeout: 30_000 });

        const wake = Number(await page.evaluate((key) => localStorage.getItem(key), WAKE_KEY));
        expect(Number.isFinite(wake)).toBe(true);
        expect(wake).toBeGreaterThan(Date.now());

        await page.waitForFunction(() => {
            const items = document.querySelectorAll('[class*="charItem"]');
            return items.length > 0 &&
                [...items].every((el) => (/** @type {HTMLElement} */ (el)).style.transform.includes("100%"));
        });

        // No rogue AI request while asleep.
        await page.waitForTimeout(3000);
        expect(await page.evaluate(() => window.__groqCalls)).toBe(0);
    });

    // ─── 6. Human Interruption & Wake-Up ────────────────────────────────

    test("human input clears the wake lock and pops the cast back up", async ({ page }) => {
        await bootStudio(page);
        await waitForEngineIdle(page);

        await page.evaluate(() => {
            window.conv.consecutiveErrors = 0;
            window.conv.scheduleNextRequestWithDelay(300000);
        });
        expect(await page.evaluate((key) => localStorage.getItem(key), WAKE_KEY)).not.toBeNull();

        const input = page.locator('input[placeholder*="Talk with Tom"]');
        await input.fill("Hello Tom!");
        await input.press("Enter");

        // Wake lock cleared immediately on interruption.
        await page.waitForFunction((key) => localStorage.getItem(key) === null, WAKE_KEY);

        // Avatars pop back up: 0% (speaking/busy) or 40% (room presence).
        await page.waitForFunction(() => {
            const items = document.querySelectorAll('[class*="charItem"]');
            return items.length > 0 &&
                [...items].some((el) => /0%|40%/.test((/** @type {HTMLElement} */ (el)).style.transform));
        });

        // The streaming-reply + persistence sub-check needs real API keys.
        test.skip(!LIVE_KEYS, "streaming reply requires TEST_LIVE_API=true with real TEST_GROQ_KEY/TEST_GEMINI_KEY");

        // A real bubble appears on screen...
        await expect(page.locator('[class*="bubbleOther"]').first()).toBeVisible({ timeout: 60_000 });

        // ...and the conversation is persisted in the real IndexedDB store.
        await page.waitForFunction(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open("tgf");
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const count = await new Promise((resolve) => {
                const getReq = /** @type {IDBDatabase} */ (db)
                    .transaction("MessageStore", "readonly")
                    .objectStore("MessageStore")
                    .count();
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => resolve(-1);
            });
            /** @type {IDBDatabase} */ (db).close();
            return typeof count === "number" && count > 0;
        }, undefined, { timeout: 30_000 });
    });
});
