# OmniStage AI — Master Architecture & Roadmap (`plan.md`)

## 1. Vision & Dual-Engine Architecture (Phase 3 + Phase 4 toolkit)
**OmniStage AI** is a from-scratch **3D WebGL & 2D Vector/Sprite Game, Animation & Playable Media Authoring Engine**. Creators can build multi-scene 3D games, 2D platformers, kinetic motion graphics, and HTML5 Playable Ads from a clean blank canvas using direct viewport manipulation and natural language AI direction.

### Architectural Pillars
1. **Declarative Dual-Engine `SceneSpec` & Multi-Scene Contract (`src/types/scene.schema.ts`)**:
   - Supports `engineType: '3d' | '2d'` per scene inside a multi-scene project storyboard (`scenes: SceneSpec[]`, `activeSceneId`).
   - **3D Engine Schema**: `WorldSpec` (procedural terrains, water level, skybox presets, volumetric clouds, weather particles, instanced scatter layers), `ActorNode` (rigged `.glb` models with `modelUrl`, `activeClip`, `availableClips`, or multi-part PBR primitives, `physicsRole`, `onClickAction`), `CameraRig` (6 cinematic modes + spline keyframes), and `VFXNode`.
   - **2D Engine Schema**: `Node2D` (`sprite`, `rect`, `circle`, `star`, `platform`, `text-kinetic`, `vector-path`) with `Physics2DRole` (`player-platformer`, `player-topdown`, `static-platform`, `collectible`, `hazard`, `bouncing`) and procedural animations.
2. **Real GLTF/GLB Skeletal Models, Custom File Import & Asset Registry (`src/registry/assetRegistry.ts`)**:
   - Verified CORS-safe rigged `.glb` models (`RobotExpressive.glb`, `Soldier.glb`, `Horse.glb`, `Flamingo.glb`, `Parrot.glb`, `Fox.glb`, `DamagedHelmet.glb`) loaded via `@react-three/drei`'s `useGLTF` + `three-stdlib`'s `SkeletonUtils.clone` + `useAnimations`.
   - Drag-and-drop local file importer (`LeftAssetDrawer.tsx`) supporting `.glb`, `.gltf`, `.svg`, `.png`, `.jpg`, `.webp`, and `.json` scene/project bundles.
3. **World & Spatial Environment Builder (`src/renderer/WorldRenderer.tsx`)**:
   - Real-time vertex-displaced 3D terrains (`flat`, `hills`, `mountains`, `islands`, `canyon`, `city-grid`, `snow-peaks`, `dunes`) with customizable roughness, scale, and animated water planes.
   - Dynamic skyboxes (`day-clear`, `golden-sunset`, `cyber-night`, `deep-space`, `nebula-dusk`), volumetric `<Clouds>`, weather emitters (`rain`, `snow`, `embers`, `fireflies`), and instanced world props (`pine-tree`, `palm-tree`, `lowpoly-rock`, `sci-fi-pillar`, `crystal-cluster`, `building-block`).
4. **Provider-Agnostic AI Director & Multimodal Vision QA (`src/components/SettingsModal.tsx`, `src/agent/*`, `server.ts`)**:
   - Configurable AI model & provider settings (`SettingsConfig` persisted in `localStorage`) supporting Default Server Gemini, Custom Gemini API keys, OpenAI-compatible endpoints, or Anthropic endpoints.
   - Live canvas inspection (`runVisionQAInspection`) works on both the 3D WebGL canvas and 2D Canvas2D stage, returning spatial diagnostics with a one-click **"Apply Recommended Fixes"** button.
5. **Unified 3D/2D Media & Multi-Scene Playable Exporter (`src/exporter/mediaExporter.ts`)**:
   - **High-Res PNG Snapshot & 60fps WebM Video Stream**: Captures either `StageCanvas.tsx` (`'3d'`) or `StageCanvas2D.tsx` (`'2d'`) via `HTMLCanvasElement.captureStream(60)` and `MediaRecorder`.
   - **Multi-Scene Project JSON Bundle (`.scenespec.json`)**: Serializes both the active `sceneSpec` and the full `scenes[]` storyboard array for lossless round-trip import and MCA handoff.
   - **Standalone HTML5 Playable Ad Bundle (`.html`)**: Self-contained playable bundle for TikTok (MRAID 3.0), Meta (`FbPlayableAd`), and Telegram Mini Apps supporting both `'3d'` Three.js and `'2d'` Canvas2D engines plus interactive multi-scene level switching.

---

## 2. Phase Roadmap

### Phase 1: Core Declarative Scaffold (Completed)
- [x] `SceneSpec` contract, semantic asset registry, server-side Gemini endpoints, and 4-panel dark workstation UI.

### Phase 2: Interactive 3D Gizmos, Sequencer & Playable Game Loop (Completed)
- [x] Direct 3D `TransformControls` (`translate`, `rotate`, `scale`), floating inspector toolbar, timeline scrubber with cue bars, WASD 3D player loop, and Playable Ad End-Card overlay.

### Phase 3: Full 2D/3D Authoring Engine, World Builder & Real GLTF Rigs (Completed)
- [x] Blank-canvas-first workflow with Multi-Scene Storyboard manager (`scenes[]`, `activeSceneId`) and secondary `Examples` modal.
- [x] Dual-Engine runtime (`StageCanvas.tsx` for 3D WebGL + `StageCanvas2D.tsx` for 2D Vector/Sprite/Platformer).
- [x] Real rigged `.glb` skeletal animation playback (`RiggedGltfModel` with clip discovery selector) and pure WebGL `THREE.CanvasTexture` sprite badges.
- [x] Procedural 3D `WorldRenderer.tsx` (terrains, water, sky, clouds, weather particles, instanced scatter).
- [x] Drag-and-drop local file importer (`.glb`, `.gltf`, `.svg`, `.png`, `.json`) & `SettingsModal.tsx` for custom AI providers and viewport settings.
- [x] Unified 3D/2D snapshot, WebM video, and multi-scene JSON/HTML5 playable export in `mediaExporter.ts`.

### Phase 3.5: Visual Logic Graph & Execution Console (Completed — labelled "Phase 5" in code comments)
- [x] Bidirectional `LogicGraphSpec` (trigger → condition → action), runtime interpreter for 2D/3D, Execution Console with deterministic + AI repair.
- [x] Multi-scene level progression (`sequence.nextSceneId`, `advanceToNextScene`, "Next Level" end-card) and storyboard pipeline.

### Phase 4: Agentic Game & Media Toolkit (Completed 2026-11-10)
Source analysis and adopt-vs-build decisions: [`docs/research/agent-ecosystem-review.md`](docs/research/agent-ecosystem-review.md).
- [x] **Verification loop in the product** — `src/verification/sceneVerifier.ts`: pure `verifySceneSpec` (ids, time windows, CTA, audio cues, easing,
  `nextSceneId`, 2D platformer reachability from the real jump physics, reachable score goals, 3D arena bounds, camera follow target) +
  `autoFixSceneSpec` + one AI repair round fed with the exact findings. Runs on every AI turn and every storyboard scene; chat shows a VERIFIED / N ERROR(S) badge.
