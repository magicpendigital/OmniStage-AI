---
paths:
  - "src/renderer/**"
  - "src/runtime/**"
---

# Renderer rules

- 3D: React Three Fiber. Badges stay WebGL sprites (`THREE.CanvasTexture`), never DOM `<Html>` portals (React 19 unmount races).
- Multi-instance rigs use `SkeletonUtils.clone`; dispose bone textures/mixers when an actor is removed.
- 2D: `StageCanvas2D.tsx` works in a 1000×600 design space. Platformer physics constants (jump vy −520, gravity 9.8×90, run 320)
  are mirrored in `src/verification/sceneVerifier.ts` (`PLATFORMER_PHYSICS`). Change both together and re-run `npm test`.
- Time-based effects read `currentTime` from the store so pause/scrub stay deterministic. Keyframe interpolation goes through
  `src/animation/easing.ts` (`sampleKeyframes`, `easedSplineProgress`).
- Sound: do not create AudioContexts in renderers; call `playSceneSfx` from `src/audio/audioBus.ts`.
- Game rules, the logic-graph interpreter and the 2D frame live in `src/runtime/*` and must not import React, the studio store or
  anything DOM-only beyond canvas; they read/write state via `runtimeStore` (`src/runtime/host.ts`). Renderers stay thin wrappers so the
  OmniStage Player runs the same code. Rebuild the Player (`npm run build:player`) after runtime changes.
