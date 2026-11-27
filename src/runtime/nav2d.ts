/**
 * Phase 7A — 2D navigation: line of sight and obstacle-aware paths for behaviour state machines (`pathfind: true`, `player-visible`).
 *
 * Pure and deterministic (no Date / Math.random / DOM): a uniform grid over the world, A* with a fixed tie-break, then string-pulling so
 * the route is a handful of straight legs. Blockers are the scene's `solid` nodes as centre-based boxes (the same boxes the player
 * collides with, `nodeBox2D`), inflated by the agent radius so a body never grazes a corner. 3D scenes have no walls, so nothing here
 * applies to them.
 */
import type { Box } from './physics/collide2d';

export type Point2 = readonly [number, number];

/** Grid cell size in design px (1000 x 600 world = 50 x 30 cells). */
export const NAV_CELL = 20;
/** How far a walker keeps from a wall (half a typical sprite). */
export const NAV_AGENT_RADIUS = 12;
/** Cell count cap, so a huge world never makes a frame slow. */
export const NAV_MAX_CELLS = 6000;

export interface NavWorld {
  width: number;
  height: number;
}

/** What the state-machine host hands the interpreter: the walls and the world they stand in. */
export interface NavInput {
  blockers: Box[];
  world: NavWorld;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Does the segment a→b cross `box` grown by `pad` on every side? (slab test; touching counts) */
export function segmentHitsBox(a: Point2, b: Point2, box: Box, pad = 0): boolean {
  const minX = box.x - box.w / 2 - pad;
  const maxX = box.x + box.w / 2 + pad;
  const minY = box.y - box.h / 2 - pad;
  const maxY = box.y + box.h / 2 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, d, lo, hi] of [[a[0], dx, minX, maxX], [a[1], dy, minY, maxY]] as const) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return false;
    } else {
      let ta = (lo - p) / d;
      let tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** True when no blocker (grown by `pad`) stands between the two points. */
export function lineOfSight(blockers: readonly Box[], a: Point2, b: Point2, pad = 0): boolean {
  if (!finite(a[0]) || !finite(a[1]) || !finite(b[0]) || !finite(b[1])) return false;
  for (const box of blockers) if (segmentHitsBox(a, b, box, pad)) return false;
  return true;
}

/** A stable key for a set of blockers (the grid is rebuilt only when this changes). */
export function navSignature(nav: NavInput): string {
  return `${Math.round(nav.world.width)}x${Math.round(nav.world.height)}|${nav.blockers.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(';')}`;
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  private blocked: Uint8Array;

  constructor(readonly nav: NavInput, cell = NAV_CELL, readonly radius = NAV_AGENT_RADIUS) {
    const w = Math.max(1, finite(nav.world.width) ? nav.world.width : 1000);
    const h = Math.max(1, finite(nav.world.height) ? nav.world.height : 600);
    // A big world gets a coarser grid instead of an unbounded one.
    this.cell = Math.max(cell, Math.ceil(Math.sqrt((w * h) / NAV_MAX_CELLS)));
    this.cols = Math.max(1, Math.ceil(w / this.cell));
    this.rows = Math.max(1, Math.ceil(h / this.cell));
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const box of nav.blockers) {
      const x0 = box.x - box.w / 2 - radius;
      const x1 = box.x + box.w / 2 + radius;
      const y0 = box.y - box.h / 2 - radius;
      const y1 = box.y + box.h / 2 + radius;
      for (let cy = Math.max(0, Math.floor(y0 / this.cell)); cy <= Math.min(this.rows - 1, Math.floor(y1 / this.cell)); cy++) {
        for (let cx = Math.max(0, Math.floor(x0 / this.cell)); cx <= Math.min(this.cols - 1, Math.floor(x1 / this.cell)); cx++) {
          const [px, py] = this.center(cx, cy);
          if (px >= x0 && px <= x1 && py >= y0 && py <= y1) this.blocked[cy * this.cols + cx] = 1;
        }
      }
    }
  }

  cellOf(p: Point2): [number, number] {
    return [Math.min(this.cols - 1, Math.max(0, Math.floor(p[0] / this.cell))), Math.min(this.rows - 1, Math.max(0, Math.floor(p[1] / this.cell)))];
  }

  center(cx: number, cy: number): [number, number] {
    return [(cx + 0.5) * this.cell, (cy + 0.5) * this.cell];
  }

  isBlocked(cx: number, cy: number): boolean {
    return cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows || this.blocked[cy * this.cols + cx] === 1;
  }

  /** The closest free cell to (cx, cy) by growing square rings (ties: row, then column — deterministic). */
  nearestFree(cx: number, cy: number): [number, number] | null {
    if (!this.isBlocked(cx, cy)) return [cx, cy];
    const max = Math.max(this.cols, this.rows);
    for (let r = 1; r <= max; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || this.isBlocked(x, y)) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < bestD) [best, bestD] = [[x, y], d];
        }
      }
      if (best) return best;
    }
    return null;
  }
}

