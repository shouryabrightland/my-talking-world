// @ts-check

import React, { useCallback, useMemo, useState } from "react";
import styles from "../DevToolsDrawer.module.css";

/** @typedef {import("../../classes/lib/PromptLogger").PromptLogEntry} PromptLogEntry */
/** @typedef {import("../../classes/lib/PromptLogger").PromptType} PromptType */

/**
 * Modular DevTools Tab for Inspecting the Last 5 LLM Executions across all 4 Prompts,
 * complete with Full Request Messages, Latency, and Extracted Thinking Chains.
 *
 * @param {Object} props
 * @param {Record<PromptType, PromptLogEntry[]>} props.promptLogs
 * @param {() => void} props.clearPromptLogs Callback to wipe prompt traces.
 * @returns {React.JSX.Element}
 */
export default function DevToolsPromptsTab({
    promptLogs,
    clearPromptLogs
}) {
    /** @type {[PromptType, React.Dispatch<React.SetStateAction<PromptType>>]} */
    const [selectedCategory, setSelectedCategory] = useState(/** @type {PromptType} */ ("dialogue"));

    /** @type {[Set<string>, React.Dispatch<React.SetStateAction<Set<string>>>]} */
    const [expandedEntryIds, setExpandedEntryIds] = useState(() => new Set());

    const activeEntries = useMemo(() => {
        return promptLogs[selectedCategory] || [];
    }, [promptLogs, selectedCategory]);

    const toggleEntry = useCallback((/** @type {string} */ id) => {
        setExpandedEntryIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    return (
        <div className={styles.tabContainer}>
            {/* Sub-Tabs Selector & Actions */}
            <div className={styles.toolBar}>
                <div className={styles.promptCategoryList}>
                    <button
                        onClick={() => setSelectedCategory("dialogue")}
                        className={selectedCategory === "dialogue" ? styles.promptCatActive : styles.promptCatBtn}
                    >
                        💬 Dialogue ({promptLogs.dialogue?.length || 0})
                    </button>
                    <button
                        onClick={() => setSelectedCategory("scheduler")}
                        className={selectedCategory === "scheduler" ? styles.promptCatActive : styles.promptCatBtn}
                    >
                        📅 Scheduler ({promptLogs.scheduler?.length || 0})
                    </button>
                    <button
                        onClick={() => setSelectedCategory("demand")}
                        className={selectedCategory === "demand" ? styles.promptCatActive : styles.promptCatBtn}
                    >
                        🎬 Demand ({promptLogs.demand?.length || 0})
                    </button>
                    <button
                        onClick={() => setSelectedCategory("stabilizer")}
                        className={selectedCategory === "stabilizer" ? styles.promptCatActive : styles.promptCatBtn}
                    >
                        ⚡ Stabilizer ({promptLogs.stabilizer?.length || 0})
                    </button>
                </div>

                <button onClick={clearPromptLogs} className={styles.clearBtn}>
                    🗑️ Clear Prompt Traces
                </button>
            </div>

            {/* Prompt Logs Feed */}
            <div className={styles.tabContentBody}>
                {activeEntries.length === 0 ? (
                    <div className={styles.emptyLogs}>
                        <span>No prompt executions recorded for '{selectedCategory}' yet.</span>
                    </div>
                ) : (
                    <div className={styles.promptEntryList}>
                        {activeEntries.map((entry, index) => {
                            const isExpanded = expandedEntryIds.has(entry.id);
                            const isSuccess = entry.status === "success";

                            return (
                                <div key={entry.id} className={styles.promptCard}>
                                    {/* Card Header (Always visible, click to toggle full trace) */}
                                    <div
                                        className={styles.promptCardHeader}
                                        onClick={() => toggleEntry(entry.id)}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div className={styles.promptMetaLeft}>
                                            <span className={styles.promptIndexBadge}>#{index + 1}</span>
                                            <span className={styles.promptTimeText}>{entry.time}</span>
                                            <span className={styles.promptModelBadge}>{entry.model.split("/").pop()}</span>
                                            <span className={styles.promptLatencyBadge}>⚡ {entry.latencyMs}ms</span>
                                            {(entry.tokensIn != null || entry.tokensOut != null) && (
                                                <span
                                                    className={styles.promptTokenBadge}
                                                    title={`Tokens In: ${entry.tokensIn ?? "n/a"} • Tokens Out: ${entry.tokensOut ?? "n/a"}`}
                                                >
                                                    ⇅ In {entry.tokensIn ?? "—"} / Out {entry.tokensOut ?? "—"}
                                                </span>
                                            )}
                                            {entry.finishReason === "length" && (
                                                <span className={styles.statusBadgeError} title="Model hit the max token limit mid-response">
                                                    TRUNCATED
                                                </span>
                                            )}
                                        </div>

                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <span className={isSuccess ? styles.statusBadgeSuccess : styles.statusBadgeError}>
                                                {isSuccess ? "200 OK" : "ERROR"}
                                            </span>
                                            <button
                                                type="button"
                                                className={styles.accordionToggleBtn}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleEntry(entry.id);
                                                }}
                                                aria-label={isExpanded ? "Collapse trace" : "Expand trace"}
                                            >
                                                {isExpanded ? "▲" : "▼"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expandable Trace Payload View */}
                                    {isExpanded && (
                                        <div className={styles.promptCardBody}>
                                            {/* Error Callout if failed */}
                                            {entry.error && (
                                                <div className={styles.promptErrorBanner}>
                                                    ❌ <strong>Error:</strong> {entry.error}
                                                </div>
                                            )}

                                            {/* Section 1: Full Request Messages Sent to Model */}
                                            <div className={styles.promptTraceSection}>
                                                <h5 className={styles.promptSectionHeading}>📤 Request Messages Sent to Groq:</h5>
                                                <div className={styles.promptMessagesContainer}>
                                                    {entry.requestMessages.map((msg, i) => (
                                                        <div key={i} className={styles.promptMessageItem}>
                                                            <span className={msg.role === "system" ? styles.roleBadgeSystem : styles.roleBadgeUser}>
                                                                {msg.role.toUpperCase()}
                                                            </span>
                                                            <pre className={styles.codeViewer}>{msg.content}</pre>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Section 2: Model Reasoning / Thinking Chain (if captured) */}
                                            {entry.thinkingChain && (
                                                <div className={styles.promptTraceSection}>
                                                    <h5 className={styles.promptSectionHeadingHighlight}>🧠 Captured Reasoning / Thinking Chain (&lt;think&gt;):</h5>
                                                    <div className={styles.thinkingChainBox}>
                                                        <pre className={styles.codeViewer}>{entry.thinkingChain}</pre>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Section 3: Raw Model Response Output */}
                                            {entry.rawResponse && (
                                                <div className={styles.promptTraceSection}>
                                                    <h5 className={styles.promptSectionHeading}>📥 Raw Response Text Returned:</h5>
                                                    <div className={styles.rawResponseBox}>
                                                        <pre className={styles.codeViewer}>{entry.rawResponse}</pre>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}