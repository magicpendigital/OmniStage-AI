/**
 * Phase 4 — Motion easing library (GSAP-style curve names, zero dependencies).
 * Used by the 2D keyframe interpolator, the 3D camera keyframe sequencer and the standalone exporter.
 * Every function maps t ∈ [0, 1] to eased progress with f(0) = 0 and f(1) = 1.
 */
import type { EaseId, EaseRef } from '../types/scene.schema';

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
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EASINGS, value);
}

/** Phase 6: `bezier(x1,y1,x2,y2)` → its four numbers, or null when malformed (x1 / x2 must stay in [0,1] so the curve is a function of t). */
export function parseBezierEase(value: unknown): [number, number, number, number] | null {
  if (typeof value !== 'string') return null;
  const m = /^bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(value);
  if (!m) return null;
  const v = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (v.some((n) => !Number.isFinite(n)) || v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1 || v[1] < -2 || v[1] > 3 || v[3] < -2 || v[3] > 3) return null;
  return v as [number, number, number, number];
}

/** A named curve or a valid cubic-bezier. */
export function isEaseRef(value: unknown): value is EaseRef {
  return isEaseId(value) || parseBezierEase(value) !== null;
}

/** Cubic-bezier progress for t in [0,1] (bisection on x, 48 steps: deterministic, identical to OMNI_EASE). */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 48; i++) {
    s = (lo + hi) / 2;
    const u = 1 - s;
    const x = 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s;
    if (x < t) lo = s;
    else hi = s;
  }
  const u = 1 - s;
  return 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s;
}

/** Clamp t to [0, 1] and apply the named curve or bezier (unknown names fall back to linear). */
export function applyEase(ease: EaseRef | string | undefined, t: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (ease && !isEaseId(ease)) {
    const b = parseBezierEase(ease);
    if (b) return cubicBezierEase(b[0], b[1], b[2], b[3], clamped);
  }
  const fn = ease && isEaseId(ease) ? EASINGS[ease] : EASINGS.linear;
  return fn(clamped);
}

export interface KeyframeSegment<K extends { time: number; ease?: EaseRef }> {
  from: K;
  to: K;
  /** Eased progress between `from` and `to` (may overshoot [0,1] for back/elastic). */
  progress: number;
}

/**
 * Finds the keyframe pair surrounding `time` and returns eased progress using the `from` keyframe's ease.
 * Keyframes need not be sorted. Returns null for an empty track.
 */
export function sampleKeyframes<K extends { time: number; ease?: EaseRef }>(
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
export function easedSplineProgress<K extends { time: number; ease?: EaseRef }>(keyframes: K[], time: number): number {
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
  var B = /^bezier\\(\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\)$/;
  function bezier(name, t) {
    var m = B.exec(name); if (!m) return null;
    var x1 = +m[1], y1 = +m[2], x2 = +m[3], y2 = +m[4];
    if (!isFinite(x1 + y1 + x2 + y2) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || y1 < -2 || y1 > 3 || y2 < -2 || y2 > 3) return null;
    if (t <= 0) return 0; if (t >= 1) return 1;
    var lo = 0, hi = 1, s = t, u, x;
    for (var i = 0; i < 48; i++) { s = (lo + hi) / 2; u = 1 - s; x = 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s; if (x < t) lo = s; else hi = s; }
    u = 1 - s;
    return 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s;
  }
  return function (name, t) {
    t = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
    if (typeof name === 'string' && !Object.prototype.hasOwnProperty.call(E, name)) { var b = bezier(name, t); if (b !== null) return b; }
    return (Object.prototype.hasOwnProperty.call(E, name) ? E[name] : E.linear)(t);
  };
})();
`;
