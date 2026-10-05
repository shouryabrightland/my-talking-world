// @ts-check

/**
 * @file ApiKeyOnboardingScreen.test.jsx
 * Component tests for the Dual-Key Onboarding Screen:
 * - Verification is instant (no 25-model probe latency badges)
 * - Failure path surfaces the verification error banner
 * - Success path persists both keys and transitions immediately
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

describe("ApiKeyOnboardingScreen — Lightweight Verification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("shows the verification error when verification fails", async () => {
        verifyAndProbeDualKeys.mockResolvedValue({
            success: false,
            error: "Groq key verification failed: Invalid API key",
            groq: { valid: false, error: "Invalid API key", models: [] },
            gemini: { valid: false, error: null, models: [], probeResults: [], workingModels: 0 }
        });

        render(<ApiKeyOnboardingScreen onKeySaved={() => {}} />);
        await fillAndSubmit();

        expect(await screen.findByText(/Groq key verification failed/u, {}, { timeout: 3000 })).toBeTruthy();

        // Keys must NOT be saved on failure
        expect(setApiKey).not.toHaveBeenCalled();
        expect(setGeminiApiKey).not.toHaveBeenCalled();
    });

    it("does not render any per-model probe breakdown", () => {
        render(<ApiKeyOnboardingScreen onKeySaved={() => {}} />);

        expect(screen.queryByText("Model Status Breakdown:")).toBeNull();
        expect(screen.queryByText("✅")).toBeNull();
        expect(screen.queryByText("❌")).toBeNull();
        expect(screen.queryByText(/\d+ms/u)).toBeNull();
    });

    it("saves both keys and transitions immediately without a probe latency wait", async () => {
        const onKeySaved = vi.fn();
        verifyAndProbeDualKeys.mockResolvedValue({
            success: true,
            error: null,
            groq: { valid: true, error: null, models: [] },
            gemini: { valid: true, error: null, models: ["gemini-2.5-flash"], probeResults: [], workingModels: 1 }
        });

        render(<ApiKeyOnboardingScreen onKeySaved={onKeySaved} />);
        await fillAndSubmit();

        // Transition happens straight away — no 1.5s badge window, no model probes.
        await waitFor(() => {
            expect(onKeySaved).toHaveBeenCalledTimes(1);
        }, { timeout: 1000 });

        expect(setApiKey).toHaveBeenCalledWith("gsk_test_key_12345");
        expect(setGeminiApiKey).toHaveBeenCalledWith("AIzaSyTestValidKey123");
        expect(screen.queryByText("Model Status Breakdown:")).toBeNull();
    });

    it("requires both keys before running verification", () => {
        verifyAndProbeDualKeys.mockResolvedValue({ success: true });
        render(<ApiKeyOnboardingScreen onKeySaved={() => {}} />);

        const submit = screen.getByRole("button", { name: /Verify & Enter Studio/u });
        expect(submit).toHaveProperty("disabled", true);
        expect(verifyAndProbeDualKeys).not.toHaveBeenCalled();
    });
});
