/**
 * Phase 9 — OmniRig step 0 + 1: import analysis, normalisation and classification.
 *
 * Works on plain arrays (positions + triangle indices) so it runs in the browser and in node tests. Deterministic: the
 * surface is sampled with a seeded generator, every decision comes from geometry. The output is a canonical frame:
 * up = +Y, facing = +Z, character's left = +X, feet on y = 0, centred on x / z — the frame every later step works in.
 */

export type Vec3 = [number, number, number];

export interface MeshData {
  positions: Float32Array; // xyz per vertex
  indices: Uint32Array; // 3 per triangle
}

export type CharacterCategory = 'humanoid' | 'quadruped' | 'prop';

export interface CanonicalFrame {
  /** Row-major 3×3 rotation from model space to canonical space (columns = where model x / y / z go). */
  rotation: number[];
  /** Applied after rotation: canonical = rotation · p · scale + offset. */
  scale: number;
  offset: Vec3;
  /** Which model axis became up / facing, for the report ("+Y", "-Z"…). */
  upAxis: string;
  facingAxis: string;
  /** 0..1 how sure the facing sign is. */
  facingConfidence: number;
}

export interface AnalysisReport {
  vertices: number;
  triangles: number;
  /** Model-space size before normalisation. */
  size: Vec3;
  frame: CanonicalFrame;
  /** Canonical height after normalisation (m). */
  height: number;
  /** Left / right mirror symmetry 0..1 (1 = perfectly symmetric). */
  symmetry: number;
  category: CharacterCategory;
  categoryConfidence: number;
  reasons: string[];
  /** Messages the user should see (too many faces, flat model…). */
  warnings: string[];
}

export const MAX_TRIANGLES = 300_000;
const TARGET_HEIGHT: Record<CharacterCategory, number> = { humanoid: 1.8, quadruped: 1.0, prop: 1.0 };

// ------------------------------------------------------------------------------------------------ sampling

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area-weighted surface samples (xyz triples). Low-poly meshes still give a dense, even point cloud. */
export function sampleSurface(mesh: MeshData, count = 30000, seed = 7): Float32Array {
  const { positions: p, indices: idx } = mesh;
  const tris = idx.length / 3;
  const cum = new Float64Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    cum[t] = total;
  }
  const out = new Float32Array(count * 3);
  if (total <= 0) return out;
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const target = r() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const a = idx[lo * 3] * 3, b = idx[lo * 3 + 1] * 3, c = idx[lo * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = p[a + k] + u * (p[b + k] - p[a + k]) + v * (p[c + k] - p[a + k]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ linear algebra

function covariance(pts: Float32Array) {
  const n = pts.length / 3;
  const m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += pts[i * 3 + k] / n;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = [pts[i * 3] - m[0], pts[i * 3 + 1] - m[1], pts[i * 3 + 2] - m[2]];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) c[r * 3 + s] += (d[r] * d[s]) / n;
  }
  return { mean: m, cov: c };
}

/** Eigen decomposition of a symmetric 3×3 (Jacobi). Returns eigenvectors (unit) sorted by eigenvalue, largest first. */
export function principalAxes(cov: number[]): Array<{ value: number; vector: Vec3 }> {
  const a = cov.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p * 3 + q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p * 3 + q];
        if (Math.abs(apq) < 1e-20) continue;
        const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k * 3 + p], akq = a[k * 3 + q];
          a[k * 3 + p] = c * akp - s * akq;
          a[k * 3 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p * 3 + k], aqk = a[q * 3 + k];
          a[p * 3 + k] = c * apk - s * aqk;
          a[q * 3 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
          v[k * 3 + p] = c * vkp - s * vkq;
          v[k * 3 + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i * 3 + i], vector: [v[i], v[3 + i], v[6 + i]] as Vec3 }))
    .sort((x, y) => y.value - x.value);
}

// ------------------------------------------------------------------------------------------------ canonical frame

const AXES: Array<{ name: string; v: Vec3 }> = [
  { name: '+X', v: [1, 0, 0] }, { name: '-X', v: [-1, 0, 0] },
  { name: '+Y', v: [0, 1, 0] }, { name: '-Y', v: [0, -1, 0] },
  { name: '+Z', v: [0, 0, 1] }, { name: '-Z', v: [0, 0, -1] },
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function applyRotation(rot: number[], p: Vec3): Vec3 {
  return [rot[0] * p[0] + rot[1] * p[1] + rot[2] * p[2], rot[3] * p[0] + rot[4] * p[1] + rot[5] * p[2], rot[6] * p[0] + rot[7] * p[1] + rot[8] * p[2]];
}

/** Rotation whose rows are the canonical axes expressed in model space: right (+X = character's left), up, facing. */
function frameRotation(up: Vec3, facing: Vec3): number[] {
  const left = cross(up, facing); // up × facing = character's left when facing +Z with +Y up → +X
  return [...left, ...up, ...facing];
}

/** Transforms a point cloud (model space) into the canonical frame. */
export function toCanonical(pts: Float32Array, frame: Pick<CanonicalFrame, 'rotation' | 'scale' | 'offset'>): Float32Array {
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    const q = applyRotation(frame.rotation, [pts[i], pts[i + 1], pts[i + 2]]);
    out[i] = q[0] * frame.scale + frame.offset[0];
    out[i + 1] = q[1] * frame.scale + frame.offset[1];
    out[i + 2] = q[2] * frame.scale + frame.offset[2];
  }
  return out;
}

