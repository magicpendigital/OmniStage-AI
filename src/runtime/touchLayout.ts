/**
 * Which on-screen controls a game scene needs — shared by the OmniStage Player HUD and the studio viewport so phones,
 * Play Test and the editor show the same buttons. Keys are the logical names the shared 2D/3D runtime reads.
 */
import type { SceneSpec } from '../types/scene.schema';

export type TouchLayout = 'platformer' | 'dpad' | 'none';

export function touchLayoutFor(spec: SceneSpec, gameEnded: boolean): TouchLayout {
  if (spec.mode !== 'game' || gameEnded) return 'none';
  const platformer = spec.engineType === '2d' && spec.nodes2D.some((n) => n.physics2D === 'player-platformer');
  if (platformer) return 'platformer';
  const player = spec.nodes2D.some((n) => n.physics2D === 'player-topdown') || spec.actors.some((a) => a.physicsRole === 'player');
  return player ? 'dpad' : 'none';
}

/** Buttons per layout: [label, key, gridColumn, gridRow] for the pad, plus the action button. */
export function touchButtons(layout: TouchLayout): { pad: Array<[string, string, number, number]>; action: [string, string] | null } {
  if (layout === 'none') return { pad: [], action: null };
  const pad: Array<[string, string, number, number]> = layout === 'platformer'
    ? [['◀', 'arrowleft', 1, 2], ['▶', 'arrowright', 3, 2]]
    : [['▲', 'arrowup', 2, 1], ['◀', 'arrowleft', 1, 2], ['▼', 'arrowdown', 2, 2], ['▶', 'arrowright', 3, 2]];
  return { pad, action: [layout === 'platformer' ? 'JUMP' : 'ACT', ' '] };
}
