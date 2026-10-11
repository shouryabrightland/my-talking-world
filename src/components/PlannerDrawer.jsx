// @ts-check

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * @property {string} denseParagraph Macro atmospheric scene paragraph.
 * @property {string} type Recurrence preset (once/forever/weekdays/weekends).
 * @property {string} typeDate Optional specific calendar date (e.g. "9 oct").
 * @property {string} mainGoal Main overarching objective.
 * @property {CharacterGoalRecord[]} characterGoals Individual character goals.
 * @property {string[]} facts Array of interactive fact tags.
 * @property {string} tagInput Current text inside the tag chip input.
 */

/**
 * Formats a decimal hour into standard 24-hour clock string (e.g. 14.5 -> "14:30").
 * Minute-overflow safe: 14.999 renders "15:00" (never "14:60") and values
 * past midnight clamp to "24:00" (Task 2).
 *
 * @param {number} decimal
 * @returns {string}
 */
function formatHour(decimal) {
    let h = Math.floor(decimal);
    let m = Math.round((decimal - h) * 60);
    if (m >= 60) { h += 1; m = 0; }
    if (h >= 24) { h = 24; m = 0; }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Human-readable recurrence pill label (null for one-off "once" blocks).
 *
 * @param {string|undefined} type
 * @returns {string|null}
 */
function formatRecurrenceLabel(type) {
    if (!type || type === "once") return null;
    if (type === "forever") return "Daily";
    if (type === "weekdays") return "Weekdays";
    if (type === "weekends") return "Weekends";
    return type; // specific calendar date, e.g. "9 oct"
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

    /** Mutable mirror of the active planner model for stream phase labels. @type {React.MutableRefObject<string|null>} */
    const streamModelRef = useRef(/** @type {string|null} */ (null));

    // Auto-scroll targets
    /** @type {React.MutableRefObject<HTMLDivElement|null>} */ const scrollBodyRef = useRef(null);
    /** @type {React.MutableRefObject<HTMLDivElement|null>} */ const proposalRef = useRef(null);
    /** @type {React.MutableRefObject<HTMLDivElement|null>} */ const streamProgressRef = useRef(null);
    /** @type {React.MutableRefObject<HTMLDivElement|null>} */ const timelineListRef = useRef(null);
    /** Previous record count for "block added" auto-scroll detection. @type {React.MutableRefObject<number|null>} */
    const prevRecordCount = useRef(/** @type {number|null} */ (null));

    // Inline Edit Form State (per-card)
    /** @type {[ScheduleFormState, React.Dispatch<React.SetStateAction<ScheduleFormState>>]} */
    const [editForm, setEditForm] = useState({
        startHour: 14,
        endHour: 15,
        topic: "",
        denseParagraph: "",
        type: "once",
        typeDate: "",
        mainGoal: "",
        characterGoals: /** @type {CharacterGoalRecord[]} */ ([]),
        facts: /** @type {string[]} */ ([]),
        tagInput: ""
    });

    // ─── Hybrid Planner: Filters, Templates & Creation ───
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [filterMode, setFilterMode] = useState("all"); // "all" | "today" | "templates"
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [searchQuery, setSearchQuery] = useState("");
    /** @type {[ScheduleRecord[], React.Dispatch<React.SetStateAction<ScheduleRecord[]>>]} */
    const [templates, setTemplates] = useState(() => world?.worldSetter?.getTemplates?.() || []);
    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isCreating, setIsCreating] = useState(false);
    /** @type {[ScheduleFormState, React.Dispatch<React.SetStateAction<ScheduleFormState>>]} */
    const [createForm, setCreateForm] = useState({
        startHour: 14,
        endHour: 15,
        topic: "",
        denseParagraph: "",
        type: "once",
        typeDate: "",
        mainGoal: "",
        characterGoals: /** @type {CharacterGoalRecord[]} */ ([]),
        facts: /** @type {string[]} */ ([]),
        tagInput: ""
    });

    const activeScheduleId = world?.activeSchedule?.id ?? null;

    /** Ids of today's placed blocks — used to spot template-only cards. */
    const todayIdSet = useMemo(() => new Set(records.map(r => r.id)), [records]);

    const refreshRecords = useCallback(() => {
        if (world?.worldSetter) {
            setRecords(world.worldSetter.getRecords());
            setIsDirty(world.worldSetter.isDirty);
            setTemplates(world.worldSetter.getTemplates ? world.worldSetter.getTemplates() : []);
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
            (/** @type {{ model?: string }} */ payload) => {
                const model = payload?.model || null;
                streamModelRef.current = model;
                setIsStreaming(true);
                setStreamingBlocks([]);
                setStreamPhase(model ? `🧠 [${model}] Thinking & Structuring Scene...` : "🧠 Thinking & structuring scene...");
            },
            "PlannerDrawer: stream start"
        );

        const offText = world.events.on(
            PlannerStreamEvents.TEXT,
            (/** @type {string} */ text) => {
                const model = streamModelRef.current;
                const prefix = model ? `⚡ [${model}] ` : "⚡ ";
                // `text` is reasoning-stripped output — block detection can only
                // fire on real <schedule> XML, never on a thought preamble.
                const hasSchedule = text.includes("<schedule");
                const blockCount = (text.match(/<\s*block\b/gi) || []).length;
                if (hasSchedule && blockCount > 0) {
                    setStreamPhase(`${prefix}Generating block ${blockCount} of ${Math.max(3, blockCount)}...`);
                } else if (hasSchedule) {
                    setStreamPhase(`${prefix}Structuring schedule...`);
                } else {
                    setStreamPhase(model ? `🧠 [${model}] Thinking & Structuring Scene...` : "🧠 Thinking & Structuring Scene...");
                }
            },
            "PlannerDrawer: stream text"
        );

        const offThinking = world.events.on(
            PlannerStreamEvents.THINKING,
            () => {
                const model = streamModelRef.current;
                setStreamPhase(model ? `🧠 [${model}] Thinking & Structuring Scene...` : "🧠 Thinking & Structuring Scene...");
            },
            "PlannerDrawer: stream thinking"
        );

        const offFailover = world.events.on(
            PlannerStreamEvents.FAILOVER,
            (/** @type {{ fromModel?: string, toModel?: string|null, status?: number|null, reason?: string }} */ payload) => {
                const from = payload?.fromModel || "unknown model";
                const to = payload?.toModel || null;
                const reason = payload?.status === 429 ? "Rate limited"
                    : payload?.status === 503 ? "Service unavailable"
                    : payload?.status === 404 ? "Model unavailable"
                    : (payload?.reason || "Model failed");

                streamModelRef.current = to;
                setStreamPhase(to
                    ? `⚠️ [${from}] ${reason}, switching to [${to}]...`
                    : `⚠️ [${from}] ${reason}, no alternate model left...`);
            },
            "PlannerDrawer: stream failover"
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
                streamModelRef.current = null;
                setTimeout(() => setStreamingBlocks([]), 500);
            },
            "PlannerDrawer: stream done"
        );

        const offError = world.events.on(
            PlannerStreamEvents.ERROR,
            () => {
                setIsStreaming(false);
                setStreamPhase("Stream failed. Retrying...");
                streamModelRef.current = null;
                setTimeout(() => setStreamPhase(""), 2000);
            },
            "PlannerDrawer: stream error"
        );

        return () => {
            offStart();
            offText();
            offThinking();
            offFailover();
            offBlock();
            offDone();
            offError();
        };
    }, [world]);

    // ─── Auto-Scroll to Proposed / Newly Added Blocks ───────────────────

    // Scroll to the proposal callout when a new proposal is generated.
    useEffect(() => {
        if (!isPlannerOpen || !proposal) return;
        proposalRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [proposal, isPlannerOpen]);

    // Scroll to the live streaming progress box as blocks stream in.
    useEffect(() => {
        if (!isPlannerOpen || streamingBlocks.length === 0) return;
        streamProgressRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [streamingBlocks.length, isPlannerOpen]);

    // Scroll to the newest card whenever a block is added to the timeline.
    useEffect(() => {
        if (prevRecordCount.current === null) {
            prevRecordCount.current = records.length;
            return;
        }
        if (records.length > prevRecordCount.current && isPlannerOpen) {
            const list = timelineListRef.current;
            list?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        prevRecordCount.current = records.length;
    }, [records.length, isPlannerOpen]);

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
        const rawType = record.type || "once";
        const isPreset = ["once", "forever", "weekdays", "weekends"].includes(rawType);

        setEditingCardId(record.id);
        setEditForm({
            startHour: record.startHour,
            endHour: record.endHour,
            topic: record.topic,
            denseParagraph: record.denseParagraph || "",
            type: isPreset ? rawType : "once",
            typeDate: isPreset ? "" : rawType,
            mainGoal: record.mainGoal || "",
            characterGoals: Array.isArray(record.characterGoals) ? record.characterGoals.map(cg => ({ ...cg })) : [],
            facts: [...record.facts],
            tagInput: ""
        });
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingCardId(null);
    }, []);

    const handleSaveEdit = useCallback(async (/** @type {string} */ recordId) => {
        if (!world?.worldSetter || !editForm.topic.trim()) return;

        const payload = {
            startHour: editForm.startHour,
            endHour: editForm.endHour,
            topic: editForm.topic.trim(),
            title: editForm.topic.trim(),
            denseParagraph: editForm.denseParagraph.trim(),
            type: editForm.typeDate.trim() ? editForm.typeDate.trim() : editForm.type,
            mainGoal: editForm.mainGoal.trim(),
            characterGoals: editForm.characterGoals,
            facts: editForm.facts
        };

        // Template-only cards live in the library, not today's timeline.
        const isTemplateOnly = !todayIdSet.has(recordId) && templates.some(t => t.id === recordId);
        if (isTemplateOnly) {
            await world.worldSetter.updateTemplate(recordId, payload);
        } else {
            await world.worldSetter.updateRecord(recordId, payload);
        }

        setEditingCardId(null);
        refreshRecords();
    }, [world, editForm, refreshRecords, todayIdSet, templates]);

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

        if (!records.some(r => r.id === recordId)) return;

        setReorderingId(recordId);

        // Smooth animation delay
        await new Promise(r => setTimeout(r, 250));

        // Task 3: reorders bind STRICTLY to record.id — only the affected
        // pair swaps time slots; unrelated blocks are never re-timed.
        world.worldSetter.reorderBlocksById(recordId, direction);
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

    /** One-off block delete (no recurring rule involved). */
    const handleDeleteRecord = useCallback(async (/** @type {string} */ id) => {
        if (!world?.worldSetter) return;
        await world.worldSetter.deleteRecord(id);
        refreshRecords();
    }, [world, refreshRecords]);

    // Task 3: template protection — deleting TODAY'S INSTANCE of a recurring
    // block is a different action from deleting the permanent recurrence
    // RULE stored in the template library.
    const handleDeleteTodayInstance = useCallback(async (/** @type {string} */ id) => {
        if (!world?.worldSetter) return;
        await world.worldSetter.deleteTodayInstance(id);
        refreshRecords();
    }, [world, refreshRecords]);

    const handleDeleteTemplateRule = useCallback(async (/** @type {string} */ id) => {
        if (!world?.worldSetter) return;
        // Template rule delete removes the library entry AND its placed copy.
        await world.worldSetter.deleteTemplate(id);
        refreshRecords();
    }, [world, refreshRecords]);

    const handleCreateBlock = useCallback(async () => {
        if (!world?.worldSetter || !createForm.topic.trim()) return;

        await world.worldSetter.createRecord({
            startHour: createForm.startHour,
            endHour: createForm.endHour,
            topic: createForm.topic.trim(),
            title: createForm.topic.trim(),
            denseParagraph: createForm.denseParagraph.trim(),
            type: createForm.typeDate.trim() ? createForm.typeDate.trim() : createForm.type,
            mainGoal: createForm.mainGoal.trim() || "Hang out together"
        });

        setCreateForm({
            startHour: 14,
            endHour: 15,
            topic: "",
            denseParagraph: "",
            type: "once",
            typeDate: "",
            mainGoal: "",
            characterGoals: [],
            facts: [],
            tagInput: ""
        });
        setIsCreating(false);
        refreshRecords();
    }, [world, createForm, refreshRecords]);

    // Task 3: blocks newly proposed by the active proposal (not yet committed
    // to today's timeline) — merged into the timeline preview at their exact
    // time slots with a bright green "+ PROPOSED" badge.
    const proposedAddBlocks = useMemo(() => {
        if (!proposal) return [];
        return proposal.changes
            .filter(c => c.action === "add")
            .map(c => c.block);
    }, [proposal]);

    // ─── Hybrid Planner: visible list (filters + title search) ───
    const visibleRecords = useMemo(() => {
        /** @type {ScheduleRecord[]} */
        let list;
        if (filterMode === "templates") {
            list = [...templates];
        } else if (filterMode === "today") {
            list = [...records];
        } else {
            // "All": today's timeline + templates that aren't placed today.
            list = [...templates.filter(t => !todayIdSet.has(t.id)), ...records];
        }

        // Task 3: merged proposal preview — render the proposed additions
        // alongside the existing day so the diff is fully interactive.
        if (proposedAddBlocks.length > 0 && filterMode !== "templates") {
            const existingIds = new Set(list.map(r => r.id));
            list = [
                ...list,
                ...proposedAddBlocks.filter(b => !existingIds.has(b.id))
            ];
        }

        list.sort((a, b) => a.startHour - b.startHour);

        const query = searchQuery.trim().toLowerCase();
        if (!query) return list;
        return list.filter(r => String(r.title || r.topic || "").toLowerCase().includes(query));
    }, [filterMode, records, templates, todayIdSet, searchQuery, proposedAddBlocks]);

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
                <div className={styles.scrollBody} ref={scrollBodyRef}>
                    {/* Director Demand Form */}
                    <form onSubmit={handleApplyDemand} className={styles.demandCard}>
                        <div className={styles.demandHeader}>
                            <span className={styles.demandTitle}>🎬 Director Demand Engine</span>
                            <span className={styles.demandSubtitle}>Gemini will contextualize your demand & inject lead-up hooks</span>
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
                        <div className={styles.proposalCallout} ref={proposalRef}>
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
                        <div className={styles.streamProgress} ref={streamProgressRef}>
                            <div className={styles.streamHeader}>
                                <span className={styles.streamDot} />
                                <span className={styles.streamPhase}>{streamPhase || "Generating schedule..."}</span>
                            </div>
                            {streamingBlocks.map((block, idx) => {
                                const sHour = block.startHour ?? 0;
                                const eHour = block.endHour ?? sHour + 1;
                                const tr = `${formatHour(sHour)} - ${formatHour(eHour)}`;

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

                    {/* Hybrid Planner: Filter Tabs + Title Search */}
                    <div className={styles.filterBar}>
                        <div className={styles.filterTabs}>
                            {[
                                { id: "all", label: "All" },
                                { id: "today", label: "Today" },
                                { id: "templates", label: "Templates" }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    className={`${styles.filterBtn} ${filterMode === tab.id ? styles.filterBtnActive : ""}`}
                                    onClick={() => setFilterMode(tab.id)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by title..."
                            className={styles.searchInput}
                            aria-label="Search schedule blocks by title"
                        />
                    </div>

                    {/* New Block Creator (once-only or recurring template) */}
                    <div className={styles.createCard}>
                        <button
                            type="button"
                            className={styles.createToggleBtn}
                            onClick={() => setIsCreating(prev => !prev)}
                        >
                            {isCreating ? "✕ Close Creator" : "＋ New Scene Block"}
                        </button>

                        {isCreating && (
                            <div className={styles.createForm}>
                                <div className={styles.createTimeRow}>
                                    <label className={styles.timeInputCol}>
                                        <span className={styles.sliderSubLabel}>Start: {formatHour(createForm.startHour)}</span>
                                        <input
                                            type="range"
                                            min="0"
                                            max="23.5"
                                            step="0.5"
                                            value={createForm.startHour}
                                            onChange={(e) => {
                                                const newStart = Number(e.target.value);
                                                setCreateForm(prev => ({ ...prev, startHour: newStart, endHour: Math.max(newStart + 0.5, prev.endHour) }));
                                            }}
                                            className={styles.rangeSlider}
                                        />
                                    </label>
                                    <label className={styles.timeInputCol}>
                                        <span className={styles.sliderSubLabel}>End: {formatHour(createForm.endHour)}</span>
                                        <input
                                            type="range"
                                            min="0.5"
                                            max="24"
                                            step="0.5"
                                            value={createForm.endHour}
                                            onChange={(e) => setCreateForm(prev => ({ ...prev, endHour: Math.max(prev.startHour + 0.5, Number(e.target.value)) }))}
                                            className={styles.rangeSlider}
                                        />
                                    </label>
                                </div>

                                <label className={styles.formLabel}>Scene Title:</label>
                                <input
                                    value={createForm.topic}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, topic: e.target.value }))}
                                    placeholder="e.g. Rooftop drone repair session"
                                    className={styles.formInput}
                                />

                                <label className={styles.formLabel}>Dense Scene Paragraph:</label>
                                <textarea
                                    value={createForm.denseParagraph}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, denseParagraph: e.target.value }))}
                                    placeholder="2-3 sentence atmospheric scene setting injected into the dialogue prompt"
                                    className={styles.formTextarea}
                                    rows={3}
                                />

                                <div className={styles.recurrenceRow}>
                                    <label className={styles.formLabel}>Recurrence:</label>
                                    <select
                                        value={createForm.type}
                                        onChange={(e) => setCreateForm(prev => ({ ...prev, type: e.target.value }))}
                                        className={styles.formSelect}
                                    >
                                        <option value="once">Once (today only)</option>
                                        <option value="forever">Daily</option>
                                        <option value="weekdays">Weekdays</option>
                                        <option value="weekends">Weekends</option>
                                    </select>
                                    <input
                                        value={createForm.typeDate}
                                        onChange={(e) => setCreateForm(prev => ({ ...prev, typeDate: e.target.value }))}
                                        placeholder='Specific date (e.g. "9 oct")'
                                        className={styles.dateInput}
                                    />
                                </div>

                                <div className={styles.editBtnRow}>
                                    <button onClick={() => setIsCreating(false)} className={styles.btnCancel}>Cancel</button>
                                    <button
                                        type="button"
                                        onClick={handleCreateBlock}
                                        disabled={!createForm.topic.trim()}
                                        className={styles.btnSave}
                                    >
                                        Add to Timeline
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Timeline Card List */}
                    <div className={styles.timelineList} ref={timelineListRef}>
                        {visibleRecords.length === 0 && (
                            <p className={styles.emptyTimelineHint}>
                                No blocks match this view — switch filters or clear the search.
                            </p>
                        )}
                        {visibleRecords.map((record, idx) => {
                            const isCurrent = record.id === activeScheduleId;
                            const isExpanded = expandedCardIds.has(record.id);
                            const isEditing = editingCardId === record.id;
                            const isReordering = reorderingId === record.id;
                            const isFirst = idx === 0;
                            const isLast = idx === visibleRecords.length - 1;

                            // Hybrid planner visuals: muted dashed one-offs vs bright templates.
                            const recurrenceLabel = formatRecurrenceLabel(record.type);
                            const variantClass = recurrenceLabel ? styles.sceneCardTemplate : styles.sceneCardOnce;

                            // Diff indicators: check if this block is proposed or removed
                            const isProposed = proposal?.changes.some(c => c.action === "add" && c.block.id === record.id);
                            const isRemoved = proposal?.changes.some(c => c.action === "remove" && c.block.id === record.id);
                            const diffClass = isProposed ? styles.sceneCardProposed : (isRemoved ? styles.sceneCardRemoved : "");

                            // Task 2: past blocks stay visible for the full day, greyed out.
                            const pastClass = record.status === "past" && !isCurrent ? styles.sceneCardPast : "";

                            // Task 3: template protection — recurring rules offer a
                            // separate "delete the permanent rule" action.
                            const isRecurringRule = templates.some(t => t.id === record.id);

                            // Timeline continuity: surface non-contiguous blocks with a gap line.
                            const nextRecord = visibleRecords[idx + 1];
                            const gapMinutes = nextRecord ? Math.round((nextRecord.startHour - record.endHour) * 60) : 0;
                            const hasGap = gapMinutes > 0;
                            const gapHours = Math.floor(gapMinutes / 60);
                            const gapMins = gapMinutes % 60;
                            const gapText = `${gapHours > 0 ? `${gapHours}h ` : ""}${gapMins > 0 ? `${gapMins}m` : ""} gap`;

                            return (
                                <React.Fragment key={record.id}>
                                <div
                                    className={`${styles.sceneCard} ${variantClass} ${isCurrent ? styles.sceneCardCurrent : ""} ${isReordering ? styles.sceneCardReordering : ""} ${diffClass} ${pastClass}`}
                                    style={isReordering ? { transform: "translate3d(0, -4px, 0)", opacity: 0.7 } : undefined}
                                >
                                    {/* ─── Card Header (always visible) ─── */}
                                    <div className={styles.cardHeaderRow}>
                                        {/* Accordion Toggle (left-anchored, before reorder controls) */}
                                        <button
                                            type="button"
                                            className={styles.accordionToggleBtn}
                                            onClick={() => toggleCardExpansion(record.id)}
                                            aria-label={isExpanded ? "Minimize block" : "Maximize block"}
                                        >
                                            {isExpanded ? "▲" : "▼"}
                                        </button>

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
                                                    {record.timeRange} {isCurrent && "• ACTIVE"}{!isCurrent && record.status === "past" && "• PAST"}
                                                </span>
                                                <h4 className={styles.minimizedTitle}>{record.title || record.topic}</h4>
                                                {recurrenceLabel && (
                                                    <span className={`${styles.recurrencePill} ${recurrenceLabel === "Daily" ? styles.recurrencePillDaily : recurrenceLabel === "Weekdays" ? styles.recurrencePillWeekdays : recurrenceLabel === "Weekends" ? styles.recurrencePillWeekends : styles.recurrencePillDate}`}>
                                                        [{recurrenceLabel}]
                                                    </span>
                                                )}
                                                {isProposed && <span className={styles.diffBadgeProposed}>+ PROPOSED</span>}
                                                {isRemoved && <span className={styles.diffBadgeRemoved}>− REMOVED</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ─── Expanded Read-Only Inspection ─── */}
                                    {isExpanded && !isEditing && (
                                        <div className={styles.expandedBody}>
                                            {record.denseParagraph && (
                                                <p className={styles.scenePlot}><strong>🎬 Scene:</strong> {record.denseParagraph}</p>
                                            )}
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
                                                {isRecurringRule ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleDeleteTodayInstance(record.id)}
                                                            className={styles.deleteBtn}
                                                            title="Delete only today's instance — the recurring rule stays"
                                                            aria-label="Delete today's instance"
                                                        >
                                                            🗑️ Delete Today
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteTemplateRule(record.id)}
                                                            className={styles.deleteBtn}
                                                            title="Delete the permanent recurring rule (all future days)"
                                                            aria-label="Delete recurring rule"
                                                        >
                                                            🗑️ Delete Rule
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => handleDeleteRecord(record.id)}
                                                        className={styles.deleteBtn}
                                                        title="Delete block"
                                                        aria-label="Delete block"
                                                    >
                                                        🗑️ Delete
                                                    </button>
                                                )}
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

                                            <label className={styles.formLabel}>Scene Title:</label>
                                            <input
                                                value={editForm.topic}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, topic: e.target.value }))}
                                                placeholder="e.g. Creative project brainstorm"
                                                className={styles.formInput}
                                            />

                                            <label className={styles.formLabel}>Dense Scene Paragraph:</label>
                                            <textarea
                                                value={editForm.denseParagraph}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, denseParagraph: e.target.value }))}
                                                placeholder="2-3 sentence atmospheric scene setting injected into the dialogue prompt"
                                                className={styles.formTextarea}
                                                rows={3}
                                            />

                                            <div className={styles.recurrenceRow}>
                                                <label className={styles.formLabel}>Recurrence:</label>
                                                <select
                                                    value={editForm.type}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value, typeDate: "" }))}
                                                    className={styles.formSelect}
                                                >
                                                    <option value="once">Once (today only)</option>
                                                    <option value="forever">Daily</option>
                                                    <option value="weekdays">Weekdays</option>
                                                    <option value="weekends">Weekends</option>
                                                </select>
                                                <input
                                                    value={editForm.typeDate}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, typeDate: e.target.value }))}
                                                    placeholder='Specific date (e.g. "9 oct") — overrides preset'
                                                    className={styles.dateInput}
                                                />
                                            </div>

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

                                {hasGap && (
                                    <div className={styles.timelineGapLine}>
                                        <div className={styles.timelineGapDash} />
                                        <span className={styles.timelineGapBadge}>── {gapText} ──</span>
                                        <div className={styles.timelineGapDash} />
                                    </div>
                                )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
