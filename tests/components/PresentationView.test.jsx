// tests/components/PresentationView.test.jsx
// @ts-check

/**
 * @file PresentationView tests — single-unit phone scrollytelling.
 * Covers: HUD (brand, 11 dots, progress, skip), per-step caption reveals,
 * scroll-bound --scroll-progress / --t clock, in-phone screen crossfades
 * (the phone frame never breaks apart), keyboard navigation and all three
 * exits (Escape, skip, finale CTA).
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresentationView, { PRESENTATION_LAYERS } from "../../src/components/presentation/PresentationView.jsx";

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

describe("PresentationView — single-unit phone scrollytelling", () => {
    it("renders ONE phone unit with a home screen and 9 in-screen layers, HUD and 11 jump dots", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        expect(screen.getByText("TOM & FRIENDS • LIVING SITCOM")).toBeTruthy();
        expect(screen.getByText("0%")).toBeTruthy();

        // Exactly one phone — the frame never breaks into pieces.
        expect(screen.getAllByTestId("phone")).toHaveLength(1);

        // The cast home screen is live on the intro step…
        expect(screen.getByTestId("screen-home").getAttribute("data-active")).toBe("true");

        // …and all nine layer screens are staged inside it (inactive for now).
        for (let k = 0; k < 9; k++) {
            expect(screen.getByTestId(`screen-${k}`).getAttribute("data-active")).toBe("false");
        }
        expect(screen.getByText("DISPLAY")).toBeTruthy();
        expect(screen.getByText("NEEDLE CHIP")).toBeTruthy();
        expect(screen.getByText("COCKPIT")).toBeTruthy();

        // Intro caption with plain-language blurb + source chips.
        expect(screen.getByTestId("caption-1")).toBeTruthy();
        expect(screen.getByText("A LIVING SITCOM IN YOUR POCKET")).toBeTruthy();
        expect(screen.getByText(/six AI friends hang out/i)).toBeTruthy();
        expect(screen.getByText("Chat.jsx")).toBeTruthy();

        const dots = screen.getAllByRole("button", { name: /^Step \d+: / });
        expect(dots).toHaveLength(PRESENTATION_LAYERS.length);
        expect(dots).toHaveLength(11);
    });

    it("every jump dot reveals its own step caption (all 11 headlines reachable)", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        for (const layer of PRESENTATION_LAYERS) {
            fireEvent.click(screen.getByRole("button", { name: `Step ${layer.id}: ${layer.label}` }));
            expect(screen.getByTestId(`caption-${layer.id}`)).toBeTruthy();
            expect(screen.getByText(layer.headline)).toBeTruthy();
            expect(screen.getByText(layer.blurb)).toBeTruthy();
        }
    });

    it("jump dots mark the active step on the HUD, track and phone screen", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        const root = screen.getByTestId("presentation-scroll");
        expect(root.getAttribute("data-active-step")).toBe("0");
        expect(screen.getByTestId("step-1").getAttribute("data-active")).toBe("true");

        fireEvent.click(screen.getByRole("button", { name: "Step 4: Director" }));

        expect(root.getAttribute("data-active-step")).toBe("3");
        expect(screen.getByTestId("step-4").getAttribute("data-active")).toBe("true");
        expect(screen.getByTestId("step-1").getAttribute("data-active")).toBe("false");
        expect(screen.getByTestId("step-1").getAttribute("data-past")).toBe("true");
        expect(
            screen.getByRole("button", { name: "Step 4: Director" }).getAttribute("aria-current")
        ).toBe("step");

        // The Director screen (k=2) plays inside the phone while its step is active.
        expect(screen.getByTestId("screen-2").getAttribute("data-active")).toBe("true");
        expect(screen.getByTestId("screen-0").getAttribute("data-active")).toBe("false");
        expect(screen.getByTestId("screen-home").getAttribute("data-active")).toBe("false");
    });

    it("scroll drives --scroll-progress, the parallax clock --t, the HUD label and the active step", () => {
        const scroller = mountWithScrollRange(1100, 100);

        scroller.scrollTop = 500;
        fireEvent.scroll(scroller);

        expect(scroller.style.getPropertyValue("--scroll-progress")).toBe("0.5000");
        // Continuous step clock: progress × 11 steps.
        expect(scroller.style.getPropertyValue("--t")).toBe("5.5000");
        expect(screen.getByText("50%")).toBeTruthy();

        // floor(0.50 × 11) = 5 → Step 06 (Chip) is the live caption.
        expect(screen.getByTestId("step-6").getAttribute("data-active")).toBe("true");
        expect(screen.getByTestId("caption-6")).toBeTruthy();
        // Everything already scrolled past stays marked as passed.
        expect(screen.getByTestId("step-3").getAttribute("data-past")).toBe("true");
        expect(screen.getByTestId("step-9").getAttribute("data-past")).toBe("false");
    });

    it("layer screens crossfade inside the phone — the frame never peels apart", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        // Regression: screens carry NO inline transforms (the old design
        // exploded the phone with per-slab translateY peel math).
        for (let k = 0; k < 9; k++) {
            const transform = screen.getByTestId(`screen-${k}`).style.getPropertyValue("transform");
            expect(transform).toBe("");
        }

        // Intro: home screen plays, layers idle.
        expect(screen.getByTestId("screen-home").getAttribute("data-active")).toBe("true");

        // First layer step swaps the home screen for the Display widget.
        fireEvent.click(screen.getByRole("button", { name: "Step 2: Display" }));
        expect(screen.getByTestId("screen-0").getAttribute("data-active")).toBe("true");
        expect(screen.getByTestId("screen-home").getAttribute("data-active")).toBe("false");

        // Finale returns to the home screen inside the same phone frame.
        fireEvent.click(screen.getByRole("button", { name: "Step 11: Wheel" }));
        expect(screen.getByTestId("screen-home").getAttribute("data-active")).toBe("true");
        expect(screen.getByTestId("screen-0").getAttribute("data-active")).toBe("false");
    });

    it("renders the cinematic FX canvas and drives zoom pulse + sway from scroll", () => {
        const scroller = mountWithScrollRange(1100, 100);

        // Starfield canvas behind the stage (2D context guarded for jsdom).
        expect(screen.getByTestId("fx-canvas")).toBeTruthy();

        scroller.scrollTop = 500;
        fireEvent.scroll(scroller);

        // t = 5.5 → pulse peaks exactly at step centers (0.5 − 0.5·cos(π) = 1).
        expect(scroller.style.getPropertyValue("--pulse")).toBe("1.0000");
        // Continuous yaw sway in degrees, written every frame.
        const sway = parseFloat(scroller.style.getPropertyValue("--sway"));
        expect(Number.isNaN(sway)).toBe(false);
        expect(sway).not.toBe(0);
    });

    it("keyboard arrows walk the pipeline one step at a time", () => {
        render(<PresentationView onFinish={vi.fn()} />);
        const root = screen.getByTestId("presentation-scroll");

        fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(root.getAttribute("data-active-step")).toBe("1");

        fireEvent.keyDown(window, { key: "PageDown" });
        expect(root.getAttribute("data-active-step")).toBe("2");

        fireEvent.keyDown(window, { key: "ArrowUp" });
        expect(root.getAttribute("data-active-step")).toBe("1");
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

    it("the finale returns home and offers the studio CTA", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        fireEvent.click(screen.getByRole("button", { name: "Step 11: Wheel" }));

        const cta = screen.getByRole("button", { name: /Enter Live Studio 🚀/ });
        expect(screen.getByTestId("caption-11").contains(cta)).toBe(true);
        expect(screen.getByText("TAKE THE WHEEL")).toBeTruthy();
        expect(screen.getByTestId("screen-home").getAttribute("data-active")).toBe("true");

        fireEvent.click(cta);
        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("layer screens carry the self-explanatory story text", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        // Display: live chat + typing indicator.
        expect(screen.getByText(/Ben is typing/i)).toBeTruthy();
        // Reality: live grounding chips + news ticker.
        expect(screen.getByText("🌡️ 32°C, Warm")).toBeTruthy();
        // Memory: the 20k gauge.
        expect(screen.getByText("8,432 / 20,000 chars")).toBeTruthy();
        // Engines: on-device keys.
        expect(screen.getByText(/keys never leave this phone/i)).toBeTruthy();
        // Armor: self-healing guards.
        expect(screen.getByText("Breaker: CLOSED ✓")).toBeTruthy();
    });
});