- [x] **Director Skills** — `src/agent/directorSkills.ts`: 5 built-in craft skills (cinematic shot grammar, platformer level design, playable-ad hook,
  kinetic typography, game juice) selected per prompt (VI/EN) and injected into the system prompt; **learned skills** distilled from an approved result via
  "Save as skill" (localStorage, ranked by use, managed in Settings → AI).
- [x] **Procedural game audio** — `src/audio/sfxRuntime.ts` (sfxr-style WebAudio synth, 10 presets, zero files) + `audioBus.ts` (store-driven
  collect / hit / win / lose / scene-start, 2D jump) + `SceneSpec.audio` + World-tab cue editor. Exported playable ads inline the same synth.
- [x] **Motion easing** — `src/animation/easing.ts` (9 GSAP-style curves), `ease` on `Keyframe2D` and `CameraKeyframe`; 2D keyframes, 3D camera spline
  (now honours keyframe times) and the exported 2D runtime use it.
- [x] **Dev harness** — pointer-index `CLAUDE.md`, scoped `.claude/rules/*.md`, `scene-contract-reviewer` subagent, `npm run verify` (tsc + 28 unit tests).

### Phase 5: Agent-Native Studio & Offline Media (Completed 2026-11-10)
- [x] **OmniStage MCP server** (`mcp/server.ts`, `mcp/projectTools.ts`, guide: `docs/mcp-server.md`): stdio JSON-RPC, 11 tools
  (contract, director skills, list/get/create, merge-patch + JSON-patch with verify/auto-fix, verify, link scenes, export playable, export captions).
  Works on studio-compatible `.scenespec.json` bundles; writes are atomic and exports are confined to `--root`. Registered in `.mcp.json`.
- [x] **Offline playables**: tree-shaken Three.js r187 inlined (`scripts/build-playable-three.mjs` → `src/exporter/generated/`, lazy chunk,
  ~540 KB / ~140 KB gzip) with light-unit compensation; legacy CDN mode kept as an option. Per-network **size budget + offline report**
  (`src/exporter/playableBundle.ts`) shown in Publish. **ZIP bundles are DEFLATE-compressed** (CompressionStream, stored fallback).
- [x] **Exporter physics parity**: exported platformer now uses the verifier/studio envelope (jump 520, gravity 882, run 320) and respawns on
  pit falls instead of an invisible floor, so verifier-approved levels are beatable in the export too.
- [x] **2D spritesheets** (`Node2D.spriteSheet`, clips idle/run/jump auto-selected for players, facing flip) in studio + export.
- [x] **Procedural 2D particles** (`type: 'particle-emitter'`, 8 deterministic presets: sparkle, confetti, fire, smoke, rain, snow, pixel-burst,
  magic-trail) — pure function of (preset, seed, time), so scrub/record are reproducible; shared verbatim with the export.
- [x] **Captions** (`SceneSpec.captions`): drawn into the 2D canvas (recorded in WebM), overlay in 3D, editor in World tab, WebVTT/SRT export,
  offline director heuristic ("add captions"/"phụ đề").
- [x] Verifier rules for particle presets, spritesheets and captions; prompt + skills updated; `npm run verify` = tsc + 40 tests.
- [x] **CI**: `.github/workflows/verify.yml` (verify + build); headless read-only agent review: `npm run review:agent` (`claude -p`).

