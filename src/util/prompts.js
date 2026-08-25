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
    "LANGUAGE: All dialogue and spoken text must be written in natural conversational Hinglish — Hindi vocabulary and grammar written exclusively in Roman/Latin script, casually mixed with English words. " +
    "Example: 'Arre Tom, yeh project kab tak finish hoga?' or 'Chalo yaar, ab dinner ka time ho gaya hai.' " +
    "STRICTLY NO Devanagari script must appear anywhere in <text> or <thought> tags under any circumstance — all Hindi must be transliterated to Latin script. " +
    "Prioritize natural Lucknow/Indian Hinglish banter over formal or pure English.";

export const PROMPT_DIALOGUE_RULES = Object.freeze([
    "Generate up to 5 dialogue messages per response.",
    "LANGUAGE RULE: All <text> and <thought> content MUST be natural conversational Hinglish — Hindi words and grammar written exclusively in Roman/Latin script, casually blended with English. " +
    "Example patterns: 'Arre yaar...', 'Chal dekhte hain', 'Yeh kya ho raha hai?', 'Bahut accha laga', 'Theek hai na?', 'Nahi nahi, suno toh'.",
    "STRICTLY FORBIDDEN: No Devanagari script anywhere in output. If you need a Hindi word, transliterate it into Latin script.",
    "Prefer natural Lucknow/Indian Hinglish banter over formal or pure English. Characters speak like real Indian friends in a casual group chat.",
    "Write natural, fluent conversational dialogue matching the setting and character personalities.",
    "Break longer conversational statements across 2 to 3 shorter messages naturally.",
    "Always include a candid <thought></thought> tag for every message revealing the character's internal mindset.",
    "PERSONA FIDELITY: Tom is ambitious/dramatic, Angela is witty/trendy, Ben is technical/protective, Ginger is playful/cheeky, Hank is relaxed/foodie, Becca is sporty/direct. Stay true to each character's voice.",
    "AUTONOMOUS MEMORIES: Use <record type=\"memory-set\"></record> with an appropriate expiry ('15m', '1h', '24h', 'forever') to store short-term reminders, temporary postures, unsaid thoughts, ongoing friction, micro-locations, or permanent facts.",
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
    "Create a continuous, natural sequence of timeline blocks starting from the given hour.";

export const PROMPT_SCHEDULER_RULES = Object.freeze([
    "Every block must naturally follow from the preceding block.",
    "Each block must have a clear discussion topic, a main objective, and individual character motivations.",
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
    "After updating the schedule, return a structured <narrative_report> XML tag describing the scene update, continuity impact, character motivation shifts, and transition hooks.";

export const PROMPT_DEMAND_RULES = Object.freeze([
    "The user's requested activity has highest priority. Schedule it at the requested time window.",
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
    "Ensure timeline blocks maintain chronological sequence without overlaps.",
    "Output strictly valid XML <schedule><block start=\"...\" end=\"...\">...</block></schedule>.",
    "Return the complete and final updated schedule."
]);
