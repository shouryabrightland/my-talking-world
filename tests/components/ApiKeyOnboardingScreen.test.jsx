// @ts-check

/**
 * @file ApiKeyOnboardingScreen.test.jsx
 * Component tests for the Dual-Key Onboarding Screen:
 * - Probe latency badges + model checkmarks (✅/❌) render per probed model
 * - Failure path keeps probe diagnostics visible with error details
 * - Success path shows probe results briefly, saves both keys, then calls onKeySaved
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/** @type {Array<{model: string, working: boolean, error: string|null, latencyMs: number}>} */
const PROBE_RESULTS = [
    { model: "gemini-3.7-flash", working: true, error: null, latencyMs: 412 },
    { model: "gemini-3.5-flash", working: false, error: "Model not found [deprecated/unavailable]", latencyMs: 380 },
    { model: "gemini-2.5-flash", working: true, error: null, latencyMs: 655 },
];

vi.mock("../../src/util/Constants", () => ({
    setApiKey: vi.fn(),
    setGeminiApiKey: vi.fn(),
    verifyAndProbeDualKeys: vi.fn(),
    GROQ_CONSOLE_KEYS_URL: "https://console.groq.com/keys",
    GEMINI_CONSOLE_KEYS_URL: "https://aistudio.google.com/apikey",
}));

import ApiKeyOnboardingScreen from "../../src/components/screens/ApiKeyOnboardingScreen.jsx";
import { verifyAndProbeDualKeys, setApiKey, setGeminiApiKey } from "../../src/util/Constants";

/** Fills both key inputs and submits the form. */
async function fillAndSubmit(/** @type {string} */ groq = "gsk_test_key_12345", /** @type {string} */ gemini = "AIzaSyTestValidKey123") {
    fireEvent.change(screen.getByPlaceholderText("Paste Groq Key (gsk_...)"), { target: { value: groq } });
    fireEvent.change(screen.getByPlaceholderText("Paste Google AI Studio Key (AIzaSy...)"), { target: { value: gemini } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & Enter Studio/u }));
}

describe("ApiKeyOnboardingScreen — Model Probe Diagnostics", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders probe latency badges and model checkmarks when verification fails", async () => {
        verifyAndProbeDualKeys.mockResolvedValue({
            success: false,
            error: "Gemini model verification failed.",
            groq: { valid: true, error: null, models: [] },
            gemini: { valid: false, error: "Too few models.", models: [], probeResults: PROBE_RESULTS, workingModels: 2 }
        });

        render(<ApiKeyOnboardingScreen onKeySaved={() => {}} />);
        await fillAndSubmit();

        // Probe panel header
        expect(await screen.findByText("Model Status Breakdown:", {}, { timeout: 3000 })).toBeTruthy();

        // Each probed model is listed
        expect(screen.getByText("gemini-3.7-flash")).toBeTruthy();
        expect(screen.getByText("gemini-3.5-flash")).toBeTruthy();
        expect(screen.getByText("gemini-2.5-flash")).toBeTruthy();

        // Checkmarks: one working row shows ✅, failed row shows ❌ + error detail
        expect(screen.getAllByText("✅").length).toBe(2);
        expect(screen.getByText("❌")).toBeTruthy();
        expect(screen.getByText(/Model not found/u)).toBeTruthy();

        // Latency badges rendered as "<ms>ms"
        expect(screen.getByText("412ms")).toBeTruthy();
        expect(screen.getByText("380ms")).toBeTruthy();
        expect(screen.getByText("655ms")).toBeTruthy();

        // Keys must NOT be saved on failure
        expect(setApiKey).not.toHaveBeenCalled();
        expect(setGeminiApiKey).not.toHaveBeenCalled();
    });

    it("shows probe results briefly on success, saves keys, then transitions via onKeySaved", async () => {
        const onKeySaved = vi.fn();
        verifyAndProbeDualKeys.mockResolvedValue({
            success: true,
            error: null,
            groq: { valid: true, error: null, models: [] },
            gemini: { valid: true, error: null, models: [], probeResults: PROBE_RESULTS, workingModels: 3 }
        });

        render(<ApiKeyOnboardingScreen onKeySaved={onKeySaved} />);
        await fillAndSubmit();

        // Probe diagnostics become visible before transition
        await waitFor(() => {
            expect(screen.getByText("Model Status Breakdown:")).toBeTruthy();
        }, { timeout: 3000 });
        expect(screen.getAllByText("✅").length).toBe(2);
        expect(screen.getByText("412ms")).toBeTruthy();

        // Both keys persisted
        expect(setApiKey).toHaveBeenCalledWith("gsk_test_key_12345");
        expect(setGeminiApiKey).toHaveBeenCalledWith("AIzaSyTestValidKey123");

        // Transition happens after the brief display window (~1.5s)
        await waitFor(() => {
            expect(onKeySaved).toHaveBeenCalledTimes(1);
        }, { timeout: 5000 });
    });

    it("does not render probe panel before verification runs", () => {
        render(<ApiKeyOnboardingScreen onKeySaved={() => {}} />);
        expect(screen.queryByText("Model Status Breakdown:")).toBeNull();
        expect(screen.queryByText("✅")).toBeNull();
    });
});
