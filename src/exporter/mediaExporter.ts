import { SceneSpec } from '../types/scene.schema';
import { analyzePlayableBudget, buildZip, PlayableBudgetReport } from './playableBundle';
import { assetBudgetFor, collectAssetUrls, defaultFetcher, embedAssets, EmbedResult, generatePlayerHTML } from './playerHtml';

/**
 * Utility: Trigger browser file download via temporary anchor element.
 */
function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Resolve the active canvas element from the DOM (WebGL or 2D).
 */
export function resolveActiveCanvas(canvas: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (canvas && canvas.isConnected) return canvas;
  return document.querySelector('canvas');
}

/**
 * Format title into URL-friendly file slug.
 */
export function slugifyTitle(title: string, fallback: string = 'omnistage'): string {
  return (title || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || fallback;
}

/**
 * Detect browser supported video MIME types for MP4 and WebM.
 */
export function detectSupportedVideoMimes(): {
  mp4: string | null;
  webm: string | null;
  preferred: string;
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mp4: null, webm: null, preferred: 'video/webm' };
  }

  const mp4Candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4',
  ];

  const webmCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  const mp4 = mp4Candidates.find((m) => MediaRecorder.isTypeSupported(m)) || null;
  const webm = webmCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || null;
  const preferred = mp4 || webm || 'video/webm';

  return { mp4, webm, preferred };
}

/**
 * 1. Instant High-Res PNG Snapshot Capture from 3D WebGL or 2D Vector Canvas
 */
export function exportCanvasSnapshotPNG(
  canvas: HTMLCanvasElement | null,
  sceneTitle: string
): string | null {
  const targetCanvas = resolveActiveCanvas(canvas);
  if (!targetCanvas) return null;
  const dataUrl = targetCanvas.toDataURL('image/png', 1.0);
  const slug = slugifyTitle(sceneTitle, 'scene-snapshot');
  triggerDownload(dataUrl, `${slug}-snapshot.png`);
  return dataUrl;
}

/**
 * 2. Single-Scene WebM/MP4 Video Stream Recorder (Backward compatible signature)
 */
export async function recordCanvasVideoWebM(
  canvas: HTMLCanvasElement | null,
  durationSeconds: number,
  sceneTitle: string,
  onProgress?: (progressRatio: number) => void
): Promise<boolean> {
  const targetCanvas = resolveActiveCanvas(canvas);
  if (!targetCanvas || typeof MediaRecorder === 'undefined') return false;

  const { preferred } = detectSupportedVideoMimes();
  const stream = targetCanvas.captureStream(60);

  return new Promise((resolve) => {
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: preferred,
      videoBitsPerSecond: 10_000_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: preferred });
      const url = URL.createObjectURL(blob);
      const ext = preferred.includes('mp4') ? 'mp4' : 'webm';
      const slug = slugifyTitle(sceneTitle, 'omnistage-video');
      triggerDownload(url, `${slug}-${durationSeconds}s.${ext}`);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      onProgress?.(1);
      resolve(true);
    };

    recorder.start(100);

    const startTime = performance.now();
    const totalMs = durationSeconds * 1000;

    const interval = window.setInterval(() => {
      const elapsed = performance.now() - startTime;
      const ratio = Math.min(1, elapsed / totalMs);
      onProgress?.(ratio);
      if (elapsed >= totalMs) {
        window.clearInterval(interval);
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }
    }, 100);
  });
}

/**
 * Progress payload reported during Multi-Scene Sequencer Recording.
 */
export interface MultiSceneRecordingProgress {
  overallRatio: number; // 0..1
  percentage: number; // 0..100
  currentSceneIndex: number; // 0..N-1
  totalScenes: number;
  currentSceneTitle: string;
  elapsedSeconds: number;
  totalDurationSeconds: number;
  phase: 'preparing' | 'recording' | 'transitioning' | 'finalizing' | 'completed';
}

/**
 * Options for the Multi-Scene Video Sequencer.
 */
