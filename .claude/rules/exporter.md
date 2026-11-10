---
paths:
  - "src/exporter/**"
  - "src/audio/**"
  - "src/animation/**"
  - "src/vfx/**"
  - "src/media/**"
  - "src/player/**"
  - "scripts/build-player.mjs"
  - "src/components/PublishModal.tsx"
---

# Exporter & playable-ad rules

- Exported HTML must work offline as a single file: no `window.alert`, no `window.open`, no network audio/font fetches.
- Code shared with the exported runtime must be self-contained: `createOmniSfxPlayer` is inlined via `toString()` (no imports or
  outer references inside it); easing ships as `EASING_RUNTIME_SOURCE` and `tests/motionAudio.test.ts` checks it matches `EASINGS`.
- After touching the exporter run `npm test`; the "standalone playable export ... compiles" test parses every inline script.
- Keep both `'2d'` and `'3d'` scenes and every scene in `scenes[]` playable in the export.
- Exports run the OmniStage Player (`src/player/*`, bundled by `npm run build:player` into `src/exporter/generated/playerRuntime.ts`).
  Never add game logic to the exporter: put it in `src/runtime/*` so the studio and the Player share it. After changing `src/player`,
  `src/runtime` or anything they import, run `npm run build:player` (tests/player.test.ts fails on a stale bundle). Never hand-edit the generated file.
- Scene data goes into the HTML through `inlineJSON` only (escapes `<`, U+2028/2029); asset embedding must respect the network budget and
  report what stays online.
- 2D physics live in `src/runtime/stage2d.ts` and must match `PLATFORMER_PHYSICS` in the verifier, so verified levels stay beatable everywhere.
