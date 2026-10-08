// @ts-check

/**
 * @file Tests for the Calendar Bharat festival parsing in environment.js.
 *
 * Regression: the live API returns a NESTED payload
 *   { "2026": { "October 2026": { "October 8, 2026, Wednesday": { event, type, extras } } } }
 * but the parser used to expect a flat { october: { "2026-10-08": { name } } } map,
 * so no calendar event ever matched ("no calendar event ever added").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = globalThis.fetch;

/** Builds a payload keyed exactly like the live calendar-bharat API. */
function buildLivePayload(today) {
    const year = today.getFullYear();
    const monthLong = today.toLocaleString("en-US", { month: "long" });
    const weekday = today.toLocaleString("en-US", { weekday: "long" });
    const todayKey = `${monthLong} ${today.getDate()}, ${year}, ${weekday}`;

    return {
        [String(year)]: {
            [`${monthLong} ${year}`]: {
                [todayKey]: { event: "Test Festivity Today", type: "Religional Festival", extras: "today" },
                [`${monthLong} ${today.getDate() + 2}, ${year}, Friday`]: { event: "Near Future Fest", type: "Religional Festival", extras: "" },
                [`${monthLong} ${today.getDate() + 5}, ${year}, Monday`]: { event: "Later Fest", type: "Government Holiday", extras: "" }
            },
            // Previous month holds a PAST event that must not show up as "upcoming".
            ["January 2026"]: {
                "January 1, 2026, Thursday": { event: "Past Year Day", type: "Good to know", extras: "" }
            }
        }
    };
}

describe("Calendar Bharat festival parsing (live nested payload)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify(buildLivePayload(new Date())), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            })
        ));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        globalThis.fetch = originalFetch;
    });

    it("resolves today's celebration from the nested {year:{month:{day}}} shape", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.todayCelebration).toContain("Test Festivity Today");
        expect(snapshot.todayCelebration).toContain("🎉");
        expect(snapshot.todayCelebration).not.toContain("Regular day");
    });

    it("lists only future festivals, nearest first, without duplicates or past entries", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.upcomingFestivals).toContain("Near Future Fest");
        expect(snapshot.upcomingFestivals).toContain("Later Fest");
        expect(snapshot.upcomingFestivals).not.toContain("Past Year Day");
        expect(snapshot.upcomingFestivals).not.toContain("Test Festivity Today");
        expect(snapshot.upcomingFestivals.length).toBeLessThanOrEqual(4);

        const nearIdx = snapshot.upcomingFestivals.indexOf("Near Future Fest");
        const laterIdx = snapshot.upcomingFestivals.indexOf("Later Fest");
        expect(nearIdx).toBeGreaterThanOrEqual(0);
        expect(nearIdx).toBeLessThan(laterIdx);
    });

    it("falls back to a regular day when no entry matches today", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify({ "2026": { "January 2026": { "January 1, 2026, Thursday": { event: "New Year", type: "Good to know", extras: "" } } } }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            })
        ));

        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.todayCelebration).toContain("Regular day");
    });

    it("keeps the seasonal fallback when the API request fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.todayCelebration).toContain("Regular day");
        expect(snapshot.upcomingFestivals.length).toBeGreaterThan(0);
    });
});