export interface MultiSceneSequenceOptions {
  scenes: SceneSpec[];
  initialActiveSceneId?: string;
  switchScene: (sceneId: string) => void;
  getCanvasElement?: () => HTMLCanvasElement | null;
  durationMode?: 'per-scene' | 'fixed';
  fixedDurationSeconds?: number;
  format?: 'webm' | 'mp4';
  fps?: number;
  transition?: 'none' | 'crossfade' | 'fade-to-black';
  transitionDurationSeconds?: number;
  resolution?: { width: number; height: number };
  watermarkBadge?: boolean;
  onProgress?: (progress: MultiSceneRecordingProgress) => void;
  abortSignal?: AbortSignal;
}

/**
 * 3. Multi-Scene Video Sequencer Recorder:
 * Automatically runs sequentially through Scene 1 -> Scene 2 -> ... -> Scene N on the timeline,
 * recording both 3D WebGL and 2D Canvas scenes continuously via a master compositor canvas,
 * applying optional transitions, and exporting a single stitched .mp4 / .webm video file.
 */
export async function recordMultiSceneSequence(
  options: MultiSceneSequenceOptions
): Promise<{ ok: boolean; filename?: string; error?: string }> {
  const {
    scenes,
    initialActiveSceneId,
    switchScene,
    getCanvasElement,
    durationMode = 'per-scene',
    fixedDurationSeconds = 5,
    format = 'webm',
    fps = 60,
    transition = 'crossfade',
    transitionDurationSeconds = 0.5,
    watermarkBadge = true,
    onProgress,
    abortSignal,
  } = options;

  if (!scenes || scenes.length === 0) {
    return { ok: false, error: 'No scenes found to sequence' };
  }

  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, error: 'MediaRecorder is not supported in this browser' };
  }

  // Calculate per-scene durations
  const sceneDurations = scenes.map((s) =>
    durationMode === 'fixed'
      ? Math.max(1, fixedDurationSeconds)
      : Math.max(2, s.durationSeconds || 5)
  );
  const totalDurationSeconds = sceneDurations.reduce((a, b) => a + b, 0);

  // Detect MIME type
  const { mp4, webm } = detectSupportedVideoMimes();
  let selectedMime = 'video/webm';
  let fileExt = 'webm';

  if (format === 'mp4' && mp4) {
    selectedMime = mp4;
    fileExt = 'mp4';
  } else if (webm) {
    selectedMime = webm;
    fileExt = 'webm';
  } else if (mp4) {
    selectedMime = mp4;
    fileExt = 'mp4';
  }

  // Master Compositor Canvas setup
  const targetWidth = options.resolution?.width || 1920;
  const targetHeight = options.resolution?.height || 1080;

  const compositorCanvas = document.createElement('canvas');
  compositorCanvas.width = targetWidth;
  compositorCanvas.height = targetHeight;
  const ctx = compositorCanvas.getContext('2d', { alpha: false });
  if (!ctx) {
    return { ok: false, error: 'Failed to create 2D canvas context for sequencer' };
  }

  // Master Capture Stream & MediaRecorder
  const stream = compositorCanvas.captureStream(fps);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: selectedMime,
    videoBitsPerSecond: 12_000_000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start(100);

  const startClock = performance.now();
  let previousSceneSnapshot: HTMLCanvasElement | null = null;
  let isAborted = false;

  const checkAborted = () => {
    if (abortSignal?.aborted) {
      isAborted = true;
      return true;
    }
    return false;
  };

  try {
    for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
      if (checkAborted()) break;

      const currentScene = scenes[sceneIdx];
      const sceneDuration = sceneDurations[sceneIdx];
      const sceneStartTime = performance.now();
      const sceneMs = sceneDuration * 1000;
      const transitionMs = transitionDurationSeconds * 1000;

      // Switch Studio state to the current scene
      switchScene(currentScene.id);

      // Wait a stabilization grace period (120ms) for React to mount and render the new engine canvas
      await new Promise((r) => setTimeout(r, 120));
      if (checkAborted()) break;

      // Render loop for this scene's duration
      await new Promise<void>((resolveScene) => {
        const renderTick = () => {
          if (checkAborted()) {
            resolveScene();
            return;
          }

          const now = performance.now();
          const sceneElapsed = now - sceneStartTime;
          const totalElapsed = (now - startClock) / 1000;
          const overallRatio = Math.min(1, totalElapsed / totalDurationSeconds);

          // Get active stage canvas
          const activeCanvas = getCanvasElement?.() || resolveActiveCanvas(null);

          // 1. Draw solid background
          ctx.fillStyle = currentScene.environment?.backgroundColor || '#0B101B';
          ctx.fillRect(0, 0, targetWidth, targetHeight);

          // 2. Draw live canvas frame (letterboxed & centered)
          if (activeCanvas && activeCanvas.width > 0 && activeCanvas.height > 0) {
            const srcW = activeCanvas.width;
            const srcH = activeCanvas.height;
            const scale = Math.min(targetWidth / srcW, targetHeight / srcH);
            const dw = srcW * scale;
            const dh = srcH * scale;
            const dx = (targetWidth - dw) / 2;
            const dy = (targetHeight - dh) / 2;

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(activeCanvas, dx, dy, dw, dh);
          }

          // 3. Handle inter-scene transitions
          let phase: MultiSceneRecordingProgress['phase'] = 'recording';
          // Phase 10A: a scene's own transition (sequence.transition) overrides the dialog default.
          const own = currentScene.sequence?.transition;
          const sceneTransition: string = own === 'cut' ? 'none' : own === 'fade' ? 'fade-to-black' : own || transition;
          if (sceneIdx > 0 && sceneTransition !== 'none' && sceneElapsed < transitionMs && previousSceneSnapshot) {
            phase = 'transitioning';
            const progress = sceneElapsed / transitionMs;

            if (sceneTransition === 'fade-white') {
              const alpha = progress < 0.5 ? (0.5 - progress) * 2 : 0;
              if (alpha > 0) {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.drawImage(previousSceneSnapshot, 0, 0, targetWidth, targetHeight);
                ctx.restore();
              }
              ctx.fillStyle = `rgba(255, 255, 255, ${progress < 0.5 ? progress * 2 : (1 - progress) * 2})`;
              ctx.fillRect(0, 0, targetWidth, targetHeight);
            } else if (sceneTransition === 'wipe') {
              const edge = Math.round(targetWidth * progress);
              ctx.drawImage(previousSceneSnapshot, edge, 0, targetWidth - edge, targetHeight, edge, 0, targetWidth - edge, targetHeight);
            } else if (sceneTransition === 'crossfade') {
              ctx.save();
              ctx.globalAlpha = 1 - progress;
              ctx.drawImage(previousSceneSnapshot, 0, 0, targetWidth, targetHeight);
              ctx.restore();
            } else if (sceneTransition === 'fade-to-black') {
              const alpha = progress < 0.5 ? (0.5 - progress) * 2 : 0;
              if (alpha > 0) {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.drawImage(previousSceneSnapshot, 0, 0, targetWidth, targetHeight);
                ctx.restore();
              }
              const blackAlpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
              ctx.fillStyle = `rgba(0, 0, 0, ${blackAlpha})`;
              ctx.fillRect(0, 0, targetWidth, targetHeight);
            }
          }

          // 4. Sleek HUD watermark overlay (optional)
          if (watermarkBadge) {
            ctx.save();
            ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
            ctx.lineWidth = 1.5;
            const padX = 24;
            const padY = 24;
            const badgeW = 340;
            const badgeH = 46;

            ctx.beginPath();
            ctx.roundRect(padX, padY, badgeW, badgeH, 10);
            ctx.fill();
            ctx.stroke();

            ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = '#06B6D4';
            ctx.fillText(
              `OMNISTAGE · SCENE ${sceneIdx + 1}/${scenes.length} [${(currentScene.engineType || '3d').toUpperCase()}]`,
              padX + 16,
              padY + 20
            );

            ctx.font = '500 12px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = '#F8FAFC';
            const titleSnippet = currentScene.title.slice(0, 28);
            ctx.fillText(titleSnippet, padX + 16, padY + 36);
            ctx.restore();
          }

          // Report progress callback
          onProgress?.({
            overallRatio,
            percentage: Math.round(overallRatio * 100),
            currentSceneIndex: sceneIdx,
            totalScenes: scenes.length,
            currentSceneTitle: currentScene.title,
            elapsedSeconds: Math.round(totalElapsed * 10) / 10,
            totalDurationSeconds,
            phase,
          });

          if (sceneElapsed >= sceneMs) {
            resolveScene();
          } else {
            requestAnimationFrame(renderTick);
          }
        };

        requestAnimationFrame(renderTick);
      });

      // Save a snapshot of the current frame for smooth transition into next scene
      if (sceneIdx < scenes.length - 1) {
        const snap = document.createElement('canvas');
        snap.width = targetWidth;
        snap.height = targetHeight;
        const snapCtx = snap.getContext('2d');
        if (snapCtx) {
          snapCtx.drawImage(compositorCanvas, 0, 0);
          previousSceneSnapshot = snap;
        }
      }
    }

    if (isAborted) {
      if (recorder.state === 'recording') recorder.stop();
      if (initialActiveSceneId) switchScene(initialActiveSceneId);
      return { ok: false, error: 'Multi-scene sequence recording was aborted by user' };
    }

    onProgress?.({
      overallRatio: 1,
      percentage: 100,
      currentSceneIndex: scenes.length - 1,
      totalScenes: scenes.length,
      currentSceneTitle: 'Finalizing Video Stream...',
      elapsedSeconds: totalDurationSeconds,
      totalDurationSeconds,
      phase: 'finalizing',
    });

    // Finalize recording
    return await new Promise<{ ok: boolean; filename: string }>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: selectedMime });
        const url = URL.createObjectURL(blob);
        const slug = slugifyTitle(scenes[0]?.title || 'omnistage-storyboard', 'storyboard');
        const filename = `${slug}-multiscene-${scenes.length}scenes.${fileExt}`;
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 12000);

        if (initialActiveSceneId) switchScene(initialActiveSceneId);

        onProgress?.({
          overallRatio: 1,
          percentage: 100,
          currentSceneIndex: scenes.length - 1,
          totalScenes: scenes.length,
          currentSceneTitle: 'Export Completed',
          elapsedSeconds: totalDurationSeconds,
          totalDurationSeconds,
          phase: 'completed',
        });

        resolve({ ok: true, filename });
      };

      if (recorder.state === 'recording') {
        recorder.stop();
      }
    });
  } catch (err: any) {
    if (recorder.state === 'recording') recorder.stop();
    if (initialActiveSceneId) switchScene(initialActiveSceneId);
    return { ok: false, error: err?.message || 'Sequencer recording encountered an error' };
  }
}

