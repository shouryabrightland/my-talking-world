// @ts-check

import React, { useMemo } from "react";
import styles from "./DevToolsBar.module.css";
import { useDevTools } from "../contexts/DevToolsContext";

/**
 * Responsive DevTools Ribbon Bar.
 * Displays quick-access badges for Log levels, active Prompts count, and System State.
 *
 * @returns {React.JSX.Element|null}
 */
export default function DevToolsBar() {
    const { isDevToolsEnabled, isDevToolsOpen, setIsDevToolsOpen, logs, promptLogs, setActiveTab } = useDevTools();

    const counts = useMemo(() => {
        let errors = 0;
        let warns = 0;
        let infos = 0;
        let debugs = 0;

        for (const log of logs) {
            if (log.level === "error") errors++;
            else if (log.level === "warn") warns++;
            else if (log.level === "info") infos++;
            else if (log.level === "debug") debugs++;
        }

        const totalPrompts = promptLogs ? (
            (promptLogs.dialogue?.length || 0) +
            (promptLogs.scheduler?.length || 0) +
            (promptLogs.demand?.length || 0) +
            (promptLogs.stabilizer?.length || 0)
        ) : 0;

        return { errors, warns, infos, debugs, totalPrompts };
    }, [logs, promptLogs]);

    if (!isDevToolsEnabled) return null;

    return (
        <div className={styles.barContainer}>
            <div className={styles.badgeRow}>
                <span className={styles.barLabel}>
                    <span className={styles.barLabelIcon}>🛠️</span>
                    <span className={styles.barLabelText}>DEV TOOLS</span>
                </span>

                {counts.errors > 0 && (
                    <button
                        onClick={() => {
                            setActiveTab("error");
                            setIsDevToolsOpen(true);
                        }}
                        className={styles.errorBadge}
                    >
                        🔴 {counts.errors}
                    </button>
                )}

                {counts.warns > 0 && (
                    <button
                        onClick={() => {
                            setActiveTab("warn");
                            setIsDevToolsOpen(true);
                        }}
                        className={styles.warnBadge}
                    >
                        🟡 {counts.warns}
                    </button>
                )}

                <button
                    onClick={() => {
                        setActiveTab("info");
                        setIsDevToolsOpen(true);
                    }}
                    className={styles.infoBadge}
                >
                    🟢 {counts.infos}
                </button>

                <button
                    onClick={() => {
                        setActiveTab("debug");
                        setIsDevToolsOpen(true);
                    }}
                    className={styles.debugBadge}
                >
                    🔵 {counts.debugs}
                </button>

                <button
                    onClick={() => {
                        setActiveTab("prompts");
                        setIsDevToolsOpen(true);
                    }}
                    className={styles.promptBadge}
                >
                    🤖 Prompts ({counts.totalPrompts})
                </button>
            </div>

            <div className={styles.actionsRow}>
                <button
                    onClick={() => {
                        setActiveTab("state");
                        setIsDevToolsOpen(true);
                    }}
                    className={styles.stateBtn}
                >
                    <span>🧩</span>
                    <span className={styles.stateBtnText}>Inspect State</span>
                    <span className={styles.stateBtnShort}>State</span>
                </button>

                <button
                    onClick={() => setIsDevToolsOpen(!isDevToolsOpen)}
                    className={styles.toggleBtn}
                >
                    {isDevToolsOpen ? "▼" : "▲"}
                </button>
            </div>
        </div>
    );
}