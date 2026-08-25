// @ts-check

import { Message_Buffer_live_request } from "../util/Constants";
import Logger from "./lib/Logger";

/** @typedef {import("./Chat").default} Chat */
/** @typedef {import("./ChatMember").default} ChatMember */
/** @typedef {import("./Message").default} Message */
/** @typedef {import("./lib/ChatMemberScheduler").default} ChatMemberScheduler */
/** @typedef {import("./types/message.types").MessageEvent} MessageEvent */

/**
 * Calculates human-like typing and reading pacing delays dynamically,
 * resolves parent-child reply hierarchies, and calculates deterministic request pacing.
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
     * @returns {Promise<void>}
     */
    async process(messages) {
        if (!messages.length) return;

        await this.ready();

        const orderedMessages = this.#repairSequence(messages);

        for (const message of orderedMessages) {
            this.#processMessage(message);
        }
    }

    /**
     * Queues a single message.
     *
     * @param {Message} message Target Message instance.
     * @returns {Promise<void>}
     */
    async add(message) {
        await this.process([message]);
    }

    /**
     * Re-sorts reply lists topologically so replies appear strictly after parent messages.
     *
     * @param {Message[]} messages Target Messages to sort.
     * @returns {Message[]}
     */
    #repairSequence(messages) {
        const remaining = [...messages];
        /** @type {Message[]} */
        const result = [];
        /** @type {Set<string>} */
        const placed = new Set();

        const watchdogMax = messages.length * 10;
        let watchdog = 0;

        while (remaining.length > 0) {
            watchdog++;
            if (watchdog > watchdogMax) {
                this.logger.warn("Circular parent-reply dependency chain detected during topological sort. Bypassing sequence repair.");
                return messages;
            }

            let index = -1;

            for (let i = 0; i < remaining.length; i++) {
                const message = remaining[i];
                if (!message) continue;

                const reply = this.#getReply(message);
                if (reply && !placed.has(reply.id)) {
                    continue;
                }

                index = i;
                break;
            }

            if (index === -1) {
                result.push(...remaining);
                break;
            }

            const message = remaining.splice(index, 1)[0];
            if (!message) continue;

            result.push(message);
            placed.add(message.id);
        }

        return result;
    }

    /**
     * Resolves the reply target for a message.
     *
     * @param {Message} message
     * @returns {Message|null}
     */
    #getReply(message) {
        if (message.reply) {
            return message.reply;
        }

        const replyId = message.protocol?.replyId;
        if (!replyId) return null;

        return this.chat.getMessageByProtocolId(replyId) ?? null;
    }

    /**
     * Schedules typing, reading, and delivery actions across participants.
     *
     * @param {Message} message Target Message.
     */
    #processMessage(message) {
        const sender = message.sender;
        if (!sender) return;

        const senderScheduler = this.schedulers.get(sender.id);
        if (!senderScheduler) return;

        const senderTime = senderScheduler.getLastTime();
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