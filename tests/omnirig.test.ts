/**
 * Phase 9 — OmniRig: canonical frame, classification, joints, skin weights, stress validation, procedural clips and the
 * rest-pose retargeter, measured on synthetic characters whose joints are known.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMesh, canonicalPositions, MeshData, toCanonical, Vec3 } from '../src/rig/analyze';
import { fitSkeleton, MIXAMO } from '../src/rig/skeleton';
import { computeSkinWeights, posePositions, quatAxisAngle, validateRig } from '../src/rig/skin';
import { proceduralClips, quatFromTo, retargetClip } from '../src/rig/animate';
import { decimateMesh, transferSkin } from '../src/rig/decimate';
import { rigMeshData, skinStage } from '../src/rig/pipeline';
import { handleRigJob, lastRigJobThread, runRigJob } from '../src/rig/rigJobs';
import { boneKey, boneMapper, importedClipName, mergeClips, retargetLibrary, retargetRootMotion, SourceClipLibrary } from '../src/rig/clipLibrary';
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

// ================================================================================================ big meshes / worker

/** Midpoint subdivision without smoothing: every triangle → 4 (same shape, 4× the triangles). */
function subdivide(m: MeshData): MeshData {
  const pos = Array.from(m.positions);
  const idx: number[] = [];
  const mid = new Map<string, number>();
  const get = (a: number, b: number) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let v = mid.get(k);
    if (v === undefined) {
      v = pos.length / 3;
      for (let i = 0; i < 3; i++) pos.push((pos[a * 3 + i] + pos[b * 3 + i]) / 2);
      mid.set(k, v);
    }
    return v;
  };
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
    const ab = get(a, b), bc = get(b, c), ca = get(c, a);
    idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

test('decimation: vertex clustering hits the triangle budget, maps every vertex and is deterministic', () => {
  const m = subdivide(subdivide(sampleHumanoid()));
  const a = decimateMesh(m, 6000);
  assert.ok(a.mesh.indices.length / 3 <= 6000, `${a.mesh.indices.length / 3} triangles`);
  assert.ok(a.mesh.indices.length / 3 > 1500, 'not collapsed to almost nothing');
  assert.equal(a.map.length, m.positions.length / 3);
  const nv = a.mesh.positions.length / 3;
  assert.ok(a.map.every((v) => v < nv));
  assert.ok(a.mesh.indices.every((i) => i < nv));
  // every original vertex stays within one cell of its cluster point
  let worst = 0;
  for (let i = 0; i < a.map.length; i++) {
    const c = a.map[i];
    worst = Math.max(worst, Math.hypot(m.positions[i * 3] - a.mesh.positions[c * 3], m.positions[i * 3 + 1] - a.mesh.positions[c * 3 + 1], m.positions[i * 3 + 2] - a.mesh.positions[c * 3 + 2]));
  }
  assert.ok(worst <= a.cell * Math.sqrt(3) + 1e-6);
  const b = decimateMesh(m, 6000);
  assert.deepEqual(Array.from(b.mesh.indices), Array.from(a.mesh.indices));
  // weight transfer copies the cluster's 4 influences
  const skin = { indices: new Uint16Array(nv * 4).map((_, i) => i % 7), weights: new Float32Array(nv * 4).fill(0.25) };
  const t = transferSkin(skin, a.map);
  assert.equal(t.indices.length, (m.positions.length / 3) * 4);
  assert.deepEqual(Array.from(t.indices.slice(40, 44)), Array.from(skin.indices.slice(a.map[10] * 4, a.map[10] * 4 + 4)));
});

test('meshes above 300k triangles are skinned on a decimated copy; weights match full-resolution skinning', () => {
  let m = sampleHumanoid();
  while (m.indices.length / 3 <= 300_000) m = subdivide(m);
  const n = m.positions.length / 3;
  const big = rigMeshData(m);
  assert.ok(big.proxyTriangles && big.proxyTriangles <= 100_000, `proxy ${big.proxyTriangles}`);
  assert.equal(big.skin.weights.length, n * 4);
  assert.match(big.report.warnings.join(' '), /simplified copy/);
  assert.ok(['A', 'B'].includes(big.validation.grade), `grade ${big.validation.grade}`);
  for (let v = 0; v < n; v += 997) {
    const sum = big.skin.weights[v * 4] + big.skin.weights[v * 4 + 1] + big.skin.weights[v * 4 + 2] + big.skin.weights[v * 4 + 3];
    assert.ok(Math.abs(sum - 1) < 1e-4);
  }
  const full = skinStage({ positions: big.positions, indices: m.indices }, big.skeleton, { maxTriangles: Infinity });
  assert.equal(full.proxyTriangles, undefined);
  let same = 0;
  for (let i = 0; i < n; i++) if (full.skin.indices[i * 4] === big.skin.indices[i * 4]) same++;
  assert.ok(same / n > 0.97, `dominant bone agrees on ${((100 * same) / n).toFixed(1)} % of vertices`);
});

