/**
 * Meshy session connector, layer 2: use the account the user is ALREADY signed in with (credits on the account),
 * by driving the official `meshy-cli` (0.4.0) as a subprocess, instead of pasting an API key.
 *
 * Rules (also in .claude/rules/workspace-and-extensions.md):
 *  - Drive the CLI only. Never read, copy, log or return the CLI's credential store or any token; only the documented
 *    bare-JSON `auth status` fields and free `balance` number leave this module.
 *  - Spend gate: `estimate()` is free; `startCharacter()` refuses unless `confirm === true`. One paid `create` per
 *    stage, never retried: exit 9 (no credit) stops the job, exit 10 / timeouts reconcile on the SAME task id.
 *  - Files go to a per-job temp dir under os.tmpdir() (`--workspace`), then into the AssetStore; the temp dir is removed.
 *
 * Assumptions about CLI JSON shapes (documented in the Meshy skill, unverified without a live CLI) are marked ASSUME.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AssetStore, LibraryAsset } from '../workspace/assets';
import { MAX_ASSET_BYTES } from '../workspace/assets';
import { mergeGlbAnimations } from './glbMerge';
import { sniffResult } from './jobs';
import { cleanPrompt, GenerationError } from './providers';
import {
  cliFailure,
  deepFind,
  deepFindNumber,
  MeshyError,
  parseJsonLoose,
  readEnvelope,
  resolveRunner,
  scrub,
  STD_FLAGS,
  type LongProcess,
  type MeshyRunner,
  type RunResult,
} from './meshyRunner';

export { MeshyError };

export const MESHY_LICENSE = 'AI-generated with Meshy; rights per your Meshy plan (free plan: CC BY 4.0)';
export const PRICING_URL = 'https://docs.meshy.ai/en/api/pricing';
export const JOB_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_ACTIVE_MESHY_JOBS = 2;
export const MAX_MESHY_PROMPT = 600;
const MAX_WAIT_ATTEMPTS = 4; // x 600 s: a wait timeout (exit 8) is not a failure, the same wait resumes the same task
const TASK_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;
const NOTE_NOT_COVERED = 'A rigged character also needs a remesh (Meshy only rigs models under 380,000 triangles), a retexture and the rigging itself (with the bundled walking/running clips). Those are not covered by the dry run: check the published price list for their cost. One real run cost 40 credits in total (preview 20, remesh 5, retexture 10, rigging 5).';
/** Meshy rejects rigging above 380,000 triangles; text-to-3d output is far denser. A low target also keeps the model light in the studio and in playable ads. */
const RIG_TARGET_POLYCOUNT = 30000;

// ------------------------------------------------------------------------------------------------ views

export interface AuthView {
  authenticated: boolean;
  verified: boolean;
  source: string;
  hint?: string;
}

export interface LoginView {
  state: 'idle' | 'waiting' | 'logged_in' | 'failed' | 'expired';
  /** https://…meshy.ai/… verification page, only while waiting. */
  url?: string;
  /** The short user code to type on that page (not a credential), only while waiting. */
  code?: string;
  message?: string;
}

export interface CharacterInput {
  prompt: unknown;
  name?: unknown;
  textured?: boolean;
  rig?: boolean;
  heightMeters?: number;
  scope?: string;
  /** Must be exactly `true`: the user saw the estimate and agreed to spend credits. */
  confirm?: unknown;
  /** Merge the walking/running clips into the rigged GLB (default true). */
  mergeClips?: boolean;
}

export interface Estimate {
  /** Credits for preview + refine from the CLI's own planner; rigging is NOT included. */
  credits?: number;
  source: 'cli-dry-run' | 'unknown';
  balance?: number;
  steps: string[];
  notes: string[];
}

export type MeshyJobStage = 'queued' | 'preview' | 'remesh' | 'retexture' | 'refine' | 'rigging' | 'downloading' | 'saving' | 'done';

