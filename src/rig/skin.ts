/**
 * Phase 9 — OmniRig steps 4 + 5: skin weights and stress-pose validation.
 *
 * Weights (Pinocchio-style, without solving a linear system): the mesh is voxelised into a solid; a bone may influence
 * a vertex only if the straight path from the vertex to the bone stays inside the solid (so an arm never pulls the ribs,
 * one leg never pulls the other). Visible bones are weighted by inverse distance (power 4), smoothed over the mesh
 * neighbourhood, and the 4 strongest kept. Validation bends the rig into stress poses with linear blend skinning and
 * measures edge stretch, volume change and flipped triangles → a 0..100 score and an A–D grade.
 */
import type { MeshData, Vec3 } from './analyze';
import type { BoneDef, RigSkeleton } from './skeleton';
import { boneSegments } from './skeleton';

export interface SkinWeights {
  /** 4 bone indices per vertex (into skeleton.bones). */
  indices: Uint16Array;
  /** 4 weights per vertex, sum 1. */
  weights: Float32Array;
}

// ================================================================================================ helpers

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { q: Vec3; d: number; behind: number } {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12;
  const raw = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2;
  const t = Math.max(0, Math.min(1, raw));
  const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  // how far (m) the point lies behind the joint, along the bone axis
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), behind: raw < 0 ? -raw * Math.sqrt(len2) : 0 };
}

/** Welds vertices at the same position (glTF splits them at UV / normal seams) so smoothing crosses seams. */
export function weld(positions: Float32Array, tolerance: number): { map: Uint32Array; count: number } {
  const map = new Uint32Array(positions.length / 3);
  const seen = new Map<string, number>();
  let count = 0;
  const q = (v: number) => Math.round(v / tolerance);
  for (let i = 0; i < map.length; i++) {
    const k = `${q(positions[i * 3])},${q(positions[i * 3 + 1])},${q(positions[i * 3 + 2])}`;
    let id = seen.get(k);
    if (id === undefined) { id = count++; seen.set(k, id); }
    map[i] = id;
  }
  return { map, count };
}

// ================================================================================================ voxel solid

export class VoxelSolid {
  readonly res: number;
  readonly min: Vec3;
  readonly size: number;
  readonly dims: [number, number, number];
  /** 0 = outside, 1 = inside (incl. surface). */
  private cells: Uint8Array;

  constructor(positions: Float32Array, indices: Uint32Array, res = 72) {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
    const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    this.size = extent / res;
    this.min = [min[0] - 2 * this.size, min[1] - 2 * this.size, min[2] - 2 * this.size];
    this.dims = [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / this.size) + 5) as [number, number, number];
    this.res = res;
    const n = this.dims[0] * this.dims[1] * this.dims[2];
    const surface = new Uint8Array(n);
    // Rasterise triangles by sampling them at half-voxel spacing.
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const pa: Vec3 = [positions[a], positions[a + 1], positions[a + 2]];
      const pb: Vec3 = [positions[b], positions[b + 1], positions[b + 2]];
      const pc: Vec3 = [positions[c], positions[c + 1], positions[c + 2]];
      const l = Math.max(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), Math.hypot(pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]), Math.hypot(pc[0] - pb[0], pc[1] - pb[1], pc[2] - pb[2]));
      const steps = Math.max(1, Math.ceil((l / this.size) * 2));
      for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps;
        const idx = this.index([pa[0] + u * (pb[0] - pa[0]) + v * (pc[0] - pa[0]), pa[1] + u * (pb[1] - pa[1]) + v * (pc[1] - pa[1]), pa[2] + u * (pb[2] - pa[2]) + v * (pc[2] - pa[2])]);
        if (idx >= 0) surface[idx] = 1;
      }
    }
    // Flood the outside from a corner; everything not reached is inside.
    const outside = new Uint8Array(n);
    const [X, Y, Z] = this.dims;
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const id = stack.pop()!;
      const x = id % X, y = Math.floor(id / X) % Y, z = Math.floor(id / (X * Y));
      const nb = [x > 0 ? id - 1 : -1, x < X - 1 ? id + 1 : -1, y > 0 ? id - X : -1, y < Y - 1 ? id + X : -1, z > 0 ? id - X * Y : -1, z < Z - 1 ? id + X * Y : -1];
      for (const m of nb) if (m >= 0 && !outside[m] && !surface[m]) { outside[m] = 1; stack.push(m); }
    }
    this.cells = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.cells[i] = outside[i] ? 0 : 1;
  }

  index(p: Vec3): number {
    const x = Math.floor((p[0] - this.min[0]) / this.size), y = Math.floor((p[1] - this.min[1]) / this.size), z = Math.floor((p[2] - this.min[2]) / this.size);
    if (x < 0 || y < 0 || z < 0 || x >= this.dims[0] || y >= this.dims[1] || z >= this.dims[2]) return -1;
    return x + y * this.dims[0] + z * this.dims[0] * this.dims[1];
  }

  inside(p: Vec3): boolean {
    const i = this.index(p);
    return i >= 0 && this.cells[i] === 1;
  }

  /** True when the path a → b stays inside (the first / last voxel are allowed outside: a vertex sits on the surface). */
  visible(a: Vec3, b: Vec3): boolean {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.ceil(d / (this.size * 0.5));
    let misses = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if ((t * d) < this.size * 1.2) continue;
      if (!this.inside([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])) {
        if (++misses > 1) return false;
      }
    }
    return true;
  }
}

