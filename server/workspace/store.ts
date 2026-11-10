/**
 * Phase 6 — Local workspace on disk (OmniStage runs on the user's own computer).
 *
 *   ~/OmniStage/                      (override with OMNISTAGE_HOME)
 *     projects/<projectId>/project.json
 *     projects/<projectId>/games/<gameId>.scenespec.json   (studio + MCP compatible bundles)
 *     projects/<projectId>/assets/{index.json, files/}     (assets shared by every game of the project)
 *     library/{index.json, files/}                          (personal asset library, shared by all projects)
 *     extensions/<extensionId>/{manifest.json, main.js}     + extensions/registry.json
 *     memory/memory.json
 *     .trash/                                               (deleted projects/games land here, never hard-deleted)
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function omniHome(): string {
  return resolve(process.env.OMNISTAGE_HOME || join(homedir(), 'OmniStage'));
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Ids become folder/file names: only lower-case slugs are accepted (no traversal, no reserved names). */
export function assertId(id: unknown, label = 'id'): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new WorkspaceError(`Invalid ${label}`);
  return id;
}

export function slugify(name: string, fallback = 'item'): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

export function uniqueId(name: string, taken: Set<string>, fallback?: string): string {
  const base = slugify(name, fallback);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

export async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return fallback;
    throw new WorkspaceError(`Corrupt file ${path}: ${e?.message || e}`, 500);
  }
}

/** Atomic write: temp file + rename, so a crash never leaves half a project file. */
export async function writeJSON(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, path);
}

export async function moveToTrash(path: string, label: string): Promise<string> {
  const target = join(omniHome(), '.trash', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.rename(path, target);
  return target;
}

export function nowIso() {
  return new Date().toISOString();
}
