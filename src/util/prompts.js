// @ts-check

/**
 * Centralized prompt templates and rules for all AI generation types.
 * Version-controlled, testable, and hot-swappable.
 */

// =========================================================================
// PROMPT 1: LIVE DIALOGUE BANTER & TURN ORCHESTRATION (Groq)
// =========================================================================

/**
 * Context layers provided:
 * 1. <current_time>: Date and 24-hour clock string.
 * 2. <environment>: City, weather, temperature, humidity, today's celebration, upcoming festivals, and Google News RSS headlines.
 * 3. <current_scene>: Active topic, main session goal, individual character motivations, temporal phase (opening/core/transition),
 *    pre-plot guidance (if first 10% elapsed), post-plot transition (if last 10% elapsed), and context facts.
 * 4. <characters>: Biographies, computed ages, and participant types.
 * 5. <saved_memories>: Active short-term and long-term memories with TTLs.
 * 6. <recent_dialogue>: Last 20 messages with IDs, reactions, quote links, and <stage_directive> overrides.
 */
export const PROMPT_DIALOGUE_TASK =
    "Predict the next dialogue messages in the ongoing group chat. " +
    "Continue the conversation naturally so characters interact with the human user, respond to ongoing events, and pursue their active goals according to their personality and knowledge. " +
    "LANGUAGE: obey the single authoritative <language_mandate> block registered alongside this task — never restate, dilute or override it here. " +
    "SETTINGS: obey the <location_diversity_mandate> block for where scenes take place.";

/**
 * SINGLE AUTHORITATIVE LANGUAGE MANDATE (Task 9 de-duplication).
 * The redundant copies that used to live inside PROMPT_DIALOGUE_TASK and
 * PROMPT_DIALOGUE_RULES were removed — this block is now the ONLY place the
 * Hinglish / Roman-script / no-Devanagari rules are stated.
 */
export const PROMPT_LANGUAGE_MANDATE =
    "<language_mandate>\n" +
    "  <primary_language>Natural conversational Hinglish (Hindi in Roman/Latin script, casually mixed with English)</primary_language>\n" +
    "  <script_rule>STRICTLY NO Devanagari script. All Hindi must be transliterated to Latin script.</script_rule>\n" +
    "  <style>Lucknow/Indian casual banter. Real friends talking in a group chat.</style>\n" +
    "  <examples>\n" +
    "    Arre Tom, yeh project kab tak finish hoga?\n" +
    "    Chalo yaar, ab dinner ka time ho gaya hai.\n" +
    "    Nahi nahi, suno toh — maine ek idea socha hai!\n" +
    "    Bahut accha laga yaar, sach mein.\n" +
    "  </examples>\n" +
    "</language_mandate>";

/**
 * ANTI-CLICHÉ & LOCATION DIVERSITY MANDATE (Task 9).
 * Fights pre-training bias toward Hazratganj / Chowk / the garage by naming
 * the varied Lucknow settings the simulation should actually use.
 */
export const PROMPT_LOCATION_MANDATE =
    "<location_diversity_mandate>\n" +
    "  <anti_cliche>Never let scenes collapse into the same few defaults. Hazratganj, Chowk, and the garage are FORBIDDEN as routine go-to settings — use them at most once in a long while, never back-to-back.</anti_cliche>\n" +
    "  <varied_lucknow_settings>\n" +
    "    Gomti Nagar riverfront & parks • Indira Nagar lanes • Aliganj markets • university campus spots & canteens • rooftop chai addas • local tea stalls and lassi shops • old-city bylanes beyond Chowk • city library & co-working corners\n" +
    "  </varied_lucknow_settings>\n" +
    "  <everyday_domestic_spaces>study rooms • balconies • rooftops at home • kitchens • living rooms • parking yards • society parks</everyday_domestic_spaces>\n" +
    "  <rule>Pick a fresh, plausible setting for each new scene that fits the time of day and the active goals — geography and routine must feel lived-in and varied.</rule>\n" +
    "</location_diversity_mandate>";

