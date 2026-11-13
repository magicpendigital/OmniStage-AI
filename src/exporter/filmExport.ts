/**
 * Phase 10B — frame-perfect MP4 export with sound.
 *
 * The film runs inside a hidden iframe on the real exported OmniStage Player (same HTML as Publish → HTML5), with
 * its clock stopped: every video frame is one `step(1/fps)`, so acting, shots and transitions land exactly on their
 * frames however slow the machine is. Frames are composited (letterbox, transitions, 3D captions, watermark) and
 * encoded with WebCodecs through Mediabunny; the procedural soundtrack is rendered offline for the whole film and
 * muxed as AAC (or Opus). Browsers without WebCodecs keep the real-time MediaRecorder sequencer.
 */
import { sceneCaptions } from '../audio/voices';
import type { SceneSpec } from '../types/scene.schema';
import { renderFilmSoundtrack } from '../audio/soundtrack';
import { voiceClipAssets } from '../audio/voices';
import { activeCaptions, drawCaptionOnCanvas } from '../media/captions';
import { generatePlayerHTML } from './playerHtml';
import {
  compositorTransition, downloadBlob, drawSceneTransition, drawWatermark, loadPlayerRuntime, slugifyTitle,
} from './mediaExporter';

export interface FilmExportProgress {
  phase: 'preparing' | 'loading' | 'rendering' | 'finalizing' | 'completed';
  /** 0..1 over the whole export */
  ratio: number;
  sceneIndex: number;
  totalScenes: number;
  sceneTitle: string;
  frame: number;
  totalFrames: number;
}

export interface FilmExportOptions {
  scenes: SceneSpec[];
  width: number;
  height: number;
  fps?: number;
  quality?: 'high' | 'ultra';
  /** Phase 7: render the frames with WebGPU where available (falls back to WebGL). */
  renderer?: 'webgl' | 'webgpu' | 'auto';
  withSound?: boolean;
  watermark?: boolean;
  /** Fallback transition when a scene has none of its own. */
  transition?: string;
  transitionSeconds?: number;
  onProgress?: (p: FilmExportProgress) => void;
  abortSignal?: AbortSignal;
  /** Skip the download (tests / callers that handle the blob). */
  download?: boolean;
}

interface PlayerHandle {
  store: { getState: () => any; setState: (patch: any) => void };
  step: (dt: number) => void;
  manual: (on: boolean) => void;
  pendingLoads: () => number;
  relayout?: () => void;
  canvas: () => HTMLCanvasElement | null;
  destroy: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when this browser can encode MP4 video frame by frame (WebCodecs). */
export async function canExportFilmFrames(width = 1280, height = 720): Promise<boolean> {
  if (typeof window === 'undefined' || typeof (window as any).VideoEncoder === 'undefined') return false;
  try {
    const { getFirstEncodableVideoCodec } = await import('mediabunny');
    return (await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height })) !== null;
  } catch {
    return false;
  }
}

async function mountPlayer(html: string, width: number, height: number, quality: 'high' | 'ultra'): Promise<{ frame: HTMLIFrameElement; player: PlayerHandle }> {
  const iframe = document.createElement('iframe');
  // The Player renders at min(devicePixelRatio, 2): size the CSS box so the canvas comes out at the target pixels.
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.round(width / ratio);
  const cssH = Math.round(height / ratio);
  // Keep the frame inside the viewport (scaled down, invisible): Chrome stops rendering off-screen iframes.
  const fit = Math.min(1, (window.innerWidth || cssW) / cssW, (window.innerHeight || cssH) / cssH);
  iframe.style.cssText = `position:fixed;left:0;top:0;width:${cssW}px;height:${cssH}px;transform:scale(${fit});transform-origin:0 0;border:0;opacity:0.001;pointer-events:none;z-index:-1`;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  const started = performance.now();
  for (;;) {
    const handle = (iframe.contentWindow as any)?.__omniPlayer as PlayerHandle | undefined;
    if (handle) {
      handle.manual(true);
      // Wait for the Player's layout (ResizeObserver) so the stage canvas has the film's aspect before frame 1.
      const want = width / height;
      const t0 = performance.now();
      for (;;) {
        handle.relayout?.();
        handle.step(0);
        const c = handle.canvas();
        if (c && c.height > 0 && Math.abs(c.width / c.height - want) < 0.02) break;
        if (performance.now() - t0 > 4000) break;
        await sleep(50);
      }
      return { frame: iframe, player: handle };
    }
    if (performance.now() - started > 15000) {
      iframe.remove();
      throw new Error(`The OmniStage Player did not start (quality ${quality})`);
    }
    await sleep(50);
  }
}

async function waitForAssets(player: PlayerHandle, abort?: AbortSignal) {
  const started = performance.now();
  // A couple of frames first so the view exists and has requested its models / images.
  player.relayout?.();
  player.step(0);
  await sleep(30);
  player.step(0);
  while (player.pendingLoads() > 0 && performance.now() - started < 20000 && !abort?.aborted) await sleep(60);
  player.step(0);
}

