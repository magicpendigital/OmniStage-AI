/**
 * Phase 2 (engine E1) — the collision box of a 2D node: its size × scale, or `collider` when authored, centred at `pos`
 * plus the collider offset. Shared by the stage, the verifier and the exporter so all of them agree on what "touching" means.
 */
import type { Node2D } from '../../types/scene.schema';
import type { Box } from './collide2d';

export function nodeBox2D(n: Pick<Node2D, 'width' | 'height' | 'scaleX' | 'scaleY' | 'collider'>, pos: { x: number; y: number }): Box {
  const sx = Math.abs(n.scaleX ?? 1);
  const sy = Math.abs(n.scaleY ?? 1);
  const c = n.collider;
  const w = Math.max(1, (finite(c?.width) ?? n.width) * sx);
  const h = Math.max(1, (finite(c?.height) ?? n.height) * sy);
  return { x: pos.x + (finite(c?.offsetX) ?? 0) * sx, y: pos.y + (finite(c?.offsetY) ?? 0) * sy, w, h };
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
