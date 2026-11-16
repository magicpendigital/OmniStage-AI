/**
 * Phase 8 — Per-device performance profiles (pure data + pure functions; no DOM).
 *
 * Three phone tiers with content budgets (used by the mobile verifier) and the quality settings the Player starts with
 * in app builds. The numbers are reference estimates for 2024–2026 Android / iOS phones, NOT measurements yet: measure
 * on real phones (docs/mobile-performance.md) and update the table. `mid` equals the original MOBILE_REFERENCE budget.
 *
 * The quality ladder is ordered best → worst. A tier starts on its `startRung`; the adaptive governor
 * (src/runtime/qualityGovernor.ts) steps down the ladder when frames are too slow and back up (never above the start
 * rung) with hysteresis.
 */

export type DeviceTier = 'low' | 'mid' | 'high';
export const DEVICE_TIERS: DeviceTier[] = ['low', 'mid', 'high'];

/** off = no shadow maps; basic = light shadow maps only; full = shadow maps + contact-shadow pass. */
export type ShadowQuality = 'off' | 'basic' | 'full';

/** Settings the Player can change while running (no renderer re-creation). */
export interface QualitySettings {
  /** Upper bound for the renderer pixel ratio: min(devicePixelRatio, cap). */
  pixelRatioCap: number;
  shadows: ShadowQuality;
  /** 0..1 share of each 3D particle system that is drawn. */
  particleScale: number;
  /** Bloom post-processing (only where the renderer was created with it: the `high` tier). */
  postFx: boolean;
}

export interface DeviceBudget {
  maxActors3D: number;
  maxNodes2D: number;
  /** Skinned vertices of rigged characters in view at once. */
  maxSkinnedVertices: number;
  maxSkinnedActors: number;
  maxBones: number;
  maxTextureSize: number;
  /** Live particles at once (3D GPU points + 2D emitters, see mobileParticleCount). */
  maxParticles: number;
}

export interface DeviceProfile {
  tier: DeviceTier;
  label: string;
  /** Phones this tier stands for (guide for the measurement docs). */
  examples: string;
  /** Frame rate the governor defends. */
  targetFps: number;
  budget: DeviceBudget;
  /** Index into QUALITY_LADDER the Player starts on. */
  startRung: number;
  /** Player construction-time quality (antialias, water / reflection size, bloom availability). */
  playerQuality: 'low' | 'high' | 'ultra';
}

/** Best → worst. Each step removes the cheapest-to-lose, most expensive-to-keep feature first. */
export const QUALITY_LADDER: QualitySettings[] = [
  { pixelRatioCap: 2, shadows: 'full', particleScale: 1, postFx: true }, // 0 high start
  { pixelRatioCap: 2, shadows: 'full', particleScale: 1, postFx: false }, // 1 bloom off
  { pixelRatioCap: 1.5, shadows: 'basic', particleScale: 1, postFx: false }, // 2 mid start
  { pixelRatioCap: 1.25, shadows: 'basic', particleScale: 0.6, postFx: false }, // 3
  { pixelRatioCap: 1, shadows: 'off', particleScale: 0.5, postFx: false }, // 4 low start
  { pixelRatioCap: 0.75, shadows: 'off', particleScale: 0.3, postFx: false }, // 5 floor
];

export const DEVICE_PROFILES: Record<DeviceTier, DeviceProfile> = {
  low: {
    tier: 'low',
    label: 'Low-end phone',
    examples: '2–3 GB RAM, 4–8 slow cores, Mali-G52 / Adreno 610 / PowerVR GE8320 (e.g. Galaxy A0x/A1x, Redmi 9–12C)',
    targetFps: 30,
    budget: { maxActors3D: 30, maxNodes2D: 150, maxSkinnedVertices: 60_000, maxSkinnedActors: 6, maxBones: 75, maxTextureSize: 1024, maxParticles: 400 },
    startRung: 4,
    playerQuality: 'low',
  },
  mid: {
    tier: 'mid',
    label: 'Mid-range phone',
    examples: '4–6 GB RAM, Adreno 618–660 / Mali-G68–G78 (e.g. Galaxy A3x/A5x, Pixel 6a, iPhone 11–12)',
    targetFps: 60,
    budget: { maxActors3D: 60, maxNodes2D: 300, maxSkinnedVertices: 150_000, maxSkinnedActors: 12, maxBones: 100, maxTextureSize: 2048, maxParticles: 800 },
    startRung: 2,
    playerQuality: 'high',
  },
  high: {
    tier: 'high',
    label: 'High-end phone',
    examples: '8+ GB RAM, Adreno 730+ / Mali-G710+ / Immortalis / Apple A15+ (e.g. Galaxy S22+, Pixel 8, iPhone 13+)',
    targetFps: 60,
    budget: { maxActors3D: 100, maxNodes2D: 500, maxSkinnedVertices: 300_000, maxSkinnedActors: 20, maxBones: 150, maxTextureSize: 4096, maxParticles: 2000 },
    startRung: 0,
    playerQuality: 'ultra',
  },
};

export function isDeviceTier(v: unknown): v is DeviceTier {
  return v === 'low' || v === 'mid' || v === 'high';
}

// ---------------------------------------------------------------------------
// Tier detection
// ---------------------------------------------------------------------------

