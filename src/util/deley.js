// @ts-check

/**
 * @file deley.js
 * Promise-based delay utility.
 *
 * Provides a simple async sleep function for pacing and scheduling operations.
 */

/**
 * Resolves a Promise after a specified time interval.
 * Features safe parameter-swapping boundaries to prevent infinite stalls on negative values.
 *
 * @param {number} ms Millisecond delay duration.
 * @returns {Promise<void>}
 */
export default function delay(ms) {
    // Defensively coerce to absolute, positive numbers to prevent negative parameter crashes
    const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);

    return new Promise(resolve => {
        setTimeout(resolve, safeMs);
    });
}