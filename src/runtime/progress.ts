/**
 * Phase 8 — Saved progress for app builds (PWA / Android / iOS): best score per scene, cleared levels and the level
 * to resume. Pure and deterministic; the Player persists the JSON through Capacitor Preferences or localStorage.
 */

export interface SavedProgress {
  version: 1;
  /** Best score reached per scene id. */
  best: Record<string, number>;
  /** Scene ids won at least once. */
  cleared: string[];
  /** Scene the player should resume at (the next unfinished level). */
  resumeSceneId?: string;
}

export function emptyProgress(): SavedProgress {
  return { version: 1, best: {}, cleared: [] };
}

/** Parses stored JSON; anything malformed becomes an empty save (never throws). */
export function parseProgress(raw: string | null | undefined): SavedProgress {
  if (!raw) return emptyProgress();
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || v.version !== 1) return emptyProgress();
    const best: Record<string, number> = {};
    if (v.best && typeof v.best === 'object') {
      for (const [k, n] of Object.entries(v.best)) if (typeof n === 'number' && Number.isFinite(n)) best[String(k).slice(0, 120)] = n;
    }
    const cleared = Array.isArray(v.cleared) ? v.cleared.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [];
    const resumeSceneId = typeof v.resumeSceneId === 'string' ? v.resumeSceneId : undefined;
    return { version: 1, best, cleared, ...(resumeSceneId ? { resumeSceneId } : {}) };
  } catch {
    return emptyProgress();
  }
}

export interface RoundResult {
  sceneId: string;
  score: number;
  won: boolean;
  /** Next level after a win (sequence.nextSceneId), if any. */
  nextSceneId?: string | null;
}

/** Records a finished round. Returns the new save and whether the score is a new best. */
export function recordRound(prev: SavedProgress, round: RoundResult): { progress: SavedProgress; newBest: boolean } {
  const oldBest = prev.best[round.sceneId];
  const newBest = oldBest === undefined ? round.score > 0 : round.score > oldBest;
  const best = { ...prev.best, [round.sceneId]: Math.max(oldBest ?? 0, round.score) };
  const cleared = round.won && !prev.cleared.includes(round.sceneId) ? [...prev.cleared, round.sceneId] : prev.cleared;
  const resumeSceneId = round.won ? round.nextSceneId || round.sceneId : prev.resumeSceneId || round.sceneId;
  return { progress: { version: 1, best, cleared, resumeSceneId }, newBest };
}

/** Scene to start at: the saved resume level if it still exists, else the export's start scene. */
export function resumeSceneFor(progress: SavedProgress, sceneIds: string[], fallback: string): string {
  return progress.resumeSceneId && sceneIds.includes(progress.resumeSceneId) ? progress.resumeSceneId : fallback;
}

/** Storage key for a game's save (app id based, so two apps never share a save). */
export function progressKey(saveKey: string): string {
  return `omnistage.progress.${saveKey.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)}`;
}
