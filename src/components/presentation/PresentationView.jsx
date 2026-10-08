// src/components/presentation/PresentationView.jsx
// @ts-check

/**
 * @file PresentationView.jsx
 * 3D Scrollytelling Presentation System for Tom & Friends.
 *
 * Combines full 11-feature architectural depth with 3D camera zoom, component
 * 3D elevation, interactive phone UI, holographic tooltips, and live Studio Lobby finale.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./PresentationView.module.css";
import Avatar from "../Avatar";
import { Tom, Angela, Ben, Ginger, Hank, Becca, Members } from "../../util/member";
import { Sound } from "../../util/sound";

/**
 * @typedef {Object} PresentationFeatureScene
 * @property {number} id 1-based step id.
 * @property {string} code Zero-padded step code ("01" - "11").
 * @property {string} label Short label for HUD pills.
 * @property {"intro"|"layer"|"finale"} role Arc position.
 * @property {string} tag Category tag.
 * @property {string} headline Giant headline.
 * @property {string} headlineGradient Gradient headline highlight.
 * @property {string} blurb Concise plain-language explanation for evaluators.
 * @property {string[]} files Source modules this step demonstrates.
 * @property {Array<{ icon: string, label: string, desc: string }>} metrics Highlight pills.
 * @property {{ title: string, subtitle: string, badge: string, desc: string }} tooltip Floating holographic card.
 * @property {string} cameraTarget Viewport zoom target.
 */

