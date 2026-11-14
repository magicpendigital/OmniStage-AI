/**
 * Phase 6 — Connection fallback chain.
 *
 * The studio sends its primary connection (x-ai-provider / x-ai-model / x-ai-key / x-ai-base-url) plus an ordered list of
 * backup connections in `x-ai-fallback` (base64 JSON). When a connection fails — not configured, CLI not installed or not
 * signed in, rate limit / quota, timeout, network error, server error, empty or non-JSON answer — the next one is tried, so a
 * director turn is not interrupted. A connection that just failed is "cooling down" for a while and moved to the end of the
 * chain for later requests (each patch-loop round is its own request, so it would otherwise wait for the same failure again).
 *
 * Pure logic + an in-memory health map; no I/O here, so it is unit-tested with fake attempts.
 */
import { isProviderId, ProviderConfig, ProviderId, ProviderUnavailableError } from './types';

/** Max backup connections accepted from the header (primary + 7 = every provider once). */
export const MAX_FALLBACKS = 7;

export type FailureKind = 'unavailable' | 'rate-limit' | 'auth' | 'timeout' | 'bad-output' | 'error';

export interface AttemptRecord {
  provider: ProviderId;
  model?: string;
  ok: boolean;
  ms: number;
  kind?: FailureKind;
  error?: string;
  /** True when this connection was cooling down and was only tried as a last resort. */
  coolingDown?: boolean;
}

export interface FallbackOutcome<T> {
  value: T;
  /** The connection that answered. */
  used: ProviderConfig;
  attempts: AttemptRecord[];
}

/** Error thrown when every connection in the chain failed. `unavailable` = none of them was configured. */
export class AllProvidersFailedError extends Error {
  constructor(
    message: string,
    public attempts: AttemptRecord[]
  ) {
    super(message);
    this.name = 'AllProvidersFailedError';
  }
}

/** Decodes `x-ai-fallback`: base64 (or plain) JSON array of { provider, model?, apiKey?, baseUrl? }. Invalid entries are dropped. */
export function parseFallbackHeader(value: string | undefined): ProviderConfig[] {
  if (!value || !value.trim()) return [];
  let raw: unknown;
  try {
    const text = value.trim().startsWith('[') ? value.trim() : Buffer.from(value.trim(), 'base64').toString('utf8');
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: ProviderConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !isProviderId((item as any).provider)) continue;
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    out.push({
      provider: (item as any).provider,
      model: str((item as any).model, 120),
      apiKey: str((item as any).apiKey, 400),
      baseUrl: str((item as any).baseUrl, 300),
    });
    if (out.length >= MAX_FALLBACKS) break;
  }
  return out;
}

/** Encodes a fallback list for the header (client side uses the same shape; btoa there, Buffer here for tests). */
export function encodeFallbackHeader(list: ProviderConfig[]): string {
  return Buffer.from(JSON.stringify(list), 'utf8').toString('base64');
}

function connectionKey(cfg: ProviderConfig): string {
  return `${cfg.provider}|${cfg.model || ''}|${cfg.baseUrl || ''}`;
}

/** Primary first, then backups; duplicates (same provider + model + base URL) removed. */
export function buildChain(primary: ProviderConfig, fallbacks: ProviderConfig[]): ProviderConfig[] {
  const seen = new Set<string>();
  const chain: ProviderConfig[] = [];
  for (const cfg of [primary, ...fallbacks]) {
    const key = connectionKey(cfg);
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push(cfg);
  }
  return chain;
}

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof ProviderUnavailableError) return 'unavailable';
  const name = (error as any)?.name || '';
  const status = Number((error as any)?.status) || 0;
  const msg = String((error as any)?.message ?? error ?? '').toLowerCase();
  if (status === 429 || /\b429\b|rate.?limit|quota|usage limit|too many requests|resource.?exhausted|overloaded|\b529\b/.test(msg)) return 'rate-limit';
  if (status === 401 || status === 403 || /\b40[13]\b|unauthori[sz]ed|invalid api key|invalid x-api-key|not logged in|log ?in|sign ?in|authenticat/.test(msg)) return 'auth';
  if (name === 'AbortError' || /timed? ?out|timeout|aborted|etimedout/.test(msg)) return 'timeout';
  if (/json|empty answer|empty model response|no message content|truncated/.test(msg)) return 'bad-output';
  return 'error';
}

/** How long a failed connection is skipped (moved to the end of the chain). Unavailable = config problem, no cooldown. */
export const COOLDOWN_MS: Record<FailureKind, number> = {
  unavailable: 0,
  'rate-limit': 5 * 60_000,
  auth: 2 * 60_000,
  timeout: 60_000,
  'bad-output': 0,
  error: 30_000,
};

