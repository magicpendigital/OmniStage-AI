/**
 * Phase 6 Batch 3 — actor shader effects (hologram, dissolve, toon, force field, lava, iridescent): a FIXED set of reviewed
 * shader presets driven by data (`actor.shaderEffect`), never generated shader code (invariant 1).
 *
 * `ActorShaderEffect` swaps every mesh material under an actor for an effect twin of the same material (so maps, skinning,
 * morphs and lighting keep working on rigged GLTF actors and procedural composites alike) and restores the originals when the
 * effect is removed. The twin is made by a `ShaderFxKit`: WebGL patches the built-in shader with `onBeforeCompile` (below);
 * under the WebGPU Player the node backend supplies a TSL twin with the same maths (src/render3d/webgpu/shaderEffects.ts).
 * Everything animates from the timeline time only, so scrubbing and frame-stepped exports are deterministic.
 */
import * as THREE from 'three';
import type { ShaderEffect, ShaderEffectPreset } from '../types/scene.schema';
import { SHADER_EFFECT_PRESETS, resolveShaderEffect, shaderEffectCastsShadow } from '../runtime/shaderEffects';
import { nodeBackend } from './backend';
import type { FrameContext } from './types';

/** Per-actor values shared by every effect material of that actor (uniforms). */
export interface ShaderFxValues {
  /** Effect clock (timeline seconds × speed). */
  t: number;
  color: THREE.Color;
  intensity: number;
  /** Dissolve threshold on the noise (see `dissolveThreshold`). */
  threshold: number;
  /** World → actor space (inverse of the actor root's world matrix). */
  actorInverse: THREE.Matrix4;
  /** 1 / actor extent, so patterns have the same density on a 2 cm prop and a 2 m robot. */
  actorScale: number;
}

export interface ShaderFxKit {
  /** Effect twin of a mesh material (a new material; the caller keeps the original to restore it). */
  material(base: THREE.Material, preset: ShaderEffectPreset): THREE.Material;
  set(values: ShaderFxValues): void;
  dispose(): void;
}

/** Dissolve progress → noise threshold: 0 keeps every fragment, 1 discards every fragment, the edge never shows at 0. */
export function dissolveThreshold(progress: number): number {
  if (progress <= 0) return -1;
  if (progress >= 1) return 2;
  return 0.15 + progress * 0.7;
}

// ------------------------------------------------------------------------------------------------ GLSL (WebGL)
const FX_VERTEX_PARS = /* glsl */ `
varying vec3 vOmniWorld;
varying vec3 vOmniView;`;

const FX_VERTEX = /* glsl */ `
vOmniWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vOmniView = -mvPosition.xyz;`;