// ================================================================================================ weights

export function computeSkinWeights(mesh: MeshData, skeleton: RigSkeleton, opts: { voxelRes?: number; smoothIterations?: number } = {}): SkinWeights {
  const { positions, indices } = mesh;
  const nV = positions.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) { minY = Math.min(minY, positions[i]); maxY = Math.max(maxY, positions[i]); }
  const H = Math.max(1e-6, maxY - minY);
  const { map, count } = weld(positions, H * 1e-4);
  // one representative position per welded vertex
  const wp = new Float32Array(count * 3);
  for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) wp[map[i] * 3 + k] = positions[i * 3 + k];
  const solid = new VoxelSolid(positions, indices, opts.voxelRes ?? 72);
  const segs = boneSegments(skeleton.bones).filter((s): s is { bone: number; a: Vec3; b: Vec3 } => !!s);
  const B = skeleton.bones.length;
  const W = new Float32Array(count * B);

  for (let v = 0; v < count; v++) {
    const p: Vec3 = [wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]];
    const cands = segs.map((s) => ({ s, ...closestOnSegment(p, s.a, s.b) })).sort((x, y) => x.d - y.d);
    const nearest = cands[0].d;
    let total = 0;
    for (const c of cands) {
      if (c.d > nearest * 2.2 + H * 0.01) break;
      if (c !== cands[0] && !solid.visible(p, c.q)) continue;
      // Behind its joint a bone fades out within ~4 % of the height (the shoulder, not the arm, owns the ribs).
      const root = skeleton.bones[c.s.bone].parent < 0;
      const fade = root ? 1 : Math.max(0, 1 - c.behind / (H * 0.04)) ** 2;
      if (fade <= 0 && c !== cands[0]) continue;
      const w = (1 / Math.pow(c.d + H * 0.005, 4)) * Math.max(fade, c === cands[0] ? 0.05 : 0);
      if (w <= 0) continue;
      W[v * B + c.s.bone] += w;
      total += w;
    }
    if (total <= 0) W[v * B + cands[0].s.bone] = 1;
    else for (let b = 0; b < B; b++) W[v * B + b] /= total;
  }

  // Smooth across the surface (welded neighbours) so joints bend softly.
  const nbrs: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    const a = map[indices[t]], b = map[indices[t + 1]], c = map[indices[t + 2]];
    nbrs[a].push(b, c); nbrs[b].push(a, c); nbrs[c].push(a, b);
  }
  const iterations = opts.smoothIterations ?? 3;
  let cur = W;
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(cur.length);
    for (let v = 0; v < count; v++) {
      const list = nbrs[v];
      for (let b = 0; b < B; b++) {
        let s = cur[v * B + b] * 2;
        for (const n of list) s += cur[n * B + b] / Math.max(1, list.length / 2);
        next[v * B + b] = s / 3;
      }
    }
    cur = next;
  }

  // Keep the 4 strongest per vertex, normalise, expand back to the original (unwelded) vertices.
  const idxOut = new Uint16Array(nV * 4);
  const wOut = new Float32Array(nV * 4);
  const top = new Array<{ b: number; w: number }>(B);
  const perWelded: Array<{ i: number[]; w: number[] }> = [];
  for (let v = 0; v < count; v++) {
    for (let b = 0; b < B; b++) top[b] = { b, w: cur[v * B + b] };
    const best = top.slice().sort((x, y) => y.w - x.w).slice(0, 4);
    const sum = best.reduce((s, x) => s + x.w, 0) || 1;
    perWelded.push({ i: best.map((x) => x.b), w: best.map((x) => x.w / sum) });
  }
  for (let i = 0; i < nV; i++) {
    const r = perWelded[map[i]];
    // rigs with fewer than 4 bones leave the remaining slots empty (bone 0, weight 0)
    for (let k = 0; k < 4; k++) { idxOut[i * 4 + k] = r.i[k] ?? 0; wOut[i * 4 + k] = r.w[k] ?? 0; }
  }
  return { indices: idxOut, weights: wOut };
}

