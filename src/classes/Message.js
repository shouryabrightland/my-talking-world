// @ts-check

/**
 * @file Message.js
 * Data structure representing a single conversational exchange.
 *
 * Responsibilities:
 * - Stores message body text, sender reference, and emotion metadata.
 * - Supports soft-deletion and sent-state tracking.
 * - Provides JSON serialization/deserialization for IndexedDB persistence.
 * - Generates LLM prompt-ready string representations.
 */

/** @typedef {import("./ChatMember").default} ChatMember */
/** @typedef {import("./Chat").default} Chat */

import ReactionClass from "./Reaction";

/**
 * Data structure representing a conversational exchange.
 * Strictly chronological — quote replies and parent-child trees were removed.
 */
export default class Message {

    /**
     * @param {Object} options
     * @param {string} [options.id] Unique UUID.
     * @param {string|null} [options.protocolId] String index of the parsed protocol ID.
     * @param {ChatMember|null} options.sender ChatMember instance of the author.
     * @param {string} [options.text] Message body text.
     * @param {{name?: string, intensity?: number}} [options.emotion] Character emotional metrics.
     */
    constructor({
        id = crypto.randomUUID(),
        protocolId = null,
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
         * Parsed protocol index for this message.
         * @type {{id: string|null}} 
         */
        this.protocol = {
            id: protocolId
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

    delete() {
        this.deleted = true;
    }

    isDeleted() {
        return this.deleted;
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
     * Outputs an LLM prompt-ready string representation.
     *
     * @param {Object} [options]
     * @param {boolean} [options.includeProtocol=false]
     * @param {boolean} [options.includeTimestamp=false]
     * @returns {string|null}
     */
    toString({
        includeProtocol = false,
        includeTimestamp = false
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

        return `${timeStr}${idPrefix}${senderName} (${emotionName}): ${this.text}`.trim();
    }

    /**
     * Serializes parameters to JSON.
     *
     * @returns {{
     *   id: string,
     *   senderId: string|null,
     *   protocolId: string|null,
     *   text: string,
     *   emotion: {name: string, emoji: string, intensity: number},
     *   deleted: boolean,
     *   sentAt: string|null
     * }}
     */
    toJSON() {
        return {
            id: this.id,
            senderId: this.sender?.id ?? null,
            protocolId: this.protocol.id,
            text: this.text,
            emotion: { ...this.emotion },
            deleted: this.deleted,
            sentAt: this.sentAt?.toISOString() ?? null
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
        if (typeof obj.text !== "string") {
            return false;
        }
        if (!Message.#validEmotion(obj.emotion)) {
            return false;
        }
        return true;
    }
}