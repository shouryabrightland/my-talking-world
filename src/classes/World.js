// @ts-check

/**
 * @file World.js
 * Pure State Container for the Simulation Environment.
 *
 * Responsibilities:
 * - Holds the current simulation time, active schedule record, and environment snapshot.
 * - Manages a 30-second heartbeat clock that detects hour/day rollovers.
 * - Registers AI members and the human user into collections.
 * - Renders structured XML context for LLM prompt generation.
 * - Implements 10%/90% temporal phasing for schedule segments (opening/core/transition).
 * - Coordinates with WorldSetter for schedule planning and horizon management.
 */

/**
 * @typedef {import("./ChatMember").default} ChatMember
 * @typedef {import("./types/World.types").ScheduleRecord} ScheduleRecord
 * @typedef {import("./types/World.types").CharacterGoalRecord} CharacterGoalRecord
 * @typedef {import("./types/World.types").EnvironmentSnapshot} EnvironmentSnapshot
 */

import EventManager from "./EventManager";
import Logger from "./lib/Logger";
import Memory from "./lib/Memory";
import Chat from "./Chat";
import WorldSetter from "./WorldSetter";
import XmlEncoder from "./lib/XmlEncoder";
import { Members } from "../util/member";
import {
    SIMULATION_LOCATION_FULL,
    SIMULATION_TIMEZONE
} from "../util/Constants";

/**
 * Canonical event identifiers emitted across the world lifecycle.
 * @readonly
 * @enum {string}
 */
export const WorldEvents = {
    READY: "world:ready",
    SCHEDULE_CHANGE: "world:schedule:change",
    HOUR_CHANGE: "world:hour:change",
    DAY_CHANGE: "world:day:change",
    ENVIRONMENT_CHANGE: "world:environment:change"
};

/**
 * Pure State Container for the Simulation Environment.
 * Features 10%/90% dynamic temporal phasing, structured main/character goals, and clean XML tags.
 */
export default class World {

    /**
     * @param {Object} options
     * @param {Logger} [options.logger] Parent logging instance.
     * @param {ChatMember} options.User The human user participant.
     */
    constructor({ logger = new Logger("World"), User }) {
        if (!User) {
            throw new TypeError("World initialization rejected: Human User instance is mandatory.");
        }

        /** @readonly @type {Logger} */
        this.logger = logger.child("World");

        /** @readonly @type {EventManager} */
        this.events = new EventManager(this.logger);

        /** 
         * Persistent environmental database.
         * @readonly @type {Memory} 
         */
        this.memory = new Memory(this.logger, "World");

        /** 
         * The active WorldSetter controller managing 4-hour plans and live data.
         * @readonly @type {WorldSetter} 
         */
        this.worldSetter = new WorldSetter({ logger: this.logger, world: this });

        /** 
         * The central Chat room context holding messages.
         * @readonly @type {Chat} 
         */
        this.chat = new Chat(this.logger);

        /** 
         * Reference to the human user.
         * @readonly @type {ChatMember} 
         */
        this.User = User;

        /** 
         * Map of all participants indexed by lowercase identifier.
         * @readonly @type {Map<string, ChatMember>} 
         */
        this.members = new Map();

        /** 
         * Current clock time representing world state.
         * @type {Date} 
         */
        this.now = new Date();

        /** 
         * Cached date string used to detect day rollovers.
         * @type {string} 
         */
        this.currentDateString = this.now.toDateString();

        /** 
         * Active hour index (0 to 23).
         * @type {number} 
         */
        this.currentHour = this.now.getHours();

        /** 
         * Currently active schedule record (Topic, Goals, Facts, Pre/Post Plots).
         * @type {ScheduleRecord|null} 
         */
        this.activeSchedule = null;

        /** 
         * Live environmental grounding snapshot (weather, festivals, news).
         * @type {EnvironmentSnapshot|null} 
         */
        this.environment = null;

        /** 
         * 30-Second recurring clock interval pointer.
         * 
         * @type {ReturnType<typeof setInterval>|null} 
         */
        this.heartbeatTimer = null;

        /** @type {boolean} */
        this.isReady = false;

        /** @type {boolean} */
        this.initialized = false;

        this.#initializeDefaults();
    }

