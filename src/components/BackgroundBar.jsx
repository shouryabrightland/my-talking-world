// @ts-check

/**
 * @file BackgroundBar.jsx
 * Persistent notification bar for background processes.
 *
 * Displays below DevToolsBar (if on) or SceneBar.
 * Shows active streams, errors, disconnect messages.
 * Clicking opens a detail modal. Retry button for actionable errors.
 *
 * Stream lifecycle:
 *   START  → addNotification("stream", ...)
 *   TEXT   → updateNotification(phase: ...)
 *   DONE   → updateNotification(status: "completed") + clear stream ID
 *   ERROR  → updateNotification(status: "error") + clear stream ID
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import styles from "./BackgroundBar.module.css";
import { useBackgroundBar } from "../contexts/BackgroundBarContext";
import { useChat } from "../contexts/ChatContext";
import { PlannerStreamEvents } from "../classes/WorldSetter";
import { ConversationEvents } from "../classes/ConversationManager";

/**
 * Human-readable reason for a Gemini model failover.
 * @param {number|null} status HTTP status (null = timeout/network).
 * @param {string} reason Raw reason from the planner.
 * @returns {string}
 */
function failoverReason(status, reason) {
    if (status === 429) return "Rate limited";
    if (status === 503) return "Model busy";
    if (status === 404) return "Deprecated";
    return reason || "Unavailable";
}

/**
 * Formats a timestamp to a short time string.
 * @param {number} ts Unix epoch ms.
 * @returns {string}
 */
function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
}

/**
 * Formats a timestamp to relative time.
 * @param {number} ts Unix epoch ms.
 * @returns {string}
 */
function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Icon for notification type.
 * @param {{ type: string }} props
 * @returns {React.JSX.Element}
 */
function NotificationIcon({ type }) {
    const icons = /** @type {Record<string, string>} */ ({
        stream: "⚡",
        error: "❌",
        disconnect: "📡",
        info: "ℹ️",
    });
    return <span className={styles.notifIcon}>{icons[type] || "📌"}</span>;
}

/**
 * Persistent notification bar for background processes.
 * Returns null when there are no active notifications or all have completed.
 * @returns {React.JSX.Element|null}
 */
