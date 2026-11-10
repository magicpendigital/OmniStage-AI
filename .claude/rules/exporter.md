---
paths:
  - "src/exporter/**"
  - "src/audio/**"
  - "src/animation/**"
  - "src/components/PublishModal.tsx"
---

# Exporter & playable-ad rules

- Exported HTML must work offline as a single file: no `window.alert`, no `window.open`, no network audio/font fetches.
- Code shared with the exported runtime must be self-contained: `createOmniSfxPlayer` is inlined via `toString()` (no imports or
  outer references inside it); easing ships as `EASING_RUNTIME_SOURCE` and `tests/motionAudio.test.ts` checks it matches `EASINGS`.
- After touching the exporter run `npm test`; the "standalone playable export ... compiles" test parses every inline script.
- Keep both `'2d'` and `'3d'` scenes and every scene in `scenes[]` playable in the export.
