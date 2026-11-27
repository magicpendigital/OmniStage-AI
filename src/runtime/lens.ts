/**
 * Phase 6B — depth of field. `SceneSpec.grade.dof` (0..1) and `focusDistance` (metres, 0 = automatic) are declarative; this module is
 * the maths shared by every renderer: where the focal plane is, how blurred a pixel at a given distance is (the circle of confusion)
 * and the GLSL of the pass. The WebGPU twin is `dofNode` in src/render3d/webgpu/index.ts and the CPU reference is `dofCoc` below, which
 * the tests pin. Change all three together.
 *
 * The blur is a fixed-tap Vogel disc (DOF_TAPS samples, golden-angle spiral) over the linear HDR colour BEFORE tone mapping, so
 * highlights bloom into bokeh; the disc is turned by a hash of the pixel position (never of time or Math.random), so the 24 taps read
 * as smooth noise instead of ghost copies and a frame is still the same on every render (frame-stepped exports repeat exactly). A tap
 * only contributes when ITS OWN blur reaches the pixel ("scatter as gather"), so a sharp subject never smears into a blurred
 * background.
 *
 * Pure: no DOM, no store.
 */
import { resolveShot } from './cinematics';
import type { SceneSpec, Vector3Tuple } from '../types/scene.schema';

/** Blur radius at full amount and full defocus, as a fraction of the image height (≈ 32 px on 1080p). */
export const DOF_MAX_RADIUS = 0.03;
/** Samples of the disc (the GLSL and TSL loops are unrolled to this). */
export const DOF_TAPS = 24;
/** How quickly blur grows with distance from the focal plane: full blur at 1/DOF_FALLOFF of the distance off the focus. */
export const DOF_FALLOFF = 3;
const GOLDEN_ANGLE = 2.39996323;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 0 (sharp) .. `amount` (fully out of focus) for a point `distance` metres in front of the camera when `focus` metres is sharp. */
export function dofCoc(distance: number, focus: number, amount: number): number {
  const z = Math.max(distance, 0.01);
  return clamp(DOF_FALLOFF * Math.abs(z - focus) / z, 0, 1) * clamp(amount, 0, 1);
}

const dist3 = (a: Vector3Tuple, b: Vector3Tuple) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Metres from the camera to the focal plane at `time`. A set `focusDistance` wins; else the point the camera is aimed at — in a shot
 * list that is the subject's framing point, so focus follows the actor the shot is about, with no extra data to author. `followShot`
 * is false while the camera is NOT the shot camera (the studio's free orbit): then it is the distance to what the camera looks at.
 */
export function focusDistanceFor(spec: SceneSpec, time: number, cameraPosition: Vector3Tuple, cameraTarget?: Vector3Tuple, followShot = true): number {
  const manual = spec.grade?.focusDistance;
  if (typeof manual === 'number' && Number.isFinite(manual) && manual > 0) return clamp(manual, 0.1, 200);
  const shot = followShot && spec.mode === 'media' && spec.engineType === '3d' ? resolveShot(spec, time) : null;
  const d = shot ? dist3(shot.position, shot.target) : cameraTarget ? dist3(cameraPosition, cameraTarget) : dist3(cameraPosition, spec.camera.target);
  return clamp(Number.isFinite(d) ? d : 6, 0.3, 200);
}

/**
 * Fragment shader of the WebGL pass: `tColor` (linear HDR) and `tDepth` (the composer target's depth texture). Uniforms: uTexel (1/size),
 * uNear / uFar of the camera, uFocus (metres) and uAmount (0..1).
 */
export const DOF_GLSL = `
uniform sampler2D tColor; uniform sampler2D tDepth;
uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uAmount;
varying vec2 vUv;
float omniDist(vec2 uv) {
  float zn = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear));
}
float omniCoc(float z) {
  z = max(z, 0.01);
  return clamp(${DOF_FALLOFF.toFixed(1)} * abs(z - uFocus) / z, 0.0, 1.0) * uAmount;
}
void main() {
  vec4 base = texture2D(tColor, vUv);
  float height = 1.0 / uTexel.y;
  float rCenter = omniCoc(omniDist(vUv)) * ${DOF_MAX_RADIUS} * height;
  if (rCenter < 0.35) { gl_FragColor = base; return; }
  vec3 acc = base.rgb; float wsum = 1.0;
  float rot = fract(sin(dot(vUv / uTexel, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  for (int i = 0; i < ${DOF_TAPS}; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / ${DOF_TAPS.toFixed(1)});
    float a = fi * ${GOLDEN_ANGLE} + rot;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * (r * rCenter) * uTexel;
    float rTap = omniCoc(omniDist(uv)) * ${DOF_MAX_RADIUS} * height;
    float w = clamp(rTap - r * rCenter + 1.0, 0.0, 1.0);
    acc += texture2D(tColor, uv).rgb * w; wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, base.a);
}`;
