// @ts-check

/**
 * Parses expiration timestamps supporting minutes ('15m'), hours ('2h'),
 * days ('7d'), weeks ('2w'), and permanent ('forever').
 *
 * Extracted from ConversationManager to enable reuse and testing.
 */
export default class MemoryExpiryParser {

    /**
     * Supported time unit multipliers.
     * @static
     * @type {Record<string, number>}
     */
    static UNITS = {
        "m": 60 * 1000,
        "h": 3600 * 1000,
        "d": 24 * 3600 * 1000,
        "w": 7 * 24 * 3600 * 1000
    };

    /**
     * Parses a raw expiry value into a Date, null, or -1 (forever).
     *
     * Malformed values fall back to a safe +24h Date — they must NEVER be
     * coerced into `-1` (permanent).
     *
     * @param {string|Date|null|-1} rawExpiry Raw expiry from protocol or storage.
     * @returns {Date|null|-1} Parsed expiry: Date for relative/absolute, null for unset, -1 for permanent.
     */
    static parse(rawExpiry) {
        if (rawExpiry === null || rawExpiry === "null" || rawExpiry === "notset") return null;
        if (rawExpiry === -1 || rawExpiry === "-1" || rawExpiry === "forever") return -1;
        if (rawExpiry instanceof Date) return rawExpiry;

        const str = String(rawExpiry).trim().toLowerCase();
        const now = Date.now();

        // Try relative format: "15m", "2h", "7d", "2w"
        const relMatch = str.match(/^(\d+)\s*(m|h|d|w)$/);
        if (relMatch) {
            const count = Number(relMatch[1]);
            const unit = relMatch[2];
            const multiplier = MemoryExpiryParser.UNITS[unit];

            if (multiplier) {
                return new Date(now + (count * multiplier));
            }
        }

        // Absolute ISO/absolute date.
        const parsedDate = new Date(str);
        if (!Number.isNaN(parsedDate.getTime())) return parsedDate;

        // DANGEROUS FALLBACK: NEVER return -1 (permanent) for garbage input.
        // A malformed expiry must not silently become an immortal memory —
        // degrade to a safe 24-hour TTL instead.
        return new Date(now + 24 * 3600 * 1000);
    }
}
