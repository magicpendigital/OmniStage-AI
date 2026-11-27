/**
 * Phase 7B — waves: a declarative, deterministic schedule of spawns (`SceneSpec.waves`). Each wave is a few spawn groups (a prefab, how many,
 * how fast); waves run one after another — a short pause, the spawns, then the wave ends after its `durationSeconds` (and, with
 * `untilCleared`, once none of its clones is left). `winCondition: 'survive-waves'` is won when the last wave has ended.
 *
 * Pure: the host (entities2d.ts) feeds `stepWaves` the frame time and how many clones are alive, and spawns what it returns. The
 * progress lives in the runtime store (`gameWave`), so a restart / retry / next level starts from wave 1 again.
 */
import type { SceneSpec, WaveSpec } from '../../types/scene.schema';
import { hash01 } from './hash';

export const MAX_WAVES = 20;
export const MAX_WAVE_GROUPS = 6;
export const MAX_WAVE_COUNT = 30;
export const DEFAULT_WAVE_DELAY = 2;
export const DEFAULT_WAVE_EVERY = 1;
/** After its last spawn a wave lasts at least this long, so the player meets what was just spawned. */
export const WAVE_TAIL_SECONDS = 2;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface ResolvedWaveGroup {
  prefabId: string;
  count: number;
  everySeconds: number;
  x?: number;
  y?: number;
  jitterX: number;
  jitterY: number;
}

export interface ResolvedWave {
  name: string;
  groups: ResolvedWaveGroup[];
  delaySeconds: number;
  /** Seconds from the wave's first spawn until it may end. */
  durationSeconds: number;
  untilCleared: boolean;
}

/** The scene's usable waves (bad groups dropped, numbers clamped; the verifier reports what was wrong). */
export function resolveWaves(spec: Pick<SceneSpec, 'waves'>): ResolvedWave[] {
  const out: ResolvedWave[] = [];
  for (const w of Array.isArray(spec.waves) ? spec.waves : []) {
    if (!w || !Array.isArray(w.spawns)) continue;
    const groups: ResolvedWaveGroup[] = [];
    for (const g of w.spawns) {
      if (!g || typeof g.prefabId !== 'string' || !g.prefabId || !finite(g.count) || g.count < 1) continue;
      groups.push({
        prefabId: g.prefabId,
        count: Math.min(MAX_WAVE_COUNT, Math.floor(g.count)),
        everySeconds: finite(g.everySeconds) && g.everySeconds > 0 ? Math.max(0.05, g.everySeconds) : DEFAULT_WAVE_EVERY,
        ...(finite(g.x) ? { x: g.x } : {}),
        ...(finite(g.y) ? { y: g.y } : {}),
        jitterX: finite(g.jitterX) ? Math.max(0, g.jitterX) : 0,
        jitterY: finite(g.jitterY) ? Math.max(0, g.jitterY) : 0,
      });
      if (groups.length >= MAX_WAVE_GROUPS) break;
    }
    if (!groups.length) continue;
    const lastSpawn = Math.max(...groups.map((g) => (g.count - 1) * g.everySeconds));
    out.push({
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 40) : `Wave ${out.length + 1}`,
      groups,
      delaySeconds: finite(w.delaySeconds) && w.delaySeconds >= 0 ? Math.min(60, w.delaySeconds) : DEFAULT_WAVE_DELAY,
      durationSeconds: Math.max(lastSpawn + WAVE_TAIL_SECONDS, finite(w.durationSeconds) && w.durationSeconds > 0 ? Math.min(300, w.durationSeconds) : 0),
      untilCleared: w.untilCleared === true,
    });
    if (out.length >= MAX_WAVES) break;
  }
  return out;
}

/** Seconds from the start of the round until the last wave can end (cleared waves may take longer). */
export function wavesMinSeconds(waves: readonly ResolvedWave[]): number {
  return waves.reduce((sum, w) => sum + w.delaySeconds + w.durationSeconds, 0);
}

export interface WaveProgress {
  /** The wave running or about to run (0-based); `waves.length` once they are all over. */
  index: number;
  phase: 'delay' | 'active' | 'done';
  /** Seconds in the current phase. */
  t: number;
  /** Spawns done so far per group of the current wave. */
  spawned: number[];
}

export const freshWaveProgress = (): WaveProgress => ({ index: 0, phase: 'delay', t: 0, spawned: [] });

export interface WaveSpawn {
  /** Index of the spawn group in its wave (the host gives a spawn back when the scene has no room for it). */
  group: number;
  prefabId: string;
  /** Group position when authored; the host falls back to the prefab's own position. */
  x?: number;
  y?: number;
  /** Deterministic offsets already scaled by the group's jitter. */
  dx: number;
  dy: number;
}

export interface WaveStep {
  next: WaveProgress;
  spawns: WaveSpawn[];
  /** The last wave ended during this step. */
  finished: boolean;
}

/**
 * Advances the schedule by `dt`. `alive(prefabId)` is how many clones of that prefab exist now (for `untilCleared`). Never mutates `p`.
 */
