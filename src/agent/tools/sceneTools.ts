/**
 * Phase 4 (Director D) — the shared scene tool layer.
 *
 * One pure toolbox used by the studio (native tool-use loop, `server/ai/toolLoop.ts`) and by the MCP server
 * (`mcp/projectTools.ts`). It works on a SceneSpec held in memory and never touches React, the studio store, fetch or the disk,
 * so the same code path verifies every edit no matter who made it:
 *
 *   patch -> recipes hook -> finalizeLogicGraph -> autoFixSceneSpec -> verify   ==   `checkScene`
 *
 * Tools (JSON-schema definitions in `SCENE_TOOL_DEFINITIONS`, executed through `SceneToolbox.run`):
 *   get_scene_slice  read only the requested part of the scene (the model starts from a summary + id index, not the whole spec)
 *   apply_patch      mergePatch and/or JSON Patch ops, checked by `checkScene`; a patch that makes verification worse is reverted
 *   verify           the current verifier report
 *   search_assets    built-in 3D assets, 2D presets, particle / SFX presets and caller-supplied library assets
 *   add_from_kit     (Phase 5) replace a 2D game level with a verified, bot-winnable genre kit        (host tool)
 *   playtest         (Phase 5) deterministic bots play the 2D game on the shared runtime, return evidence (host tool)
 *   finish           ends the loop with a short summary
 *
 * Host tools need the headless runtime, so the host passes `extraTools` (see `gameTools.ts`); this module stays light because the
 * client imports its tool names for the prompt. Deliberately NOT here (no machinery yet): generate_asset, screenshot.
 * Tools never execute code; every result is a compact string (capped) and `run` never throws.
 */
import { applyPatchProposal, buildIdIndex, describeReportForModel } from '../patchLoop';
import type { PatchCheck, PatchProposal } from '../patchLoop';
import { finalizeLogicGraph } from '../logicFinalize';
import { autoFixSceneSpec, verifySceneSpec } from '../../verification/sceneVerifier';
import { ASSET_REGISTRY, cloneSceneSpec, PRESET_2D_ASSETS } from '../../registry/assetRegistry';
import { SFX_PRESET_IDS } from '../../audio/audioBus';
import { PARTICLE_2D_PRESETS } from '../../vfx/particles2D';
import type { JsonPatchOp } from '../../utils/jsonPatch';
import type { SceneSpec, VerificationReport } from '../../types/scene.schema';

/** Max characters of any tool result sent back to the model. */
export const MAX_TOOL_RESULT_CHARS = 6000;

export const SCENE_SLICE_SECTIONS = [
  'summary',
  'actors',
  'nodes2D',
  'logic',
  'world',
  'rules',
  'hud',
  'variables',
  'audio',
  'camera',
  'vfx',
  'other',
] as const;
export type SceneSliceSection = (typeof SCENE_SLICE_SECTIONS)[number];

export const SCENE_TOOL_NAMES = ['get_scene_slice', 'apply_patch', 'verify', 'search_assets', 'add_from_kit', 'playtest', 'finish'] as const;
/** Tools the host provides through `SceneToolboxOptions.extraTools` (see gameTools.ts); a toolbox without them neither lists nor runs them. */
export const HOST_TOOL_NAMES = ['add_from_kit', 'playtest'] as const;
export type HostToolName = (typeof HOST_TOOL_NAMES)[number];
export type SceneToolName = (typeof SCENE_TOOL_NAMES)[number];

export type AssetSearchKind = '3d' | '2d-preset' | 'particle' | 'sfx';

/** A searchable asset. Callers add personal-library / hub names through `SceneToolboxOptions.assets`. */
export interface AssetHit {
  id: string;
  name: string;
  /** Built-ins use the four search kinds; library entries may also be 'image' | 'audio' | 'hdri' (only listed without a kind filter). */
  kind: AssetSearchKind | 'image' | 'audio' | 'hdri';
  category?: string;
  clips?: string[];
  tags?: string[];
  /** Loadable URL for library assets (the model must only reuse urls it is given). */
  url?: string;
  source?: string;
}

export interface SceneToolDefinition {
  name: SceneToolName;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

const PATCH_OP_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['add', 'replace', 'remove', 'move', 'copy', 'test'] },
    path: { type: 'string', description: 'JSON pointer. Address array items by id with "@": /actors/@hero/position. Append with "-".' },
    from: { type: 'string' },
    value: {},
  },
  required: ['op', 'path'],
};

