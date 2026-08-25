// @ts-check

/**
 * @file BackgroundBarContext.jsx
 * React Context managing background process notifications.
 *
 * Lifecycle state machine per notification:
 *   idle → active → completed → (auto-dismissed after 3s)
 *   idle → active → error → (user retry or manual dismiss)
 *
 * Responsibilities:
 * - Tracks active background processes (streams, errors, disconnects).
 * - Auto-dismisses completed notifications after 3000ms.
 * - Provides add/remove/update/retry actions to all components.
 * - Exposes modal state for expanded notification details.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState
} from "react";

/**
 * @typedef {"stream" | "error" | "disconnect" | "info"} NotificationType
 * @typedef {"idle" | "active" | "completed" | "error"} NotificationStatus
 */

/**
 * @typedef {Object} Notification
 * @property {string} id Unique identifier.
 * @property {NotificationType} type Category of notification.
 * @property {string} message Short summary shown in the bar.
 * @property {NotificationStatus} status Current lifecycle status.
 * @property {number} timestamp When the notification was created.
 * @property {string} [details] Full details shown in modal.
 * @property {string} [phase] Current processing phase (e.g. "Generating block 2...").
 * @property {(() => Promise<void>)|null} retryFn Retry callback for actionable errors.
 * @property {boolean} dismissable Whether user can close this notification.
 */

/**
 * @typedef {Object} BackgroundBarContextValue
 * @property {Notification[]} notifications Active notifications.
 * @property {(type: NotificationType, message: string, opts?: {details?: string, retryFn?: () => Promise<void>, dismissable?: boolean, id?: string}) => string} addNotification Add a new notification, returns its ID.
 * @property {(id: string, updates: Partial<Pick<Notification, "message" | "phase" | "status" | "details">>) => void} updateNotification Update an existing notification.
 * @property {(id: string) => void} removeNotification Remove a notification by ID.
 * @property {(id: string) => Promise<void>} retryNotification Execute the retry function for a notification.
 * @property {Notification|null} selectedNotification Notification currently shown in modal.
 * @property {(notification: Notification | null) => void} setSelectedNotification Open/close modal.
 * @property {() => void} clearCompleted Remove all completed/errored notifications.
 */

/** Auto-dismiss delay for completed notifications (ms). */
const AUTO_DISMISS_DELAY = 3000;

const BackgroundBarContext =
    /** @type {React.Context<BackgroundBarContextValue|null>} */ (
        createContext(/** @type {BackgroundBarContextValue|null} */ (null))
    );

/**
 * Provider for background process notification state.
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {React.JSX.Element}
 */
