# OmniStage AI — Agentic 3D Game & Programmatic Media Studio

OmniStage AI is a contract-first, AI-powered 3D creation workstation that allows creators and marketers to build interactive HTML5 Playable Ads, 3D Mini-Games, and programmatic marketing videos through natural language direction, live scene inspection, and multimodal visual quality assurance.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following core product and workflow decisions have been locked in based on your preferences and architectural requirements:

- **Confirmed Decision 1 — Default Starter Scene Template**: Launches into a **Clean Studio Stage with a Starter Primitive** (calibrated studio lighting, ground grid with contact shadows, and a centered composite showcase hero actor) so creators begin with an uncluttered, predictable spatial baseline while retaining one-click access to full game and product templates in the Asset Drawer.
- **Confirmed Decision 2 — Vision QA Spatial Check Workflow**: Clicking **Visual QA Snapshot** captures the live WebGL canvas and inspects it alongside the active `SceneSpec` to generate a **Diagnostic Report with a one-click "Apply Fixes" button**, giving creators full transparency and control before mutating spatial coordinates.
- **Confirmed Decision 3 — Pro Dark 3D Workstation Layout**: Uses a docked 4-panel dark studio interface (Top Navigation Bar, Left Semantic Asset Drawer, Center 3D Viewport with Bottom Timeline & HUD Dock, and Right Conversational Agent & Inspector Panel) with high-contrast amber and cyan accents and zero viewport occlusion.
- **Architectural Boundary — Server-Side Gemini Proxy**: To keep API credentials secure while supporting structured `SceneSpec` mutations and multimodal Vision QA with `gemini-3.8-flash`, the studio communicates with an Express backend route (`/api/agent/*`) that executes `@google/genai` calls server-side.

---

## 1. Overview & Core Concept

- **What It Does**: OmniStage AI bridges 3D game engines and programmatic ad production by driving an interactive Three.js / React Three Fiber stage entirely from a declarative `SceneSpec` JSON contract. Users can spawn multi-part 3D characters and luxury product models, choreograph camera flythroughs, configure tap-to-collect playable ad mechanics, run AI Vision checks to fix framing or clipping, and export 60fps WebM videos, 4K PNG snapshots, or self-contained HTML5 Playable bundles.
- **Target Audience / Persona**: Performance marketers producing TikTok/Reels/Meta playable ads, indie game designers prototyping 3D mini-games, and multi-agent engineering teams (Claude Code, Antigravity, Codex) collaborating via strict schema contracts.
- **Key Value**: Eliminates brittle runtime code generation by separating declarative scene state (`SceneSpec`), semantic 3D asset definitions (bounding boxes, attachment sockets, animations), and deterministic WebGL rendering.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Zero-State & Studio Exploration**: The user lands in the Pro Dark 3D Workstation showing the Clean Studio Stage with a grounded starter primitive. From the Left Asset Drawer, they can one-click spawn composite 3D actors (Cyber Mecha Bot, Fantasy Knight, Sports Sneaker, Luxury Perfume Bottle, Coin/Gem Collectibles, Sports Car, Sci-Fi Portal), switch lighting rigs, or load complete starter templates.
2. **Dual-Mode Production (Game Mode vs. Media Mode)**:
   - In **Game Mode**, users test interactive tap/click behaviors (collectibles, score bursts, win targets, countdown timers) and preview the live Playable Ad HUD and CTA overlay.
   - In **Media Mode**, users scrub the camera keyframe timeline, preview cinematic flythrough or orbit rigs, and frame shots across `16:9` (Landscape), `9:16` (TikTok/Reels Vertical), and `1:1` (Square Social) aspect ratios.
