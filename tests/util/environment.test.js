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

        expect(snapshot.todayCelebration).toContain("Today is Test Festivity Today!");
        expect(snapshot.todayCelebration).toContain("🎉");
        expect(snapshot.todayCelebration).not.toContain("Regular day");
    });

    it("exposes the next dated events (Phase 4.2) for memory seeding", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(Array.isArray(snapshot.upcomingEvents)).toBe(true);
        expect(snapshot.upcomingEvents.length).toBe(2);
        expect(snapshot.upcomingEvents.map(e => e.name)).toEqual(["Near Future Fest", "Later Fest"]);
        expect(snapshot.upcomingEvents[0].ts).toBeLessThan(snapshot.upcomingEvents[1].ts);
        expect(snapshot.upcomingEvents[0].dateStr).toMatch(/\d{1,2} \w{3}/);
        // Today's event and past events are NOT in the countdown list.
        expect(snapshot.upcomingEvents.some(e => e.name === "Test Festivity Today")).toBe(false);
        expect(snapshot.upcomingEvents.some(e => e.name === "Past Year Day")).toBe(false);
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

    it("never returns 'Regular day' — falls back to the next-festival countdown", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify({ "2026": { "January 2026": { "January 1, 2026, Thursday": { event: "New Year", type: "Good to know", extras: "" } } } }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            })
        ));

        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.todayCelebration).not.toContain("Regular day");
        expect(snapshot.todayCelebration).toContain("⏳");
    });

    it("keeps a countdown-style fallback when the API request fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.todayCelebration).not.toContain("Regular day");
        expect(snapshot.todayCelebration).toContain("⏳");
        expect(snapshot.upcomingFestivals.length).toBeGreaterThan(0);
    });

    it("counts down to the nearest future festival when nothing matches today", async () => {
        const today = new Date();
        const year = today.getFullYear();
        const monthLong = today.toLocaleString("en-US", { month: "long" });
        const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        const inFive = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
        const keyFor = (/** @type {Date} */ d) =>
            `${d.toLocaleString("en-US", { month: "long" })} ${d.getDate()}, ${d.getFullYear()}, ${d.toLocaleString("en-US", { weekday: "long" })}`;

        // No event today → countdown to tomorrow's festival.
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify({
                [String(year)]: {
                    [`${monthLong} ${year}`]: {
                        [keyFor(tomorrow)]: { event: "Test Countdown Fest", type: "Festival", extras: "" },
                        [keyFor(inFive)]: { event: "Later Countdown Fest", type: "Festival", extras: "" }
                    }
                }
            }), { status: 200, headers: { "Content-Type": "application/json" } })
        ));

        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);
        expect(snapshot.todayCelebration).toBe("⏳ Tomorrow is Test Countdown Fest!");
    });

    it("counts remaining days for festivals further out", async () => {
        const today = new Date();
        const year = today.getFullYear();
        const monthLong = today.toLocaleString("en-US", { month: "long" });
        const inFive = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
        const keyFor = (/** @type {Date} */ d) =>
            `${d.toLocaleString("en-US", { month: "long" })} ${d.getDate()}, ${d.getFullYear()}, ${d.toLocaleString("en-US", { weekday: "long" })}`;

        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response(JSON.stringify({
                [String(year)]: {
                    [`${monthLong} ${year}`]: {
                        [keyFor(inFive)]: { event: "Five Days Fest", type: "Festival", extras: "" }
                    }
                }
            }), { status: 200, headers: { "Content-Type": "application/json" } })
        ));

        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);
        expect(snapshot.todayCelebration).toBe("⏳ 5 days left until Five Days Fest");
        expect(snapshot.todayCelebration).not.toContain("Regular day");
    });
});

// ─── Phase 7.1: top-50 headline batch ───────────────────────────

describe("Google News headline batch (Phase 7.1)", () => {
    beforeEach(() => {
        const items = Array.from({ length: 60 }, (_, i) => ({
            title: `Story ${i} - Source Publication`
        }));

        vi.stubGlobal("fetch", vi.fn(async (/** @type {string} */ url) => {
            const target = String(url);
            if (target.includes("open-meteo")) {
                return new Response(JSON.stringify({
                    current: { temperature_2m: 31, relative_humidity_2m: 48, weather_code: 1 }
                }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (target.includes("rss2json")) {
                return new Response(JSON.stringify({ items }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            // Calendar endpoint: empty payload → seasonal fallbacks.
            return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        globalThis.fetch = originalFetch;
    });

    it("collects up to 50 top headlines with the publisher suffix stripped", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        const snapshot = await getEnvironmentSnapshot(true);

        expect(snapshot.newsHeadlines).toHaveLength(50);
        expect(snapshot.newsHeadlines[0]).toBe("Story 0");
        expect(snapshot.newsHeadlines[49]).toBe("Story 49");
    });

    it("passes the count=50 request to the RSS gateway", async () => {
        const { getEnvironmentSnapshot } = await import("../../src/util/environment.js");
        await getEnvironmentSnapshot(true);

        const gatewayCall = vi.mocked(globalThis.fetch).mock.calls
            .map((/** @type {any[]} */ call) => String(call[0]))
            .find(url => url.includes("rss2json"));

        expect(gatewayCall).toBeTruthy();
        expect(gatewayCall).toContain("count=50");
    });
});
