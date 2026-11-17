import { optimizeGlbTextures } from '../utils/glbOptimize';
import { browserTextureCodec } from '../utils/glbTextureCodec';
import { workspaceApi, type LibraryAsset } from './workspaceClient';

export const DEFAULT_TEXTURE_SIZE = 1024;

export interface OptimizedModel {
  asset: LibraryAsset;
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Saves a lighter copy of a library model (textures shrunk to `maxSize`) next to the original, which is kept: it may be a paid
 * generation. The copy keeps the original's tags, source, licence and meta (so clips and generation info survive).
 * Resolves to null when nothing could be made smaller.
 */
export async function optimizeLibraryModel(scope: string, asset: LibraryAsset, maxSize = DEFAULT_TEXTURE_SIZE): Promise<OptimizedModel | null> {
  const res = await fetch(workspaceApi.assetUrl(scope, asset.id), { cache: 'no-store' }); // a 25 MB response can fail to cache
  if (!res.ok) throw new Error(`Could not read ${asset.name} (${res.status})`);
  const report = await optimizeGlbTextures(new Uint8Array(await res.arrayBuffer()), { codec: browserTextureCodec, maxSize, quality: 0.85 });
  if (!report.changed || report.after > report.before * 0.9) return null;

  const file = new File([new Uint8Array(report.glb)], `${asset.id}-${maxSize}px.glb`, { type: 'model/gltf-binary' });
  const added = await workspaceApi.uploadToLibrary(scope, file, {
    tags: [...new Set([...(asset.tags || []), 'optimized'])],
    source: asset.source,
    license: asset.license,
  });
  const asset2 = await workspaceApi.updateAsset(scope, added.id, {
    name: `${asset.name} (${maxSize}px)`,
    meta: { ...(asset.meta || {}), optimizedFrom: asset.id, textureMaxSize: maxSize, bytesBefore: report.before, bytesAfter: report.after },
  });
  return { asset: asset2, bytesBefore: report.before, bytesAfter: report.after };
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
