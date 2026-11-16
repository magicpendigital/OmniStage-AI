/**
 * Phase 6 Batch 3 — small pure helpers the studio uses around generation (shared with tests).
 */
import type { SemanticAssetEntry, SettingsConfig, SpriteSheetSpec, WorldHDRISpec } from '../types/scene.schema';
import type { GenerationProviderId } from './types';
import { SPRITE_SHEET_FRAMES } from './types';

/**
 * The key sent for a provider: its own Generation key, else the key the user already saved elsewhere in Settings
 * (OpenRouter AI connection key, ElevenLabs voice key), so nobody has to paste the same key twice.
 */
export function generationKeyFor(settings: Pick<SettingsConfig, 'generationKeys' | 'aiApiKeys' | 'elevenLabsApiKey'>, provider: GenerationProviderId): string {
  const own = settings.generationKeys?.[provider]?.trim();
  if (own) return own;
  if (provider === 'openrouter') return (settings.aiApiKeys as Record<string, string | undefined> | undefined)?.openrouter?.trim() || '';
  if (provider === 'elevenlabs') return settings.elevenLabsApiKey?.trim() || '';
  return '';
}

/**
 * A sprite-sheet spec read back from a library asset's `meta.spriteSheet` (written by the generator, but the file on
 * disk is user data, so it is re-checked). Returns undefined for single sprites (`{columns: 1, rows: 1}`) and junk.
 */
export function spriteSheetFromMeta(meta: Record<string, unknown> | undefined): SpriteSheetSpec | undefined {
  const s = meta?.spriteSheet as Partial<SpriteSheetSpec> | undefined;
  if (!s || typeof s !== 'object') return undefined;
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
  const frameCount = int(s.frameCount, SPRITE_SHEET_FRAMES.min, 64);
  const columns = int(s.columns, 1, 64);
  const frameWidth = int(s.frameWidth, 8, 4096);
  const frameHeight = int(s.frameHeight, 8, 4096);
  if (!frameCount || !columns || !frameWidth || !frameHeight) return undefined;
  const fps = typeof s.fps === 'number' && s.fps > 0 && s.fps <= 60 ? s.fps : 8;
  return { frameWidth, frameHeight, columns, frameCount, fps, loop: s.loop !== false };
}

const CLIP_NAME_RE = /^[\p{L}\p{N} _.:|-]{1,64}$/u;

/**
 * Asset-registry entry for a model a rig generator (Meshy / Tripo) saved: rigged, with the clip names it wrote to
 * `meta.clips` (re-checked; the file on disk is user data). Undefined for anything that is not a rigged generation.
 */
export function riggedEntryFromMeta(meta: Record<string, unknown> | undefined, name: string): Partial<SemanticAssetEntry> | undefined {
  if (!meta || meta.rigged !== true) return undefined;
  const clips = Array.isArray(meta.clips) ? [...new Set(meta.clips.filter((c): c is string => typeof c === 'string' && CLIP_NAME_RE.test(c)))].slice(0, 32) : [];
  const provider = typeof meta.provider === 'string' ? meta.provider.replace(/[^a-z0-9-]/gi, '').slice(0, 24) : 'provider';
  return {
    category: 'gltf-rigged',
    description: `${name.slice(0, 60)} — rigged by ${provider}${clips.length ? ` (${clips.join(', ')})` : ''}.`,
    embeddedClips: clips,
    ...(clips.length ? { defaultClip: clips.includes('Idle') ? 'Idle' : clips[0] } : {}),
    defaultPhysicsRole: 'static',
    defaultClickAction: 'none',
  };
}

/** True for a library picture a skybox generator saved (equirectangular, used as the world sky). */
export function isSkyboxAsset(asset: { kind: string; tags?: string[]; meta?: Record<string, unknown> }): boolean {
  if (asset.kind !== 'image') return false;
  const sky = asset.meta?.skybox as { projection?: unknown } | undefined;
  return sky?.projection === 'equirectangular' || !!asset.tags?.includes('skybox');
}

/** World sky for a skybox picture (keeps the current intensity / background choice). */
export function skyboxHdri(url: string, name: string, current?: WorldHDRISpec): WorldHDRISpec {
  return { url, name: name.slice(0, 80), source: 'custom', format: 'image', showBackground: current?.showBackground ?? true, intensity: current?.intensity ?? 1 };
}
