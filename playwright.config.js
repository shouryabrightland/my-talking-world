// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for TGF (Tom & Friends).
 *
 * Cross-browser matrix: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari.
 * Dev server is started automatically via the `webServer` block.
 */
export default defineConfig({
    testDir: "tests/e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [["html", { open: "never" }], ["github"]]
        : [["html", { open: "on-failure" }]],
    use: {
        // The dev server runs with @vitejs/plugin-basic-ssl, so it serves HTTPS.
        baseURL: "https://localhost:5173",
        ignoreHTTPSErrors: true,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: process.env.CI ? "retain-on-failure" : "off",
    },
    projects: [
        // ─── Desktop Browsers ────────────────────────────────────────────
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
        },
        {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
        },
        // ─── Mobile Browsers ─────────────────────────────────────────────
        {
            name: "mobile-chrome",
            use: { ...devices["Pixel 5"] },
        },
        {
            name: "mobile-safari",
            use: { ...devices["iPhone 13"] },
        },
    ],
    webServer: {
        command: "npm run dev -- --port 5173",
        url: "https://localhost:5173",
        ignoreHTTPSErrors: true,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
    outputDir: "tests/e2e-results",
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
});
