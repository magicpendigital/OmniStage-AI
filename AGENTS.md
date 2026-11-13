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
   - **Phase 4 Agentic Game & Media Toolkit** (see `plan.md`, `docs/research/agent-ecosystem-review.md`):
     - `src/verification/sceneVerifier.ts` — deterministic `verifySceneSpec` / `autoFixSceneSpec` (2D jump reachability, score goals, 3D arena, ids, timing, CTA, cues). Every AI turn and storyboard scene passes through it, plus one AI repair round.
     - `src/agent/directorSkills.ts` — built-in + learned Director Skills injected into the system prompt via `customSystemPrompt`.
     - `src/audio/sfxRuntime.ts` + `src/audio/audioBus.ts` — procedural WebAudio SFX (`SceneSpec.audio`), shared verbatim with exported playables.
     - `src/animation/easing.ts` — GSAP-style easing for `Keyframe2D.ease` / `CameraKeyframe.ease`, mirrored in `EASING_RUNTIME_SOURCE` for the exporter.
     - Run `npm run verify` (tsc + unit tests) before handing work back.
   - **Phase 5 Agent-Native Studio & Offline Media**:
     - `mcp/server.ts` + `mcp/projectTools.ts` — OmniStage MCP server (`docs/mcp-server.md`); agents author `.scenespec.json` projects headlessly with verify/auto-fix and offline export.
     - `src/exporter/playableBundle.ts` — size budgets, offline check, DEFLATE ZIP (Phase 7: exports inline the OmniStage Player bundle instead of a separate Three.js build).
     - `src/animation/spriteSheet.ts`, `src/vfx/particles2D.ts`, `src/media/captions.ts` — 2D spritesheets, deterministic 2D particles, captions (WebVTT/SRT); all shared with the exporter via `toString()`.
   - **Phase 6 Creator Platform (batch 1)** — see `plan.md`, `docs/research/tech-stack-evaluation.md`:
     - `server/ai/*` + `src/agent/aiClient.ts` — providers: Gemini, Anthropic SDK, OpenRouter, OpenAI-compatible, and CLI login (Claude Code, Codex, OpenCode, Google Antigravity CLI `agy`; localhost only). Headers `x-ai-provider` / `x-ai-model` / `x-ai-key` / `x-ai-base-url`.
     - `server/workspace/*` — `~/OmniStage` projects (games are MCP-compatible bundles), personal + project libraries, installed extensions, memory; localhost-only `/api/projects|library|extensions|memory`.
     - `src/extensions/*` — manifest contract, validation/risk review, catalog, sandboxed code plugins (`iframe sandbox` + CSP + permissioned `window.omni`), recommendations. Installs always require user approval.
     - `src/agent/memory.ts` — memory selection / explicit "remember" / suggestions; `buildDirectorContext` in `studioAgent.ts` merges skills, memory and extension presets per turn.
   - **Phase 6 batch 2 (Play & Learn)**: `PlayTestModal.tsx` (exported build in a sandboxed iframe, device frames, FPS, verifier panel), `server/play/playSessions.ts` (token-gated `/play/:token` for phones on the LAN; session creation is localhost-only), `FullPreviewOverlay.tsx` + `src/playtest/previewOrder.ts` (storyboard playback), `src/guide/*` + `GuideModal.tsx` + `WelcomeTour.tsx` (help center, tour, chat how-to answers).
   - **Phase 9 (OmniRig)**: `src/rig/*` auto-rigs a GLB (canonical frame, classification, joints from cross-sections, voxel-visibility skin weights, stress-pose grade, procedural clips, rest-pose retargeter); `OmniRigModal` lets users fix joints and saves the rigged GLB + rig.json to My Library.
   - **Phase 10C (dialogue)**: `sceneSpec.dialogue` + `actors[].voice`; `src/audio/voices.ts` (timing, babble voice, captions, talk levels, mixing) and `src/audio/piperVoice.ts` (Piper TTS in the studio, IndexedDB clips) — voices, captions and talk motion match in studio, Player and MP4.
   - **Phase 10B (sound, biomes, MP4)**: `src/audio/soundtrack.ts` renders `sceneSpec.soundtrack` (mood music, ambience, cues) to PCM for Preview, the Player and the frame-stepped MP4 export (`src/exporter/filmExport.ts`, Mediabunny); `src/runtime/biomes.ts` + `src/render3d/waterFeatures.ts` dress worlds and add waterfalls / rivers / ponds.
   - **Phase 10A (acting & shots)**: `src/runtime/cinematics.ts` resolves `actor.performance`, `camera.shots` and scene transitions for the studio, Preview, Player and exports; the storyboard writes a script per shot and polishes static scenes through the patch loop.
   - **Phase 7C**: AI edits are JSON Patch rounds verified in a loop (`src/agent/patchLoop.ts`); the store is split into `src/state/slices/*`; `npm run test:e2e` drives exported games through the Player `step()` hook.
   - **Phase 7B (one look)**: `src/render3d/*` builds every 3D visual as plain Three.js; the studio R3F viewport hosts the builders via `<Built>` and the Player uses them directly.
   - **Phase 7 (one runtime)**: `src/runtime/*` (game slice, logic graph, 2D frame, graph sync, world math — framework-free, bound via `host.ts`) is shared by the studio and the OmniStage Player `src/player/*` (vanilla store, 2D/3D views, HUD, unified input). All exports go through `src/exporter/playerHtml.ts` with the bundle from `npm run build:player`.
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
