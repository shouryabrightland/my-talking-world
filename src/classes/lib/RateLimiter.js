// @ts-check

/**
 * Shared Rate Limiter enforcing rolling-window caps, minimum request spacing,
 * and concurrent request limits. Thread-safe via async mutex.
 */
export default class RateLimiter {

    /**
     * @param {Object} options
     * @param {number} [options.maxPerMinute=10] Max requests in a 60-second window.
     * @param {number} [options.minSpacingMs=2500] Minimum ms between consecutive requests.
     * @param {number} [options.maxConcurrent=3] Maximum concurrent in-flight requests.
     */
    constructor({
        maxPerMinute = 10,
        minSpacingMs = 2500,
        maxConcurrent = 3
    } = {}) {
        /** @readonly @type {number} */ this.maxPerMinute = maxPerMinute;
        /** @readonly @type {number} */ this.minSpacingMs = minSpacingMs;
        /** @readonly @type {number} */ this.maxConcurrent = maxConcurrent;

        /** @private @type {number[]} */ this._timestamps = [];
        /** @private @type {number} */ this._inflight = 0;
        /** @private @type {Promise<void>} */ this._mutex = Promise.resolve();

        /**
         * Absolute ms timestamp until which the SERVER says no requests may be
         * sent (derived from real x-ratelimit-reset-* / retry-after headers).
         * @private @type {number}
         */
        this._serverPauseUntil = 0;
    }

    /**
     * Applies a REAL rate-limit window reported by the provider so acquire()
     * pauses for the exact server-specified duration instead of blindly
     * guessing cooldowns.
     *
     * @param {number} untilMs Absolute epoch-ms timestamp when the window resets.
     * @returns {void}
     */
    syncServerLimit(untilMs) {
        if (Number.isFinite(untilMs) && untilMs > this._serverPauseUntil) {
            this._serverPauseUntil = untilMs;
        }
    }

    /**
     * Ms remaining until the provider's real rate-limit window resets.
     * 0 when no server-imposed pause is active — lets the UI surface an
     * "exhausted rate limit" countdown instead of appearing frozen.
     *
     * @returns {number}
     */
    get serverPauseRemaining() {
        return Math.max(0, this._serverPauseUntil - Date.now());
    }

    /**
     * Waits until a rate limit slot is available, then returns a release function.
     * Call the release function when the request completes to decrement the concurrent counter.
     *
     * @param {function} [logger] Optional logger function (e.g. logger.warn).
     * @returns {Promise<() => void>} Release function to call when request finishes.
     */
    async acquire(logger) {
        return new Promise((resolve, reject) => {
            this._mutex = this._mutex.then(async () => {
                try {
                    // 0. Honor the provider's real rate-limit reset window
                    while (this._serverPauseUntil > Date.now()) {
                        const remaining = this._serverPauseUntil - Date.now();
                        if (logger) {
                            logger(`Server rate-limit window active. Waiting ${Math.round(remaining / 100) / 10}s for exact reset...`);
                        }
                        await sleep(Math.min(1_000, remaining));
                    }

                    // 1. Wait if at max concurrent
                    while (this._inflight >= this.maxConcurrent) {
                        await sleep(100);
                    }

                    let now = Date.now();

                    // 2. Prune timestamps older than 60s
                    this._timestamps = this._timestamps.filter(
                        ts => (now - ts) < 60_000
                    );

                    // 3. Wait if rolling window is full
                    if (this._timestamps.length >= this.maxPerMinute) {
                        const oldest = this._timestamps[0] || now;
                        const waitTime = 60_000 - (now - oldest);

                        if (waitTime > 0) {
                            if (logger) {
                                logger(`Rate limit reached (${this.maxPerMinute}/min). Waiting ${Math.round(waitTime / 1000)}s...`);
                            }
                            await sleep(waitTime);
                            now = Date.now();
                            this._timestamps = this._timestamps.filter(
                                ts => (now - ts) < 60_000
                            );
                        }
                    }

                    // 4. Enforce minimum spacing
                    const lastTimestamp = this._timestamps[this._timestamps.length - 1] || 0;
                    const spacingDelta = now - lastTimestamp;

                    if (spacingDelta < this.minSpacingMs) {
                        const spacingWait = this.minSpacingMs - spacingDelta;
                        await sleep(spacingWait);
                        now = Date.now();
                    }

                    // 5. Record timestamp and increment concurrent
                    this._timestamps.push(now);
                    this._inflight++;

                    let released = false;
                    const release = () => {
                        if (released) return;
                        released = true;
                        this._inflight = Math.max(0, this._inflight - 1);
                    };

                    resolve(release);
                } catch (/** @type {unknown} */ err) {
                    reject(err);
                }
            }).catch(reject);
        });
    }
}

/**
 * Promise-based sleep helper.
 * @param {number} ms Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
