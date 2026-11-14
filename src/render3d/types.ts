/** Phase 7B — contract for framework-free scene builders shared by the studio (R3F) and the OmniStage Player. */
import type * as THREE from 'three';

export interface FrameContext {
  /** Timeline time in seconds (studio scrubber / Player clock). */
  time: number;
  /** Scene duration in seconds. */
  duration: number;
  /** Wall-clock milliseconds (Date.now) for one-shot effects. */
  nowMs: number;
  /** Seconds since the view started (free-running, for shimmer / shake). */
  clock: number;
  /** Drawing-buffer height in device pixels (point-size maths). */
  viewportHeight: number;
}

export interface Built3D<T extends THREE.Object3D = THREE.Object3D> {
  object: T;
  update?: (ctx: FrameContext) => void;
  /** Phase 7C: extra off-screen rendering before the main render (e.g. contact-shadow depth pass). */
  prerender?: (renderer: THREE.WebGLRenderer, scene: THREE.Scene) => void;
  dispose: () => void;
}

export type RenderQuality = 'low' | 'high';
