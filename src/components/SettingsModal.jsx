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

/**
 * @typedef {import("../classes/types/UI.types").ApiKeyVerificationResult} ApiKeyVerificationResult
 * @typedef {import("../classes/ChatMember").default} ChatMember
 * @typedef {"general" | "advanced"} SettingsTab
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
 * Responsive Dual-Key Settings Modal Scalable down to 200px screens.
 * Contains Groq Key Manager, Google AI Studio Key Manager, Audio Mixer, and Memory Manager.
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
    // CAST & MEMORY MANAGER STATE
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

    /** @type {[{ key: string, value: string, expiryOption: string }, React.Dispatch<React.SetStateAction<{ key: string, value: string, expiryOption: string }>>]} */
    const [newMemoryForm, setNewMemoryForm] = useState({
        key: "",
        value: "",
        expiryOption: "forever"
    });

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isAddMemoryOpen, setIsAddMemoryOpen] = useState(false);

    /** @type {[number, React.Dispatch<React.SetStateAction<number>>]} */
    const [memoryChangeCounter, setMemoryChangeCounter] = useState(0);

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
    }, []);

    const handleSaveProfile = useCallback(() => {
        if (!activeSelectedMember) return;

        activeSelectedMember.name = memberForm.name.trim() || activeSelectedMember.name;
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

    const handleAddMemory = useCallback(async () => {
        if (!activeSelectedMember || !newMemoryForm.key.trim() || !newMemoryForm.value.trim()) return;

        /** @type {-1|null|Date} */
        let expiry = null;
        const now = Date.now();

        switch (newMemoryForm.expiryOption) {
            case "forever":
                expiry = -1;
                break;
            case "1h":
                expiry = new Date(now + 3600 * 1000);
                break;
            case "24h":
                expiry = new Date(now + 24 * 3600 * 1000);
                break;
            case "7d":
                expiry = new Date(now + 7 * 24 * 3600 * 1000);
                break;
            case "30d":
                expiry = new Date(now + 30 * 24 * 3600 * 1000);
                break;
            default:
                expiry = -1;
        }

        activeSelectedMember.memory.set(newMemoryForm.key.trim(), newMemoryForm.value.trim(), expiry);
        await activeSelectedMember.saveMemory();

        setNewMemoryForm({ key: "", value: "", expiryOption: "forever" });
        setIsAddMemoryOpen(false);
        setMemoryChangeCounter(c => c + 1);
    }, [activeSelectedMember, newMemoryForm]);

    const handleDeleteMemory = useCallback(async (/** @type {string} */ keyName) => {
        if (!activeSelectedMember) return;
        activeSelectedMember.memory.delete(keyName);
        await activeSelectedMember.saveMemory();
        setMemoryChangeCounter(c => c + 1);
    }, [activeSelectedMember]);

    const currentGroqKey = getApiKey();
    const maskedGroqPreview = currentGroqKey.length > 8
        ? `${currentGroqKey.slice(0, 5)}••••${currentGroqKey.slice(-3)}`
        : "No Key Saved";

    const currentGeminiKey = getGeminiApiKey();
    const maskedGeminiPreview = currentGeminiKey.length > 8
        ? `${currentGeminiKey.slice(0, 5)}••••${currentGeminiKey.slice(-3)}`
        : "No Key Saved";

    const memberMemories = useMemo(() => {
        if (!activeSelectedMember) return [];
        void memoryChangeCounter;
        return activeSelectedMember.memory.values();
    }, [activeSelectedMember, memoryChangeCounter]);

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
                            setActiveTab("advanced");
                            handleSelectMember(activeSelectedMember);
                        }}
                        className={activeTab === "advanced" ? styles.tabActive : styles.tab}
                    >
                        <span className={styles.tabIcon}>🔬</span>
                        <span className={styles.tabLabelFull}>Cast & Memories</span>
                        <span className={styles.tabLabelShort}>Cast</span>
                    </button>
                </div>

                {/* Fluid Scrollable Body */}
                <div className={styles.modalBody}>
                    {activeTab === "general" ? (
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
                    ) : (
                        /* Cast & Memory Manager Tab */
                        <div className={styles.advancedContainer}>
                            <div className={styles.memberSelectorTrack}>
                                {allMembers.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => handleSelectMember(m)}
                                        className={selectedMemberId === m.id ? styles.memberSelectBtnActive : styles.memberSelectBtn}
                                    >
                                        {m.id === "me" ? "👤 Me (You)" : m.name}
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
                                        <label className={styles.formLabel}>Display Name:</label>
                                        <input
                                            value={memberForm.name}
                                            onChange={(e) => setMemberForm(prev => ({ ...prev, name: e.target.value }))}
                                            className={styles.formInput}
                                        />

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
                                            className={styles.formTextarea}
                                        />

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

                            {/* Dynamic Memory Manager Section */}
                            <div className={styles.memoryManagerSection}>
                                <div className={styles.memoryHeaderRow}>
                                    <div>
                                        <span className={styles.sectionTitle}>🧠 Dynamic Memories & States</span>
                                        <span className={styles.memoryCountBadge}>{memberMemories.length} Facts & States</span>
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
                                        <label className={styles.formLabel}>Memory Key (e.g. Reminder, Current Spot, Secret):</label>
                                        <input
                                            placeholder="e.g. Active Reminder, Hidden Thought"
                                            value={newMemoryForm.key}
                                            onChange={(e) => setNewMemoryForm(prev => ({ ...prev, key: e.target.value }))}
                                            className={styles.formInput}
                                        />

                                        <label className={styles.formLabel}>Memory Content:</label>
                                        <input
                                            placeholder="e.g. Check on the project in 20m"
                                            value={newMemoryForm.value}
                                            onChange={(e) => setNewMemoryForm(prev => ({ ...prev, value: e.target.value }))}
                                            className={styles.formInput}
                                        />

                                        <label className={styles.formLabel}>Expiration TTL:</label>
                                        <select
                                            value={newMemoryForm.expiryOption}
                                            onChange={(e) => setNewMemoryForm(prev => ({ ...prev, expiryOption: e.target.value }))}
                                            className={styles.formSelect}
                                        >
                                            <option value="forever">Permanent (Never expires)</option>
                                            <option value="1h">1 Hour (Short session)</option>
                                            <option value="24h">24 Hours (Today)</option>
                                            <option value="7d">7 Days (Week)</option>
                                            <option value="30d">30 Days (Month)</option>
                                        </select>

                                        <div className={styles.editBtnRow}>
                                            <button onClick={handleAddMemory} className={styles.saveBtn}>
                                                Save to Brain 🧠
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className={styles.memoryList}>
                                    {memberMemories.length === 0 ? (
                                        <div className={styles.emptyMemoryBox}>
                                            <span>No dynamic memories stored. The model will autonomously save states during conversation, or you can add them above.</span>
                                        </div>
                                    ) : (
                                        memberMemories.map(memKey => {
                                            const isForever = memKey.isForever();
                                            const isUsable = memKey.isUsable();
                                            let expiryBadge = "Permanent";

                                            if (memKey.expiry instanceof Date) {
                                                const msLeft = memKey.expiry.getTime() - Date.now();
                                                const minsLeft = Math.max(1, Math.round(msLeft / (60 * 1000)));
                                                expiryBadge = minsLeft > 60
                                                    ? `${Math.round(minsLeft / 60)}h`
                                                    : `${minsLeft}m`;
                                            }

                                            return (
                                                <div key={memKey.name} className={styles.memoryFactItem}>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                                                            <span className={styles.memoryKeyTitle}>{memKey.name}</span>
                                                            <span className={isForever ? styles.foreverTag : (isUsable ? styles.ttlTag : styles.expiredTag)}>
                                                                {isForever ? "♾️ Perm" : (isUsable ? `⏱️ ${expiryBadge}` : "⚠️ Exp")}
                                                            </span>
                                                        </div>
                                                        <span className={styles.memoryValueText}>
                                                            {Array.isArray(memKey.value) ? memKey.value.join(", ") : String(memKey.value)}
                                                        </span>
                                                    </div>

                                                    <button
                                                        onClick={() => handleDeleteMemory(memKey.name)}
                                                        className={styles.deleteMemoryBtn}
                                                        title="Delete memory"
                                                        aria-label="Delete memory"
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            );
                                        })
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