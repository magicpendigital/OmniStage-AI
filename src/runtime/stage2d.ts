/**
 * Phase 7 — 2D stage frame: platformer / top-down physics, collisions, logic-graph contacts, node drawing (shapes,
 * text, sprites, spritesheets, particles), VFX and captions. Shared verbatim by the studio StageCanvas2D and the
 * OmniStage Player, so the editor, Play Test, phones and exports run the same simulation.
 */
import { sceneCaptions } from '../audio/voices';
import { playerClipFor, spriteFrameAt } from '../animation/spriteSheet';
import { particleRuntimeFor } from '../vfx/particles2D';
import { activeCaptions, drawCaptionOnCanvas } from '../media/captions';
import { playSceneSfx } from '../audio/audioBus';
import { sampleKeyframes } from '../animation/easing';
import { Node2D, SceneSpec } from '../types/scene.schema';
import { runtimeStore } from './host';
import { DESIGN_HEIGHT, DESIGN_WIDTH, findLogicContacts, RuntimeLogicGraph } from './logicGraph';
import { overlaps, Solid } from './physics/collide2d';
import { Camera2DState, createCamera2D, fitWorldCamera, resolveCamera2D, resolveWorld, screenToWorld, stepCamera2D } from './physics/camera2d';
import { moverOffset } from './physics/mover';
import { nodeBox2D } from './physics/nodeBox';
import { ControllerInput, createPlatformerState, PlatformerState, stepPlatformer, stepTopDown } from './physics/platformer';
import { resolveTuning } from './physics/constants';
import { stepGameEntities2D } from './game/entities2d';
import { applyInputMap } from './inputMap';
import { healthMax } from './game/state';
import type { ProjectileClock, SpawnerClock } from './game/state';

export interface RuntimeBody2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  collected?: boolean;
  specX?: number;
  specY?: number;
  /** Phase 2: the player's controller state (coyote time, jump buffer, …), created on the first play frame. */
  ctl?: PlatformerState;
  /** Phase 2: where the player comes back after a hazard or a fall (start position, then the last checkpoint). */
  respawnX?: number;
  respawnY?: number;
  /** Phase 2: a checkpoint the player has already touched. */
  reached?: boolean;
  /** Phase 2: a mover's offset last frame, so the platform's per-frame travel (and its rider's carry) is exact. */
  moverPrev?: { x: number; y: number };
  /** Phase 3: a spawner's timer and a projectile's age (see ./game/entities2d.ts). */
  spawnClock?: SpawnerClock;
  projClock?: ProjectileClock;
}

/** One camera per bodies map (= per stage instance / scene): the studio and Player both read it for pointer hit tests. */
const cameras = new WeakMap<object, Camera2DState>();
export function cameraFor(bodies: Record<string, RuntimeBody2D>): Camera2DState {
  let cam = cameras.get(bodies);
  if (!cam) {
    cam = createCamera2D();
    cameras.set(bodies, cam);
  }
  return cam;
}

function inputFromKeys(keys: Set<string>): ControllerInput {
  return {
    left: keys.has('a') || keys.has('arrowleft'),
    right: keys.has('d') || keys.has('arrowright'),
    up: keys.has('w') || keys.has('arrowup'),
    down: keys.has('s') || keys.has('arrowdown'),
    jump: keys.has('w') || keys.has('arrowup') || keys.has(' '),
  };
}

function isCollidable(role: Node2D['physics2D']) {
  return role === 'static-platform' || role === 'solid';
}

/**
 * Phase 2: one game-mode physics step for the player: build the solids (moving platforms carry what stands on them),
 * run the controller, then resolve hazards, checkpoints, the world edge and falling out of the world.
 */
