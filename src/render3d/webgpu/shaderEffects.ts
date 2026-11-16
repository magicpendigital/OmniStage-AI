/**
 * Phase 6 Batch 3 — TSL twin of the actor shader-effect presets (src/render3d/shaderEffects.ts, GLSL). Same uniforms, same
 * constants, same order of operations: the effect is applied to the lit colour before fog (`setupOutput`), the dissolve
 * discards through `maskNode`. Only the WebGPU Player imports this module (through the node backend).
 */
import * as THREE from 'three';
import {
  MeshBasicNodeMaterial, MeshLambertNodeMaterial, MeshMatcapNodeMaterial, MeshPhongNodeMaterial, MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial, MeshToonNodeMaterial, NodeMaterial,
} from 'three/webgpu';
import {
  abs, clamp, cos, dot, float, floor, Fn, fract, max, min, mix, normalFlat, normalViewGeometry, normalize, positionViewDirection,
  positionWorld, pow, sin, smoothstep, uniform, vec3, vec4,
} from 'three/tsl';
import type { ShaderEffectPreset } from '../../types/scene.schema';
import type { ShaderFxKit, ShaderFxValues } from '../shaderEffects';

const NODE_CLASSES: Record<string, new () => NodeMaterial> = {
  MeshBasicMaterial: MeshBasicNodeMaterial,
  MeshLambertMaterial: MeshLambertNodeMaterial,
  MeshPhongMaterial: MeshPhongNodeMaterial,
  MeshStandardMaterial: MeshStandardNodeMaterial,
  MeshPhysicalMaterial: MeshPhysicalNodeMaterial,
  MeshToonMaterial: MeshToonNodeMaterial,
  MeshMatcapMaterial: MeshMatcapNodeMaterial,
};
const SKIP_KEYS = new Set(['uuid', 'type', 'version', 'userData', '_listeners', 'onBeforeCompile', 'customProgramCacheKey']);

/** The node version of a classic material (same property copy as three's NodeLibrary.fromMaterial). */
function toNodeMaterial(base: THREE.Material): NodeMaterial {
  const Cls = NODE_CLASSES[base.type] || MeshStandardNodeMaterial;
  const m = new Cls() as any;
  for (const key in base) {
    if (SKIP_KEYS.has(key)) continue;
    m[key] = (base as any)[key];
  }
  m.name = base.name;
  return m;
}

const hash13 = Fn(([p]: any[]) => {
  const p3: any = fract(p.mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.zyx.add(31.32)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

const noise3 = Fn(([x]: any[]) => {
  const i: any = floor(x).toVar();
  const f: any = fract(x).toVar();
  const u: any = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
  const h = (dx: number, dy: number, dz: number) => hash13(i.add(vec3(dx, dy, dz)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), u.x), mix(h(0, 1, 0), h(1, 1, 0), u.x), u.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), u.x), mix(h(0, 1, 1), h(1, 1, 1), u.x), u.y),
    u.z,
  );
});

let kitIds = 0;

