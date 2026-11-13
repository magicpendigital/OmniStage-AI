/**
 * Phase 10A — acting and shot direction, shared by the studio viewport, the OmniStage Player, Preview and video export.
 * Pure maths (no Three.js, React or store): given a SceneSpec and a time, where is each performer, which clip plays,
 * and where is the camera. Deterministic, so scrubbing, Preview and frame-stepped renders agree.
 */
import { dialogueTimeline, talkLevelAt } from '../audio/voices';
import { applyEase } from '../animation/easing';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { computeTerrainHeight } from './world';
import type {
  ActorNode,
  AnimationType,
  CameraShot,
  PerformanceStep,
  SceneSpec,
  SceneTransition,
  ShotType,
  Vector3Tuple,
} from '../types/scene.schema';

const TURN_SECONDS = 0.35;
const RUN_SPEED = 2.6; // m/s above which an auto clip becomes Run

export interface PerformedPose {
  position: Vector3Tuple;
  /** Facing in radians around +y (0 = towards +z). */
  yaw: number;
  clip?: string;
  animation: AnimationType;
  speed: number;
  moving: boolean;
}

type World = Pick<SceneSpec, 'world'>['world'] | undefined;

export function hasPerformance(actor: Pick<ActorNode, 'performance'>): boolean {
  return Array.isArray(actor.performance) && actor.performance.length > 0;
}

function groundY(world: World, x: number, z: number): number {
  const t = world?.terrain;
  if (!t || t.type === 'flat-grid' || t.type === 'none') return 0;
  return computeTerrainHeight(t.type, x, z, t.elevationScale ?? 1);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

function sortedSteps(actor: ActorNode): PerformanceStep[] {
  return [...(actor.performance || [])]
    .filter((s) => s && Number.isFinite(s.time))
    .sort((a, b) => a.time - b.time);
}

/**
 * Pose of a performer at `time`. Steps apply in order from the actor's base position / rotation / clip.
 * `depth` stops lookAt recursion (a lookAt target is resolved without its own lookAt).
 */
export function resolvePerformance(actor: ActorNode, time: number, actors: ActorNode[] = [], world?: World, depth = 0): PerformedPose {
  let pos: Vector3Tuple = [...actor.position];
  let clip = actor.activeClip;
  let animation: AnimationType = actor.activeAnimation || 'idle';
  let speed = actor.animationSpeed ?? 1;
  let moving = false;
  // Facing keys: the pose eases from the previous key to the latest one.
  let prevYaw = actor.rotation?.[1] ?? 0;
  let keyYaw = prevYaw;
  let keyTime = -Infinity;
  const setYaw = (yaw: number, at: number) => {
    if (at > time) return;
    prevYaw = yawAt(at);
    keyYaw = yaw;
    keyTime = at;
  };
  const yawAt = (t: number) => (Number.isFinite(keyTime) ? lerpAngle(prevYaw, keyYaw, smooth((t - keyTime) / TURN_SECONDS)) : keyYaw);

  const steps = sortedSteps(actor);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.time > time) break;
    const nextTime = steps[i + 1]?.time;
    if (step.speed !== undefined && Number.isFinite(step.speed)) speed = step.speed;
    if (step.animation) animation = step.animation;
    if (step.clip) clip = step.clip;
    let settleAt = step.time;

    if (Array.isArray(step.moveTo) && step.moveTo.length === 3) {
      const from = pos;
      const to = step.moveTo.map(Number) as Vector3Tuple;
      const duration = Math.max(0.2, step.duration ?? (nextTime !== undefined ? nextTime - step.time : 2));
      const dx = to[0] - from[0];
      const dz = to[2] - from[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 0.01) setYaw(Math.atan2(dx, dz), step.time);
      const u = (time - step.time) / duration;
      const e = applyEase(step.ease || 'sine.inOut', u);
      pos = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e];
      if (u < 1) {
        moving = true;
        clip = step.clip || (dist / duration > RUN_SPEED ? 'Run' : 'Walk');
        animation = step.animation || 'walk';
        continue; // facing commands wait until arrival
      }
      moving = false;
      clip = step.arriveClip || 'Idle';
      animation = step.animation && step.animation !== 'walk' ? step.animation : 'idle';
      settleAt = step.time + duration;
    }

    if (step.faceDeg !== undefined && Number.isFinite(step.faceDeg)) {
      setYaw((step.faceDeg * Math.PI) / 180, settleAt);
    } else if (step.lookAt !== undefined) {
      let target: Vector3Tuple | undefined;
      if (Array.isArray(step.lookAt)) target = step.lookAt as Vector3Tuple;
      else {
        const other = actors.find((a) => a.id === step.lookAt);
        if (other && other.id !== actor.id) {
          target = depth > 0 || !hasPerformance(other) ? other.position : resolvePerformance(other, time, actors, world, depth + 1).position;
        }
      }
      if (target) {
        const dx = target[0] - pos[0];
        const dz = target[2] - pos[2];
        if (Math.hypot(dx, dz) > 0.01) setYaw(Math.atan2(dx, dz), settleAt);
      }
    }
  }

  const y = pos[1] + groundY(world, pos[0], pos[2]);
  return { position: [pos[0], y, pos[2]], yaw: yawAt(time), clip, animation, speed, moving };
}

