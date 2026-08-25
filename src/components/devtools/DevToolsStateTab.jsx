// @ts-check

import React, { useMemo } from "react";
import styles from "../DevToolsDrawer.module.css";

/** @typedef {import("../../contexts/DevToolsContext").DevToolsSystemState} DevToolsSystemState */
/** @typedef {import("../../classes/types/World.types").CharacterGoalRecord} CharacterGoalRecord */

/**
 * Type guard checking if system state payload is initialized.
 *
 * @param {any} state
 * @returns {state is DevToolsSystemState}
 */
function isSystemState(state) {
    return (
        state &&
        typeof state === "object" &&
        !("status" in state) &&
        Array.isArray(state.characters) &&
        typeof state.timestamp === "string"
    );
}

/**
 * Modular DevTools Tab for Inspecting Live System State via Visual Flash Cards.
 *
 * @param {Object} props
 * @param {DevToolsSystemState | { status: string } | null} props.liveState
 * @param {() => void} props.handleCopyState Callback to copy raw JSON snapshot.
 * @param {boolean} props.copied Whether JSON copy confirmation is active.
 * @returns {React.JSX.Element}
 */
export default function DevToolsStateTab({
    liveState,
    handleCopyState,
    copied
}) {
    const validState = useMemo(() => {
        return isSystemState(liveState) ? liveState : null;
    }, [liveState]);

    return (
        <div className={styles.tabContainer}>
            {/* Toolbar */}
            <div className={styles.toolBar}>
                <div className={styles.stateBar}>
                    <span className={styles.stateHeading}>Active System State Dashboard</span>
                    <button onClick={handleCopyState} className={styles.copyBtn}>
                        {copied ? "✅ Copied JSON!" : "📋 Copy Raw JSON"}
                    </button>
                </div>
            </div>

            {/* Flash Cards Dashboard Body */}
            <div className={styles.tabContentBody}>
                {!validState ? (
                    <div className={styles.emptyLogs}>
                        <span>{typeof liveState === "object" && liveState && "status" in liveState ? String(liveState.status) : "State not initialized."}</span>
                    </div>
                ) : (
                    <div className={styles.cardsGrid}>
                        {/* Card 1: Active Schedule & Scene */}
                        <div className={styles.stateCard}>
                            <div className={styles.stateCardHeader}>
                                <h4 className={styles.stateCardTitle}>🕒 Active Horizon & Scene</h4>
                                <span className={styles.badgePrimary}>
                                    {validState.activeSchedule?.timeRange || "No Active Block"}
                                </span>
                            </div>

                            {validState.activeSchedule ? (
                                <div className={styles.cardContentList}>
                                    <div className={styles.metaField}>
                                        <span className={styles.fieldLabel}>Topic:</span>
                                        <span className={styles.fieldValueBold}>{validState.activeSchedule.topic}</span>
                                    </div>

                                    <div className={styles.metaField}>
                                        <span className={styles.fieldLabel}>Main Goal:</span>
                                        <span className={styles.fieldValue}>{validState.activeSchedule.mainGoal}</span>
                                    </div>

                                    {Array.isArray(validState.activeSchedule.characterGoals) && validState.activeSchedule.characterGoals.length > 0 && (
                                        <div className={styles.metaField}>
                                            <span className={styles.fieldLabel}>Character Motivations:</span>
                                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                {validState.activeSchedule.characterGoals.map((/** @type {CharacterGoalRecord} */ cg) => (
                                                    <span key={cg.id} className={styles.fieldSubValue}>
                                                        • <strong>{cg.name}:</strong> {cg.goal}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {validState.activeSchedule.prePlot && (
                                        <div className={styles.prePlotCallout}>
                                            ⏮️ <strong>Pre-Plot:</strong> {validState.activeSchedule.prePlot}
                                        </div>
                                    )}

                                    {validState.activeSchedule.postPlot && (
                                        <div className={styles.postPlotCallout}>
                                            ⏭️ <strong>Post-Plot:</strong> {validState.activeSchedule.postPlot}
                                        </div>
                                    )}

                                    {Array.isArray(validState.activeSchedule.facts) && validState.activeSchedule.facts.length > 0 && (
                                        <div className={styles.tagRow}>
                                            {validState.activeSchedule.facts.map((/** @type {string} */ fact, /** @type {number} */ idx) => (
                                                <span key={idx} className={styles.tagChip}>
                                                    🏷️ {fact}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <span className={styles.emptyNote}>Casual conversation (no specific block active).</span>
                            )}
                        </div>

                        {/* Card 2: Real-World Environment Grounding */}
                        <div className={styles.stateCard}>
                            <div className={styles.stateCardHeader}>
                                <h4 className={styles.stateCardTitle}>🌤️ Real-World Environment</h4>
                                <span className={styles.badgeSuccess}>
                                    {validState.environment?.temperature || "32°C"}
                                </span>
                            </div>

                            {validState.environment ? (
                                <div className={styles.cardContentList}>
                                    <div className={styles.metaField}>
                                        <span className={styles.fieldLabel}>Location:</span>
                                        <span className={styles.fieldValue}>{validState.environment.city}</span>
                                    </div>

                                    <div className={styles.metaField}>
                                        <span className={styles.fieldLabel}>Weather & Humidity:</span>
                                        <span className={styles.fieldValue}>
                                            {validState.environment.weather} (Humidity: {validState.environment.humidity})
                                        </span>
                                    </div>

                                    <div className={styles.metaField}>
                                        <span className={styles.fieldLabel}>Today's Celebration:</span>
                                        <span className={styles.fieldValueHighlight}>{validState.environment.todayCelebration}</span>
                                    </div>

                                    {Array.isArray(validState.environment.newsHeadlines) && validState.environment.newsHeadlines.length > 0 && (
                                        <div className={styles.metaField}>
                                            <span className={styles.fieldLabel}>Google News Headlines:</span>
                                            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                                {validState.environment.newsHeadlines.slice(0, 3).map((/** @type {string} */ h, /** @type {number} */ i) => (
                                                    <span key={i} className={styles.fieldSubValue}>
                                                        📰 {h}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <span className={styles.emptyNote}>Environment data loading...</span>
                            )}
                        </div>

                        {/* Card 3: Chat Engine & Scheduler Metrics */}
                        <div className={styles.stateCard}>
                            <div className={styles.stateCardHeader}>
                                <h4 className={styles.stateCardTitle}>💬 Engine & Queue Metrics</h4>
                                <span className={styles.badgeWarning}>
                                    {validState.chatEngine.activeModel.split("/").pop()}
                                </span>
                            </div>

                            <div className={styles.cardContentList}>
                                <div className={styles.metricGrid}>
                                    <div className={styles.metricBox}>
                                        <span className={styles.metricNumber}>{validState.chatEngine.totalMessages}</span>
                                        <span className={styles.metricLabel}>Total Messages</span>
                                    </div>
                                    <div className={styles.metricBox}>
                                        <span className={styles.metricNumber}>{validState.chatEngine.membersCount}</span>
                                        <span className={styles.metricLabel}>Active Members</span>
                                    </div>
                                    <div className={styles.metricBox}>
                                        <span className={styles.metricNumber}>{validState.chatEngine.pendingQueuesCount}</span>
                                        <span className={styles.metricLabel}>Queued Events</span>
                                    </div>
                                </div>

                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Simulation Clock:</span>
                                    <span className={styles.fieldValue}>{validState.timeWindow}</span>
                                </div>
                            </div>
                        </div>

                        {/* Card 4: Cast Real-Time States & Dynamic Memories */}
                        <div className={styles.stateCardWide}>
                            <div className={styles.stateCardHeader}>
                                <h4 className={styles.stateCardTitle}>👥 Cast States & Dynamic Memories</h4>
                                <span className={styles.badgeSecondary}>
                                    {validState.characters.length} Participants
                                </span>
                            </div>

                            <div className={styles.characterCardsList}>
                                {validState.characters.map((char) => {
                                    const isTyping = char.activity.isTyping;
                                    const isReading = char.activity.isReading;
                                    const isThinking = char.activity.isThinking;

                                    return (
                                        <div key={char.id} className={styles.charStateItem}>
                                            <div className={styles.charItemHeader}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                    <strong className={styles.charItemName}>{char.name}</strong>
                                                    <span className={styles.charAgeTag}>{char.age}y</span>
                                                    <span className={char.isAI ? styles.aiTag : styles.userTag}>
                                                        {char.isAI ? "Character" : "User"}
                                                    </span>
                                                </div>

                                                <div className={styles.charStatusBadgeRow}>
                                                    {isTyping && <span className={styles.typingBadge}>✍️ Typing</span>}
                                                    {isReading && <span className={styles.readingBadge}>📖 Reading</span>}
                                                    {isThinking && <span className={styles.thinkingBadge}>🤔 Thinking</span>}
                                                    {!isTyping && !isReading && !isThinking && (
                                                        <span className={styles.idleBadge}>● Idle</span>
                                                    )}
                                                    <span className={styles.emotionMiniTag}>
                                                        {char.currentEmotion}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Active Dynamic Memories with TTLs */}
                                            {char.memories && char.memories.length > 0 ? (
                                                <div className={styles.charMemoriesList}>
                                                    {char.memories.map((mem, idx) => (
                                                        <div key={idx} className={styles.charMemoryChip}>
                                                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                                <strong>{mem.key}:</strong>
                                                                <span>{mem.value}</span>
                                                            </div>
                                                            <span className={mem.expiry === "Permanent" ? styles.permTag : styles.ttlTag}>
                                                                {mem.expiry}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className={styles.noMemoriesNote}>No dynamic memories active</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}