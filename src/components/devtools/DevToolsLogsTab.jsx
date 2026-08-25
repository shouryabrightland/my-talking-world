// @ts-check

import React, { useMemo } from "react";
import styles from "../DevToolsDrawer.module.css";

/** @typedef {import("../../classes/lib/Logger").LogEntry} LogEntry */
/** @typedef {import("../../classes/lib/Logger").LogSeverity} LogSeverity */

/**
 * Modular DevTools Tab for Filtering & Inspecting System Logs.
 *
 * @param {Object} props
 * @param {LogEntry[]} props.logs Complete buffered log collection.
 * @param {LogSeverity} props.activeLevel Currently selected log level.
 * @param {string} props.searchQuery Live search input filter.
 * @param {(query: string) => void} props.setSearchQuery Setter for search query.
 * @param {() => void} props.clearLogs Callback to clear all logs.
 * @returns {React.JSX.Element}
 */
export default function DevToolsLogsTab({
    logs,
    activeLevel,
    searchQuery,
    setSearchQuery,
    clearLogs
}) {
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const matchesLevel = activeLevel === log.level;
            if (!matchesLevel) return false;

            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return log.message.toLowerCase().includes(q) || log.name.toLowerCase().includes(q);
        });
    }, [logs, activeLevel, searchQuery]);

    return (
        <div className={styles.tabContainer}>
            {/* Toolbar */}
            <div className={styles.toolBar}>
                <input
                    placeholder={`Filter ${activeLevel} logs...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={styles.searchInput}
                />
                <button onClick={clearLogs} className={styles.clearBtn}>
                    🗑️ Clear Logs
                </button>
            </div>

            {/* Logs Stream Body */}
            <div className={styles.tabContentBody}>
                {filteredLogs.length === 0 ? (
                    <div className={styles.emptyLogs}>
                        <span>No {activeLevel} logs recorded.</span>
                    </div>
                ) : (
                    <div className={styles.logList}>
                        {filteredLogs.map((log) => (
                            <div key={log.id} className={styles.logRow}>
                                <span className={styles.logTime}>{log.time}</span>
                                <span className={styles.logTag}>[{log.name}]</span>
                                <div className={styles.logMessage}>{log.message}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}