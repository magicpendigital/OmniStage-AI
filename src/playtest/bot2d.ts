/**
 * Phase 5 (Director E) — the deterministic 2D playtest bot. It plays a game scene on the shared runtime (`headless2d.ts`) with
 * seeded strategies and returns EVIDENCE, not a bare verdict: did any run win, how far did the best one get, when did anything
 * first happen, where did it die or get stuck, and the input tape that reproduces a win (replay it as a regression test).
 *
 * Reading a report: `outcome: 'won'` is proof (a tape exists and `replayTape` reproduces it). `'not-won'` only means these simple
 * bots did not manage it, so the issues say "check" and carry the numbers; they are warnings, never errors.
 * Pure and deterministic: same spec + options give the same report. No `Date`, no `Math.random`.
 */
import type { Node2D, SceneSpec } from '../types/scene.schema';
import { moverOffset } from '../runtime/physics/mover';
import { nodeBox2D } from '../runtime/physics/nodeBox';
import { Box } from '../runtime/physics/collide2d';
import { isPlayerEntity } from '../runtime/game/state';
import { platformerLimits, PlatformerLimits, resolveTuning } from '../runtime/physics/constants';
import { resolveWorld } from '../runtime/physics/camera2d';
import { canReachSurface } from '../verification/sceneVerifier';
import { HEADLESS_DT, HeadlessSession2D, runHeadless2D } from './headless2d';

export type BotStrategy = 'goal' | 'goal-early' | 'wander' | 'idle';

export interface PlaytestOptions {
  /** Strategies to run, in order. Default: goal, goal-early, wander (seed 1 and 2), idle. */
  strategies?: BotStrategy[];
  seed?: number;
  /** Cap on the seconds one run may play. Default: the scene's time limit + 2 s, at most 120. */
  maxSeconds?: number;
}

export interface TraceSample {
  t: number;
  x: number;
  y: number;
  score: number;
  health?: number;
}

/** Run-length input tape: `[frames, mask]`, mask bits 1 = a, 2 = d, 4 = w, 8 = s, 16 = space. Replays at `HEADLESS_DT`. */
export type InputTape = Array<[number, number]>;

export interface PlaytestRun {
  strategy: BotStrategy;
  seed: number;
  won: boolean;
  ended: boolean;
  /** Why the run stopped. */
  stop: 'won' | 'lost' | 'budget';
  seconds: number;
  score: number;
  targetScore?: number;
  collected: number;
  collectibles: number;
  /** Times the player was sent back (hit, fell, hazard). */
  setbacks: number;
  /** Seconds until the score, a variable or health first changed (undefined: nothing ever happened). */
  firstEventSeconds?: number;
  /** Longest stretch with the player not moving while the round was running. */
  longestStillSeconds: number;
  /** Where the longest stillness happened. */
  stillAt?: { x: number; y: number; t: number };
  /** Distance the player travelled in total (px). */
  travelled: number;
  timeLeft: number;
  trace: TraceSample[];
  tape: InputTape;
}

export type PlaytestSeverity = 'error' | 'warn' | 'info';

export interface PlaytestIssue {
  code: string;
  severity: PlaytestSeverity;
  message: string;
  /** The numbers behind the message, so a "fail" is never a bare claim. */
  evidence: Record<string, number | string | boolean>;
}

