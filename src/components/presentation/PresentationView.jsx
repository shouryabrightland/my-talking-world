// src/components/presentation/PresentationView.jsx
// @ts-check

/**
 * @file PresentationView — single-unit phone scrollytelling pitch.
 *
 * ONE phone stays whole on a sticky stage while the scroll track flies past.
 * Scroll progress drives a continuous custom property (`--t`), and each step
 * swaps what plays INSIDE the phone screen: the intro shows the cast home
 * screen, nine layer steps swap in self-explanatory mini-widgets (chat,
 * weather, diffs, memory, chip, keys, EQ, armor, gauges), and the finale
 * returns to the home screen with the studio CTA. The phone frame never
 * breaks apart — the changes happen on its screen.
 *
 * Responsive by design: the caption sits beside the phone on desktop and
 * overlays the bottom of the stage on phones, where the HUD wraps into two
 * compact rows. Wheel / touch / keyboard / HUD dots all move the same
 * pipeline. No frameworks beyond React + CSS custom properties.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "./PresentationView.module.css";
import Avatar from "../Avatar";
import { Members } from "../../util/member";
import { Sound } from "../../util/sound";

/**
 * @typedef {Object} PresentationLayer
 * @property {number} id 1-based step id.
 * @property {string} code Zero-padded step code ("01").
 * @property {string} label Short label used by the HUD jump dots.
 * @property {"intro"|"layer"|"finale"} role Where this step sits in the arc.
 * @property {number} [layer] Zero-based screen index for `layer` steps (0 = display, top).
 * @property {string} headline Giant kinetic headline.
 * @property {string} subTag Single-line capability tag.
 * @property {string} blurb One-sentence plain-language explanation.
 * @property {string[]} files Source modules this step visualizes.
 */

/** @type {PresentationLayer[]} */
export const PRESENTATION_LAYERS = [
    {
        id: 1, code: "01", label: "Studio", role: "intro",
        headline: "A LIVING SITCOM IN YOUR POCKET",
        subTag: "Six AI friends • One human • Zero scripts",
        blurb: "This is the whole app: an always-on sitcom where six AI friends hang out, argue and joke in Lucknow Hinglish — and you can jump into the scene any time.",
        files: ["Chat.jsx"]
    },
    {
        id: 2, code: "02", label: "Display", role: "layer", layer: 0,
        headline: "THE CHAT IS ALIVE",
        subTag: "Sub-second Hinglish banter • Thought peeks",
        blurb: "The screen layer: replies stream in under a second with typing rhythm, reactions — and a peek at what a character REALLY thinks before they say it.",
        files: ["Chat.jsx", "GroqClient.js", "Reaction.js"]
    },
    {
        id: 3, code: "03", label: "Reality", role: "layer", layer: 1,
        headline: "GROUNDED IN TODAY",
        subTag: "Live weather • Festivals • News • 24h arc",
        blurb: "A slice of live reality: today's real Lucknow weather, Indian festivals and Google News headlines flow into every conversation — under a 24-hour schedule the cast actually follows.",
        files: ["environment.js", "SceneBar.jsx", "World.js"]
    },
    {
        id: 4, code: "04", label: "Director", role: "layer", layer: 2,
        headline: "YOU ARE THE DIRECTOR",
        subTag: "Instant plot twists • Visual diffs",
        blurb: "Tap once to inject a plot twist: the planner instantly reshapes everyone's goals and shows exactly what changed — what was added and what was dropped.",
        files: ["directorPresets.js", "PlannerDrawer.jsx"]
    },
    {
        id: 5, code: "05", label: "Memory", role: "layer", layer: 3,
        headline: "THEY REMEMBER EVERYTHING",
        subTag: "20,000-char episodic vault",
        blurb: "Every fact, promise and grudge is distilled into a memory vault with expiring and permanent entries — so callbacks land episodes later.",
        files: ["UnifiedMemory.js", "SituationEngine.js"]
    },
    {
        id: 6, code: "06", label: "Chip", role: "layer", layer: 4,
        headline: "A 14MB AI CHIP ON YOUR DEVICE",
        subTag: "Needle router • <1ms • Works offline",
        blurb: "Needle — a 14MB on-device model — routes every message in under a millisecond, deciding who speaks next and which tools to use, even with no network.",
        files: ["NeedleRouter.js", "Needle 2 by Cactus"]
    },
    {
        id: 7, code: "07", label: "Engines", role: "layer", layer: 5,
        headline: "DUAL AI • ZERO SERVERS",
        subTag: "Groq + Gemini keys stay on-device",
        blurb: "Your two API keys call the cloud directly from the browser: no backend, no accounts, no logs. The safe never leaves the phone.",
        files: ["apiKeys.js", "GeminiClient.js"]
    },
    {
        id: 8, code: "08", label: "Sound", role: "layer", layer: 6,
        headline: "A SOUNDTRACK WITH NO MP3s",
        subTag: "Web Audio API • Zero audio files",
        blurb: "Every ring, pop and mood cue is synthesized live by the browser — zero audio files to download.",
        files: ["sound.js"]
    },
    {
        id: 9, code: "09", label: "Armor", role: "layer", layer: 7,
        headline: "UNBREAKABLE ARMOR",
        subTag: "Circuit breaker • Rate limiter • PWA cache",
        blurb: "A circuit breaker, rate limiter and offline cache absorb outages: a server hiccup is felt as a two-second pause, never a crash.",
        files: ["CircuitBreaker.js", "RateLimiter.js", "sw.js"]
    },
    {
        id: 10, code: "10", label: "Cockpit", role: "layer", layer: 8,
        headline: "THE LIVE COCKPIT",
        subTag: "Client-side observability suite",
        blurb: "Flip open the cockpit: every prompt, model, cooldown and memory entry can be inspected live, right inside the app.",
        files: ["DevToolsBar.jsx", "DevToolsDrawer.jsx"]
    },
    {
        id: 11, code: "11", label: "Wheel", role: "finale",
        headline: "TAKE THE WHEEL",
        subTag: "The studio is live",
        blurb: "Enough visuals — the sitcom is running right now. Enter the studio and direct your own episode.",
        files: ["Chat.jsx"]
    }
];

