// @ts-check

/**
 * @file ChatMember.js
 * Represents a single participant in the chat room (human user or AI character).
 *
 * Responsibilities:
 * - Stores personality bio, dynamic birthday, and computed age.
 * - Handles transient visual states (isTyping, isReading, isThinking, isActive, emotion).
 *
 * NOTE: Long-term factual memory lives entirely in UnifiedMemory (tag-indexed
 * by member id). ChatMember only owns the transient `stateMemory` table.
 * - Calculates human-like typing and reading pacing delays.
 * - Persists state to IndexedDB via Storage.
 * - Connects/disconnects from Chat room context.
 */

/** @typedef {import("./Chat").default} Chat */
/** @typedef {import("./Message").default} Message */
/** @typedef {import("./types/Reaction.types").EmotionInfo} EmotionInfo */

import EventManager from "./EventManager";
import Reaction from "./Reaction";
import Memory from "./lib/Memory";
import Logger from "./lib/Logger";
import ChatMemberScheduler from "./lib/ChatMemberScheduler";
import { random } from "../util/random";
import Storage from "./lib/Storage";

/**
 * Event identifiers emitted across an individual member's lifecycle.
 * @readonly
 * @enum {string}
 */
export const ChatMemberEvents = {
    ONLINE: "online",
    ACTIVE: "active",
    READING: "reading",
    TYPING: "typing",
    THINKING: "thinking",
    EMOTION: "emotion",
    ABOUT: "about",
    BIRTHDAY: "birthday"
};

/**
 * Represents a single participant in the room (human user or AI character).
 * Encapsulates personality bio, dynamic birthday & computed age,
 * transient visual state, and timeline scheduling.
 */
export default class ChatMember {

    /** 
     * Timer used to delay transition to inactive state after activity stops.
     * @type {ReturnType<typeof setTimeout>|null} 
     */
    #inactiveTimer = null;

    /** 
     * Internal initialization flag.
     * @type {boolean} 
     */
    #isInit = false;

    /**
     * @param {Object} options
     * @param {string} options.id Unique lowercase identifier (e.g. 'tom', 'me').
     * @param {string} options.name Display name of the participant.
     * @param {string} [options.about=""] Biographical personality instructions.
     * @param {string} [options.birthday="2006-01-01"] ISO date string (YYYY-MM-DD).
     * @param {Logger} [options.logger] Parent logging instance.
     * @param {boolean} [options.isAI=true] Whether this member is an autonomous AI agent.
     * @param {number} [options.typingSpeedMs=28] Pacing speed in milliseconds per letter.
     */
    constructor({
        id,
        name,
        about = "",
        birthday = "2006-01-01",
        logger = new Logger("ChatMember"),
        isAI = true,
        typingSpeedMs = 28
    }) {
        if (typeof id !== "string" || !id.trim()) {
            throw new TypeError("ChatMember initialization rejected: 'id' must be a non-empty string.");
        }

        if (typeof name !== "string" || !name.trim()) {
            throw new TypeError("ChatMember initialization rejected: 'name' must be a non-empty string.");
        }

        /** 
         * Unique lowercase participant identifier.
         * @readonly 
         * @type {string} 
         */
        this.id = id.toLowerCase();

        /** 
         * Display name.
         * @type {string} 
         */
        this.name = name;

        /** 
         * Whether this character is driven by AI generation.
         * @readonly 
         * @type {boolean} 
         */
        this.isAI = isAI;

        /** 
         * ISO Birthday string (YYYY-MM-DD).
         * @type {string} 
         */
        this.birthday = typeof birthday === "string" && birthday.trim() ? birthday.trim() : "2006-01-01";

        /** 
         * Pacing rate in milliseconds per letter for typing simulations.
         * @type {number} 
         */
        this.typingSpeedMs = Number.isFinite(typingSpeedMs) ? Math.max(10, typingSpeedMs) : 28;

        /** @readonly @type {Logger} */
        this.logger = logger.child(name);

        /** @readonly @type {EventManager} */
        this.events = new EventManager(this.logger);

        /** 
         * Sprite sheet and emotion coordinate manager.
         * @readonly 
         * @type {Reaction} 
         */
        this.reaction = new Reaction();

        /** 
         * Reference to the chat room this member is connected to.
         * @type {Chat|null} 
         */
        this.chat = null;

        /** 
         * Reload-resistant transient state store (isTyping, isReading, isActive, emotion).
         * @readonly 
         * @type {Memory} 
         */
        this.stateMemory = new Memory(
            this.logger,
            `state:${this.id}`
        );

        /** 
         * Dedicated database table for persistent timeline scheduler queues.
         * @readonly 
         * @type {Storage} 
         */
        this.schedulerStorage = new Storage("Scheduler");

        /** 
         * Base personality biography.
         * @type {string} 
         */
        this.about = about;

        /** @type {boolean} */
        this.isOnline = true;

        /** @type {boolean} */
        this.isReading = false;

        /** @type {boolean} */
        this.isTyping = false;

        /** @type {boolean} */
        this.isThinking = false;

        /** @type {boolean} */
        this.isActive = false;

        /** @type {number} */
        this.lastSeen = Date.now();

        /** @type {Message|null} */
        this.lastSeenMessage = null;

        /** @type {EmotionInfo|null} */
        this.currentEmotion = Reaction.getInfo("Default");

        /** @readonly @type {ChatMemberScheduler} */
        this.scheduler = new ChatMemberScheduler(this);

        this.#bindEvents();
        this.logger.info("ChatMember constructed successfully.");
    }