export function shaderFx(): ShaderFxKit {
  const kitId = ++kitIds;
  const uT = uniform(0);
  const uColor: any = uniform(new THREE.Color());
  const uIntensity = uniform(1);
  const uThreshold = uniform(-1);
  const uActorInv: any = uniform(new THREE.Matrix4());
  const uActorScale = uniform(1);
  const actorPos = () => uActorInv.mul(vec4(positionWorld, 1)).xyz.mul(uActorScale);
  const dissolveNoise = (P: any) => float(0.7).mul(noise3(P.mul(5))).add(float(0.3).mul(noise3(P.mul(11).add(3.7))));

  const apply = (preset: ShaderEffectPreset, base: any, unlit: boolean) => Fn(() => {
    const N = unlit ? normalFlat : normalViewGeometry;
    const fres = float(1).sub(abs(dot(normalize(N), positionViewDirection))).toVar();
    const P = actorPos().toVar();
    const C = base.rgb;
    const K = uColor;
    const I = uIntensity;
    const t = uT;
    switch (preset) {
      case 'hologram': {
        const s = float(0.5).add(sin(P.y.mul(120).sub(t.mul(6))).mul(0.5));
        const scan = s.mul(s);
        const flick = float(0.92).add(sin(t.mul(37)).mul(sin(t.mul(11))).mul(0.08));
        const rgb = C.mul(0.25).add(K.mul(float(0.25).add(fres.mul(fres).mul(1.5)).add(scan.mul(0.35))).mul(I)).mul(flick);
        return vec4(rgb, clamp(float(0.25).add(fres.mul(0.75)).add(scan.mul(0.2)).mul(flick), 0, 1).mul(base.a));
      }
      case 'dissolve': {
        const edge = float(1).sub(smoothstep(0, 0.04, dissolveNoise(P).sub(uThreshold)));
        return vec4(C.add(K.mul(edge).mul(4).mul(I)), base.a);
      }
      case 'toon': {
        const l = dot(C, vec3(0.2126, 0.7152, 0.0722));
        const q = floor(l.mul(4)).add(0.5).div(4);
        const rgb = C.mul(min(q.div(max(l, 0.0001)), 3)).add(K.mul(smoothstep(0.55, 0.65, fres)).mul(0.8).mul(I));
        return vec4(rgb, base.a);
      }
      case 'forcefield': {
        const pulse = float(0.75).add(sin(t.mul(3).sub(P.y.mul(8))).mul(0.25));
        return vec4(C.add(K.mul(pow(fres, 2.5).mul(2.5).add(0.08)).mul(pulse).mul(I)), base.a);
      }
      case 'lava': {
        const q = P.mul(3).add(vec3(0, t.mul(-0.4), t.mul(0.15))).toVar();
        const n = float(0.65).mul(noise3(q)).add(float(0.35).mul(noise3(q.mul(2.03).add(7.1)))).toVar();
        const vein = float(1).sub(smoothstep(0, 0.07, abs(n.sub(0.5))));
        const heat = smoothstep(0.35, 0.75, n);
        return vec4(C.mul(0.3).add(K.mul(vein.mul(2.5).add(heat.mul(0.6))).mul(I)), base.a);
      }
      default: { // rainbow
        const h = fres.mul(1.5).add(P.y.mul(1.2)).add(t.mul(0.25));
        const rain = cos(vec3(h, h, h).add(vec3(0, 0.33, 0.67)).mul(6.28318)).mul(0.5).add(0.5);
        const m = clamp(I.mul(0.6), 0, 1);
        return vec4(C.mul(float(1).sub(m.mul(0.5))).add(rain.mul(K).mul(float(0.15).add(fres.mul(0.9))).mul(m)), base.a);
      }
    }
  })();

  return {
    material(base, preset) {
      const m = toNodeMaterial(base) as any;
      const proto = Object.getPrototypeOf(m);
      const unlit = base.type === 'MeshBasicMaterial';
      // Before fog, like the GLSL patch after <opaque_fragment>.
      m.setupOutput = function (builder: unknown, output: unknown) {
        return proto.setupOutput.call(this, builder, apply(preset, output, unlit));
      };
      // setupOutput is not a node property: key the program by kit (its uniforms) and preset so nothing is shared wrongly.
      m.customProgramCacheKey = function () {
        return `${proto.customProgramCacheKey.call(this)}|omni-fx:${kitId}:${preset}`;
      };
      if (preset === 'dissolve') m.maskNode = dissolveNoise(actorPos()).greaterThanEqual(uThreshold);
      if (preset === 'hologram') m.transparent = true;
      m.needsUpdate = true;
      return m as THREE.Material;
    },
    set(v: ShaderFxValues) {
      uT.value = v.t;
      uColor.value.copy(v.color);
      uIntensity.value = v.intensity;
      uThreshold.value = v.threshold;
      uActorInv.value.copy(v.actorInverse);
      uActorScale.value = v.actorScale;
    },
    dispose() {},
  };
}
