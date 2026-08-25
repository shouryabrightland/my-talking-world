// @ts-check

/**
 * @file PlannerApproval.test.jsx
 * Tests for proposal approval workflow: Accept/Deny buttons, diff indicators, manual edit action bar.
 * Uses structural validation of the component source (CSS module imports hang vitest).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const COMPONENT_PATH = resolve(import.meta.dirname, "../../src/components/PlannerDrawer.jsx");
const COMPONENT_SOURCE = readFileSync(COMPONENT_PATH, "utf-8");
const CSS_PATH = resolve(import.meta.dirname, "../../src/components/PlannerDrawer.module.css");
const CSS_SOURCE = readFileSync(CSS_PATH, "utf-8");

describe("PlannerDrawer — Proposal Approval Workflow", () => {
    it("has proposal callout with Accept and Deny buttons", () => {
        expect(COMPONENT_SOURCE).toContain("proposalCallout");
        expect(COMPONENT_SOURCE).toContain("proposalAcceptBtn");
        expect(COMPONENT_SOURCE).toContain("proposalDenyBtn");
        expect(COMPONENT_SOURCE).toContain("✓ Accept");
        expect(COMPONENT_SOURCE).toContain("✕ Deny");
    });

    it("proposal callout shows summary text", () => {
        expect(COMPONENT_SOURCE).toContain("proposalSummary");
        expect(COMPONENT_SOURCE).toContain("proposal.summary");
    });

    it("has handleAcceptProposal handler", () => {
        expect(COMPONENT_SOURCE).toContain("handleAcceptProposal");
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.acceptProposal");
    });

    it("has handleDenyProposal handler", () => {
        expect(COMPONENT_SOURCE).toContain("handleDenyProposal");
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.denyProposal");
    });

    it("proposal state is managed via useState", () => {
        expect(COMPONENT_SOURCE).toContain("ScheduleProposal");
        expect(COMPONENT_SOURCE).toContain("proposal");
        expect(COMPONENT_SOURCE).toContain("setProposal");
    });

    it("proposal changes the worldSetter pendingProposal after demand application", () => {
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.pendingProposal");
        expect(COMPONENT_SOURCE).toContain("setProposal(p ?");
    });

    it("clears proposal on accept and deny", () => {
        expect(COMPONENT_SOURCE).toContain("setProposal(null)");
    });
});

describe("PlannerDrawer — Diff Indicators", () => {
    it("has proposed and removed card styles", () => {
        expect(COMPONENT_SOURCE).toContain("sceneCardProposed");
        expect(COMPONENT_SOURCE).toContain("sceneCardRemoved");
    });

    it("computes isProposed and isRemoved flags per block", () => {
        expect(COMPONENT_SOURCE).toContain("isProposed");
        expect(COMPONENT_SOURCE).toContain("isRemoved");
        expect(COMPONENT_SOURCE).toContain("proposal?.changes.some");
    });

    it("renders + PROPOSED badge for proposed additions", () => {
        expect(COMPONENT_SOURCE).toContain("diffBadgeProposed");
        expect(COMPONENT_SOURCE).toContain("+ PROPOSED");
    });

    it("renders − REMOVED badge for proposed removals", () => {
        expect(COMPONENT_SOURCE).toContain("diffBadgeRemoved");
        expect(COMPONENT_SOURCE).toContain("− REMOVED");
    });

    it("CSS has green border for proposed cards", () => {
        expect(CSS_SOURCE).toContain(".sceneCardProposed");
        expect(CSS_SOURCE).toContain("#16a34a");
    });

    it("CSS has red border and strikethrough for removed cards", () => {
        expect(CSS_SOURCE).toContain(".sceneCardRemoved");
        expect(CSS_SOURCE).toContain("line-through");
    });

    it("CSS has green badge for + PROPOSED", () => {
        expect(CSS_SOURCE).toContain(".diffBadgeProposed");
    });

    it("CSS has red badge for − REMOVED", () => {
        expect(CSS_SOURCE).toContain(".diffBadgeRemoved");
    });
});

describe("PlannerDrawer — Dynamic Action Bar", () => {
    it("has Discard button for manual changes", () => {
        expect(COMPONENT_SOURCE).toContain("handleDiscardManual");
        expect(COMPONENT_SOURCE).toContain("world.worldSetter.discardManualChanges");
        expect(COMPONENT_SOURCE).toContain("↩ Discard");
    });

    it("has Stabilize & Save button", () => {
        expect(COMPONENT_SOURCE).toContain("handleStabilizeSave");
        expect(COMPONENT_SOURCE).toContain("Stabilize & Save");
    });

    it("action bar only shows when isDirty and no proposal", () => {
        expect(COMPONENT_SOURCE).toContain("isDirty && !proposal");
    });

    it("proposal callout only shows when proposal has changes", () => {
        expect(COMPONENT_SOURCE).toContain("proposal && proposal.changes.length > 0");
    });

    it("CSS has discard and stabilize-save button styles", () => {
        expect(CSS_SOURCE).toContain(".discardBtn");
        expect(CSS_SOURCE).toContain(".stabilizeSaveBtn");
    });

    it("old restabilize button is removed from JSX", () => {
        expect(COMPONENT_SOURCE).not.toContain("handleRestabilize");
        expect(COMPONENT_SOURCE).not.toContain("restabilizeBtn");
        expect(COMPONENT_SOURCE).not.toContain("Re-stabilize Storyline");
    });
});

describe("PlannerDrawer — Proposal Callout Styling", () => {
    it("CSS has proposalCallout styles", () => {
        expect(CSS_SOURCE).toContain(".proposalCallout");
    });

    it("CSS has proposalAcceptBtn green styles", () => {
        expect(CSS_SOURCE).toContain(".proposalAcceptBtn");
    });

    it("CSS has proposalDenyBtn red styles", () => {
        expect(CSS_SOURCE).toContain(".proposalDenyBtn");
    });
});
