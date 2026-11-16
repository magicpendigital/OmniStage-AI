import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { gazeAt } from '../src/runtime/cinematics';
import { LOOK_LIMITS, RigPoseLayer, rigPoseInputFor } from '../src/render3d/rigPose';
import type { ActorNode, SceneSpec } from '../src/types/scene.schema';

function film(): SceneSpec {
  const spec = createBlankSceneSpec('3d', 'Gaze film');
  spec.mode = 'media';
  spec.durationSeconds = 10;
  const base = spec.actors[0];
  const a: ActorNode = { ...base, id: 'robot', name: 'Robot', position: [0, 0, 0], rotation: [0, 0, 0], performance: [] };
  const b: ActorNode = { ...base, id: 'fox', name: 'Fox', position: [3, 0, 0], rotation: [0, 0, 0], performance: [] };
  spec.actors = [a, b];
  return spec;
}

test('gazeAt: speakers and listeners look at each other, eased in', () => {
  const spec = film();
  spec.dialogue = [{ id: 'l1', time: 1, speaker: 'robot', listener: 'fox', text: 'Xin chào bạn cáo, hôm nay trời đẹp quá!' }];
  assert.equal(gazeAt(spec.actors[0], spec, 0.5), null);
  const early = gazeAt(spec.actors[0], spec, 1.05)!;
  const mid = gazeAt(spec.actors[0], spec, 1.6)!;
  assert.ok(early.weight > 0 && early.weight < mid.weight);
  assert.equal(mid.weight, 1);
  assert.equal(mid.target[0], 3, 'speaker looks at the listener');
  assert.ok(mid.target[1] > 1, 'at eye height');
  assert.equal(gazeAt(spec.actors[1], spec, 1.6)!.target[0], 0, 'listener looks back at the speaker');
  assert.equal(gazeAt(spec.actors[0], { ...spec, mode: 'game' }, 1.6), null, 'films only');
  assert.equal(gazeAt(spec.actors[0], spec, 9.9), null, 'eases out after the line');
});

test('gazeAt: an authored lookAt holds until the next walk', () => {
  const spec = film();
  spec.actors[0].performance = [
    { time: 1, lookAt: 'fox' },
    { time: 4, moveTo: [0, 0, 4], duration: 2 },
    { time: 7, lookAt: [0, 2, 9] },
  ];
  assert.equal(gazeAt(spec.actors[0], spec, 0.5), null);
  assert.equal(gazeAt(spec.actors[0], spec, 3)!.target[0], 3);
  assert.equal(gazeAt(spec.actors[0], spec, 5), null, 'walking: eyes follow the path');
  assert.deepEqual(gazeAt(spec.actors[0], spec, 8)!.target, [0, 2, 9]);
});

/** Hips(1 m) → legs of 0.45 + 0.45 m, spine → neck → head. */
function skeleton() {
  const root = new THREE.Group();
  const bone = (name: string, parent: THREE.Object3D, pos: [number, number, number]) => {
    const b = new THREE.Bone();
    b.name = `mixamorig:${name}`;
    b.position.set(...pos);
    parent.add(b);
    return b;
  };
  const hips = bone('Hips', root, [0, 1, 0]);
  const legs: Record<string, THREE.Bone> = {};
  for (const [side, x] of [['Left', 0.1], ['Right', -0.1]] as const) {
    const up = bone(`${side}UpLeg`, hips, [x, 0, 0]);
    const leg = bone(`${side}Leg`, up, [0, -0.45, 0]);
    legs[side] = bone(`${side}Foot`, leg, [0, -0.45, 0]);
    legs[`${side}Knee`] = leg;
  }
  const spine = bone('Spine', hips, [0, 0.3, 0]);
  const neck = bone('Neck', spine, [0, 0.35, 0]);
  const head = bone('Head', neck, [0, 0.1, 0]);
  root.updateMatrixWorld(true);
  return { root, hips, head, neck, legs };
}

const yawOf = (o: THREE.Object3D) => {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  return Math.atan2(f.x, f.z);
};
const pitchOf = (o: THREE.Object3D) => {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  return Math.atan2(f.y, Math.hypot(f.x, f.z));
};

