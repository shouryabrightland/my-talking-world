import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "jsdom",
        include: ["tests/components/**/*.test.jsx", "tests/components/**/*.test.js"],
        setupFiles: ["./tests/setup.js"],
        pool: "forks",
        testTimeout: 15000,
    }
});
