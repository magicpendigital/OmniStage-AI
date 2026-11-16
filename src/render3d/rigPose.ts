/**
 * Phase 9 — procedural pose layer on top of skeletal clips, shared by the studio viewport and the OmniStage Player:
 *  - head look-at: neck + head turn toward a world point (from `gazeAt`), clamped like a real neck and blended by weight;
 *  - foot IK on terrain: each leg is solved as a two-bone chain so the feet follow the ground under them (the clip's own
 *    foot lift is kept), and the hips drop when one foot has to reach lower.
 * Works on Mixamo / OmniRig bone names (mixamorig prefixes ignored). Runs after the mixer each frame; bones the mixer does not
 * drive are restored to their base pose first, so corrections never accumulate.
 */
import * as THREE from 'three';
import { gazeAt, terrainGroundY } from '../runtime/cinematics';
import type { ActorNode, SceneSpec } from '../types/scene.schema';

export const LOOK_LIMITS = { yaw: (70 * Math.PI) / 180, pitch: (30 * Math.PI) / 180, neckShare: 0.4 };
/** Feet only follow terrain within this height difference (m); a bigger step is a ledge, not a slope. */
export const FOOT_IK_MAX_STEP = 0.6;

interface LegChain {
  upper: THREE.Bone;
  lower: THREE.Bone;
  foot: THREE.Bone;
}

interface Tracked {
  bone: THREE.Bone;
  base: THREE.Quaternion;
  written: THREE.Quaternion;
  basePos?: THREE.Vector3;
  writtenPos?: THREE.Vector3;
}

export interface RigPoseInput {
  /** World point + weight for the head, or null. */
  gaze?: { target: [number, number, number]; weight: number } | null;
  /** Terrain height at world (x, z), or undefined on a flat stage (no foot IK). */
  groundAt?: (x: number, z: number) => number;
  /** Facing of the actor root in radians around +y (0 = +z). */
  yaw: number;
}

const bare = (name: string) => name.replace(/^mixamorig\d*[:_]?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

function findBones(root: THREE.Object3D): Map<string, THREE.Bone> {
  const out = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !out.has(bare(o.name))) out.set(bare(o.name), o as THREE.Bone);
  });
  return out;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Rotates a bone by a world-space rotation, keeping its children attached. */
