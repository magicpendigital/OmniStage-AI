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
  outer references inside it; its recipe table mirrors `src/audio/sfxRecipes.ts`, checked by `tests/soundtrack.test.ts`); easing ships as `EASING_RUNTIME_SOURCE` and `tests/motionAudio.test.ts` checks it matches `EASINGS`.
- After touching the exporter run `npm test`; the "standalone playable export ... compiles" test parses every inline script.
- Keep both `'2d'` and `'3d'` scenes and every scene in `scenes[]` playable in the export.
- Exports run the OmniStage Player (`src/player/*`, bundled by `npm run build:player` into `src/exporter/generated/playerRuntime.ts`).
  Never add game logic to the exporter: put it in `src/runtime/*` so the studio and the Player share it. After changing `src/player`,
  `src/runtime` or anything they import, run `npm run build:player` (tests/player.test.ts fails on a stale bundle). Never hand-edit the generated file.
- Two Player runtimes: `playerRuntime.ts` (WebGL, default, smallest) and `playerRuntimeWebgpu.ts` (built with `__OMNI_WEBGPU__`). Pick with
  `loadPlayerRuntime(renderer)`; `npm run build:player` regenerates both and `tests/player.test.ts` checks both hashes.
- Phase 10B MP4: `src/exporter/filmExport.ts` renders films frame by frame on the exported Player in a hidden iframe (`manual(true)` +
  `step(1/fps)`, wait for `pendingLoads() === 0`) and encodes with Mediabunny (WebCodecs). Read the stage canvas in the same task as
  `step()`; never add a real-time path to it. Sound comes from `renderFilmSoundtrack` (one render for the whole film, scene lengths in
  whole frames). Shared compositor drawing (transitions, badge) lives in `mediaExporter.ts`.
- Phase 10C voices: generated Piper clips exist only in the studio browser (IndexedDB + `src/audio/voices.ts` registry). Exports carry
  them as `omni-voice:<key>` WAV assets (`voiceClipAssets`), the Player registers them at start (`registerVoiceAssets`). Never import
  `src/audio/piperVoice.ts` (Piper / onnxruntime) from the Player or runtime.
- Scene data goes into the HTML through `inlineJSON` only (escapes `<`, U+2028/2029); asset embedding must respect the network budget and
  report what stays online.
- 2D physics live in `src/runtime/stage2d.ts` and must match `PLATFORMER_PHYSICS` in the verifier, so verified levels stay beatable everywhere.
