// @ts-check

/**
 * @file directorPresets.js
 * Director Mode shortcut cue library.
 *
 * Responsibilities:
 * - Exports `DIRECTOR_PRESETS`: 25 elite, high-impact, funny, child-safe sitcom cues
 *   across 5 categories (5 cues each).
 * - Exports `sampleDirectorPresets(count)`: Fisher-Yates sampling of unique
 *   cues used by the footer rail (up to 10 cues per mount, no repeats).
 *
 * @typedef {Object} DirectorPreset
 * @property {string} label Short chip label (unique across the library).
 * @property {string} plot Full director directive text.
 * @property {string} category Category name.
 */

// ---------------------------------------------------------------------------
// Category 1: Everyday Chaos (5 elite cues)
// ---------------------------------------------------------------------------
const EVERYDAY_CHAOS = [
    ["⚡ Power Cut", "A sudden power cut hits the neighborhood, plunging the room into darkness!"],
    ["💧 Burst Pipe", "A water pipe bursts under the sink and starts flooding the kitchen floor!"],
    ["🦜 Parrot Invasion", "A colorful pet parrot flies in through the open window and refuses to leave!"],
    ["🎈 Balloon Static", "Rubbing a balloon creates funny static electricity that makes everyone's hair stand straight up!"],
    ["🥞 Pancake Flip Fail", "A pancake launch goes sky-high and lands upside down on the table!"]
];

// ---------------------------------------------------------------------------
// Category 2: Social & Comedy (5 elite cues)
// ---------------------------------------------------------------------------
const SOCIAL_COMEDY = [
    ["👫 Old Friend Visit", "A childhood friend nobody has seen in years shows up completely unannounced!"],
    ["🍕 Wrong Food Order", "The food order arrives completely wrong, and it's all wildly spicy!"],
    ["📦 Surprise Gift Box", "A surprise gift box arrives with a funny riddle attached to the ribbon!"],
    ["🎨 Painting Mix-Up", "Two art canvases get mixed up right before the community exhibition!"],
    ["🎭 Silly Charades", "An impromptu game of charades turns into hilarious guessing chaos!"]
];

// ---------------------------------------------------------------------------
// Category 3: Adventure & Drama (5 elite cues)
// ---------------------------------------------------------------------------
const ADVENTURE_DRAMA = [
    ["🏃 Hallway Sack Race", "A rainy afternoon turns into a high-stakes living room potato sack race!"],
    ["🔭 Stargazing Spot", "The friends find a perfect terrace stargazing spot and spot a bizarre glowing satellite!"],
    ["🏆 Paper Plane Derby", "A championship paper airplane derby breaks out with hilarious aerodynamics!"],
    ["🗺️ Lost Treasure Map", "An old map of Lucknow with a secret marked spot falls out of a library book!"],
    ["🏕️ Backyard Campout", "The group decides to pitch a tent and camp out under the stars tonight!"]
];

// ---------------------------------------------------------------------------
// Category 4: City Life & Outings (5 elite cues)
// ---------------------------------------------------------------------------
const CITY_LIFE = [
    ["🪁 Stuck Kite", "A colorful runaway kite gets tangled in the terrace railing during a breezy afternoon!"],
    ["🍦 Melting Kulfi Race", "The famous Lucknow kulfi starts melting fast in the heat before anyone can finish!"],
    ["🛺 Auto Rickshaw Detour", "The auto driver takes a wildly scenic shortcut through narrow old-city alleys!"],
    ["🎪 Street Circus", "A troupe of street jugglers and acrobats gathers a huge cheering crowd outside!"],
    ["🥟 Chaat Tasting Contest", "The friends hold an impromptu Lucknow chaat showdown to pick the best street snack!"]
];

// ---------------------------------------------------------------------------
// Category 5: Mystery & Secrets (5 elite cues)
// ---------------------------------------------------------------------------
const MYSTERY_SECRETS = [
    ["🔍 Cookie Crumb Trail", "A trail of cookie crumbs leads straight to an unexpected hiding spot in the closet!"],
    ["📻 Funky Frequency", "An old radio tunes into a quirky mystery broadcast transmitting silly sound effects!"],
    ["🧦 Missing Sock Mystery", "Every single left sock has mysteriously vanished and the group investigates!"],
    ["🗝️ Mysterious Key", "An antique brass key is found under the sofa, but nobody knows what it unlocks!"],
    ["📚 Secret Door", "A tiny hidden compartment is discovered behind the bookshelf!"]
];

/**
 * Canonical category names across the 25-cue library.
 * @readonly
 */
export const DIRECTOR_PRESET_CATEGORIES = Object.freeze([
    "Everyday Chaos",
    "Social & Comedy",
    "Adventure & Drama",
    "City Life & Outings",
    "Mystery & Secrets"
]);

/**
 * Complete Director Mode shortcut library — 25 elite sitcom-style plot
 * twists and stage directives (5 per category).
 * @readonly
 * @type {readonly DirectorPreset[]}
 */
export const DIRECTOR_PRESETS = Object.freeze([
    ...EVERYDAY_CHAOS.map(([label, plot]) => ({ label, plot, category: "Everyday Chaos" })),
    ...SOCIAL_COMEDY.map(([label, plot]) => ({ label, plot, category: "Social & Comedy" })),
    ...ADVENTURE_DRAMA.map(([label, plot]) => ({ label, plot, category: "Adventure & Drama" })),
    ...CITY_LIFE.map(([label, plot]) => ({ label, plot, category: "City Life & Outings" })),
    ...MYSTERY_SECRETS.map(([label, plot]) => ({ label, plot, category: "Mystery & Secrets" }))
]);

/**
 * Fisher-Yates sampling of unique presets (no repeats within a sample).
 * Used by the footer rail to show up to 10 random cues per mount.
 *
 * @param {number} [count=10] Number of cues to sample.
 * @returns {DirectorPreset[]} Shuffled sample of `count` distinct presets.
 */
export function sampleDirectorPresets(count = 10) {
    const pool = [...DIRECTOR_PRESETS];

    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = pool[i];
        pool[i] = pool[j];
        pool[j] = swap;
    }

    const size = Math.max(1, Math.min(count, pool.length));
    return pool.slice(0, size);
}
