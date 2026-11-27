/**
 * Phase 6B — editing the timeline. The lanes are derived (timelineLanes.ts); this is the other direction: a drag / resize / nudge of a
 * clip becomes a write to the SceneSpec field the clip came from (shot start / end, performance step time / duration, caption window,
 * dialogue line time, sound cue time, VFX window). Pure and deterministic, so the studio store, the tests and agents share it.
 */
import type { SceneSpec } from '../types/scene.schema';
import { shotWindows } from './cinematics';
import type { ClipSource, TimelineClip, TimelineLane } from './timelineLanes';

export const MIN_CLIP_SECONDS = 0.2;
/** Where a dragged edge lands when nothing else is close. */
export const GRID_SECONDS = 0.1;
/** How close (in seconds, at the current zoom) an edge has to be to a target to jump onto it. */
export const SNAP_SECONDS = 0.15;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const sceneDuration = (spec: Pick<SceneSpec, 'durationSeconds'>) => Math.max(2, spec.durationSeconds || 8);

export type DragMode = 'move' | 'start' | 'end';
export interface ClipWindow {
  start: number;
  end: number;
}

/** A stable id for a clip's source (history coalescing: one drag = one undo step). */
export function clipSourceId(source: ClipSource): string {
  switch (source.kind) {
    case 'shot':
    case 'caption':
    case 'cue':
      return `${source.kind}-${source.index}`;
    case 'step':
      return `step-${source.actorId}-${source.index}`;
    case 'dialogue':
      return `dialogue-${source.lineId}`;
    case 'vfx':
      return `vfx-${source.id}`;
  }
}

