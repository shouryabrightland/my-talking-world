// @ts-check

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// NOTE: never call context actions (addNotification etc.) during render —
// each call schedules a state update with a fresh ID, causing an infinite
// re-render loop that hangs vitest. Fire them from an effect instead.

vi.mock("../../src/contexts/ChatContext.jsx", () => ({
    useChat: () => ({
        world: { events: { on: () => () => {}, emit: () => {} }, now: new Date(), User: { memory: { values: () => [] } } },
        chat: { getMessages: () => [] },
    }),
    ChatProvider: ({ children }) => children,
}));

vi.mock("../../src/classes/WorldSetter.js", () => ({
    PlannerStreamEvents: { START: "x", TEXT: "x", BLOCK: "x", DONE: "x", ERROR: "x" },
    default: class WorldSetter {},
}));

vi.mock("../../src/components/BackgroundBar.module.css", () => ({
    default: new Proxy({}, { get: (_, key) => String(key) }),
}));

import BackgroundBar from "../../src/components/BackgroundBar.jsx";
import { BackgroundBarProvider, useBackgroundBar } from "../../src/contexts/BackgroundBarContext.jsx";

function Trigger({ fn }) {
    const ctx = useBackgroundBar();
    const fired = React.useRef(false);
    React.useEffect(() => {
        if (!fired.current) {
            fired.current = true;
            fn(ctx);
        }
    });
    return null;
}

describe("BackgroundBar", () => {
    it("hidden when idle", () => {
        render(<BackgroundBarProvider><BackgroundBar /></BackgroundBarProvider>);
        expect(screen.queryByText("Generating schedule...")).toBeNull();
    });

    it("shows notification", () => {
        render(
            <BackgroundBarProvider>
                <Trigger fn={(ctx) => ctx.addNotification("stream", "Hello")} />
                <BackgroundBar />
            </BackgroundBarProvider>
        );
        expect(screen.getByText("Hello")).toBeTruthy();
    });

    it("error shows retry", () => {
        render(
            <BackgroundBarProvider>
                <Trigger fn={(ctx) => ctx.addNotification("error", "Oops", { retryFn: async () => {} })} />
                <BackgroundBar />
            </BackgroundBarProvider>
        );
        expect(screen.getByText("Oops")).toBeTruthy();
        expect(screen.getByTitle("Retry")).toBeTruthy();
    });

    it("remove clears", () => {
        let notifications = [];
        let actions = null;
        function C() {
            const ctx = useBackgroundBar();
            notifications = ctx.notifications;
            actions = ctx;
            return null;
        }
        render(
            <BackgroundBarProvider>
                <C />
                <BackgroundBar />
            </BackgroundBarProvider>
        );
        let id = "";
        act(() => { id = actions.addNotification("info", "X"); });
        expect(notifications).toHaveLength(1);
        act(() => { actions.removeNotification(id); });
        expect(notifications).toHaveLength(0);
    });

    it("network offline", () => {
        let notifications = [];
        function C() {
            notifications = useBackgroundBar().notifications;
            return null;
        }
        render(
            <BackgroundBarProvider>
                <C />
                <BackgroundBar />
            </BackgroundBarProvider>
        );
        act(() => { window.dispatchEvent(new Event("offline")); });
        expect(notifications.some(n => n.type === "disconnect")).toBe(true);
    });
});
