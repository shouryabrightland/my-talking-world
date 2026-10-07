// @ts-check

/**
 * @file UnifiedMemory.test.js
 * Covers the Tier-3 episodic stack: tagging, TTL pruning, deterministic
 * relevance scoring, persistence round-trips and Gemma compression.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import UnifiedMemory from "../../src/classes/lib/UnifiedMemory.js";
import Logger from "../../src/classes/lib/Logger.js";

/** @type {import("../../src/classes/lib/UnifiedMemory.js").default} */
let memory;

/** Fully-specified stack entry helper. */
function entry(id, data, tags = ["tom"], expiry = "forever", datetime = "2026-10-07 10:00") {
    return { id, datetime, tags, data, expiry };
}

beforeEach(async () => {
    memory = new UnifiedMemory(new Logger("Test"));
    memory.storageKey = `test_unified_memory_${crypto.randomUUID()}`;
    await memory.init();
    memory.entries = [];
});

describe("UnifiedMemory — stack operations", () => {
    it("adds entries with normalized tags and a default forever expiry", async () => {
        const added = await memory.add({ tags: [" Tom ", "CHAI", "tom"], data: "Tom likes chai" });

        expect(added.tags).toEqual(["tom", "chai"]);
        expect(added.expiry).toBe("forever");
        expect(added.datetime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(memory.entries).toHaveLength(1);
    });

    it("ignores empty payloads", async () => {
        await memory.add({ tags: ["tom"], data: "   " });
        expect(memory.entries).toHaveLength(0);
    });

    it("removes entries by id", async () => {
        const a = await memory.add({ tags: ["tom"], data: "first" });
        await memory.add({ tags: ["ben"], data: "second" });

        await memory.remove(a.id);

        expect(memory.entries.map(e => e.data)).toEqual(["second"]);
    });

    it("round-trips through storage on init()", async () => {
        await memory.add({ tags: ["angela", "drone"], data: "Angela rebuilt the rotor", expiry: "24h" });

        const reloaded = new UnifiedMemory(new Logger("Test"));
        reloaded.storageKey = memory.storageKey;
        await reloaded.init();

        expect(reloaded.entries).toHaveLength(1);
        expect(reloaded.entries[0].data).toBe("Angela rebuilt the rotor");
        expect(reloaded.entries[0].tags).toEqual(["angela", "drone"]);
    });
});

describe("UnifiedMemory — TTL pruning", () => {
    it("drops expired entries while permanent and future entries survive", async () => {
        memory.entries.push(
            entry("1", "stale gossip", ["tom"], new Date(Date.now() - 1_000).toISOString()),
            entry("2", "forever fact", ["ben"], "forever"),
            entry("3", "fresh secret", ["angela"], "15m"),
            entry("4", "relative future", ["ginger"], "1h")
        );

        const pruned = await memory.clearExpired(new Date());

        expect(pruned).toBe(1);
        expect(memory.entries.map(e => e.data)).toEqual(["forever fact", "fresh secret", "relative future"]);
    });

    it("keeps malformed expiries instead of silently promoting them to permanent", async () => {
        memory.entries.push(entry("1", "weird expiry", ["tom"], "not-a-real-format"));

        const pruned = await memory.clearExpired(new Date());

        // MemoryExpiryParser degrades garbage to a safe +24h TTL → still alive.
        expect(pruned).toBe(0);
        expect(memory.entries).toHaveLength(1);
    });
});

describe("UnifiedMemory — deterministic relevance search", () => {
    beforeEach(() => {
        memory.entries = [
            entry("a", "Tom repaired the drone", ["tom"], "forever", "2026-10-07 09:00"),
            entry("b", "Angela's drone broke again", ["angela", "drone"], "forever", "2026-10-07 10:00"),
            entry("c", "Ben soldered the circuit", ["ben"], "forever", "2026-10-07 11:00")
        ];
    });

    it("ranks tag matches above keyword matches and caps at 2 lines", () => {
        const lines = memory.searchDeterministic(["drone"], ["tom"]);

        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("Tom repaired the drone");
        expect(lines[1]).toContain("Angela's drone broke again");
        expect(lines.join()).not.toContain("soldered");
    });

    it("returns an empty list when there is nothing to search", () => {
        expect(memory.searchDeterministic([], [])).toEqual([]);
        expect(memory.searchDeterministic([], ["any"])).toEqual([]);
    });

    it("supports member-only lookups when Needle omits keywords", () => {
        const lines = memory.searchDeterministic([], ["tom"]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("Tom repaired the drone");
    });

    it("ignores keyword misses", () => {
        expect(memory.searchDeterministic(["football"], ["any"])).toEqual([]);
    });

    it("renders a prompt-ready text stack", () => {
        const text = memory.toTextStack();

        expect(text.split("\n")).toHaveLength(3);
        expect(text).toContain("[2026-10-07 09:00 | tags: tom] Tom repaired the drone");
        expect(memory.getCharacterCount()).toBe(text.length);
    });
});

describe("UnifiedMemory — Gemma compression", () => {
    it("only compresses once the 20,000-character budget is reached", async () => {
        const gemmaClient = {
            streamGenerate: vi.fn().mockResolvedValue({
                text: [
                    "```xml",
                    "<memories>",
                    '<memory tags="tom, drone" expiry="forever">Consolidated drone memory</memory>',
                    "</memories>",
                    "```"
                ].join("\n")
            })
        };

        await expect(memory.compressIfExceeded(gemmaClient)).resolves.toBe(false);
        expect(gemmaClient.streamGenerate).not.toHaveBeenCalled();

        memory.entries.push(entry("big", "x".repeat(20_000), ["tom"], "forever"));

        await expect(memory.compressIfExceeded(gemmaClient)).resolves.toBe(true);
        expect(gemmaClient.streamGenerate).toHaveBeenCalledTimes(1);
        expect(memory.entries).toHaveLength(1);
        expect(memory.entries[0].data).toBe("Consolidated drone memory");
        expect(memory.entries[0].tags).toEqual(["tom", "drone"]);
        expect(memory.getCharacterCount()).toBeLessThan(20_000);
        expect(memory.isCompressing).toBe(false);
    });

    it("leaves the stack untouched when Gemma fails", async () => {
        const original = entry("keep", "keep me", ["tom"], "forever");
        memory.entries.push({ ...original, data: "y".repeat(20_000) });

        const gemmaClient = { streamGenerate: vi.fn().mockRejectedValue(new Error("quota")) };

        await expect(memory.compressIfExceeded(gemmaClient)).resolves.toBe(false);
        expect(memory.entries).toHaveLength(1);
        expect(memory.entries[0].id).toBe(original.id);
        expect(memory.isCompressing).toBe(false);
    });
});
