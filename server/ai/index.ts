/**
 * Phase 6 — AI router: resolves the provider from request headers (Settings → AI) or env, enforces that CLI
 * providers (which spend the user's own signed-in subscription) are only reachable from this machine, and
 * exposes provider status / connection test endpoints.
 *
 * Headers sent by the studio: x-ai-provider, x-ai-model, x-ai-key, x-ai-base-url, and x-ai-fallback (ordered backup
 * connections, see ./fallback.ts). Every /api/agent/* response carries x-ai-used-provider / x-ai-used-model and, when a
 * backup answered, x-ai-fallback-note.
 */
import type { Express, Request } from 'express';
import { apiProviderConfigured, callApiProvider, DEFAULT_MODELS } from './apiProviders';
import { callCliProvider, CLI_BINARIES, detectCliProviders } from './cliProviders';
import { AllProvidersFailedError, buildChain, fallbackNote, parseFallbackHeader, providerHealth, runWithFallback } from './fallback';
import {
  API_PROVIDERS,
  extractJSON,
  GenerateRequest,
  GenerateResult,
  isCliProvider,
  isProviderId,
  ProviderConfig,
  ProviderId,
  ProviderUnavailableError,
} from './types';

export { extractJSON, ProviderUnavailableError, AllProvidersFailedError };

const LEGACY_GEMINI_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
]);

export function isLoopbackRequest(req: Pick<Request, 'socket' | 'headers'>): boolean {
  const addr = req.socket?.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  // A reverse proxy on this machine could forward remote traffic; refuse forwarded requests for local-only features.
  return loopback && !req.headers['x-forwarded-for'];
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

/** Provider config for this request. Body `model` is the legacy Gemini model field kept for old clients. */
export function resolveProviderConfig(req: Request, bodyModel?: unknown): ProviderConfig {
  const requested = header(req, 'x-ai-provider');
  const envProvider = process.env.OMNISTAGE_AI_PROVIDER;
  const provider: ProviderId = isProviderId(requested) ? requested : isProviderId(envProvider) ? envProvider : 'gemini';
  let model = header(req, 'x-ai-model');
  if (!model && provider === 'gemini' && typeof bodyModel === 'string' && LEGACY_GEMINI_MODELS.has(bodyModel)) model = bodyModel;
  return { provider, model, apiKey: header(req, 'x-ai-key'), baseUrl: header(req, 'x-ai-base-url') };
}

export async function generate(cfg: ProviderConfig, request: GenerateRequest, req?: Request): Promise<GenerateResult> {
  if (isCliProvider(cfg.provider)) {
    if (request.requireVision) {
      throw new ProviderUnavailableError('This needs a vision-capable AI connection (Gemini, Anthropic, OpenRouter or OpenAI-compatible); CLI providers cannot see images.');
    }
    if (req && !isLoopbackRequest(req)) {
      throw new ProviderUnavailableError('CLI providers are only available when OmniStage is opened on this computer (localhost).');
    }
    return callCliProvider(cfg, request);
  }
  return callApiProvider(cfg, request);
}

/** Backup connections for this request (x-ai-fallback), in the user's order. */
export function resolveFallbackChain(req: Request, primary: ProviderConfig): ProviderConfig[] {
  return buildChain(primary, parseFallbackHeader(header(req, 'x-ai-fallback')));
}

export interface GenerateJSONOptions {
  /** false = only the primary connection (connection test). Default true. */
  fallback?: boolean;
}

/**
 * generate() + JSON extraction over the fallback chain, as used by every /api/agent/* endpoint. A connection whose answer is
 * not JSON also counts as failed, so the next connection gets the turn.
 */
export async function generateJSON(
  req: Request,
  request: GenerateRequest,
  bodyModel?: unknown,
  opts: GenerateJSONOptions = {}
): Promise<{ data: any; meta: GenerateResult & { fallbackNote?: string } }> {
  const primary = resolveProviderConfig(req, bodyModel);
  const chain = opts.fallback === false ? [primary] : resolveFallbackChain(req, primary);
  const outcome = await runWithFallback(chain, async (cfg) => {
    const meta = await generate(cfg, request, req);
    return { data: extractJSON(meta.text), meta };
  });
  const note = fallbackNote(outcome);
  const res = req.res;
  if (res && !res.headersSent) {
    res.setHeader('x-ai-used-provider', outcome.value.meta.provider);
    res.setHeader('x-ai-used-model', encodeURIComponent(outcome.value.meta.model));
    if (note) res.setHeader('x-ai-fallback-note', encodeURIComponent(note));
  }
  if (note) console.warn(`[ai] ${note}`);
  return { data: outcome.value.data, meta: { ...outcome.value.meta, ...(note ? { fallbackNote: note } : {}) } };
}

/** Maps provider errors to HTTP status: 503 = "not configured" (studio falls back to the offline director). */
export function aiErrorStatus(error: unknown): number {
  return error instanceof ProviderUnavailableError ? 503 : 500;
}

export function registerAiRoutes(app: Express) {
  app.get('/api/ai/providers', async (req, res) => {
    const local = isLoopbackRequest(req);
    const cli = local ? await detectCliProviders(req.query.refresh === '1') : [];
    res.json({
      local,
      api: API_PROVIDERS.map((id) => ({
        id,
        defaultModel: DEFAULT_MODELS[id],
        serverKeyConfigured: apiProviderConfigured({ provider: id }),
      })),
      cli: (Object.keys(CLI_BINARIES) as Array<keyof typeof CLI_BINARIES>).map((id) => {
        const status = cli.find((c) => c.id === id);
        return { id, label: CLI_BINARIES[id].label, installed: !!status?.installed, version: status?.version, install: CLI_BINARIES[id].install, available: local };
      }),
      // Connections that failed recently and are tried last until the cooldown ends (no keys in here).
      health: providerHealth.snapshot(),
    });
  });

  // Round-trips a tiny JSON prompt through the selected provider (uses a few tokens of the user's account).
  app.post('/api/ai/test', async (req, res) => {
    const started = Date.now();
    try {
      const { data, meta } = await generateJSON(req, {
        system: 'You are a connectivity probe for OmniStage. Reply with JSON only.',
        user: 'Return exactly {"ok": true}.',
        timeoutMs: 120_000,
      }, undefined, { fallback: false });
      res.json({ ok: data?.ok === true, provider: meta.provider, model: meta.model, ms: Date.now() - started });
    } catch (error: any) {
      res.status(aiErrorStatus(error)).json({ ok: false, error: error?.message || String(error), ms: Date.now() - started });
    }
  });
}