3. **Conversational Agent & JSON Diff Inspection**: In the Right Agent Panel, users type natural language instructions or select quick prompt actions. The AI Agent mutates the `SceneSpec` state, logs a human-readable summary, and provides an expandable JSON diff viewer with full Undo/Redo history.
4. **Vision QA Loop (Diagnostic Report + One-Click Fix)**: Clicking **Visual QA Snapshot** captures a base64 PNG from the WebGL buffer and sends it with the current `SceneSpec` to Gemini Vision. The Right Agent Panel displays detected spatial issues (off-center framing, overlapping bounding boxes, low contrast, camera clipping) along with a **Apply Recommended Fixes** button that updates the scene and records an undo snapshot.
5. **Instant Capture & Multi-Channel Publishing**: Users can snap instant PNG renders, record 3s/5s/10s WebM video streams while camera tracks and procedural animations play, or open the Publish Modal to export standalone HTML5 Playable Ad bundles and `SceneSpec` JSON packages for TikTok Playable Ads, Meta Ads, and Telegram Mini Apps.

### Visual Identity & Theme
- **Aesthetic Direction**: Precision dark-mode 3D workstation inspired by professional DCC and broadcast motion tools—clean hairline borders, tabular telemetry, unobstructed 3D viewport framing, and zero decorative clutter.
- **Color Palette & Mood**:
  - **60% Dominant Neutral Canvas**: Deep obsidian and carbon slate (`#090D16` workspace background, `#0F172A` docked panel surfaces).
  - **30% Structural Surfaces**: Subdued graphite panels (`#1E293B`), subtle hairline dividers (`border-slate-800`), and crisp off-white/muted slate typography (`#F8FAFC` primary, `#94A3B8` secondary).
  - **10% Accent Budget**: Electric Cyan (`#06B6D4`) for active spatial/camera controls and Vision QA diagnostics, paired with Studio Amber (`#F59E0B`) for primary CTAs, recording states, and playable game highlights. Semantic status indicators use Emerald (`#16A34A`), Amber (`#D97706`), and Crimson (`#DC2626`) paired with explicit labels.
- **Typography & Hierarchy**:
  - **Display & Studio Headers**: `Outfit` (600/700 weight) for crisp geometric workspace headers and modal titles.
  - **UI Body & Controls**: `Plus Jakarta Sans` (400/500/600 weight) for scannable asset cards, inspector labels, and chat interactions.
  - **Coordinates, Timeline & JSON Diff**: `JetBrains Mono` with `tabular-nums` for `[X, Y, Z]` spatial transforms, frame timers, aspect ratios, and schema diffs.
- **Component Styling & Layout**: Full-viewport (`100vw x 100vh`, `overflow-hidden`) 4-zone docked workstation layout. Controls remain single-line (`whitespace-nowrap shrink-0`), metadata uses clean typographic separators (`·`), and the central 3D stage frames the active aspect ratio (`16:9`, `9:16`, `1:1`) with a collapsible bottom timeline/HUD bar so the 3D subject is never occluded.
- **Interactive Feedback & Motion**: Smooth exponential damping (`THREE.MathUtils.damp`) on camera transitions and actor animations, real-time score popups and particle bursts when clicking actors in Game Mode, recording progress countdowns during WebM capture, and instant undo/redo state transitions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Declarative `SceneSpec` Contract vs. Raw Runtime Code Generation**
  - *Chosen Approach*: All 3D scene changes flow through a strongly typed `SceneSpec` state object (`mode`, `aspectRatio`, `environment`, `camera`, `actors`, `vfx`, `marketingOverlay`, `gameRules`, `timeline`).
  - *Why*: Guarantees 100% deterministic rendering, zero runtime syntax crashes, instant undo/redo snapshots, and clean hand-offs across multi-agent workflows (Claude Code, Antigravity, Codex).
  - *Alternatives Considered*: Having the LLM generate raw Three.js/R3F JSX strings at runtime, which is slow, prone to compilation errors, and impossible to serialize cleanly for ad network bundlers.
- **Decision 2: Hybrid Procedural Composite 3D Registry + Custom GLB Support**
  - *Chosen Approach*: Every built-in asset in the Semantic Asset Registry is constructed as a rich, multi-part Three.js procedural group (3–12 distinct sub-meshes with calibrated metallic, physical glass, and emissive PBR materials, grounded bottom-center pivots, bounding boxes, and attachment sockets) while also supporting external `.glb` URLs via an error-boundary loader.
  - *Why*: Eliminates broken external 3D model URLs and CORS failures during live preview and video capture while still allowing users to attach custom `.glb` assets when needed.
