// @ts-check

/**
 * @file Message.js
 * Data structure representing a single conversational exchange.
 *
 * Responsibilities:
 * - Stores message body text, sender reference, and emotion metadata.
 * - Manages parent-child reply relationships via protocol IDs.
 * - Supports soft-deletion and sent-state tracking.
 * - Provides JSON serialization/deserialization for IndexedDB persistence.
 * - Generates LLM prompt-ready string representations.
 */

/** @typedef {import("./ChatMember").default} ChatMember */
/** @typedef {import("./Chat").default} Chat */

import ReactionClass from "./Reaction";

/**
 * Data structure representing a conversational exchange.
 * Supports emotion metadata and quote relationships.
 */
export default class Message {

    /**
     * @param {Object} options
     * @param {string} [options.id] Unique UUID.
     * @param {string|null} [options.protocolId] String index of the parsed protocol ID.
     * @param {string|null} [options.protocolReplyId] Target protocol ID this message is replying to.
     * @param {ChatMember|null} options.sender ChatMember instance of the author.
     * @param {string} [options.text] Message body text.
     * @param {{name?: string, intensity?: number}} [options.emotion] Character emotional metrics.
     */
    constructor({
        id = crypto.randomUUID(),
        protocolId = null,
        protocolReplyId = null,
        sender,
        text = "",
        emotion = {}
    }) {
        if (!Message.#validId(id)) {
            throw new TypeError("Initialization rejected: Message ID must be a non-empty string.");
        }

        if (protocolId !== null && !Message.#validId(protocolId)) {
            throw new TypeError("Initialization rejected: Protocol ID must be a non-empty string or null.");
        }

        if (protocolReplyId !== null && !Message.#validId(protocolReplyId)) {
            throw new TypeError("Initialization rejected: Protocol Reply ID must be a non-empty string or null.");
        }

        if (typeof text !== "string") {
            throw new TypeError("Initialization rejected: Message text parameter must be a string.");
        }

        const info = ReactionClass.getInfo(
            emotion && typeof emotion.name === "string" ? emotion.name : undefined
        );

        /** 
         * Unique identifier.
         * @readonly @type {string} 
         */
        this.id = id;

        /** 
         * Parent-child reply mapping parameters.
         * @type {{id: string|null, replyId: string|null}} 
         */
        this.protocol = {
            id: protocolId,
            replyId: protocolReplyId
        };

        /** 
         * Authoring member reference.
         * @type {ChatMember|null} 
         */
        this.sender = sender;

        /** 
         * Body text payload.
         * @type {string} 
         */
        this.text = text;

        /** 
         * Active emotion metadata.
         * @type {{name: string, emoji: string, intensity: number}} 
         */
        this.emotion = {
            name: info.name,
            emoji: info.emoji,
            intensity: Message.#validIntensity(emotion?.intensity) ? /** @type {number} */ (emotion.intensity) : 0
        };

        /** 
         * Parent message reference when this is a reply.
         * @type {Message|null} 
         */
        this.reply = null;

        /** 
         * Soft-deletion state flag.
         * @type {boolean} 
         */
        this.deleted = false;

        /** 
         * Status tracking if message was committed to chat array.
         * @type {boolean} 
         */
        this._isSent = false;

        /** 
         * Commit timestamp.
         * @type {Date|null} 
         */
        this.sentAt = null;
    }

    /**
     * Safely updates message body text.
     * @param {string} text
     */
    setText(text) {
        if (typeof text !== "string") {
            throw new TypeError("Failed to set text: Parameter must be a string.");
        }
        this.text = text;
    }

    /**
     * Safely modifies emotion metadata.
     * @param {string} name
     * @param {number} [intensity]
     */
    setEmotion(name, intensity = this.emotion.intensity) {
        if (typeof name !== "string") {
            throw new TypeError("Failed to set emotion: Emotion name must be a string.");
        }

        if (!Message.#validIntensity(intensity)) {
            throw new TypeError("Failed to set emotion: Intensity value must be a finite number.");
        }

        const info = ReactionClass.getInfo(name);

        this.emotion = {
            name: info.name,
            emoji: info.emoji,
            intensity
        };
    }

    /**
     * Establishes a reply connection to a parent message.
     * @param {Message|null} message
     */
    setReply(message) {
        if (message !== null && !(message instanceof Message)) {
            throw new TypeError("Failed to assign reply reference: Expected a Message instance or null.");
        }
        this.reply = message;
    }

    delete() {
        this.deleted = true;
    }

    isDeleted() {
        return this.deleted;
    }

    isReply() {
        return this.reply !== null;
    }

    sent() {
        if (this._isSent) {
            return;
        }
        this._isSent = true;
        this.sentAt = new Date();
    }

    isSent() {
        return this._isSent && this.sentAt !== null;
    }