/** What the browser tells us about the device (every field optional: browsers hide some). */
export interface DeviceSignals {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory (GB, Chrome only, rounded down to 0.25 / 0.5 / 1 / 2 / 4 / 8). */
  memoryGb?: number;
  /** UNMASKED_RENDERER_WEBGL (WEBGL_debug_renderer_info) or the plain RENDERER string. */
  gpu?: string;
  /** CSS px and devicePixelRatio. */
  screen?: { width: number; height: number; dpr: number };
  /** Touch-first device (phone / tablet). */
  touch?: boolean;
}

export type GpuClass = 'low' | 'mid' | 'high' | 'software' | 'unknown';

/** Rough GPU class from the renderer string. Unknown strings (and Safari's generic "Apple GPU") stay 'unknown'. */
export function classifyGpu(gpu: string | undefined): GpuClass {
  const g = (gpu || '').trim();
  if (!g) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(g)) return 'software';
  const adreno = /adreno[^0-9]*(\d{3})/i.exec(g);
  if (adreno) {
    const n = Number(adreno[1]);
    if (n < 618) return 'low';
    if (n < 730) return 'mid';
    return 'high';
  }
  if (/immortalis/i.test(g)) return 'high';
  const mali = /mali-?\s*([gt])?(\d+)/i.exec(g);
  if (mali) {
    const series = (mali[1] || '').toLowerCase();
    const n = Number(mali[2]);
    if (series !== 'g') return 'low'; // Mali-4xx / T-series
    if (n >= 700 && n < 1000) return 'high'; // G710 / G715 / G720
    if (n >= 610 && n < 700) return 'mid'; // G610 / G615
    if (n >= 68 && n < 100) return 'mid'; // G68 / G72 / G76 / G77 / G78
    return 'low'; // G31 / G51 / G52 / G57
  }
  if (/powervr|sgx|ge8\d{3}|img\b/i.test(g)) return 'low';
  if (/xclipse/i.test(g)) return 'high';
  if (/apple (m\d|a1[5-9])/i.test(g)) return 'high';
  if (/nvidia|geforce|quadro|radeon|intel.*(iris|arc)|apple m\d/i.test(g)) return 'high';
  if (/intel/i.test(g)) return 'mid';
  return 'unknown';
}

export interface TierDetection {
  tier: DeviceTier;
  gpuClass: GpuClass;
  /** Short human-readable reasons, shown in the profile report. */
  reasons: string[];
}

/** Physical pixels above which a mid GPU should not render at full DPR (≈ 1440p phones). */
const LARGE_SCREEN_PX = 3_700_000;

/**
 * Picks a tier from browser signals. Conservative: any strong "weak" signal (software / low GPU, ≤ 3 GB RAM, ≤ 4 cores
 * on a touch device) gives `low`; `high` needs a high-class GPU (or 8 GB + 8 cores when the GPU is hidden) and no weak
 * signal. Everything else is `mid`.
 */
export function detectDeviceTier(s: DeviceSignals): TierDetection {
  const reasons: string[] = [];
  const gpuClass = classifyGpu(s.gpu);
  if (s.gpu) reasons.push(`GPU "${s.gpu.slice(0, 60)}" → ${gpuClass}`);
  else reasons.push('GPU hidden');
  const touch = s.touch !== false;
  const mem = typeof s.memoryGb === 'number' && s.memoryGb > 0 ? s.memoryGb : undefined;
  const cores = typeof s.cores === 'number' && s.cores > 0 ? s.cores : undefined;
  if (mem !== undefined) reasons.push(`${mem} GB RAM`);
  if (cores !== undefined) reasons.push(`${cores} cores`);
  const px = s.screen ? Math.round(s.screen.width * s.screen.height * s.screen.dpr * s.screen.dpr) : undefined;
  if (px !== undefined) reasons.push(`${(px / 1e6).toFixed(1)} M physical px`);

  if (gpuClass === 'software') return { tier: 'low', gpuClass, reasons: [...reasons, 'software rendering'] };
  if (gpuClass === 'low') return { tier: 'low', gpuClass, reasons: [...reasons, 'entry-level GPU'] };
  if (mem !== undefined && mem <= 3) return { tier: 'low', gpuClass, reasons: [...reasons, 'little memory'] };
  if (touch && cores !== undefined && cores <= 4) return { tier: 'low', gpuClass, reasons: [...reasons, 'few cores'] };

  const memOk = mem === undefined || mem >= 6;
  const coresOk = cores === undefined || cores >= 6;
  if (gpuClass === 'high' && memOk && coresOk) return { tier: 'high', gpuClass, reasons: [...reasons, 'high-end GPU'] };
  if (gpuClass === 'unknown' && mem !== undefined && mem >= 8 && cores !== undefined && cores >= 8) {
    return { tier: 'high', gpuClass, reasons: [...reasons, '8 GB+ and 8+ cores'] };
  }
  if (!touch && gpuClass === 'high') return { tier: 'high', gpuClass, reasons: [...reasons, 'desktop GPU'] };
  if (px !== undefined && px > LARGE_SCREEN_PX && gpuClass !== 'high') reasons.push('large screen: pixel ratio capped');
  return { tier: 'mid', gpuClass, reasons: [...reasons, 'default'] };
}

/** Start settings for a tier: its ladder rung. */
export function tierSettings(tier: DeviceTier): QualitySettings {
  return { ...QUALITY_LADDER[DEVICE_PROFILES[tier].startRung] };
}

/** Pixel ratio the renderer should use for the device DPR under the given settings. */
export function effectivePixelRatio(devicePixelRatio: number, settings: QualitySettings): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(0.5, Math.min(dpr, settings.pixelRatioCap));
}