/**
 * 4. Declarative SceneSpec + Multi-Scene Storyboard JSON Contract Exporter
 */
export function exportSceneSpecJSON(sceneSpec: SceneSpec, scenes?: SceneSpec[]) {
  const syncedScenes =
    scenes && scenes.length > 0
      ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s))
      : [sceneSpec];

  const payload = {
    ...sceneSpec,
    projectBundleVersion: '3.1.0',
    activeSceneId: sceneSpec.id,
    scenes: syncedScenes,
  };

  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const slug = slugifyTitle(sceneSpec.title, 'scene-spec');
  triggerDownload(url, `${slug}.scenespec.json`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Options for Standalone HTML5 Game & Playable Ad Generation.
 */
export type StandaloneAdNetwork = 'universal' | 'tiktok' | 'meta' | 'telegram' | 'itch';

export interface StandalonePlayerOptions {
  autoProgressScenes?: boolean;
  enableMobileTouchControls?: boolean;
  enableProceduralAudio?: boolean;
  responsiveScaling?: boolean;
  /** Phase 7: OmniStage Player runtime source (loaded lazily by buildStandalonePlayable when omitted). */
  playerRuntimeSource?: string;
  /** Phase 7: asset URL → data URI map embedded in the HTML. */
  assets?: Record<string, string>;
  /** Phase 6 batch 2: show an FPS / frame-time meter (Play Test). */
  showFps?: boolean;
  quality?: 'auto' | 'low' | 'high';
}

export interface PlayableBuildResult {
  html: string;
  budget: PlayableBudgetReport;
  /** Phase 7: which models / images were embedded for offline play. */
  embed?: EmbedResult;
}

/**
 * Helper: Pure TypeScript PKZIP 2.0 Generator (Zero dependencies, 100% browser/Node standard).
 */
export interface ZipFileEntry {
  name: string;
  content: string | Uint8Array;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function computeCRC32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipBlob(files: ZipFileEntry[]): Blob {
  const parts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate =
    (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const textEncoder = new TextEncoder();

  for (const f of files) {
    const nameBytes = textEncoder.encode(f.name);
    const dataBytes =
      typeof f.content === 'string' ? textEncoder.encode(f.content) : f.content;
    const crc = computeCRC32(dataBytes);

    // Local Header (30 bytes)
    const lhBuf = new ArrayBuffer(30);
    const lh = new DataView(lhBuf);
    lh.setUint32(0, 0x04034b50, true); // Local file header signature
    lh.setUint16(4, 20, true); // Version needed (2.0)
    lh.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8)
    lh.setUint16(8, 0, true); // Compression method (0 = Stored)
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, dataBytes.length, true); // Compressed size
    lh.setUint32(22, dataBytes.length, true); // Uncompressed size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true); // Extra field length

    parts.push(new Uint8Array(lhBuf), nameBytes, dataBytes);

    // Central Directory Header (46 bytes)
    const cdBuf = new ArrayBuffer(46);
    const cd = new DataView(cdBuf);
    cd.setUint32(0, 0x02014b50, true); // Central directory header signature
    cd.setUint16(4, 20, true); // Version made by
    cd.setUint16(6, 20, true); // Version needed
    cd.setUint16(8, 0x0800, true); // UTF-8
    cd.setUint16(10, 0, true); // Stored
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, dataBytes.length, true);
    cd.setUint32(24, dataBytes.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true); // External file attributes
    cd.setUint32(42, offset, true); // Relative offset of local header

    cdParts.push(new Uint8Array(cdBuf), nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const cdOffset = offset;
  const cdSize = cdParts.reduce((acc, p) => acc + p.length, 0);

  // End of Central Directory Record (22 bytes)
  const eocdBuf = new ArrayBuffer(22);
  const eocd = new DataView(eocdBuf);
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdOffset, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...parts, ...cdParts, new Uint8Array(eocdBuf)] as BlobPart[], {
    type: 'application/zip',
  });
}

