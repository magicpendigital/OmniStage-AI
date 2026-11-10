import React from 'react';
import { createGpuParticles, GpuParticleOptions } from '../render3d/gpuParticles';
import { Built } from './Built';

/** Studio wrapper around the shared GPU particle builder (src/render3d/gpuParticles.ts). */
export function GpuParticles(props: GpuParticleOptions) {
  const { kind, count, color, size, spread, scale, startTime, createdAt } = props;
  return <Built factory={() => createGpuParticles(props)} deps={[kind, count, color, size, spread, scale, startTime, createdAt]} />;
}
