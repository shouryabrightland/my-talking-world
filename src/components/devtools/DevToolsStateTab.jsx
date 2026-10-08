// @ts-check

import React, { useCallback, useMemo, useState } from "react";
import styles from "../DevToolsDrawer.module.css";
import { useDevTools } from "../../contexts/DevToolsContext";

/** @typedef {import("../../contexts/DevToolsContext").DevToolsSystemState} DevToolsSystemState */
/** @typedef {import("../../contexts/DevToolsContext").ModelPoolEntry} ModelPoolEntry */
/** @typedef {import("../../util/apiKeys").ModelVerifyResult} ModelVerifyResult */
/** @typedef {import("../../classes/types/World.types").CharacterGoalRecord} CharacterGoalRecord */

/**
 * Inline verification probe state for a single model.
 * @typedef {Object} ProbeState
 * @property {boolean} busy
 * @property {string} label Inline feedback ("✓ 182ms" / "✕ HTTP 429").
 * @property {boolean} ok
 */

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
    const { verifyModel } = useDevTools();

    /** @type {[Record<string, ProbeState>, React.Dispatch<React.SetStateAction<Record<string, ProbeState>>>]} */
    const [probeResults, setProbeResults] = useState(/** @type {Record<string, ProbeState>} */ ({}));

    const validState = useMemo(() => {
        return isSystemState(liveState) ? liveState : null;
    }, [liveState]);

    /**
     * Sends a 1-token probe to one specific model, measures latency and shows
     * immediate inline feedback. The probe outcome is also reported back into
     * the owning pool (reportSuccess / reportFailure).
     *
     * @returns {Promise<void>}
     */
    const handleVerify = useCallback(async (
        /** @type {"groq"|"gemini"} */ provider,
        /** @type {string} */ modelId
    ) => {
        setProbeResults(prev => ({
            ...prev,
            [modelId]: { busy: true, label: "⏳ Probing…", ok: false }
        }));

        /** @type {ModelVerifyResult} */
        let result;
        try {
            result = await verifyModel(provider, modelId);
        } catch (/** @type {unknown} */ err) {
            const message = err instanceof Error ? err.message : String(err);
            result = { ok: false, ms: 0, label: `✕ ${message}`, status: null, error: message };
        }

        setProbeResults(prev => ({
            ...prev,
            [modelId]: { busy: false, label: result.label, ok: result.ok }
        }));
    }, [verifyModel]);

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

                        {/* Card 4: Groq Live Chat Model Pool */}
                        <ModelPoolCard
                            title="⚡ Groq Chat Model Pool"
                            provider="groq"
                            activeModel={validState.groqModelPool?.activeModel || null}
                            models={validState.groqModelPool?.models || []}
                            probeResults={probeResults}
                            onVerify={handleVerify}
                        />

                        {/* Card 5: Gemini Storyline Model Pool */}
                        <ModelPoolCard
                            title="✨ Gemini Storyline Model Pool"
                            provider="gemini"
                            activeModel={validState.geminiModelPool?.activeModel || null}
                            models={validState.geminiModelPool?.models || []}
                            probeResults={probeResults}
                            onVerify={handleVerify}
                        />

                        {/* Card 7: Ambient Situation Engine (Tier 2) */}
                        {validState.situationEngine && (
                        <div className={styles.stateCard}>
                            <div className={styles.stateCardHeader}>
                                <h4 className={styles.stateCardTitle}>🌫️ Ambient Situation Engine</h4>
                                <span className={validState.situationEngine.isProcessing ? styles.badgeWarning : styles.badgeSuccess}>
                                    {validState.situationEngine.isProcessing ? "Distilling…" : "Tier 2"}
                                </span>
                            </div>

                            <div className={styles.cardContentList}>
                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Current Situation:</span>
                                    <span className={styles.fieldValue}>{validState.situationEngine.situationText}</span>
                                </div>

                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Distillation Progress:</span>
                                    <span className={styles.fieldValue}>
                                        {validState.situationEngine.unreadCount}/10 unread messages
                                    </span>
                                </div>

                                {/* Unread counter progress bar (10 msgs OR 10 min triggers a pass) */}
                                <div style={{ width: "100%", height: "6px", background: "rgba(255,255,255,0.12)", borderRadius: "3px", overflow: "hidden" }}>
                                    <div
                                        style={{
                                            width: `${Math.min(100, (validState.situationEngine.unreadCount / 10) * 100)}%`,
                                            height: "100%",
                                            background: "#3b82f6"
                                        }}
                                    />
                                </div>

                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Last Distillation:</span>
                                    <span className={styles.fieldValue}>{validState.situationEngine.lastRunTime}</span>
                                </div>
                            </div>
                        </div>
                        )}

                        {/* Card 8: Needle Query Router (Tier 3) */}
                        {validState.needleRouter && (
                        <div className={styles.stateCard}>
                            <div className={styles.stateCardHeader}>
                                <h4 className={styles.stateCardTitle}>🎯 Needle Query Router</h4>
                                <span className={validState.needleRouter.isReady ? styles.badgeSuccess : styles.badgeWarning}>
                                    {validState.needleRouter.isReady ? "Wasm Ready" : "Fallback"}
                                </span>
                            </div>

                            <div className={styles.cardContentList}>
                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Worker Status:</span>
                                    <span className={styles.fieldValue}>
                                        {validState.needleRouter.isReady
                                            ? "Needle 2 worker online (300ms route budget)"
                                            : "Deterministic keyword fallback active"}
                                    </span>
                                </div>

                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Last Route:</span>
                                    <span className={styles.fieldValue}>{validState.needleRouter.lastRoute}</span>
                                </div>

                                <div className={styles.metaField}>
                                    <span className={styles.fieldLabel}>Last Memory Injected:</span>
                                    <span className={styles.fieldValue}>{validState.needleRouter.lastMemorySnippet}</span>
                                </div>
                            </div>
                        </div>
                        )}

                        {/* Card 9: Cast Real-Time States & Dynamic Memories */}
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

