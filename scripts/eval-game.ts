/**
 * Game eval runner (Phase 5F): builds the levels for each golden game prompt, verifies and plays them with the playtest bot, scores them with
 * src/agent/gameEval.ts and compares with the previous run.
 *
 *   npm run eval:game                                  offline director (no AI, no network): the baseline
 *   npm run eval:game -- --server http://localhost:3000 --provider cli-claude   live AI through the running studio server
 *
 * Options: --server URL, --provider ID, --model NAME, --key KEY (or env EVAL_AI_KEY; sent only to --server), --only a,b, --label NAME,
 *          --out DIR (default output/eval), --no-save, --min-score N (exit 1 when the mean is under N).
 * Results are written to output/eval/game-<mode>-<timestamp>.json (git-ignored). The score does not judge looks: it tracks verifier health,
 * whether a bot can win each level, engagement and pacing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareGameReports, evaluateGame, GAME_EVAL_WEIGHTS, offlineGameLevels, type GameEvalReport } from '../src/agent/gameEval';
import { detectStoryboardIntent, generateStoryboardWithAgent } from '../src/agent/storyboardAgent';
import { checkScene } from '../src/agent/tools/sceneTools';
import { DEFAULT_SETTINGS } from '../src/state/storeHelpers';
import type { AIProviderId, SceneSpec } from '../src/types/scene.schema';

interface GoldenPrompt { id: string; shape: string; prompt: string }
interface PromptResult { id: string; shape: string; prompt: string; source: string; ms: number; report: GameEvalReport; error?: string }
interface RunFile {
  version: 1;
  mode: 'offline' | 'live';
  label?: string;
  provider?: string;
  createdAt: string;
  mean: number;
  dimensionMeans: Record<string, number>;
  results: PromptResult[];
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const server = typeof args.server === 'string' ? args.server.replace(/\/$/, '') : '';
const mode: 'offline' | 'live' = server ? 'live' : 'offline';
const outDir = path.resolve(typeof args.out === 'string' ? args.out : 'output/eval');
const only = typeof args.only === 'string' ? new Set(args.only.split(',').map((s) => s.trim())) : null;

// The agent talks to relative /api URLs (browser). Offline: every call fails fast like a missing key; live: forward to --server.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (typeof url === 'string' && url.startsWith('/')) {
    if (!server) return new Response(JSON.stringify({ error: 'offline eval: no AI connection' }), { status: 503 });
    return realFetch(server + url, init);
  }
  return realFetch(input, init);
}) as typeof fetch;

const settings = {
  ...DEFAULT_SETTINGS,
  directorQA: false,
  aiProvider: (typeof args.provider === 'string' ? args.provider : DEFAULT_SETTINGS.aiProvider) as AIProviderId,
  aiModels: typeof args.model === 'string' && typeof args.provider === 'string' ? { [args.provider]: args.model } : {},
  aiApiKeys:
    typeof args.provider === 'string' && (typeof args.key === 'string' || process.env.EVAL_AI_KEY)
      ? { [args.provider]: String(args.key ?? process.env.EVAL_AI_KEY) }
      : {},
};

const color = (code: number, s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const scoreColor = (n: number) => color(n >= 85 ? 32 : n >= 70 ? 36 : n >= 55 ? 33 : 31, String(n).padStart(3));
const arrow = (d: number) => (d > 0 ? color(32, `+${d}`) : d < 0 ? color(31, String(d)) : color(90, ' 0'));

function latestPrevious(): RunFile | null {
  if (!fs.existsSync(outDir)) return null;
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(`game-${mode}-`) && f.endsWith('.json')).sort();
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(outDir, files[files.length - 1]), 'utf-8')) as RunFile; } catch { return null; }
}

async function levelsFor(prompt: string): Promise<{ scenes: SceneSpec[]; source: string }> {
  if (mode === 'offline') {
    const scenes = offlineGameLevels(prompt);
    if (!scenes) throw new Error('the prompt is not a multi-level game request');
    return { scenes, source: 'offline' };
  }
  const intent = detectStoryboardIntent(prompt);
  if (!intent || intent.kind !== 'game-levels') throw new Error('the prompt is not a multi-level game request');
  const result = await generateStoryboardWithAgent(prompt, intent, settings);
  return { scenes: result.scenes.map((s) => checkScene(s).spec), source: result.source };
}

async function main() {
  const golden = JSON.parse(fs.readFileSync(path.resolve('eval/game-prompts.json'), 'utf-8')) as { prompts: GoldenPrompt[] };
  const prompts = golden.prompts.filter((p) => !only || only.has(p.id));
  if (!prompts.length) { console.error('No prompts selected.'); process.exit(2); }
  const previous = latestPrevious();
  console.log(`Game eval · ${mode}${mode === 'live' ? ` · ${settings.aiProvider}` : ''} · ${prompts.length} prompt(s)\n`);

  const results: PromptResult[] = [];
  for (const p of prompts) {
    const started = Date.now();
    let result: PromptResult;
    try {
      const { scenes, source } = await levelsFor(p.prompt);
      result = { id: p.id, shape: p.shape, prompt: p.prompt, source, ms: Date.now() - started, report: evaluateGame({ scenes }) };
      if (args['save-scenes']) {
        const dir = path.join(outDir, 'scenes');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${p.id}.scenespec.json`), JSON.stringify({ scenes }, null, 2));
      }
    } catch (e: any) {
      result = { id: p.id, shape: p.shape, prompt: p.prompt, source: 'error', ms: Date.now() - started, error: e?.message || String(e), report: evaluateGame({ scenes: [] }) };
    }
    results.push(result);
    const prev = previous?.results.find((x) => x.id === p.id);
    const won = result.report.levels.filter((l) => l.outcome === 'won').length;
    const dims = result.report.dimensions.map((d) => `${d.id.slice(0, 4)} ${String(d.score).padStart(3)}`).join(' · ');
    console.log(`${p.id.padEnd(16)} ${scoreColor(result.report.score)} ${result.report.grade}  ${prev ? arrow(result.report.score - prev.report.score) : '  '}  [${result.source}, ${won}/${result.report.levels.length} levels won, ${(result.ms / 1000).toFixed(1)}s]`);
    console.log(`  ${dims}`);
    if (result.error) console.log(`  ! ${result.error}`);
    for (const d of [...result.report.dimensions].sort((a, b) => a.score - b.score).slice(0, 2)) {
      for (const n of d.notes.slice(0, 2)) console.log(color(90, `  - ${d.label}: ${n}`));
    }
    if (prev) {
      const delta = compareGameReports(prev.report, result.report);
      const worse = Object.entries(delta.dimensions).filter(([, v]) => v < 0).map(([k, v]) => `${k} ${v}`);
      if (worse.length) console.log(color(31, `  regressed: ${worse.join(', ')}`));
    }
  }

  const mean = Math.round(results.reduce((n, r) => n + r.report.score, 0) / results.length);
  const dimensionMeans: Record<string, number> = {};
  for (const id of Object.keys(GAME_EVAL_WEIGHTS)) {
    dimensionMeans[id] = Math.round(results.reduce((n, r) => n + (r.report.dimensions.find((d) => d.id === id)?.score ?? 0), 0) / results.length);
  }
  const passing = results.filter((r) => r.report.score >= 80).length;
  console.log(`\nMean ${scoreColor(mean)}${previous ? `  (${arrow(mean - previous.mean)} vs ${previous.createdAt.slice(0, 16)})` : ''} · ${passing}/${results.length} prompts ≥ 80`);
  console.log(Object.entries(dimensionMeans).map(([k, v]) => `${k} ${v}${previous?.dimensionMeans[k] !== undefined ? ` (${arrow(v - previous.dimensionMeans[k])})` : ''}`).join(' · '));

  if (!args['no-save']) {
    const file: RunFile = {
      version: 1, mode, label: typeof args.label === 'string' ? args.label : undefined,
      provider: mode === 'live' ? settings.aiProvider : undefined,
      createdAt: new Date().toISOString(), mean, dimensionMeans, results,
    };
    fs.mkdirSync(outDir, { recursive: true });
    const name = `game-${mode}-${file.createdAt.replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(file, null, 2));
    console.log(`Saved ${path.relative(process.cwd(), path.join(outDir, name))}`);
  }
  const min = typeof args['min-score'] === 'string' ? Number(args['min-score']) : null;
  if (min !== null && mean < min) { console.error(`Mean ${mean} is under --min-score ${min}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
