// @ts-check

/** @typedef {import("./types/Reaction.types").EmotionInfo} EmotionInfo */
/** @typedef {import("./types/Reaction.types").Sprite} Sprite */

/**
 * Static metadata registry mapping emotional identifiers to physical coordinates on 
 * individual character sprite sheets. Features case-insensitive lookups and strict default falls.
 */
export default class Reaction {

    /**
     * Array offset index of the default emotion state.
     * @readonly
     */
    static DEFAULT_INDEX = 0;

    /**
     * Supported emotions and active emoji codes.
     * @readonly
     * @type {EmotionInfo[]}
     */
    static EMOTION = [
        { name: "Default", emoji: "🙂" },
        { name: "Happy", emoji: "😊" },
        { name: "Laughing", emoji: "😂" },
        { name: "Thinking", emoji: "🤔" },
        { name: "Surprised", emoji: "😲" },
        { name: "Sad", emoji: "😢" },
        { name: "Angry", emoji: "😠" },
        { name: "Sleeping", emoji: "😴" },
        { name: "Excited", emoji: "🤩" }
    ];

    /**
     * Constant dictionary cache mapping case-insensitive names to metadata objects.
     * @readonly
     * @type {Record<string, EmotionInfo>}
     */
    static MAP = Object.fromEntries(
        Reaction.EMOTION.map(emotion => [
            emotion.name.toLowerCase(),
            emotion
        ])
    );

    /**
     * Safely normalizes lookup keys, purging whitespace and lowercasing keys.
     *
     * @param {string} [name] Emotion name string.
     * @returns {string}
     */
    static normalize(name = "") {
        return String(name ?? "")
            .trim()
            .toLowerCase();
    }

    /**
     * Checks if an emotion exists.
     *
     * @param {string} name Emotion name string.
     * @returns {boolean}
     */
    static has(name) {
        return Object.hasOwn(
            Reaction.MAP,
            Reaction.normalize(name)
        );
    }

    constructor() {
        /** 
         * Reference URL locating individual image sprite assets.
         * @type {string} 
         */
        this.url = "";

        /**
         * Key-Value register mapping emotion names to coordinates array [X%, Y%, scale%].
         * @type {Record<string, Sprite>}
         */
        this.sprites = {};

        // Pre-allocate coordinate containers for all supported emotions
        for (const { name } of Reaction.EMOTION) {
            this.sprites[name] = [0, 0, 0];
        }
    }

    /**
     * Retrieves coordinate arrays. Falls back strictly to default states
     * if the requested emotion is unknown or undefined.
     *
     * @param {string} [name] Emotion name.
     * @returns {Sprite}
     */
    get(name = Reaction.EMOTION[Reaction.DEFAULT_INDEX].name) {
        const info = Reaction.getInfo(name);

        return (
            this.sprites[info.name] ??
            this.sprites[Reaction.EMOTION[Reaction.DEFAULT_INDEX].name]
        );
    }

    /**
     * Retrieves the emoji symbol associated with an emotion name.
     *
     * @param {string} [name] Emotion name.
     * @returns {string}
     */
    static getEmoji(name = Reaction.EMOTION[Reaction.DEFAULT_INDEX].name) {
        return Reaction.getInfo(name).emoji;
    }

    /**
     * Resolves emotional metadata case-insensitively, defaulting to the base state on mismatch.
     *
     * @param {string} [name] Emotion name.
     * @returns {EmotionInfo}
     */
    static getInfo(name = Reaction.EMOTION[Reaction.DEFAULT_INDEX].name) {
        const normalized = Reaction.normalize(name);
        return Reaction.MAP[normalized] ?? Reaction.EMOTION[Reaction.DEFAULT_INDEX];
    }

    /**
     * Returns the array offset index. Returns -1 on failure.
     *
     * @param {string} name Emotion name.
     * @returns {number}
     */
    static getIndex(name) {
        const normalized = Reaction.normalize(name);

        return Reaction.EMOTION.findIndex(
            emotion => emotion.name.toLowerCase() === normalized
        );
    }
}