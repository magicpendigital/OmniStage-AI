/**
 * Phase 7 — 2D stage frame: platformer / top-down physics, collisions, logic-graph contacts, node drawing (shapes,
 * text, sprites, spritesheets, particles), VFX and captions. Shared verbatim by the studio StageCanvas2D and the
 * OmniStage Player, so the editor, Play Test, phones and exports run the same simulation.
 */
import { playerClipFor, spriteFrameAt } from '../animation/spriteSheet';
import { particleRuntimeFor } from '../vfx/particles2D';
import { activeCaptions, drawCaptionOnCanvas } from '../media/captions';
import { playSceneSfx } from '../audio/audioBus';
import { sampleKeyframes } from '../animation/easing';
import { Node2D } from '../types/scene.schema';
import { runtimeStore } from './host';
import { DESIGN_HEIGHT, DESIGN_WIDTH, findLogicContacts, RuntimeLogicGraph } from './logicGraph';

export interface RuntimeBody2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  collected?: boolean;
  specX?: number;
  specY?: number;
}

export function drawStage2D(
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
  gravityPx: number,
  logicRuntime: RuntimeLogicGraph
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
          playSceneSfx(runtimeStore.getState().sceneSpec, 'jump');
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

    }
  }

  if (isPlaying) {
    const live = nodes.filter((n) => n.visible !== false && !bodies[n.id]?.collected);
    const pairs = findLogicContacts({ ...runtimeStore.getState().sceneSpec, nodes2D: live }, logicRuntime.runtimePosition);
    const handled = logicRuntime.collisions(pairs);
    for (const [id, otherId] of pairs) {
      const player = live.find((n) => n.id === id);
      const other = live.find((n) => n.id === otherId);
      if (mode === 'game' && !handled.has(otherId) && player?.physics2D.startsWith('player-') && other?.physics2D === 'collectible') {
        if (bodies[other.id]) bodies[other.id].collected = true;
        runtimeStore.getState().addGameScore(other.scoreValue ?? 25, other.name, other.fill);
      }
    }
    // Collision actions can move/hide nodes or spawn effects in this same frame.
    nodes = runtimeStore.getState().sceneSpec.nodes2D;
  }

  for (const node of nodes) {
    if (node.visible === false) continue;
    const body = bodies[node.id];
    if (mode === 'game' && isPlaying && body?.collected) continue;

    const position = displayedPosition2D(node, isPlaying, currentTime, mode, bodies);
    const drawX = position.x;
    const drawY = position.y;
    let drawRot = (node.rotation * Math.PI) / 180;
    let drawScaleX = node.scaleX ?? 1;
    let drawScaleY = node.scaleY ?? 1;

    if (isPlaying) {
      if (!node.keyframeTrack?.length && (node.physics2D === 'collectible' || node.shapeKind === 'star')) {
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

    if (node.type === 'particle-emitter' && node.emitter) {
      // Phase 5: deterministic particles — a pure function of (preset, seed, timeline time).
      particleRuntimeFor(runtimeStore.getState().sceneSpec.particleLibrary).draw(ctx, node.emitter.preset, node.emitter.seed ?? 7, currentTime, w, h, node.emitter.rate, node.emitter.color);
      if (!isPlaying) {
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);
      }
    } else if (node.imageUrl) {
      let img = imageCache[node.imageUrl];
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = node.imageUrl;
        imageCache[node.imageUrl] = img;
      }
      const frame = node.spriteSheet
        ? spriteFrameAt(
            node.spriteSheet,
            currentTime,
            node.physics2D === 'player-platformer' && body ? playerClipFor(node.spriteSheet, body.vx, body.onGround) : undefined
          )
        : null;
      if (img.complete && img.naturalWidth > 0 && frame) {
        if (body && body.vx < -20 && node.physics2D.startsWith('player-')) ctx.scale(-1, 1);
        ctx.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, -w / 2, -h / 2, w, h);
      } else if (img.complete && img.naturalWidth > 0) {
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

  // Render graph-created effects from the same declarative VFX contract as 3D.
  for (const effect of runtimeStore.getState().sceneSpec.vfx) {
    if (effect.visible === false || !isPlaying || currentTime < (effect.startTime ?? 0) || currentTime > (effect.endTime ?? Infinity)) continue;
    const age = currentTime - (effect.startTime ?? 0);
    ctx.save();
    ctx.translate(effect.position[0], effect.position[1]);
    ctx.strokeStyle = ctx.fillStyle = effect.color;
    ctx.globalAlpha = Math.max(0, 1 - age);
    if (effect.type === 'floating-3d-badge') {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(effect.labelText || effect.name, 0, -age * 40);
    } else if (effect.type === 'laser-beam') {
      ctx.fillRect(-3, -80, 6, 160);
    } else if (effect.type === 'shockwave') {
      ctx.beginPath(); ctx.arc(0, 0, 10 + age * 90, 0, Math.PI * 2); ctx.stroke();
    } else {
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        ctx.fillRect(Math.cos(angle) * age * 90, Math.sin(angle) * age * 90 + (effect.type === 'confetti' ? age * age * 80 : 0), 4, 4);
      }
    }
    ctx.restore();
  }

  // Phase 5: captions are drawn into the canvas so recorded video and snapshots include them.
  for (const cue of activeCaptions(runtimeStore.getState().sceneSpec.captions, currentTime)) {
    drawCaptionOnCanvas(ctx, cue, DESIGN_WIDTH, DESIGN_HEIGHT);
  }
}

