/**
 * Phase 5 — OmniStage MCP tool implementations (headless, file-based).
 *
 * External coding agents (Claude Code, Codex, ...) author OmniStage projects through these tools instead of
 * editing JSON by hand. Every mutation goes through the same contract code the studio uses
 * (createBlankSceneSpec, autoFixSceneSpec, the playable exporter), and the project file stays a normal
 * `.scenespec.json` bundle that the studio imports via Library → Import.
 */
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { EngineType, SceneSpec, StudioMode } from '../src/types/scene.schema';
import { ASSET_REGISTRY, createBlankSceneSpec, PRESET_2D_ASSETS } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import { BUILTIN_DIRECTOR_SKILLS, buildSkillContext, inferSkillContext, selectDirectorSkills } from '../src/agent/directorSkills';
import { EASE_IDS } from '../src/animation/easing';
import { SFX_PRESET_IDS, GAME_AUDIO_EVENTS } from '../src/audio/audioBus';
import { PARTICLE_2D_PRESETS } from '../src/vfx/particles2D';
import { captionsToSRT, captionsToWebVTT } from '../src/media/captions';
import { buildStandalonePlayable, StandaloneAdNetwork } from '../src/exporter/mediaExporter';
import { PLAYER_RUNTIME } from '../src/exporter/generated/playerRuntime';
import { applyJsonPatch, mergePatch } from '../src/utils/jsonPatch';

export interface ProjectBundle {
  projectBundleVersion: string;
  activeSceneId: string;
  scenes: SceneSpec[];
}

export interface ToolContext {
  /** The `.scenespec.json` project file the server operates on. */
  projectPath: string;
  /** Exports may only be written inside this directory. */
  rootDir: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutates?: boolean;
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
}

export class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Project persistence
// ---------------------------------------------------------------------------

export function normalizeBundle(raw: any): ProjectBundle {
  if (raw && Array.isArray(raw.scenes) && raw.scenes.length) {
    const active = raw.scenes.find((s: SceneSpec) => s.id === raw.activeSceneId) ? raw.activeSceneId : raw.scenes[0].id;
    return { projectBundleVersion: raw.projectBundleVersion || '3.1.0', activeSceneId: active, scenes: raw.scenes };
  }
  if (raw && raw.id && raw.engineType) {
    return { projectBundleVersion: '3.1.0', activeSceneId: raw.id, scenes: [raw] };
  }
  throw new ToolError('Project file is neither a .scenespec.json bundle nor a single SceneSpec.');
}

/** Studio-compatible file shape: the active scene's fields at the top level + scenes[]. */
export function serializeBundle(bundle: ProjectBundle): string {
  const active = bundle.scenes.find((s) => s.id === bundle.activeSceneId) || bundle.scenes[0];
  return JSON.stringify({ ...active, projectBundleVersion: bundle.projectBundleVersion, activeSceneId: active.id, scenes: bundle.scenes }, null, 2);
}

export async function loadProject(ctx: ToolContext): Promise<ProjectBundle | null> {
  try {
    return normalizeBundle(JSON.parse(await fs.readFile(ctx.projectPath, 'utf8')));
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    if (e instanceof ToolError) throw e;
    throw new ToolError(`Cannot read project ${ctx.projectPath}: ${e?.message || e}`);
  }
}

async function requireProject(ctx: ToolContext): Promise<ProjectBundle> {
  const bundle = await loadProject(ctx);
  if (!bundle) throw new ToolError(`Project ${ctx.projectPath} does not exist yet. Call omnistage_create_scene first.`);
  return bundle;
}

