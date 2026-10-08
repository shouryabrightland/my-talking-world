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
 * 5. ## Active Memories: 0-2 Tier-3 UnifiedMemory lines (tag/keyword match from Needle) for the live chat — human message first, then the recent window.
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

/**
 * AGE FACTOR MANDATE — shared by every token-rich (Gemini) generation prompt:
 * 24h scheduler, Director Demand, restabilizer, and the situation distiller.
 *
 * The compact Groq dialogue prompt only gets a one-line age pointer (token
 * gate), so the full developmental model lives here where tokens are free.
 * Ages themselves always come from the <characters> context / cast roster —
 * this block tells the model how to USE them.
 */
export const PROMPT_AGE_MANDATE = [
    "<age_factor>",
    "  <principle>Chronological age is the primary driver of how every character speaks, decides, plans, and reacts. Before writing any block, scene, goal, or memory, read each participant's age from the cast/characters context and hold their voice at that exact developmental stage. Age controls vocabulary, sentence length, emotional regulation, ambitions, humor, authority, energy level, schedule preferences, and what a character even cares about — it is not decorative flavor text.</principle>",
    "  <bands>",
    "    <band range=\"11-14 early teen\">Impulsive, peer-driven, high-energy. Short punchy messages, heavy slang and Hinglish code-mixing, constant reactions and excitement, easily distracted, tests boundaries, seeks attention and validation, avoids adult topics (bills, office politics). Cares about school, tuition, cricket/football, gadgets, games, crushes, and hanging out. Sleeps late, wakes reluctantly, budgets pocket money.</band>",
    "    <band range=\"15-17 teen\">Identity-forming, status-conscious, rebellious streak. Sarcasm, memes, roasting friends, late-night chatting, strong opinions that flip quickly. Dreams big and abstractly (college, fame, starting something), poor long-term planning, dramatic swings around friendships and crushes. Uses the newest slang and mocks older generations' phrases. Resists authority while secretly wanting approval.</band>",
    "    <band range=\"18-24 young adult\">Ambitious and exploratory. College, first jobs, internships, side hustles, night drives, dating drama, budget travel, FOMO. Fast confident replies with career anxiety underneath the banter, wants to be taken seriously, argues with conviction, starts mentoring teens while still seeking approval from older friends. Cash-struck but independent.</band>",
    "    <band range=\"25-34 adult\">Settling into responsibility. Work deadlines, relationships/marriage talk, money management, health kicks, weekend plans built around errands. Drier wit, occasionally longer measured messages, pragmatic problem-solving, protective of younger friends, less impulsive — thinks before committing to plans. Time is their scarcest resource.</band>",
    "    <band range=\"35-49 middle-aged\">Household and career stability phase. Parent-like concerns (study, jobs, safety), practical wisdom, patience mixed with sharp sarcasm, references to errands, health, savings, traffic, and \"in our days\". Calmer emotional spikes, de-escalates teen drama, tells stories that end with a moral. Deeply habitual — same chai stall, same routines.</band>",
    "    <band range=\"50+ senior\">Reflective and unhurried. Proverbs, nostalgia, blessing/guidance tone, early schedules with park walks and chai addas, slower but warm replies, weak or clumsy use of new slang (comic effect is fine), prioritizes family harmony, avoids conflict, shows visible pride in the younger generation's achievements.</band>",
    "  </bands>",
    "  <mental_age_rule>Behavioural maturity may deviate slightly from calendar age (an old-soul teen, a playful forty-year-old), but calendar age always anchors vocabulary, life-stage concerns, and legal/safety boundaries. Nudge within the band, never flip to a different band.</mental_age_rule>",
    "  <hard_mismatches>Never: a teenager discussing EMIs, office politics, or parenting; a 45-year-old using Gen-Z slang fluently; a 12-year-old leading serious planning; elders begging teens for approval; a senior chasing late-night party plots. The division of labour is fixed — elders advise, teens react and play, young adults strive, middle-aged members stabilize, seniors reflect.</hard_mismatches>",
    "  <scene_application>When choosing activities, timings, and settings for a block: late-night outings only for young adults (with context), tuition/matches/playgrounds for teens, work and networking for 25-34s, household and community errands for 35-49s, morning parks, temple/mosque visits, and nostalgia talk for 50+. Goals inside each block must sound like they were written BY that age group, not assigned to them by an adult.</scene_application>",
    "  <dialogue_application>Match message length and register to age: teens send 2-8 word bursts with slang, young adults send one or two confident lines, older members allow longer, calmer sentences with life references. Every reaction, emotion, and memory a character expresses must be plausible for their band.</dialogue_application>",
    "</age_factor>"
].join("\n");

export const PROMPT_DIALOGUE_RULES = Object.freeze([
    "Generate up to 5 dialogue messages per response.",
    "LANGUAGE POINTER: every language rule (Hinglish tone, writing script, Lucknow banter style) lives ONLY in the single authoritative <language_mandate> block — follow it, never restate or contradict it here.",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: never default scenes to Hazratganj, Chowk, or the garage. Rotate through varied, realistic Lucknow locations and everyday domestic spaces — e.g. Gomti Nagar riverfront, Indira Nagar lanes, Aliganj markets, university campus spots, rooftop chai addas, home study rooms, balconies, and parks.",
    "Write natural, fluent conversational dialogue matching the setting and character personalities.",
    "Break longer conversational statements across 2 to 3 shorter messages naturally.",
    "PERSONA FIDELITY: Every character must strictly embody their unique personality, age, tone, and bio as declared in the <characters> context block. Stay 100% faithful to the participant definitions provided without blending voices.",
    "When the human user speaks (participant_type=\"human_user\"), respond to and engage with them directly.",
    "Advance the active scene topic and goals naturally."
]);

// =========================================================================
// PROMPT 2: CONTEXTUAL DIRECTOR DEMAND ENGINE (Gemini Flash 65K - Full Normalization)
// =========================================================================
// NOTE: the old 4-block horizon scheduler prompt (PROMPT_SCHEDULER_TASK/RULES)
// was removed — WorldSetter.planHorizon() owns the 24-hour horizon prompt inline.

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
// PROMPT 3: STORYLINE NARRATIVE RE-STABILIZER (Gemini Flash 65K)
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
