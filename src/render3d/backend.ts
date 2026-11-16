/**
 * Phase 7 — render backend switch for the shared builders.
 *
 * The builders in src/render3d are written for WebGL (GLSL ShaderMaterials, Reflector, EffectComposer). When the OmniStage
 * Player runs on WebGPU it installs a NodeBackend here (src/render3d/webgpu, TSL node materials) and the builders hand those
 * parts over to it. Nothing imports three/webgpu unless that backend is installed, so the WebGL bundles stay as they were.
 */
import type * as THREE from 'three';
import type { EnvironmentConfig, WorldSpec } from '../types/scene.schema';
import type { Built3D, RenderQuality } from './types';
import type { GpuParticleOptions } from './gpuParticles';
import type { BloomOptions, PostFx } from './postfx';
import type { ShaderFxKit } from './shaderEffects';

export interface NodeBackend {
  readonly name: 'webgpu';
  sky(world: WorldSpec): Built3D<THREE.Mesh>;
  water(world: WorldSpec, level: number, quality: RenderQuality, reflectionSize: number): Built3D;
  grid(env: Partial<EnvironmentConfig>, opts: { size: number; cellSize: number; sectionSize: number; fadeDistance: number }): Built3D<THREE.Mesh>;
  particles(opts: GpuParticleOptions): Built3D;
  studioEnvironment(renderer: unknown, scene: THREE.Scene): () => void;
  bloom(renderer: unknown, scene: THREE.Scene, camera: THREE.Camera, opts?: BloomOptions): PostFx;
  /** Phase 6 Batch 3: TSL twin of the actor shader-effect presets (src/render3d/shaderEffects.ts). */
  shaderFx(): ShaderFxKit;
}

let backend: NodeBackend | null = null;

export function setNodeBackend(b: NodeBackend | null) {
  backend = b;
}

export function nodeBackend(): NodeBackend | null {
  return backend;
}
