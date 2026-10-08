// src/components/presentation/PresentationView.jsx
// @ts-check

/**
 * @file PresentationView — continuous scroll "living flowchart" pitch.
 *
 * A single vertical journey: 11 architectural stations chained by a glowing
 * data-conduit pipeline. Scroll progress (0 → 1) drives the conduit fill, the
 * HUD progress bar and the active-station state. No slides, no Next/Prev,
 * no artificial act cuts — wheel, touch, keyboard and the HUD dots all move
 * through the same continuous pipeline.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./PresentationView.module.css";
import Avatar from "../Avatar";
import { Tom, Angela, Ben, Ginger, Hank, Becca } from "../../util/member";
import { Sound } from "../../util/sound";

/**
 * @typedef {Object} PresentationStation
 * @property {number} id 1-based station index.
 * @property {string} code Zero-padded station code ("01").
 * @property {string} label Short label used by the HUD jump dots.
 * @property {string} headline Giant kinetic headline.
 * @property {string} subTag Single-line capability tag.
 * @property {string[]} files Source modules this station visualizes.
 */

/** @type {PresentationStation[]} */
export const PRESENTATION_STATIONS = [
    { id: 1, code: "01", label: "Privacy", headline: "ZERO-SERVER PRIVACY", subTag: "100% Client-Side • Dual API Keys", files: ["apiKeys.js", "ApiKeyOnboardingScreen.jsx"] },
    { id: 2, code: "02", label: "Reality", headline: "GROUNDED REALITY", subTag: "Live City Sync • Lucknow, India", files: ["environment.js", "SceneBar.jsx"] },
    { id: 3, code: "03", label: "Horizon", headline: "24-HOUR LIVING ARC", subTag: "Continuous Daily Timeline", files: ["WorldSetter.js", "World.js"] },
    { id: 4, code: "04", label: "Director", headline: "DIRECTOR GOD-MODE", subTag: "Instant Sitcom Plot Twists", files: ["directorPresets.js", "Demand Engine"] },
    { id: 5, code: "05", label: "Memory", headline: "20,000-CHAR VAULT", subTag: "Unified Episodic Memory", files: ["Memory.js", "20k Stack"] },
    { id: 6, code: "06", label: "Router", headline: "ON-DEVICE 14MB AI CHIP", subTag: "<1ms Wasm Tool-Calling", files: ["NeedleRouter.js", "Needle 2 by Cactus"] },
    { id: 7, code: "07", label: "Banter", headline: "SUB-SECOND BANTER", subTag: "Authentic Lucknow Hinglish", files: ["GroqClient.js", "Reaction.js"] },
    { id: 8, code: "08", label: "Sound", headline: "PROCEDURAL SOUND ENGINE", subTag: "Web Audio API • Zero MP3 Files", files: ["sound.js"] },
    { id: 9, code: "09", label: "Armor", headline: "UNBREAKABLE ARMOR", subTag: "Self-Healing Fault Tolerance", files: ["CircuitBreaker.js", "RateLimiter.js", "PWA sw.js"] },
    { id: 10, code: "10", label: "Cockpit", headline: "LIVE SYSTEM COCKPIT", subTag: "Client-Side Observability Suite", files: ["DevToolsBar.jsx", "DevToolsDrawer.jsx"] },
    { id: 11, code: "11", label: "Studio", headline: "TAKE THE WHEEL", subTag: "Experience It Live", files: ["Chat.jsx"] }
];

/** Fixed-date Indian holidays used by the Station 02 calendar flipper. @type {Array<{m: number, d: number, name: string}>} */
const INDIAN_HOLIDAYS = [
    { m: 1, d: 26, name: "Republic Day" },
    { m: 8, d: 15, name: "Independence Day" },
    { m: 10, d: 2, name: "Gandhi Jayanti" },
    { m: 12, d: 25, name: "Christmas" }
];

/**
 * Resolves the next fixed-date Indian holiday and its day countdown.
 * @returns {string} e.g. "Gandhi Jayanti in 3d".
 */
