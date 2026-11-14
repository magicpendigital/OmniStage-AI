/**
 * Phase 6 — CLI providers: reuse a coding agent the user installed and signed in to on this machine.
 *
 * Every call runs in a fresh temp directory with no tools enabled where the CLI allows it, the prompt goes
 * through stdin or an attached file (never the command line, which is length-limited on Windows and visible
 * in process lists), and model ids are sanitised before they reach the shell.
 * Verified non-interactive invocations (2026-11-10):
 *   claude   -p --output-format json --tools "" --no-session-persistence     (stdin → JSON .result)
 *   codex    exec --skip-git-repo-check --ephemeral --sandbox read-only -o <file> -   (stdin → last message file)
 *   opencode run --format json -f <prompt file> -- "<instruction>"           (stdin closed → JSONL "text" events)
 *   agy      --input-format stream-json --output-format stream-json --sandbox -p=   (Google Antigravity CLI 1.5.4:
 *            stdin NDJSON {"event":"user","message":{"content":...}} → NDJSON, final {"event":"result"} .result.response;
 *            tool calls needing permission are auto-denied in headless mode)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliProviderId, GenerateRequest, GenerateResult, ProviderConfig } from './types';
import { ProviderUnavailableError, sanitizeModelId } from './types';

export const CLI_BINARIES: Record<CliProviderId, { command: string; label: string; install: string }> = {
  'cli-claude': { command: 'claude', label: 'Claude Code', install: 'npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in' },
  'cli-codex': { command: 'codex', label: 'Codex CLI', install: 'npm i -g @openai/codex, then `codex login`' },
  'cli-antigravity': { command: 'agy', label: 'Google Antigravity CLI', install: 'Install Google Antigravity, run `agy install`, then `agy` once to sign in' },
  'cli-opencode': { command: 'opencode', label: 'OpenCode', install: 'npm i -g opencode-ai, then `opencode auth login`' },
};

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(command: string, args: string[], opts: { cwd: string; stdin?: string; timeoutMs: number }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // npm-installed CLIs are .cmd shims on Windows, which need a shell. Arguments here are fixed flags and
    // sanitised model ids only; prompts never go through argv.
    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.stdin);
    }
  });
}

/**
 * Argument for a fixed literal (empty string or a sentence). On Windows the CLI runs through cmd.exe, so the
 * value must be quoted; elsewhere there is no shell and quotes would become part of the value.
 */
export function shellArg(value: string): string {
  return process.platform === 'win32' ? `"${value.replace(/"/g, '')}"` : value;
}

/** Single text prompt for CLIs that have no separate system channel. */
export function composeCliPrompt(req: GenerateRequest): string {
  return [
    '# ROLE AND RULES',
    req.system,
    '',
    '# TASK',
    req.user,
    '',
    '# OUTPUT',
    'Answer with ONE JSON object only. No markdown fences, no commentary, do not use tools or edit files.',
  ].join('\n');
}

function fail(label: string, r: RunResult): never {
  if (r.timedOut) throw new Error(`${label} timed out`);
  const detail = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300);
  throw new Error(`${label} exited with code ${r.code}: ${detail}`);
}

/** Parses `opencode run --format json` JSONL events into the assistant text. */
export function parseOpenCodeEvents(stdout: string): string {
  let text = '';
  let error = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'text' && typeof ev.part?.text === 'string') text += ev.part.text;
      if (ev.type === 'error') error = ev.error?.data?.message || ev.error?.name || 'OpenCode error';
    } catch {
      // ignore non-JSON log lines
    }
  }
  if (!text && error) throw new Error(`OpenCode: ${error}`);
  return text;
}

/** Parses `claude -p --output-format json`. */
export function parseClaudeOutput(stdout: string): string {
  const json = JSON.parse(stdout.trim());
  if (json.is_error) throw new Error(`Claude Code: ${json.result || json.subtype || 'error'}`);
  return String(json.result ?? '');
}

/** One NDJSON user message for `agy --input-format stream-json`. */
export function antigravityStdin(prompt: string): string {
  return JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
}