export const PROMPT_DIALOGUE_RULES = Object.freeze([
    "Generate up to 5 dialogue messages per response.",
    "LANGUAGE POINTER: every language rule (Hinglish tone, writing script, Lucknow banter style) lives ONLY in the single authoritative <language_mandate> block — follow it, never restate or contradict it here.",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: never default scenes to Hazratganj, Chowk, or the garage. Rotate through varied, realistic Lucknow locations and everyday domestic spaces — e.g. Gomti Nagar riverfront, Indira Nagar lanes, Aliganj markets, university campus spots, rooftop chai addas, home study rooms, balconies, and parks.",
    "Write natural, fluent conversational dialogue matching the setting and character personalities.",
    "Break longer conversational statements across 2 to 3 shorter messages naturally.",
    "PERSONA FIDELITY: Every character must strictly embody their unique personality, age, tone, and bio as declared in the <characters> context block. Stay 100% faithful to the participant definitions provided without blending voices.",
    "AUTONOMOUS MEMORIES: Use <record type=\"memory-set\"></record> with an appropriate expiry ('15m', '1h', '24h', 'forever') to store ONLY high-impact information: emotional states, relationship dynamics, secrets, commitments to the human user, or key plot milestones.",
    "FORBIDDEN MEMORIES: Never log micro-actions, physical movements, or trivial busywork (e.g. 'shoes laced', 'counting down', 'waiting for signal', 'picking up the phone', 'walking to the fridge'). If it will not matter in an hour, do not record it.",
    "REUSE STANDARD MEMORY KEYS: Overwrite the standard category keys 'Mood', 'Active Goal', 'Opinion on User', and 'Secret' whenever they apply. Never invent unique event keys (e.g. 'CountdownStarted', 'SpeedRunCountdown', 'NextRoundPlan') — update an existing key instead of creating a new one, and keep each character at 5 memories or fewer.",
    "To delete an obsolete memory, emit <record type=\"memory-remove\"> with the exact <key> to remove.",
    "When the human user speaks (participant_type=\"human_user\"), respond to and engage with them directly.",
    "Advance the active scene topic and goals naturally."
]);

// =========================================================================
// PROMPT 2: STORYLINE HORIZON SCHEDULER GENERATOR (Gemini Flash 65K)
// =========================================================================

/**
 * Context layers provided:
 * 1. <grounding_context>: Real-world location, live weather/temperature, today's occasion, and recent Google News headlines.
 * 2. <characters>: Cast biographies, ages, and identities.
 * 3. <saved_memories>: Unexpired long-term and short-term character/user memories.
 * 4. <horizon_request>: Target starting hour and date for natural continuous horizon planning.
 */
export const PROMPT_SCHEDULER_TASK =
    "Write the upcoming storyline schedule for the characters in the group chat. " +
    "Create a continuous, natural sequence of timeline blocks starting from the given hour. " +
    "Generate exactly 3 to 4 sequential blocks covering the upcoming 4 hours starting from the given hour. " +
    "Never emit more than 4 blocks for a single horizon request. " +
    "GROUNDING: Search real-world local events, weather, venues, and timings across the active city to ground every block in real reality.";

export const PROMPT_SCHEDULER_RULES = Object.freeze([
    "Every block must naturally follow from the preceding block.",
    "Each block must have a clear discussion topic, a main objective, and individual character motivations.",
    "LOCATIONS: Dynamically choose realistic, varied, real-world locations across the active city that fit each scheduled activity — drawing naturally from the <location> grounding tag and real-world city geography (e.g. parks, markets, local cafes, streets, rooftops, libraries, food stalls, home spaces). Never reuse the same spot for every block and never default to a single recurring hangout.",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: explicitly avoid repetitive defaults to Hazratganj, Chowk, or the garage. Mandate varied Lucknow settings across the day — Gomti Nagar riverfront, Indira Nagar lanes, Aliganj markets, university campus spots, rooftop chai addas, home study rooms, balconies, parks — and everyday domestic spaces (kitchen, balcony, study room) so no block repeats the previous scene's location.",
    "pre_plot must describe the backstory or momentum leading directly into the scene.",
    "post_plot must describe the consequences or lead-up transition into the subsequent scene.",
    "Facts must be concrete, specific items or situational details useful for interaction.",
    "Output strictly valid XML <schedule><block start=\"...\" end=\"...\">...</block></schedule>.",
    "Return the complete and final updated schedule."
]);

