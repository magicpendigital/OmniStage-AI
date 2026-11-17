/**
 * Scene transitions drawn on a 2D canvas (Phase 11E). One implementation for the MP4 compositor (`mediaExporter` / `filmExport`)
 * and the OmniStage Player (Play Test, exported HTML), so a dissolve looks the same everywhere. Pure canvas 2D: no DOM, no imports
 * beyond types, safe to bundle into the Player.
 *
 * `previous` is the LAST frame of the scene we leave; what is already on `ctx` is the scene we enter (in the Player the overlay
 * canvas is transparent, the live scene shows through).
 */
import type { SceneSpec, SceneTransition } from '../types/scene.schema';

export type CompositorTransition = 'none' | 'crossfade' | 'fade-to-black' | 'fade-white' | 'wipe' | 'whip-pan' | 'iris';

export const COMPOSITOR_TRANSITIONS: CompositorTransition[] = ['none', 'crossfade', 'fade-to-black', 'fade-white', 'wipe', 'whip-pan', 'iris'];

/** A scene's own transition (`sequence.transition`) mapped to the compositor's names; falls back to `fallback`. */
export function compositorTransition(scene: Pick<SceneSpec, 'sequence'>, fallback: string): CompositorTransition {
  const own: SceneTransition | undefined = scene.sequence?.transition;
  const t = own === 'cut' ? 'none' : own === 'fade' ? 'fade-to-black' : own || fallback;
  return (COMPOSITOR_TRANSITIONS.includes(t as CompositorTransition) ? t : 'fade-to-black') as CompositorTransition;
}

/** How long a transition runs (seconds) when the host does not pick one: a whip is quick, an iris is a beat. */
export function transitionSeconds(kind: CompositorTransition): number {
  switch (kind) {
    case 'none': return 0;
    case 'whip-pan': return 0.35;
    case 'iris': return 0.9;
    case 'crossfade': return 0.7;
    default: return 0.6;
  }
}

const smooth = (p: number) => p * p * (3 - 2 * p);

/** Draws the transition from the previous scene's last frame over the current frame. `progress` 0..1. */
export function drawSceneTransition(
  ctx: CanvasRenderingContext2D,
  previous: CanvasImageSource,
  kind: CompositorTransition,
  progress: number,
  width: number,
  height: number
) {
  const p = Math.min(1, Math.max(0, progress));
  if (kind === 'fade-white' || kind === 'fade-to-black') {
    const alpha = p < 0.5 ? (0.5 - p) * 2 : 0;
    if (alpha > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(previous, 0, 0, width, height);
      ctx.restore();
    }
    const veil = p < 0.5 ? p * 2 : (1 - p) * 2;
    ctx.fillStyle = kind === 'fade-white' ? `rgba(255, 255, 255, ${veil})` : `rgba(0, 0, 0, ${veil})`;
    ctx.fillRect(0, 0, width, height);
  } else if (kind === 'wipe') {
    const edge = Math.round(width * p);
    if (width - edge > 0) ctx.drawImage(previous, edge, 0, width - edge, height, edge, 0, width - edge, height);
  } else if (kind === 'crossfade') {
    // A real dissolve: the old frame stays and melts away over the live new scene.
    ctx.save();
    ctx.globalAlpha = 1 - smooth(p);
    ctx.drawImage(previous, 0, 0, width, height);
    ctx.restore();
  } else if (kind === 'whip-pan') {
    // The old frame is flung off to the left; ghost copies behind it stand in for motion blur (no ctx.filter: works everywhere).
    const e = p * p;
    const x = -width * e * 1.15;
    const ghosts = 6;
    ctx.save();
    for (let g = ghosts; g >= 0; g--) {
      ctx.globalAlpha = (g === 0 ? 1 : 0.35 / g) * (1 - p * p * p);
      ctx.drawImage(previous, x + g * width * 0.05 * e * 4, 0, width, height);
    }
    ctx.restore();
  } else if (kind === 'iris') {
    // Iris out on the old frame to black, then iris in on the new scene.
    const radius = Math.hypot(width, height) / 2;
    const hole = p < 0.5 ? (1 - p * 2) * radius : (p * 2 - 1) * radius;
    if (p < 0.5) ctx.drawImage(previous, 0, 0, width, height);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(width / 2, height / 2, Math.max(0, hole), 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }
}
