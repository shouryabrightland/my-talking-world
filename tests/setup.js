// @ts-check

/**
 * @file setup.js
 * Global test setup for vitest.
 * Initializes MSW server with all external API mocks and provides clean isolation.
 */

import { server } from "../src/mocks/server.js";

// Live-API mode: bypass MSW entirely so requests hit the real network endpoints.
// Set via `cross-env TEST_LIVE_API=true` (see `npm run test:live:keys`).
const LIVE_API_MODE = process.env.TEST_LIVE_API === "true";

if (!LIVE_API_MODE) {
    // Start MSW before all tests — warn on unhandled requests so we know if a new API surface was added
    beforeAll(() => {
        server.listen({ onUnhandledRequest: "warn" });
    });

    // Reset handlers after each test for clean isolation
    afterEach(() => {
        server.resetHandlers();
    });

    // Close MSW after all tests
    afterAll(() => {
        server.close();
    });
}

// Mock localStorage for jsdom
if (typeof globalThis.localStorage === "undefined") {
    const store = {};
    globalThis.localStorage = {
        getItem: (/** @type {string} */ key) => store[key] ?? null,
        setItem: (/** @type {string} */ key, /** @type {string} */ value) => { store[key] = value; },
        removeItem: (/** @type {string} */ key) => { delete store[key]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (/** @type {number} */ index) => Object.keys(store)[index] ?? null
    };
}
