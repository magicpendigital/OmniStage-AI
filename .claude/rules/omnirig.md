---
paths:
  - "src/rig/**"
  - "src/components/OmniRigModal.tsx"
---

# OmniRig (Phase 9 character pipeline)

- The maths is pure TypeScript on plain arrays (`analyze.ts`, `skeleton.ts`, `skin.ts`, `animate.ts`) so it runs in node tests;
  only `omnirig3d.ts` touches Three.js. Keep it deterministic (seeded sampling, no Math.random).
- Canonical frame for every step: up +Y, facing +Z, character's left +X, feet on y = 0. Bones have identity rest rotations,
  so clip rotations are about these axes. Humanoid bones use loader-style Mixamo names (`MIXAMO('LeftArm')` → `mixamorigLeftArm`).
- Clip names must stay the ones the AI and `matchClipName` already use (Idle, Walking, Running, Wave, Jump, Yes, No, Sitting, Dance).
- Retarget with `retargetClip` (rest-pose deltas), never `SkeletonUtils.retargetClip`.
- Keep `tests/omnirig.test.ts` green: joints within 9 cm on the sample humanoid at any yaw / scale, no arm-to-ribs bleed, A/B grades
  for the samples, walking feet near the ground.