- **Decision 3: Diagnostic Report Before Applying Vision QA Fixes**
  - *Chosen Approach*: Vision QA returns a structured spatial critique (severity, detected issues, explanation, and a proposed `SceneSpec` patch) that the user reviews and applies with a single click.
  - *Why*: Prevents unexpected camera jumps while giving the user clear visibility into *why* the AI recommends repositioning actors, adjusting FOV, or improving lighting contrast.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                 TopNavBar (Dock)                                  │
│  [OmniStage AI]   [Mode: Game | Media] [Ratio: 16:9 | 9:16 | 1:1]   [Export/Pub]  │
├──────────────────────┬─────────────────────────────────────┬──────────────────────┤
│   LeftAssetDrawer    │           CenterViewport            │    RightAgentChat    │
│                      │  ┌───────────────────────────────┐  │                      │
│  • Starter Templates │  │      StageCanvas (R3F)        │  │  • Chat History      │
│  • 3D Actors & Props │  │  preserveDrawingBuffer={true} │  │  • Quick Prompt Bar  │
│    (Multi-part PBR)  │  │  ┌─────────────────────────┐  │  │  • Vision QA Report  │
│  • Lighting Studios  │  │  │      SceneDirector      │  │  │    + [Apply Fixes]   │
│  • VFX & Text Nodes  │  │  │ • Environment & Lights  │  │  │  • Live Actor/Scene  │
│  • Custom GLB Input  │  │  │ • Camera Rig & Keyframe │  │  │    Inspector & JSON  │
│                      │  │  │ • ActorRenderer (PBR)   │  │  │    Diff Viewer       │
│                      │  │  │ • VFXRenderer (3D/Part) │  │  │                      │
│                      │  │  └─────────────────────────┘  │  │                      │
│                      │  │  + Playable Game HUD & CTA    │  │                      │
│                      │  └───────────────────────────────┘  │                      │
│                      │  [Play/Pause | Timeline | QA Snap]  │                      │
└──────────────────────┴─────────────────────────────────────┴──────────────────────┘
                                         │
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                         Central Studio Store (SceneSpec)                          │
│  • Live SceneSpec JSON State + Undo/Redo Stack + Playback Clock + Game Score      │
└──────────────────────┬─────────────────────────────────────┬──────────────────────┘
                       │                                     │
                       ▼                                     ▼