// ================================================================================================ posing (LBS)

export type Quat = [number, number, number, number]; // x y z w

export function quatAxisAngle(axis: Vec3, deg: number): Quat {
  const a = (deg * Math.PI) / 360;
  const l = Math.hypot(...axis) || 1;
  return [(axis[0] / l) * Math.sin(a), (axis[1] / l) * Math.sin(a), (axis[2] / l) * Math.sin(a), Math.cos(a)];
}

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const s = q[3];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const c: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [0, 1, 2].map((k) => 2 * d * u[k] + (s * s - uu) * v[k] + 2 * s * c[k]) as Vec3;
}

/** Local rotations (bone name → quaternion, rest = identity) and an optional root offset → posed vertex positions. */
export function posePositions(positions: Float32Array, bones: BoneDef[], skin: SkinWeights, pose: Record<string, Quat>, rootOffset: Vec3 = [0, 0, 0]): Float32Array {
  // forward kinematics: global rotation + global joint position per bone
  const gq: Quat[] = [];
  const gp: Vec3[] = [];
  bones.forEach((b, i) => {
    const local = pose[b.name] || [0, 0, 0, 1];
    if (b.parent < 0) {
      gq[i] = local;
      gp[i] = [b.head[0] + rootOffset[0], b.head[1] + rootOffset[1], b.head[2] + rootOffset[2]];
    } else {
      const p = bones[b.parent];
      const off = rotate(gq[b.parent], [b.head[0] - p.head[0], b.head[1] - p.head[1], b.head[2] - p.head[2]]);
      gp[i] = [gp[b.parent][0] + off[0], gp[b.parent][1] + off[1], gp[b.parent][2] + off[2]];
      gq[i] = quatMul(gq[b.parent], local);
    }
  });
  const out = new Float32Array(positions.length);
  for (let v = 0; v < positions.length / 3; v++) {
    const p: Vec3 = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const acc: Vec3 = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = skin.weights[v * 4 + k];
      if (w <= 0) continue;
      const bi = skin.indices[v * 4 + k];
      const h = bones[bi].head;
      const r = rotate(gq[bi], [p[0] - h[0], p[1] - h[1], p[2] - h[2]]);
      acc[0] += w * (gp[bi][0] + r[0]);
      acc[1] += w * (gp[bi][1] + r[1]);
      acc[2] += w * (gp[bi][2] + r[2]);
    }
    out[v * 3] = acc[0]; out[v * 3 + 1] = acc[1]; out[v * 3 + 2] = acc[2];
  }
  return out;
}

// ================================================================================================ validation

export interface PoseTest {
  name: string;
  pose: Record<string, Quat>;
}

