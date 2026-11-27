/**
 * Phase 7C — Ultra-quality post-processing (bloom) shared by the studio viewport and the OmniStage Player.
 * RenderPass → UnrealBloomPass → OutputPass (OutputPass applies the renderer's ACES tone mapping and sRGB output) → GradePass.
 * Phase 6: GradePass is the scene's colour grade / lens look (src/runtime/colorGrade.ts) on display-referred colour; it is skipped
 * (disabled) when the scene has none. `enabled: false` builds the same stack without bloom, for scenes that only have a grade.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GRADE_GLSL, type ResolvedGrade } from '../runtime/colorGrade';

export interface BloomOptions {
  strength?: number;
  radius?: number;
  /** Luminance above which pixels glow (emissive materials, VFX, sparkles). */
  threshold?: number;
  /** false = no bloom (a grade-only stack). Default true. */
  enabled?: boolean;
}

export interface PostFx {
  render: (deltaSeconds?: number) => void;
  setSize: (width: number, height: number, pixelRatio: number) => void;
  setCamera: (camera: THREE.Camera) => void;
  /** Phase 6: the colour grade for the next frames (null = none) and the grain seed (`grainSeed(time)`). */
  setGrade: (grade: ResolvedGrade | null, seed?: number) => void;
  dispose: () => void;
}

// Threshold is in linear HDR before ACES tone mapping: ~1.0 keeps daylit surfaces clean and makes only emissive parts,
// VFX and specular highlights glow.
export const DEFAULT_BLOOM: Required<BloomOptions> = { strength: 0.35, radius: 0.4, threshold: 1.0, enabled: true };

/** The final display pass: the uniforms are set from a ResolvedGrade by `setGrade`. */
function createGradePass(): ShaderPass {
  const pass = new ShaderPass({
    name: 'OmniGrade',
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: 0 }, uContrast: { value: 1 }, uSaturation: { value: 1 }, uTemperature: { value: 0 }, uTint: { value: 0 },
      uFade: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uSplit: { value: 0 }, uSeed: { value: 0 },
      uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
${GRADE_GLSL}
void main() { vec4 t = texture2D(tDiffuse, vUv); gl_FragColor = vec4(omniGrade(t.rgb, vUv), t.a); }`,
  });
  pass.enabled = false;
  return pass;
}

function applyGrade(pass: ShaderPass, grade: ResolvedGrade | null, seed: number) {
  pass.enabled = !!grade;
  if (!grade) return;
  const u = pass.uniforms as Record<string, { value: any }>;
  u.uExposure.value = grade.exposure;
  u.uContrast.value = grade.contrast;
  u.uSaturation.value = grade.saturation;
  u.uTemperature.value = grade.temperature;
  u.uTint.value = grade.tint;
  u.uFade.value = grade.fade;
  u.uVignette.value = grade.vignette;
  u.uGrain.value = grade.grain;
  u.uSplit.value = grade.split;
  u.uSeed.value = seed;
  u.uShadowTint.value.set(...grade.shadowTint);
  u.uHighlightTint.value.set(...grade.highlightTint);
}

export function createBloom(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: BloomOptions = {}): PostFx {
  const o = { ...DEFAULT_BLOOM, ...opts };
  const size = renderer.getSize(new THREE.Vector2());
  // The composer's own targets are not multisampled, so without this the scene loses the renderer's antialiasing whenever bloom or a
  // grade is on (jagged edges in exports). 4 samples where the GPU allows it; the grade pass reads the resolved texture.
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType });
  target.samples = Math.min(4, renderer.capabilities.maxSamples ?? 0);
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), o.strength, o.radius, o.threshold);
  bloom.enabled = o.enabled !== false;
  const output = new OutputPass();
  const gradePass = createGradePass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(gradePass);
  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h, pr) => {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
    },
    setCamera: (c) => {
      renderPass.camera = c;
    },
    setGrade: (grade, seed = 0) => applyGrade(gradePass, grade, seed),
    dispose: () => {
      bloom.dispose();
      output.dispose();
      gradePass.dispose();
      composer.dispose();
    },
  };
}
