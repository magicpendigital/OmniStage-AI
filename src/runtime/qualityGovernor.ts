/**
 * Phase 8 — Adaptive quality governor + profile report (pure; time comes from the caller).
 *
 * The Player feeds it the real frame time of every requestAnimationFrame frame in app builds. Frames are averaged over a
 * window; a window slower than the budget steps the quality ladder down, and a run of windows that hold the target
 * steps it back up (never above the tier's start rung). Hysteresis:
 * - down needs avg > budget × downFactor, up needs `upWindows` consecutive windows at avg ≤ budget × upFactor;
 * - after any step the next window is discarded (shader compiles / resize hitch) and `cooldownMs` must pass;
 * - stepping down within `relockMs` of a step up locks the ceiling there, so the ladder does not oscillate.
 * Frame-stepped playback (MP4 export, `manual(true)`, tests) never calls it.
 */
import { DEVICE_PROFILES, DeviceTier, QUALITY_LADDER, QualitySettings, TierDetection } from './deviceProfiles';

export interface GovernorOptions {
  tier: DeviceTier;
  /** Defaults to the tier's targetFps. */
  targetFps?: number;
  /** Start rung (defaults to the tier's start rung); also the best rung the governor may climb back to. */
  startRung?: number;
  windowFrames?: number;
  downFactor?: number;
  upFactor?: number;
  upWindows?: number;
  cooldownMs?: number;
  relockMs?: number;
  /** Frames longer than this are hitches (tab switch, GC, loading) and are ignored. */
  maxFrameMs?: number;
  /** false = measure and report only, never change quality. */
  adaptive?: boolean;
}

export interface GovernorStep {
  atMs: number;
  from: number;
  to: number;
  /** Average frame time (ms) of the window that caused the step. */
  avgMs: number;
  reason: 'slow' | 'recovered';
}

export interface PerfReport {
  version: 1;
  tier: DeviceTier;
  reasons: string[];
  gpuClass?: string;
  targetFps: number;
  startRung: number;
  rung: number;
  /** Best rung the governor may still climb to (lowered by oscillation locks). */
  ceiling: number;
  settings: QualitySettings;
  frames: number;
  /** fps of the last full window, the slowest window and the whole session (measured frames only). */
  fps: { last: number; worstWindow: number; average: number };
  steps: GovernorStep[];
  /** Device facts (for filling the measurement table). */
  device?: { userAgent?: string; screen?: string; dpr?: number };
}

export interface QualityGovernor {
  readonly rung: number;
  settings(): QualitySettings;
  /** Feed one frame. Returns the new rung when the quality changed, else null. */
  sample(frameMs: number, nowMs: number): GovernorStep | null;
  /** Forget the current window (after a pause / resume). */
  resetWindow(): void;
  report(): PerfReport;
}

export function createQualityGovernor(opts: GovernorOptions, detection?: Pick<TierDetection, 'reasons' | 'gpuClass'>): QualityGovernor {
  const profile = DEVICE_PROFILES[opts.tier];
  const targetFps = opts.targetFps ?? profile.targetFps;
  const budgetMs = 1000 / targetFps;
  const last = QUALITY_LADDER.length - 1;
  const startRung = Math.max(0, Math.min(last, opts.startRung ?? profile.startRung));
  const windowFrames = opts.windowFrames ?? 90;
  const downFactor = opts.downFactor ?? 1.2;
  const upFactor = opts.upFactor ?? 1.05;
  const upWindows = opts.upWindows ?? 4;
  const cooldownMs = opts.cooldownMs ?? 3000;
  const relockMs = opts.relockMs ?? 20000;
  const maxFrameMs = opts.maxFrameMs ?? 250;

  let rung = startRung;
  let ceiling = startRung;
  let winSum = 0;
  let winCount = 0;
  let skipWindow = false;
  let goodWindows = 0;
  let lastStepAt = -Infinity;
  let lastUpAt = -Infinity;
  let frames = 0;
  let totalMs = 0;
  let lastFps = 0;
  let worstFps = 0;
  const steps: GovernorStep[] = [];

  const step = (to: number, avgMs: number, nowMs: number, reason: GovernorStep['reason']): GovernorStep => {
    const s: GovernorStep = { atMs: Math.round(nowMs), from: rung, to, avgMs: Math.round(avgMs * 10) / 10, reason };
    if (reason === 'slow' && nowMs - lastUpAt < relockMs) ceiling = Math.max(ceiling, to);
    if (reason === 'recovered') lastUpAt = nowMs;
    rung = to;
    lastStepAt = nowMs;
    goodWindows = 0;
    skipWindow = true;
    steps.push(s);
    if (steps.length > 50) steps.shift();
    return s;
  };

  return {
    get rung() {
      return rung;
    },
    settings: () => ({ ...QUALITY_LADDER[rung] }),
    resetWindow: () => {
      winSum = 0;
      winCount = 0;
    },
    sample(frameMs, nowMs) {
      if (!(frameMs > 0) || frameMs > maxFrameMs) return null;
      frames++;
      totalMs += frameMs;
      winSum += frameMs;
      winCount++;
      if (winCount < windowFrames) return null;
      const avg = winSum / winCount;
      winSum = 0;
      winCount = 0;
      lastFps = Math.round(1000 / avg);
      worstFps = worstFps ? Math.min(worstFps, lastFps) : lastFps;
      if (skipWindow) {
        skipWindow = false;
        return null;
      }
      if (opts.adaptive === false) return null;
      const cooled = nowMs - lastStepAt >= cooldownMs;
      if (avg > budgetMs * downFactor) {
        goodWindows = 0;
        if (cooled && rung < last) return step(rung + 1, avg, nowMs, 'slow');
        return null;
      }
      if (avg <= budgetMs * upFactor) {
        goodWindows++;
        if (cooled && rung > ceiling && goodWindows >= upWindows) return step(rung - 1, avg, nowMs, 'recovered');
      } else goodWindows = 0;
      return null;
    },
    report: () => ({
      version: 1,
      tier: opts.tier,
      reasons: detection?.reasons ? [...detection.reasons] : [],
      gpuClass: detection?.gpuClass,
      targetFps,
      startRung,
      rung,
      ceiling,
      settings: { ...QUALITY_LADDER[rung] },
      frames,
      fps: { last: lastFps, worstWindow: worstFps, average: frames ? Math.round((1000 * frames) / totalMs) : 0 },
      steps: steps.slice(),
    }),
  };
}

/** Plain-text report for the debug overlay / copy-paste into the measurement sheet. */
export function formatPerfReport(r: PerfReport): string {
  const s = r.settings;
  const lines = [
    `tier ${r.tier} · target ${r.targetFps} fps · rung ${r.rung} (start ${r.startRung}, ceiling ${r.ceiling})`,
    `fps last ${r.fps.last} · worst window ${r.fps.worstWindow} · avg ${r.fps.average} · ${r.frames} frames`,
    `pixel ratio ≤ ${s.pixelRatioCap} · shadows ${s.shadows} · particles ${Math.round(s.particleScale * 100)}% · post FX ${s.postFx ? 'on' : 'off'}`,
    `why: ${r.reasons.join('; ') || '-'}`,
  ];
  if (r.device) lines.push(`device: ${r.device.screen || ''} dpr ${r.device.dpr ?? '?'} · ${r.device.userAgent || ''}`);
  for (const st of r.steps.slice(-6)) lines.push(`  ${(st.atMs / 1000).toFixed(1)}s ${st.reason === 'slow' ? '↓' : '↑'} ${st.from}→${st.to} (avg ${st.avgMs} ms)`);
  return lines.join('\n');
}