function nextHolidayLabel() {
    const now = new Date();
    const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    /** @type {{ name: string, days: number }} */
    let best = { name: INDIAN_HOLIDAYS[0].name, days: 365 };

    for (const holiday of INDIAN_HOLIDAYS) {
        let target = Date.UTC(now.getFullYear(), holiday.m - 1, holiday.d);
        if (target < todayMs) target = Date.UTC(now.getFullYear() + 1, holiday.m - 1, holiday.d);
        const days = Math.round((target - todayMs) / 86_400_000);
        if (days < best.days) best = { name: holiday.name, days };
    }

    return best.days === 0 ? `${best.name} • today` : `${best.name} in ${best.days}d`;
}

/** 24-hour macro schedule blocks rendered by Station 03. @type {Array<{label: string, from: number, span: number}>} */
const DAY_BLOCKS = [
    { label: "Chai Adda", from: 7, span: 3 },
    { label: "Creative Session", from: 10, span: 3 },
    { label: "Riverfront Walk", from: 17, span: 2 },
    { label: "Night Terrace", from: 21, span: 3 }
];

/** Nine sprite emotions exposed by Reaction.js. @type {Array<{icon: string, name: string}>} */
const EMOTION_MATRIX = [
    { icon: "🙂", name: "Default" },
    { icon: "😊", name: "Happy" },
    { icon: "😂", name: "Laughing" },
    { icon: "🤔", name: "Thinking" },
    { icon: "😲", name: "Surprised" },
    { icon: "😢", name: "Sad" },
    { icon: "😠", name: "Angry" },
    { icon: "😴", name: "Sleeping" },
    { icon: "🤩", name: "Excited" }
];

/**
 * Continuous 11-station living flowchart presentation.
 *
 * @param {Object} props
 * @param {() => void} [props.onFinish] Exit callback back to the studio.
 * @returns {React.JSX.Element}
 */
