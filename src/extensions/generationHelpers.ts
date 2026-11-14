/**
 * Phase 6 Batch 3 — small pure helpers the studio uses around generation (shared with tests).
 */
import type { SettingsConfig, SpriteSheetSpec } from '../types/scene.schema';
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
