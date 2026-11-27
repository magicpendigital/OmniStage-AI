/**
 * Phase 7 — OmniStage Player: one framework-free runtime for Play Test, phone preview and every export.
 *
 * It binds the shared runtime (logic graph, 2D simulation, game rules — the same code the studio runs) to its own
 * vanilla store, renders 2D with the studio's frame step and 3D with plain Three.js, and adds unified input
 * (keyboard / touch / gamepad), HUD, end cards, level progression, procedural audio and ad-network CTA bridges.
 */
import { bindRuntimeStore } from '../runtime/host';
import { RuntimeLogicGraph } from '../runtime/logicGraph';
import { canonicalKeysFor, resolveBindings } from '../runtime/inputMap';
import { installAudioBus } from '../audio/audioBus';
import type { SceneSpec } from '../types/scene.schema';
import { createPlayerStore, nextSceneIdFor, PlayerStore } from './playerStore';
import { InputManager, isTouchDevice } from './input';
import { View2D } from './view2d';
import { QualityLevel, View3D } from './view3d';
import { transitionInto, transitionOverlay } from '../runtime/cinematics';
import { compositorTransition, drawSceneTransition, transitionSeconds, type CompositorTransition } from '../runtime/transitionDraw';
import { Hud, PLAYER_CSS } from './hud';
import { pendingLoads } from './loading';
import { registerVoiceAssets } from '../audio/voices';
import { setNodeBackend } from '../render3d/backend';
import { createNativeBridge, NativeBridge } from './native';
import { parseProgress, progressKey, recordRound, resumeSceneFor, SavedProgress } from '../runtime/progress';
import { AppPerfOptions, createPerfMonitor, PerfMonitor } from './perf';
import type { PerfReport } from '../runtime/qualityGovernor';

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
  /**
   * Phase 8: app builds (PWA / Android / iOS). Turns on haptics, saved progress (best score, resume level) and
   * pause on background. Ad exports leave it unset so their behaviour does not change.
   */
  app?: { saveKey: string; haptics?: boolean; saves?: boolean } & AppPerfOptions;
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
  /** Switches to another scene with its authored transition (what the HUD "Next" button does). */
  gotoScene: (id: string) => void;
  /** True while a canvas-composited transition (crossfade, wipe, whip-pan, iris) is on screen. */
  transitionRunning: () => boolean;
  /** Phase 7C: runtime-only state for tests (2D physics bodies live outside the store). */
  inspect: () => {
    engine: string;
    bodies2D: Record<string, { x: number; y: number; collected: boolean; onGround: boolean; reached: boolean }>;
    /** Phase 2: the 2D camera (world position of the viewport's top-left, zoom). */
    camera2D?: { x: number; y: number; zoom: number };
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
  /** Phase 8: device tier + adaptive quality report (app builds only; null in ad exports). */
  perf: () => PerfReport | null;
  /** Phase 8: feed `count` synthetic frames of `frameMs` to the governor (tests / tuning; app builds only). */
  perfSample: (frameMs: number, count?: number) => void;
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
  /** Escape (and P, unless the scene binds it) opens / closes the pause menu of a running game round. */
  const togglePause = () => {
    const s = store.getState();
    if (s.gamePaused) s.resumeGame();
    else s.pauseGame();
  };
  const input = new InputManager({
    onKeyPress: (key, code) => {
      const scene = store.getState().sceneSpec;
      if (scene.mode === 'game' && (key === 'escape' || (key === 'p' && !Object.values(resolveBindings(scene.input)).some((keys) => keys?.includes('p'))))) togglePause();
      // The logic graph still hears the key (a bomb on P), and a remapped key also counts as the key it stands for.
      runtimeFor().emit('key-press', { key, code });
      for (const canonical of canonicalKeysFor(scene.input, key)) runtimeFor().emit('key-press', { key: canonical, code: canonical });
    },
  });
  const assets = options.assets || {};
  const resolveUrl = (url: string) => assets[url] || url;
  // Phase 8: native bridge (Capacitor plugins inside the app shell, web APIs in a PWA).
  const native: NativeBridge | null = options.app ? createNativeBridge() : null;
  // Phase 8: app builds pick a device tier and adapt quality to measured frame times (src/player/perf.ts).
  let perf: PerfMonitor | null = null;
  if (options.app) {
    perf = createPerfMonitor({
      root,
      app: options.app,
      quality: options.quality,
      native,
      onChange: (s) => {
        if (view instanceof View3D) view.applySettings(s);
      },
    });
  }
  const quality = perf ? perf.playerQuality : pickQuality(options.quality);
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

  const haptic = (kind: Parameters<NativeBridge['haptic']>[0]) => {
    if (native && options.app?.haptics !== false) native.haptic(kind);
  };
  const saveKey = options.app && options.app.saves !== false ? progressKey(options.app.saveKey) : null;
  let progress: SavedProgress | null = null;

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
    store.getState().resetGameSession(); // also clears a pause
    store.setState({ isPlaying: true, currentTime: 0 });
  };
  // Phase 10A: fade in from the target scene's transition colour (cut = none).
  const fade = document.createElement('div');
  fade.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:5;transition-property:opacity';
  frame.appendChild(fade);
  // Phase 11E: dissolve / wipe / whip-pan / iris are drawn from the last frame of the scene we leave (same code as the MP4 export).
  const tCanvas = document.createElement('canvas');
  tCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;display:none';
  frame.appendChild(tCanvas);
  const tSnapshot = document.createElement('canvas');
  let tRaf = 0;
  const stopTransitionCanvas = () => {
    cancelAnimationFrame(tRaf);
    tCanvas.style.display = 'none';
  };
  /** True when the transition is composited here (so the colour overlay is skipped). */
  const startCanvasTransition = (kind: CompositorTransition): boolean => {
    if (manualMode || !view || !view.canvas.width || !view.canvas.height) return false;
    try {
      // Render the current state once more and copy it in the same task: the WebGL buffer is still readable.
      view.frame(0);
      tSnapshot.width = view.canvas.width;
      tSnapshot.height = view.canvas.height;
      tSnapshot.getContext('2d')!.drawImage(view.canvas, 0, 0);
    } catch {
      return false;
    }
    const octx = tCanvas.getContext('2d');
    if (!octx) return false;
    tCanvas.width = tSnapshot.width;
    tCanvas.height = tSnapshot.height;
    tCanvas.style.display = 'block';
    const ms = transitionSeconds(kind) * 1000;
    const t0 = performance.now();
    const stepT = (now: number) => {
      const p = (now - t0) / ms;
      octx.clearRect(0, 0, tCanvas.width, tCanvas.height);
      if (p >= 1) {
        tCanvas.style.display = 'none';
        return;
      }
      drawSceneTransition(octx, tSnapshot, kind, p, tCanvas.width, tCanvas.height);
      tRaf = requestAnimationFrame(stepT);
    };
    cancelAnimationFrame(tRaf);
    drawSceneTransition(octx, tSnapshot, kind, 0, tCanvas.width, tCanvas.height);
    tRaf = requestAnimationFrame(stepT);
    return true;
  };
  const gotoScene = (id: string) => {
    const incoming = store.getState().scenes.find((s) => s.id === id);
    const kind = compositorTransition(incoming || {}, 'fade-to-black');
    const composited = (kind === 'crossfade' || kind === 'wipe' || kind === 'whip-pan' || kind === 'iris') && incoming?.sequence?.index !== 0 && startCanvasTransition(kind);
    if (!composited) stopTransitionCanvas();
    store.getState().switchScene(id);
    store.setState({ isPlaying: true });
    const overlay = composited ? null : transitionOverlay(transitionInto(incoming));
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
    onPause: togglePause,
    onResume: () => store.getState().resumeGame(),
    onRestart: restartScene,
    onReplay: () => gotoScene(data.activeSceneId && data.scenes.some((s) => s.id === data.activeSceneId) ? data.activeSceneId : store.getState().scenes[0].id),
    onCta: openCta,
  }, { touch, fullscreenTarget: root });

  let view: View2D | View3D | null = null;
  let viewEngine = '';
  const ensureView = () => {
    const engine = store.getState().sceneSpec.engineType;
    if (engine === viewEngine && view) return;
    view?.dispose();
    view = engine === '2d' ? new View2D(frame, runtimes['2d'], input, resolveUrl) : new View3D(frame, runtimes['3d'], input, resolveUrl, quality, sharedRenderer || undefined, perf?.settings());
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
  let lastScore = store.getState().gameScore;
  let endedKey = '';
  const onRoundState = (s: ReturnType<typeof store.getState>) => {
    if (!native) return;
    if (s.gameScore > lastScore) haptic('light');
    lastScore = s.gameScore;
    const key = s.gameEnded ? `${s.activeSceneId}:${s.gameWon}` : '';
    if (key === endedKey) return;
    endedKey = key;
    if (!key || s.sceneSpec.mode !== 'game') return;
    haptic(s.gameWon ? 'success' : 'error');
    if (saveKey && progress) {
      const r = recordRound(progress, { sceneId: s.activeSceneId, score: s.gameScore, won: s.gameWon, nextSceneId: s.gameWon ? nextSceneIdFor(s) : null });
      progress = r.progress;
      native.save(saveKey, JSON.stringify(progress));
      if (r.newBest && s.gameScore > 0) hud.showNotice(`New best: ${s.gameScore}`);
    }
  };
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
    onRoundState(s);
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
    perf?.frame(now - last);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tick(dt);
  };
  raf = requestAnimationFrame(loop);

  // Phase 8: app builds pause in the background (no frames, soundtrack stopped) and resume where they were.
  let manualMode = false;
  let paused = false;
  let wasPlaying = false;
  const unsubscribeLifecycle = native
    ? native.onLifecycle(
        () => {
          if (paused) return;
          paused = true;
          wasPlaying = store.getState().isPlaying;
          cancelAnimationFrame(raf);
          perf?.pause();
          if (wasPlaying) store.setState({ isPlaying: false });
        },
        () => {
          if (!paused) return;
          paused = false;
          perf?.resume();
          if (wasPlaying) store.setState({ isPlaying: true });
          if (!manualMode) {
            last = performance.now();
            raf = requestAnimationFrame(loop);
          }
        }
      )
    : () => undefined;
  if (native && saveKey) {
    const key = saveKey;
    native.load(key).then((raw) => {
      progress = parseProgress(raw);
      const s = store.getState();
      const target = resumeSceneFor(progress, s.scenes.map((x) => x.id), s.activeSceneId);
      if (target !== s.activeSceneId && s.currentTime < 1 && !s.gameEnded) gotoScene(target);
    });
  }

  const handle: OmniPlayerHandle = {
    store,
    restart: restartScene,
    gotoScene,
    transitionRunning: () => tCanvas.style.display !== 'none',
    step: (dt) => tick(Math.min(Math.max(dt, 0), 0.05)),
    inspect: () => ({
      engine: viewEngine,
      bodies2D: view instanceof View2D ? view.bodyPositions() : {},
      camera2D: view instanceof View2D ? view.cameraState() : undefined,
      view3d: view instanceof View3D ? view.inspect() : undefined,
    }),
    manual: (on) => {
      manualMode = on;
      cancelAnimationFrame(raf);
      if (!on && !paused) {
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
    perf: () => (perf ? perf.report() : null),
    perfSample: (frameMs, count = 1) => {
      for (let i = 0; i < count; i++) perf?.frame(frameMs);
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      unsubscribeLifecycle();
      perf?.destroy();
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
