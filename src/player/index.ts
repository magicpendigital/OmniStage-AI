/**
 * Phase 7 — OmniStage Player: one framework-free runtime for Play Test, phone preview and every export.
 *
 * It binds the shared runtime (logic graph, 2D simulation, game rules — the same code the studio runs) to its own
 * vanilla store, renders 2D with the studio's frame step and 3D with plain Three.js, and adds unified input
 * (keyboard / touch / gamepad), HUD, end cards, level progression, procedural audio and ad-network CTA bridges.
 */
import { bindRuntimeStore } from '../runtime/host';
import { RuntimeLogicGraph } from '../runtime/logicGraph';
import { installAudioBus } from '../audio/audioBus';
import type { SceneSpec } from '../types/scene.schema';
import { createPlayerStore, nextSceneIdFor, PlayerStore } from './playerStore';
import { InputManager, isTouchDevice } from './input';
import { View2D } from './view2d';
import { QualityLevel, View3D } from './view3d';
import { transitionInto, transitionOverlay } from '../runtime/cinematics';
import { Hud, PLAYER_CSS } from './hud';
import { pendingLoads } from './loading';
import { registerVoiceAssets } from '../audio/voices';
import { setNodeBackend } from '../render3d/backend';

export interface OmniPlayerData {
  scenes: SceneSpec[];
  activeSceneId?: string;
}

export interface OmniPlayerOptions {
  network?: string;
  /** 'auto' picks 'low' on touch devices with few cores / little memory. */
  quality?: 'auto' | QualityLevel;
  touchControls?: boolean | 'auto';
  /** Exported asset URL → data URI (embedded GLB / images) so the build works offline. */
  assets?: Record<string, string>;
  sound?: boolean;
  /** Phase 7: 'webgpu' / 'auto' use WebGPU where the device has it (WebGPU build of the Player only), else WebGL. */
  renderer?: 'webgl' | 'webgpu' | 'auto';
}

/** true only in the WebGPU build of the Player (scripts/build-player.mjs defines it); undefined in the studio. */
declare const __OMNI_WEBGPU__: boolean | undefined;

export interface OmniPlayerHandle {
  store: PlayerStore;
  restart: () => void;
  destroy: () => void;
  /** Advance one frame manually (deterministic tests / headless capture). */
  step: (dt: number) => void;
  /** Phase 7C: stop (true) or restart (false) the requestAnimationFrame loop so only step() advances time (E2E tests). */
  manual: (on: boolean) => void;
  /** Phase 7C: runtime-only state for tests (2D physics bodies live outside the store). */
  inspect: () => {
    engine: string;
    bodies2D: Record<string, { x: number; y: number; collected: boolean }>;
    view3d?: ReturnType<View3D['inspect']>;
  };
  /** Phase 10B: asset loads still in flight (frame-stepped capture waits for 0). */
  pendingLoads: () => number;
  /** Phase 7: which renderer the 3D view uses ('pending' while WebGPU initialises). */
  backend: () => 'webgl' | 'webgpu' | 'pending';
  /** Phase 10C: lay the frame out now (headless capture: off-screen iframes may never run ResizeObserver). */
  relayout: () => void;
  /** Phase 10B: the stage canvas currently shown (2D or 3D). */
  canvas: () => HTMLCanvasElement | null;
  /** Hold or release a logical key ('arrowright', ' ', …) as if pressed (tests / accessibility tools). */
  setKey: (key: string, down: boolean) => void;
}

function pickQuality(q: OmniPlayerOptions['quality']): QualityLevel {
  if (q === 'low' || q === 'high' || q === 'ultra') return q;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || (navigator.hardwareConcurrency || 8) <= 4;
  return isTouchDevice() && weak ? 'low' : 'high';
}

function aspectOf(spec: SceneSpec) {
  return spec.aspectRatio === '9:16' ? 9 / 16 : spec.aspectRatio === '1:1' ? 1 : 16 / 9;
}