/** Mirror symmetry across x = 0 in canonical space (0..1): how well each point finds a partner on the other side. */
export function mirrorSymmetry(pts: Float32Array, height: number): number {
  const cell = Math.max(1e-4, height / 40);
  const grid = new Set<string>();
  const key = (x: number, y: number, z: number) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  for (let i = 0; i < pts.length; i += 3) grid.add(key(pts[i], pts[i + 1], pts[i + 2]));
  let hit = 0, n = 0;
  for (let i = 0; i < pts.length; i += 9) {
    n++;
    const x = -pts[i], y = pts[i + 1], z = pts[i + 2];
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      const k = `${Math.round(x / cell) + dx},${Math.round(y / cell)},${Math.round(z / cell)}`;
      if (grid.has(k)) found = true;
    }
    if (found) hit++;
  }
  return n ? hit / n : 0;
}

/** Horizontal principal directions of the cloud (perpendicular to up) as facing candidates. */
function horizontalCandidates(pts: Float32Array, up: Vec3): Array<{ name: string; v: Vec3 }> {
  // basis of the horizontal plane
  const ref: Vec3 = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(up, ref);
  const ul = Math.hypot(...u);
  const e1: Vec3 = [u[0] / ul, u[1] / ul, u[2] / ul];
  const e2 = cross(up, e1);
  let a = 0, b = 0, c = 0, n = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const p: Vec3 = [pts[i], pts[i + 1], pts[i + 2]];
    m1 += dot(p, e1); m2 += dot(p, e2); n++;
  }
  m1 /= n; m2 /= n;
  for (let i = 0; i < pts.length; i += 3) {
    const p: Vec3 = [pts[i], pts[i + 1], pts[i + 2]];
    const x = dot(p, e1) - m1, y = dot(p, e2) - m2;
    a += x * x; b += x * y; c += y * y;
  }
  const theta = 0.5 * Math.atan2(2 * b, a - c);
  const dirs: Vec3[] = [0, Math.PI / 2].map((d) => {
    const t = theta + d;
    return [e1[0] * Math.cos(t) + e2[0] * Math.sin(t), e1[1] * Math.cos(t) + e2[1] * Math.sin(t), e1[2] * Math.cos(t) + e2[2] * Math.sin(t)] as Vec3;
  });
  return dirs.map((v) => {
    const snap = AXES.find((ax) => dot(ax.v, v) > Math.cos((4 * Math.PI) / 180) || dot(ax.v, v) < -Math.cos((4 * Math.PI) / 180));
    if (snap) {
      const s = dot(snap.v, v) > 0 ? snap : AXES.find((ax) => dot(ax.v, snap.v) < -0.99)!;
      return { name: s.name, v: s.v };
    }
    const deg = Math.round((Math.atan2(v[0], v[2]) * 180) / Math.PI);
    return { name: `yaw ${deg}°`, v };
  });
}

// ------------------------------------------------------------------------------------------------ slices

export interface Blob2D { cx: number; cz: number; count: number; minX: number; maxX: number; minZ: number; maxZ: number }

/** Connected clusters (x / z plane) of the canonical points with y in [y0, y1). */
export function sliceBlobs(pts: Float32Array, y0: number, y1: number, cell: number, minCount = 4): Blob2D[] {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < pts.length; i += 3) {
    const y = pts[i + 1];
    if (y < y0 || y >= y1) continue;
    const k = `${Math.floor(pts[i] / cell)},${Math.floor(pts[i + 2] / cell)}`;
    let arr = cells.get(k);
    if (!arr) cells.set(k, (arr = []));
    arr.push(i);
  }
  const seen = new Set<string>();
  const blobs: Blob2D[] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const b: Blob2D = { cx: 0, cz: 0, count: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    while (stack.length) {
      const k = stack.pop()!;
      for (const i of cells.get(k)!) {
        const x = pts[i], z = pts[i + 2];
        b.cx += x; b.cz += z; b.count++;
        b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
        b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
      }
      const [gx, gz] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nk = `${gx + dx},${gz + dz}`;
        if (!seen.has(nk) && cells.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    if (b.count >= minCount) {
      b.cx /= b.count; b.cz /= b.count;
      blobs.push(b);
    }
  }
  return blobs.sort((a, b) => b.count - a.count);
}

function bounds(pts: Float32Array) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pts[i + k]);
    max[k] = Math.max(max[k], pts[i + k]);
  }
  return { min, max };
}