export default function BackgroundBar() {
    const ctx = useBackgroundBar();
    const {
        notifications,
        removeNotification,
        retryNotification,
        setSelectedNotification,
        clearCompleted,
    } = ctx;
    const conv = useChat();
    const { world } = conv;
    // ConversationManager exposes the EventManager; some test harnesses mount
    // a reduced context, so probe before subscribing.
    const conversationEvents = conv && conv.events ? conv.events : null;

    // Stable ref to avoid re-subscribing event listeners when ctx changes
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;

    // ── Planner Stream Event Lifecycle ──────────────────────────────────
    useEffect(() => {
        if (!world) return;

        /**
         * Track the active stream notification ID + resolved Gemini model.
         * Uses refs (not state) to avoid re-renders and stale closures
         * in event handlers.
         * @type {{ current: { id: string, model: string } | null }}
         */
        const activeStreamRef = { current: null };

        const offStart = world.events.on(
            PlannerStreamEvents.START,
            (/** @type {{ model?: string }} */ payload) => {
                // Clear any stale previous stream ID
                activeStreamRef.current = null;
                const model = payload?.model || "gemini";
                const id = ctxRef.current.addNotification(
                    "stream",
                    "Generating schedule...",
                    { dismissable: false }
                );
                ctxRef.current.updateNotification(id, {
                    phase: `[${model}] Thinking & structuring scene...`,
                });
                activeStreamRef.current = { id, model };
            },
            "BackgroundBar: stream start"
        );

        const offText = world.events.on(
            PlannerStreamEvents.TEXT,
            (/** @type {string} */ text) => {
                const active = activeStreamRef.current;
                if (!active) return;
                const hasSchedule = text.includes("<schedule");
                const blockCount = (
                    text.match(/<\s*block\b/gi) || []
                ).length;
                let phase = `[${active.model}] Thinking & structuring scene...`;
                if (hasSchedule && blockCount > 0)
                    phase = `[${active.model}] Generating block ${blockCount} of ${Math.max(blockCount, 3)}...`;
                else if (hasSchedule) phase = `[${active.model}] Parsing schedule...`;
                ctxRef.current.updateNotification(active.id, { phase });
            },
            "BackgroundBar: stream text"
        );

        const offFailover = world.events.on(
            PlannerStreamEvents.FAILOVER,
            (/** @type {{ fromModel: string, toModel: string|null, status: number|null, reason?: string }} */ data) => {
                const active = activeStreamRef.current;
                const from = data?.fromModel || "?";
                const to = data?.toModel;
                const reason = failoverReason(data?.status ?? null, data?.reason || "");
                const phase = to
                    ? `⚠️ [${from}] ${reason}, moving to cooldown. Switching to [${to}]...`
                    : `⚠️ [${from}] ${reason}, moving to cooldown. No alternate model left.`;

                if (active) {
                    if (to) active.model = to;
                    ctxRef.current.updateNotification(active.id, { phase });
                } else {
                    const id = ctxRef.current.addNotification(
                        "stream",
                        "Switching Gemini model...",
                        { dismissable: true }
                    );
                    ctxRef.current.updateNotification(id, { phase });
                }
            },
            "BackgroundBar: stream failover"
        );

        const offDone = world.events.on(
            PlannerStreamEvents.DONE,
            () => {
                const active = activeStreamRef.current;
                // Clear stream ID immediately to prevent any race with ERROR
                activeStreamRef.current = null;
                if (!active) return;
                // Transition to completed → auto-dismiss will clean up
                ctxRef.current.updateNotification(active.id, {
                    message: "Schedule generated",
                    phase: "",
                    status: "completed",
                });
            },
            "BackgroundBar: stream done"
        );

        const offError = world.events.on(
            PlannerStreamEvents.ERROR,
            (/** @type {{ error?: string }} */ data) => {
                const active = activeStreamRef.current;
                // Clear stream ID immediately
                activeStreamRef.current = null;

                if (active) {
                    // Update existing notification to error state
                    ctxRef.current.updateNotification(active.id, {
                        message: "Generation failed",
                        phase: data?.error || "Error occurred",
                        status: "error",
                    });
                } else {
                    // No active stream — create a standalone error notification
                    ctxRef.current.addNotification(
                        "error",
                        "Schedule generation failed",
                        {
                            details: data?.error || "Unknown error",
                            retryFn: async () => {
                                await world.worldSetter.ensureSchedule(
                                    world.now
                                );
                            },
                            dismissable: true,
                        }
                    );
                }
            },
            "BackgroundBar: stream error"
        );

        return () => {
            offStart();
            offText();
            offFailover();
            offDone();
            offError();
            // If there's a pending stream on unmount, force-complete it
            if (activeStreamRef.current) {
                ctxRef.current.updateNotification(activeStreamRef.current.id, {
                    status: "completed",
                });
                activeStreamRef.current = null;
            }
        };
    }, [world]);

    // ── Director Mode Stage Directive Lifecycle ─────────────────────────
    useEffect(() => {
        if (!conversationEvents || typeof conversationEvents.on !== "function") return;

        /** @type {string|null} */
        let directorNotifId = null;

        const offStart = conversationEvents.on(
            ConversationEvents.DIRECTOR_EVENT,
            (/** @type {string} */ plot) => {
                if (directorNotifId) ctxRef.current.removeNotification(directorNotifId);
                directorNotifId = ctxRef.current.addNotification(
                    "stream",
                    "⚡ Updating scene...",
                    { details: plot, dismissable: false }
                );
                ctxRef.current.updateNotification(directorNotifId, {
                    phase: "Waiting for cast reaction...",
                });
            },
            "BackgroundBar: director event"
        );

        const offResponse = conversationEvents.on(
            ConversationEvents.DIRECTOR_RESPONSE_START,
            () => {
                const id = directorNotifId;
                directorNotifId = null;
                if (id) {
                    ctxRef.current.updateNotification(id, {
                        message: "Scene updated",
                        phase: "",
                        status: "completed",
                    });
                } else {
                    ctxRef.current.addNotification("info", "Scene updated", {
                        dismissable: true,
                    });
                }
            },
            "BackgroundBar: director response start"
        );

        const offError = conversationEvents.on(
            ConversationEvents.ERROR,
            (/** @type {any} */ error) => {
                const id = directorNotifId;
                if (!id) return;
                directorNotifId = null;
                ctxRef.current.updateNotification(id, {
                    message: "Scene update failed",
                    phase: error?.message || "Turn generation failed",
                    status: "error",
                });
            },
            "BackgroundBar: director error"
        );

        return () => {
            offStart();
            offResponse();
            offError();
            directorNotifId = null;
        };
    }, [conversationEvents]);

    // ── Network Offline/Online Events ──────────────────────────────────
    // Use ctxRef (stable ref) instead of ctx in deps to prevent infinite re-renders
    // since ctx is a new object reference on every render.
    useEffect(() => {
        /** @type {string|null} */
        let offlineNotifId = null;

        const handleOffline = () => {
            offlineNotifId = ctxRef.current.addNotification(
                "disconnect",
                "Network connection lost",
                {
                    details:
                        "You are currently offline. Background AI processing is paused. Messages will be queued.",
                    dismissable: true,
                }
            );
        };

        const handleOnline = () => {
            // Update existing offline notification to completed (auto-dismiss)
            if (offlineNotifId) {
                ctxRef.current.updateNotification(offlineNotifId, {
                    message: "Connection restored",
                    phase: "",
                    status: "completed",
                });
                offlineNotifId = null;
            } else {
                // No offline notification exists — show a brief info
                ctxRef.current.addNotification("info", "Connection restored", {
                    dismissable: true,
                });
            }
        };

        window.addEventListener("offline", handleOffline);
        window.addEventListener("online", handleOnline);
        return () => {
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("online", handleOnline);
        };
    }, []);

    // ── Derived state ──────────────────────────────────────────────────
    const activeNotifications = useMemo(
        // Completed notifications stay visible until their 3s auto-dismiss
        // fires, so success confirmations ("Scene updated", "Schedule
        // generated") are actually seen by the user.
        () => notifications,
        [notifications]
    );

    // Bar renders a collapsed grid row when idle so .chatShell's explicit
    // grid rows never desynchronise (see Chat.module.css).
    const hasAny = activeNotifications.length > 0;
    if (!hasAny) {
        return <div className={styles.barCollapsed} aria-hidden="true" />;
    }

    const latest = activeNotifications[activeNotifications.length - 1];
    const hasCompleted = notifications.some(
        (n) => n.status === "completed"
    );

    return (
        <div className={latest.status === "completed" ? `${styles.bar} ${styles.barCompleted}` : styles.bar}>
            <button
                className={styles.barContent}
                onClick={() => setSelectedNotification(latest)}
                title="Click for details"
            >
                <NotificationIcon type={latest.type} />
                <span className={styles.barMessage}>{latest.message}</span>
                {latest.phase && (
                    <span className={styles.barPhase}>{latest.phase}</span>
                )}
                {activeNotifications.length > 1 && (
                    <span className={styles.barCount}>
                        +{activeNotifications.length - 1} more
                    </span>
                )}
                <span className={styles.barTime}>
                    {timeAgo(latest.timestamp)}
                </span>
            </button>

            <div className={styles.barActions}>
                {(latest.status === "error" || latest.type === "error") && latest.retryFn && (
                    <button
                        className={styles.btnRetry}
                        onClick={(e) => {
                            e.stopPropagation();
                            retryNotification(latest.id);
                        }}
                        title="Retry"
                    >
                        🔄
                    </button>
                )}
                {latest.dismissable && (
                    <button
                        className={styles.btnClose}
                        onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(latest.id);
                        }}
                        title="Dismiss"
                    >
                        ✕
                    </button>
                )}
                {hasCompleted && (
                    <button
                        className={styles.btnClear}
                        onClick={(e) => {
                            e.stopPropagation();
                            clearCompleted();
                        }}
                        title="Clear completed"
                    >
                        🗑
                    </button>
                )}
            </div>

            {/* Detail Modal */}
            <DetailModal />
        </div>
    );
}

