import { SceneSpec } from '../types/scene.schema';

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function resolveActiveCanvas(canvas: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (canvas && canvas.isConnected) return canvas;
  return document.querySelector('canvas');
}

/**
 * 1. Instant PNG Snapshot Capture from 3D WebGL or 2D Vector/Sprite Canvas
 */
export function exportCanvasSnapshotPNG(
  canvas: HTMLCanvasElement | null,
  sceneTitle: string
): string | null {
  const targetCanvas = resolveActiveCanvas(canvas);
  if (!targetCanvas) return null;
  const dataUrl = targetCanvas.toDataURL('image/png', 1.0);
  const slug = (sceneTitle || 'omnistage-scene')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  triggerDownload(dataUrl, `${slug}-snapshot.png`);
  return dataUrl;
}

/**
 * 2. WebM Video Stream Recorder (3s / 5s / 10s) using HTMLCanvasElement.captureStream() + MediaRecorder
 * Works seamlessly across both 3D WebGL (StageCanvas) and 2D Canvas2D (StageCanvas2D) engines.
 */
export async function recordCanvasVideoWebM(
  canvas: HTMLCanvasElement | null,
  durationSeconds: number,
  sceneTitle: string,
  onProgress?: (progressRatio: number) => void
): Promise<boolean> {
  const targetCanvas = resolveActiveCanvas(canvas);
  if (!targetCanvas || typeof MediaRecorder === 'undefined') return false;

  const stream = targetCanvas.captureStream(60);
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
 * 3. Export Declarative SceneSpec + Multi-Scene Storyboard JSON Contract
 * Compatible with single-scene SceneSpec consumers AND full multi-scene project bundle importers.
 */
export function exportSceneSpecJSON(sceneSpec: SceneSpec, scenes?: SceneSpec[]) {
  const syncedScenes =
    scenes && scenes.length > 0
      ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s))
      : [sceneSpec];

  const payload = {
    ...sceneSpec,
    projectBundleVersion: '3.0.0',
    activeSceneId: sceneSpec.id,
    scenes: syncedScenes,
  };

  const jsonString = JSON.stringify(payload, null, 2);
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
 * 4. Export Self-Contained Single-File HTML5 Playable Ad Bundle (Dual 3D WebGL + 2D Canvas2D + Multi-Scene)
 * Ready for TikTok Playable Ads (MRAID 3.0), Meta Interactive Ads (FbPlayableAd), and Telegram Mini Apps.
 */
