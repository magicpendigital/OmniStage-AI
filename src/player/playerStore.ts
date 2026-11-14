/**
 * Phase 7 — OmniStage Player state: a framework-free zustand/vanilla store that composes the SAME game runtime
 * slice as the studio store. Scene switching here is runtime-only (no undo history, no editor state).
 */
import { createStore } from 'zustand/vanilla';
import { cloneSceneSpec } from '../registry/assetRegistry';
import { createGameRuntimeSlice } from '../runtime/gameSlice';
import { syncGraphWithScene } from '../runtime/graphSync';
import type { RuntimeHostState } from '../runtime/host';
import type { SceneSpec } from '../types/scene.schema';

export type PlayerState = RuntimeHostState;

export function createPlayerStore(scenes: SceneSpec[], startSceneId?: string) {
  const prepared = scenes.map((s) => syncGraphWithScene(cloneSceneSpec(s)));
  const first = prepared.find((s) => s.id === startSceneId) || prepared[0];
  return createStore<PlayerState>()((set, get) => ({
    sceneSpec: cloneSceneSpec(first),
    scenes: prepared,
    activeSceneId: first.id,
    isPlaying: true,
    isLooping: first.mode === 'media' ? false : false,
    currentTime: 0,
    gameScore: 0,
    gameTimeRemaining: first.gameRules?.timeLimitSeconds || 60,
    gameWon: false,
    gameEnded: false,
    unboxTapCounts: {},
    scorePopups: [],
    burstEffects: [],
    executionLogs: [],
    settings: { physicsGravity: 9.8 },
    selectedNode2DId: null,
    switchScene: (sceneId: string) => {
      const target = get().scenes.find((s) => s.id === sceneId);
      if (!target) return;
      const spec = syncGraphWithScene(cloneSceneSpec(target));
      set({
        sceneSpec: spec,
        activeSceneId: spec.id,
        currentTime: 0,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        unboxTapCounts: {},
        scorePopups: [],
        burstEffects: [],
        gameTimeRemaining: spec.gameRules?.timeLimitSeconds || 60,
      });
    },
    ...createGameRuntimeSlice<PlayerState>(set, get),
  }));
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;

/** Order scenes play in: storyboard chain when present, else bundle order. */
export function nextSceneIdFor(state: PlayerState): string | undefined {
  const linked = state.sceneSpec.sequence?.nextSceneId;
  if (linked && state.scenes.some((s) => s.id === linked)) return linked;
  const idx = state.scenes.findIndex((s) => s.id === state.activeSceneId);
  return idx >= 0 && idx < state.scenes.length - 1 ? state.scenes[idx + 1].id : undefined;
}