export interface HealthEntry {
  until: number;
  kind: FailureKind;
  error: string;
}

export class ProviderHealth {
  private map = new Map<string, HealthEntry>();

  markFailed(cfg: ProviderConfig, kind: FailureKind, error: string, now = Date.now()) {
    const ms = COOLDOWN_MS[kind];
    if (ms > 0) this.map.set(connectionKey(cfg), { until: now + ms, kind, error: error.slice(0, 200) });
  }

  markOk(cfg: ProviderConfig) {
    this.map.delete(connectionKey(cfg));
  }

  coolingDown(cfg: ProviderConfig, now = Date.now()): HealthEntry | undefined {
    const entry = this.map.get(connectionKey(cfg));
    if (!entry) return undefined;
    if (entry.until <= now) {
      this.map.delete(connectionKey(cfg));
      return undefined;
    }
    return entry;
  }

  /** Snapshot for /api/ai/providers (no keys). */
  snapshot(now = Date.now()): Array<{ provider: string; model?: string; kind: FailureKind; error: string; retryInMs: number }> {
    const out: Array<{ provider: string; model?: string; kind: FailureKind; error: string; retryInMs: number }> = [];
    for (const [key, entry] of this.map) {
      if (entry.until <= now) continue;
      const [provider, model] = key.split('|');
      out.push({ provider, model: model || undefined, kind: entry.kind, error: entry.error, retryInMs: entry.until - now });
    }
    return out;
  }

  clear() {
    this.map.clear();
  }
}

export const providerHealth = new ProviderHealth();

/** Healthy connections keep their order; cooling-down ones move to the end (still tried as a last resort). */
export function orderByHealth(chain: ProviderConfig[], health: ProviderHealth, now = Date.now()): Array<{ cfg: ProviderConfig; cooling: boolean }> {
  const healthy: Array<{ cfg: ProviderConfig; cooling: boolean }> = [];
  const cooling: Array<{ cfg: ProviderConfig; cooling: boolean }> = [];
  for (const cfg of chain) {
    if (health.coolingDown(cfg, now)) cooling.push({ cfg, cooling: true });
    else healthy.push({ cfg, cooling: false });
  }
  return [...healthy, ...cooling];
}

function shortError(error: unknown): string {
  return String((error as any)?.message ?? error ?? 'error').replace(/\s+/g, ' ').slice(0, 240);
}

/**
 * Runs `attempt` over the chain until one succeeds. Throws ProviderUnavailableError when no connection is configured
 * (the studio then uses the offline director), otherwise AllProvidersFailedError listing every attempt.
 */
export async function runWithFallback<T>(
  chain: ProviderConfig[],
  attempt: (cfg: ProviderConfig) => Promise<T>,
  opts: { health?: ProviderHealth; now?: () => number } = {}
): Promise<FallbackOutcome<T>> {
  const health = opts.health ?? providerHealth;
  const now = opts.now ?? Date.now;
  const attempts: AttemptRecord[] = [];
  for (const { cfg, cooling } of orderByHealth(chain, health, now())) {
    const started = now();
    try {
      const value = await attempt(cfg);
      health.markOk(cfg);
      attempts.push({ provider: cfg.provider, model: cfg.model, ok: true, ms: now() - started, ...(cooling ? { coolingDown: true } : {}) });
      return { value, used: cfg, attempts };
    } catch (error) {
      const kind = classifyFailure(error);
      health.markFailed(cfg, kind, shortError(error), now());
      attempts.push({ provider: cfg.provider, model: cfg.model, ok: false, ms: now() - started, kind, error: shortError(error), ...(cooling ? { coolingDown: true } : {}) });
    }
  }
  const summary = attempts.map((a) => `${a.provider}${a.model ? ` (${a.model})` : ''}: ${a.error}`).join(' | ');
  if (attempts.length && attempts.every((a) => a.kind === 'unavailable')) {
    throw new ProviderUnavailableError(attempts.length === 1 ? attempts[0].error || 'AI provider not configured' : `No AI connection is configured. ${summary}`);
  }
  throw new AllProvidersFailedError(attempts.length === 1 ? attempts[0].error || 'AI request failed' : `All AI connections failed. ${summary}`, attempts);
}

/** One-line note for the chat when a backup connection answered, e.g. "gemini failed (rate-limit) → used cli-claude". */
export function fallbackNote(outcome: { used: ProviderConfig; attempts: AttemptRecord[] }): string | undefined {
  const failed = outcome.attempts.filter((a) => !a.ok);
  if (!failed.length) return undefined;
  const parts = failed.map((a) => `${a.provider} failed (${a.kind})`);
  return `${parts.join(', ')} → used ${outcome.used.provider}${outcome.used.model ? ` · ${outcome.used.model}` : ''}`;
}