function simulatePlayer2D(
  spec: SceneSpec,
  nodes: Node2D[],
  player: Node2D,
  bodies: Record<string, RuntimeBody2D>,
  keys: Set<string>,
  dt: number,
  time: number,
  gravityPx: number
) {
  const world = resolveWorld(spec.world2D);
  const topDown = player.physics2D === 'player-topdown';
  const body = bodies[player.id];
  const tuning = resolveTuning(player.controller, gravityPx);

  const solids: Solid[] = [];
  for (const n of nodes) {
    if (n.visible === false || n.prefab || !isCollidable(n.physics2D)) continue;
    const off = moverOffset(n.mover, time);
    const nb = bodies[n.id];
    const prev = nb?.moverPrev ?? off;
    if (nb) nb.moverPrev = off;
    const box = nodeBox2D(n, { x: n.x + off.x, y: n.y + off.y });
    solids.push({
      id: n.id,
      box,
      kind: n.physics2D === 'solid' || topDown ? 'solid' : 'one-way',
      dx: off.x - prev.x,
      dy: off.y - prev.y,
    });
  }

  const hit = nodeBox2D(player, { x: body.x, y: body.y });
  const offX = hit.x - body.x;
  const offY = hit.y - body.y;
  let ctl = body.ctl;
  if (!ctl) {
    ctl = body.ctl = createPlatformerState(hit.x, hit.y, hit.w, hit.h);
    body.respawnX ??= body.x;
    body.respawnY ??= body.y;
  }
  ctl.w = hit.w;
  ctl.h = hit.h;
  ctl.x = hit.x;
  ctl.y = hit.y;

  const input = inputFromKeys(applyInputMap(spec.input, keys));
  if (topDown) stepTopDown(ctl, input, dt, solids, tuning);
  else if (stepPlatformer(ctl, input, dt, solids, tuning).jumped) playSceneSfx(spec, 'jump');

  const halfW = ctl.w / 2;
  if (ctl.x < halfW) ctl.x = halfW;
  if (ctl.x > world.width - halfW) ctl.x = world.width - halfW;
  if (topDown) ctl.y = Math.min(world.height - ctl.h / 2, Math.max(ctl.h / 2, ctl.y));

  const respawn = () => {
    const x = body.respawnX ?? player.x;
    const y = body.respawnY ?? player.y;
    body.ctl = createPlatformerState(x + offX, y + offY, hit.w, hit.h);
    ctl = body.ctl;
  };

  // Hazards and checkpoints are sensors: they never block, they react to overlap.
  const box = { x: ctl.x, y: ctl.y, w: ctl.w, h: ctl.h };
  let dead = !topDown && ctl.y - ctl.h / 2 > world.height + 100;
  let hurt = 1;
  for (const n of nodes) {
    if (n.visible === false || n.prefab || (n.physics2D !== 'hazard' && n.physics2D !== 'checkpoint')) continue;
    const off = moverOffset(n.mover, time);
    const sensor = nodeBox2D(n, { x: n.x + off.x, y: n.y + off.y });
    if (!overlaps(box, sensor)) continue;
    if (n.physics2D === 'hazard') {
      dead = true;
      hurt = Math.max(hurt, n.contactDamage ?? 1);
    }
    else {
      const nb = bodies[n.id];
      if (nb && !nb.reached) {
        nb.reached = true;
        playSceneSfx(spec, 'collect');
      }
      // Come back standing on the checkpoint.
      body.respawnX = sensor.x - offX;
      body.respawnY = sensor.y + sensor.h / 2 - hit.h / 2 - offY;
    }
  }
  if (dead) {
    // Phase 3: with hit points a hazard or a fall costs health first (the death rule ends the game at 0).
    if (healthMax(player) !== undefined) runtimeStore.getState().damageEntity(player.id, hurt);
    else playSceneSfx(spec, 'hit');
    respawn();
  }

  body.x = ctl.x - offX;
  body.y = ctl.y - offY;
  body.vx = ctl.vx;
  body.vy = ctl.vy;
  body.onGround = ctl.grounded;
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

  // Phase 2: the world may be bigger than one screen. While authoring (or in media mode) the whole world is fitted on
  // screen; while a game plays the camera follows the player.
  const spec = runtimeStore.getState().sceneSpec;
  const world = resolveWorld(spec.world2D);
  const cam = cameraFor(bodies);
  const follow = mode === 'game' && isPlaying;

  // 2D Physics Simulation Step (Phase 2: src/runtime/physics/*)
  let target: { x: number; y: number; vx: number } | null = null;
  if (follow) {
    const playerNode = nodes.find((n) => (n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown') && n.visible !== false);
    if (playerNode) {
      const b =
        bodies[playerNode.id] ||
        (bodies[playerNode.id] = { x: playerNode.x, y: playerNode.y, vx: 0, vy: 0, onGround: false });
      simulatePlayer2D(spec, nodes, playerNode, bodies, keys, dt, currentTime, gravityPx);
      target = { x: b.x, y: b.y, vx: b.vx };
    }
  }
  if (follow) stepCamera2D(cam, target, resolveCamera2D(spec.camera2D, world), world, dt);
  else fitWorldCamera(world, cam);

  ctx.save();
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  if (showGrid) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const step = 50;
    for (let x = 0; x <= world.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.height);
      ctx.stroke();
    }
    for (let y = 0; y <= world.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(world.width, y);
      ctx.stroke();
    }
  }
  if (!isPlaying && (world.width > DESIGN_WIDTH || world.height > DESIGN_HEIGHT)) {
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.5)';
    ctx.lineWidth = 2 / cam.zoom;
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(0, 0, world.width, world.height);
    ctx.setLineDash([]);
  }

  if (isPlaying) {
    // Phase 3: spawners, projectiles and contact damage (game mode); clones appear in the scene this frame.
    if (mode === 'game') {
      stepGameEntities2D(bodies, dt);
      nodes = runtimeStore.getState().sceneSpec.nodes2D;
    }
    const live = nodes.filter((n) => n.visible !== false && !n.prefab && !bodies[n.id]?.collected);
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
    // A prefab is only a template: visible (dimmed) while authoring, absent while the game plays.
    if (node.prefab && isPlaying && mode === 'game') continue;
    const body = bodies[node.id];
    if (mode === 'game' && isPlaying && body?.collected) continue;

    const position = displayedPosition2D(node, isPlaying, currentTime, mode, bodies);
    // Phase 2: a parallax layer drifts against the camera (factor 1 = moves with the world, 0 = pinned to the screen).
    const parallax = node.type === 'parallax-layer' ? 1 - Math.min(1, Math.max(0, node.parallaxFactor ?? 0.5)) : 0;
    const drawX = position.x + cam.x * parallax;
    const drawY = position.y + cam.y * parallax;
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
    // Phase 2: a checkpoint lights up once the player has touched it.
    if (isPlaying && mode === 'game' && node.physics2D === 'checkpoint' && !body?.reached) ctx.globalAlpha *= 0.5;
    if (node.prefab) ctx.globalAlpha *= 0.35;

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

  ctx.restore(); // end of the camera transform: captions are screen-space
  // Phase 5: captions are drawn into the canvas so recorded video and snapshots include them.
  for (const cue of activeCaptions(sceneCaptions(runtimeStore.getState().sceneSpec), currentTime)) {
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
  // Phase 2: moving platforms follow a pure function of timeline time.
  if (isPlaying && node.mover && !node.keyframeTrack?.length) {
    const off = moverOffset(node.mover, time);
    x += off.x;
    y += off.y;
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
      // Phase 2: stopping, restarting or moving a node from a logic action also restarts its controller / respawn state.
      Object.assign(body, {
        x: node.x, y: node.y, specX: node.x, specY: node.y, vx: 0, vy: 0, onGround: false,
        ctl: undefined, respawnX: undefined, respawnY: undefined, reached: false, moverPrev: undefined,
      });
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

/** Design-space (viewport) point → world coordinates through the stage's current camera. Pointer code calls this before `hitTest2D`. */
export function designToWorld(x: number, y: number, bodies: Record<string, RuntimeBody2D>) {
  return screenToWorld(cameraFor(bodies), x, y);
}

/** Topmost visible node under a WORLD point (see `designToWorld`; respects rotation and runtime positions). */
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
