import React, { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../state/useStudioStore';
import { Node2D } from '../types/scene.schema';

const DESIGN_WIDTH = 1000;
const DESIGN_HEIGHT = 600;

interface RuntimeBody2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  collected?: boolean;
}

export const StageCanvas2D: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const bodiesRef = useRef<Record<string, RuntimeBody2D>>({});
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const setCanvasElement = useStudioStore((s) => s.setCanvasElement);
  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const updateNode2D = useStudioStore((s) => s.updateNode2D);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const advanceTimeline = useStudioStore((s) => s.advanceTimeline);
  const settings = useStudioStore((s) => s.settings);

  // Register 2D canvas element for 4K PNG snapshots & 60fps WebM video capture
  useEffect(() => {
    if (canvasRef.current) {
      setCanvasElement(canvasRef.current);
    }
    return () => setCanvasElement(null);
  }, [setCanvasElement]);

  // Reset physics bodies when switching scenes or toggling playback
  useEffect(() => {
    const map: Record<string, RuntimeBody2D> = {};
    (sceneSpec.nodes2D || []).forEach((n) => {
      map[n.id] = {
        x: n.x,
        y: n.y,
        vx: n.physics2D === 'bouncing' ? 160 : 0,
        vy: n.physics2D === 'bouncing' ? -180 : 0,
        onGround: false,
        collected: false,
      };
    });
    bodiesRef.current = map;
  }, [sceneSpec.id, sceneSpec.nodes2D, isPlaying, sceneSpec.mode]);

  // Keyboard listeners for 2D Platformer / Top-Down Game Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      pressedKeysRef.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = DESIGN_WIDTH / rect.width;
    const scaleY = DESIGN_HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e);
    const nodes = [...(sceneSpec.nodes2D || [])].filter((n) => n.visible !== false).reverse();

    const hit = nodes.find(
      (n) =>
        x >= n.x - n.width / 2 &&
        x <= n.x + n.width / 2 &&
        y >= n.y - n.height / 2 &&
        y <= n.y + n.height / 2
    );

    if (hit) {
      selectNode2D(hit.id);
      if (!hit.locked && !(sceneSpec.mode === 'game' && isPlaying)) {
        setDraggingId(hit.id);
        dragOffsetRef.current = { dx: x - hit.x, dy: y - hit.y };
      }
    } else {
      selectNode2D(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingId) return;
    const { x, y } = toCanvasCoords(e);
    updateNode2D(draggingId, {
      x: Math.round(x - dragOffsetRef.current.dx),
      y: Math.round(y - dragOffsetRef.current.dy),
    });
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const storeState = useStudioStore.getState();
      if (storeState.isPlaying) {
        storeState.advanceTimeline(dt);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawStage2D(
            ctx,
            storeState.sceneSpec.nodes2D || [],
            storeState.sceneSpec.environment.backgroundColor || '#0B101B',
            storeState.sceneSpec.environment.groundGrid,
            storeState.selectedNode2DId,
            storeState.isPlaying,
            storeState.currentTime,
            storeState.sceneSpec.mode,
            dt,
            pressedKeysRef.current,
            bodiesRef.current,
            imageCacheRef.current,
            Math.abs(storeState.settings.physicsGravity || 9.8) * 90
          );
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [advanceTimeline, settings.physicsGravity]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        width={DESIGN_WIDTH}
        height={DESIGN_HEIGHT}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full object-contain cursor-crosshair shadow-2xl"
      />

      <div className="pointer-events-none absolute bottom-16 left-4 flex items-center gap-2 px-2.5 py-1 rounded bg-slate-900/85 border border-fuchsia-500/40 text-[11px] font-mono text-fuchsia-300">
        <span>2D VECTOR & SPRITE ENGINE (1000×600)</span>
        <span className="text-slate-500">·</span>
        <span>
          {sceneSpec.mode === 'game'
            ? 'WASD / SPACE to Jump & Collect'
            : 'Click & Drag 2D Layers directly on Canvas'}
        </span>
      </div>
    </div>
  );
};

