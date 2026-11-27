/**
 * Phase 6 (video / post-production) — the colour grade and lens look of a scene, as pure data + maths.
 *
 * `SceneSpec.grade` is declarative: a preset and/or a few numbers. `resolveGrade` turns it into the numbers the final display pass
 * uses (null when the look is neutral, so nothing is rendered). The pass itself exists three times with the SAME maths — GLSL
 * (`src/render3d/postfx.ts`), TSL (`src/render3d/webgpu/index.ts`) and the CPU reference `gradeRgb` below, which the tests pin.
 * Change all three together. The grade runs on display-referred colour (after tone mapping and sRGB), so it behaves like a
 * grading tool, not like a light.
 *
 * Pure: no DOM, no store, no Date / Math.random. Grain is a function of pixel + `seed` (the renderers pass the frame number).
 */
import type { ColorGrade, GradePreset } from '../types/scene.schema';

export const GRADE_PRESET_IDS: GradePreset[] = ['neutral', 'warm', 'cool', 'noir', 'vivid', 'faded', 'teal-orange', 'sepia', 'portrait'];

export interface ResolvedGrade {
  /** Stops (2^x), -2..2. */
  exposure: number;
  /** Around mid grey; 1 = unchanged, 0.5..1.6. */
  contrast: number;
  /** 0 = monochrome, 1 = unchanged, up to 2. */
  saturation: number;
  /** -1 (cool/blue) .. 1 (warm/orange). */
  temperature: number;
  /** -1 (green) .. 1 (magenta). */
  tint: number;
  /** Lifted blacks, 0..0.4. */
  fade: number;
  /** Darkened corners, 0..1. */
  vignette: number;
  /** Film grain amount, 0..1. */
  grain: number;
  /** Split-toning strength 0..1 and the two tint colours (already normalised to equal luma, so they colour without darkening). */
  split: number;
  /** Phase 6B depth of field 0..1 (the blur itself is the lens pass in src/runtime/lens.ts) and the manual focus distance in metres (0 = automatic). */
  dof: number;
  focusDistance: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
}

export type GradeNumbers = Omit<ColorGrade, 'preset' | 'shadows' | 'highlights'> & { shadows: string; highlights: string };

const NEUTRAL = {
  exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, fade: 0, vignette: 0, grain: 0, split: 0, dof: 0, focusDistance: 0, shadows: '#808080', highlights: '#808080',
};

/** Looks the AI (and the Properties panel) can pick by name; explicit fields on `grade` override them. */
export const GRADE_PRESETS: Record<GradePreset, typeof NEUTRAL> = {
  neutral: NEUTRAL,
  warm: { ...NEUTRAL, temperature: 0.35, saturation: 1.06, contrast: 1.05, vignette: 0.15 },
  cool: { ...NEUTRAL, temperature: -0.35, saturation: 0.96, contrast: 1.04, vignette: 0.15 },
  noir: { ...NEUTRAL, saturation: 0, contrast: 1.32, exposure: -0.15, vignette: 0.5, grain: 0.3 },
  vivid: { ...NEUTRAL, saturation: 1.35, contrast: 1.12, vignette: 0.1 },
  faded: { ...NEUTRAL, saturation: 0.78, contrast: 0.9, fade: 0.12, grain: 0.12, temperature: 0.1 },
  'teal-orange': { ...NEUTRAL, contrast: 1.12, saturation: 1.08, vignette: 0.2, split: 0.55, shadows: '#1c7f8c', highlights: '#f0a15a' },
  portrait: { ...NEUTRAL, contrast: 1.05, saturation: 1.05, vignette: 0.22, dof: 0.6 },
  sepia: { ...NEUTRAL, saturation: 0.35, contrast: 1.08, temperature: 0.55, fade: 0.06, vignette: 0.35, grain: 0.2, split: 0.5, shadows: '#4a3320', highlights: '#f2d9a8' },
};

/** Allowed ranges of every number (the verifier and the sanitizer use the same table). */
export const GRADE_RANGES: Record<'exposure' | 'contrast' | 'saturation' | 'temperature' | 'tint' | 'fade' | 'vignette' | 'grain' | 'split' | 'dof' | 'focusDistance', [number, number]> = {
  exposure: [-2, 2],
  contrast: [0.5, 1.6],
  saturation: [0, 2],
  temperature: [-1, 1],
  tint: [-1, 1],
  fade: [0, 0.4],
  vignette: [0, 1],
  grain: [0, 1],
  split: [0, 1],
  dof: [0, 1],
  focusDistance: [0, 200],
};

