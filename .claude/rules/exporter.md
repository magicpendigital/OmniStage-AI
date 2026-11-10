---
paths:
  - "src/exporter/**"
  - "src/audio/**"
  - "src/animation/**"
  - "src/vfx/**"
  - "src/media/**"
  - "src/components/PublishModal.tsx"
---

# Exporter & playable-ad rules

- Exported HTML must work offline as a single file: no `window.alert`, no `window.open`, no network audio/font fetches.
- Code shared with the exported runtime must be self-contained: `createOmniSfxPlayer` is inlined via `toString()` (no imports or
  outer references inside it); easing ships as `EASING_RUNTIME_SOURCE` and `tests/motionAudio.test.ts` checks it matches `EASINGS`.
- After touching the exporter run `npm test`; the "standalone playable export ... compiles" test parses every inline script.
- Keep both `'2d'` and `'3d'` scenes and every scene in `scenes[]` playable in the export.
- The inlined Three.js (`src/exporter/generated/threePlayableRuntime.ts`) only contains `PLAYABLE_THREE_EXPORTS`. Using a new `THREE.X`
  in the inline script requires adding it in `scripts/build-playable-three.mjs` and running `npm run build:playable-three`
  (a test fails otherwise). Never hand-edit the generated file.
- Exported 2D physics must use `PLATFORMER_PHYSICS` from the verifier, so levels approved by the verifier stay beatable.
- `createParticle2DRuntime`, `spriteFrameAt`, `drawCaptionOnCanvas`, `createOmniSfxPlayer` are inlined with `toString()`: no outer references.
