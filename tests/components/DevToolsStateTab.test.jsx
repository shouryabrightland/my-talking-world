// @ts-check

/**
 * @file DevToolsStateTab.test.jsx
 * Verifies the intermediate-state inspection cards added for DevTools
 * transparency: SituationEngine (Tier 2) and the Needle query router
 * (Tier 3) — plus graceful rendering of legacy state payloads that
 * predate those cards. (The Unified Memory stack moved to the Settings
 * → Unified Memory tab, so DevTools no longer renders it.)
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../src/contexts/DevToolsContext.jsx", () => ({
    useDevTools: () => ({ verifyModel: vi.fn(async () => ({ ok: true, ms: 1, label: "✓ 1ms", status: null })) }),
    DevToolsProvider: ({ children }) => children
}));

import DevToolsStateTab from "../../src/components/devtools/DevToolsStateTab.jsx";

/**
 * Builds a full system-state payload including the new intermediate-state cards.
 * @returns {any}
 */
function makeFullState() {
    return {
        timestamp: new Date().toISOString(),
        timeWindow: "Tue Oct 07 2026, 10:00",
        activeSchedule: null,
        environment: null,
        characters: [],
        chatEngine: {
            totalMessages: 12,
            membersCount: 6,
            pendingQueuesCount: 3,
            activeModel: "llama-3.3-70b-versatile"
        },
        groqModelPool: { activeModel: null, models: [] },
        geminiModelPool: { activeModel: null, models: [] },
        situationEngine: {
            situationText: "Cast is on the rooftop repairing Angela's drone.",
            unreadCount: 7,
            lastRunTime: "14:30:05",
            isProcessing: false
        },
        needleRouter: {
            isReady: true,
            lastRoute: "tom: chai, plan",
            lastMemorySnippet: "Gomti Nagar stall wale chaiwale se paidaishi dosti hai."
        }
    };
}

describe("DevToolsStateTab — intermediate state inspection cards", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("renders the Ambient Situation Engine card with unread progress and last run", () => {
        render(<DevToolsStateTab liveState={makeFullState()} handleCopyState={() => {}} copied={false} />);

        expect(screen.getByText("🌫️ Ambient Situation Engine")).toBeTruthy();
        expect(screen.getByText("Cast is on the rooftop repairing Angela's drone.")).toBeTruthy();
        expect(screen.getByText("7/10 unread messages")).toBeTruthy();
        expect(screen.getByText("14:30:05")).toBeTruthy();
        expect(screen.getByText("Tier 2")).toBeTruthy();
    });

    it("renders the Needle Query Router card with worker status, route and snippet", () => {
        render(<DevToolsStateTab liveState={makeFullState()} handleCopyState={() => {}} copied={false} />);

        expect(screen.getByText("🎯 Needle Query Router")).toBeTruthy();
        expect(screen.getByText("Wasm Ready")).toBeTruthy();
        expect(screen.getByText("tom: chai, plan")).toBeTruthy();
        expect(screen.getByText("Gomti Nagar stall wale chaiwale se paidaishi dosti hai.")).toBeTruthy();
    });

    it("falls back cleanly when the state payload predates the new cards", () => {
        const legacyState = makeFullState();
        delete legacyState.situationEngine;
        delete legacyState.needleRouter;

        render(<DevToolsStateTab liveState={legacyState} handleCopyState={() => {}} copied={false} />);

        expect(screen.queryByText("🌫️ Ambient Situation Engine")).toBeNull();
        expect(screen.queryByText("🎯 Needle Query Router")).toBeNull();
        // Pre-existing cards still render.
        expect(screen.getByText("💬 Engine & Queue Metrics")).toBeTruthy();
    });
});