export const isGradePreset = (v: unknown): v is GradePreset => typeof v === 'string' && Object.prototype.hasOwnProperty.call(GRADE_PRESETS, v);
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const LUMA: [number, number, number] = [0.2126, 0.7152, 0.0722];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A colour scaled to luma 1 (components capped at 2): multiplying by it tints without brightening or darkening. */
function equalLuma(rgb: [number, number, number]): [number, number, number] {
  const l = Math.max(0.02, rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]);
  return [Math.min(2, rgb[0] / l), Math.min(2, rgb[1] / l), Math.min(2, rgb[2] / l)];
}

/** Out-of-range / non-numeric fields of a grade (what `grade.invalid` reports). */
export function gradeProblems(grade: unknown): string[] {
  if (grade === undefined) return [];
  if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return ['grade must be an object'];
  const g = grade as Record<string, unknown>;
  const out: string[] = [];
  if (g.preset !== undefined && !isGradePreset(g.preset)) out.push(`unknown preset "${String(g.preset).slice(0, 30)}" (${GRADE_PRESET_IDS.join(', ')})`);
  for (const [key, [lo, hi]] of Object.entries(GRADE_RANGES)) {
    const v = g[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) out.push(`${key} must be a number in ${lo}..${hi}`);
  }
  for (const key of ['shadows', 'highlights']) if (g[key] !== undefined && !isHexColor(g[key])) out.push(`${key} must be a #rrggbb colour`);
  return out;
}

/** Drops / clamps whatever `gradeProblems` reports (the verifier's auto-fix). Returns undefined when nothing usable is left. */
export function sanitizeGrade(grade: unknown): ColorGrade | undefined {
  if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return undefined;
  const g = grade as Record<string, unknown>;
  const out: ColorGrade = {};
  if (isGradePreset(g.preset)) out.preset = g.preset;
  for (const [key, [lo, hi]] of Object.entries(GRADE_RANGES)) {
    const v = g[key];
    if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, number>)[key] = clamp(v, lo, hi);
  }
  if (isHexColor(g.shadows)) out.shadows = g.shadows;
  if (isHexColor(g.highlights)) out.highlights = g.highlights;
  return Object.keys(out).length ? out : undefined;
}

/** The numbers the display pass uses, or null when the look is (near) neutral and no pass is needed. */
export function resolveGrade(grade: ColorGrade | undefined | null): ResolvedGrade | null {
  if (!grade || typeof grade !== 'object') return null;
  const base = isGradePreset(grade.preset) ? GRADE_PRESETS[grade.preset] : NEUTRAL;
  const num = (key: keyof typeof GRADE_RANGES): number => {
    const own = (grade as Record<string, unknown>)[key];
    const [lo, hi] = GRADE_RANGES[key];
    return clamp(typeof own === 'number' && Number.isFinite(own) ? own : (base as unknown as Record<string, number>)[key], lo, hi);
  };
  const shadows = isHexColor(grade.shadows) ? grade.shadows : base.shadows;
  const highlights = isHexColor(grade.highlights) ? grade.highlights : base.highlights;
  const resolved: ResolvedGrade = {
    exposure: num('exposure'), contrast: num('contrast'), saturation: num('saturation'), temperature: num('temperature'), tint: num('tint'),
    fade: num('fade'), vignette: num('vignette'), grain: num('grain'), split: num('split'), dof: num('dof'), focusDistance: num('focusDistance'),
    shadowTint: equalLuma(hexToRgb(shadows)), highlightTint: equalLuma(hexToRgb(highlights)),
  };
  return isNeutralGrade(resolved) ? null : resolved;
}

export function isNeutralGrade(g: ResolvedGrade): boolean {
  return (
    Math.abs(g.exposure) < 1e-3 && Math.abs(g.contrast - 1) < 1e-3 && Math.abs(g.saturation - 1) < 1e-3 && Math.abs(g.temperature) < 1e-3 &&
    Math.abs(g.tint) < 1e-3 && g.fade < 1e-3 && g.vignette < 1e-3 && g.grain < 1e-3 && g.split < 1e-3 && g.dof < 1e-3
  );
}