### Phase 6: Creator Platform — Batch 1 "Foundation" (Completed 2026-11-10)
Decisions (confirmed with the product owner): local-first (Node server on the user's computer; cloud build degrades gracefully),
strongest plugin model (code allowed, sandboxed, AI may draft/recommend, human approves every install), CLI login for OpenCode / Claude Code /
Codex / Gemini CLI (later replaced by the Google Antigravity CLI), delivery in batches with the foundation first.
- [x] **AI providers** (`server/ai/*`, `src/agent/aiClient.ts`, Settings → AI): Gemini, **Anthropic** (official SDK, adaptive thinking,
  server-side refusal fallback), **OpenRouter**, **OpenAI-compatible** (OpenAI, Ollama, LM Studio, vLLM, Groq, DeepSeek…), and **CLI login**:
  Claude Code, Codex, OpenCode and **Google Antigravity CLI** (`agy` 1.5.4, stream-json over stdin) — all verified end-to-end on this machine.
  CLI providers are localhost-only, prompts go via stdin/file, model ids are sanitised; "Test connection" + CLI detection in Settings.
  Fixed: Settings provider/model/key were never sent to the server before.
- [x] **Connection picker + fallback chain** (2026-11-14, `server/ai/fallback.ts`, `src/components/AIConnectionPicker.tsx`): choose the
  connection and model right in the chat (CPU button on the prompt bar, and under the drawer prompt; ● = ready, ○ = not set up).
  Settings → AI → "Fallback connections" holds an ordered backup list; when a connection fails (not configured, CLI missing / not
  signed in, 429 / quota, timeout, server error, non-JSON answer) the server tries the next one in the same request
  (`x-ai-fallback` header). A failed connection cools down (rate limit 5 min, auth 2 min, timeout 1 min) and is tried last meanwhile,
  so later patch-loop rounds don't wait on it. The answering connection comes back in `x-ai-used-provider` / `x-ai-fallback-note` and
  as an "AI connection fallback" line in the chat reply. All connections unconfigured → 503 → offline director, as before.
  Connection test checks only the selected connection. Verified live: Gemini without key → Claude Code CLI answered.
- [x] **Projects** (`server/workspace/*`, Project Hub): `~/OmniStage/projects/<project>/games/*.scenespec.json` (+ shared `assets/`),
  one game or a collection of games sharing assets, autosave (2.5 s debounce, Ctrl+S), deletes go to `.trash`. Game files are MCP-compatible.
- [x] **Personal library** (`~/OmniStage/library`) + project-shared library, upload/place/delete from the Library tab.
- [x] **Extensions** (`src/extensions/*`, Extensions manager): manifest with skills, particle presets, SFX presets, asset libraries and
  commands; code runs in `<iframe sandbox="allow-scripts">` + CSP `default-src 'none'` with a permissioned `window.omni` RPC
  (scene read/write via verifier + undo, notify, declared-host fetch). Static risk review + optional AI review; install only after the user
  approves every permission. Install from the built-in catalog (5 packs), https URL, manifest file, or **"Create with AI"** (director drafts a
  pack). The director **recommends** catalog extensions in chat. Enable/disable/uninstall globally or per project; built-in skills can be
  switched off. Extension presets are copied into `SceneSpec.particleLibrary` / `sfxLibrary` so scenes stay portable (export, MCP).
- [x] **Memory** (`~/OmniStage/memory`, Settings → Memory): "nhớ rằng… / remember…" in chat, confirmed suggestions from preference
  statements, pin/edit/delete, global or per project; up to 8 relevant memories injected per AI turn.
- [x] Tech stack evaluation: `docs/research/tech-stack-evaluation.md`. Tests: 58 (`npm run verify`). Fixed esbuild peer conflict that broke `npm install`.

## 3. Roadmap after Phase 6 batch 1 (re-prioritised 2026-11-10)

Goal clarified by the product owner: **multi-platform games, including native iOS and Android apps**, alongside web, playable ads and
Telegram; and **automatic rigging + animation of (often AI-generated) 3D characters**. Analysis and sources:
[`docs/research/mobile-and-character-pipeline.md`](docs/research/mobile-and-character-pipeline.md),
[`docs/research/tech-stack-evaluation.md`](docs/research/tech-stack-evaluation.md).

Conclusion: the TypeScript + SceneSpec + web-runtime foundation is the right base for iOS/Android (native shell via Capacitor), but
mobile was never an explicit target. Every mobile path and every rigged-character export depends on **one shared Player runtime**,
so that moves to the front.

### Phase 6 — Batch 2 "Play & Learn" (Completed 2026-11-10)
- [x] **Play Test** (top bar ▶ in Game Mode): runs the exported playable (exactly what ships, Three.js inlined) in a sandboxed iframe;
  start-from-level, restart, device frames (fit / phone portrait / phone landscape / tablet), FPS + worst-frame meter, per-level verifier panel.
- [x] **Play on phone**: `POST /api/play/session` (localhost only) stores the build; phones on the same Wi-Fi open
  `http://<LAN-IP>:<port>/play/<token>` from a QR code. 128-bit tokens, 4 h expiry, read-only; every private API answers 403 over the LAN
  (verified from the LAN address). Phones use the exported runtime's touch buttons. Studio-viewport touch input moves to Phase 7 (Player runtime).
- [x] **Full preview** (top bar ▶ in Media): storyboard order (nextSceneId chain, else index / project order), fade transitions, captions,
  audio cues, progress per scene, ←/→/Space/Esc, end card with replay; undo history is restored on exit.
- [x] **Guide**: Help center (13 topics, VI/EN, search, "Try it" buttons), first-run tour (6 highlighted steps), and "how do I…?" questions
  in the chat answered from the Guide in the user's language without an AI call.

### Phase 7 — One OmniStage Player runtime (7A, 7B and 7C completed 2026-11-10)
**7A — shared runtime + Player (done)**
- [x] **Shared runtime** (`src/runtime/*`, framework-free): game rules / timeline / logs / level progression extracted from the studio store
  into `gameSlice.ts`; logic-graph interpreter + contacts (`logicGraph.ts`), 2D frame step / physics / drawing / hit test (`stage2d.ts`),
  graph sync and terrain math. Both the studio store and the Player store compose the same slice; runtime modules talk to whichever store is
  bound in `host.ts`. StageCanvas2D shrank from ~1,000 to ~260 lines and now runs `stepStage2D` — the exact frame the Player runs.
- [x] **OmniStage Player** (`src/player/*`): vanilla store + shared slice, 2D view (shared frame step), 3D view in plain Three.js (sky
  gradient, terrain height field, water, scatter, weather, GLB actors with skeletal clips via AnimationMixer + cross-fade, procedural
  stand-ins per asset category, studio camera modes incl. eased keyframe flythrough, VFX, collect bursts), HUD (score/timer/level, sound,
  fullscreen, 3D captions, marketing CTA), end cards with next level / retry / replay, media sequences, Telegram / MRAID / Meta CTA bridges.
- [x] **Unified input**: keyboard, on-screen touch controls (platformer ◀▶+JUMP or d-pad+ACT, safe-area aware), gamepads, programmatic keys;
  responsive letterboxing for 16:9 / 9:16 / 1:1; quality auto-profile (low on weak touch devices: DPR 1, no AA/shadows).
- [x] **One build for everything**: `scripts/build-player.mjs` → `src/exporter/generated/playerRuntime.ts` (~740 KB / ~200 KB gzip incl.
  Three.js), lazily loaded. Exports, ZIP, MCP export, Play Test and phone preview all use it; the hand-written export runtime and the separate
  inlined Three.js build were removed. A test rebuilds the Player and fails if the generated file is stale.
- [x] **Embedded assets**: GLB models and images are embedded as data URIs smallest-first within the network budget; anything that does not fit
  stays online and is reported (`offlineReady=false`). Verified: RobotExpressive.glb (453 KB) embedded, 1.36 MB HTML, offline.
- [x] `step(dt)` / `setKey()` hooks for deterministic testing; verified in the browser: 2D movement + level win → Next level → 3D level with
  GLB robot, WASD collect (+25), bursts, CTA.

**7B — one set of 3D builders for studio and Player (done)**
- [x] **Shared scene builders** (`src/render3d/*`, plain Three.js, no React): lighting rig, background/fog, studio reflection environment,
  pedestal, shader sky, stars, height-field terrain, planar-reflection water (cheap plane on low quality), clouds, GPU particles (weather,
  sparkles, confetti, bursts), scatter props, VFX nodes, badges, all 11 procedural composite actors and the procedural actor motion.
  Readable JSX is kept: files with `/** @jsx h */` compile to Three.js objects through the tiny `h()` factory, not React.
- [x] **Studio viewport renders through the same builders**: R3F components became thin hosts (`<Built>` → `<primitive>` + per-frame
  `update`), so editing tools (gizmos, selection, orbit, drei Grid/ContactShadows/HDRI) stay in React while every visual object is
  identical in the editor, Play Test, phone preview and exports. Decision: the R3F tree is kept as the editor host instead of mounting the
  Player inside the studio — parity comes from shared builders, without re-implementing gizmos.
- [x] **Player gains the studio look**: reflective water, clouds, scatter props with full geometry, GPU weather / VFX / bursts, the real
  composite assets (gift box with tap-reactive lid and glow, mecha, knight, car, portal…) instead of category stand-ins, unbox badge,
  click pulse, media enter effects, HDRI via RGBELoader (embedded when it fits), registry GLB models (now also embedded for offline).
- [x] **Studio viewport overlay**: FPS / worst-frame meter, render-quality selector (Draft = DPR 1 + no shadows, like weak phones), and
  on-screen touch controls (same layout as the Player via `src/runtime/touchLayout.ts`; buttons dispatch key events, so 2D/3D input and
  logic-graph key events work unchanged; auto on touch screens, "📱 Touch" toggle on desktop).
- [x] Tests: `tests/render3d.test.ts` (factory, all composites, motion rules, world builder, rig, particles). Player bundle ~215 KB gzip.

**7C — patch edits, store slices, E2E, last shared visuals (done)**
- [x] **AI edits as JSON Patch in a tool-use loop** (`src/agent/patchLoop.ts`, `POST /api/agent/patch`): the model returns
  `{ mergePatch?, ops[], diffSummary, done }` instead of a whole SceneSpec; OmniStage applies it, finalizes the logic graph, auto-fixes
  and verifies, then sends rejected patches / verifier errors back as a TOOL RESULT (up to 3 rounds, never accepting a round that makes
  verification worse). Plain JSON, so it works for every provider including local CLIs. Array items are addressed by id
  (`/actors/@hero/position`); `move`/`copy` added (also for MCP `omnistage_apply_patch`). Settings → AI "How the AI edits your scene"
  keeps the old full-rewrite mode for weak models; no provider → offline director as before.
- [x] **Studio store split into slices** (`src/state/slices/*`: logic graph, scenes, world, actors, stage content, agent, workspace;
  types in `studioTypes.ts`, initial state in `storeHelpers.ts`). `useStudioStore.ts` went from ~1,960 to ~120 lines; a test checks
  every `StudioState` member is still provided.
- [x] **Shared contact shadows, shader grid and ambient dust** (`src/render3d/contactShadows.ts`, `createGroundGrid`,
  `createAmbientDust`): the studio no longer uses drei's ContactShadows / Grid / Sparkles; the Player gets the same objects.
  `Built3D.prerender` runs off-screen passes (shadow depth) in both hosts.
- [x] **Bloom on Ultra** (`src/render3d/postfx.ts`, Unreal bloom + OutputPass): studio quality "Ultra" + Bloom setting, Player
  `quality: 'ultra'` (export option). The existing "Enable bloom" setting now actually does something.
- [x] **Playwright E2E** (`npm run test:e2e`, `e2e/*.e2e.ts`): builds real exported HTML, stops the rAF loop (`__omniPlayer.manual(true)`)
  and drives frames with `step()`: 3D render high/ultra (pixel stats, no console errors), coin-rush scoring with held keys, tap-to-unbox,
  2D platformer run (`inspect()` exposes live 2D bodies). Uses the installed Chrome (no browser download; `OMNI_E2E_CHANNEL` overrides).
- [x] **Bug found by E2E**: when a logic graph reacted to a tap, the gift box skipped its own unbox counter, so "Tap to Unbox" could never
  be opened or won (studio and exports). Shared rule `clickRunsBuiltIn` (`src/runtime/gameSlice.ts`) now keeps unbox progress.
- [x] **WebGPU renderer for the Player (done 2026-11-13)** — Phase 7 complete.
  - The custom GLSL parts are ported to TSL node materials (`src/render3d/webgpu`): shader sky, reflective water (`reflector()` node with
    the same wave / fresnel / specular maths), the anti-aliased grid, GPU particles (instanced sprites — WebGPU has no large points; same
    seeds and motion for all 7 kinds), node PMREM studio environment and node bloom (`RenderPipeline` + `BloomNode`) on Ultra.
  - Builders stay shared: `src/render3d/backend.ts` routes those parts to the node backend only when the Player installed it; contact
    shadows step aside under WebGPU (shadow maps ground the actors). The studio viewport stays on WebGL (R3F editor host).
  - Two Player builds: the default WebGL runtime is unchanged (861 KB, no three/webgpu inside — a test checks it); the WebGPU runtime
    (1.5 MB) is embedded only when an export picks "WebGPU where available" (Publish → 3D renderer, `renderer: 'auto' | 'webgpu'`).
    It initialises the device before the first frame and falls back to WebGL when the device has no adapter. The MP4 exporter accepts
    the same option.
  - Tests: `tests/webgpu.test.ts` (backend switch, runtime selection); `e2e/webgpu.e2e.ts` renders the same scenes with both renderers at
    the same frame (open world with water, waterfall valley + grid + snow, ultra bloom) — `npm run test:e2e:gpu` on the real GPU
    (SwiftShader has no WebGPU adapter, so the default E2E run skips them).
  - Not yet: WebGPU in the studio viewport (R3F async renderer); contact shadows as a node pass.

### Phase 8 — Mobile native (Android first, then iOS) — v1 done 2026-11-14
Publish → "Mobile App" tab (`src/components/MobileExportPanel.tsx`, pure builders in `src/exporter/mobileExport.ts`, tests in
`tests/mobileExport.test.ts`).
- [x] **PWA export**: zip with `index.html` (Player), `manifest.webmanifest` (fullscreen, orientation, maskable icon), `sw.js`
  (cache-first, versioned cache per appId/version/build), icons. Service worker registers only over http(s).
- [x] **Android**: Capacitor 8 project zip (`www/`, `capacitor.config.json`, `resources/` for `@capacitor/assets`),
  `scripts/configure-native.mjs` sets SDK 36, versionCode/versionName, orientation and a release signingConfig read from
  `keystore.properties` (git-ignored; passwords never on the command line). `npm run android:debug` / `android:release` (AAB).
- [x] **iOS**: same project, `npx cap add ios` on a Mac, or `codemagic.yaml` (user's own Codemagic account) for TestFlight.
- [x] **Native capabilities v1**: haptics, persistent saves (best score, cleared levels, resume level — `src/runtime/progress.ts`),
  pause/resume on app background (`src/player/native.ts`, Capacitor plugins with web fallbacks; only active in app builds).
- [ ] Deferred: Game Center / Play Games leaderboards, in-app purchases, ads SDK, push — each needs store accounts, SDK keys and
  policy review per app; listed as "later" in the panel.
- [x] **Store assistant**: icons 192/512/maskable/1024 and 2732 splash from the stage, store screenshots (1290×2796),
  data-safety report + privacy policy draft, checklist (identity, orientation, offline, SDK 36, signing, closed testing 12×14 days).
- [x] Mobile verifier rules (`verifySceneSpec(spec, { target: 'mobile' })`): `mobile.text-small`, `mobile.touch-target`,
  `mobile.edge-ui` (fixable), `mobile.heavy-scene`, `mobile.keyboard-only` (warnings). Orientation is a checklist item.
- [x] Rig cost in the mobile budget (2026-11-16): OmniRig characters carry `actors[].rigCost` (bones, skinned vertices, texture size)
  measured on placement; `mobile.rig-cost` warns above 150k skinned vertices, 12 rigged actors, 100 bones or 2048 px textures.
- [x] Per-device performance profiles — machinery (2026-11-16): low / mid / high tiers as data (`src/runtime/deviceProfiles.ts`;
  `mid` = `MOBILE_REFERENCE`), `verifySceneSpec(spec, { target: 'mobile', deviceTier })` (same rule ids; particle budget under
  `mobile.heavy-scene`). App builds detect the tier (cores, memory, GPU string, screen) and run an adaptive governor
  (`src/runtime/qualityGovernor.ts`: bloom → pixel ratio → shadows → particles, hysteresis + oscillation lock); never in ad
  exports or frame-stepped capture. Hidden overlay (5 taps top-left / `?omniPerf=1`), `__omniPlayer.perf()`, report saved
  under `omnistage.perf.<appId>`. Guide: `docs/mobile-performance.md`.
- [ ] Measure the tier budgets on real phones and fill in the table in `docs/mobile-performance.md`; 2D quality steps.

### Phase 9 — Character pipeline "OmniRig" (auto-rig + animation) — v1 done 2026-11-13
Order check (2026-11-13): Phase 9 before Phase 8 has no conflict — both only need the shared Player (Phase 7) and the library /
extensions (Phase 6), and neither consumes the other's output. Phase 8's mobile budgets will later include rig cost (bones,
vertices, texture size of OmniRig characters).

**Done (v1, all local and deterministic, `src/rig/*`, World → Assets → "Auto-rig a character")**
- [x] Analysis & normalisation: area-weighted surface sampling, up axis (lying models detected), facing at ANY yaw (horizontal PCA +
  mirror symmetry; front/back from toes in front of each ankle), height normalised (humanoid 1.8 m), triangle-count warning.
- [x] Classification by geometry (ground contacts in thin slices, proportions, arms at shoulder height) with a confidence; the user
  picks the type when unsure. (Vision-LLM cross-check: not yet.)
- [x] Joint finding without ML: legs from horizontal slices (crotch = highest slice with two separate legs; touching legs fall back to
  body proportions with a warning), arms from slices across x (T / A pose), neck at the narrowest slice above the shoulders; mirror
  symmetric. Mixamo-named humanoid skeleton (27 bones), quadruped skeleton (legs, spine, neck, tail), one-piece prop rig.
- [x] Skin weights Pinocchio-style without a solver: voxel solid + visibility (a bone only influences vertices it can "see" through the
  body), inverse-distance falloff, fade behind each joint, smoothing over welded neighbours, 4 bones per vertex.
- [x] Validation: arms-raised / squat / stride (quadruped: gallop reach / head down) with linear blend skinning; edge stretch p95,
  volume change, flipped triangles → score and A–D grade.
- [x] Animation: procedural clips with the names the AI already uses (Idle, Walking, Running, Wave, Jump, Yes, No, Sitting, Dance;
  quadruped Idle / Walking / Running / Sitting), stride from leg length; rest-pose retargeter (`retargetClip`, tested).
- [x] Manual fix: drag joints in the preview (left / right stay mirrored) → re-skin + re-validate. Characters saved to My Library as a
  rigged GLB (opaque textures as JPEG, ≤ 2048 px) + `rig.json` in the asset meta, and placed with their clips and real size.
- [x] Checked on real models: Soldier (B, 81), Expressive Robot (C, 65 — big head / thin arms), Fox (B), Horse (B, 2 of 4 feet found
  → warning). Tests: `tests/omnirig.test.ts`.
- [x] (2026-11-14) Big meshes: rigging runs in a Web Worker (`rig.worker.ts` / `rigJobs.ts`, main-thread fallback); above 300k
  triangles the mesh is decimated (vertex clustering, ≤ 100k) for skinning + validation and weights are transferred back to every
  vertex — the mesh keeps its detail (305k-tri test: 99.7 % same dominant bone, ~2× faster).
- [x] (2026-11-14) Clip library import: "Import clips (Mixamo .glb)" in the OmniRig dialog → bones matched by name (`mixamorig`
  prefixes stripped), clips retargeted with `retargetClip` (+ rest-direction matching for A-pose vs T-pose), hips motion scaled and
  kept in place; Walking / Running … replace the generated clips. Checked: Soldier.glb → 22/22 bones, 4 clips.

- [x] (2026-11-16) Pose layer after the clips (`src/render3d/rigPose.ts`, studio + Player): head look-at (neck 40 % / head 60 %,
  yaw ±70°, pitch ±30°, eased weight) driven by `gazeAt` in `src/runtime/cinematics.ts` (speaker ↔ listener during a line, else the
  latest `lookAt` step until the next walk); foot IK on terrain (two-bone legs, feet follow the ground under them, pelvis drops for
  the lower foot, steps over 0.6 m ignored, only while the actor stands on the terrain). Bones the mixer does not drive are reset
  first, so nothing accumulates. Tests: `tests/rigPose.test.ts`.

**Not yet**
- [ ] Vision-LLM classification / scoring of rendered views; MediaPipe landmarks for arms-down (I-pose) characters.
- [x] Spring bones (2026-11-16): tail / hair / ear / cape chains swing from the root's past acceleration (damped spring as a
  convolution, so scrubbing and frame-stepped exports match); films only, in `RigPoseLayer`.
- [x] FBX clip import (2026-11-16): OmniRig "Import clips" accepts Mixamo `.fbx` (FBXLoader) as well as `.glb`; not yet checked
  against a real Mixamo download.
- [x] LLM state machine JSON (2026-11-16): `actors[].stateMachine` / `nodes2D[].stateMachine` = states with moves (patrol, chase,
  flee, move-to, return-home), closed-list conditions and actions; interpreted by `src/runtime/stateMachine.ts` (studio, Play Test,
  Player; seeded, game mode only); verifier `machine.*` (auto-fixed), prompt + `behaviour-state-machines` skill, inspector badge.
- [ ] Weight painting.
- [x] Bird / serpent templates (2026-11-16): `bird` = thin wings spread wide at mid height + legs (spine, neck, head, 3-bone
  wings, 2 legs, tail; clips Idle / Walking / Running / Flying / Gliding / Peck; stress poses wings up / down, peck); `serpent` =
  long and low, normalised to 2 m long (10–16 spine bones + head + jaw; travelling-wave slither Idle / Walking / Running + Attack;
  coil / S-curve / rear up). Both auto-detected or picked in OmniRig; samples grade A on the synthetic meshes.
- [x] Finger bones (2026-11-16): open hands with separated fingers get Mixamo chains (`mixamorigLeftHandIndex1..4` …, thumb
  included) from a 2D distance transform of the hand in the palm plane; weights stay on one finger per vertex; clips curl the
  fingers; Mixamo finger tracks retarget. Mitten / touching / curled fingers keep one hand bone with a warning. Not yet checked
  on real models.
- [x] Provider plugins (2026-11-16): Meshy rig + animation (`meshy-rig-animator`: rigging → animations with Animation Library
  action ids) and Tripo rig + retarget (`tripo-rig-animator`: v3 upload → rig → retarget presets, biped + quadruped), BYO keys.
  The source is a GLB from My Library; the result's clips are renamed to Idle / Walking / Running… (`server/generate/glb.ts`)
  so `matchClipName` and the AI drive them; placing it registers a `gltf-rigged` entry with those clips. Mocked HTTP only —
  not yet run against the real APIs.
- [ ] UniRig / Puppeteer via an optional local GPU ML server.

### Phase 10 — Media Production (analysis: `docs/research/media-production-upgrade.md`)
Why AI films feel flat: SceneSpec cannot express acting over time, multiple shots, dialogue or a soundtrack; the video export has no audio;
the verifier only checks playability. Fix in layers: contract → production tools → director skills → quality judge.
- [x] **10A (done 2026-11-11)** Acting, shots and transitions, shared by studio, Preview, Player and video export
  (`src/runtime/cinematics.ts`):
  - `actor.performance[]`: timed clips, `moveTo` walks with auto Walk/Run on the terrain, `lookAt` / `faceDeg` with eased turns,
    `arriveClip`; shared fuzzy clip matching (Walk → Walking).
  - `camera.shots[]`: establishing / wide / medium / close-up / over-shoulder / low / high / tracking, moves push-in / pull-out /
    crane-up / orbit / pan. Shots are hard cuts framed on wherever the subject is. They avoid occluding actors (move in, then swing ≤ 50°
    for close-ups). In Preview the shot holds while paused.
  - `sequence.transition` (cut / fade / fade-white / crossfade / wipe) in Preview, Player and the video sequencer. Preview hides editor
    gizmos.
  - Storyboard planner writes a timed **script** per media beat; scene authoring turns it into performance + shots; continuity passes
    where each character ends.
  - AI actor ids and performances survive normalisation (shot / lookAt references used to break).
  - Skills: `character-acting`, `scene-dressing`, shot grammar rewritten for `camera.shots`.
  - Verifier: performance / clip / lookAt / shot / transition validity with auto-fixes, plus craft hints `media.hero-static`,
    `media.single-shot`, `media.bare-stage`. The patch loop takes a `qualityPenalty` so AI film shots get up to 2 polish rounds until
    those are gone.
  - Offline director: acting arcs, 4-shot lists and a dressed set (no grid floor).
  - Tests: `tests/cinematics.test.ts` (composition: nobody blocks the subject, close-ups / over-shoulders see the face) and an E2E film
    test (walk + cut in the exported Player).
  - Real AI run (Claude Code CLI, 2026-11-12): 3-scene robot film in ~8 min, timed scripts, 5-6 performance steps per hero,
    4-6 shots per scene, continuity of positions, shot / reverse-shot over-shoulders; verifier clean, no polish round needed.
    Fixes from it: an authored shot `fov` is a lens (distance compensates, so close-ups stay close-ups); seated performers are
    framed lower; over-shoulder offsets come from the foreground actor's size (camera was inside the robot's head); prompt says
    which actor is `partner`; outdoor fog follows the sky horizon (dark studio fog made dark clouds / horizon); AI terrain without a
    colour gets a natural one (was near-black); leaving the page with unsaved work and no open project now asks first.
  - Not yet: sound (10B), dialogue (10C), a real waterfall / water props (the AI faked one with a laser beam).
