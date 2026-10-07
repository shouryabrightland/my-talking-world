// src/components/presentation/PresentationView.jsx
// @ts-check

import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./PresentationView.module.css";
import Avatar from "../Avatar";
import { Tom, Angela, Ben, Ginger, Hank, Becca } from "../../util/member";
import { Sound } from "../../util/sound";

export const PRESENTATION_SCENES = [
    {
        id: 0,
        act: "ACT 0 • THE BREAKTHROUGH",
        headlineMain: "CHATBOTS ARE DEAD.",
        headlineGradient: "WE BUILT A LIVING SITCOM.",
        punchline: "Transforming kids from passive reel-scrolling digital zombies into active story directors.",
        metrics: [
            { icon: "🚫", label: "Zero Prompts", desc: "Autonomous Banter" },
            { icon: "🎭", label: "6 AI Friends", desc: "Lucknow Garage Studio" },
            { icon: "🎬", label: "You Direct", desc: "Complete Creative Agency" }
        ],
        cameraTarget: "hero",
        mockMessage: {
            member: Tom,
            emotion: "Laughing",
            sender: "Tom",
            text: "Arre yaar! Lucknow garage mein swagat hai. Aaj kuch toofani create karte hain!",
            thought: "Main chahta hoon sab dekhein ki hum kitne cool hain."
        }
    },
    {
        id: 1,
        act: "ACT I • REALITY ANCHOR",
        headlineMain: "AI GROUNDED IN",
        headlineGradient: "TODAY'S REAL WORLD.",
        punchline: "Never hallucinates in a void. Environmental engine syncs live Lucknow weather, Indian festivals, and news.",
        metrics: [
            { icon: "🌤️", label: "Open-Meteo", desc: "Live 32°C Lucknow Weather" },
            { icon: "🎉", label: "Calendar Bharat", desc: "Indian Festival Sync" },
            { icon: "📰", label: "Google News", desc: "Live Regional RSS Feeds" }
        ],
        cameraTarget: "scenebar",
        mockMessage: {
            member: Angela,
            emotion: "Happy",
            sender: "Angela",
            text: "Uff, Lucknow mein 32°C garmi hai aaj! Shaam ko Gomti Nagar riverfront pe cold coffee peete hain.",
            thought: "Riverfront pe photo shoot ke liye lighting bohot achi hogi."
        }
    },
    {
        id: 2,
        act: "ACT II • COGNITIVE TRANSPARENCY",
        headlineMain: "THEY THINK",
        headlineGradient: "BEFORE THEY SPEAK.",
        punchline: "Natural Lucknow Roman Hinglish banter with peekable inner monologues and human typing delays.",
        metrics: [
            { icon: "💭", label: "Thought Peels", desc: "Inspect Unspoken Motives" },
            { icon: "🗣️", label: "Roman Hinglish", desc: "Authentic Local Slang" },
            { icon: "⚡", label: "Sub-Second", desc: "Groq LPU Dialogue Core" }
        ],
        cameraTarget: "message",
        mockMessage: {
            member: Ben,
            emotion: "Thinking",
            sender: "Ben",
            text: "Maine garage ka naya solar circuit test kiya hai. Tom, tumhare drone ko direct charge kar sakte hain!",
            thought: "Umeed hai Tom battery polarity ulti connect nahi karega."
        }
    },
    {
        id: 3,
        act: "ACT III • ON-DEVICE PRIVACY",
        headlineMain: "100% PRIVATE.",
        headlineGradient: "ZERO SERVER LEAKS.",
        punchline: "All memories and chat logs persist locally in browser IndexedDB. Zero private data touches any remote server.",
        metrics: [
            { icon: "🔒", label: "Local IndexedDB", desc: "Zero External Server Storage" },
            { icon: "🧠", label: "Dual Memory", desc: "15m Postures vs Permanent Secrets" },
            { icon: "🛡️", label: "Self-Healing", desc: "Local Corruption Recovery" }
        ],
        cameraTarget: "architecture",
        mockMessage: {
            member: Ginger,
            emotion: "Laughing",
            sender: "Ginger",
            text: "Maine Ben ki spare battery chupa di hai garage mein, kisi ko mat batana!",
            thought: "Ab Ben gusse mein pura garage dhoondhega!"
        }
    },
    {
        id: 4,
        act: "ACT IV • DIRECTOR GOD-MODE",
        headlineMain: "YOU ARE NOT JUST A USER.",
        headlineGradient: "YOU ARE THE DIRECTOR.",
        punchline: "Guide the 24-hour narrative arc. The AI macro planner recalculates timeline blocks with visual diffs.",
        metrics: [
            { icon: "🎬", label: "200+ Cues", desc: "Instant Sitcom Plot Twists" },
            { icon: "📅", label: "24h Continuity", desc: "Gemini 65K Normalizer" },
            { icon: "⚖️", label: "Visual Diffs", desc: "+Proposed / −Removed Diffs" }
        ],
        cameraTarget: "planner",
        mockMessage: {
            member: Hank,
            emotion: "Default",
            sender: "Hank",
            text: "Director ne plot twist de diya! 5 baje stray puppy aa raha hai garage mein!",
            thought: ""
        }
    },
    {
        id: 5,
        act: "FINALE • TAKE THE WHEEL",
        headlineMain: "DON'T TAKE OUR WORD.",
        headlineGradient: "EXPERIENCE IT LIVE.",
        punchline: "3D components lock together seamlessly. Step inside the studio to chat or direct right now.",
        metrics: [
            { icon: "🚀", label: "Zero Reload", desc: "Instant Seamless Boot" },
            { icon: "⚡", label: "Dual AI Core", desc: "Groq Banter + Gemini Planning" },
            { icon: "🎵", label: "Web Audio", desc: "Procedural 3-Ch Synth" }
        ],
        cameraTarget: "finale",
        mockMessage: {
            member: Becca,
            emotion: "Default",
            sender: "Becca",
            text: "Sab ready hain? Chalo jury ko live studio demo dikhate hain!",
            thought: ""
        }
    }
];

