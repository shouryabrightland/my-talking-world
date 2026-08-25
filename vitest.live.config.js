import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "jsdom",
        // No MSW server for live API tests — requests hit real endpoints.
        // IndexedDB is polyfilled so Storage persistence works under jsdom.
        setupFiles: ["./tests/live/setup.js"],
        include: [
            "tests/live/**/*.test.js",
        ],
        testTimeout: 60_000,
    },
});