- [x] **10B (done 2026-11-13)** Sound, biomes and a frame-perfect MP4:
  - `sceneSpec.soundtrack` = mood music (calm / happy / playful / adventure / epic / tense / sad / mysterious), ambience ('auto' follows
    the world: forest, meadow, beach, river, waterfall, rain, wind, night, city, cave, space) and timed SFX cues (new foley: chime,
    splash, footstep, pop). `src/audio/soundtrack.ts` renders it to PCM in plain JS (wavetables, Karplus-Strong plucks, seeded noise),
    deterministic and unit-tested; music sits on a global bar grid so same-mood shots continue across cuts. Live playback follows the
    timeline in the studio, Preview and the Player (`soundtrackPlayback.ts`, installed by the audio bus).
  - MP4 export (`src/exporter/filmExport.ts`): the exported Player runs in a hidden iframe with its clock stopped; each frame is one
    `step(1/fps)`, composited (letterbox, transitions, 3D captions, badge) and encoded with WebCodecs via Mediabunny; the whole film's
    soundtrack is muxed as AAC/Opus. The Player waits for its asset loads before frame 1. WebM / browsers without WebCodecs keep the
    real-time sequencer, which now records the soundtrack too.
  - Biomes (`src/runtime/biomes.ts`): forest, meadow, beach, desert, snowy-peaks, waterfall-valley, night-forest, city-night dress sky,
    terrain, 4-6 prop layers (new: broadleaf trees, bushes, flowers, grass tufts, palms, cacti), water and outdoor light.
    `world.features` = real animated waterfall (cliff, scrolling sheet, pool, foam, mist), river (meanders on the terrain) and pond;
    props keep out of the water.
  - AI: prompt sections for SOUND, biome and features; `sound-design` skill; normaliser keeps soundtrack / biome / features and expands
    a bare `{ biome }`; offline director picks a biome (waterfall when asked) and a mood arc. Verifier: `media.silent` craft hint,
    `soundtrack.invalid`, `world.biome-invalid`, `world.feature-invalid`, `world.feature-on-stage` (all auto-fixed).
  - UI: World tab → Film Soundtrack panel, Biome & Water section; Publish → MP4 is frame-perfect with a Soundtrack switch.
  - Tests: `tests/soundtrack.test.ts`, `tests/biomes.test.ts`, E2E waterfall-valley film in the exported Player.
  - Not yet: dialogue / TTS (10C); lighting presets per biome are a patch, not a full outdoor rig.
  - [x] Footsteps synced to walk cycles (2026-11-16): `src/audio/footsteps.ts` lands a step every half stride actually travelled
    (runs faster and louder), mixed into the film soundtrack; `soundtrack.footsteps: false` turns them off.