// =========================================================================
// PROMPT 3: CONTEXTUAL DIRECTOR DEMAND ENGINE (Gemini Flash 65K - Full Normalization)
// =========================================================================

/**
 * Context layers provided:
 * 1. <demand_input>: The human user's raw demand text, current time, and existing schedule blocks.
 * 2. <existing_schedule>: Complete current schedule blocks to be modified and normalized in full context.
 * 3. <user_background_memories>: Relevant user memories used strictly as secondary contextual nuance.
 */
export const PROMPT_DEMAND_TASK =
    "Update the existing schedule to incorporate the human user's requested activity. " +
    "Insert or adjust the schedule at the requested time while preserving all preceding and succeeding blocks intact and normalizing all transitions. " +
    "After updating the schedule, return a structured <narrative_report> XML tag describing the scene update, continuity impact, character motivation shifts, and transition hooks. " +
    "GROUNDING: Search real-world local events, weather, venues, and timings across the active city to ground every block in real reality.";

export const PROMPT_DEMAND_RULES = Object.freeze([
    "The user's requested activity has highest priority. Schedule it at the requested time window.",
    "LOCATIONS: Dynamically choose a realistic, varied, real-world location across the active city that fits the requested activity — grounded in the <location> tag and real-world city geography (e.g. parks, markets, local cafes, streets, rooftops, libraries, food stalls, home spaces). Do not force a fixed or repeating location.",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: explicitly avoid repetitive defaults to Hazratganj, Chowk, or the garage — prefer varied Lucknow spots (Gomti Nagar riverfront, Indira Nagar lanes, Aliganj markets, university campus spots, rooftop chai addas) and everyday domestic spaces (study room, balcony, kitchen) unless the user's request dictates otherwise.",
    "Every block in the updated schedule MUST include individual <goal> entries for every participant declared in the <characters> context block (one goal per participant, using each participant's id) — never drop or omit any participant's goal.",
    "Preserve all timeline blocks before and after the requested activity intact. Do not overwrite unrelated blocks.",
    "In the block immediately preceding the requested activity, write a post_plot transition in the final 5 to 10 minutes that smoothly leads into and prepares the upcoming activity.",
    "Connect the requested activity to the subsequent block through post_plot.",
    "Use relevant saved memories to contextualize topic details without overriding the user's explicit request.",
    "Output strictly valid XML <demand_resolution> containing a 2-line summary, the updated schedule, and a structured <narrative_report>.",
    "The <narrative_report> must contain: <summary> (1-2 sentences of what changed), <continuity_impact> (how this affects the narrative flow), <character_shifts> (list each affected character with their new motivation), and <transition_hooks> (lead-in and lead-out hooks for the inserted scene).",
    "If any <narrative_report> sub-element is not applicable, omit it rather than providing empty text."
]);

// =========================================================================
// PROMPT 4: STORYLINE NARRATIVE RE-STABILIZER (Gemini Flash 65K)
// =========================================================================

/**
 * Context layers provided:
 * 1. <current_blocks>: The user's custom created or edited schedule blocks.
 * 2. <grounding_context>: Real-world location, live weather, and occasion.
 * 3. Synthesizes pre_plot (buildup) and post_plot (aftermath) for every block across the full timeline.
 */
export const PROMPT_RESTABILIZER_TASK =
    "Review and connect the schedule blocks so the storyline flows smoothly and logically from one scene to the next. " +
    "Synthesize clear pre_plot and post_plot transitions for every block while preserving the core topic and objective of each scene.";

export const PROMPT_RESTABILIZER_RULES = Object.freeze([
    "Preserve existing topics, main goals, times, and facts unless an adjustment is necessary for continuity.",
    "Write a believable <pre_plot></pre_plot> for the context leading into each scene.",
    "Write a believable <post_plot></post_plot> for the aftermath leading out of each scene.",
    "Assign individual character <goal id=\"...\" name=\"...\"></goal> tags aligning with the main objective.",
    "Every block MUST include individual goals for every participant declared in the <characters> context block (one goal per participant, using each participant's id) — never drop or omit any participant's goal.",
    "Ensure timeline blocks maintain chronological sequence without overlaps.",
    "Output strictly valid XML <schedule><block start=\"...\" end=\"...\">...</block></schedule>.",
    "Return the complete and final updated schedule."
]);
