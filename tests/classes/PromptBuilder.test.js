// @ts-check

/**
 * @file PromptBuilder.test.js
 * Verifies Hinglish language mandate is present in prompt templates
 * and that the compiled system prompt contains the directive.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Logger
vi.mock("../../src/classes/lib/Logger.js", () => ({
    default: class MockLogger {
        constructor(name = "Mock") { this.name = name; }
        child(name) { return new MockLogger(`${this.name}:${name}`); }
        info() {}
        warn() {}
        error() {}
        debug() {}
    }
}));

import PromptBuilder from "../../src/classes/PromptBuilder.js";
import {
    PROMPT_DIALOGUE_TASK,
    PROMPT_DIALOGUE_RULES,
    PROMPT_LANGUAGE_MANDATE,
    PROMPT_LOCATION_MANDATE
} from "../../src/util/prompts.js";

// ─── Devanagari Unicode range: \u0900–\u097F ───
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

describe("Prompt Templates — Hinglish Language Mandate", () => {

    describe("PROMPT_DIALOGUE_TASK", () => {
        it("delegates language rules to the single <language_mandate> block", () => {
            expect(PROMPT_DIALOGUE_TASK).toContain("<language_mandate>");
            expect(PROMPT_DIALOGUE_TASK).toContain("never restate");
        });

        it("does NOT restate the language mandate itself (de-duplicated)", () => {
            expect(PROMPT_DIALOGUE_TASK).not.toContain("Hinglish");
            expect(PROMPT_DIALOGUE_TASK.toLowerCase()).not.toContain("devanagari");
        });

        it("the authoritative mandate keeps every original language rule", () => {
            expect(PROMPT_LANGUAGE_MANDATE).toContain("Hinglish");
            expect(PROMPT_LANGUAGE_MANDATE).toContain("Roman/Latin script");
            expect(PROMPT_LANGUAGE_MANDATE.toLowerCase()).toContain("no devanagari");
            expect(PROMPT_LANGUAGE_MANDATE).toContain("Arre");
            expect(PROMPT_LANGUAGE_MANDATE).toContain("kab tak");
            expect(DEVANAGARI_REGEX.test(PROMPT_LANGUAGE_MANDATE)).toBe(false);
        });

        it("does NOT contain any Devanagari characters", () => {
            expect(DEVANAGARI_REGEX.test(PROMPT_DIALOGUE_TASK)).toBe(false);
        });

        it("still contains the original dialogue generation instruction", () => {
            expect(PROMPT_DIALOGUE_TASK).toContain("group chat");
            expect(PROMPT_DIALOGUE_TASK).toContain("personality");
        });
    });

    describe("PROMPT_DIALOGUE_RULES", () => {
        it("contains a pointer to the single <language_mandate> (de-duplicated)", () => {
            const pointerRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("<language_mandate>"));
            expect(pointerRule).toBeDefined();
            expect(pointerRule).toContain("Hinglish");
        });

        it("does NOT restate the Devanagari prohibition (mandate owns it)", () => {
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("Devanagari"))).toBe(false);
            expect(PROMPT_LANGUAGE_MANDATE.toLowerCase()).toContain("devanagari");
        });

        it("contains Lucknow/Indian banter preference", () => {
            const banterRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("Lucknow") || r.includes("Indian"));
            expect(banterRule).toBeDefined();
        });

        it("contains persona fidelity rule", () => {
            const personaRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("PERSONA FIDELITY"));
            expect(personaRule).toBeDefined();
        });

        it("persona rule delegates to the <characters> block with no hardcoded names", () => {
            const personaRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("PERSONA FIDELITY"));
            expect(personaRule).toBeDefined();
            expect(personaRule).toContain("<characters>");

            // Renaming/editing characters in Settings must never contradict the
            // system prompt, so no participant names may be baked into rules.
            for (const name of ["Tom", "Angela", "Ben", "Ginger", "Hank", "Becca"]) {
                expect(personaRule).not.toContain(name);
            }
        });

        it("example phrases live only in the mandate, not in the rules", () => {
            expect(PROMPT_LANGUAGE_MANDATE).toContain("Arre");
            expect(PROMPT_LANGUAGE_MANDATE).toContain("Chal");
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("Example patterns"))).toBe(false);
        });

        it("contains the anti-cliché location diversity rule", () => {
            const rule = PROMPT_DIALOGUE_RULES.find(r => r.includes("ANTI-CLICHÉ"));
            expect(rule).toBeDefined();
            expect(rule).toContain("Hazratganj");
            expect(rule).toContain("Chowk");
            expect(rule).toContain("Lucknow");
        });

        it("does NOT contain any Devanagari characters across all rules", () => {
            for (const rule of PROMPT_DIALOGUE_RULES) {
                expect(DEVANAGARI_REGEX.test(rule)).toBe(false);
            }
        });

        it("still contains the original dialogue rules", () => {
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("5 dialogue"))).toBe(true);
            // Legacy keyed-memory instructions were removed with the old
            // per-character memory arch (memories now come from UnifiedMemory).
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("memory-set"))).toBe(false);
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("memory-remove"))).toBe(false);
        });

        it("carries NO <thought> instruction (thought system eliminated)", () => {
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("<thought>"))).toBe(false);
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("thought"))).toBe(false);
        });
    });
});

describe("Compiled Prompt Output — Hinglish Language Mandate", () => {
    /** @type {PromptBuilder} */
    let builder;

    beforeEach(() => {
        builder = new PromptBuilder();
    });

    it("compiled system prompt contains Hinglish directive when registerPrompt-like blocks are added", async () => {
        // Register the task and rules blocks (mirrors ConversationManager.registerPrompt)
        builder.useSystem(() => builder.part(
            `<task>${PROMPT_DIALOGUE_TASK}</task>`
        ));

        builder.useSystem(() => builder.part(
            "<language_mandate>\n" +
            "  <primary_language>Natural conversational Hinglish (Hindi in Roman/Latin script, casually mixed with English)</primary_language>\n" +
            "  <script_rule>STRICTLY NO Devanagari script. All Hindi must be transliterated to Latin script.</script_rule>\n" +
            "  <style>Lucknow/Indian casual banter. Real friends talking in a group chat.</style>\n" +
            "</language_mandate>"
        ));

        builder.useSystem(() => builder.part(
            "<dialogue_protocol>\n" +
            "  <rules>\n" +
            PROMPT_DIALOGUE_RULES.map(r => `    <rule>${r}</rule>`).join("\n") + "\n" +
            "  </rules>\n" +
            "</dialogue_protocol>"
        ));

        const payload = await builder.build({ includeSystem: true, includeUser: false });

        expect(payload.messages).toHaveLength(1);
        expect(payload.messages[0].role).toBe("system");

        const systemContent = payload.messages[0].content;

        // Hinglish directive is present
        expect(systemContent).toContain("Hinglish");
        expect(systemContent).toContain("language_mandate");

        // Devanagari prohibition is present
        expect(systemContent).toContain("STRICTLY NO Devanagari");

        // Script rule is present
        expect(systemContent).toContain("script_rule");

        // Persona fidelity is present
        expect(systemContent).toContain("PERSONA FIDELITY");

        // No Devanagari characters in the compiled output
        expect(DEVANAGARI_REGEX.test(systemContent)).toBe(false);
    });

    it("language_mandate block appears in system prompt before dialogue_protocol", async () => {
        builder.useSystem(() => builder.part(`<task>${PROMPT_DIALOGUE_TASK}</task>`));
        builder.useSystem(() => builder.part(
            "<language_mandate>\n" +
            "  <primary_language>Natural conversational Hinglish</primary_language>\n" +
            "</language_mandate>"
        ));
        builder.useSystem(() => builder.part(
            "<dialogue_protocol>\n  <rules>\n" +
            PROMPT_DIALOGUE_RULES.map(r => `    <rule>${r}</rule>`).join("\n") +
            "\n  </rules>\n</dialogue_protocol>"
        ));

        const payload = await builder.build({ includeSystem: true, includeUser: false });
        const systemContent = payload.messages[0].content;

        const mandateIdx = systemContent.indexOf("language_mandate");
        const protocolIdx = systemContent.indexOf("dialogue_protocol");

        expect(mandateIdx).toBeGreaterThan(-1);
        expect(protocolIdx).toBeGreaterThan(-1);
        expect(mandateIdx).toBeLessThan(protocolIdx);
    });
});