/**
 * The actor as the renderers should draw it at `time`: performance applied in media mode (base actor otherwise).
 * Studio and Player both draw this, so editor, Preview and exports match.
 */
export function performedActor(actor: ActorNode, spec: Pick<SceneSpec, 'mode' | 'actors' | 'world'> & Partial<Pick<SceneSpec, 'dialogue'>>, time: number): ActorNode {
  const talks = spec.mode === 'media' && !!spec.dialogue?.some((l) => l.speaker === actor.id);
  if (spec.mode !== 'media' || (!hasPerformance(actor) && !talks)) return actor;
  const pose = hasPerformance(actor)
    ? resolvePerformance(actor, time, spec.actors, spec.world)
    : { position: actor.position, yaw: actor.rotation?.[1] ?? 0, clip: actor.activeClip, animation: actor.activeAnimation, speed: actor.animationSpeed ?? 1, moving: false };
  let yaw = pose.yaw;
  let talkLevel = 0;
  if (talks) {
    // Phase 10C: a speaker standing still turns to its listener for the line (eased in and back out).
    const scene = { actors: spec.actors, dialogue: spec.dialogue };
    talkLevel = talkLevelAt(scene, actor.id, time);
    if (!pose.moving) {
      for (const tl of dialogueTimeline(scene)) {
        if (tl.line.speaker !== actor.id || !tl.line.listener || time < tl.start || time > tl.end + TURN_SECONDS) continue;
        const other = spec.actors.find((a) => a.id === tl.line.listener);
        if (!other || other.id === actor.id) continue;
        const target = hasPerformance(other) ? resolvePerformance(other, time, spec.actors, spec.world, 1).position : other.position;
        const dx = target[0] - pose.position[0];
        const dz = target[2] - pose.position[2];
        if (Math.hypot(dx, dz) < 0.01) continue;
        const w = smooth((time - tl.start) / TURN_SECONDS) * (1 - smooth((time - tl.end) / TURN_SECONDS));
        yaw = lerpAngle(pose.yaw, Math.atan2(dx, dz), w);
      }
    }
  }
  return {
    ...actor,
    position: pose.position,
    rotation: [actor.rotation?.[0] ?? 0, yaw, actor.rotation?.[2] ?? 0],
    activeClip: pose.clip,
    activeAnimation: pose.animation,
    animationSpeed: pose.speed,
    ...(talkLevel > 0 ? { talkLevel } : {}),
  };
}

