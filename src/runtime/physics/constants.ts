/**
 * Phase 2 (engine E1) — the ONE source of platformer numbers. The runtime (`stage2d.ts` / `platformer.ts`) and the verifier
 * (`sceneVerifier.ts`: how far a jump reaches) both read these, so a level the verifier accepts is a level the engine can play.
 * Pure data + maths: no DOM, no store, runs unchanged inside exported playable ads.
 */
import type { PlatformerController2D } from '../../types/scene.schema';

/** Pixels of the 1000x600 design space per "metre" of the studio gravity setting (9.8 m/s² → 882 px/s²). */
export const PX_PER_METER = 90;

export interface PlatformerTuning {
  /** Horizontal speed while a direction is held (px/s). */
  runSpeed: number;
  /** Initial upward speed of a jump (px/s). */
  jumpVelocity: number;
  /** Downward acceleration (px/s²). */
  gravity: number;
  /** Seconds after walking off a ledge during which a jump still counts as a ground jump. */
  coyoteTime: number;
  /** Seconds a jump press is remembered before landing, so an early press still jumps. */
  jumpBuffer: number;
  /** 1 = single jump, 2 = double jump … */
  maxJumps: number;
  /** Releasing jump while rising multiplies vy by this (1 = no variable-height jump). */
  jumpCut: number;
  /** Horizontal slow-down per 1/60 s with no direction held (0.82 = the original feel). */
  friction: number;
  /** 0..1: how much of the run speed the player can steer to while airborne. */
  airControl: number;
  /** Terminal fall speed (px/s); also keeps fast bodies from tunnelling thin platforms. */
  maxFallSpeed: number;
}

export const PLATFORMER_DEFAULTS: Readonly<PlatformerTuning> = Object.freeze({
  runSpeed: 320,
  jumpVelocity: 520,
  gravity: 9.8 * PX_PER_METER,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
  maxJumps: 1,
  jumpCut: 0.5,
  friction: 0.82,
  airControl: 1,
  maxFallSpeed: 1100,
});

/** Allowed range per authored controller field; values outside are clamped by the runtime and flagged by the verifier. */
export const CONTROLLER_LIMITS = {
  runSpeed: [60, 900],
  jumpVelocity: [150, 1100],
  gravityScale: [0.25, 3],
  coyoteTime: [0, 0.3],
  jumpBuffer: [0, 0.3],
  maxJumps: [1, 3],
  airControl: [0, 1],
} as const;

function clamp(v: number, [lo, hi]: readonly [number, number]) {
  return Math.min(hi, Math.max(lo, v));
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Defaults + the player's authored controller (clamped) + the scene's gravity (px/s²) → the numbers the engine uses. */
export function resolveTuning(controller?: PlatformerController2D, gravityPx: number = PLATFORMER_DEFAULTS.gravity): PlatformerTuning {
  const c = controller || {};
  const d = PLATFORMER_DEFAULTS;
  const gravity = (Number.isFinite(gravityPx) && gravityPx > 0 ? gravityPx : d.gravity) * clamp(num(c.gravityScale) ?? 1, CONTROLLER_LIMITS.gravityScale);
  return {
    runSpeed: clamp(num(c.runSpeed) ?? d.runSpeed, CONTROLLER_LIMITS.runSpeed),
    jumpVelocity: clamp(num(c.jumpVelocity) ?? d.jumpVelocity, CONTROLLER_LIMITS.jumpVelocity),
    gravity,
    coyoteTime: clamp(num(c.coyoteTime) ?? d.coyoteTime, CONTROLLER_LIMITS.coyoteTime),
    jumpBuffer: clamp(num(c.jumpBuffer) ?? d.jumpBuffer, CONTROLLER_LIMITS.jumpBuffer),
    maxJumps: Math.round(clamp(num(c.maxJumps) ?? d.maxJumps, CONTROLLER_LIMITS.maxJumps)),
    jumpCut: c.variableJump === false ? 1 : d.jumpCut,
    friction: d.friction,
    airControl: clamp(num(c.airControl) ?? d.airControl, CONTROLLER_LIMITS.airControl),
    maxFallSpeed: d.maxFallSpeed,
  };
}

/** Safety margin for landing on platforms, so levels stay comfortable rather than pixel-perfect. */
export const REACH_MARGIN = 0.82;
/** Platforms are one-way (land from above only), so a near-full jump can touch pickups through them. */
export const PICKUP_MARGIN = 0.95;

export interface PlatformerLimits {
  /** Apex height of one full jump (px). */
  jumpHeight: number;
  /** Highest ledge the player can climb onto from a standing start (px, with margin). */
  maxStepUp: number;
  /** Widest gap the player can cross on the level (px, with margin). */
  maxGap: number;
  runSpeed: number;
  gravity: number;
}

/**
 * How far a player with this tuning can jump. Extra jumps are modelled as stacking one more apex each (the best case a
 * player can time), which keeps the verifier from rejecting levels a double-jumper clears.
 */
export function platformerLimits(t: PlatformerTuning = PLATFORMER_DEFAULTS): PlatformerLimits {
  const jumps = Math.max(1, t.maxJumps);
  const single = (t.jumpVelocity * t.jumpVelocity) / (2 * t.gravity);
  const jumpHeight = single * jumps;
  const airTime = ((2 * t.jumpVelocity) / t.gravity) * jumps;
  return {
    jumpHeight,
    maxStepUp: Math.floor(jumpHeight * REACH_MARGIN),
    maxGap: Math.floor(airTime * t.runSpeed * REACH_MARGIN),
    runSpeed: t.runSpeed,
    gravity: t.gravity,
  };
}