export async function exportFilmMP4(options: FilmExportOptions): Promise<{ ok: boolean; filename?: string; blob?: Blob; error?: string }> {
  const { scenes, width, height, fps = 30, quality = 'high', withSound = true, watermark = false, transition = 'fade-to-black', transitionSeconds = 0.5, onProgress, abortSignal } = options;
  if (!scenes.length) return { ok: false, error: 'No scenes to export' };
  const mb = await import('mediabunny');
  const videoCodec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height });
  if (!videoCodec) return { ok: false, error: 'This browser cannot encode MP4 video (WebCodecs)' };

  const durations = scenes.map((s) => Math.max(1, s.durationSeconds || 5));
  const frameCounts = durations.map((d) => Math.max(1, Math.round(d * fps)));
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0);
  const report = (p: Omit<FilmExportProgress, 'totalScenes' | 'totalFrames'>) => onProgress?.({ ...p, totalScenes: scenes.length, totalFrames });
  report({ phase: 'preparing', ratio: 0, sceneIndex: 0, sceneTitle: scenes[0].title, frame: 0 });

  // Exact scene lengths in whole frames, so picture and sound stay in sync to the frame.
  const timed = scenes.map((s, i) => ({ ...s, durationSeconds: frameCounts[i] / fps }));
  const runtime = await loadPlayerRuntime(options.renderer);
  // Voice clips go in too, so talk motion follows the real voice in the captured frames.
  const html = generatePlayerHTML(timed[0], 'universal', timed, { playerRuntimeSource: runtime, touchControls: false, sound: false, quality, assets: voiceClipAssets(timed), renderer: options.renderer });

  const compositor = document.createElement('canvas');
  compositor.width = width;
  compositor.height = height;
  const ctx = compositor.getContext('2d', { alpha: false })!;
  const previous = document.createElement('canvas');
  previous.width = width;
  previous.height = height;
  const prevCtx = previous.getContext('2d')!;

  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const video = new mb.CanvasSource(compositor, { codec: videoCodec, bitrate: mb.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  let audio: InstanceType<typeof mb.AudioBufferSource> | null = null;
  const hasSound = withSound && timed.some((s) => s.soundtrack);
  if (hasSound) {
    const audioCodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 });
    if (audioCodec) {
      audio = new mb.AudioBufferSource({ codec: audioCodec, bitrate: mb.QUALITY_HIGH });
      output.addAudioTrack(audio);
    }
  }

  let mounted: Awaited<ReturnType<typeof mountPlayer>> | null = null;
  try {
    mounted = await mountPlayer(html, width, height, quality);
    const { player } = mounted;
    await output.start();

    if (audio) {
      const pcm = renderFilmSoundtrack(timed, 48000);
      const buffer = new AudioBuffer({ length: pcm.left.length, numberOfChannels: 2, sampleRate: pcm.sampleRate });
      buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
      buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
      await audio.add(buffer);
      audio.close();
    }

    let done = 0;
    for (let i = 0; i < timed.length; i++) {
      const scene = timed[i];
      report({ phase: 'loading', ratio: done / totalFrames, sceneIndex: i, sceneTitle: scene.title, frame: done });
      const state = player.store.getState();
      state.switchScene(scene.id);
      player.store.setState({ isPlaying: true, currentTime: 0 });
      await waitForAssets(player, abortSignal);
      player.store.setState({ isPlaying: true, currentTime: 0 });
      const kind = compositorTransition(scene, transition);
      const transitionFrames = i > 0 && kind !== 'none' ? Math.round(transitionSeconds * fps) : 0;

      for (let f = 0; f < frameCounts[i]; f++) {
        if (abortSignal?.aborted) throw new Error('aborted');
        player.step(f === 0 ? 0 : 1 / fps);
        const src = player.canvas();
        ctx.fillStyle = scene.environment?.backgroundColor || '#000000';
        ctx.fillRect(0, 0, width, height);
        if (src && src.width > 0 && src.height > 0) {
          // Same task as the render: the WebGL drawing buffer is still readable.
          const k = Math.min(width / src.width, height / src.height);
          const dw = src.width * k;
          const dh = src.height * k;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(src, (width - dw) / 2, (height - dh) / 2, dw, dh);
        }
        if (scene.engineType === '3d') {
          for (const cue of activeCaptions(sceneCaptions(scene), f / fps)) drawCaptionOnCanvas(ctx, cue, width, height);
        }
        if (f < transitionFrames) drawSceneTransition(ctx, previous, kind, f / transitionFrames, width, height);
        if (watermark) drawWatermark(ctx, scene, i, timed.length);
        await video.add((done + f) / fps, 1 / fps);
        if (f % 10 === 0) report({ phase: 'rendering', ratio: (done + f) / totalFrames, sceneIndex: i, sceneTitle: scene.title, frame: done + f });
      }
      prevCtx.drawImage(compositor, 0, 0);
      done += frameCounts[i];
    }

    report({ phase: 'finalizing', ratio: 1, sceneIndex: timed.length - 1, sceneTitle: 'Finalizing MP4…', frame: totalFrames });
    video.close();
    await output.finalize();
    const blob = new Blob([(output.target as InstanceType<typeof mb.BufferTarget>).buffer!], { type: 'video/mp4' });
    const filename = `${slugifyTitle(scenes[0].sequence?.storyboardTitle || scenes[0].title, 'film')}-${timed.length}scene${timed.length > 1 ? 's' : ''}.mp4`;
    if (options.download !== false) downloadBlob(blob, filename);
    report({ phase: 'completed', ratio: 1, sceneIndex: timed.length - 1, sceneTitle: 'Export completed', frame: totalFrames });
    return { ok: true, filename, blob };
  } catch (err: any) {
    await output.cancel().catch(() => undefined);
    if (abortSignal?.aborted) return { ok: false, error: 'Export cancelled' };
    return { ok: false, error: err?.message || 'MP4 export failed' };
  } finally {
    try {
      mounted?.player.destroy();
    } catch {
      /* iframe teardown */
    }
    mounted?.frame.remove();
  }
}
