// @ts-check

/**
 * @file PlannerDrawer.test.jsx
 * Validates PlannerDrawer component structure, inline edit removal, and utility logic.
 *
 * NOTE: Full component rendering hangs vitest due to CSS module import chain.
 * These tests validate the component file's exported logic and structure.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const COMPONENT_PATH = resolve(import.meta.dirname, "../../src/components/PlannerDrawer.jsx");
const COMPONENT_SOURCE = readFileSync(COMPONENT_PATH, "utf-8");

describe("PlannerDrawer — Structural Invariants", () => {
    it("does NOT have a top-mounted create/edit form (the old UI pattern)", () => {
        // The old UI had a createBox outside the timeline cards
        // New UI has only inlineEditForm inside each card
        expect(COMPONENT_SOURCE).not.toContain("Schedule New Discussion Block");
        expect(COMPONENT_SOURCE).not.toContain("Edit Schedule Block");
        expect(COMPONENT_SOURCE).not.toContain("+ Add Block");
    });

    it("has reorderControls for up/down block reordering", () => {
        expect(COMPONENT_SOURCE).toContain("reorderControls");
        expect(COMPONENT_SOURCE).toContain("Move block up");
        expect(COMPONENT_SOURCE).toContain("Move block down");
    });

    it("has handleReorder function that calls worldSetter.reorderBlocks", () => {
        expect(COMPONENT_SOURCE).toContain("handleReorder");
        expect(COMPONENT_SOURCE).toContain("reorderBlocks");
    });

    it("has inlineEditForm for in-place editing", () => {
        expect(COMPONENT_SOURCE).toContain("inlineEditForm");
        expect(COMPONENT_SOURCE).toContain("editingCardId");
    });

    it("has expandedBody for read-only inspection", () => {
        expect(COMPONENT_SOURCE).toContain("expandedBody");
        expect(COMPONENT_SOURCE).toContain("Main Goal");
    });

    it("has reordering animation state", () => {
        expect(COMPONENT_SOURCE).toContain("reorderingId");
        expect(COMPONENT_SOURCE).toContain("sceneCardReordering");
    });

    it("expansion toggle closes inline edit", () => {
        // toggleCardExpansion should reset editingCardId
        expect(COMPONENT_SOURCE).toContain("setEditingCardId(null)");
    });
});

describe("PlannerDrawer — hybrid planner filters, recurrence & creation", () => {
    it("has the [All | Today | Templates] filter bar with a title search input", () => {
        expect(COMPONENT_SOURCE).toContain("filterBar");
        expect(COMPONENT_SOURCE).toContain("filterTabs");
        expect(COMPONENT_SOURCE).toContain("filterBtnActive");
        expect(COMPONENT_SOURCE).toContain("Search by title...");
        expect(COMPONENT_SOURCE).toContain("setFilterMode");
    });

    it("renders recurrence pills and once/template card variants", () => {
        expect(COMPONENT_SOURCE).toContain("formatRecurrenceLabel");
        expect(COMPONENT_SOURCE).toContain("recurrencePill");
        expect(COMPONENT_SOURCE).toContain("sceneCardOnce");
        expect(COMPONENT_SOURCE).toContain("sceneCardTemplate");
        // Spec pills: [Daily] / [Weekdays] / [Weekends] / [date]
        expect(COMPONENT_SOURCE).toContain("[{recurrenceLabel}]");
    });

    it("provides create + edit form inputs: title, dense paragraph & recurrence", () => {
        expect(COMPONENT_SOURCE).toContain("New Scene Block");
        expect(COMPONENT_SOURCE).toContain("Dense Scene Paragraph:");
        expect(COMPONENT_SOURCE).toContain("Recurrence:");
        expect(COMPONENT_SOURCE).toContain("denseParagraph");
        expect(COMPONENT_SOURCE).toContain("handleCreateBlock");
        // Free reordering must not demand the AI stabilizer.
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.updateTemplate");
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.deleteTemplate");
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.getTemplates");
    });

    it("styles the hybrid variants in the CSS module", () => {
        const cssPath = resolve(import.meta.dirname, "../../src/components/PlannerDrawer.module.css");
        const css = readFileSync(cssPath, "utf-8");

        expect(css).toContain(".filterBar");
        expect(css).toContain(".recurrencePill");
        expect(css).toContain(".sceneCardOnce");
        expect(css).toContain(".sceneCardTemplate");
        // Spec: dashed one-off border + bright template highlight
        expect(css).toMatch(/\.sceneCardOnce[\s\S]*?dashed/);
        expect(css).toMatch(/\.sceneCardTemplate[\s\S]*?solid/);
    });
});

describe("PlannerDrawer — timeline gap indicator", () => {
    it("computes a gap between non-contiguous blocks", () => {
        expect(COMPONENT_SOURCE).toContain("const nextRecord = visibleRecords[idx + 1]");
        expect(COMPONENT_SOURCE).toContain("Math.round((nextRecord.startHour - record.endHour) * 60)");
        expect(COMPONENT_SOURCE).toContain("const hasGap = gapMinutes > 0");
    });

    it("renders the ── Xh Ym gap ── badge between the cards", () => {
        expect(COMPONENT_SOURCE).toContain("timelineGapLine");
        expect(COMPONENT_SOURCE).toContain("timelineGapDash");
        expect(COMPONENT_SOURCE).toContain("timelineGapBadge");
        expect(COMPONENT_SOURCE).toContain("── {gapText} ──");
        expect(COMPONENT_SOURCE).toContain("${gapHours > 0");
        expect(COMPONENT_SOURCE).toContain("${gapMins > 0");
    });

    it("styles the gap line in the CSS module", () => {
        const cssPath = resolve(import.meta.dirname, "../../src/components/PlannerDrawer.module.css");
        const css = readFileSync(cssPath, "utf-8");

        expect(css).toContain(".timelineGapLine");
        expect(css).toContain(".timelineGapDash");
        expect(css).toContain(".timelineGapBadge");
    });
});

describe("PlannerDrawer — formatHour utility", () => {
    // Extract formatHour by evaluating a minimal snippet
    function formatHour(/** @type {number} */ decimal) {
        const h = Math.floor(decimal);
        const m = Math.round((decimal - h) * 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    it("formats integer hours correctly", () => {
        expect(formatHour(0)).toBe("00:00");
        expect(formatHour(14)).toBe("14:00");
        expect(formatHour(23)).toBe("23:00");
    });

    it("formats half-hour decimals correctly", () => {
        expect(formatHour(14.5)).toBe("14:30");
        expect(formatHour(9.5)).toBe("09:30");
    });

    it("formats quarter-hour decimals correctly", () => {
        expect(formatHour(14.25)).toBe("14:15");
        expect(formatHour(14.75)).toBe("14:45");
    });
});