// ------------------------------------------------------------------------------------------------ analysis

/**
 * Finds the canonical frame and the category. Up: glTF is Y-up, so +Y unless the shape says otherwise (a model lying on
 * its back has its long axis horizontal and a short vertical extent). Left / right: the horizontal axis with the best
 * mirror symmetry. Facing sign: feet and faces stick out to the front (toes / snout), tails and heels do not.
 */
export function analyzeMesh(mesh: MeshData, opts: { samples?: number; forceCategory?: CharacterCategory } = {}): { report: AnalysisReport; points: Float32Array } {
  const warnings: string[] = [];
  const reasons: string[] = [];
  const triangles = mesh.indices.length / 3;
  if (triangles > MAX_TRIANGLES) warnings.push(`${triangles.toLocaleString()} triangles — above ${MAX_TRIANGLES.toLocaleString()}, the model is simplified before rigging.`);
  const raw = sampleSurface(mesh, opts.samples ?? 30000);
  const b0 = bounds(raw);
  const size: Vec3 = [b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]];

  // Up axis: keep +Y unless Y is clearly the shortest extent while another axis is the longest by far (lying model).
  const { cov } = covariance(raw);
  const axes = principalAxes(cov);
  let up: Vec3 = [0, 1, 0];
  let upName = '+Y';
  if (size[1] < 0.45 * Math.max(size[0], size[2])) {
    // Lying: the up direction is the smallest principal axis, snapped to a model axis; ground side = flatter side.
    const smallest = axes[2].vector;
    const best = AXES.filter((a) => a.name !== '+Y' && a.name !== '-Y').reduce((p, c) => (Math.abs(dot(c.v, smallest)) > Math.abs(dot(p.v, smallest)) ? c : p));
    up = best.v;
    upName = best.name;
    warnings.push(`The model looks like it is lying down; ${upName} is treated as up.`);
  }

  // Candidate facing directions: the horizontal principal axes (any yaw), snapped to a model axis when within ~4°;
  // the left / right mirror plane is then chosen by symmetry.
  const horiz = horizontalCandidates(raw, up);
  let best = { sym: -1, facing: horiz[0].v, facingName: horiz[0].name };
  for (const f of horiz) {
    const rot = frameRotation(up, f.v);
    const pts = toCanonical(raw, { rotation: rot, scale: 1, offset: [0, 0, 0] });
    // centre x before testing symmetry
    let mx = 0;
    for (let i = 0; i < pts.length; i += 3) mx += pts[i];
    mx /= pts.length / 3;
    for (let i = 0; i < pts.length; i += 3) pts[i] -= mx;
    const sym = mirrorSymmetry(pts, Math.max(...size));
    if (sym > best.sym + 1e-6) best = { sym, facing: f.v, facingName: f.name };
  }

  // Facing sign: front protrusions low (toes) and high (snout / face) on the facing axis.
  const rot0 = frameRotation(up, best.facing);
  let pts = toCanonical(raw, { rotation: rot0, scale: 1, offset: [0, 0, 0] });
  let bb = bounds(pts);
  const h0 = bb.max[1] - bb.min[1];
  const frontScore = (() => {
    // Each foot (lowest 6 %) against its own ankle just above: toes stick out in front of the ankle, heels barely behind.
    const fine = h0 / 120;
    const feet = sliceBlobs(pts, bb.min[1], bb.min[1] + 0.06 * h0, fine, 8);
    const ankles = sliceBlobs(pts, bb.min[1] + 0.07 * h0, bb.min[1] + 0.15 * h0, fine, 8);
    let score = 0, weight = 0;
    for (const f of feet) {
      const a = ankles.reduce<Blob2D | null>((best, x) => {
        const d = Math.hypot(x.cx - f.cx, x.cz - f.cz);
        return !best || d < Math.hypot(best.cx - f.cx, best.cz - f.cz) ? x : best;
      }, null);
      if (!a) continue;
      const front = f.maxZ - a.maxZ;
      const back = a.minZ - f.minZ;
      const span = Math.max(1e-6, Math.abs(front) + Math.abs(back));
      score += ((front - back) / span) * f.count;
      weight += f.count;
    }
    return weight ? score / weight : 0;
  })();
  let facing = best.facing;
  let facingName = best.facingName;
  if (frontScore < 0) {
    facing = [-facing[0], -facing[1], -facing[2]] as Vec3;
    facingName = facingName[0] === '+' || facingName[0] === '-'
      ? (facingName[0] === '+' ? '-' : '+') + facingName[1]
      : `yaw ${Math.round((Math.atan2(facing[0], facing[2]) * 180) / Math.PI)}°`;
  }
  const facingConfidence = Math.min(1, Math.abs(frontScore) * 2);
  if (facingConfidence < 0.3) warnings.push('Could not tell front from back reliably; check the facing arrow.');

  const rotation = frameRotation(up, facing);
  pts = toCanonical(raw, { rotation, scale: 1, offset: [0, 0, 0] });
  bb = bounds(pts);
  const rawHeight = Math.max(1e-6, bb.max[1] - bb.min[1]);
  const length = bb.max[2] - bb.min[2];
  const width = bb.max[0] - bb.min[0];

  // ---------------------------------------------------------------- classification (canonical, unscaled)
  const cell = rawHeight / 100;
  const centre = [(bb.min[0] + bb.max[0]) / 2, (bb.min[2] + bb.max[2]) / 2];
  // Ground contacts: several thin slices from the ankles up (feet that nearly touch separate at some height); the slice
  // with the most significant blobs wins.
  let legBlobs: Blob2D[] = [];
  for (let f = 0.02; f <= 0.2; f += 0.03) {
    const slice = sliceBlobs(pts, bb.min[1] + f * rawHeight, bb.min[1] + (f + 0.03) * rawHeight, rawHeight / 100, 8);
    const total = slice.reduce((s, x) => s + x.count, 0);
    const big = slice.filter((b) => b.count > 0.12 * total);
    if (big.length > legBlobs.length && big.length <= 6) legBlobs = big;
  }
  const chestSlice = sliceBlobs(pts, bb.min[1] + 0.74 * rawHeight, bb.min[1] + 0.84 * rawHeight, cell, 20);
  const chestWidth = chestSlice.length ? Math.max(...chestSlice.map((b) => b.maxX)) - Math.min(...chestSlice.map((b) => b.minX)) : 0;
  let category: CharacterCategory = 'prop';
  let confidence = 0.4;
  const tall = rawHeight > 1.15 * Math.max(length, 0.01);
  const long = length > 1.1 * rawHeight;
  if (tall && legBlobs.length >= 2 && legBlobs.length <= 3) {
    category = 'humanoid';
    confidence = 0.75 + (legBlobs.length === 2 ? 0.1 : 0) + (chestWidth > 0.35 * rawHeight ? 0.1 : 0);
    reasons.push(`Taller than long, ${legBlobs.length} legs at the bottom${chestWidth > 0.35 * rawHeight ? ', arms out at chest height' : ''}.`);
  } else if (long && legBlobs.length >= 2 && legBlobs.length <= 6) {
    category = 'quadruped';
    confidence = 0.65 + (legBlobs.length === 4 ? 0.25 : 0.05);
    reasons.push(`Longer than tall with ${legBlobs.length} leg contacts at the bottom.`);
  } else {
    reasons.push(`${legBlobs.length} ground contact(s), proportions ${(rawHeight / Math.max(1e-6, length)).toFixed(2)}:1 — not a clear humanoid or quadruped.`);
  }
  if (opts.forceCategory) {
    category = opts.forceCategory;
    confidence = 1;
    reasons.push('Category chosen by the user.');
  }
  void centre;
  void width;

  // ---------------------------------------------------------------- normalise: feet on the ground, centred, target height
  const scale = TARGET_HEIGHT[category] / rawHeight;
  const offset: Vec3 = [-((bb.min[0] + bb.max[0]) / 2) * scale, -bb.min[1] * scale, -((bb.min[2] + bb.max[2]) / 2) * scale];
  const frame: CanonicalFrame = { rotation, scale, offset, upAxis: upName, facingAxis: facingName, facingConfidence };
  const canonical = toCanonical(raw, frame);
  const symmetry = mirrorSymmetry(canonical, TARGET_HEIGHT[category]);
  if (symmetry < 0.6) warnings.push(`Left / right symmetry is low (${Math.round(symmetry * 100)} %); the rig assumes a symmetric body.`);
  return {
    report: {
      vertices: mesh.positions.length / 3,
      triangles,
      size,
      frame,
      height: TARGET_HEIGHT[category],
      symmetry,
      category,
      categoryConfidence: Math.min(1, confidence),
      reasons,
      warnings,
    },
    points: canonical,
  };
}

/** Applies a canonical frame to mesh positions (for the final skinned mesh). */
export function canonicalPositions(mesh: MeshData, frame: CanonicalFrame): Float32Array {
  return toCanonical(mesh.positions, frame);
}