export default function PresentationView({ onFinish }) {
    /** Scrolling viewport. */
    const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    /** Per-station anchors for HUD jumps. */
    const sectionRefs = useRef(/** @type {Array<HTMLElement | null>} */ ([]));

    const [activeIndex, setActiveIndex] = useState(0);
    const [progressPct, setProgressPct] = useState(0);
    const [peekOpen, setPeekOpen] = useState(false);
    const [twistPulse, setTwistPulse] = useState(0);
    const [armor, setArmor] = useState({ breaker: false, offline: false, rebuild: false });

    /**
     * Normalizes container scroll into `--scroll-progress` + active station.
     * Writes the CSS custom property directly (no React re-render per frame)
     * and only re-renders when the integer progress or station actually flips.
     * @returns {void}
     */
    const syncScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;

        const scrollable = el.scrollHeight - el.clientHeight;
        const raw = scrollable > 0 ? el.scrollTop / scrollable : 0;
        const progress = Math.max(0, Math.min(1, raw));

        el.style.setProperty("--scroll-progress", progress.toFixed(4));

        const pct = Math.round(progress * 100);
        setProgressPct(prev => (prev === pct ? prev : pct));

        const station = Math.max(
            0,
            Math.min(PRESENTATION_STATIONS.length - 1, Math.floor(progress * PRESENTATION_STATIONS.length))
        );
        setActiveIndex(prev => (prev === station ? prev : station));
    }, []);

    // Re-sync on mount (restored scroll positions) and whenever the layout resizes.
    useEffect(() => {
        syncScroll();
        window.addEventListener("resize", syncScroll);
        return () => window.removeEventListener("resize", syncScroll);
    }, [syncScroll]);

    /**
     * Smoothly jumps the viewport to one station (HUD dots + keyboard).
     * @param {number} index Zero-based station index.
     * @returns {void}
     */
    const scrollToStation = useCallback(
        /** @param {number} index Zero-based station index. */
        (index) => {
            const clamped = Math.max(0, Math.min(PRESENTATION_STATIONS.length - 1, index));
            setActiveIndex(prev => (prev === clamped ? prev : clamped));

            try { Sound.playMessagePop(); } catch { /* audio is optional */ }

            const el = scrollRef.current;
            if (!el) return;

            const node = sectionRefs.current[clamped];
            if (node && typeof node.scrollIntoView === "function") {
                try {
                    node.scrollIntoView({ behavior: "smooth", block: "start" });
                    return;
                } catch {
                    // Environment refused the smooth scroll — fall through.
                }
            }

            // Fallback for environments without scrollIntoView: equal-height sections.
            const scrollable = el.scrollHeight - el.clientHeight;
            if (scrollable > 0) {
                el.scrollTop = (clamped / PRESENTATION_STATIONS.length) * scrollable;
                syncScroll();
            }
        },
        [syncScroll]
    );

    // Keyboard pipeline navigation: arrows / PageUp-Down / Space move one
    // station, Escape exits straight into the live studio.
    useEffect(() => {
        /** @param {KeyboardEvent} e */
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                onFinish?.();
                return;
            }

            const target = /** @type {HTMLElement|null} */ (e.target);
            const onControl = Boolean(target) && ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "");

            if (e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !onControl)) {
                e.preventDefault();
                scrollToStation(activeIndex + 1);
            } else if (e.key === "ArrowUp" || e.key === "PageUp") {
                e.preventDefault();
                scrollToStation(activeIndex - 1);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeIndex, scrollToStation, onFinish]);

    /** @returns {string} Today's formatted date for the Station 02 calendar flipper. */
    const todayFormatted = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    /**
     * Renders the interactive micro-widget for one station.
     * @param {number} id Station id (1-11).
     * @returns {React.JSX.Element}
     */
    const renderWidget = (id) => {
        switch (id) {
            // ── 01 · Zero-leak privacy safe ────────────────────────────────
            case 1:
                return (
                    <div className={styles.safeWidget}>
                        <div className={styles.socketRow}>
                            <div className={styles.socket}>
                                <span className={styles.socketPort}>⚡</span>
                                <strong>GROQ</strong>
                                <em>chat key</em>
                            </div>
                            <div className={styles.socketWire} aria-hidden="true" />
                            <div className={styles.socket}>
                                <span className={styles.socketPort}>✨</span>
                                <strong>GEMINI</strong>
                                <em>planner key</em>
                            </div>
                        </div>
                        <div className={styles.safeBox}>
                            <span className={styles.safeLock}>🔒</span>
                            <span className={styles.safeLabel}>ON-DEVICE SAFE</span>
                            <span className={styles.shieldCheck}>🛡️ ✓</span>
                        </div>
                        <span className={styles.microNote}>0 server hops • 0 leaked bytes</span>
                    </div>
                );

            // ── 02 · Real-world grounding engine ───────────────────────────
            case 2:
                return (
                    <div className={styles.cityWidget}>
                        <div className={styles.skyline} aria-hidden="true">
                            {[42, 74, 58, 92, 66, 80, 50, 70].map((h, i) => (
                                <span key={i} className={styles.skylineTower} style={{ height: `${h}%` }} />
                            ))}
                        </div>
                        <div className={styles.conduitCol}>
                            <div className={styles.conduitChip}>
                                <span className={styles.chipIcon}>🌡️</span>
                                <strong>32°C, Warm</strong>
                                <em className={styles.ambientPulse}>live pulse</em>
                            </div>
                            <div className={styles.conduitChip}>
                                <span className={styles.chipIcon}>🗓️</span>
                                <strong>{nextHolidayLabel()}</strong>
                                <em>{todayFormatted}</em>
                            </div>
                            <div className={styles.newsTicker}>
                                <span className={styles.newsLabel}>📰 GOOGLE NEWS</span>
                                <span className={styles.newsTrack}>
                                    India GDP accelerates • Lucknow Metro phase-4 clears • Gomti Nagar riverfront adds night food trail&nbsp;
                                </span>
                            </div>
                        </div>
                    </div>
                );

            // ── 03 · 24-hour horizon planner ───────────────────────────────
            case 3:
                return (
                    <div className={styles.timelineWidget}>
                        <div className={styles.rail} role="img" aria-label="24-hour timeline rail">
                            {DAY_BLOCKS.map(block => (
                                <div
                                    key={block.label}
                                    className={styles.block}
                                    style={{ left: `${(block.from / 24) * 100}%`, width: `${(block.span / 24) * 100}%` }}
                                >
                                    <span>{block.label}</span>
                                </div>
                            ))}
                            <span className={styles.clockHand} aria-hidden="true" />
                        </div>
                        <div className={styles.hourTicks} aria-hidden="true">
                            <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
                        </div>
                        <div className={styles.goalRow}>
                            <span className={styles.goalBadge}>🎯 Tom: rotor repair</span>
                            <span className={styles.goalBadge}>🎯 Angela: reel shoot</span>
                            <span className={styles.goalBadge}>🎯 Ben: solar viva</span>
                        </div>
                    </div>
                );

            // ── 04 · Director agency & visual diffs ────────────────────────
            case 4:
                return (
                    <div className={styles.directorWidget}>
                        <button
                            type="button"
                            className={styles.slateBtn}
                            onClick={() => setTwistPulse(p => p + 1)}
                        >
                            🎬 Fire Plot Twist
                        </button>
                        <div className={styles.diffStack} key={`twist-${twistPulse}`}>
                            <div className={styles.diffAdd}>
                                <span className={styles.diffTagAdd}>+ PROPOSED</span>
                                <strong>17:00 – 18:30 • Rescue the stray puppy</strong>
                            </div>
                            <div className={styles.diffRemove}>
                                <span className={styles.diffTagSub}>− REMOVED</span>
                                <del>17:00 – 18:30 • Casual garage gaming</del>
                            </div>
                        </div>
                        <span className={styles.restabBadge}>↺ timeline re-stabilized</span>
                    </div>
                );

            // ── 05 · Cognitive distiller & memory vault ────────────────────
            case 5:
                return (
                    <div className={styles.vaultWidget}>
                        <div className={styles.noisyLines} aria-hidden="true">
                            <span>“chai abhi baki hai…”</span>
                            <span>“screw gayab hai drone ka…”</span>
                            <span>“kal viva hai yaar…”</span>
                        </div>
                        <div className={styles.chamber}>
                            <span className={styles.chamberCore}>⚗️</span>
                            <span>DISTILL</span>
                        </div>
                        <div className={styles.situationCard}>
                            <span className={styles.cardTag}>500-CHAR SITUATION</span>
                            <span className={styles.cardBody}>Cast is on the Gomti Nagar rooftop repairing Angela’s drone…</span>
                        </div>
                        <div className={styles.rack}>
                            <span className={styles.memCard}>[Tom] rotor repair</span>
                            <span className={styles.memCard}>[Angela] shoot at 5</span>
                            <span className={styles.memCard}>[Ben] solar viva</span>
                            <span className={styles.rackMeter}>8,432 / 20,000 chars</span>
                        </div>
                    </div>
                );

            // ── 06 · On-device semantic router ─────────────────────────────
            case 6:
                return (
                    <div className={styles.chipWidget}>
                        <div className={styles.chip}>
                            <span className={styles.chipPins} aria-hidden="true" />
                            <strong>Needle 2 • 14MB Wasm</strong>
                            <em>ON-DEVICE ROUTER</em>
                        </div>
                        <div className={styles.queryLine}>
                            <span className={styles.queryPill}>“chai plan kab?”</span>
                            <span className={styles.queryArrow}>→ 🔎 keywords</span>
                        </div>
                        <div className={styles.resultLine}>✓ Tom promised chai at 5 • Gomti Nagar stall</div>
                        <span className={styles.stopwatch}>&lt; 1ms • 0 Cloud Tokens</span>
                    </div>
                );

            // ── 07 · Ultra-lean banter core ────────────────────────────────
            case 7:
                return (
                    <div className={styles.banterWidget}>
                        <div className={styles.bubbleRow}>
                            <div className={styles.bubbleAvatar}><Avatar member={Tom} emotion="Happy" glow={true} /></div>
                            <div className={styles.banterBubble}>
                                <span className={styles.bubbleMeta}>TOM • 180ms</span>
                                <span className={styles.streamText}>Arre 5 baje Gomti Nagar riverfront, cold coffee meri taraf! ☕</span>
                                <button
                                    type="button"
                                    className={styles.peekBtn}
                                    aria-expanded={peekOpen}
                                    onClick={() => setPeekOpen(o => !o)}
                                >
                                    💭 Peek Thought
                                </button>
                                {peekOpen && (
                                    <div className={styles.peekInner}>
                                        “Lighting best rahegi — reel kabhi kabhi ban jayegi.”
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className={styles.emotionMatrix}>
                            {EMOTION_MATRIX.map(emotion => (
                                <span key={emotion.name} className={styles.emotionChip} title={emotion.name}>
                                    <span className={styles.emotionIcon}>{emotion.icon}</span>
                                    {emotion.name}
                                </span>
                            ))}
                        </div>
                    </div>
                );

            // ── 08 · Procedural soundscape ─────────────────────────────────
            case 8:
                return (
                    <div className={styles.soundWidget}>
                        <div className={styles.eqRow}>
                            {[
                                { name: "Ch 1 • Melody", wave: "BPM wave", bars: [46, 82, 60, 96, 70] },
                                { name: "Ch 2 • Brown Noise", wave: "Air wave", bars: [64, 40, 76, 52, 88] },
                                { name: "Ch 3 • Lofi Drone", wave: "Chord pad", bars: [30, 58, 44, 66, 38] }
                            ].map(channel => (
                                <div key={channel.name} className={styles.eqChannel}>
                                    <span className={styles.eqBars}>
                                        {channel.bars.map((h, i) => (
                                            <span key={i} className={styles.eqBar} style={{ height: `${h}%` }} />
                                        ))}
                                    </span>
                                    <strong>{channel.name}</strong>
                                    <em>{channel.wave}</em>
                                </div>
                            ))}
                        </div>
                        <div className={styles.voiceRow}>
                            <span className={styles.voiceChip}>△ Tom • triangle</span>
                            <span className={styles.voiceChip}>∿ Angela • sine</span>
                            <span className={styles.voiceChip}>◺ Ben • sawtooth</span>
                        </div>
                    </div>
                );

            // ── 09 · System armor & resilience ─────────────────────────────
            case 9: {
                /** @type {Array<{key: "breaker"|"offline"|"rebuild", title: string, on: string, off: string, icon: string}>} */
                const switches = [
                    { key: "breaker", title: "Circuit Breaker", on: "OPEN • outage absorbed", off: "CLOSED • healthy", icon: "⚡" },
                    { key: "offline", title: "Offline Armor", on: "CACHED • chats keep running", off: "ONLINE • live sync", icon: "🛡️" },
                    { key: "rebuild", title: "Auto-Rebuild", on: "REBUILT • corrupt row restored", off: "IDLE • db healthy", icon: "🧱" }
                ];

                return (
                    <div className={styles.armorWidget}>
                        {switches.map(item => {
                            const on = armor[item.key];
                            return (
                                <div key={item.key} className={`${styles.armorUnit} ${on ? styles.armorUnitOn : ""}`}>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={on}
                                        aria-label={item.title}
                                        className={`${styles.armorSwitch} ${on ? styles.armorSwitchOn : ""}`}
                                        onClick={() => setArmor(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                                    >
                                        <span className={styles.armorKnob} />
                                    </button>
                                    <strong>{item.icon} {item.title}</strong>
                                    <em>{on ? item.on : item.off}</em>
                                </div>
                            );
                        })}
                    </div>
                );
            }

            // ── 10 · DevTools cockpit ──────────────────────────────────────
            case 10:
                return (
                    <div className={styles.cockpitWidget}>
                        <div className={styles.ringRow}>
                            {[
                                { icon: "🔴", name: "Errors", value: 0, ring: "err" },
                                { icon: "🟡", name: "Warns", value: 2, ring: "warn" },
                                { icon: "🟢", name: "Infos", value: 18, ring: "info" },
                                { icon: "🔵", name: "Debugs", value: 41, ring: "debug" }
                            ].map(buffer => (
                                <div key={buffer.name} className={`${styles.ringCard} ${styles[`ring_${buffer.ring}`]}`}>
                                    <span className={styles.ringValue}>{buffer.value}</span>
                                    <span className={styles.ringName}>{buffer.icon} {buffer.name}</span>
                                    <span className={styles.ringNote}>non-evicting</span>
                                </div>
                            ))}
                        </div>
                        <div className={styles.flashRow}>
                            <span className={styles.flashCard}>TOM <b>Excited</b></span>
                            <span className={styles.flashCard}>ANGELA <b>Happy</b></span>
                            <span className={styles.flashCard}>BEN <b>Thinking</b></span>
                        </div>
                        <div className={styles.promptInspector}>
                            <span className={styles.tokenBadge}>PROMPT IN ⇅ 412</span>
                            <span className={styles.tokenBadge}>OUT ⇅ 68</span>
                            <span className={styles.ttftBadge}>TTFT 180ms</span>
                        </div>
                    </div>
                );

            // ── 11 · The assembled studio launchpad ────────────────────────
            case 11:
            default:
                return (
                    <div className={styles.studioWidget}>
                        <div className={styles.streamFan} aria-hidden="true">
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
                                <span key={i} className={styles.streamLine} style={{ transform: `rotate(${-54 + i * 12}deg)` }} />
                            ))}
                            <span className={styles.fanCore}>🎬</span>
                        </div>

                        <div className={styles.miniStage}>
                            <div className={styles.miniHeader}>
                                <span className={styles.miniDot} />
                                <strong>Tom &amp; Friends</strong>
                                <em>6 in room • Lucknow Studio</em>
                            </div>
                            <div className={styles.miniBubbles}>
                                <span className={styles.miniBubble}>Chalo phir 5 baje milte hain!</span>
                                <span className={styles.miniBubbleAlt}>Bilkul, riverfront pe ☕</span>
                            </div>
                            <div className={styles.typingClouds}>
                                <span className={styles.typingCloud}>Angela is typing…</span>
                                <span className={styles.typingCloudB}>Ben is typing…</span>
                            </div>
                            <div className={styles.miniCast}>
                                {[Tom, Angela, Ben, Ginger, Hank, Becca].map(member => (
                                    <span key={member.id} className={styles.miniCastItem}>
                                        <Avatar member={member} emotion="Default" glow={false} />
                                    </span>
                                ))}
                            </div>
                        </div>

                        <button type="button" className={styles.ctaBtn} onClick={onFinish}>
                            Enter Live Studio 🚀
                        </button>
                    </div>
                );
        }
    };

    return (
        <div
            className={styles.scrollViewport}
            data-testid="presentation-scroll"
            data-active-station={activeIndex}
            ref={scrollRef}
            onScroll={syncScroll}
        >
            {/* ── Floating glass HUD ─────────────────────────────────────── */}
            <header className={styles.hudBar}>
                <div className={styles.brandCluster}>
                    <span className={styles.liveDot} aria-hidden="true" />
                    <span className={styles.brandTitle}>TOM &amp; FRIENDS • LIVING SITCOM</span>
                </div>

                <div className={styles.hudProgress}>
                    <div className={styles.progressTrack}>
                        <div className={styles.progressFill} />
                    </div>
                    <span className={styles.progressLabel}>{progressPct}%</span>
                </div>

                <nav className={styles.dotRow} aria-label="Station navigation">
                    {PRESENTATION_STATIONS.map((station, index) => (
                        <button
                            key={station.id}
                            type="button"
                            className={`${styles.jumpDot} ${activeIndex === index ? styles.jumpDotActive : ""}`}
                            aria-label={`Station ${station.id}: ${station.label}`}
                            aria-current={activeIndex === index ? "step" : undefined}
                            onClick={() => scrollToStation(index)}
                        >
                            {station.code}
                        </button>
                    ))}
                </nav>

                <button type="button" className={styles.skipBtn} onClick={onFinish}>
                    Enter Live Studio ⏩
                </button>
            </header>

            {/* ── Continuous pipeline journey ────────────────────────────── */}
            <main className={styles.journey}>
                <div className={styles.pipelineRail} aria-hidden="true">
                    <div className={styles.pipelineFill} />
                    <span className={styles.pipelineSpark} />
                </div>

                {PRESENTATION_STATIONS.map((station, index) => (
                    <section
                        key={station.id}
                        id={`station-${station.id}`}
                        data-testid={`station-${station.id}`}
                        data-active={activeIndex === index ? "true" : "false"}
                        data-past={activeIndex > index ? "true" : "false"}
                        ref={el => { sectionRefs.current[index] = el; }}
                        className={`${styles.station} ${activeIndex === index ? styles.stationActive : ""}`}
                    >
                        <div className={styles.stationNode} aria-hidden="true">
                            <span>{station.code}</span>
                        </div>

                        <div className={styles.stationCopy}>
                            <span className={styles.stationCode}>STATION {station.code} / 11</span>
                            <h2 className={styles.headline}>{station.headline}</h2>
                            <span className={styles.subTag}>{station.subTag}</span>
                            <div className={styles.fileRow}>
                                {station.files.map(file => (
                                    <code key={file} className={styles.fileChip}>{file}</code>
                                ))}
                            </div>
                        </div>

                        <div className={styles.widgetCard}>
                            {renderWidget(station.id)}
                        </div>
                    </section>
                ))}
            </main>
        </div>
    );
}
