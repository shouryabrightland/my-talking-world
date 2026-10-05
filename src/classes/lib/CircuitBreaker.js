// @ts-check

/**
 * Circuit Breaker states.
 * @readonly
 * @enum {string}
 */
export const CircuitState = {
    CLOSED: "closed",
    OPEN: "open",
    HALF_OPEN: "half_open"
};

/**
 * Circuit Breaker protecting API calls from cascading failures.
 *
 * States:
 * - CLOSED: Normal operation. Failures increment the counter.
 * - OPEN: Too many failures. All calls are rejected immediately for `resetTimeoutMs`.
 * - HALF_OPEN: After timeout, one test call is allowed through. If it succeeds → CLOSED, if fails → OPEN.
 *
 * @example
 * const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30000 });
 * const result = await cb.execute(() => fetchFromAPI());
 */
export default class CircuitBreaker {

    /**
     * @param {Object} options
     * @param {number} [options.failureThreshold=5] Failures before circuit opens.
     * @param {number} [options.resetTimeoutMs=30000] Ms to wait before trying again.
     * @param {number} [options.successThreshold=2] Consecutive successes in HALF_OPEN to close.
     * @param {((newState: string, oldState: string) => void)|null} [options.onStateChange] Callback when state changes.
     */
    constructor({
        failureThreshold = 5,
        resetTimeoutMs = 30_000,
        successThreshold = 2,
        onStateChange = null
    } = {}) {
        /** @readonly @type {number} */ this.failureThreshold = failureThreshold;
        /** @readonly @type {number} */ this.resetTimeoutMs = resetTimeoutMs;
        /** @readonly @type {number} */ this.successThreshold = successThreshold;

        /** @private @type {((newState: string, oldState: string) => void)|null} */ this._onStateChange = onStateChange;

        /** @type {string} */ this._state = CircuitState.CLOSED;
        /** @type {number} */ this._failureCount = 0;
        /** @type {number} */ this._successCount = 0;
        /** @type {number} */ this._lastFailureTime = 0;
        /** @type {string|null} */ this._lastError = null;
    }

    /** @returns {string} */
    get state() {
        // Auto-transition OPEN → HALF_OPEN if reset timeout has elapsed
        if (this._state === CircuitState.OPEN) {
            const elapsed = Date.now() - this._lastFailureTime;
            if (elapsed >= this.resetTimeoutMs) {
                this._setState(CircuitState.HALF_OPEN);
            }
        }
        return this._state;
    }

    /** @returns {number} */
    get failureCount() {
        return this._failureCount;
    }

    /** @returns {string|null} */
    get lastError() {
        return this._lastError;
    }

    /**
     * Executes an operation through the circuit breaker.
     *
     * @template T
     * @param {() => Promise<T>} operation Async operation to execute.
     * @returns {Promise<T>}
     */
    async execute(operation) {
        const currentState = this.state;

        if (currentState === CircuitState.OPEN) {
            const error = new Error(
                `Circuit breaker is OPEN. Retry after ${Math.round((this.resetTimeoutMs - (Date.now() - this._lastFailureTime)) / 1000)}s.`
            );
            error.code = "CIRCUIT_OPEN";
            error.lastError = this._lastError;
            throw error;
        }

        try {
            const result = await operation();
            this._onSuccess();
            return result;
        } catch (/** @type {unknown} */ err) {
            // User-initiated cancellations are NOT failures — re-throw without
            // touching the failure counter so AbortError can never trip the breaker OPEN.
            if (err instanceof DOMException && err.name === "AbortError") {
                throw err;
            }
            this._onFailure(err);
            throw err;
        }
    }

    /**
     * Records a successful call.
     * @returns {void}
     */
    _onSuccess() {
        this._lastError = null;

        if (this._state === CircuitState.HALF_OPEN) {
            this._successCount++;
            if (this._successCount >= this.successThreshold) {
                this._failureCount = 0;
                this._successCount = 0;
                this._setState(CircuitState.CLOSED);
            }
        } else {
            // CLOSED → reset failure count on success
            this._failureCount = 0;
        }
    }

    /**
     * Records a failed call.
     * @param {any} err The error that occurred.
     * @returns {void}
     */
    _onFailure(err) {
        this._failureCount++;
        this._successCount = 0;
        this._lastFailureTime = Date.now();
        this._lastError = err instanceof Error ? err.message : String(err);

        if (this._state === CircuitState.HALF_OPEN) {
            // Failed during half-open → re-open
            this._setState(CircuitState.OPEN);
        } else if (this._failureCount >= this.failureThreshold) {
            this._setState(CircuitState.OPEN);
        }
    }

    /**
     * Transitions state and fires the change callback.
     * @param {string} newState
     * @returns {void}
     */
    _setState(newState) {
        const oldState = this._state;
        if (oldState === newState) return;

        this._state = newState;

        if (this._onStateChange) {
            try {
                this._onStateChange(newState, oldState);
            } catch {
                // Don't let callback errors break the circuit
            }
        }
    }

    /**
     * Manually resets the circuit breaker to CLOSED.
     * @returns {void}
     */
    reset() {
        this._failureCount = 0;
        this._successCount = 0;
        this._lastFailureTime = 0;
        this._lastError = null;
        this._setState(CircuitState.CLOSED);
    }

    /**
     * Returns a diagnostic snapshot.
     * @returns {{ state: string, failureCount: number, lastError: string|null, lastFailureTime: number }}
     */
    snapshot() {
        return {
            state: this.state,
            failureCount: this._failureCount,
            lastError: this._lastError,
            lastFailureTime: this._lastFailureTime
        };
    }
}
