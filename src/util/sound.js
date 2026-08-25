// @ts-check

/**
 * @file sound.js
 * Audio system for ambient room sounds and message SFX.
 *
 * Responsibilities:
 * - Ambient audio mixer with melody, noise, and drone channels.
 * - BPM-synced audio generation using Web Audio API.
 * - Sound effects for message pops and character voices.
 * - Volume and mix controls with preset support (sitcom, coffee, sleep).
 */

/**
 * @typedef {import("../classes/types/World.types").ScheduleRecord} ScheduleRecord
 */

const STORAGE_SFX_KEY = "tgf:audio:sfx_enabled";
const STORAGE_AMBIENT_KEY = "tgf:audio:ambient_enabled";
const STORAGE_AMBIENT_MIX_KEY = "tgf:audio:ambient_mix";

/** @type {AudioContext|null} */
let audioCtx = null;

/**
 * Safely initializes and unlocks the browser Web Audio Context on user gesture.
 * @returns {AudioContext|null}
 */
function getAudioContext() {
    if (typeof window === "undefined") return null;

    if (!audioCtx) {
        try {
            const w = /** @type {Window & {AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext}} */ (/** @type {unknown} */ (window));
            const AudioContextClass = w.AudioContext || w.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        } catch (/** @type {unknown} */ err) {
            console.warn("[Sound] AudioContext init failed:", err);
        }
    }

    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
    }

    return audioCtx;
}

/**
 * Sound Manager tracking global SFX and synthesizing procedural character voice blips.
 */
class SoundEngine {
    constructor() {
        /** @type {boolean} */
        this.sfxEnabled = true;

        try {
            const saved = localStorage.getItem(STORAGE_SFX_KEY);
            if (saved !== null) {
                this.sfxEnabled = saved === "true";
            }
        } catch {}
    }

    /**
     * @returns {boolean}
     */
    toggleSFX() {
        this.sfxEnabled = !this.sfxEnabled;
        try {
            localStorage.setItem(STORAGE_SFX_KEY, String(this.sfxEnabled));
        } catch {}
        return this.sfxEnabled;
    }

