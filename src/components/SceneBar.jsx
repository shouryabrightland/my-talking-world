// @ts-check

import React, { useCallback, useEffect, useState } from "react";
import styles from "./SceneBar.module.css";
import { useChat } from "../contexts/ChatContext";
import { WorldEvents } from "../classes/World";
import { AmbientAudio } from "../util/sound";

/**
 * @typedef {import("../classes/types/World.types").ScheduleRecord} ScheduleRecord
 * @typedef {import("../classes/types/World.types").EnvironmentSnapshot} EnvironmentSnapshot
 */

/**
 * Responsive Atmospheric Scene Ribbon with Marquee Ticker.
 * Displays live Lucknow Weather, Google News headlines, and the active Schedule Goal.
 *
 * @returns {React.JSX.Element}
 */
export default function SceneBar() {
    const conv = useChat();
    const { world } = conv;

    /** @type {[ScheduleRecord|null, React.Dispatch<React.SetStateAction<ScheduleRecord|null>>]} */
    const [schedule, setSchedule] = useState(() => world?.activeSchedule || null);

    /** @type {[EnvironmentSnapshot|null, React.Dispatch<React.SetStateAction<EnvironmentSnapshot|null>>]} */
    const [environment, setEnvironment] = useState(() => world?.environment || null);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isAmbientPlaying, setIsAmbientPlaying] = useState(() => AmbientAudio.isPlaying);

    /** @type {[boolean, React.Dispatch<React.SetStateAction<boolean>>]} */
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        if (!world) return;

        const updateState = () => {
            setSchedule(world.activeSchedule);
            setEnvironment(world.environment);
        };

        const offSchedule = world.events.on(
            WorldEvents.SCHEDULE_CHANGE,
            updateState,
            "SceneBar: schedule change"
        );
        const offReady = world.events.on(
            WorldEvents.READY,
            updateState,
            "SceneBar: world ready"
        );
        const offHour = world.events.on(
            WorldEvents.HOUR_CHANGE,
            updateState,
            "SceneBar: hour change"
        );

        updateState();

        return () => {
            offSchedule();
            offReady();
            offHour();
        };
    }, [world]);

    const handleToggleAudio = useCallback((/** @type {React.MouseEvent} */ event) => {
        event.stopPropagation();
        const playing = AmbientAudio.toggle(null);
        setIsAmbientPlaying(playing);
    }, []);

    const weatherText = environment ? `🌤️ ${environment.temperature}, ${environment.weather}` : "🌤️ 32°C, Warm";
    const topicText = schedule ? `🎯 ${schedule.topic}` : "🎯 Casual Banter";
    const goalText = schedule?.mainGoal ? `⚡ Goal: ${schedule.mainGoal}` : "";
    const newsText = environment?.newsHeadlines?.[0] ? `📰 ${environment.newsHeadlines[0]}` : "";

    const tickerText = `📍 Lucknow • ${weatherText} • ${topicText} ${goalText ? `• ${goalText}` : ""} ${newsText ? `• ${newsText}` : ""}`;

    return (
        <>
            {/* Top Scene Ribbon with Marquee Ticker */}
            <div
                className={styles.ribbon}
                onClick={() => setIsModalOpen(true)}
                role="button"
                tabIndex={0}
                aria-label="View Active Scene Details"
            >
                <div className={styles.marqueeTrack}>
                    <div className={styles.marqueeContent}>
                        <span className={styles.tickerSegment}>{tickerText}</span>
                        <span className={styles.tickerSpacer}>••••</span>
                        <span className={styles.tickerSegment}>{tickerText}</span>
                        <span className={styles.tickerSpacer}>••••</span>
                    </div>
                </div>

                {/* Compact Ambient Audio Button */}
                <button
                    onClick={handleToggleAudio}
                    className={isAmbientPlaying ? styles.audioButtonActive : styles.audioButton}
                    title={isAmbientPlaying ? "Pause Room Ambient Audio" : "Play Room Ambient Audio"}
                    aria-label="Toggle ambient room sound"
                >
                    {isAmbientPlaying ? (
                        <>
                            <span className={styles.equalizerWave}>
                                <span className={styles.waveBar} />
                                <span className={styles.waveBar} />
                                <span className={styles.waveBar} />
                            </span>
                            <span>ON</span>
                        </>
                    ) : (
                        <span>🔇 OFF</span>
                    )}
                </button>
            </div>

            {/* Atmosphere & Schedule Details Modal */}
            <div
                className={`${styles.modalOverlay} ${isModalOpen ? styles.modalOverlayVisible : ""}`}
                onClick={() => setIsModalOpen(false)}
            >
                <div
                    className={`${styles.modalCard} ${isModalOpen ? styles.modalCardVisible : ""}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={styles.modalHeader}>
                        <div>
                            <span className={styles.modalBadge}>
                                {schedule?.timeRange || "ACTIVE HORIZON"} • LIVE ENVIRONMENT
                            </span>
                            <h3 className={styles.modalTitle}>{schedule?.topic || "Group Hangout"}</h3>
                        </div>
                        <button onClick={() => setIsModalOpen(false)} className={styles.closeButton}>
                            ✕
                        </button>
                    </div>

                    <div className={styles.modalBody}>
                        {/* Real-World Environment */}
                        <div className={styles.section}>
                            <h5 className={styles.sectionHeading}>📍 Real-World Weather & Setting</h5>
                            <p className={styles.sectionText}><strong>Location:</strong> Lucknow, Uttar Pradesh</p>
                            <p className={styles.sectionText}><strong>Weather:</strong> {environment?.weather || "Warm"} ({environment?.temperature || "32°C"}, Humidity: {environment?.humidity || "55%"})</p>
                            <p className={styles.sectionText}><strong>Occasion:</strong> {environment?.todayCelebration || "Regular day"}</p>
                        </div>

                        {/* Active Schedule Main Goal */}
                        <div className={styles.sectionHighlight}>
                            <h5 className={styles.sectionHeadingHighlight}>🎯 Main Session Objective</h5>
                            <p className={styles.situationText}>{schedule?.mainGoal || "Hang out and chat naturally."}</p>
                        </div>

                        {/* Character Goals if present */}
                        {schedule?.characterGoals && schedule.characterGoals.length > 0 && (
                            <div className={styles.section}>
                                <h5 className={styles.sectionHeading}>👥 Character Motivations</h5>
                                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                    {schedule.characterGoals.map(cg => (
                                        <p key={cg.id} className={styles.sectionText}>
                                            • <strong>{cg.name}:</strong> {cg.goal}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Schedule Facts */}
                        {schedule?.facts && schedule.facts.length > 0 && (
                            <div className={styles.section}>
                                <h5 className={styles.sectionHeading}>📌 Context Facts</h5>
                                <div className={styles.propsRow}>
                                    {schedule.facts.map((fact, idx) => (
                                        <span key={idx} className={styles.propChip}>
                                            📌 {fact}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Ongoing Google News */}
                        {environment?.newsHeadlines && environment.newsHeadlines.length > 0 && (
                            <div className={styles.section}>
                                <h5 className={styles.sectionHeading}>📰 Live Google News Headlines</h5>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {environment.newsHeadlines.slice(0, 3).map((headline, idx) => (
                                        <span key={idx} className={styles.sectionText}>
                                            • {headline}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}