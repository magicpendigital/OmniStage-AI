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

### Phase 5: Next Handoff (Backlog)
- [ ] **OmniStage MCP server** (all agents): expose `get_scene`, `apply_patch`, `verify`, `export` so Claude Code / Codex can author scenes headlessly. Highest leverage for the MCA workflow.
- [ ] **Claude Code**: Rapier3D rigid-body physics; verifier rules for new physics roles; headless `claude -p` review job in CI once CI exists.
- [ ] **Antigravity**: playable size budget + real DEFLATE in the ZIP bundler (entries are stored uncompressed today);
  the standalone HTML still loads Three.js r128 from cdnjs, so 3D exports are not fully offline yet — inline or vendor it under a size budget.
- [ ] **Codex**: GLSL terrain splatmap + post-FX presets; skeletal animation retargeting; 2.5D billboard actors (2D characters in 3D worlds).
- [ ] **Media**: frame-stepped deterministic video render (fixed timestep + WebCodecs) instead of real-time MediaRecorder; caption track; shot-list view for storyboards.
- [ ] **2D**: spritesheet animation for `Node2D`; procedural 2D VFX preset library; timeline stagger helpers.
- [ ] **Audio (optional, BYO key)**: ElevenLabs SFX/TTS adapter through the server proxy, embedded within the export size budget.
