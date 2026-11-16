/**
 * Phase 6 Batch 3 — shader effect presets for actors: a FIXED set of reviewed, parameterised looks. SceneSpec only ever
 * carries `{ preset, color?, intensity?, speed?, progress?, progressTween? }`; the shader maths lives in
 * src/render3d/shaderEffects.ts (GLSL) and src/render3d/webgpu/shaderEffects.ts (TSL twin). Pure data + functions, shared
 * by the verifier, the AI normaliser, the inspector and both renderers.
 */
import type { ShaderEffect, ShaderEffectPreset } from '../types/scene.schema';

export const SHADER_EFFECT_PRESETS: ShaderEffectPreset[] = ['hologram', 'dissolve', 'toon', 'forcefield', 'lava', 'rainbow'];

export const SHADER_EFFECT_INFO: Record<ShaderEffectPreset, { label: string; color: string; hint: string }> = {
  hologram: { label: 'Hologram', color: '#38bdf8', hint: 'see-through scanlines, fresnel edge and flicker' },
  dissolve: { label: 'Dissolve', color: '#ff8a1f', hint: 'burns away with a glowing edge as progress goes 0 → 1' },
  toon: { label: 'Toon', color: '#ffffff', hint: 'banded cel lighting with a rim light' },
  forcefield: { label: 'Force field', color: '#22d3ee', hint: 'pulsing fresnel glow / energy shield' },
  lava: { label: 'Lava / energy', color: '#ff5a1f', hint: 'scrolling glowing veins' },
  rainbow: { label: 'Iridescent', color: '#ffffff', hint: 'shifting rainbow sheen' },
};

export const SHADER_EFFECT_LIMITS = { intensity: [0, 3], speed: [0, 5], progress: [0, 1], tweenTime: [0, 600] } as const;
const HEX = /^#[0-9a-f]{6}$/i;

export function isShaderEffectPreset(v: unknown): v is ShaderEffectPreset {
  return typeof v === 'string' && (SHADER_EFFECT_PRESETS as string[]).includes(v);
}

const clampNum = (v: unknown, [lo, hi]: readonly [number, number]) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);

/** Keep a #rrggbb colour, expand #rgb, drop anything else. */
function cleanColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (HEX.test(v)) return v;
  const s = v.trim().toLowerCase();
  if (HEX.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return undefined;
}

const canon = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

/**
 * The clean version of an authored effect (known fields only, numbers clamped, colour normalised), or null when it has
 * no known preset. Used by the verifier fix and the AI normaliser.
 */
export function sanitizeShaderEffect(raw: unknown): ShaderEffect | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isShaderEffectPreset(r.preset)) return null;
  const out: ShaderEffect = { preset: r.preset };
  const color = cleanColor(r.color);
  if (color) out.color = color;
  const intensity = clampNum(r.intensity, SHADER_EFFECT_LIMITS.intensity);
  if (intensity !== undefined) out.intensity = intensity;
  const speed = clampNum(r.speed, SHADER_EFFECT_LIMITS.speed);
  if (speed !== undefined) out.speed = speed;
  const progress = clampNum(r.progress, SHADER_EFFECT_LIMITS.progress);
  if (progress !== undefined) out.progress = progress;
  const tw = r.progressTween as Record<string, unknown> | undefined;
  if (tw && typeof tw === 'object' && !Array.isArray(tw)) {
    const from = clampNum(tw.from, SHADER_EFFECT_LIMITS.progress);
    const to = clampNum(tw.to, SHADER_EFFECT_LIMITS.progress);
    const start = clampNum(tw.start, SHADER_EFFECT_LIMITS.tweenTime);
    const duration = clampNum(tw.duration, SHADER_EFFECT_LIMITS.tweenTime);
    if (from !== undefined && to !== undefined && start !== undefined && duration !== undefined) out.progressTween = { from, to, start, duration };
  }
  return out;
}

/** Why an authored effect is not clean (unknown preset, junk fields, out-of-range values), or null when it is. */
export function shaderEffectProblem(raw: unknown): string | null {
  const clean = sanitizeShaderEffect(raw);
  if (!clean) {
    const preset = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).preset : undefined;
    return `has unknown preset "${String(preset)}" (use ${SHADER_EFFECT_PRESETS.join(' | ')})`;
  }
  return JSON.stringify(canon(clean)) === JSON.stringify(canon(raw)) ? null : 'has unknown fields or values out of range';
}

export interface ResolvedShaderEffect {
  preset: ShaderEffectPreset;
  color: string;
  intensity: number;
  /** Effect clock: timeline seconds × speed (deterministic: scrubbing and frame-stepped exports match). */
  t: number;
  progress: number;
}

/** Dissolve progress at a timeline time: the tween (smoothstep eased) when present, else the static value. */
export function shaderEffectProgress(effect: ShaderEffect, time: number): number {
  const tw = effect.progressTween;
  if (tw) {
    const k = tw.duration > 0 ? Math.max(0, Math.min(1, (time - tw.start) / tw.duration)) : time >= tw.start ? 1 : 0;
    return tw.from + (tw.to - tw.from) * (k * k * (3 - 2 * k));
  }
  return effect.progress ?? 0;
}

/** Everything a renderer needs at one timeline time (defaults applied, values clamped). */
export function resolveShaderEffect(effect: ShaderEffect, time: number): ResolvedShaderEffect {
  const clean = sanitizeShaderEffect(effect) || { preset: 'hologram' as const };
  return {
    preset: clean.preset,
    color: clean.color || SHADER_EFFECT_INFO[clean.preset].color,
    intensity: clean.intensity ?? 1,
    t: time * (clean.speed ?? 1),
    progress: Math.max(0, Math.min(1, shaderEffectProgress(clean, time))),
  };
}

/** Shadow casting under an effect (same rule in both backends): holograms cast none, a dissolve stops at half way. */
export function shaderEffectCastsShadow(r: Pick<ResolvedShaderEffect, 'preset' | 'progress'>): boolean {
  if (r.preset === 'hologram') return false;
  if (r.preset === 'dissolve') return r.progress < 0.5;
  return true;
}