const LAYER_COUNT = PRESENTATION_LAYERS.length;

/** Zero-based in-phone layer screens (index matches `layer` in PRESENTATION_LAYERS). */
const SLAB_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Icon + header label shown at the top of each in-phone layer screen. */
const SCREEN_META = [
    { icon: "🖥️", name: "DISPLAY" },
    { icon: "🌦️", name: "SCENE HORIZON" },
    { icon: "🎬", name: "DIRECTOR DESK" },
    { icon: "🧠", name: "MEMORY VAULT" },
    { icon: "⚙️", name: "NEEDLE CHIP" },
    { icon: "🔐", name: "TWIN ENGINES" },
    { icon: "🎚️", name: "SOUND ENGINE" },
    { icon: "🛡️", name: "ARMOR PLATE" },
    { icon: "📈", name: "COCKPIT" }
];

/**
 * Continuous 11-step single-phone scrollytelling presentation.
 *
 * @param {Object} props
 * @param {() => void} [props.onFinish] Exit callback back to the studio.
 * @returns {React.JSX.Element}
 */
export default function PresentationView({ onFinish }) {
    /** Scrolling viewport. */
    const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const [activeIndex, setActiveIndex] = useState(0);
    const [progressPct, setProgressPct] = useState(0);

    /**
     * Normalizes container scroll into `--scroll-progress` + continuous `--t`
     * (the parallax clock) + active step. CSS custom properties are written
     * directly so the phone glows per frame WITHOUT a React re-render;
     * React only re-renders when the integer step or percent flips.
     * @returns {void}
     */
    const syncScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;

        const scrollable = el.scrollHeight - el.clientHeight;
        const raw = scrollable > 0 ? el.scrollTop / scrollable : 0;
        const progress = Math.max(0, Math.min(1, raw));

        el.style.setProperty("--scroll-progress", progress.toFixed(4));
        // Continuous step clock: 0 → LAYER_COUNT. Drives phone glow/parallax.
        el.style.setProperty("--t", (progress * LAYER_COUNT).toFixed(4));

        const pct = Math.round(progress * 100);
        setProgressPct(prev => (prev === pct ? prev : pct));

        const step = Math.max(
            0,
            Math.min(LAYER_COUNT - 1, Math.floor(progress * LAYER_COUNT))
        );
        setActiveIndex(prev => (prev === step ? prev : step));
    }, []);

    // Re-sync on mount (restored scroll positions) and whenever the layout resizes.
    useEffect(() => {
        syncScroll();
        window.addEventListener("resize", syncScroll);
        return () => window.removeEventListener("resize", syncScroll);
    }, [syncScroll]);

    /** Currently glowing screen (undefined during intro/finale → home screen). */
    const activeLayer = typeof PRESENTATION_LAYERS[activeIndex]?.layer === "number"
        ? PRESENTATION_LAYERS[activeIndex].layer
        : undefined;

    /** Intro and finale both show the cast home screen inside the phone. */
    const homeActive = activeLayer === undefined;

    /**
     * Jumps the viewport to one step (HUD dots + keyboard). Uses the
     * proportional track math rather than scrollIntoView so the sticky-stage
     * layout lands exactly on t = index (scrollIntoView would overshoot by
     * the stage's 100vh and show the NEXT step's caption).
     * @param {number} index Zero-based step index.
     * @returns {void}
     */
    const scrollToStation = useCallback(
        /** @param {number} index Zero-based step index. */
        (index) => {
            const clamped = Math.max(0, Math.min(LAYER_COUNT - 1, index));
            setActiveIndex(prev => (prev === clamped ? prev : clamped));

            try { Sound.playMessagePop(); } catch { /* audio is optional */ }

            const el = scrollRef.current;
            if (!el) return;

            // Land in the CENTER of the step's scroll band (t = i + 0.5),
            // not on its edge: integer rounding of scrollTop on the exact
            // boundary could otherwise floor back to the previous step.
            const scrollable = el.scrollHeight - el.clientHeight;
            if (scrollable > 0) {
                el.scrollTop = ((clamped + 0.5) / LAYER_COUNT) * scrollable;
                syncScroll();
            }
        },
        [syncScroll]
    );

    // Keyboard pipeline navigation: arrows / PageUp-Down / Space move one
    // step, Escape exits straight into the live studio.
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

    const active = PRESENTATION_LAYERS[activeIndex];

    /**
     * The glowing layer content — every screen carries its own
     * self-explanatory visual so the phone alone tells the story.
     * @param {number} layer Zero-based screen index (0 = display … 8 = cockpit).
     * @returns {React.JSX.Element|null}
     */
    const renderSlabContent = (layer) => {
        switch (layer) {
            case 0: // Display — live chat
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.chatRow}>
                            <span className={styles.chatAvatar}><Avatar member={Members[0]} emotion="Happy" glow={true} /></span>
                            <span className={styles.chatBubble}>Arre yaar, rotor gayab hai drone ka! 🛠️</span>
                        </div>
                        <div className={`${styles.chatRow} ${styles.chatRowRight}`}>
                            <span className={`${styles.chatBubble} ${styles.chatBubbleAlt}`}>Ek min, shoot ke baad duct tape lagati hoon 😌</span>
                            <span className={styles.chatAvatar}><Avatar member={Members[1]} emotion="Thinking" glow={true} /></span>
                        </div>
                        <div className={styles.typingRow} aria-hidden="true">
                            <span className={styles.typingDot} /><span className={styles.typingDot} /><span className={styles.typingDot} />
                            <em>Ben is typing…</em>
                        </div>
                    </div>
                );
            case 1: // Reality — live grounding + 24h arc
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.chipRow}>
                            <span className={styles.dataChip}>🌡️ 32°C, Warm</span>
                            <span className={styles.dataChip}>🗓️ Gandhi Jayanti in 3d</span>
                        </div>
                        <div className={styles.ticker} aria-hidden="true">
                            <span className={styles.tickerTrack}>
                                India GDP accelerates • Lucknow Metro phase-4 clears • Gomti Nagar riverfront adds night food trail&nbsp;
                            </span>
                        </div>
                        <div className={styles.dayBar} role="img" aria-label="24-hour schedule bar">
                            <span className={styles.daySeg} style={{ left: "29%", width: "12%" }}>Chai</span>
                            <span className={styles.daySeg} style={{ left: "42%", width: "12%" }}>Create</span>
                            <span className={styles.daySeg} style={{ left: "71%", width: "8%" }}>Walk</span>
                            <span className={styles.daySeg} style={{ left: "87%", width: "12%" }}>Terrace</span>
                        </div>
                    </div>
                );
            case 2: // Director — visual diffs
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.diffRowAdd}>
                            <span className={styles.diffTag}>+ ADDED</span>
                            <strong>17:00 • Rescue the stray puppy</strong>
                        </div>
                        <div className={styles.diffRowSub}>
                            <span className={styles.diffTag}>− DROPPED</span>
                            <del>17:00 • Casual garage gaming</del>
                        </div>
                        <span className={styles.restabBadge}>🎬 timeline re-stabilized in 0.8s</span>
                    </div>
                );
            case 3: // Memory — vault gauge
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.memChips}>
                            <span className={styles.memChip}>[Tom] rotor repair</span>
                            <span className={styles.memChip}>[Angela] shoot at 5</span>
                            <span className={styles.memChip}>[Ben] solar viva • 24h</span>
                        </div>
                        <div className={styles.gauge} role="img" aria-label="Memory gauge 8,432 of 20,000 characters">
                            <div className={styles.gaugeFill} style={{ width: "42%" }} />
                        </div>
                        <em className={styles.gaugeLabel}>8,432 / 20,000 chars</em>
                    </div>
                );
            case 4: // Chip — Needle on-device router
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.chipGraphic} aria-hidden="true">
                            <span className={styles.chipCore}>🧠</span>
                            <span className={styles.chipPulse} />
                        </div>
                        <div className={styles.chipMeta}>
                            <strong>NEEDLE • 14MB</strong>
                            <em>&lt;1ms routing • works offline</em>
                        </div>
                    </div>
                );
            case 5: // Engines — dual keys, no servers
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.keyRow}>
                            <span className={styles.keyChip}>⚡ GROQ<em>chat</em></span>
                            <span className={styles.keyWire} aria-hidden="true" />
                            <span className={styles.keyChip}>✨ GEMINI<em>planner</em></span>
                        </div>
                        <span className={styles.safeBadge}>🔒 0 servers • 0 accounts • keys never leave this phone</span>
                    </div>
                );
            case 6: // Sound — procedural EQ
                return (
                    <div className={`${styles.slabBody} ${styles.eqRow}`} aria-hidden="true">
                        {Array.from({ length: 12 }, (_, i) => (
                            <span
                                key={i}
                                className={styles.eqBar}
                                style={{ animationDelay: `${(i % 5) * 0.13}s`, height: `${30 + ((i * 37) % 60)}%` }}
                            />
                        ))}
                        <em className={styles.eqLabel}>Web Audio API • 0 MP3 files</em>
                    </div>
                );
            case 7: // Armor — self-healing guards
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.armorRow}>
                            <span className={styles.armorShield} aria-hidden="true">🛡️</span>
                            <div className={styles.armorPills}>
                                <span className={styles.armorPill}>Breaker: CLOSED ✓</span>
                                <span className={styles.armorPill}>Rate limit: synced</span>
                                <span className={styles.armorPill}>Offline cache: warm ✓</span>
                            </div>
                        </div>
                    </div>
                );
            case 8: // Cockpit — observability gauges
                return (
                    <div className={styles.slabBody}>
                        <div className={styles.gaugeRow}><span>Model</span><div className={styles.miniBar} style={{ width: "70%" }} /></div>
                        <div className={styles.gaugeRow}><span>Cooldowns</span><div className={styles.miniBar} style={{ width: "12%" }} /></div>
                        <div className={styles.gaugeRow}><span>Memory</span><div className={styles.miniBar} style={{ width: "42%" }} /></div>
                        <em className={styles.cockpitLabel}>prompts • models • TTLs — inspectable live</em>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div
            className={styles.scrollViewport}
            data-testid="presentation-scroll"
            data-active-step={activeIndex}
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

                <nav className={styles.dotRow} aria-label="Step navigation">
                    {PRESENTATION_LAYERS.map((layer, index) => (
                        <button
                            key={layer.id}
                            type="button"
                            className={`${styles.jumpDot} ${activeIndex === index ? styles.jumpDotActive : ""}`}
                            aria-label={`Step ${layer.id}: ${layer.label}`}
                            aria-current={activeIndex === index ? "step" : undefined}
                            onClick={() => scrollToStation(index)}
                        >
                            {layer.code}
                        </button>
                    ))}
                </nav>

                <button type="button" className={styles.skipBtn} onClick={onFinish}>
                    Enter Live Studio ⏩
                </button>
            </header>

            {/* ── Sticky stage: ONE phone, content changes on its screen ─── */}
            <div className={styles.stage} aria-hidden={false}>
                <span className={styles.ghostCode} aria-hidden="true">{active.code}</span>

                <div className={styles.phoneWrap} data-testid="phone">
                    <div className={styles.phoneBody}>
                        <span className={styles.phoneIsland} aria-hidden="true" />

                        <div className={styles.phoneScreen}>
                            {/* Cast home screen — intro & finale */}
                            <div
                                className={`${styles.screen} ${styles.screenHome}`}
                                data-testid="screen-home"
                                data-active={homeActive ? "true" : "false"}
                            >
                                <span className={styles.homeKicker}>
                                    {active.role === "finale" ? "EPISODE 1 • LIVE NOW" : "WELCOME TO"}
                                </span>
                                <strong className={styles.homeTitle}>TOM &amp; FRIENDS</strong>
                                <div className={styles.homeCast}>
                                    {Members.map(member => (
                                        <span key={member.id} className={styles.homeAvatar}>
                                            <span className={styles.homeFace}>
                                                <Avatar member={member} emotion="Happy" glow={true} />
                                            </span>
                                            <em>{member.name}</em>
                                        </span>
                                    ))}
                                </div>
                                <span className={styles.homeTag}>A LIVING SITCOM • ALWAYS ON</span>
                            </div>

                            {/* Nine layer screens — swapped by scroll step */}
                            {SLAB_INDICES.map(k => {
                                const isActive = activeLayer === k;
                                const meta = SCREEN_META[k];
                                return (
                                    <div
                                        key={k}
                                        className={styles.screen}
                                        data-testid={`screen-${k}`}
                                        data-active={isActive ? "true" : "false"}
                                    >
                                        <div className={styles.screenHead}>
                                            <span className={styles.slabIcon} aria-hidden="true">{meta.icon}</span>
                                            <span className={styles.slabName}>{meta.name}</span>
                                            <span className={styles.screenRail} aria-hidden="true" />
                                        </div>
                                        {renderSlabContent(k)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className={styles.phoneShadow} aria-hidden="true" />
                </div>

                {/* ── Caption card for the active step ───────────────────── */}
                <aside
                    className={styles.caption}
                    key={active.id}
                    data-testid={`caption-${active.id}`}
                >
                    <span className={styles.captionCode}>STEP {active.code} / 11</span>
                    <h2 className={styles.headline}>{active.headline}</h2>
                    <span className={styles.subTag}>{active.subTag}</span>
                    <p className={styles.blurb}>{active.blurb}</p>
                    <div className={styles.fileRow}>
                        {active.files.map(file => (
                            <code key={file} className={styles.fileChip}>{file}</code>
                        ))}
                    </div>

                    {active.role === "finale" && (
                        <button
                            type="button"
                            className={styles.finaleCta}
                            onClick={onFinish}
                        >
                            Enter Live Studio 🚀
                        </button>
                    )}
                </aside>
            </div>

            {/* ── Scroll track: 11 equal steps driving --t ───────────────── */}
            <main className={styles.track}>
                {PRESENTATION_LAYERS.map((layer, index) => (
                    <section
                        key={layer.id}
                        id={`step-${layer.id}`}
                        data-testid={`step-${layer.id}`}
                        data-active={activeIndex === index ? "true" : "false"}
                        data-past={activeIndex > index ? "true" : "false"}
                        className={styles.step}
                        aria-label={layer.headline}
                    />
                ))}
            </main>
        </div>
    );
}
