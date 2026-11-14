/**
 * Phase 9 — OmniRig: canonical frame, classification, joints, skin weights, stress validation, procedural clips and the
 * rest-pose retargeter, measured on synthetic characters whose joints are known.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMesh, canonicalPositions, MeshData, toCanonical, Vec3 } from '../src/rig/analyze';
import { fitSkeleton, MIXAMO } from '../src/rig/skeleton';
import { computeSkinWeights, posePositions, quatAxisAngle, validateRig } from '../src/rig/skin';
import { proceduralClips, retargetClip } from '../src/rig/animate';
import { SAMPLE_HUMANOID_JOINTS, sampleHumanoid, sampleQuadruped, transformMesh } from '../src/rig/fixtures';

function rig(m0: MeshData, forceCategory?: 'humanoid' | 'quadruped' | 'prop') {
  const { report, points } = analyzeMesh(m0, { forceCategory });
  const mesh = { positions: canonicalPositions(m0, report.frame), indices: m0.indices };
  const skeleton = fitSkeleton(report.category, points);
  const skin = computeSkinWeights(mesh, skeleton);
  return { report, mesh, skeleton, skin };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('canonical frame: up, facing and size are recovered whatever the import orientation / units', () => {
  const cases: Array<[MeshData, string, string]> = [
    [sampleHumanoid(), '+Y', '+Z'],
    [transformMesh(sampleHumanoid(), 180, 0.01), '+Y', '-Z'],
    [transformMesh(sampleHumanoid(), 90, 40), '+Y', '+X'],
    [transformMesh(sampleHumanoid(), 0, 1, true), '+Z', '-Y'],
    [transformMesh(sampleQuadruped(), -90, 3), '+Y', '-X'],
  ];
  for (const [mesh, up, facing] of cases) {
    const { report } = analyzeMesh(mesh);
    assert.equal(report.frame.upAxis, up);
    assert.equal(report.frame.facingAxis, facing);
    assert.ok(report.frame.facingConfidence > 0.5);
    assert.ok(report.symmetry > 0.9);
  }
  // any yaw, not only 90° steps
  const { report } = analyzeMesh(transformMesh(sampleHumanoid(), 37));
  assert.match(report.frame.facingAxis, /yaw 37°/);
});

test('classification: humanoid, quadruped, or the user decides', () => {
  const h = analyzeMesh(sampleHumanoid()).report;
  assert.equal(h.category, 'humanoid');
  assert.ok(h.categoryConfidence >= 0.85);
  assert.equal(h.height, 1.8);
  const q = analyzeMesh(sampleQuadruped()).report;
  assert.equal(q.category, 'quadruped');
  assert.equal(analyzeMesh(sampleHumanoid(), { forceCategory: 'prop' }).report.category, 'prop');
});

test('humanoid joints land within 9 cm of the real joints (1.8 m character, any yaw / scale)', () => {
  const yaw = 37, scale = 0.013;
  const m0 = transformMesh(sampleHumanoid(), yaw, scale);
  const { report, skeleton } = rig(m0);
  // where the known joints went: same transform, then the canonical frame
  const toCanon = (p: Vec3): Vec3 => {
    const t = transformMesh({ positions: new Float32Array(p), indices: new Uint32Array() }, yaw, scale).positions;
    return Array.from(toCanonical(t, report.frame)) as Vec3;
  };
  const pairs: Record<string, string> = { hips: 'Hips', neck: 'Neck', head: 'Head', leftShoulder: 'LeftArm', leftElbow: 'LeftForeArm', leftHand: 'LeftHand', leftHip: 'LeftUpLeg', leftKnee: 'LeftLeg', leftAnkle: 'LeftFoot', rightElbow: 'RightForeArm', rightKnee: 'RightLeg' };
  for (const [k, bone] of Object.entries(pairs)) {
    const got = skeleton.bones.find((b) => b.name === MIXAMO(bone))!.head;
    const err = dist(got, toCanon(SAMPLE_HUMANOID_JOINTS[k]));
    assert.ok(err < 0.09, `${k}: ${err.toFixed(3)} m off`);
  }
  assert.ok(Object.values(skeleton.confidence).every((c) => c >= 0.8));
  // Mixamo hierarchy
  const parent = (n: string) => skeleton.bones[skeleton.bones.find((b) => b.name === MIXAMO(n))!.parent]?.name;
  assert.equal(parent('LeftForeArm'), MIXAMO('LeftArm'));
  assert.equal(parent('LeftUpLeg'), MIXAMO('Hips'));
  assert.equal(parent('Head'), MIXAMO('Neck'));
});

test('skin weights: normalised, 4 per vertex, limbs follow their own bones (no arm-to-ribs bleed)', () => {
  const { mesh, skeleton, skin } = rig(sampleHumanoid());
  const n = mesh.positions.length / 3;
  for (let v = 0; v < n; v++) {
    const s = skin.weights[v * 4] + skin.weights[v * 4 + 1] + skin.weights[v * 4 + 2] + skin.weights[v * 4 + 3];
    assert.ok(Math.abs(s - 1) < 1e-4);
  }
  const owner = (pred: (x: number, y: number) => boolean) => {
    const c: Record<string, number> = {};
    for (let v = 0; v < n; v++) {
      if (!pred(mesh.positions[v * 3], mesh.positions[v * 3 + 1])) continue;
      const b = skeleton.bones[skin.indices[v * 4]].name;
      c[b] = (c[b] || 0) + 1;
    }
    return c;
  };
  const forearm = owner((x, y) => x > 0.55 && x < 0.65 && y > 1.3);
  assert.ok(Object.keys(forearm).every((b) => /Left(ForeArm|Hand|Arm)/.test(b)), JSON.stringify(forearm));
  const shin = owner((x, y) => x > 0.03 && y > 0.2 && y < 0.4);
  assert.ok(Object.keys(shin).every((b) => /LeftLeg|LeftFoot|LeftUpLeg/.test(b)), JSON.stringify(shin));
  const ribs = owner((x, y) => x > 0.15 && x < 0.2 && y > 0.95 && y < 1.25);
  const armOnRibs = Object.entries(ribs).filter(([b]) => /LeftArm|LeftForeArm/.test(b)).reduce((s, [, c]) => s + c, 0);
  const totalRibs = Object.values(ribs).reduce((s, c) => s + c, 0);
  assert.ok(armOnRibs / totalRibs < 0.3, `${armOnRibs}/${totalRibs} rib vertices follow the arm`);
  // the right shin never follows the left leg
  const right = owner((x, y) => x < -0.03 && y > 0.2 && y < 0.4);
  assert.ok(!Object.keys(right).some((b) => b.includes('Left')));
});

test('stress poses grade the rig; a broken rig scores lower', () => {
  const { mesh, skeleton, skin } = rig(sampleHumanoid());
  const good = validateRig(mesh, skeleton, skin);
  assert.ok(['A', 'B'].includes(good.grade), `grade ${good.grade} (${good.score})`);
  assert.equal(good.poses.length, 3);
  // scramble the weights: everything on the hips → arms raised tears the mesh
  const bad = { indices: new Uint16Array(skin.indices.length), weights: new Float32Array(skin.weights.length) };
  for (let v = 0; v < bad.weights.length; v += 4) {
    bad.indices[v] = (v / 4) % 2 ? skeleton.bones.findIndex((b) => b.name === MIXAMO('LeftForeArm')) : 0;
    bad.weights[v] = 1;
  }
  assert.ok(validateRig(mesh, skeleton, bad).score < good.score - 20);
  const quad = rig(sampleQuadruped());
  assert.ok(['A', 'B'].includes(validateRig(quad.mesh, quad.skeleton, quad.skin).grade));
  const prop = rig(sampleHumanoid(), 'prop');
  assert.ok(Number.isFinite(validateRig(prop.mesh, prop.skeleton, prop.skin).score), 'rigs with < 4 bones are valid');
});

test('procedural clips: the names the AI uses, finite keys, feet stay near the ground while walking', () => {
  const { mesh, skeleton, skin } = rig(sampleHumanoid());
  const clips = proceduralClips(skeleton);
  assert.deepEqual(clips.map((c) => c.name), ['Idle', 'Walking', 'Running', 'Wave', 'Jump', 'Yes', 'No', 'Sitting', 'Dance']);
  for (const c of clips) for (const t of c.tracks) {
    assert.ok([...(t.rotations || []), ...(t.positions || [])].every(Number.isFinite), `${c.name}/${t.bone}`);
    assert.ok(skeleton.bones.some((b) => b.name === t.bone), `${c.name} animates unknown bone ${t.bone}`);
  }
  const walk = clips.find((c) => c.name === 'Walking')!;
  for (const k of [0, 6, 12, 18]) {
    const pose: Record<string, any> = {};
    let root: Vec3 = [0, 0, 0];
    for (const t of walk.tracks) {
      if (t.rotations) pose[t.bone] = t.rotations.slice(k * 4, k * 4 + 4);
      if (t.positions) root = t.positions.slice(k * 3, k * 3 + 3) as Vec3;
    }
    const posed = posePositions(mesh.positions, skeleton.bones, skin, pose, root);
    let minY = Infinity;
    for (let i = 1; i < posed.length; i += 3) minY = Math.min(minY, posed[i]);
    assert.ok(minY > -0.08 && minY < 0.08, `key ${k}: lowest point ${minY.toFixed(3)}`);
  }
  assert.deepEqual(proceduralClips(rig(sampleQuadruped()).skeleton).map((c) => c.name), ['Idle', 'Walking', 'Running', 'Sitting']);
});

test('retargeting applies rest-pose deltas, so a different source rest pose does not leak through', () => {
  const { skeleton } = rig(sampleHumanoid());
  // Source: hips → spine → left arm whose REST is already rotated 30° (a different bone roll / rest orientation).
  const rest30 = quatAxisAngle([0, 0, 1], 30);
  const source = { bones: [
    { name: 'src_hips', parent: -1, restLocal: [0, 0, 0, 1] as [number, number, number, number] },
    { name: 'src_arm', parent: 0, restLocal: rest30 },
  ] };
  // The animation lowers the arm by 40° relative to its rest: local = rest · rotZ(-40)
  const lower = quatAxisAngle([0, 0, 1], -40);
  const mul = (a: number[], b: number[]) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const clip = { name: 'Lower', duration: 1, times: [0, 1], local: { src_arm: [...rest30, ...mul(rest30, lower)] } };
  const out = retargetClip(clip, source, skeleton, (n) => (n === 'src_arm' ? MIXAMO('LeftArm') : n === 'src_hips' ? MIXAMO('Hips') : null));
  const arm = out.tracks.find((t) => t.bone === MIXAMO('LeftArm'))!;
  // key 0 = rest → identity on the target; key 1 = the 40° lowering only (not 30 + 40)
  assert.ok(Math.abs(arm.rotations![3] - 1) < 1e-6);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(arm.rotations![7]))) * (180 / Math.PI);
  assert.ok(Math.abs(angle - 40) < 0.5, `retargeted angle ${angle}`);
});