/** Parses `agy --output-format stream-json`: the final "result" event, else the concatenated text deltas. */
export function parseAntigravityEvents(stdout: string): string {
  let deltas = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.event === 'result') {
      const r = ev.result || {};
      if (r.status && r.status !== 'SUCCESS') throw new Error(`Antigravity: ${r.error || r.status}`);
      if (typeof r.response === 'string' && r.response.trim()) return r.response;
    }
    const step = ev.step_update;
    if (ev.event === 'step_update' && step?.step_type === 'agent_response' && typeof step.text_delta === 'string') deltas += step.text_delta;
  }
  return deltas;
}

export async function callCliProvider(cfg: ProviderConfig, req: GenerateRequest): Promise<GenerateResult> {
  const id = cfg.provider as CliProviderId;
  const bin = CLI_BINARIES[id];
  if (!bin) throw new Error(`Unknown CLI provider ${cfg.provider}`);
  const model = sanitizeModelId(cfg.model);
  const prompt = composeCliPrompt(req);
  const timeoutMs = req.timeoutMs ?? 300_000;
  const cwd = await mkdtemp(join(tmpdir(), 'omnistage-cli-'));
  try {
    let text: string;
    if (id === 'cli-claude') {
      const args = ['-p', '--output-format', 'json', '--tools', shellArg(''), '--no-session-persistence'];
      if (model) args.push('--model', model);
      const r = await run(bin.command, args, { cwd, stdin: prompt, timeoutMs });
      if (r.code !== 0 && !r.stdout.trim().startsWith('{')) fail(bin.label, r);
      text = parseClaudeOutput(r.stdout);
    } else if (id === 'cli-codex') {
      const out = join(cwd, 'last-message.txt');
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '-o', out];
      if (model) args.push('-m', model);
      args.push('-');
      const r = await run(bin.command, args, { cwd, stdin: prompt, timeoutMs });
      if (r.code !== 0) fail(bin.label, r);
      text = await readFile(out, 'utf8');
    } else if (id === 'cli-opencode') {
      await writeFile(join(cwd, 'omnistage-prompt.md'), prompt, 'utf8');
      const args = ['run', '--format', 'json', '-f', 'omnistage-prompt.md'];
      if (model) args.push('-m', model);
      args.push('--', shellArg('Follow the instructions in the attached file omnistage-prompt.md exactly.'));
      const r = await run(bin.command, args, { cwd, timeoutMs });
      if (r.code !== 0 && !r.stdout.includes('"type":"text"')) fail(bin.label, r);
      text = parseOpenCodeEvents(r.stdout);
    } else {
      // Google Antigravity CLI: prompt as one NDJSON message on stdin; sandboxed terminal, no slash commands.
      const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--disable-slash-commands'];
      if (model) args.push('--model', model);
      args.push('-p=');
      const r = await run(bin.command, args, { cwd, stdin: antigravityStdin(prompt), timeoutMs });
      if (r.code !== 0 && !r.stdout.includes('"event":"result"')) fail(bin.label, r);
      text = parseAntigravityEvents(r.stdout);
    }
    if (!text.trim()) throw new Error(`${bin.label} returned an empty answer`);
    return { text, provider: id, model: model || 'cli-default' };
  } catch (e: any) {
    if (e?.code === 'ENOENT') throw new ProviderUnavailableError(`${bin.label} is not installed. ${bin.install}`);
    throw e;
  } finally {
    rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface CliStatus {
  id: CliProviderId;
  label: string;
  installed: boolean;
  version?: string;
  install: string;
}

let cache: { at: number; statuses: CliStatus[] } | null = null;

/** Detects installed CLIs (`<cli> --version`), cached for 60 s. Sign-in state is only known on first use. */
export async function detectCliProviders(force = false): Promise<CliStatus[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.statuses;
  const cwd = tmpdir();
  const statuses = await Promise.all(
    (Object.keys(CLI_BINARIES) as CliProviderId[]).map(async (id) => {
      const bin = CLI_BINARIES[id];
      try {
        const r = await run(bin.command, ['--version'], { cwd, timeoutMs: 15_000 });
        const version = (r.stdout || r.stderr).trim().split('\n')[0].slice(0, 80);
        return { id, label: bin.label, installed: r.code === 0, version: r.code === 0 ? version : undefined, install: bin.install };
      } catch {
        return { id, label: bin.label, installed: false, install: bin.install };
      }
    })
  );
  cache = { at: Date.now(), statuses };
  return statuses;
}
