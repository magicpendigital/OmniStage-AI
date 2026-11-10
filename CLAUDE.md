# CLAUDE.md — OmniStage AI (pointer index)

Keep this file short. It points to where the rules live; scoped rules load from `.claude/rules/` when you touch matching files.

## Commands (run before saying work is done)

```bash
npm run verify        # tsc --noEmit + all unit tests (tests/*.test.ts) — must exit 0
npm run build         # vite production build
npm run dev           # tsx server.ts on :3000 (PORT env overrides)
```

Verification loop: change → `npm run verify` → fix until exit code 0. Do not eyeball results or skip failing tests.

## Core invariants

1. Everything renders from the declarative `SceneSpec` (`src/types/scene.schema.ts`). Never generate or `eval` Three.js / Canvas code at runtime.
2. All mutations go through `src/state/useStudioStore.ts`.
3. New behaviour = union literal in `scene.schema.ts` first, then handlers in renderers/store, then the agent prompt (`src/agent/systemPrompts.ts`).
4. AI output must pass `verifySceneSpec` (`src/verification/sceneVerifier.ts`). Add a verifier rule + test when you add a gameplay rule.
5. Anything that must also run in exported playable ads (`src/exporter/mediaExporter.ts`) must be self-contained (see `src/audio/sfxRuntime.ts`, `EASING_RUNTIME_SOURCE`).

## Map

| Area | Files | Scoped rules |
| --- | --- | --- |
| Contract | `src/types/scene.schema.ts` | `.claude/rules/scene-contract.md` |
| Renderers 3D/2D | `src/renderer/*` | `.claude/rules/renderers.md` |
| AI director, skills, verifier | `src/agent/*`, `src/verification/*`, `server.ts` | `.claude/rules/agent-and-verification.md` |
| Exporter / playable ads | `src/exporter/*`, `src/audio/*`, `src/animation/*` | `.claude/rules/exporter.md` |

Full roles for the multi-agent workflow: `AGENTS.md`. Roadmap: `plan.md`. Renderer QA notes: `docs/renderer-quality.md`.

## Conventions

- TypeScript strict-ish, React 19 function components, Zustand store, Tailwind classes.
- Tests: `node:test` + `tsx`, pure modules only (no DOM). Put browser-only checks in `tests/renderer.browser.js`.
- UI copy is English; user-facing docs may be Vietnamese.
- Do not read `dist/`, `output/`, `node_modules/` or `.playwright-cli/` unless debugging them; they are generated.
- Review a change with the `scene-contract-reviewer` subagent (`.claude/agents/`) before merging large SceneSpec changes.
