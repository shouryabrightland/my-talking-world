// @ts-check

/**
 * @file setup.js
 * Setup for live-API vitest runs (vitest.live.config.js).
 *
 * Unlike the unit-test setup, MSW is intentionally NOT started here —
 * requests must hit real network endpoints (TEST_LIVE_API=true).
 * IndexedDB is polyfilled with an in-memory implementation so that the
 * Storage layer can persist schedule/memory data inside jsdom.
 */

import "fake-indexeddb/auto";

// jsdom localStorage guard (mirrors tests/setup.js)
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