export interface MeshyJobView {
  id: string;
  kind: 'character';
  prompt: string;
  name: string;
  scope: string;
  textured: boolean;
  rig: boolean;
  status: 'running' | 'succeeded' | 'failed';
  stage: MeshyJobStage;
  /** 0-100, coarse: moves when a stage starts or finishes (Meshy reports no progress through the CLI wait). */
  progress: number;
  error?: string;
  errorCode?: string;
  /** Meshy task ids per stage (not secrets). Present as soon as the paid create was accepted. */
  tasks: { preview?: string; remesh?: string; retexture?: string; refine?: string; rigging?: string };
  /** Sum of `consumed_credits` over the stages, or null when Meshy did not report all of them. */
  consumedCredits: number | null;
  creditsByStage: { preview: number | null; remesh: number | null; retexture: number | null; refine: number | null; rigging: number | null };
  asset?: LibraryAsset;
  assets: LibraryAsset[];
  clips?: string[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

interface Job extends MeshyJobView {
  expiresAt: number;
  heightMeters: number;
  mergeClips: boolean;
  done: Promise<void>;
}

export interface MeshyDeps {
  /** A runner, or a factory; default resolves `meshy` 0.4.0 on PATH, else the pinned `npm exec`. Tests inject a fake. */
  runner?: MeshyRunner | (() => Promise<MeshyRunner>);
  /** Maps a scope ("personal" | "project:<id>") to its AssetStore; must throw for an unknown scope. */
  storeFor: (scope: string) => AssetStore;
  now?: () => number;
  tmpRoot?: string;
  sleep?: (ms: number) => Promise<void>;
}

// ------------------------------------------------------------------------------------------------ input cleaning

/** A single argv-safe prompt: control characters removed, no leading dash (it would read as a flag), max 600 chars. */
export function cleanMeshyPrompt(raw: unknown): string {
  let text: string;
  try {
    text = cleanPrompt(raw);
  } catch (e) {
    if (e instanceof GenerationError) throw new MeshyError(e.message, 400, 'bad_prompt');
    throw e;
  }
  text = text.replace(/^[\s\-‐-―]+/, '').slice(0, MAX_MESHY_PROMPT).trim();
  if (text.length < 3) throw new MeshyError('Describe the character (at least 3 characters).', 400, 'bad_prompt');
  return text;
}

function cleanName(raw: unknown, prompt: string): string {
  const base = typeof raw === 'string' && raw.trim() ? raw : prompt;
  const words = base.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ').replace(/^-+/, '');
  return (words || 'Meshy character').slice(0, 60);
}

function cleanHeight(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1.7;
  return Math.round(Math.max(0.3, Math.min(3, n)) * 100) / 100;
}

const asTaskId = (v: unknown, what: string): string => {
  const id = String(v ?? '');
  if (!TASK_ID_RE.test(id)) throw new MeshyError(`Meshy returned an unexpected ${what} id`, 502, 'bad_task_id');
  return id;
};

// Pure command builders (exported so tests can assert exactly what is sent and how often).
export const cmd = {
  authStatus: () => ['auth', 'status', '--format', 'json', '--no-update-check'],
  login: () => ['auth', 'login', '--device', '--format', 'json', '--no-update-check'],
  balance: () => ['balance', ...STD_FLAGS],
  dryRun: (prompt: string) => ['make', prompt, '--dry-run', ...STD_FLAGS],
  createPreview: (prompt: string) => ['text-to-3d', 'create', '--mode', 'preview', '--prompt', prompt, '--pose-mode', 'a-pose', '--target-formats', 'glb', '--async', ...STD_FLAGS],
  createRefine: (previewId: string, pd: string, ws: string) => ['text-to-3d', 'create', '--mode', 'refine', '--preview-task-id', previewId, '--enable-pbr', 'true', '--target-formats', 'glb', '--async', '--project', pd, '--stage', 'refine', '--workspace', ws, ...STD_FLAGS],
  createRemesh: (sourceId: string, pd: string, ws: string) => ['remesh', 'create', '--input-task-id', sourceId, '--topology', 'triangle', '--target-polycount', String(RIG_TARGET_POLYCOUNT), '--target-formats', 'glb', '--async', '--project', pd, '--stage', 'remesh', '--workspace', ws, ...STD_FLAGS],
  createRetexture: (sourceId: string, prompt: string, pd: string, ws: string) => ['retexture', 'create', '--input-task-id', sourceId, '--text-style-prompt', prompt, '--enable-pbr', 'true', '--target-formats', 'glb', '--async', '--project', pd, '--stage', 'retexture', '--workspace', ws, ...STD_FLAGS],
  createRigging: (textureId: string, height: number, pd: string, ws: string) => ['rigging', 'create', '--input-task-id', textureId, '--height-meters', String(height), '--async', '--project', pd, '--stage', 'rigging', '--workspace', ws, ...STD_FLAGS],
  projectInit: (root: string, name: string, taskId: string, ws: string) => ['project', 'init', '--root', root, '--name', name, '--task-id', taskId, '--task-type', 'text-to-3d', '--workspace', ws, ...STD_FLAGS],
  wait: (resource: string, id: string, pd: string, stage: string, ws: string) => [resource, 'wait', id, '--timeout', '600', '--project', pd, '--stage', stage, '--workspace', ws, ...STD_FLAGS],
  inspectFaces: (taskJson: string) => ['inspect', 'faces', '--task-json', taskJson, '--max-faces', '300000', ...STD_FLAGS],
  downloadAsset: (taskJson: string, asset: string, out: string, pd: string, stage: string, ws: string) => ['download', '--task-json', taskJson, '--asset', asset, '--output', out, '--project', pd, '--stage', stage, '--workspace', ws, ...STD_FLAGS],
  downloadModel: (taskJson: string, out: string, pd: string, stage: string, ws: string) => ['download', '--task-json', taskJson, '--model-format', 'glb', '--output', out, '--project', pd, '--stage', stage, '--workspace', ws, ...STD_FLAGS],
};

function stepLabel(step: unknown): string | undefined {
  if (typeof step === 'string') return scrub(step, 120);
  if (!step || typeof step !== 'object') return undefined;
  const s = step as Record<string, unknown>;
  const label = [s.name, s.title, s.label, s.command, s.type, s.id].find((v) => typeof v === 'string' && v) as string | undefined;
  if (!label) return undefined;
  const credits = [s.estimated_credits, s.credits, s.cost].find((v) => typeof v === 'number') as number | undefined;
  return scrub(credits !== undefined ? `${label} (${credits} credits)` : label, 120);
}

const DEVICE_LINE_RE = /Enter code\s+([A-Za-z0-9-]{3,20})\s+at\s+(https?:\/\/[^\s]+)/i;

/** https on meshy.ai (or a subdomain), no credentials, no port. */
export function validateVerificationUrl(raw: string): string | null {
  try {
    const u = new URL(raw.replace(/[.,;:)\]]+$/, ''));
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (host !== 'meshy.ai' && !host.endsWith('.meshy.ai')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Parses `Enter code WXYZ-1234 at https://www.meshy.ai/device`; null when absent or the URL is not trustworthy. */
export function parseDeviceLine(line: string): { code: string; url: string } | 'bad_url' | null {
  const m = DEVICE_LINE_RE.exec(line);
  if (!m) return null;
  const url = validateVerificationUrl(m[2]);
  const code = m[1].toUpperCase();
  if (!url || !/^[A-Z0-9-]{3,20}$/.test(code)) return 'bad_url';
  return { code, url };
}

// ------------------------------------------------------------------------------------------------ service

export function createMeshyService(deps: MeshyDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const jobs = new Map<string, Job>();
  let runnerPromise: Promise<MeshyRunner> | null = null;
  let balanceCache: { at: number; value: number | undefined } | null = null;
  let login: { view: LoginView; proc?: LongProcess; seq: number } = { view: { state: 'idle' }, seq: 0 };

  async function getRunner(): Promise<MeshyRunner> {
    if (!runnerPromise) {
      const r = deps.runner;
      runnerPromise = (typeof r === 'function' ? r() : r ? Promise.resolve(r) : resolveRunner()).catch((e) => {
        runnerPromise = null; // do not cache a failure: the user may install Node/npm and retry
        throw e;
      });
    }
    return runnerPromise;
  }

  async function runCli(args: string[], timeoutMs: number): Promise<RunResult> {
    const runner = await getRunner();
    try {
      return await runner.run(args, { timeoutMs });
    } catch (e: any) {
      if (e instanceof MeshyError) throw e;
      throw new MeshyError(`Could not run the Meshy CLI (${scrub(e?.code || e?.message || 'spawn error', 80)}).`, 503, 'spawn_failed');
    }
  }

  // ---- auth -------------------------------------------------------------------------------------------------

  /** Only `{authenticated, verified, source, hint}`; token-shaped text is scrubbed from the hint. */
  async function authStatus(): Promise<AuthView> {
    const r = await runCli(cmd.authStatus(), 60_000);
    const raw = parseJsonLoose(r.stdout);
    const j = raw && typeof raw === 'object' ? (raw.authenticated !== undefined ? raw : (raw.result ?? raw)) : undefined;
    if (!j || typeof j !== 'object') {
      return { authenticated: false, verified: false, source: 'unknown', hint: scrub(r.stderr || 'Could not read the Meshy sign-in status.', 200) };
    }
    const source = typeof j.source === 'string' ? j.source.replace(/[^\w:. -]/g, '').slice(0, 40) || 'unknown' : 'unknown';
    const view: AuthView = { authenticated: j.authenticated === true, verified: j.authenticated === true && j.verified === true && r.code === 0, source };
    if (typeof j.hint === 'string' && j.hint.trim()) view.hint = scrub(j.hint, 200);
    return view;
  }

  /** Free call; returns only a number (credits) or undefined. */
  async function balance(): Promise<number | undefined> {
    if (balanceCache && now() - balanceCache.at < 20_000) return balanceCache.value;
    let value: number | undefined;
    try {
      const r = await runCli(cmd.balance(), 60_000);
      if (r.code === 0) value = deepFindNumber(readEnvelope(r).result, ['balance', 'credits', 'available_credits', 'credit_balance', 'remaining_credits', 'available']);
    } catch {
      value = undefined;
    }
    balanceCache = { at: now(), value };
    return value;
  }

  async function requireSession(): Promise<AuthView> {
    const auth = await authStatus();
    if (!auth.authenticated) throw new MeshyError('Sign in to Meshy first (Connect Meshy account).', 401, 'login_required');
    if (!auth.verified) {
      throw new MeshyError('Meshy could not verify the saved session (network or server problem?). Nothing was changed and no new login was started; try again in a moment.', 503, 'session_unverified');
    }
    return auth;
  }

  async function status() {
    let runnerInfo: { available: boolean; kind?: string; version?: string; command?: string; error?: string; code?: string };
    try {
      const runner = await getRunner();
      runnerInfo = { available: true, kind: runner.kind, version: runner.version, command: runner.describe };
    } catch (e: any) {
      runnerInfo = { available: false, error: scrub(e?.message || 'Meshy CLI unavailable', 240), code: e instanceof MeshyError ? e.code : 'runner_failed' };
    }
    let auth: AuthView | undefined;
    let bal: number | undefined;
    if (runnerInfo.available) {
      try {
        auth = await authStatus();
        if (auth.authenticated && auth.verified) bal = await balance();
      } catch (e: any) {
        auth = { authenticated: false, verified: false, source: 'unknown', hint: scrub(e?.message || 'status check failed', 200) };
      }
    }
    const state = !runnerInfo.available ? 'runner_unavailable' : !auth?.authenticated ? 'login_required' : !auth.verified ? 'unverified' : 'ready';
    return { state, runner: runnerInfo, auth, balance: bal ?? null, login: loginView() };
  }

  // ---- device login -------------------------------------------------------------------------------------------

  function loginView(): LoginView {
    const { state, url, code, message } = login.view;
    return state === 'waiting' ? { state, url, code } : { state, ...(message ? { message } : {}) };
  }

  async function startLogin(): Promise<LoginView> {
    if (login.view.state === 'waiting') return loginView();
    const runner = await getRunner();
    const seq = ++login.seq;
    const view: LoginView = { state: 'waiting' };
    let proc: LongProcess;
    try {
      proc = runner.spawnLong(cmd.login(), { timeoutMs: 15 * 60_000, maxBytes: 256 * 1024 });
    } catch (e: any) {
      throw new MeshyError(`Could not start the Meshy login (${scrub(e?.code || e?.message || 'spawn error', 80)}).`, 503, 'spawn_failed');
    }
    login = { view, proc, seq };
    let urlReady!: () => void;
    const ready = new Promise<void>((r) => (urlReady = r));
    proc.onLine((_stream, line) => {
      if (login.seq !== seq || login.view.state !== 'waiting') return;
      const parsed = parseDeviceLine(line);
      if (!parsed) return;
      if (parsed === 'bad_url') {
        proc.kill();
        login.view = { state: 'failed', message: 'Meshy printed a verification address that is not on meshy.ai; login was stopped.' };
      } else {
        login.view = { state: 'waiting', url: parsed.url, code: parsed.code };
      }
      urlReady();
    });
    proc.wait().then(
      async (r) => {
        if (login.seq !== seq || login.view.state !== 'waiting') return urlReady();
        const text = `${r.stderr}\n${r.stdout}`;
        if (r.code === 0) {
          let verified = false;
          try {
            verified = (await authStatus()).verified;
          } catch {
            verified = false;
          }
          balanceCache = null;
          login.view = verified ? { state: 'logged_in' } : { state: 'failed', message: 'Login finished but Meshy could not verify the session. Check the connection and try again.' };
        } else if (/device_flow_not_supported/i.test(text)) {
          login.view = { state: 'failed', message: 'This Meshy host has no device login. Run `meshy auth login` in your own terminal instead.' };
        } else if (r.timedOut || r.code === 8 || /expired|denied/i.test(text)) {
          login.view = { state: 'expired', message: 'The code expired or was denied. Start again for a new code.' };
        } else {
          login.view = { state: 'failed', message: `Login did not complete (${scrub(text.trim().split('\n').slice(-1)[0] || `exit ${r.code}`, 160)}).` };
        }
        urlReady();
      },
      (e: any) => {
        if (login.seq === seq) login.view = { state: 'failed', message: `Could not run the Meshy login (${scrub(e?.code || e?.message || 'error', 80)}).` };
        urlReady();
      }
    );
    const timer = setTimeout(urlReady, 20_000);
    timer.unref?.();
    await ready;
    clearTimeout(timer);
    return loginView();
  }

  function cancelLogin(): LoginView {
    if (login.view.state === 'waiting') {
      login.proc?.kill();
      login = { view: { state: 'idle' }, seq: login.seq + 1 };
    }
    return loginView();
  }

  // ---- estimate -------------------------------------------------------------------------------------------------

  async function estimate(input: Pick<CharacterInput, 'prompt' | 'textured' | 'rig'>): Promise<Estimate> {
    const prompt = cleanMeshyPrompt(input.prompt);
    const rig = input.rig !== false;
    const textured = input.textured !== false;
    const notes: string[] = [];
    let credits: number | undefined;
    let cliSteps: string[] = [];
    try {
      const r = await runCli(cmd.dryRun(prompt), 60_000);
      if (r.code === 0) {
        const env = readEnvelope(r);
        // ASSUME: v1 envelope result has `estimated_credits` (number) and `steps[]` (docs: delivery.md "Cost").
        credits = deepFindNumber(env.result, ['estimated_credits']);
        const steps = deepFind(env.result, 'steps');
        if (Array.isArray(steps)) cliSteps = steps.map(stepLabel).filter((s): s is string => !!s).slice(0, 10);
      }
    } catch (e) {
      if (e instanceof MeshyError && ['node_too_old', 'npm_missing'].includes(e.code)) throw e;
    }
    if (credits === undefined) notes.push('The Meshy CLI gave no estimate; the exact price is unknown (see the published price list).');
    if (!textured) notes.push('The dry run plans a textured model; an untextured preview costs less.');
    notes.push(NOTE_NOT_COVERED, `Price list: ${PRICING_URL}`);
    const steps = [...(cliSteps.length ? cliSteps : textured ? ['Preview mesh (text-to-3d, A-pose)', 'Texture (refine, PBR)'] : ['Preview mesh (text-to-3d, A-pose)'])];
    if (rig) steps.push('Rigging + bundled walking/running clips (price not covered by the dry run)');
    const result: Estimate = { source: credits !== undefined ? 'cli-dry-run' : 'unknown', steps, notes };
    if (credits !== undefined) result.credits = credits;
    const bal = await balance();
    if (bal !== undefined) result.balance = bal;
    return result;
  }

  // ---- jobs -------------------------------------------------------------------------------------------------

  const toView = (j: Job): MeshyJobView => {
    const { expiresAt: _a, heightMeters: _h, mergeClips: _m, done: _d, ...view } = j;
    return { ...view, tasks: { ...j.tasks }, creditsByStage: { ...j.creditsByStage }, assets: [...j.assets], warnings: [...j.warnings] };
  };

  function sweep() {
    const t = now();
    for (const [id, j] of jobs) if (j.expiresAt < t && j.status !== 'running') jobs.delete(id);
  }

  function touch(j: Job, patch: Partial<Pick<Job, 'stage' | 'progress'>>) {
    Object.assign(j, patch);
    j.updatedAt = new Date(now()).toISOString();
  }

  async function startCharacter(input: CharacterInput): Promise<MeshyJobView> {
    // Spend gate first, before anything can touch the CLI.
    if (input.confirm !== true) {
      throw new MeshyError('This spends Meshy credits. Show the estimate and send confirm: true to start.', 400, 'confirm_required');
    }
    const prompt = cleanMeshyPrompt(input.prompt);
    const textured = input.textured !== false;
    const rig = input.rig !== false;
    if (rig && !textured) throw new MeshyError('Rigging needs a textured model. Turn texturing on or rigging off.', 400, 'rig_needs_texture');
    const scope = String(input.scope || 'personal');
    const store = deps.storeFor(scope); // validates the scope before any credits are spent
    sweep();
    if ([...jobs.values()].filter((j) => j.status === 'running').length >= MAX_ACTIVE_MESHY_JOBS) {
      throw new MeshyError(`At most ${MAX_ACTIVE_MESHY_JOBS} Meshy generations can run at once.`, 429, 'too_many_jobs');
    }
    await requireSession();
    const stamp = new Date(now()).toISOString();
    const job = {
      id: randomBytes(12).toString('hex'),
      kind: 'character',
      prompt,
      name: cleanName(input.name, prompt),
      scope,
      textured,
      rig,
      status: 'running',
      stage: 'queued',
      progress: 1,
      tasks: {},
      consumedCredits: null,
      creditsByStage: { preview: null, remesh: null, retexture: null, refine: null, rigging: null },
      assets: [],
      warnings: [],
      createdAt: stamp,
      updatedAt: stamp,
      expiresAt: now() + JOB_TTL_MS,
      heightMeters: cleanHeight(input.heightMeters),
      mergeClips: input.mergeClips !== false,
      done: Promise.resolve(),
    } as Job;
    jobs.set(job.id, job);
    job.done = runCharacter(job, store).catch(() => undefined);
    return toView(job);
  }

  async function stageCreate(j: Job, stage: 'preview' | 'remesh' | 'retexture' | 'refine' | 'rigging', args: string[]): Promise<string> {
    // The only place a paid `create` is issued; a stage can never be created twice in one job.
    if (j.tasks[stage]) throw new MeshyError(`Internal error: ${stage} was already submitted`, 500, 'duplicate_create');
    const r = await runCli(args, 120_000);
    if (r.code !== 0) throw cliFailure(r, `Submitting the ${stage} stage`);
    const env = readEnvelope(r);
    // ASSUME: create --async prints `result.submission.task_id` (pipelines.md "Shared lifecycle").
    const id = asTaskId(deepFind(env.result, 'task_id') ?? deepFind(env.result, 'id'), 'task');
    j.tasks[stage] = id;
    return id;
  }

  async function waitStage(j: Job, resource: string, stage: 'preview' | 'remesh' | 'retexture' | 'refine' | 'rigging', id: string, pd: string, ws: string): Promise<unknown> {
    let last: RunResult | undefined;
    for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt++) {
      last = await runCli(cmd.wait(resource, id, pd, stage, ws), 11 * 60_000);
      if (last.code === 0) return readEnvelope(last).result;
      // Timeout (8), network blip (7), rate limit (6): the task keeps running remotely; resume the SAME wait. Never re-create.
      if (last.timedOut || last.code === 8 || last.code === 7 || last.code === 6) {
        if (last.code !== 8 && !last.timedOut) await sleep(5_000);
        continue;
      }
      break;
    }
    if (last && (last.timedOut || [6, 7, 8].includes(last.code))) {
      throw new MeshyError(`Meshy is still working on the ${stage} task (${id}) after a long wait. It was not resubmitted; look for that task in your Meshy account.`, 504, 'wait_timeout');
    }
    throw cliFailure(last!, `The ${stage} stage`);
  }

  async function credits(ws: string, pd: string, id: string, env: unknown): Promise<number | null> {
    let n = deepFindNumber(env, ['consumed_credits']);
    if (n === undefined) {
      try {
        const file = join(pd, `task_${id}.json`);
        const stat = await fs.stat(file);
        if (stat.size < 2_000_000 && inside(ws, file)) n = deepFindNumber(JSON.parse(await fs.readFile(file, 'utf8')), ['consumed_credits']);
      } catch {
        n = undefined;
      }
    }
    return n ?? null;
  }

  const inside = (root: string, p: string) => {
    const rel = relative(resolve(root), resolve(p));
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
  };

  async function readDownloaded(ws: string, file: string): Promise<Buffer> {
    if (!inside(ws, file)) throw new MeshyError('Meshy wrote a file outside the job folder; it was ignored.', 502, 'bad_path');
    const stat = await fs.stat(file);
    if (stat.size > MAX_ASSET_BYTES) throw new MeshyError('The generated file is larger than 200 MB', 413, 'too_large');
    const data = await fs.readFile(file);
    try {
      sniffResult(data, 'model');
    } catch {
      throw new MeshyError('Meshy returned a file that is not a GLB model.', 502, 'bad_file');
    }
    return data;
  }

  async function download(ws: string, args: string[], file: string, what: string): Promise<Buffer> {
    const r = await runCli(args, 5 * 60_000);
    if (r.code !== 0) throw cliFailure(r, what);
    return readDownloaded(ws, file);
  }

  async function runCharacter(j: Job, store: AssetStore): Promise<void> {
    const ws = await fs.mkdtemp(join(deps.tmpRoot ?? tmpdir(), 'omnistage-meshy-'));
    try {
      const root = join(ws, 'meshy_output');
      // 1. preview
      touch(j, { stage: 'preview', progress: 5 });
      const previewId = await stageCreate(j, 'preview', cmd.createPreview(j.prompt));
      const init = await runCli(cmd.projectInit(root, j.name, previewId, ws), 60_000);
      if (init.code !== 0) throw cliFailure(init, `Setting up the job folder (the preview task ${previewId} was already submitted)`);
      const pdRaw = deepFind(readEnvelope(init).result, 'project_dir');
      if (typeof pdRaw !== 'string' || !inside(ws, pdRaw)) throw new MeshyError('The Meshy CLI reported an unexpected project folder.', 502, 'bad_path');
      const pd = resolve(pdRaw);
      const previewEnv = await waitStage(j, 'text-to-3d', 'preview', previewId, pd, ws);
      j.creditsByStage.preview = await credits(ws, pd, previewId, previewEnv);

      let modelTask = previewId;
      let modelStage: 'preview' | 'refine' = 'preview';
      if (j.textured && j.rig) {
        // Rigging path: text-to-3d output is ~1M triangles and Meshy rigs at most 380,000, so remesh the preview first, then texture
        // the remeshed model (a remeshed model is textured with retexture, not refine), then rig.
        touch(j, { stage: 'remesh', progress: 25 });
        const remeshId = await stageCreate(j, 'remesh', cmd.createRemesh(previewId, pd, ws));
        const remeshEnv = await waitStage(j, 'remesh', 'remesh', remeshId, pd, ws);
        j.creditsByStage.remesh = await credits(ws, pd, remeshId, remeshEnv);
        touch(j, { stage: 'retexture', progress: 45 });
        const texId = await stageCreate(j, 'retexture', cmd.createRetexture(remeshId, j.prompt, pd, ws));
        const texEnv = await waitStage(j, 'retexture', 'retexture', texId, pd, ws);
        j.creditsByStage.retexture = await credits(ws, pd, texId, texEnv);
        modelTask = texId;
      } else if (j.textured) {
        // Static textured model (no rig): the plain preview -> refine path.
        touch(j, { stage: 'refine', progress: 35 });
        const refineId = await stageCreate(j, 'refine', cmd.createRefine(previewId, pd, ws));
        const refineEnv = await waitStage(j, 'text-to-3d', 'refine', refineId, pd, ws);
        j.creditsByStage.refine = await credits(ws, pd, refineId, refineEnv);
        modelTask = refineId;
        modelStage = 'refine';
      }

      let main: Buffer;
      const clipFiles: Array<{ name: string; data: Buffer }> = [];
      if (j.rig) {
        // 3. rigging (must start from the textured task)
        touch(j, { stage: 'rigging', progress: 70 });
        const faces = await runCli(cmd.inspectFaces(join(pd, `task_${modelTask}.json`)), 60_000);
        if (faces.code === 12) throw new MeshyError('The textured model has too many faces to rig (limit 300,000). Nothing more was spent.', 422, 'too_dense');
        if (faces.code !== 0) j.warnings.push(`The face-count check gave no answer (exit ${faces.code}); the model was remeshed to ${RIG_TARGET_POLYCOUNT.toLocaleString('en-US')} triangles before rigging, far under Meshy's 380,000 limit.`);
        const rigId = await stageCreate(j, 'rigging', cmd.createRigging(modelTask, j.heightMeters, pd, ws));
        const rigEnv = await waitStage(j, 'rigging', 'rigging', rigId, pd, ws);
        j.creditsByStage.rigging = await credits(ws, pd, rigId, rigEnv);

        touch(j, { stage: 'downloading', progress: 90 });
        const taskJson = join(pd, `task_${rigId}.json`);
        const riggedPath = join(pd, 'rigged.glb');
        // ASSUME: asset keys result.rigged_character_glb_url / result.basic_animations.{walking,running}_glb_url (pipelines.md).
        main = await download(ws, cmd.downloadAsset(taskJson, 'result.rigged_character_glb_url', riggedPath, pd, 'rigging', ws), riggedPath, 'Downloading the rigged character');
        for (const [name, key] of [['walking', 'walking_glb_url'], ['running', 'running_glb_url']] as const) {
          const p = join(pd, `${name}.glb`);
          try {
            clipFiles.push({ name, data: await download(ws, cmd.downloadAsset(taskJson, `result.basic_animations.${key}`, p, pd, 'rigging', ws), p, `Downloading the ${name} clip`) });
          } catch (e: any) {
            j.warnings.push(`The ${name} clip could not be downloaded (${scrub(e?.message, 120)}).`);
          }
        }
      } else {
        touch(j, { stage: 'downloading', progress: 90 });
        const p = join(pd, 'model.glb');
        main = await download(ws, cmd.downloadModel(join(pd, `task_${modelTask}.json`), p, pd, modelStage, ws), p, 'Downloading the model');
      }

      touch(j, { stage: 'saving', progress: 96 });
      await saveAssets(j, store, main, clipFiles);
      await patchCredits(j, store);
      j.status = 'succeeded';
      touch(j, { stage: 'done', progress: 100 });
    } catch (e: any) {
      j.status = 'failed';
      j.error = e instanceof MeshyError ? e.message : `Meshy generation failed (${scrub(e?.message || 'unexpected error', 160)}).`;
      j.errorCode = e instanceof MeshyError ? e.code : 'unexpected';
      const spent = Object.keys(j.tasks);
      if (spent.length && j.errorCode !== 'insufficient_credit') j.warnings.push(`Meshy tasks already submitted (${spent.join(', ')}) may have used credits; they are listed in your Meshy account.`);
      touch(j, { progress: j.progress });
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Total credits are only known after all stages finished, so they are written onto the saved assets afterwards. */
  async function patchCredits(j: Job, store: AssetStore) {
    j.consumedCredits = totalCredits(j);
    if (!j.asset) return;
    try {
      const updated = await store.update(j.asset.id, { meta: { consumedCredits: j.consumedCredits, creditsByStage: { ...j.creditsByStage } } });
      j.asset = updated;
      j.assets = j.assets.map((a) => (a.id === updated.id ? updated : a));
    } catch {
      j.warnings.push('Saved the asset, but could not record the credits used on it.');
    }
  }

  function totalCredits(j: Job): number | null {
    const stages: Array<number | null> = [j.creditsByStage.preview];
    if (j.textured && j.rig) stages.push(j.creditsByStage.remesh, j.creditsByStage.retexture);
    else if (j.textured) stages.push(j.creditsByStage.refine);
    if (j.rig) stages.push(j.creditsByStage.rigging);
    return stages.every((v) => v !== null) ? (stages as number[]).reduce((a, b) => a + b, 0) : null;
  }

  async function saveAssets(j: Job, store: AssetStore, main: Buffer, clipFiles: Array<{ name: string; data: Buffer }>) {
    const baseMeta = { generated: true, provider: 'meshy', via: 'meshy-cli', prompt: j.prompt, tasks: { ...j.tasks }, generatedAt: new Date(now()).toISOString() };
    const tags = ['generated', 'meshy', '3d', 'character'];
    let primary = main;
    const separate: Array<{ name: string; data: Buffer }> = [];
    let clips: string[] | undefined;
    let mergeNote: string | undefined;
    if (j.rig && clipFiles.length) {
      if (j.mergeClips) {
        try {
          const merged = mergeGlbAnimations(main, clipFiles.map((c) => ({ name: c.name, glb: c.data })));
          clips = merged.clips;
          if (merged.clips.length) primary = merged.glb;
          for (const s of merged.skipped) j.warnings.push(`The ${s.name} clip was not merged (${s.reason}); saved as its own asset.`);
          separate.push(...clipFiles.filter((c) => !merged.clips.includes(c.name)));
          if (!merged.clips.length) mergeNote = 'No clip could be merged into the rigged GLB.';
        } catch (e: any) {
          mergeNote = `Merging clips failed (${scrub(e?.message, 100)}).`;
          j.warnings.push(`${mergeNote} The clips were saved as separate assets.`);
          separate.push(...clipFiles);
        }
      } else separate.push(...clipFiles);
    }
    const clipAssets: Record<string, string> = {};
    for (const c of separate) {
      const a = await store.add({
        filename: `${j.name} ${c.name}.glb`,
        data: c.data,
        name: `${j.name} (${c.name})`.slice(0, 80),
        kind: 'model',
        tags: [...tags, 'animation', c.name],
        source: 'meshy',
        license: MESHY_LICENSE,
        meta: { ...baseMeta, role: 'animation-clip', clip: c.name },
      });
      clipAssets[c.name] = a.id;
      j.assets.push(a);
    }
    const asset = await store.add({
      filename: `${j.name}.glb`,
      data: primary,
      name: j.name,
      kind: 'model',
      tags,
      source: 'meshy',
      license: MESHY_LICENSE,
      meta: {
        ...baseMeta,
        rigged: j.rig,
        textured: j.textured,
        heightMeters: j.heightMeters,
        consumedCredits: null,
        ...(clips ? { clips } : {}),
        ...(Object.keys(clipAssets).length ? { clipAssets } : {}),
        ...(mergeNote ? { mergeNote } : {}),
      },
    });
    j.asset = asset;
    j.assets.unshift(asset);
    if (clips) j.clips = clips;
  }

  return {
    getRunner,
    authStatus,
    balance,
    status,
    startLogin,
    loginView,
    cancelLogin,
    estimate,
    startCharacter,
    getJob(id: string): MeshyJobView {
      sweep();
      const j = jobs.get(String(id));
      if (!j) throw new MeshyError('Meshy job not found (it may have expired).', 404, 'job_not_found');
      return toView(j);
    },
    listJobs(): MeshyJobView[] {
      sweep();
      return [...jobs.values()].map(toView).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    /** Resolves when the job's background pipeline has finished (tests, smoke script). */
    async waitForJob(id: string): Promise<MeshyJobView> {
      const j = jobs.get(String(id));
      if (!j) throw new MeshyError('Meshy job not found (it may have expired).', 404, 'job_not_found');
      await j.done;
      return toView(j);
    },
  };
}

export type MeshyService = ReturnType<typeof createMeshyService>;
