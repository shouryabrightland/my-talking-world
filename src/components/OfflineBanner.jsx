// @ts-check

/**
 * @file OfflineBanner.jsx
 * Rich offline/reconnect banner displayed at the top of the screen.
 *
 * Features:
 * - Shows offline status with pulsing indicator.
 * - Reconnect button that triggers a connectivity probe.
 * - Retry queue size indicator when operations are pending.
 * - Connection quality display (good/degraded/offline).
 * - Smooth transition animations.
 */

import React, { useCallback, useState } from "react";
import { useOffline } from "../contexts/OfflineContext";

/**
 * In-flow banner: sits above the header in the document flow so it pushes the
 * header down instead of obscuring its buttons.
 * @type {React.CSSProperties}
 */
const bannerBase = {
    position: "relative",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "8px 16px",
    paddingTop: "max(8px, env(safe-area-inset-top))",
    fontSize: "12px",
    fontWeight: "700",
    textAlign: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    lineHeight: "1.3",
    transition: "all 0.3s ease"
};

/** Color schemes for different connection states */
const THEMES = {
    offline: { bg: "#f59e0b", color: "#1a1a1a" },
    degraded: { bg: "#fb923c", color: "#1a1a1a" },
    reconnecting: { bg: "#3b82f6", color: "#ffffff" }
};

/**
 * Offline Banner Component.
 * Displays connection status, retry queue info, and reconnect action.
 *
 * @returns {React.JSX.Element|null}
 */
export default function OfflineBanner() {
    const { isOffline, quality, retryQueueSize, flushRetries, latencyMs } = useOffline();

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isReconnecting, setIsReconnecting] = useState(false);

    /**
     * Triggers a manual connectivity probe and flushes retry queue.
     */
    const handleReconnect = useCallback(async () => {
        setIsReconnecting(true);
        try {
            flushRetries();
        } finally {
            // Keep "reconnecting" state for a moment for visual feedback
            setTimeout(() => setIsReconnecting(false), 1500);
        }
    }, [flushRetries]);

    // Don't show banner if online and quality is good
    if (!isOffline && quality === "good" && !isReconnecting) return null;

    const theme = isReconnecting ? THEMES.reconnecting : (quality === "degraded" ? THEMES.degraded : THEMES.offline);

    const statusText = isReconnecting
        ? "Reconnecting..."
        : quality === "degraded"
            ? `Weak signal (${latencyMs}ms)`
            : "You're offline";

    const featureText = "AI responses disabled. You can view cached chats and send local messages.";

    return (
        <div
            style={{ ...bannerBase, backgroundColor: theme.bg, color: theme.color }}
            role="alert"
            aria-live="polite"
        >
            {/* Pulsing dot */}
            <span style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: theme.color,
                opacity: 0.6,
                flexShrink: 0,
                animation: isReconnecting ? "none" : "pulse 2s ease-in-out infinite"
            }} />

            {/* Status icon */}
            <span style={{ fontSize: "14px", flexShrink: 0 }}>
                {isReconnecting ? "🔄" : quality === "degraded" ? "📶" : "📡"}
            </span>

            {/* Status text */}
            <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{statusText}</strong>
                {" — "}
                <span style={{ opacity: 0.8 }}>{featureText}</span>
            </span>

            {/* Retry queue badge */}
            {retryQueueSize > 0 && (
                <span style={{
                    padding: "2px 6px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(0,0,0,0.15)",
                    fontSize: "10px",
                    fontWeight: "800",
                    flexShrink: 0
                }}>
                    {retryQueueSize} pending
                </span>
            )}

            {/* Reconnect button */}
            <button
                onClick={handleReconnect}
                disabled={isReconnecting}
                style={{
                    padding: "4px 10px",
                    borderRadius: "8px",
                    border: `1px solid ${theme.color}40`,
                    backgroundColor: `${theme.color}20`,
                    color: theme.color,
                    fontSize: "11px",
                    fontWeight: "800",
                    cursor: isReconnecting ? "wait" : "pointer",
                    flexShrink: 0,
                    opacity: isReconnecting ? 0.7 : 1
                }}
            >
                {isReconnecting ? "Checking..." : "Reconnect"}
            </button>
        </div>
    );
}
