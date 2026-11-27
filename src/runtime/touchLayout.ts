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

/** Phase 7C: how the movement keys are drawn — four/two buttons or a thumb stick (same logical keys either way). */
export type TouchStyle = 'buttons' | 'joystick';

/** `spec.input.touch` decides; 'auto' uses a stick where free movement matters (top-down and 3D) and buttons for platformers. */
export function touchStyleFor(spec: Pick<SceneSpec, 'input'>, layout: TouchLayout): TouchStyle {
  if (layout === 'none') return 'buttons';
  const want = spec.input?.touch;
  if (want === 'joystick') return 'joystick';
  if (want === 'buttons') return 'buttons';
  return layout === 'dpad' ? 'joystick' : 'buttons';
}

export const JOYSTICK_DEADZONE = 0.3;
/** Pushing a platformer's stick up this far presses "up" (jump). */
export const JOYSTICK_JUMP = 0.65;

/**
 * The keys a thumb stick holds. `dx`/`dy` are the knob offset from the centre as a fraction of the stick's radius (-1..1, y down, like
 * the screen). A platformer stick moves left / right and jumps when pushed up; a top-down / 3D stick also walks up / down. Diagonals hold two keys.
 */
export function joystickKeys(dx: number, dy: number, layout: TouchLayout, deadzone = JOYSTICK_DEADZONE): string[] {
  if (layout === 'none' || !Number.isFinite(dx) || !Number.isFinite(dy)) return [];
  const keys: string[] = [];
  if (dx < -deadzone) keys.push('arrowleft');
  else if (dx > deadzone) keys.push('arrowright');
  if (layout === 'platformer') {
    if (dy < -JOYSTICK_JUMP) keys.push('arrowup');
  } else if (dy < -deadzone) keys.push('arrowup');
  else if (dy > deadzone) keys.push('arrowdown');
  return keys;
}
