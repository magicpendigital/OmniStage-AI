/**
 * Phase 4 — Motion easing library (GSAP-style curve names, zero dependencies).
 * Used by the 2D keyframe interpolator, the 3D camera keyframe sequencer and the standalone exporter.
 * Every function maps t ∈ [0, 1] to eased progress with f(0) = 0 and f(1) = 1.
 */
import type { EaseId } from '../types/scene.schema';

const c1 = 1.70158;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const EASINGS: Record<EaseId, (t: number) => number> = {
  linear: (t) => t,
  'sine.inOut': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  'power1.out': (t) => 1 - (1 - t) * (1 - t),
  'power2.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'power3.out': (t) => 1 - Math.pow(1 - t, 4),
  'expo.out': (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  'back.out': (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  'elastic.out': (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
  'bounce.out': bounceOut,
};

export const EASE_IDS = Object.keys(EASINGS) as EaseId[];

export function isEaseId(value: unknown): value is EaseId {
  return typeof value === 'string' && value in EASINGS;
}

/** Clamp t to [0, 1] and apply the named curve (unknown names fall back to linear). */
export function applyEase(ease: EaseId | string | undefined, t: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const fn = ease && isEaseId(ease) ? EASINGS[ease] : EASINGS.linear;
  return fn(clamped);
}

export interface KeyframeSegment<K extends { time: number; ease?: EaseId }> {
  from: K;
  to: K;
  /** Eased progress between `from` and `to` (may overshoot [0,1] for back/elastic). */
  progress: number;
}

/**
 * Finds the keyframe pair surrounding `time` and returns eased progress using the `from` keyframe's ease.
 * Keyframes need not be sorted. Returns null for an empty track.
 */
export function sampleKeyframes<K extends { time: number; ease?: EaseId }>(
  keyframes: K[],
  time: number
): KeyframeSegment<K> | null {
  if (!keyframes.length) return null;
  const keys = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= keys[0].time) return { from: keys[0], to: keys[0], progress: 0 };
  const last = keys[keys.length - 1];
  if (time >= last.time) return { from: last, to: last, progress: 1 };
  const nextIdx = keys.findIndex((k) => k.time > time);
  const from = keys[nextIdx - 1];
  const to = keys[nextIdx];
  const raw = (time - from.time) / Math.max(0.0001, to.time - from.time);
  return { from, to, progress: applyEase(from.ease, raw) };
}

/**
 * Maps global timeline progress u ∈ [0,1] across N keyframes onto eased spline progress, so a
 * CatmullRom curve through the keyframes honours per-segment easing and keyframe timing.
 */
export function easedSplineProgress<K extends { time: number; ease?: EaseId }>(keyframes: K[], time: number): number {
  const keys = [...keyframes].sort((a, b) => a.time - b.time);
  if (keys.length < 2) return 0;
  if (time <= keys[0].time) return 0;
  if (time >= keys[keys.length - 1].time) return 1;
  const nextIdx = keys.findIndex((k) => k.time > time);
  const segment = nextIdx - 1;
  const raw = (time - keys[segment].time) / Math.max(0.0001, keys[nextIdx].time - keys[segment].time);
  return (segment + applyEase(keys[segment].ease, raw)) / (keys.length - 1);
}

/**
 * Standalone (exportable) source for the exporter's inline runtime. Kept in sync with EASINGS by
 * tests/easing.test.ts, which evaluates both and compares samples.
 */
export const EASING_RUNTIME_SOURCE = `
var OMNI_EASE = (function () {
  var c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3;
  function bounceOut(t) { var n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375; }
  var E = {
    'linear': function (t) { return t; },
    'sine.inOut': function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    'power1.out': function (t) { return 1 - (1 - t) * (1 - t); },
    'power2.inOut': function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    'power3.out': function (t) { return 1 - Math.pow(1 - t, 4); },
    'expo.out': function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    'back.out': function (t) { return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    'elastic.out': function (t) { return t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; },
    'bounce.out': bounceOut
  };
  return function (name, t) { t = Math.max(0, Math.min(1, isFinite(t) ? t : 0)); return (E[name] || E.linear)(t); };
})();
`;