// --------------------------------------------------------------------------------------------- clips

const CLIP_SYNONYMS: Record<string, string[]> = {
  idle: ['idle', 'survey', 'breath', 'stand'],
  walk: ['walk', 'walking'],
  run: ['run', 'running', 'gallop', 'sprint'],
  sit: ['sit', 'sitting'],
  wave: ['wave', 'hello'],
};

/** Finds the model clip for a requested name: exact → case-insensitive → contains → synonyms → idle → first. */
export function matchClipName(wanted: string | undefined, names: string[]): string | undefined {
  if (!names.length) return undefined;
  const idle = () => names.find((n) => /idle|survey|breath/i.test(n)) || names[0];
  if (!wanted) return idle();
  const w = wanted.toLowerCase();
  const found =
    names.find((n) => n === wanted) ||
    names.find((n) => n.toLowerCase() === w) ||
    names.find((n) => n.toLowerCase().includes(w)) ||
    names.find((n) => w.includes(n.toLowerCase().replace(/[_\s]+$/, '')) && n.length > 2);
  if (found) return found;
  for (const [key, list] of Object.entries(CLIP_SYNONYMS)) {
    if (list.some((s) => w.includes(s))) {
      const hit = names.find((n) => list.some((s) => n.toLowerCase().includes(s))) || (key === 'idle' ? idle() : undefined);
      if (hit) return hit;
    }
  }
  return idle();
}

// --------------------------------------------------------------------------------------------- shots

export interface ShotFrame {
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov: number;
  /** Index of the active shot (changes = hard cut). */
  shotIndex: number;
}

/** The hero: the player, else the first actor with a performance, else the first actor. */
export function heroActor(spec: Pick<SceneSpec, 'actors'>): ActorNode | undefined {
  return spec.actors.find((a) => a.physicsRole === 'player') || spec.actors.find(hasPerformance) || spec.actors[0];
}

export function actorHeight(actor: ActorNode): number {
  const box = ASSET_REGISTRY[actor.assetId]?.boundingBox;
  return Math.max(0.3, (box?.height ?? 1.8) * Math.abs(actor.scale?.[1] ?? 1));
}

/** Over-shoulder camera offsets behind / beside the foreground actor, from its footprint. */
export function shoulderOffsets(actor: ActorNode): { back: number; off: number } {
  const box = ASSET_REGISTRY[actor.assetId]?.boundingBox;
  const sx = Math.abs(actor.scale?.[0] ?? 1);
  const sz = Math.abs(actor.scale?.[2] ?? 1);
  const k = actorHeight(actor) / 1.8;
  const halfDepth = ((box?.depth ?? 0.6) * sz) / 2;
  const halfWidth = ((box?.width ?? 0.6) * sx) / 2;
  // Far enough that the foreground shoulder / head fills about a third of the frame width, not
  // half of it: distance ≈ 2.2 × the actor's width (seen from behind: side to side), split behind (0.86) and beside (0.5).
  const reach = Math.max(1.2 * k, halfWidth * 2 * 2.2);
  return { back: Math.max(halfDepth + 0.95, reach * 0.86), off: Math.max(halfWidth + 0.8, reach * 0.5) };
}

export function shotWindows(spec: Pick<SceneSpec, 'durationSeconds' | 'camera'>): Array<{ shot: CameraShot; start: number; end: number }> {
  const shots = [...(spec.camera.shots || [])].filter((s) => s && Number.isFinite(s.start)).sort((a, b) => a.start - b.start);
  const duration = Math.max(1, spec.durationSeconds || 8);
  return shots.map((shot, i) => ({
    shot,
    start: Math.max(0, shot.start),
    end: Math.min(duration, shot.end ?? shots[i + 1]?.start ?? duration),
  }));
}

