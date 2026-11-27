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
- `mutateSceneWithAgent` returns `aiSource` (`ai` | `offline` | `error`). ONLY a 503 (no connection configured) may use the keyword director, and the
  reply must say so; any other provider failure or unusable output returns the scene unchanged with `source: 'error'` (never a canned scene).
  The UI shows the source chip, has a Stop button (AbortSignal threaded through the fetches) and must not push history for an `error` result.
- Patch paths may address array items by id (`/actors/@id`), see `src/utils/jsonPatch.ts`; keep `tests/patchLoop.test.ts` green.
- Media craft (Phase 10A): film quality hints are verifier *warnings* listed in `MEDIA_CRAFT_CODES`; the patch loop treats them as work
  through `qualityPenalty` (storyboard polish rounds), never as errors. Generated actors keep their ids (shots / lookAt reference them).
  Keep `tests/cinematics.test.ts` green, including its composition checks.
- Story Bible (Phase 11A, `src/agent/storyBible.ts`): films/ads are written bible-first (draft → lint → one revise round → offline fallback);
  the server builds the prompts from structured input, never from client prompt strings. Add a lint code + test in
  `tests/storyBible.test.ts` when you add a story rule. After changing storyboard prompts or the pipeline run `npm run eval:film`
  (offline baseline; live with `--server`) and compare with the previous run; keep `tests/filmEval.test.ts` green.
- Skills are prompt text only (`DirectorSkill.guidance`). Never let a skill carry executable code or URLs to fetch.
- AI-authored `particleLibrary` / `sfxLibrary` recipes are data checked by `recipe.invalid` with the same sanitizers extensions use
  (`sanitizeParticleRecipe` / `sanitizeSfxRecipe` in `src/extensions/validate.ts`); add new recipe fields there, not in the verifier.
- Built-in skills live in `BUILTIN_DIRECTOR_SKILLS`; learned skills are user data in localStorage (`omnistage-learned-director-skills`).
- Verifier rules must be deterministic, pure and covered in `tests/sceneVerifier.test.ts`. Mark an issue `fixable` only when
  `applyFix` really repairs it, and check for false positives against `SCENE_TEMPLATES` and the offline storyboard generator.
- MCP tools (`mcp/projectTools.ts`) must reuse studio contract code (createBlankSceneSpec, autoFixSceneSpec, exporter); never
  write outside `ctx.rootDir`, keep scene ids stable, and keep `tests/mcpServer.test.ts` green.
- Every AI call goes through `generateJSON` → `runWithFallback` (`server/ai/fallback.ts`): primary connection, then the user's
  `x-ai-fallback` chain. Keep 503 only for "no connection configured" so the offline director still takes over; keep
  `/api/ai/test` on `{ fallback: false }`; keep `tests/aiProviders.test.ts` green.
- API keys arrive via headers (`x-ai-key`, `x-polypizza-key`, ...) or env; never log them or put them in SceneSpec.
- Writers' Room (Phase 11B, `src/agent/writersRoom.ts`): the showrunner and continuity desks are rules, never AI; a writer desk may only
  write its own fields (`mergeDeskOutput`); `POST /api/agent/storyboard/room` builds prompts from `RoomAskRequest`, never from client
  text; a failed desk falls back to the offline template and is marked `local`; abort must propagate. Keep `tests/writersRoom.test.ts`
  green. Generated models reach scenes only through `applyBibleToScene` (stand-in rig stays the `assetId`).
- Film editor (Phase 11C, `src/agent/filmEditor.ts`): cut lint and carry are deterministic and pure; a fix is mechanical only (character state, a mirror
  that is re-linted before it is kept), taste calls (lighting, jump cuts) are reported. Characters need a stable id across scenes (bible `actorId`,
  offline `char-<assetId>`) or nothing carries. Keep `tests/filmEditor.test.ts` green; new seam rules get a code + test there.
