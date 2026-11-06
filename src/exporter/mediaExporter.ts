import { SceneSpec } from '../types/scene.schema';

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 1. Instant PNG Snapshot Capture from WebGL Canvas
 */
export function exportCanvasSnapshotPNG(
  canvas: HTMLCanvasElement | null,
  sceneTitle: string
): string | null {
  if (!canvas) return null;
  const dataUrl = canvas.toDataURL('image/png', 1.0);
  const slug = (sceneTitle || 'omnistage-scene')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  triggerDownload(dataUrl, `${slug}-snapshot.png`);
  return dataUrl;
}

/**
 * 2. WebM Video Stream Recorder (3s / 5s / 10s) using HTMLCanvasElement.captureStream() + MediaRecorder
 */
export async function recordCanvasVideoWebM(
  canvas: HTMLCanvasElement | null,
  durationSeconds: number,
  sceneTitle: string,
  onProgress?: (progressRatio: number) => void
): Promise<boolean> {
  if (!canvas || typeof MediaRecorder === 'undefined') return false;

  const stream = canvas.captureStream(60);
  const mimeCandidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const selectedMime =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  return new Promise((resolve) => {
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: selectedMime,
      videoBitsPerSecond: 8_000_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: selectedMime });
      const url = URL.createObjectURL(blob);
      const slug = (sceneTitle || 'omnistage-video')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      triggerDownload(url, `${slug}-${durationSeconds}s.webm`);
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
 * 3. Export Raw Declarative SceneSpec JSON Contract (for Claude Code / Antigravity / Codex)
 */
export function exportSceneSpecJSON(sceneSpec: SceneSpec) {
  const jsonString = JSON.stringify(sceneSpec, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const slug = (sceneSpec.title || 'scene-spec')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  triggerDownload(url, `${slug}.scenespec.json`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * 4. Export Self-Contained Single-File HTML5 Playable Ad Bundle
 * Ready for TikTok Playable Ads, Meta Interactive Ads, and Telegram Mini Apps.
 */
export function exportStandalonePlayableHTML(
  sceneSpec: SceneSpec,
  targetNetwork: 'tiktok' | 'meta' | 'telegram' = 'tiktok'
) {
  const specJson = JSON.stringify(sceneSpec);
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${sceneSpec.title} — Playable Ad (${targetNetwork.toUpperCase()})</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body, html { width: 100%; height: 100%; overflow: hidden; background: ${sceneSpec.environment.backgroundColor}; font-family: system-ui, -apple-system, sans-serif; color: #F8FAFC; }
    #stage { width: 100vw; height: 100vh; display: block; }
    .hud-top { position: fixed; top: 16px; left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: center; pointer-events: none; z-index: 10; }
    .score-pill { background: rgba(9, 13, 22, 0.88); border: 1px solid rgba(6, 182, 212, 0.45); padding: 8px 14px; border-radius: 8px; font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; }
    .cta-bar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); width: min(420px, 92vw); background: rgba(9, 13, 22, 0.92); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 20; }
    .cta-btn { background: ${sceneSpec.marketingOverlay.brandColor || '#F59E0B'}; color: #090D16; font-weight: 800; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-size: 13px; text-transform: uppercase; white-space: nowrap; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <div class="hud-top">
    <div class="score-pill" id="scoreDisplay">SCORE: 0 / ${sceneSpec.gameRules.targetScore}</div>
    <div class="score-pill">${sceneSpec.marketingOverlay.badgeText || 'PLAYABLE AD'}</div>
  </div>
  <canvas id="stage"></canvas>
  <div class="cta-bar">
    <div>
      <div style="font-weight:800;font-size:15px;">${sceneSpec.marketingOverlay.headline}</div>
      <div style="font-size:12px;color:#94A3B8;margin-top:2px;">${sceneSpec.marketingOverlay.subheadline}</div>
    </div>
    <button class="cta-btn" id="ctaBtn">${sceneSpec.marketingOverlay.ctaText}</button>
  </div>
  <script>
    const SCENE_SPEC = ${specJson};
    let score = 0;
    document.getElementById('ctaBtn').addEventListener('click', () => {
      if (window.mraid && window.mraid.open) window.mraid.open(SCENE_SPEC.marketingOverlay.ctaUrl || 'https://example.com');
      else if (window.FbPlayableAd && window.FbPlayableAd.onCTAClick) window.FbPlayableAd.onCTAClick();
      else alert('Playable Ad CTA Triggered: ' + SCENE_SPEC.marketingOverlay.ctaText);
    });

    const canvas = document.getElementById('stage');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_SPEC.environment.backgroundColor || '#0B101B');

    const camera = new THREE.PerspectiveCamera(SCENE_SPEC.camera.fov || 45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(...SCENE_SPEC.camera.position);
    camera.lookAt(...SCENE_SPEC.camera.target);

    scene.add(new THREE.HemisphereLight(SCENE_SPEC.environment.keyLightColor, SCENE_SPEC.environment.groundColor, 0.85));
    const dirLight = new THREE.DirectionalLight(SCENE_SPEC.environment.keyLightColor, 2.0);
    dirLight.position.set(5, 8, 6);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(24, 24, SCENE_SPEC.environment.rimLightColor, '#1E293B');
    scene.add(grid);

    const actorMeshes = [];
    SCENE_SPEC.actors.forEach((a) => {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: a.primaryColor || '#06B6D4', metalness: 0.75, roughness: 0.25 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.25, 24), new THREE.MeshStandardMaterial({ color: '#1E293B' }));
      base.position.y = 0.125;
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 1), mat);
      body.position.y = 1.1;
      group.add(base, body);
      group.position.set(...a.position);
      group.userData = { actor: a };
      scene.add(group);
      actorMeshes.push(group);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    window.addEventListener('pointerdown', (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(actorMeshes, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj.parent && !obj.userData.actor) obj = obj.parent;
        const actor = obj.userData.actor;
        if (actor) {
          score += actor.scoreValue || 15;
          document.getElementById('scoreDisplay').textContent = 'SCORE: ' + score + ' / ' + SCENE_SPEC.gameRules.targetScore;
          obj.scale.set(1.25, 1.25, 1.25);
        }
      }
    });

    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      actorMeshes.forEach((g) => {
        g.rotation.y = t * 1.4;
        g.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
      });
      renderer.render(scene, camera);
    }
    animate();
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const slug = (sceneSpec.title || 'omnistage-playable')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  triggerDownload(url, `${slug}-${targetNetwork}-playable.html`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