/**
 * @param {Object} props
 * @param {(() => void)} [props.onFinish] Exit callback back to the studio.
 * @returns {React.JSX.Element}
 */
export default function PresentationView({ onFinish }) {
    const [activeAct, setActiveAct] = useState(0);
    const [mouseTilt, setMouseTilt] = useState({ x: 0, y: 0 });
    const isScrollingRef = useRef(false);

    const goToAct = useCallback(
        /** @param {number} newIdx */
        (newIdx) => {
            const clamped = Math.max(0, Math.min(PRESENTATION_SCENES.length - 1, newIdx));
            setActiveAct(clamped);
            try { Sound.playMessagePop(); } catch {}
        },
        []
    );

    // Interactive hover parallax
    const handleMouseMove = useCallback(
        /** @param {React.MouseEvent} e */
        (e) => {
            if (activeAct === 5) {
                setMouseTilt({ x: 0, y: 0 });
                return;
            }
            const { innerWidth, innerHeight } = window;
            const x = (e.clientX / innerWidth - 0.5) * 6;
            const y = (e.clientY / innerHeight - 0.5) * -6;
            setMouseTilt({ x, y });
        },
        [activeAct]
    );

    // Keyboard navigation
    useEffect(() => {
        /** @param {KeyboardEvent} e */
        const handleKeyDown = (e) => {
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

    // Trackpad / Wheel navigation
    const handleWheel = useCallback(
        /** @param {React.WheelEvent} e */
        (e) => {
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

    const currentScene = PRESENTATION_SCENES[activeAct];
    const todayFormatted = new Date().toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short", year: "numeric"
    });

    // Viewport camera target transform (applied to cameraRig, NOT phoneChassis)
    const getCameraTransform = () => {
        if (activeAct === 5) {
            return "rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate3d(0, 0, 0) scale(1)";
        }

        const baseRotX = 12 + mouseTilt.y;
        const baseRotY = -16 + mouseTilt.x;

        switch (currentScene.cameraTarget) {
            case "scenebar":
                return `rotateX(${baseRotX - 1}deg) rotateY(${baseRotY}deg) translate3d(-10px, 50px, 40px) scale(1.15)`;
            case "message":
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 10px, 45px) scale(1.18)`;
            case "architecture":
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(-5px, 15px, 40px) scale(1.14)`;
            case "planner":
                return `rotateX(${baseRotX + 1}deg) rotateY(${baseRotY}deg) translate3d(-5px, -25px, 45px) scale(1.18)`;
            case "hero":
            default:
                return `rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) translate3d(0, 0, 0) scale(0.95)`;
        }
    };

    return (
        <div className={styles.stageViewport} onWheel={handleWheel} onMouseMove={handleMouseMove}>
            {/* Top Navigation Bar */}
            <header className={styles.topHudBar}>
                <div className={styles.brandCluster}>
                    <span className={styles.pulseLiveDot} />
                    <span className={styles.brandTitle}>TOM & FRIENDS</span>
                    <span className={styles.brandSub}>CBSE HACKATHON 2026</span>
                </div>

                <div className={styles.stepperPillTrack}>
                    {PRESENTATION_SCENES.map((scene) => (
                        <button
                            key={scene.id}
                            onClick={() => goToAct(scene.id)}
                            className={activeAct === scene.id ? styles.pillActive : styles.pillInactive}
                            aria-label={`Jump to Act ${scene.id}`}
                        >
                            <span>{scene.id}</span>
                        </button>
                    ))}
                </div>

                <button onClick={onFinish} className={styles.quickSkipBtn}>
                    Enter Live Studio ⏩
                </button>
            </header>

            {/* Split Screen Stage */}
            <div className={styles.presentationSplitCanvas}>
                {/* =========================================================
                   LEFT: Pitch Content HUD (Clean, High-Contrast)
                   ========================================================= */}
                <aside className={styles.pitchSideColumn}>
                    <div className={styles.hudCard} key={currentScene.id}>
                        <div className={styles.actTagRow}>
                            <span className={styles.actTagBadge}>{currentScene.act}</span>
                        </div>

                        <h1 className={styles.giantHeadline}>
                            {currentScene.headlineMain}
                            <span className={styles.gradientHighlight}>{currentScene.headlineGradient}</span>
                        </h1>

                        <p className={styles.punchlineSummary}>{currentScene.punchline}</p>

                        {/* Minimal Metric Cards */}
                        <div className={styles.metricsCluster}>
                            {currentScene.metrics.map((m, idx) => (
                                <div key={idx} className={styles.metricPill}>
                                    <span className={styles.metricIcon}>{m.icon}</span>
                                    <div className={styles.metricTextGroup}>
                                        <strong className={styles.metricTitle}>{m.label}</strong>
                                        <span className={styles.metricDesc}>{m.desc}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {activeAct === 5 && (
                            <button onClick={onFinish} className={styles.ctaEnterStudioBtn}>
                                🎭 Enter Live Studio Now 🚀
                            </button>
                        )}

                        {/* Stepper Controls */}
                        <div className={styles.stepperRow}>
                            <button
                                onClick={() => goToAct(activeAct - 1)}
                                disabled={activeAct === 0}
                                className={styles.prevBtn}
                            >
                                ← Prev
                            </button>
                            <span className={styles.stepperCounter}>{activeAct + 1} / {PRESENTATION_SCENES.length}</span>
                            <button
                                onClick={() => activeAct === 5 ? onFinish?.() : goToAct(activeAct + 1)}
                                className={styles.nextBtn}
                            >
                                {activeAct === 5 ? "Launch Studio 🚀" : "Next Scene →"}
                            </button>
                        </div>
                    </div>
                </aside>

                {/* =========================================================
                   RIGHT: 3D Stage (Crystal-Clear Visibility)
                   ========================================================= */}
                <main className={styles.stage3DColumn}>
                    <div className={styles.chassisBackdropHalo} />

                    <div className={styles.perspectiveChamber}>
                        {/* Nested Camera Rig: Pans and zooms without breaking @keyframes floatingLevitate */}
                        <div className={styles.cameraRig} style={{ transform: getCameraTransform() }}>
                            <div className={`${styles.phoneChassis} ${activeAct === 5 ? styles.chassisAssembled : ""}`}>
                                {/* Physical 3D Extrusion Depth Backplate */}
                                <div className={styles.chassisExtrusionDepth} />
                                <div className={styles.glassReflectionGlare} />

                                {/* Speaker Notch Bar */}
                                <div className={styles.phoneSpeakerBar}>
                                    <span className={styles.notchClock}>14:30</span>
                                    <div className={styles.speakerPill} />
                                    <span className={styles.notchIcons}>5G 🔋 98%</span>
                                </div>

                                {/* =======================================================
                                   Phone Display Screen (Strict overflow: hidden with curved corners)
                                   ======================================================= */}
                                <div className={styles.phoneDisplayScreen}>
                                    {/* App Header */}
                                    <div className={styles.appHeader}>
                                        <img src="/group.png" alt="Tom & Friends" width={26} height={26} className={styles.groupAvatar} />
                                        <div className={styles.headerInfo}>
                                            <span className={styles.headerAppName}>Tom & Friends</span>
                                            <span className={styles.headerRoomStatus}>
                                                <span className={styles.greenDot} /> 6 In Room • Lucknow Studio
                                            </span>
                                        </div>
                                    </div>

                                    {/* SceneBar (Act 1 Focus) */}
                                    <div className={`${styles.sceneBarContainer} ${currentScene.cameraTarget === "scenebar" ? styles.focusActiveBar : ""}`}>
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

                                    {/* Central Chat Feed */}
                                    <div className={styles.chatFeedArea}>
                                        {/* Act III: On-Device Class Architecture Flowchart */}
                                        {currentScene.cameraTarget === "architecture" ? (
                                            <div className={styles.architectureFlowchart}>
                                                <div className={styles.flowchartBanner}>
                                                    <span>🛡️ 100% ON-DEVICE RUNTIME • NO EXTERNAL SERVERS</span>
                                                </div>

                                                <div className={styles.flowchartPipeline}>
                                                    {/* Row 1: Input to Turn Engine */}
                                                    <div className={styles.pipelineRow}>
                                                        <div className={styles.pipelineNode}>
                                                            <span className={styles.nodeIcon}>👤</span>
                                                            <strong className={styles.nodeTitle}>User Input</strong>
                                                            <span className={styles.nodeFile}>me (ChatMember)</span>
                                                        </div>
                                                        <span className={styles.pipelineArrow}>➔</span>
                                                        <div className={styles.pipelineNodeHighlight}>
                                                            <span className={styles.nodeIcon}>🧠</span>
                                                            <strong className={styles.nodeTitle}>Turn Engine</strong>
                                                            <span className={styles.nodeFile}>ConversationManager.js</span>
                                                        </div>
                                                    </div>

                                                    <div className={styles.pipelineArrowDown}>↓</div>

                                                    {/* Row 2: Codec to Pacing Queue */}
                                                    <div className={styles.pipelineRow}>
                                                        <div className={styles.pipelineNode}>
                                                            <span className={styles.nodeIcon}>📜</span>
                                                            <strong className={styles.nodeTitle}>Stream Codec</strong>
                                                            <span className={styles.nodeFile}>ProtocolCodec.js</span>
                                                        </div>
                                                        <span className={styles.pipelineArrow}>➔</span>
                                                        <div className={styles.pipelineNode}>
                                                            <span className={styles.nodeIcon}>⏱️</span>
                                                            <strong className={styles.nodeTitle}>Pacing Queue</strong>
                                                            <span className={styles.nodeFile}>TimelineProcessor.js</span>
                                                        </div>
                                                    </div>

                                                    <div className={styles.pipelineArrowDown}>↓</div>

                                                    {/* Row 3: Full-Width IndexedDB Storage Node */}
                                                    <div className={styles.pipelineNodeStorage}>
                                                        <div className={styles.storageTitleRow}>
                                                            <span className={styles.nodeIcon}>💾</span>
                                                            <strong className={styles.storageTitle}>Private IndexedDB (Storage.js)</strong>
                                                        </div>
                                                        <span className={styles.storageSubtitle}>
                                                            100% Client-Side DB • Zero Cloud Server Storage
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            /* Normal Chat Feed with dynamically generated message */
                                            <div className={styles.chatBubblesColumn}>
                                                <div className={`${styles.messageRow} ${currentScene.cameraTarget === "message" ? styles.focusActiveBubble : ""}`}>
                                                    <div className={styles.circularAvatar}>
                                                        <Avatar member={currentScene.mockMessage.member} emotion={currentScene.mockMessage.emotion} glow={true} />
                                                    </div>

                                                    <div className={styles.speechBubble}>
                                                        <div className={styles.bubbleSender}>{currentScene.mockMessage.sender}</div>
                                                        <p className={styles.bubbleText}>"{currentScene.mockMessage.text}"</p>

                                                        {currentScene.mockMessage.thought && (
                                                            <div className={styles.thoughtBox}>
                                                                <span className={styles.thoughtHeader}>💭 INNER MONOLOGUE:</span>
                                                                <p className={styles.thoughtContent}>"{currentScene.mockMessage.thought}"</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Angela typing indicator preview */}
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

                                        {/* Act IV: Storyline Planner Drawer in Phone */}
                                        {currentScene.cameraTarget === "planner" && (
                                            <div className={`${styles.plannerDrawerOverlay} ${styles.focusActivePlanner}`}>
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
                                    </div>

                                    {/* Footer with Character Track and Input Box */}
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

                                {/* Act V: Magnetic Re-Assembly into Studio Lobby */}
                                {currentScene.cameraTarget === "finale" && (
                                    <div className={styles.lobbyReassembledOverlay}>
                                        <div className={styles.lobbyBadge}>🎬 LIVING STUDIO LOBBY</div>
                                        <div className={styles.lobbyAvatarGroup}>
                                            <div className={styles.lobbyRingGlow} />
                                            <img src="/group.png" alt="Tom & Friends Cast" className={styles.lobbyGroupAvatar} />
                                        </div>
                                        <h2 className={styles.lobbyTitle}>Tom & Friends</h2>
                                        <p className={styles.lobbyDate}>📍 Lucknow Studio • {todayFormatted}</p>
                                        <p className={styles.lobbyDesc}>
                                            Tom, Angela, Ben, Ginger, Hank, and Becca are ready. Step inside to chat or direct the scene!
                                        </p>
                                        <button onClick={onFinish} className={styles.lobbyLoginBtn}>
                                            🎭 Log In & Enter Studio
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}