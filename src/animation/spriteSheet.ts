/**
 * Phase 5 — Grid spritesheet animation for Node2D (sprite-gen style atlases).
 * Pure functions; the exporter inlines `spriteFrameAt` via toString(), so it must stay self-contained.
 */
import type { SpriteSheetSpec } from '../types/scene.schema';

export interface SpriteFrame {
  index: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Source rectangle for the frame shown at `time` (seconds). `clipName` overrides `sheet.activeClip`. */
export function spriteFrameAt(sheet: SpriteSheetSpec, time: number, clipName?: string): SpriteFrame | null {
  if (!sheet || !(sheet.frameWidth > 0) || !(sheet.frameHeight > 0) || !(sheet.columns > 0) || !(sheet.frameCount > 0)) {
    return null;
  }
  var name = clipName || sheet.activeClip;
  var clip = name && sheet.clips ? sheet.clips[name] : undefined;
  var start = clip ? Math.max(0, Math.floor(clip.start)) : 0;
  var end = clip ? Math.min(sheet.frameCount - 1, Math.floor(clip.end)) : sheet.frameCount - 1;
  if (end < start) end = start;
  var fps = (clip && clip.fps) || sheet.fps || 12;
  var loop = clip && clip.loop !== undefined ? clip.loop : sheet.loop !== false;
  var length = end - start + 1;
  var step = Math.floor(Math.max(0, time) * fps);
  var offset = loop ? step % length : Math.min(step, length - 1);
  var index = start + offset;
  return {
    index: index,
    sx: (index % sheet.columns) * sheet.frameWidth,
    sy: Math.floor(index / sheet.columns) * sheet.frameHeight,
    sw: sheet.frameWidth,
    sh: sheet.frameHeight,
  };
}

/** Picks idle / run / jump for platformer players when the sheet defines those clips. */
export function playerClipFor(sheet: SpriteSheetSpec, vx: number, onGround: boolean): string | undefined {
  const clips = sheet.clips || {};
  if (!onGround && clips.jump) return 'jump';
  if (Math.abs(vx) > 20 && clips.run) return 'run';
  if (clips.idle) return 'idle';
  return sheet.activeClip;
}