- [x] **10C (done 2026-11-13)** Dialogue:
  - `sceneSpec.dialogue[]` = { time, speaker, text, emotion?, listener? } + `actors[].voice` { engine piper | babble, voiceId, pitch, rate }.
    `src/audio/voices.ts` (pure) times lines, writes captions (speaker-prefixed when several talk), drives talk levels and mixes the voice
    track (levelled lines, music / ambience duck under speech) into the soundtrack renderer.
  - Real voices: Piper neural TTS in the browser (`src/audio/piperVoice.ts`, @mintplex-labs/piper-tts-web + onnxruntime-web 1.18,
    Vietnamese `vi_VN-vais1000-medium` by default; model ~60 MB downloaded once). Clips are cached in IndexedDB by content key,
    restored on reload, embedded as WAV in HTML5 exports and the MP4 export. Without a clip a line speaks with the procedural
    "babble" voice (syllables with vowel formants and Vietnamese tone contours from the diacritics) — deterministic, offline.
  - Talk motion: speakers nod / lean with the voice envelope and turn to their listener (eased in and out), in studio, Player and MP4.
  - AI: DIALOGUE prompt section, `dialogue-writing` skill, normaliser keeps lines and voices, offline director writes a short exchange
    in the prompt's language. Verifier: `dialogue.invalid`, `dialogue.overlap`, `dialogue.cut-off` (auto-fixed).
  - UI: World tab → Dialogue (lines, emotions, listeners, per-character voice + pitch, hear a line, Generate real voices).
  - MP4 capture fix: the hidden Player iframe is kept in the viewport (scaled) and laid out explicitly — off-screen iframes did not
    run layout, which squeezed frames in small windows.
  - Tests: `tests/dialogue.test.ts`, E2E dialogue in the exported Player.
  - Real AI run (Claude Code CLI, 2026-11-13): 3-scene robot + fox film in ~3 min, verifier clean on the first pass; the AI used
    biomes (forest, waterfall-valley), a waterfall + pond, a mood arc (calm → happy → epic), 4-5 cues per scene, 10 Vietnamese lines
    with emotions / listeners and distinct voice pitches. 10 Piper voices in seconds, 34 s MP4 with sound in ~6 s.
    Fixes from it: pitch shifts keep the tempo (WSOLA; the fox talked 26 % faster), shots avoid blockers for the whole shot and also
    with authored angles (the AI always sets one), blockers are judged by how much of the frame they fill (a fox beside the sight
    line still filled half a close-up), the camera follows the talk turn, over-shoulder distance comes from the partner's width and
    its sight line passes beside the partner's body.
  - Not done: CC0 Quaternius animation library retargeting (gesture clips per emotion); lip-sync visemes (models have no mouth rigs);
    voice clips are per browser (a project opened elsewhere falls back to babble until voices are generated again).