export function displayedPosition2D(node: Node2D, isPlaying: boolean, time: number, mode: 'game' | 'media', bodies: Record<string, RuntimeBody2D>) {
  const body = bodies[node.id];
  let x = node.x, y = node.y;
  if (isPlaying && mode === 'game' && body && node.physics2D.startsWith('player-') && body.specX === node.x && body.specY === node.y) {
    x = body.x; y = body.y;
  }
  if (isPlaying && node.keyframeTrack?.length) {
    // Phase 4: per-keyframe easing (GSAP-style curves from src/animation/easing.ts).
    const seg = sampleKeyframes(node.keyframeTrack, time);
    if (seg) {
      x = seg.from.x + (seg.to.x - seg.from.x) * seg.progress;
      y = seg.from.y + (seg.to.y - seg.from.y) * seg.progress;
    }
  } else if (isPlaying && (node.physics2D === 'collectible' || node.shapeKind === 'star')) {
    y += Math.sin(time * 3.5 + node.x * 0.02) * 8;
  }
  return { x, y };
}

export function drawRoundedRect(
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

export function drawStarPath(
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

/**
 * One complete 2D frame: advance the logic graph / timeline, keep physics bodies in sync with the scene, then
 * simulate and draw. Used by the studio StageCanvas2D and the OmniStage Player.
 */
export function stepStage2D(
  ctx: CanvasRenderingContext2D,
  dt: number,
  keys: Set<string>,
  bodies: Record<string, RuntimeBody2D>,
  imageCache: Record<string, HTMLImageElement>,
  logicRuntime: RuntimeLogicGraph,
  opts: { selectedId?: string | null; showGrid?: boolean } = {}
): { bodiesReset: boolean } {
  const generation = logicRuntime.generation;
  logicRuntime.advance(dt);
  const bodiesReset = generation !== logicRuntime.generation;
  if (bodiesReset) for (const id of Object.keys(bodies)) delete bodies[id];
  const state = runtimeStore.getState();
  const liveIds = new Set(state.sceneSpec.nodes2D.map((n) => n.id));
  for (const id of Object.keys(bodies)) if (!liveIds.has(id)) delete bodies[id];
  for (const node of state.sceneSpec.nodes2D) {
    const body = bodies[node.id];
    if (!body) bodies[node.id] = { x: node.x, y: node.y, vx: 0, vy: 0, onGround: false, specX: node.x, specY: node.y };
    else if (body.specX !== node.x || body.specY !== node.y || !state.isPlaying) {
      Object.assign(body, { x: node.x, y: node.y, specX: node.x, specY: node.y, vx: 0, vy: 0, onGround: false });
    }
  }
  drawStage2D(
    ctx,
    state.sceneSpec.nodes2D || [],
    state.sceneSpec.environment.backgroundColor || '#0B101B',
    opts.showGrid ?? state.sceneSpec.environment.groundGrid,
    opts.selectedId ?? null,
    state.isPlaying,
    state.currentTime,
    state.sceneSpec.mode,
    dt,
    keys,
    bodies,
    imageCache,
    Math.abs(state.settings.physicsGravity || 9.8) * 90,
    logicRuntime
  );
  return { bodiesReset };
}

/** Topmost visible node under a point in the 1000x600 design space (respects rotation and runtime positions). */
export function hitTest2D(x: number, y: number, bodies: Record<string, RuntimeBody2D>): Node2D | undefined {
  const state = runtimeStore.getState();
  const nodes = [...(state.sceneSpec.nodes2D || [])].filter((n) => n.visible !== false && !(state.isPlaying && bodies[n.id]?.collected)).reverse();
  return nodes.find((n) => {
    const position = displayedPosition2D(n, state.isPlaying, state.currentTime, state.sceneSpec.mode, bodies);
    const angle = (-n.rotation * Math.PI) / 180;
    const dx = x - position.x;
    const dy = y - position.y;
    return (
      Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) <= (n.width * Math.abs(n.scaleX)) / 2 &&
      Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) <= (n.height * Math.abs(n.scaleY)) / 2
    );
  });
}

/** Maps a pointer position on a letterboxed 1000x600 canvas to design coordinates. */
export function toDesignCoords(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  const scale = Math.min(rect.width / DESIGN_WIDTH, rect.height / DESIGN_HEIGHT);
  return {
    x: (clientX - rect.left - (rect.width - DESIGN_WIDTH * scale) / 2) / scale,
    y: (clientY - rect.top - (rect.height - DESIGN_HEIGHT * scale) / 2) / scale,
  };
}
