---
paths:
  - "src/agent/**"
  - "src/verification/**"
  - "server.ts"
  - "server/**"
  - "mcp/**"
---

# AI director, Director Skills & verification loop

- Every AI turn runs: select Director Skills (`directorSkills.ts`) → generate → `finalizeLogicGraph` → `autoFixSceneSpec` → verify.
  Default edit mode is the JSON Patch tool-use loop (`src/agent/patchLoop.ts`, `/api/agent/patch`): each round's patch is applied,
  finalized, auto-fixed and verified, and rejected patches / verifier errors go back as TOOL RESULTs (max `DEFAULT_PATCH_ROUNDS`; a round
  that makes verification worse is discarded). Full-rewrite mode keeps at most one AI repair round. Keep this order; the offline heuristic
  path must stay usable without keys (a 503 from the provider skips straight to it).
- Patch paths may address array items by id (`/actors/@id`), see `src/utils/jsonPatch.ts`; keep `tests/patchLoop.test.ts` green.
- Skills are prompt text only (`DirectorSkill.guidance`). Never let a skill carry executable code or URLs to fetch.
- Built-in skills live in `BUILTIN_DIRECTOR_SKILLS`; learned skills are user data in localStorage (`omnistage-learned-director-skills`).
- Verifier rules must be deterministic, pure and covered in `tests/sceneVerifier.test.ts`. Mark an issue `fixable` only when
  `applyFix` really repairs it, and check for false positives against `SCENE_TEMPLATES` and the offline storyboard generator.
- MCP tools (`mcp/projectTools.ts`) must reuse studio contract code (createBlankSceneSpec, autoFixSceneSpec, exporter); never
  write outside `ctx.rootDir`, keep scene ids stable, and keep `tests/mcpServer.test.ts` green.
- API keys arrive via headers (`x-ai-key`, `x-polypizza-key`, ...) or env; never log them or put them in SceneSpec.
