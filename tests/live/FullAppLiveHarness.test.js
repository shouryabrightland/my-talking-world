// @ts-check

/**
 * @file FullAppLiveHarness.test.js
 * System-wide live integration harness:
 * - Real-world grounding (Open-Meteo weather, Calendar Bharat celebrations, Google News RSS)
 * - Web Audio synthesis engines initialize without runtime errors
 * - DevTools structured system-state extraction (getSystemState)
 * - ErrorBoundary crash recovery options ("Try Again", "Reload App", "Clear Data & Reload")
 *
 * Run with:
 *   npm run test:live:all
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Live-mode guard — real network requests are made below
const describeLive = process.env.TEST_LIVE_API === "true" ? describe : describe.skip;

// ===========================================================================
// 1. REAL-WORLD GROUNDING (Open-Meteo + Calendar Bharat + Google News RSS)
// ===========================================================================

describeLive("Environment Grounding — getEnvironmentSnapshot()", () => {
    it("retrieves live Lucknow temperature/humidity from Open-Meteo", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot).toBeTruthy();
        expect(snapshot.city).toContain("Lucknow");
        expect(snapshot.temperature).toMatch(/\d/);
        expect(snapshot.humidity).toMatch(/\d/);
        console.log(`\n🌍 Weather: ${snapshot.temperature} / ${snapshot.humidity} in ${snapshot.city}`);
    }, 30_000);

    it("retrieves 2026 celebrations from Calendar Bharat", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(false);

        expect(snapshot.todayCelebration).toBeDefined();
        expect(typeof snapshot.todayCelebration).toBe("string");
        expect(Array.isArray(snapshot.upcomingFestivals)).toBe(true);
        const festivalNames = snapshot.upcomingFestivals.map((/** @type {any} */ f) => typeof f === "string" ? f : (f?.name || f?.localName || JSON.stringify(f)));
        console.log(`\n🎉 Today: "${snapshot.todayCelebration}" | Upcoming: ${festivalNames.join(", ") || "(none)"}`);
    }, 30_000);

    it("retrieves headlines from Google News RSS", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(false);

        expect(Array.isArray(snapshot.newsHeadlines)).toBe(true);
        console.log(`\n📰 Headlines (${snapshot.newsHeadlines.length}):`);
        for (const h of snapshot.newsHeadlines.slice(0, 3)) console.log(`  • ${h}`);
    }, 30_000);
});

// ===========================================================================
// 2. WEB AUDIO SYNTHESIS
// ===========================================================================

describe("Web Audio Synthesis — SoundEngine & AmbientSoundEngine", () => {
    it("initializes engines and adjusts gains without runtime errors (no AudioContext in jsdom → guarded no-op)", async () => {
        const soundModule = await import("../../src/util/sound.js");

        expect(soundModule.Sound).toBeTruthy();
        expect(soundModule.AmbientAudio).toBeTruthy();

        // All play/gain APIs must be safe no-ops when AudioContext is unavailable
        expect(() => soundModule.Sound.playMessagePop()).not.toThrow();
        expect(() => soundModule.Sound.playCharacterVoice()).not.toThrow();
        expect(() => soundModule.Sound.toggleSFX()).not.toThrow();

        // Ambient mix controls — gain adjustments must never throw
        expect(() => soundModule.AmbientAudio.setVolume(0.5)).not.toThrow();
        expect(() => soundModule.AmbientAudio.setMix({ melody: 0.4, noise: 0.2, drone: 0.3 })).not.toThrow();
        expect(() => soundModule.AmbientAudio.setBpm(90)).not.toThrow();
        expect(() => soundModule.AmbientAudio.applyPreset("coffee")).not.toThrow();
        expect(() => soundModule.AmbientAudio.stop()).not.toThrow();

        // Mix settings round-trip after preset + volume adjustments
        const mix = soundModule.AmbientAudio.getMixSettings();
        expect(mix.masterVolume).toBeGreaterThanOrEqual(0);
        expect(mix.masterVolume).toBeLessThanOrEqual(1);
    });
});

// ===========================================================================
// 3. DEVTOOLS STRUCTURED STATE INSPECTION
// ===========================================================================

