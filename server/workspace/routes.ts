/**
 * Phase 6 — Workspace HTTP API (projects, games, libraries, extensions, memory).
 * Every route is restricted to requests from this computer: the workspace is the user's private disk.
 */
import express, { Express, NextFunction, Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { isLoopbackRequest } from '../ai/index';
import { AssetStore, LibraryAssetKind } from './assets';
import { fetchRemoteManifest, installExtension, listInstalled, setExtensionEnabled, uninstallExtension } from './extensions';
import { addMemory, deleteMemory, markMemoriesUsed, readMemory, setMemoryEnabled, updateMemory } from './memory';
import {
  createGame,
  createProject,
  gameFilePath,
  getProject,
  listProjects,
  loadGame,
  projectAssets,
  saveGame,
  trashGame,
  trashProject,
  updateProject,
} from './projects';
import { omniHome, WorkspaceError } from './store';
import { join } from 'node:path';

const personalLibrary = () => new AssetStore(join(omniHome(), 'library'));

function storeFor(scope: string): AssetStore {
  if (scope === 'personal') return personalLibrary();
  const m = /^project:([a-z0-9][a-z0-9-]{0,63})$/.exec(scope);
  if (m) return projectAssets(m[1]);
  throw new WorkspaceError('scope must be "personal" or "project:<id>"');
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

function route(handler: Handler) {
  return async (req: Request, res: Response) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (e: any) {
      const status = e instanceof WorkspaceError ? e.status : 500;
      if (status === 500) console.error('[workspace]', e?.message || e);
      if (!res.headersSent) res.status(status).json({ error: e?.message || 'Workspace error' });
    }
  };
}

function localOnly(req: Request, res: Response, next: NextFunction) {
  if (isLoopbackRequest(req)) return next();
  res.status(403).json({ error: 'The local workspace is only available on this computer (open OmniStage via localhost).' });
}

export function registerWorkspaceRoutes(app: Express) {
  const r = express.Router();
  r.use(localOnly);

  r.get('/workspace', route(async () => ({ home: omniHome(), projects: (await listProjects()).length, library: (await personalLibrary().list()).length })));

  // Projects & games
  r.get('/projects', route(() => listProjects()));
  r.post('/projects', route((req) => createProject(req.body ?? {})));
  r.get('/projects/:pid', route((req) => getProject(req.params.pid)));
  r.patch('/projects/:pid', route((req) => updateProject(req.params.pid, req.body ?? {})));
  r.delete('/projects/:pid', route(async (req) => ({ trashedTo: await trashProject(req.params.pid) })));
  r.post('/projects/:pid/games', route((req) => createGame(req.params.pid, req.body?.name, req.body?.bundle ?? {})));
  r.get('/projects/:pid/games/:gid', route(async (req) => ({ bundle: await loadGame(req.params.pid, req.params.gid), path: gameFilePath(req.params.pid, req.params.gid) })));
  r.put('/projects/:pid/games/:gid', route((req) => saveGame(req.params.pid, req.params.gid, req.body?.bundle, req.body?.name)));
  r.delete('/projects/:pid/games/:gid', route((req) => trashGame(req.params.pid, req.params.gid)));

  // Libraries (personal + project-shared)
  r.get('/library', route((req) => storeFor(String(req.query.scope || 'personal')).list()));
  r.post(
    '/library/upload',
    express.raw({ type: () => true, limit: '200mb' }),
    route((req) =>
      storeFor(String(req.query.scope || 'personal')).add({
        filename: String(req.query.filename || ''),
        data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        name: req.query.name ? String(req.query.name) : undefined,
        kind: req.query.kind ? (String(req.query.kind) as LibraryAssetKind) : undefined,
        tags: req.query.tags ? String(req.query.tags).split(',') : [],
        source: req.query.source ? String(req.query.source).slice(0, 40) : 'upload',
        license: req.query.license ? String(req.query.license).slice(0, 80) : undefined,
      })
    )
  );
  r.patch('/library/:scope/:id', route((req) => storeFor(req.params.scope).update(req.params.id, req.body ?? {})));
  r.delete('/library/:scope/:id', route((req) => storeFor(req.params.scope).remove(req.params.id)));
  r.get(
    '/library/file/:scope/:id',
    route(async (req, res) => {
      const { path, asset } = await storeFor(req.params.scope).filePath(req.params.id);
      res.setHeader('Content-Type', asset.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(path);
        stream.on('error', reject).on('end', () => resolve());
        stream.pipe(res);
      });
    })
  );

  // Extensions
  r.get('/extensions', route(() => listInstalled()));
  r.post('/extensions/fetch', route((req) => fetchRemoteManifest(String(req.body?.url || ''))));
  r.post('/extensions/install', route((req) => installExtension(req.body ?? {})));
  r.patch('/extensions/:id', route((req) => setExtensionEnabled(req.params.id, !!req.body?.enabled)));
  r.delete('/extensions/:id', route((req) => uninstallExtension(req.params.id)));

  // Memory
  r.get('/memory', route(() => readMemory()));
  r.post('/memory', route((req) => addMemory(req.body ?? {})));
  r.patch('/memory/settings', route((req) => setMemoryEnabled(!!req.body?.enabled)));
  r.post('/memory/used', route((req) => markMemoriesUsed(Array.isArray(req.body?.ids) ? req.body.ids : [])));
  r.patch('/memory/:id', route((req) => updateMemory(req.params.id, req.body ?? {})));
  r.delete('/memory/:id', route((req) => deleteMemory(req.params.id)));

  app.use('/api', r);
}