/**
 * Color-coded health badge for a pool model.
 * 🟢 Healthy • 🟡 Cooling Down [Xs left] • 🔴 Ejected
 *
 * @param {{ model: ModelPoolEntry }} props
 * @returns {React.JSX.Element}
 */
function HealthBadge({ model }) {
    if (model.status === "ejected") {
        return <span className={styles.badgeEjected}>🔴 Ejected</span>;
    }

    if (model.status === "cooling") {
        const seconds = Math.max(1, Math.ceil((model.cooldownRemainingMs || 0) / 1000));
        return <span className={styles.badgeCooling}>🟡 Cooling Down [{seconds}s left]</span>;
    }

    return <span className={styles.badgeHealthy}>🟢 Healthy</span>;
}

/**
 * Dedicated model-pool card with per-model tier/health badges and a Verify
 * button that fires a minimal 1-token probe at that exact model.
 *
 * @param {Object} props
 * @param {string} props.title Card heading.
 * @param {"groq"|"gemini"} props.provider Owning pool.
 * @param {string|null} [props.activeModel] Currently active model id, if any.
 * @param {ModelPoolEntry[]} props.models Pool snapshot.
 * @param {Record<string, ProbeState>} props.probeResults Inline probe states.
 * @param {(provider: "groq"|"gemini", modelId: string) => Promise<void>} props.onVerify Verify callback.
 * @returns {React.JSX.Element}
 */
function ModelPoolCard({ title, provider, activeModel, models, probeResults, onVerify }) {
    return (
        <div className={styles.stateCard}>
            <div className={styles.stateCardHeader}>
                <h4 className={styles.stateCardTitle}>{title}</h4>
                <span className={styles.badgeSecondary}>
                    {activeModel ? `Active: ${activeModel.split("/").pop()} · ` : ""}
                    {models.length} Model{models.length === 1 ? "" : "s"}
                </span>
            </div>

            {models.length === 0 ? (
                <span className={styles.emptyNote}>
                    No models discovered yet — add an API key or trigger discovery.
                </span>
            ) : (
                <div className={styles.modelList}>
                    {models.map((model) => {
                        const probe = probeResults[model.id];
                        return (
                            <div key={model.id} className={styles.modelRow}>
                                <div className={styles.modelRowTop}>
                                    <span className={styles.modelName} title={model.id}>
                                        {model.displayName}
                                    </span>
                                    <span className={styles.tierBadge}>
                                        Tier {model.tier} · v{model.version}
                                    </span>
                                    <HealthBadge model={model} />
                                </div>

                                <div className={styles.modelRowActions}>
                                    <code className={styles.modelCode}>{model.id}</code>
                                    <button
                                        type="button"
                                        className={styles.verifyBtn}
                                        disabled={Boolean(probe?.busy)}
                                        onClick={() => onVerify(provider, model.id)}
                                        title={`Send a 1-token probe to ${model.id}`}
                                    >
                                        {probe?.busy ? "Probing…" : "Verify"}
                                    </button>
                                    {probe && (
                                        <span
                                            className={probe.ok ? styles.probeOk : styles.probeErr}
                                            role="status"
                                        >
                                            {probe.label}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}