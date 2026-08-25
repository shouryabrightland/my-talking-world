// @ts-check

/**
 * @file ChatMemberScheduler.js
 * Handles chronologically scheduled actions for individual ChatMembers.
 *
 * Responsibilities:
 * - Manages a timeline queue of typing, reading, and message delivery events.
 * - Executes events at precise timestamps with expiry-based visual queue flood prevention.
 * - Provides mutex-locked sequential database persistence.
 * - Supports event type: typing:start/end, reading:start/end, message.
 */

import Message from "../Message";
import Logger from "./Logger";
import { ChatMemberEvents } from "../ChatMember";

/** @typedef {import("../ChatMember").default} ChatMember */

/**
 * @typedef {{
 *     type:
 *         "typing:start"|
 *         "typing:end"|
 *         "reading:start"|
 *         "reading:end"|
 *         "message",
 *     time: number,
 *     message: Message
 * }} MessageEvent
 */

/**
 * Handles chronologically scheduled actions (typing, reading, message delivery) 
 * for individual ChatMembers with sequential, mutex-locked database persistence.
 */
export default class ChatMemberScheduler {

    /** 
     * Actions older than 4 seconds are marked as expired to prevent visual queue floods.
     * @readonly
     */
    ExpiryThreshold = 4_000;

    /** @type {(() => void)|null} */
    #resolveReady = null;

    /**
     * @param {ChatMember} member Parent ChatMember reference.
     */
    constructor(member) {
        if (!member) throw new TypeError("ChatMemberScheduler requires a ChatMember instance.");

        /** @readonly @type {ChatMember} */
        this.member = member;

        /** @readonly @type {string} */
        this.key = `scheduler:${member.id}`;

        /** 
         * Active queue of scheduled events sorted chronologically.
         * @type {MessageEvent[]} 
         */
        this.timeline = [];

        /** 
         * Native setTimeout pointer for the next pending event.
         * @type {ReturnType<typeof setTimeout>|null} 
         */
        this.timeout = null;

        /** @type {boolean} */
        this.ready = false;

        /** 
         * Promise resolved once database states are fully loaded.
         * @readonly @type {Promise<void>} 
         */
        this.readyPromise = new Promise(resolve => {
            this.#resolveReady = resolve;
        });

        /** @readonly @type {Logger} */
        this.logger = member.logger.child("Scheduler");

        /** 
         * Sequential transaction queue to eliminate concurrent IndexedDB write collisions.
         * @type {Promise<void>} 
         */
        this.saveQueue = Promise.resolve();
    }

    /**
     * Initializes the scheduler and restores persisted queues from IndexedDB.
     * Must be awaited to ensure database hydration completes before scheduling.
     */
    async init() {
        if (this.ready) return;

        try {
            await this.load();
            this.ready = true;
            this.#resolveReady?.();
            this.#resolveReady = null;
            this.scheduleNext();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to initialize timeline scheduler:", error);
            this.ready = false;
            this.#resolveReady = null;
            throw error;
        }
    }

