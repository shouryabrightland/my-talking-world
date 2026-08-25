// @ts-check

/**
 * @file ErrorBoundary.jsx
 * Rich React Error Boundary with comprehensive crash recovery.
 *
 * Features:
 * - Catches uncaught UI exceptions with full error details.
 * - Shows error message, stack trace, and component stack.
 * - Recovery actions: Reload, Clear Database, Reset to Lobby.
 * - Copy error to clipboard for debugging.
 * - Collapsible technical details panel.
 * - Smooth animations and responsive design.
 */

import React from "react";
import styles from "./ErrorBoundary.module.css";

/**
 * @typedef {Object} ErrorBoundaryProps
 * @property {React.ReactNode} children
 * @property {React.ReactNode} [fallback]
 */

/**
 * @typedef {Object} ErrorBoundaryState
 * @property {boolean} hasError
 * @property {Error|null} error
 * @property {React.ErrorInfo|null} errorInfo
 * @property {boolean} showDetails
 * @property {boolean} isResetting
 */

/**
 * Global React Error Boundary to catch uncaught UI exceptions.
 * Provides rich crash recovery with multiple action options.
 *
 * @extends {React.Component<ErrorBoundaryProps, ErrorBoundaryState>}
 */
export default class ErrorBoundary extends React.Component {
    /** @param {ErrorBoundaryProps} props */
    constructor(props) {
        super(props);
        this.state = /** @type {ErrorBoundaryState} */ ({
            hasError: false,
            error: null,
            errorInfo: null,
            showDetails: false,
            isResetting: false
        });
    }

    /**
     * Static lifecycle method to capture error and update state.
     * @param {Error} error The error that was thrown.
     * @returns {Partial<ErrorBoundaryState>}
     */
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    /**
     * Catches errors with full component stack trace.
     * @param {Error} error The error that was thrown.
     * @param {React.ErrorInfo} errorInfo Component stack trace info.
     */
    componentDidCatch(error, errorInfo) {
        console.error("[ErrorBoundary] Uncaught UI Crash:", error, errorInfo);
        this.setState({ errorInfo });
    }

    /**
     * Reloads the entire application.
     */
    handleReload = () => {
        this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
        window.location.reload();
    };

    /**
     * Clears the IndexedDB database and reloads.
     * Useful when the crash is caused by corrupt stored data.
     */
    handleClearDatabase = async () => {
        this.setState({ isResetting: true });
        try {
            // Delete the database
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase("tgf");
                request.onsuccess = () => resolve(undefined);
                request.onerror = () => reject(request.error);
                request.onblocked = () => resolve(undefined); // Continue anyway
            });

            // Also clear localStorage keys
            try {
                const keys = Object.keys(localStorage);
                for (const key of keys) {
                    if (key.startsWith("tgf:")) {
                        localStorage.removeItem(key);
                    }
                }
            } catch {
                // Ignore localStorage errors
            }

            // Reload after clearing
            window.location.reload();
        } catch (/** @type {unknown} */ err) {
            console.error("[ErrorBoundary] Failed to clear database:", err);
            this.setState({ isResetting: false });
            // Fall back to hard reload
            window.location.reload();
        }
    };

    /**
     * Resets error state and returns to the app (retry without reload).
     */
    handleRetry = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
            showDetails: false
        });
    };

    /**
     * Copies the full error report to clipboard.
     */
    handleCopyError = async () => {
        const { error, errorInfo } = this.state;
        const report = [
            "=== Tom & Friends Crash Report ===",
            `Time: ${new Date().toISOString()}`,
            `User Agent: ${navigator.userAgent}`,
            "",
            "Error:",
            error?.message || "Unknown error",
            "",
            "Stack:",
            error?.stack || "No stack trace available",
            "",
            "Component Stack:",
            errorInfo?.componentStack || "Not available"
        ].join("\n");

        try {
            await navigator.clipboard.writeText(report);
            // Brief visual feedback
            const btn = document.querySelector('[data-copy-btn]');
            if (btn) {
                btn.textContent = "✓ Copied!";
                setTimeout(() => {
                    if (btn) btn.textContent = "📋 Copy Error";
                }, 2000);
            }
        } catch {
            // Fallback: select text from a textarea
            const textarea = document.createElement("textarea");
            textarea.value = report;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        }
    };

    /**
     * Toggles the technical details panel.
     */
    toggleDetails = () => {
        this.setState(prev => ({ showDetails: !prev.showDetails }));
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const { error, errorInfo, showDetails, isResetting } = this.state;

            return (
                <div className={styles.backdrop}>
                    <div className={styles.card}>
                        {/* Header */}
                        <div className={styles.header}>
                            <div className={styles.icon}>💥</div>
                            <h2 className={styles.title}>Something went wrong</h2>
                            <p className={styles.subtitle}>
                                The app encountered an unexpected error. You can try to recover or report the issue.
                            </p>
                        </div>

                        {/* Error Message */}
                        <div className={styles.errorBox}>
                            <span className={styles.errorIcon}>⚠️</span>
                            <span className={styles.errorText}>
                                {error?.message || "An unexpected error occurred."}
                            </span>
                        </div>

                        {/* Action Buttons */}
                        <div className={styles.actions}>
                            <button onClick={this.handleRetry} className={styles.primaryBtn}>
                                🔄 Try Again
                            </button>
                            <button onClick={this.handleReload} className={styles.secondaryBtn}>
                                🔃 Reload App
                            </button>
                            <button
                                onClick={this.handleClearDatabase}
                                className={styles.dangerBtn}
                                disabled={isResetting}
                            >
                                {isResetting ? "Clearing..." : "🗑️ Clear Data & Reload"}
                            </button>
                        </div>

                        {/* Copy Error Button */}
                        <button
                            onClick={this.handleCopyError}
                            className={styles.copyBtn}
                            data-copy-btn
                        >
                            📋 Copy Error
                        </button>

                        {/* Collapsible Technical Details */}
                        <div className={styles.detailsSection}>
                            <button
                                onClick={this.toggleDetails}
                                className={styles.detailsToggle}
                            >
                                {showDetails ? "▼ Hide Details" : "▶ Show Technical Details"}
                            </button>

                            {showDetails && (
                                <div className={styles.detailsPanel}>
                                    {/* Error Message */}
                                    <div className={styles.detailBlock}>
                                        <span className={styles.detailLabel}>Error Message:</span>
                                        <pre className={styles.detailContent}>
                                            {error?.message || "N/A"}
                                        </pre>
                                    </div>

                                    {/* Stack Trace */}
                                    {error?.stack && (
                                        <div className={styles.detailBlock}>
                                            <span className={styles.detailLabel}>Stack Trace:</span>
                                            <pre className={styles.detailContent}>
                                                {error.stack}
                                            </pre>
                                        </div>
                                    )}

                                    {/* Component Stack */}
                                    {errorInfo?.componentStack && (
                                        <div className={styles.detailBlock}>
                                            <span className={styles.detailLabel}>Component Stack:</span>
                                            <pre className={styles.detailContent}>
                                                {errorInfo.componentStack}
                                            </pre>
                                        </div>
                                    )}

                                    {/* Environment Info */}
                                    <div className={styles.detailBlock}>
                                        <span className={styles.detailLabel}>Environment:</span>
                                        <pre className={styles.detailContent}>
                                            {`Time: ${new Date().toISOString()}
URL: ${window.location.href}
Online: ${navigator.onLine}
User Agent: ${navigator.userAgent}`}
                                        </pre>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
