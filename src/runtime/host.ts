/**
 * Phase 7 — Runtime host binding. Shared runtime modules (logic graph, 2D simulation/drawing, game rules) read and
 * write state through whichever store is bound here: the studio binds `useStudioStore`, the OmniStage Player binds
 * its own vanilla store. Both expose the same zustand API (getState / setState / subscribe).
 */
import type { GameRuntimeState } from './gameSlice';
import type { SettingsConfig } from '../types/scene.schema';

export interface RuntimeHostState extends GameRuntimeState {
  settings: Pick<SettingsConfig, 'physicsGravity'> & Partial<SettingsConfig>;
  selectedNode2DId?: string | null;
}

export interface RuntimeStoreApi<S = RuntimeHostState> {
  getState: () => S;
  setState: (partial: Partial<S> | ((state: S) => Partial<S> | S)) => void;
  subscribe: (listener: (state: S, prev: S) => void) => () => void;
}

let bound: RuntimeStoreApi<any> | null = null;

export function bindRuntimeStore(store: RuntimeStoreApi<any>) {
  bound = store;
}

function store(): RuntimeStoreApi<RuntimeHostState> {
  if (!bound) throw new Error('OmniStage runtime store is not bound (call bindRuntimeStore first)');
  return bound;
}

/** The bound runtime store (studio store in the editor, the Player's store in exports). */
export const runtimeStore: RuntimeStoreApi<RuntimeHostState> = {
  getState: () => store().getState(),
  setState: (partial) => store().setState(partial as any),
  subscribe: (listener) => store().subscribe(listener),
};
