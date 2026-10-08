// tests/components/PresentationView.test.jsx
// @ts-check

/**
 * @file PresentationView tests — continuous 11-station living flowchart.
 * Covers: station rendering, HUD jump dots, scroll-bound progress,
 * keyboard navigation and both onFinish exits (skip + finale CTA).
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresentationView from "../../src/components/presentation/PresentationView.jsx";

/** Exact headlines of the 11 architectural stations (0% → 100% scroll). */
const HEADLINES = [
    "ZERO-SERVER PRIVACY",
    "GROUNDED REALITY",
    "24-HOUR LIVING ARC",
    "DIRECTOR GOD-MODE",
    "20,000-CHAR VAULT",
    "ON-DEVICE 14MB AI CHIP",
    "SUB-SECOND BANTER",
    "PROCEDURAL SOUND ENGINE",
    "UNBREAKABLE ARMOR",
    "LIVE SYSTEM COCKPIT",
    "TAKE THE WHEEL"
];

/**
 * Give the scroll container a deterministic scrollable range in jsdom
 * (which reports 0 for scrollHeight/clientHeight by default).
 * @param {number} scrollHeight
 * @param {number} clientHeight
 * @returns {HTMLElement}
 */
function mountWithScrollRange(scrollHeight, clientHeight) {
    render(<PresentationView onFinish={vi.fn()} />);
    const scroller = screen.getByTestId("presentation-scroll");
    Object.defineProperty(scroller, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: clientHeight, configurable: true });
    return scroller;
}

describe("PresentationView — continuous 11-station flowchart", () => {
    it("renders all 11 stations with their headlines and source chips", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        for (const headline of HEADLINES) {
            expect(screen.getByText(headline)).toBeTruthy();
        }

        // Every station section is present in the continuous pipeline.
        for (let i = 1; i <= 11; i++) {
            expect(screen.getByTestId(`station-${i}`)).toBeTruthy();
        }

        // Source-module chips prove the pipeline maps to real architecture.
        expect(screen.getByText("apiKeys.js")).toBeTruthy();
        expect(screen.getByText("WorldSetter.js")).toBeTruthy();
        expect(screen.getByText("sound.js")).toBeTruthy();
        expect(screen.getByText("Chat.jsx")).toBeTruthy();

        // Station 06 chip carries the exact spec label.
        expect(screen.getByText("Needle 2 • 14MB Wasm")).toBeTruthy();
    });

    it("shows the glass HUD: brand, 11 jump dots, progress bar and skip button", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        expect(screen.getByText("TOM & FRIENDS • LIVING SITCOM")).toBeTruthy();
        expect(screen.getByText("0%")).toBeTruthy();

        const dots = screen.getAllByRole("button", { name: /^Station \d+:/ });
        expect(dots).toHaveLength(11);

        // No slide-deck controls survive the rewrite.
        expect(screen.queryByRole("button", { name: /Next Scene/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Prev/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Launch Studio/ })).toBeNull();
    });

    it("jump dots activate the target station along the pipeline", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        expect(screen.getByTestId("station-1").getAttribute("data-active")).toBe("true");

        fireEvent.click(screen.getByRole("button", { name: "Station 4: Director" }));

        expect(screen.getByTestId("station-4").getAttribute("data-active")).toBe("true");
        expect(screen.getByTestId("station-1").getAttribute("data-active")).toBe("false");
        expect(
            screen.getByRole("button", { name: "Station 4: Director" }).getAttribute("aria-current")
        ).toBe("step");
    });

    it("scroll position drives --scroll-progress, the HUD label and the active station", () => {
        const scroller = mountWithScrollRange(1100, 100);

        scroller.scrollTop = 500;
        fireEvent.scroll(scroller);

        expect(scroller.style.getPropertyValue("--scroll-progress")).toBe("0.5000");
        expect(screen.getByText("50%")).toBeTruthy();

        // floor(0.50 × 11) = 5 → Station 06 is the live node.
        expect(screen.getByTestId("station-6").getAttribute("data-active")).toBe("true");
        // Everything already streamed past stays marked as passed.
        expect(screen.getByTestId("station-3").getAttribute("data-past")).toBe("true");
        expect(screen.getByTestId("station-9").getAttribute("data-past")).toBe("false");
    });

    it("keyboard arrows walk the pipeline one station at a time", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(screen.getByTestId("station-2").getAttribute("data-active")).toBe("true");

        fireEvent.keyDown(window, { key: "PageDown" });
        expect(screen.getByTestId("station-3").getAttribute("data-active")).toBe("true");

        fireEvent.keyDown(window, { key: "ArrowUp" });
        expect(screen.getByTestId("station-2").getAttribute("data-active")).toBe("true");
    });

    it("Escape exits straight back to the studio", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("triggers onFinish from the fixed HUD skip button", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        fireEvent.click(screen.getByRole("button", { name: /Enter Live Studio ⏩/ }));
        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("triggers onFinish from the finale CTA at 100% scroll", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        const cta = screen.getByRole("button", { name: /Enter Live Studio 🚀/ });
        expect(screen.getByTestId("station-11").contains(cta)).toBe(true);

        fireEvent.click(cta);
        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("micro-widgets are interactive: thought peek and armor switches", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        const peek = screen.getByRole("button", { name: /Peek Thought/ });
        expect(peek.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(peek);
        expect(peek.getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByText(/Lighting best rahegi/)).toBeTruthy();

        const breaker = screen.getByRole("switch", { name: "Circuit Breaker" });
        expect(breaker.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(breaker);
        expect(breaker.getAttribute("aria-checked")).toBe("true");
        expect(screen.getByText(/outage absorbed/)).toBeTruthy();
    });
});
