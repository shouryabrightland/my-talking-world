// @ts-check

import React, { useCallback, useMemo, useState } from "react";
import styles from "./SettingsModal.module.css";
import { useTheme } from "../contexts/ThemeContext";
import { useDevTools } from "../contexts/DevToolsContext";
import { useChat } from "../contexts/ChatContext";
import { Sound, AmbientAudio } from "../util/sound";
import {
    getApiKey,
    getGeminiApiKey,
    setApiKey,
    setGeminiApiKey,
    verifyApiKey,
    verifyGeminiApiKey,
    GROQ_CONSOLE_KEYS_URL,
    GEMINI_CONSOLE_KEYS_URL
} from "../util/Constants";
import Avatar from "./Avatar";
import UnifiedMemory from "../classes/lib/UnifiedMemory";
import MemoryExpiryParser from "../classes/lib/MemoryExpiryParser";

/**
 * @typedef {import("../classes/types/UI.types").ApiKeyVerificationResult} ApiKeyVerificationResult
 * @typedef {import("../classes/ChatMember").default} ChatMember
 * @typedef {import("../classes/lib/UnifiedMemory").UnifiedMemoryEntry} UnifiedMemoryEntry
 * @typedef {"general" | "cast" | "memory"} SettingsTab
 */

/**
 * Parses a date-only `YYYY-MM-DD` string using LOCAL calendar parts.
 * `new Date("2006-01-01")` is parsed as UTC midnight, which renders as
 * Dec 31 in negative UTC offsets — an off-by-one birthday bug.
 *
 * @param {string} str Raw date string.
 * @returns {Date} Local-calendar date (falls back to Date's own parsing).
 */
function parseLocalDateOnly(str) {
    const clean = String(str || "").trim();
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
    if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    return new Date(clean);
}

/**
 * Formats a stored birthday without timezone drift.
 * @param {string} str Raw birthday string.
 * @returns {string} Localized date label.
 */
