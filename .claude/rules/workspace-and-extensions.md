---
paths:
  - "server/workspace/**"
  - "server/ai/**"
  - "server/generate/**"
  - "src/components/GeneratePanel.tsx"
  - "src/extensions/**"
  - "src/workspace/**"
  - "src/agent/memory.ts"
  - "src/agent/aiClient.ts"
  - "src/components/ExtensionsModal.tsx"
  - "src/components/ExtensionReviewDialog.tsx"
  - "src/components/ProjectHubModal.tsx"
  - "server/play/**"
  - "src/components/PlayTestModal.tsx"
---

# Workspace, extensions, memory & providers

- The workspace is the user's private disk. Every `/api/projects|library|extensions|memory` route and every CLI provider must stay
  behind the localhost check (`isLoopbackRequest`); never widen it or trust `x-forwarded-for`.
- Ids that become paths go through `assertId` / `uniqueId`. Writes use `writeJSON` (atomic); deletes use `moveToTrash`, never `rm`.
- Extensions: nothing installs without `approvedPermissions` covering every requested permission (server enforces it). AI may draft or
  recommend, never install. Code plugins only run via `ExtensionSandbox` (`sandbox="allow-scripts"` + CSP `default-src 'none'`); new host
  methods must be added to `METHOD_PERMISSION` with the narrowest permission, and scene writes must go through `autoFixSceneSpec` + `setSceneSpec`.
- Extension presets used by a scene are copied into `particleLibrary` / `sfxLibrary` (`attachExtensionRecipes`) — scenes must render
  without the extension installed (export, MCP, another computer).
- Generation providers (`server/generate/*`, Phase 6 Batch 3): API hosts, auth and result hosts live in `PROVIDERS`, never in a
  manifest; extensions only pick a provider + a `GENERATION_MODEL_RE` model id and need the approved `generate` permission. Keys
  come per request (`x-generate-key`) or env, are never stored in jobs, logged or echoed (`upstreamErrorMessage` scrubs them), and
  never go to result hosts. Downloads: `safeUrl` (https, provider hosts, no IPs/ports) + `sniffResult` before `AssetStore.add`.
  Keep `tests/generate.test.ts` green; re-check the upstream API comments in `providers.ts` when a provider changes its API.
- CLI providers: prompts via stdin or a temp file, never argv; model ids through `sanitizeModelId`; run in a temp cwd with tools disabled
  where the CLI allows. Re-verify flags with `<cli> --help` after CLI upgrades and update `server/ai/cliProviders.ts` comments.
- Anthropic calls use the official `@anthropic-ai/sdk` (default `claude-opus-5-5`, adaptive thinking, server-side refusal fallback).
- Phone preview: `/play/:token` is the ONLY route meant for the LAN. Keep tokens random (crypto) with an expiry, never serve workspace
  files through it, and keep session creation behind `isLoopbackRequest`. Play Test iframes stay `sandbox="allow-scripts allow-pointer-lock"`
  (no same-origin). Guide content changes need both `vi` and `en` with the same number of steps (`tests/playAndGuide.test.ts`).
- Drafts (`server/workspace/drafts.ts`, `~/OmniStage/drafts`): work without a project autosaves there (studio `saveDraft`), the latest
  draft reopens on start, saving it into a project MOVES it (`promoteDraft`, draft folder to the trash). Drafts idle 30+ days are only
  ever removed after the user chooses Delete in `StaleDraftsDialog` (keep restarts the clock). Saved bundles carry `voiceClips`.
- Memory is user data: only explicit commands or user-confirmed suggestions are stored; keep `selectMemories` scoped (never leak another
  project's memories) and keep `tests/extensions.test.ts` / `tests/workspace.test.ts` green.
