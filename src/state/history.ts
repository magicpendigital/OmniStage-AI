/**
 * Undo history helper shared by the store slices.
 *
 * Every authoring action pushes the previous SceneSpec onto `pastSpecs`. Continuous edits (typing in a number
 * field, dragging a slider or a gizmo, moving a 2D node) fire many actions in a row: without coalescing a single
 * drag would use up the whole history. Pass a `coalesceKey` (what is being edited) and repeated pushes with the same
 * key inside COALESCE_WINDOW_MS keep only the snapshot taken before the first one, so one drag = one undo step.
 * Actions without a key always push, exactly as before.
 */
import { cloneSceneSpec } from '../registry/assetRegistry';
import type { SceneSpec } from '../types/scene.schema';

/** Max undo steps kept per scene. */
export const HISTORY_CAP = 50;
/** Edits to the same target closer together than this belong to one undo step. */
export const COALESCE_WINDOW_MS = 700;

let lastKey: string | null = null;
let lastAt = 0;

/** Forget the running burst (call on undo, redo and scene switches so the next edit always starts a new step). */
export function resetHistoryBurst(): void {
  lastKey = null;
  lastAt = 0;
}

/** New `pastSpecs` after an edit to `current`. See the file header for `coalesceKey`. */
export function pushPast(
  past: SceneSpec[],
  current: SceneSpec,
  coalesceKey?: string,
  now: number = Date.now()
): SceneSpec[] {
  if (coalesceKey) {
    const sameBurst = lastKey === coalesceKey && now - lastAt < COALESCE_WINDOW_MS && past.length > 0;
    lastKey = coalesceKey;
    lastAt = now;
    if (sameBurst) return past;
  } else {
    resetHistoryBurst();
  }
  return [...past.slice(-(HISTORY_CAP - 1)), cloneSceneSpec(current)];
}

/** Stable coalesce key for a partial update: the target plus the property names it touches. */
export function editKey(scope: string, patch: object): string {
  return `${scope}:${Object.keys(patch).sort().join(',')}`;
}
