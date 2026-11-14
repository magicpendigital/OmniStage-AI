# OmniStage MCP server

Lets Claude Code, Codex or any MCP client author OmniStage projects headlessly. The server works on a normal
`.scenespec.json` project bundle, and the studio opens the same file via **Library → Import**.

## Run

```bash
npx tsx mcp/server.ts --project projects/demo.scenespec.json --root .
```

- `--project`: project file (created by the first `omnistage_create_scene`). Env: `OMNISTAGE_PROJECT`.
- `--root`: exports may only be written inside this folder (default: current directory). Env: `OMNISTAGE_ROOT`.
- Transport: stdio, newline-delimited JSON-RPC 2.0. Implements `initialize`, `ping`, `tools/list`, `tools/call`.
  No resources or prompts yet.

The repo ships a `.mcp.json`, so Claude Code offers to enable the `omnistage` server when opened in this folder.
To add it manually:

```bash
claude mcp add omnistage -- npx tsx mcp/server.ts --project projects/omnistage.scenespec.json
```

## Tools

| Tool | What it does |
| --- | --- |
| `omnistage_contract` | Vocabulary: 3D asset ids + clips, 2D presets, particle / SFX presets, audio events, easings, skills, key rules. Call first. |
| `omnistage_director_skills` | Returns the Director Skill rules matching a brief (same skills the in-app director uses). |
| `omnistage_list_scenes` / `omnistage_get_scene` | Read the project. |
| `omnistage_create_scene` | Blank `2d` / `3d` scene, `game` or `media`. |
| `omnistage_apply_patch` | JSON Merge Patch and/or JSON Patch ops → verify → deterministic auto-fix → save. Returns remaining issues. |
| `omnistage_verify` | Verifier only (no changes). |
| `omnistage_set_active_scene`, `omnistage_link_scenes` | Storyboard order and level progression (`sequence.nextSceneId`). |
| `omnistage_export_playable` | Offline single-file HTML (Three.js inlined) + size budget report for `meta` / `tiktok` / `universal` / `telegram` / `itch`. |
| `omnistage_export_captions` | WebVTT / SRT for a scene's captions. |

Calls are serialised, and project writes are atomic (temp file + rename). Scene ids can't be changed through a patch.

## Example agent loop

1. `omnistage_contract`, then `omnistage_director_skills { prompt: "3-level neon platformer with sound" }`.
2. `omnistage_create_scene { engineType: "2d", mode: "game", title: "Level 1" }`.
3. `omnistage_apply_patch { ops: [{ op: "add", path: "/nodes2D/-", value: {...} }], mergePatch: { audio: {...} } }`.
   Read `verification` and `autoFixes`; patch again until `verification.ok` is true.
4. Repeat for levels 2–3, then `omnistage_link_scenes { kind: "game-levels" }`.
5. `omnistage_export_playable { network: "meta", outPath: "out/neon.html" }` and check `budget.withinBudget` / `offlineReady`.

## Limits

- File-based only. It doesn't drive a running studio tab; reload or re-import the project in the studio to see changes.
- No AI calls inside the server. The calling agent is the director, and the server provides the contract, verification and export.