const BASE: Record<ShotType, { dist: number; height: number; aim: number; fov: number; angle: number }> = {
  // dist/height in "hero heights" (1.8 m reference), aim = fraction of subject height the camera looks at
  establishing: { dist: 7.5, height: 2.6, aim: 0.4, fov: 50, angle: 25 },
  wide: { dist: 3.9, height: 1.0, aim: 0.5, fov: 45, angle: 25 },
  medium: { dist: 2.0, height: 0.8, aim: 0.65, fov: 40, angle: 20 },
  'close-up': { dist: 1.3, height: 0.85, aim: 0.8, fov: 38, angle: 10 },
  'over-shoulder': { dist: 0, height: 0.85, aim: 0.8, fov: 40, angle: 0 },
  'low-angle': { dist: 1.8, height: 0.18, aim: 0.75, fov: 45, angle: 20 },
  'high-angle': { dist: 2.2, height: 2.2, aim: 0.4, fov: 42, angle: 20 },
  tracking: { dist: 2.4, height: 0.7, aim: 0.6, fov: 42, angle: 90 },
};

const ANGLE_DEG: Record<NonNullable<CameraShot['angle']>, number> = {
  front: 0,
  'three-quarter-left': 35,
  'three-quarter-right': -35,
  left: 90,
  right: -90,
  back: 180,
};

/**
 * Camera for the shot active at `time`, framing performers where they are at that moment. Returns null when the
 * scene has no shot list (the camera `mode` presets apply instead).
 */