/** @type {PresentationFeatureScene[]} */
export const PRESENTATION_LAYERS = [
    {
        id: 1, code: "01", label: "Studio", role: "intro",
        tag: "CBSE HACKATHON 2026 • CREATIVE AI SHOWCASE",
        headline: "CHATBOTS ARE DEAD.",
        headlineGradient: "A LIVING SITCOM IN YOUR POCKET.",
        blurb: "Today's students spend 4+ hours daily scrolling 15-second vertical reels — passive digital zombies. We built a living story sandbox where six autonomous AI friends converse, disagree, and live 24/7 in an authentic Lucknow garage.",
        files: ["Chat.jsx", "World.js"],
        metrics: [
            { icon: "🚫", label: "Zero Prompts", desc: "Autonomous Banter" },
            { icon: "🎭", label: "6 AI Friends", desc: "Lucknow Garage" },
            { icon: "🎬", label: "You Direct", desc: "Active Agency" }
        ],
        cameraTarget: "hero",
        tooltip: {
            badge: "LIVING STUDIO",
            title: "Autonomous Multi-Agent World",
            subtitle: "Lucknow Garage Studio",
            desc: "Characters converse autonomously, form lifelong memories, and continue their lives even when you close the tab."
        }
    },
    {
        id: 2, code: "02", label: "Display", role: "layer",
        tag: "COGNITIVE TRANSPARENCY",
        headline: "THE CHAT IS ALIVE.",
        headlineGradient: "THEY THINK BEFORE THEY SPEAK.",
        blurb: "Real human conversation is not an instant 500-word paragraph dump. Our cast speaks in natural Lucknow Roman Hinglish with realistic human typing cadence and inspectable inner monologues.",
        files: ["Chat.jsx", "GroqClient.js", "Reaction.js"],
        metrics: [
            { icon: "💭", label: "Thought Peels", desc: "Inspect Unspoken Motives" },
            { icon: "🗣️", label: "Roman Hinglish", desc: "Natural Local Slang" },
            { icon: "⚡", label: "Sub-Second", desc: "Groq LPU Dialogue Core" }
        ],
        cameraTarget: "message",
        tooltip: {
            badge: "POP-OUT: REASONING BUBBLE",
            title: "Inspectable Cognition (<thought>)",
            subtitle: "Unspoken Motives & Cadence",
            desc: "Characters generate unsaid reasoning before speaking. Click 'Peek Thought' on any bubble to inspect what Tom is secretly hiding!"
        }
    },
    {
        id: 3, code: "03", label: "Reality", role: "layer",
        tag: "EMBODIED REALITY",
        headline: "AI GROUNDED IN",
        headlineGradient: "TODAY'S REAL WORLD.",
        blurb: "Standard AI models hallucinate in an isolated void. Our grounding engine syncs live Lucknow weather via Open-Meteo, Indian cultural holidays via Calendar Bharat, and real headlines from Google News RSS.",
        files: ["environment.js", "SceneBar.jsx", "World.js"],
        metrics: [
            { icon: "🌤️", label: "Open-Meteo", desc: "Live 32°C Lucknow Weather" },
            { icon: "🎉", label: "Calendar Bharat", desc: "Diwali, Eid & Holi Sync" },
            { icon: "📰", label: "Google News", desc: "Live Regional RSS Feeds" }
        ],
        cameraTarget: "scenebar",
        tooltip: {
            badge: "POP-OUT: SCENEBAR",
            title: "Real-Time Environmental Anchor",
            subtitle: "Open-Meteo • Calendar Bharat • RSS",
            desc: "If it hits 34°C in Lucknow at 3 PM, Tom will naturally complain about the heat and suggest getting chilled lassi!"
        }
    },
    {
        id: 4, code: "04", label: "Director", role: "layer",
        tag: "DIRECTOR GOD-MODE",
        headline: "YOU ARE NOT JUST A USER.",
        headlineGradient: "YOU ARE THE DIRECTOR.",
        blurb: "Stop watching the sitcom. Take the director's chair and guide the 24-hour narrative arc. Type any demand or select from 200+ sitcom cues to restructure the day's timeline with live visual proposal diffs.",
        files: ["directorPresets.js", "PlannerDrawer.jsx", "WorldSetter.js"],
        metrics: [
            { icon: "🎬", label: "200+ Cues", desc: "Instant Sitcom Plot Twists" },
            { icon: "📅", label: "24h Arc", desc: "Gemini 65K Normalizer" },
            { icon: "⚖️", label: "Visual Diffs", desc: "+Proposed / −Removed Diffs" }
        ],
        cameraTarget: "planner",
        tooltip: {
            badge: "POP-OUT: DIRECTOR DRAWER",
            title: "24-Hour Storyline Engine",
            subtitle: "Gemini Flash 65K Normalizer",
            desc: "Restructures the entire day in real-time, staging non-destructive proposals (+PROPOSED in green, −REMOVED in red) for human approval."
        }
    },
    {
        id: 5, code: "05", label: "Memory", role: "layer",
        tag: "RELATIONAL MEMORY",
        headline: "THEY REMEMBER",
        headlineGradient: "EVERYTHING.",
        blurb: "Traditional chatbots suffer from catastrophic amnesia. Our characters form persistent relationships using a dual-tier memory engine: 15-minute transient postures and permanent life secrets, with Gemma auto-compression at 20,000 characters.",
        files: ["UnifiedMemory.js", "SituationEngine.js"],
        metrics: [
            { icon: "⏳", label: "Dual Memory", desc: "15m Postures vs Permanent Facts" },
            { icon: "🎂", label: "Dynamic Ages", desc: "Living Calendar Birthdays" },
            { icon: "🗜️", label: "Gemma Compression", desc: "20,000-Char Budget Vault" }
        ],
        cameraTarget: "memory",
        tooltip: {
            badge: "POP-OUT: MEMORY VAULT",
            title: "20,000-Char Episodic Vault",
            subtitle: "Dual-Tier Memory & Dynamic Ages",
            desc: "Stores posture friction (15m) alongside deep promises and dynamic birthdays. Gemma compacts the stack when the 20k budget is reached."
        }
    },
    {
        id: 6, code: "06", label: "Chip", role: "layer",
        tag: "ON-DEVICE AI ROUTER",
        headline: "A 14MB AI CHIP",
        headlineGradient: "ON YOUR DEVICE.",
        blurb: "Needle 2 — a 14MB on-device model running in a background Web Worker — routes user messages in under 1 millisecond. It extracts search keywords and speaker targets with zero network delay, even when completely offline.",
        files: ["NeedleRouter.js", "needleWorker.js"],
        metrics: [
            { icon: "⚡", label: "<1ms Routing", desc: "Deterministic Turn Dispatch" },
            { icon: "📦", label: "14MB Wasm", desc: "Local Compact Binary" },
            { icon: "🌐", label: "100% Offline", desc: "Zero Network Overhead" }
        ],
        cameraTarget: "chip",
        tooltip: {
            badge: "POP-OUT: NEEDLE CHIP",
            title: "Needle 2 On-Device Router",
            subtitle: "14MB Wasm • <1ms Route Budget",
            desc: "Decides which character speaks next and extracts relevant memory tags instantly without touching external servers."
        }
    },
    {
        id: 7, code: "07", label: "Engines", role: "layer",
        tag: "CLIENT-SIDE PRIVACY",
        headline: "100% PRIVATE.",
        headlineGradient: "ZERO SERVER LEAKS.",
        blurb: "Your API keys call Groq and Gemini directly from the browser: zero intermediate servers, zero chat logs stored remotely, and zero tracking. All conversation state lives in your browser's private self-healing IndexedDB.",
        files: ["apiKeys.js", "Storage.js", "GroqClient.js"],
        metrics: [
            { icon: "🔒", label: "Local IndexedDB", desc: "Zero Server Database Logs" },
            { icon: "⚡", label: "Dual AI Core", desc: "Groq Banter + Gemini Planning" },
            { icon: "🛡️", label: "Self-Healing", desc: "Auto-Corruption Recovery" }
        ],
        cameraTarget: "engines",
        tooltip: {
            badge: "POP-OUT: DUAL AI CORE",
            title: "Client-Side Sovereignty",
            subtitle: "Direct Provider Isolation",
            desc: "Groq is strictly for sub-second chat; Gemini is strictly for 24h planning. Chat history never touches any remote database."
        }
    },
    {
        id: 8, code: "08", label: "Sound", role: "layer",
        tag: "PROCEDURAL WEB AUDIO",
        headline: "A SOUNDTRACK WITH",
        headlineGradient: "ZERO AUDIO FILES.",
        blurb: "Every message pop, ambient room air, and character voice blip is synthesized procedurally in real-time by the browser's Web Audio API. Zero MP3 downloads, with real-time 3-channel mixer sliders and Sitcom, Lounge, and Sleep presets.",
        files: ["sound.js", "SettingsModal.jsx"],
        metrics: [
            { icon: "🎵", label: "3-Channel Mixer", desc: "Melody, Noise & Drone" },
            { icon: "0 MB", label: "Zero MP3 Files", desc: "100% Pure Code Synthesis" },
            { icon: "🎧", label: "Voice Signatures", desc: "Procedural Character Blips" }
        ],
        cameraTarget: "sound",
        tooltip: {
            badge: "POP-OUT: SOUND ENGINE",
            title: "Procedural Audio Synthesizer",
            subtitle: "Web Audio API • 3-Channel Mixer",
            desc: "Synthesizes ambient room tone, theme melodies (112 BPM), and character-specific oscillator voice blips on the fly."
        }
    },
    {
        id: 9, code: "09", label: "Armor", role: "layer",
        tag: "ENGINE RESILIENCE",
        headline: "UNBREAKABLE",
        headlineGradient: "ENGINE ARMOR.",
        blurb: "Built for real-world school laptops and flaky Wi-Fi. Multi-tiered resilience protects the simulation: automatic model failover chains, circuit breakers, server-timed rate limit pacing, and PWA offline service worker caching.",
        files: ["CircuitBreaker.js", "RateLimiter.js", "sw.js"],
        metrics: [
            { icon: "🛡️", label: "Circuit Breaker", desc: "Prevents Cascading Hangs" },
            { icon: "📶", label: "PWA Service Worker", desc: "Full Offline App Shell" },
            { icon: "🔄", label: "Auto-Recovery", desc: "Self-Healing Retry Queue" }
        ],
        cameraTarget: "armor",
        tooltip: {
            badge: "POP-OUT: ARMOR PLATE",
            title: "Multi-Tier Fault Tolerance",
            subtitle: "Circuit Breakers & Rate Limits",
            desc: "If an endpoint is rate-limited or fails, the engine absorbs it with a 2-second pause instead of crashing."
        }
    },
    {
        id: 10, code: "10", label: "Cockpit", role: "layer",
        tag: "SYSTEM OBSERVABILITY",
        headline: "THE LIVE",
        headlineGradient: "COCKPIT SUITE.",
        blurb: "Complete architectural transparency. Evaluators and teachers can open the DevTools cockpit anytime to inspect real-time prompts, model token budgets, thinking chains, system state JSON, and per-model health probes.",
        files: ["DevToolsBar.jsx", "DevToolsDrawer.jsx", "PromptLogger.js"],
        metrics: [
            { icon: "🤖", label: "Prompt Inspector", desc: "Thinking Chains & Tokens" },
            { icon: "📋", label: "Live Log Streams", desc: "Category-Filtered Buffers" },
            { icon: "🧩", label: "State JSON", desc: "Real-Time System Diagnostics" }
        ],
        cameraTarget: "cockpit",
        tooltip: {
            badge: "POP-OUT: COCKPIT",
            title: "DevTools Observability",
            subtitle: "Live Token Meters & Traces",
            desc: "Inspect live prompt payloads, token counts, thinking chains, system state JSON, and per-model health probes directly inside the app."
        }
    },
    {
        id: 11, code: "11", label: "Wheel", role: "finale",
        tag: "LIVE STUDIO ACCESS",
        headline: "DON'T TAKE OUR WORD.",
        headlineGradient: "TAKE THE WHEEL.",
        blurb: "All 3D components snap magnetically back into the live app chassis right before your eyes. We invite the jury to step into the Lucknow garage: chat with Tom, peek into character minds, or direct a live plot twist right now!",
        files: ["Chat.jsx", "StudioLobbyScreen.jsx"],
        metrics: [
            { icon: "🚀", label: "Zero Reload", desc: "Instant Seamless Launch" },
            { icon: "⚡", label: "Dual AI Core", desc: "Groq Banter + Gemini Planning" },
            { icon: "🏆", label: "CBSE Hackathon", desc: "Class 12 Showcase 2026" }
        ],
        cameraTarget: "finale",
        tooltip: {
            badge: "MAGNETIC REASSEMBLY",
            title: "Living Studio Lobby Ready",
            subtitle: "Step Inside and Direct",
            desc: "The audience steps directly into the living garage studio to talk or direct a live plot twist!"
        }
    }
];

