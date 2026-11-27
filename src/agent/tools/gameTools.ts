/**
 * Phase 5 (Director C + E) — the host tools of the scene tool layer: `add_from_kit` and `playtest`.
 *
 * They need the headless game runtime and the genre kits, so they live apart from `sceneTools.ts` (which the client imports for tool
 * names). A host that can run them (the studio's tool loop on the server, the MCP server) passes `GAME_TOOL_HANDLERS` as
 * `SceneToolboxOptions.extraTools`; every other toolbox simply does not list them.
 */
import { buildGenreKit, GENRE_KITS, isGenreKitId, KIT_SCENE_FIELDS } from '../genreKits';
import { formatPlaytestReport, playtestScene } from '../../playtest/bot2d';
import type { HostToolHandler, HostToolName } from './sceneTools';
import type { SceneSpec } from '../../types/scene.schema';

const KIT_IDS = GENRE_KITS.map((k) => k.id).join(', ');

/** The working scene with a kit's level swapped in: the kit decides `KIT_SCENE_FIELDS` (and the empty logic graph); id, title, links and the rest stay. */
export function applyKitToScene(scene: SceneSpec, kitId: string, difficulty: number, title?: string): SceneSpec {
  const kit = buildGenreKit(kitId as never, { difficulty, title: title || scene.title, index: scene.sequence?.index ?? 0, total: scene.sequence?.total });
  const next = JSON.parse(JSON.stringify(scene)) as SceneSpec & Record<string, unknown>;
  const source = kit as unknown as Record<string, unknown>;
  // The kit also owns the stage it was built for (default size, no scroll) and an empty logic graph: a stale camera / world / graph would point at deleted nodes.
  for (const field of [...KIT_SCENE_FIELDS, 'logicGraph', 'gameRules', 'world2D', 'camera2D'] as string[]) {
    if (source[field] === undefined) delete next[field];
    else next[field] = JSON.parse(JSON.stringify(source[field]));
  }
  next.mode = 'game';
  return next;
}

const addFromKit: HostToolHandler = (toolbox, args) => {
  const spec = toolbox.spec;
  if (spec.engineType !== '2d') return 'ERROR: add_from_kit builds 2D game levels; this scene is 3D.';
  const kit = typeof args.kit === 'string' ? args.kit : '';
  if (!isGenreKitId(kit)) return `ERROR: Unknown kit "${kit.slice(0, 40)}". Kits: ${KIT_IDS}.`;
  const raw = Number(args.difficulty);
  const difficulty = Number.isFinite(raw) ? Math.max(1, Math.min(6, Math.round(raw))) : 2;
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 80) : undefined;
  const candidate = applyKitToScene(spec, kit, difficulty, title);
  const result = toolbox.commitCandidate(candidate, { label: `kit ${kit}, difficulty ${difficulty}` });
  if (result.startsWith('ERROR:')) return result;
  const info = GENRE_KITS.find((k) => k.id === kit)!;
  // The kit is promised to be winnable: confirm it on the MERGED scene (what is kept), not only on a blank one.
  const played = playtestScene(toolbox.spec);
  const verdict = played.outcome === 'won' ? 'a bot beat the merged level' : `WARNING: no bot beat the merged level (${played.reason ?? 'check the leftover scene settings'})`;
  return `${result}\nThe level is now the "${info.name}" kit (${info.summary}) — ${candidate.nodes2D.length} nodes; ${verdict}. Adjust with apply_patch (keep ids you do not touch).`;
};

const playtest: HostToolHandler = (toolbox) => {
  const report = playtestScene(toolbox.spec);
  if (!report.supported || report.outcome === 'unsupported') return formatPlaytestReport(report);
  const runs = report.runs.map(
    (r) => `${r.strategy}${r.seed > 0 && r.strategy === 'wander' ? `#${r.seed}` : ''}: ${r.stop}, ${r.seconds}s, score ${r.score}${r.targetScore ? `/${r.targetScore}` : ''}, ${r.collected}/${r.collectibles} collectibles, ${r.setbacks} setbacks`
  );
  return `${formatPlaytestReport(report)}\nRuns:\n${runs.map((l) => `- ${l}`).join('\n')}`;
};

export const GAME_TOOL_HANDLERS: Record<HostToolName, HostToolHandler> = { add_from_kit: addFromKit, playtest };