// A* over the grid with a binary heap ordered by (f, h, index) so equal-cost routes are always the same one.
class Heap {
  private items: Array<{ f: number; h: number; i: number }> = [];
  get size() {
    return this.items.length;
  }
  private less(a: { f: number; h: number; i: number }, b: { f: number; h: number; i: number }) {
    return a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.i < b.i;
  }
  push(item: { f: number; h: number; i: number }) {
    const a = this.items;
    a.push(item);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.less(a[k], a[parent])) break;
      [a[k], a[parent]] = [a[parent], a[k]];
      k = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === k) break;
        [a[k], a[m]] = [a[m], a[k]];
        k = m;
      }
    }
    return top;
  }
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1],
  [1, -1, Math.SQRT2], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * A route from `from` to `to` around the grid's blockers: the waypoints to walk through, ending at `to` (or the free spot nearest to it
 * when `to` stands inside a wall). Null when the goal cannot be reached. The start is not included.
 */
export function findPath(grid: NavGrid, from: Point2, to: Point2): Array<[number, number]> | null {
  if (!finite(from[0]) || !finite(from[1]) || !finite(to[0]) || !finite(to[1])) return null;
  const s = grid.nearestFree(...grid.cellOf(from));
  const g = grid.nearestFree(...grid.cellOf(to));
  if (!s || !g) return null;
  const goalIsFree = !grid.isBlocked(...grid.cellOf(to));
  const endPoint: [number, number] = goalIsFree ? [to[0], to[1]] : grid.center(g[0], g[1]);
  const n = grid.cols * grid.rows;
  const cost = new Float64Array(n).fill(Infinity);
  const from_ = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const idx = (x: number, y: number) => y * grid.cols + x;
  const octile = (x: number, y: number) => {
    const dx = Math.abs(x - g[0]);
    const dy = Math.abs(y - g[1]);
    return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy));
  };
  const open = new Heap();
  const start = idx(s[0], s[1]);
  cost[start] = 0;
  open.push({ f: octile(s[0], s[1]), h: octile(s[0], s[1]), i: start });
  const goal = idx(g[0], g[1]);
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    if (cur.i === goal) {
      found = true;
      break;
    }
    const cx = cur.i % grid.cols;
    const cy = Math.floor(cur.i / grid.cols);
    for (const [dx, dy, step] of NEIGHBOURS) {
      const x = cx + dx;
      const y = cy + dy;
      if (grid.isBlocked(x, y)) continue;
      // No cutting a wall's corner on a diagonal.
      if (dx && dy && (grid.isBlocked(cx + dx, cy) || grid.isBlocked(cx, cy + dy))) continue;
      const j = idx(x, y);
      if (closed[j]) continue;
      const c = cost[cur.i] + step;
      if (c < cost[j]) {
        cost[j] = c;
        from_[j] = cur.i;
        const h = octile(x, y);
        open.push({ f: c + h, h, i: j });
      }
    }
  }
  if (!found) return null;
  const cells: Array<[number, number]> = [];
  for (let k = goal; k !== -1 && k !== start; k = from_[k]) cells.push(grid.center(k % grid.cols, Math.floor(k / grid.cols)));
  cells.reverse();
  // String-pull: keep only the corners a straight, wall-clear leg cannot skip.
  const route: Array<[number, number]> = [...cells, endPoint];
  const out: Array<[number, number]> = [];
  let anchor: Point2 = from;
  let i = 0;
  while (i < route.length) {
    let far = i;
    for (let k = route.length - 1; k > i; k--) {
      if (lineOfSight(grid.nav.blockers, anchor, route[k], grid.radius * 0.9)) {
        far = k;
        break;
      }
    }
    out.push(route[far]);
    anchor = route[far];
    i = far + 1;
  }
  return out;
}