export const SCENE_TOOL_DEFINITIONS: SceneToolDefinition[] = [
  {
    name: 'get_scene_slice',
    description:
      'Read part of the CURRENT scene as JSON. Call this before editing: request only the sections you need ("summary" is cheap; "actors", "nodes2D", "logic", "hud" can be large) and pass ids to narrow actors / nodes2D / vfx / logic nodes / hud / variables to specific items.',
    input_schema: {
      type: 'object',
      properties: {
        sections: { type: 'array', items: { type: 'string', enum: [...SCENE_SLICE_SECTIONS] }, description: 'Which sections to return.' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Optional ids that narrow the list sections.' },
      },
      required: ['sections'],
    },
  },
  {
    name: 'apply_patch',
    description:
      'Edit the scene with small steps. mergePatch (RFC 7386: objects merge, null deletes a key, arrays are replaced whole) is applied first, then ops (RFC 6902). OmniStage then repairs the logic graph, auto-fixes deterministic problems and runs the verifier; the result lists the remaining errors. A patch that makes verification worse is reverted. Send only what changes.',
    input_schema: {
      type: 'object',
      properties: {
        mergePatch: { type: 'object', description: 'RFC 7386 merge patch, applied first.' },
        ops: { type: 'array', items: PATCH_OP_SCHEMA, description: 'RFC 6902 operations, applied after the merge patch (max 200).' },
      },
    },
  },
  {
    name: 'verify',
    description: 'Run the deterministic verifier on the current scene and list its errors / warnings. Does not change anything.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_assets',
    description:
      'Find asset ids to use: 3D models (with their animation clips), 2D presets, particle presets, SFX presets and the creator\'s library assets. Use the returned id verbatim (assetId, emitter.preset, audio cue).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "robot", "coin", "fire". Empty lists the first entries.' },
        kind: { type: 'string', enum: ['3d', '2d-preset', 'particle', 'sfx'], description: 'Optional filter.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_from_kit',
    description:
      'Replace the level of a 2D GAME scene with a genre kit: a complete, verified level that a bot has beaten at every difficulty (platformer, key-hunt, turret-dodge, survival). Keeps the scene id, title and links; REPLACES its 2D nodes, game rules, HUD, variables, logic graph, stage size / camera and marketing overlay (anything built there is lost), so call it FIRST on a new or empty game, then adjust with apply_patch. Prefer it over hand-placing platforms for a standard genre.',
    input_schema: {
      type: 'object',
      properties: {
        kit: { type: 'string', enum: ['platformer', 'key-hunt', 'turret-dodge', 'survival'] },
        difficulty: { type: 'integer', minimum: 1, maximum: 6, description: '1 gentle ... 6 hard. Default 2.' },
        title: { type: 'string', description: 'Optional level title.' },
      },
      required: ['kit'],
    },
  },
  {
    name: 'playtest',
    description:
      'Let deterministic bots play the current 2D GAME on the real game runtime and return evidence: did a bot win (a replayable proof), how far the best one got, setbacks, where the player got stuck, whether doing nothing wins. "No bot won" is a warning to check, not proof the level is impossible. Run it after you change a level, and fix what it reports.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'finish',
    description: 'Call when the requested change is done (or cannot be done). summary is shown to the creator: what you changed and any limits.',
    input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
];

// ---------------------------------------------------------------------------
// The single check path
// ---------------------------------------------------------------------------

export interface CheckOptions {
  /** Whole storyboard (validates sequence links). */
  scenes?: SceneSpec[];
  /** Runs on a clone before the logic graph is finalized, e.g. the studio's `attachExtensionRecipes`. May return the names it attached. */
  recipes?: (spec: SceneSpec) => string[] | void;
}

export interface CheckResult extends PatchCheck {
  /** Logic-graph repair notes from finalizeLogicGraph. */
  notes: string[];
  /** Names returned by the recipes hook. */
  presets: string[];
}

/**
 * THE check every edit path uses (studio patch loop, tool loop, MCP): recipes hook -> finalizeLogicGraph -> autoFixSceneSpec.
 * Input is never mutated.
 */
export function checkScene(spec: SceneSpec, opts: CheckOptions = {}): CheckResult {
  const draft = cloneSceneSpec(spec);
  const presets = opts.recipes?.(draft) || [];
  const { spec: finalized, notes } = finalizeLogicGraph(draft);
  const fixed = autoFixSceneSpec(finalized, { scenes: opts.scenes });
  return { spec: fixed.spec, report: fixed.report, fixes: fixed.fixes, notes, presets };
}

const errorScore = (r: VerificationReport) => r.errors * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function capText(text: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const note = `\n…[truncated ${text.length - max} chars: ask for fewer sections or pass ids]`;
  return text.slice(0, Math.max(0, max - note.length)) + note;
}

const errorText = (msg: string) => capText(`ERROR: ${msg}`);

function toIdSet(ids: unknown): Set<string> | null {
  if (!Array.isArray(ids)) return null;
  const set = new Set(ids.filter((x): x is string => typeof x === 'string' && !!x));
  return set.size ? set : null;
}

function filterById<T extends { id?: string }>(items: T[] | undefined, ids: Set<string> | null): T[] {
  const list = Array.isArray(items) ? items : [];
  return ids ? list.filter((x) => x && typeof x.id === 'string' && ids.has(x.id)) : list;
}

/** Short scene summary for the model's first message (counts + key facts, no bulk data). */
export function summarizeScene(spec: SceneSpec): Record<string, unknown> {
  return {
    id: spec.id,
    title: spec.title,
    engineType: spec.engineType,
    mode: spec.mode,
    aspectRatio: spec.aspectRatio,
    durationSeconds: spec.durationSeconds,
    actors: spec.actors?.length ?? 0,
    nodes2D: spec.nodes2D?.length ?? 0,
    vfx: spec.vfx?.length ?? 0,
    logicNodes: spec.logicGraph?.nodes?.length ?? 0,
    logicEdges: spec.logicGraph?.edges?.length ?? 0,
    variables: (spec.variables || []).map((v) => v.id),
    hud: spec.hud?.length ?? 0,
    gameRules: spec.gameRules ? { winCondition: spec.gameRules.winCondition, targetScore: spec.gameRules.targetScore } : undefined,
    audio: spec.audio?.enabled ?? null,
    captions: spec.captions?.length ?? 0,
    world2D: spec.world2D ? { width: spec.world2D.width, height: spec.world2D.height } : undefined,
  };
}

/** The slice of a scene for the requested sections (pure; used by the tool and by tests). */
export function sliceScene(spec: SceneSpec, sections: SceneSliceSection[], ids?: string[]): Record<string, unknown> {
  const idSet = toIdSet(ids);
  const out: Record<string, unknown> = {};
  for (const section of sections) {
    switch (section) {
      case 'summary':
        out.summary = summarizeScene(spec);
        break;
      case 'actors':
        out.actors = filterById(spec.actors, idSet);
        break;
      case 'nodes2D':
        out.nodes2D = filterById(spec.nodes2D, idSet);
        break;
      case 'vfx':
        out.vfx = filterById(spec.vfx, idSet);
        break;
      case 'logic': {
        const g = spec.logicGraph;
        if (!g) {
          out.logic = null;
        } else if (idSet) {
          const nodes = (g.nodes || []).filter((n) => idSet.has(n.id));
          const edges = (g.edges || []).filter((e) => idSet.has(e.id) || nodes.some((n) => n.id === e.sourceNodeId || n.id === e.targetNodeId));
          out.logic = { nodes, edges };
        } else {
          out.logic = g;
        }
        break;
      }
      case 'world':
        out.world = { environment: spec.environment, world: spec.world, world2D: spec.world2D };
        break;
      case 'rules':
        out.rules = { gameRules: spec.gameRules, sequence: spec.sequence };
        break;
      case 'hud':
        out.hud = filterById(spec.hud, idSet);
        break;
      case 'variables':
        out.variables = filterById(spec.variables, idSet);
        break;
      case 'audio':
        out.audio = {
          audio: spec.audio,
          soundtrack: spec.soundtrack,
          dialogue: spec.dialogue,
          captions: spec.captions,
          audioTracks: spec.audioTracks,
          sfxLibrary: spec.sfxLibrary,
        };
        break;
      case 'camera':
        out.camera = { camera: spec.camera, camera2D: spec.camera2D, grade: spec.grade };
        break;
      case 'other':
        out.other = {
          marketingOverlay: spec.marketingOverlay,
          timelineTracks: spec.timelineTracks,
          particleLibrary: spec.particleLibrary,
          dialogueCaptions: spec.dialogueCaptions,
        };
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Asset search
// ---------------------------------------------------------------------------

function builtinAssets(spec: SceneSpec): AssetHit[] {
  const out: AssetHit[] = [];
  for (const a of Object.values(ASSET_REGISTRY)) {
    out.push({ id: a.assetId, name: a.name, kind: '3d', category: a.category, clips: a.embeddedClips || [], source: 'built-in' });
  }
  for (const p of PRESET_2D_ASSETS) {
    out.push({ id: p.id, name: p.name, kind: '2d-preset', category: `${p.nodeTemplate.type}${p.nodeTemplate.physics2D ? ` · ${p.nodeTemplate.physics2D}` : ''}`, source: 'built-in' });
  }
  for (const id of PARTICLE_2D_PRESETS as string[]) out.push({ id, name: id, kind: 'particle', source: 'built-in' });
  for (const id of Object.keys(spec.particleLibrary || {})) out.push({ id, name: id, kind: 'particle', source: 'this scene' });
  for (const id of SFX_PRESET_IDS as string[]) out.push({ id, name: id, kind: 'sfx', source: 'built-in' });
  for (const id of Object.keys(spec.sfxLibrary || {})) out.push({ id, name: id, kind: 'sfx', source: 'this scene' });
  return out;
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9À-ỹ]+/i).filter(Boolean);
}

/** Ranks assets by how many query words hit id / name / category / tags (id and name weigh more). */
export function searchAssets(spec: SceneSpec, extra: AssetHit[], query: string, kind?: AssetSearchKind, limit = 12): AssetHit[] {
  const pool = [...builtinAssets(spec), ...extra].filter((a) => (kind ? a.kind === kind : true));
  const words = tokens(query);
  if (!words.length) return pool.slice(0, limit);
  const scored = pool
    .map((a) => {
      const id = a.id.toLowerCase();
      const name = a.name.toLowerCase();
      const rest = `${a.category || ''} ${(a.tags || []).join(' ')} ${(a.clips || []).join(' ')}`.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (id.includes(w)) score += 3;
        if (name.includes(w)) score += 3;
        if (rest.includes(w)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}

function formatHit(a: AssetHit): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    ...(a.category ? { category: a.category } : {}),
    ...(a.clips?.length ? { clips: a.clips } : {}),
    ...(a.url ? { url: a.url } : {}),
    ...(a.source ? { source: a.source } : {}),
  };
}

// ---------------------------------------------------------------------------
// The toolbox
// ---------------------------------------------------------------------------

/** A host-provided tool: gets the toolbox (read `spec`, call `commitCandidate`) and the tool's arguments; returns the result text. */
export type HostToolHandler = (toolbox: SceneToolbox, args: Record<string, any>) => string;

export interface SceneToolboxOptions {
  /** Handlers for the host tools (`HOST_TOOL_NAMES`), from gameTools.ts. */
  extraTools?: Partial<Record<HostToolName, HostToolHandler>>;
  /** Other scenes of the project (for sequence validation). */
  scenes?: SceneSpec[];
  /** Extra searchable assets (personal library / hub names). */
  assets?: AssetHit[];
  /** Recipes hook, run by `checkScene` before the logic graph is finalized (studio: attachExtensionRecipes). */
  recipes?: (spec: SceneSpec) => string[] | void;
}

export interface PatchLogEntry {
  ok: boolean;
  ops: number;
  merged: boolean;
  /** Why the patch was not kept. */
  reason?: string;
  errorsAfter?: number;
}

export interface ToolboxResult {
  spec: SceneSpec;
  report: VerificationReport;
  fixes: string[];
  /** Logic-graph repair notes accumulated over the accepted patches. */
  notes: string[];
  presets: string[];
  /** At least one patch was kept. */
  changed: boolean;
  finished: boolean;
  summary: string;
  patches: PatchLogEntry[];
}

export class SceneToolbox {
  private working: SceneSpec;
  private best: CheckResult | null = null;
  private fixes: string[] = [];
  private notes = new Set<string>();
  private presets = new Set<string>();
  private patches: PatchLogEntry[] = [];
  private finishedFlag = false;
  private summaryText = '';
  private changed = false;
  private readonly opts: SceneToolboxOptions;

  constructor(spec: SceneSpec, opts: SceneToolboxOptions = {}) {
    this.working = cloneSceneSpec(spec);
    this.opts = opts;
  }

  /** Tool definitions (plain JSON-schema objects). */
  get definitions(): SceneToolDefinition[] {
    const hosted = this.opts.extraTools || {};
    return SCENE_TOOL_DEFINITIONS.filter((d) => !(HOST_TOOL_NAMES as readonly string[]).includes(d.name) || !!hosted[d.name as HostToolName]);
  }

  get finished(): boolean {
    return this.finishedFlag;
  }

  /** The working spec (already includes every kept patch). */
  get spec(): SceneSpec {
    return this.working;
  }

  private check(spec: SceneSpec): CheckResult {
    return checkScene(spec, { scenes: this.opts.scenes, recipes: this.opts.recipes });
  }

  /** Baseline = the best checked state so far (the first call checks the scene as handed in). */
  private baseline(): CheckResult {
    if (!this.best) this.best = this.check(this.working);
    return this.best;
  }

  /** The model's first message: instruction + addressable ids + summary. Not the whole spec. */
  buildUserPrompt(prompt: string): string {
    const base = this.baseline();
    return `USER INSTRUCTION: "${prompt.slice(0, 4000)}"

SCENE SUMMARY:
${JSON.stringify(summarizeScene(this.working))}

ADDRESSABLE IDS:
${buildIdIndex(this.working)}

CURRENT VERIFIER STATE: ${describeReportForModel(base.report, 6)}

Use get_scene_slice to read what you need, apply_patch in small steps, verify, then finish.`;
  }

  /** Runs one tool. Always returns a string (capped); failures are "ERROR: ..." text. */
  run(name: string, input: unknown): string {
    try {
      const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, any>) : {};
      switch (name) {
        case 'get_scene_slice':
          return this.getSlice(args);
        case 'apply_patch':
          return this.applyPatch(args);
        case 'verify':
          return this.verifyTool();
        case 'search_assets':
          return this.searchTool(args);
        case 'add_from_kit':
        case 'playtest': {
          const handler = this.opts.extraTools?.[name];
          if (!handler) return errorText(`Tool "${name}" is not available in this host. Available: ${this.definitions.map((d) => d.name).join(', ')}.`);
          return capText(handler(this, args));
        }
        case 'finish': {
          this.finishedFlag = true;
          this.summaryText = typeof args.summary === 'string' ? args.summary.trim().slice(0, 1200) : '';
          return 'OK: finished.';
        }
        default:
          return errorText(`Unknown tool "${String(name).slice(0, 60)}". Available: ${this.definitions.map((d) => d.name).join(', ')}.`);
      }
    } catch (e) {
      return errorText(`Tool "${String(name).slice(0, 60)}" failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private getSlice(args: Record<string, any>): string {
    const raw = Array.isArray(args.sections) ? args.sections : typeof args.sections === 'string' ? [args.sections] : [];
    const bad = raw.filter((s: unknown) => !(SCENE_SLICE_SECTIONS as readonly string[]).includes(String(s)));
    if (!raw.length) return errorText(`"sections" is required. Choose from: ${SCENE_SLICE_SECTIONS.join(', ')}.`);
    if (bad.length) return errorText(`Unknown section(s): ${bad.map(String).join(', ')}. Choose from: ${SCENE_SLICE_SECTIONS.join(', ')}.`);
    return capText(JSON.stringify(sliceScene(this.working, raw as SceneSliceSection[], args.ids)));
  }

  private applyPatch(args: Record<string, any>): string {
    const proposal: PatchProposal = {};
    if (args.mergePatch !== undefined) {
      if (!args.mergePatch || typeof args.mergePatch !== 'object' || Array.isArray(args.mergePatch)) return errorText('"mergePatch" must be an object.');
      proposal.mergePatch = args.mergePatch;
    }
    if (args.ops !== undefined) {
      if (!Array.isArray(args.ops)) return errorText('"ops" must be an array of JSON Patch operations.');
      proposal.ops = args.ops as JsonPatchOp[];
    }
    const opCount = proposal.ops?.length ?? 0;
    const merged = !!proposal.mergePatch && Object.keys(proposal.mergePatch).length > 0;
    if (!opCount && !merged) return errorText('Nothing to apply: send "mergePatch" and/or a non-empty "ops" array.');

    let candidate: SceneSpec;
    try {
      candidate = applyPatchProposal(this.working, proposal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.patches.push({ ok: false, ops: opCount, merged, reason: msg });
      return errorText(`PATCH REJECTED: ${msg}. Nothing was applied; the scene is unchanged. Send a corrected patch.`);
    }

    return this.commitCandidate(candidate, { ops: opCount, merged, label: [merged ? 'mergePatch' : '', opCount ? opCount + ' op(s)' : ''].filter(Boolean).join(' + ') });
  }

  /**
   * The one place a changed scene is checked and kept: checkScene, revert when it raises the error count, otherwise commit.
   * Used by apply_patch and by host tools that replace parts of the scene (add_from_kit). Returns the tool result text.
   */
  commitCandidate(candidate: SceneSpec, info: { ops?: number; merged?: boolean; label: string }): string {
    const opCount = info.ops ?? 0;
    const merged = info.merged ?? false;
    const base = this.baseline();
    const checked = this.check(candidate);
    if (errorScore(checked.report) > errorScore(base.report)) {
      this.patches.push({ ok: false, ops: opCount, merged, reason: 'worse', errorsAfter: checked.report.errors });
      return errorText(
        `PATCH REVERTED: it made verification worse (${base.report.errors} -> ${checked.report.errors} errors), so the scene is unchanged.\n${describeReportForModel(checked.report, 8)}\nRetry with a patch that also fixes what these errors point at.`
      );
    }

    this.working = checked.spec;
    this.best = checked;
    this.changed = true;
    this.fixes.push(...checked.fixes);
    checked.notes.forEach((n) => this.notes.add(n));
    checked.presets.forEach((p) => this.presets.add(p));
    this.patches.push({ ok: true, ops: opCount, merged, errorsAfter: checked.report.errors });
    const fixLine = checked.fixes.length ? ` OmniStage auto-fixed ${checked.fixes.length} issue(s): ${checked.fixes.slice(0, 3).join('; ')}${checked.fixes.length > 3 ? '; ...' : ''}.` : '';
    return capText(`OK: patch applied (${info.label}).${fixLine}\n${describeReportForModel(checked.report, 8)}`);
  }

  private verifyTool(): string {
    const report = verifySceneSpec(this.working, { scenes: this.opts.scenes });
    return capText(describeReportForModel(report, 12));
  }

  private searchTool(args: Record<string, any>): string {
    const query = typeof args.query === 'string' ? args.query : '';
    const kinds: string[] = ['3d', '2d-preset', 'particle', 'sfx'];
    if (args.kind !== undefined && !kinds.includes(String(args.kind))) return errorText(`Unknown kind "${String(args.kind)}". Use one of: ${kinds.join(', ')}.`);
    const hits = searchAssets(this.working, this.opts.assets || [], query, args.kind as AssetSearchKind | undefined);
    if (!hits.length) return `No assets matched "${query.slice(0, 80)}"${args.kind ? ` (kind ${args.kind})` : ''}. Try a broader word or no kind filter.`;
    return capText(JSON.stringify(hits.map(formatHit)));
  }

  /** What the caller gets when the loop ends. */
  result(): ToolboxResult {
    const final = this.best ?? this.check(this.working);
    return {
      spec: this.changed ? this.working : final.spec,
      report: final.report,
      fixes: [...this.fixes],
      notes: [...this.notes],
      presets: [...this.presets],
      changed: this.changed,
      finished: this.finishedFlag,
      summary: this.summaryText,
      patches: [...this.patches],
    };
  }
}

/** Tool definitions in the MCP shape (name, description, inputSchema). */
export function mcpToolDefinition(name: SceneToolName): { name: string; description: string; inputSchema: Record<string, unknown> } {
  const def = SCENE_TOOL_DEFINITIONS.find((d) => d.name === name);
  if (!def) throw new Error(`Unknown scene tool ${name}`);
  return { name: `omnistage_${def.name}`, description: def.description, inputSchema: def.input_schema as unknown as Record<string, unknown> };
}