export async function saveProject(ctx: ToolContext, bundle: ProjectBundle): Promise<void> {
  await fs.mkdir(dirname(ctx.projectPath), { recursive: true });
  const tmp = `${ctx.projectPath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, serializeBundle(bundle), 'utf8');
  await fs.rename(tmp, ctx.projectPath);
}

function pickScene(bundle: ProjectBundle, sceneId?: string): SceneSpec {
  const id = sceneId || bundle.activeSceneId;
  const scene = bundle.scenes.find((s) => s.id === id);
  if (!scene) throw new ToolError(`Scene "${id}" not found. Known: ${bundle.scenes.map((s) => s.id).join(', ')}`);
  return scene;
}

function replaceScene(bundle: ProjectBundle, scene: SceneSpec) {
  bundle.scenes = bundle.scenes.map((s) => (s.id === scene.id ? scene : s));
}

/** Resolves an output path and refuses anything outside rootDir. */
export function safeOutputPath(ctx: ToolContext, outPath: string): string {
  const full = isAbsolute(outPath) ? resolve(outPath) : resolve(ctx.rootDir, outPath);
  const rel = relative(resolve(ctx.rootDir), full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new ToolError(`Refusing to write outside ${ctx.rootDir}: ${outPath}`);
  return full;
}

// ---------------------------------------------------------------------------
// Patching: JSON Merge Patch (RFC 7386) + JSON Patch subset (RFC 6902)
// ---------------------------------------------------------------------------

export { mergePatch, applyJsonPatch } from '../src/utils/jsonPatch';
export type { JsonPatchOp } from '../src/utils/jsonPatch';

function summarize(scene: SceneSpec) {
  return {
    id: scene.id,
    title: scene.title,
    engineType: scene.engineType,
    mode: scene.mode,
    durationSeconds: scene.durationSeconds,
    actors: scene.actors?.length || 0,
    nodes2D: scene.nodes2D?.length || 0,
    vfx: scene.vfx?.length || 0,
    captions: scene.captions?.length || 0,
    audio: scene.audio?.enabled ?? null,
    sequence: scene.sequence ? { index: scene.sequence.index, nextSceneId: scene.sequence.nextSceneId } : null,
  };
}

const sceneIdProp = { sceneId: { type: 'string', description: 'Scene id (defaults to the active scene).' } };

// ---------------------------------------------------------------------------
// Tool catalogue
// ---------------------------------------------------------------------------

export const OMNISTAGE_TOOLS: ToolDefinition[] = [
  {
    name: 'omnistage_contract',
    description:
      'Returns the OmniStage authoring vocabulary: asset ids, 2D presets, particle presets, SFX presets/events, easings, director skills and the key SceneSpec rules. Call this first.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({
      rules: [
        'Everything is declarative SceneSpec JSON (src/types/scene.schema.ts); never write renderer code.',
        "2D stage is 1000x600 (y down). 3D player arena is x/z within ±5.5, actors grounded at y=0.",
        'Every patch is verified; fixable problems are auto-repaired and remaining errors are returned to you.',
      ],
      assets3D: Object.values(ASSET_REGISTRY).map((a) => ({ assetId: a.assetId, name: a.name, category: a.category, clips: a.embeddedClips || [] })),
      presets2D: PRESET_2D_ASSETS.map((p) => ({ id: p.id, name: p.name, type: p.nodeTemplate.type, role: p.nodeTemplate.physics2D })),
      particlePresets: PARTICLE_2D_PRESETS,
      sfxPresets: SFX_PRESET_IDS,
      audioEvents: GAME_AUDIO_EVENTS,
      easings: EASE_IDS,
      skills: BUILTIN_DIRECTOR_SKILLS.map((s) => ({ id: s.id, title: s.title, engine: s.engine, mode: s.mode })),
    }),
  },
  {
    name: 'omnistage_director_skills',
    description: 'Selects the OmniStage Director Skills relevant to a creative brief and returns their rules as text to follow while authoring.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Creative brief, e.g. "3-level neon platformer with sound".' },
        engineType: { type: 'string', enum: ['2d', '3d'] },
        mode: { type: 'string', enum: ['game', 'media'] },
      },
      required: ['prompt'],
    },
    run: async (args) => {
      const ctx = inferSkillContext(String(args.prompt), { engineType: args.engineType || '3d', mode: args.mode || 'media' });
      const skills = selectDirectorSkills(String(args.prompt), ctx);
      return { context: ctx, skills: skills.map((s) => s.id), guidance: buildSkillContext(skills) || 'No specific skill matched.' };
    },
  },
  {
    name: 'omnistage_list_scenes',
    description: 'Lists the scenes of the project with a short summary each.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => {
      const bundle = await loadProject(ctx);
      if (!bundle) return { projectPath: ctx.projectPath, exists: false, scenes: [] };
      return { projectPath: ctx.projectPath, exists: true, activeSceneId: bundle.activeSceneId, scenes: bundle.scenes.map(summarize) };
    },
  },
  {
    name: 'omnistage_get_scene',
    description: 'Returns the full SceneSpec JSON of one scene.',
    inputSchema: { type: 'object', properties: sceneIdProp },
    run: async (args, ctx) => pickScene(await requireProject(ctx), args.sceneId),
  },
  {
    name: 'omnistage_create_scene',
    description: 'Creates a blank 2D or 3D scene (creating the project file if needed) and makes it active.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        engineType: { type: 'string', enum: ['2d', '3d'] },
        title: { type: 'string' },
        mode: { type: 'string', enum: ['game', 'media'] },
      },
      required: ['engineType'],
    },
    run: async (args, ctx) => {
      const scene = createBlankSceneSpec(args.engineType as EngineType, args.title);
      if (args.mode) scene.mode = args.mode as StudioMode;
      const bundle = (await loadProject(ctx)) || { projectBundleVersion: '3.1.0', activeSceneId: scene.id, scenes: [] };
      bundle.scenes.push(scene);
      bundle.activeSceneId = scene.id;
      await saveProject(ctx, bundle);
      return { created: summarize(scene), verification: verifySceneSpec(scene, { scenes: bundle.scenes }) };
    },
  },
  {
    name: 'omnistage_apply_patch',
    description:
      'Mutates a scene with a JSON Merge Patch (object; null deletes a key; arrays are replaced) and/or JSON Patch ops (add/replace/remove/move/copy/test with JSON pointers, e.g. "/nodes2D/-"; address array items by id with "@", e.g. "/actors/@hero/position"). The result is verified and deterministic problems are auto-fixed (autoFix=false to skip). Returns the verification report.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...sceneIdProp,
        mergePatch: { type: 'object', description: 'RFC 7386 merge patch applied first.' },
        ops: {
          type: 'array',
          description: 'RFC 6902 operations applied after the merge patch.',
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: ['add', 'replace', 'remove', 'move', 'copy', 'test'] }, path: { type: 'string' }, from: { type: 'string' }, value: {} },
            required: ['op', 'path'],
          },
        },
        autoFix: { type: 'boolean', default: true },
      },
    },
    run: async (args, ctx) => {
      const bundle = await requireProject(ctx);
      const scene = pickScene(bundle, args.sceneId);
      let next: SceneSpec = args.mergePatch ? mergePatch(scene, args.mergePatch) : JSON.parse(JSON.stringify(scene));
      if (Array.isArray(args.ops) && args.ops.length) next = applyJsonPatch(next, args.ops);
      next.id = scene.id; // ids are stable handles; create a new scene instead of renaming
      let fixes: string[] = [];
      let report = verifySceneSpec(next, { scenes: bundle.scenes });
      if (args.autoFix !== false) {
        const fixed = autoFixSceneSpec(next, { scenes: bundle.scenes });
        next = fixed.spec;
        fixes = fixed.fixes;
        report = fixed.report;
      }
      replaceScene(bundle, next);
      await saveProject(ctx, bundle);
      return { sceneId: next.id, summary: summarize(next), autoFixes: fixes, verification: report };
    },
  },
  {
    name: 'omnistage_verify',
    description: 'Runs the deterministic SceneSpec verifier (playability, reachability, score goals, timing, captions, cues) without changing anything.',
    inputSchema: { type: 'object', properties: sceneIdProp },
    run: async (args, ctx) => {
      const bundle = await requireProject(ctx);
      return verifySceneSpec(pickScene(bundle, args.sceneId), { scenes: bundle.scenes });
    },
  },
  {
    name: 'omnistage_set_active_scene',
    description: 'Sets which scene the studio opens first and which scene tools default to.',
    mutates: true,
    inputSchema: { type: 'object', properties: sceneIdProp, required: ['sceneId'] },
    run: async (args, ctx) => {
      const bundle = await requireProject(ctx);
      bundle.activeSceneId = pickScene(bundle, args.sceneId).id;
      await saveProject(ctx, bundle);
      return { activeSceneId: bundle.activeSceneId };
    },
  },
  {
    name: 'omnistage_link_scenes',
    description: 'Links scenes in order as a storyboard (sets sequence.nextSceneId, index, total) so winning a level advances to the next one.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        sceneIds: { type: 'array', items: { type: 'string' }, description: 'Ordered scene ids (defaults to project order).' },
        title: { type: 'string' },
        kind: { type: 'string', enum: ['film', 'game-levels', 'ad-sequence'] },
      },
    },
    run: async (args, ctx) => {
      const bundle = await requireProject(ctx);
      const ids: string[] = Array.isArray(args.sceneIds) && args.sceneIds.length ? args.sceneIds : bundle.scenes.map((s) => s.id);
      const ordered = ids.map((id) => pickScene(bundle, id));
      const storyboardId = `storyboard-${Date.now().toString(36)}`;
      ordered.forEach((scene, i) => {
        scene.sequence = {
          storyboardId,
          storyboardTitle: args.title || ordered[0].title,
          kind: args.kind || (scene.mode === 'game' ? 'game-levels' : 'film'),
          index: i,
          total: ordered.length,
          nextSceneId: ordered[i + 1]?.id,
          beat: scene.sequence?.beat,
        };
      });
      await saveProject(ctx, bundle);
      return { linked: ordered.map((s) => s.id) };
    },
  },
  {
    name: 'omnistage_export_playable',
    description:
      'Writes a single-file HTML5 playable (OmniStage Player runtime, models/images embedded within the network budget) for the whole project and returns the size budget report.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sceneIdProp,
        network: { type: 'string', enum: ['universal', 'tiktok', 'meta', 'telegram', 'itch'], default: 'universal' },
        outPath: { type: 'string', description: 'Output .html path, relative to the server root.' },
      },
      required: ['outPath'],
    },
    run: async (args, ctx) => {
      const bundle = await requireProject(ctx);
      const scene = pickScene(bundle, args.sceneId);
      const network = (args.network || 'universal') as StandaloneAdNetwork;
      // OmniStage Player runtime + models / images embedded within the network budget (http(s) URLs only here;
      // studio-relative library URLs need the studio's export).
      const { html, budget, embed } = await buildStandalonePlayable(scene, network, bundle.scenes, {
        playerRuntimeSource: PLAYER_RUNTIME,
        fetcher: async (url) => {
          if (!/^https?:\/\//i.test(url)) throw new Error('not an http(s) URL');
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
        },
      });
      const out = safeOutputPath(ctx, args.outPath);
      await fs.mkdir(dirname(out), { recursive: true });
      await fs.writeFile(out, html, 'utf8');
      return { written: out, budget, embedded: embed?.embedded.map((e) => e.url) ?? [], notEmbedded: embed?.skipped ?? [] };
    },
  },
  {
    name: 'omnistage_export_captions',
    description: 'Writes a scene\'s captions as WebVTT or SRT.',
    inputSchema: {
      type: 'object',
      properties: { ...sceneIdProp, format: { type: 'string', enum: ['vtt', 'srt'], default: 'vtt' }, outPath: { type: 'string' } },
      required: ['outPath'],
    },
    run: async (args, ctx) => {
      const scene = pickScene(await requireProject(ctx), args.sceneId);
      const text = args.format === 'srt' ? captionsToSRT(scene.captions || []) : captionsToWebVTT(scene.captions || []);
      const out = safeOutputPath(ctx, args.outPath);
      await fs.mkdir(dirname(out), { recursive: true });
      await fs.writeFile(out, text, 'utf8');
      return { written: out, cues: (scene.captions || []).length };
    },
  },
];

export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<{ text: string; isError: boolean }> {
  const tool = OMNISTAGE_TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool "${name}"`, isError: true };
  try {
    const result = await tool.run(args && typeof args === 'object' ? args : {}, ctx);
    return { text: JSON.stringify(result, null, 2), isError: false };
  } catch (e: any) {
    return { text: e instanceof ToolError ? e.message : `Tool failed: ${e?.message || e}`, isError: true };
  }
}
