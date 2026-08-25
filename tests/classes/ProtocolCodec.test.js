// @ts-check

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Logger before importing ProtocolCodec
vi.mock("../../src/classes/lib/Logger.js", () => {
    return {
        default: class MockLogger {
            constructor(name = "Mock") { this.name = name; }
            child(name) { return new MockLogger(`${this.name}:${name}`); }
            info() {}
            warn() {}
            error() {}
            debug() {}
        }
    };
});

import ProtocolCodec from "../../src/classes/ProtocolCodec.js";

describe("ProtocolCodec — Buffer Lifecycle", () => {
    /** @type {ProtocolCodec} */
    let codec;

    beforeEach(() => {
        codec = new ProtocolCodec({
            logger: { child: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }
        });
    });

    // ─────────────────────────────────────────────
    // stripIncompleteTrailingRecords (static)
    // ─────────────────────────────────────────────
    describe("stripIncompleteTrailingRecords", () => {
        it("returns empty string for falsy input", () => {
            expect(ProtocolCodec.stripIncompleteTrailingRecords("")).toBe("");
            expect(ProtocolCodec.stripIncompleteTrailingRecords(null)).toBe("");
            expect(ProtocolCodec.stripIncompleteTrailingRecords(undefined)).toBe("");
        });

        it("returns buffer unchanged when no <record> tags exist", () => {
            const buf = "Hello world, some plain text";
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe(buf);
        });

        it("returns buffer unchanged when all <record> tags are properly closed", () => {
            const buf = '<record type="message" id="1" sender="tom"><text>Hi</text></record>';
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe(buf);
        });

        it("strips a trailing incomplete <record> tag with no closing", () => {
            const buf = '<record type="message" id="1" sender="tom"><text>Hello</text></record>  <record type="message" id="2" sender="lily">';
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe(
                '<record type="message" id="1" sender="tom"><text>Hello</text></record>'
            );
        });

        it("strips only the incomplete trailing tag when preceded by a complete one", () => {
            const buf = '<record type="message" id="1" sender="tom"><text>Done</text></record><record type="message" id="2" sender="lily"><text>Partial';
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe(
                '<record type="message" id="1" sender="tom"><text>Done</text></record>'
            );
        });

        it("returns full buffer when last </record> closes after last <record>", () => {
            const buf = '<record type="message" id="1" sender="tom"><text>Complete</text></record>';
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe(buf);
        });

        it("handles buffer with only an opening <record> tag", () => {
            const buf = "<record type=\"message\"";
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe("");
        });

        it("preserves text before the incomplete record tag", () => {
            const buf = "Some preamble text <record type=\"message\" id=\"1\" sender=\"tom\"><text>Hi";
            expect(ProtocolCodec.stripIncompleteTrailingRecords(buf)).toBe("Some preamble text");
        });
    });

    // ─────────────────────────────────────────────
    // parseRecords — complete records
    // ─────────────────────────────────────────────
    describe("parseRecords — complete records", () => {
        it("parses a single complete message record", () => {
            const text = '<record type="message" id="1" sender="tom" reaction="Laughing"><text>Hello world</text></record>';
            const records = codec.parseRecords(text);
            expect(records).toHaveLength(1);
            expect(records[0].recordType).toBe("message");
            expect(records[0].sender).toBe("tom");
            expect(records[0].text).toBe("Hello world");
        });

        it("parses multiple consecutive records", () => {
            const text =
                '<record type="message" id="1" sender="tom"><text>First</text></record>' +
                '<record type="message" id="2" sender="lily"><text>Second</text></record>' +
                '<record type="memory-set" member="tom" expiry="30m"><key>Mood</key><value>Happy</value></record>';
            const records = codec.parseRecords(text);
            expect(records).toHaveLength(3);
            expect(records[0].recordType).toBe("message");
            expect(records[1].recordType).toBe("message");
            expect(records[2].recordType).toBe("memory-set");
        });

        it("returns empty array for empty/whitespace input", () => {
            expect(codec.parseRecords("")).toEqual([]);
            expect(codec.parseRecords("   ")).toEqual([]);
            expect(codec.parseRecords(null)).toEqual([]);
        });
    });

    // ─────────────────────────────────────────────
    // parseRecords — incomplete/aborted records
    // ─────────────────────────────────────────────
    describe("parseRecords — incomplete records from aborted streams", () => {
        it("ignores an incomplete trailing <record> tag (no closing tag)", () => {
            const text = '<record type="message" id="1" sender="tom"><text>Hello</text></record><record type="message" id="2" sender="lily"><text>Partial';
            const records = codec.parseRecords(text);
            expect(records).toHaveLength(1);
            expect(records[0].sender).toBe("tom");
            expect(records[0].text).toBe("Hello");
        });

        it("ignores a standalone incomplete record with no prior complete records", () => {
            const text = '<record type="message" id="1" sender="tom"><text>Start';
            const records = codec.parseRecords(text);
            expect(records).toHaveLength(0);
        });

        it("handles mixed think tags and incomplete records", () => {
            const text = '<record type="message" id="1" sender="tom"><text>Complete</text></record><record type="message" id="2" sender="lily"><text>';
            const records = codec.parseRecords(text);
            expect(records).toHaveLength(1);
            expect(records[0].text).toBe("Complete");
        });
    });

    // ─────────────────────────────────────────────
    // extractThinkingChain — reasoning block handling
    // ─────────────────────────────────────────────
    describe("extractThinkingChain", () => {
        it("extracts think tags from text", () => {
            const text = '<think>I should greet them.</think>Hello!';
            const result = ProtocolCodec.extractThinkingChain(text);
            expect(result.thinking).toBe("I should greet them.");
            expect(result.cleanText).toBe("Hello!");
        });

        it("returns null thinking when no think tags present", () => {
            const result = ProtocolCodec.extractThinkingChain("Hello world");
            expect(result.thinking).toBeNull();
            expect(result.cleanText).toBe("Hello world");
        });

        it("handles multiple think blocks", () => {
            const text = '<think>First thought</think><think>Second thought</think>Response';
            const result = ProtocolCodec.extractThinkingChain(text);
            expect(result.thinking).toContain("First thought");
            expect(result.thinking).toContain("Second thought");
            expect(result.cleanText).toBe("Response");
        });
    });

    // ─────────────────────────────────────────────
    // Scenario: fragmented back-to-back streams
    // ─────────────────────────────────────────────
    describe("Fragmented stream simulation", () => {
        it("processes tokens incrementally and only emits complete records", () => {
            const tokenChunks = [
                '<record type="message" id="1" sender="tom"><text>Hel',
                'lo world</text></record><record type="message" id="2" sender="lily"',
                '><text>Hi there</text></record>'
            ];

            let buffer = "";
            /** @type {import("../../src/classes/types/Protocol.types.js").ProtocolRecord[]} */ const allRecords = [];
            const recordTagRegex = /<\s*record\b([^>]*)>([\s\S]*?)<\/\s*record\s*>/gi;

            for (const token of tokenChunks) {
                buffer += token;

                let lastIndex = 0;
                let match;
                const completedBlocks = [];

                while ((match = recordTagRegex.exec(buffer)) !== null) {
                    completedBlocks.push(match[0]);
                    lastIndex = match.index + match[0].length;
                }

                if (lastIndex > 0) {
                    buffer = buffer.slice(lastIndex);
                    for (const block of completedBlocks) {
                        allRecords.push(...codec.parseRecords(block));
                    }
                }
            }

            expect(allRecords).toHaveLength(2);
            expect(allRecords[0].sender).toBe("tom");
            expect(allRecords[0].text).toBe("Hello world");
            expect(allRecords[1].sender).toBe("lily");
            expect(allRecords[1].text).toBe("Hi there");
        });

        it("does not duplicate records across consecutive token batches", () => {
            // Batch 1: complete record
            const batch1 = '<record type="message" id="1" sender="tom"><text>First</text></record>';
            // Batch 2: second complete record (no overlap with batch 1)
            const batch2 = '<record type="message" id="2" sender="lily"><text>Second</text></record>';

            let buffer = "";
            /** @type {import("../../src/classes/types/Protocol.types.js").ProtocolRecord[]} */ const allRecords = [];
            const recordTagRegex = /<\s*record\b([^>]*)>([\s\S]*?)<\/\s*record\s*>/gi;

            for (const batch of [batch1, batch2]) {
                buffer += batch;

                let lastIndex = 0;
                let match;
                const completedBlocks = [];

                while ((match = recordTagRegex.exec(buffer)) !== null) {
                    completedBlocks.push(match[0]);
                    lastIndex = match.index + match[0].length;
                }

                if (lastIndex > 0) {
                    buffer = buffer.slice(lastIndex);
                    for (const block of completedBlocks) {
                        allRecords.push(...codec.parseRecords(block));
                    }
                }
            }

            // Should have exactly 2 records, not 3 or 4
            expect(allRecords).toHaveLength(2);
            expect(allRecords[0].id).toBe(1);
            expect(allRecords[1].id).toBe(2);
        });
    });
});