/** Keep this maths identical to the TSL twin in src/render3d/webgpu/shaderEffects.ts. */
const FX_FRAGMENT_PARS = /* glsl */ `
uniform float omniT;
uniform vec3 omniColor;
uniform float omniIntensity;
uniform float omniThreshold;
uniform mat4 omniActorInv;
uniform float omniActorScale;
varying vec3 vOmniWorld;
varying vec3 vOmniView;
float omniHash(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float omniNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(omniHash(i), omniHash(i + vec3(1.0, 0.0, 0.0)), u.x), mix(omniHash(i + vec3(0.0, 1.0, 0.0)), omniHash(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(omniHash(i + vec3(0.0, 0.0, 1.0)), omniHash(i + vec3(1.0, 0.0, 1.0)), u.x), mix(omniHash(i + vec3(0.0, 1.0, 1.0)), omniHash(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
vec3 omniActorPos() { return (omniActorInv * vec4(vOmniWorld, 1.0)).xyz * omniActorScale; }
float omniDissolveNoise(vec3 P) { return 0.7 * omniNoise(P * 5.0) + 0.3 * omniNoise(P * 11.0 + 3.7); }
vec4 omniApply(vec4 base, vec3 N) {
  vec3 V = normalize(vOmniView);
  float fres = 1.0 - abs(dot(normalize(N), V));
  vec3 P = omniActorPos();
  vec3 C = base.rgb;
  vec3 K = omniColor;
  float I = omniIntensity;
  float t = omniT;
#if OMNI_FX == 0
  float scan = 0.5 + 0.5 * sin(P.y * 120.0 - t * 6.0);
  scan *= scan;
  float flick = 0.92 + 0.08 * sin(t * 37.0) * sin(t * 11.0);
  vec3 rgb = (C * 0.25 + K * (0.25 + fres * fres * 1.5 + scan * 0.35) * I) * flick;
  return vec4(rgb, clamp((0.25 + fres * 0.75 + scan * 0.2) * flick, 0.0, 1.0) * base.a);
#elif OMNI_FX == 1
  float edge = 1.0 - smoothstep(0.0, 0.04, omniDissolveNoise(P) - omniThreshold);
  return vec4(C + K * edge * 4.0 * I, base.a);
#elif OMNI_FX == 2
  float l = dot(C, vec3(0.2126, 0.7152, 0.0722));
  float q = (floor(l * 4.0) + 0.5) / 4.0;
  vec3 rgb = C * min(q / max(l, 0.0001), 3.0) + K * smoothstep(0.55, 0.65, fres) * 0.8 * I;
  return vec4(rgb, base.a);
#elif OMNI_FX == 3
  float pulse = 0.75 + 0.25 * sin(t * 3.0 - P.y * 8.0);
  return vec4(C + K * (pow(fres, 2.5) * 2.5 + 0.08) * pulse * I, base.a);
#elif OMNI_FX == 4
  vec3 q = P * 3.0 + vec3(0.0, -t * 0.4, t * 0.15);
  float n = 0.65 * omniNoise(q) + 0.35 * omniNoise(q * 2.03 + 7.1);
  float vein = 1.0 - smoothstep(0.0, 0.07, abs(n - 0.5));
  float heat = smoothstep(0.35, 0.75, n);
  return vec4(C * 0.3 + K * (vein * 2.5 + heat * 0.6) * I, base.a);
#else
  float h = fres * 1.5 + P.y * 1.2 + t * 0.25;
  vec3 rain = 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
  float m = clamp(I * 0.6, 0.0, 1.0);
  return vec4(C * (1.0 - 0.5 * m) + rain * K * (0.15 + fres * 0.9) * m, base.a);
#endif
}`;

