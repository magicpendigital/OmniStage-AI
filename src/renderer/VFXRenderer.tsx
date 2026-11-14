import React from 'react';
import { VFXNode } from '../types/scene.schema';
import { BurstVFXInstance, useStudioStore } from '../state/useStudioStore';
import { createBurst, createVfx } from '../render3d/vfx3d';
import { Built } from './Built';

/** Studio wrapper around the shared VFX builder (src/render3d/vfx3d.ts) — identical in the OmniStage Player. */
export const VFXRenderer: React.FC<{ vfx: VFXNode }> = ({ vfx }) => {
  const currentTime = useStudioStore((s) => s.currentTime);
  const mode = useStudioStore((s) => s.sceneSpec.mode);
  const isWithinWindow = mode === 'game' ||
    ((vfx.startTime === undefined || currentTime >= vfx.startTime) && (vfx.endTime === undefined || currentTime <= vfx.endTime));
  if (!isWithinWindow || vfx.visible === false) return null;
  return <Built factory={() => createVfx(vfx)} deps={[vfx]}
    onFrame={(built) => built.setPlaying(useStudioStore.getState().isPlaying)} />;
};

/** Transient collision / pickup burst. */
export const CollisionBurstRenderer: React.FC<{ burst: BurstVFXInstance }> = ({ burst }) =>
  <Built factory={() => createBurst(burst)} deps={[burst.id]} />;