    /**
     * Parses a birthday using LOCAL calendar parts for `YYYY-MM-DD` strings.
     * Native parsing treats date-only strings as UTC midnight, which shifts the
     * birthday to the previous day in negative UTC offsets (off-by-one age).
     *
     * @param {string} isoDate Raw birthday string.
     * @returns {Date} Local-calendar Date (or an Invalid Date).
     */
    static #parseBirthday(isoDate) {
        const clean = String(isoDate || "").trim();
        const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
        if (match) {
            return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        }
        return new Date(clean);
    }

    /**
     * Calculates the member's current age dynamically by comparing their birthday against the current date.
     *
     * @returns {number} Age in full integer years.
     */
    get age() {
        if (!this.birthday) return 20;

        const birthDate = ChatMember.#parseBirthday(this.birthday);
        if (Number.isNaN(birthDate.getTime())) return 20;

        const now = new Date();
        let calculatedAge = now.getFullYear() - birthDate.getFullYear();
        const monthDiff = now.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
            calculatedAge--;
        }

        return Math.max(1, calculatedAge);
    }

    /**
     * Updates the member's birthday and broadcasts change event.
     *
     * @param {string} isoDate YYYY-MM-DD formatted date string.
     * @returns {void}
     */
    setBirthday(isoDate) {
        if (typeof isoDate !== "string" || !isoDate.trim()) return;
        const parsed = ChatMember.#parseBirthday(isoDate);
        if (Number.isNaN(parsed.getTime())) return;

        this.birthday = isoDate.trim();
        this.events.emit(ChatMemberEvents.BIRTHDAY, this.birthday);
        this.logger.info(`Updated birthday for ${this.name}: ${this.birthday} (Age: ${this.age})`);
    }

    /**
     * Initializes member storage, restoring persistent memories, transient visual states, and schedulers.
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (this.#isInit) {
            this.logger.warn("init() ignored: member already initialized.");
            return;
        }

        this.logger.info("Initializing member state data...");

        try {
            await this.stateMemory.load();
            this.#restoreTransientState();
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to load transient stateMemory:", error);
        }

        try {
            await this.scheduler.init();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Initialization failed on timeline scheduler:", error);
            this.events.clearAll();
            throw error;
        }

        this.#isInit = true;
        this.logger.info("Initialization completed successfully.");
    }

    /**
     * Restores active visual states from transient memory if expiration timestamps are unexpired.
     * @returns {void}
     */
    #restoreTransientState() {
        const now = new Date();

        const isTypingKey = this.stateMemory.get("isTyping");
        this.isTyping = isTypingKey ? (isTypingKey.isUsable(now) && Boolean(isTypingKey.value)) : false;

        const isReadingKey = this.stateMemory.get("isReading");
        this.isReading = isReadingKey ? (isReadingKey.isUsable(now) && Boolean(isReadingKey.value)) : false;

        const isThinkingKey = this.stateMemory.get("isThinking");
        this.isThinking = isThinkingKey ? (isThinkingKey.isUsable(now) && Boolean(isThinkingKey.value)) : false;

        const isActiveKey = this.stateMemory.get("isActive");
        this.isActive = isActiveKey ? (isActiveKey.isUsable(now) && Boolean(isActiveKey.value)) : false;

        const emotionKey = this.stateMemory.get("emotion");
        if (emotionKey && emotionKey.isUsable(now) && typeof emotionKey.value === "string") {
            this.currentEmotion = Reaction.getInfo(emotionKey.value);
        } else {
            this.currentEmotion = Reaction.getInfo("Default");
        }
    }

    /**
     * Sets active emotion and writes to transient memory with TTL expiration.
     *
     * @param {string} [name="Default"]
     * @param {number} [durationMs=4500]
     * @returns {void}
     */
    setEmotion(name = "Default", durationMs = 4500) {
        this.currentEmotion = Reaction.getInfo(name);
        this.events.emit(ChatMemberEvents.EMOTION, this.currentEmotion);

        const expiry = name.toLowerCase() === "default"
            ? null
            : new Date(Date.now() + Math.max(durationMs, 2000));

        this.stateMemory.set("emotion", this.currentEmotion.name, expiry);
        void this.saveStateMemory();
    }

    /**
     * Persists transient runtime visual states to stateMemory with duration-based expiry.
     *
     * @param {"isTyping"|"isReading"|"isThinking"|"isActive"} key
     * @param {boolean} value
     * @param {number} [durationMs=3500]
     * @returns {void}
     */
    setTransientState(key, value, durationMs = 3500) {
        const expiry = value ? new Date(Date.now() + durationMs) : null;
        this.stateMemory.set(key, value ? "true" : null, expiry);
        void this.saveStateMemory();
    }

    /**
     * Binds internal event listeners.
     * @returns {void}
     */
    #bindEvents() {
        this.events.on(
            ChatMemberEvents.READING,
            /** @param {boolean} state */
            (state) => {
                if (typeof state !== "boolean") return;
                this.isReading = state;
                this.updateActive();
            },
            "state:reading"
        );

        this.events.on(
            ChatMemberEvents.TYPING,
            /** @param {boolean} state */
            (state) => {
                if (typeof state !== "boolean") return;
                this.isTyping = state;
                this.updateActive();
            },
            "state:typing"
        );

        this.events.on(
            ChatMemberEvents.THINKING,
            /** @param {boolean} state */
            (state) => {
                if (typeof state !== "boolean") return;
                this.isThinking = state;
                this.updateActive();
            },
            "state:thinking"
        );

        this.events.on(
            ChatMemberEvents.ABOUT,
            /** @param {string} text */
            (text) => {
                if (typeof text !== "string") return;
                this.about = text;
            },
            "state:about"
        );

        this.events.on(
            ChatMemberEvents.EMOTION,
            /** @param {EmotionInfo|null} emotion */
            (emotion) => {
                this.currentEmotion = emotion;
            },
            "state:emotion"
        );
    }

    /**
     * @param {Chat} chat
     * @returns {void}
     */
    connect(chat) {
        if (!chat) throw new TypeError("Chat reference is required.");
        if (this.chat === chat) return;
        this.chat = chat;
    }

    /**
     * @returns {void}
     */
    disconnect() {
        if (!this.chat) return;
        this.chat = null;
    }

    /**
     * Dispatches a message to the active chat room.
     * @param {Message} message
     * @returns {void}
     */
    send(message) {
        if (!this.chat) throw new Error("Chat connection is absent.");
        if (!message) throw new TypeError("Message is required.");
        this.chat.addMessage(message);
    }

    /**
     * Calculates typing delay in milliseconds based on text length and typing speed rate.
     *
     * @param {Message} message
     * @returns {number} Delay in milliseconds.
     */
    typingDelay(message) {
        const length = Math.max(message?.text?.length ?? 0, 1);
        const rate = this.typingSpeedMs || 28;
        return random(length * (rate * 0.8), length * (rate * 1.25));
    }

    /**
     * Calculates reading delay in milliseconds based on text length.
     *
     * @param {Message} message
     * @returns {number} Delay in milliseconds.
     */
    readingDelay(message) {
        const length = Math.max(message?.text?.length ?? 0, 30);
        return random(length * 18, length * 26);
    }

    /**
     * Evaluates active state based on reading/typing/thinking flags.
     * @returns {void}
     */
    updateActive() {
        const active = this.isReading || this.isTyping || this.isThinking;

        if (active) {
            if (this.#inactiveTimer !== null) {
                clearTimeout(this.#inactiveTimer);
                this.#inactiveTimer = null;
            }

            this.setTransientState("isActive", true, 4000);

            if (this.isActive) return;

            this.isActive = true;
            this.events.emit(ChatMemberEvents.ACTIVE, true);
            return;
        }

        if (this.#inactiveTimer !== null) return;

        this.#inactiveTimer = setTimeout(() => {
            this.#inactiveTimer = null;

            if (this.isReading || this.isTyping || this.isThinking) return;
            if (!this.isActive) return;

            this.isActive = false;
            this.setEmotion("Default");
            this.setTransientState("isActive", false, 0);
            this.events.emit(ChatMemberEvents.ACTIVE, false);
        }, 3000);
    }

    /**
     * Resets visual and scheduling states.
     * @returns {void}
     */
    resetState() {
        if (this.#inactiveTimer !== null) {
            clearTimeout(this.#inactiveTimer);
            this.#inactiveTimer = null;
        }

        this.isReading = false;
        this.isTyping = false;
        this.isThinking = false;
        this.isActive = false;
        this.setEmotion("Default");
        this.scheduler.clear();
        this.stateMemory.clear();
        void this.stateMemory.destroy();
    }

    /**
     * @returns {Promise<void>}
     */
    async saveStateMemory() {
        try {
            await this.stateMemory.save();
        } catch (/** @type {unknown} */ error) {
            this.logger.warn("Failed to save stateMemory:", error);
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async destroy() {
        if (this.#inactiveTimer !== null) {
            clearTimeout(this.#inactiveTimer);
            this.#inactiveTimer = null;
        }

        try {
            this.scheduler.destroy();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Scheduler destroy error:", error);
        }

        this.disconnect();
        this.events.clearAll();
        this.#isInit = false;
    }

    /**
     * Outputs a concise biographical summary string.
     *
     * @returns {string}
     */
    toString() {
        return `${this.id} (${this.name}, Age: ${this.age}): ${this.about}`;
    }
}