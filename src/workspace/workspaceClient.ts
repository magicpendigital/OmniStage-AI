/**
 * Phase 6 — Browser client for the local workspace API (/api/projects, /api/library, /api/extensions, /api/memory).
 * All endpoints only answer requests from this computer; when OmniStage runs in the cloud they return 403 and
 * the studio falls back to in-browser state.
 */
import type { ExtensionManifest, ExtensionPermission, ExtensionReview, InstalledExtension } from '../extensions/types';

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
  kind: 'game' | 'media' | 'collection';
  tags: string[];
  extensions?: string[];
  games: ProjectGameEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface LibraryAsset {
  id: string;
  name: string;
  kind: 'model' | 'image' | 'spritesheet' | 'audio' | 'hdri' | 'video' | 'other';
  file: string;
  mime: string;
  size: number;
  tags: string[];
  source: string;
  license?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export type MemoryKind = 'preference' | 'style' | 'goal' | 'constraint' | 'feedback' | 'fact';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  scope: string;
  source: 'explicit' | 'confirmed-suggestion' | 'learned';
  pinned: boolean;
  uses: number;
  createdAt: string;
  updatedAt: string;
}

export class WorkspaceRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json', ...(init.headers || {}) } : init?.headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new WorkspaceRequestError((json as any).error || `${path} returned ${res.status}`, res.status);
  return json as T;
}

const body = (data: unknown) => JSON.stringify(data);

export const workspaceApi = {
  info: () => api<{ home: string; projects: number; library: number }>('/workspace'),

  listProjects: () => api<ProjectMeta[]>('/projects'),
  createProject: (input: { name: string; description?: string; kind?: ProjectMeta['kind']; tags?: string[] }) =>
    api<ProjectMeta>('/projects', { method: 'POST', body: body(input) }),
  updateProject: (id: string, patch: Partial<Pick<ProjectMeta, 'name' | 'description' | 'kind' | 'tags' | 'extensions'>>) =>
    api<ProjectMeta>(`/projects/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteProject: (id: string) => api<{ trashedTo: string }>(`/projects/${id}`, { method: 'DELETE' }),
  createGame: (projectId: string, name: string, bundle: unknown) =>
    api<{ project: ProjectMeta; game: ProjectGameEntry }>(`/projects/${projectId}/games`, { method: 'POST', body: body({ name, bundle }) }),
  loadGame: (projectId: string, gameId: string) => api<{ bundle: any; path: string }>(`/projects/${projectId}/games/${gameId}`),
  saveGame: (projectId: string, gameId: string, bundle: unknown) =>
    api<ProjectGameEntry>(`/projects/${projectId}/games/${gameId}`, { method: 'PUT', body: body({ bundle }) }),
  deleteGame: (projectId: string, gameId: string) => api(`/projects/${projectId}/games/${gameId}`, { method: 'DELETE' }),

  listLibrary: (scope: string) => api<LibraryAsset[]>(`/library?scope=${encodeURIComponent(scope)}`),
  uploadToLibrary: (scope: string, file: File, extra: { tags?: string[]; source?: string; license?: string } = {}) => {
    const q = new URLSearchParams({ scope, filename: file.name, name: file.name.replace(/\.[^.]+$/, '') });
    if (extra.tags?.length) q.set('tags', extra.tags.join(','));
    if (extra.source) q.set('source', extra.source);
    if (extra.license) q.set('license', extra.license);
    return api<LibraryAsset>(`/library/upload?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  },
  updateAsset: (scope: string, id: string, patch: Partial<Pick<LibraryAsset, 'name' | 'kind' | 'tags' | 'license' | 'meta'>>) =>
    api<LibraryAsset>(`/library/${encodeURIComponent(scope)}/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteAsset: (scope: string, id: string) => api(`/library/${encodeURIComponent(scope)}/${id}`, { method: 'DELETE' }),
  assetUrl: (scope: string, id: string) => `/api/library/file/${encodeURIComponent(scope)}/${id}`,

  listExtensions: () => api<InstalledExtension[]>('/extensions'),
  fetchExtensionManifest: (url: string) => api<ExtensionManifest>('/extensions/fetch', { method: 'POST', body: body({ url }) }),
  installExtension: (input: { manifest: ExtensionManifest; source: InstalledExtension['source']; approvedPermissions: ExtensionPermission[]; aiReview?: Pick<ExtensionReview, 'aiSummary' | 'aiRisk'> }) =>
    api<InstalledExtension>('/extensions/install', { method: 'POST', body: body(input) }),
  setExtensionEnabled: (id: string, enabled: boolean) => api(`/extensions/${id}`, { method: 'PATCH', body: body({ enabled }) }),
  uninstallExtension: (id: string) => api(`/extensions/${id}`, { method: 'DELETE' }),

  readMemory: () => api<{ enabled: boolean; entries: MemoryEntry[] }>('/memory'),
  addMemory: (entry: Partial<MemoryEntry>) => api<MemoryEntry>('/memory', { method: 'POST', body: body(entry) }),
  updateMemory: (id: string, patch: Partial<MemoryEntry>) => api<MemoryEntry>(`/memory/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteMemory: (id: string) => api(`/memory/${id}`, { method: 'DELETE' }),
  setMemoryEnabled: (enabled: boolean) => api('/memory/settings', { method: 'PATCH', body: body({ enabled }) }),
  markMemoriesUsed: (ids: string[]) => api('/memory/used', { method: 'POST', body: body({ ids }) }),
};
