/**
 * Phase 3 — game state, pure helpers shared by the studio, the OmniStage Player and the verifier:
 * variables, health, the declarative HUD model and the deterministic spawn / projectile maths.
 * No React, no store, no DOM: everything here is a function of its arguments.
 */
import type { ActorNode, GameVariable, HealthSpec, HudAnchor, HudElement, Node2D, Projectile2D, SceneSpec, Spawner2D } from '../../types/scene.schema';
import { hash01 } from './hash';
import type { GameMessage } from './messages';
import { freshWaveProgress, resolveWaves, type WaveProgress, waveStatus } from './waves';

export const VARIABLE_ID = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
export const MAX_VARIABLES = 32;
export const MAX_HUD = 12;
export const MAX_SPAWNED = 64;
export const HUD_ANCHORS: readonly HudAnchor[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const HUD_SOURCES = ['score', 'time', 'variable', 'health', 'wave'] as const;
export const HUD_KINDS = ['counter', 'bar', 'text'] as const;
export const COMPARE_OPS = ['>=', '>', '<=', '<', '==', '!='] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

export const DEFAULT_INVULNERABLE_SECONDS = 0.6;
export const DEFAULT_PROJECTILE_LIFETIME = 3;
export const DEFAULT_SPAWNER_MAX = 5;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/** The scene's usable variable declarations (bad ids / duplicates dropped; the verifier reports them). */
export function resolveVariables(spec: Pick<SceneSpec, 'variables'>): GameVariable[] {
  const seen = new Set<string>();
  const out: GameVariable[] = [];
  for (const v of spec.variables || []) {
    if (!v || typeof v.id !== 'string' || !VARIABLE_ID.test(v.id) || seen.has(v.id) || !finite(v.initial)) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= MAX_VARIABLES) break;
  }
  return out;
}

export function clampVariable(decl: Pick<GameVariable, 'min' | 'max'>, value: number): number {
  let v = value;
  if (finite(decl.min)) v = Math.max(decl.min, v);
  if (finite(decl.max)) v = Math.min(decl.max, v);
  return v;
}

export function initialVariables(spec: Pick<SceneSpec, 'variables'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of resolveVariables(spec)) out[v.id] = clampVariable(v, v.initial);
  return out;
}