export function resolveShot(spec: Pick<SceneSpec, 'durationSeconds' | 'camera' | 'actors' | 'mode' | 'world'> & Partial<Pick<SceneSpec, 'dialogue' | 'aspectRatio'>>, time: number): ShotFrame | null {
  const windows = shotWindows(spec);
  if (!windows.length) return null;
  let index = windows.findIndex((w) => time >= w.start && time < w.end);
  if (index < 0) index = time < windows[0].start ? 0 : windows.length - 1;
  const { shot, start, end } = windows[index];
  const p = Math.max(0, Math.min(1, (time - start) / Math.max(0.1, end - start)));
  const pe = applyEase('sine.inOut', p);

  const subject = spec.actors.find((a) => a.id === shot.subject) || heroActor(spec);
  if (!subject) return null;
  // The pose the renderers draw (performance + Phase 10C turns towards a listener), so the camera frames the face we see.
  const poseAt = (a: ActorNode, t: number): Pick<PerformedPose, 'position' | 'yaw' | 'clip'> => {
    if (spec.mode !== 'media') return { position: a.position, yaw: a.rotation?.[1] ?? 0 };
    const p = performedActor(a, spec, t);
    return { position: p.position, yaw: p.rotation?.[1] ?? 0, clip: p.activeClip };
  };
  const pose = poseAt(subject, time);
  // Frame relative to where the subject faced when the shot started: stable framing, no camera whip on turns.
  const baseYaw = poseAt(subject, start).yaw;
  // A seated performer's face is lower: aim and camera height follow.
  const seat = /sit/i.test(pose.clip || '') ? 0.8 : 1;
  const h = actorHeight(subject);
  const k = Math.max(0.55, h / 1.8);
  const b = BASE[shot.type] || BASE.medium;
  const target: Vector3Tuple = [pose.position[0], pose.position[1] + h * seat * b.aim, pose.position[2]];
  // An authored fov is a lens choice, not a framing change: the camera backs off (or moves in) so the subject keeps
  // the size the shot type promises (a 'close-up' at fov 30 is still a close-up, not an extreme close-up).
  let fov = Math.max(20, Math.min(75, shot.fov ?? b.fov));
  const lens = Math.tan((b.fov * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);

  if (shot.type === 'over-shoulder') {
    const partner = spec.actors.find((a) => a.id === shot.partner && a.id !== subject.id);
    if (partner) {
      const pp = poseAt(partner, time).position;
      const ph = actorHeight(partner);
      const dx = pose.position[0] - pp[0];
      const dz = pose.position[2] - pp[2];
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const side = shot.angle === 'three-quarter-right' || shot.angle === 'right' ? -1 : 1;
      // Stand clear of the foreground actor's own bulk (a big-headed robot is ~1.4 m deep): offsets come from the
      // partner's size, otherwise a small subject puts the camera inside a large partner.
      const { back } = shoulderOffsets(partner);
      let { off } = shoulderOffsets(partner);
      // The sight line to the subject must pass beside the partner's body, not through it: at the partner it is
      // off · L / (back + L) to the side (L = partner → subject distance).
      const box = ASSET_REGISTRY[partner.assetId]?.boundingBox;
      const halfW = ((box?.width ?? 0.6) * Math.abs(partner.scale?.[0] ?? 1)) / 2;
      off = Math.max(off, ((halfW + 0.35) * (back + len)) / Math.max(0.5, len));
      const position: Vector3Tuple = [pp[0] - ux * back + -uz * off * side, pp[1] + ph * 0.95, pp[2] - uz * back + ux * off * side];
      return { position, target, fov: Math.max(fov, 34), shotIndex: index };
    }
  }

  let dist = b.dist * 1.8 * k * lens;
  let height = b.height * 1.8 * k * (shot.type === 'establishing' || shot.type === 'wide' || shot.type === 'high-angle' ? 1 : seat);
  let angle = baseYaw + ((shot.angle ? ANGLE_DEG[shot.angle] : b.angle) * Math.PI) / 180;
  let dollied = false;
  if ((!shot.angle && b.angle !== 0) || (shot.angle && shot.angle !== 'back')) {
    // Film from a side where nobody stands between camera and subject (decided once per shot, so the camera never flips
    // mid-shot). An authored angle is a preference: kept when clear, otherwise the camera dollies in or turns a little.
    // Checked over the whole shot (start, middle, end): someone walking into the line of sight later still counts.
    // Each blocker has its own footprint (a fox is long, a coin is tiny).
    const samples = [start, (start + end) / 2, Math.max(start, end - 0.05)];
    const others = spec.actors.filter((a) => a.id !== subject.id && a.visible !== false);
    const footprint = (a: ActorNode) => {
      const box = ASSET_REGISTRY[a.assetId]?.boundingBox;
      return (Math.max(box?.width ?? 0.6, box?.depth ?? 0.6) * Math.max(Math.abs(a.scale?.[0] ?? 1), Math.abs(a.scale?.[2] ?? 1))) / 2;
    };
    const frames = samples.map((t) => ({ s: poseAt(subject, t).position, o: others.map((a) => ({ p: poseAt(a, t).position, r: footprint(a) })) }));
    const s0 = frames[0].s;
    // How far (radians) the nearest foreground blocker stays outside the middle of the frame, worst moment of the shot.
    // Only actors between the camera and the subject count (behind it they are background); a big actor close to the
    // lens fills the frame even when it is beside the line of sight, so this works in frame angles, not metres.
    const aspect = spec.aspectRatio === '9:16' ? 9 / 16 : spec.aspectRatio === '1:1' ? 1 : 16 / 9;
    const halfH = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
    const clearance = (ang: number, r = dist) => {
      let best = Infinity;
      for (const f of frames) {
        const cx = f.s[0] + Math.sin(ang) * r;
        const cz = f.s[2] + Math.cos(ang) * r;
        const ax = f.s[0] - cx;
        const az = f.s[2] - cz;
        const len = Math.hypot(ax, az) || 1;
        for (const o of f.o) {
          const ox = o.p[0] - cx;
          const oz = o.p[2] - cz;
          const depth = (ox * ax + oz * az) / len;
          if (depth > len - 0.15 || depth < -o.r) continue; // behind the subject, or behind the camera
          const lateral = Math.abs(ox * az - oz * ax) / len;
          const edge = Math.atan2(lateral, Math.max(0.05, depth)) - Math.atan2(o.r * 1.15, Math.max(0.05, Math.hypot(ox, oz)));
          best = Math.min(best, edge - 0.85 * halfH);
        }
      }
      return best;
    };
    if (others.length && clearance(angle) < 0) {
      // 1) Keep the frontal view but stand in front of the blocker (dolly in), when that still frames the shot.
      const nearest = Math.min(...frames.flatMap((f) => f.o.map((o) => Math.hypot(o.p[0] - f.s[0], o.p[2] - f.s[2]) - o.r)));
      const closer = Math.min(dist, nearest - 0.4);
      const minDist = shot.type === 'close-up' || shot.type === 'medium' ? 1.55 * k : dist * 0.55;
      if (closer >= minDist && clearance(angle, closer) >= 0) {
        dist = closer;
        dollied = true;
      }
    }
    if (others.length && !dollied && clearance(angle) < 0) {
      // 2) Try the mirrored angle, then swing further round the subject (still a front-ish view).
      const deg = (b.angle * Math.PI) / 180;
      // Close-ups must keep the face: swing at most ~50°.
      const wide = shot.type === 'close-up' ? [] : [baseYaw + deg + 1.3, baseYaw - deg - 1.3];
      const candidates = shot.angle
        ? [angle + 0.45, angle - 0.45, angle + 0.85, angle - 0.85, angle + 1.3, angle - 1.3]
        : [baseYaw - deg, baseYaw + deg + 0.7, baseYaw - deg - 0.7, ...wide];
      let bestAngle = angle;
      let bestClear = clearance(angle);
      for (const c of candidates) {
        const cl = clearance(c);
        if (cl > bestClear + 0.05) { bestAngle = c; bestClear = cl; }
      }
      angle = bestAngle;
    }
  }
  switch (shot.move) {
    case 'push-in': if (!dollied) dist *= 1 - 0.2 * pe; break;
    case 'pull-out': dist *= 0.8 + 0.4 * pe; break;
    case 'crane-up': height += 2.2 * k * pe; break;
    case 'orbit': angle += 0.9 * pe; break;
    case 'pan-left':
    case 'pan-right': {
      const dir = shot.move === 'pan-left' ? 1 : -1;
      const off = (pe - 0.5) * 2 * k * dir;
      target[0] += Math.cos(angle) * off;
      target[2] -= Math.sin(angle) * off;
      break;
    }
    default: break;
  }
  const position: Vector3Tuple = [
    pose.position[0] + Math.sin(angle) * dist,
    pose.position[1] + height,
    pose.position[2] + Math.cos(angle) * dist,
  ];
  // Never put the camera under hilly ground.
  position[1] = Math.max(position[1], groundY(spec.world, position[0], position[2]) + 0.25);
  return { position, target, fov, shotIndex: index };
}

// --------------------------------------------------------------------------------------------- authoring helpers

/** Total number of distinct actions (clip / move / facing changes) in a performance. */
export function performanceActionCount(actor: ActorNode): number {
  return sortedSteps(actor).filter((s) => s.clip || s.moveTo || s.animation || s.lookAt !== undefined || s.faceDeg !== undefined).length;
}

// --------------------------------------------------------------------------------------------- transitions

/** Transition into `scene` from the previous scene of its storyboard (default fade). */
export function transitionInto(scene: Pick<SceneSpec, 'sequence'> | undefined): SceneTransition {
  return scene?.sequence?.transition || 'fade';
}

/** How hosts without a compositor (Preview overlay, Player) show a transition: an overlay colour and duration. */
export function transitionOverlay(t: SceneTransition): { color: string; ms: number } | null {
  switch (t) {
    case 'cut': return null;
    case 'fade-white': return { color: '#ffffff', ms: 450 };
    case 'crossfade': return { color: '#000000', ms: 300 };
    default: return { color: '#000000', ms: 450 };
  }
}
