/**
 * Meshy session connector, layer 1: how OmniStage runs the official `meshy-cli` (pinned to 0.4.0).
 *
 * OmniStage never reads, copies or logs the CLI's credential store (~/.config/meshy/credentials.json or %APPDATA%\meshy).
 * It only DRIVES the CLI as a subprocess, the same way server/ai/cliProviders.ts drives claude/codex, and parses what the
 * CLI prints. Everything here is pure plumbing: the runner interface (so tests inject a fake), process spawning with
 * timeouts and output caps, tolerant JSON parsing, and scrubbing of anything token-shaped from text we may echo.
 *
 * Authoritative CLI usage: the Meshy plugin skill (meshy-3d-generation, references/setup.md, pipelines.md,
 * troubleshooting.md). Re-verify after a CLI upgrade; the version is pinned on purpose.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export const MESHY_CLI_VERSION = '0.4.0';
export const MESHY_NPM_PACKAGE = `meshy-cli@${MESHY_CLI_VERSION}`;
export const MIN_NODE = { major: 22, minor: 12 };
/** Flags every business command carries (docs: "Execution boundaries"). */
export const STD_FLAGS = ['--output-schema', 'v1', '--format', 'json', '--no-update-check'];

export class MeshyError extends Error {
  constructor(message: string, public status = 400, public code = 'meshy_error') {
    super(message);
  }
}

export interface RunResult {
  /** Process exit code; -1 when the process was killed (timeout) or could not report one. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface RunOpts {
  timeoutMs?: number;
  cwd?: string;
  /** Per-stream cap in bytes (default 4 MiB). */
  maxBytes?: number;
}

export type LineListener = (stream: 'stdout' | 'stderr', line: string) => void;

/** A long-lived subprocess whose output lines are streamed (device login). */
export interface LongProcess {
  /** Register before output arrives (spawnLong returns synchronously, lines arrive asynchronously). */
  onLine(listener: LineListener): void;
  wait(): Promise<RunResult>;
  kill(): void;
}

export interface MeshyRunner {
  kind: 'path' | 'npm-exec' | 'injected';
  /** Human readable command prefix, e.g. `meshy` or `npm exec --yes --package=meshy-cli@0.4.0 -- meshy`. No secrets. */
  describe: string;
  /** CLI version the runner was resolved for. */
  version: string;
  run(args: string[], opts?: RunOpts): Promise<RunResult>;
  spawnLong(args: string[], opts?: RunOpts): LongProcess;
}

// ------------------------------------------------------------------------------------------------ spawning

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Windows runs npm shims (.cmd) only through cmd.exe, so there the command line is a string. Every argument is
 * therefore quoted here so cmd.exe cannot interpret it: inside double quotes the metacharacters (& | < > ^) are
 * literal; the two that still bite are `"` (ends the quote) and `%` (variable expansion), which are rewritten, and a
 * trailing backslash (would escape the closing quote), which becomes a slash. Control characters become spaces.
 * On POSIX there is no shell at all and args go straight to execve.
 */
export function quoteForWindowsShell(arg: string): string {
  if (arg !== '' && /^[A-Za-z0-9_\-.:/\\=@,+]+$/.test(arg)) return arg;
  const s = arg
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/"/g, "'")
    .replace(/%/g, ' percent ')
    .replace(/\\+$/, (m) => '/'.repeat(m.length));
  return `"${s}"`;
}

function killTree(child: ChildProcess) {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // already gone
  }
}

interface Prefix {
  command: string;
  args: string[];
}

