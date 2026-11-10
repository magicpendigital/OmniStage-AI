# AGENTS.md — Multi-Coding-Agent (MCA) Contract & Phase 3 Handoff Guide

Welcome to **OmniStage AI (Phase 3)**, an Agentic **3D WebGL & 2D Vector/Sprite Game & Programmatic Media Authoring Engine** engineered for a **Multi-Coding-Agent (MCA)** workflow across Google AI Studio, Claude Code, Antigravity, and Codex.

---

## 1. Core Architectural Invariant (Contract-First Design)

1. **Declarative State Driven (`SceneSpec` + Multi-Scene `scenes[]`)**:
   - Both the **3D WebGL Stage** (`src/renderer/StageCanvas.tsx`) and the **2D Vector/Sprite Stage** (`src/renderer/StageCanvas2D.tsx`) are 100% driven by the `SceneSpec` contract defined in `src/types/scene.schema.ts`.
   - **NEVER** generate or `eval` raw Three.js or Canvas2D code strings at runtime. All AI agent operations, user outliner/inspector edits, World Terrain Builder updates, and Vision QA fixes MUST mutate the central `SceneSpec` state via `src/state/useStudioStore.ts`.
2. **Strict Separation of Concerns (Phase 3 Module Map)**:
   - `src/types/scene.schema.ts` — Single source of truth for data structures (`SceneSpec`, `EngineType` (`'3d' | '2d'`), `WorldSpec`, `TerrainType`, `WeatherType`, `ScatterObjectSpec`, `ActorNode`, `Node2D`, `Physics2DRole`, `CameraRig`, `LightingPreset`, `VFXNode`, `GameRule`, `VisionQAReport`, `SettingsConfig`).
   - `src/registry/assetRegistry.ts` — Semantic 3D & 2D library:
     - **Real Rigged GLTF/GLB Models** loaded from verified CORS-safe CDNs (`RobotExpressive.glb`, `Soldier.glb`, `Horse.glb`, `Flamingo.glb`, `Parrot.glb`, `Fox.glb`, `DamagedHelmet.glb`) with embedded skeletal animation clip metadata (`availableClips`, `defaultClip`).
     - **Composite Multi-Part 3D PBR Assets** with explicit `boundingBox` and `attachmentSockets`.
     - **2D Vector/Sprite Authoring Presets (`PRESETS_2D`)** for 2D Platformer characters, solid platforms, collectible stars, kinetic typography, and parallax backgrounds.
     - **Blank Canvas Builders (`createBlankSceneSpec('3d' | '2d')`)** for from-scratch authoring alongside optional starter templates (`SCENE_TEMPLATES`).
   - `src/state/useStudioStore.ts` — Central Zustand state store managing:
     - **Multi-Scene Storyboard (`scenes: SceneSpec[]`, `activeSceneId`)** with `createNewBlankScene`, `switchScene`, `duplicateScene`, `deleteScene`, and `loadProjectBundle`.
     - **Undo/Redo History Stack** (`pastSpecs`, `futureSpecs`), timeline playback clock (`currentTime`, `isPlaying`, `isLooping`), and playable game runtime (`gameScore`, `gameTimeRemaining`, `gameWon`, `gameEnded`).
     - **World Environment Builder Mutations** (`updateWorld`, `updateTerrain`, `updateClouds`, `updateWeather`, `addScatterLayer`, `removeScatterLayer`).
     - **3D Actor & Custom Asset Mutations** (`spawnAsset`, `registerAndSpawnCustomAsset`, `registerActorClips`, `updateActorTransform`, `updateActorProperty`).
     - **2D Node Authoring Mutations** (`spawnPreset2D`, `addCustomNode2D`, `updateNode2D`, `duplicateNode2D`, `removeNode2D`).
     - **Persistent Studio Settings (`SettingsConfig`)** synced with `localStorage` (`updateSettings`, `resetSettings`).
   - `src/renderer/*` — Dual-Engine Renderers:
     - `StageCanvas.tsx` & `SceneDirector.tsx`: React Three Fiber (`@react-three/fiber`) 3D viewport, camera keyframe sequencer (`orbit-360`, `dolly-zoom-in`, `crane-reveal`, `top-down-isometric`, `first-person-follow`, `cinematic-flythrough`), WASD 3D player movement, and bounding-sphere collision loop.
     - `WorldRenderer.tsx`: Procedural 3D vertex-displaced terrains (`flat`, `hills`, `mountains`, `islands`, `canyon`, `city-grid`, `snow-peaks`, `dunes`), animated water plane, `<Sky>`, `<Stars>`, volumetric `<Clouds>`, weather particle systems (`rain`, `snow`, `embers`, `fireflies`), and instanced environment scatter (`pine-tree`, `palm-tree`, `lowpoly-rock`, `sci-fi-pillar`, `crystal-cluster`, `building-block`).
     - `ActorRenderer.tsx`: Renders real rigged `.glb` models via `useGLTF`, `SkeletonUtils.clone`, and `useAnimations` (with automatic skeletal clip discovery and cross-fade playback), composite PBR groups, interactive 3D gizmos (`TransformControls`), and pure WebGL `THREE.CanvasTexture` sprite badges.
     - `VFXRenderer.tsx`: Renders ambient and click-burst 3D particle systems plus WebGL sprite promo badges.
     - `StageCanvas2D.tsx`: Interactive `1000x600` HTML5 2D Vector/Sprite & Platformer engine supporting drag-to-move, corner resize handles, WASD/Arrow 2D platformer gravity & jumping, AABB platform collision, star collection, and kinetic typography.
   - `src/components/*` — Pro Dark Workstation UI:
     - `TopNavBar.tsx` (with `3D WebGL` / `2D Vector` engine switcher, multi-scene storyboard selector, `Examples` modal trigger, and `Settings` modal trigger).
     - `LeftAssetDrawer.tsx` (4 from-scratch authoring tabs: `Hierarchy`, `World`, `Library`, and `Import` for `.glb`, `.gltf`, `.svg`, `.png`, `.json`).
     - `CenterViewport.tsx` (dual-engine viewport frame, 3D skeletal clip & gizmo toolbar, 2D node inspector toolbar, timeline sequencer dock, and playable end-card overlay).
     - `RightAgentChat.tsx` (AI Director chat, quick-prompt chips, and interactive Vision QA report card).
     - `PublishModal.tsx` & `SettingsModal.tsx`.
   - `src/agent/*` & `server.ts` — Gemini AI integration (`/api/agent/mutate` and `/api/agent/vision-qa`) with support for custom provider/model overrides from `SettingsModal.tsx` via request headers (`x-ai-model`, `x-ai-key`, `x-ai-base-url`).
   - `src/agent/storyboardAgent.ts` — Multi-step storyboard pipeline: `detectStoryboardIntent` (VI/EN, e.g. "phim 3D gồm 3 cảnh", "game 2D 3 màn") → plan (`/api/agent/storyboard/plan`) → one scene per beat, sequentially with a continuity summary (`/api/agent/storyboard/scene`) → `normalizeGeneratedSceneSpec`. Offline fallback builds beatable 2D levels (step-up ≤ 100px, pits ≤ 170px) and 3D film shots. Scenes carry `SceneSpec.sequence` (`storyboardId`, `index`, `nextSceneId`); the store links them (`appendStoryboardScene`, `linkStoryboardScenes`, `advanceToNextScene`) and the end-card shows "Next Level" on win.
   - `server/assetHubProxy.ts` + `src/registry/onlineAssetHub.ts` + `src/components/OnlineAssetBrowser.tsx` — Online Asset Hub: `/api/assets/search` (Poly Pizza / Sketchfab / Poly Haven, keys from Settings sent as `x-polypizza-key` / `x-sketchfab-token`, or env `POLY_PIZZA_API_KEY` / `SKETCHFAB_API_TOKEN`), `/api/assets/proxy` (allow-listed hosts only), `/api/assets/sketchfab/resolve` (GLB cached server-side), Poly Haven glTF with URIs rewritten to `./files/*`, and `.hdr` HDRIs applied through `WorldSpec.hdri`. Proxied URLs are same-origin, so exported standalone HTML cannot load them offline yet.
   - **Adaptive Docking Shell** — `src/App.tsx` composes `TopNavBar` (4 zones: project/scene, Game/Media mode, Stage / Node Graph / Split view, engine + settings + publish), `LeftAssetDrawer.tsx` (`IconRail` + pin/float `PanelFlyout` hosting `components/panels/*`: Outliner, World, Library, Online Hub, Logic, Audio), `CenterViewport.tsx` (mode strip, one always-mounted stage canvas repositioned for full / split / PiP, `RightAgentChat` as floating command bar or slide-over drawer) and `BottomDock.tsx` (Timeline + camera keyframes, Storyboard strip, Captions & Audio mixer, `ExecutionConsole` logs). Layout-only state lives in `src/state/useShellStore.ts` (persisted to `localStorage`); it never holds SceneSpec data. Design tokens and shell classes (`.rail`, `.flyout`, `.pip`, `.aibar`, `.drawer`, `.dock`) are in `src/index.css`.
   - **User Asset Library** — `useStudioStore` holds `favoriteAssetIds`, `savedExternalAssets: AssetDefinition[]`, `assetCollections` (persisted under `omnistage_asset_library_v1`; `blob:` URLs are never written) with `toggleFavoriteAsset`, `createAssetCollection`, `deleteAssetCollection`, `assignAssetToCollection`, `importLocalDirectoryAssets`, `saveExternalAsset`, `spawnSavedAsset`. Shared card / filter-bar UI is `src/components/AssetLibrary.tsx`. `SceneSpec.captions` and `SceneSpec.audioTracks` drive the stage caption overlay and timeline-synced audio.
   - `src/exporter/mediaExporter.ts` — Unified 3D/2D media exporter for PNG snapshots, 60fps `.webm` video streams (`MediaRecorder`), multi-scene `.scenespec.json` project bundles, and self-contained HTML5 Playable Ad bundles supporting both `'3d'` and `'2d'` scenes.

