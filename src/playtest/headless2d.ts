/**
 * Phase 5 (Director E) — a headless 2D game session on the SAME runtime the studio, Play Test and every export run.
 * It builds the Player's vanilla store, binds it as the runtime host, and steps `stepStage2D` with a canvas context that
 * draws nothing, so a bot (or a regression test) plays the real physics, spawners, logic graph and win / lose rules.
 * Pure TypeScript: no DOM, no React, no network. The previous runtime host and the SFX mute are restored afterwards.
 */
import { createPlayerStore, PlayerStore } from '../player/playerStore';
import { bindRuntimeStore, boundRuntimeStore, runtimeStore } from '../runtime/host';
import { RuntimeLogicGraph } from '../runtime/logicGraph';
import { displayedPosition2D, RuntimeBody2D, stepStage2D } from '../runtime/stage2d';
import { isSfxMuted, setSfxMuted } from '../audio/audioBus';
import { cloneSceneSpec } from '../registry/assetRegistry';
import type { SceneSpec } from '../types/scene.schema';

/** A canvas context that accepts every call and draws nothing (text measures as 0 wide). */
export function createNullContext(): CanvasRenderingContext2D {
  const sink: any = new Proxy(function sinkTarget() {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  return sink as CanvasRenderingContext2D;
}

/** Frame length of the headless session: the Player's own cap (`step` clamps dt to 0.05), at 60 fps. */
export const HEADLESS_DT = 1 / 60;

export interface HeadlessSession2D {
  store: PlayerStore;
  bodies: Record<string, RuntimeBody2D>;
  /** Keys held during the next frame (lower-case, like the Player's InputManager: a d w s space arrows). */
  keys: Set<string>;
  /** Advance one frame with the current `keys`. */
  step: (dt?: number) => void;
  /** Put the host and the SFX mute back the way they were. Always call it (use `runHeadless`). */
  dispose: () => void;
}

/** The scene exactly as the headless run plays it: images dropped (they only draw), everything else untouched. */
function preparedScene(spec: SceneSpec): SceneSpec {
  const clone = cloneSceneSpec(spec);
  for (const n of clone.nodes2D || []) delete (n as { imageUrl?: string }).imageUrl;
  return clone;
}

export function openHeadlessSession2D(spec: SceneSpec): HeadlessSession2D {
  // Everything that can throw (a malformed scene) is built before the globals are touched, so a failure leaks neither the mute nor the host.
  const store = createPlayerStore([preparedScene(spec)]);
  const previousHost = boundRuntimeStore();
  const wasMuted = isSfxMuted();
  setSfxMuted(true);
  bindRuntimeStore(store);
  const runtime = new RuntimeLogicGraph('2d');
  const bodies: Record<string, RuntimeBody2D> = {};
  // Same live positions the Player's View2D gives the logic graph: contacts and distance checks see the moving player.
  runtime.runtimePosition = (id) => {
    const state = runtimeStore.getState();
    const node = state.sceneSpec.nodes2D.find((n) => n.id === id);
    if (!node) return undefined;
    const p = displayedPosition2D(node, state.isPlaying, state.currentTime, state.sceneSpec.mode, bodies);
    return [p.x, p.y, 0];
  };
  const keys = new Set<string>();
  const ctx = createNullContext();
  let disposed = false;
  return {
    store,
    bodies,
    keys,
    step: (dt = HEADLESS_DT) => {
      stepStage2D(ctx, Math.min(Math.max(dt, 0), 0.05), keys, bodies, {}, runtime, { showGrid: false, selectedId: null });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      bindRuntimeStore(previousHost);
      setSfxMuted(wasMuted);
    },
  };
}

/** Open a session, hand it to `fn`, and always restore the host. */
export function runHeadless2D<T>(spec: SceneSpec, fn: (session: HeadlessSession2D) => T): T {
  const session = openHeadlessSession2D(spec);
  try {
    return fn(session);
  } finally {
    session.dispose();
  }
}
