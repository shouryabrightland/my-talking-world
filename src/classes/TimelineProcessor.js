// @ts-check

import { Message_Buffer_live_request } from "../util/Constants";
import Logger from "./lib/Logger";

/** @typedef {import("./Chat").default} Chat */
/** @typedef {import("./ChatMember").default} ChatMember */
/** @typedef {import("./Message").default} Message */
/** @typedef {import("./lib/ChatMemberScheduler").default} ChatMemberScheduler */
/** @typedef {import("./types/message.types").MessageEvent} MessageEvent */

/**
 * Calculates human-like typing and reading pacing delays dynamically and
 * calculates deterministic request pacing. Messages are purely chronological —
 * no topological reply-graph sorting is performed.
 */
export default class TimelineProcessor {

    /**
     * @param {Chat} chat Main Chat reference.
     * @param {readonly ChatMember[]} members Array of registered participants.
     * @param {Logger} logger Main logging interface.
     */
    constructor(chat, members, logger) {
        if (!chat) throw new TypeError("TimelineProcessor requires a Chat reference.");
        if (!members || !members.length) throw new TypeError("TimelineProcessor requires an array of members.");

        /** @readonly @type {Chat} */
        this.chat = chat;

        /** @readonly @type {readonly ChatMember[]} */
        this.members = members;

        /** @readonly @type {Logger} */
        this.logger = logger.child("TimelineProcessor");

        /** 
         * Map indexing member schedulers for fast lookup.
         * @readonly @type {Map<string, ChatMemberScheduler>} 
         */
        this.schedulers = new Map();

        for (const member of members) {
            this.schedulers.set(member.id, member.scheduler);
        }
    }

    /**
     * Blocks execution flow until all participant schedulers conclude database loads.
     *
     * @returns {Promise<void>}
     */
    async ready() {
        await Promise.all(
            [...this.schedulers.values()].map(scheduler => scheduler.readyPromise)
        );
    }

    /**
     * Orchestrates pacing delays on newly added messages.
     *
     * @param {Message[]} messages Array of target Messages.
     * @param {number} [interMessageDelay=0] Gap (ms) before each message's
     *   typing starts — the inter-message pacing offset (Phase 6.3).
     * @returns {Promise<void>}
     */
    async process(messages, interMessageDelay = 0) {
        if (!messages.length) return;

        await this.ready();

        for (const message of messages) {
            this.#processMessage(message, interMessageDelay);
        }
    }

    /**
     * Queues a single message.
     *
     * @param {Message} message Target Message instance.
     * @param {number} [interMessageDelay=0] Gap (ms) before typing begins.
     * @returns {Promise<void>}
     */
    async add(message, interMessageDelay = 0) {
        await this.process([message], interMessageDelay);
    }

    /**
     * Schedules typing, reading, and delivery actions across participants.
     *
     * @param {Message} message Target Message.
     * @param {number} [interMessageDelay=0] Offset (ms) applied to the sender's
     *   start time BEFORE typingDelay begins, so consecutive bubbles pop in
     *   with a realistic pause between them (Phase 6.3).
     */
    #processMessage(message, interMessageDelay = 0) {
        const sender = message.sender;
        if (!sender) return;

        const senderScheduler = this.schedulers.get(sender.id);
        if (!senderScheduler) return;

        const senderTime = senderScheduler.getLastTime() + Math.max(0, interMessageDelay);
        const typingEnd = senderTime + sender.typingDelay(message);

        /** @type {MessageEvent[]} */
        const senderEvents = [
            {
                type: "typing:start",
                time: senderTime,
                message
            },
            {
                type: "typing:end",
                time: typingEnd,
                message
            },
            {
                type: "message",
                time: typingEnd,
                message
            }
        ];

        senderScheduler.add(senderEvents);

        // Distribute reading delays to all other chat participants
        for (const member of this.members) {
            if (member.id === sender.id) continue;

            const scheduler = this.schedulers.get(member.id);
            if (!scheduler) continue;

            const previousTime = scheduler.getLastTime();
            const readingStart = Math.max(previousTime, typingEnd);
            const readingEnd = readingStart + member.readingDelay(message);

            scheduler.add([
                {
                    type: "reading:start",
                    time: readingStart,
                    message
                },
                {
                    type: "reading:end",
                    time: readingEnd,
                    message
                }
            ]);
        }
    }

    /**
     * Epoch ms at which the last queued event across ALL participant schedulers
     * finishes — i.e. when the final message of this turn has been typed,
     * delivered and read on screen. Anchored to at least Date.now().
     *
     * Used to anchor macro pacing: a `<delay ms="…"/>` only starts counting
     * after this instant, so it never runs concurrently with on-screen typing.
     *
     * @returns {number} Timestamp in milliseconds epoch.
     */
    getLastTime() {
        let maxTime = Date.now();
        for (const scheduler of this.schedulers.values()) {
            maxTime = Math.max(maxTime, scheduler.getLastTime());
        }
        return maxTime;
    }

    /**
     * Calculates the exact timestamp when the next Groq request should be triggered.
     * Prevents fast-loop quota exhaustion by ensuring that requests are only fired
     * when the pending message buffer drains below the threshold.
     *
     * @returns {number} Timestamp in milliseconds epoch.
     */
    getNextLiveRequstTime() {
        let maxBufferTime = 0;
        let totalQueuedMessages = 0;

        for (const scheduler of this.schedulers.values()) {
            const timeline = scheduler.getTimeline();
            const messageEvents = timeline.filter(ev => ev.type === "message");
            totalQueuedMessages += messageEvents.length;

            if (messageEvents.length > 0) {
                const targetEvent = messageEvents[Math.max(0, messageEvents.length - Message_Buffer_live_request)];
                if (targetEvent && targetEvent.time > maxBufferTime) {
                    maxBufferTime = targetEvent.time;
                }
            }
        }

        // If the queue has fewer messages than the buffer threshold, request immediately
        if (totalQueuedMessages < Message_Buffer_live_request) {
            return Date.now();
        }

        return Math.max(Date.now(), maxBufferTime);
    }
}