/** Grain pattern seed for a timeline time: a new pattern every film frame (24 per second), identical for the same time. */
export const grainSeed = (timeSeconds: number): number => (Math.floor(Math.max(0, timeSeconds) * 24 + 1e-6) % 997) / 997;

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** How much a pixel at `uv` (0..1) is darkened by the vignette: 0 in the middle, 1 in the far corners. */
export const vignetteMask = (u: number, v: number): number => smoothstep(0.35, 1, Math.hypot(u - 0.5, v - 0.5) * Math.SQRT2);

/**
 * CPU reference of the display pass for one pixel: `rgb` and the result are display-referred 0..1, `(u, v)` the pixel position in
 * 0..1 and `noise` a value in [0,1) (the shaders hash the position + seed; the tests pass fixed values).
 */
export function gradeRgb(rgb: [number, number, number], g: ResolvedGrade, u = 0.5, v = 0.5, noise = 0.5): [number, number, number] {
  const e = Math.pow(2, g.exposure);
  let r = rgb[0] * e;
  let gr = rgb[1] * e;
  let b = rgb[2] * e;
  r *= 1 + 0.18 * g.temperature + 0.05 * g.tint;
  b *= 1 - 0.18 * g.temperature + 0.05 * g.tint;
  gr *= 1 - 0.1 * g.tint;
  r = (r - 0.5) * g.contrast + 0.5;
  gr = (gr - 0.5) * g.contrast + 0.5;
  b = (b - 0.5) * g.contrast + 0.5;
  let l = r * LUMA[0] + gr * LUMA[1] + b * LUMA[2];
  r = l + (r - l) * g.saturation;
  gr = l + (gr - l) * g.saturation;
  b = l + (b - l) * g.saturation;
  r = g.fade + r * (1 - g.fade);
  gr = g.fade + gr * (1 - g.fade);
  b = g.fade + b * (1 - g.fade);
  l = clamp(r * LUMA[0] + gr * LUMA[1] + b * LUMA[2], 0, 1);
  const sh = (1 - smoothstep(0, 0.6, l)) * g.split;
  const hi = smoothstep(0.4, 1, l) * g.split;
  r = r * (1 + (g.shadowTint[0] - 1) * sh);
  gr = gr * (1 + (g.shadowTint[1] - 1) * sh);
  b = b * (1 + (g.shadowTint[2] - 1) * sh);
  r = r * (1 + (g.highlightTint[0] - 1) * hi);
  gr = gr * (1 + (g.highlightTint[1] - 1) * hi);
  b = b * (1 + (g.highlightTint[2] - 1) * hi);
  const dark = 1 - g.vignette * vignetteMask(u, v);
  const grain = (noise - 0.5) * g.grain * 0.25;
  return [clamp(r * dark + grain, 0, 1), clamp(gr * dark + grain, 0, 1), clamp(b * dark + grain, 0, 1)];
}

/** Looks the offline director uses per story mood (a whole film shares one look, which is most of what makes it feel graded). */
export const GRADE_FOR_MOOD: Record<string, GradePreset> = {
  calm: 'warm',
  happy: 'vivid',
  playful: 'vivid',
  adventure: 'teal-orange',
  epic: 'teal-orange',
  tense: 'cool',
  sad: 'faded',
  mysterious: 'cool',
};

/** Shader code shared by the GLSL pass. Kept as a string so the WebGL and Player bundles carry the same maths. */
export const GRADE_GLSL = /* glsl */ `
uniform float uExposure, uContrast, uSaturation, uTemperature, uTint, uFade, uVignette, uGrain, uSplit, uSeed;
uniform vec3 uShadowTint, uHighlightTint;
vec3 omniGrade(vec3 c, vec2 uv) {
  c *= exp2(uExposure);
  c.r *= 1.0 + 0.18 * uTemperature + 0.05 * uTint;
  c.b *= 1.0 - 0.18 * uTemperature + 0.05 * uTint;
  c.g *= 1.0 - 0.1 * uTint;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = uFade + c * (1.0 - uFade);
  l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  c *= mix(vec3(1.0), uShadowTint, (1.0 - smoothstep(0.0, 0.6, l)) * uSplit);
  c *= mix(vec3(1.0), uHighlightTint, smoothstep(0.4, 1.0, l) * uSplit);
  c *= 1.0 - uVignette * smoothstep(0.35, 1.0, distance(uv, vec2(0.5)) * 1.41421356);
  float n = fract(sin(dot(uv * vec2(1013.7, 917.3) + uSeed * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uGrain * 0.25;
  return clamp(c, 0.0, 1.0);
}
`;