function startProcess(prefix: Prefix, args: string[], opts: RunOpts, onLine?: LineListener): { wait: Promise<RunResult>; kill: () => void } {
  const full = [...prefix.args, ...args];
  const win = process.platform === 'win32';
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let child: ChildProcess;
  try {
    child = win
      ? spawn([prefix.command, ...full.map(quoteForWindowsShell)].join(' '), [], { cwd: opts.cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } })
      : spawn(prefix.command, full, { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  } catch (e: any) {
    return { wait: Promise.reject(e), kill: () => undefined };
  }
  const out = { stdout: '', stderr: '' };
  const partial = { stdout: '', stderr: '' };
  let truncated = false;
  let timedOut = false;
  const feed = (stream: 'stdout' | 'stderr') => (d: Buffer) => {
    const text = d.toString('utf8');
    if (out[stream].length < maxBytes) out[stream] += text.slice(0, maxBytes - out[stream].length);
    else truncated = true;
    if (onLine) {
      partial[stream] += text;
      let i: number;
      while ((i = partial[stream].search(/\r?\n/)) >= 0) {
        const line = partial[stream].slice(0, i);
        partial[stream] = partial[stream].slice(partial[stream].indexOf('\n', i) + 1);
        if (line.trim()) onLine(stream, line);
      }
      if (partial[stream].length > 16_384) partial[stream] = '';
    }
  };
  child.stdout?.on('data', feed('stdout'));
  child.stderr?.on('data', feed('stderr'));
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, opts.timeoutMs)
    : undefined;
  const wait = new Promise<RunResult>((resolve, reject) => {
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (onLine) for (const s of ['stdout', 'stderr'] as const) if (partial[s].trim()) onLine(s, partial[s]);
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout: out.stdout, stderr: out.stderr, timedOut, truncated });
    });
  });
  return { wait, kill: () => killTree(child) };
}

export function createProcessRunner(prefix: Prefix, kind: 'path' | 'npm-exec', describe: string): MeshyRunner {
  return {
    kind,
    describe,
    version: MESHY_CLI_VERSION,
    run: (args, opts = {}) => startProcess(prefix, args, opts).wait,
    spawnLong: (args, opts = {}) => {
      const listeners: LineListener[] = [];
      const p = startProcess(prefix, args, opts, (s, l) => listeners.forEach((f) => f(s, l)));
      return { onLine: (l) => void listeners.push(l), wait: () => p.wait, kill: p.kill };
    },
  };
}

// ------------------------------------------------------------------------------------------------ runner resolution

export type ExecFn = (command: string, args: string[]) => Promise<RunResult>;

const defaultExec: ExecFn = (command, args) => startProcess({ command, args: [] }, args, { timeoutMs: 20_000, maxBytes: 64 * 1024 }).wait;

export function nodeVersionOk(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

const PINNED_VERSION_RE = /(?<![\d.])0\.4\.0(?![\d.])/;

/**
 * `meshy` on PATH when `--version` prints 0.4.0, otherwise the pinned temporary package through `npm exec`
 * (`npm.cmd` on Windows). Nothing is installed globally and an existing global CLI is never touched.
 */
export async function resolveRunner(opts: { exec?: ExecFn; platform?: NodeJS.Platform; nodeVersion?: string } = {}): Promise<MeshyRunner> {
  const exec = opts.exec ?? defaultExec;
  const platform = opts.platform ?? process.platform;
  const nodeVersion = opts.nodeVersion ?? process.versions.node;
  if (!nodeVersionOk(nodeVersion)) {
    throw new MeshyError(`Meshy CLI needs Node.js ${MIN_NODE.major}.${MIN_NODE.minor} or newer (this computer has ${nodeVersion}). Install a newer Node.js.`, 503, 'node_too_old');
  }
  try {
    const r = await exec('meshy', ['--version']);
    if (r.code === 0 && PINNED_VERSION_RE.test((r.stdout || r.stderr).trim().split('\n')[0] || '')) {
      return createProcessRunner({ command: 'meshy', args: [] }, 'path', 'meshy');
    }
  } catch {
    // no meshy on PATH: fall through to the pinned package
  }
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    const r = await exec(npm, ['--version']);
    if (r.code !== 0) throw new Error('npm failed');
  } catch {
    throw new MeshyError('npm was not found on this computer. Install Node.js (it includes npm) or run `npm install -g meshy-cli@0.4.0` yourself.', 503, 'npm_missing');
  }
  return createProcessRunner({ command: npm, args: ['exec', '--yes', `--package=${MESHY_NPM_PACKAGE}`, '--', 'meshy'] }, 'npm-exec', `npm exec --yes --package=${MESHY_NPM_PACKAGE} -- meshy`);
}

// ------------------------------------------------------------------------------------------------ parsing helpers

/** Parses CLI output tolerantly: whole text, else the last JSON-looking line, else first `{` .. last `}`. */
export function parseJsonLoose(text: string): any {
  const t = String(text ?? '').trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    // fall through
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep looking
    }
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {
      // not JSON
    }
  }
  return undefined;
}