- [x] **10D (done 2026-11-14: director QA + ElevenLabs)** Paid production tools + director QA:
  - Director QA (`src/agent/directorQA.ts` pure, `src/agent/directorQARunner.ts`, `src/media/directorKeyframes.ts`): one keyframe per
    camera shot (midpoint, ≤ 4), rendered on the real exported Player (frame-stepped like the MP4 export) and tiled into one labelled
    JPEG contact sheet, so every single-image vision provider works. `/api/agent/vision-qa` with `mode: "director"` returns a 0-100
    score + findings (framing, composition, staging, acting, lighting, continuity, readability; tile, target id, fix). Under the
    threshold (Settings → Production tools, default 70) the findings drive ONE extra patch round (`runDirectorQARound` on the patch
    loop); a round that raises verifier errors / craft issues is dropped and scene identity is kept. Runs after the 10A polish on AI
    3D film shots in the storyboard agent; notes appear in the storyboard diff summary.
  - Vision only: `GenerateRequest.requireVision` makes CLI providers throw `ProviderUnavailableError` (a fallback chain skips them);
    the studio skips director QA when the active connection has no vision (`AI_PROVIDERS[].vision`).
  - ElevenLabs, bring your own key (Settings → 5. Production tools; or `ELEVENLABS_API_KEY`, used only for requests from this computer):
    local proxy `/api/media/elevenlabs/{status,voices,tts,sfx,music}` (`server/media/elevenLabs.ts`), key sent upstream as
    `xi-api-key`, never logged, echoed (errors are redacted) or stored in SceneSpec. Shared request builders in
    `src/audio/elevenLabs.ts` (emotion → voice settings; v3 audio tags only for `eleven_v3*`).
  - `VoiceEngine` adds `'elevenlabs'` (+ `actors[].voice.elevenLabsVoiceId`, per-line `dialogue[].engine` override). Dialogue panel:
    ElevenLabs per character (voice list from the account) or per line; Generate voices speaks those lines with ElevenLabs (24 kHz
    PCM), caches them like Piper clips (same IndexedDB / export path) and saves a WAV copy + licence record to the library. The AI
    never picks ElevenLabs on its own (paid).
  - Licences: every generated file goes to the project library (personal library outside a project) with source `elevenlabs`, a
    short licence line and `meta.licence` { provider, tool, model, voiceId, prompt, generatedAt, terms, note }. SFX / music
    generator in Settings saves to the library and adds an audio track.
  - Tests: `tests/directorQA.test.ts`.
  - (2026-11-16) Manual "Director QA" button (AI drawer header + command bar) for any 3D scene with keyframes; runs even when
    automatic Director QA is off, asks for a vision connection otherwise; the result is undoable like an AI turn.
  - (2026-11-16) Blockade Labs skybox generator (`blockade-skybox-generator`): prompt → equirect JPG in My Library → "Use as
    sky" sets `world.hdri` with the new `format: 'image'` (studio TextureLoader + drei Environment map; Player TextureLoader);
    verifier `world.hdri-invalid`. Meshy animation: see Phase 9 provider plugins. Mocked HTTP only.
  - Not done: a real vision-model run on a generated film; real-key runs of Blockade / Meshy / Tripo rig.

