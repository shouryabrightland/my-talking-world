// tests/components/PresentationView.test.jsx
// @ts-check

/**
 * @file PresentationView.test.jsx
 * Unit & Integration tests for the 3D Exploded-View Scrollytelling Presentation System.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresentationView, { PRESENTATION_LAYERS } from "../../src/components/presentation/PresentationView.jsx";

describe("PresentationView — High-Zoom 3D Scrollytelling Presentation", () => {
    it("renders Step 1 (Studio) by default with giant headlines, real phone chassis, and 12 jump dots", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        expect(screen.getByText("CHATBOTS ARE DEAD.")).toBeTruthy();
        expect(screen.getByText("A LIVING SITCOM IN YOUR POCKET.")).toBeTruthy();
        expect(screen.getByText(/CBSE HACKATHON 2026/)).toBeTruthy();

        // Real 3D phone chassis exists
        expect(screen.getByTestId("phone")).toBeTruthy();

        // All 12 navigation step dots are rendered
        const dots = screen.getAllByRole("button", { name: /^Step \d+: / });
        expect(dots).toHaveLength(PRESENTATION_LAYERS.length);
        expect(dots).toHaveLength(12);
    });

    it("every jump dot reveals its own detailed feature scene across all 12 steps", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        for (const layer of PRESENTATION_LAYERS) {
            fireEvent.click(screen.getByRole("button", { name: `Step ${layer.id}: ${layer.label}` }));
            expect(screen.getByTestId(`caption-${layer.id}`)).toBeTruthy();
            expect(screen.getByText(layer.headline)).toBeTruthy();
            expect(screen.getByText(layer.blurb)).toBeTruthy();
        }
    });

    it("displays floating holographic tooltip callouts on focused feature scenes", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        // Step 1: Studio Overview tooltip
        expect(screen.getByText("Autonomous Multi-Agent World")).toBeTruthy();

        // Jump to Step 3: Reality (SceneBar)
        fireEvent.click(screen.getByRole("button", { name: "Step 3: Reality" }));
        expect(screen.getByText("Real-Time Environmental Anchor")).toBeTruthy();

        // Jump to Step 6: Chip (Needle 2)
        fireEvent.click(screen.getByRole("button", { name: "Step 6: Chip" }));
        expect(screen.getByText("Needle 2 On-Device Router")).toBeTruthy();
    });

    it("renders the bifurcated view with overall project engineering statistics on Step 11", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        fireEvent.click(screen.getByRole("button", { name: "Step 11: Exploded" }));

        expect(screen.getByText(/52 Source Files/)).toBeTruthy();
        expect(screen.getByText(/28,000\+ LoC/)).toBeTruthy();
        expect(screen.getByText(/371\/371 Vitest/)).toBeTruthy();
        expect(screen.getByText(/0 Remote Servers/)).toBeTruthy();
    });

    it("triggers onFinish when clicking 'Enter Live Studio ⏩' in nav header", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        const skipBtn = screen.getByRole("button", { name: /Enter Live Studio ⏩/ });
        fireEvent.click(skipBtn);

        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("triggers onFinish when clicking launch button in the Step 12 finale", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        // Jump to Step 12
        fireEvent.click(screen.getByRole("button", { name: "Step 12: Wheel" }));

        const launchBtn = screen.getByRole("button", { name: /Launch Studio 🚀/ });
        fireEvent.click(launchBtn);

        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("keyboard Escape triggers onFinish immediately", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onFinish).toHaveBeenCalledTimes(1);
    });
});