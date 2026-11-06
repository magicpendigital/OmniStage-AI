# OmniStage AI — Master Architecture & Roadmap (`plan.md`)

## 1. Vision & System Architecture
**OmniStage AI** enables game creators, performance marketers, and creative directors to build **3D Mini-Games**, **HTML5 Playable Ads**, and **Programmatic 3D Marketing Videos** through conversational AI and a live visual feedback loop.

### Architectural Pillars
1. **Declarative `SceneSpec` Contract (`src/types/scene.schema.ts`)**:
   - Unifies interactive gameplay state (`gameRules`, `actors`, `onClickAction`) and cinematic video production (`camera.keyframes`, `aspectRatio`, `marketingOverlay`, `environment`) in one serializable JSON schema.
2. **Semantic Asset Registry (`src/registry/assetRegistry.ts`)**:
   - Zero-CORS hybrid 3D library featuring multi-part procedural PBR models (Cyber Mecha Bot, Fantasy Knight, Pro Sports Sneaker, Luxury Perfume Bottle, GT Sports Car, Sci-Fi Warp Portal, Gold Coin, Plasma Gem, and Clean Studio Primitive) alongside custom `.glb` URL loading.
   - Includes explicit `boundingBox` dimensions, `attachmentSockets` (`head`, `hand_r`, `ground`, `top_badge`), and supported animations (`idle`, `bounce`, `spin`, `walk`, `attack`, `float`).
3. **Multimodal Vision QA Loop (`src/agent/studioAgent.ts` + `server.ts`)**:
   - Captures the live WebGL canvas (`canvas.toDataURL('image/png')`) and pairs it with the active `SceneSpec` JSON for server-side Gemini inspection (`/api/agent/vision-qa`).
   - Detects spatial issues (off-center framing, overlapping bounding boxes, low lighting contrast, camera clipping) and produces a **Diagnostic Report with a one-click "Apply Fixes" action**.
4. **Instant Media & Playable Exporter (`src/exporter/mediaExporter.ts`)**:
   - **High-Res PNG Snapshot**: Captures the exact framed aspect ratio from the WebGL buffer.
   - **Programmatic WebM Video Recording (3s / 5s / 10s)**: Streams the canvas at 60fps via `HTMLCanvasElement.captureStream(60)` and `MediaRecorder` while executing camera keyframe trajectories and procedural animations.
   - **Standalone HTML5 Playable Ad Bundle**: Generates a self-contained `.html` playable ad file embedding the `SceneSpec` state, Three.js runtime, interactive raycasting, score HUD, and marketing CTA overlay.

---

## 2. Phase Roadmap

### Phase 1: Google AI Studio Core Scaffold (Completed)
- [x] Complete `SceneSpec` TypeScript schema & validation helpers (`src/types/scene.schema.ts`)
- [x] Built-in Semantic Asset Registry with 9 multi-part PBR 3D assets, 4 lighting studios, 5 VFX types, and 4 starter templates (`src/registry/assetRegistry.ts`)
- [x] Central Zustand store with Undo/Redo history, playback timeline clock, and playable game engine (`src/state/useStudioStore.ts`)
- [x] R3F StageCanvas, SceneDirector, ActorRenderer, and VFXRenderer (`src/renderer/*`)
- [x] Server-side Gemini 3.8 Flash agent mutation & Vision QA endpoints (`server.ts`, `src/agent/*`)
- [x] Instant PNG, WebM Video, and Standalone Playable HTML5 Exporter (`src/exporter/mediaExporter.ts`)
- [x] 4-Panel Pro Dark 3D Workstation UI (`TopNavBar`, `LeftAssetDrawer`, `CenterViewport`, `RightAgentChat`, `PublishModal`)

### Phase 2: Downstream Multi-Agent Extensions
- [ ] **Claude Code**: Rapier3D rigid-body collision solver & multi-wave spawner rules
- [ ] **Antigravity**: MRAID 3.0 / TikTok Pangle / Meta Playable single-file zip compressor
- [ ] **Codex**: Custom GLSL procedural surface shaders & skeletal GLTF animation retargeting