test('rig jobs: the worker protocol returns plain data (+ transferables) and falls back to the main thread', async () => {
  const data = sampleHumanoid();
  const reply = handleRigJob({ id: 7, kind: 'rig', data, opts: {} });
  assert.equal(reply.message.id, 7);
  assert.ok(reply.message.ok);
  assert.equal(reply.transfer.length, 3);
  const res = (reply.message as { result: ReturnType<typeof rigMeshData> }).result;
  assert.equal(res.report.category, 'humanoid');
  const skinJob = handleRigJob({ id: 8, kind: 'skin', mesh: { positions: res.positions.slice(), indices: data.indices }, skeleton: res.skeleton });
  assert.ok(skinJob.message.ok && skinJob.transfer.length === 2);
  const bad = handleRigJob({ id: 9, kind: 'rig', data: null as unknown as MeshData, opts: {} });
  assert.equal(bad.message.ok, false);
  // node has no Worker → runs inline, same answer as the direct call (deterministic)
  const viaJob = await runRigJob({ kind: 'rig', data, opts: {} });
  assert.equal(lastRigJobThread, 'main');
  assert.deepEqual(Array.from(viaJob.skin.indices.slice(0, 400)), Array.from(res.skin.indices.slice(0, 400)));
  assert.equal(viaJob.validation.score, res.validation.score);
});

// ================================================================================================ clip library import

type Q = [number, number, number, number];
function rotateVec(q: Q, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/** A Mixamo-format source built from the fitted rig: centimetres, "mixamorig1:" names, optional A-pose left arm. */
function mixamoSource(skeleton: ReturnType<typeof rig>['skeleton'], opts: { armDownDeg?: number } = {}): SourceClipLibrary['skeleton'] {
  const heads = skeleton.bones.map((b) => b.head.map((v) => v * 100) as Vec3);
  if (opts.armDownDeg) {
    const q = quatAxisAngle([0, 0, 1], -opts.armDownDeg) as Q;
    const shoulder = skeleton.bones.findIndex((b) => b.name === MIXAMO('LeftArm'));
    const inChain = (i: number): boolean => i === shoulder || (i >= 0 && skeleton.bones[i].parent >= 0 && inChain(skeleton.bones[i].parent));
    const p0 = heads[shoulder];
    skeleton.bones.forEach((_, i) => {
      if (i === shoulder || !inChain(i)) return;
      const d = rotateVec(q, [heads[i][0] - p0[0], heads[i][1] - p0[1], heads[i][2] - p0[2]]);
      heads[i] = [p0[0] + d[0], p0[1] + d[1], p0[2] + d[2]];
    });
  }
  return { bones: skeleton.bones.map((b, i) => ({ name: b.name.replace('mixamorig', 'mixamorig1:'), parent: b.parent, restLocal: [0, 0, 0, 1] as Q, head: heads[i] })) };
}

test('clip import: Mixamo bone names map onto the rig, clip names become the ones the AI uses', () => {
  assert.equal(boneKey('mixamorig:LeftArm'), 'leftarm');
  assert.equal(boneKey('mixamorig1_LeftForeArm'), 'leftforearm');
  assert.equal(boneKey('Armature|mixamorigHips'), 'hips');
  const map = boneMapper([MIXAMO('LeftArm'), MIXAMO('Hips')]);
  assert.equal(map('mixamorig:LeftArm'), MIXAMO('LeftArm'));
  assert.equal(map('mixamorig:LeftHandIndex1'), null);
  assert.equal(importedClipName('mixamo.com', 'Slow Walking.glb'), 'Walking');
  assert.equal(importedClipName('Armature|mixamo.com|Layer0', 'Ch09@Running.glb'), 'Running');
  assert.equal(importedClipName('Samba Dancing', 'x.glb'), 'Dance');
  assert.equal(importedClipName('mixamo.com', 'Fist Pump.glb'), 'Fist Pump');
  assert.equal(importedClipName('Take 001', 'Kick.glb', 1, 2), 'Kick 2');
  const proc = proceduralClips(rig(sampleHumanoid()).skeleton);
  const merged = mergeClips(proc, [{ name: 'Walking', duration: 1, loop: true, tracks: [] }, { name: 'Fist Pump', duration: 1, loop: true, tracks: [] }]);
  assert.equal(merged.filter((c) => c.name === 'Walking').length, 1);
  assert.equal(merged.find((c) => c.name === 'Walking')!.tracks.length, 0);
  assert.equal(merged.length, proc.length + 1);
});

test('clip import: a T-pose Mixamo clip retargets onto the rig with in-place, rescaled hips motion', () => {
  const { skeleton } = rig(sampleHumanoid());
  const src = mixamoSource(skeleton);
  const keys = 5;
  const times = Array.from({ length: keys }, (_, k) => k / (keys - 1));
  const hips = skeleton.bones.find((b) => b.name === MIXAMO('Hips'))!.head.map((v) => v * 100);
  const lib: SourceClipLibrary = {
    skeleton: src,
    rootBone: 'mixamorig1:Hips',
    clips: [{
      name: 'mixamo.com', duration: 1, times,
      local: { 'mixamorig1:LeftArm': times.flatMap((t) => quatAxisAngle([0, 0, 1], -60 * t)) },
      // walks 2 m forward (in cm) while bobbing 4 cm
      rootPositions: times.flatMap((t) => [hips[0], hips[1] - 4 * Math.sin(t * Math.PI), hips[2] + 200 * t]),
    }],
  };
  const out = retargetLibrary(lib, skeleton, 'Walking.glb');
  assert.equal(out.clips[0].name, 'Walking');
  assert.ok(out.matched >= out.total * 0.9, `${out.matched}/${out.total}`);
  const arm = out.clips[0].tracks.find((t) => t.bone === MIXAMO('LeftArm'))!;
  const last = arm.rotations!.slice((keys - 1) * 4);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(last[3]))) * (180 / Math.PI);
  assert.ok(Math.abs(angle - 60) < 1, `arm lowered ${angle.toFixed(1)}°`);
  const root = out.clips[0].tracks.find((t) => t.positions)!;
  assert.equal(root.bone, MIXAMO('Hips'));
  const p = root.positions!;
  // no forward travel (played in place); the bob is scaled from cm to the rig's metres
  for (let k = 0; k < keys; k++) assert.ok(Math.abs(p[k * 3 + 2]) < 1e-6 && Math.abs(p[k * 3]) < 1e-6);
  assert.ok(Math.abs(p[2 * 3 + 1] + 0.04) < 1e-3, `bob ${p[2 * 3 + 1]}`);
  // the same file against a quadruped rig is refused with a reason
  assert.throws(() => retargetLibrary(lib, rig(sampleQuadruped()).skeleton, 'Walking.glb'), /bones match/);
  assert.deepEqual(retargetRootMotion([0, 100, 0, 0, 100, 50], [0, 100, 0], 1), [0, 0, 0, 0, 0, 0]);
});

