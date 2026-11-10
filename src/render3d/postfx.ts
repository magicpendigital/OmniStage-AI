/**
 * Phase 7C — Ultra-quality post-processing (bloom) shared by the studio viewport and the OmniStage Player.
 * RenderPass → UnrealBloomPass → OutputPass (OutputPass applies the renderer's ACES tone mapping and sRGB output).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface BloomOptions {
  strength?: number;
  radius?: number;
  /** Luminance above which pixels glow (emissive materials, VFX, sparkles). */
  threshold?: number;
}

export interface PostFx {
  render: (deltaSeconds?: number) => void;
  setSize: (width: number, height: number, pixelRatio: number) => void;
  setCamera: (camera: THREE.Camera) => void;
  dispose: () => void;
}

// Threshold is in linear HDR before ACES tone mapping: ~1.0 keeps daylit surfaces clean and makes only emissive parts,
// VFX and specular highlights glow.
export const DEFAULT_BLOOM: Required<BloomOptions> = { strength: 0.35, radius: 0.4, threshold: 1.0 };

export function createBloom(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: BloomOptions = {}): PostFx {
  const o = { ...DEFAULT_BLOOM, ...opts };
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), o.strength, o.radius, o.threshold);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h, pr) => {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
    },
    setCamera: (c) => {
      renderPass.camera = c;
    },
    dispose: () => {
      bloom.dispose();
      output.dispose();
      composer.dispose();
    },
  };
}
