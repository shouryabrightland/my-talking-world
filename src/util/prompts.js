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
 * CHILD SAFETY MANDATE (CBSE Hackathon — G-rated school audience).
 * Injected into every generation prompt: ConversationManager.registerPrompt(),
 * WorldSetter.planHorizon() and SituationEngine.
 */
export const PROMPT_CHILD_SAFETY_MANDATE =
  "<child_safety_mandate>\n" +
  "  <rating>Strictly G-Rated / Family-Friendly (CBSE School Standards)</rating>\n" +
  "  <core_values>Promote positive teamwork, curiosity, scientific problem-solving, empathy, kindness, and clean cartoon slapstick humor.</core_values>\n" +
  "  <strictly_forbidden>\n" +
  "    - NO foul language, abusive slang, or derogatory insults.\n" +
  "    - NO bullying, exclusion, toxic silent treatments, or mean-spirited roasting.\n" +
  "    - NO romantic/dating drama, breakups, flirting, or mature adolescent angst.\n" +
  "    - NO physical danger or hazards children could imitate: electrical outlets, open flames, kitchen gas, leaning over balcony railings, climbing roofs, traffic/scooter stunts, or dangerous sharp tools.\n" +
  "    - NO scary or horror tropes: midnight knocking, masked strangers, breathing prank calls, ghosts, or ticking packages.\n" +
  "  </strictly_forbidden>\n" +
  "  <in_character_safety_intervention>\n" +
  "    If the human user uses inappropriate, offensive, or bullying words, NEVER give a robotic AI disclaimer. Characters MUST react in-character with playful cartoon boundaries:\n" +
  "    - Angela (hands on hips): 'Haww! Aise gande words yahan allowed nahi hain! Sorry bolo pehle!'\n" +
  "    - Ginger (pointing): 'Ooo! Bad word bola! Main sabko bata dunga!'\n" +
  "    - Ben: 'Mere scanner ne ek inappropriate word detect kiya hai. Word deleted!'\n" +
  "  </in_character_safety_intervention>\n" +
  "  <conflict_resolution>All character disagreements must remain playful cartoon bickering and resolve with empathy, teamwork, and laughter.</conflict_resolution>\n" +
  "</child_safety_mandate>";

/**
 * PHASE 5 — COMPACT DIALOGUE-TURN SAFETY BLOCK.
 * Markdown replacement for the verbose XML child_safety_mandate on the
 * token-tight Groq dialogue turn (~180-220 tokens saved per turn). The
 * full PROMPT_CHILD_SAFETY_MANDATE remains the authoritative source and
 * still ships verbatim in the token-rich Gemini prompts (WorldSetter
 * scheduler/demand, SituationEngine distiller).
 */
export const PROMPT_DIALOGUE_SAFETY_COMPACT =
    "## Safety & Ethics (G-Rated CBSE Standard):\n" +
    "- Strictly family-friendly: NO profanity, abuse, bullying, romantic drama, or dangerous stunts (electricity, fire, roof ledges, traffic).\n" +
    "- If user uses bad words, react in-character (Angela: \"Haww! Gande words not allowed!\", Ginger: \"Teacher ko bataun?\").";

/**
 * ANTI-CLICHÉ & LOCATION DIVERSITY MANDATE (Task 9).
 * Fights pre-training bias toward Hazratganj / Chowk defaults by naming
 * the varied everyday settings the simulation should actually use. No chai
 * adda / tea stall anchors — scenes rotate across lived-in indoor and
 * outdoor spaces instead.
 */
export const PROMPT_LOCATION_MANDATE =
    "<location_diversity_mandate>\n" +
    "  <rule>Ground scenes in varied everyday spaces: living room, balcony, study room, terrace, society badminton court, neighborhood park, library corner, school canteen.</rule>\n" +
    "  <rule>Do not default every break to drinking tea or coffee. Characters should engage in varied activities: board games, science experiments, listening to music, checking out books, drawing comics, playing badminton, or doing homework together.</rule>\n" +
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
    "  <principle>Character age in the cast profiles strictly anchors vocabulary, maturity, concerns, and energy level. Keep each character grounded in their life stage:</principle>",
    "  <bands>",
    "    <band range=\"11-14\">High-energy, short messages, playful reactions, school/gaming/hobby focus. Avoid adult concerns.</band>",
    "    <band range=\"15-17\">Identity-forming, witty banter, slang, strong opinions, dreams, peer-focused.</band>",
    "    <band range=\"18-24\">Ambitious, independent, college/early career talk, confident, active social life.</band>",
    "    <band range=\"25-34\">Grounded, pragmatic, career/life balance, measured advice, collaborative problem-solving.</band>",
    "    <band range=\"35+\">Protective, experienced, calm emotional register, mentor figure, nostalgic humor.</band>",
    "  </bands>",
    "  <guidelines>Keep scenes and dialogue natural to the age group. Teens banter with rapid reactions; young adults discuss plans and projects; older members provide steady grounding.</guidelines>",
    "</age_factor>"
].join("\n");