/** The times other clips, the playhead and the scene edges offer as snap points (the dragged clip's own edges are left out). */
export function snapTargets(lanes: TimelineLane[], exceptClipId: string | null, playhead: number, duration: number): number[] {
  const out = new Set<number>([0, round3(duration)]);
  if (finite(playhead)) out.add(round3(playhead));
  for (const lane of lanes) {
    if (lane.kind === 'music' || lane.kind === 'ambience' || lane.kind === 'look') continue;
    for (const clip of lane.clips) {
      if (clip.id === exceptClipId) continue;
      out.add(round3(clip.start));
      out.add(round3(clip.end));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Where an edge may land: other clips' edges, the playhead and the scene ends (`targets`) when closer than `threshold`, else the grid. */
export interface SnapConfig {
  targets: readonly number[];
  threshold: number;
  grid?: number;
}

/** The nearest snap target within the threshold, or null. */
function snapHit(t: number, cfg: SnapConfig): number | null {
  let best: number | null = null;
  let bestD = cfg.threshold;
  for (const target of cfg.targets) {
    const d = Math.abs(target - t);
    if (d <= bestD) {
      best = target;
      bestD = d;
    }
  }
  return best;
}

/** `t` jumps onto the nearest target within `threshold`, else onto the grid (grid 0 = free). */
export function snapTime(t: number, targets: readonly number[], threshold = SNAP_SECONDS, grid = GRID_SECONDS): number {
  return snapHit(t, { targets, threshold }) ?? (grid > 0 ? round3(Math.round(t / grid) * grid) : t);
}

const place = (t: number, cfg?: SnapConfig) => (cfg ? snapHit(t, cfg) ?? (cfg.grid ? round3(Math.round(t / cfg.grid) * cfg.grid) : t) : t);

/**
 * The window a drag produces. `orig` is the window when the drag began and `delta` the pointer distance in seconds, so repeated calls
 * during one drag are idempotent. A move keeps the clip's length (and snaps whichever of its two edges is closer to a target); an edge
 * pull keeps the other edge and at least MIN_CLIP_SECONDS of length. Everything stays inside [0, duration].
 */
export function dragWindow(
  orig: ClipWindow,
  mode: DragMode,
  delta: number,
  duration: number,
  snap?: SnapConfig
): ClipWindow {
  if (!finite(delta)) delta = 0;
  if (!finite(duration) || duration <= 0) duration = Math.max(orig.end, MIN_CLIP_SECONDS);
  const len = Math.max(MIN_CLIP_SECONDS, orig.end - orig.start);
  if (mode === 'move') {
    const raw = orig.start + delta;
    // Whichever edge (its start or its end) is nearer to a snap point sticks to it; with nothing near, the start goes to the grid.
    const a = snap ? snapHit(raw, snap) : null;
    const b = snap ? snapHit(raw + len, snap) : null;
    let start: number;
    if (a !== null && (b === null || Math.abs(a - raw) <= Math.abs(b - len - raw))) start = a;
    else if (b !== null) start = b - len;
    else start = place(raw, snap);
    start = Math.min(Math.max(0, start), Math.max(0, duration - len));
    return { start: round3(start), end: round3(start + len) };
  }
  if (mode === 'start') {
    const start = Math.min(Math.max(0, place(orig.start + delta, snap)), orig.end - MIN_CLIP_SECONDS);
    return { start: round3(start), end: round3(orig.end) };
  }
  const end = Math.max(Math.min(duration, place(orig.end + delta, snap)), orig.start + MIN_CLIP_SECONDS);
  return { start: round3(orig.start), end: round3(end) };
}

/**
 * Writes a clip's new window into `spec` (mutates it — the store passes a clone). Returns true when something changed. A clip can only
 * write what it owns: a performance step moves (`time`) and a walking step also resizes (`duration`, only when its END was pulled: a
 * plain move never turns an implicit walk length — "until the next step" — into a fixed one); a dialogue caption moves its line;
 * a sound cue moves; a shot whose `end` was implicit ("until the next shot") keeps it implicit unless its end really moved.
 * `mode` is the gesture that produced `win` (default: a move). Non-finite windows are refused.
 */
export function applyClipEdit(spec: SceneSpec, source: ClipSource, win: ClipWindow, mode: DragMode = 'move'): boolean {
  if (!finite(win.start) || !finite(win.end)) return false;
  // Never write past the real scene length (the lanes show at least 2 s, the runtime filters on the real duration).
  const cap = Math.max(MIN_CLIP_SECONDS, finite(spec.durationSeconds) && spec.durationSeconds > 0 ? spec.durationSeconds : sceneDuration(spec));
  const clamp = (t: number, lo: number, hi: number) => round3(Math.min(hi, Math.max(lo, t)));
  const start = clamp(win.start, 0, cap - MIN_CLIP_SECONDS);
  const end = clamp(win.end, start + MIN_CLIP_SECONDS, cap);
  switch (source.kind) {
    case 'shot': {
      const shot = spec.camera.shots?.[source.index];
      if (!shot) return false;
      const before = [shot.start, shot.end];
      const derivedEnd = shotWindows({ ...spec, durationSeconds: cap }).find((w) => w.shot === shot)?.end;
      shot.start = start;
      if (shot.end !== undefined || mode !== 'start' || derivedEnd === undefined || Math.abs(derivedEnd - end) > 1e-6) shot.end = end;
      return before[0] !== shot.start || before[1] !== shot.end;
    }
    case 'step': {
      const step = spec.actors.find((a) => a.id === source.actorId)?.performance?.[source.index];
      if (!step) return false;
      const before = [step.time, step.duration];
      step.time = start;
      if (step.moveTo && mode === 'end') step.duration = round3(Math.max(MIN_CLIP_SECONDS, end - start));
      return before[0] !== step.time || before[1] !== step.duration;
    }
    case 'caption': {
      const cue = spec.captions?.[source.index];
      if (!cue) return false;
      const before = [cue.start, cue.end];
      cue.start = start;
      cue.end = end;
      return before[0] !== cue.start || before[1] !== cue.end;
    }
    case 'dialogue': {
      const line = spec.dialogue?.find((l) => l.id === source.lineId);
      if (!line) return false;
      const before = line.time;
      line.time = start;
      return before !== line.time;
    }
    case 'cue': {
      const cue = spec.soundtrack?.cues?.[source.index];
      if (!cue) return false;
      const before = cue.time;
      cue.time = start;
      return before !== cue.time;
    }
    case 'vfx': {
      const vfx = spec.vfx.find((v) => v.id === source.id);
      if (!vfx) return false;
      const before = [vfx.startTime, vfx.endTime];
      vfx.startTime = start;
      vfx.endTime = end;
      return before[0] !== vfx.startTime || before[1] !== vfx.endTime;
    }
  }
}

/** The window a keyboard nudge produces (arrow keys: 0.1 s, Shift 1 s) for a clip, honouring what it allows. */
export function nudgeWindow(clip: Pick<TimelineClip, 'start' | 'end'>, seconds: number, duration: number): ClipWindow {
  return dragWindow({ start: clip.start, end: clip.end }, 'move', seconds, duration);
}
