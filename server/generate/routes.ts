/**
 * Phase 6 Batch 3 — /api/generate/* (mounted on the workspace router, so it is localhost-only).
 *
 *   GET  /api/generate/generators            generators from enabled extensions that were granted `generate`
 *   POST /api/generate/jobs  {extensionId, generatorId, prompt, scope}   header x-generate-key → job
 *   GET  /api/generate/jobs/:id                                          header x-generate-key → job (polls upstream)
 *   GET  /api/generate/jobs                                              recent jobs (no keys, ever)
 *
 * The key comes from the request header or the server env (MESHY_API_KEY, TRIPO_API_KEY, FAL_KEY,
 * REPLICATE_API_TOKEN). It is never logged, stored or echoed back.
 */
import type { Request, Response, Router } from 'express';
import type { ExtensionGenerator, InstalledExtension } from '../../src/extensions/types';
import type { AssetStore } from '../workspace/assets';
import { listInstalled } from '../workspace/extensions';
import { WorkspaceError } from '../workspace/store';
import { FetchLike, listGenerations, pollGeneration, startGeneration } from './jobs';
import { GenerationError, PROVIDERS } from './providers';

type Handler = (req: Request, res: Response) => Promise<unknown>;

export interface AvailableGenerator extends ExtensionGenerator {
  extensionId: string;
  extensionName: string;
  /** True when the server env already has a key for this provider. */
  serverKey: boolean;
}

export function availableGenerators(installed: InstalledExtension[], env: NodeJS.ProcessEnv = process.env): AvailableGenerator[] {
  return installed
    .filter((e) => e.enabled && e.approvedPermissions.includes('generate'))
    .flatMap((e) =>
      (e.manifest.contributes?.generators || [])
        .filter((g) => PROVIDERS[g.provider] && PROVIDERS[g.provider].output === g.output)
        .map((g) => ({ ...g, extensionId: e.manifest.id, extensionName: e.manifest.name, serverKey: !!env[PROVIDERS[g.provider].envKey] }))
    );
}

export function resolveGenerator(installed: InstalledExtension[], extensionId: unknown, generatorId: unknown): AvailableGenerator {
  const ext = installed.find((e) => e.manifest.id === extensionId);
  if (!ext) throw new WorkspaceError('Generator extension is not installed', 404);
  if (!ext.enabled) throw new WorkspaceError(`${ext.manifest.name} is turned off`, 403);
  if (!ext.approvedPermissions.includes('generate')) throw new WorkspaceError(`${ext.manifest.name} was not granted the "generate" permission`, 403);
  const gen = availableGenerators([ext]).find((g) => g.id === generatorId);
  if (!gen) throw new WorkspaceError('Generator not found in that extension', 404);
  return gen;
}

function keyFrom(req: Request, provider: keyof typeof PROVIDERS): string {
  const h = req.headers['x-generate-key'];
  const v = (Array.isArray(h) ? h[0] : h)?.trim();
  return v || process.env[PROVIDERS[provider].envKey]?.trim() || '';
}

export function registerGenerateRoutes(
  r: Router,
  deps: { route: (h: Handler) => (req: Request, res: Response) => Promise<void>; storeFor: (scope: string) => AssetStore; fetch?: FetchLike }
) {
  const fetcher: FetchLike = deps.fetch || ((url, init) => fetch(url, init));
  // GenerationError → WorkspaceError so the shared route() helper maps the status without logging (keys never reach logs).
  const wrap = (h: Handler): Handler => async (req, res) => {
    try {
      return await h(req, res);
    } catch (e) {
      if (e instanceof GenerationError) throw new WorkspaceError(e.message, e.status);
      throw e;
    }
  };

  r.get('/generate/generators', deps.route(async () => availableGenerators(await listInstalled())));
  r.get('/generate/jobs', deps.route(async () => listGenerations()));
  r.post(
    '/generate/jobs',
    deps.route(
      wrap(async (req) => {
        const body = req.body ?? {};
        const gen = resolveGenerator(await listInstalled(), body.extensionId, body.generatorId);
        const scope = String(body.scope || 'personal');
        const store = deps.storeFor(scope); // validates the scope before any credits are spent
        return startGeneration({ extensionId: gen.extensionId, generator: gen, prompt: body.prompt, scope }, keyFrom(req, gen.provider), { fetch: fetcher, store });
      })
    )
  );
  r.get(
    '/generate/jobs/:id',
    deps.route(
      wrap(async (req) => {
        const job = listGenerations().find((j) => j.id === req.params.id);
        if (!job) throw new WorkspaceError('Generation not found (it may have expired)', 404);
        return pollGeneration(job.id, keyFrom(req, job.provider), { fetch: fetcher, store: deps.storeFor(job.scope) });
      })
    )
  );
}
