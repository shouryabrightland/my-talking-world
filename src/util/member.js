// @ts-check

/**
 * @file member.js
 * Character member definitions for the simulation.
 *
 * Responsibilities:
 * - Defines all AI characters (Tom, Angela, Ben, Ginger, Hank, Becca).
 * - Provides personality bios, birthdays, and typing speed configurations.
 * - Exports the Members array for registration into the World.
 */

import ChatMember from "../classes/ChatMember";
import Logger from "../classes/lib/Logger";

/** @typedef {import("../classes/Reaction").Sprite} Sprite */

const logger = new Logger("ChatMember");

/**
 * Factory helper constructing character instances with explicit birthdays,
 * rich biographical instructions, and emotion sprite coordinates.
 *
 * @param {string} id Unique lowercase participant ID.
 * @param {string} name Display name of the character.
 * @param {string} about Biographical personality profile.
 * @param {string} birthday ISO date string (YYYY-MM-DD).
 * @param {string} image Relative URL locating the sprite sheet asset.
 * @param {Record<string, Sprite>} sprites Emotion coordinate maps [X%, Y%, Scale%].
 * @param {number} [typingSpeedMs=28] Character typing pacing speed in ms/letter.
 * @returns {ChatMember}
 */
function createMember(id, name, about, birthday, image, sprites, typingSpeedMs = 28) {
    const member = new ChatMember({
        id,
        name,
        about,
        birthday,
        isAI: true,
        logger,
        typingSpeedMs
    });

    member.reaction.url = image;

    Object.assign(
        member.reaction.sprites,
        sprites
    );

    return member;
}

// ---------------------------------------------------------------------
// Canonical AI Cast Profiles (De-biased, Authentic, and Multi-Dimensional)
// ---------------------------------------------------------------------

export const Tom = createMember(
    "tom",
    "Tom",
    "Overconfident, charismatic, ambitious leader of the group. " +
    "Constantly pitches creative concepts and bold plans, attempts to appear impressive, " +
    "and navigates comical complications with high energy.",
    "2006-08-18", // Age 20 in 2026
    "/char/tom.png",
    {
        Default: [0, 1, 300],
        Happy: [50, 1, 300],
        Laughing: [100, 2, 300],
        Thinking: [0, 43, 300],
        Surprised: [50, 44, 300],
        Sad: [100, 44, 300],
        Angry: [1, 86, 300],
        Sleeping: [50, 84, 319],
        Excited: [99, 85, 300]
    },
    26
);

export const Angela = createMember(
    "angela",
    "Angela",
    "Stylish, artistic, aspiring singer with a sharp eye for fashion and music. " +
    "Enjoys lively conversational banter and witty commentary while keeping group situations grounded.",
    "2007-06-22", // Age 19 in 2026
    "/char/angela.png",
    {
        Default: [4, 1, 340],
        Happy: [49, 1, 340],
        Laughing: [97, 2, 340],
        Thinking: [2, 41, 340],
        Surprised: [51, 41, 340],
        Sad: [97, 41, 340],
        Angry: [5, 81, 340],
        Sleeping: [50, 81, 340],
        Excited: [98, 82, 320]
    },
    28
);

export const Ben = createMember(
    "ben",
    "Ben",
    "Analytical technical inventor with courteous, polite manners. " +
    "Builds complex electronic devices and gadgets, highly protective of his workspace, tools, experimental circuits, and robotics hardware.",
    "2004-04-10", // Age 22 in 2026
    "/char/ben.png",
    {
        Default: [0, 0, 300],
        Happy: [50, 0, 300],
        Laughing: [100, 0, 300],
        Thinking: [0, 44, 300],
        Surprised: [50, 44, 300],
        Sad: [100, 44, 300],
        Angry: [1, 88, 300],
        Sleeping: [50, 88, 319],
        Excited: [100, 88, 300]
    },
    32
);

export const Ginger = createMember(
    "ginger",
    "Ginger",
    "Energetic 7-year-old kitten with an outspoken, unfiltered curiosity. " +
    "Enjoys lighthearted games, harmless pranks, and asking direct, blunt questions.",
    "2019-03-12", // Age 7 in 2026
    "/char/ginger.png",
    {
        Default: [0, 0, 300],
        Happy: [50, 0, 300],
        Laughing: [100, 0, 300],
        Thinking: [0, 44, 300],
        Surprised: [50, 44, 300],
        Sad: [100, 44, 300],
        Angry: [1, 90, 300],
        Sleeping: [50, 88, 300],
        Excited: [100, 90, 300]
    },
    22
);

export const Hank = createMember(
    "hank",
    "Hank",
    "Easygoing, relaxed character who appreciates good food, retro cinema, trivia, video games, and relaxing comedy. " +
    "Moves at a calm pace and occasionally offers thoughtful, philosophical observations.",
    "2002-09-25", // Age 23-24 in 2026
    "/char/hank.png",
    {
        Default: [1, 2, 300],
        Happy: [52, 2, 300],
        Laughing: [101, 2, 300],
        Thinking: [1, 45, 300],
        Surprised: [50, 45, 300],
        Sad: [100, 47, 300],
        Angry: [1, 90, 300],
        Sleeping: [50, 90, 300],
        Excited: [100, 90, 300]
    },
    38
);

export const Becca = createMember(
    "becca",
    "Becca",
    "Competitive, athletic rabbit who values action, outdoor challenges, sports, " +
    "and straightforward communication without patience for excuses.",
    "2007-11-05", // Age 18-19 in 2026
    "/char/becca.png",
    {
        Default: [0, 1, 300],
        Happy: [50, 1, 300],
        Laughing: [100, 0, 300],
        Thinking: [0, 44, 300],
        Surprised: [50, 45, 300],
        Sad: [100, 47, 300],
        Angry: [1, 90, 300],
        Sleeping: [52, 93, 300],
        Excited: [100, 89, 300]
    },
    26
);

/**
 * Array containing all default AI character instances.
 * @type {readonly ChatMember[]}
 */
export const Members = Object.freeze([
    Tom,
    Angela,
    Ben,
    Ginger,
    Hank,
    Becca
]);

/**
 * Dictionary mapping character IDs to profile descriptions.
 * @type {Record<string, string>}
 */
export const MemberInfo = Object.freeze(
    Object.fromEntries(
        Members.map(member => [
            member.id,
            member.about
        ])
    )
);