export function rotateBoneWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(_q2) : _q2.identity();
  const world = _q.copy(parentQ).multiply(bone.quaternion);
  world.premultiply(delta);
  bone.quaternion.copy(parentQ.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

const worldPos = (o: THREE.Object3D, out: THREE.Vector3) => o.getWorldPosition(out);

/**
 * Two-bone IK in world space: bends the middle joint so the chain spans the target distance, then swings the chain at its
 * root to point at the target. `bendAxis` is used when the chain is straight (the knee bends around it).
 */
export function solveTwoBone(chain: LegChain, target: THREE.Vector3, bendAxis: THREE.Vector3) {
  const hip = worldPos(chain.upper, new THREE.Vector3());
  const knee = worldPos(chain.lower, new THREE.Vector3());
  const ankle = worldPos(chain.foot, new THREE.Vector3());
  const a = hip.distanceTo(knee);
  const b = knee.distanceTo(ankle);
  if (a < 1e-5 || b < 1e-5) return;
  const c = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const u = _a.subVectors(hip, knee).normalize();
  const v = _b.subVectors(ankle, knee).normalize();
  const current = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
  const wanted = Math.acos(THREE.MathUtils.clamp((a * a + b * b - c * c) / (2 * a * b), -1, 1));
  _axis.crossVectors(u, v);
  if (_axis.lengthSq() < 1e-8) _axis.copy(bendAxis);
  _axis.normalize();
  rotateBoneWorld(chain.lower, _q.setFromAxisAngle(_axis, wanted - current).clone());
  // Swing the whole chain so the ankle points at the target.
  const ankle2 = worldPos(chain.foot, new THREE.Vector3());
  const from = _a.subVectors(ankle2, hip).normalize();
  const to = _b.subVectors(target, hip).normalize();
  rotateBoneWorld(chain.upper, new THREE.Quaternion().setFromUnitVectors(from, to));
}

/** Per-model pose layer. Create once per loaded model; call `apply` after the mixer update every frame. */
export class RigPoseLayer {
  private head?: THREE.Bone;
  private neck?: THREE.Bone;
  private hips?: THREE.Bone;
  private legs: LegChain[] = [];
  private tracked = new Map<THREE.Bone, Tracked>();
  readonly hasHead: boolean;
  readonly hasLegs: boolean;

  constructor(private readonly root: THREE.Object3D) {
    const bones = findBones(root);
    this.head = bones.get('head');
    this.neck = bones.get('neck');
    this.hips = bones.get('hips');
    for (const side of ['left', 'right']) {
      const upper = bones.get(`${side}upleg`);
      const lower = bones.get(`${side}leg`);
      const foot = bones.get(`${side}foot`);
      if (upper && lower && foot) this.legs.push({ upper, lower, foot });
    }
    this.hasHead = !!(this.head || this.neck);
    this.hasLegs = this.legs.length === 2;
    for (const bone of [this.head, this.neck, this.hips, ...this.legs.flatMap((l) => [l.upper, l.lower])]) {
      if (bone) this.tracked.set(bone, { bone, base: bone.quaternion.clone(), written: new THREE.Quaternion(NaN, NaN, NaN, NaN) });
    }
    if (this.hips) {
      const t = this.tracked.get(this.hips)!;
      t.basePos = this.hips.position.clone();
      t.writtenPos = new THREE.Vector3(NaN, NaN, NaN);
    }
  }

  /** Bones the mixer left alone this frame still hold our last write: put their base pose back first. */
  private restore() {
    for (const t of this.tracked.values()) {
      if (t.bone.quaternion.equals(t.written)) t.bone.quaternion.copy(t.base);
      else t.base.copy(t.bone.quaternion);
      if (t.basePos && t.writtenPos) {
        if (t.bone.position.equals(t.writtenPos)) t.bone.position.copy(t.basePos);
        else t.basePos.copy(t.bone.position);
      }
    }
  }

  private remember() {
    for (const t of this.tracked.values()) {
      t.written.copy(t.bone.quaternion);
      if (t.writtenPos) t.writtenPos.copy(t.bone.position);
    }
  }

  apply(input: RigPoseInput) {
    if (!this.hasHead && !this.hasLegs) return;
    this.restore();
    this.root.updateWorldMatrix(true, true);
    if (input.groundAt && this.hasLegs) this.placeFeet(input.groundAt, input.yaw);
    if (input.gaze && input.gaze.weight > 0.001 && this.hasHead) this.lookAt(input.gaze.target, input.gaze.weight, input.yaw);
    this.remember();
  }

  private lookAt(target: [number, number, number], weight: number, yaw: number) {
    const pivot = worldPos((this.head || this.neck)!, new THREE.Vector3());
    _v.set(target[0] - pivot.x, target[1] - pivot.y, target[2] - pivot.z);
    const horiz = Math.hypot(_v.x, _v.z);
    if (horiz < 1e-3 && Math.abs(_v.y) < 1e-3) return;
    const w = THREE.MathUtils.clamp(weight, 0, 1);
    let dYaw = Math.atan2(_v.x, _v.z) - yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    // Behind the shoulder: a person turns the body, not the neck; hold at the limit instead of flipping.
    const yawTurn = THREE.MathUtils.clamp(dYaw, -LOOK_LIMITS.yaw, LOOK_LIMITS.yaw) * w;
    const pitch = THREE.MathUtils.clamp(Math.atan2(_v.y, horiz), -LOOK_LIMITS.pitch, LOOK_LIMITS.pitch) * w;
    const parts: Array<[THREE.Bone | undefined, number]> = this.neck && this.head
      ? [[this.neck, LOOK_LIMITS.neckShare], [this.head, 1 - LOOK_LIMITS.neckShare]]
      : [[this.head || this.neck, 1]];
    for (const [bone, share] of parts) {
      if (!bone) continue;
      // Pitch around the facing's right axis (+x turned by the final yaw): positive angle looks down, so negate.
      const right = _c.set(1, 0, 0).applyAxisAngle(UP, yaw + yawTurn);
      const delta = new THREE.Quaternion().setFromAxisAngle(UP, yawTurn * share);
      delta.premultiply(new THREE.Quaternion().setFromAxisAngle(right, -pitch * share));
      rotateBoneWorld(bone, delta);
    }
  }

  private placeFeet(groundAt: (x: number, z: number) => number, yaw: number) {
    const rootPos = worldPos(this.root, new THREE.Vector3());
    const baseGround = groundAt(rootPos.x, rootPos.z);
    const offsets = this.legs.map((leg) => {
      const ankle = worldPos(leg.foot, new THREE.Vector3());
      const d = groundAt(ankle.x, ankle.z) - baseGround;
      return Math.abs(d) <= FOOT_IK_MAX_STEP ? d : 0;
    });
    if (offsets.every((d) => Math.abs(d) < 1e-3)) return;
    // Lower the pelvis so the lower foot can reach (never raise it: the higher foot bends its knee instead).
    const drop = Math.min(0, ...offsets);
    if (this.hips && drop < 0) {
      const hipsWorld = worldPos(this.hips, new THREE.Vector3());
      hipsWorld.y += drop;
      const local = this.hips.parent ? this.hips.parent.worldToLocal(hipsWorld) : hipsWorld;
      this.hips.position.copy(local);
      this.hips.updateMatrixWorld(true);
    }
    // Straight legs bend around -x of the facing, so after the swing the knee points forward (+z).
    const bend = _c.set(-1, 0, 0).applyAxisAngle(UP, yaw).clone();
    this.legs.forEach((leg, i) => {
      const ankle = worldPos(leg.foot, new THREE.Vector3());
      // The clip's ankle height above its own ground is kept; only the terrain difference is added (+ the pelvis drop undone).
      const target = ankle.clone();
      target.y += offsets[i] - drop;
      solveTwoBone(leg, target, bend);
    });
  }
}

/** Feet are treated as standing when the root is within this distance of the terrain. */
const STANDING_TOLERANCE = 0.15;

/**
 * Pose-layer input for one actor at `time`: gaze from the shared cinematics maths, and foot IK only on real terrain while the
 * actor stands on it (a flying or jumping actor keeps the clip's legs).
 */
export function rigPoseInputFor(
  baseActor: ActorNode,
  performed: ActorNode,
  spec: Pick<SceneSpec, 'mode' | 'actors' | 'world'> & Partial<Pick<SceneSpec, 'dialogue' | 'durationSeconds'>>,
  time: number
): RigPoseInput {
  const t = spec.world?.terrain;
  const [x, y, z] = performed.position;
  const onTerrain = !!t && t.type !== 'flat-grid' && t.type !== 'none' && Math.abs(y - terrainGroundY(spec.world, x, z)) < STANDING_TOLERANCE;
  return {
    yaw: performed.rotation?.[1] ?? 0,
    gaze: gazeAt(baseActor, spec, time),
    groundAt: onTerrain ? (gx, gz) => terrainGroundY(spec.world, gx, gz) : undefined,
  };
}
