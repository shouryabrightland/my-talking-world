// @ts-check

import React, { useCallback, useEffect, useState } from "react";
import styles from "./PlannerDrawer.module.css";
import { useChat } from "../contexts/ChatContext";
import { useInputBox } from "../contexts/InputBoxContext";
import { WorldEvents } from "../classes/World";
import { PlannerStreamEvents } from "../classes/WorldSetter";

/**
 * @typedef {import("../classes/types/World.types").ScheduleRecord} ScheduleRecord
 * @typedef {import("../classes/types/World.types").CharacterGoalRecord} CharacterGoalRecord
 * @typedef {import("../classes/types/World.types").DemandResolutionResult} DemandResolutionResult
 * @typedef {import("../classes/types/World.types").DemandReport} DemandReport
 * @typedef {import("../classes/types/World.types").ScheduleProposal} ScheduleProposal
 * @typedef {import("../classes/types/World.types").ProposedChange} ProposedChange
 */

/**
 * @typedef {Object} ScheduleFormState
 * @property {number} startHour Start hour decimal (e.g. 14.5 for 14:30).
 * @property {number} endHour End hour decimal (e.g. 16.0 for 16:00).
 * @property {string} topic Core topic description.
 * @property {string} mainGoal Main overarching objective.
 * @property {CharacterGoalRecord[]} characterGoals Individual character goals.
 * @property {string[]} facts Array of interactive fact tags.
 * @property {string} tagInput Current text inside the tag chip input.
 * @property {string} prePlot Context of what happened prior.
 * @property {string} postPlot Expected aftermath leading to next scene.
 */

/**
 * Formats a decimal hour into standard 24-hour clock string (e.g. 14.5 -> "14:30").
 *
 * @param {number} decimal
 * @returns {string}
 */
