/**
 * Phase 6 — Provider-agnostic AI layer shared by every /api/agent/* endpoint.
 *
 * API providers: Gemini, OpenAI-compatible (any /chat/completions endpoint: OpenAI, LM Studio, Ollama, vLLM, ...),
 * OpenRouter and Anthropic. CLI providers reuse a coding agent the user already installed and signed in to
 * on this machine (Claude Code, Codex, Google Antigravity CLI, OpenCode), so no API key is needed.
 */

export type ApiProviderId = 'gemini' | 'openai-compatible' | 'openrouter' | 'anthropic';
export type CliProviderId = 'cli-claude' | 'cli-codex' | 'cli-antigravity' | 'cli-opencode';
export type ProviderId = ApiProviderId | CliProviderId;

export const API_PROVIDERS: ApiProviderId[] = ['gemini', 'openai-compatible', 'openrouter', 'anthropic'];
export const CLI_PROVIDERS: CliProviderId[] = ['cli-claude', 'cli-codex', 'cli-antigravity', 'cli-opencode'];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && ([...API_PROVIDERS, ...CLI_PROVIDERS] as string[]).includes(value);
}

export function isCliProvider(id: ProviderId): id is CliProviderId {
  return id.startsWith('cli-');
}

export interface ProviderConfig {
  provider: ProviderId;
  /** Model id in the provider's own naming; empty = provider default. */
  model?: string;
  apiKey?: string;
  /** For openai-compatible: e.g. http://localhost:11434/v1 (Ollama) or https://api.openai.com/v1. */
  baseUrl?: string;
}

export interface GenerateRequest {
  system: string;
  user: string;
  /** Optional PNG/JPEG screenshot (vision QA). Providers without vision ignore it and say so via `supportsVision`. */
  image?: { mimeType: string; base64: string };
  /**
   * Phase 10D: the answer is worthless without the image (director QA). Connections without vision (local CLIs) are then
   * reported as unavailable instead of answering blind, so a fallback chain skips to the next connection.
   */
  requireVision?: boolean;
  /** Hard timeout for the whole call. */
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderId;
  model: string;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** Model ids reach shell commands for CLI providers: only allow plain identifier characters. */
export function sanitizeModelId(model: string | undefined): string | undefined {
  const m = (model || '').trim();
  if (!m) return undefined;
  if (!/^[A-Za-z0-9._:/@+-]{1,120}$/.test(m)) throw new Error(`Invalid model id "${m.slice(0, 40)}"`);
  return m;
}

/**
 * Extracts the first JSON object from model output: tolerates ```json fences, prose before/after the object,
 * and braces inside strings.
 */
export function extractJSON(raw: string | undefined): any {
  const text = (raw ?? '').trim();
  if (!text) throw new Error('Empty model response');
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  } catch {
    // fall through to a balanced-brace scan
  }
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Model response contains no JSON object');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Model response JSON is truncated');
}
