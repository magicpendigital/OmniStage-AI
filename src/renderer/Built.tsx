/**
 * Phase 7B — hosts a framework-free src/render3d builder inside the R3F studio viewport: builds it when `deps` change,
 * disposes the previous one, and drives `update()` every frame with the studio timeline. The OmniStage Player calls the
 * same builders directly, so studio and exports render identical objects.
 */
import React, { useEffect, useMemo } from 'react';
import { RootState, useFrame } from '@react-three/fiber';
import type { Built3D, FrameContext } from '../render3d/types';
import { useStudioStore } from '../state/useStudioStore';

export function studioFrameContext(state: RootState): FrameContext {
  const s = useStudioStore.getState();
  return {
    time: s.currentTime,
    duration: s.sceneSpec.durationSeconds,
    nowMs: Date.now(),
    clock: state.clock.elapsedTime,
    viewportHeight: state.size.height * state.gl.getPixelRatio(),
  };
}

export function Built<T extends Built3D | null>({ factory, deps, onFrame }: {
  factory: () => T;
  deps: React.DependencyList;
  /** Extra per-frame work on the built object (e.g. play/pause flags). */
  onFrame?: (built: NonNullable<T>, ctx: FrameContext) => void;
}) {
  const built = useMemo(factory, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => built?.dispose(), [built]);
  useFrame((state) => {
    if (!built) return;
    const ctx = studioFrameContext(state);
    onFrame?.(built as NonNullable<T>, ctx);
    built.update?.(ctx);
    built.prerender?.(state.gl, state.scene);
  });
  return built ? <primitive object={built.object} dispose={null} /> : null;
}
