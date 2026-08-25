// @ts-check

/**
 * @file browser.js
 * MSW service worker for browser (Playwright/E2E) mock mode.
 *
 * Usage in E2E tests:
 *   import { worker } from "./mocks/browser.js";
 *   await worker.start({ onUnhandledRequest: "bypass" });
 *
 * @module mocks/browser
 */

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.js";

/** MSW browser worker for E2E test mock mode. */
export const worker = setupWorker(...handlers);
