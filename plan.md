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

### Phase 7 — One OmniStage Player runtime (prerequisite for mobile and characters)
- [ ] Framework-free TypeScript player (Three.js + Canvas2D + WebAudio) shared by studio preview, play test, phone preview and every export;
  studio editor overlays (gizmos, inspector) sit on top. Ends the studio/export drift.
- [ ] Exports render real GLB actors (embedded within the size budget), world (terrain/sky/water), VFX and rigged animation.
- [ ] Unified input layer (keyboard, mouse, touch, gamepad) and responsive layouts (portrait/landscape, safe areas, notches).
- [ ] Device performance profiles (low/mid/high), frame-time budget overlay, WebGL2 default with optional WebGPU.
- [ ] AI edits as JSON Patch + tool-use loop (faster/cheaper than full SceneSpec regeneration); split `useStudioStore` into slices.

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

### Phase 6 — Batch 3 "Generate" (runs alongside Phases 7–9)
- [ ] Asset-generation providers as Extensions (BYO key, server proxy, results saved to the library with license/source):
  3D (Meshy, Tripo, Rodin), 2D sprites (image models via fal.ai / Replicate / OpenRouter), audio (ElevenLabs SFX / music / TTS).
- [ ] VFX & animation by code as AI skills: AI-authored particle/SFX recipes (available now via extensions), GLSL shader effects in a
  validated sandbox, procedural tween/sprite animation, all reviewable and installable.

### Later
- [ ] Desktop packaging for non-coders (Electron; bundles the local server + CLI support); Playwright E2E; Rapier3D + lightweight ECS.
- [ ] Exporter plugins beyond the web runtime (e.g. SceneSpec → Godot project) for heavy 3D games, consoles and Steam.
- [ ] Deterministic video (WebCodecs) with audio; NodeGraphView passive `onWheel` fix.
