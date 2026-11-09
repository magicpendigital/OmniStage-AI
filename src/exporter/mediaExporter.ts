import { SceneSpec } from '../types/scene.schema';

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
          if (sceneIdx > 0 && sceneElapsed < transitionMs && previousSceneSnapshot) {
            phase = 'transitioning';
            const progress = sceneElapsed / transitionMs;

            if (transition === 'crossfade') {
              ctx.save();
              ctx.globalAlpha = 1 - progress;
              ctx.drawImage(previousSceneSnapshot, 0, 0, targetWidth, targetHeight);
              ctx.restore();
            } else if (transition === 'fade-to-black') {
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
      if (sceneIdx < scenes.length - 1 && transition !== 'none') {
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
 * 5. Generate Standalone HTML5 Game / Playable Ad String.
 * Self-contained, responsive, multi-scene, dual 3D/2D engines, procedural audio synth,
 * mobile touch controls, level progression, and ad network compliance.
 */
export function generateStandaloneHTMLContent(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'universal',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions
): string {
  const syncedScenes =
    scenes && scenes.length > 0
      ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s))
      : [sceneSpec];

  const bundleJson = JSON.stringify(syncedScenes);
  const activeIdJson = JSON.stringify(sceneSpec.id);
  const autoProgress = options?.autoProgressScenes ?? true;
  const mobileControls = options?.enableMobileTouchControls ?? true;
  const proceduralAudio = options?.enableProceduralAudio ?? true;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>${sceneSpec.title} — OmniStage Standalone Game (${targetNetwork.toUpperCase()})</title>
  ${targetNetwork === 'telegram' ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>' : ''}
  ${targetNetwork === 'tiktok' ? '<script src="mraid.js"></script>' : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body, html { width: 100%; height: 100%; overflow: hidden; background: ${sceneSpec.environment?.backgroundColor || '#0B101B'}; font-family: system-ui, -apple-system, sans-serif; color: #F8FAFC; }
    .stage-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; touch-action: none; }
    .hud-top { position: fixed; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; pointer-events: none; z-index: 20; }
    .hud-left, .hud-right { display: flex; align-items: center; gap: 8px; pointer-events: auto; }
    .pill { background: rgba(9, 13, 22, 0.9); border: 1px solid rgba(6, 182, 212, 0.45); padding: 6px 12px; border-radius: 8px; font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .engine-badge { background: rgba(6, 182, 212, 0.2); border: 1px solid rgba(6, 182, 212, 0.55); color: #67E8F9; padding: 5px 9px; border-radius: 7px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
    .scene-select { background: rgba(9, 13, 22, 0.92); border: 1px solid rgba(148, 163, 184, 0.4); color: #F8FAFC; padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; outline: none; }
    .icon-btn { background: rgba(9, 13, 22, 0.9); border: 1px solid rgba(148, 163, 184, 0.4); color: #F8FAFC; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; }
    .cta-bar { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); width: min(440px, 92vw); background: rgba(9, 13, 22, 0.94); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 25; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .cta-btn { background: ${sceneSpec.marketingOverlay?.brandColor || '#F59E0B'}; color: #090D16; font-weight: 800; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 12px; text-transform: uppercase; white-space: nowrap; transition: transform 0.1s; }
    .cta-btn:active { transform: scale(0.96); }
    .toast-banner { position: fixed; top: 62px; left: 50%; transform: translateX(-50%); background: rgba(16, 185, 129, 0.95); color: #052E16; font-weight: 800; font-size: 13px; padding: 8px 18px; border-radius: 999px; z-index: 30; display: none; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    .overlay-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.82); display: none; align-items: center; justify-content: center; z-index: 50; p: 16px; }
    .overlay-card { background: #0F172A; border: 1px solid #334155; border-radius: 16px; padding: 24px; max-width: 380px; width: 90%; text-align: center; box-shadow: 0 24px 48px rgba(0,0,0,0.7); }
    .modal-btn { padding: 10px 20px; border-radius: 8px; font-weight: 700; font-size: 13px; border: none; cursor: pointer; margin-top: 14px; text-transform: uppercase; }
    /* Mobile Virtual Controls */
    .mobile-controls { position: fixed; bottom: 84px; left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: center; pointer-events: none; z-index: 24; }
    .dpad-btn { width: 56px; height: 56px; border-radius: 28px; background: rgba(15, 23, 42, 0.85); border: 2px solid rgba(6, 182, 212, 0.6); color: #67E8F9; font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; box-shadow: 0 6px 16px rgba(0,0,0,0.5); }
    .dpad-btn:active { background: rgba(6, 182, 212, 0.4); transform: scale(0.92); }
    .jump-btn { width: 68px; height: 68px; border-radius: 34px; background: rgba(245, 158, 11, 0.88); border: 2px solid #F59E0B; color: #090D16; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; box-shadow: 0 6px 16px rgba(0,0,0,0.5); }
    .jump-btn:active { background: #FCD34D; transform: scale(0.92); }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <div class="hud-top">
    <div class="hud-left">
      <span class="engine-badge" id="engineBadge">${(sceneSpec.engineType || '3d').toUpperCase()}</span>
      <div class="pill" id="scoreDisplay">SCORE: 0 / ${sceneSpec.gameRules?.targetScore || 100}</div>
      <div class="pill" id="timerDisplay">${Math.ceil(sceneSpec.gameRules?.timeLimitSeconds || 60)}s</div>
    </div>
    <div class="hud-right">
      <select class="scene-select" id="sceneSelect" style="display:none;"></select>
      <button class="icon-btn" id="audioToggleBtn" title="Toggle Sound">🔊</button>
      <button class="icon-btn" id="fsToggleBtn" title="Toggle Fullscreen">⛶</button>
      <div class="pill" id="badgeText">${sceneSpec.marketingOverlay?.badgeText || 'PLAYABLE GAME'}</div>
    </div>
  </div>

  <div class="toast-banner" id="toastBanner"></div>

  <canvas id="stage3d" class="stage-canvas"></canvas>
  <canvas id="stage2d" class="stage-canvas" style="display:none;"></canvas>

  <!-- Mobile Virtual Controls -->
  <div class="mobile-controls" id="mobileControls" style="${mobileControls ? '' : 'display:none;'}">
    <div style="display:flex;gap:12px;">
      <div class="dpad-btn" id="btnLeft">◄</div>
      <div class="dpad-btn" id="btnRight">►</div>
    </div>
    <div class="jump-btn" id="btnJump">JUMP</div>
  </div>

  <!-- Marketing CTA Bar -->
  <div class="cta-bar" id="ctaBar">
    <div style="min-width:0;">
      <div id="headlineText" style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sceneSpec.marketingOverlay?.headline || sceneSpec.title}</div>
      <div id="subheadlineText" style="font-size:11px;color:#94A3B8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sceneSpec.marketingOverlay?.subheadline || ''}</div>
    </div>
    <button class="cta-btn" id="ctaBtn">${sceneSpec.marketingOverlay?.ctaText || 'Play Now'}</button>
  </div>

  <!-- Victory / Level Complete Modal -->
  <div class="overlay-modal" id="levelModal">
    <div class="overlay-card">
      <div style="font-size:36px;margin-bottom:8px;" id="modalIcon">🏆</div>
      <h2 style="font-size:20px;font-weight:800;color:#F8FAFC;" id="modalTitle">LEVEL COMPLETED!</h2>
      <p style="font-size:13px;color:#94A3B8;margin-top:6px;" id="modalSubtitle">You reached the target score!</p>
      <div style="margin-top:16px;background:#1E293B;padding:12px;border-radius:10px;font-weight:700;font-size:14px;color:#38BDF8;" id="modalScore">Score: 100 PTS</div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;">
        <button class="modal-btn" id="modalNextBtn" style="background:#06B6D4;color:#090D16;flex:1;">Next Scene ⏩</button>
        <button class="modal-btn" id="modalReplayBtn" style="background:#334155;color:#F8FAFC;">Replay</button>
      </div>
    </div>
  </div>

  <script>
    // Embedded Storyboard Scenes Bundle
    const SCENES_BUNDLE = ${bundleJson};
    let activeSceneId = ${activeIdJson};
    let SCENE_SPEC = SCENES_BUNDLE.find((s) => s.id === activeSceneId) || SCENES_BUNDLE[0];
    const AUTO_PROGRESS = ${autoProgress ? 'true' : 'false'};

    let score = 0;
    let timeRemaining = (SCENE_SPEC.gameRules && SCENE_SPEC.gameRules.timeLimitSeconds) || 60;
    let isGameOver = false;
    let isSoundMuted = false;

    // --- PROCEDURAL 8-BIT AUDIO SYNTH (Web Audio API) ---
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    function initAudio() {
      if (!audioCtx && AudioCtx) {
        audioCtx = new AudioCtx();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    }

    function playSynthSound(type) {
      if (isSoundMuted || !${proceduralAudio ? 'true' : 'false'}) return;
      initAudio();
      if (!audioCtx) return;
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime;

        if (type === 'coin') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, t); // D5
          osc.frequency.setValueAtTime(880.00, t + 0.08); // A5
          gain.gain.setValueAtTime(0.25, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
          osc.start(t);
          osc.stop(t + 0.3);
        } else if (type === 'jump') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(160, t);
          osc.frequency.exponentialRampToValueAtTime(420, t + 0.16);
          gain.gain.setValueAtTime(0.3, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.start(t);
          osc.stop(t + 0.22);
        } else if (type === 'win') {
          const notes = [523.25, 659.25, 783.99, 1046.50];
          notes.forEach((freq, idx) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g);
            g.connect(audioCtx.destination);
            o.type = 'square';
            o.frequency.setValueAtTime(freq, t + idx * 0.1);
            g.gain.setValueAtTime(0.18, t + idx * 0.1);
            g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.1 + 0.22);
            o.start(t + idx * 0.1);
            o.stop(t + idx * 0.1 + 0.24);
          });
        }
      } catch (e) {}
    }

    // Audio & Fullscreen Buttons
    document.getElementById('audioToggleBtn').addEventListener('click', () => {
      initAudio();
      isSoundMuted = !isSoundMuted;
      document.getElementById('audioToggleBtn').textContent = isSoundMuted ? '🔇' : '🔊';
    });

    document.getElementById('fsToggleBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    function showNotice(msg) {
      const el = document.getElementById('toastBanner');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
    }

    // Storyboard Scene Selector
    const sceneSelect = document.getElementById('sceneSelect');
    if (SCENES_BUNDLE.length > 1) {
      sceneSelect.style.display = 'block';
      SCENES_BUNDLE.forEach((sc, idx) => {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = (idx + 1) + '. ' + sc.title + ' [' + (sc.engineType || '3d').toUpperCase() + ']';
        if (sc.id === SCENE_SPEC.id) opt.selected = true;
        sceneSelect.appendChild(opt);
      });
      sceneSelect.addEventListener('change', (e) => {
        switchActiveScene(e.target.value);
      });
    }

    function switchActiveScene(sceneId) {
      const found = SCENES_BUNDLE.find((s) => s.id === sceneId);
      if (found) {
        SCENE_SPEC = JSON.parse(JSON.stringify(found));
        activeSceneId = SCENE_SPEC.id;
        score = 0;
        timeRemaining = (SCENE_SPEC.gameRules && SCENE_SPEC.gameRules.timeLimitSeconds) || 60;
        isGameOver = false;
        document.getElementById('levelModal').style.display = 'none';
        sceneSelect.value = SCENE_SPEC.id;
        syncHudAndEngine();
      }
    }

    // Ad Network CTA Trigger Hooks
    document.getElementById('ctaBtn').addEventListener('click', () => {
      const targetUrl = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.ctaUrl) || 'https://example.com';
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.HapticFeedback?.impactOccurred('medium');
        window.Telegram.WebApp.openLink?.(targetUrl);
      } else if (window.mraid && window.mraid.open) {
        window.mraid.open(targetUrl);
      } else if (window.FbPlayableAd && window.FbPlayableAd.onCTAClick) {
        window.FbPlayableAd.onCTAClick();
      } else {
        showNotice('CTA Triggered: ' + (SCENE_SPEC.marketingOverlay?.ctaText || 'Action') + ' -> ' + targetUrl);
      }
    });

    // Keyboard state
    const keys = {};
    window.addEventListener('keydown', (e) => { initAudio(); keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    // Touch D-Pad bindings
    const bindTouch = (elId, keyName) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); initAudio(); keys[keyName] = true; });
      el.addEventListener('pointerup', (e) => { e.preventDefault(); keys[keyName] = false; });
      el.addEventListener('pointerleave', (e) => { e.preventDefault(); keys[keyName] = false; });
    };
    bindTouch('btnLeft', 'arrowleft');
    bindTouch('btnRight', 'arrowright');
    bindTouch('btnJump', 'arrowup');

    // --- 3D ENGINE ---
    const canvas3d = document.getElementById('stage3d');
    const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    let scene3d = new THREE.Scene();
    let camera3d = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 160);
    let actorMeshes = [];

    function build3DScene() {
      scene3d = new THREE.Scene();
      scene3d.background = new THREE.Color((SCENE_SPEC.environment && SCENE_SPEC.environment.backgroundColor) || '#0B101B');
      camera3d = new THREE.PerspectiveCamera((SCENE_SPEC.camera && SCENE_SPEC.camera.fov) || 45, window.innerWidth / window.innerHeight, 0.1, 160);
      camera3d.position.set(...((SCENE_SPEC.camera && SCENE_SPEC.camera.position) || [0, 3.2, 7.5]));
      camera3d.lookAt(...((SCENE_SPEC.camera && SCENE_SPEC.camera.target) || [0, 0.9, 0]));

      scene3d.add(new THREE.HemisphereLight(SCENE_SPEC.environment?.keyLightColor || '#38BDF8', SCENE_SPEC.environment?.groundColor || '#0F172A', 0.9));
      const dirLight = new THREE.DirectionalLight(SCENE_SPEC.environment?.keyLightColor || '#ffffff', 2.0);
      dirLight.position.set(5, 9, 6);
      scene3d.add(dirLight);

      // Procedural Terrain
      const terrainCfg = SCENE_SPEC.world && SCENE_SPEC.world.terrain;
      const groundGeo = new THREE.PlaneGeometry(36, 36, 32, 32);
      if (terrainCfg && terrainCfg.type && terrainCfg.type !== 'flat' && terrainCfg.type !== 'none') {
        const pos = groundGeo.attributes.position;
        const hScale = terrainCfg.heightScale || 2.5;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const d = Math.sqrt(x * x + y * y);
          const edge = Math.min(1, Math.max(0, (d - 3.0) / 5.0));
          pos.setZ(i, (Math.sin(x * 0.25) * Math.cos(y * 0.25)) * hScale * edge);
        }
        groundGeo.computeVertexNormals();
      }
      const groundMat = new THREE.MeshStandardMaterial({
        color: (terrainCfg && terrainCfg.primaryColor) || SCENE_SPEC.environment?.groundColor || '#1E293B',
        roughness: 0.85,
        metalness: 0.12
      });
      const groundMesh = new THREE.Mesh(groundGeo, groundMat);
      groundMesh.rotation.x = -Math.PI / 2;
      scene3d.add(groundMesh);

      const grid = new THREE.GridHelper(28, 28, SCENE_SPEC.environment?.rimLightColor || '#06B6D4', '#1E293B');
      grid.position.y = 0.02;
      scene3d.add(grid);

      actorMeshes = [];
      (SCENE_SPEC.actors || []).forEach((a) => {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: a.primaryColor || '#06B6D4', metalness: a.metalness ?? 0.65, roughness: a.roughness ?? 0.28 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.22, 24), new THREE.MeshStandardMaterial({ color: '#1E293B' }));
        base.position.y = 0.11;
        const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 1), mat);
        body.position.y = 0.95;
        group.add(base, body);
        group.position.set(...(a.position || [0, 0, 0]));
        group.scale.set(...(a.scale || [1, 1, 1]));
        group.userData = { actor: a, baseScale: [...(a.scale || [1, 1, 1])] };
        scene3d.add(group);
        actorMeshes.push(group);
      });
    }

    // --- 2D ENGINE ---
    const canvas2d = document.getElementById('stage2d');
    const ctx2d = canvas2d.getContext('2d');
    let nodes2D = [];
    let player2dVelY = 0;
    let player2dGrounded = false;

    function build2DScene() {
      canvas2d.width = 1000;
      canvas2d.height = 600;
      nodes2D = JSON.parse(JSON.stringify(SCENE_SPEC.nodes2D || []));
      player2dVelY = 0;
      player2dGrounded = false;
    }

    function checkLevelProgression() {
      const targetScore = (SCENE_SPEC.gameRules && SCENE_SPEC.gameRules.targetScore) || 100;
      if (score >= targetScore && !isGameOver) {
        isGameOver = true;
        playSynthSound('win');
        if (window.Telegram?.WebApp?.HapticFeedback) {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }

        const currentIdx = SCENES_BUNDLE.findIndex((s) => s.id === SCENE_SPEC.id);
        const hasNext = currentIdx >= 0 && currentIdx < SCENES_BUNDLE.length - 1;

        const modal = document.getElementById('levelModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalSubtitle = document.getElementById('modalSubtitle');
        const modalScore = document.getElementById('modalScore');
        const nextBtn = document.getElementById('modalNextBtn');

        modalScore.textContent = 'Final Score: ' + score + ' PTS';

        if (hasNext) {
          modalTitle.textContent = 'SCENE CLEARED! 🏆';
          modalSubtitle.textContent = 'Advancing to Scene ' + (currentIdx + 2) + ': ' + SCENES_BUNDLE[currentIdx + 1].title;
          nextBtn.textContent = 'Next Scene ⏩';
          nextBtn.onclick = () => {
            switchActiveScene(SCENES_BUNDLE[currentIdx + 1].id);
          };
          if (AUTO_PROGRESS) {
            setTimeout(() => {
              if (isGameOver) switchActiveScene(SCENES_BUNDLE[currentIdx + 1].id);
            }, 2400);
          }
        } else {
          modalTitle.textContent = 'VICTORY! ALL LEVELS CLEARED 🎉';
          modalSubtitle.textContent = 'Congratulations! You mastered all storyboard scenes.';
          nextBtn.textContent = SCENE_SPEC.marketingOverlay?.ctaText || 'Play Again';
          nextBtn.onclick = () => {
            document.getElementById('ctaBtn').click();
          };
        }

        document.getElementById('modalReplayBtn').onclick = () => {
          switchActiveScene(SCENE_SPEC.id);
        };

        modal.style.display = 'flex';
      }
    }

    function updateScoreUI() {
      document.getElementById('scoreDisplay').textContent = 'SCORE: ' + score + ' / ' + ((SCENE_SPEC.gameRules && SCENE_SPEC.gameRules.targetScore) || 100);
      document.getElementById('timerDisplay').textContent = Math.max(0, Math.ceil(timeRemaining)) + 's';
      checkLevelProgression();
    }

    function syncHudAndEngine() {
      const is2D = SCENE_SPEC.engineType === '2d';
      document.getElementById('engineBadge').textContent = is2D ? '2D ENGINE' : '3D ENGINE';
      document.getElementById('badgeText').textContent = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.badgeText) || 'PLAYABLE GAME';
      document.getElementById('headlineText').textContent = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.headline) || SCENE_SPEC.title;
      document.getElementById('subheadlineText').textContent = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.subheadline) || '';
      document.getElementById('ctaBtn').textContent = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.ctaText) || 'Play Now';
      document.getElementById('ctaBtn').style.background = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.brandColor) || '#F59E0B';
      updateScoreUI();

      if (is2D) {
        canvas3d.style.display = 'none';
        canvas2d.style.display = 'block';
        build2DScene();
      } else {
        canvas2d.style.display = 'none';
        canvas3d.style.display = 'block';
        build3DScene();
      }
    }

    // Pointer Interaction
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    window.addEventListener('pointerdown', (e) => {
      initAudio();
      if (e.target.closest('.cta-bar') || e.target.closest('.hud-top') || e.target.closest('.overlay-modal') || e.target.closest('.mobile-controls')) return;

      if (SCENE_SPEC.engineType === '2d') {
        const rect = canvas2d.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 1000;
        const py = ((e.clientY - rect.top) / rect.height) * 600;
        let hitAny = false;
        nodes2D.forEach((n) => {
          if (px >= n.x - n.width / 2 && px <= n.x + n.width / 2 && py >= n.y - n.height / 2 && py <= n.y + n.height / 2) {
            hitAny = true;
            score += n.scoreValue || 20;
            playSynthSound('coin');
            updateScoreUI();
          }
        });
        if (!hitAny && player2dGrounded) {
          player2dVelY = -460;
          player2dGrounded = false;
          playSynthSound('jump');
        }
      } else {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(pointer, camera3d);
        const hits = raycaster.intersectObjects(actorMeshes, true);
        if (hits.length > 0) {
          let obj = hits[0].object;
          while (obj.parent && !obj.userData.actor) obj = obj.parent;
          const actor = obj.userData.actor;
          if (actor) {
            score += actor.scoreValue || 15;
            playSynthSound('coin');
            updateScoreUI();
            obj.scale.set(1.3, 1.3, 1.3);
          }
        }
      }
    });

    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera3d.aspect = window.innerWidth / window.innerHeight;
      camera3d.updateProjectionMatrix();
    });

    // Telegram Mini App initial handshake
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand?.();
      if (SCENE_SPEC.environment?.backgroundColor) {
        window.Telegram.WebApp.setHeaderColor?.(SCENE_SPEC.environment.backgroundColor);
        window.Telegram.WebApp.setBackgroundColor?.(SCENE_SPEC.environment.backgroundColor);
      }
    }

    syncHudAndEngine();

    // Main Game Loop
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();

      if (!isGameOver && timeRemaining > 0) {
        timeRemaining -= dt;
        if (timeRemaining <= 0) {
          timeRemaining = 0;
          checkLevelProgression();
        }
        document.getElementById('timerDisplay').textContent = Math.max(0, Math.ceil(timeRemaining)) + 's';
      }

      if (SCENE_SPEC.engineType === '2d') {
        ctx2d.fillStyle = (SCENE_SPEC.environment && SCENE_SPEC.environment.backgroundColor) || '#0B101B';
        ctx2d.fillRect(0, 0, 1000, 600);

        const platforms = nodes2D.filter((n) => n.physics2D === 'static-platform');
        nodes2D.forEach((n) => {
          if (n.physics2D === 'player-platformer') {
            if (keys['a'] || keys['arrowleft']) n.x -= 280 * dt;
            if (keys['d'] || keys['arrowright']) n.x += 280 * dt;
            if ((keys['w'] || keys['arrowup'] || keys[' ']) && player2dGrounded) {
              player2dVelY = -480;
              player2dGrounded = false;
              playSynthSound('jump');
            }
            player2dVelY += 980 * dt;
            n.y += player2dVelY * dt;
            player2dGrounded = false;

            platforms.forEach((p) => {
              const overlapX = Math.abs(n.x - p.x) < (n.width + p.width) / 2;
              const pTop = p.y - p.height / 2;
              if (overlapX && player2dVelY >= 0 && n.y + n.height / 2 >= pTop && n.y + n.height / 2 <= pTop + 24) {
                n.y = pTop - n.height / 2;
                player2dVelY = 0;
                player2dGrounded = true;
              }
            });

            if (n.y > 550) {
              n.y = 550;
              player2dVelY = 0;
              player2dGrounded = true;
            }
          }
        });

        // Collectibles collision check
        const player = nodes2D.find((n) => n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown');
        if (player) {
          nodes2D = nodes2D.filter((n) => {
            if (n.physics2D === 'collectible') {
              const hit = Math.hypot(player.x - n.x, player.y - n.y) < (player.width + n.width) * 0.45;
              if (hit) {
                score += n.scoreValue || 25;
                playSynthSound('coin');
                updateScoreUI();
                return false;
              }
            }
            return true;
          });
        }

        nodes2D.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).forEach((n) => {
          ctx2d.save();
          ctx2d.translate(n.x, n.y);
          ctx2d.fillStyle = n.fill || '#06B6D4';
          if (n.type === 'text-kinetic') {
            ctx2d.font = '800 ' + (n.fontSize || 36) + 'px system-ui, sans-serif';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.fillText(n.text || n.name, 0, Math.sin(t * 3.5) * 5);
          } else if (n.type === 'circle' || n.type === 'star') {
            ctx2d.beginPath();
            ctx2d.arc(0, 0, Math.min(n.width, n.height) / 2, 0, Math.PI * 2);
            ctx2d.fill();
          } else {
            ctx2d.fillRect(-n.width / 2, -n.height / 2, n.width, n.height);
          }
          ctx2d.restore();
        });
      } else {
        actorMeshes.forEach((g) => {
          g.rotation.y = t * 1.2;
          const baseScale = g.userData.baseScale || [1, 1, 1];
          g.scale.lerp(new THREE.Vector3(...baseScale), 0.08);
        });
        renderer.render(scene3d, camera3d);
      }
    }
    animate();
  </script>