    /**
     * Appends events to the queue and re-sorts execution orders defensively.
     *
     * @param {MessageEvent[]} events Array of message events.
     */
    add(events) {
        if (!this.ready) {
            throw new Error(`Scheduler "${this.member.id}" is not ready.`);
        }

        if (!Array.isArray(events) || !events.length) return;

        for (const event of events) {
            if (!this.#isValidEvent(event)) continue;
            this.timeline.push(event);
        }

        this.timeline.sort((a, b) => a.time - b.time);
        this.save();
        this.scheduleNext();
    }

    /**
     * Purges all scheduled events and cancels active timers cleanly.
     */
    clear() {
        this.cancelTimeout();
        this.timeline.length = 0;
        this.save();
        this.logger.info("Timeline queue cleared.");
    }

    /**
     * Returns a copy of the active queue.
     * @returns {MessageEvent[]}
     */
    getTimeline() {
        return [...this.timeline];
    }

    /**
     * Verifies if the queue is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this.timeline.length === 0;
    }

    /**
     * Returns the timestamp of the last scheduled item.
     * Anchored to at least Date.now() to prevent past-time scheduling.
     *
     * @returns {number}
     */
    getLastTime() {
        const last = this.timeline.at(-1)?.time ?? 0;
        return Math.max(Date.now(), last);
    }

    /**
     * Schedules the next chronologically pending task.
     */
    scheduleNext() {
        this.cancelTimeout();
        if (!this.ready) return;

        const event = this.timeline[0];
        if (!event) return;

        const delay = Math.max(0, event.time - Date.now());

        this.timeout = setTimeout(() => {
            this.timeout = null;
            try {
                this.executeDue();
            } catch (/** @type {unknown} */ error) {
                this.logger.error("Failed to execute due timeline actions:", error);
                this.scheduleNext();
            }
        }, delay);
    }

    /**
     * Executes all tasks whose execution boundary has passed.
     */
    executeDue() {
        const now = Date.now();

        while (this.timeline.length > 0) {
            const event = this.timeline[0];
            if (!event) break;

            if (event.time > now) break;

            this.timeline.shift();
            const expired = (now - event.time) > this.ExpiryThreshold;

            try {
                this.execute(event, expired);
            } catch (/** @type {unknown} */ error) {
                this.logger.error(`Error occurred executing action "${event.type}":`, error);
            }
        }

        this.save();
        this.scheduleNext();
    }

    /**
     * Executes a single timeline action preserving individual character emotion continuity.
     *
     * @param {MessageEvent} event Context MessageEvent.
     * @param {boolean} expired True if the event was delayed beyond ExpiryThreshold.
     */
    execute(event, expired) {
        try {
            switch (event.type) {
                case "typing:start":
                    if (!expired) {
                        const duration = Math.max(1000, event.message ? this.member.typingDelay(event.message) : 2500);
                        this.member.events.emit(ChatMemberEvents.TYPING, true);
                        this.member.setTransientState("isTyping", true, duration);
                        this.member.setEmotion("Thinking", duration);
                    }
                    break;

                case "typing:end":
                    if (!expired) {
                        this.member.events.emit(ChatMemberEvents.TYPING, false);
                        this.member.setTransientState("isTyping", false, 0);
                    }
                    break;

                case "reading:start":
                    if (!expired) {
                        const duration = Math.max(1000, event.message ? this.member.readingDelay(event.message) : 2000);
                        this.member.events.emit(ChatMemberEvents.READING, true);
                        this.member.setTransientState("isReading", true, duration);

                        const ownEmotion = this.member.currentEmotion?.name || "Default";
                        this.member.setEmotion(ownEmotion, duration + 4000);
                    }
                    break;

                case "reading:end":
                    if (!expired) {
                        this.member.events.emit(ChatMemberEvents.READING, false);
                        this.member.setTransientState("isReading", false, 0);
                        this.member.lastSeenMessage = event.message;
                    }
                    break;

                case "message":
                    if (event.message?.emotion?.name) {
                        this.member.setEmotion(event.message.emotion.name, 5000);
                    }
                    this.member.send(event.message);
                    break;

                default:
                    this.logger.warn(`Ignored unrecognized action: "${event.type}"`);
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.error(`Failed to execute action "${event.type}":`, error);
        }
    }

    /**
     * Serializes and writes active timeline structures to the database via sequential queue.
     *
     * @returns {Promise<void>}
     */
    save() {
        const operation = this.saveQueue.then(async () => {
            try {
                await this.member.schedulerStorage.setItem(
                    this.key,
                    this.timeline.map(event => ({
                        type: event.type,
                        time: event.time,
                        message: event.message.toJSON()
                    }))
                );
            } catch (/** @type {unknown} */ error) {
                this.logger.error("Failed to commit timeline states to Storage database:", error);
            }
        });

        this.saveQueue = operation.catch(() => {});
        return operation;
    }

    /**
     * Restores state timeline queues from the database table.
     *
     * @returns {Promise<void>}
     */
    async load() {
        try {
            const data = await this.member.schedulerStorage.getItem(this.key);
            if (!data || !Array.isArray(data)) {
                this.timeline.length = 0;
                return;
            }

            /** @type {MessageEvent[]} */
            const next = [];

            for (const event of data) {
                if (!this.#isValidStoredEvent(event)) continue;

                const sender = this.member.chat?.getMember(event.message.senderId);
                if (!sender) continue;

                try {
                    next.push({
                        type: event.type,
                        time: event.time,
                        message: Message.fromJSON(event.message, sender)
                    });
                } catch (/** @type {unknown} */ error) {
                    this.logger.error("Failed to instantiate message inside timeline loader:", error);
                }
            }

            next.sort((a, b) => a.time - b.time);
            this.timeline = next;
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to restore timeline queues from database:", error);
            this.timeline.length = 0;
        }
    }

    /**
     * @param {any} event
     * @returns {boolean}
     */
    #isValidEvent(event) {
        return (
            event &&
            typeof event.type === "string" &&
            typeof event.time === "number" &&
            Number.isFinite(event.time) &&
            event.message instanceof Message
        );
    }

    /**
     * @param {any} event
     * @returns {boolean}
     */
    #isValidStoredEvent(event) {
        return (
            event &&
            typeof event.type === "string" &&
            typeof event.time === "number" &&
            Number.isFinite(event.time) &&
            !!event.message
        );
    }

    cancelTimeout() {
        if (this.timeout === null) return;
        clearTimeout(this.timeout);
        this.timeout = null;
    }

    destroy() {
        this.cancelTimeout();
        this.timeline.length = 0;
        this.ready = false;
        this.#resolveReady = null;
    }
}