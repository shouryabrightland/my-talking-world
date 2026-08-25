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
    PROMPT_DIALOGUE_RULES
} from "../../src/util/prompts.js";

// ─── Devanagari Unicode range: \u0900–\u097F ───
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

describe("Prompt Templates — Hinglish Language Mandate", () => {

    describe("PROMPT_DIALOGUE_TASK", () => {
        it("contains 'Hinglish' directive", () => {
            expect(PROMPT_DIALOGUE_TASK).toContain("Hinglish");
        });

        it("contains 'Roman/Latin script' instruction", () => {
            expect(PROMPT_DIALOGUE_TASK).toContain("Roman/Latin script");
        });

        it("contains Devanagari prohibition", () => {
            expect(PROMPT_DIALOGUE_TASK.toLowerCase()).toContain("no devanagari");
        });

        it("contains example Hinglish phrases", () => {
            expect(PROMPT_DIALOGUE_TASK).toContain("Arre");
            expect(PROMPT_DIALOGUE_TASK).toContain("kab tak");
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
        it("contains a Hinglish language rule", () => {
            const hinglishRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("Hinglish"));
            expect(hinglishRule).toBeDefined();
        });

        it("contains a Devanagari prohibition rule", () => {
            const devanagariRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("Devanagari"));
            expect(devanagariRule).toBeDefined();
        });

        it("contains Lucknow/Indian banter preference", () => {
            const banterRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("Lucknow") || r.includes("Indian"));
            expect(banterRule).toBeDefined();
        });

        it("contains persona fidelity rule", () => {
            const personaRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("PERSONA FIDELITY"));
            expect(personaRule).toBeDefined();
        });

        it("persona rule mentions all six characters", () => {
            const personaRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("PERSONA FIDELITY"));
            expect(personaRule).toContain("Tom");
            expect(personaRule).toContain("Angela");
            expect(personaRule).toContain("Ben");
            expect(personaRule).toContain("Ginger");
            expect(personaRule).toContain("Hank");
            expect(personaRule).toContain("Becca");
        });

        it("contains Hinglish example phrases in rules", () => {
            const hinglishRule = PROMPT_DIALOGUE_RULES.find(r => r.includes("Hinglish"));
            expect(hinglishRule).toContain("Arre");
            expect(hinglishRule).toContain("Chal");
        });

        it("does NOT contain any Devanagari characters across all rules", () => {
            for (const rule of PROMPT_DIALOGUE_RULES) {
                expect(DEVANAGARI_REGEX.test(rule)).toBe(false);
            }
        });

        it("still contains the original dialogue rules", () => {
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("5 dialogue"))).toBe(true);
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("memory-set"))).toBe(true);
            expect(PROMPT_DIALOGUE_RULES.some(r => r.includes("thought"))).toBe(true);
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
