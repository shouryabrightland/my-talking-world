// @ts-check

/**
 * @file HeaderStatusDot.test.jsx
 * Task 5 — live tri-state engine status dot in the Header:
 * 🟢 idle    (online, no turn/stream in flight)
 * 🟡 busy    (turn request or SSE stream active)
 * 🔴 blocked (offline, circuit open, all Groq models cooling, error backoff)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────

/** @type {any} Mutable conversation double shared with the useChat mock. */
let conv;

vi.mock("../../src/contexts/ChatContext.jsx", () => ({
    useChat: () => conv,
    ChatProvider: ({ children }) => children,
}));

/** @type {boolean} Toggled per test for the offline flag. */
let offline = false;

vi.mock("../../src/contexts/OfflineContext.jsx", () => ({
    useOffline: () => ({ isOnline: !offline, isOffline: offline }),
    OfflineProvider: ({ children }) => children,
}));

vi.mock("../../src/contexts/InputBoxContext.jsx", () => ({
    useInputBox: () => ({
        mode: "user",
        setMode: () => {},
        setIsPlannerOpen: () => {},
        Reply: null,
        setReply: () => {},
    }),
    InputBoxContextProvider: ({ children }) => children,
}));

vi.mock("../../src/components/SettingsModal.jsx", () => ({
    default: () => null,
}));

import Header, { computeEngineStatus } from "../../src/components/Header.jsx";

/**
 * Builds a conversation double reflecting a live engine.
 * @param {Partial<any>} [overrides]
 */
function makeConv(overrides = {}) {
    return {
        requesting: false,
        consecutiveErrors: 0,
        isReady: true,
        client: {
            isStreaming: false,
            circuitState: "closed",
            isCircuitOpen: false,
            modelPool: { allModelsBlocked: () => false },
        },
        chat: {
            getMembers: () => [],
            events: { on: () => () => {} },
        },
        ...overrides,
    };
}

describe("computeEngineStatus — tri-state logic", () => {
    beforeEach(() => {
        offline = false;
    });

    it("is idle when online with no turn and no stream", () => {
        expect(computeEngineStatus(makeConv(), false)).toBe("idle");
    });

    it("is busy while a turn request is in flight", () => {
        expect(computeEngineStatus(makeConv({ requesting: true }), false)).toBe("busy");
    });

    it("is busy while the SSE stream is active", () => {
        const conv_ = makeConv();
        conv_.client.isStreaming = true;
        expect(computeEngineStatus(conv_, false)).toBe("busy");
    });

    it("is blocked when the app is offline", () => {
        expect(computeEngineStatus(makeConv(), true)).toBe("blocked");
    });

    it("is blocked while the circuit breaker is open", () => {
        const conv_ = makeConv();
        conv_.client.circuitState = "open";
        conv_.client.isCircuitOpen = true;
        expect(computeEngineStatus(conv_, false)).toBe("blocked");
    });

    it("is blocked when every Groq chat model is cooling down", () => {
        const conv_ = makeConv();
        conv_.client.modelPool.allModelsBlocked = () => true;
        expect(computeEngineStatus(conv_, false)).toBe("blocked");
    });

    it("is blocked while the engine is in consecutive-error backoff", () => {
        expect(computeEngineStatus(makeConv({ consecutiveErrors: 3 }), false)).toBe("blocked");
    });

    it("blocked wins over busy (engine cannot actually serve the turn)", () => {
        const conv_ = makeConv({ requesting: true, consecutiveErrors: 2 });
        expect(computeEngineStatus(conv_, false)).toBe("blocked");
    });

    it("tolerates reduced harnesses without a client", () => {
        expect(computeEngineStatus({ chat: {} }, false)).toBe("idle");
        expect(computeEngineStatus(null, false)).toBe("idle");
        expect(computeEngineStatus(undefined, true)).toBe("blocked");
    });
});

describe("Header — status dot rendering", () => {
    beforeEach(() => {
        offline = false;
        conv = makeConv();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders the dot before the subtitle with data-status", () => {
        render(<Header title="Tom & Friends" />);

        const dot = screen.getByRole("status");
        expect(dot).toBeTruthy();
        expect(dot.getAttribute("data-status")).toBe("idle");
        expect(dot.getAttribute("aria-label")).toContain("idle");
    });

    it("flips to busy when a turn request starts", () => {
        conv.requesting = true;
        render(<Header title="Tom & Friends" />);

        expect(screen.getByRole("status").getAttribute("data-status")).toBe("busy");
    });

    it("flips to blocked when offline", () => {
        offline = true;
        render(<Header title="Tom & Friends" />);

        const dot = screen.getByRole("status");
        expect(dot.getAttribute("data-status")).toBe("blocked");
        expect(dot.getAttribute("aria-label")).toContain("blocked");
    });

    it("re-polls engine health on its 500ms interval", () => {
        vi.useFakeTimers();
        render(<Header title="Tom & Friends" />);
        expect(screen.getByRole("status").getAttribute("data-status")).toBe("idle");

        conv.requesting = true;
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(screen.getByRole("status").getAttribute("data-status")).toBe("busy");
    });
});
