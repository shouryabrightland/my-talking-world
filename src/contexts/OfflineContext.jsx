// @ts-check

/**
 * @file OfflineContext.jsx
 * Enhanced network status provider with:
 * - Real connectivity probes (not just navigator.onLine).
 * - Retry queue for operations that failed due to network.
 * - Connection quality tracking (good/degraded/offline).
 * - Auto-retry when connection is restored.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * @typedef {"good" | "degraded" | "offline"} ConnectionQuality
 */

/**
 * @typedef {Object} OfflineContextValue
 * @property {boolean} isOnline Whether the browser reports network connectivity.
 * @property {boolean} isOffline Convenience inverse of isOnline.
 * @property {boolean} wasOffline Whether the app was recently offline (for UI transitions).
 * @property {ConnectionQuality} quality Connection quality assessment.
 * @property {string} status Human-readable network status label.
 * @property {number} latencyMs Last measured round-trip latency in ms.
 * @property {(fn: () => Promise<void>, label?: string) => void} enqueueRetry Adds a failed operation to the retry queue.
 * @property {number} retryQueueSize Number of pending retry operations.
 * @property {() => void} flushRetries Manually trigger retry of all queued operations.
 */

/** @type {React.Context<OfflineContextValue|null>} */
const OfflineContext = createContext(/** @type {OfflineContextValue|null} */ (null));

/** URL used for connectivity probes (tiny, fast, always available) */
const PROBE_URL = "https://www.google.com/generate_204";

/** Probe timeout in ms */
const PROBE_TIMEOUT = 5000;

/** Polling interval for connectivity checks (ms) */
const POLL_INTERVAL = 15_000;

/**
 * Performs an actual network request to verify true connectivity.
 * navigator.onLine can be unreliable (e.g. connected to a captive portal).
 *
 * @returns {Promise<{ online: boolean, latencyMs: number }>}
 */
async function probeConnectivity() {
    const startTime = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

        const response = await fetch(PROBE_URL, {
            method: "HEAD",
            mode: "no-cors",
            cache: "no-store",
            signal: controller.signal
        });

        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;

        // Any response (even opaque) means we have connectivity
        return { online: true, latencyMs };
    } catch {
        return { online: false, latencyMs: 0 };
    }
}

/**
 * Provider tracking browser online/offline status with real connectivity probes.
 *
 * Features:
 * - Event-based detection (online/offline events).
 * - Periodic polling with actual fetch probes.
 * - Connection quality assessment based on latency.
 * - Retry queue for operations that failed due to network.
 * - Auto-retry flush when connection is restored.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @returns {React.JSX.Element}
 */
export function OfflineProvider({ children }) {
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isOnline, setIsOnline] = useState(() => {
        if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
            return navigator.onLine;
        }
        return true;
    });

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [wasOffline, setWasOffline] = useState(false);

    /** @type {[ConnectionQuality, React.Dispatch<React.SetStateAction<ConnectionQuality>>]} */
    const [quality, setQuality] = useState(/** @type {ConnectionQuality} */ ("good"));

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [latencyMs, setLatencyMs] = useState(0);

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [retryQueueSize, setRetryQueueSize] = useState(0);

    /** @type {React.MutableRefObject<Array<{ fn: () => Promise<void>, label: string }>>} */
    const retryQueueRef = useRef([]);

    /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
    const wasOfflineTimerRef = useRef(null);

    /** Track whether we're currently probing to avoid duplicate probes */
    /** @type {React.MutableRefObject<boolean>} */
    const probingRef = useRef(false);

    /**
     * Performs a connectivity probe and updates state.
     * @returns {Promise<void>}
     */
    const doProbe = useCallback(async () => {
        if (probingRef.current) return;
        probingRef.current = true;

        try {
            const result = await probeConnectivity();
            const prevOnline = isOnline;

            setIsOnline(result.online);
            setLatencyMs(result.latencyMs);

            // Assess connection quality based on latency
            if (!result.online) {
                setQuality("offline");
            } else if (result.latencyMs > 2000) {
                setQuality("degraded");
            } else {
                setQuality("good");
            }

            // Handle transition from offline → online
            if (!prevOnline && result.online) {
                setWasOffline(true);
                if (wasOfflineTimerRef.current) {
                    clearTimeout(wasOfflineTimerRef.current);
                }
                wasOfflineTimerRef.current = setTimeout(() => setWasOffline(false), 3000);

                // Auto-flush retry queue when coming back online
                flushRetriesRef.current?.();
            }

            // Handle transition from online → offline
            if (prevOnline && !result.online) {
                setWasOffline(false);
                if (wasOfflineTimerRef.current) {
                    clearTimeout(wasOfflineTimerRef.current);
                    wasOfflineTimerRef.current = null;
                }
            }
        } finally {
            probingRef.current = false;
        }
    }, [isOnline]);

    /** Ref to avoid stale closure in flushRetries */
    /** @type {React.MutableRefObject<(() => void) | null>} */
    const flushRetriesRef = useRef(null);

    /**
     * Flushes all queued retry operations.
     * Called automatically when connection is restored.
     */
    const flushRetries = useCallback(async () => {
        const queue = retryQueueRef.current;
        if (queue.length === 0) return;

        const operations = [...queue];
        retryQueueRef.current = [];
        setRetryQueueSize(0);

        for (const op of operations) {
            try {
                await op.fn();
            } catch (/** @type {unknown} */ err) {
                console.warn(`[OfflineContext] Retry failed for "${op.label}":`, err);
                // Re-queue failed operations
                retryQueueRef.current.push(op);
            }
        }

        // Update size after all operations
        setRetryQueueSize(retryQueueRef.current.length);
    }, []);

    // Store flushRetries in ref for the probe callback
    flushRetriesRef.current = flushRetries;

    /**
     * Enqueues a failed operation for automatic retry when back online.
     * @param {() => Promise<void>} fn The async operation to retry.
     * @param {string} [label="unnamed"] Human-readable label for debugging.
     */
    const enqueueRetry = useCallback((/** @type {() => Promise<void>} */ fn, label = "unnamed") => {
        retryQueueRef.current.push({ fn, label });
        setRetryQueueSize(retryQueueRef.current.length);
    }, []);

    useEffect(() => {
        /** Handle browser online/offline events */
        const handleOnline = () => doProbe();
        const handleOffline = () => {
            setIsOnline(false);
            setQuality("offline");
            setLatencyMs(0);
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        // Periodic connectivity polling
        const interval = setInterval(doProbe, POLL_INTERVAL);

        // Initial probe
        doProbe();

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            clearInterval(interval);
            if (wasOfflineTimerRef.current) {
                clearTimeout(wasOfflineTimerRef.current);
            }
        };
    }, [doProbe]);

    /** @type {OfflineContextValue} */
    const value = useMemo(() => ({
        isOnline,
        isOffline: !isOnline,
        wasOffline,
        quality,
        status: isOnline ? (quality === "degraded" ? "degraded" : "online") : "offline",
        latencyMs,
        enqueueRetry,
        retryQueueSize,
        flushRetries
    }), [isOnline, wasOffline, quality, latencyMs, enqueueRetry, retryQueueSize, flushRetries]);

    return (
        <OfflineContext.Provider value={value}>
            {children}
        </OfflineContext.Provider>
    );
}

/**
 * Hook to consume network status context.
 * @returns {OfflineContextValue}
 */
export function useOffline() {
    const context = useContext(OfflineContext);
    if (!context) {
        throw new Error("useOffline must be used within an OfflineProvider.");
    }
    return context;
}
