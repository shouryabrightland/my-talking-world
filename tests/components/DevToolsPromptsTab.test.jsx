// @ts-check

/**
 * @file DevToolsPromptsTab.test.jsx
 * Verifies the new "situation" prompt category so Gemma distillation passes
 * are visible in the DevTools Prompt Inspector.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import DevToolsPromptsTab from "../../src/components/devtools/DevToolsPromptsTab.jsx";

/**
 * Builds one prompt log entry.
 * @param {Partial<any>} overrides
 * @returns {any}
 */
function makeEntry(overrides = {}) {
    return {
        id: crypto.randomUUID(),
        type: "situation",
        model: "gemma-2-27b-it",
        timestamp: Date.now(),
        time: "14:30:05",
        latencyMs: 412,
        status: "success",
        requestMessages: [{ role: "user", content: "# Ambient Situation Distiller" }],
        rawResponse: "<analysis><situation>Cast is on the rooftop.</situation></analysis>",
        thinkingChain: null,
        groundingMetadata: null,
        error: null,
        tokensIn: 220,
        tokensOut: 96,
        finishReason: "stop",
        ...overrides
    };
}

/** @returns {any} Full promptLogs record with one situation entry. */
function makeLogs() {
    return {
        dialogue: [],
        scheduler: [],
        demand: [],
        stabilizer: [],
        situation: [makeEntry()]
    };
}

describe("DevToolsPromptsTab — situation category", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("shows the Situation sub-tab with its entry count", () => {
        render(<DevToolsPromptsTab promptLogs={makeLogs()} clearPromptLogs={() => {}} />);

        expect(screen.getByRole("button", { name: /🧠 Situation \(1\)/ })).toBeTruthy();
        expect(screen.getByRole("button", { name: /💬 Dialogue \(0\)/ })).toBeTruthy();
    });

    it("lists the Gemma distillation trace when Situation is selected", () => {
        render(<DevToolsPromptsTab promptLogs={makeLogs()} clearPromptLogs={() => {}} />);

        fireEvent.click(screen.getByRole("button", { name: /🧠 Situation \(1\)/ }));

        expect(screen.getByText("gemma-2-27b-it")).toBeTruthy();
        expect(screen.getByText(/⚡ 412ms/)).toBeTruthy();

        // Expand the trace to reveal the captured request/response payloads.
        fireEvent.click(screen.getByText("14:30:05"));

        expect(screen.getByText("# Ambient Situation Distiller")).toBeTruthy();
        expect(screen.getByText(/Cast is on the rooftop\./)).toBeTruthy();
    });

    it("renders the empty state for categories without traces", () => {
        render(<DevToolsPromptsTab promptLogs={makeLogs()} clearPromptLogs={() => {}} />);

        expect(screen.getByText(/No prompt executions recorded for 'dialogue' yet\./)).toBeTruthy();
    });
});

// ─── Phase 5.2: reasoning-token badge ──────────────────────────

describe("DevToolsPromptsTab — thinking token badge (Phase 5.2)", () => {
    it("renders the 🧠 Think badge when reasoning tokens were consumed", () => {
        const logs = makeLogs();
        logs.situation = [makeEntry({ tokensThinking: 112 })];

        render(<DevToolsPromptsTab promptLogs={logs} clearPromptLogs={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: /🧠 Situation \(1\)/ }));

        expect(screen.getByText(/Think: 112 tok \(Budget: 512\)/)).toBeTruthy();
    });

    it("hides the badge when no thinking tokens were reported", () => {
        const logs = makeLogs();
        logs.situation = [makeEntry({ tokensThinking: null })];

        render(<DevToolsPromptsTab promptLogs={logs} clearPromptLogs={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: /🧠 Situation \(1\)/ }));

        expect(screen.queryByText(/Think:/)).toBeNull();
        // The regular In/Out badge still renders.
        expect(screen.getByText(/In 220 \/ Out 96/)).toBeTruthy();
    });
});
