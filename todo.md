# TODO — session checkpoint (handoff)

> Context dump for continuing this task. Read this first after resuming.
> Last updated: 2026-10-08 (session COMPLETE — all issues committed, all gates green).

## Goal / Definition of done — ✅ ALL GREEN

```bash
npx tsc --noEmit      # ✅ 0 errors
npm run test          # ✅ 371/371 pass (32 files) — zero failures
npm run build         # ✅ exit 0 (589 kB chunk >500 kB warning is expected/ok)
npx eslint .          # ✅ changed files clean
```

Commits follow conventional style, one issue per commit, footer:
```
🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
```
**User rule: commit after EACH completed issue (rollback safety).**

---

## ✅ Committed this session (in order)

| Commit | Issue |
|---|---|
| `4527103` | `fix(types)`: cleared all 48 pre-existing tsc errors (JSDoc in GroqClient, GroqModelPool, ConversationManager, DevToolsContext). `tsc` now exits 0. |
| `40f1ee1` | `fix(environment)`: **Calendar Bharat API never added events** — live payload nests `{year:{month:{day:{event,type,extras}}}}` but parser expected flat `{month:{YYYY-MM-DD:{name}}}`. Parser now walks all month blocks, parses both key formats, matches today by date, lists only future festivals nearest-first. MSW fixture updated to live shape + `tests/util/environment.test.js` (4 regression tests). |
| `6ea0597` | `fix(memory)`: duplicate React key `india` on Settings→Compress — `syncEnvironment` news tags duplicated when headline contains "India". Deduped via Set; Settings tag chips keyed `${entry.id}-${tag}`. |
| `aec211e` | `fix(situation)`: double AbortError warning at boot — World READY listener AND `init()` both fired the forced situation pass; overlapping passes shared ONE `GeminiClient.abortController`. Fixed: `executeIfDue` single-flight EVEN when forced; GeminiClient only cleans up its OWN controller. Regression test added. |
| `bcc0539` | `feat(routing)`: app at `/`, presentation at `/presentation` via react-router (`BrowserRouter` in `src/main.jsx`; `Studio` = old App body; `PresentationRoute`; `?presentation=true` redirect; `*` → `/`; `tgf:open-presentation` event → navigate). |
| `7e355af` | `docs(todo)`: this checkpoint file. |
| `aa578d0` | `feat(presentation)`: single-phone exploded-layer scrollytelling — `PRESENTATION_LAYERS` (11 steps), one sticky stage, 9 slabs (`slab-0..8`) driven by custom prop `--t` (no React re-render per frame), jump dots/keyboard, `Enter Live Studio` CTA. Tests 10/10. |
| `5d8b74b` | `fix(memory)`: Compress Stack actually shrinks — `compressIfExceeded(gemmaClient, force=false)` (Settings button passes `force=true`, auto-call stays budget-gated); acceptance guard keeps original stack unless output has fewer records AND fewer chars; drops schema-example echoes; `compressUnifiedMemory` returns `compressed|skipped|error` with MEMORY_COMPRESS_ERROR on no-shrink; Settings maps `busy`→`skipped`. |
| `c4f3428` | `feat(memory)`: SituationEngine can delete stale records — numbered snapshot in prompt, `<deletions><delete index="N"/></deletions>` parsed and removed id-based (`unifiedMemory.remove(target.id)`), exact-duplicate `<memory>` adds skipped. |
| `473535e` | `fix(tests)`: last 6 pre-existing failures (5 GroqClient + 1 apiKeys) — expectations aligned with intended architecture: pool ≥12B restriction (4 survivors: `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `qwen/qwen3.6-27b`, `mixtral-8x7b-32768`), GroqClient has NO `defaultModel` (pin model per request via `streamChat(..., { model })`), `verifyApiKey` probes via single `GET /openai/v1/models` (test asserts method, ≥12B filtering, no non-chat models). |
| `0691a72` | `docs(todo)`: checkpoint marked complete. |
| `0cd9839` | `feat(dialogue)`: **Needle listens to the recent chat** (human message leads the query; autonomous turns route too) + **human-message priority**: prompt `## Turn Priority` ladder + trailing `## The Human Just Said` block + SituationEngine `latestHumanMessage` ctx & PRIORITY rule. Prompt budget held at 637/650 via prose trims. |
| `31f08cd` | `feat(presentation)`: **cinematic 3D** — canvas starfield (warp burst per step), pointer parallax, scroll `--pulse` zoom + `--sway` yaw on the phone, 3D screen swaps, sheen sweep, vignette, blur-in captions, prefers-reduced-motion guard. |
| `a4f3be2` | `feat(memory)`: planner's future schedule blocks → UnifiedMemory (`syncPlannerScenes`, tags planner/schedule/future, replaces on re-sync, skips ended blocks) wired to World READY + SCHEDULE_CHANGE so characters see upcoming events via Needle → Active Memories. |
| `de4f7a9` | `feat(presentation)`: **true 3D chassis** (extrusion backplate/mid-frame translateZ, isometric base angle, levitate, glare, status bar — reference: `7ac1b62` "intermidiate") + **animated SVG flowchart screens** replacing all text blocks (pulse wires, timeline swap, brain feed, router fan-out, crossed server, speaker waves, shield ricochet, gauge needles). Background starfield kept. |
| `f7a4992` | `fix(presentation)`: **user reported the pitch broken** (img/1.png) — rebuilt as ONE solid phone (bezel + island + screen) whose screen swaps per step (home on intro/finale, 9 widgets for layers) instead of exploding slabs. Root cause of the width break: `#root` in theme.css is `display:flex; justify-content:center` → the scroller shrink-wrapped to content (958px on 1920). Fixed with `width:100%` + `svh` units matching the global URL-bar lock; responsive ≤980px = 2-row HUD + bottom-overlay caption; jumps land mid-band (t=i+0.5) against scrollTop rounding; `.homeFace` 46px box (Avatar is 100%×100%). Tests rewritten to new contract (10/10); verified via Playwright screenshots at 1920/1366/768/390/360. |

---

## Verification transcript (final run)

```
npx tsc --noEmit                       → 0
npx eslint <changed files>             → 0
npx vitest run                         → 32 files, 371 tests, all passed
npm run build                          → ✓ built in 429ms (exit 0)
```

## No pending work

Everything in the original backlog (Pending B test fixes, presentation, compress,
situation deletions, routing, types, environment, React key) is committed.

---

## Quick architecture notes

- `conv` = ConversationManager via `useChat()`; `conv.unifiedMemory` is the single memory
  store; `world.unifiedMemory` mirrors it.
- UnifiedMemory entry: `{id, datetime: "YYYY-MM-DD HH:mm", tags: string[], data, expiry}`
  where expiry ∈ `"forever" | "15m" | "1h" | "24h" | "7d" | ISO`; budget 20,000 chars.
- Memory writes: SituationEngine (Tier-2 extraction, can also DELETE by snapshot index),
  Settings manual add, `syncEnvironment` (weather/news, replaces env+news tags each time).
- Compression: Settings button (`compressUnifiedMemory` → `force=true`) + auto after each
  SituationEngine pass (`compressIfExceeded(geminiClient)` budget-gated at 20k). Acceptance
  guard: model output must be fewer records AND fewer chars or original stack is kept.
- Settings tabs: `SettingsTab = "general" | "cast" | "memory"`; compress status strings
  `running|compressed|skipped|failed` (SettingsModal `compressStatusText`).
- Routing: `react-router` v7 (`BrowserRouter` in main.jsx; `Studio` = app;
  `PresentationRoute` at `/presentation`).
- Groq pool: text chat models ≥12B only; ladder order `openai/gpt-oss-120b` →
  `llama-3.3-70b-versatile` → `qwen/qwen3.6-27b` → `mixtral-8x7b-32768`.
- `verifyApiKey` = single `GET /openai/v1/models` (validates key + discovers ladder).
- Tests: `vitest.config.js` excludes `tests/e2e/**` and `tests/live/**`;
  `npx tsc` only checks `src/` (tsconfig include).
- Presentation exports `PRESENTATION_LAYERS` (used only by its own tests).

## User decisions this task (do not re-ask)
1. Posture/prop tag dropped as residue; `memory-set` protocol removed; `world.memory` deleted.
2. Dead files `deley.js` + `mocks/browser.js` deleted (commit `7dd725d`).
3. Cast Profiles: AI names locked; human edits own display name.
4. Compress progress shows in the Background Bar (MEMORY_COMPRESS_* events).
5. **Commit after every completed issue** (rollback checkpoints).
6. Presentation: single phone, layers revealed one-by-one ("bifurcating"), SBS The Boat-level
   dynamism, self-explanatory visuals, separate URL route (done via react-router).
7. Old commits contain NO phone visual (only "EXPLODED LAYER" caption tags in the
   pre-`ad275e5` acts version) — the new phone design is original.
8. Test updates only when source behavior is the intended new architecture; never weaken
   assertions (applied in `473535e`).
