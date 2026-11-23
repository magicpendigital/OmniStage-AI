/**
 * Phase 2 (engine E1) — the 2D camera: a viewport of the fixed 1000x600 design size looking into a world that may be larger
 * (`SceneSpec.world2D`). Fixed, or following the player with a dead zone, look-ahead and smoothing; clamped to the world.
 * Pure maths; the same camera is used by the studio stage, Play Test and exported ads.
 */
import type { Camera2DSpec, World2DSpec } from '../../types/scene.schema';

export const VIEW_W = 1000;
export const VIEW_H = 600;
export const WORLD_LIMITS = { min: 320, max: 20000 } as const;

export const DEFAULT_WORLD: Readonly<World2DSpec> = Object.freeze({ width: VIEW_W, height: VIEW_H });

export interface Camera2DState {
  /** World coordinate at the top-left of the viewport. */
  x: number;
  y: number;
  zoom: number;
  /** False until the first follow step, which snaps instead of easing. */
  ready: boolean;
}

export interface Camera2DConfig {
  mode: 'fixed' | 'follow';
  zoom: number;
  /** Seconds the camera takes to catch up (0 = glued to the target). */
  smoothing: number;
  /** Half-size of the box around the view centre the target may move in before the camera follows (world px). */
  deadzoneX: number;
  deadzoneY: number;
  /** World px the camera leads in the direction the target is moving. */
  lookAhead: number;
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function resolveWorld(world?: World2DSpec): World2DSpec {
  const clampDim = (v: unknown, fallback: number) => Math.min(WORLD_LIMITS.max, Math.max(WORLD_LIMITS.min, finite(v, fallback)));
  return { width: clampDim(world?.width, VIEW_W), height: clampDim(world?.height, VIEW_H) };
}

/** A world bigger than one screen follows the player by default; the classic 1000x600 stage stays fixed. */
export function resolveCamera2D(camera: Camera2DSpec | undefined, world: World2DSpec): Camera2DConfig {
  const big = world.width > VIEW_W + 1 || world.height > VIEW_H + 1;
  const mode = camera?.mode === 'fixed' || camera?.mode === 'follow' ? camera.mode : big ? 'follow' : 'fixed';
  return {
    mode,
    zoom: Math.min(3, Math.max(0.5, finite(camera?.zoom, 1))),
    smoothing: Math.min(2, Math.max(0, finite(camera?.smoothing, 0.15))),
    deadzoneX: Math.min(400, Math.max(0, finite(camera?.deadzoneX, 60))),
    deadzoneY: Math.min(300, Math.max(0, finite(camera?.deadzoneY, 40))),
    lookAhead: Math.min(400, Math.max(0, finite(camera?.lookAhead, 80))),
  };
}

export function createCamera2D(): Camera2DState {
  return { x: 0, y: 0, zoom: 1, ready: false };
}

/** Authoring view: the whole world fits on screen (identity for the classic stage). */
export function fitWorldCamera(world: World2DSpec, cam: Camera2DState = createCamera2D()): Camera2DState {
  cam.zoom = Math.min(1, VIEW_W / world.width, VIEW_H / world.height);
  cam.x = 0;
  cam.y = 0;
  cam.ready = false;
  return cam;
}

function clampAxis(pos: number, view: number, world: number): number {
  if (world <= view) return (world - view) / 2;
  return Math.min(world - view, Math.max(0, pos));
}

export function clampCamera(cam: Camera2DState, world: World2DSpec): void {
  cam.x = clampAxis(cam.x, VIEW_W / cam.zoom, world.width);
  cam.y = clampAxis(cam.y, VIEW_H / cam.zoom, world.height);
}

export interface CameraTarget {
  x: number;
  y: number;
  /** Horizontal velocity, only its sign is used (look-ahead). */
  vx: number;
}

/** One play step. `fixed` shows the world's top-left (or its centre when it is smaller than the view). */
export function stepCamera2D(cam: Camera2DState, target: CameraTarget | null, cfg: Camera2DConfig, world: World2DSpec, dt: number): void {
  cam.zoom = cfg.zoom;
  if (cfg.mode === 'fixed' || !target) {
    if (cfg.mode === 'fixed') {
      cam.x = 0;
      cam.y = 0;
    }
    clampCamera(cam, world);
    return;
  }
  const viewW = VIEW_W / cam.zoom;
  const viewH = VIEW_H / cam.zoom;
  if (!cam.ready) {
    cam.x = target.x - viewW / 2;
    cam.y = target.y - viewH / 2;
    cam.ready = true;
    clampCamera(cam, world);
    return;
  }
  const tx = target.x + Math.sign(target.vx) * cfg.lookAhead;
  const cx = cam.x + viewW / 2;
  const cy = cam.y + viewH / 2;
  let wantX = cx;
  let wantY = cy;
  if (tx > cx + cfg.deadzoneX) wantX = tx - cfg.deadzoneX;
  else if (tx < cx - cfg.deadzoneX) wantX = tx + cfg.deadzoneX;
  if (target.y > cy + cfg.deadzoneY) wantY = target.y - cfg.deadzoneY;
  else if (target.y < cy - cfg.deadzoneY) wantY = target.y + cfg.deadzoneY;
  const alpha = cfg.smoothing <= 0 ? 1 : 1 - Math.exp(-dt / cfg.smoothing);
  cam.x += (wantX - cx) * alpha;
  cam.y += (wantY - cy) * alpha;
  clampCamera(cam, world);
}

/** Viewport (design px) → world position. */
export function screenToWorld(cam: Camera2DState, sx: number, sy: number) {
  return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
}