    playMessagePop() {
        if (!this.sfxEnabled) return;
        const ctx = getAudioContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = "sine";
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);

            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.07);
        } catch {}
    }

    /**
     * @param {string} [memberId="tom"]
     */
    playCharacterVoice(memberId = "tom") {
        if (!this.sfxEnabled) return;
        const ctx = getAudioContext();
        if (!ctx) return;

        const id = String(memberId || "").toLowerCase();
        const now = ctx.currentTime;

        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            switch (id) {
                case "tom":
                    osc.type = "triangle";
                    osc.frequency.setValueAtTime(440, now);
                    osc.frequency.setValueAtTime(587.33, now + 0.05);
                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
                    osc.start(now);
                    osc.stop(now + 0.11);
                    break;

                case "angela":
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(783.99, now);
                    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.08);
                    gain.gain.setValueAtTime(0.11, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
                    osc.start(now);
                    osc.stop(now + 0.13);
                    break;

                case "ben":
                    osc.type = "sawtooth";
                    osc.frequency.setValueAtTime(329.63, now);
                    osc.frequency.setValueAtTime(659.25, now + 0.04);
                    gain.gain.setValueAtTime(0.08, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
                    osc.start(now);
                    osc.stop(now + 0.09);
                    break;

                case "ginger":
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(1046.50, now);
                    osc.frequency.exponentialRampToValueAtTime(1567.98, now + 0.05);
                    gain.gain.setValueAtTime(0.11, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                    osc.start(now);
                    osc.stop(now + 0.08);
                    break;

                case "hank":
                    osc.type = "triangle";
                    osc.frequency.setValueAtTime(196.00, now);
                    osc.frequency.exponentialRampToValueAtTime(146.83, now + 0.12);
                    gain.gain.setValueAtTime(0.14, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
                    osc.start(now);
                    osc.stop(now + 0.14);
                    break;

                case "becca":
                    osc.type = "square";
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.exponentialRampToValueAtTime(392.00, now + 0.06);
                    gain.gain.setValueAtTime(0.07, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                    osc.start(now);
                    osc.stop(now + 0.08);
                    break;

                default:
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.07);
                    gain.gain.setValueAtTime(0.09, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
                    osc.start(now);
                    osc.stop(now + 0.09);
                    break;
            }

            osc.connect(gain);
            gain.connect(ctx.destination);
        } catch {}
    }
}

/**
 * @typedef {Object} AmbientMixSettings
 * @property {number} masterVolume Overall gain (0.0 to 1.0)
 * @property {number} melodyVolume Melody channel gain (0.0 to 1.0)
 * @property {number} noiseVolume Brown noise channel gain (0.0 to 1.0)
 * @property {number} droneVolume Chord pad channel gain (0.0 to 1.0)
 * @property {number} bpm Melody tempo in beats per minute
 */

/**
 * 100% Pure JavaScript Procedural Ambient Soundscape Engine.
 * Supports real-time mixer controls, persistent user presets, and dynamic tempo changes.
 */
class AmbientSoundEngine {
    constructor() {
        /** @type {boolean} */
        this.isPlaying = true;

        // Default Mixing Values
        /** @type {number} */
        this.masterVolume = 0.5;
        /** @type {number} */
        this.melodyVolume = 0.75;
        /** @type {number} */
        this.noiseVolume = 0.12;
        /** @type {number} */
        this.droneVolume = 0.28;
        /** @type {number} */
        this.bpm = 112;

        /** @type {number} */
        this.melodyFilterCutoff = 1800;
        /** @type {number} */
        this.noiseFilterCutoff = 160;
        /** @type {number} */
        this.droneFilterCutoff = 280;

        // Restore saved mix customizations from storage
        this.#loadSavedMixSettings();

        // Audio Nodes
        /** @type {GainNode|null} */
        this.masterGain = null;
        /** @type {GainNode|null} */
        this.noiseGain = null;
        /** @type {GainNode|null} */
        this.droneGain = null;
        /** @type {GainNode|null} */
        this.melodyBusGain = null;
        /** @type {AudioBufferSourceNode|null} */
        this.noiseSource = null;
        /** @type {OscillatorNode[]} */
        this.droneOscillators = [];
        /** @type {ReturnType<typeof setTimeout>|null} */
        this.melodyTimer = null;

        try {
            const saved = localStorage.getItem(STORAGE_AMBIENT_KEY);
            this.enabled = saved === "true";
        } catch {
            this.enabled = false;
        }
    }

    /**
     * Restores saved channel balances from localStorage.
     * 
     */
    #loadSavedMixSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_AMBIENT_MIX_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed.masterVolume === "number") this.masterVolume = parsed.masterVolume;
                if (typeof parsed.melodyVolume === "number") this.melodyVolume = parsed.melodyVolume;
                if (typeof parsed.noiseVolume === "number") this.noiseVolume = parsed.noiseVolume;
                if (typeof parsed.droneVolume === "number") this.droneVolume = parsed.droneVolume;
                if (typeof parsed.bpm === "number") this.bpm = parsed.bpm;
            }
        } catch {}
    }

    /**
     * Persists active mixing state to localStorage.
     * 
     */
    #persistMixSettings() {
        try {
            const state = {
                masterVolume: this.masterVolume,
                melodyVolume: this.melodyVolume,
                noiseVolume: this.noiseVolume,
                droneVolume: this.droneVolume,
                bpm: this.bpm
            };
            localStorage.setItem(STORAGE_AMBIENT_MIX_KEY, JSON.stringify(state));
        } catch {}
    }

    /**
     * Retrieves a copy of the current mix settings.
     * @returns {AmbientMixSettings}
     */
    getMixSettings() {
        return {
            masterVolume: this.masterVolume,
            melodyVolume: this.melodyVolume,
            noiseVolume: this.noiseVolume,
            droneVolume: this.droneVolume,
            bpm: this.bpm
        };
    }

    /**
     * Applies a 1-tap quick vibe preset.
     *
     * @param {"sitcom"|"coffee"|"sleep"} presetName
     */
    applyPreset(presetName) {
        switch (presetName) {
            case "sitcom":
                this.masterVolume = 0.5;
                this.melodyVolume = 0.75;
                this.noiseVolume = 0.12;
                this.droneVolume = 0.28;
                this.bpm = 112;
                break;
            case "coffee":
                this.masterVolume = 0.42;
                this.melodyVolume = 0.35;
                this.noiseVolume = 0.28;
                this.droneVolume = 0.38;
                this.bpm = 90;
                break;
            case "sleep":
                this.masterVolume = 0.38;
                this.melodyVolume = 0.0;
                this.noiseVolume = 0.45;
                this.droneVolume = 0.22;
                this.bpm = 70;
                break;
        }

        this.setMix({
            melody: this.melodyVolume,
            noise: this.noiseVolume,
            drone: this.droneVolume
        });
        this.setVolume(this.masterVolume);
        this.setBpm(this.bpm);
        this.#persistMixSettings();
    }

    /**
     * Sets master volume level in real-time.
     * @param {number} volume Value between 0.0 and 1.0.
     */
    setVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        const ctx = getAudioContext();
        if (ctx && this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.masterVolume, ctx.currentTime);
        }
        this.#persistMixSettings();
    }

    /**
     * Sets the melody tempo (BPM) dynamically.
     * @param {number} bpm Beats per minute (e.g. 112).
     */
    setBpm(bpm) {
        this.bpm = Math.max(40, Math.min(240, bpm));
        if (this.isPlaying) {
            const ctx = getAudioContext();
            if (ctx) {
                if (this.melodyTimer) clearTimeout(this.melodyTimer);
                this.#startThemeMelody(ctx);
            }
        }
        this.#persistMixSettings();
    }

    /**
     * Adjusts individual channel levels in real-time.
     * @param {{ melody?: number, noise?: number, drone?: number }} mix
     */
    setMix({ melody, noise, drone }) {
        const ctx = getAudioContext();
        const now = ctx ? ctx.currentTime : 0;

        if (melody !== undefined) {
            this.melodyVolume = Math.max(0, Math.min(1, melody));
            if (ctx && this.melodyBusGain) {
                this.melodyBusGain.gain.setValueAtTime(this.melodyVolume, now);
            }
        }
        if (noise !== undefined) {
            this.noiseVolume = Math.max(0, Math.min(1, noise));
            if (ctx && this.noiseGain) {
                this.noiseGain.gain.setValueAtTime(this.noiseVolume, now);
            }
        }
        if (drone !== undefined) {
            this.droneVolume = Math.max(0, Math.min(1, drone));
            if (ctx && this.droneGain) {
                this.droneGain.gain.setValueAtTime(this.droneVolume, now);
            }
        }
        this.#persistMixSettings();
    }

    /**
     * @param {ScheduleRecord|null} [scene=null]
     * @returns {boolean}
     */
    toggle(scene = null) {
        if (this.isPlaying) {
            this.stop();
            return false;
        } else {
            this.start(scene);
            return true;
        }
    }

    /**
     * Starts procedural ambient generation matching the active scene.
     * @param {ScheduleRecord|null} [scene=null]
     */
    start(scene = null) {
        const ctx = getAudioContext();
        if (!ctx) return;

        this.stop();

        this.isPlaying = true;
        this.enabled = true;
        try {
            localStorage.setItem(STORAGE_AMBIENT_KEY, "true");
        } catch {}

        try {
            if (ctx.state === "suspended") {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;

            // Master Bus
            this.masterGain = ctx.createGain();
            this.masterGain.gain.setValueAtTime(0.001, now);
            this.masterGain.gain.exponentialRampToValueAtTime(this.masterVolume, now + 0.6);
            this.masterGain.connect(ctx.destination);

            // Melody Channel Bus
            this.melodyBusGain = ctx.createGain();
            this.melodyBusGain.gain.setValueAtTime(this.melodyVolume, now);
            this.melodyBusGain.connect(this.masterGain);

            // Noise Channel Bus
            this.noiseGain = ctx.createGain();
            this.noiseGain.gain.setValueAtTime(this.noiseVolume, now);
            this.noiseGain.connect(this.masterGain);

            // Drone Pad Bus
            this.droneGain = ctx.createGain();
            this.droneGain.gain.setValueAtTime(this.droneVolume, now);
            this.droneGain.connect(this.masterGain);

            this.#createBrownNoise(ctx);
            this.#createLofiDroneChords(ctx);
            this.#startThemeMelody(ctx);
        } catch (/** @type {unknown} */ err) {
            console.warn("[Ambient] Audio start failed:", err);
            this.isPlaying = false;
        }
    }

    stop() {
        if (!this.isPlaying && !this.masterGain) return;
        const ctx = getAudioContext();

        try {
            if (ctx && this.masterGain) {
                const now = ctx.currentTime;
                this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
                this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

                setTimeout(() => {
                    this.#cleanupNodes();
                }, 450);
            } else {
                this.#cleanupNodes();
            }
        } catch {
            this.#cleanupNodes();
        }

        this.isPlaying = false;
        this.enabled = false;
        try {
            localStorage.setItem(STORAGE_AMBIENT_KEY, "false");
        } catch {}
    }

    #cleanupNodes() {
        try {
            if (this.melodyTimer) {
                clearTimeout(this.melodyTimer);
                this.melodyTimer = null;
            }
            if (this.noiseSource) {
                this.noiseSource.stop();
                this.noiseSource.disconnect();
                this.noiseSource = null;
            }
            for (const osc of this.droneOscillators) {
                osc.stop();
                osc.disconnect();
            }
            this.droneOscillators = [];
            if (this.masterGain) {
                this.masterGain.disconnect();
                this.masterGain = null;
            }
        } catch {}
    }

    /**
     * @param {AudioContext} ctx
     */
    #createBrownNoise(ctx) {
        if (!this.noiseGain) return;

        const bufferSize = ctx.sampleRate * 2;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            lastOut = (lastOut + (0.02 * white)) / 1.02;
            data[i] = lastOut * 2.2;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(this.noiseFilterCutoff, ctx.currentTime);

        source.connect(filter);
        filter.connect(this.noiseGain);
        source.start();

        this.noiseSource = source;
    }

    /**
     * @param {AudioContext} ctx
     */
    #createLofiDroneChords(ctx) {
        if (!this.droneGain) return;

        const freqs = [130.81, 164.81, 196.00]; // C3, E3, G3 (Warm C Major Pad)

        const droneFilter = ctx.createBiquadFilter();
        droneFilter.type = "lowpass";
        droneFilter.frequency.setValueAtTime(this.droneFilterCutoff, ctx.currentTime);

        for (const freq of freqs) {
            const osc = ctx.createOscillator();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            osc.connect(droneFilter);
            osc.start();
            this.droneOscillators.push(osc);
        }

        droneFilter.connect(this.droneGain);
    }

    /**
     * @param {AudioContext} ctx
     */
    #startThemeMelody(ctx) {
        const C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23, G4 = 392.00, A4 = 440.00, B4 = 493.88;
        const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99;

        /** @type {Array<[number, number]>} */
        const score = [
            // Phrase 1: Bouncy Opening Motif
            [C4, 0.5], [E4, 0.5], [G4, 1.0],
            [A4, 0.5], [G4, 0.5], [E4, 1.0],
            [D4, 0.5], [E4, 0.5], [G4, 1.5], [0, 0.5],
            [A4, 0.5], [C5, 0.5], [D5, 1.0], [C5, 2.0],

            // Phrase 2: Playful Banter Energy
            [F4, 0.5], [A4, 0.5], [C5, 0.5], [D5, 0.5],
            [E5, 1.5], [D5, 0.5], [C5, 1.0],
            [A4, 0.5], [D4, 0.5], [F4, 0.5], [A4, 0.5],
            [C5, 1.0], [B4, 0.5], [G4, 0.5], [E4, 1.5], [D4, 0.5],

            // Phrase 3: Ascending Sparkle & Deep Home Tone
            [C4, 0.5], [G4, 0.5], [E4, 0.5], [G4, 0.5],
            [C5, 1.0], [E5, 1.0], [D5, 0.5], [C5, 1.5],
            [A4, 0.5], [C5, 0.5], [G4, 1.0],
            [E4, 0.5], [D4, 0.5], [C4, 2.0],

            // Phrase 4: Grand Sitcom Turnaround
            [G4, 0.5], [A4, 0.5], [C5, 1.0],
            [E5, 0.5], [G5, 1.5],
            [E5, 0.5], [D5, 0.5], [C5, 1.0],
            [A4, 0.5], [G4, 0.5], [E4, 1.0],
            [D4, 0.5], [E4, 0.5], [D4, 1.0], [C4, 2.5], [0, 1.0]
        ];

        let stepIndex = 0;
        const beatMs = (60 / this.bpm) * 1000;

        const playNextStep = () => {
            if (!this.isPlaying || !this.melodyBusGain) return;

            const [freq, beats] = score[stepIndex % score.length];
            stepIndex++;

            const stepDurationMs = beatMs * beats;
            const noteDurationSec = (stepDurationMs / 1000) * 0.94;

            if (freq > 0) {
                try {
                    const now = ctx.currentTime;
                    const osc = ctx.createOscillator();
                    const noteGain = ctx.createGain();
                    const noteFilter = ctx.createBiquadFilter();

                    osc.type = "sine";
                    osc.frequency.setValueAtTime(freq, now);

                    noteFilter.type = "lowpass";
                    noteFilter.frequency.setValueAtTime(this.melodyFilterCutoff, now);

                    noteGain.gain.setValueAtTime(0.0001, now);
                    noteGain.gain.exponentialRampToValueAtTime(0.85, now + 0.02);
                    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + noteDurationSec);

                    osc.connect(noteFilter);
                    noteFilter.connect(noteGain);
                    noteGain.connect(this.melodyBusGain);

                    osc.start(now);
                    osc.stop(now + noteDurationSec + 0.05);
                } catch {}
            }

            this.melodyTimer = setTimeout(playNextStep, stepDurationMs);
        };

        playNextStep();
    }
}

export const Sound = new SoundEngine();
export const AmbientAudio = new AmbientSoundEngine();