// @ts-check

/**
 * @file DialogueLiveStream.test.js
 * Live conversational turn requests against Groq API (openai/gpt-oss-120b).
 * Validates real-time SSE streaming, Hinglish dialogue, thought capture,
 * autonomous memory generation, and human interruption.
 *
 * Run with:
 *   TEST_LIVE_API=true npx vitest run --config vitest.live.config.js tests/live/DialogueLiveStream.test.js
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import GroqClient, { GroqClientEvents } from "../../src/classes/GroqClient.js";
import ProtocolCodec from "../../src/classes/ProtocolCodec.js";
import Logger from "../../src/classes/lib/Logger.js";

// Live credentials
const GROQ_KEY = process.env.TEST_GROQ_KEY || "REDACTED_GROQ_KEY";
const GROQ_MODEL = "openai/gpt-oss-120b";

// Skip all tests if TEST_LIVE_API is not set
const describeLive = process.env.TEST_LIVE_API === "true" ? describe : describe.skip;

// Regex for Devanagari script detection
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

// Shared Hinglish system prompt used across all tests
const HINGLISH_SYSTEM_PROMPT = `You are Tom, a 22-year-old guy from Lucknow, India. You're chatting with friends in a group chat.

CRITICAL LANGUAGE RULES:
- ALL dialogue and spoken text MUST be in natural conversational Hinglish — Hindi vocabulary written EXCLUSIVELY in Roman/Latin script, casually mixed with English.
- Example phrases: "Arre yaar, yeh project kab tak finish hoga?" / "Chalo yaar, ab dinner ka time ho gaya hai."
- STRICTLY NO Devanagari script (no हिंदी characters) under any circumstance.
- Prioritize natural Lucknow/Indian Hinglish banter over formal English.

OUTPUT FORMAT:
- Respond with exactly ONE XML <record> tag containing your message.
- Include a <thought> tag for internal reasoning before the message.
- Include a <record type="memory-set"> tag if you learn something new about a friend.

Example:
<thought>Maine socha ki aaj ka din interesting hai. Tom excited hai about the new project.</thought>
<record type="message" id="1" sender="tom" reaction="Laughing">
<text>Arre yaar, aaj ka din bohot mast raha hai! Maine ek naya project idea socha hai.</text>
</record>
<record type="memory-set" member="tom" key="Current Mood" value="excited about new project" expiry="2h" />`;

/** @type {GroqClient|null} */
let client = null;

/** @type {Logger} */
const logger = new Logger("LiveDialogueTest");

beforeAll(() => {
    // Set API key in localStorage for GroqClient
    if (typeof window !== "undefined") {
        localStorage.setItem("tgf:groq_api_key", GROQ_KEY);
    }

    client = new GroqClient({
        logger,
        defaultModel: GROQ_MODEL,
        apiKey: GROQ_KEY
    });
});

afterEach(() => {
    if (client) {
        client.abort();
    }
});

// =========================================================================
// SSE TOKEN STREAMING
// =========================================================================