test('clip import: rest directions are matched, so an A-pose source still points the arm where the source does', () => {
  const { skeleton } = rig(sampleHumanoid());
  const src = mixamoSource(skeleton, { armDownDeg: 45 });
  const lib: SourceClipLibrary = { skeleton: src, rootBone: 'mixamorig1:Hips', clips: [{ name: 'Hold', duration: 1, times: [0, 1], local: {} }] };
  const out = retargetLibrary(lib, skeleton, 'Hold.glb');
  const arm = out.clips[0].tracks.find((t) => t.bone === MIXAMO('LeftArm'))!;
  const q = arm.rotations!.slice(0, 4) as Q;
  // the T-pose target's upper arm now points along the source's A-pose upper arm
  const sh = skeleton.bones.find((b) => b.name === MIXAMO('LeftArm'))!.head, el = skeleton.bones.find((b) => b.name === MIXAMO('LeftForeArm'))!.head;
  const dir = rotateVec(q, [el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]]);
  const sSh = src.bones.find((b) => b.name === 'mixamorig1:LeftArm')!.head!, sEl = src.bones.find((b) => b.name === 'mixamorig1:LeftForeArm')!.head!;
  const sDir: Vec3 = [sEl[0] - sSh[0], sEl[1] - sSh[1], sEl[2] - sSh[2]];
  const cos = (dir[0] * sDir[0] + dir[1] * sDir[1] + dir[2] * sDir[2]) / (Math.hypot(...dir) * Math.hypot(...sDir));
  assert.ok(cos > 0.999, `arm direction cos ${cos}`);
  // the forearm does not swing again (its parent already carries the swing)
  const fore = out.clips[0].tracks.find((t) => t.bone === MIXAMO('LeftForeArm'))!;
  assert.ok(Math.abs(Math.abs(fore.rotations![3]) - 1) < 1e-3);
  const ft = quatFromTo([1, 0, 0], [0, 1, 0]);
  assert.ok(Math.abs(ft[2] - Math.SQRT1_2) < 1e-6 && Math.abs(ft[3] - Math.SQRT1_2) < 1e-6);
});