export function stressPoses(skeleton: RigSkeleton): PoseTest[] {
  const has = (n: string) => skeleton.bones.some((b) => b.name === n);
  if (skeleton.category === 'humanoid') {
    const m = (n: string) => `mixamorig${n}`;
    return [
      { name: 'Arms raised', pose: { [m('LeftArm')]: quatAxisAngle([0, 0, 1], 70), [m('RightArm')]: quatAxisAngle([0, 0, 1], -70), [m('LeftForeArm')]: quatAxisAngle([0, 1, 0], -40), [m('RightForeArm')]: quatAxisAngle([0, 1, 0], 40) } },
      { name: 'Squat', pose: { [m('LeftUpLeg')]: quatAxisAngle([1, 0, 0], -80), [m('RightUpLeg')]: quatAxisAngle([1, 0, 0], -80), [m('LeftLeg')]: quatAxisAngle([1, 0, 0], 100), [m('RightLeg')]: quatAxisAngle([1, 0, 0], 100), [m('Spine')]: quatAxisAngle([1, 0, 0], 15) } },
      { name: 'Stride', pose: { [m('LeftUpLeg')]: quatAxisAngle([1, 0, 0], -35), [m('RightUpLeg')]: quatAxisAngle([1, 0, 0], 30), [m('LeftLeg')]: quatAxisAngle([1, 0, 0], 20), [m('RightLeg')]: quatAxisAngle([1, 0, 0], 40) } },
    ];
  }
  if (skeleton.category === 'quadruped') {
    return [
      { name: 'Gallop reach', pose: { LeftFrontUpLeg: quatAxisAngle([1, 0, 0], -40), RightFrontUpLeg: quatAxisAngle([1, 0, 0], -40), LeftBackUpLeg: quatAxisAngle([1, 0, 0], 35), RightBackUpLeg: quatAxisAngle([1, 0, 0], 35) } },
      { name: 'Head down', pose: { Neck: quatAxisAngle([1, 0, 0], 40), ...(has('Tail1') ? { Tail1: quatAxisAngle([0, 1, 0], 35) } : {}) } },
    ];
  }
  return [{ name: 'Lean', pose: { Body: quatAxisAngle([1, 0, 0], 25) } }];
}

function signedVolume(p: Float32Array, idx: Uint32Array) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

export interface PoseResult { name: string; stretchP95: number; volumeChange: number; flipped: number; score: number }
export interface RigValidation { poses: PoseResult[]; score: number; grade: 'A' | 'B' | 'C' | 'D' }

export function validateRig(mesh: MeshData, skeleton: RigSkeleton, skin: SkinWeights, poses = stressPoses(skeleton)): RigValidation {
  const { positions, indices } = mesh;
  const vol0 = signedVolume(positions, indices);
  const edges: Array<[number, number]> = [];
  for (let t = 0; t < indices.length; t += 3) edges.push([indices[t], indices[t + 1]], [indices[t + 1], indices[t + 2]]);
  const len = (p: Float32Array, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  const normal = (p: Float32Array, t: number): Vec3 => {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const u: Vec3 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v: Vec3 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  const results: PoseResult[] = poses.map((pt) => {
    const posed = posePositions(positions, skeleton.bones, skin, pt.pose);
    const devs: number[] = [];
    for (let i = 0; i < edges.length; i += 3) {
      const [a, b] = edges[i];
      const l0 = len(positions, a, b);
      if (l0 > 1e-9) devs.push(Math.abs(len(posed, a, b) / l0 - 1));
    }
    devs.sort((x, y) => x - y);
    const stretchP95 = devs.length ? devs[Math.floor(devs.length * 0.95)] : 0;
    const volumeChange = vol0 ? Math.abs(signedVolume(posed, indices) / vol0 - 1) : 0;
    let flipped = 0, tris = 0;
    for (let t = 0; t < indices.length; t += 9) {
      const n0 = normal(positions, t), n1 = normal(posed, t);
      if (Math.hypot(...n0) < 1e-12) continue;
      tris++;
      if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0) flipped++;
    }
    const flippedFrac = tris ? flipped / tris : 0;
    const score = Math.max(0, Math.min(100, 100 - stretchP95 * 120 - volumeChange * 120 - flippedFrac * 400));
    return { name: pt.name, stretchP95, volumeChange, flipped: flippedFrac, score };
  });
  const score = Math.round(results.reduce((s, r) => s + r.score, 0) / Math.max(1, results.length));
  return { poses: results, score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D' };
}
