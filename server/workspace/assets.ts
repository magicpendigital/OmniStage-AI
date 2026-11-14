/**
 * Phase 6 — Asset store used for the personal library (~/OmniStage/library) and per-project shared assets
 * (~/OmniStage/projects/<id>/assets). Files are stored as files/<assetId>.<ext> with a JSON index.
 */
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { assertId, nowIso, readJSON, uniqueId, WorkspaceError, writeJSON } from './store';

export type LibraryAssetKind = 'model' | 'image' | 'spritesheet' | 'audio' | 'hdri' | 'video' | 'other';

export interface LibraryAsset {
  id: string;
  name: string;
  kind: LibraryAssetKind;
  file: string;
  mime: string;
  size: number;
  tags: string[];
  /** Where it came from: upload, meshy, tripo, polyhaven, ai-generated... */
  source: string;
  license?: string;
  /** Free-form metadata, e.g. spriteSheet grid, clip names, generation prompt. */
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

const EXT_KIND: Record<string, { kind: LibraryAssetKind; mime: string }> = {
  '.glb': { kind: 'model', mime: 'model/gltf-binary' },
  '.gltf': { kind: 'model', mime: 'model/gltf+json' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.svg': { kind: 'image', mime: 'image/svg+xml' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.hdr': { kind: 'hdri', mime: 'image/vnd.radiance' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.json': { kind: 'other', mime: 'application/json' },
};

export function classifyFile(filename: string): { ext: string; kind: LibraryAssetKind; mime: string } {
  const ext = extname(filename).toLowerCase();
  const known = EXT_KIND[ext];
  if (!known) throw new WorkspaceError(`Unsupported file type "${ext || filename}"`);
  return { ext, ...known };
}

export class AssetStore {
  constructor(private root: string) {}

  private indexPath() {
    return join(this.root, 'index.json');
  }

  async list(): Promise<LibraryAsset[]> {
    const index = await readJSON<{ assets: LibraryAsset[] }>(this.indexPath(), { assets: [] });
    return index.assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async save(assets: LibraryAsset[]) {
    await writeJSON(this.indexPath(), { assets });
  }

  async add(input: { filename: string; data: Buffer; name?: string; kind?: LibraryAssetKind; tags?: string[]; source?: string; license?: string; meta?: Record<string, unknown> }): Promise<LibraryAsset> {
    if (!input.data?.length) throw new WorkspaceError('Empty file');
    if (input.data.length > MAX_ASSET_BYTES) throw new WorkspaceError('File is larger than 200 MB', 413);
    const { ext, kind, mime } = classifyFile(input.filename);
    const assets = await this.list();
    const name = (input.name || input.filename.replace(/\.[^.]+$/, '')).slice(0, 80);
    const id = uniqueId(name, new Set(assets.map((a) => a.id)), 'asset');
    const file = `${id}${ext}`;
    await fs.mkdir(join(this.root, 'files'), { recursive: true });
    await fs.writeFile(join(this.root, 'files', file), input.data);
    const asset: LibraryAsset = {
      id,
      name,
      kind: input.kind && input.kind !== 'other' ? input.kind : kind,
      file,
      mime,
      size: input.data.length,
      tags: (input.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20),
      source: input.source || 'upload',
      license: input.license,
      meta: input.meta,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.save([asset, ...assets]);
    return asset;
  }

  async update(id: string, patch: Partial<Pick<LibraryAsset, 'name' | 'kind' | 'tags' | 'license' | 'meta'>>): Promise<LibraryAsset> {
    assertId(id, 'asset id');
    const assets = await this.list();
    const asset = assets.find((a) => a.id === id);
    if (!asset) throw new WorkspaceError('Asset not found', 404);
    if (patch.name) asset.name = String(patch.name).slice(0, 80);
    if (patch.kind) asset.kind = patch.kind;
    if (Array.isArray(patch.tags)) asset.tags = patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20);
    if (patch.license !== undefined) asset.license = patch.license;
    if (patch.meta && typeof patch.meta === 'object') asset.meta = { ...(asset.meta || {}), ...patch.meta };
    asset.updatedAt = nowIso();
    await this.save(assets);
    return asset;
  }

  async remove(id: string): Promise<void> {
    assertId(id, 'asset id');
    const assets = await this.list();
    const asset = assets.find((a) => a.id === id);
    if (!asset) throw new WorkspaceError('Asset not found', 404);
    await fs.rm(join(this.root, 'files', asset.file), { force: true });
    await this.save(assets.filter((a) => a.id !== id));
  }

  async filePath(id: string): Promise<{ path: string; asset: LibraryAsset }> {
    assertId(id, 'asset id');
    const asset = (await this.list()).find((a) => a.id === id);
    if (!asset) throw new WorkspaceError('Asset not found', 404);
    return { path: join(this.root, 'files', asset.file), asset };
  }
}
