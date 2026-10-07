// src/components/presentation/PresentationView.jsx
// @ts-check

import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./PresentationView.module.css";
import Avatar from "../Avatar";
import { Tom, Angela, Ben, Ginger, Hank, Becca } from "../../util/member";
import { Sound } from "../../util/sound";

export const PRESENTATION_ACTS = [
    {
        id: 0,
        act: "ACT 0 • THE BREAKTHROUGH",
        tag: "CBSE HACKATHON 2026 • CREATIVE AI SHOWCASE",
        headlineMain: "CHATBOTS ARE DEAD.",
        headlineGradient: "WE BUILT A LIVING SITCOM.",
        punchline: "Transforming kids from passive reel-scrolling digital zombies into active story directors.",
        metrics: [
            { icon: "🚫", label: "Zero Prompts", desc: "Autonomous Banter" },
            { icon: "🎭", label: "6 AI Friends", desc: "Lucknow Garage" },
            { icon: "🎬", label: "You Direct", desc: "Total Agency" }
        ],
        layerTag: "LIVING STUDIO CHASSIS"
    },
    {
        id: 1,
        act: "ACT I • REALITY ANCHOR",
        headlineMain: "AI GROUNDED IN",
        headlineGradient: "TODAY'S REAL WORLD.",
        punchline: "Never hallucinates in a vacuum. Characters sync with live Lucknow weather, Indian festivals, and news.",
        metrics: [
            { icon: "🌤️", label: "Open-Meteo", desc: "Live 32°C Lucknow" },
            { icon: "🎉", label: "Calendar Bharat", desc: "National Festivals" },
            { icon: "📰", label: "Google News", desc: "Live RSS Feeds" }
        ],
        layerTag: "EXPLODED LAYER: SCENE HORIZON BAR"
    },
    {
        id: 2,
        act: "ACT II • COGNITIVE TRANSPARENCY",
        headlineMain: "THEY THINK",
        headlineGradient: "BEFORE THEY SPEAK.",
        punchline: "Authentic Lucknow Roman Hinglish with inspectable inner monologues and realistic typing cadence.",
        metrics: [
            { icon: "💭", label: "Thought Peels", desc: "Unspoken Motives" },
            { icon: "🗣️", label: "Roman Hinglish", desc: "Natural Slang" },
            { icon: "⚡", label: "Sub-Second", desc: "Groq LPU Engine" }
        ],
        layerTag: "EXPLODED LAYER: REASONING & SPEECH BALLOON"
    },
    {
        id: 3,
        act: "ACT III • PERSISTENT MEMORY & PRIVACY",
        headlineMain: "100% PRIVATE.",
        headlineGradient: "ZERO SERVER LEAKS.",
        punchline: "Self-healing IndexedDB runs locally on the browser. Memories, secrets, and birthdays never leave your device.",
        metrics: [
            { icon: "🔒", label: "Local Database", desc: "Zero Server Logs" },
            { icon: "🧠", label: "Dual Memory", desc: "15m TTL & Permanent" },
            { icon: "🎂", label: "Dynamic Ages", desc: "Living Calendar" }
        ],
        layerTag: "EXPLODED LAYER: RELATIONAL CAST LOUNGE"
    },
    {
        id: 4,
        act: "ACT IV • DIRECTOR GOD-MODE",
        headlineMain: "YOU ARE NOT JUST A USER.",
        headlineGradient: "YOU ARE THE DIRECTOR.",
        punchline: "Inject plot twists anytime. The 24-hour macro planner recalculates story arcs with visual proposal diffs.",
        metrics: [
            { icon: "🎬", label: "200+ Cues", desc: "Instant Sitcom Twists" },
            { icon: "📅", label: "24h Arc", desc: "Gemini 65K Normalizer" },
            { icon: "⚖️", label: "Visual Diffs", desc: "+Add / −Remove" }
        ],
        layerTag: "EXPLODED LAYER: 24H STORYLINE PLANNER"
    },
    {
        id: 5,
        act: "FINALE • TAKE THE WHEEL",
        headlineMain: "DON'T TAKE OUR WORD.",
        headlineGradient: "EXPERIENCE IT LIVE.",
        punchline: "All 3D layers snap magnetically into the live app. Chat, direct, or inspect character minds right now.",
        metrics: [
            { icon: "🚀", label: "Zero Reload", desc: "Instant Boot" },
            { icon: "⚡", label: "Dual AI Core", desc: "Groq + Gemini" },
            { icon: "🎵", label: "Web Audio", desc: "Procedural Synth" }
        ],
        layerTag: "MAGNETIC REASSEMBLY: LIVE STUDIO LOBBY"
    }
];

