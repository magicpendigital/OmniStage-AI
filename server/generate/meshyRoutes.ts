/**
 * Meshy session connector HTTP API (localhost only). The studio never sees a token: it asks the server to drive the
 * installed Meshy CLI, which holds the user's own signed-in session.
 *
 *   GET    /api/meshy/status        {state, runner, auth:{authenticated,verified,source,hint?}, balance, login}
 *   POST   /api/meshy/login         start the device login → {state:'waiting', url, code}
 *   GET    /api/meshy/login         poll the login → {state:'idle'|'waiting'|'logged_in'|'failed'|'expired', url?, code?, message?}
 *   DELETE /api/meshy/login         cancel it
 *   POST   /api/meshy/estimate      {prompt, textured?, rig?} → {credits?, source, balance?, steps, notes}   (free)
 *   POST   /api/meshy/characters    {prompt, name?, textured?, rig?, heightMeters?, scope?, confirm:true} → job   (SPENDS credits)
 *   GET    /api/meshy/jobs/:id      job
 *   GET    /api/meshy/jobs          recent jobs
 *
 * Errors: HTTP status + {error, code}. Nothing here logs or returns credentials, device codes or signed URLs.
 */
import express, { type Express, type NextFunction, type Request, type Response, type Router } from 'express';
import { join } from 'node:path';
import { isLoopbackRequest } from '../ai/index';
import { AssetStore } from '../workspace/assets';
import { projectAssets } from '../workspace/projects';
import { omniHome, WorkspaceError } from '../workspace/store';
import { createMeshyService, MeshyError, type MeshyService } from './meshyCli';
import { scrub } from './meshyRunner';

export function defaultStoreFor(scope: string): AssetStore {
  if (scope === 'personal') return new AssetStore(join(omniHome(), 'library'));
  const m = /^project:([a-z0-9][a-z0-9-]{0,63})$/.exec(scope);
  if (m) return projectAssets(m[1]);
  throw new MeshyError('scope must be "personal" or "project:<id>"', 400, 'bad_scope');
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

function route(handler: Handler) {
  return async (req: Request, res: Response) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (e: any) {
      let status = 500;
      let code = 'meshy_error';
      if (e instanceof MeshyError) {
        status = e.status;
        code = e.code;
      } else if (e instanceof WorkspaceError) {
        status = e.status;
      }
      const message = status === 500 ? 'Meshy connector error' : scrub(e?.message || 'Meshy error', 400);
      if (status === 500) console.error('[meshy]', scrub(e?.message || e, 200));
      if (!res.headersSent) res.status(status).json({ error: message, code });
    }
  };
}

function localOnly(req: Request, res: Response, next: NextFunction) {
  if (isLoopbackRequest(req)) return next();
  res.status(403).json({ error: 'The Meshy connector is only available on this computer (open OmniStage via localhost).', code: 'local_only' });
}

/** The router (loopback check included), so tests and other hosts can mount it anywhere. */
export function createMeshyRouter(service: MeshyService): Router {
  const r = express.Router();
  r.use(localOnly);
  const body = (req: Request) => (req.body && typeof req.body === 'object' ? req.body : {});

  r.get('/status', route(() => service.status()));
  r.post('/login', route(() => service.startLogin()));
  r.get('/login', route(() => service.loginView()));
  r.delete('/login', route(() => service.cancelLogin()));
  r.post('/estimate', route((req) => service.estimate(body(req))));
  r.post(
    '/characters',
    route((req) => {
      const b = body(req);
      return service.startCharacter({
        prompt: b.prompt,
        name: b.name,
        textured: typeof b.textured === 'boolean' ? b.textured : undefined,
        rig: typeof b.rig === 'boolean' ? b.rig : undefined,
        heightMeters: typeof b.heightMeters === 'number' ? b.heightMeters : undefined,
        scope: typeof b.scope === 'string' ? b.scope : undefined,
        mergeClips: typeof b.mergeClips === 'boolean' ? b.mergeClips : undefined,
        confirm: b.confirm,
      });
    })
  );
  r.get('/jobs', route(() => service.listJobs()));
  r.get('/jobs/:id', route((req) => service.getJob(req.params.id)));
  return r;
}

/** Mounts /api/meshy/* on the app. `service` is injectable for tests. */
export function registerMeshyRoutes(app: Express, opts: { service?: MeshyService } = {}) {
  const service = opts.service ?? createMeshyService({ storeFor: defaultStoreFor });
  app.use('/api/meshy', createMeshyRouter(service));
  return service;
}