export function exportStandalonePlayableHTML(
  sceneSpec: SceneSpec,
  targetNetwork: 'tiktok' | 'meta' | 'telegram' = 'tiktok',
  scenes?: SceneSpec[]
) {
  const syncedScenes =
    scenes && scenes.length > 0
      ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s))
      : [sceneSpec];

  const bundleJson = JSON.stringify(syncedScenes);
  const activeIdJson = JSON.stringify(sceneSpec.id);

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${sceneSpec.title} — Playable Ad (${targetNetwork.toUpperCase()})</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body, html { width: 100%; height: 100%; overflow: hidden; background: ${sceneSpec.environment.backgroundColor || '#0B101B'}; font-family: system-ui, -apple-system, sans-serif; color: #F8FAFC; }
    .stage-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
    .hud-top { position: fixed; top: 14px; left: 14px; right: 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px; pointer-events: none; z-index: 20; flex-wrap: wrap; }
    .hud-left, .hud-right { display: flex; align-items: center; gap: 8px; pointer-events: auto; }
    .score-pill { background: rgba(9, 13, 22, 0.9); border: 1px solid rgba(6, 182, 212, 0.45); padding: 7px 13px; border-radius: 8px; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; }
    .engine-badge { background: rgba(6, 182, 212, 0.18); border: 1px solid rgba(6, 182, 212, 0.5); color: #67E8F9; padding: 6px 10px; border-radius: 7px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
    .scene-select { background: rgba(9, 13, 22, 0.92); border: 1px solid rgba(148, 163, 184, 0.35); color: #F8FAFC; padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .cta-bar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: min(440px, 92vw); background: rgba(9, 13, 22, 0.94); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 13px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 25; box-shadow: 0 20px 40px rgba(0,0,0,0.55); }
    .cta-btn { background: ${sceneSpec.marketingOverlay.brandColor || '#F59E0B'}; color: #090D16; font-weight: 800; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; text-transform: uppercase; white-space: nowrap; }
    .toast-banner { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); background: rgba(16, 185, 129, 0.95); color: #052E16; font-weight: 800; font-size: 12px; padding: 8px 16px; border-radius: 999px; z-index: 30; display: none; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <div class="hud-top">
    <div class="hud-left">
      <span class="engine-badge" id="engineBadge">${(sceneSpec.engineType || '3d').toUpperCase()}</span>
      <div class="score-pill" id="scoreDisplay">SCORE: 0 / ${sceneSpec.gameRules.targetScore}</div>
    </div>
    <div class="hud-right">
      <select class="scene-select" id="sceneSelect" style="display:none;"></select>
      <div class="score-pill" id="badgeText">${sceneSpec.marketingOverlay.badgeText || 'PLAYABLE AD'}</div>
    </div>
  </div>
  <div class="toast-banner" id="toastBanner"></div>
  <canvas id="stage3d" class="stage-canvas"></canvas>
  <canvas id="stage2d" class="stage-canvas" style="display:none;"></canvas>
  <div class="cta-bar" id="ctaBar">
    <div style="min-width:0;">
      <div id="headlineText" style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sceneSpec.marketingOverlay.headline}</div>
      <div id="subheadlineText" style="font-size:12px;color:#94A3B8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sceneSpec.marketingOverlay.subheadline}</div>
    </div>
    <button class="cta-btn" id="ctaBtn">${sceneSpec.marketingOverlay.ctaText}</button>
  </div>
  <script>
    const SCENES_BUNDLE = ${bundleJson};
    let activeSceneId = ${activeIdJson};
    let SCENE_SPEC = SCENES_BUNDLE.find((s) => s.id === activeSceneId) || SCENES_BUNDLE[0];
    let score = 0;

    function showNotice(msg) {
      const el = document.getElementById('toastBanner');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
    }

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
        const found = SCENES_BUNDLE.find((s) => s.id === e.target.value);
        if (found) {
          SCENE_SPEC = JSON.parse(JSON.stringify(found));
          score = 0;
          syncHudAndEngine();
        }
      });
    }

    document.getElementById('ctaBtn').addEventListener('click', () => {
      const targetUrl = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.ctaUrl) || 'https://example.com';
      if (window.mraid && window.mraid.open) window.mraid.open(targetUrl);
      else if (window.FbPlayableAd && window.FbPlayableAd.onCTAClick) window.FbPlayableAd.onCTAClick();
      else if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openLink) window.Telegram.WebApp.openLink(targetUrl);
      else showNotice('CTA Triggered: ' + SCENE_SPEC.marketingOverlay.ctaText + ' -> ' + targetUrl);
    });

    // Keyboard state shared by 3D & 2D engines
    const keys = {};
    window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    // --- 3D ENGINE SETUP ---
    const canvas3d = document.getElementById('stage3d');
    const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
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

      scene3d.add(new THREE.HemisphereLight(SCENE_SPEC.environment.keyLightColor || '#38BDF8', SCENE_SPEC.environment.groundColor || '#0F172A', 0.9));
      const dirLight = new THREE.DirectionalLight(SCENE_SPEC.environment.keyLightColor || '#ffffff', 2.0);
      dirLight.position.set(5, 9, 6);
      scene3d.add(dirLight);

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
        color: (terrainCfg && terrainCfg.primaryColor) || SCENE_SPEC.environment.groundColor || '#1E293B',
        roughness: 0.85,
        metalness: 0.12
      });
      const groundMesh = new THREE.Mesh(groundGeo, groundMat);
      groundMesh.rotation.x = -Math.PI / 2;
      scene3d.add(groundMesh);

      const grid = new THREE.GridHelper(28, 28, SCENE_SPEC.environment.rimLightColor || '#06B6D4', '#1E293B');
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
        group.userData = { actor: a };
        scene3d.add(group);
        actorMeshes.push(group);
      });
    }

    // --- 2D ENGINE SETUP ---
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

    function updateScoreUI() {
      document.getElementById('scoreDisplay').textContent = 'SCORE: ' + score + ' / ' + (SCENE_SPEC.gameRules ? SCENE_SPEC.gameRules.targetScore : 100);
    }

    function syncHudAndEngine() {
      const is2D = SCENE_SPEC.engineType === '2d';
      document.getElementById('engineBadge').textContent = is2D ? '2D ENGINE' : '3D ENGINE';
      document.getElementById('badgeText').textContent = (SCENE_SPEC.marketingOverlay && SCENE_SPEC.marketingOverlay.badgeText) || 'PLAYABLE AD';
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

    // 3D & 2D Pointer Interaction
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    window.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cta-bar') || e.target.closest('.hud-top')) return;
      if (SCENE_SPEC.engineType === '2d') {
        const rect = canvas2d.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 1000;
        const py = ((e.clientY - rect.top) / rect.height) * 600;
        let hitAny = false;
        nodes2D.forEach((n) => {
          if (px >= n.x - n.width / 2 && px <= n.x + n.width / 2 && py >= n.y - n.height / 2 && py <= n.y + n.height / 2) {
            hitAny = true;
            score += n.scoreValue || 20;
            updateScoreUI();
          }
        });
        if (!hitAny && player2dGrounded) {
          player2dVelY = -420;
          player2dGrounded = false;
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
            updateScoreUI();
            obj.scale.set(1.25, 1.25, 1.25);
          }
        }
      }
    });

    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera3d.aspect = window.innerWidth / window.innerHeight;
      camera3d.updateProjectionMatrix();
    });

    syncHudAndEngine();

    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();

      if (SCENE_SPEC.engineType === '2d') {
        ctx2d.fillStyle = (SCENE_SPEC.environment && SCENE_SPEC.environment.backgroundColor) || '#0B101B';
        ctx2d.fillRect(0, 0, 1000, 600);

        const platforms = nodes2D.filter((n) => n.physics2D === 'static-platform');
        nodes2D.forEach((n) => {
          if (n.physics2D === 'player-platformer') {
            if (keys['a'] || keys['arrowleft']) n.x -= 260 * dt;
            if (keys['d'] || keys['arrowright']) n.x += 260 * dt;
            if ((keys['w'] || keys['arrowup'] || keys[' ']) && player2dGrounded) {
              player2dVelY = -460;
              player2dGrounded = false;
            }
            player2dVelY += 920 * dt;
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
            if (n.y > 560) { n.y = 560; player2dVelY = 0; player2dGrounded = true; }
          }
        });

        // Collectibles check
        const player = nodes2D.find((n) => n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown');
        if (player) {
          nodes2D = nodes2D.filter((n) => {
            if (n.physics2D === 'collectible') {
              const hit = Math.hypot(player.x - n.x, player.y - n.y) < (player.width + n.width) * 0.45;
              if (hit) {
                score += n.scoreValue || 25;
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
            ctx2d.fillText(n.text || n.name, 0, Math.sin(t * 3) * 4);
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
          g.rotation.y = t * 1.3;
          g.scale.lerp(new THREE.Vector3(...(g.userData.actor.scale || [1, 1, 1])), 0.1);
        });
        renderer.render(scene3d, camera3d);
      }
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
