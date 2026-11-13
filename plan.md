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
- [ ] Later: optional WebGPU renderer (Three r17x WebGPURenderer + TSL) once the custom shaders are ported.

### Phase 8 — Mobile native (Android first, then iOS)
- [ ] **PWA export** (manifest, service worker, offline cache, install prompt) for instant phone distribution.
- [ ] **Android**: generate a Capacitor project (target API 36+), debug APK for sideload testing, signed AAB for Google Play; keystore wizard.
- [ ] **iOS**: Capacitor Xcode project; build on a Mac or via a cloud build (Codemagic / Capawesome / Capgo, user's own account); TestFlight upload.
- [ ] **Native capability plugins** (as Extensions): haptics, persistent saves, Game Center / Play Games leaderboards & achievements,
  in-app purchases, ads SDK, push — also what keeps apps above Apple guideline 4.2 "minimum functionality".
- [ ] **Store assistant**: icon/splash generation, screenshots from the Player, privacy/data-safety checklist, version & signing checks.
- [ ] Mobile verifier rules: touch-reachable UI, text size, performance budget per profile, orientation lock.

### Phase 9 — Character pipeline "OmniRig" (auto-rig + animation)
- [ ] Import analysis & normalisation (weld, clean, decimate > 300k faces, unit scale, up-axis/facing via PCA + symmetry, watertight voxel proxy).
- [ ] Classification: vision-LLM JSON (humanoid / quadruped / bird / prop, facing, parts) cross-checked by geometry; ask the user when unsure.
- [ ] Humanoid auto-rig: render → MediaPipe Pose landmarks → back-project to mesh centres → fit Mixamo/VRM-compatible template
  (symmetry, bone ratios, consistent bone roll) → bone-heat skin weights (TypeScript, WASM when needed).
- [ ] Validation: stress poses (arm raise, squat, stride) measuring stretch / volume loss / self-intersection + vision-LLM score; rig quality grade.
- [ ] Animation: own rest-pose retargeter (not `SkeletonUtils.retargetClip`), clip library (Mixamo-format / licensed mocap / provider presets),
  procedural locomotion (stride from leg length), foot IK on terrain, look-at, spring bones; LLM outputs the animation state machine as JSON.
- [ ] Manual fix UI: joint gizmos, simple weight painting, "re-rig". Characters saved to the personal library (rigged GLB + `rig.json` + score).
- [ ] Provider / ML plugins: Meshy rig + animation, Tripo rig + retarget (BYO keys); UniRig / Puppeteer via an optional local GPU ML server
  for non-humanoid creatures. Quadruped / bird templates.

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
  - Not yet: dialogue / TTS (10C); footsteps synced to walk cycles; lighting presets per biome are a patch, not a full outdoor rig.
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
- [ ] **10D** Paid Production Tools via Settings/Extensions (ElevenLabs voice/music/SFX, Blockade skybox, Meshy animation), licences recorded
  in the project library; vision-model "director QA" scoring rendered keyframes → extra patch round.

### Phase 6 — Batch 3 "Generate" (runs alongside Phases 7–9)
- [ ] Asset-generation providers as Extensions (BYO key, server proxy, results saved to the library with license/source):
  3D (Meshy, Tripo, Rodin), 2D sprites (image models via fal.ai / Replicate / OpenRouter), audio (ElevenLabs SFX / music / TTS).
- [ ] VFX & animation by code as AI skills: AI-authored particle/SFX recipes (available now via extensions), GLSL shader effects in a
  validated sandbox, procedural tween/sprite animation, all reviewable and installable.

### Later
- [ ] Desktop packaging for non-coders (Electron; bundles the local server + CLI support); Playwright E2E; Rapier3D + lightweight ECS.
- [ ] Exporter plugins beyond the web runtime (e.g. SceneSpec → Godot project) for heavy 3D games, consoles and Steam.
- [ ] Deterministic video (WebCodecs) with audio; NodeGraphView passive `onWheel` fix.
