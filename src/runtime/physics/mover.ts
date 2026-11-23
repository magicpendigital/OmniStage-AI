/**
 * Phase 2 (engine E1) — moving platforms. A mover's offset is a pure function of timeline time, so scrubbing, restarts and
 * frame-stepped exports always agree on where a platform is. Constant speed, ping-pong along one axis.
 */
import type { Mover2D } from '../../types/scene.schema';

export function validMover(m: Mover2D | undefined): m is Mover2D {
  return !!m && (m.axis === 'x' || m.axis === 'y') && Number.isFinite(m.distance) && m.distance !== 0 && Number.isFinite(m.speed) && m.speed > 0;
}

/** Offset (px) from the authored position at timeline time `t`, 0 → `distance` → 0 … */
export function moverOffset(m: Mover2D | undefined, t: number): { x: number; y: number } {
  if (!validMover(m)) return { x: 0, y: 0 };
  const period = (2 * Math.abs(m.distance)) / m.speed;
  const phase = Number.isFinite(m.phase) ? (m.phase as number) : 0;
  const u = (((t / period + phase) % 1) + 1) % 1;
  const tri = u < 0.5 ? u * 2 : 2 - u * 2;
  const off = m.distance * tri;
  return m.axis === 'x' ? { x: off, y: 0 } : { x: 0, y: off };
}
