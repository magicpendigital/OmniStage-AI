---
paths:
  - "src/types/scene.schema.ts"
  - "src/state/useStudioStore.ts"
  - "src/registry/**"
---

# SceneSpec contract rules

- `scene.schema.ts` is the single source of truth. Add new fields as optional (`field?:`) so old `.scenespec.json` bundles still load.
- When you add a union literal (physics role, click action, ease, SFX preset...), update in the same change:
  1. the renderer handler(s), 2. `systemPrompts.ts` so the AI knows it, 3. `sceneVerifier.ts` if it affects playability, 4. a test.
- Store actions clone with `cloneSceneSpec`, push the previous spec onto `pastSpecs` (cap 20) and clear `futureSpecs`.
- Never store functions, class instances or DOM nodes inside `SceneSpec` — it must round-trip through JSON and the exporter.