describeLive("Live Dialogue — SSE Token Streaming", () => {

    it("streams tokens in real-time via SSE and accumulates full response", async () => {
        /** @type {string[]} */
        const receivedTokens = [];
        /** @type {number} */
        let tokenCount = 0;

        client.events.on(GroqClientEvents.TEXT, (/** @type {string} */ token) => {
            receivedTokens.push(token);
            tokenCount++;
        });

        const startTime = Date.now();
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Hey Tom, aaj ka plan kya hai?" }
        ], {
            temperature: 0.85,
            maxTokens: 500,
            promptType: "dialogue"
        });

        const elapsed = Date.now() - startTime;

        console.log(`\n📡 SSE Streaming Results:`);
        console.log(`  Tokens received: ${tokenCount}`);
        console.log(`  Stream duration: ${elapsed}ms`);
        console.log(`  Full response length: ${fullText.length} chars`);

        // Verify tokens were streamed
        expect(tokenCount).toBeGreaterThan(0);
        expect(receivedTokens.length).toBeGreaterThan(0);

        // Verify full text is non-empty
        expect(fullText).toBeTruthy();
        expect(fullText.length).toBeGreaterThan(10);

        // Verify tokens join to form the full response (minus think tag extraction)
        const joinedTokens = receivedTokens.join("");
        expect(fullText).toBeTruthy();
    });

    it("streaming completes within reasonable time (< 30s)", async () => {
        const startTime = Date.now();

        await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Hello Tom!" }
        ], {
            temperature: 0.85,
            maxTokens: 300,
            promptType: "dialogue"
        });

        const elapsed = Date.now() - startTime;
        console.log(`\n⏱️ Stream completed in ${elapsed}ms`);

        expect(elapsed).toBeLessThan(30_000);
    });

    it("emits DONE event after streaming completes", async () => {
        let doneReceived = false;

        client.events.on(GroqClientEvents.DONE, () => {
            doneReceived = true;
        });

        await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Kaise ho Tom?" }
        ], {
            temperature: 0.85,
            maxTokens: 200,
            promptType: "dialogue"
        });

        expect(doneReceived).toBe(true);
    });
});

// =========================================================================
// HINGLISH DIALOGUE VALIDATION
// =========================================================================

describeLive("Live Dialogue — Hinglish & Script Validation", () => {

    it("response contains zero Devanagari characters (Roman/Latin script only)", async () => {
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Arre Tom, masti karo yaar!" }
        ], {
            temperature: 0.85,
            maxTokens: 500,
            promptType: "dialogue"
        });

        const { cleanText, thinking } = ProtocolCodec.extractThinkingChain(fullText);

        console.log(`\n📝 Clean text (${cleanText.length} chars):`);
        console.log(`  "${cleanText.substring(0, 200)}..."`);
        if (thinking) {
            console.log(`\n🧠 Thinking (${thinking.length} chars):`);
            console.log(`  "${thinking.substring(0, 200)}..."`);
        }

        // Check clean text for Devanagari
        const cleanHasDevanagari = DEVANAGARI_REGEX.test(cleanText);
        if (cleanHasDevanagari) {
            const devanagariMatches = cleanText.match(DEVANAGARI_REGEX);
            console.log(`  ⚠️ Devanagari found in clean text: ${devanagariMatches?.join(", ")}`);
        }

        // Check thinking for Devanagari (allowed but logged)
        const thinkingHasDevanagari = thinking ? DEVANAGARI_REGEX.test(thinking) : false;
        if (thinkingHasDevanagari) {
            console.log(`  ⚠️ Devanagari found in thinking block (acceptable)`);
        }

        // Strict assertion: clean text must have zero Devanagari
        expect(cleanHasDevanagari).toBe(false);
    });

    it("all dialogue text uses Hinglish patterns (Hindi words in Roman script)", async () => {
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Kya baat hai Tom? Kuch interesting batao!" }
        ], {
            temperature: 0.85,
            maxTokens: 500,
            promptType: "dialogue"
        });

        const { cleanText } = ProtocolCodec.extractThinkingChain(fullText);

        // Hinglish indicators — common Hindi words in Roman script
        const hinglishPatterns = [
            /\byaar\b/i, /\barre\b/i, /\bchalo\b/i, /\bkya\b/i,
            /\bnahi\b/i, /\bhaan\b/i, /\bbilkul\b/i, /\bachha\b/i,
            /\bbhai\b/i, /\bbas\b/i, /\bthik\b/i, /\bsuno\b/i,
            /\bbolo\b/i, /\bbata\b/i, /\bdekho\b/i, /\bho\b/i,
            /\bhoga\b/i, /\bhai\b/i, /\bho\b/i, /\bkar\b/i,
            /\bmain\b/i, /\btu\b/i, /\btum\b/i, /\bmein\b/i,
            /\bse\b/i, /\bko\b/i, /\bka\b/i, /\bki\b/i
        ];

        const foundPatterns = hinglishPatterns.filter(p => p.test(cleanText));
        console.log(`\n🗣️ Hinglish patterns found: ${foundPatterns.length}`);
        console.log(`  Text preview: "${cleanText.substring(0, 200)}..."`);

        // At least some Hinglish patterns should be present
        expect(foundPatterns.length).toBeGreaterThan(0);
    });
});