function formatHour(decimal) {
    const h = Math.floor(decimal);
    const m = Math.round((decimal - h) * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Storyline Planner with inline in-place editing, expandable read-only inspection,
 * animated block reordering, and automatic expired block pruning.
 *
 * @returns {React.JSX.Element}
 */
export default function PlannerDrawer() {
    const conv = useChat();
    const { world } = conv;
    const { isPlannerOpen, setIsPlannerOpen } = useInputBox();

    /** @type {[ScheduleRecord[], React.Dispatch<React.SetStateAction<ScheduleRecord[]>>]} */
    const [records, setRecords] = useState(() => world?.worldSetter?.getRecords() || []);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isDirty, setIsDirty] = useState(() => world?.worldSetter?.isDirty || false);

    // Expanded cards (read-only inspection mode)
    /** @type {[Set<string>, React.Dispatch<React.SetStateAction<Set<string>>>]} */
    const [expandedCardIds, setExpandedCardIds] = useState(() => new Set());

    // In-place editing: which card ID is currently in edit mode (null = none)
    /** @type {[string|null, React.Dispatch<React.SetStateAction<string|null>>]} */
    const [editingCardId, setEditingCardId] = useState(/** @type {string|null} */ (null));

    // Reorder animation state
    /** @type {[string|null, React.Dispatch<React.SetStateAction<string|null>>]} */
    const [reorderingId, setReorderingId] = useState(/** @type {string|null} */ (null));

    // Director Demand Engine State
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [demandInput, setDemandInput] = useState("");
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isApplyingDemand, setIsApplyingDemand] = useState(false);
    /** @type {[DemandReport | null, React.Dispatch<React.SetStateAction<DemandReport | null>>]} */
    const [demandReport, setDemandReport] = useState(/** @type {DemandReport | null} */ (null));
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isReportMinimized, setIsReportMinimized] = useState(false);

    // Proposal Approval State
    /** @type {[ScheduleProposal | null, React.Dispatch<React.SetStateAction<ScheduleProposal | null>>]} */
    const [proposal, setProposal] = useState(/** @type {ScheduleProposal | null} */ (null));

    // Real-time Planner Stream State
    /** @type {[Partial<ScheduleRecord>[], React.Dispatch<React.SetStateAction<Partial<ScheduleRecord>[]>>]} */
    const [streamingBlocks, setStreamingBlocks] = useState(/** @type {Partial<ScheduleRecord>[]} */ ([]));
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isStreaming, setIsStreaming] = useState(false);
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [streamPhase, setStreamPhase] = useState("");

    // Inline Edit Form State (per-card)
    /** @type {[ScheduleFormState, React.Dispatch<React.SetStateAction<ScheduleFormState>>]} */
    const [editForm, setEditForm] = useState({
        startHour: 14,
        endHour: 15,
        topic: "",
        mainGoal: "",
        characterGoals: /** @type {CharacterGoalRecord[]} */ ([]),
        facts: /** @type {string[]} */ ([]),
        tagInput: "",
        prePlot: "",
        postPlot: ""
    });

    const activeScheduleId = world?.activeSchedule?.id ?? null;

    const refreshRecords = useCallback(() => {
        if (world?.worldSetter) {
            setRecords(world.worldSetter.getRecords());
            setIsDirty(world.worldSetter.isDirty);
        }
    }, [world]);

    useEffect(() => {
        if (!world) return;

        const offSchedule = world.events.on(
            WorldEvents.SCHEDULE_CHANGE,
            refreshRecords,
            "PlannerDrawer: schedule change"
        );
        const offHour = world.events.on(
            WorldEvents.HOUR_CHANGE,
            refreshRecords,
            "PlannerDrawer: hour change"
        );

        refreshRecords();
        return () => {
            offSchedule();
            offHour();
        };
    }, [world, refreshRecords]);

    // Listen for real-time planner stream events
    useEffect(() => {
        if (!world) return;

        const offStart = world.events.on(
            PlannerStreamEvents.START,
            () => {
                setIsStreaming(true);
                setStreamingBlocks([]);
                setStreamPhase("Connecting to AI model...");
            },
            "PlannerDrawer: stream start"
        );

        const offText = world.events.on(
            PlannerStreamEvents.TEXT,
            (/** @type {string} */ text) => {
                const hasSchedule = text.includes("<schedule");
                const blockCount = (text.match(/<\s*block\b/gi) || []).length;
                if (hasSchedule && blockCount > 0) {
                    setStreamPhase(`Generating block ${blockCount}...`);
                } else if (hasSchedule) {
                    setStreamPhase("Parsing schedule...");
                } else {
                    setStreamPhase("Thinking...");
                }
            },
            "PlannerDrawer: stream text"
        );

        const offBlock = world.events.on(
            PlannerStreamEvents.BLOCK,
            (/** @type {Partial<ScheduleRecord>} */ block) => {
                setStreamingBlocks(prev => {
                    const exists = prev.some(b => b.startHour === block.startHour && b.endHour === block.endHour);
                    if (exists) return prev;
                    return [...prev, block];
                });
            },
            "PlannerDrawer: stream block"
        );

        const offDone = world.events.on(
            PlannerStreamEvents.DONE,
            () => {
                setIsStreaming(false);
                setStreamPhase("");
                setTimeout(() => setStreamingBlocks([]), 500);
            },
            "PlannerDrawer: stream done"
        );

        const offError = world.events.on(
            PlannerStreamEvents.ERROR,
            () => {
                setIsStreaming(false);
                setStreamPhase("Stream failed. Retrying...");
                setTimeout(() => setStreamPhase(""), 2000);
            },
            "PlannerDrawer: stream error"
        );

        return () => {
            offStart();
            offText();
            offBlock();
            offDone();
            offError();
        };
    }, [world]);

    // ─── Card Expansion (Read-Only Inspection) ──────────────────────────

    const toggleCardExpansion = useCallback((/** @type {string} */ id) => {
        // Close any inline edit when toggling expansion
        setEditingCardId(null);
        setExpandedCardIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    // ─── Inline Edit Handlers ────────────────────────────────────────────

    const handleStartEdit = useCallback((/** @type {ScheduleRecord} */ record) => {
        setEditingCardId(record.id);
        setEditForm({
            startHour: record.startHour,
            endHour: record.endHour,
            topic: record.topic,
            mainGoal: record.mainGoal || "",
            characterGoals: Array.isArray(record.characterGoals) ? record.characterGoals.map(cg => ({ ...cg })) : [],
            facts: [...record.facts],
            tagInput: "",
            prePlot: record.prePlot || "",
            postPlot: record.postPlot || ""
        });
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingCardId(null);
    }, []);

    const handleSaveEdit = useCallback(async (/** @type {string} */ recordId) => {
        if (!world?.worldSetter || !editForm.topic.trim()) return;

        await world.worldSetter.updateRecord(recordId, {
            startHour: editForm.startHour,
            endHour: editForm.endHour,
            topic: editForm.topic.trim(),
            mainGoal: editForm.mainGoal.trim(),
            characterGoals: editForm.characterGoals,
            facts: editForm.facts,
            prePlot: editForm.prePlot.trim(),
            postPlot: editForm.postPlot.trim()
        });

        setEditingCardId(null);
        refreshRecords();
    }, [world, editForm, refreshRecords]);

    // ─── Tag Chip Handlers ───────────────────────────────────────────────

    const handleAddTag = useCallback(() => {
        const tag = editForm.tagInput.trim().replace(/^#/, "");
        if (tag && !editForm.facts.includes(tag)) {
            setEditForm(prev => ({ ...prev, facts: [...prev.facts, tag], tagInput: "" }));
        }
    }, [editForm.tagInput, editForm.facts]);

    const handleRemoveTag = useCallback((/** @type {string} */ tagToRemove) => {
        setEditForm(prev => ({ ...prev, facts: prev.facts.filter(t => t !== tagToRemove) }));
    }, []);

    // ─── Reorder Handlers ────────────────────────────────────────────────

    const handleReorder = useCallback(async (/** @type {string} */ recordId, /** @type {'up' | 'down'} */ direction) => {
        if (!world?.worldSetter) return;

        const idx = records.findIndex(r => r.id === recordId);
        if (idx === -1) return;

        setReorderingId(recordId);

        // Smooth animation delay
        await new Promise(r => setTimeout(r, 250));

        world.worldSetter.reorderBlocks(idx, direction);
        refreshRecords();

        setReorderingId(null);
    }, [world, records, refreshRecords]);

    // ─── Director Demand ─────────────────────────────────────────────────

    const handleApplyDemand = useCallback(async (/** @type {React.FormEvent} */ e) => {
        e.preventDefault();
        const clean = demandInput.trim();
        if (!clean || !world?.worldSetter || isApplyingDemand) return;

        setIsApplyingDemand(true);
        setDemandReport(null);
        setIsReportMinimized(false);

        try {
            const result = await world.worldSetter.applyUserDemand(clean);
            const report = result.report || { summary: `${result.line1} — ${result.line2}` };
            setDemandReport(report);
            setIsReportMinimized(false);
            setDemandInput("");
            // Load the pending proposal from worldSetter
            const p = world.worldSetter.pendingProposal;
            setProposal(p ? { ...p } : null);
            refreshRecords();
        } catch (/** @type {unknown} */ err) {
            console.error("[Scheduler] Demand application failed:", err);
        } finally {
            setIsApplyingDemand(false);
        }
    }, [demandInput, world, isApplyingDemand, refreshRecords]);

    // ─── Proposal Accept/Deny ──────────────────────────────────────────

    const handleAcceptProposal = useCallback(async () => {
        if (!world?.worldSetter || !proposal) return;
        await world.worldSetter.acceptProposal();
        setProposal(null);
        setDemandReport(null);
        refreshRecords();
    }, [world, proposal, refreshRecords]);

    const handleDenyProposal = useCallback(() => {
        if (!world?.worldSetter || !proposal) return;
        world.worldSetter.denyProposal();
        setProposal(null);
        setDemandReport(null);
        refreshRecords();
    }, [world, proposal, refreshRecords]);

    // ─── Manual Edit Action Bar ──────────────────────────────────────────

    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [stabilizationError, setStabilizationError] = useState("");
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isStabilizing, setIsStabilizing] = useState(false);

    const handleDiscardManual = useCallback(async () => {
        if (!world?.worldSetter) return;
        setStabilizationError("");
        await world.worldSetter.discardManualChanges();
        refreshRecords();
    }, [world, refreshRecords]);

    const handleStabilizeSave = useCallback(async () => {
        if (!world?.worldSetter || isStabilizing) return;
        setIsStabilizing(true);
        setStabilizationError("");

        try {
            const result = await world.worldSetter.restabilizeAndSave();
            if (result.success) {
                setStabilizationError("");
            } else {
                setStabilizationError(result.message);
            }
            refreshRecords();
        } catch (/** @type {unknown} */ err) {
            setStabilizationError(err instanceof Error ? err.message : "Stabilization failed.");
        } finally {
            setIsStabilizing(false);
        }
    }, [world, isStabilizing, refreshRecords]);

    const handleDirectSave = useCallback(async () => {
        if (!world?.worldSetter) return;
        try {
            await world.worldSetter.directSave();
        } catch (/** @type {unknown} */ err) {
            setStabilizationError(err instanceof Error ? err.message : "Direct save failed.");
        }
    }, [world]);

    // ─── Delete ──────────────────────────────────────────────────────────

    const handleDeleteRecord = useCallback(async (/** @type {string} */ id) => {
        if (!world?.worldSetter) return;
        await world.worldSetter.deleteRecord(id);
        refreshRecords();
    }, [world, refreshRecords]);

    return (
        <div
            className={`${styles.drawerOverlay} ${isPlannerOpen ? styles.drawerOverlayVisible : ""}`}
            onClick={() => setIsPlannerOpen(false)}
        >
            <div
                className={`${styles.drawerCard} ${isPlannerOpen ? styles.drawerCardVisible : ""}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Fixed Header */}
                <div className={styles.drawerHeader}>
                    <div className={styles.headerTitleGroup}>
                        <span className={styles.planBadge}>NARRATIVE ENGINE</span>
                        <h3 className={styles.drawerTitle}>Storyline Scheduler</h3>
                    </div>
                    <button
                        onClick={() => setIsPlannerOpen(false)}
                        className={styles.closeBtn}
                        aria-label="Close scheduler"
                    >
                        ✕
                    </button>
                </div>

                {/* Fluid Scrollable Body */}
                <div className={styles.scrollBody}>
                    {/* Director Demand Form */}
                    <form onSubmit={handleApplyDemand} className={styles.demandCard}>
                        <div className={styles.demandHeader}>
                            <span className={styles.demandTitle}>🎬 Director Demand Engine</span>
                            <span className={styles.demandSubtitle}>Groq will contextualize your demand & inject lead-up hooks</span>
                        </div>

                        <div className={styles.demandInputRow}>
                            <input
                                placeholder="e.g. 'I want to study physics at 5pm'"
                                value={demandInput}
                                onChange={(e) => setDemandInput(e.target.value)}
                                disabled={isApplyingDemand}
                                className={styles.demandInput}
                            />
                            <button
                                type="submit"
                                disabled={!demandInput.trim() || isApplyingDemand}
                                className={styles.demandBtn}
                            >
                                {isApplyingDemand ? "Applying..." : "⚡ Apply Demand"}
                            </button>
                        </div>

                        {demandReport && (
                            <div className={`${styles.narrativeReport} ${isReportMinimized ? styles.narrativeReportMinimized : ""}`}>
                                {/* Report Header Row */}
                                <div className={styles.reportHeaderRow}>
                                    <span className={styles.reportHeaderTitle}>📋 Narrative Update Report</span>
                                    <div className={styles.reportHeaderActions}>
                                        <button
                                            type="button"
                                            className={styles.reportToggleBtn}
                                            onClick={() => setIsReportMinimized(prev => !prev)}
                                            aria-label={isReportMinimized ? "Expand report" : "Minimize report"}
                                        >
                                            {isReportMinimized ? "▼" : "▲"}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.reportDismissBtn}
                                            onClick={() => { setDemandReport(null); setIsReportMinimized(false); }}
                                            aria-label="Dismiss report"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>

                                {/* Report Body (collapsible) */}
                                {!isReportMinimized && (
                                    <div className={styles.reportBody}>
                                        {/* Summary */}
                                        <div className={styles.reportSection}>
                                            <span className={styles.reportSectionLabel}>💡 Summary</span>
                                            <p className={styles.reportSectionText}>{demandReport.summary}</p>
                                        </div>

                                        {/* Continuity Impact */}
                                        {demandReport.continuityImpact && (
                                            <div className={styles.reportSection}>
                                                <span className={styles.reportSectionLabel}>🔗 Continuity Impact</span>
                                                <p className={styles.reportSectionText}>{demandReport.continuityImpact}</p>
                                            </div>
                                        )}

                                        {/* Character Shifts */}
                                        {Array.isArray(demandReport.characterShifts) && demandReport.characterShifts.length > 0 && (
                                            <div className={styles.reportSection}>
                                                <span className={styles.reportSectionLabel}>🎭 Character Shifts</span>
                                                <div className={styles.reportShiftsList}>
                                                    {demandReport.characterShifts.map((shift) => (
                                                        <div key={shift.id} className={styles.reportShiftItem}>
                                                            <span className={styles.reportShiftName}>{shift.name}:</span>
                                                            <span className={styles.reportShiftMotivation}>{shift.motivation}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Transition Hooks */}
                                        {demandReport.transitionHooks && (
                                            <div className={styles.reportSection}>
                                                <span className={styles.reportSectionLabel}>🪝 Transition Hooks</span>
                                                <p className={styles.reportSectionText}>{demandReport.transitionHooks}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </form>

                    {/* Proposal Callout — AI/Director Proposed Changes */}
                    {proposal && proposal.changes.length > 0 && (
                        <div className={styles.proposalCallout}>
                            <div className={styles.proposalHeader}>
                                <span className={styles.proposalTitle}>🤖 AI Proposed Changes</span>
                                <span className={styles.proposalSummary}>{proposal.summary}</span>
                            </div>
                            <div className={styles.proposalActions}>
                                <button
                                    onClick={handleAcceptProposal}
                                    className={styles.proposalAcceptBtn}
                                >
                                    ✓ Accept
                                </button>
                                <button
                                    onClick={handleDenyProposal}
                                    className={styles.proposalDenyBtn}
                                >
                                    ✕ Deny
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Dynamic Action Bar — Manual Edit Controls */}
                    {isDirty && !proposal && (
                        <div className={styles.actionBar}>
                            <div className={styles.actionBtnRow}>
                                <button
                                    onClick={handleDiscardManual}
                                    className={styles.discardBtn}
                                    title="Discard unsaved manual changes"
                                >
                                    ↩ Discard
                                </button>
                                <button
                                    onClick={handleStabilizeSave}
                                    className={styles.stabilizeSaveBtn}
                                    disabled={isStabilizing}
                                    title="AI-stabilize and persist schedule"
                                >
                                    {isStabilizing ? "⏳ Stabilizing..." : "🔬 Stabilize & Save"}
                                </button>
                            </div>
                            {stabilizationError && (
                                <div className={styles.stabilizationError}>
                                    <span className={styles.stabilizationErrorIcon}>⚠️</span>
                                    <span className={styles.stabilizationErrorText}>{stabilizationError}</span>
                                    <button
                                        className={styles.stabilizationErrorDismiss}
                                        onClick={() => setStabilizationError("")}
                                        aria-label="Dismiss error"
                                    >
                                        ✕
                                    </button>
                                </div>
                            )}
                            <span className={styles.dirtyBadge}>● Unsaved Changes — Requires Stabilization</span>
                        </div>
                    )}

                    {/* Real-time Streaming Progress */}
                    {isStreaming && (
                        <div className={styles.streamProgress}>
                            <div className={styles.streamHeader}>
                                <span className={styles.streamDot} />
                                <span className={styles.streamPhase}>{streamPhase || "Generating schedule..."}</span>
                            </div>
                            {streamingBlocks.map((block, idx) => {
                                const sHour = block.startHour ?? 0;
                                const eHour = block.endHour ?? sHour + 1;
                                const h1 = Math.floor(sHour);
                                const m1 = Math.round((sHour - h1) * 60);
                                const h2 = Math.floor(eHour);
                                const m2 = Math.round((eHour - h2) * 60);
                                const tr = `${String(h1).padStart(2, "0")}:${String(m1).padStart(2, "0")} - ${String(h2).padStart(2, "0")}:${String(m2).padStart(2, "0")}`;

                                return (
                                    <div key={`stream-${idx}-${sHour}`} className={`${styles.sceneCard} ${styles.sceneCardStreaming}`}>
                                        <div className={styles.minimizedHeader}>
                                            <div className={styles.minimizedTitleGroup}>
                                                <span className={styles.timeBadgeStreaming}>{tr}</span>
                                                <h4 className={styles.minimizedTitle}>{block.topic || "Generating..."}</h4>
                                            </div>
                                            <span className={styles.streamSpinner}>⏳</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Timeline Card List */}
                    <div className={styles.timelineList}>
                        {records.map((record, idx) => {
                            const isCurrent = record.id === activeScheduleId;
                            const isExpanded = expandedCardIds.has(record.id);
                            const isEditing = editingCardId === record.id;
                            const isReordering = reorderingId === record.id;
                            const isFirst = idx === 0;
                            const isLast = idx === records.length - 1;

                            // Diff indicators: check if this block is proposed or removed
                            const isProposed = proposal?.changes.some(c => c.action === "add" && c.block.id === record.id);
                            const isRemoved = proposal?.changes.some(c => c.action === "remove" && c.block.id === record.id);
                            const diffClass = isProposed ? styles.sceneCardProposed : (isRemoved ? styles.sceneCardRemoved : "");

                            return (
                                <div
                                    key={record.id}
                                    className={`${styles.sceneCard} ${isCurrent ? styles.sceneCardCurrent : ""} ${isReordering ? styles.sceneCardReordering : ""} ${diffClass}`}
                                    style={isReordering ? { transform: "translate3d(0, -4px, 0)", opacity: 0.7 } : undefined}
                                >
                                    {/* ─── Card Header (always visible) ─── */}
                                    <div className={styles.cardHeaderRow}>
                                        {/* Reorder Controls */}
                                        <div className={styles.reorderControls}>
                                            <button
                                                type="button"
                                                className={styles.reorderBtn}
                                                onClick={() => handleReorder(record.id, "up")}
                                                disabled={isFirst || isReordering || !!editingCardId}
                                                aria-label="Move block up"
                                                title="Move up"
                                            >
                                                ▲
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.reorderBtn}
                                                onClick={() => handleReorder(record.id, "down")}
                                                disabled={isLast || isReordering || !!editingCardId}
                                                aria-label="Move block down"
                                                title="Move down"
                                            >
                                                ▼
                                            </button>
                                        </div>

                                        {/* Title & Time (clickable to expand) */}
                                        <div
                                            className={styles.minimizedHeader}
                                            onClick={() => toggleCardExpansion(record.id)}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${record.topic}`}
                                        >
                                            <div className={styles.minimizedTitleGroup}>
                                                <span className={isCurrent ? styles.timeBadgeCurrent : styles.timeBadge}>
                                                    {record.timeRange} {isCurrent && "• ACTIVE"}
                                                </span>
                                                <h4 className={styles.minimizedTitle}>{record.topic}</h4>
                                                {isProposed && <span className={styles.diffBadgeProposed}>+ PROPOSED</span>}
                                                {isRemoved && <span className={styles.diffBadgeRemoved}>− REMOVED</span>}
                                            </div>
                                        </div>

                                        {/* Accordion Toggle */}
                                        <button
                                            type="button"
                                            className={styles.accordionToggleBtn}
                                            onClick={() => toggleCardExpansion(record.id)}
                                            aria-label={isExpanded ? "Minimize block" : "Maximize block"}
                                        >
                                            {isExpanded ? "▲" : "▼"}
                                        </button>
                                    </div>

                                    {/* ─── Expanded Read-Only Inspection ─── */}
                                    {isExpanded && !isEditing && (
                                        <div className={styles.expandedBody}>
                                            <p className={styles.scenePlot}><strong>🎯 Main Goal:</strong> {record.mainGoal || "Casual conversation"}</p>

                                            {Array.isArray(record.characterGoals) && record.characterGoals.length > 0 && (
                                                <div className={styles.charGoalsList}>
                                                    {record.characterGoals.map((cg) => (
                                                        <span key={cg.id} className={styles.charGoalItem}>
                                                            • <strong>{cg.name}:</strong> {cg.goal}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {(record.prePlot || record.postPlot) && (
                                                <div className={styles.plotContextRow}>
                                                    {record.prePlot && (
                                                        <span className={styles.prePlotBadge} title={`Buildup: ${record.prePlot}`}>
                                                            ⏮️ <strong>Pre:</strong> {record.prePlot}
                                                        </span>
                                                    )}
                                                    {record.postPlot && (
                                                        <span className={styles.postPlotBadge} title={`Aftermath: ${record.postPlot}`}>
                                                            ⏭️ <strong>Post:</strong> {record.postPlot}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {record.facts.length > 0 && (
                                                <div className={styles.metaRow}>
                                                    {record.facts.map((fact, fi) => (
                                                        <span key={fi} className={styles.metaChip}>
                                                            🏷️ {fact}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className={styles.cardActionRow}>
                                                <button
                                                    onClick={() => handleStartEdit(record)}
                                                    className={styles.editBtn}
                                                >
                                                    ✏️ Edit Block
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteRecord(record.id)}
                                                    className={styles.deleteBtn}
                                                    title="Delete block"
                                                    aria-label="Delete block"
                                                >
                                                    🗑️ Delete
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* ─── In-Place Inline Edit Form ─── */}
                                    {isExpanded && isEditing && (
                                        <div className={styles.inlineEditForm}>
                                            {/* Timeline Slider */}
                                            <div className={styles.sliderGroup}>
                                                <div className={styles.sliderLabelRow}>
                                                    <span className={styles.sliderLabel}>Timeline Window:</span>
                                                    <span className={styles.sliderValueBadge}>
                                                        {formatHour(editForm.startHour)} - {formatHour(editForm.endHour)} ({editForm.endHour - editForm.startHour}h)
                                                    </span>
                                                </div>
                                                <div className={styles.dualSliderRow}>
                                                    <div className={styles.sliderCol}>
                                                        <span className={styles.sliderSubLabel}>Start: {formatHour(editForm.startHour)}</span>
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="23.5"
                                                            step="0.5"
                                                            value={editForm.startHour}
                                                            onChange={(e) => {
                                                                const newStart = Number(e.target.value);
                                                                setEditForm(prev => ({
                                                                    ...prev,
                                                                    startHour: newStart,
                                                                    endHour: Math.max(newStart + 0.5, prev.endHour)
                                                                }));
                                                            }}
                                                            className={styles.rangeSlider}
                                                        />
                                                    </div>
                                                    <div className={styles.sliderCol}>
                                                        <span className={styles.sliderSubLabel}>End: {formatHour(editForm.endHour)}</span>
                                                        <input
                                                            type="range"
                                                            min="0.5"
                                                            max="24"
                                                            step="0.5"
                                                            value={editForm.endHour}
                                                            onChange={(e) => {
                                                                const newEnd = Number(e.target.value);
                                                                setEditForm(prev => ({
                                                                    ...prev,
                                                                    endHour: Math.max(prev.startHour + 0.5, newEnd)
                                                                }));
                                                            }}
                                                            className={styles.rangeSlider}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <label className={styles.formLabel}>Topic to Discuss:</label>
                                            <input
                                                value={editForm.topic}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, topic: e.target.value }))}
                                                placeholder="e.g. Creative project brainstorm"
                                                className={styles.formInput}
                                            />

                                            <label className={styles.formLabel}>Main Session Goal:</label>
                                            <input
                                                value={editForm.mainGoal}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, mainGoal: e.target.value }))}
                                                placeholder="e.g. Plan project details"
                                                className={styles.formInput}
                                            />

                                            {/* Tag Chips */}
                                            <label className={styles.formLabel}>Context Facts (Tags):</label>
                                            <div className={styles.tagChipsContainer}>
                                                {editForm.facts.map((tag, ti) => (
                                                    <span key={ti} className={styles.tagChip}>
                                                        🏷️ {tag}
                                                        <button type="button" onClick={() => handleRemoveTag(tag)} className={styles.tagRemoveBtn} aria-label="Remove tag">✕</button>
                                                    </span>
                                                ))}
                                                <div className={styles.tagInputWrapper}>
                                                    <input
                                                        value={editForm.tagInput}
                                                        onChange={(e) => setEditForm(prev => ({ ...prev, tagInput: e.target.value }))}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" || e.key === ",") {
                                                                e.preventDefault();
                                                                handleAddTag();
                                                            }
                                                        }}
                                                        placeholder="Type tag & Enter..."
                                                        className={styles.tagInput}
                                                    />
                                                    <button type="button" onClick={handleAddTag} disabled={!editForm.tagInput.trim()} className={styles.tagAddBtn}>+ Add</button>
                                                </div>
                                            </div>

                                            <div className={styles.plotInputGrid}>
                                                <div className={styles.plotInputCol}>
                                                    <label className={styles.formLabel}>Pre-Plot (Buildup):</label>
                                                    <input
                                                        value={editForm.prePlot}
                                                        onChange={(e) => setEditForm(prev => ({ ...prev, prePlot: e.target.value }))}
                                                        placeholder="What led into this scene"
                                                        className={styles.formInput}
                                                    />
                                                </div>
                                                <div className={styles.plotInputCol}>
                                                    <label className={styles.formLabel}>Post-Plot (Aftermath):</label>
                                                    <input
                                                        value={editForm.postPlot}
                                                        onChange={(e) => setEditForm(prev => ({ ...prev, postPlot: e.target.value }))}
                                                        placeholder="What this leads to next"
                                                        className={styles.formInput}
                                                    />
                                                </div>
                                            </div>

                                            <div className={styles.editBtnRow}>
                                                <button onClick={handleCancelEdit} className={styles.btnCancel}>Cancel</button>
                                                <button
                                                    onClick={() => handleSaveEdit(record.id)}
                                                    disabled={!editForm.topic.trim()}
                                                    className={styles.btnSave}
                                                >
                                                    Save Changes
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