function drawStage2D(
  ctx: CanvasRenderingContext2D,
  nodes: Node2D[],
  bgColor: string,
  showGrid: boolean,
  selectedId: string | null,
  isPlaying: boolean,
  currentTime: number,
  mode: 'game' | 'media',
  dt: number,
  keys: Set<string>,
  bodies: Record<string, RuntimeBody2D>,
  imageCache: Record<string, HTMLImageElement>,
  gravityPx: number
) {
  ctx.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

  const grad = ctx.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
  grad.addColorStop(0, bgColor);
  grad.addColorStop(1, '#050811');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

  if (showGrid) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const step = 50;
    for (let x = 0; x <= DESIGN_WIDTH; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, DESIGN_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= DESIGN_HEIGHT; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(DESIGN_WIDTH, y);
      ctx.stroke();
    }
  }

  // 2D Physics Simulation Step
  if (mode === 'game' && isPlaying) {
    const playerNode = nodes.find(
      (n) =>
        (n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown') &&
        n.visible !== false
    );
    const platforms = nodes.filter(
      (n) => n.physics2D === 'static-platform' && n.visible !== false
    );

    if (playerNode) {
      const b =
        bodies[playerNode.id] ||
        (bodies[playerNode.id] = {
          x: playerNode.x,
          y: playerNode.y,
          vx: 0,
          vy: 0,
          onGround: false,
        });

      const moveSpeed = 320;
      if (keys.has('a') || keys.has('arrowleft')) b.vx = -moveSpeed;
      else if (keys.has('d') || keys.has('arrowright')) b.vx = moveSpeed;
      else b.vx *= 0.82;

      if (playerNode.physics2D === 'player-topdown') {
        if (keys.has('w') || keys.has('arrowup')) b.vy = -moveSpeed;
        else if (keys.has('s') || keys.has('arrowdown')) b.vy = moveSpeed;
        else b.vy *= 0.82;
      } else {
        if ((keys.has('w') || keys.has('arrowup') || keys.has(' ')) && b.onGround) {
          b.vy = -520;
          b.onGround = false;
        }
        b.vy += gravityPx * dt;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.onGround = false;

      const halfW = playerNode.width / 2;
      const halfH = playerNode.height / 2;

      for (const plat of platforms) {
        const pLeft = plat.x - plat.width / 2;
        const pRight = plat.x + plat.width / 2;
        const pTop = plat.y - plat.height / 2;
        const pBottom = plat.y + plat.height / 2;

        if (b.x + halfW > pLeft && b.x - halfW < pRight) {
          if (
            b.vy >= 0 &&
            b.y + halfH >= pTop &&
            b.y - halfH < pTop &&
            b.y + halfH <= pBottom + 24
          ) {
            b.y = pTop - halfH;
            b.vy = 0;
            b.onGround = true;
          }
        }
      }

      if (b.x < halfW) b.x = halfW;
      if (b.x > DESIGN_WIDTH - halfW) b.x = DESIGN_WIDTH - halfW;
      if (b.y > DESIGN_HEIGHT + 100) {
        b.x = playerNode.x;
        b.y = playerNode.y;
        b.vx = 0;
        b.vy = 0;
      }

      // Check collectibles
      for (const other of nodes) {
        if (other.id === playerNode.id || other.visible === false) continue;
        const ob = bodies[other.id];
        if (ob?.collected) continue;

        const dist = Math.hypot(b.x - other.x, b.y - other.y);
        const minDist = (playerNode.width + other.width) * 0.42;
        if (dist < minDist && other.physics2D === 'collectible') {
          if (ob) ob.collected = true;
          useStudioStore
            .getState()
            .addGameScore(other.scoreValue ?? 25, other.name, other.fill);
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.visible === false) continue;
    const body = bodies[node.id];
    if (mode === 'game' && isPlaying && body?.collected) continue;

    const isDynamicPlayer =
      mode === 'game' &&
      isPlaying &&
      body &&
      (node.physics2D === 'player-platformer' || node.physics2D === 'player-topdown');

    let drawX = isDynamicPlayer ? body.x : node.x;
    let drawY = isDynamicPlayer ? body.y : node.y;
    let drawRot = (node.rotation * Math.PI) / 180;
    let drawScaleX = node.scaleX ?? 1;
    let drawScaleY = node.scaleY ?? 1;

    if (isPlaying) {
      if (node.keyframeTrack && node.keyframeTrack.length >= 2) {
        const sortedKf = [...node.keyframeTrack].sort((a, b) => a.time - b.time);
        const first = sortedKf[0];
        const last = sortedKf[sortedKf.length - 1];
        if (currentTime <= first.time) {
          drawX = first.x;
          drawY = first.y;
        } else if (currentTime >= last.time) {
          drawX = last.x;
          drawY = last.y;
        } else {
          for (let i = 0; i < sortedKf.length - 1; i++) {
            const k0 = sortedKf[i];
            const k1 = sortedKf[i + 1];
            if (currentTime >= k0.time && currentTime <= k1.time) {
              const alpha = (currentTime - k0.time) / Math.max(0.001, k1.time - k0.time);
              drawX = k0.x + (k1.x - k0.x) * alpha;
              drawY = k0.y + (k1.y - k0.y) * alpha;
              break;
            }
          }
        }
      } else if (node.physics2D === 'collectible' || node.shapeKind === 'star') {
        drawY += Math.sin(currentTime * 3.5 + node.x * 0.02) * 8;
        drawRot += currentTime * 1.4;
      } else if (node.type === 'text-kinetic') {
        const pulse = 1 + Math.sin(currentTime * 3.0) * 0.04;
        drawScaleX *= pulse;
        drawScaleY *= pulse;
      }
    }

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(drawRot);
    ctx.scale(drawScaleX, drawScaleY);
    ctx.globalAlpha = node.opacity ?? 1;

    const w = node.width;
    const h = node.height;

    if (node.imageUrl) {
      let img = imageCache[node.imageUrl];
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = node.imageUrl;
        imageCache[node.imageUrl] = img;
      }
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = node.fill;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
    } else if (node.type === 'text-kinetic') {
      ctx.font = `800 ${node.fontSize || 34}px "Space Grotesk", Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (node.stroke) {
        ctx.lineWidth = (node.strokeWidth || 2) * 2;
        ctx.strokeStyle = node.stroke;
        ctx.strokeText(node.text || node.name, 0, 0);
      }
      ctx.fillStyle = node.fill;
      ctx.fillText(node.text || node.name, 0, 0);
    } else if (node.shapeKind === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#ffffff';
        ctx.stroke();
      }
    } else if (node.shapeKind === 'star') {
      drawStarPath(ctx, 0, 0, 5, Math.min(w, h) / 2, Math.min(w, h) / 4.2);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#ffffff';
        ctx.stroke();
      }
    } else if (node.shapeKind === 'capsule' || node.type === 'sprite-actor') {
      drawRoundedRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.35);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#ffffff';
        ctx.stroke();
      }
      if (node.type === 'sprite-actor') {
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, -w * 0.22, -h * 0.26, w * 0.52, h * 0.22, 6);
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(w * 0.12, -h * 0.15, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      drawRoundedRect(ctx, -w / 2, -h / 2, w, h, 8);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#38bdf8';
        ctx.stroke();
      }
    }

    if (node.id === selectedId) {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number
) {
  let rot = (Math.PI / 2) * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}