export interface PlaytestReport {
  supported: boolean;
  /** Why not, when unsupported. */
  reason?: string;
  outcome: 'won' | 'not-won' | 'unsupported';
  /** The run the report is about: the first that won, else the one that got furthest. */
  best?: PlaytestRun;
  runs: PlaytestRun[];
  /** Input tape that reproduces the win (same as `best.tape` when `outcome` is `'won'`). */
  winningTape?: InputTape;
  issues: PlaytestIssue[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Input tape
// ---------------------------------------------------------------------------------------------------------------------

const KEY_BITS: Array<[string, number]> = [['a', 1], ['d', 2], ['w', 4], ['s', 8], [' ', 16]];

export function keysToMask(keys: ReadonlySet<string>): number {
  let mask = 0;
  for (const [key, bit] of KEY_BITS) if (keys.has(key)) mask |= bit;
  return mask;
}

export function maskToKeys(mask: number, into: Set<string>): void {
  into.clear();
  for (const [key, bit] of KEY_BITS) if (mask & bit) into.add(key);
}

function pushTape(tape: InputTape, mask: number): void {
  const last = tape[tape.length - 1];
  if (last && last[1] === mask) last[0] += 1;
  else tape.push([1, mask]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Seeded randomness (mulberry32)
// ---------------------------------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------------------------------------------------

const isLive = (n: Node2D) => n.visible !== false && !n.prefab;

interface Surf {
  id: string;
  left: number;
  right: number;
  top: number;
}

interface Observation {
  player: Node2D;
  box: Box;
  grounded: boolean;
  vy: number;
  time: number;
  solids: Box[];
  surfaces: Surf[];
  limits: PlatformerLimits;
  targets: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  dangers: Danger[];
  /** Where the player may stand horizontally (the world's width), so a dodge never runs into the edge. */
  worldWidth: number;
}

interface Danger {
  box: Box;
  /** px/s of a projectile (0 for spikes and enemies). */
  vx: number;
  vy: number;
}

function observe(session: HeadlessSession2D): Observation | null {
  const state = session.store.getState();
  const nodes = state.sceneSpec.nodes2D;
  const player = nodes.find((n) => isLive(n) && isPlayerEntity(n));
  if (!player) return null;
  const body = session.bodies[player.id];
  const at = body ? { x: body.x, y: body.y } : { x: player.x, y: player.y };
  const solids: Box[] = [];
  const surfaces: Surf[] = [];
  const targets: Observation['targets'] = [];
  const dangers: Danger[] = [];
  for (const n of nodes) {
    if (!isLive(n) || n.id === player.id) continue;
    const off = moverOffset(n.mover, state.currentTime);
    const pos = { x: n.x + off.x, y: n.y + off.y };
    if (n.physics2D === 'static-platform' || n.physics2D === 'solid') {
      const b = nodeBox2D(n, pos);
      solids.push(b);
      surfaces.push({ id: n.id, left: left(b), right: right(b), top: top(b) });
    } else if (n.physics2D === 'collectible' && !session.bodies[n.id]?.collected) {
      const b = nodeBox2D(n, pos);
      targets.push({ id: n.id, x: pos.x, y: pos.y, w: b.w, h: b.h });
    }
    else if (n.physics2D === 'hazard' || (n.contactDamage ?? 0) > 0 || n.projectile) dangers.push({ box: nodeBox2D(n, pos), vx: n.projectile?.vx ?? 0, vy: n.projectile?.vy ?? 0 });
  }
  return { player, box: nodeBox2D(player, at), grounded: !!body?.onGround, vy: body?.vy ?? 0, time: state.currentTime, solids, surfaces, limits: platformerLimits(resolveTuning(player.controller)), targets, dangers, worldWidth: resolveWorld(state.sceneSpec.world2D).width };
}

const left = (b: Box) => b.x - b.w / 2;
const right = (b: Box) => b.x + b.w / 2;
const top = (b: Box) => b.y - b.h / 2;
const bottom = (b: Box) => b.y + b.h / 2;

/** Is there floor under the point (x, just below the feet) within `depth` px? */
function floorUnder(solids: Box[], x: number, feet: number, depth: number): boolean {
  return solids.some((s) => x >= left(s) && x <= right(s) && top(s) >= feet - 6 && top(s) <= feet + depth);
}

// ---------------------------------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------------------------------

interface Policy {
  (obs: Observation, frame: number): number;
}

/** Reactive fallback: head for the nearest collectible; jump onto ledges, over walls, pits and hazards. `lead` jumps that many px earlier. */
function reactivePolicy(topDown: boolean, lead: number): Policy {
  return (obs) => {
    const { box, targets, solids, dangers, grounded } = obs;
    // Nearest by travel: horizontal distance counts fully, climbing costs extra.
    let target: { x: number; y: number } | undefined;
    let bestCost = Infinity;
    for (const t of targets) {
      const cost = Math.abs(t.x - box.x) + (t.y < box.y ? 1.4 : 0.4) * Math.abs(t.y - box.y);
      if (cost < bestCost) {
        bestCost = cost;
        target = t;
      }
    }
    let mask = 0;
    if (!target) return mask;
    const dx = target.x - box.x;
    const dy = target.y - box.y;
    const dir = Math.abs(dx) < 10 ? 0 : dx > 0 ? 1 : -1;
    if (dir > 0) mask |= 2;
    if (dir < 0) mask |= 1;
    if (topDown) {
      if (Math.abs(dy) > 10) mask |= dy > 0 ? 8 : 4;
      return mask;
    }
    if (!grounded) {
      // Hold jump while rising so the full jump height is used; let go once falling.
      if (obs.vy < 0) mask |= 16;
      return mask;
    }
    const feet = bottom(box);
    const probe = dir === 0 ? 0 : dir * (box.w / 2 + 14 + lead);
    // A wall or a taller ledge right ahead.
    const blocked = dir !== 0 && solids.some((s) => {
      const ahead = dir > 0 ? left(s) - right(box) : left(box) - right(s);
      return ahead >= -2 && ahead <= 18 + lead && top(s) < feet - 6 && bottom(s) > top(box);
    });
    // A pit ahead where the target is not below us.
    const pit = dir !== 0 && !floorUnder(solids, box.x + probe, feet, 12) && !(dy > 60 && floorUnder(solids, box.x + probe, feet, 400));
    // The target is above us: jump when close enough to land on it.
    const above = dy < -28 && Math.abs(dx) < 150 + lead;
    // A danger ahead at roughly our height.
    const danger = dir !== 0 && dangers.some(({ box: d }) => {
      const ahead = dir > 0 ? left(d) - right(box) : left(box) - right(d);
      return ahead >= -4 && ahead <= 70 + lead && bottom(d) > top(box) - 10 && top(d) < feet + 10;
    });
    if (blocked || pit || above || danger) mask |= 16;
    return mask;
  };
}

/** The surface the player stands on (highest top within a few px of the feet, overlapping the body horizontally). */
function standingOn(obs: Observation): Surf | undefined {
  const feet = bottom(obs.box);
  return obs.surfaces
    .filter((s) => obs.box.x + obs.box.w / 2 > s.left && obs.box.x - obs.box.w / 2 < s.right && Math.abs(s.top - feet) <= 8)
    .sort((a, b) => a.top - b.top)[0];
}

/** Surfaces a collectible can be grabbed from: close enough sideways and not more than a jump above the surface. */
function supportsOf(obs: Observation, t: Observation['targets'][number], tight: boolean): Surf[] {
  // Tight: the pickup sits over the platform and a jump from it clearly gets there. Loose: a jump from the edge might (the verifier's rule).
  const reachX = tight ? 10 : (obs.box.w + t.w) / 2 + 40;
  const lift = obs.limits.jumpHeight * (tight ? 0.85 : 1);
  // Tight also counts the climb the way a person judges it: feet from the surface to the pickup's centre must fit one jump (the body's
  // own height is not a bonus), so the ground under a high ledge pickup is not a place to jump from.
  const headroom = tight ? 0 : obs.box.h;
  return obs.surfaces.filter((s) => t.x >= s.left - reachX && t.x <= s.right + reachX && t.y >= s.top - headroom - lift && t.y - t.h / 2 <= s.top + 4);
}

/**
 * Deterministic work budget for the planner: every reach check counts, and a run that spends it falls back to the cheap reactive bot.
 * (Counted work, never wall-clock time, so the same scene always plays the same. It keeps a big scene from blocking the server that runs it.)
 */
const PLAN_WORK_LIMIT = 400_000;
let planWork = 0;

/** Frames all runs of one playtest may play together (about 3.5 minutes of game time). */
const TOTAL_FRAME_BUDGET = 12_000;

/** Scenes bigger than this are not playtested (the planner is quadratic in platforms). */
export const MAX_PLAYTEST_NODES = 100;

/** Shortest hop sequence between surfaces (the verifier's own reach rule). Returns the surfaces after `from`, in order. */
function hopPath(obs: Observation, from: Surf, goals: Surf[]): Surf[] | undefined {
  const goalIds = new Set(goals.map((g) => g.id));
  if (goalIds.has(from.id)) return [];
  const prev = new Map<string, Surf | null>([[from.id, null]]);
  const queue: Surf[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of obs.surfaces) {
      if (prev.has(next.id)) continue;
      planWork++;
      if (!canReachSurface(cur, next, obs.limits)) continue;
      prev.set(next.id, cur);
      if (goalIds.has(next.id)) {
        const path: Surf[] = [next];
        for (let at = prev.get(next.id) ?? null; at && at.id !== from.id; at = prev.get(at.id) ?? null) path.unshift(at);
        return path;
      }
      queue.push(next);
    }
  }
  return undefined;
}

/**
 * Platformer planner: pick the nearest collectible, find the platform path to it with the verifier's own reach rule, then walk to
 * the take-off edge, jump, and steer onto the next platform. Falls back to the reactive bot when there is no path (e.g. a lift).
 * `lead` takes off that many px before the edge.
 */
function goalPolicy(topDown: boolean, lead: number): Policy {
  const reactive = reactivePolicy(topDown, lead);
  if (topDown) return reactive;
  let dest: Surf | undefined;
  let cachedKey = '';
  let cachedPaths = new Map<string, Surf[]>();
  return (obs, frame) => {
    const { box, grounded } = obs;
    const w = box.w;
    if (!obs.targets.length) return 0;

    // In the air: steer onto the platform we jumped for, hold the jump while rising.
    if (!grounded) {
      let mask = obs.vy < 0 ? 16 : 0;
      if (dest) {
        const lo = dest.left + w / 2 + 4;
        const hi = dest.right - w / 2 - 4;
        const aim = lo <= hi ? Math.min(hi, Math.max(lo, box.x)) : (dest.left + dest.right) / 2;
        if (Math.abs(aim - box.x) > 4) mask |= aim > box.x ? 2 : 1;
      } else {
        const t = obs.targets[0];
        if (Math.abs(t.x - box.x) > 8) mask |= t.x > box.x ? 2 : 1;
      }
      return mask;
    }
    const here = standingOn(obs);
    if (!here) return reactive(obs, frame);
    if (planWork > PLAN_WORK_LIMIT) return reactive(obs, frame);
    // Nearest collectible by hops, then by distance. The hop paths only change when we land somewhere else or a pickup is gone: reuse them.
    const planKey = `${here.id}|${obs.targets.map((t) => t.id).join(',')}`;
    if (planKey !== cachedKey) {
      cachedKey = planKey;
      cachedPaths = new Map();
      for (const t of obs.targets) {
        const path = hopPath(obs, here, supportsOf(obs, t, true)) ?? hopPath(obs, here, supportsOf(obs, t, false));
        if (path) cachedPaths.set(t.id, path);
      }
    }
    let best: { t: Observation['targets'][number]; path: Surf[] } | undefined;
    for (const t of obs.targets) {
      const path = cachedPaths.get(t.id);
      if (!path) continue;
      const cost = path.length * 1000 + Math.abs(t.x - box.x);
      if (!best || cost < best.path.length * 1000 + Math.abs(best.t.x - box.x)) best = { t, path };
    }
    if (!best) return reactive(obs, frame);

    // The cached route names surfaces by id; read their positions now (a mover shifts them).
    const liveSurfaces = new Map(obs.surfaces.map((x) => [x.id, x]));
    const t = best.t;
    const path = best.path.map((x) => liveSurfaces.get(x.id) ?? x);
    let mask = 0;
    const hop = path[0];
    // Remember where this hop lands: if the body leaves the edge before the jump press registers, the air logic still knows.
    dest = hop;
    if (!hop) {
      // On the right platform: walk under the pickup and jump for it when it is up there.
      const dx = t.x - box.x;
      if (Math.abs(dx) > 6) mask |= dx > 0 ? 2 : 1;
      if (t.y < box.y - 24 && Math.abs(dx) < 36) {
        dest = here;
        mask |= 16;
      }
      return mask;
    }

    const overlap = hop.left < here.right && hop.right > here.left;
    // Side by side: toward it. Stacked below us (a drop): off the edge that faces the pickup.
    const toRight = overlap ? t.x > box.x : hop.left >= here.right - 1;
    const rise = here.top - hop.top;
    let jumpAt: number;
    if (overlap && rise > 0) {
      // Stacked: jump from under it, once the body is over its span.
      const lo = Math.max(here.left, hop.left) + w / 2;
      const hi = Math.min(here.right, hop.right) - w / 2;
      jumpAt = Math.min(Math.max(box.x, lo), Math.max(lo, hi));
      mask |= Math.abs(jumpAt - box.x) > 5 ? (jumpAt > box.x ? 2 : 1) : 0;
      if (Math.abs(jumpAt - box.x) <= 5 || (box.x >= lo && box.x <= hi)) {
        dest = hop;
        mask |= 16;
      }
      return mask;
    }
    // Side to side (or a drop): run to the edge facing it and jump from the very edge.
    const edge = toRight ? here.right + w / 2 - 10 - lead : here.left - w / 2 + 10 + lead;
    const dir = toRight ? 1 : -1;
    const beforeEdge = toRight ? box.x < edge - 3 : box.x > edge + 3;
    if (beforeEdge) mask |= dir > 0 ? 2 : 1;
    else {
      mask |= dir > 0 ? 2 : 1;
      dest = hop;
      if (!overlap) mask |= 16;
    }
    return mask;
  };
}

/**
 * Dodge layer over a policy: step away from something falling on us, jump a projectile or a spike coming along our height, and let the
 * inner policy decide everything else. A bot that cannot dodge cannot tell a fair shooter level from an impossible one.
 */
function withDodge(inner: Policy): Policy {
  return (obs, frame) => {
    const base = inner(obs, frame);
    const { box, grounded } = obs;
    let mask = base;

    // Things falling on us: pick the direction (keep going / stay / left / right) that leaves the fewest of them landing on the body.
    const falling = obs.dangers.filter((f) => f.vy > 0 && bottom(f.box) <= top(box) + 6 && (top(box) - bottom(f.box)) / f.vy < 1.3);
    if (falling.length) {
      const speed = obs.limits.runSpeed;
      const lo = box.w / 2;
      const hi = obs.worldWidth - box.w / 2;
      const risk = (dir: number) => {
        let bad = 0;
        for (const f of falling) {
          const t = Math.max(0, (top(box) - bottom(f.box)) / f.vy);
          const x = Math.min(hi, Math.max(lo, box.x + dir * speed * t));
          if (Math.abs(x - f.box.x) < (box.w + f.box.w) / 2 + 8) bad += 1 / (1 + t);
        }
        return bad;
      };
      const baseDir = base & 2 ? 1 : base & 1 ? -1 : 0;
      let best = baseDir;
      let bestRisk = risk(baseDir);
      for (const dir of [0, 1, -1]) {
        const r = risk(dir);
        if (r < bestRisk - 1e-9) {
          best = dir;
          bestRisk = r;
        }
      }
      mask = (mask & ~3) | (best > 0 ? 2 : best < 0 ? 1 : 0);
    }

    // Falling onto a spike: steer out of its column (a person steers in the air too).
    if (!grounded && obs.vy > 120) {
      for (const { box: d, vx, vy } of obs.dangers) {
        if (vx !== 0 || vy !== 0 || d.y < box.y) continue;
        const dx = box.x - d.x;
        if (Math.abs(dx) < (box.w + d.w) / 2 + 14) mask = (mask & ~3) | (dx >= 0 ? 2 : 1);
      }
    }

    // Coming along our height (or a spike in our way): jump it.
    let hop = false;
    for (const { box: d, vx } of obs.dangers) {
      const dx = d.x - box.x;
      const reach = (box.w + d.w) / 2;
      const level = bottom(d) > top(box) - 4 && top(d) < bottom(box) + 4;
      const closing = vx === 0 ? ((mask & 2) !== 0 && dx > 0) || ((mask & 1) !== 0 && dx < 0) : (vx > 0) === (dx < 0);
      if (level && closing && Math.abs(dx) < reach + 70 + Math.abs(vx) * 0.18) hop = true;
    }
    if (hop && grounded) mask |= 16;
    return mask;
  };
}

function wanderPolicy(seed: number, topDown: boolean): Policy {
  const next = rng(seed);
  let hold = 0;
  let mask = 0;
  return () => {
    if (hold-- <= 0) {
      hold = 12 + Math.floor(next() * 40);
      const r = next();
      mask = r < 0.4 ? 2 : r < 0.7 ? 1 : 0;
      if (topDown) mask |= next() < 0.5 ? (next() < 0.5 ? 4 : 8) : 0;
      else if (next() < 0.45) mask |= 16;
    }
    return mask;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------------------------------

function playerHealth(session: HeadlessSession2D, id: string): number | undefined {
  return session.store.getState().gameHealth[id];
}

function eventSignature(session: HeadlessSession2D, playerId: string): string {
  const s = session.store.getState();
  return `${s.gameScore}|${JSON.stringify(s.gameVars)}|${playerHealth(session, playerId) ?? ''}`;
}

function runOnce(spec: SceneSpec, strategy: BotStrategy, seed: number, maxSeconds: number): PlaytestRun {
  planWork = 0;
  return runHeadless2D(spec, (session) => {
    const topDown = spec.nodes2D.some((n) => n.physics2D === 'player-topdown');
    const policy: Policy =
      strategy === 'idle' ? () => 0 : strategy === 'wander' ? wanderPolicy(seed, topDown) : withDodge(goalPolicy(topDown, strategy === 'goal-early' ? 36 : 0));
    const frames = Math.ceil(maxSeconds / HEADLESS_DT);
    const tape: InputTape = [];
    const trace: TraceSample[] = [];
    const collectibles = spec.nodes2D.filter((n) => isLive(n) && n.physics2D === 'collectible').length;
    const playerNode = spec.nodes2D.find((n) => isLive(n) && isPlayerEntity(n));
    const playerId = playerNode?.id ?? '';
    const startSig = eventSignature(session, playerId);

    let previous: { x: number; y: number } | undefined;
    let setbacks = 0;
    let travelled = 0;
    let firstEvent: number | undefined;
    let stillFor = 0;
    let longestStill = 0;
    let stillAt: PlaytestRun['stillAt'];
    let frame = 0;
    for (; frame < frames; frame++) {
      const state = session.store.getState();
      if (state.gameEnded) break;
      const obs = observe(session);
      const mask = obs ? policy(obs, frame) : 0;
      maskToKeys(mask, session.keys);
      pushTape(tape, mask);
      session.step(HEADLESS_DT);

      const after = observe(session);
      const t = (frame + 1) * HEADLESS_DT;
      if (after) {
        const jumpedBack = previous ? Math.hypot(after.box.x - previous.x, after.box.y - previous.y) > 90 : false;
        if (previous) {
          const step = Math.hypot(after.box.x - previous.x, after.box.y - previous.y);
          if (jumpedBack) setbacks++;
          else travelled += step;
          if (step < 0.05 && !session.store.getState().gameEnded) {
            stillFor += HEADLESS_DT;
            if (stillFor > longestStill) {
              longestStill = stillFor;
              stillAt = { x: Math.round(after.box.x), y: Math.round(after.box.y), t: Number(t.toFixed(2)) };
            }
          } else stillFor = 0;
        }
        previous = { x: after.box.x, y: after.box.y };
        if (frame % 30 === 0) {
          const hp = playerHealth(session, playerId);
          trace.push({ t: Number(t.toFixed(2)), x: Math.round(after.box.x), y: Math.round(after.box.y), score: session.store.getState().gameScore, ...(hp !== undefined ? { health: hp } : {}) });
        }
      }
      if (firstEvent === undefined && eventSignature(session, playerId) !== startSig) firstEvent = Number(t.toFixed(2));
    }
    const final = session.store.getState();
    const target = spec.gameRules?.winCondition === 'score-threshold' || spec.gameRules?.winCondition === 'collect-all' ? spec.gameRules.targetScore : undefined;
    const collected = Object.values(session.bodies).filter((b) => b.collected).length;
    return {
      strategy,
      seed,
      won: final.gameWon,
      ended: final.gameEnded,
      stop: final.gameEnded ? (final.gameWon ? 'won' : 'lost') : 'budget',
      seconds: Number((Math.min(frame, frames) * HEADLESS_DT).toFixed(2)),
      score: final.gameScore,
      targetScore: target,
      collected,
      collectibles,
      setbacks,
      firstEventSeconds: firstEvent,
      longestStillSeconds: Number(longestStill.toFixed(2)),
      stillAt,
      travelled: Math.round(travelled),
      timeLeft: Number(final.gameTimeRemaining.toFixed(2)),
      trace: trace.slice(0, 160),
      tape,
    } satisfies PlaytestRun;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------------------------------------------------

export interface ReplayResult {
  won: boolean;
  ended: boolean;
  score: number;
  seconds: number;
}

/** Play a recorded tape back on the runtime. A winning tape that stops winning is a regression. */
export function replayTape(spec: SceneSpec, tape: InputTape): ReplayResult {
  return runHeadless2D(spec, (session) => {
    let frames = 0;
    for (const [count, mask] of tape) {
      maskToKeys(mask, session.keys);
      for (let i = 0; i < count; i++) {
        if (session.store.getState().gameEnded) break;
        session.step(HEADLESS_DT);
        frames++;
      }
    }
    const s = session.store.getState();
    return { won: s.gameWon, ended: s.gameEnded, score: s.gameScore, seconds: Number((frames * HEADLESS_DT).toFixed(2)) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------------------------------

const DEFAULT_STRATEGIES: BotStrategy[] = ['goal', 'goal-early', 'wander', 'wander', 'idle'];

function supportReason(spec: SceneSpec): string | undefined {
  if (spec.engineType !== '2d') return 'The playtest bot plays 2D games only.';
  if (spec.mode !== 'game') return 'The scene is media, not a game: there is nothing to win.';
  const live = spec.nodes2D.filter(isLive).length;
  if (live > MAX_PLAYTEST_NODES) return `The scene has ${live} nodes; the playtest bot plays scenes of at most ${MAX_PLAYTEST_NODES} (it plans a route across every platform).`;
  return undefined;
}

/** How far a run got, for picking "the one the report is about" when nothing won. */
function progressOf(run: PlaytestRun): number {
  const share = run.targetScore ? Math.min(1, run.score / run.targetScore) : run.collectibles ? run.collected / run.collectibles : 0;
  return share * 1000 + run.travelled / 100 - run.setbacks;
}

export function playtestScene(spec: SceneSpec, options: PlaytestOptions = {}): PlaytestReport {
  const reason = supportReason(spec);
  if (reason) return { supported: false, reason, outcome: 'unsupported', runs: [], issues: [] };
  if (!spec.nodes2D.some((n) => isLive(n) && isPlayerEntity(n))) {
    return {
      supported: true,
      outcome: 'not-won',
      runs: [],
      issues: [{ code: 'playtest.no-player', severity: 'error', message: 'There is no player node, so nobody can play this level.', evidence: {} }],
    };
  }

  const limit = spec.gameRules?.timeLimitSeconds || 60;
  const maxSeconds = options.maxSeconds ?? Math.min(120, limit + 2);
  const base = options.seed ?? 1;
  const strategies = options.strategies ?? DEFAULT_STRATEGIES;
  const runs: PlaytestRun[] = [];
  // All runs together may play at most TOTAL_FRAME_BUDGET frames (counted, so the result stays deterministic and a big scene cannot hold the process).
  let frameBudget = TOTAL_FRAME_BUDGET;
  strategies.forEach((strategy, i) => {
    // Once a goal bot has proven the level winnable, only the idle bot still adds information (does nothing win?).
    if (runs.some((r) => r.won && r.strategy !== 'idle') && strategy !== 'idle') return;
    if (frameBudget < 60) return;
    const run = runOnce(spec, strategy, base + i, Math.min(maxSeconds, frameBudget * HEADLESS_DT));
    frameBudget -= Math.round(run.seconds / HEADLESS_DT);
    runs.push(run);
  });

  const winner = runs.find((r) => r.won && r.strategy !== 'idle');
  const players = runs.filter((r) => r.strategy !== 'idle');
  const best = winner ?? [...players].sort((a, b) => progressOf(b) - progressOf(a))[0] ?? runs[0];
  const report: PlaytestReport = {
    supported: true,
    outcome: winner ? 'won' : 'not-won',
    best,
    runs,
    winningTape: winner?.tape,
    issues: [],
  };
  report.issues = playtestIssues(spec, report);
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------------------------------------------------

const SLOW_FIRST_EVENT_SECONDS = 8;
const TIGHT_TIME_SHARE = 0.1;
const STILL_SECONDS = 4;

export function playtestIssues(spec: SceneSpec, report: PlaytestReport): PlaytestIssue[] {
  const issues: PlaytestIssue[] = [];
  const best = report.best;
  if (!best) return issues;
  const survive = spec.gameRules?.winCondition === 'survive-timer' || spec.gameRules?.winCondition === 'survive-waves';
  const idle = report.runs.find((r) => r.strategy === 'idle');

  if (report.outcome === 'not-won') {
    issues.push({
      code: 'playtest.not-won',
      severity: 'warn',
      message: `No bot won this level (best: ${best.strategy}, ${best.collected}/${best.collectibles} collectibles${best.targetScore ? `, score ${best.score}/${best.targetScore}` : ''}, ${best.setbacks} setbacks, stopped: ${best.stop}). Check that the goal can be reached and that nothing blocks the route.`,
      evidence: { strategy: best.strategy, collected: best.collected, collectibles: best.collectibles, score: best.score, targetScore: best.targetScore ?? -1, setbacks: best.setbacks, seconds: best.seconds, stop: best.stop },
    });
  }
  if (idle?.won && !survive) {
    issues.push({
      code: 'playtest.wins-without-input',
      severity: 'warn',
      message: `A bot that never touches a control wins after ${idle.seconds}s, so the level plays itself. Make the goal need the player.`,
      evidence: { seconds: idle.seconds, score: idle.score },
    });
  }
  if (best.firstEventSeconds === undefined && best.stop !== 'won') {
    issues.push({
      code: 'playtest.nothing-happens',
      severity: 'warn',
      message: `In ${best.seconds}s of play the score, variables and health never changed: the player never reaches anything.`,
      evidence: { seconds: best.seconds, travelled: best.travelled },
    });
  } else if (best.firstEventSeconds !== undefined && best.firstEventSeconds > SLOW_FIRST_EVENT_SECONDS) {
    issues.push({
      code: 'playtest.slow-start',
      severity: 'warn',
      message: `The first reward or consequence comes after ${best.firstEventSeconds}s. Players leave quiet starts: put something to collect or dodge within ${SLOW_FIRST_EVENT_SECONDS}s.`,
      evidence: { firstEventSeconds: best.firstEventSeconds },
    });
  }
  if (best.travelled < 20 && best.seconds >= 2) {
    issues.push({
      code: 'playtest.player-immobile',
      severity: 'warn',
      message: `The player moved ${best.travelled}px in ${best.seconds}s while the bot held the controls: it is boxed in, or has no controls.`,
      evidence: { travelled: best.travelled, seconds: best.seconds },
    });
  } else if (report.outcome === 'not-won' && best.longestStillSeconds >= STILL_SECONDS && best.stillAt) {
    issues.push({
      code: 'playtest.stuck',
      severity: 'warn',
      message: `The player stood still for ${best.longestStillSeconds}s around (${best.stillAt.x}, ${best.stillAt.y}) at t=${best.stillAt.t}s: look for a wall, a gap that is too wide or a ledge that is too high there.`,
      evidence: { still: best.longestStillSeconds, x: best.stillAt.x, y: best.stillAt.y, t: best.stillAt.t },
    });
  }
  if (report.outcome === 'won' && best.timeLeft <= (spec.gameRules?.timeLimitSeconds || 60) * TIGHT_TIME_SHARE && !survive) {
    issues.push({
      code: 'playtest.time-tight',
      severity: 'info',
      message: `The bot won with only ${best.timeLeft}s left of ${spec.gameRules?.timeLimitSeconds || 60}s: a human will probably run out of time.`,
      evidence: { timeLeft: best.timeLeft, timeLimit: spec.gameRules?.timeLimitSeconds || 60 },
    });
  }
  if (report.outcome === 'won' && best.setbacks >= 4) {
    issues.push({
      code: 'playtest.punishing',
      severity: 'info',
      message: `Even the winning run was set back ${best.setbacks} times: the level may punish more than it teaches.`,
      evidence: { setbacks: best.setbacks },
    });
  }
  return issues;
}

/** The report as plain text for a model or a log: verdict first, then the numbers, then what to check. */
export function formatPlaytestReport(report: PlaytestReport): string {
  if (!report.supported || report.outcome === 'unsupported') return `Playtest skipped: ${report.reason ?? 'unsupported scene'}`;
  const lines: string[] = [];
  const best = report.best;
  if (!best) lines.push('Playtest could not start.');
  else if (report.outcome === 'won') lines.push(`Playtest: a bot WON (${best.strategy}) in ${best.seconds}s with ${best.timeLeft}s left, score ${best.score}${best.targetScore ? `/${best.targetScore}` : ''}, ${best.setbacks} setbacks. A tape that reproduces it is available.`);
  else lines.push(`Playtest: NO bot won. Best attempt (${best.strategy}): ${best.collected}/${best.collectibles} collectibles, score ${best.score}${best.targetScore ? `/${best.targetScore}` : ''}, ${best.setbacks} setbacks, stopped: ${best.stop}. This does not prove the level is unwinnable, only that these simple bots did not manage it.`);
  for (const issue of report.issues) lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
  if (!report.issues.length) lines.push('- no playtest issues');
  return lines.join('\n');
}
