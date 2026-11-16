/**
 * Phase 8 — Device tier + adaptive quality for app builds (PWA / Android / iOS). Ad exports never create this.
 *
 * At start: read browser signals, pick a tier (src/runtime/deviceProfiles.ts) and its start settings. Every real
 * requestAnimationFrame frame goes to the governor (src/runtime/qualityGovernor.ts); quality changes are pushed to the
 * 3D view. The governor's clock is the sum of measured frame times, so pauses and frame-stepped playback never count.
 * A hidden overlay shows the profile report: 5 quick taps in the top-left corner, or `?omniPerf=1` in the URL.
 */
import { DeviceSignals, DeviceTier, DEVICE_PROFILES, detectDeviceTier, isDeviceTier, QualitySettings, TierDetection } from '../runtime/deviceProfiles';
import { createQualityGovernor, formatPerfReport, PerfReport, QualityGovernor } from '../runtime/qualityGovernor';
import { isTouchDevice } from './input';
import type { NativeBridge } from './native';

export interface AppPerfOptions {
  /** 'auto' (default) detects the tier; a fixed tier skips detection. */
  tier?: 'auto' | DeviceTier;
  /** false keeps the start settings for the whole session. */
  governor?: boolean;
}

export function readDeviceSignals(win: any = window): DeviceSignals {
  const nav = win.navigator || {};
  let gpu: string | undefined;
  try {
    const canvas = win.document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '') || undefined;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* GPU string is optional */
  }
  return {
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    gpu,
    screen: { width: win.screen?.width || win.innerWidth || 0, height: win.screen?.height || win.innerHeight || 0, dpr: win.devicePixelRatio || 1 },
    touch: isTouchDevice(),
  };
}

function urlParam(name: string): string | null {
  try {
    const q = new URLSearchParams(location.search).get(name);
    if (q !== null) return q;
    return new URLSearchParams(location.hash.replace(/^#/, '')).get(name);
  } catch {
    return null;
  }
}

const QUALITY_TIER: Record<string, DeviceTier> = { low: 'low', high: 'mid', ultra: 'high' };

export interface PerfMonitor {
  tier: DeviceTier;
  playerQuality: 'low' | 'high' | 'ultra';
  settings: () => QualitySettings;
  /** One real frame (ms between two rAF callbacks). */
  frame: (frameMs: number) => void;
  /** After pause / resume: drop the partial window and save the report. */
  pause: () => void;
  resume: () => void;
  report: () => PerfReport;
  destroy: () => void;
}

export function createPerfMonitor(opts: {
  root: HTMLElement;
  app: AppPerfOptions & { saveKey: string; saves?: boolean };
  quality?: string;
  native: NativeBridge | null;
  onChange: (settings: QualitySettings) => void;
}): PerfMonitor {
  const forced = urlParam('omniTier');
  let detection: TierDetection;
  if (isDeviceTier(forced)) detection = { tier: forced, gpuClass: 'unknown', reasons: ['forced by ?omniTier'] };
  else if (isDeviceTier(opts.app.tier)) detection = { tier: opts.app.tier, gpuClass: 'unknown', reasons: ['fixed in the build'] };
  else if (opts.quality && QUALITY_TIER[opts.quality]) detection = { tier: QUALITY_TIER[opts.quality], gpuClass: 'unknown', reasons: [`quality "${opts.quality}" in the build`] };
  else detection = detectDeviceTier(readDeviceSignals());
  const tier = detection.tier;
  const governing = opts.app.governor !== false && urlParam('omniGovernor') !== '0';
  const gov: QualityGovernor = createQualityGovernor({ tier, adaptive: governing }, detection);
  const device = { userAgent: navigator.userAgent, screen: `${screen.width}×${screen.height}`, dpr: window.devicePixelRatio || 1 };
  let clock = 0;
  const report = (): PerfReport => ({ ...gov.report(), device });

  const storeKey = opts.native && opts.app.saves !== false ? `omnistage.perf.${opts.app.saveKey.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)}` : null;
  const persist = () => {
    if (storeKey) opts.native!.save(storeKey, JSON.stringify(report()));
  };

  // Hidden overlay.
  let overlay: HTMLDivElement | null = null;
  let overlayTimer = 0;
  const render = () => {
    if (overlay) overlay.querySelector('pre')!.textContent = formatPerfReport(report());
  };
  const toggleOverlay = () => {
    if (overlay) {
      overlay.remove();
      overlay = null;
      clearInterval(overlayTimer);
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'omni-perf';
    overlay.style.cssText =
      'position:absolute;left:6px;top:6px;z-index:60;max-width:min(92vw,520px);background:rgba(2,6,23,.86);color:#A7F3D0;font:500 10px/1.35 ui-monospace,monospace;padding:6px 8px;border-radius:8px;pointer-events:auto;user-select:text;-webkit-user-select:text';
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;white-space:pre-wrap';
    const copy = document.createElement('button');
    copy.textContent = 'Copy JSON';
    copy.style.cssText = 'margin-top:4px;font:600 10px system-ui;padding:2px 8px;border-radius:6px;border:1px solid #34d399;background:transparent;color:#A7F3D0';
    copy.onclick = (e) => {
      e.stopPropagation();
      const text = JSON.stringify(report(), null, 2);
      Promise.resolve(navigator.clipboard?.writeText(text)).then(() => (copy.textContent = 'Copied'), () => (copy.textContent = 'Copy failed'));
    };
    overlay.append(pre, copy);
    opts.root.appendChild(overlay);
    render();
    overlayTimer = window.setInterval(render, 500);
  };
  let taps: number[] = [];
  const onTap = (e: PointerEvent) => {
    const r = opts.root.getBoundingClientRect();
    if (e.clientX - r.left > Math.max(48, r.width * 0.12) || e.clientY - r.top > Math.max(48, r.height * 0.08)) return;
    const now = performance.now();
    taps = [...taps.filter((t) => now - t < 2500), now];
    if (taps.length >= 5) {
      taps = [];
      toggleOverlay();
    }
  };
  opts.root.addEventListener('pointerdown', onTap, true);
  if (urlParam('omniPerf') === '1') toggleOverlay();

  return {
    tier,
    playerQuality: DEVICE_PROFILES[tier].playerQuality,
    settings: () => gov.settings(),
    frame: (frameMs) => {
      if (!(frameMs > 0)) return;
      clock += Math.min(frameMs, 250);
      const step = gov.sample(frameMs, clock);
      if (step) {
        opts.onChange(gov.settings());
        persist();
      }
    },
    pause: () => {
      gov.resetWindow();
      persist();
    },
    resume: () => gov.resetWindow(),
    report,
    destroy: () => {
      opts.root.removeEventListener('pointerdown', onTap, true);
      clearInterval(overlayTimer);
      overlay?.remove();
    },
  };
}