function glslKit(): ShaderFxKit {
  const uniforms = {
    omniT: { value: 0 },
    omniColor: { value: new THREE.Color() },
    omniIntensity: { value: 1 },
    omniThreshold: { value: -1 },
    omniActorInv: { value: new THREE.Matrix4() },
    omniActorScale: { value: 1 },
  };
  return {
    material(base, preset) {
      const m = base.clone();
      const id = SHADER_EFFECT_PRESETS.indexOf(preset);
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms); // shared objects: one update per actor
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>${FX_VERTEX_PARS}`)
          .replace('#include <project_vertex>', `#include <project_vertex>${FX_VERTEX}`);
        // Lit materials have a smooth shading normal; unlit ones get the face normal from derivatives.
        const normal = shader.fragmentShader.includes('#include <normal_fragment_begin>')
          ? 'nonPerturbedNormal'
          : 'cross(dFdx(vOmniView), dFdy(vOmniView))';
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n#define OMNI_FX ${id}${FX_FRAGMENT_PARS}`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#if OMNI_FX == 1
  if (omniDissolveNoise(omniActorPos()) < omniThreshold) discard;
#endif`)
          .replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor = omniApply(gl_FragColor, ${normal});`);
      };
      m.customProgramCacheKey = () => `omni-fx-${preset}`;
      if (preset === 'hologram') m.transparent = true;
      return m;
    },
    set(v) {
      uniforms.omniT.value = v.t;
      uniforms.omniColor.value.copy(v.color);
      uniforms.omniIntensity.value = v.intensity;
      uniforms.omniThreshold.value = v.threshold;
      uniforms.omniActorInv.value.copy(v.actorInverse);
      uniforms.omniActorScale.value = v.actorScale;
    },
    dispose() {},
  };
}

// ------------------------------------------------------------------------------------------------ controller
interface Swapped {
  original: THREE.Material | THREE.Material[];
  fx: THREE.Material | THREE.Material[];
  castShadow: boolean;
}

/** Custom shader / node materials (water, glows, badges) keep their own look. */
function eligible(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || o.userData.omniNoShaderFx) return false;
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return list.every((m) => m && !(m as THREE.ShaderMaterial).isShaderMaterial && !(m as any).isNodeMaterial);
}

const tmpBox = new THREE.Box3();
const tmpMatrix = new THREE.Matrix4();
const tmpSize = new THREE.Vector3();

/** Applies `actor.shaderEffect` to everything under `root` (the actor's animated group). One per actor. */
export class ActorShaderEffect {
  private kit: ShaderFxKit | null = null;
  private preset: ShaderEffectPreset | null = null;
  private swapped = new Map<THREE.Mesh, Swapped>();
  private values: ShaderFxValues = { t: 0, color: new THREE.Color(), intensity: 1, threshold: -1, actorInverse: new THREE.Matrix4(), actorScale: 1 };

  constructor(readonly root: THREE.Object3D) {}

  /** Apply (or clear) the effect at a timeline time; call every frame after the actor's model is in place. */
  update(effect: ShaderEffect | undefined, ctx: Pick<FrameContext, 'time'>) {
    if (!effect) {
      this.clear();
      return;
    }
    const r = resolveShaderEffect(effect, ctx.time);
    if (r.preset !== this.preset || !this.kit) {
      this.clear();
      this.preset = r.preset;
      this.kit = nodeBackend()?.shaderFx() ?? glslKit();
    }
    // Models arrive late (GLB load) and composites are rebuilt: follow the current mesh set.
    let changed = false;
    const seen = new Set<THREE.Mesh>();
    const castBefore = new Map<THREE.Mesh, boolean>();
    this.root.traverse((o) => {
      let known = this.swapped.has(o as THREE.Mesh);
      // The host replaced the material (React re-render, rebuilt composite): take the new one as the original.
      if (known && (o as THREE.Mesh).material !== this.swapped.get(o as THREE.Mesh)!.fx) {
        const s = this.swapped.get(o as THREE.Mesh)!;
        for (const m of Array.isArray(s.fx) ? s.fx : [s.fx]) m.dispose();
        this.swapped.delete(o as THREE.Mesh);
        castBefore.set(o as THREE.Mesh, s.castShadow);
        known = false;
      }
      if (!known && !eligible(o)) return;
      const mesh = o as THREE.Mesh;
      seen.add(mesh);
      if (known) return;
      const fx = Array.isArray(mesh.material) ? mesh.material.map((m) => this.kit!.material(m, r.preset)) : this.kit!.material(mesh.material, r.preset);
      this.swapped.set(mesh, { original: mesh.material, fx, castShadow: castBefore.get(mesh) ?? mesh.castShadow });
      mesh.material = fx;
      changed = true;
    });
    for (const mesh of [...this.swapped.keys()]) {
      if (!seen.has(mesh)) {
        this.restore(mesh);
        changed = true;
      }
    }
    this.root.updateWorldMatrix(true, changed);
    if (changed) this.measure();
    const casts = shaderEffectCastsShadow(r);
    for (const [mesh, s] of this.swapped) mesh.castShadow = s.castShadow && casts;
    const v = this.values;
    v.t = r.t;
    v.color.set(r.color);
    v.intensity = r.intensity;
    v.threshold = dissolveThreshold(r.progress);
    v.actorInverse.copy(this.root.matrixWorld).invert();
    this.kit.set(v);
  }

  /** Give back the original materials under `subtree` (call before that subtree is disposed). */
  release(subtree: THREE.Object3D) {
    subtree.traverse((o) => {
      if (this.swapped.has(o as THREE.Mesh)) this.restore(o as THREE.Mesh);
    });
  }

  /** Meshes currently drawn with an effect material (tests / inspect). */
  get meshCount() {
    return this.swapped.size;
  }

  dispose() {
    this.clear();
  }

  private restore(mesh: THREE.Mesh) {
    const s = this.swapped.get(mesh);
    if (!s) return;
    if (mesh.material === s.fx) mesh.material = s.original;
    mesh.castShadow = s.castShadow;
    for (const m of Array.isArray(s.fx) ? s.fx : [s.fx]) m.dispose();
    this.swapped.delete(mesh);
  }

  private clear() {
    for (const mesh of [...this.swapped.keys()]) this.restore(mesh);
    this.kit?.dispose();
    this.kit = null;
    this.preset = null;
  }

  /** Pattern scale from the actor's size in its own space (bind-pose bounds; deterministic for a given model). */
  private measure() {
    const inverse = tmpMatrix.copy(this.root.matrixWorld).invert();
    const box = new THREE.Box3();
    for (const mesh of this.swapped.keys()) {
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) continue;
      box.union(tmpBox.copy(g.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
    }
    const size = box.isEmpty() ? 0 : Math.max(...box.getSize(tmpSize).toArray());
    this.values.actorScale = Number.isFinite(size) && size > 1e-4 ? 1 / size : 1;
  }
}