export function BackgroundBarProvider({ children }) {
    /** @type {[Notification[], React.Dispatch<React.SetStateAction<Notification[]>>]} */
    const [notifications, setNotifications] = useState(
        /** @type {Notification[]} */ ([])
    );
    /** @type {[Notification|null, React.Dispatch<React.SetStateAction<Notification|null>>]} */
    const [selectedNotification, setSelectedNotification] = useState(
        /** @type {Notification|null} */ (null)
    );

    /** @type {React.MutableRefObject<number>} */
    const idCounter = useRef(0);

    // Track dismiss timers so we can clear them on unmount or removal
    /** @type {React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>} */
    const dismissTimers = useRef(new Map());

    /**
     * Clears an auto-dismiss timer for a given notification ID.
     * @param {string} id
     */
    const clearDismissTimer = useCallback((/** @type {string} */ id) => {
        const timer = dismissTimers.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            dismissTimers.current.delete(id);
        }
    }, []);

    /**
     * Schedules auto-dismiss for a notification after AUTO_DISMISS_DELAY.
     * @param {string} id
     */
    const scheduleAutoDismiss = useCallback((/** @type {string} */ id) => {
        clearDismissTimer(id);
        const timer = setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n.id !== id));
            dismissTimers.current.delete(id);
            // Clear selection if this was the selected notification
            setSelectedNotification((prev) =>
                prev?.id === id ? null : prev
            );
        }, AUTO_DISMISS_DELAY);
        dismissTimers.current.set(id, timer);
    }, [clearDismissTimer]);

    // Clean up all timers on unmount
    useEffect(() => {
        const timers = dismissTimers.current;
        return () => {
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
        };
    }, []);

    /**
     * Adds a new notification.
     * @param {NotificationType} type
     * @param {string} message
     * @param {{ details?: string, retryFn?: () => Promise<void>, dismissable?: boolean, id?: string }} [opts]
     * @returns {string} The notification ID.
     */
    const addNotification = useCallback(
        (/** @type {NotificationType} */ type, /** @type {string} */ message, /** @type {{ details?: string, retryFn?: () => Promise<void>, dismissable?: boolean, id?: string }} */ opts = {}) => {
            const id =
                opts.id ||
                `bg-${++idCounter.current}-${Date.now()}`;
            const notification = /** @type {Notification} */ ({
                id,
                type,
                message,
                status: "active",
                timestamp: Date.now(),
                details: opts.details || "",
                phase: "",
                retryFn: opts.retryFn || null,
                dismissable: opts.dismissable !== false,
            });

            setNotifications((prev) => {
                // Deduplicate by id — if exists, update instead of adding
                const idx = prev.findIndex((n) => n.id === id);
                if (idx !== -1) {
                    const updated = [...prev];
                    updated[idx] = { ...updated[idx], ...notification };
                    return updated;
                }
                return [...prev, notification];
            });

            return id;
        },
        []
    );

    /**
     * Updates an existing notification by ID.
     * When status transitions to "completed", schedules auto-dismiss.
     * @param {string} id
     * @param {Partial<Pick<Notification, "message" | "phase" | "status" | "details">>} updates
     */
    const updateNotification = useCallback(
        (/** @type {string} */ id, /** @type {Partial<Pick<Notification, "message" | "phase" | "status" | "details">>} */ updates) => {
            setNotifications((prev) =>
                prev.map((n) => {
                    if (n.id !== id) return n;
                    const next = { ...n, ...updates };
                    return next;
                })
            );

            // Schedule auto-dismiss when transitioning to completed
            if (updates.status === "completed") {
                scheduleAutoDismiss(id);
            }
            // Clear any pending dismiss timer if reverting to active
            if (updates.status === "active") {
                clearDismissTimer(id);
            }
        },
        [scheduleAutoDismiss, clearDismissTimer]
    );

    /**
     * Removes a notification by ID and clears its dismiss timer.
     * @param {string} id
     */
    const removeNotification = useCallback(
        (/** @type {string} */ id) => {
            clearDismissTimer(id);
            setNotifications((prev) => prev.filter((n) => n.id !== id));
            setSelectedNotification((prev) =>
                prev?.id === id ? null : prev
            );
        },
        [clearDismissTimer]
    );

    /**
     * Executes the retry function for a notification.
     * Resets status to active on retry start.
     * @param {string} id
     */
    const retryNotification = useCallback(
        async (/** @type {string} */ id) => {
            const notification = notifications.find((n) => n.id === id);
            if (!notification?.retryFn) return;

            // Clear any pending dismiss timer
            clearDismissTimer(id);
            updateNotification(id, {
                phase: "Retrying...",
                status: "active",
            });
            try {
                await notification.retryFn();
                updateNotification(id, {
                    phase: "Retry succeeded",
                    status: "completed",
                });
            } catch (err) {
                const errMsg =
                    err instanceof Error ? err.message : String(err);
                updateNotification(id, {
                    phase: `Retry failed: ${errMsg}`,
                    status: "error",
                });
            }
        },
        [notifications, updateNotification, clearDismissTimer]
    );

    /**
     * Removes all completed or errored notifications.
     */
    const clearCompleted = useCallback(() => {
        setNotifications((prev) => {
            const remaining = prev.filter(
                (n) => n.status === "active"
            );
            // Clear dismiss timers for removed notifications
            for (const n of prev) {
                if (n.status !== "active") {
                    clearDismissTimer(n.id);
                }
            }
            return remaining;
        });
    }, [clearDismissTimer]);

    /** @type {BackgroundBarContextValue} */
    const value = {
        notifications,
        addNotification,
        updateNotification,
        removeNotification,
        retryNotification,
        selectedNotification,
        setSelectedNotification,
        clearCompleted,
    };

    return (
        <BackgroundBarContext.Provider value={value}>
            {children}
        </BackgroundBarContext.Provider>
    );
}

/**
 * Hook to consume background bar context.
 * @returns {BackgroundBarContextValue}
 */
export function useBackgroundBar() {
    const ctx = useContext(BackgroundBarContext);
    if (!ctx)
        throw new Error(
            "useBackgroundBar must be used within BackgroundBarProvider."
        );
    return ctx;
}