/**
 * 5. Standalone HTML5 game / playable ad, powered by the OmniStage Player (Phase 7): the same runtime as the
 * studio's Play Test and phone preview, so what you test is what ships.
 */
export function generateStandaloneHTMLContent(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'universal',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions
): string {
  if (!options?.playerRuntimeSource) throw new Error('playerRuntimeSource is required (use buildStandalonePlayable in the browser)');
  return generatePlayerHTML(sceneSpec, targetNetwork, scenes && scenes.length ? scenes : [sceneSpec], {
    playerRuntimeSource: options.playerRuntimeSource,
    assets: options.assets,
    touchControls: options.enableMobileTouchControls === false ? false : 'auto',
    sound: options.enableProceduralAudio !== false,
    showFps: options.showFps,
    quality: options.quality,
  });
}

export async function loadPlayerRuntime(): Promise<string> {
  const mod = await import('./generated/playerRuntime');
  return mod.PLAYER_RUNTIME;
}

/**
 * 6. Export Standalone Single-File HTML5 Playable Ad
 */
export async function buildStandalonePlayable(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'universal',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions & { offline?: boolean; fetcher?: typeof defaultFetcher }
): Promise<PlayableBuildResult> {
  const playerRuntimeSource = options?.playerRuntimeSource ?? (await loadPlayerRuntime());
  const all = scenes && scenes.length ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s)) : [sceneSpec];
  let embed: EmbedResult | undefined;
  let assets = options?.assets;
  if (!assets && options?.offline !== false) {
    const shell = generateStandaloneHTMLContent(sceneSpec, targetNetwork, all, { ...options, playerRuntimeSource });
    embed = await embedAssets(collectAssetUrls(all), assetBudgetFor(targetNetwork, new TextEncoder().encode(shell).length), options?.fetcher ?? defaultFetcher);
    assets = embed.assets;
  }
  const html = generateStandaloneHTMLContent(sceneSpec, targetNetwork, all, { ...options, playerRuntimeSource, assets });
  const remote = options?.offline === false ? collectAssetUrls(all) : embed?.skipped.map((s) => s.url) || [];
  return { html, budget: analyzePlayableBudget(html, targetNetwork, undefined, remote), embed };
}

