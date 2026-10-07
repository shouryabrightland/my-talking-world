// @ts-check

/**
 * @file Chat.js
 * Chat room orchestrator managing active participants, conversation messages,
 * database synchronizations, and lifecycle events.
 *
 * Responsibilities:
 * - Maintains an in-memory message array and message/protocol ID lookup maps.
 * - Synchronizes messages to IndexedDB via MessageStore.
 * - Manages participant registration and lifecycle.
 * - Handles message trimming to prevent memory bloat (>1000 messages).
 * - Repairs reply reference links using protocol IDs.
 */

/** @typedef {import("./lib/Logger").default} Logger */
/** @typedef {import("./ChatMember").default} ChatMember */

import EventManager from "./EventManager";
import MessageStore from "./lib/MessageStore";
import Message from "./Message";

export const ChatEvents = {
    MEMBER_ADD: "chat:member:add",
    MEMBER_REMOVE: "chat:member:remove",
    MEMBER_UPDATE: "chat:member:update",
    MESSAGE_ADD: "chat:message:add",
    MESSAGE_REMOVE: "chat:message:remove",
    MESSAGE_UPDATE: "chat:message:update",
    REACTION_ADD: "chat:reaction:add",
    REACTION_REMOVE: "chat:reaction:remove",
    REACTION_UPDATE: "chat:reaction:update",
    CLEAR: "chat:clear"
};

/**
 * Orchestrator managing active participants, conversation lists, 
 * database synchronizations, and lifecycle events.
 */
export default class Chat {
    /**
     * @param {Logger} logger Root logging context.
     */
    constructor(logger) {
        if (!logger) throw new TypeError("Chat requires a Logger instance.");

        /** @readonly @type {Logger} */
        this.logger = logger.child("Chat");

        /** @readonly @type {EventManager} */
        this.events = new EventManager(this.logger);

        /** 
         * Active participants.
         * @type {Map<string, ChatMember>} 
         */
        this.members = new Map();

        /** 
         * Conversation messages array.
         * @type {Message[]} 
         */
        this.messages = [];

        /** 
         * Message map used for sub-second, constant-time ID lookups.
         * @type {Map<string, Message>} 
         */
        this.messageMap = new Map();

        /** 
         * Protocol ID index map used to resolve relative protocol reply parameters.
         * @type {Map<string, string>} 
         */
        this.protocolMessageMap = new Map();

        /** @readonly @type {MessageStore} */
        this.messageStore = new MessageStore(this.logger);        /** @type {boolean} */ this.initialized = false;

        /** @type {boolean} */ this.destroyed = false;

        /**
         * Session-level pause flag (logout). Members and messages stay intact.
         * @type {boolean}
         */
        this.paused = false;
    }