/**
 * Modal showing full notification details.
 * @returns {React.JSX.Element|null}
 */
function DetailModal() {
    const {
        selectedNotification,
        setSelectedNotification,
        removeNotification,
        retryNotification,
    } = useBackgroundBar();

    if (!selectedNotification) return null;

    const n = selectedNotification;

    return (
        <div
            className={styles.modalOverlay}
            onClick={() => setSelectedNotification(null)}
        >
            <div
                className={styles.modalCard}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.modalHeader}>
                    <NotificationIcon type={n.type} />
                    <h3 className={styles.modalTitle}>{n.message}</h3>
                    <button
                        className={styles.modalClose}
                        onClick={() => setSelectedNotification(null)}
                    >
                        ✕
                    </button>
                </div>

                <div className={styles.modalBody}>
                    <div className={styles.modalMeta}>
                        <span className={styles.modalTime}>
                            {formatTime(n.timestamp)}
                        </span>
                        <span className={styles.modalType}>
                            {n.type.toUpperCase()}
                        </span>
                        <span
                            className={`${styles.modalStatus} ${
                                n.status === "active"
                                    ? styles.statusActive
                                    : n.status === "error"
                                    ? styles.statusError
                                    : styles.statusComplete
                            }`}
                        >
                            {n.status}
                        </span>
                    </div>

                    {n.phase && (
                        <div className={styles.modalPhase}>
                            <strong>Phase:</strong> {n.phase}
                        </div>
                    )}

                    {n.details && (
                        <div className={styles.modalDetails}>
                            <strong>Details:</strong>
                            <pre className={styles.modalPre}>{n.details}</pre>
                        </div>
                    )}
                </div>

                <div className={styles.modalFooter}>
                    {(n.status === "error" || n.type === "error") && n.retryFn && (
                        <button
                            className={styles.btnModalRetry}
                            onClick={() => retryNotification(n.id)}
                        >
                            🔄 Retry
                        </button>
                    )}
                    {n.dismissable && (
                        <button
                            className={styles.btnModalDismiss}
                            onClick={() => {
                                removeNotification(n.id);
                                setSelectedNotification(null);
                            }}
                        >
                            Dismiss
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