/**
 * Full-screen pitch tour shown before entering the Studio.
 *
 * @param {Object} props
 * @param {() => void} [props.onFinish] Called when the tour should close.
 * @returns {React.JSX.Element}
 */
export default function PresentationView({ onFinish }) {
    const [activeAct, setActiveAct] = useState(0);
    const [mouseTilt, setMouseTilt] = useState({ x: 0, y: 0 });
    const isScrollingRef = useRef(false);

    const goToAct = useCallback((/** @type {number} */ newIdx) => {
        const clamped = Math.max(0, Math.min(PRESENTATION_ACTS.length - 1, newIdx));
        setActiveAct(clamped);
        try { Sound.playMessagePop(); } catch {}
    }, []);

    const handleMouseMove = useCallback((/** @type {React.MouseEvent<HTMLDivElement>} */ e) => {
        if (activeAct === 5) {
            setMouseTilt({ x: 0, y: 0 });
            return;
        }
        const { innerWidth, innerHeight } = window;
        const x = (e.clientX / innerWidth - 0.5) * 10;
        const y = (e.clientY / innerHeight - 0.5) * -10;
        setMouseTilt({ x, y });
    }, [activeAct]);

    useEffect(() => {
        const handleKeyDown = (/** @type {KeyboardEvent} */ e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
                e.preventDefault();
                goToAct(activeAct + 1);
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                goToAct(activeAct - 1);
            } else if (e.key === "Escape") {
                onFinish?.();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeAct, goToAct, onFinish]);

    const handleWheel = useCallback((/** @type {React.WheelEvent<HTMLDivElement>} */ e) => {
        if (isScrollingRef.current) return;
        if (Math.abs(e.deltaY) < 30) return;

        isScrollingRef.current = true;
        setTimeout(() => { isScrollingRef.current = false; }, 600);

        if (e.deltaY > 0) {
            goToAct(activeAct + 1);
        } else {
            goToAct(activeAct - 1);
        }
    }, [activeAct, goToAct]);

    const currentAct = PRESENTATION_ACTS[activeAct];
    const todayFormatted = new Date().toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short", year: "numeric"
    });

    return (
        <div className={styles.presentationViewport} onWheel={handleWheel} onMouseMove={handleMouseMove}>
            {/* Ambient Animated Cybernetic Backlight */}
            <div className={styles.ambientBackdropGlow} />
            <div className={styles.ambientCyberGrid} />

            {/* Top Navigation HUD Bar */}
            <header className={styles.navBar}>
                <div className={styles.brandGroup}>
                    <span className={styles.pulseDot} />
                    <span className={styles.brandTitle}>TOM & FRIENDS</span>
                    <span className={styles.brandBadge}>CBSE HACKATHON 2026</span>
                </div>

                <div className={styles.actPillRow}>
                    {PRESENTATION_ACTS.map((act) => (
                        <button
                            key={act.id}
                            onClick={() => goToAct(act.id)}
                            className={activeAct === act.id ? styles.pillActive : styles.pillInactive}
                        >
                            <span>{act.id}</span>
                        </button>
                    ))}
                </div>

                <button onClick={onFinish} className={styles.skipStudioBtn}>
                    Enter Live Studio ⏩
                </button>
            </header>

            {/* Integrated Stage Layout */}
            <main className={styles.mainCanvas}>
                {/* Left Floating Pitch HUD */}
                <section className={styles.pitchHUD}>
                    <div className={styles.hudCard} key={currentAct.id}>
                        <div className={styles.hudHeaderRow}>
                            <span className={styles.actBadge}>{currentAct.act}</span>
                            <span className={styles.layerActiveIndicator}>{currentAct.layerTag}</span>
                        </div>

                        <h1 className={styles.bigHeadline}>
                            {currentAct.headlineMain}
                            <span className={styles.gradientText}>{currentAct.headlineGradient}</span>
                        </h1>

                        <p className={styles.punchlineText}>{currentAct.punchline}</p>

                        {/* High-Impact Stat Chips */}
                        <div className={styles.metricsGrid}>
                            {currentAct.metrics.map((m, idx) => (
                                <div key={idx} className={styles.metricCard}>
                                    <span className={styles.metricIcon}>{m.icon}</span>
                                    <div className={styles.metricDetails}>
                                        <strong className={styles.metricLabel}>{m.label}</strong>
                                        <span className={styles.metricDesc}>{m.desc}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {activeAct === 5 && (
                            <button onClick={onFinish} className={styles.ctaEnterBtn}>
                                🎭 Enter Live Studio Now 🚀
                            </button>
                        )}

                        <div className={styles.stepperControls}>
                            <button
                                onClick={() => goToAct(activeAct - 1)}
                                disabled={activeAct === 0}
                                className={styles.navBtn}
                            >
                                ← Prev
                            </button>
                            <span className={styles.stepCounter}>{activeAct + 1} / {PRESENTATION_ACTS.length}</span>
                            <button
                                onClick={() => activeAct === 5 ? onFinish?.() : goToAct(activeAct + 1)}
                                className={styles.navBtnPrimary}
                            >
                                {activeAct === 5 ? "Launch Studio 🚀" : "Next Act →"}
                            </button>
                        </div>
                    </div>
                </section>

                {/* Right 3D True Depth Stage */}
                <section className={styles.stage3DSection}>
                    <div className={styles.perspectiveStage}>
                        <div
                            className={`${styles.studioChassis3D} ${activeAct === 5 ? styles.chassisFlat : ""}`}
                            style={{
                                transform: activeAct === 5
                                    ? "rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate3d(0, 0, 0) scale(1)"
                                    : `rotateX(${14 + mouseTilt.y}deg) rotateY(${-22 + mouseTilt.x}deg) rotateZ(2deg) scale(0.92)`
                            }}
                            onClick={activeAct === 5 ? onFinish : undefined}
                        >
                            {/* Realistic 3D Physical Extrusion Depth Backplate */}
                            <div className={styles.chassisDepthExtrusion} />
                            <div className={styles.glassReflectionSheen} />

                            {/* Chassis Top Speaker Notch */}
                            <div className={styles.chassisTopBar}>
                                <span className={styles.statusBarClock}>14:30</span>
                                <div className={styles.speakerGrill} />
                                <span className={styles.statusBarSignals}>5G 🔋 98%</span>
                            </div>

                            {/* App Header Bar */}
                            <div className={styles.appHeader}>
                                <img src="/group.png" alt="Tom & Friends" width={32} height={32} className={styles.headerGroupIcon} />
                                <div className={styles.headerTitles}>
                                    <span className={styles.headerAppName}>Tom & Friends</span>
                                    <span className={styles.headerRoomStatus}>
                                        <span className={styles.livePulseDot} />
                                        6 In Room • Lucknow Studio
                                    </span>
                                </div>
                            </div>

                            {/* 3D LAYER 1: SceneBar (Zooms in Act 1) */}
                            <div className={`${styles.layerSceneBar} ${activeAct === 1 ? styles.zoomedSceneBar : ""}`}>
                                <div className={styles.marqueeWrapper}>
                                    <span className={styles.marqueeTicker}>
                                        📍 Lucknow • 🌤️ 32°C, Warm • 🎯 Casual Banter • ⚡ Goal: Relax with samosas • 📰 India GDP accelerates
                                    </span>
                                </div>
                                <div className={styles.audioBadge}>
                                    <span className={styles.equalizerWave} />
                                    <span className={styles.equalizerWave} />
                                    <span className={styles.equalizerWave} />
                                    <span>ON</span>
                                </div>

                                {activeAct === 1 && (
                                    <div className={styles.floatingHUDExtractTag}>
                                        🌤️ Live Open-Meteo Weather + Google News RSS
                                    </div>
                                )}
                            </div>

                            {/* 3D LAYER 2: Chat Message + Circular Avatar (Zooms in Act 2) */}
                            <div className={`${styles.layerMessageArea} ${activeAct === 2 ? styles.zoomedMessage : ""}`}>
                                <div className={styles.messageRow}>
                                    {/* Authentic Circular Sprite Avatar */}
                                    <div className={styles.avatarCircle}>
                                        <Avatar member={Tom} emotion="Laughing" glow={true} />
                                    </div>

                                    <div className={styles.speechBalloon}>
                                        <div className={styles.balloonSender}>Tom</div>
                                        <p className={styles.balloonBody}>
                                            "Arre yaar, suno toh! Maine garage mein naya drone setup kiya hai. Aaj shaam ko terrace pe test karenge!"
                                        </p>

                                        {/* Dynamic Thought Peek */}
                                        <div className={styles.thoughtPeekCard}>
                                            <span className={styles.thoughtPeekTitle}>💭 INNER MONOLOGUE:</span>
                                            <p className={styles.thoughtPeekBody}>
                                                "Main Ben ko dikhana chahta hoon ki main bhi tech samajhta hoon, bhale hi drone crash ho jaye!"
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Angela Typing Dot Indicator Preview */}
                                <div className={styles.typingPreviewRow}>
                                    <div className={styles.avatarCircleMini}>
                                        <Avatar member={Angela} emotion="Happy" glow={false} />
                                    </div>
                                    <div className={styles.typingBouncingPill}>
                                        <span className={styles.bouncingDot} />
                                        <span className={styles.bouncingDot} />
                                        <span className={styles.bouncingDot} />
                                    </div>
                                </div>

                                {activeAct === 2 && (
                                    <div className={styles.floatingHUDExtractTag}>
                                        🧠 Unspoken Reasoning & Roman Hinglish Banter
                                    </div>
                                )}
                            </div>

                            {/* 3D LAYER 3: Cast Lounge & Memory (Zooms in Act 3) */}
                            <div className={`${styles.layerCastLounge} ${activeAct === 3 ? styles.zoomedCastLounge : ""}`}>
                                <div className={styles.loungeAvatarStrip}>
                                    {[
                                        { char: Tom, mood: "Excited", color: "#3b82f6" },
                                        { char: Angela, mood: "Happy", color: "#db2777" },
                                        { char: Ben, mood: "Thinking", color: "#ca8a04" },
                                        { char: Ginger, mood: "Laughing", color: "#ea580c" },
                                        { char: Hank, mood: "Default", color: "#7c3aed" },
                                        { char: Becca, mood: "Default", color: "#059669" }
                                    ].map((item) => (
                                        <div key={item.char.id} className={styles.loungeCharItem} style={/** @type {React.CSSProperties} */ ({ "--brand-color": item.color })}>
                                            <div className={styles.loungeAvatarFrame}>
                                                <Avatar member={item.char} emotion={item.mood} glow={false} />
                                            </div>
                                            <span className={styles.charMoodTag}>{item.mood}</span>
                                        </div>
                                    ))}
                                </div>

                                {activeAct === 3 && (
                                    <div className={styles.memoryHUDPins}>
                                        <div className={styles.hudMemoryPin}>📌 Tom: [Mood: Hyper-Excited (15m)]</div>
                                        <div className={styles.hudMemoryPin}>📌 Ben: [Secret: Hidden battery pack (Permanent)]</div>
                                        <div className={styles.hudMemoryPin}>📌 Hank: [Posture: Eating samosas]</div>
                                    </div>
                                )}
                            </div>

                            {/* 3D LAYER 4: Storyline Planner Drawer (Zooms in Act 4) */}
                            <div className={`${styles.layerPlannerDrawer} ${activeAct === 4 ? styles.zoomedPlannerDrawer : ""}`}>
                                <div className={styles.plannerDrawerHeader}>
                                    <span>🎬 Director Demand Engine</span>
                                    <span className={styles.geminiBadge}>Gemini Flash 65K</span>
                                </div>

                                <div className={styles.demandBoxPreview}>
                                    <span>"I want to study physics at 5pm"</span>
                                    <span className={styles.demandAppliedTag}>⚡ Staged</span>
                                </div>

                                <div className={styles.stagedProposalCard}>
                                    <div className={styles.proposalTopRow}>
                                        <span>🤖 AI Proposed Changes</span>
                                        <div className={styles.proposalActions}>
                                            <span className={styles.acceptTag}>✓ Accept</span>
                                            <span className={styles.denyTag}>✕ Deny</span>
                                        </div>
                                    </div>
                                    <div className={styles.diffProposed}>
                                        <span className={styles.diffAddBadge}>+ PROPOSED</span>
                                        <strong>17:00 - 18:30 • Physics Study & Rocket Science</strong>
                                    </div>
                                    <div className={styles.diffRemoved}>
                                        <span className={styles.diffRemoveBadge}>− REMOVED</span>
                                        <del>17:00 - 18:30 • Casual Garage Gaming</del>
                                    </div>
                                </div>

                                {activeAct === 4 && (
                                    <div className={styles.floatingHUDExtractTag}>
                                        ⚖️ 24-Hour Non-Destructive Storyline Diffs
                                    </div>
                                )}
                            </div>

                            {/* 3D LAYER 5: Finale Lobby Screen Reassembly */}
                            {activeAct === 5 && (
                                <div className={styles.lobbyFinaleCover}>
                                    <div className={styles.lobbyBadge}>🎬 LIVING STUDIO LOBBY</div>
                                    <div className={styles.lobbyGroupRing}>
                                        <div className={styles.pulseAuraRing} />
                                        <img src="/group.png" alt="Tom & Friends" className={styles.lobbyGroupAvatar} />
                                    </div>
                                    <h2 className={styles.lobbyTitle}>Tom & Friends</h2>
                                    <p className={styles.lobbyDate}>📍 Lucknow Studio • {todayFormatted}</p>
                                    <p className={styles.lobbyDescription}>
                                        Tom, Angela, Ben, Ginger, Hank, and Becca are hanging out. Step into the studio to chat or direct today's scene!
                                    </p>
                                    <button onClick={onFinish} className={styles.lobbySubmitBtn}>
                                        🎭 Log In & Enter Studio
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}