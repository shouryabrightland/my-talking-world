// @ts-check

/**
 * @typedef {import("./Logger").default} Logger
 * @typedef {import("../ChatMember").default} ChatMember
 * @typedef {import("./ChatMemberScheduler").default} ChatMemberScheduler
 */

import { ChatMemberEvents } from "../ChatMember";

/**
 * Handles human user interruption logic: cancels AI queues,
 * debounces rapid messages, and waits for typing to settle
 * before requesting a character response.
 *
 * Extracted from ConversationManager for testability and reuse.
 */
export default class UserInterruptHandler {

    /** @type {ReturnType<typeof setTimeout>|null} */ #debounceTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */ #fallbackTimer = null;
    /** @type {Function|null} */ #unsubTyping = null;
    /** @type {boolean} */ #active = false;

    /**
     * @param {Object} options
     * @param {Logger} options.logger
     */
    constructor({ logger }) {
        /** @readonly @type {Logger} */ this.logger = logger.child("UserInterrupt");
    }

    /**
     * Handles user interruption by canceling AI queues and scheduling a debounced turn request.
     *
     * @param {Object} params
     * @param {ChatMember} params.user The human user.
     * @param {ChatMember[]} params.aiMembers All AI participants.
     * @param {{abort: () => void}|null} params.aiAbortController Controller to abort AI requests.
     * @param {function} params.onRequestTurn Callback to request a new dialogue turn.
     * @param {function} params.onCancelQueues Callback to cancel all AI member schedulers and reset typing states.
     */
    handle({ user, aiMembers, aiAbortController, onRequestTurn, onCancelQueues }) {
        this.logger.info("Human input detected. Pausing AI queues and requesting direct response...");
        this.#active = true;

        // Abort any in-flight AI requests
        if (aiAbortController && typeof aiAbortController.abort === "function") {
            aiAbortController.abort();
        }

        // Cancel AI member queues and reset typing states
        onCancelQueues();

        // Clear any existing debounce timers
        this.#clearTimers();

        /** @param {number} [delayMs=750] */
        const triggerPrompt = (delayMs = 750) => {
            this.#debounceTimer = setTimeout(() => {
                this.#clearTimers();
                this.#active = false;
                this.logger.info("Human pause settled. Requesting direct character reply...");
                onRequestTurn();
            }, delayMs);
        };

        if (user.isTyping) {
            // Wait for user to finish typing, with a fallback timeout
            this.#unsubTyping = user.events.on(
                ChatMemberEvents.TYPING,
                /** @param {boolean} isTyping */
                (isTyping) => {
                    if (!isTyping) {
                        if (this.#unsubTyping) {
                            this.#unsubTyping();
                            this.#unsubTyping = null;
                        }
                        triggerPrompt(500);
                    }
                },
                "UserInterrupt: wait for typing pause"
            );

            this.#fallbackTimer = setTimeout(() => {
                this.#clearTimers();
                this.#active = false;
                onRequestTurn();
            }, 3000);
        } else {
            triggerPrompt(750);
        }
    }

    /**
     * Whether an interruption is currently being processed.
     * @returns {boolean}
     */
    get isActive() {
        return this.#active;
    }

    /**
     * Clears all pending debounce and fallback timers.
     * @returns {void}
     */
    #clearTimers() {
        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }
        if (this.#fallbackTimer) {
            clearTimeout(this.#fallbackTimer);
            this.#fallbackTimer = null;
        }
        if (this.#unsubTyping) {
            this.#unsubTyping();
            this.#unsubTyping = null;
        }
    }

    /**
     * Destroys the handler, clearing all timers and state.
     * @returns {void}
     */
    destroy() {
        this.#clearTimers();
        this.#active = false;
    }
}
