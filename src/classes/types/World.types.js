// @ts-check

/**
 * Individual character goal or motivation within a scheduled block.
 * @typedef {Object} CharacterGoalRecord
 * @property {string} id Unique participant ID (e.g. 'tom', 'angela').
 * @property {string} name Display name of the character.
 * @property {string} goal Specific motivation or personal agenda for this session.
 */

/**
 * Represents a single dynamic scheduled block in the rolling Horizon with structured goals and pre/post context.
 * @typedef {Object} ScheduleRecord
 * @property {string} id Unique UUID identifier.
 * @property {number} startHour Decimal start hour of this segment (e.g. 14.0 for 14:00, 14.5 for 14:30).
 * @property {number} endHour Decimal end hour of this segment (e.g. 15.5 for 15:30).
 * @property {string} timeRange Formatted window string (e.g. '14:00 - 15:30').
 * @property {string} topic Core discussion topic for this session.
 * @property {string} mainGoal Main overarching session objective.
 * @property {CharacterGoalRecord[]} characterGoals Individual character motivations for this block.
 * @property {string[]} facts Specific context facts / tags active during this segment.
 * @property {string} prePlot Context of what happened just before this scene (momentum / backstory).
 * @property {string} postPlot Expected aftermath leading to the next scene or lead-up motivation hook.
 * @property {number} createdAt Millisecond epoch when this record was created.
 * @property {number} updatedAt Millisecond epoch when this record was last modified.
 */

/**
 * Autonomous real-world environmental grounding context (read-only for user).
 * @typedef {Object} EnvironmentSnapshot
 * @property {string} city Geographic location name (e.g. 'Lucknow, Uttar Pradesh (India)').
 * @property {string} temperature Current temperature string (e.g. '34°C').
 * @property {string} weather Current weather description (e.g. 'Sunny, partly cloudy').
 * @property {string} humidity Relative humidity percentage (e.g. '62%').
 * @property {string} todayCelebration Active festival or holiday from Calendar Bharat.
 * @property {string[]} upcomingFestivals List of upcoming Indian celebrations.
 * @property {string[]} newsHeadlines Real ongoing headlines from Google News RSS.
 * @property {number} updatedAt Timestamp of the last environmental refresh.
 */

/**
 * Individual character motivation shift within a demand update.
 * @typedef {Object} CharacterShiftRecord
 * @property {string} id Unique participant ID (e.g. 'tom', 'angela').
 * @property {string} name Display name of the character.
 * @property {string} motivation Updated motivation or behavioral shift for this character.
 */

/**
 * Structured narrative report returned by the Director Demand Engine.
 * Describes scene update, continuity impact, character shifts, and transition hooks.
 * @typedef {Object} DemandReport
 * @property {string} summary 1-2 sentences describing what was changed in the schedule.
 * @property {string} [continuityImpact] How this update affects the narrative flow and scene transitions.
 * @property {CharacterShiftRecord[]} [characterShifts] List of characters whose motivations were updated.
 * @property {string} [transitionHooks] Lead-in and lead-out hooks for the inserted scene.
 */

/**
 * Result returned after applying a Director Demand.
 * @typedef {Object} DemandResolutionResult
 * @property {string} line1 Summary of what was updated or scheduled.
 * @property {string} line2 Where and when it is scheduled (including lead-up hooks).
 * @property {ScheduleRecord[]} schedule The newly updated schedule array.
 * @property {DemandReport} [report] Structured narrative report (when available from the model).
 */

/**
 * Structured state container persisted to storage and shared across the simulation.
 * @typedef {Object} WorldStateRecord
 * @property {string} date Formatted date string (e.g. 'Sat Aug 22 2026').
 * @property {number} generatedAt Timestamp when schedule was refreshed.
 * @property {ScheduleRecord[]} schedule Rolling schedule segments covering the horizon.
 * @property {EnvironmentSnapshot} environment Real-world weather, news, and festival grounding.
 */

/**
 * Action type for a proposed change: 'add' for new blocks, 'remove' for blocks to delete.
 * @typedef {'add' | 'remove'} ProposalAction
 */

/**
 * A single proposed change from the AI/Director, pending human approval.
 * @typedef {Object} ProposedChange
 * @property {ProposalAction} action Whether this is an addition or removal.
 * @property {ScheduleRecord} block The schedule block being added or removed.
 * @property {string} [reason] Optional AI-generated explanation for why this change was proposed.
 */

/**
 * A set of AI-proposed changes pending human approval.
 * Created when the Director Demand Engine generates schedule modifications.
 * @typedef {Object} ScheduleProposal
 * @property {string} id Unique identifier for this proposal batch.
 * @property {ProposedChange[]} changes List of proposed additions and removals.
 * @property {string} summary AI-generated summary of all proposed changes.
 * @property {number} createdAt Timestamp when the proposal was created.
 * @property {DemandReport} [report] Optional narrative report from the demand engine.
 */

export {};