export function compareNumbers(op: string, a: number, b: number): boolean {
  switch (op) {
    case '>=': return a >= b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '<': return a < b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: throw new Error(`Unsupported comparison: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

type HealthHost = Pick<Node2D, 'id'> & { health?: HealthSpec };

export function healthMax(entity: { health?: HealthSpec } | undefined): number | undefined {
  const max = entity?.health?.max;
  return finite(max) && max > 0 ? max : undefined;
}

/** Starting hit points of every entity that has `health`. */
export function initialHealth(spec: Pick<SceneSpec, 'nodes2D' | 'actors'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of [...spec.nodes2D, ...spec.actors] as HealthHost[]) {
    const max = healthMax(e);
    if (max !== undefined) out[e.id] = max;
  }
  return out;
}

export function invulnerableFor(entity: { health?: HealthSpec } | undefined): number {
  const s = entity?.health?.invulnerableSeconds;
  return finite(s) && s >= 0 ? s : DEFAULT_INVULNERABLE_SECONDS;
}

/** A hit right now is ignored while the immunity window after the last hit is still open. */
export function isInvulnerable(lastHurt: number | undefined, now: number, window: number): boolean {
  return lastHurt !== undefined && now >= lastHurt && now - lastHurt < window;
}

export const isPlayerEntity = (e: Node2D | ActorNode): boolean => ('physics2D' in e ? e.physics2D.startsWith('player-') : e.physicsRole === 'player');

/** Phase 3 session state of a scene, rebuilt whenever a session starts (scene switch, retry, next level). */
export interface GameSessionState {
  gameVars: Record<string, number>;
  gameHealth: Record<string, number>;
  /** Scene time of the last hit per entity (immunity window). */
  gameHurtAt: Record<string, number>;
  /** Counts runtime spawns, so every clone gets a unique, replayable id. */
  gameSpawnSerial: number;
  /** Phase 7B: where the wave schedule is. */
  gameWave: WaveProgress;
  /** Phase 7D: the message box on screen (null = none). */
  gameMessage: GameMessage | null;
  /** Phase 7D: the player paused the round (Player pause menu). */
  gamePaused: boolean;
}

export function freshGameState(spec: SceneSpec): GameSessionState {
  return { gameVars: initialVariables(spec), gameHealth: initialHealth(spec), gameHurtAt: {}, gameSpawnSerial: 0, gameWave: freshWaveProgress(), gameMessage: null, gamePaused: false };
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export interface HudSnapshot {
  score: number;
  timeRemaining: number;
  variables: Record<string, number>;
  health: Record<string, number>;
  /** Phase 7B. */
  wave?: WaveProgress;
}

export interface HudItem {
  id: string;
  kind: HudElement['kind'];
  anchor: HudAnchor;
  label: string;
  /** Text shown for counters and text elements. */
  text: string;
  /** 0..1 fill for bars (counters get a fraction too when a max is known). */
  fraction: number;
  color: string;
}

const HUD_COLORS: Record<HudElement['source'], string> = { score: '#fbbf24', time: '#38bdf8', variable: '#a78bfa', health: '#f87171', wave: '#fb923c' };

function playerOf(spec: Pick<SceneSpec, 'nodes2D' | 'actors'>): { id: string; health?: HealthSpec } | undefined {
  return spec.nodes2D.find((n) => n.physics2D.startsWith('player-')) ?? spec.actors.find((a) => a.physicsRole === 'player');
}

/** One HUD element -> what to draw (null when its source does not exist, so a stale binding draws nothing). */
export function resolveHudElement(el: HudElement, spec: SceneSpec, snap: HudSnapshot): HudItem | null {
  const color = el.color || HUD_COLORS[el.source] || '#e2e8f0';
  const base = { id: el.id, kind: el.kind, anchor: el.anchor, color };
  const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  switch (el.source) {
    case 'score': {
      const max = finite(el.max) && el.max > 0 ? el.max : spec.gameRules?.targetScore || 0;
      return { ...base, label: el.label ?? 'Score', text: max > 0 ? `${snap.score}/${max}` : String(snap.score), fraction: max > 0 ? clamp01(snap.score / max) : 0 };
    }
    case 'time': {
      const total = spec.gameRules?.timeLimitSeconds || 0;
      const left = Math.max(0, snap.timeRemaining);
      return { ...base, label: el.label ?? 'Time', text: `${Math.ceil(left)}s`, fraction: total > 0 ? clamp01(left / total) : 0 };
    }
    case 'variable': {
      const decl = resolveVariables(spec).find((v) => v.id === el.variableId);
      if (!decl) return null;
      const value = snap.variables[decl.id] ?? decl.initial;
      const max = finite(el.max) && el.max > 0 ? el.max : finite(decl.max) && decl.max > 0 ? decl.max : 0;
      return { ...base, label: el.label ?? decl.label ?? decl.id, text: round(value), fraction: max > 0 ? clamp01(value / max) : 0 };
    }
    case 'health': {
      const entity = el.actorId ? [...spec.nodes2D, ...spec.actors].find((e) => e.id === el.actorId) : playerOf(spec);
      const max = healthMax(entity);
      if (!entity || max === undefined) return null;
      const hp = snap.health[entity.id] ?? max;
      return { ...base, label: el.label ?? 'HP', text: `${Math.ceil(hp)}/${max}`, fraction: clamp01(hp / max) };
    }
    case 'wave': {
      const status = waveStatus(spec, snap.wave);
      if (!status || resolveWaves(spec).length === 0) return null;
      return { ...base, label: el.label ?? 'Wave', text: `${status.current}/${status.total}`, fraction: clamp01((status.done ? status.total : status.current - 1) / status.total) };
    }
    default:
      return null;
  }
}

export function resolveHud(spec: SceneSpec, snap: HudSnapshot): HudItem[] {
  const out: HudItem[] = [];
  for (const el of (spec.hud || []).slice(0, MAX_HUD)) {
    if (!el || !HUD_ANCHORS.includes(el.anchor)) continue;
    const item = resolveHudElement(el, spec, snap);
    if (item) out.push(item);
  }
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

// ---------------------------------------------------------------------------
// Spawning and projectiles (2D)
// ---------------------------------------------------------------------------

export { hash01 } from './hash';

export function spawnedId(prefabId: string, serial: number): string {
  return `${prefabId}#${serial}`;
}

/** Runtime clones are never part of the authored scene. */
export const isSpawnedId = (id: string): boolean => id.includes('#');

export interface SpawnerClock {
  /** Seconds since the last spawn (or since the start, minus the start delay). */
  t: number;
  /** Spawns so far (also the jitter index). */
  n: number;
}

export interface SpawnRequest {
  prefabId: string;
  x: number;
  y: number;
}

/** Advance one spawner by `dt`. Returns where to spawn when it is due; `alive` is how many of its clones still exist. */
export function stepSpawner(owner: Pick<Node2D, 'id' | 'x' | 'y'>, spec: Spawner2D, clock: SpawnerClock, dt: number, alive: number): SpawnRequest | undefined {
  const every = finite(spec.everySeconds) && spec.everySeconds > 0 ? Math.max(0.05, spec.everySeconds) : undefined;
  if (every === undefined) return undefined;
  const start = finite(spec.startDelay) && spec.startDelay >= 0 ? spec.startDelay : every;
  clock.t += dt;
  const due = clock.n === 0 ? start : every;
  if (clock.t < due) return undefined;
  clock.t = 0;
  const max = finite(spec.max) && spec.max > 0 ? Math.min(MAX_SPAWNED, spec.max) : DEFAULT_SPAWNER_MAX;
  if (alive >= max) return undefined;
  const jx = finite(spec.jitterX) ? (hash01(owner.id, clock.n * 2) * 2 - 1) * spec.jitterX : 0;
  const jy = finite(spec.jitterY) ? (hash01(owner.id, clock.n * 2 + 1) * 2 - 1) * spec.jitterY : 0;
  clock.n += 1;
  return { prefabId: spec.prefabId, x: owner.x + (spec.offsetX ?? 0) + jx, y: owner.y + (spec.offsetY ?? 0) + jy };
}

export interface ProjectileClock {
  age: number;
  /** Vertical speed, changed by gravity. */
  vy: number;
}

export function projectileLifetime(spec: Projectile2D): number {
  return finite(spec.lifetimeSeconds) && spec.lifetimeSeconds > 0 ? spec.lifetimeSeconds : DEFAULT_PROJECTILE_LIFETIME;
}

/** Move a projectile by `dt` (semi-implicit Euler, so it is exact for the frame-stepped exports). */
export function stepProjectile(spec: Projectile2D, clock: ProjectileClock, x: number, y: number, dt: number): { x: number; y: number; expired: boolean } {
  clock.age += dt;
  clock.vy += (finite(spec.gravity) ? spec.gravity : 0) * dt;
  return { x: x + (finite(spec.vx) ? spec.vx : 0) * dt, y: y + (finite(spec.vy) ? spec.vy : 0) * dt + clock.vy * dt, expired: clock.age >= projectileLifetime(spec) };
}

/** A copy of a prefab ready to put in the scene. */
export function cloneForSpawn(prefab: Node2D, id: string, x: number, y: number): Node2D {
  const clone: Node2D = JSON.parse(JSON.stringify(prefab));
  clone.id = id;
  clone.x = x;
  clone.y = y;
  clone.visible = true;
  clone.locked = true;
  delete clone.prefab;
  delete clone.spawner;
  return clone;
}
