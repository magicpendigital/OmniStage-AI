# AGENTS.md — Multi-Coding-Agent (MCA) Contract & Handoff Guide

Welcome to **OmniStage AI**, an Agentic 3D Game & Programmatic Media Studio engineered for a **Multi-Coding-Agent (MCA)** workflow across Google AI Studio, Claude Code, Antigravity, and Codex.

---

## 1. Core Architectural Invariant (Contract-First Design)

1. **Declarative State Driven (`SceneSpec`)**:
   - The 3D WebGL stage (`src/renderer/*`) is 100% driven by the `SceneSpec` contract defined in `src/types/scene.schema.ts`.
   - **NEVER** generate or eval raw Three.js code strings at runtime. All AI agent operations, user inspector edits, and Vision QA fixes MUST mutate the central `SceneSpec` state via `src/state/useStudioStore.ts`.
2. **Strict Separation of Concerns**:
   - `src/types/scene.schema.ts` — Single source of truth for data structures (`SceneSpec`, `ActorNode`, `CameraRig`, `LightingPreset`, `VFXNode`, `TimelineTrack`, `GameRule`, `VisionQAReport`).
   - `src/registry/assetRegistry.ts` — Semantic 3D asset metadata (bounding boxes, attachment sockets, supported procedural animations, composite 3D geometry specs) and starter scene templates.
   - `src/state/useStudioStore.ts` — Central Zustand state store with full Undo/Redo history stack, timeline clock, game score/timer runtime, and atomic mutation actions.
   - `src/renderer/*` — Pure React Three Fiber (`@react-three/fiber`) rendering components (`StageCanvas`, `SceneDirector`, `ActorRenderer`, `VFXRenderer`) that subscribe to `SceneSpec`.
   - `src/agent/*` & `server.ts` — Gemini AI integration (`/api/agent/mutate` and `/api/agent/vision-qa`) translating natural language prompts and WebGL canvas screenshots into validated `SceneSpec` diffs.
   - `src/exporter/mediaExporter.ts` — Deterministic media exporter for 4K PNG snapshots, 60fps `.webm` video streams (`MediaRecorder`), and self-contained HTML5 Playable Ad bundles.

---

## 2. Downstream Agent Responsibilities

### A. Claude Code (Gameplay & Physics Logic Expansion)
- **Primary Scope**: `src/types/scene.schema.ts`, `src/state/useStudioStore.ts`, `src/renderer/ActorRenderer.tsx`
- **Rules**:
  - When adding new `onClickAction` or `physicsRole` behaviors, register the union literal in `scene.schema.ts` first, then implement the deterministic handler in `ActorRenderer.tsx` and `useStudioStore.ts`.
  - Respect each asset's `boundingBox` and `attachmentSockets` from `assetRegistry.ts` so spawned objects sit flush on `y = 0` without ground clipping.

### B. Antigravity (Ad Network Bundler & Playable HTML5 Compiler)
- **Primary Scope**: `src/exporter/mediaExporter.ts`, `src/components/PublishModal.tsx`
- **Rules**:
  - Consume `exportPlayableBundle(sceneSpec)` to package single-file HTML5 Playable Ads compliant with **TikTok Playable Ads**, **Meta Interactive Ads**, and **Telegram Mini Apps** (`window.openAppStore` / CTA bridge hooks).
  - Never introduce external unhosted texture or `.glb` dependencies that break offline sandboxed ad validation.

### C. Codex (Procedural Asset & Shader Authoring)
- **Primary Scope**: `src/registry/assetRegistry.ts`, `src/renderer/ActorRenderer.tsx`, `src/renderer/VFXRenderer.tsx`
- **Rules**:
  - Every built-in asset must be represented as a multi-part `THREE.Group` (3–12 distinct sub-meshes across primary hull, secondary read, and accent details) with calibrated PBR `metalness` and `roughness` values.
  - Every new asset entry in `ASSET_REGISTRY` must define accurate `boundingBox: { width, height, depth }` and `attachmentSockets` coordinates.