    /**
     * Initializes the chatroom, restoring verified message histories from the database.
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (this.destroyed) {
            throw new Error("Initialization rejected: Cannot boot a destroyed Chat room context.");
        }

        if (this.initialized) {
            this.logger.warn("init() ignored: Chat is already initialized.");
            return;
        }

        this.logger.info("Initializing Chat room database states...");

        try {
            // Retrieve and validate historical message collections
            const messages = await this.messageStore.load(
                id => this.members.get(id)
            );

            for (const message of messages) {
                if (!this.messageMap.has(message.id)) {
                    this.messages.push(message);
                    this.#addMaps(message);
                    this.#repairMessage(message);
                }
            }

            if (messages.length > 0) {
                this.events.emit(
                    ChatEvents.MESSAGE_ADD,
                    ...messages
                );
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to cleanly restore chat message history:", error);
        }

        // Initialize and bind all registered participants
        for (const member of this.members.values()) {
            try {
                member.connect(this);
                await member.init();
            } catch (/** @type {unknown} */ error) {
                this.logger.error(`Failed to initialize participant: ${member.id}`, error);
            }
        }

        this.initialized = true;
        this.paused = false;
        this.logger.info("Chat room initialization completed.");
    }

    /**
     * Non-destructive session pause (logout / backgrounding).
     * Keeps `members`, `messages` and every lookup map fully intact so a later
     * resume() continues the SAME room context. Contrast with destroy(), which
     * is reserved for permanent unmounting only.
     *
     * @returns {boolean} False when the room was already permanently destroyed.
     */
    pause() {
        if (this.destroyed) return false;
        this.paused = true;
        this.logger.info("Chat room paused for session logout — members and history preserved.");
        return true;
    }

    /**
     * Resumes a paused room context. No-op for destroyed rooms.
     *
     * @returns {boolean} False when the room was already permanently destroyed.
     */
    resume() {
        if (this.destroyed) return false;
        if (this.paused) {
            this.paused = false;
            this.logger.info("Chat room resumed.");
        }
        return true;
    }

    /**
     * Adds an active participant.
     *
     * @param {ChatMember} member
     * @returns {boolean}
     */
    addMember(member) {
        if (this.destroyed) {
            throw new Error("Operation rejected: Cannot add member to a destroyed Chat room.");
        }

        if (!member || typeof member.id !== "string" || !member.id) {
            throw new TypeError("Operation rejected: Invalid ChatMember structure.");
        }

        if (this.members.has(member.id)) {
            this.logger.warn(`Participant ID "${member.id}" already exists. Add aborted.`);
            return false;
        }

        this.members.set(member.id, member);

        try {
            member.connect(this);
            if (this.initialized) {
                void member.init();
            }
        } catch (/** @type {unknown} */ error) {
            this.members.delete(member.id);
            this.logger.error(`Failed to bind participant "${member.id}":`, error);
            throw error;
        }

        this.logger.info(`Participant registered successfully: ${member.id}`);
        this.events.emit(ChatEvents.MEMBER_ADD, member);

        return true;
    }

    /**
     * Removes an active participant.
     *
     * @param {string} id Unique participant ID.
     * @returns {boolean}
     */
    removeMember(id) {
        const member = this.members.get(id);
        if (!member) {
            return false;
        }

        this.members.delete(id);

        try {
            void member.destroy();
        } catch (/** @type {unknown} */ error) {
            this.logger.error(`Error encountered destroying participant context "${id}":`, error);
        }

        this.events.emit(ChatEvents.MEMBER_REMOVE, member);
        this.logger.info(`Participant unregistered: ${id}`);

        return true;
    }

    /**
     * Recovers a member by ID.
     *
     * @param {string} id Unique participant ID.
     * @returns {ChatMember|undefined}
     */
    getMember(id) {
        return this.members.get(id);
    }

    /**
     * Returns copies of active participants.
     * @returns {ChatMember[]}
     */
    getMembers() {
        return [...this.members.values()];
    }

    /**
     * Adds a message immediately.
     * Enforces strict array-map bounds synchronization.
     *
     * @param {Message} message
     * @returns {boolean}
     */
    addMessage(message) {
        if (this.destroyed) {
            throw new Error("Operation rejected: Cannot add messages to a destroyed Chat room.");
        }

        if (!(message instanceof Message)) {
            this.logger.warn("Rejected message: Invalid Message instance types.");
            return false;
        }

        if (this.messageMap.has(message.id)) {
            this.logger.warn(`Rejected duplicate message ID addition: ${message.id}`);
            return false;
        }

        // Align reply links
        this.#repairMessage(message);

        if (!message.isSent()) {
            message.sent();
        }

        this.messages.push(message);
        this.#addMaps(message);

        // Prune database values of excess historical items to retain low query footprint
        const removed = this.#trimMessages();

        void this.#persistMessage(message, removed);

        this.events.emit(
            ChatEvents.MESSAGE_ADD,
            message
        );

        return true;
    }

    /**
     * Soft-deletes a message.
     *
     * @param {string} id Unique message ID.
     * @returns {boolean}
     */
    deleteMessage(id) {
        const message = this.messageMap.get(id);
        if (!message || message.isDeleted()) {
            return false;
        }

        message.delete();

        void this.messageStore
            .save(message)
            .catch(error =>
                this.logger.error("Failed to commit soft-delete transaction to database:", error)
            );

        this.events.emit(
            ChatEvents.MESSAGE_UPDATE,
            message
        );

        this.logger.info(`Message marked as soft-deleted: ${id}`);
        return true;
    }

    /**
     * Permanently purges a message from active arrays and storage.
     *
     * @param {string} id Unique message ID.
     * @returns {boolean}
     */
    removeMessage(id) {
        const message = this.messageMap.get(id);
        if (!message) {
            return false;
        }

        this.#removeMaps(message);

        const index = this.messages.indexOf(message);
        if (index !== -1) {
            this.messages.splice(index, 1);
        }

        void this.messageStore
            .remove(id)
            .catch(error =>
                this.logger.error("Failed to execute hard-delete from database table:", error)
            );

        this.events.emit(
            ChatEvents.MESSAGE_REMOVE,
            message
        );

        this.logger.info(`Message purged permanently: ${id}`);
        return true;
    }

    /**
     * Recovers a message by ID.
     *
     * @param {string} id Unique message ID.
     * @returns {Message|undefined}
     */
    getMessage(id) {
        return this.messageMap.get(id);
    }

    /**
     * Recovers a message by array offset index.
     *
     * @param {number} index Array offset.
     * @returns {Message|undefined}
     */
    getMessageAt(index) {
        if (!Number.isInteger(index)) {
            return undefined;
        }
        return this.messages[index];
    }

    /**
     * Returns copies of active messages.
     * @returns {readonly Message[]}
     */
    getMessages() {
        return [...this.messages];
    }

    /**
     * Resolves absolute message reference mapping using parsed protocol IDs.
     *
     * @param {string} protocolId String protocol index identifier.
     * @returns {Message|undefined}
     */
    getMessageByProtocolId(protocolId) {
        const id = this.protocolMessageMap.get(protocolId);
        return id ? this.messageMap.get(id) : undefined;
    }

    /**
     * Checks if message ID exists inside active maps.
     *
     * @param {Message} message Target Message instance.
     * @returns {boolean}
     */
    hasMessage(message) {
        return message instanceof Message && this.messageMap.has(message.id);
    }

    /**
     * Retrieves a chronological history slice of the newest messages.
     *
     * @param {number} [history=10] Target length of the historical slice.
     * @returns {Message[]}
     */
    getHistory(history = 10) {
        if (!Number.isFinite(history) || history <= 0) {
            return [];
        }

        const count = Math.floor(history);
        return this.messages.slice(
            Math.max(0, this.messages.length - count)
        );
    }

    /**
     * Wipes active arrays, tracking maps, and commits a clear transaction to the database.
     *
     * @returns {Promise<void>}
     */
    async clear() {
        if (this.destroyed) return;

        this.messages.length = 0;
        this.messageMap.clear();
        this.protocolMessageMap.clear();

        try {
            await this.messageStore.clear();
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to clear message store databases:", error);
            throw error;
        }

        this.events.emit(ChatEvents.CLEAR);
        this.logger.info("Chat messages flushed and storage structures synchronized successfully.");
    }

    /**
     * Permanently destroys active chat dependencies, releasing all participants
     * and wiping members + message history from RAM.
     *
     * RESERVED for final unmounting only — a session logout MUST call pause()
     * instead, otherwise re-login throws
     * "Cannot boot a destroyed Chat room context." and loses the room state.
     */
    destroy() {
        if (this.destroyed) return;

        this.destroyed = true;

        for (const member of this.members.values()) {
            try {
                void member.destroy();
            } catch (/** @type {unknown} */ error) {
                this.logger.error(`Failed to cleanly destroy participant "${member.id}":`, error);
            }
        }

        this.members.clear();
        this.messages.length = 0;
        this.messageMap.clear();
        this.protocolMessageMap.clear();

        this.events.clearAll();

        this.logger.info("Chat context destroyed.");
    }

    /**
     * Maps message objects to active ID indexes.
     *
     * @param {...Message} messages Message objects.
     */
    #addMaps(...messages) {
        for (const message of messages) {
            this.messageMap.set(message.id, message);

            const protocolId = message.protocol?.id;
            if (protocolId) {
                this.protocolMessageMap.set(protocolId, message.id);
            }
        }
    }

    /**
     * Removes message mapping references.
     *
     * @param {Message} message Message object.
     */
    #removeMaps(message) {
        this.messageMap.delete(message.id);

        const protocolId = message.protocol?.id;
        if (
            protocolId &&
            this.protocolMessageMap.get(protocolId) === message.id
        ) {
            this.protocolMessageMap.delete(protocolId);
        }
    }

    /**
     * Trims old records when boundaries are crossed to preserve performance.
     *
     * @returns {Message[]}
     */
    #trimMessages() {
        const excess = this.messages.length - 1000;
        if (excess <= 0) {
            return [];
        }

        const removed = this.messages.splice(0, excess);
        for (const message of removed) {
            this.#removeMaps(message);
        }

        return removed;
    }

    /**
     * Persists writes and removals to local database.
     *
     * @param {Message} message Target Message to commit.
     * @param {Message[]} removed Target array to purge from database.
     */
    async #persistMessage(message, removed) {
        try {
            await this.messageStore.save(message);
            for (const oldMessage of removed) {
                await this.messageStore.remove(oldMessage.id);
            }
        } catch (/** @type {unknown} */ error) {
            this.logger.error("Failed to synchronize active additions/removals with MessageStore database:", error);
        }
    }

    /**
     * Maps message reference pointers using parsed protocol reply properties.
     *
     * @param {Message} message Target Message to verify.
     */
    #repairMessage(message) {
        const replyId = message.protocol?.replyId;
        if (!replyId) {
            message.setReply(null);
            return;
        }

        const reply = this.getMessageByProtocolId(replyId);
        if (!reply) {
            message.setReply(null);
            this.logger.warn(`Message reply reference matching protocol ID "${replyId}" could not be resolved.`);
            return;
        }

        message.setReply(reply);
    }
}