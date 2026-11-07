# OmniStage AI — Master Architecture & Roadmap (`plan.md`)

## 1. Vision & Phase 3 Dual-Engine Architecture
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

### Phase 4: Downstream Multi-Agent Extensions (Next Handoff)
- [ ] **Claude Code**: Multi-scene level progression triggers & Rapier3D rigid-body physics solver.
- [ ] **Antigravity**: Automated MRAID 3.0 / TikTok Pangle / Meta Playable `< 2MB` ZIP asset compressor.
- [ ] **Codex**: Custom GLSL terrain splatmap shaders & skeletal GLTF animation retargeting.
