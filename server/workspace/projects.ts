/**
 * Phase 6 — Projects: one project = one game/media product, or a collection of small games that share assets.
 * Each "game" is a normal multi-scene .scenespec.json bundle, so the studio, MCP server and exporters all read it.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AssetStore } from './assets';
import { assertId, moveToTrash, nowIso, omniHome, readJSON, uniqueId, WorkspaceError, writeJSON } from './store';

export type ProjectKind = 'game' | 'media' | 'collection';

export interface ProjectGameEntry {
  id: string;
  name: string;
  engineType?: '2d' | '3d';
  mode?: 'game' | 'media';
  sceneCount: number;
  updatedAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  kind: ProjectKind;
  /** Genre / style tags ("platformer", "pixel-art"...) — used for memory and extension recommendations. */
  tags: string[];
  /** Extensions enabled for this project on top of the global ones. */
  extensions?: string[];
  games: ProjectGameEntry[];
  createdAt: string;
  updatedAt: string;
}

export function projectsRoot() {
  return join(omniHome(), 'projects');
}

function projectDir(id: string) {
  return join(projectsRoot(), assertId(id, 'project id'));
}

export function projectAssets(id: string) {
  return new AssetStore(join(projectDir(id), 'assets'));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(projectsRoot());
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  const metas = await Promise.all(
    entries.filter((e) => /^[a-z0-9][a-z0-9-]*$/.test(e)).map((e) => readJSON<ProjectMeta | null>(join(projectsRoot(), e, 'project.json'), null))
  );
  return metas.filter((m): m is ProjectMeta => !!m).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<ProjectMeta> {
  const meta = await readJSON<ProjectMeta | null>(join(projectDir(id), 'project.json'), null);
  if (!meta) throw new WorkspaceError('Project not found', 404);
  return meta;
}

async function saveMeta(meta: ProjectMeta) {
  meta.updatedAt = nowIso();
  await writeJSON(join(projectDir(meta.id), 'project.json'), meta);
}

export async function createProject(input: { name: string; description?: string; kind?: ProjectKind; tags?: string[] }): Promise<ProjectMeta> {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw new WorkspaceError('Project name is required');
  const existing = new Set((await listProjects()).map((p) => p.id));
  const meta: ProjectMeta = {
    id: uniqueId(name, existing, 'project'),
    name,
    description: String(input.description || '').slice(0, 2000),
    kind: input.kind === 'media' || input.kind === 'collection' ? input.kind : 'game',
    tags: (input.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 12),
    games: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await fs.mkdir(join(projectDir(meta.id), 'games'), { recursive: true });
  await saveMeta(meta);
  return meta;
}

export async function updateProject(id: string, patch: Partial<Pick<ProjectMeta, 'name' | 'description' | 'kind' | 'tags' | 'extensions'>>): Promise<ProjectMeta> {
  const meta = await getProject(id);
  if (patch.name) meta.name = String(patch.name).slice(0, 80);
  if (patch.description !== undefined) meta.description = String(patch.description).slice(0, 2000);
  if (patch.kind) meta.kind = patch.kind;
  if (Array.isArray(patch.tags)) meta.tags = patch.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 12);
  if (Array.isArray(patch.extensions)) meta.extensions = patch.extensions.map((e) => assertId(e, 'extension id'));
  await saveMeta(meta);
  return meta;
}

export async function trashProject(id: string): Promise<string> {
  await getProject(id);
  return moveToTrash(projectDir(id), `project-${id}`);
}

function gamePath(projectId: string, gameId: string) {
  return join(projectDir(projectId), 'games', `${assertId(gameId, 'game id')}.scenespec.json`);
}

function summarizeBundle(bundle: any): Pick<ProjectGameEntry, 'engineType' | 'mode' | 'sceneCount'> {
  const scenes = Array.isArray(bundle?.scenes) && bundle.scenes.length ? bundle.scenes : bundle?.id ? [bundle] : [];
  const first = scenes[0] || {};
  return { engineType: first.engineType, mode: first.mode, sceneCount: scenes.length };
}

export async function createGame(projectId: string, name: string, bundle: unknown): Promise<{ project: ProjectMeta; game: ProjectGameEntry }> {
  const project = await getProject(projectId);
  const clean = String(name || '').trim().slice(0, 80) || 'Untitled game';
  const game: ProjectGameEntry = {
    id: uniqueId(clean, new Set(project.games.map((g) => g.id)), 'game'),
    name: clean,
    ...summarizeBundle(bundle),
    updatedAt: nowIso(),
  };
  await writeJSON(gamePath(projectId, game.id), bundle);
  project.games.push(game);
  await saveMeta(project);
  return { project, game };
}

export async function loadGame(projectId: string, gameId: string): Promise<unknown> {
  const bundle = await readJSON<unknown>(gamePath(projectId, gameId), null);
  if (!bundle) throw new WorkspaceError('Game not found', 404);
  return bundle;
}

export async function saveGame(projectId: string, gameId: string, bundle: unknown, name?: string): Promise<ProjectGameEntry> {
  const project = await getProject(projectId);
  const game = project.games.find((g) => g.id === gameId);
  if (!game) throw new WorkspaceError('Game not found', 404);
  if (!bundle || typeof bundle !== 'object') throw new WorkspaceError('Bundle must be a SceneSpec project object');
  await writeJSON(gamePath(projectId, gameId), bundle);
  Object.assign(game, summarizeBundle(bundle), { updatedAt: nowIso() });
  if (name) game.name = String(name).slice(0, 80);
  await saveMeta(project);
  return game;
}

export async function trashGame(projectId: string, gameId: string): Promise<void> {
  const project = await getProject(projectId);
  const idx = project.games.findIndex((g) => g.id === gameId);
  if (idx < 0) throw new WorkspaceError('Game not found', 404);
  await moveToTrash(gamePath(projectId, gameId), `game-${projectId}-${gameId}.scenespec.json`);
  project.games.splice(idx, 1);
  await saveMeta(project);
}

/** Absolute path of a game bundle (shown in the UI so users can point the MCP server or other tools at it). */
export function gameFilePath(projectId: string, gameId: string) {
  return gamePath(projectId, gameId);
}
