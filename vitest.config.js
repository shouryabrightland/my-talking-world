import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./tests/setup.js"],
        include: [
            "tests/**/*.test.js",
            "tests/**/*.test.jsx",
            "tests/integration/**/*.test.js",
        ],
        exclude: [
            "tests/e2e/**",
            "tests/live/**",
        ],
        testTimeout: 30_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "coverage",
            include: ["src/**/*.js", "src/**/*.jsx"],
            thresholds: {
                statements: 85,
                branches: 85,
                functions: 85,
                lines: 85,
            },
        },
    },
});