---

## 2. Downstream Agent Responsibilities

### A. Claude Code (Gameplay, Multi-Scene Logic & Physics Expansion)
- **Primary Scope**: `src/types/scene.schema.ts`, `src/state/useStudioStore.ts`, `src/renderer/ActorRenderer.tsx`, `src/renderer/StageCanvas2D.tsx`
- **Rules**:
  - When adding new 3D `onClickAction` / `physicsRole` or 2D `Physics2DRole` behaviors, register the union literal in `scene.schema.ts` first, then implement deterministic handlers in `ActorRenderer.tsx`, `StageCanvas2D.tsx`, and `useStudioStore.ts`.
  - Use multi-scene transitions (`switchScene`, `scenes[]`) when implementing multi-level progression (e.g., advancing from Level 1 to Level 2 upon reaching `gameRules.targetScore`).

### B. Antigravity (Ad Network Bundler & Playable HTML5 Compiler)
- **Primary Scope**: `src/exporter/mediaExporter.ts`, `src/components/PublishModal.tsx`
- **Rules**:
  - Consume `exportStandalonePlayableHTML(sceneSpec, targetNetwork, scenes)` to package single-file HTML5 Playable Ads compliant with **TikTok Playable Ads (MRAID 3.0)**, **Meta Interactive Ads (`FbPlayableAd.onCTAClick`)**, and **Telegram Mini Apps**.
  - Ensure both `'3d'` and `'2d'` engine modes and all scenes in `scenes[]` remain playable inside the exported standalone HTML file without `window.alert` or `window.open`.

### C. Codex (Procedural World Shaders, Rigged GLTF & 2D Vector Authoring)
- **Primary Scope**: `src/registry/assetRegistry.ts`, `src/renderer/WorldRenderer.tsx`, `src/renderer/ActorRenderer.tsx`, `src/renderer/VFXRenderer.tsx`
- **Rules**:
  - Maintain pure WebGL `<sprite>` badges (`THREE.CanvasTexture`) inside R3F components rather than DOM `<Html>` portals to guarantee zero React 19 synchronous root unmount race conditions.
  - Verify all external `.glb` URLs in `ASSET_REGISTRY` return HTTP `200 OK` with CORS headers enabled, and provide `SkeletonUtils.clone` support for multi-instance skeletal rigs.