test('RigPoseLayer: head turns toward the target within neck limits and never accumulates', () => {
  const s = skeleton();
  const layer = new RigPoseLayer(s.root);
  assert.ok(layer.hasHead && layer.hasLegs);
  const headY = s.head.getWorldPosition(new THREE.Vector3()).y;
  // 30° to the side: full turn, split neck / head.
  const side = [Math.sin(Math.PI / 6) * 5, headY, Math.cos(Math.PI / 6) * 5] as [number, number, number];
  layer.apply({ yaw: 0, gaze: { target: side, weight: 1 } });
  assert.ok(Math.abs(yawOf(s.head) - Math.PI / 6) < 1e-3, `yaw ${yawOf(s.head)}`);
  assert.ok(Math.abs(yawOf(s.neck) - (Math.PI / 6) * LOOK_LIMITS.neckShare) < 1e-3);
  // Applying again (no mixer resets the bones) gives the same pose.
  layer.apply({ yaw: 0, gaze: { target: side, weight: 1 } });
  assert.ok(Math.abs(yawOf(s.head) - Math.PI / 6) < 1e-3, 'no accumulation');
  // Straight to the side is clamped; up is pitched (looks up = positive pitch of +z).
  layer.apply({ yaw: 0, gaze: { target: [5, headY, 0], weight: 1 } });
  assert.ok(Math.abs(yawOf(s.head) - LOOK_LIMITS.yaw) < 1e-3);
  layer.apply({ yaw: 0, gaze: { target: [0, headY + 1, 5], weight: 1 } });
  assert.ok(Math.abs(pitchOf(s.head) - Math.atan2(1, 5)) < 1e-3, `pitch ${pitchOf(s.head)}`);
  // Half weight → half turn; no gaze → back to the rest pose.
  layer.apply({ yaw: 0, gaze: { target: side, weight: 0.5 } });
  assert.ok(Math.abs(yawOf(s.head) - Math.PI / 12) < 1e-3);
  layer.apply({ yaw: 0, gaze: null });
  assert.ok(Math.abs(yawOf(s.head)) < 1e-6);
  // Facing another way: the turn is relative to the body.
  s.root.rotation.y = Math.PI / 2;
  layer.apply({ yaw: Math.PI / 2, gaze: { target: [5, headY, Math.tan(Math.PI / 12) * 5], weight: 1 } });
  assert.ok(Math.abs(yawOf(s.head) - (Math.PI / 2 - Math.PI / 12)) < 1e-3, `yaw ${yawOf(s.head)}`);
});

test('RigPoseLayer: feet follow a slope, hips drop for the lower foot, knees bend forward', () => {
  const s = skeleton();
  const layer = new RigPoseLayer(s.root);
  const ground = (x: number) => x * 2; // left foot (x 0.1) 0.2 m up, right foot (x -0.1) 0.2 m down
  const ankles0 = ['Left', 'Right'].map((k) => s.legs[k].getWorldPosition(new THREE.Vector3()));
  layer.apply({ yaw: 0, groundAt: (x) => ground(x) });
  s.root.updateMatrixWorld(true);
  const left = s.legs.Left.getWorldPosition(new THREE.Vector3());
  const right = s.legs.Right.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(left.y - (ankles0[0].y + 0.2)) < 1e-3, `left ${left.y}`);
  assert.ok(Math.abs(right.y - (ankles0[1].y - 0.2)) < 1e-3, `right ${right.y}`);
  assert.ok(Math.abs(left.x - ankles0[0].x) < 1e-3 && Math.abs(left.z - ankles0[0].z) < 1e-3, 'feet stay under the body');
  assert.ok(Math.abs(s.hips.getWorldPosition(new THREE.Vector3()).y - 0.8) < 1e-3, 'pelvis dropped 0.2 m');
  assert.ok(s.legs.LeftKnee.getWorldPosition(new THREE.Vector3()).z > 0.05, 'knee bends forward (+z facing)');
  // Re-applying without a mixer is stable; flat ground restores the rest pose.
  layer.apply({ yaw: 0, groundAt: (x) => ground(x) });
  assert.ok(Math.abs(s.legs.Left.getWorldPosition(new THREE.Vector3()).y - (ankles0[0].y + 0.2)) < 1e-3);
  layer.apply({ yaw: 0, groundAt: () => 0 });
  s.root.updateMatrixWorld(true);
  assert.ok(s.legs.Left.getWorldPosition(new THREE.Vector3()).distanceTo(ankles0[0]) < 1e-6);
  assert.ok(Math.abs(s.hips.position.y - 1) < 1e-9);
});

test('rigPoseInputFor: foot IK only on terrain while standing on it', () => {
  const spec = film();
  const actor = spec.actors[0];
  assert.equal(rigPoseInputFor(actor, actor, spec, 0).groundAt, undefined, 'flat stage');
  spec.world = { ...spec.world, terrain: { ...(spec.world?.terrain || {}), type: 'grassy-hills', elevationScale: 1 } } as SceneSpec['world'];
  const standing = { ...actor, position: [0, rigGround(spec, 0, 0), 0] as [number, number, number] };
  assert.equal(typeof rigPoseInputFor(actor, standing, spec, 0).groundAt, 'function');
  const flying = { ...actor, position: [0, rigGround(spec, 0, 0) + 3, 0] as [number, number, number] };
  assert.equal(rigPoseInputFor(actor, flying, spec, 0).groundAt, undefined);
});

import { terrainGroundY } from '../src/runtime/cinematics';
const rigGround = (spec: SceneSpec, x: number, z: number) => terrainGroundY(spec.world, x, z);
