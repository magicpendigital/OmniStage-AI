/**
 * Phase 2 (engine E1) — kinematic character controllers for the 2D stage: a platformer (run, jump with coyote time, a jump
 * buffer, variable jump height and extra air jumps) and a top-down mover. Deterministic: the same inputs and `dt` always give the
 * same positions. A frame is split into fixed substeps so slow frames and fast bodies cannot skip through thin platforms.
 */
import { Body2D, createBody, moveBody, Solid } from './collide2d';
import { PlatformerTuning } from './constants';

export interface ControllerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Jump key / button currently held. The controller detects the press itself. */
  jump: boolean;
}

export interface PlatformerState extends Body2D {
  /** Seconds of coyote time left. */
  coyote: number;
  /** Seconds the last jump press is still remembered. */
  buffer: number;
  /** Jumps used since last standing on the ground. */
  jumpsUsed: number;
  /** Jump held last substep (for edge detection). */
  jumpHeld: boolean;
  /** True from a jump until it is cut or the body starts falling (for variable jump height). */
  rising: boolean;
  facing: 1 | -1;
}

export function createPlatformerState(x: number, y: number, w: number, h: number): PlatformerState {
  return { ...createBody(x, y, w, h), coyote: 0, buffer: 0, jumpsUsed: 0, jumpHeld: false, rising: false, facing: 1 };
}

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
}

export const NO_INPUT: ControllerInput = Object.freeze({ left: false, right: false, up: false, down: false, jump: false });

/** Substep length: 1/60 s, and short enough that the fastest body moves at most ~10 px per substep. */
function substeps(dt: number, speed: number): number {
  const frames = Math.max(1, Math.ceil(dt * 60 - 1e-6));
  const distance = Math.ceil((Math.abs(speed) * dt) / 10);
  return Math.min(16, Math.max(frames, distance, 1));
}

/** Advance a platformer body by `dt` seconds. */
export function stepPlatformer(s: PlatformerState, input: ControllerInput, dt: number, solids: Solid[], t: PlatformerTuning): StepEvents {
  const events: StepEvents = { jumped: false, landed: false };
  if (!(dt > 0)) return events;
  const n = substeps(dt, Math.max(Math.abs(s.vy), Math.abs(s.vx), t.jumpVelocity, t.runSpeed));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const wasGrounded = s.grounded;

    // --- jump bookkeeping ---
    if (input.jump && !s.jumpHeld) s.buffer = t.jumpBuffer;
    s.jumpHeld = input.jump;
    s.buffer = Math.max(0, s.buffer - h);
    if (s.grounded) {
      s.coyote = t.coyoteTime;
      s.jumpsUsed = 0;
    } else {
      s.coyote = Math.max(0, s.coyote - h);
      // Walked off a ledge and coyote time ran out: the ground jump is gone, air jumps remain.
      if (s.coyote === 0 && s.jumpsUsed === 0) s.jumpsUsed = 1;
    }
    if (s.buffer > 0) {
      const groundJump = s.grounded || (s.coyote > 0 && s.jumpsUsed === 0);
      const airJump = !groundJump && s.jumpsUsed < t.maxJumps;
      if (groundJump || airJump) {
        s.vy = -t.jumpVelocity;
        s.jumpsUsed = groundJump ? 1 : s.jumpsUsed + 1;
        s.buffer = 0;
        s.coyote = 0;
        s.grounded = false;
        s.groundId = undefined;
        s.rising = true;
        events.jumped = true;
      }
    }
    // Variable height: letting go of jump while rising cuts the jump short (once).
    if (s.rising) {
      if (s.vy >= 0) s.rising = false;
      else if (!input.jump) {
        s.vy *= t.jumpCut;
        s.rising = false;
      }
    }

    // --- horizontal ---
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      s.facing = dir > 0 ? 1 : -1;
      const target = dir * t.runSpeed;
      s.vx = s.grounded || t.airControl >= 1 ? target : s.vx + (target - s.vx) * t.airControl;
    } else {
      s.vx *= Math.pow(t.friction, h * 60);
      if (Math.abs(s.vx) < 0.5) s.vx = 0;
    }

    // --- vertical + collision ---
    s.vy = Math.min(s.vy + t.gravity * h, t.maxFallSpeed);
    moveBody(s, solids, h, { mode: 'platformer' });
    if (!wasGrounded && s.grounded) events.landed = true;
  }
  return events;
}

/** Advance a top-down body (8-way movement, diagonals normalised, no gravity) by `dt` seconds. */
export function stepTopDown(s: PlatformerState, input: ControllerInput, dt: number, solids: Solid[], t: PlatformerTuning): void {
  if (!(dt > 0)) return;
  const n = substeps(dt, t.runSpeed);
  const h = dt / n;
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 0; i < n; i++) {
    if (dx !== 0) {
      s.vx = (dx / len) * t.runSpeed;
      s.facing = dx > 0 ? 1 : -1;
    } else {
      s.vx *= Math.pow(t.friction, h * 60);
      if (Math.abs(s.vx) < 0.5) s.vx = 0;
    }
    if (dy !== 0) s.vy = (dy / len) * t.runSpeed;
    else {
      s.vy *= Math.pow(t.friction, h * 60);
      if (Math.abs(s.vy) < 0.5) s.vy = 0;
    }
    moveBody(s, solids, h, { mode: 'topdown' });
  }
}
