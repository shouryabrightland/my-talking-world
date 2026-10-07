// tests/components/PresentationView.test.jsx
// @ts-check

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresentationView from "../../src/components/presentation/PresentationView.jsx";

describe("PresentationView — 3D Scrollytelling Presentation", () => {
    it("renders Act 0 (The Breakthrough) by default with bold headlines", () => {
        render(<PresentationView onFinish={vi.fn()} />);
        expect(screen.getByText("CHATBOTS ARE DEAD.")).toBeTruthy();
        expect(screen.getByText("WE BUILT A LIVING SITCOM.")).toBeTruthy();
        expect(screen.getByText(/CBSE HACKATHON 2026/)).toBeTruthy();
    });

    it("advances scenes when clicking next scene button", () => {
        render(<PresentationView onFinish={vi.fn()} />);

        const nextBtn = screen.getByRole("button", { name: /Next Scene →/ });
        fireEvent.click(nextBtn);

        expect(screen.getByText("AI GROUNDED IN")).toBeTruthy();
        expect(screen.getByText("TODAY'S REAL WORLD.")).toBeTruthy();
    });

    it("triggers onFinish when clicking 'Enter Live Studio ⏩' in nav header", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        const skipBtn = screen.getByRole("button", { name: /Enter Live Studio ⏩/ });
        fireEvent.click(skipBtn);

        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("triggers onFinish when clicking launch button in Act 5", () => {
        const onFinish = vi.fn();
        render(<PresentationView onFinish={onFinish} />);

        // Advance to the final scene
        for (let i = 0; i < 5; i++) {
            const nextBtn = screen.getByRole("button", { name: /Next Scene →/ });
            fireEvent.click(nextBtn);
        }

        const launchBtn = screen.getByRole("button", { name: /Launch Studio 🚀/ });
        fireEvent.click(launchBtn);

        expect(onFinish).toHaveBeenCalledTimes(1);
    });
});