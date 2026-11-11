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
}

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
    view = engine === '2d' ? new View2D(frame, runtimes['2d'], input, resolveUrl) : new View3D(frame, runtimes['3d'], input, resolveUrl, quality);
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