┌────────────────────────────────────────┐ ┌────────────────────────────────────────┐
│   Media & Playable Exporter Engine     │ │   Express Server Proxy (/api/agent/*)  │
│  • 4K PNG Canvas Snapshot              │ │  • POST /api/agent/mutate (Gemini 3.8) │
│  • 3s/5s/10s WebM MediaRecorder Stream │ │  • POST /api/agent/vision-qa           │
│  • Standalone HTML5 Playable Bundler   │ │    (Base64 Canvas + SceneSpec Audit)   │
└────────────────────────────────────────┘ └────────────────────────────────────────┘
```

### Data Model & State
- **`SceneSpec` Schema**:
  - `id`, `title`, `mode` (`'game' | 'media'`), `aspectRatio` (`'16:9' | '9:16' | '1:1'`).
  - `environment`: `presetId` (`'clean-apple-studio' | 'cyberpunk-neon' | 'sunset-cinematic' | 'arcade-vibrant'`), `backgroundColor`, `fogColor`, `fogNear`, `fogFar`, `groundGrid`, `groundColor`, `ambientIntensity`.
  - `camera`: `mode` (`'orbit' | 'cinematic-flythrough' | 'follow-target' | 'isometric-game'`), `position`, `target`, `fov`, `keyframes` (timestamped `[x,y,z]` waypoints and look-at targets).
  - `actors`: Array of `ActorNode` (`id`, `name`, `assetId`, `customGlbUrl`, `position`, `rotation`, `scale`, `primaryColor`, `secondaryColor`, `metalness`, `roughness`, `activeAnimation` (`'idle' | 'bounce' | 'spin' | 'walk' | 'attack' | 'float'`), `physicsRole` (`'static' | 'dynamic' | 'collectible' | 'player'`), `onClickAction` (`'none' | 'collect-score' | 'jump-boost' | 'trigger-vfx' | 'cta-redirect'`), `scoreValue`).
  - `vfx`: Array of `VFXNode` (`id`, `type` (`'sparkles' | 'shockwave' | 'floating-3d-badge' | 'laser-beam' | 'confetti'`), `position`, `color`, `intensity`, `labelText`).
  - `marketingOverlay`: `headline`, `subheadline`, `ctaText`, `brandColor`, `showCondition` (`'always' | 'on-win' | 'after-5s'`), `badgeText`.
  - `gameRules`: `winCondition` (`'collect-all' | 'score-threshold' | 'survive-timer'`), `targetScore`, `timeLimitSeconds`, `instructions`.
- **Semantic Asset Registry**:
  - Stores pre-configured multi-part 3D assets (`starter-primitive-showcase`, `cyber-mecha-bot`, `fantasy-knight`, `sports-sneaker-pro`, `luxury-perfume-bottle`, `gold-coin-collectible`, `plasma-gem`, `gt-sports-car`, `scifi-warp-portal`) with `boundingBox`, `attachmentSockets` (`head`, `hand_r`, `ground`, `top_badge`), `supportedAnimations`, and `category`.

### Interactive Component & State Mapping
- **Top Navigation Bar**: Switches between `game` and `media` modes, toggles `16:9` / `9:16` / `1:1` viewport framing, triggers Undo/Redo across the `SceneSpec` history stack, provides instant PNG/WebM capture buttons, and opens the Publish Modal.
- **Left Asset Drawer**: Filters registry items by category (Templates, Actors & Products, Lighting Studios, VFX Presets). Clicking an asset spawns a new `ActorNode` at an unoccupied ground-aligned position (`y = 0`) using registry bounding-box metadata; clicking a Lighting Studio updates `environment`; clicking a Scene Template loads a curated preset (`Clean Studio Stage`, `Cyber Mecha Coin Collector`, `Luxury Sneaker Showcase`, `Sci-Fi Portal Defense`).
- **Center 3D Viewport & Bottom Timeline Dock**:
  - Hosts the R3F `<Canvas gl={{ preserveDrawingBuffer: true }}>` and renders `SceneDirector`, `ActorRenderer`, and `VFXRenderer`.
  - In `game` mode, clicking actors executes their `onClickAction` (incrementing live score, triggering shockwave/sparkle bursts, floating `+10` feedback, and evaluating win conditions).
  - Bottom dock controls Play/Pause, timeline scrubbing (`0.0s` to `10.0s`), camera rig mode switching, selected actor quick-transform controls, and the **Visual QA Snapshot** trigger.
- **Right Agent Chat & Inspector Panel**:
  - Sends natural language prompts + current `SceneSpec` to `/api/agent/mutate`, receiving a validated updated `SceneSpec` and explanation.
  - Displays the Vision QA Diagnostic Card when a snapshot scan completes, listing spatial findings with a one-click **Apply Recommended Fixes** handler.
  - Includes a tabbed **Scene Inspector & JSON Diff** view so users can fine-tune selected actor transforms, colors, animations, or directly inspect `SceneSpec` JSON changes.
- **Publish & Export Modal**: Generates and downloads high-res `.png` snapshots, records live `.webm` video streams (`3s`, `5s`, `10s`) via `canvas.captureStream(60)` + `MediaRecorder`, and builds a self-contained single-file HTML5 Playable Ad bundle (with embedded Three.js runtime and `SceneSpec` payload) alongside raw JSON export for downstream MCA agents.