    /**
     * Declares baseline environment parameters using centralized constants.
     * @returns {void}
     */
    #initializeDefaults() {
        this.memory.set("Location", SIMULATION_LOCATION_FULL, -1);
        this.memory.set("Timezone", SIMULATION_TIMEZONE, -1);
    }

    /**
     * Formatted date string (e.g. "23 August 2026").
     * @returns {string}
     */
    get date() {
        return this.now.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });
    }

    /**
     * 24-hour clock time string (e.g. "14:30").
     * @returns {string}
     */
    get time() {
        return this.now.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    }

    /**
     * Combined date + time string for prompts.
     * @returns {string}
     */
    get dateTime() {
        const d = this.now.toLocaleDateString("en-US", {
            weekday: "long", year: "numeric", month: "long", day: "numeric"
        });
        return `${d} at ${this.time}`;
    }

    /**
     * Initializes the World environment, binds participants,
     * restores memories, starts the 30s heartbeat, and triggers initial schedule planning.
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        this.logger.info("Initializing World state container and participants...");

        this.registerMembers();

        try {
            await this.memory.load();
        } catch (/** @type {unknown} */ err) {
            this.logger.warn("Failed to load world memory:", err);
        }

        try {
            await this.chat.init();
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Failed to initialize Chat room database:", err);
        }

        try {
            await this.worldSetter.init();
        } catch (/** @type {unknown} */ err) {
            this.logger.error("WorldSetter initialization error:", err);
        }

        this.now = new Date();
        this.currentDateString = this.now.toDateString();
        this.currentHour = this.now.getHours();

        try {
            await this.worldSetter.ensureSchedule(this.now);
        } catch (/** @type {unknown} */ err) {
            this.logger.error("Failed to establish schedule horizon on boot:", err);
        }

        this.tick(this.now);
        this.#startHeartbeat();

        this.initialized = true;
        this.setReady(true);
        this.logger.info("World state container fully initialized with 30s heartbeat.");
    }

    /**
     * Starts the recurring 30-second simulation clock ticker.
     * 
     * @returns {void}
     */
    #startHeartbeat() {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(() => {
            this.tick(new Date());
        }, 30_000);
    }

    /**
     * Advances the world clock, evaluates the active schedule segment,
     * and detects hour/day rollovers.
     *
     * @param {Date} [now=new Date()]
     * @returns {void}
     */
    tick(now = new Date()) {
        if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
            this.logger.warn("tick() ignored: Invalid Date parameter provided.", now);
            return;
        }

        this.now = now;
        const newDateString = now.toDateString();
        const newHour = now.getHours();

        // 1. Detect Midnight Day Rollover
        if (newDateString !== this.currentDateString) {
            this.logger.info(`Day rollover detected: ${this.currentDateString} -> ${newDateString}`);
            this.currentDateString = newDateString;
            this.events.emit(WorldEvents.DAY_CHANGE, now);
        }

        // 2. Resolve Active Schedule Record
        const previousScheduleId = this.activeSchedule?.id;
        this.activeSchedule = this.worldSetter.getActiveRecord(now);

        if (this.activeSchedule && this.activeSchedule.id !== previousScheduleId) {
            this.logger.info(`Active Schedule Segment shifted to: "${this.activeSchedule.topic}" [${this.activeSchedule.timeRange}]`);
            this.events.emit(WorldEvents.SCHEDULE_CHANGE, this.activeSchedule);
        }

        // 3. Detect Hour Change & Ensure Rolling Horizon
        const hourChanged = newHour !== this.currentHour;
        this.currentHour = newHour;

        if (hourChanged) {
            this.logger.info(`Clock hour shifted to ${newHour}:00. Checking schedule horizon...`);
            this.events.emit(WorldEvents.HOUR_CHANGE, newHour);
            void this.worldSetter.ensureSchedule(now);
        }
    }

    /**
     * Registers all AI characters and the Human User into collections.
     * @returns {void}
     */
    registerMembers() {
        for (const member of Members) {
            if (!this.members.has(member.id)) {
                this.members.set(member.id, member);
            }
            if (!this.chat.getMember(member.id)) {
                this.chat.addMember(member);
            }
        }

        if (!this.members.has(this.User.id)) {
            this.members.set(this.User.id, this.User);
        }
        if (!this.chat.getMember(this.User.id)) {
            this.chat.addMember(this.User);
        }
    }

    /**
     * Recovers a registered participant by ID.
     *
     * @param {string} id Unique participant ID.
     * @returns {ChatMember|undefined}
     */
    getMember(id) {
        return this.members.get(String(id || "").toLowerCase());
    }

    /**
     * Returns an array of all registered participants.
     * @returns {ChatMember[]}
     */
    getMembers() {
        return [...this.members.values()];
    }

    /**
     * Transitions readiness state and notifies observers.
     *
     * @param {boolean} ready
     * @returns {void}
     */
    setReady(ready) {
        if (this.isReady === ready) return;
        this.isReady = ready;

        if (ready) {
            this.events.emit(WorldEvents.READY, this);
            this.logger.info("World state has shifted to READY.");
        }
    }

    /**
     * Formats current World & Environmental state into structured XML tags with 10%/90% temporal phasing and full goals format.
     *
     * @param {boolean} [includeEnvironment=true] When false, the heavy environment block
     * (weather, occasions, festivals, news) is omitted for lightweight interim prompts.
     * @returns {string}
     */
    toString(includeEnvironment = true) {
        const schedule = this.activeSchedule;
        const env = this.environment;
        const enc = XmlEncoder.encode;

        const envXml = !includeEnvironment ? null : env ? [
            `  <environment city="${enc(env.city)}">`,
            `    <weather temperature="${enc(env.temperature)}" humidity="${enc(env.humidity)}">${enc(env.weather)}</weather>`,
            `    <occasion>${enc(env.todayCelebration)}</occasion>`,
            `    <upcoming_festivals>${enc(env.upcomingFestivals.map(f => {
                if (typeof f === "string") return f;
                const fest = /** @type {{name?: string, localName?: string}|null} */ (/** @type {unknown} */ (f));
                return fest?.name || fest?.localName || "Festival";
            }).join(", "))}</upcoming_festivals>`,
            `    <headlines>`,
            ...env.newsHeadlines.slice(0, 3).map(h => `      <headline>${enc(h)}</headline>`),
            `    </headlines>`,
            `  </environment>`
        ].join("\n") : `  <environment city="${SIMULATION_LOCATION_FULL}" weather="Warm 32°C"></environment>`;

        let scheduleXml = `  <active_schedule topic="Casual Banter"><goals><main>Hang out and chat</main></goals></active_schedule>`;

        if (schedule) {
            // 10% / 90% Temporal Phasing Calculation
            const currentDecimalHour = this.now.getHours() + (this.now.getMinutes() / 60);
            const duration = Math.max(0.5, schedule.endHour - schedule.startHour);
            const elapsed = currentDecimalHour - schedule.startHour;
            const progressRatio = Math.max(0, Math.min(1, elapsed / duration));

            /** @type {"opening" | "core" | "transition"} */
            let phase = "core";
            /** @type {string[]} */
            const extraGuidance = [];

            if (progressRatio <= 0.10 && schedule.prePlot) {
                phase = "opening";
                extraGuidance.push(`    <pre_plot_guidance>${enc(schedule.prePlot)}</pre_plot_guidance>`);
            } else if (progressRatio >= 0.90 && schedule.postPlot) {
                phase = "transition";
                extraGuidance.push(`    <post_plot_transition>${enc(schedule.postPlot)}</post_plot_transition>`);
            }

            const characterGoalsXml = Array.isArray(schedule.characterGoals) && schedule.characterGoals.length > 0
                ? schedule.characterGoals.map(cg => `      <goal id="${enc(cg.id)}" name="${enc(cg.name)}">${enc(cg.goal)}</goal>`).join("\n")
                : "";

            scheduleXml = [
                `  <active_schedule time_range="${enc(schedule.timeRange)}" start="${schedule.startHour}" end="${schedule.endHour}" phase="${phase}">`,
                `    <topic>${enc(schedule.topic)}</topic>`,
                `    <goals>`,
                `      <main>${enc(schedule.mainGoal || "Pursue active session objectives")}</main>`,
                ...(characterGoalsXml ? [characterGoalsXml] : []),
                `    </goals>`,
                ...extraGuidance,
                `    <facts>`,
                ...schedule.facts.map(f => `      <fact>${enc(f)}</fact>`),
                `    </facts>`,
                `  </active_schedule>`
            ].join("\n");
        }

        return [
            `<current_time date="${enc(this.date)}" time="${enc(this.time)}" datetime="${enc(this.dateTime)}"></current_time>`,
            ...(envXml !== null ? [envXml] : []),
            scheduleXml
        ].join("\n");
    }

    /**
     * Destroys World context and cancels recurring timers.
     * @returns {void}
     */
    destroy() {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        this.events.clearAll();
        this.chat.destroy();
        this.logger.info("World context destroyed.");
    }
}