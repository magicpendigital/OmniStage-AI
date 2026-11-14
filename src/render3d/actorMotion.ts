/**
 * Phase 7B — procedural actor motion shared by the studio viewport and the OmniStage Player: idle/bounce/float/spin/
 * walk/attack offsets, media enter effects and the click / unbox pulse. Pure maths, no Three.js scene access.
 */
import type { ActorNode } from '../types/scene.schema';

export interface ActorMotion {
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * @param time        timeline time (seconds)
 * @param hasRig      the actor renders a GLB: skeletal clips already animate walk/attack/idle
 * @param clickPulse  1 → 0 decay after a tap
 * @param clock       free-running seconds (shake frequency)
 */
export function actorMotion(actor: ActorNode, mode: 'game' | 'media' | string, time: number, hasRig: boolean,
  clickPulse = 0, clock = 0, hovered = false): ActorMotion {
  const t = time * (actor.animationSpeed ?? 1);
  let ox = 0, oy = 0, oz = 0, rx = 0, ry = 0, rz = 0, enterScale = 1;

  if (mode === 'media' && actor.startTime !== undefined && actor.enterEffect && actor.enterEffect !== 'none') {
    const p = Math.min(1, Math.max(0, time - actor.startTime) / 0.6);
    if (actor.enterEffect === 'pop-in') enterScale = smoothstep(p);
    else if (actor.enterEffect === 'slide-up') oy -= (1 - smoothstep(p)) * 1.5;
  }

  const anim = actor.activeAnimation;
  if (!hasRig || anim === 'bounce' || anim === 'float' || anim === 'spin') {
    switch (anim) {
      case 'bounce': oy += Math.abs(Math.sin(t * 3.2)) * 0.48; break;
      case 'float': oy += Math.sin(t * 2.0) * 0.18 + 0.12; ry += Math.sin(t * 0.9) * 0.25; break;
      case 'spin': ry = t * 1.8; break;
      case 'walk': oy += Math.abs(Math.sin(t * 5.0)) * 0.12; rz = Math.sin(t * 5.0) * 0.08; break;
      case 'attack': ry += Math.sin(t * 3.8) * 0.48; oz += Math.max(0, Math.sin(t * 3.8)) * 0.32; break;
      default: oy += Math.sin(t * 1.5) * 0.04; break;
    }
  }

  // Phase 10C: talking — a small nod and lean in time with the voice (works on rigged and procedural actors).
  const talk = actor.talkLevel || 0;
  if (talk > 0) {
    oy += talk * 0.025;
    rx += talk * 0.07 * (0.6 + 0.4 * Math.sin(time * 9));
    ry += Math.sin(time * 2.3) * 0.06 * talk;
  }

  if (clickPulse > 0.01) {
    if (actor.onClickAction === 'unbox-tap' || actor.assetId === 'mystery-gift-box') {
      rz += Math.sin(clock * 45) * clickPulse * 0.28;
      rx += Math.cos(clock * 38) * clickPulse * 0.22;
      oy += clickPulse * 0.35;
    } else {
      oy += clickPulse * 0.6;
      ry += clickPulse * 1.4;
    }
  }
  return { offset: [ox, oy, oz], rotation: [rx, ry, rz], scale: (hovered ? 1.05 : 1) * enterScale };
}

/** Frame-rate independent exponential smoothing (same as THREE.MathUtils.damp). */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Whether an actor is visible on the media timeline at `time` (always in game mode). */
export function actorInTimeline(actor: ActorNode, mode: string, time: number) {
  if (actor.visible === false) return false;
  return mode === 'game' || ((actor.startTime === undefined || time >= actor.startTime) && (actor.endTime === undefined || time <= actor.endTime));
}

export function actorBadgeText(actor: ActorNode, unboxTapCount: number): string {
  return actor.assetId === 'mystery-gift-box'
    ? `TAP TO UNBOX (${unboxTapCount}/${actor.unboxTapsRequired || 3})`
    : `${actor.name} · [${actor.position.map((n) => n.toFixed(1)).join(', ')}]`;
}
