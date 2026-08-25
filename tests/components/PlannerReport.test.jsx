// @ts-check

/**
 * @file PlannerReport.test.jsx
 * Tests for the Narrative Update Report card: minimize/expand toggle and dismiss behavior.
 * Uses structural validation of the component source (CSS module imports hang vitest).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const COMPONENT_PATH = resolve(import.meta.dirname, "../../src/components/PlannerDrawer.jsx");
const COMPONENT_SOURCE = readFileSync(COMPONENT_PATH, "utf-8");

describe("PlannerDrawer — Narrative Report Card", () => {
    it("renders the Narrative Update Report header", () => {
        expect(COMPONENT_SOURCE).toContain("📋 Narrative Update Report");
    });

    it("has minimize/expand toggle button (▼/▲)", () => {
        expect(COMPONENT_SOURCE).toContain("reportToggleBtn");
        expect(COMPONENT_SOURCE).toContain("isReportMinimized");
    });

    it("toggles isReportMinimized state on toggle button click", () => {
        expect(COMPONENT_SOURCE).toContain("setIsReportMinimized(prev => !prev)");
    });

    it("has a dismiss button (✕)", () => {
        expect(COMPONENT_SOURCE).toContain("reportDismissBtn");
        expect(COMPONENT_SOURCE).toContain("Dismiss report");
    });

    it("dismiss button clears the report and resets minimized state", () => {
        expect(COMPONENT_SOURCE).toContain("setDemandReport(null)");
        expect(COMPONENT_SOURCE).toContain("setIsReportMinimized(false)");
    });

    it("hides report body when minimized", () => {
        expect(COMPONENT_SOURCE).toContain("!isReportMinimized && (");
    });

    it("renders the Summary section", () => {
        expect(COMPONENT_SOURCE).toContain("reportSectionLabel");
        expect(COMPONENT_SOURCE).toContain("💡 Summary");
    });

    it("conditionally renders Continuity Impact section", () => {
        expect(COMPONENT_SOURCE).toContain("🔗 Continuity Impact");
        expect(COMPONENT_SOURCE).toContain("demandReport.continuityImpact");
    });

    it("conditionally renders Character Shifts section", () => {
        expect(COMPONENT_SOURCE).toContain("🎭 Character Shifts");
        expect(COMPONENT_SOURCE).toContain("demandReport.characterShifts");
        expect(COMPONENT_SOURCE).toContain("reportShiftItem");
    });

    it("conditionally renders Transition Hooks section", () => {
        expect(COMPONENT_SOURCE).toContain("🪝 Transition Hooks");
        expect(COMPONENT_SOURCE).toContain("demandReport.transitionHooks");
    });

    it("replaces old simple 2-line feedback with rich report", () => {
        // Old pattern should NOT be present
        expect(COMPONENT_SOURCE).not.toContain("demandFeedback.line1");
        expect(COMPONENT_SOURCE).not.toContain("demandFeedback.line2");
        expect(COMPONENT_SOURCE).not.toContain("Updated:</strong> {demandFeedback");
        // New pattern should be present
        expect(COMPONENT_SOURCE).toContain("demandReport");
        expect(COMPONENT_SOURCE).toContain("reportBody");
    });

    it("uses DemandReport type import", () => {
        expect(COMPONENT_SOURCE).toContain("DemandReport");
    });
});