</body>
</html>`;
}

/**
 * 6. Export Standalone Single-File HTML5 Playable Ad
 */
export function exportStandalonePlayableHTML(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'universal',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions
): string {
  const htmlContent = generateStandaloneHTMLContent(sceneSpec, targetNetwork, scenes, options);
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const slug = slugifyTitle(sceneSpec.title, 'omnistage-game');
  triggerDownload(url, `${slug}-${targetNetwork}-playable.html`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return htmlContent;
}

/**
 * 7. Export Complete Standalone Game Package as ZIP (Standard itch.io / Ad Network bundle)
 */
export async function exportStandaloneGameZIP(
  sceneSpec: SceneSpec,
  targetNetwork: StandaloneAdNetwork = 'itch',
  scenes?: SceneSpec[],
  options?: StandalonePlayerOptions
): Promise<void> {
  const syncedScenes =
    scenes && scenes.length > 0
      ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s))
      : [sceneSpec];

  const htmlContent = generateStandaloneHTMLContent(sceneSpec, targetNetwork, syncedScenes, options);

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

  const zipBlob = createZipBlob(files);
  const url = URL.createObjectURL(zipBlob);
  const slug = slugifyTitle(sceneSpec.title, 'omnistage-game');
  triggerDownload(url, `${slug}-${targetNetwork}-package.zip`);
  setTimeout(() => URL.revokeObjectURL(url), 6000);
}
