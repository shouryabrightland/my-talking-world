// @ts-check

/**
 * @typedef {import("./Logger").default} Logger
 * @typedef {import("../ChatMember").default} ChatMember
 * @typedef {import("./ChatMemberScheduler").default} ChatMemberScheduler
 */

import { ChatMemberEvents } from "../ChatMember";

/**
 * Handles human user interruption logic: cancels AI queues,
 * bypasses the artificial debounce for explicit submissions, and waits for an
 * in-progress typing pause to settle before requesting a character response.
 *
 * Turn trigger contract:
 * - Explicit submit (`isExplicitSubmit: true`, i.e. Send / Enter) with the user
 *   NOT typing → `onRequestTurn()` is invoked synchronously (no 750ms debounce,
 *   no 3000ms stall).
 * - Any submit while the user keeps typing a follow-up → the turn is deferred
 *   until the 800ms typing cadence settles (TYPING → false), with a 3000ms
 *   safety net so the engine is never stranded.
 * - Non-explicit triggers with the user idle keep the legacy settle debounce.
 *
 * Extracted from ConversationManager for testability and reuse.
 */
export default class UserInterruptHandler {

    /** @type {ReturnType<typeof setTimeout>|null} */ #fallbackTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */ #debounceTimer = null;
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
     * Handles user interruption by canceling AI queues and triggering a turn
     * as fast as possible — immediately for settled submissions, or after the
     * typing cadence settles when the user is mid-sentence.
     *
     * @param {Object} params
     * @param {ChatMember} params.user The human user.
     * @param {ChatMember[]} params.aiMembers All AI participants.
     * @param {{abort: () => void}|null} params.aiAbortController Controller to abort AI requests.
     * @param {function} params.onRequestTurn Callback to request a new dialogue turn.
     * @param {function} params.onCancelQueues Callback to cancel all AI member schedulers and reset typing states.
     * @param {boolean} [params.isExplicitSubmit=false] True when the user explicitly clicked Send / pressed Enter.
     */
    handle({ user, aiMembers, aiAbortController, onRequestTurn, onCancelQueues, isExplicitSubmit = false }) {
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

        if (user.isTyping) {
            // The user submitted and is already typing the follow-up sentence:
            // defer the turn until the typing cadence settles (TYPING → false).
            this.logger.info("User kept typing after submit — deferring turn until the typing pause settles...");

            this.#unsubTyping = user.events.on(
                ChatMemberEvents.TYPING,
                /** @param {boolean} isTyping */
                (isTyping) => {
                    if (!isTyping) {
                        this.#fireNow(onRequestTurn, "Typing settled. Requesting direct character reply...");
                    }
                },
                "UserInterrupt: wait for typing pause"
            );

            // Safety net: never strand the engine if typing never settles.
            this.#fallbackTimer = setTimeout(() => {
                this.#fireNow(onRequestTurn, "Typing settle timed out — requesting reply anyway...");
            }, 3000);
        } else if (isExplicitSubmit) {
            // Explicit Send/Enter with the user idle → NO artificial delay.
            this.#fireNow(onRequestTurn, "Explicit submission settled. Requesting direct character reply...");
        } else {
            // Non-explicit triggers keep the legacy settle debounce.
            this.#debounceTimer = setTimeout(() => {
                this.#fireNow(onRequestTurn, "Human pause settled. Requesting direct character reply...");
            }, 750);
        }
    }

    /**
     * Fires the turn callback immediately and tears down all timers/listeners.
     * @param {function} onRequestTurn
     * @param {string} logMessage
     * @returns {void}
     */
    #fireNow(onRequestTurn, logMessage) {
        this.#clearTimers();
        this.#active = false;
        this.logger.info(logMessage);
        onRequestTurn();
    }

    /**
     * Whether an interruption is currently being processed.
     * @returns {boolean}
     */
    get isActive() {
        return this.#active;
    }

    /**
     * Clears all pending settle/fallback timers and typing subscriptions.
     * @returns {void}
     */
    #clearTimers() {
        if (this.#fallbackTimer) {
            clearTimeout(this.#fallbackTimer);
            this.#fallbackTimer = null;
        }
        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
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