export const PRESENTATION_SCENES = PRESENTATION_LAYERS;

export default function PresentationView({ onFinish }) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [mouseTilt, setMouseTilt] = useState({ x: 0, y: 0 });
    const isScrollingRef = useRef(false);

    const goToStep = useCallback((newIdx) => {
        const clamped = Math.max(0, Math.min(PRESENTATION_LAYERS.length - 1, newIdx));
        setActiveIndex(clamped);
        try { Sound.playMessagePop(); } catch {}
    }, []);

    // Interactive desktop hover parallax
    const handleMouseMove = useCallback((e) => {
        if (activeIndex === PRESENTATION_LAYERS.length - 1) {
            setMouseTilt({ x: 0, y: 0 });
            return;
        }
        const { innerWidth, innerHeight } = window;
        const x = (e.clientX / innerWidth - 0.5) * 6;
        const y = (e.clientY / innerHeight - 0.5) * -6;
        setMouseTilt({ x, y });
    }, [activeIndex]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
                e.preventDefault();
                goToStep(activeIndex + 1);
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                goToStep(activeIndex - 1);
            } else if (e.key === "Escape") {
                onFinish?.();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeIndex, goToStep, onFinish]);

    // Trackpad / Wheel navigation
    const handleWheel = useCallback((e) => {
        if (isScrollingRef.current) return;
        if (Math.abs(e.deltaY) < 30) return;

        isScrollingRef.current = true;
        setTimeout(() => { isScrollingRef.current = false; }, 600);

        if (e.deltaY > 0) {
            goToStep(activeIndex + 1);
        } else {
            goToStep(activeIndex - 1);
        }
    }, [activeIndex, goToStep]);

    const activeScene = PRESENTATION_LAYERS[activeIndex];
    const todayFormatted = new Date().toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short", year: "numeric"
    });

    // Viewport camera zoom & pan targeting the specific active component
    const getCameraTransform = () => {
        if (activeScene.role === "finale") {
            return "rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate3d(0, 0, 0) scale(1)";
        }

        const baseRotX = 12 + mouseTilt.y;
        const baseRotY = -15 + mouseTilt.x;

        switch (activeScene.cameraTarget) {
            case "scenebar": // Act 3: SceneBar
                return `rotateX(${baseRotX - 1}deg) rotateY(${baseRotY}deg) translate3d(-10px, 50px, 40px) scale(1.16)`;
            case "message": // Act 2: Speech Bubble & Thought
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 12px, 45px) scale(1.18)`;
            case "planner": // Act 4: Director Drawer
                return `rotateX(${baseRotX + 1}deg) rotateY(${baseRotY}deg) translate3d(-5px, -25px, 45px) scale(1.18)`;
            case "memory": // Act 5: Memory Vault
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 15px, 40px) scale(1.15)`;
            case "chip": // Act 6: Needle 2 Wasm
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 15px, 40px) scale(1.15)`;
            case "engines": // Act 7: Dual AI Core
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 10px, 40px) scale(1.15)`;
            case "sound": // Act 8: Sound Mixer
                return `rotateX(${baseRotX + 1}deg) rotateY(${baseRotY}deg) translate3d(-5px, -15px, 40px) scale(1.16)`;
            case "armor": // Act 9: Armor Plate
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 10px, 40px) scale(1.15)`;
            case "cockpit": // Act 10: Cockpit
                return `rotateX(${baseRotX + 1}deg) rotateY(${baseRotY}deg) translate3d(-5px, -15px, 40px) scale(1.16)`;
            case "hero":
            default:
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(0, 0, 0) scale(0.95)`;
        }
    };

    return (
        <div
            className={styles.stageViewport}
            data-testid="presentation-scroll"
            data-active-step={activeIndex}
            onWheel={handleWheel}
            onMouseMove={handleMouseMove}
        >
            {/* Top Navigation Bar */}
            <header className={styles.topHudBar}>
                <div className={styles.brandCluster}>
                    <span className={styles.pulseLiveDot} />
                    <span className={styles.brandTitle}>TOM & FRIENDS • LIVING SITCOM</span>
                </div>

                <div className={styles.stepperPillTrack}>
                    {PRESENTATION_LAYERS.map((scene, idx) => (
                        <button
                            key={scene.id}
                            onClick={() => goToStep(idx)}
                            className={activeIndex === idx ? styles.pillActive : styles.pillInactive}
                            aria-label={`Step ${scene.id}: ${scene.label}`}
                            aria-current={activeIndex === idx ? "step" : undefined}
                        >
                            <span>{scene.code}</span>
                        </button>
                    ))}
                </div>

                <button onClick={onFinish} className={styles.quickSkipBtn}>
                    Enter Live Studio ⏩
                </button>
            </header>

            {/* Main Presentation Split Canvas */}
            <div className={styles.presentationSplitCanvas}>
                {/* =========================================================
                   LEFT COLUMN: Pitch HUD (Rich Explanatory Text)
                   ========================================================= */}
                <aside className={styles.pitchSideColumn}>
                    <div className={styles.hudCard} key={activeScene.id} data-testid={`caption-${activeScene.id}`}>
                        <div className={styles.actTagRow}>
                            <span className={styles.actTagBadge}>STEP {activeScene.code} / 11</span>
                            <span className={styles.categoryTag}>{activeScene.tag}</span>
                        </div>

                        <h1 className={styles.giantHeadline}>
                            {activeScene.headline}
                            <span className={styles.gradientHighlight}>{activeScene.headlineGradient}</span>
                        </h1>

                        <p className={styles.punchlineSummary}>{activeScene.blurb}</p>

                        {/* Metric Highlights */}
                        <div className={styles.metricsCluster}>
                            {activeScene.metrics.map((m, idx) => (
                                <div key={idx} className={styles.metricPill}>
                                    <span className={styles.metricIcon}>{m.icon}</span>
                                    <div className={styles.metricTextGroup}>
                                        <strong className={styles.metricTitle}>{m.label}</strong>
                                        <span className={styles.metricDesc}>{m.desc}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Source File Modules */}
                        <div className={styles.fileRow}>
                            {activeScene.files.map(file => (
                                <code key={file} className={styles.fileChip}>{file}</code>
                            ))}
                        </div>

                        {activeScene.role === "finale" && (
                            <button onClick={onFinish} className={styles.ctaEnterStudioBtn}>
                                🎭 Enter Live Studio Now 🚀
                            </button>
                        )}

                        {/* Stepper Navigation */}
                        <div className={styles.stepperRow}>
                            <button
                                onClick={() => goToStep(activeIndex - 1)}
                                disabled={activeIndex === 0}
                                className={styles.prevBtn}
                            >
                                ← Prev
                            </button>
                            <span className={styles.stepperCounter}>{activeIndex + 1} / {PRESENTATION_LAYERS.length}</span>
                            <button
                                onClick={() => activeScene.role === "finale" ? onFinish() : goToStep(activeIndex + 1)}
                                className={styles.nextBtn}
                            >
                                {activeScene.role === "finale" ? "Launch Studio 🚀" : "Next Scene →"}
                            </button>
                        </div>
                    </div>
                </aside>

                {/* =========================================================
                   RIGHT COLUMN: 3D Stage with Zoom, Elevation & Hologram
                   ========================================================= */}
                <main className={styles.stage3DColumn}>
                    <div className={styles.chassisBackdropHalo} />

                    <div className={styles.perspectiveChamber}>
                        {/* Nested Camera Rig: Pans & Zooms Viewport smoothly */}
                        <div className={styles.cameraRig} style={{ transform: getCameraTransform() }}>
                            <div
                                className={`${styles.phoneChassis} ${activeScene.role === "finale" ? styles.chassisAssembled : ""}`}
                                data-testid="phone"
                            >
                                {/* Physical 3D Extrusion Backplate */}
                                <div className={styles.chassisExtrusionDepth} />
                                <div className={styles.glassReflectionGlare} />

                                {/* Speaker Notch Bar */}
                                <div className={styles.phoneSpeakerBar}>
                                    <span className={styles.notchClock}>14:30</span>
                                    <div className={styles.speakerPill} />
                                    <span className={styles.notchIcons}>5G 🔋 98%</span>
                                </div>

                                {/* =======================================================
                                   Phone Display Screen: Identical to Live App UI
                                   ======================================================= */}
                                <div className={styles.phoneDisplayScreen}>
                                    {/* App Header Bar */}
                                    <div className={styles.appHeader}>
                                        <img src="/group.png" alt="Tom & Friends" width={26} height={26} className={styles.groupAvatar} />
                                        <div className={styles.headerInfo}>
                                            <span className={styles.headerAppName}>Tom & Friends</span>
                                            <span className={styles.headerRoomStatus}>
                                                <span className={styles.greenDot} /> 6 In Room • Lucknow Studio
                                            </span>
                                        </div>
                                    </div>

                                    {/* SceneBar: Pop-Out Elevation in Step 3 */}
                                    <div className={`${styles.sceneBarContainer} ${activeScene.cameraTarget === "scenebar" ? styles.focusElevatedBar : ""}`}>
                                        <div className={styles.marqueeTrack}>
                                            <span className={styles.marqueeText}>
                                                📍 Lucknow • 🌤️ 32°C, Warm • 🎯 Casual Banter • ⚡ Goal: Relax with samosas • 📰 India GDP accelerates
                                            </span>
                                        </div>
                                        <div className={styles.equalizerTag}>
                                            <span className={styles.eqWave} />
                                            <span className={styles.eqWave} />
                                            <span className={styles.eqWave} />
                                            <span>ON</span>
                                        </div>
                                    </div>

                                    {/* Chat Feed Canvas */}
                                    <div className={styles.chatFeedArea}>
                                        {/* Step 4: Director Storyline Planner Drawer View */}
                                        {activeScene.cameraTarget === "planner" && (
                                            <div className={`${styles.plannerDrawerOverlay} ${styles.focusElevatedPlanner}`}>
                                                <div className={styles.plannerHeader}>
                                                    <span>🎬 Director Demand Engine</span>
                                                    <span className={styles.geminiBadge}>Gemini Flash 65K</span>
                                                </div>

                                                <div className={styles.demandBox}>
                                                    <span>"A stray puppy enters the garage at 5 PM"</span>
                                                    <span className={styles.stagedBadge}>⚡ Staged</span>
                                                </div>

                                                <div className={styles.diffCardProposed}>
                                                    <span className={styles.diffAdd}>+ PROPOSED</span>
                                                    <strong>17:00 - 18:30 • Rescue the Stray Puppy</strong>
                                                </div>
                                                <div className={styles.diffCardRemoved}>
                                                    <span className={styles.diffSub}>− REMOVED</span>
                                                    <del>17:00 - 18:30 • Casual Garage Gaming</del>
                                                </div>

                                                <div className={styles.diffActions}>
                                                    <span className={styles.acceptBtn}>✓ Accept Twist</span>
                                                    <span className={styles.denyBtn}>✕ Deny</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Step 5: Memory Vault Display */}
                                        {activeScene.cameraTarget === "memory" && (
                                            <div className={`${styles.memoryVaultCard} ${styles.focusElevatedCard}`}>
                                                <div className={styles.vaultHeaderRow}>
                                                    <span className={styles.vaultTitle}>🧠 20k Episodic Memory Vault</span>
                                                    <span className={styles.vaultGaugeText}>8,432 / 20,000 chars</span>
                                                </div>

                                                <div className={styles.vaultItem}>
                                                    <span className={styles.vaultKey}>📌 Tom: [Mood: Hyper-Excited]</span>
                                                    <span className={styles.ttlTag}>15m TTL</span>
                                                </div>
                                                <div className={styles.vaultItem}>
                                                    <span className={styles.vaultKey}>📌 Ben: [Secret: Hidden battery pack in garage]</span>
                                                    <span className={styles.foreverTag}>Permanent</span>
                                                </div>
                                                <div className={styles.vaultItem}>
                                                    <span className={styles.vaultKey}>📌 Hank: [Posture: Eating samosas by the door]</span>
                                                    <span className={styles.ttlTag}>15m TTL</span>
                                                </div>

                                                <div className={styles.gemmaBadge}>
                                                    🗜️ Gemma Auto-Compression Active
                                                </div>
                                            </div>
                                        )}

                                        {/* Step 6: Needle 2 Wasm Router */}
                                        {activeScene.cameraTarget === "chip" && (
                                            <div className={`${styles.needleChipCard} ${styles.focusElevatedCard}`}>
                                                <div className={styles.chipHeaderRow}>
                                                    <span className={styles.chipTitle}>⚙️ Needle 2 On-Device Router</span>
                                                    <span className={styles.chipLatencyBadge}>⚡ &lt;1ms</span>
                                                </div>

                                                <div className={styles.chipPipelineRow}>
                                                    <span className={styles.chipNode}>User Input</span>
                                                    <span className={styles.chipArrow}>➔</span>
                                                    <span className={styles.chipNodeCore}>Needle Wasm (14MB)</span>
                                                    <span className={styles.chipArrow}>➔</span>
                                                    <span className={styles.chipNode}>Target: Tom</span>
                                                </div>

                                                <div className={styles.chipOfflineText}>
                                                    🌐 Operates 100% Client-Side with Zero Network Latency
                                                </div>
                                            </div>
                                        )}

                                        {/* Step 7: Dual AI Core & Local Storage */}
                                        {activeScene.cameraTarget === "engines" && (
                                            <div className={`${styles.architectureFlowchart} ${styles.focusElevatedCard}`}>
                                                <div className={styles.flowchartBanner}>
                                                    <span>🛡️ DUAL AI CORE • ZERO REMOTE SERVERS</span>
                                                </div>

                                                <div className={styles.flowchartPipeline}>
                                                    <div className={styles.pipelineRow}>
                                                        <div className={styles.pipelineNodeHighlight}>
                                                            <strong className={styles.nodeTitle}>Groq Cloud (LPU)</strong>
                                                            <span className={styles.nodeFile}>Sub-Second Banter</span>
                                                        </div>
                                                        <span className={styles.pipelineArrow}>⇄</span>
                                                        <div className={styles.pipelineNodeHighlight}>
                                                            <strong className={styles.nodeTitle}>Gemini AI Studio</strong>
                                                            <span className={styles.nodeFile}>65K Macro Planner</span>
                                                        </div>
                                                    </div>

                                                    <div className={styles.pipelineArrowDown}>↓</div>

                                                    <div className={styles.pipelineNodeStorage}>
                                                        <strong className={styles.storageTitle}>💾 Private IndexedDB (Storage.js)</strong>
                                                        <span className={styles.storageSubtitle}>
                                                            100% Client-Side DB • Zero Cloud Logging
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Step 8: Procedural Web Audio Synth */}
                                        {activeScene.cameraTarget === "sound" && (
                                            <div className={`${styles.soundMixerCard} ${styles.focusElevatedCard}`}>
                                                <div className={styles.mixerHeaderRow}>
                                                    <span className={styles.mixerTitle}>🎚️ Web Audio Procedural Synth</span>
                                                    <span className={styles.bpmBadge}>112 BPM</span>
                                                </div>

                                                <div className={styles.mixerSliderItem}>
                                                    <span>Master Volume (50%)</span>
                                                    <div className={styles.mockSliderBar} style={{ "--fill": "50%" }} />
                                                </div>
                                                <div className={styles.mixerSliderItem}>
                                                    <span>Theme Melody (75%)</span>
                                                    <div className={styles.mockSliderBar} style={{ "--fill": "75%" }} />
                                                </div>
                                                <div className={styles.mixerSliderItem}>
                                                    <span>Room Air (Brown Noise)</span>
                                                    <div className={styles.mockSliderBar} style={{ "--fill": "20%" }} />
                                                </div>

                                                <div className={styles.mixerPresetsRow}>
                                                    <span className={styles.presetTagActive}>🎉 Sitcom</span>
                                                    <span className={styles.presetTag}>☕ Cozy Lounge</span>
                                                    <span className={styles.presetTag}>🌙 Sleep</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Step 9: Armor Plate Resilience */}
                                        {activeScene.cameraTarget === "armor" && (
                                            <div className={`${styles.armorShieldCard} ${styles.focusElevatedCard}`}>
                                                <div className={styles.shieldHeaderRow}>
                                                    <span className={styles.shieldTitle}>🛡️ Engine Armor & Resilience</span>
                                                    <span className={styles.armorOkBadge}>ACTIVE</span>
                                                </div>

                                                <div className={styles.armorFeatureList}>
                                                    <div className={styles.armorCheckItem}>✅ Circuit Breaker: Prevents Cascading Freezes</div>
                                                    <div className={styles.armorCheckItem}>✅ Rate Limiter: Enforces Server-Timed Reset Windows</div>
                                                    <div className={styles.armorCheckItem}>✅ PWA Service Worker: Full Cache-First Offline Shell</div>
                                                    <div className={styles.armorCheckItem}>✅ Self-Healing Database: Auto-Repairs IndexedDB</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Step 10: Cockpit Observability */}
                                        {activeScene.cameraTarget === "cockpit" && (
                                            <div className={`${styles.cockpitCard} ${styles.focusElevatedCard}`}>
                                                <div className={styles.cockpitHeaderRow}>
                                                    <span className={styles.cockpitTitle}>📈 DevTools Cockpit Suite</span>
                                                    <span className={styles.cockpitBadge}>PROMPT TRACES</span>
                                                </div>

                                                <div className={styles.cockpitTraceBox}>
                                                    <div className={styles.traceMeta}>Model: openai/gpt-oss-120b • Latency: 342ms</div>
                                                    <div className={styles.traceTokens}>Tokens In: 120 / Out: 38 • Finish: STOP</div>
                                                    <div className={styles.traceThought}>&lt;think&gt; Tom wants to test drone safely... &lt;/think&gt;</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Standard Interactive Chat Feed (Steps 1, 2, and Hero) */}
                                        {(!["planner", "memory", "chip", "engines", "sound", "armor", "cockpit"].includes(activeScene.cameraTarget)) && (
                                            <div className={styles.chatBubblesColumn}>
                                                <div className={`${styles.messageRow} ${activeScene.cameraTarget === "message" ? styles.focusElevatedMessage : ""}`}>
                                                    <div className={styles.circularAvatar}>
                                                        <Avatar member={Tom} emotion="Laughing" glow={true} />
                                                    </div>

                                                    <div className={styles.speechBubble}>
                                                        <div className={styles.bubbleSender}>Tom</div>
                                                        <p className={styles.bubbleText}>
                                                            "Arre yaar! Lucknow garage mein swagat hai. Maine naya drone setup kiya hai, aaj shaam ko terrace pe test karenge!"
                                                        </p>

                                                        {/* Thought Box Peek */}
                                                        <div className={styles.thoughtBox}>
                                                            <span className={styles.thoughtHeader}>💭 INNER MONOLOGUE:</span>
                                                            <p className={styles.thoughtContent}>
                                                                "Main Ben ko dikhana chahta hoon ki main bhi tech samajhta hoon, bhale hi drone crash ho jaye!"
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Angela typing indicator */}
                                                <div className={styles.typingIndicatorRow}>
                                                    <div className={styles.circularAvatarMini}>
                                                        <Avatar member={Angela} emotion="Happy" glow={false} />
                                                    </div>
                                                    <div className={styles.typingBubble}>
                                                        <span className={styles.bounceDot} />
                                                        <span className={styles.bounceDot} />
                                                        <span className={styles.bounceDot} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Footer with Character Lounge Strip and Input Box */}
                                    <footer className={styles.footerContainer}>
                                        <div className={styles.charactersTrack}>
                                            {[
                                                { char: Tom, mood: "Excited" },
                                                { char: Angela, mood: "Happy" },
                                                { char: Ben, mood: "Thinking" },
                                                { char: Ginger, mood: "Laughing" },
                                                { char: Hank, mood: "Default" },
                                                { char: Becca, mood: "Default" }
                                            ].map((item) => (
                                                <div key={item.char.id} className={styles.charItem}>
                                                    <div className={styles.footerAvatarFrame}>
                                                        <Avatar member={item.char} emotion={item.mood} glow={false} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className={styles.inputHub}>
                                            <div className={styles.inputForm}>
                                                <input
                                                    type="text"
                                                    readOnly
                                                    placeholder="Talk with Tom and the cast..."
                                                    className={styles.inputField}
                                                />
                                                <button type="button" className={styles.expressionBtn}>🎭</button>
                                                <button type="button" className={styles.sendBtn}>🚀</button>
                                            </div>
                                        </div>
                                    </footer>
                                </div>

                                {/* Step 11 Finale: Studio Lobby Screen Reassembly */}
                                {activeScene.role === "finale" && (
                                    <div className={styles.lobbyReassembledOverlay}>
                                        <div className={styles.lobbyBadge}>🎬 LIVING STUDIO LOBBY</div>
                                        <div className={styles.lobbyAvatarGroup}>
                                            <div className={styles.lobbyRingGlow} />
                                            <img src="/group.png" alt="Tom & Friends Cast" className={styles.lobbyGroupAvatar} />
                                        </div>
                                        <h2 className={styles.lobbyTitle}>Tom & Friends</h2>
                                        <p className={styles.lobbyDate}>📍 Lucknow Studio • {todayFormatted}</p>
                                        <p className={styles.lobbyDesc}>
                                            Tom, Angela, Ben, Ginger, Hank, and Becca are ready. Step inside to chat or direct today's scene!
                                        </p>
                                        <button onClick={onFinish} className={styles.lobbyLoginBtn}>
                                            🎭 Log In & Enter Studio
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 3D Holographic Tooltip / Virtual Representation Callout */}
                            {activeScene.tooltip && (
                                <aside className={styles.holographicTooltip}>
                                    <div className={styles.tooltipPointerLine} />
                                    <div className={styles.tooltipHeaderRow}>
                                        <span className={styles.tooltipBadge}>{activeScene.tooltip.badge}</span>
                                        <span className={styles.tooltipPulseDot} />
                                    </div>
                                    <h4 className={styles.tooltipTitle}>{activeScene.tooltip.title}</h4>
                                    <span className={styles.tooltipSubtitle}>{activeScene.tooltip.subtitle}</span>
                                    <p className={styles.tooltipDesc}>{activeScene.tooltip.desc}</p>
                                </aside>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}