### Phase 11 — Film quality & traction (analysis: `docs/research/film-quality-and-commercialization.md`)
Why films feel boring and disjointed: every scene is authored alone, there is no story plan to measure against, and nothing tracks
quality between pipeline changes. Fix: write the story first, then a number that proves the film got better.
- [x] **11A (done 2026-11-16)** Story Bible + film eval:
  - `StoryBible` (`scene.schema.ts`, optional on `sequence.bible` and `StoryboardPlan`): logline, theme, tone, 3 s hook, stakes, turn,
    payoff, cast (want / flaw / manner / signature gesture + clip / voice pitch) and one beat per scene (purpose, conflict, emotion
    start→end, ending pull), plus motifs (setup → payoff). Five templates: visual-gag, mini-journey, meet-cute, reveal-twist, story-ad.
  - `src/agent/storyBible.ts` (pure): writers' room = draft → sanitize → autoFix (structure only) → lint rubric (score = 100 − 15·errors
    − 6·warnings, pass 80) → ONE revise round with the findings → offline fallback when the score is under 40. Cast inventory comes from
    `ASSET_REGISTRY` (real embedded clips) so the writer only plans gestures a rig can perform (`strictClipMatch`: no silent Idle).
  - `POST /api/agent/storyboard/bible` (prompts built on the server from a structured `{draft, findings}`); the plan and every scene
    request carry the bible; scenes inherit voice pitch; the continuity summary now includes earlier dialogue. Game levels skip it.
    Offline mode attaches no bible (a placeholder story would not match the offline scenes).
  - `src/agent/filmEval.ts`: deterministic 0-100 score from the SceneSpecs (story 20, hook 8, acting 18, camera 14, sound 8, dialogue 6,
    continuity 16, technical 10; without a bible story is capped). `npm run eval:film` runs `eval/golden-prompts.json` (10 prompts),
    offline or live (`--server http://localhost:3000 --provider cli-claude`), saves to `output/eval/` and shows the change vs the last run.
  - Offline baseline (2026-11-16): mean 70, 0/10 prompts ≥ 80. Weakest: story 25 (no bible offline), continuity 54, dialogue 59.
  - Tests: `tests/storyBible.test.ts`, `tests/filmEval.test.ts`.
  - Not done: a live-AI eval run (needs a connection); showing the bible in the studio UI / letting the user edit it; Director QA and
    contact sheets inside the eval; real transitions (today overlays only) and cross-scene character continuity (the next P0).
- [x] **11B (done 2026-11-17, not yet run live)** Writers' Room + Meshy characters:
  - `src/agent/writersRoom.ts` (pure) + `writersRoomPrompts.ts` + `POST /api/agent/storyboard/room`: the MCA model applied to the script.
    Showrunner (rules, plans and asks at most 2 questions, never writes) → architect → character ∥ world → dialogue → continuity
    (rules, no AI) → editor (AI critique + 11A rubric, on a different connection when a fallback exists) → one fix round routed to
    the desk that owns each finding. Each desk may only write its own fields; locked desks are approved text; failed desks fall back to
    the offline template (marked). Score = 0.6 rubric/continuity + 0.4 editor, pass mark 80. The server builds prompts from a structured
    `RoomAskRequest`; the client never sends prompt text.
  - UI: `WritersRoomModal` (teams, desk status, edit anything, lock, note + revise, "Ask the editor again", Produce / Skip). Film and ad
    prompts open the room first; Settings → AI → "Writers' Room" turns it off. The approved bible skips `writeStoryBible`.
  - Meshy: `server/generate/meshy*.ts` drives the user's own pinned `meshy-cli@0.4.0` session (device login, no credentials read,
    estimate then `confirm:true`, preview → remesh to 30k triangles → retexture → rig → walking/running clips merged by `glbMerge.ts`; the first live run showed text-to-3d output is 1.2M triangles and Meshy rigs at most 380k, hence the remesh) into the asset library
    (`/api/meshy/*`, loopback). `MeshyCastPanel` (character desk): connect, see cost, tick the agreement, generate. A generated model is
    stored as `StoryCharacter.generated`; scenes are written on the stand-in rig and `applyBibleToScene` swaps the model and maps clips.
  - Tests: `tests/writersRoom.test.ts`, `tests/meshyCli.test.ts` (fake CLI), model swap in `tests/storyBible.test.ts`.
  - Not done / unverified: no live run of the AI desks or of Meshy (the CLI shapes are assumed from its docs; `npm run meshy:smoke`
    validates them, `--yes` spends credits); the UI was type-checked, not exercised in a browser; props with generated models are not
    placed in scenes yet (only characters are swapped); exported playables must embed the `/api/library/file/...` model (not checked).
  - GLB size (2026-11-17): the first live Meshy character was 25 MB (3 JPEG textures = 22.5 MB, 4K). `src/utils/glbOptimize.ts` (pure,
    codec injected, `tests/glbOptimize.test.ts`) re-packs the GLB with textures capped at 1024 px; geometry, skin and clips are copied
    byte for byte. `glbTextureCodec.ts` uses the browser (createImageBitmap + OffscreenCanvas), so no image library is needed
    (installing `jpeg-js`/`pngjs` for a server-side version was declined). My Library shows a "shrink textures" button on models over
    3 MB; the Meshy panel shrinks right after a generation. The original is always kept. Measured: 23.9 MB -> 2.8 MB, same 30,704
    triangles, 24 joints, 3 clips. The Meshy-panel auto-shrink path was not run live (it needs a paid generation); the same function
    ran from the library button.
  - Comics / interactive comics analysis: `docs/research/comic-interactive-comic-fit.md` (recommendation: storyboard grid view first).