export async function exportStandalonePlayableHTML(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'universal',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions & { offline?: boolean }
): Promise<PlayableBuildResult> {
  const result = await buildStandalonePlayable(sceneSpec, targetNetwork, scenes, options);
  const blob = new Blob([result.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const slug = slugifyTitle(sceneSpec.title, 'omnistage-game');
  triggerDownload(url, `${slug}-${targetNetwork}-playable.html`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return result;
}

/**
 * 7. Export Complete Standalone Game Package as ZIP (Standard itch.io / Ad Network bundle)
 */
export async function exportStandaloneGameZIP(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'itch',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions & { offline?: boolean }
): Promise<PlayableBuildResult> {
  const syncedScenes =
    scenes && scenes.length > 0
      ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s))
      : [sceneSpec];

  const { html: htmlContent } = await buildStandalonePlayable(sceneSpec, targetNetwork, syncedScenes, options);

  const manifest = {
    name: slugifyTitle(sceneSpec.title, 'omnistage-game'),
    title: sceneSpec.title,
    version: '1.0.0',
    description: 'Exported from OmniStage AI Multi-Scene Authoring Engine',
    author: 'OmniStage AI Studio',
    targetNetwork,
    aspectRatio: sceneSpec.aspectRatio,
    scenesCount: syncedScenes.length,
    engine: 'Dual 3D WebGL & 2D Vector Canvas Engine',
    main: 'index.html',
    createdAt: new Date().toISOString(),
  };

  const readme = `=====================================================
${sceneSpec.title} — Standalone Game Package
=====================================================

Platform Target: ${targetNetwork.toUpperCase()}
Total Scenes: ${syncedScenes.length}
Engine: Dual 3D WebGL & 2D Vector Engine

INSTRUCTIONS FOR ITCH.IO UPLOAD:
1. Log in to your itch.io creator dashboard.
2. Click "Create new project".
3. Under "Kind of project", select "HTML - You have a ZIP file or HTML file that will be played in the browser".
4. Upload this .zip file directly.
5. In the upload options, check the checkbox: "This file will be played in the browser".
6. Set Viewport Dimensions:
   - Width: 1000 px
   - Height: 600 px (or responsive)
7. Save and view your playable game!

INSTRUCTIONS FOR TELEGRAM MINI APP / LOCAL HOSTING:
1. Extract this .zip into your static web server or host index.html on GitHub Pages / Vercel / Netlify.
2. In BotFather on Telegram, use /newapp and set the WebApp URL to your hosted index.html.

Enjoy creating with OmniStage AI!
`;

  const files: ZipFileEntry[] = [
    { name: 'index.html', content: htmlContent },
    { name: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    { name: 'README.txt', content: readme },
  ];

  // Phase 5: DEFLATE-compressed archive (falls back to stored entries without CompressionStream).
  const zipBytes = await buildZip(files, { compress: true });
  const zipBlob = new Blob([zipBytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(zipBlob);
  const slug = slugifyTitle(sceneSpec.title, 'omnistage-game');
  triggerDownload(url, `${slug}-${targetNetwork}-package.zip`);
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  return { html: htmlContent, budget: analyzePlayableBudget(htmlContent, targetNetwork, zipBytes.length) };
}
