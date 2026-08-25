// @ts-check

/**
 * @file random.js
 * Random number utilities for simulation pacing.
 *
 * Responsibilities:
 * - Generates random integers within a specified range.
 * - Used for typing and reading delay calculations to create human-like pacing.
 */

/**
 * Generates a random floating-point number within a specified range [min, max).
 * Swap-defensive: Auto-detects and corrects values if minimum exceeds maximum boundaries [1].
 *
 * @param {number} min Left-hand numerical boundary.
 * @param {number} max Right-hand numerical boundary.
 * @returns {number}
 */
export function random(min, max) {
    // Coerce values to valid numbers defensively
    let numMin = Number.isFinite(min) ? min : 0;
    let numMax = Number.isFinite(max) ? max : 0;

    // Swap parameters if they are accidentally passed in reversed order [1]
    if (numMin > numMax) {
        const temp = numMin;
        numMin = numMax;
        numMax = temp;
    }

    return Math.random() * (numMax - numMin) + numMin;
}