export function stepWaves(waves: readonly ResolvedWave[], p: WaveProgress, dt: number, alive: (prefabId: string) => number): WaveStep {
  if (!waves.length || p.phase === 'done' || p.index >= waves.length || !(dt >= 0)) {
    return { next: waves.length && p.index >= waves.length ? { ...p, phase: 'done' } : p, spawns: [], finished: false };
  }
  const w = waves[p.index];
  let next: WaveProgress = { ...p, spawned: [...p.spawned], t: p.t + dt };
  const spawns: WaveSpawn[] = [];
  if (next.phase === 'delay') {
    if (next.t < w.delaySeconds) return { next, spawns, finished: false };
    next = { index: p.index, phase: 'active', t: next.t - w.delaySeconds, spawned: w.groups.map(() => 0) };
  }
  w.groups.forEach((g, gi) => {
    let n = next.spawned[gi] ?? 0;
    while (n < g.count && next.t >= n * g.everySeconds - 1e-9) {
      const seed = `${g.prefabId}@${p.index}.${gi}`;
      spawns.push({
        group: gi,
        prefabId: g.prefabId,
        ...(g.x !== undefined ? { x: g.x } : {}),
        ...(g.y !== undefined ? { y: g.y } : {}),
        dx: g.jitterX ? (hash01(seed, n * 2) * 2 - 1) * g.jitterX : 0,
        dy: g.jitterY ? (hash01(seed, n * 2 + 1) * 2 - 1) * g.jitterY : 0,
      });
      n += 1;
    }
    next.spawned[gi] = n;
  });
  const allOut = w.groups.every((g, gi) => (next.spawned[gi] ?? 0) >= g.count);
  const cleared = !w.untilCleared || w.groups.every((g) => alive(g.prefabId) === 0);
  if (allOut && next.t >= w.durationSeconds && cleared) {
    const index = p.index + 1;
    if (index >= waves.length) return { next: { index, phase: 'done', t: 0, spawned: [] }, spawns, finished: true };
    return { next: { index, phase: 'delay', t: 0, spawned: [] }, spawns, finished: false };
  }
  return { next, spawns, finished: false };
}

/** Public view of the progress for the HUD. */
export function waveStatus(spec: Pick<SceneSpec, 'waves'>, p: WaveProgress | undefined): { current: number; total: number; done: boolean; name: string } | null {
  const waves = resolveWaves(spec);
  if (!waves.length) return null;
  const progress = p ?? freshWaveProgress();
  const done = progress.phase === 'done' || progress.index >= waves.length;
  return { current: done ? waves.length : progress.index + 1, total: waves.length, done, name: waves[Math.min(progress.index, waves.length - 1)].name };
}


/** What is wrong with the authored waves (empty = fine). Mirrors what `resolveWaves` silently drops, so the verifier can say it. */
export function waveProblems(spec: Pick<SceneSpec, 'waves'>): string[] {
  const out: string[] = [];
  const waves = spec.waves;
  if (waves === undefined) return out;
  if (!Array.isArray(waves)) return ['waves must be a list'];
  if (waves.length > MAX_WAVES) out.push(`at most ${MAX_WAVES} waves`);
  waves.forEach((w, i) => {
    const at = `wave ${i + 1}`;
    if (!w || !Array.isArray(w.spawns) || !w.spawns.length) return void out.push(`${at} has no spawns`);
    if (w.spawns.length > MAX_WAVE_GROUPS) out.push(`${at}: at most ${MAX_WAVE_GROUPS} spawn groups`);
    for (const g of w.spawns) {
      if (!g || typeof g.prefabId !== 'string' || !g.prefabId) out.push(`${at}: a spawn group has no prefabId`);
      else if (!finite(g.count) || g.count < 1 || g.count > MAX_WAVE_COUNT || !Number.isInteger(g.count)) out.push(`${at}: "${g.prefabId}" count must be a whole number 1-${MAX_WAVE_COUNT}`);
      else if (g.everySeconds !== undefined && (!finite(g.everySeconds) || g.everySeconds < 0.05)) out.push(`${at}: "${g.prefabId}" everySeconds must be >= 0.05`);
    }
    if (w.delaySeconds !== undefined && (!finite(w.delaySeconds) || w.delaySeconds < 0 || w.delaySeconds > 60)) out.push(`${at}: delaySeconds must be 0-60`);
    if (w.durationSeconds !== undefined && (!finite(w.durationSeconds) || w.durationSeconds <= 0 || w.durationSeconds > 300)) out.push(`${at}: durationSeconds must be 1-300`);
  });
  return out;
}

/** Deterministic repair of `waveProblems` (mutates `spec`): bad groups / waves are dropped, numbers clamped. Returns true when something changed. */
export function repairWaves(spec: Pick<SceneSpec, 'waves'>): boolean {
  if (spec.waves === undefined) return false;
  const before = JSON.stringify(spec.waves);
  const list = Array.isArray(spec.waves) ? spec.waves : [];
  const next: WaveSpec[] = [];
  for (const w of list) {
    if (!w || !Array.isArray(w.spawns)) continue;
    const spawns = w.spawns
      .filter((g) => g && typeof g.prefabId === 'string' && g.prefabId && finite(g.count) && g.count >= 1)
      .slice(0, MAX_WAVE_GROUPS)
      .map((g) => ({
        ...g,
        count: Math.min(MAX_WAVE_COUNT, Math.floor(g.count)),
        ...(g.everySeconds !== undefined ? { everySeconds: finite(g.everySeconds) ? Math.max(0.05, g.everySeconds) : DEFAULT_WAVE_EVERY } : {}),
      }));
    if (!spawns.length) continue;
    const fixed: WaveSpec = { ...w, spawns };
    if (fixed.delaySeconds !== undefined) fixed.delaySeconds = finite(fixed.delaySeconds) ? Math.min(60, Math.max(0, fixed.delaySeconds)) : DEFAULT_WAVE_DELAY;
    if (fixed.durationSeconds !== undefined) {
      if (finite(fixed.durationSeconds) && fixed.durationSeconds > 0) fixed.durationSeconds = Math.min(300, fixed.durationSeconds);
      else delete fixed.durationSeconds;
    }
    next.push(fixed);
    if (next.length >= MAX_WAVES) break;
  }
  if (next.length) spec.waves = next;
  else delete spec.waves;
  return JSON.stringify(spec.waves) !== before;
}
