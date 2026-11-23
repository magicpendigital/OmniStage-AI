/**
 * Phase 2 (engine E1) — deterministic 2D collision: axis-aligned boxes, solid / one-way surfaces, moving-platform carry,
 * raycast and swept-box queries. Pure functions of their arguments (no Date, no Math.random, no DOM), so the studio,
 * Play Test, phones and exported ads simulate identically.
 *
 * Coordinates are the 1000x600 design space (y grows downward). Boxes are centre-based.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SolidKind = 'solid' | 'one-way';

export interface Solid {
  id: string;
  /** Position AFTER this step's movement (moving platforms). */
  box: Box;
  kind: SolidKind;
  /** Distance the solid moved this step; a body standing on it is carried by the same amount. */
  dx?: number;
  dy?: number;
}

export interface Body2D extends Box {
  vx: number;
  vy: number;
  grounded: boolean;
  /** Id of the solid we stand on (so a moving platform can carry us). */
  groundId?: string;
  /** -1 / 1 when pushing against a wall this step. */
  wall: -1 | 0 | 1;
  ceiling: boolean;
}

export const left = (b: Box) => b.x - b.w / 2;
export const right = (b: Box) => b.x + b.w / 2;
export const top = (b: Box) => b.y - b.h / 2;
export const bottom = (b: Box) => b.y + b.h / 2;

/** Strict overlap (touching edges do not count). */
export function overlaps(a: Box, b: Box): boolean {
  return left(a) < right(b) && right(a) > left(b) && top(a) < bottom(b) && bottom(a) > top(b);
}

export function createBody(x: number, y: number, w: number, h: number): Body2D {
  return { x, y, w, h, vx: 0, vy: 0, grounded: false, wall: 0, ceiling: false };
}

const EPS = 0.01;
/** A one-way platform catches a body whose feet were above its top by at most this much last step. */
const ONE_WAY_SLOP = 1;

export interface MoveOptions {
  /** 'platformer': one-way surfaces catch from above. 'topdown': every solid blocks on all sides, no ground state. */
  mode: 'platformer' | 'topdown';
}

/**
 * Advance `body` by its velocity for `dt` seconds against `solids`: carry with the moving platform it stands on, move on X and
 * resolve, move on Y and resolve. Sets grounded / groundId / wall / ceiling and zeroes the blocked velocity component.
 * Keep `dt` small (the platformer controller substeps) so a body cannot skip through a thin solid.
 */
export function moveBody(body: Body2D, solids: Solid[], dt: number, opts: MoveOptions = { mode: 'platformer' }): void {
  const platformer = opts.mode === 'platformer';
  body.wall = 0;
  body.ceiling = false;

  // Ride the platform we were standing on.
  if (platformer && body.groundId) {
    const ride = solids.find((s) => s.id === body.groundId);
    if (ride) {
      body.x += ride.dx ?? 0;
      body.y += ride.dy ?? 0;
    }
  }

  // --- X ---
  const prevBottom = bottom(body);
  body.x += body.vx * dt;
  for (const s of solids) {
    if (s.kind === 'one-way' && platformer) continue;
    if (!overlaps(body, s.box)) continue;
    // Standing exactly on top of something while it slides under us is not a wall hit.
    if (platformer && prevBottom <= top(s.box) + EPS) continue;
    const dir = body.vx !== 0 ? Math.sign(body.vx) : Math.sign(body.x - s.box.x) || 1;
    if (dir > 0) {
      body.x = left(s.box) - body.w / 2;
      body.wall = 1;
    } else {
      body.x = right(s.box) + body.w / 2;
      body.wall = -1;
    }
    body.vx = 0;
  }

  // --- Y ---
  const wasBottom = bottom(body);
  body.y += body.vy * dt;
  body.grounded = false;
  body.groundId = undefined;
  for (const s of solids) {
    if (!overlaps(body, s.box)) continue;
    const solidTop = top(s.box);
    if (s.kind === 'one-way' && platformer) {
      const relVy = body.vy - (s.dy ?? 0) / Math.max(dt, 1e-6);
      const feetWereAbove = wasBottom <= solidTop - (s.dy ?? 0) + ONE_WAY_SLOP;
      if (relVy >= 0 && feetWereAbove) {
        body.y = solidTop - body.h / 2;
        body.vy = 0;
        body.grounded = true;
        body.groundId = s.id;
      }
      continue;
    }
    const falling = body.vy > 0 || (body.vy === 0 && body.y < s.box.y);
    if (falling) {
      body.y = solidTop - body.h / 2;
      body.vy = 0;
      if (platformer) {
        body.grounded = true;
        body.groundId = s.id;
      }
    } else {
      body.y = bottom(s.box) + body.h / 2;
      body.vy = 0;
      body.ceiling = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------------------------

export interface Hit {
  id: string;
  /** Distance along the ray / sweep (px) at first contact. */
  distance: number;
  x: number;
  y: number;
  /** Surface normal at the contact (0,0 when the origin starts inside the box). */
  nx: number;
  ny: number;
}

export interface Target {
  id: string;
  box: Box;
}

/** First box hit by a ray from (ox, oy) along (dx, dy) within `maxDistance` px, or null. Slab method, exact. */
export function raycast(ox: number, oy: number, dx: number, dy: number, maxDistance: number, targets: Target[]): Hit | null {
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !(maxDistance > 0)) return null;
  const ux = dx / len;
  const uy = dy / len;
  let best: Hit | null = null;
  for (const t of targets) {
    const hit = rayVsBox(ox, oy, ux, uy, maxDistance, t.box);
    if (hit && (!best || hit.distance < best.distance)) best = { id: t.id, ...hit };
  }
  return best;
}

function rayVsBox(ox: number, oy: number, ux: number, uy: number, maxDistance: number, b: Box): Omit<Hit, 'id'> | null {
  const minX = left(b);
  const maxX = right(b);
  const minY = top(b);
  const maxY = bottom(b);
  if (ox > minX && ox < maxX && oy > minY && oy < maxY) return { distance: 0, x: ox, y: oy, nx: 0, ny: 0 };
  let tmin = 0;
  let tmax = maxDistance;
  let nx = 0;
  let ny = 0;
  // X slab
  if (ux === 0) {
    if (ox <= minX || ox >= maxX) return null;
  } else {
    let t1 = (minX - ox) / ux;
    let t2 = (maxX - ox) / ux;
    let n = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Y slab
  if (uy === 0) {
    if (oy <= minY || oy >= maxY) return null;
  } else {
    let t1 = (minY - oy) / uy;
    let t2 = (maxY - oy) / uy;
    let n = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin > maxDistance) return null;
  return { distance: tmin, x: ox + ux * tmin, y: oy + uy * tmin, nx, ny };
}

/** Sweep `box` by (dx, dy): the first target it would touch (Minkowski-expanded raycast), or null. */
export function sweepBox(box: Box, dx: number, dy: number, targets: Target[]): Hit | null {
  const grown = targets.map((t) => ({ id: t.id, box: { x: t.box.x, y: t.box.y, w: t.box.w + box.w, h: t.box.h + box.h } }));
  return raycast(box.x, box.y, dx, dy, Math.hypot(dx, dy), grown);
}

/** True when nothing in `blockers` lies between the two points. */
export function hasLineOfSight(ax: number, ay: number, bx: number, by: number, blockers: Target[]): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  if (dist === 0) return true;
  const hit = raycast(ax, ay, bx - ax, by - ay, dist, blockers);
  return !hit || hit.distance >= dist - EPS;
}