    /**
     * Outputs an LLM prompt-ready string representation with inlined quotes.
     *
     * @param {Object} [options]
     * @param {boolean} [options.includeProtocol=false]
     * @param {boolean} [options.includeTimestamp=false]
     * @param {number} [options.maxQuoteLength=60]
     * @returns {string|null}
     */
    toString({
        includeProtocol = false,
        includeTimestamp = false,
        maxQuoteLength = 60
    } = {}) {
        if (this.deleted) {
            return null;
        }

        const timeStr = includeTimestamp && this.isSent() && this.sentAt
            ? `[${this.sentAt.toLocaleTimeString()}] `
            : "";

        const idPrefix = includeProtocol && this.protocol.id
            ? `[#${this.protocol.id}] `
            : "";

        const senderName = this.sender?.name ?? this.sender?.id ?? "Director/System";
        const emotionName = this.emotion?.name || "Default";

        let replyContext = "";

        if (includeProtocol) {
            if (this.reply && this.reply.sender) {
                const replyAuthor = this.reply.sender.name || this.reply.sender.id;
                const cleanText = this.reply.text.trim();
                const snippet = cleanText.length > maxQuoteLength
                    ? `${cleanText.slice(0, maxQuoteLength)}...`
                    : cleanText;

                replyContext = ` [Replying to ${replyAuthor}: "${snippet}"]`;
            } else if (this.protocol.replyId) {
                replyContext = ` [Replying to Msg #${this.protocol.replyId}]`;
            }
        }

        return `${timeStr}${idPrefix}${senderName} (${emotionName})${replyContext}: ${this.text}`.trim();
    }

    /**
     * Serializes parameters to JSON.
     *
     * @returns {{
     *   id: string,
     *   senderId: string|null,
     *   protocolId: string|null,
     *   protocolReplyId: string|null,
     *   text: string,
     *   emotion: {name: string, emoji: string, intensity: number},
     *   deleted: boolean,
     *   sentAt: string|null,
     *   replyId: string|null
     * }}
     */
    toJSON() {
        return {
            id: this.id,
            senderId: this.sender?.id ?? null,
            protocolId: this.protocol.id,
            protocolReplyId: this.protocol.replyId,
            text: this.text,
            emotion: { ...this.emotion },
            deleted: this.deleted,
            sentAt: this.sentAt?.toISOString() ?? null,
            replyId: this.reply?.id ?? null
        };
    }

    /**
     * Restores a Message from JSON.
     *
     * @param {any} data
     * @param {ChatMember|null} sender
     * @returns {Message}
     */
    static fromJSON(data, sender) {
        if (!Message.#validRecord(data)) {
            throw new TypeError("Failed to deserialize Message: Input data violates schema.");
        }

        const message = new Message({
            id: data.id,
            sender,
            protocolId: Message.#nullableId(data.protocolId),
            protocolReplyId: Message.#nullableId(data.protocolReplyId),
            text: typeof data.text === "string" ? data.text : "",
            emotion: Message.#validEmotion(data.emotion) ? data.emotion : {}
        });

        message.deleted = data.deleted === true;

        if (data.sentAt !== null) {
            const date = new Date(data.sentAt);
            if (!Number.isNaN(date.getTime())) {
                message.sentAt = date;
                message._isSent = true;
            }
        }

        return message;
    }

    /**@param {unknown} value */
    static #validId(value) {
        return typeof value === "string" && value.trim().length > 0;
    }

    /**@param {unknown} value */
    static #validIntensity(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    /**
     * @param {unknown} value
     * @returns {string|null}
     */
    static #nullableId(value) {
        if (value === null) return null;
        return Message.#validId(value) ? String(value) : null;
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    static #validEmotion(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }
        const obj = /** @type {Record<string, unknown>} */ (value);
        if (obj.name !== undefined && typeof obj.name !== "string") {
            return false;
        }
        if (obj.intensity !== undefined && !Message.#validIntensity(obj.intensity)) {
            return false;
        }
        return true;
    }

    /**@param {unknown} value */
    static #validRecord(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }
        const obj = /** @type {Record<string, unknown>} */ (value);
        if (!Message.#validId(obj.id)) {
            return false;
        }
        if (obj.senderId !== null && !Message.#validId(obj.senderId)) {
            return false;
        }
        if (obj.protocolId !== null && !Message.#validId(obj.protocolId)) {
            return false;
        }
        if (obj.protocolReplyId !== null && !Message.#validId(obj.protocolReplyId)) {
            return false;
        }
        if (obj.replyId !== null && !Message.#validId(obj.replyId)) {
            return false;
        }
        if (typeof obj.text !== "string") {
            return false;
        }
        if (!Message.#validEmotion(obj.emotion)) {
            return false;
        }
        return true;
    }
}