function formatLocalDate(str) {
    const date = parseLocalDateOnly(str);
    if (Number.isNaN(date.getTime())) return String(str || "");
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Splits a comma-separated tag string into deduped lowercase tags.
 * @param {string} raw Raw comma-separated input.
 * @returns {string[]} Normalized tags.
 */
function splitTags(raw) {
    return [...new Set(String(raw || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Renders a UnifiedMemory entry expiry as a short human-readable badge.
 * @param {string|null|undefined} expiry "forever", "-1", "15m"/"2h"/"7d", or ISO.
 * @returns {{ permanent: boolean, label: string, cls: string }} Label + CSS class key.
 */
function formatUnifiedExpiry(expiry) {
    const raw = String(expiry || "forever");
    if (raw === "forever" || raw === "-1") return { permanent: true, label: "♾️ Perm", cls: "foreverTag" };

    const parsed = MemoryExpiryParser.parse(raw);
    if (!(parsed instanceof Date)) return { permanent: true, label: "♾️ Perm", cls: "foreverTag" };

    const msLeft = parsed.getTime() - Date.now();
    if (msLeft <= 0) return { permanent: false, label: "⚠️ Exp", cls: "expiredTag" };

    const minsLeft = Math.max(1, Math.round(msLeft / 60000));
    return {
        permanent: false,
        label: `⏱️ ${minsLeft > 60 ? `${Math.round(minsLeft / 60)}h` : `${minsLeft}m`}`,
        cls: "ttlTag"
    };
}

/**
 * Responsive Dual-Key Settings Modal Scalable down to 200px screens.
 * 3 tabs: General & Keys, Cast Profiles (locked AI names + tagged memories),
 * and the Unified Memory manager (20k budget gauge, search, list, compress).
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @returns {React.JSX.Element}
 */
export default function SettingsModal({ isOpen, onClose }) {
    const conv = useChat();
    const { isDark, toggleTheme } = useTheme();
    const { isDevToolsEnabled, setIsDevToolsEnabled } = useDevTools();

    /** @type {[SettingsTab, React.Dispatch<React.SetStateAction<SettingsTab>>]} */
    const [activeTab, setActiveTab] = useState(/** @type {SettingsTab} */ ("general"));

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [sfxActive, setSfxActive] = useState(() => Sound.sfxEnabled);

    // =========================================================================
    // AMBIENT SOUND STUDIO STATE
    // =========================================================================
    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [ambientMasterVol, setAmbientMasterVol] = useState(() => Math.round(AmbientAudio.masterVolume * 100));

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [ambientMelodyVol, setAmbientMelodyVol] = useState(() => Math.round(AmbientAudio.melodyVolume * 100));

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [ambientNoiseVol, setAmbientNoiseVol] = useState(() => Math.round(AmbientAudio.noiseVolume * 100));

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [ambientDroneVol, setAmbientDroneVol] = useState(() => Math.round(AmbientAudio.droneVolume * 100));

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [ambientBpm, setAmbientBpm] = useState(() => AmbientAudio.bpm);

    // =========================================================================
    // DUAL API KEYS & RESET STATE
    // =========================================================================
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [groqKeyInput, setGroqKeyInput] = useState(() => getApiKey());

    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [geminiKeyInput, setGeminiKeyInput] = useState(() => getGeminiApiKey());

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isVerifyingGroq, setIsVerifyingGroq] = useState(false);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isVerifyingGemini, setIsVerifyingGemini] = useState(false);

    /** @type {[ApiKeyVerificationResult|null, React.Dispatch<React.SetStateAction<ApiKeyVerificationResult|null>>]} */
    const [groqVerifyResult, setGroqVerifyResult] = useState(/** @type {ApiKeyVerificationResult|null} */ (null));

    /** @type {[ApiKeyVerificationResult|null, React.Dispatch<React.SetStateAction<ApiKeyVerificationResult|null>>]} */
    const [geminiVerifyResult, setGeminiVerifyResult] = useState(/** @type {ApiKeyVerificationResult|null} */ (null));

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);

    // =========================================================================
    // CAST PROFILE STATE (AI names are strictly read-only)
    // =========================================================================
    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [selectedMemberId, setSelectedMemberId] = useState("me");

    /** @type {[{ name: string, birthday: string, about: string, speedMs: number }, React.Dispatch<React.SetStateAction<{ name: string, birthday: string, about: string, speedMs: number }>>]} */
    const [memberForm, setMemberForm] = useState({
        name: "",
        birthday: "2005-01-01",
        about: "",
        speedMs: 28
    });

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isEditingProfile, setIsEditingProfile] = useState(false);

    // =========================================================================
    // UNIFIED MEMORY STATE (shared by Cast + Unified Memory tabs)
    // =========================================================================
    /** @type {[{ data: string, tags: string, expiryOption: string }, React.Dispatch<React.SetStateAction<{ data: string, tags: string, expiryOption: string }>>]} */
    const [memoryForm, setMemoryForm] = useState({ data: "", tags: "", expiryOption: "forever" });

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isAddMemoryOpen, setIsAddMemoryOpen] = useState(false);

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [memoryChangeCounter, setMemoryChangeCounter] = useState(0);

    /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
    const [memorySearch, setMemorySearch] = useState("");

    /** @type {[string|null, React.Dispatch<React.SetStateAction<string|null>>]} */
    const [compressStatus, setCompressStatus] = useState(/** @type {string|null} */ (null));

    const handleToggleSFX = useCallback(() => {
        const state = Sound.toggleSFX();
        setSfxActive(state);
    }, []);

    // Ambient Audio Handlers
    const handleMasterVolChange = useCallback((/** @type {number} */ val) => {
        setAmbientMasterVol(val);
        AmbientAudio.setVolume(val / 100);
    }, []);

    const handleMelodyVolChange = useCallback((/** @type {number} */ val) => {
        setAmbientMelodyVol(val);
        AmbientAudio.setMix({ melody: val / 100 });
    }, []);

    const handleNoiseVolChange = useCallback((/** @type {number} */ val) => {
        setAmbientNoiseVol(val);
        AmbientAudio.setMix({ noise: val / 100 });
    }, []);

    const handleDroneVolChange = useCallback((/** @type {number} */ val) => {
        setAmbientDroneVol(val);
        AmbientAudio.setMix({ drone: val / 100 });
    }, []);

    const handleBpmChange = useCallback((/** @type {number} */ val) => {
        setAmbientBpm(val);
        AmbientAudio.setBpm(val);
    }, []);

    const handleApplyAmbientPreset = useCallback((/** @type {"sitcom"|"coffee"|"sleep"} */ preset) => {
        AmbientAudio.applyPreset(preset);
        const settings = AmbientAudio.getMixSettings();
        setAmbientMasterVol(Math.round(settings.masterVolume * 100));
        setAmbientMelodyVol(Math.round(settings.melodyVolume * 100));
        setAmbientNoiseVol(Math.round(settings.noiseVolume * 100));
        setAmbientDroneVol(Math.round(settings.droneVolume * 100));
        setAmbientBpm(settings.bpm);
    }, []);

    // Key Verifiers
    const handleVerifyGroqKey = useCallback(async () => {
        const clean = groqKeyInput.trim();
        setIsVerifyingGroq(true);
        setGroqVerifyResult(null);

        const result = await verifyApiKey(clean);
        setIsVerifyingGroq(false);
        setGroqVerifyResult(/** @type {ApiKeyVerificationResult} */ ({ valid: result.valid, error: result.error }));

        if (result.valid) {
            setApiKey(clean);
        }
    }, [groqKeyInput]);

    const handleVerifyGeminiKey = useCallback(async () => {
        const clean = geminiKeyInput.trim();
        setIsVerifyingGemini(true);
        setGeminiVerifyResult(null);

        const result = await verifyGeminiApiKey(clean);
        setIsVerifyingGemini(false);
        setGeminiVerifyResult(/** @type {ApiKeyVerificationResult} */ ({ valid: result.valid, error: result.error }));

        if (result.valid) {
            setGeminiApiKey(clean);
        }
    }, [geminiKeyInput]);

    const handleExecuteReset = useCallback(async () => {
        setIsConfirmResetOpen(false);
        onClose();
        try {
            await conv.reset();
        } catch (/** @type {unknown} */ err) {
            console.error("[Settings] Reset failed:", err);
        }
    }, [conv, onClose]);

    // =========================================================================
    // UNIFIED MEMORY ACCESS (reference-based; no legacy member.memory)
    // =========================================================================
    /** @type {import("../classes/lib/UnifiedMemory").default|null} */
    const unifiedMemory = conv.unifiedMemory || null;

    const allMembers = useMemo(() => {
        return conv.world ? conv.world.getMembers() : [conv.User];
    }, [conv.world, conv.User]);

    const activeSelectedMember = useMemo(() => {
        return allMembers.find(m => m.id === selectedMemberId) || conv.User;
    }, [allMembers, selectedMemberId, conv.User]);

    const handleSelectMember = useCallback((/** @type {ChatMember} */ member) => {
        setSelectedMemberId(member.id);
        setMemberForm({
            name: member.name,
            birthday: member.birthday || "2006-01-01",
            about: member.about,
            speedMs: member.typingSpeedMs || 28
        });
        setIsEditingProfile(false);
        setIsAddMemoryOpen(false);
        setMemoryForm({ data: "", tags: "", expiryOption: "forever" });
    }, []);

    const handleSaveProfile = useCallback(() => {
        if (!activeSelectedMember) return;

        // AI character names are strictly locked: only the human user may
        // rename their own display name (messages reference the member object,
        // so nothing in history is rewritten).
        if (!activeSelectedMember.isAI) {
            activeSelectedMember.name = memberForm.name.trim() || activeSelectedMember.name;
        }

        activeSelectedMember.setBirthday(memberForm.birthday);
        activeSelectedMember.about = memberForm.about.trim() || activeSelectedMember.about;

        if (activeSelectedMember.isAI) {
            activeSelectedMember.typingSpeedMs = Math.max(10, Math.min(120, memberForm.speedMs));
        }

        setIsEditingProfile(false);
    }, [activeSelectedMember, memberForm]);

    const computedFormAge = useMemo(() => {
        if (!memberForm.birthday) return 20;
        const birthDate = parseLocalDateOnly(memberForm.birthday);
        if (Number.isNaN(birthDate.getTime())) return 20;

        const now = new Date();
        let age = now.getFullYear() - birthDate.getFullYear();
        const m = now.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) {
            age--;
        }
        return Math.max(1, age);
    }, [memberForm.birthday]);

    /** Memories tagged with the currently selected member. */
    const memberMemories = useMemo(() => {
        void memoryChangeCounter;
        if (!unifiedMemory || !activeSelectedMember) return [];
        return unifiedMemory.getEntriesForMember(activeSelectedMember.id);
    }, [unifiedMemory, activeSelectedMember, memoryChangeCounter]);

    /** Whole stack (recomputed after every mutation), newest first. */
    const allUnifiedEntries = useMemo(() => {
        void memoryChangeCounter;
        return unifiedMemory ? [...unifiedMemory.entries].reverse() : [];
    }, [unifiedMemory, memoryChangeCounter]);

    /** Live text/tag search filter over the whole stack. */
    const filteredUnifiedEntries = useMemo(() => {
        const q = memorySearch.trim().toLowerCase();
        if (!q) return allUnifiedEntries;
        return allUnifiedEntries.filter(entry =>
            entry.data.toLowerCase().includes(q) ||
            entry.tags.some(t => t.includes(q))
        );
    }, [allUnifiedEntries, memorySearch]);

    /** Current character footprint of the rendered stack. */
    const unifiedCharCount = useMemo(() => {
        void memoryChangeCounter;
        if (!unifiedMemory) return 0;
        return unifiedMemory.getCharacterCount();
    }, [unifiedMemory, memoryChangeCounter]);

    const budgetPercent = Math.min(
        100,
        Math.round((unifiedCharCount / UnifiedMemory.MAX_CHARACTERS) * 100)
    );

    const handleAddMemberMemory = useCallback(async () => {
        if (!unifiedMemory || !activeSelectedMember) return;
        const data = memoryForm.data.trim();
        if (!data) return;

        await unifiedMemory.add({
            tags: [activeSelectedMember.id],
            data,
            expiry: memoryForm.expiryOption
        });

        setMemoryForm({ data: "", tags: "", expiryOption: "forever" });
        setIsAddMemoryOpen(false);
        setMemoryChangeCounter(c => c + 1);
    }, [unifiedMemory, activeSelectedMember, memoryForm]);

    const handleAddUnifiedMemory = useCallback(async () => {
        if (!unifiedMemory) return;
        const data = memoryForm.data.trim();
        if (!data) return;

        await unifiedMemory.add({
            tags: splitTags(memoryForm.tags),
            data,
            expiry: memoryForm.expiryOption
        });

        setMemoryForm({ data: "", tags: "", expiryOption: "forever" });
        setMemoryChangeCounter(c => c + 1);
    }, [unifiedMemory, memoryForm]);

    const handleDeleteEntry = useCallback(async (/** @type {string} */ entryId) => {
        if (!unifiedMemory) return;
        await unifiedMemory.remove(entryId);
        setMemoryChangeCounter(c => c + 1);
    }, [unifiedMemory]);

    const handleCompressStack = useCallback(async () => {
        if (!unifiedMemory || unifiedMemory.isCompressing) return;

        setCompressStatus("running");
        try {
            const result = await conv.compressUnifiedMemory();
            setCompressStatus(
                result === "compressed" ? "compressed"
                    : result === "skipped" ? "skipped"
                        : "failed"
            );
        } catch (/** @type {unknown} */ err) {
            console.error("[Settings] Unified memory compression failed:", err);
            setCompressStatus("failed");
        } finally {
            setMemoryChangeCounter(c => c + 1);
        }
    }, [conv, unifiedMemory]);

    const compressStatusText = {
        running: "🗜️ Compressing stack with Gemma… (watch the Background Bar)",
        compressed: "✅ Stack compressed successfully.",
        skipped: "ℹ️ Under the 20,000-char budget (or a pass is already running) — nothing to compress.",
        failed: "❌ Compression failed — the original stack is untouched."
    }[compressStatus || ""] || null;

    const currentGroqKey = getApiKey();
    const maskedGroqPreview = currentGroqKey.length > 8
        ? `${currentGroqKey.slice(0, 5)}••••${currentGroqKey.slice(-3)}`
        : "No Key Saved";

    const currentGeminiKey = getGeminiApiKey();
    const maskedGeminiPreview = currentGeminiKey.length > 8
        ? `${currentGeminiKey.slice(0, 5)}••••${currentGeminiKey.slice(-3)}`
        : "No Key Saved";

    /**
     * Renders one UnifiedMemory entry as a list row (tag chips + data + meta).
     * @param {UnifiedMemoryEntry} entry
     * @param {React.ReactNode} [suffix] Optional trailing control (e.g. delete).
     * @returns {React.JSX.Element}
     */
    const renderUnifiedEntry = (entry, suffix) => {
        const expiry = formatUnifiedExpiry(entry.expiry);

        return (
            <div key={entry.id} className={styles.memoryFactItem}>
                <div className={styles.unifiedItemBody}>
                    {entry.tags.length > 0 && (
                        <div className={styles.tagChipRow}>
                            {entry.tags.map(tag => (
                                <span key={`${entry.id}-${tag}`} className={styles.tagChip}>{tag}</span>
                            ))}
                        </div>
                    )}
                    <span className={styles.memoryValueText}>{entry.data}</span>
                    <div className={styles.unifiedItemMeta}>
                        <span className={styles.memoryTimestamp}>🕒 {entry.datetime}</span>
                        <span className={styles[expiry.cls]}>
                            {expiry.label}
                        </span>
                    </div>
                </div>
                {suffix}
            </div>
        );
    };

    return (
        <div className={`${styles.modalOverlay} ${isOpen ? styles.modalOverlayVisible : ""}`} onClick={onClose}>
            <div className={`${styles.modalCard} ${isOpen ? styles.modalCardVisible : ""}`} onClick={(e) => e.stopPropagation()}>
                {/* Fixed Header */}
                <div className={styles.modalHeader}>
                    <div>
                        <span className={styles.badge}>STUDIO CONFIG</span>
                        <h3 className={styles.title}>Settings</h3>
                    </div>
                    <button onClick={onClose} className={styles.closeBtn} aria-label="Close Settings">
                        ✕
                    </button>
                </div>

                {/* Tab Bar */}
                <div className={styles.tabBar}>
                    <button
                        onClick={() => setActiveTab("general")}
                        className={activeTab === "general" ? styles.tabActive : styles.tab}
                    >
                        <span className={styles.tabIcon}>⚙️</span>
                        <span className={styles.tabLabelFull}>General & Keys</span>
                        <span className={styles.tabLabelShort}>General</span>
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab("cast");
                            handleSelectMember(activeSelectedMember);
                        }}
                        className={activeTab === "cast" ? styles.tabActive : styles.tab}
                    >
                        <span className={styles.tabIcon}>🎭</span>
                        <span className={styles.tabLabelFull}>Cast Profiles</span>
                        <span className={styles.tabLabelShort}>Cast</span>
                    </button>
                    <button
                        onClick={() => setActiveTab("memory")}
                        className={activeTab === "memory" ? styles.tabActive : styles.tab}
                    >
                        <span className={styles.tabIcon}>🧠</span>
                        <span className={styles.tabLabelFull}>Unified Memory</span>
                        <span className={styles.tabLabelShort}>Memory</span>
                    </button>
                </div>

                {/* Fluid Scrollable Body */}
                <div className={styles.modalBody}>
                    {activeTab === "general" && (
                        <>
                            {/* 1. Theme & Sound */}
                            <div className={styles.section}>
                                <h5 className={styles.sectionTitle}>🎨 Appearance & SFX</h5>
                                <div className={styles.row}>
                                    <div className={styles.rowLabelGroup}>
                                        <span className={styles.rowTitle}>Theme Mode</span>
                                        <span className={styles.rowSubtitle}>Color palette</span>
                                    </div>
                                    <button onClick={toggleTheme} className={styles.togglePill}>
                                        {isDark ? "🌙 Dark" : "☀️ Light"}
                                    </button>
                                </div>

                                <div className={styles.row}>
                                    <div className={styles.rowLabelGroup}>
                                        <span className={styles.rowTitle}>Sound FX</span>
                                        <span className={styles.rowSubtitle}>Voices & message pops</span>
                                    </div>
                                    <button
                                        onClick={handleToggleSFX}
                                        className={sfxActive ? styles.togglePillSuccess : styles.togglePillMuted}
                                    >
                                        {sfxActive ? "🔊 ON" : "🔇 OFF"}
                                    </button>
                                </div>
                            </div>

                            {/* 2. Ambient Sound Studio */}
                            <div className={styles.section}>
                                <div className={styles.sectionHeaderRow}>
                                    <h5 className={styles.sectionTitle}>🎵 Ambient Audio</h5>
                                    <span className={styles.keyPreviewTag}>{ambientBpm} BPM</span>
                                </div>

                                <div className={styles.presetButtonGroup}>
                                    <button onClick={() => handleApplyAmbientPreset("sitcom")} className={styles.vibePresetBtn}>
                                        🎉 Sitcom
                                    </button>
                                    <button onClick={() => handleApplyAmbientPreset("coffee")} className={styles.vibePresetBtn}>
                                        ☕ Cozy Lounge
                                    </button>
                                    <button onClick={() => handleApplyAmbientPreset("sleep")} className={styles.vibePresetBtn}>
                                        🌙 Sleep
                                    </button>
                                </div>

                                <div className={styles.audioSliderGrid}>
                                    <div className={styles.sliderRow}>
                                        <div className={styles.sliderLabelRow}>
                                            <span className={styles.sliderLabel}>Master Volume</span>
                                            <span className={styles.sliderValueBadge}>{ambientMasterVol}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={ambientMasterVol}
                                            onChange={(e) => handleMasterVolChange(Number(e.target.value))}
                                            className={styles.rangeSlider}
                                        />
                                    </div>

                                    <div className={styles.sliderRow}>
                                        <div className={styles.sliderLabelRow}>
                                            <span className={styles.sliderLabel}>Theme Melody</span>
                                            <span className={styles.sliderValueBadge}>{ambientMelodyVol}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={ambientMelodyVol}
                                            onChange={(e) => handleMelodyVolChange(Number(e.target.value))}
                                            className={styles.rangeSlider}
                                        />
                                    </div>

                                    <div className={styles.sliderRow}>
                                        <div className={styles.sliderLabelRow}>
                                            <span className={styles.sliderLabel}>Room Air (Noise)</span>
                                            <span className={styles.sliderValueBadge}>{ambientNoiseVol}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={ambientNoiseVol}
                                            onChange={(e) => handleNoiseVolChange(Number(e.target.value))}
                                            className={styles.rangeSlider}
                                        />
                                    </div>

                                    <div className={styles.sliderRow}>
                                        <div className={styles.sliderLabelRow}>
                                            <span className={styles.sliderLabel}>Lofi Chord Pad</span>
                                            <span className={styles.sliderValueBadge}>{ambientDroneVol}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={ambientDroneVol}
                                            onChange={(e) => handleDroneVolChange(Number(e.target.value))}
                                            className={styles.rangeSlider}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 3. Developer Tools */}
                            <div className={styles.section}>
                                <h5 className={styles.sectionTitle}>🛠️ Developer Mode</h5>
                                <div className={styles.row}>
                                    <div className={styles.rowLabelGroup}>
                                        <span className={styles.rowTitle}>Dev Tools Ribbon</span>
                                        <span className={styles.rowSubtitle}>Inspect live logs, state & prompts</span>
                                    </div>
                                    <button
                                        onClick={() => setIsDevToolsEnabled(!isDevToolsEnabled)}
                                        className={isDevToolsEnabled ? styles.togglePillActive : styles.togglePillMuted}
                                    >
                                        {isDevToolsEnabled ? "✅ ON" : "⭕ OFF"}
                                    </button>
                                </div>
                            </div>

                            {/* 4. Dual API Key Management (Groq Chat + Gemini 65K Planner) */}
                            <div className={styles.section}>
                                <h5 className={styles.sectionTitle}>🔑 Hybrid API Key Managers</h5>

                                {/* Key A: Groq Key */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    <div className={styles.sectionHeaderRow}>
                                        <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--primary)" }}>
                                            ⚡ Groq Cloud Key (Live Chat Banter):
                                        </span>
                                        <span className={styles.keyPreviewTag}>{maskedGroqPreview}</span>
                                    </div>
                                    <div className={styles.keyInputRow}>
                                        <input
                                            type="password"
                                            placeholder="Update Groq Key (gsk_...)"
                                            value={groqKeyInput}
                                            onChange={(e) => setGroqKeyInput(e.target.value)}
                                            disabled={isVerifyingGroq}
                                            className={styles.keyInput}
                                        />
                                        <button
                                            onClick={handleVerifyGroqKey}
                                            disabled={isVerifyingGroq || !groqKeyInput.trim()}
                                            className={styles.verifyBtn}
                                        >
                                            {isVerifyingGroq ? "Checking..." : "Save Groq"}
                                        </button>
                                    </div>
                                    <a
                                        href={GROQ_CONSOLE_KEYS_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={styles.groqConsoleLink}
                                    >
                                        Get free key at Groq Keys ↗
                                    </a>
                                    {groqVerifyResult && (
                                        <div className={groqVerifyResult.valid ? styles.verifySuccessBox : styles.verifyErrorBox}>
                                            <span className={styles.verifyTitle}>
                                                {groqVerifyResult.valid ? "✅ Groq Key Active" : "❌ Groq Verification Failed"}
                                            </span>
                                            {groqVerifyResult.error && <span className={styles.verifyDetails}>{groqVerifyResult.error}</span>}
                                        </div>
                                    )}
                                </div>

                                {/* Key B: Gemini AI Studio Key */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle, rgba(203, 213, 225, 0.4))" }}>
                                    <div className={styles.sectionHeaderRow}>
                                        <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--director-gold, #f59e0b)" }}>
                                            ✨ Gemini Flash Key (65K Planner & Demands):
                                        </span>
                                        <span className={styles.keyPreviewTag}>{maskedGeminiPreview}</span>
                                    </div>
                                    <div className={styles.keyInputRow}>
                                        <input
                                            type="password"
                                            placeholder="Update Gemini Key (AIzaSy...)"
                                            value={geminiKeyInput}
                                            onChange={(e) => setGeminiKeyInput(e.target.value)}
                                            disabled={isVerifyingGemini}
                                            className={styles.keyInput}
                                        />
                                        <button
                                            onClick={handleVerifyGeminiKey}
                                            disabled={isVerifyingGemini || !geminiKeyInput.trim()}
                                            className={styles.verifyBtn}
                                        >
                                            {isVerifyingGemini ? "Checking..." : "Save Gemini"}
                                        </button>
                                    </div>
                                    <a
                                        href={GEMINI_CONSOLE_KEYS_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={styles.groqConsoleLink}
                                        style={{ color: "var(--director-gold, #f59e0b)" }}
                                    >
                                        Get free key at Google AI Studio ↗
                                    </a>
                                    {geminiVerifyResult && (
                                        <div className={geminiVerifyResult.valid ? styles.verifySuccessBox : styles.verifyErrorBox}>
                                            <span className={styles.verifyTitle}>
                                                {geminiVerifyResult.valid ? "✅ Gemini Key Active" : "❌ Gemini Verification Failed"}
                                            </span>
                                            {geminiVerifyResult.error && <span className={styles.verifyDetails}>{geminiVerifyResult.error}</span>}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 5. Danger Zone */}
                            <div className={styles.dangerSection}>
                                <h5 className={styles.dangerTitle}>⚠️ Danger Zone</h5>
                                <div className={styles.row}>
                                    <div className={styles.rowLabelGroup}>
                                        <span className={styles.rowTitle}>Reset Session</span>
                                        <span className={styles.rowSubtitle}>Wipes history & restarts banter</span>
                                    </div>
                                    <button
                                        onClick={() => setIsConfirmResetOpen(true)}
                                        className={styles.resetBtn}
                                    >
                                        🔄 Reset
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === "cast" && (
                        <div className={styles.advancedContainer}>
                            <div className={styles.memberSelectorTrack}>
                                {allMembers.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => handleSelectMember(m)}
                                        className={selectedMemberId === m.id ? styles.memberSelectBtnActive : styles.memberSelectBtn}
                                    >
                                        {m.isAI ? m.name : "👤 Me (You)"}
                                    </button>
                                ))}
                            </div>

                            <div className={styles.memberProfileCard}>
                                <div className={styles.memberCardHeader}>
                                    <div className={styles.memberMetaRow}>
                                        {activeSelectedMember.isAI ? (
                                            <div style={{ width: "34px", height: "34px", flexShrink: 0 }}>
                                                <Avatar member={activeSelectedMember} emotion="Default" />
                                            </div>
                                        ) : (
                                            <div className={styles.userAvatarPlaceholder}>👤</div>
                                        )}
                                        <div className={styles.memberTextGroup}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                                                <span className={styles.memberName}>{activeSelectedMember.name}</span>
                                                {activeSelectedMember.isAI ? (
                                                    <span className={styles.lockBadge} title="AI character names are read-only">
                                                        🔒 Locked
                                                    </span>
                                                ) : (
                                                    <span className={styles.editableBadge} title="You can rename your own display name">
                                                        ✏️ Editable
                                                    </span>
                                                )}
                                                <span className={styles.ageBadge}>
                                                    🎂 {activeSelectedMember.age}y
                                                </span>
                                            </div>
                                            <span className={styles.birthdaySubtitle}>
                                                Born: {formatLocalDate(activeSelectedMember.birthday)}
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            if (!isEditingProfile) {
                                                setMemberForm({
                                                    name: activeSelectedMember.name,
                                                    birthday: activeSelectedMember.birthday || "2006-01-01",
                                                    about: activeSelectedMember.about,
                                                    speedMs: activeSelectedMember.typingSpeedMs || 28
                                                });
                                            }
                                            setIsEditingProfile(prev => !prev);
                                        }}
                                        className={styles.editProfileBtn}
                                    >
                                        {isEditingProfile ? "✕ Cancel" : "✏️ Edit Profile"}
                                    </button>
                                </div>

                                {isEditingProfile ? (
                                    <div className={styles.memberEditForm}>
                                        <label className={styles.formLabel}>
                                            Display Name: {activeSelectedMember.isAI && "🔒 (locked for AI characters)"}
                                        </label>
                                        <input
                                            value={memberForm.name}
                                            onChange={(e) => setMemberForm(prev => ({ ...prev, name: e.target.value }))}
                                            className={styles.formInput}
                                            disabled={activeSelectedMember.isAI}
                                            readOnly={activeSelectedMember.isAI}
                                        />
                                        {activeSelectedMember.isAI ? (
                                            <span className={styles.lockedHintText}>
                                                🔒 AI character names are strictly read-only so the cast stays consistent.
                                            </span>
                                        ) : (
                                            <span className={styles.lockedHintText}>
                                                Your display name updates everywhere instantly — chat history is never rewritten.
                                            </span>
                                        )}

                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", flexWrap: "wrap" }}>
                                            <div style={{ flex: "1 1 120px" }}>
                                                <label className={styles.formLabel}>Birthday (YYYY-MM-DD):</label>
                                                <input
                                                    type="date"
                                                    value={memberForm.birthday}
                                                    onChange={(e) => setMemberForm(prev => ({ ...prev, birthday: e.target.value }))}
                                                    className={styles.formInput}
                                                />
                                            </div>
                                            <div style={{ alignSelf: "flex-end", paddingBottom: "4px" }}>
                                                <span className={styles.liveComputedAgeTag}>
                                                    Age: {computedFormAge} yrs
                                                </span>
                                            </div>
                                        </div>

                                        <label className={styles.formLabel}>Personality & Bio (Hinglish):</label>
                                        <textarea
                                            value={memberForm.about}
                                            onChange={(e) => setMemberForm(prev => ({ ...prev, about: e.target.value }))}
                                            rows={3}
                                            maxLength={50}
                                            className={styles.formTextarea}
                                        />
                                        <span style={{ display: "block", textAlign: "right", fontSize: "11px", opacity: 0.7 }}>
                                            {memberForm.about.length}/50
                                        </span>

                                        {activeSelectedMember.isAI && (
                                            <>
                                                <label className={styles.formLabel}>
                                                    Typing Speed: {memberForm.speedMs} ms/letter
                                                </label>
                                                <input
                                                    type="range"
                                                    min="12"
                                                    max="80"
                                                    value={memberForm.speedMs}
                                                    onChange={(e) => setMemberForm(prev => ({ ...prev, speedMs: Number(e.target.value) }))}
                                                    className={styles.rangeSlider}
                                                />
                                            </>
                                        )}

                                        <div className={styles.editBtnRow}>
                                            <button onClick={handleSaveProfile} className={styles.saveBtn}>
                                                Save Profile
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className={styles.memberAboutText}>"{activeSelectedMember.about}"</p>
                                )}
                            </div>

                            {/* UnifiedMemory entries tagged for the selected member */}
                            <div className={styles.memoryManagerSection}>
                                <div className={styles.memoryHeaderRow}>
                                    <div>
                                        <span className={styles.sectionTitle}>🧠 Memories Tagged for {activeSelectedMember.name}</span>
                                        <span className={styles.memoryCountBadge}>{memberMemories.length} Entries</span>
                                    </div>
                                    <button
                                        onClick={() => setIsAddMemoryOpen(prev => !prev)}
                                        className={styles.addFactBtn}
                                    >
                                        {isAddMemoryOpen ? "✕ Close" : "+ Add Memory"}
                                    </button>
                                </div>

                                {isAddMemoryOpen && (
                                    <div className={styles.addMemoryForm}>
                                        <label className={styles.formLabel}>Memory Content:</label>
                                        <input
                                            placeholder="e.g. Check on the project in 20m"
                                            value={memoryForm.data}
                                            onChange={(e) => setMemoryForm(prev => ({ ...prev, data: e.target.value }))}
                                            className={styles.formInput}
                                        />

                                        <label className={styles.formLabel}>Expiration TTL:</label>
                                        <select
                                            value={memoryForm.expiryOption}
                                            onChange={(e) => setMemoryForm(prev => ({ ...prev, expiryOption: e.target.value }))}
                                            className={styles.formSelect}
                                        >
                                            <option value="forever">Permanent (Never expires)</option>
                                            <option value="15m">15 Minutes (Short session)</option>
                                            <option value="1h">1 Hour (Short session)</option>
                                            <option value="24h">24 Hours (Today)</option>
                                            <option value="7d">7 Days (Week)</option>
                                            <option value="30d">30 Days (Month)</option>
                                        </select>

                                        <div className={styles.editBtnRow}>
                                            <button onClick={handleAddMemberMemory} className={styles.saveBtn}>
                                                Save to Brain 🧠
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className={styles.memoryList}>
                                    {memberMemories.length === 0 ? (
                                        <div className={styles.emptyMemoryBox}>
                                            <span>No memories tagged for this member yet. The SituationEngine saves them automatically, or you can add them above.</span>
                                        </div>
                                    ) : (
                                        memberMemories.map(entry => (
                                            <div key={entry.id} className={styles.memoryFactItem}>
                                                <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                                                        <span className={styles.memoryKeyTitle}>
                                                            {entry.tags.filter(t => t !== activeSelectedMember.id).join(", ") || "Memory"}
                                                        </span>
                                                        <span className={styles[formatUnifiedExpiry(entry.expiry).cls]}>
                                                            {formatUnifiedExpiry(entry.expiry).label}
                                                        </span>
                                                    </div>
                                                    <span className={styles.memoryValueText}>{entry.data}</span>
                                                </div>

                                                <button
                                                    onClick={() => handleDeleteEntry(entry.id)}
                                                    className={styles.deleteMemoryBtn}
                                                    title="Delete memory"
                                                    aria-label="Delete memory"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === "memory" && (
                        <div className={styles.advancedContainer}>
                            {/* 20,000-char budget gauge */}
                            <div className={styles.section}>
                                <div className={styles.sectionHeaderRow}>
                                    <h5 className={styles.sectionTitle}>📊 Unified Memory Budget</h5>
                                    <span className={styles.keyPreviewTag}>
                                        {unifiedCharCount.toLocaleString()} / {UnifiedMemory.MAX_CHARACTERS.toLocaleString()} chars
                                    </span>
                                </div>
                                <div
                                    className={styles.gaugeTrack}
                                    role="progressbar"
                                    aria-valuenow={budgetPercent}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label="Unified memory budget usage"
                                >
                                    <div
                                        className={`${styles.gaugeFill} ${budgetPercent > 90
                                            ? styles.gaugeFillDanger
                                            : budgetPercent > 70
                                                ? styles.gaugeFillWarn
                                                : ""}`}
                                        style={{ width: `${budgetPercent}%` }}
                                    />
                                </div>
                                <div className={styles.gaugeMetaRow}>
                                    <span className={styles.gaugeMetaText}>
                                        {budgetPercent}% used • {allUnifiedEntries.length} entries stored
                                    </span>
                                    <button
                                        onClick={handleCompressStack}
                                        disabled={Boolean(unifiedMemory?.isCompressing) || compressStatus === "running"}
                                        className={styles.compressBtn}
                                        title="Compress the stack with Gemma once it exceeds the 20,000-char budget"
                                    >
                                        {compressStatus === "running" ? "🗜️ Compressing…" : "🗜️ Compress Stack"}
                                    </button>
                                </div>
                                {compressStatusText && (
                                    <span className={styles.compressStatusText}>{compressStatusText}</span>
                                )}
                            </div>

                            {/* Manual add-memory form */}
                            <div className={styles.section}>
                                <div className={styles.sectionHeaderRow}>
                                    <h5 className={styles.sectionTitle}>➕ Add Memory Manually</h5>
                                </div>
                                <label className={styles.formLabel}>Memory Content:</label>
                                <input
                                    placeholder="e.g. Tom promised chai at the Gomti Nagar stall"
                                    value={memoryForm.data}
                                    onChange={(e) => setMemoryForm(prev => ({ ...prev, data: e.target.value }))}
                                    className={styles.formInput}
                                />
                                <label className={styles.formLabel}>Tags (comma-separated):</label>
                                <input
                                    placeholder="e.g. tom, chai, promise"
                                    value={memoryForm.tags}
                                    onChange={(e) => setMemoryForm(prev => ({ ...prev, tags: e.target.value }))}
                                    className={styles.formInput}
                                />
                                <label className={styles.formLabel}>Expiration TTL:</label>
                                <select
                                    value={memoryForm.expiryOption}
                                    onChange={(e) => setMemoryForm(prev => ({ ...prev, expiryOption: e.target.value }))}
                                    className={styles.formSelect}
                                >
                                    <option value="forever">Permanent (Never expires)</option>
                                    <option value="15m">15 Minutes (Short session)</option>
                                    <option value="1h">1 Hour (Short session)</option>
                                    <option value="24h">24 Hours (Today)</option>
                                    <option value="7d">7 Days (Week)</option>
                                    <option value="30d">30 Days (Month)</option>
                                </select>
                                <div className={styles.editBtnRow}>
                                    <button onClick={handleAddUnifiedMemory} className={styles.saveBtn}>
                                        Add to Stack 🧠
                                    </button>
                                </div>
                            </div>

                            {/* Live text/tag search */}
                            <div className={styles.section}>
                                <h5 className={styles.sectionTitle}>🔍 Search (text or tags)</h5>
                                <input
                                    placeholder="e.g. chai, tom, drone..."
                                    value={memorySearch}
                                    onChange={(e) => setMemorySearch(e.target.value)}
                                    className={styles.formInput}
                                />
                            </div>

                            {/* Full memory list */}
                            <div className={styles.memoryManagerSection}>
                                <div className={styles.memoryHeaderRow}>
                                    <span className={styles.sectionTitle}>🗂️ All Memory Items</span>
                                    <span className={styles.memoryCountBadge}>
                                        {filteredUnifiedEntries.length} / {allUnifiedEntries.length} shown
                                    </span>
                                </div>
                                <div className={styles.memoryListWide}>
                                    {filteredUnifiedEntries.length === 0 ? (
                                        <div className={styles.emptyMemoryBox}>
                                            <span>
                                                {allUnifiedEntries.length === 0
                                                    ? "The unified memory stack is empty. Add memories above or let the SituationEngine extract them."
                                                    : "No entries match this search."}
                                            </span>
                                        </div>
                                    ) : (
                                        filteredUnifiedEntries.map(entry => (
                                            renderUnifiedEntry(
                                                entry,
                                                <button
                                                    onClick={() => handleDeleteEntry(entry.id)}
                                                    className={styles.deleteMemoryBtn}
                                                    title="Delete memory"
                                                    aria-label="Delete memory"
                                                >
                                                    🗑️
                                                </button>
                                            )
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Reset Confirmation Modal */}
                {isConfirmResetOpen && (
                    <div className={styles.subModalOverlay}>
                        <div className={styles.subModalCard}>
                            <h4 className={styles.subModalTitle}>Reset Chat Session?</h4>
                            <p className={styles.subModalText}>
                                This will erase conversation history and restart dialogue.
                            </p>
                            <div className={styles.subModalButtonRow}>
                                <button onClick={() => setIsConfirmResetOpen(false)} className={styles.subModalCancelBtn}>
                                    Cancel
                                </button>
                                <button onClick={handleExecuteReset} className={styles.subModalConfirmBtn}>
                                    Yes, Reset
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