- [x] **11C (done 2026-11-17, offline-tested only)** Film editor: seams between scenes (P0 #3 lint + #4b carry; plan in
  `docs/research/film-quality-and-commercialization.md` B1):
  - `src/agent/filmEditor.ts` (pure, no AI): `lintCuts` reports `cut.position-jump`, `cut.facing-jump`, `cut.axis-flip` (180° rule),
    `cut.jump-cut`, `cut.light-jump` (straight cuts in one place) and `cut.no-carryover`; `carryFromPrevious` / `editFilm` repair what
    needs no taste: characters present in both scenes resume where and how they ended (only when both scenes share a location, else the
    move is deliberate) and a straight cut that crosses the line gets its opening left/right angle mirrored, kept only if that clears
    the flag. Lighting and jump cuts are reported, never guessed.
  - Wired in `generateStoryboard`: each scene is carried from the previous one before polish / Director QA, leftovers go to the
    summary as "Editor: ...". Offline characters now keep one id for the whole film (`char-<assetId>`; before, every scene minted new
    ids, so nothing could carry). `filmEval` continuity gains a cut-grammar term (weights 35/20/15/10/5/15).
  - Offline baseline 2026-11-17: mean 75 (was 70), continuity 79 (was 54). Most of that gain is the stable ids (the eval counts
    carried characters now) plus the new term; the eval scores raw scenes, before `editFilm` runs.
  - Tests: `tests/filmEditor.test.ts`.
  - Still open in P0: #2 script line ids + `script.unperformable` / `script.uncovered` (coverage in the storyboard panel), #4a real
    cross-dissolve in the Player (MP4 export already crossfades from the previous frame; the Player and Preview still use an overlay),
    #4c J/L cuts, #4d whip-pan / iris, #4e film-wide music cues, #5 shared `locations[]`, vision QA of the cut pair (last frame A +
    first frame B).

### Phase 6 — Batch 3 "Generate" (runs alongside Phases 7–9)
- [x] Asset-generation providers as Extensions (2026-11-14): catalog extensions `meshy-3d-generator`, `tripo-3d-generator`
  (text → GLB; Meshy preview → PBR refine), `fal-sprite-generator` (FLUX schnell + background cut-out → transparent PNG) and
  `replicate-sprite-generator`. New `generate` permission + `contributes.generators`; adapters in `server/generate/providers.ts`
  (API/result hosts fixed server-side, https-only downloads, magic-byte check), jobs in `server/generate/jobs.ts`, routes
  `/api/generate/*` on the localhost-only workspace router. BYO key from Settings → Generation keys (localStorage, sent as
  `x-generate-key`, or env `MESHY_API_KEY` / `TRIPO_API_KEY` / `FAL_KEY` / `REPLICATE_API_TOKEN`), never stored or logged.
  Results land in My Library (personal or project) with source, licence and prompt; "Generate with AI" in My Library → Place.
  Tests: `tests/generate.test.ts`.
- [x] Remaining generators (2026-11-14): `rodin-3d-generator` (Hyper3D Rodin Gen-2.5, multipart create → status → download; its
  CDN is undocumented so results may come from any public https host via `ANY_PUBLIC_HOST`, key never sent there),
  `openrouter-image-generator` (sprite / sprite sheet / backdrop, one-shot base64) and `elevenlabs-audio-generator` (SFX + music,
  binary MP3, licence record). One-shot providers run as background "sync" jobs. Image-to-3D (Meshy v1 image-to-3d, Rodin
  images) reads the picture from My Library (`imageAssetId`, ≤ 15 MB, sniffed PNG/JPEG/WebP). Multi-frame sprite sheets
  (`frames` 2–8: fal, OpenRouter) save `meta.spriteSheet` and play animated when placed. Generated models get a Rig button that
  opens OmniRig with the model loaded. OpenRouter / ElevenLabs reuse the keys already saved in Settings. TTS stays in the existing
  dialogue voice pipeline (not a library generator).
- [x] AI-authored particle/SFX recipes (2026-11-14): the director may write `particleLibrary` / `sfxLibrary` recipes itself
  (prompt section + `custom-vfx-recipes` skill); shared sanitizers in `src/extensions/validate.ts`; verifier rule `recipe.invalid`
  (fixable: clamp, drop renamed built-ins / junk, max 24). Procedural tween + sprite-sheet animation already ship as data.
- [x] Shader effects as a FIXED set of parameterised, reviewed presets (never generated shader code — invariant 1):
  `actors[].shaderEffect = { preset: hologram|dissolve|toon|forcefield|lava|rainbow, color?, intensity? 0..3, speed? 0..5, progress? 0..1,
  progressTween? }`. Pure params in `src/runtime/shaderEffects.ts`; shared builder `ActorShaderEffect` (`src/render3d/shaderEffects.ts`,
  onBeforeCompile material twins, works on skinned GLTF + composites, clock = timeline time × speed) with its TSL twin in
  `src/render3d/webgpu/shaderEffects.ts`; verifier rule `actor.shader-effect-invalid` (fixable), prompt rule 14, normaliser, inspector
  control; WebGL e2e + WebGPU parity scene.

### Later
- [x] Desktop packaging (2026-11-16): `desktop/` Electron app runs the bundled server (`npm run build:server`) on 127.0.0.1, adds
  the AI CLI install dirs to PATH, Help → Diagnostics; NSIS + portable built on Windows (unsigned); dmg / AppImage configured,
  not built. Docs: `docs/desktop.md`. Playwright E2E was done in Phase 7C.
- [ ] Rapier3D + lightweight ECS.
- [x] SceneSpec → Godot 4 project (2026-11-16): `src/exporter/godotExport.ts` (Publish → Godot 4 project): tscn scenes, fixed
  GDScript templates for score / win-lose / movement / scene links, logic graph compiled to rule data; everything not converted
  (VFX, audio, cinematics, state machines, shader effects…) is listed as warnings + `OMNISTAGE_EXPORT_NOTES.md`. Not yet opened
  in a real Godot (the headless check runs when `godot` / `GODOT_BIN` is available).
- [ ] Further exporter plugins (consoles, Steam).
- [x] Deterministic video (WebCodecs) with audio — done in 10B; NodeGraphView wheel zoom uses a non-passive listener (2026-11-16).