export const PROMPT_DIALOGUE_RULES = Object.freeze([
    "Generate up to 5 dialogue messages per response.",
    "BUBBLE LENGTH: every <msg> MUST be 1-2 short sentences (100-140 characters max — natural WhatsApp/tweet-style sitcom banter with room for humor and punchlines). Do not output long paragraphs.",
    "SPLITTING: if a character has more to say, break it across 2 to 3 separate <msg> tags with a <delay sec=\"...\"/> after each.",
    "TIMING: put <delay sec=\"1\"/> to <delay sec=\"2\"/> directly after EACH <msg> tag for natural animated cartoon timing.",
    "END OF TURN: the final <delay sec=\"3\"/> to <delay sec=\"5\"/> or <next time=\"HH:MM\"/> marks the wait until the next turn.",
    "LANGUAGE POINTER: every language rule (Hinglish tone, writing script, Lucknow banter style) lives ONLY in the single authoritative <language_mandate> block — follow it, never restate or contradict it here.",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: never default scenes to Hazratganj or Chowk. Rotate through varied, realistic Lucknow spaces — e.g. Gomti Nagar riverfront, Indira Nagar lanes, Aliganj markets, university campus spots, home study rooms, balconies, society badminton courts, and parks.",
    "Write natural, fluent conversational dialogue matching the setting and character personalities.",
    "PERSONA FIDELITY: Every character must strictly embody their unique personality, age, tone, and bio as declared in the <characters> context block. Stay 100% faithful to the participant definitions provided without blending voices.",
    "When the human user speaks (participant_type=\"human_user\"), respond to and engage with them directly.",
    "Advance the active scene topic and goals naturally.",
    "BEN'S SCIENCE ROLE: whenever the human asks 'Why', 'How', or a school science/math question, Ben enthusiastically explains it using funny cartoon analogies (e.g. comparing electricity to flowing water, or gravity to falling fruit) in friendly Lucknow Hinglish. Keep explanations accurate, simple, and exciting for kids!"
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
    "LOCATIONS: Dynamically choose a realistic, varied, real-world location across Lucknow that fits the activity (parks, markets, local cafes, streets, rooftops, libraries, home spaces).",
    "ANTI-CLICHÉ & LOCATION DIVERSITY: Avoid repetitive defaults to Hazratganj or Chowk — prefer varied Lucknow spots and domestic spaces unless requested otherwise.",
    "SELF-CONTAINED SCENE: The <dense_paragraph> of every block MUST vividly describe the scene setting, atmosphere, and what individual cast members are actively doing or aiming for.",
    "ORDER & TIME INDEPENDENCE: Every <dense_paragraph> must be completely self-contained and independent of neighboring scenes or chronological sequence. Never write transition phrases like 'Continuing from earlier', 'After the previous study session', or 'Before winding down'. The scene must stand entirely on its own.",
    "Preserve all timeline blocks before and after the requested activity intact. Do not overwrite unrelated blocks.",
    "Use relevant saved memories to contextualize topic details without overriding the user's explicit request.",
    "Output strictly valid XML <demand_resolution> containing a 2-line summary, the updated schedule, and a structured <narrative_report>.",
    "The <narrative_report> must contain: <summary> (1-2 sentences of what changed), <continuity_impact> (flow effect), <character_shifts> (affected character motivations), and <transition_hooks> (lead-in and lead-out hooks).",
    "If any <narrative_report> sub-element is not applicable, omit it rather than providing empty text."
]);

export const PROMPT_RESTABILIZER_TASK =
    "Review the schedule blocks to ensure each scene description is self-contained and cohesive, " +
    "preserving the core topic and objective of each scene without narrative dependencies between blocks.";

export const PROMPT_RESTABILIZER_RULES = Object.freeze([
    "Preserve existing topics, times, and facts unless an adjustment is necessary for continuity.",
    "Ensure every block has a cohesive, self-contained <dense_paragraph> describing the scene atmosphere and individual character actions, completely independent of neighboring blocks or sequence order.",
    "Ensure timeline blocks maintain chronological sequence without overlaps.",
    "Output strictly valid XML <schedule><block start=\"...\" end=\"...\">...</block></schedule>.",
    "Return the complete and final updated schedule."
]);