describe("DevTools — getSystemState() structured JSON", () => {
    /** @type {any} */
    let useDevTools;
    /** @type {any} */
    let DevToolsProvider;

    beforeAll(async () => {
        // Minimal conversation manager stub with full cognitive/schedule surface
        const members = new Map([
            ["tom", {
                id: "tom", name: "Tom", age: 22, isAI: true,
                currentEmotion: { name: "Excited" },
                isTyping: false, isReading: false, isThinking: true, isActive: true,
                memory: { values: () => [{ name: "Current Posture", value: "leaning back", expiry: new Date(Date.now() + 900_000), isUsable: () => true }] },
                scheduler: { getTimeline: () => [{}] },
            }],
        ]);
        const conv = {
            world: {
                date: "Mon, 25 Aug 2026",
                time: "16:30",
                environment: { city: "Lucknow, India", temperature: "32°C", humidity: "55%", todayCelebration: "Onam", newsHeadlines: [], upcomingFestivals: [] },
                activeSchedule: {
                    id: "b1", timeRange: "16:00 - 17:00", topic: "Chai break",
                    mainGoal: "Relax with samosas", characterGoals: [{ id: "tom", name: "Tom", goal: "Enjoy chai" }],
                    facts: ["Samosas arrived"], prePlot: "", postPlot: "",
                },
                members,
            },
            chat: { getMessages: () => new Array(5), getMembers: () => Array.from(members.values()) },
            client: { defaultModel: "openai/gpt-oss-120b" },
        };

        vi.doMock("../../src/contexts/ChatContext.jsx", () => ({
            useChat: () => conv,
            ChatProvider: ({ children }) => children,
        }));
        ({ useDevTools, DevToolsProvider } = await import("../../src/contexts/DevToolsContext.jsx"));
    });

    afterAll(() => {
        vi.doUnmock("../../src/contexts/ChatContext.jsx");
    });

    function Probe({ onState }) {
        const ctx = useDevTools();
        onState(ctx.getSystemState());
        return null;
    }

    it("produces structured JSON with character states, memories, and active block metrics", () => {
        /** @type {any} */
        let state = null;
        render(
            React.createElement(
                DevToolsProvider,
                null,
                React.createElement(Probe, { onState: (/** @type {any} */ s) => { state = s; } })
            )
        );

        expect(state.status).toBeUndefined(); // Not an error stub

        // Structured JSON serializable
        const json = JSON.stringify(state);
        expect(json.length).toBeGreaterThan(50);
        expect(() => JSON.parse(json)).not.toThrow();

        // Active block metrics
        expect(state.activeSchedule.topic).toBe("Chai break");
        expect(state.activeSchedule.characterGoals.length).toBeGreaterThan(0);

        // Character cognitive states + memories
        expect(state.characters.length).toBe(1);
        expect(state.characters[0].currentEmotion).toBe("Excited");
        expect(state.characters[0].activity.isThinking).toBe(true);
        expect(state.characters[0].memories[0].key).toBe("Current Posture");
        expect(state.characters[0].memories[0].expiry).toMatch(/m left|Permanent|Expired/u);

        // Engine metrics
        expect(state.chatEngine.totalMessages).toBe(5);
        expect(state.chatEngine.membersCount).toBe(1);
        expect(state.chatEngine.pendingQueuesCount).toBe(1);
    });
});

// ===========================================================================
// 4. ERROR BOUNDARY CRASH RECOVERY
// ===========================================================================

describe("ErrorBoundary — Crash Recovery Options", () => {
    /** @type {typeof import("../../src/components/ErrorBoundary/ErrorBoundary.jsx").default} */
    let ErrorBoundary;

    beforeAll(async () => {
        ({ default: ErrorBoundary } = await import("../../src/components/ErrorBoundary/ErrorBoundary.jsx"));
    });

    /** @returns {never} */
    function Bomb() {
        throw new Error("Simulated UI crash");
    }

    // Suppress React's expected error-boundary console noise and prevent
    // React 19's rethrown uncaught errors from failing the test run
    let consoleErrorSpy;
    /** @type {(e: Event) => void} */
    const swallow = (e) => { e.preventDefault(); };
    beforeAll(() => {
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        window.addEventListener("error", swallow);
    });
    afterAll(() => {
        consoleErrorSpy?.mockRestore();
        window.removeEventListener("error", swallow);
    });

    it("renders all three recovery options on simulated crash", () => {
        render(
            React.createElement(
                ErrorBoundary,
                null,
                React.createElement(Bomb)
            )
        );

        expect(screen.getByText("Something went wrong")).toBeTruthy();
        expect(screen.getByText(/Try Again/u)).toBeTruthy();
        expect(screen.getByText(/Reload App/u)).toBeTruthy();
        expect(screen.getByText(/Clear Data & Reload/u)).toBeTruthy();
    });

    it('"Try Again" resets the boundary and re-renders children cleanly', () => {
        // NOTE: React dev-mode double-invokes function components, so a local
        // counter would hit its "throw once" condition twice in a single render
        // pass. Use an explicit module-scope flag toggled between renders.
        let shouldThrow = true;
        /** @returns {React.JSX.Element} */
        function RecoverableBomb() {
            if (shouldThrow) throw new Error("First crash");
            return React.createElement("div", null, "App recovered");
        }

        render(
            React.createElement(
                ErrorBoundary,
                null,
                React.createElement(RecoverableBomb)
            )
        );
        expect(screen.getByText(/Try Again/u)).toBeTruthy();

        shouldThrow = false;
        fireEvent.click(screen.getByText(/Try Again/u));
        expect(screen.getByText("App recovered")).toBeTruthy();
    });
});
