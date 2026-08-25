
/** @typedef {import("../Message").default} Message */

/**
 * @typedef {{
 *     type: "typing:start"|"typing:end"|"reading:start"|"reading:end"|"message",
 *     time: number,
 *     message: Message
 * }} MessageEvent
 */

/** @typedef {Map<string, MessageEvent[]>} MessageTimeline */

export {}