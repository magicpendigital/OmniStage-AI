/**
 * Film eval runner (Phase 11A): generates a storyboard for each golden prompt, scores the film with src/agent/filmEval.ts and
 * compares with the previous run.
 *
 *   npm run eval:film                                  offline generator (no AI, no network): the baseline
 *   npm run eval:film -- --server http://localhost:3000 --provider cli-claude   live AI through the running studio server
 *
 * Options:
 *   --server URL        studio server to call for /api/agent/* (omit = offline generator)
 *   --provider ID       AI connection (gemini | anthropic | openrouter | openai-compatible | cli-claude | cli-codex | cli-antigravity | cli-opencode)
 *   --model NAME        model for that connection
 *   --key KEY           API key for that connection (or env EVAL_AI_KEY); sent only to the --server URL
 *   --only a,b          run only these prompt ids          --label NAME  tag stored in the result file
 *   --out DIR           results folder (default output/eval)   --no-save  do not write a result file
 *   --save-scenes       also write each generated film as .scenespec.json next to the result
 *   --min-score N       exit 1 when the mean score is under N (for CI / gates)
 *
 * Results are written to output/eval/film-<mode>-<timestamp>.json (output/ is git-ignored). The deterministic score does not
 * judge looks; it tracks story coverage, hook, acting, camera, sound, dialogue, continuity and verifier health.
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluateFilm, EVAL_WEIGHTS, type FilmEvalReport } from '../src/agent/filmEval';
import { detectStoryboardIntent, generateStoryboardWithAgent, type StoryboardIntent } from '../src/agent/storyboardAgent';
import { DEFAULT_SETTINGS } from '../src/state/storeHelpers';
import type { AIProviderId } from '../src/types/scene.schema';

interface GoldenPrompt { id: string; shape: string; prompt: string }
interface PromptResult {
  id: string;
  shape: string;
  prompt: string;
  source: string;
  ms: number;
  report: FilmEvalReport;
  bible?: { logline: string; score?: number };
  error?: string;
}
interface RunFile {
  version: 1;
  mode: 'offline' | 'live';
  label?: string;
  provider?: string;
  model?: string;
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

// The agent talks to relative /api URLs (browser). Offline: every call fails fast (like a missing key); live: forward to --server.
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
  directorQA: false, // needs a rendered Player + a vision model; the deterministic eval does not use it
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
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(`film-${mode}-`) && f.endsWith('.json')).sort();
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(outDir, files[files.length - 1]), 'utf-8')) as RunFile; } catch { return null; }
}

async function main() {
  const golden = JSON.parse(fs.readFileSync(path.resolve('eval/golden-prompts.json'), 'utf-8')) as { prompts: GoldenPrompt[] };
  const prompts = golden.prompts.filter((p) => !only || only.has(p.id));
  if (!prompts.length) { console.error('No prompts selected.'); process.exit(2); }
  const previous = latestPrevious();
  console.log(`Film eval · ${mode}${mode === 'live' ? ` · ${settings.aiProvider}` : ''} · ${prompts.length} prompt(s)\n`);

  const results: PromptResult[] = [];
  for (const p of prompts) {
    const intent: StoryboardIntent = detectStoryboardIntent(p.prompt) ?? { sceneCount: 3, kind: 'film', engineType: '3d' };
    const started = Date.now();
    try {
      const result = await generateStoryboardWithAgent(p.prompt, intent, settings);
      const report = evaluateFilm({ scenes: result.scenes, bible: result.bible });
      results.push({
        id: p.id, shape: p.shape, prompt: p.prompt, source: result.source, ms: Date.now() - started, report,
        ...(result.bible ? { bible: { logline: result.bible.logline, score: result.bibleScore } } : {}),
      });
      if (args['save-scenes']) {
        const dir = path.join(outDir, 'scenes');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${p.id}.scenespec.json`), JSON.stringify({ scenes: result.scenes, bible: result.bible }, null, 2));
      }
    } catch (e: any) {
      results.push({ id: p.id, shape: p.shape, prompt: p.prompt, source: 'error', ms: Date.now() - started, error: e?.message || String(e),
        report: evaluateFilm({ scenes: [] }) });
    }
    const r = results[results.length - 1];
    const prev = previous?.results.find((x) => x.id === p.id);
    const dims = r.report.dimensions.map((d) => `${d.id.slice(0, 4)} ${String(d.score).padStart(3)}`).join(' · ');
    console.log(`${p.id.padEnd(24)} ${scoreColor(r.report.score)} ${r.report.grade}  ${prev ? arrow(r.report.score - prev.report.score) : '  '}  [${r.source}, ${r.report.scenes} scenes, ${(r.ms / 1000).toFixed(1)}s]`);
    console.log(`  ${dims}`);
    if (r.error) console.log(`  ! ${r.error}`);
    for (const d of [...r.report.dimensions].sort((a, b) => a.score - b.score).slice(0, 2)) {
      for (const n of d.notes.slice(0, 2)) console.log(color(90, `  - ${d.label}: ${n}`));
    }
  }

  const mean = Math.round(results.reduce((n, r) => n + r.report.score, 0) / results.length);
  const dimensionMeans: Record<string, number> = {};
  for (const id of Object.keys(EVAL_WEIGHTS)) {
    dimensionMeans[id] = Math.round(results.reduce((n, r) => n + (r.report.dimensions.find((d) => d.id === id)?.score ?? 0), 0) / results.length);
  }
  const passing = results.filter((r) => r.report.score >= 80).length;
  console.log(`\nMean ${scoreColor(mean)}${previous ? `  (${arrow(mean - previous.mean)} vs ${previous.createdAt.slice(0, 16)})` : ''} · ${passing}/${results.length} prompts ≥ 80`);
  console.log(Object.entries(dimensionMeans).map(([k, v]) => `${k} ${v}${previous?.dimensionMeans[k] !== undefined ? ` (${arrow(v - previous.dimensionMeans[k])})` : ''}`).join(' · '));

  if (!args['no-save']) {
    const file: RunFile = {
      version: 1, mode, label: typeof args.label === 'string' ? args.label : undefined,
      provider: mode === 'live' ? settings.aiProvider : undefined,
      model: typeof args.model === 'string' ? args.model : undefined,
      createdAt: new Date().toISOString(), mean, dimensionMeans, results,
    };
    fs.mkdirSync(outDir, { recursive: true });
    const name = `film-${mode}-${file.createdAt.replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(file, null, 2));
    console.log(`Saved ${path.relative(process.cwd(), path.join(outDir, name))}`);
  }
  const min = typeof args['min-score'] === 'string' ? Number(args['min-score']) : null;
  if (min !== null && mean < min) { console.error(`Mean ${mean} is under --min-score ${min}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