export function createOmniPlayer(root: HTMLElement, data: OmniPlayerData, options: OmniPlayerOptions = {}): OmniPlayerHandle {
  if (!data.scenes?.length) throw new Error('OmniStage Player needs at least one scene');
  const style = document.createElement('style');
  style.textContent = PLAYER_CSS;
  document.head.appendChild(style);
  root.classList.add('omni-root');
  const frame = document.createElement('div');
  frame.className = 'omni-frame';
  root.appendChild(frame);

  // Phase 10C: generated voice clips embedded in the export (WAV data URIs) → voice registry.
  registerVoiceAssets(options.assets);
  const store = createPlayerStore(data.scenes, data.activeSceneId);
  bindRuntimeStore(store);
  const uninstallAudio = options.sound === false ? () => undefined : installAudioBus(store);
  const runtimes = { '2d': new RuntimeLogicGraph('2d'), '3d': new RuntimeLogicGraph('3d') };
  const runtimeFor = () => runtimes[store.getState().sceneSpec.engineType];
  const input = new InputManager({ onKeyPress: (key, code) => runtimeFor().emit('key-press', { key, code }) });
  const assets = options.assets || {};
  const resolveUrl = (url: string) => assets[url] || url;
  const quality = pickQuality(options.quality);
  const touch = options.touchControls === 'auto' || options.touchControls === undefined ? isTouchDevice() : options.touchControls;

  // Phase 7: optional WebGPU. Frames wait until the device is ready; without a WebGPU adapter the Player stays on WebGL.
  let backend: 'webgl' | 'webgpu' | 'pending' = 'webgl';
  let sharedRenderer: any = null;
  const wantsGpu = options.renderer === 'webgpu' || options.renderer === 'auto';
  if (wantsGpu && typeof __OMNI_WEBGPU__ !== 'undefined' && __OMNI_WEBGPU__) {
    backend = 'pending';
    import('../render3d/webgpu')
      .then(async (m) => {
        const r = await m.createWebGPURenderer({ antialias: quality !== 'low' });
        if (r) {
          setNodeBackend(m.webgpuBackend);
          sharedRenderer = r;
          backend = 'webgpu';
        } else backend = 'webgl';
      })
      .catch(() => { backend = 'webgl'; });
  }

  const ctaUrl = () => store.getState().sceneSpec.marketingOverlay?.ctaUrl || '';
  const openCta = () => {
    const w = window as any;
    const url = ctaUrl();
    if (w.Telegram?.WebApp) {
      w.Telegram.WebApp.HapticFeedback?.impactOccurred?.('medium');
      if (url) w.Telegram.WebApp.openLink?.(url);
    } else if (w.mraid?.open) {
      w.mraid.open(url || 'about:blank');
    } else if (w.FbPlayableAd?.onCTAClick) {
      w.FbPlayableAd.onCTAClick();
    } else {
      hud.showNotice(`${store.getState().sceneSpec.marketingOverlay?.ctaText || 'CTA'} → ${url || '(no URL set)'}`);
    }
  };

  const restartScene = () => {
    store.getState().resetGameSession();
    store.setState({ isPlaying: true, currentTime: 0 });
  };
  // Phase 10A: fade in from the target scene's transition colour (cut = none).
  const fade = document.createElement('div');
  fade.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:5;transition-property:opacity';
  frame.appendChild(fade);
  const gotoScene = (id: string) => {
    store.getState().switchScene(id);
    store.setState({ isPlaying: true });
    const overlay = transitionOverlay(transitionInto(store.getState().scenes.find((s) => s.id === id)));
    if (overlay) {
      fade.style.transitionDuration = '0ms';
      fade.style.background = overlay.color;
      fade.style.opacity = '1';
      void fade.offsetWidth; // restart the transition
      fade.style.transitionDuration = `${overlay.ms}ms`;
      fade.style.opacity = '0';
    }
  };

  const hud = new Hud(frame, input, {
    onNext: () => {
      const next = nextSceneIdFor(store.getState());
      if (next) gotoScene(next);
    },
    onRetry: restartScene,
    onReplay: () => gotoScene(data.activeSceneId && data.scenes.some((s) => s.id === data.activeSceneId) ? data.activeSceneId : store.getState().scenes[0].id),
    onCta: openCta,
  }, { touch, fullscreenTarget: root });

  let view: View2D | View3D | null = null;
  let viewEngine = '';
  const ensureView = () => {
    const engine = store.getState().sceneSpec.engineType;
    if (engine === viewEngine && view) return;
    view?.dispose();
    view = engine === '2d' ? new View2D(frame, runtimes['2d'], input, resolveUrl) : new View3D(frame, runtimes['3d'], input, resolveUrl, quality, sharedRenderer || undefined);
    frame.insertBefore(view.canvas, hud.root);
    viewEngine = engine;
  };

  const layout = () => {
    const spec = store.getState().sceneSpec;
    const aspect = aspectOf(spec);
    const w = root.clientWidth;
    const h = root.clientHeight;
    const width = Math.min(w, h * aspect);
    frame.style.width = `${Math.round(width)}px`;
    frame.style.height = `${Math.round(width / aspect)}px`;
  };
  const ro = new ResizeObserver(layout);
  ro.observe(root);

  const w = window as any;
  w.Telegram?.WebApp?.ready?.();
  w.Telegram?.WebApp?.expand?.();

  let raf = 0;
  let last = performance.now();
  let lastAspect = '';
  const tick = (dt: number) => {
    if (backend === 'pending') return;
    input.pollGamepads();
    ensureView();
    const aspectKey = store.getState().sceneSpec.aspectRatio;
    if (aspectKey !== lastAspect) {
      lastAspect = aspectKey;
      layout();
    }
    view!.frame(dt);

    const s = store.getState();
    const spec = s.sceneSpec;
    const index = Math.max(0, s.scenes.findIndex((x) => x.id === s.activeSceneId));
    hud.update(s, index, s.scenes.length);
    const next = nextSceneIdFor(s);
    const cta = spec.marketingOverlay?.enabled ? spec.marketingOverlay.ctaText : undefined;
    if (spec.mode === 'game') {
      hud.setCard(s.gameEnded ? (s.gameWon ? 'won' : 'lost') : 'none', !!next, cta);
    } else if (!s.isPlaying && s.currentTime >= Math.max(2, spec.durationSeconds || 8) - 0.05) {
      // Media: play the sequence through, then show the end card.
      if (next) gotoScene(next);
      else hud.setCard('media-end', false, cta);
    } else {
      hud.setCard('none', false);
    }
  };
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tick(dt);
  };
  raf = requestAnimationFrame(loop);

  const handle: OmniPlayerHandle = {
    store,
    restart: restartScene,
    step: (dt) => tick(Math.min(Math.max(dt, 0), 0.05)),
    inspect: () => ({
      engine: viewEngine,
      bodies2D: view instanceof View2D ? view.bodyPositions() : {},
      view3d: view instanceof View3D ? view.inspect() : undefined,
    }),
    manual: (on) => {
      cancelAnimationFrame(raf);
      if (!on) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    },
    setKey: (key, down) => input.setVirtualKey(key.toLowerCase(), down),
    pendingLoads,
    backend: () => backend,
    relayout: () => {
      if (backend === 'pending') return;
      ensureView();
      layout();
      if (view instanceof View3D) view.resize();
    },
    canvas: () => (view ? view.canvas : null),
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      uninstallAudio();
      view?.dispose();
      root.replaceChildren();
      style.remove();
    },
  };
  (window as any).__omniPlayer = handle;
  return handle;
}
