# 🎬 Tom & Friends

**A Living AI Studio where autonomous characters chat, plan, and react to real-world events in real-time.**

Tom & Friends is an AI-powered group chat simulation set in a Lucknow garage studio. Six distinct AI characters — Tom, Angela, Ben, Ginger, Hank, and Becca — autonomously converse, form memories, follow dynamic storylines, and respond to your inputs as a human participant or invisible director.

---

## 🧩 Table of Contents

- [The Problem](#-the-problem)
- [The Solution](#-the-solution)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Project Timeline](#-project-timeline)
- [Testing & CI](#-testing--ci)
- [Project Structure](#-project-structure)
- [License](#-license)

---

## 🔴 The Problem

Building a believable, living AI group chat faces several fundamental challenges:

1. **Single-model monotony.** Most AI chat apps use one model for everything — dialogue, planning, and reasoning. This creates flat, homogeneous responses with no sense of autonomy or personality divergence.

2. **No real-world grounding.** AI characters typically have no awareness of what's happening outside the chat — weather, festivals, news, time of day — making conversations feel detached from reality.

3. **No temporal structure.** Without a storyline engine, AI characters have no concept of what they should be doing at any given hour. They react passively instead of proactively driving scenes forward.

4. **Memory amnesia.** Most chat systems forget everything between sessions. Characters can't remember what happened yesterday, what posture someone is in, or what their friend whispered to them.

5. **No user agency.** Users can chat, but they can't steer the direction of the story, inject plot twists, or restructure the timeline — they're locked into a single interaction mode.

6. **Fragile pipelines.** AI APIs are unreliable — rate limits, model outages, and network failures break single-provider systems. There's no graceful degradation or crash recovery.

---

## 🟢 The Solution

Tom & Friends solves these problems through a **hybrid dual-AI architecture** with real-world environmental grounding, autonomous memory, and a 24-hour storyline scheduler.

| Problem | Solution |
|---------|----------|
| Single-model monotony | **Dual-provider engine** — Groq powers instant live banter (sub-second), Gemini Flash 65K handles long-context schedule planning and director demands |
| No real-world grounding | **Live environment context** — Open-Meteo weather, Calendar Bharat festivals, and Google News RSS headlines are injected into every AI prompt |
| No temporal structure | **24-Hour Storyline Planner** — Gemini generates hourly schedule blocks with topics, goals, character motivations, pre-plot buildup, and post-plot transitions |
| Memory amnesia | **Autonomous Memory Engine** — Characters persist short-term (15m) and long-term (forever) memories via IndexedDB, with TTL expiry and relevance scoring |
| No user agency | **Dual interaction modes** — User Mode (chat as a participant) and Director Mode (inject plot twists, restructure timelines, issue demands) |
| Fragile pipelines | **Resilience layer** — Model fallback chains, circuit breakers, rate limiters, retry queues, and offline mode with cached data |

---

## 🎯 Key Features

### 🗣️ Live Group Chat with Distinct Personalities

Six AI characters with unique voices, emotions, and behavioral patterns:

- **Tom** — Ambitious, dramatic, always cooking up the next big idea
- **Angela** — Witty, trendy, drops pop culture references
- **Ben** — Technical, protective, the group's problem solver
- **Ginger** — Playful, cheeky, the youngest energy in the room
- **Hank** — Relaxed, foodie, brings everyone back to earth
- **Becca** — Sporty, direct, no-nonsense attitude

All dialogue is written in natural **Hinglish** (Hindi transliterated to Latin script, mixed with English), capturing authentic Lucknow conversational tone.

### 🌍 Real-World Environmental Grounding

The simulation is anchored in reality:

- **Live Weather** — Open-Meteo API provides Lucknow temperature, humidity, and weather conditions updated every 20 minutes
- **Festivals & Celebrations** — Calendar Bharat integration surfaces today's Indian festivals and upcoming celebrations
- **Google News RSS** — Real headlines from Indian news sources appear in the scene ribbon and are injected into AI prompts
- **Time Awareness** — Characters know the exact date, day of week, and 24-hour clock, enabling time-appropriate dialogue

### 📅 24-Hour Storyline Planner (Director Mode)

A complete narrative scheduling engine:

- **Hourly Blocks** — Gemini Flash 65K generates continuous timeline blocks with topics, goals, and character motivations
- **Pre-Plot & Post-Plot** — Each scene has a buildup narrative and a transition into the next, creating seamless story flow
- **Context Facts** — Concrete details (what's on the table, who arrived, what's happening outside) ground each scene
- **Inline Editing** — Click any block to edit its topic, goal, or facts directly in the planner drawer
- **Block Reordering** — Drag or arrow-reorder blocks with animation feedback and dirty-state tracking
- **Demand Injection** — Tell the AI "I want to study physics at 5pm" and the planner restructures the timeline around your request
- **Stabilize & Save** — After manual edits, a re-stabilization pass synthesizes smooth transitions across the full timeline

### 🧠 Autonomous Memory Engine

Characters remember everything — and forget nothing they shouldn't:

- **Short-Term Memories** — 15-minute TTL for transient states (posture, current location, ongoing friction)
- **Long-Term Memories** — Permanent facts (birthdays, secrets, relationships) with no expiry
- **User-Managed Memories** — Add, edit, or delete memories for any character through the Settings modal
- **Memory-Informed Prompts** — Active memories are injected into every AI request for context-aware responses
- **IndexedDB Persistence** — All memories survive page reloads and browser restarts

### 🎵 Ambient Sound Engine

A procedural Web Audio soundscape:

- **Three-Channel Mixer** — Melody (BPM-synced theme), Brown Noise (room air), Lofi Drone (chord pad)
- **Three Presets** — Sitcom (upbeat), Cozy Lounge (cozy), Sleep (ambient)
- **Real-Time Controls** — Master volume, per-channel levels, and BPM adjustment via sliders
- **Character Voice Blips** — Unique oscillator signatures per character (Tom = triangle, Angela = sine, Ben = sawtooth, etc.)
- **Message Pop SFX** — Subtle sine-wave pop when messages arrive

### 📊 DevTools & System Inspection

Built-in developer mode for real-time debugging:

- **System State Dashboard** — Structured JSON with character emotions, memory states, schedule metrics, and engine stats
- **Live Log Stream** — Buffered, throttled log viewer with category filtering
- **Prompt Inspector** — View exact prompts sent to Groq and Gemini, including thinking chains and token counts
- **Toggle Ribbon** — Enable/disable via Settings → Developer Mode

### 🛡️ Resilience & Offline Mode

Production-grade fault tolerance:

- **Dual-Provider Fallback** — If Groq fails, the system falls back through a chain of models (qwen3.6-27b → gpt-oss-20b → llama-4-scout)
- **Circuit Breaker** — Automatically stops hammering a failing endpoint and retries after cooldown
- **Rate Limiter** — Prevents API quota exhaustion with token-bucket throttling
- **Offline Mode** — When network is lost, the app auto-logins, shows cached chats, and allows local message sending (AI responses disabled)
- **Crash Recovery** — ErrorBoundary with three recovery options: Try Again, Reload App, Clear Data & Reload
- **IndexedDB Persistence** — All messages, schedules, and memories survive offline sessions

### 🎨 Responsive UI & Theming

- **Dark/Light Theme** — Toggle between color palettes with CSS custom properties
- **Mobile-First Design** — Tested across 320px to 1280px+ viewports (Mobile Chrome, Mobile Safari, Desktop)
- **Studio Lobby** — Immersive entry screen with live date, location tag, and character roster
- **Backstage Loading** — Animated loading screen during engine initialization
- **Scene Ribbon** — Marquee ticker showing live weather, active topic, and news headlines
- **Character Lounge** — Horizontal avatar strip with live emotion and typing state indicators
- **Emotion Drawer** — Quick-access emoji reactions (Default, Happy, Laughing, Thinking, Surprised, Sad, Angry, Sleeping, Excited)

### 🔑 Dual-Key Onboarding

Secure, hybrid API setup:

- **Groq Key** — Powers instant live chat banter (free tier available)
- **Gemini Key** — Powers 65K-context schedule planning and director demands (free tier available)
- **Model Probing** — On first login, the system probes all Gemini candidates and reports latency + status
- **Key Verification** — Both keys are verified against live APIs before granting studio access
- **Persistent Keys** — Stored in localStorage, never sent to any third-party server

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React Frontend                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ ChatUX   │ │ Planner  │ │ Settings │ │ DevTools│  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘  │
│       │             │            │            │        │
│  ┌────▼─────────────▼────────────▼────────────▼────┐  │
│  │              Context Layer                       │  │
│  │  ChatContext · DevToolsContext · OfflineContext  │  │
│  │  InputBoxContext · BackgroundBar · ThemeContext  │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼───────────────────────────┐  │
│  │           Conversation Manager                  │  │
│  │  Chat · ChatMember · EventManager · World       │  │
│  └──────┬─────────────────────┬───────────────────┘  │
│         │                     │                      │
│  ┌──────▼──────┐     ┌───────▼────────┐             │
│  │ GroqClient  │     │ GeminiClient   │             │
│  │ (Live Chat) │     │ (Planner/Demand│             │
│  │ openai/     │     │  gemini-3.7-   │             │
│  │ gpt-oss-120b│     │  flash 65K)    │             │
│  └──────┬──────┘     └───────┬────────┘             │
│         │                     │                      │
│  ┌──────▼─────────────────────▼───────────────────┐  │
│  │              Resilience Layer                    │  │
│  │  CircuitBreaker · RateLimiter · FallbackChain   │  │
│  │  RetryQueue · UserInterruptHandler              │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼───────────────────────────┐  │
│  │           Persistence Layer                     │  │
│  │  IndexedDB (Messages · Scheduler · Memories)    │  │
│  │  localStorage (Keys · Settings · Audio State)   │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Core Engine Classes

| Class | Responsibility |
|-------|---------------|
| `ConversationManager` | Orchestrates the full chat lifecycle — initialization, message flow, world sync |
| `Chat` | Message buffer, member registry, event bus for chat events |
| `ChatMember` | Individual character state — emotion, typing, memory, personality |
| `World` | 24-hour simulation clock, environment snapshot, active schedule, member registry |
| `WorldSetter` | Generates and updates schedule blocks via Gemini Flash 65K |
| `EventManager` | Typed pub/sub event system with subscriber tracking |
| `GroqClient` | Groq API integration with streaming, fallback chain, and model probing |
| `GeminiClient` | Google AI Studio integration for planner and demand generation |
| `Memory` | TTL-based memory store with expiry tracking and relevance filtering |
| `Storage` | IndexedDB wrapper for message, schedule, and memory persistence |
| `CircuitBreaker` | Prevents cascading failures with state-machine (Closed → Open → Half-Open) |
| `RateLimiter` | Token-bucket rate limiting for API calls |
| `PromptBuilder` | Assembles multi-layer prompts with environment, schedule, characters, and memories |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + Vite 8 |
| **AI — Chat** | Groq Cloud (openai/gpt-oss-120b with fallback chain) |
| **AI — Planner** | Google Gemini 3.7 Flash (65K context window) |
| **Environment APIs** | Open-Meteo (weather), Calendar Bharat (festivals), Google News RSS |
| **Storage** | IndexedDB (via custom wrapper) + localStorage |
| **Audio** | Web Audio API (procedural synthesis) |
| **Styling** | CSS Modules + CSS Custom Properties |
| **Testing** | Vitest + MSW (unit/integration), Playwright (E2E across 5 browsers) |
| **Type Safety** | TypeScript strict mode (checkJs + allowJs) |
| **PWA** | Service Worker for offline caching |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Groq API key](https://console.groq.com/keys) (free tier)
- A [Google AI Studio API key](https://aistudio.google.com/app/apikey) (free tier)

### Installation

```bash
git clone <repository-url>
cd tgf
npm install
```

### Development

```bash
npm run dev
```

Opens at `https://localhost:5173`. Enter your Groq and Gemini API keys on the onboarding screen.

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript strict type checking |
| `npm run test` | Run unit & integration tests |
| `npm run test:coverage` | Tests with coverage report (≥85% threshold) |
| `npm run test:e2e` | Playwright E2E tests (5 browsers) |
| `npm run test:live:all` | Live API integration tests |
| `npm run test:ci` | Full CI pipeline (lint → typecheck → test → e2e → build) |

---

## 📅 Project Timeline

### Week 1: Foundation (July 19 – July 22, 2026)

| Date | Milestone |
|------|-----------|
| Jul 19 | **Project init** — React + Vite scaffold, initial component structure |
| Jul 20 | Core chat pipeline working — basic message flow, broken but compiling |
| Jul 22 | Prompting engine stabilized — dialogue generation producing coherent Hinglish output |

### Week 2: Engine Architecture (Aug 6 – Aug 9, 2026)

| Date | Milestone |
|------|-----------|
| Aug 6 | First step toward decreasing complexity — decoupled monolithic classes |
| Aug 7 | **Core redesign** — ConversationManager architecture overhauled |
| Aug 8 | **World got its first beat!** — 24-hour simulation clock ticking |
| Aug 9 | First boot complete — World, Director, and live chat all functioning together |
| Aug 9 | UI wiring started — connecting React components to engine state |

### Week 3: Stabilization & Memory (Aug 11 – Aug 15, 2026)

| Date | Milestone |
|------|-----------|
| Aug 11 | Chat architecture reorganized — cleaner separation of concerns |
| Aug 12 | TimelineProcessor working — schedule blocks pacing correctly |
| Aug 13 | Fixed initialization hangs, timeline pacing, and React memory leaks |
| Aug 15 | Memory pipeline decoupled — multi-agent chat engine optimized |

### Week 4: World Simulation & UI Overhaul (Aug 18 – Aug 21, 2026)

| Date | Milestone |
|------|-----------|
| Aug 18 | **WorldSetter replaces Director** — 24-hour macro simulation engine |
| Aug 18 | AI pipeline stabilized with rate-limiting and state continuity |
| Aug 18 | Stable backend achieved, CSS improved, custom CSS modules introduced |
| Aug 19 | Director mode + new CSS — App build complete, not yet stable |
| Aug 19 | API keys removed from codebase (security cleanup) |
| Aug 20 | **DevTools suite** — Live log stream, prompt inspector, system state dashboard |
| Aug 20 | Onboarding lifecycle — dual-key setup flow, model probing UI |
| Aug 21 | **Production living stage engine** — Dynamic thoughts, responsive UX |
| Aug 21 | Autonomous AI memories with dynamic birthdays and multi-record parser |
| Aug 21 | **Studio Lobby lifecycle** — Ambient sound mixer, live memory engine, anti-degeneration sampling |

### Week 5: Migration & Production Hardening (Aug 22 – Aug 24, 2026)

| Date | Milestone |
|------|-----------|
| Aug 22 | **v2.0 release** — Major version milestone |
| Aug 22 | **Groq API migration** — XML protocol, dynamic storyline scheduler |
| Aug 23 | Prompt debugging pass — refined Hinglish output quality |
| Aug 23 | **PWA offline support** — Service worker, IndexedDB persistence, crash recovery |
| Aug 24 | **Production hardening** — API resilience, streaming UI, responsive layout, type safety |

### Week 6: Quality & Testing (Aug 25, 2026)

| Date | Milestone |
|------|-----------|
| Aug 25 | Comprehensive E2E test suite — Playwright across 5 browsers (105 tests) |
| Aug 25 | Unit & integration test suite — Vitest + MSW (191 tests) |
| Aug 25 | TypeScript strict mode — zero type errors |
| Aug 25 | Live integration harness — Open-Meteo, Calendar Bharat, Google News RSS verification |
| Aug 25 | Full README, CI pipeline, and coverage enforcement |

---

## 🧪 Testing & CI

### Test Pyramid

```
          ┌─────────────┐
          │  E2E (105)  │  Playwright — 5 browsers
          ├─────────────┤
          │ Live (16)   │  Real API integration
          ├─────────────┤
          │ Unit (191)  │  Vitest + MSW
          └─────────────┘
```

### E2E Test Coverage

| Test Suite | Tests | Browsers |
|-----------|-------|----------|
| Chat Workflow | 9 | Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari |
| Offline Mode | 7 | Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari |
| Onboarding | 7 | Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari |
| Planner & Director | 13 | Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari |

### CI Pipeline

```bash
npm run test:ci
# Runs: lint → typecheck → test:coverage → test:e2e → build
```

---

## 📁 Project Structure

```
src/
├── App.jsx                          # Root shell — onboarding → lobby → loading → chat
├── main.jsx                         # Entry point with providers
├── theme.css                        # CSS custom properties (dark/light)
├── classes/
│   ├── Chat.js                      # Message buffer & member registry
│   ├── ChatMember.js                # Character state & behavior
│   ├── ConversationManager.js       # Full chat lifecycle orchestrator
│   ├── EventManager.js              # Typed pub/sub event bus
│   ├── GeminiClient.js              # Gemini Flash 65K integration
│   ├── GroqClient.js                # Groq API with fallback chain
│   ├── Message.js                   # Message data model
│   ├── PromptBuilder.js             # Multi-layer prompt assembly
│   ├── ProtocolCodec.js             # XML protocol parser/encoder
│   ├── Reaction.js                  # Emotion/reaction system
│   ├── TimelineProcessor.js         # Schedule block pacing
│   ├── World.js                     # 24-hour simulation engine
│   ├── WorldSetter.js               # Schedule generation via Gemini
│   ├── lib/
│   │   ├── BlockedModels.js         # Model blocklist management
│   │   ├── ChatMemberScheduler.js   # Per-character timeline scheduling
│   │   ├── CircuitBreaker.js        # API failure protection
│   │   ├── GeminiModelResolver.js   # Model discovery & probing
│   │   ├── Key.js                   # Encryption utilities
│   │   ├── Logger.js                # Buffered log system
│   │   ├── Memory.js                # TTL-based memory store
│   │   ├── MemoryExpiryParser.js    # Duration string parser
│   │   ├── MessageStore.js          # IndexedDB message persistence
│   │   ├── PromptLogger.js          # Prompt execution tracing
│   │   ├── RateLimiter.js           # Token-bucket rate limiting
│   │   ├── Storage.js               # IndexedDB abstraction layer
│   │   ├── UserInterruptHandler.js  # Graceful abort handling
│   │   └── XmlEncoder.js            # XML tag builder
│   └── types/                       # JSDoc type definitions
├── components/
│   ├── Chat.jsx                     # Main chat UI shell
│   ├── Header.jsx                   # Top bar with title & settings
│   ├── footer.jsx                   # Dual-mode input hub (User/Director)
│   ├── Avatar.jsx                   # Character avatar with emotion states
│   ├── BackgroundBar.jsx            # Scene progress & block visualization
│   ├── DevToolsBar.jsx              # Developer tools toggle ribbon
│   ├── DevToolsDrawer.jsx           # Bottom inspection panel
│   ├── message.jsx                  # Chat message bubble renderer
│   ├── OfflineBanner.jsx            # Network disconnect notification
│   ├── PlannerDrawer.jsx            # 24-hour schedule editor
│   ├── SceneBar.jsx                 # Live environment marquee ticker
│   ├── SettingsModal.jsx            # Studio config (keys, audio, memories)
│   ├── ErrorBoundary/               # Crash recovery UI
│   ├── devtools/                    # Log, Prompt, and State tabs
│   └── screens/
│       ├── ApiKeyOnboardingScreen.jsx    # Dual-key setup with probing
│       ├── StudioBackstageLoadingScreen.jsx  # Engine initialization
│       └── StudioLobbyScreen.jsx         # Pre-chat lobby gate
├── contexts/
│   ├── BackgroundBarContext.jsx     # Scene progress state
│   ├── ChatContext.jsx              # ConversationManager provider
│   ├── DevToolsContext.jsx          # System inspection state
│   ├── InputBoxContext.jsx          # Input mode & planner visibility
│   ├── OfflineContext.jsx           # Network connectivity state
│   └── ThemeContext.jsx             # Dark/light theme state
├── util/
│   ├── apiKeys.js                   # Dual-key management & verification
│   ├── config.js                    # Application constants
│   ├── Constants.js                 # Barrel re-export
│   ├── environment.js               # Open-Meteo, Calendar Bharat, Google News
│   ├── prompts.js                   # Centralized prompt templates
│   ├── sound.js                     # Web Audio synthesis engines
│   ├── member.js                    # Character roster definitions
│   ├── random.js                    # Deterministic random utilities
│   └── deley.js                     # Async delay helper
└── mocks/                           # MSW handlers for testing
```

---

## 🤝 Contributing

1. Run `npm run typecheck` — zero errors required
2. Run `npm run test` — all tests must pass
3. Run `npm run test:e2e` — all browser tests must pass
4. Follow existing code conventions (JSDoc types, CSS Modules, event-driven architecture)

---

## 📄 License

Private — All rights reserved.