- Shared locations (Phase 11D, `src/agent/locations.ts`): the bible names places (`locations[]`, `beat.location`), `autoFixStoryBible` keeps
  them consistent (`deriveLocations`), and a scene at an already-built location reuses that world (`shareLocationWorld`; weather, lighting,
  camera and blocking stay the scene's). The world desk owns locations; other desks must not touch them. Keep `tests/locations.test.ts` green.
- Film finishing (Phase 11E): script lines get ids from `scriptCoverage.ts` (`script.uncovered` / `script.unperformable` are craft warnings, never fixable);
  `soundCuts` (J/L) and the `musicCues.ts` cue sheet run per scene inside `generateStoryboard`; cut QA (`cutQA.ts`) is vision-only, notes only,
  never auto-patches. `MOOD_BPM` must match `MOODS` in `soundtrack.ts`. Keep `tests/phase11e.test.ts` green.
- Game design (Phase 4 Director B, `src/agent/gameDesign.ts`): 2D game-level storyboards write a GDD first (draft -> sanitize -> autoFix -> lint -> one revise round -> offline design), exactly like the Story Bible;
  the server (`POST /api/agent/game/design`) builds prompts from structured data only; the review modal (`GameDesignModal`, setting `gameDesignReview`) hands the approved design to the chat through
  `gameDesignClient.ts`. An AI or approved design is passed to `/plan` and `/scene` and is attached to AI-authored level scenes as `sceneSpec.gameDesign`; offline levels do not carry it. The verbs are
  ONLY what the engine runs (`GAME_VERBS`); a new gameplay verb needs engine support first. `src/verification/intentAlignment.ts` checks level against design (`intent.*` codes, craft warnings in
      `MEDIA_CRAFT_CODES` so the patch loop treats them as work); scenes without a design produce none. Add a code + test in `tests/gameDesign.test.ts` when you add an intent rule.
- Shared tool layer (Phase 4 Director D, `src/agent/tools/sceneTools.ts` + `src/agent/logicFinalize.ts`): ONE pure `checkScene` (recipes hook -> `finalizeLogicGraph` -> `autoFixSceneSpec` -> verify)
  is the check for the studio patch loop, the tool loop and MCP `omnistage_apply_patch`; never add a second path. `finalizeLogicGraph` and its repair helpers live in `logicFinalize.ts` (no store, DOM or fetch;
  `studioAgent` re-exports them). The toolbox is pure, `run` never throws (errors are "ERROR: ..." text), results are capped (`MAX_TOOL_RESULT_CHARS`), a patch that makes verification worse is reverted.
  Tools exist only for things that exist: `get_scene_slice`, `apply_patch`, `verify`, `search_assets`, `finish`, plus the host tools `add_from_kit` and `playtest` (Phase 5; a toolbox lists them only when the host passes `extraTools: GAME_TOOL_HANDLERS` from `tools/gameTools.ts`, so `sceneTools.ts` stays light for the client). Do NOT add `generate_asset` (needs the cost-confirmation step) or `screenshot`
  until their machinery exists. Skills stay prompt text; no tool runs code.
- Tool-use edit loop (`server/ai/toolLoop.ts`, `POST /api/agent/tools` in `server/ai/toolRoute.ts`, studio `runToolEdit`): opt-in (`aiEditMode: 'tools'`, default stays `patch`) and eligible only when the PRIMARY connection is
  `anthropic` with a key (`resolveToolLoopConnection`); everything else returns 501 / null and the studio uses the JSON patch loop. Any failure of the tool loop (including 503) also falls through to the patch loop, which
  still owns the 503 -> offline director decision, and the result notes it. Limits: <= 12 turns, <= 40 tool calls, `client` injectable (tests use a scripted fake, never the network). It has NOT been run against a live
  Anthropic account; do that before making it the default. Keys are never logged, echoed or put in transcripts. Keep `tests/sceneTools.test.ts`, `tests/toolLoop.test.ts` and `tests/mcpServer.test.ts` green.
- Genre kits and playtest (Phase 5, `src/agent/genreKits.ts`, `src/playtest/*`): a kit must verify with no errors AND be won by the bot at every difficulty, also after `checkScene`
  (the shipped state), and `detectGameGenre` / `kitForGenre` choose it. The bot runs the REAL runtime headlessly (`headless2d.ts`: `stepStage2D`, the Player store, `RuntimeLogicGraph`); never fork
  game rules into the bot. "won" is proof (`replayTape` reproduces it); "not-won" is only a warning with evidence, never a verifier error. The bot is deterministic (no `Date`/`Math.random`).
  A change to the runtime, a kit or the finalizer needs `tests/playtest.test.ts`, `tests/genreKits.test.ts` and `npm run eval:game` (offline baseline; live with `--server`; keep `tests/gameEval.test.ts`
  green; add a golden prompt to `eval/game-prompts.json` when you add a kit). 2D pickups are collected by the runtime itself: the finalizer must not wire a collection chain for them, and 2D action
  nodes must not carry 3D-only params (`animation`, `activeClip`, `speed`).
- Post-production (Phase 6): `SceneSpec.grade` (`ColorGrade`, presets + numbers, `grade.invalid` / `grade.2d-ignored` verifier warnings, both fixable) is authored by the director like any other field (`systemPrompts.ts` item 15); a film shares ONE look across its 3D scenes (`unifyFilmGrade`, `filmGrade.ts`, run once inside `generateStoryboard`; ads only share a look the director authored; 2D scenes never get one). `EaseRef` allows `bezier(x1,y1,x2,y2)` anywhere `ease` is accepted (`isEaseRef`; `EASING_RUNTIME_SOURCE` must stay identical, `tests/motionAudio.test.ts`). The dock timeline lanes are DERIVED from the spec (`deriveTimeline`, `src/runtime/timelineLanes.ts`), never stored: when a new timed field is added, add its lane there. A new SceneSpec field also needs a Godot mapping or warning (`grade` maps exposure / contrast / saturation to Environment adjustments).
