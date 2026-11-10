---
paths:
  - "src/renderer/**"
  - "src/runtime/**"
  - "src/render3d/**"
---

# Renderer rules

- 3D visuals (world, lights, VFX, particles, composite actors, actor motion) are built once in `src/render3d/*` as plain Three.js
  (`Built3D` = { object, update(ctx), dispose }). The studio hosts them with `<Built>` (src/renderer/Built.tsx); the Player
  (src/player/view3d.ts) calls them directly. Never add a visual only to an R3F component — add it to a builder so exports match.
  Builders must not import React, drei or the studio store; time comes from `FrameContext`. JSX in builders uses
  `/** @jsxRuntime classic */ /** @jsx h */` (src/render3d/h.ts); add new tags to `h()`. Off-screen passes go in `Built3D.prerender`
  (contact shadows); post-processing lives in `src/render3d/postfx.ts` (bloom on Ultra). Do not add drei visual helpers to the viewport.
- 3D host: React Three Fiber (editor tools: gizmos, selection, orbit). Badges stay WebGL sprites (`THREE.CanvasTexture`), never DOM `<Html>` portals (React 19 unmount races).
- Multi-instance rigs use `SkeletonUtils.clone`; dispose bone textures/mixers when an actor is removed.
- 2D: `StageCanvas2D.tsx` works in a 1000×600 design space. Platformer physics constants (jump vy −520, gravity 9.8×90, run 320)
  are mirrored in `src/verification/sceneVerifier.ts` (`PLATFORMER_PHYSICS`). Change both together and re-run `npm test`.
- Time-based effects read `currentTime` from the store so pause/scrub stay deterministic. Keyframe interpolation goes through
  `src/animation/easing.ts` (`sampleKeyframes`, `easedSplineProgress`).
- Sound: do not create AudioContexts in renderers; call `playSceneSfx` from `src/audio/audioBus.ts`.
- Game rules, the logic-graph interpreter and the 2D frame live in `src/runtime/*` and must not import React, the studio store or
  anything DOM-only beyond canvas; they read/write state via `runtimeStore` (`src/runtime/host.ts`). Renderers stay thin wrappers so the
  OmniStage Player runs the same code. Rebuild the Player (`npm run build:player`) after runtime changes.