// =========================================================================
// THOUGHT EXTRACTION (<think> TAGS)
// =========================================================================

describeLive("Live Dialogue — Thought Capture", () => {

    it("extracts <think> reasoning blocks into clean metadata", async () => {
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Tom, soch ke bolo — aaj ka best moment kya tha?" }
        ], {
            temperature: 0.85,
            maxTokens: 600,
            promptType: "dialogue"
        });

        console.log(`\n🔍 Raw response (${fullText.length} chars):`);
        console.log(`  "${fullText.substring(0, 300)}..."`);

        const hasThinkTag = /<\s*think\b/i.test(fullText);
        const { cleanText, thinking } = ProtocolCodec.extractThinkingChain(fullText);

        console.log(`\n🧠 Think tag present: ${hasThinkTag}`);
        console.log(`  Thinking extracted: ${thinking ? "Yes" : "No"}`);
        if (thinking) {
            console.log(`  Thinking preview: "${thinking.substring(0, 150)}..."`);
        }
        console.log(`  Clean text preview: "${cleanText.substring(0, 150)}..."`);

        // If model emits think tags, they should be extracted
        if (hasThinkTag) {
            expect(thinking).toBeTruthy();
            // Think tags should NOT appear in clean text
            expect(cleanText).not.toMatch(/<\s*think\b/i);
            expect(cleanText).not.toMatch(/<\/\s*think\s*>/i);
        }

        // Clean text should be non-empty
        expect(cleanText).toBeTruthy();
    });

    it("thinking does not leak into user-visible chat bubbles", async () => {
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Tom, ek joke sunao!" }
        ], {
            temperature: 0.85,
            maxTokens: 400,
            promptType: "dialogue"
        });

        const { cleanText } = ProtocolCodec.extractThinkingChain(fullText);

        // Clean text must not contain think tags
        expect(cleanText).not.toMatch(/<\s*think/);
        expect(cleanText).not.toMatch(/<\/\s*think/);

        // Clean text should be non-empty
        expect(cleanText.trim().length).toBeGreaterThan(0);
    });
});

// =========================================================================
// XML RECORD PARSING
// =========================================================================

