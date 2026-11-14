/**
 * Phase 6 batch 2 — order of scenes for "Preview all" and "Play Test": the active scene's storyboard (by
 * sequence.index / nextSceneId), otherwise every scene in project order.
 */
import type { SceneSpec } from '../types/scene.schema';

export function previewOrder(scenes: SceneSpec[], activeSceneId: string): string[] {
  const active = scenes.find((s) => s.id === activeSceneId);
  const storyboardId = active?.sequence?.storyboardId;
  if (!storyboardId) return scenes.map((s) => s.id);
  const board = scenes.filter((s) => s.sequence?.storyboardId === storyboardId);
  // Follow nextSceneId links from the first scene when they form a chain; else sort by index.
  const byId = new Map(board.map((s) => [s.id, s]));
  const first = [...board].sort((a, b) => (a.sequence!.index ?? 0) - (b.sequence!.index ?? 0))[0];
  const chain: string[] = [];
  let cur: SceneSpec | undefined = first;
  while (cur && !chain.includes(cur.id)) {
    chain.push(cur.id);
    cur = cur.sequence?.nextSceneId ? byId.get(cur.sequence.nextSceneId) : undefined;
  }
  if (chain.length === board.length) return chain;
  return [...board].sort((a, b) => (a.sequence!.index ?? 0) - (b.sequence!.index ?? 0)).map((s) => s.id);
}

/** Total running time of a preview, in seconds. */
export function previewDuration(scenes: SceneSpec[], order: string[]): number {
  return order.reduce((sum, id) => sum + Math.max(1, scenes.find((s) => s.id === id)?.durationSeconds || 8), 0);
}
