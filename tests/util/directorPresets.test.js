// @ts-check

/**
 * @file directorPresets.test.js
 * Phase 1.2 / 1.3 — child-safe Director preset library:
 *  - the listed danger / creepy / mature cues are gone (G-rated replacements),
 *  - no banned hazard, horror or toxic wording survives in any plot,
 *  - labels stay unique across the 200-cue library,
 *  - sampleDirectorPresets() returns distinct cues.
 */

import { describe, it, expect } from "vitest";
import { DIRECTOR_PRESETS, sampleDirectorPresets } from "../../src/util/directorPresets.js";

/** Every preset label the spec explicitly requires to be replaced. */
const REMOVED_PRESETS = [
    "🔌 Outlet Spark",
    "🪂 Balcony Rescue",
    "🔥 Gas Smell",
    "🔥 Kitchen Flare-Up",
    "🛵 Lane Sprint",
    "🌆 Skyline Sneak",
    "👤 Watched Figure",
    "📞 Breathing Caller",
    "🔔 3AM Doorbell",
    "🚪 Midnight Knocking",
    "🧳 Stranger's Suitcase",
    "🧨 Prank Timer",
    "📱 Pickpocketed Phone",
    "💔 Overheard Breakup",
    "🎯 Wrong-Target Egg",
    "🥶 Group Silent Treatment",
    "💌 Misdirected Love Letter",
];

/** Hazard / horror / mature phrasing that must not appear in any plot. */
const BANNED_PLOTS = [
    "electrical outlet sparks",
    "gas smell",
    "flare-up on the stove",
    "scooter race",
    "forbidden skyline view",
    "masked figure",
    "breathes, and hangs up",
    "rings at 3 AM",
    "knocking sounds at the door at midnight",
    "suitcase is left at the door",
    "prank countdown timer",
    "pickpocketed",
    "breakup conversation",
    "egg meant for a prank",
    "silent treatment",
    "love letter meant for someone else",
];

describe("DIRECTOR_PRESETS — child-safe purge (Phase 1.2)", () => {
    it("keeps the full 200-cue library", () => {
        expect(DIRECTOR_PRESETS).toHaveLength(200);
    });

    it("removes every label the spec marked unsafe", () => {
        for (const label of REMOVED_PRESETS) {
            expect(
                DIRECTOR_PRESETS.some(p => p.label === label),
                `unsafe preset still present: ${label}`
            ).toBe(false);
        }
    });

    it("keeps the G-rated replacement cues", () => {
        const labels = DIRECTOR_PRESETS.map(p => p.label);
        for (const replacement of [
            "🎈 Balloon Static",
            "🪁 Stuck Kite",
            "🥞 Pancake Flip Fail",
            "🏃 Hallway Sack Race",
            "🔭 Stargazing Spot",
            "🔍 Cookie Crumb Trail",
            "📦 Surprise Gift Box",
            "📻 Funky Frequency",
            "🧦 Missing Sock Mystery",
            "🎨 Painting Mix-Up",
            "🏆 Paper Plane Derby",
            "🎭 Silly Charades",
        ]) {
            expect(labels, `replacement missing: ${replacement}`).toContain(replacement);
        }
    });

    it("contains no banned hazard, horror or mature phrasing", () => {
        for (const preset of DIRECTOR_PRESETS) {
            const haystack = `${preset.label} ${preset.plot}`.toLowerCase();
            for (const banned of BANNED_PLOTS) {
                expect(
                    haystack.includes(banned),
                    `banned phrasing "${banned}" found in "${preset.label}"`
                ).toBe(false);
            }
        }
    });

    it("every cue carries a non-empty label, plot and known category", () => {
        const categories = new Set(DIRECTOR_PRESETS.map(p => p.category));
        expect([...categories].sort()).toEqual([
            "Adventure & Drama",
            "City Life & Outings",
            "Everyday Chaos",
            "Mystery & Secrets",
            "Social & Comedy",
        ]);

        for (const preset of DIRECTOR_PRESETS) {
            expect(preset.label.trim().length).toBeGreaterThan(0);
            expect(preset.plot.trim().length).toBeGreaterThan(10);
        }
    });

    it("labels are unique across the library", () => {
        const labels = DIRECTOR_PRESETS.map(p => p.label);
        const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
        expect(dupes).toEqual([]);
    });
});

describe("sampleDirectorPresets (Phase 1.2)", () => {
    it("returns distinct cues without repeats", () => {
        const sample = sampleDirectorPresets(10);
        expect(sample).toHaveLength(10);

        const labels = sample.map(p => p.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("clamps oversized requests to the library size", () => {
        expect(sampleDirectorPresets(500)).toHaveLength(DIRECTOR_PRESETS.length);
    });
});