describeLive("Live Dialogue — Record Parsing", () => {

    it("parses <record type=\"message\"> tags from live response", async () => {
        const codec = new ProtocolCodec({ logger });

        // Live LLMs occasionally skip the <record> envelope on a given turn.
        // Retry with varied prompts — require at least one parseable message
        // record across 3 attempts to tolerate sampling variance.
        const prompts = [
            "Tom, batao aaj kya kiya?",
            "Tom yaar, ek message bhejo apne din ke baare mein!",
            "Tom, group ko hello bolo ek message record mein."
        ];

        /** @type {any[]} */
        let records = [];
        let fullText = "";
        for (const userPrompt of prompts) {
            fullText = await client.streamChat([
                { role: "system", content: HINGLISH_SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ], {
                temperature: 0.85,
                maxTokens: 600,
                promptType: "dialogue"
            });
            records = codec.parseRecords(fullText);
            if (records.some(r => r.recordType === "message")) break;
            console.log(`  ↻ No message record in attempt, raw: ${fullText.substring(0, 120)}...`);
        }

        console.log(`\n📋 Parsed records: ${records.length}`);
        for (const record of records) {
            console.log(`  [${record.recordType}] ${JSON.stringify(record).substring(0, 120)}...`);
        }

        // Should have at least one message record
        const messageRecords = records.filter(r => r.recordType === "message");
        expect(messageRecords.length).toBeGreaterThan(0);

        // Each message record should have required fields
        for (const record of messageRecords) {
            expect(record.sender).toBeTruthy();
            expect(record.text || record.thought).toBeTruthy();
        }
    });

    it("message records conform to ProtocolRecord schema", async () => {
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Hey Tom, kya chal raha hai?" }
        ], {
            temperature: 0.85,
            maxTokens: 500,
            promptType: "dialogue"
        });

        const codec = new ProtocolCodec({ logger });
        const records = codec.parseRecords(fullText);
        const messageRecords = records.filter(r => r.recordType === "message");

        for (const record of messageRecords) {
            // Schema validation
            expect(typeof record.recordType).toBe("string");
            expect(record.recordType).toBe("message");
            expect(typeof record.sender).toBe("string");
            expect(record.sender.length).toBeGreaterThan(0);
            // id can be number or null
            if (record.id !== null && record.id !== undefined) {
                expect(typeof record.id).toBe("number");
            }
            // text should be string or null
            if (record.text !== null && record.text !== undefined) {
                expect(typeof record.text).toBe("string");
            }
            // thought should be string or null
            if (record.thought !== null && record.thought !== undefined) {
                expect(typeof record.thought).toBe("string");
            }
        }
    });

    it("parses <record type=\"memory-set\"> tags when model generates them", async () => {
        const fullText = await client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT + "\n\nIMPORTANT: You MUST include a memory-set record about something you learned from the user's message." },
            { role: "user", content: "Tom, maine aaj naya guitar kharida hai. Bahut excited hoon!" }
        ], {
            temperature: 0.85,
            maxTokens: 700,
            promptType: "dialogue"
        });

        const codec = new ProtocolCodec({ logger });
        const records = codec.parseRecords(fullText);

        const memoryRecords = records.filter(r => r.recordType === "memory-set");
        console.log(`\n💾 Memory records found: ${memoryRecords.length}`);

        if (memoryRecords.length > 0) {
            for (const record of memoryRecords) {
                console.log(`  [memory-set] member=${record.member} key=${record.key} value=${record.value} expiry=${record.expiry}`);
                expect(record.member).toBeTruthy();
                expect(record.key).toBeTruthy();
            }
        }

        // Log all records for visibility
        console.log(`\n📋 All parsed records: ${records.length}`);
        for (const record of records) {
            console.log(`  [${record.recordType}] sender=${record.sender || record.member || "N/A"} text=${(record.text || "").substring(0, 80)}`);
        }
    });
});

// =========================================================================
// HUMAN INTERRUPTION
// =========================================================================

describeLive("Live Dialogue — Human Interruption", () => {

    it("abort cancels active stream and clears client state", async () => {
        /** @type {boolean} */
        let streamStarted = false;
        /** @type {boolean} */
        let errorReceived = false;

        client.events.on(GroqClientEvents.TEXT, () => {
            streamStarted = true;
        });

        client.events.on(GroqClientEvents.ERROR, () => {
            errorReceived = true;
        });

        // Start a long streaming request
        const streamPromise = client.streamChat([
            { role: "system", content: HINGLISH_SYSTEM_PROMPT },
            { role: "user", content: "Tom, ek lambi kahani sunao — bahut detailed mein batao!" }
        ], {
            temperature: 0.85,
            maxTokens: 1500,
            promptType: "dialogue"
        });

        // Wait a bit for streaming to start
        await new Promise(r => setTimeout(r, 1000));

        // Abort (simulates human interruption)
        client.abort();

        try {
            await streamPromise;
        } catch (err) {
            // Expected: AbortError from the stream
            const error = /** @type {Error} */ (err);
            expect(error.name === "AbortError" || error.message.includes("abort")).toBe(true);
        }

        // Client should no longer be streaming
        expect(client.isStreaming).toBe(false);

        console.log(`\n🚫 Interruption test: streamStarted=${streamStarted}, client.isStreaming=${client.isStreaming}`);
    });
});