/** Breadth-first search for the first value stored under `key` (depth-limited; skips arrays of non-objects). */
export function deepFind(root: unknown, key: string, maxDepth = 6): unknown {
  let level: unknown[] = [root];
  for (let d = 0; d <= maxDepth && level.length; d++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!node || typeof node !== 'object') continue;
      if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) return (node as Record<string, unknown>)[key];
      for (const v of Object.values(node as object)) if (v && typeof v === 'object') next.push(v);
    }
    level = next;
  }
  return undefined;
}

export function deepFindNumber(root: unknown, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = deepFind(root, k);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  }
  return undefined;
}

/**
 * Removes anything token-shaped from text that may be shown to the user or put in an error: bearer tokens, `msy_` keys,
 * JWTs, long opaque strings, and URL query strings (signed download URLs carry credentials in the query).
 */
export function scrub(text: unknown, max = 300): string {
  let s = String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\bmsy[_-][A-Za-z0-9_-]{6,}/gi, '***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}(\.[A-Za-z0-9_-]*)?/g, '***')
    .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']*/gi, '$1?***')
    .replace(/\b(token|secret|password|api[_-]?key|device[_-]?code|signature)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2***')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '***')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

export interface CliEnvelope {
  ok: boolean;
  /** `result` of the v1 envelope (or the bare object when the command is not enveloped). */
  result: any;
  error?: { code?: string; message?: string };
  raw: any;
}

/** v1 envelope: `{ ok, result, error: {code,message,recovery}, warnings }`. Tolerant of bare JSON and of garbage. */
export function readEnvelope(r: Pick<RunResult, 'code' | 'stdout'>): CliEnvelope {
  const raw = parseJsonLoose(r.stdout);
  if (!raw || typeof raw !== 'object') return { ok: r.code === 0, result: undefined, raw };
  const error = raw.error && typeof raw.error === 'object' ? { code: typeof raw.error.code === 'string' ? raw.error.code : undefined, message: typeof raw.error.message === 'string' ? raw.error.message : undefined } : typeof raw.error === 'string' ? { message: raw.error } : undefined;
  return { ok: r.code === 0 && raw.ok !== false, result: raw.result !== undefined ? raw.result : raw, error, raw };
}

const lastLines = (text: string, n = 3) => text.trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' ');

/** A MeshyError for a failed CLI call, with the exit-code table from troubleshooting.md. Never echoes args or env. */
export function cliFailure(r: RunResult, what: string): MeshyError {
  const env = readEnvelope(r);
  const detail = scrub(env.error?.message || lastLines(r.stderr) || lastLines(r.stdout) || '', 240);
  const tail = detail ? ` (${detail})` : '';
  if (r.timedOut) return new MeshyError(`${what} timed out.`, 504, 'timeout');
  switch (r.code) {
    case 3:
      return new MeshyError(`Meshy did not accept the saved session${tail}. Sign in to Meshy again.`, 401, 'auth');
    case 4:
      return new MeshyError(`Meshy rejected the request${tail}.`, 400, 'validation');
    case 5:
      return new MeshyError(`${what}: Meshy could not find that task${tail}.`, 404, 'not_found');
    case 6:
      return new MeshyError('Meshy is rate-limiting requests; wait a moment and try again.', 429, 'rate_limit');
    case 7:
      return new MeshyError(`Could not reach Meshy (network)${tail}.`, 502, 'network');
    case 8:
      return new MeshyError(`${what} timed out waiting for Meshy.`, 504, 'timeout');
    case 9:
      return new MeshyError('The Meshy account is out of credits. Top up at meshy.ai, then try again. Nothing was retried.', 402, 'insufficient_credit');
    case 10:
      return new MeshyError('Meshy may or may not have accepted the request (the connection dropped). It was NOT resubmitted; check your Meshy task list before trying again.', 502, 'submission_unknown');
    case 11:
      return new MeshyError(`${what}: could not write the file locally${tail}.`, 500, 'local_io');
    case 12:
      return new MeshyError(`${what}: the model failed a check${tail}.`, 422, 'check_failed');
    case 130:
      return new MeshyError(`${what} was interrupted.`, 502, 'interrupted');
    default:
      return new MeshyError(`${what} failed (exit ${r.code})${tail}.`, 502, 'cli_error');
  }
}
