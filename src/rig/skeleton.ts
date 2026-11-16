/**
 * Phase 9 — OmniRig steps 2 + 3: find the joints on the canonical point cloud and fit a skeleton template.
 *
 * Humanoid bones use Mixamo names (`mixamorig:Hips` …) so Mixamo-format clips retarget by name. Joints are found from
 * cross-sections: legs from horizontal slices (two blobs below the crotch), arms from slices across the left / right
 * axis (T- or A-pose), the neck at the narrowest slice above the shoulders. Left / right are averaged (mirror symmetry)
 * and every joint gets a confidence so the UI can ask the user to check the doubtful ones.
 */
import { CharacterCategory, MeshData, principalAxes, sampleSurface, sliceBlobs, Vec3 } from './analyze';

export interface BoneDef {
  name: string;
  parent: number; // -1 for the root
  /** Joint position (canonical frame). */
  head: Vec3;
}

export interface RigSkeleton {
  category: CharacterCategory;
  bones: BoneDef[];
  /** 0..1 per landmark group (legs, arms, spine, head …). */
  confidence: Record<string, number>;
  warnings: string[];
}

/** Mixamo bone names as glTF loaders expose them (three.js strips the ":" of "mixamorig:Hips"). */
export const MIXAMO = (n: string) => `mixamorig${n}`;

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
const avgMirror = (l: Vec3, r: Vec3): [Vec3, Vec3] => {
  const m: Vec3 = [(l[0] - r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
  return [m, mirror(m)];
};

function heightOf(pts: Float32Array) {
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < pts.length; i += 3) { min = Math.min(min, pts[i]); max = Math.max(max, pts[i]); }
  return { min, max, h: Math.max(1e-6, max - min) };
}

/** Centroid of points inside an axis-aligned box. */
function centroidIn(pts: Float32Array, lo: Vec3, hi: Vec3): { c: Vec3; n: number } {
  const c: Vec3 = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
    c[0] += x; c[1] += y; c[2] += z; n++;
  }
  return { c: n ? [c[0] / n, c[1] / n, c[2] / n] : c, n };
}

// ================================================================================================ humanoid

/**
 * `mesh` (canonical positions + triangles) lets the hands be sampled densely for finger detection; without it only the
 * sparse cloud is used and fingers are usually not found (the hand stays one bone).
 */
export function fitHumanoid(pts: Float32Array, mesh?: MeshData): RigSkeleton {
  const warnings: string[] = [];
  const { min: y0, h: H } = heightOf(pts);
  const cell = H / 100;
  const conf: Record<string, number> = {};

  // ---- legs: two blobs from the ankles up to the crotch
  let crotch = y0 + 0.45 * H;
  const legL: Array<{ y: number; c: Vec3 }> = [];
  const legR: Array<{ y: number; c: Vec3 }> = [];
  // Every slice up to 62 %: where are two separate side blobs? The crotch is the highest such slice, so knees that touch
  // further down do not end the legs early, and short-legged (chibi / robot) bodies keep their real proportions.
  let separated = 0, total = 0, highest = -1;
  for (let f = 0.05; f < 0.62; f += 0.015) {
    const ya = y0 + f * H;
    const blobs = sliceBlobs(pts, ya, ya + 0.015 * H, cell, 6).filter((b) => b.count >= 6);
    const left = blobs.filter((b) => b.minX > 0.005 * H).sort((a, b) => b.count - a.count)[0];
    const right = blobs.filter((b) => b.maxX < -0.005 * H).sort((a, b) => b.count - a.count)[0];
    const centreBlob = blobs.find((b) => b.minX < 0 && b.maxX > 0);
    total++;
    if (left && right && !centreBlob) {
      separated++;
      highest = ya;
      legL.push({ y: ya, c: [left.cx, ya, left.cz] });
      legR.push({ y: ya, c: [right.cx, ya, right.cz] });
    } else if (highest > 0 && ya - highest > 0.12 * H) {
      break; // well into the body
    }
  }
  if (highest > y0 + 0.15 * H) crotch = highest + 0.015 * H;
  conf.legs = legL.length > 8 && separated / Math.max(1, total) > 0.25 ? 0.9 : 0.4;
  if (conf.legs < 0.5) {
    // Legs that touch (knees together, trousers, robe): split left / right at the mirror plane and put the crotch at the
    // usual proportion; the user can drag the joints if the character is unusual.
    crotch = y0 + 0.47 * H;
    legL.length = 0;
    legR.length = 0;
    for (let f = 0.05; f < 0.45; f += 0.03) {
      const ya = y0 + f * H;
      for (const [leg, sign] of [[legL, 1], [legR, -1]] as const) {
        const { c, n } = centroidIn(pts, sign > 0 ? [0, ya, -H] : [-H, ya, -H], sign > 0 ? [H, ya + 0.03 * H, H] : [0, ya + 0.03 * H, H]);
        if (n > 4) leg.push({ y: ya, c });
      }
    }
    conf.legs = 0.5;
    warnings.push('Legs touch or are covered (trousers / robe) — hips, knees and ankles were placed by body proportions; check them.');
  }
  const legAt = (leg: typeof legL, y: number, fallbackX: number): Vec3 => {
    if (!leg.length) return [fallbackX, y, 0];
    const best = leg.reduce((p, q) => (Math.abs(q.y - y) < Math.abs(p.y - y) ? q : p));
    return [best.c[0], y, best.c[2]];
  };
  const ankleY = y0 + 0.055 * H;
  const hipY = crotch - 0.01 * H;
  let [lAnkle, rAnkle] = avgMirror(legAt(legL, ankleY + 0.01 * H, 0.06 * H), legAt(legR, ankleY + 0.01 * H, -0.06 * H));
  lAnkle[1] = rAnkle[1] = ankleY;
  let [lHip, rHip] = avgMirror(legAt(legL, crotch - 0.04 * H, 0.06 * H), legAt(legR, crotch - 0.04 * H, -0.06 * H));
  lHip[1] = rHip[1] = hipY;
  const kneeY = (hipY + ankleY) / 2;
  let [lKnee, rKnee] = avgMirror(legAt(legL, kneeY, lHip[0]), legAt(legR, kneeY, rHip[0]));
  lKnee[1] = rKnee[1] = kneeY;
  // toes: the front tip of the foot
  const foot = centroidIn(pts, [lAnkle[0] - 0.06 * H, y0, -H], [lAnkle[0] + 0.06 * H, y0 + 0.04 * H, H]);
  let toeZ = lAnkle[2] + 0.06 * H;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] < y0 + 0.04 * H && Math.abs(pts[i] - lAnkle[0]) < 0.06 * H) toeZ = Math.max(toeZ, pts[i + 2]);
  }
  void foot;
  const lToe: Vec3 = [lAnkle[0], y0 + 0.02 * H, lAnkle[2] + (toeZ - lAnkle[2]) * 0.6];
  const lToeEnd: Vec3 = [lAnkle[0], y0 + 0.02 * H, toeZ];

  // ---- torso width below the arms (waist) and the arms from slices across x
  const waist = sliceBlobs(pts, y0 + 0.6 * H, y0 + 0.64 * H, cell, 6);
  const waistBlob = waist.find((b) => b.minX < 0 && b.maxX > 0) || waist[0];
  const torsoHalf = waistBlob ? Math.max(Math.abs(waistBlob.minX), Math.abs(waistBlob.maxX)) : 0.12 * H;
  let xMax = 0;
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] > crotch + 0.1 * H) xMax = Math.max(xMax, pts[i]);
  const armSpan = xMax - torsoHalf;
  const armLine: Array<{ x: number; c: Vec3 }> = [];
  if (armSpan > 0.12 * H) {
    for (let x = torsoHalf * 1.15; x <= xMax; x += armSpan / 24) {
      const { c, n } = centroidIn(pts, [x, crotch + 0.1 * H, -H], [x + armSpan / 24, y0 + H, H]);
      if (n > 4) armLine.push({ x: c[0], c });
    }
  }
  conf.arms = armLine.length >= 8 ? 0.85 : 0.3;
  let lShoulder: Vec3, lElbow: Vec3, lHand: Vec3, lHandEnd: Vec3;
  if (conf.arms >= 0.5) {
    const at = (t: number) => armLine[Math.min(armLine.length - 1, Math.max(0, Math.round(t * (armLine.length - 1))))].c;
    const start = at(0);
    lShoulder = [torsoHalf * 0.85, start[1], start[2]];
    lHandEnd = at(1);
    lHand = at(0.86);
    lElbow = at(0.45);
  } else {
    warnings.push('Arms were not found away from the body (arms down / attached?) — place the shoulder, elbow and hand joints.');
    const sy = y0 + 0.8 * H;
    lShoulder = [torsoHalf * 0.85, sy, 0];
    lElbow = [torsoHalf + 0.05 * H, sy - 0.16 * H, 0];
    lHand = [torsoHalf + 0.07 * H, sy - 0.3 * H, 0];
    lHandEnd = [torsoHalf + 0.07 * H, sy - 0.36 * H, 0];
  }

  // ---- fingers: a top view of the hand at the end of the arm (only when the arms were found)
  let fingers: FingerFit | null = null;
  if (conf.arms >= 0.5) {
    const fit = fitFingers(handSamples(pts, mesh, lElbow, lHand, H), lElbow, lHand, H);
    if (fit.fit) {
      fingers = fit.fit;
      lHand = fit.fit.wrist;
      conf.fingers = fit.fit.chains.Thumb ? 0.85 : 0.6;
    }
    if (fit.warning) warnings.push(fit.warning);
  }

  // ---- spine, neck (narrowest slice above the shoulders), head
  const shoulderY = lShoulder[1];
  let neckY = shoulderY + 0.06 * H;
  let narrow = Infinity;
  for (let y = shoulderY + 0.01 * H; y < shoulderY + 0.16 * H && y < y0 + 0.97 * H; y += 0.008 * H) {
    const blobs = sliceBlobs(pts, y, y + 0.008 * H, cell, 4);
    const c = blobs.find((b) => b.minX < 0.02 * H && b.maxX > -0.02 * H);
    if (!c) continue;
    const w = c.maxX - c.minX;
    if (w < narrow) { narrow = w; neckY = y; }
  }
  conf.spine = narrow < Infinity ? 0.85 : 0.5;
  const zAt = (y: number) => centroidIn(pts, [-0.1 * H, y - 0.02 * H, -H], [0.1 * H, y + 0.02 * H, H]).c[2];
  const hips: Vec3 = [0, crotch + 0.02 * H, zAt(crotch + 0.02 * H)];
  const neck: Vec3 = [0, neckY, zAt(neckY)];
  const top = y0 + H;
  const head: Vec3 = [0, neckY + (top - neckY) * 0.25, zAt(neckY + (top - neckY) * 0.25)];
  const headTop: Vec3 = [0, top, head[2]];
  const spine = lerp(hips, neck, 0.28);
  const spine1 = lerp(hips, neck, 0.55);
  const spine2 = lerp(hips, neck, 0.8);
  const lClav: Vec3 = [lShoulder[0] * 0.35, (spine2[1] + lShoulder[1]) / 2 + 0.01 * H, spine2[2]];

  // ---- assemble (left side measured, right side mirrored)
  const bones: BoneDef[] = [];
  const add = (name: string, parent: string | null, head: Vec3) => {
    bones.push({ name: MIXAMO(name), parent: parent ? bones.findIndex((b) => b.name === MIXAMO(parent)) : -1, head });
  };
  add('Hips', null, hips);
  add('Spine', 'Hips', spine);
  add('Spine1', 'Spine', spine1);
  add('Spine2', 'Spine1', spine2);
  add('Neck', 'Spine2', neck);
  add('Head', 'Neck', head);
  add('HeadTop_End', 'Head', headTop);
  for (const [side, m] of [['Left', (p: Vec3) => p], ['Right', mirror]] as const) {
    add(`${side}Shoulder`, 'Spine2', m(lClav));
    add(`${side}Arm`, `${side}Shoulder`, m(lShoulder));
    add(`${side}ForeArm`, `${side}Arm`, m(lElbow));
    add(`${side}Hand`, `${side}ForeArm`, m(lHand));
    if (!fingers) {
      add(`${side}HandEnd`, `${side}Hand`, m(lHandEnd));
      continue;
    }
    // Middle first: the hand's own segment runs from the wrist to the middle knuckle.
    for (const f of FINGERS) {
      const chain = fingers.chains[f];
      if (!chain) continue;
      chain.forEach((p, k) => add(`${side}Hand${f}${k + 1}`, k ? `${side}Hand${f}${k}` : `${side}Hand`, m(p)));
    }
  }
  for (const [side, m] of [['Left', (p: Vec3) => p], ['Right', mirror]] as const) {
    add(`${side}UpLeg`, 'Hips', m(lHip));
    add(`${side}Leg`, `${side}UpLeg`, m(lKnee));
    add(`${side}Foot`, `${side}Leg`, m(lAnkle));
    add(`${side}ToeBase`, `${side}Foot`, m(lToe));
    add(`${side}Toe_End`, `${side}ToeBase`, m(lToeEnd));
  }
  void rHip; void rKnee; void rAnkle;
  return { category: 'humanoid', bones, confidence: conf, warnings };
}

// ================================================================================================ fingers

/** Mixamo finger names, in the order they are added (Middle first: the hand bone's segment points at it). */
export const FINGERS = ['Middle', 'Thumb', 'Index', 'Ring', 'Pinky'] as const;
export type FingerName = (typeof FINGERS)[number];

/** `mixamorigLeftHandIndex2` → 'LeftHandIndex' (the finger chain it belongs to), anything else → null. */
export function fingerChainOf(name: string): string | null {
  const m = /(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d$/.exec(name);
  return m ? `${m[1]}Hand${m[2]}` : null;
}

interface FingerFit {
  /** Finger → 4 joints (knuckle, middle joint, last joint, tip) of the left hand, canonical frame. */
  chains: Partial<Record<FingerName, Vec3[]>>;
  /** The wrist (hand joint), moved back from the arm-line estimate to the start of the palm. */
  wrist: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Points of the left hand (beyond 60 % of the forearm, within 9 % of the height of the arm axis). */
function handSamples(pts: Float32Array, mesh: MeshData | undefined, elbow: Vec3, hand: Vec3, H: number): Float32Array {
  const u = unit(sub(hand, elbow));
  const fore = Math.hypot(...sub(hand, elbow));
  const inRegion = (x: number, y: number, z: number) => {
    const d: Vec3 = [x - elbow[0], y - elbow[1], z - elbow[2]];
    const s = dot3(d, u);
    if (s < 0.6 * fore) return false;
    return Math.hypot(d[0] - s * u[0], d[1] - s * u[1], d[2] - s * u[2]) < 0.09 * H;
  };
  const out: number[] = [];
  if (mesh) {
    // Dense samples on the triangles that touch the hand: fingers are only a couple of centimetres wide.
    const p = mesh.positions, idx = mesh.indices;
    const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k] * 3;
        if (inRegion(p[v], p[v + 1], p[v + 2])) { keep.push(idx[t], idx[t + 1], idx[t + 2]); break; }
      }
    }
    if (keep.length) {
      const dense = sampleSurface({ positions: p, indices: new Uint32Array(keep) }, 40000, 11);
      for (let i = 0; i < dense.length; i += 3) if (inRegion(dense[i], dense[i + 1], dense[i + 2])) out.push(dense[i], dense[i + 1], dense[i + 2]);
      return new Float32Array(out);
    }
  }
  for (let i = 0; i < pts.length; i += 3) if (inRegion(pts[i], pts[i + 1], pts[i + 2])) out.push(pts[i], pts[i + 1], pts[i + 2]);
  return new Float32Array(out);
}

/** Two-pass 3-4 chamfer distance (8-neighbourhood) to the nearest `zero` pixel; 3 units = one pixel. */
function chamfer(zero: (i: number) => boolean, W: number, Hh: number): Float32Array {
  const d = new Float32Array(W * Hh);
  for (let i = 0; i < d.length; i++) d[i] = zero(i) ? 0 : 1e9;
  const relax = (i: number, j: number, c: number) => { if (d[j] + c < d[i]) d[i] = d[j] + c; };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (x > 0) relax(i, i - 1, 3);
    if (y > 0) {
      relax(i, i - W, 3);
      if (x > 0) relax(i, i - W - 1, 4);
      if (x < W - 1) relax(i, i - W + 1, 4);
    }
  }
  for (let y = Hh - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (x < W - 1) relax(i, i + 1, 3);
    if (y < Hh - 1) {
      relax(i, i + W, 3);
      if (x < W - 1) relax(i, i + W + 1, 4);
      if (x > 0) relax(i, i + W - 1, 4);
    }
  }
  return d;
}

/**
 * Fingers from a top view of the hand. The hand points are projected onto the palm plane (one axis along the forearm,
 * the palm normal = the thinnest principal axis of the hand) into an image of 2.5 mm per 1.8 m of height. A
 * morphological opening (chamfer distance) keeps the thick part — wrist and palm — and the thin protrusions left over are
 * the fingers. Five protrusions = the thumb (the one that leaves the palm closest to the wrist) + four fingers ordered
 * front to back; four = fingers without a separate thumb. Anything else (mitten hands, fingers touching, fists, very
 * low-poly hands) keeps the single hand bone and returns a warning.
 */
function fitFingers(hand: Float32Array, elbow: Vec3, handJoint: Vec3, H: number): { fit: FingerFit | null; warning?: string } {
  const mitten = (why: string) => ({ fit: null, warning: `${why} — each hand moves as one piece (no finger bones).` });
  const u = unit(sub(handJoint, elbow));
  const fore = Math.hypot(...sub(handJoint, elbow));
  // palm normal: the thinnest direction of the points beyond 90 % of the forearm
  const mean: Vec3 = [0, 0, 0];
  let n = 0;
  const beyond = (i: number) => dot3([hand[i] - elbow[0], hand[i + 1] - elbow[1], hand[i + 2] - elbow[2]], u) >= 0.9 * fore;
  for (let i = 0; i < hand.length; i += 3) {
    if (!beyond(i)) continue;
    mean[0] += hand[i]; mean[1] += hand[i + 1]; mean[2] += hand[i + 2]; n++;
  }
  if (n < 200) return mitten('Too few points on the hands to find fingers');
  mean[0] /= n; mean[1] /= n; mean[2] /= n;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < hand.length; i += 3) {
    if (!beyond(i)) continue;
    const d = [hand[i] - mean[0], hand[i + 1] - mean[1], hand[i + 2] - mean[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += (d[r] * d[c]) / n;
  }
  const axes = principalAxes(cov);
  let nrm = axes[2].vector;
  if (Math.abs(dot3(nrm, u)) > 0.7) nrm = axes[1].vector; // a hand thinner along the arm than across: use the next axis
  const along = dot3(nrm, u);
  nrm = unit([nrm[0] - along * u[0], nrm[1] - along * u[1], nrm[2] - along * u[2]]);
  const w = cross3(nrm, u);

  const cell = 0.0025 * H;
  const count = hand.length / 3;
  const A = new Float32Array(count), B = new Float32Array(count), C = new Float32Array(count);
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const d: Vec3 = [hand[i * 3] - handJoint[0], hand[i * 3 + 1] - handJoint[1], hand[i * 3 + 2] - handJoint[2]];
    A[i] = dot3(d, u); B[i] = dot3(d, w); C[i] = dot3(d, nrm);
    aMin = Math.min(aMin, A[i]); aMax = Math.max(aMax, A[i]); bMin = Math.min(bMin, B[i]); bMax = Math.max(bMax, B[i]);
  }
  const W = Math.ceil((aMax - aMin) / cell) + 3, Hh = Math.ceil((bMax - bMin) / cell) + 3;
  if (W * Hh > 250_000) return mitten('The hands are too large to analyse');
  const fg = new Uint8Array(W * Hh);
  const cSum = new Float32Array(W * Hh), cCount = new Uint32Array(W * Hh);
  for (let i = 0; i < count; i++) {
    const k = (Math.floor((B[i] - bMin) / cell) + 1) * W + Math.floor((A[i] - aMin) / cell) + 1;
    fg[k] = 1; cSum[k] += C[i]; cCount[k]++;
  }
  // opening: core = far from the outline, palm = within the same distance of the core; what is left are protrusions
  const dist = chamfer((i) => !fg[i], W, Hh);
  let maxD = 0;
  for (let i = 0; i < dist.length; i++) if (fg[i]) maxD = Math.max(maxD, dist[i]);
  const t = 0.5 * maxD;
  if (t < 9) return mitten('The hands are too small to separate fingers');
  const dCore = chamfer((i) => fg[i] === 1 && dist[i] >= t, W, Hh);
  const palm = (i: number) => fg[i] === 1 && dCore[i] <= t + 3;
  const label = new Int32Array(W * Hh).fill(-1);
  const comps: number[][] = [];
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i] || palm(i) || label[i] >= 0) continue;
    const list: number[] = [];
    const stack = [i];
    label[i] = comps.length;
    while (stack.length) {
      const k = stack.pop()!;
      list.push(k);
      const x = k % W, y = (k / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
        const j = ny * W + nx;
        if (fg[j] && !palm(j) && label[j] < 0) { label[j] = comps.length; stack.push(j); }
      }
    }
    comps.push(list);
  }
  const tM = (t / 3) * cell; // opening radius in metres
  const at = (k: number): [number, number] => [aMin + ((k % W) - 0.5) * cell, bMin + (((k / W) | 0) - 0.5) * cell];
  type Finger = { base: [number, number]; tip: [number, number]; len: number; c: number };
  const found: Finger[] = [];
  for (const list of comps) {
    if (list.length < 4 || list.some((k) => k % W <= 2)) continue; // tiny corners, the cut end of the forearm
    const edge = list.filter((k) => {
      const x = k % W, y = (k / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < Hh && palm(ny * W + nx)) return true;
      }
      return false;
    });
    if (!edge.length) continue; // floating bits are not attached to the palm
    const base: [number, number] = [0, 0];
    for (const k of edge) { const p = at(k); base[0] += p[0] / edge.length; base[1] += p[1] / edge.length; }
    let tip = base, len = 0;
    for (const k of list) {
      const p = at(k);
      const l = Math.hypot(p[0] - base[0], p[1] - base[1]);
      if (l > len) { len = l; tip = p; }
    }
    const width = (list.length * cell * cell) / Math.max(1e-9, len);
    if (len < Math.max(1.2 * tM, 0.012 * H) || width > 0.6 * len) continue;
    let cs = 0, cn = 0;
    for (const k of list) { cs += cSum[k]; cn += cCount[k]; }
    found.push({ base, tip, len, c: cn ? cs / cn : 0 });
  }
  if (found.length < 4 || found.length > 5) {
    return mitten(found.length ? `Found ${found.length} finger(s) instead of 4–5 (fingers touching or curled?)` : 'Fingers are not separated (mitten hand or fingers touching)');
  }
  const to3 = (a: number, b: number, c: number): Vec3 => [
    handJoint[0] + a * u[0] + b * w[0] + c * nrm[0],
    handJoint[1] + a * u[1] + b * w[1] + c * nrm[1],
    handJoint[2] + a * u[2] + b * w[2] + c * nrm[2],
  ];
  const thumb = found.length === 5 ? found.reduce((p, q) => (q.base[0] < p.base[0] ? q : p)) : undefined;
  // left hand, palm down or facing the body: the index finger is the front-most (+z) one
  const rest = found.filter((f) => f !== thumb).sort((p, q) => to3(q.base[0], q.base[1], q.c)[2] - to3(p.base[0], p.base[1], p.c)[2]);
  const chain = (f: Finger, back: number, splits: [number, number]): Vec3[] => {
    const dir: [number, number] = [(f.tip[0] - f.base[0]) / f.len, (f.tip[1] - f.base[1]) / f.len];
    const k1: [number, number] = [f.base[0] - dir[0] * back * f.len, f.base[1] - dir[1] * back * f.len];
    const T: [number, number] = [f.tip[0] - k1[0], f.tip[1] - k1[1]];
    return [k1, [k1[0] + T[0] * splits[0], k1[1] + T[1] * splits[0]], [k1[0] + T[0] * splits[1], k1[1] + T[1] * splits[1]], f.tip]
      .map((p) => to3(p[0], p[1], f.c));
  };
  const chains: FingerFit['chains'] = {};
  (['Index', 'Middle', 'Ring', 'Pinky'] as const).forEach((name, i) => { chains[name] = chain(rest[i], 0.2, [0.45, 0.75]); });
  if (thumb) chains.Thumb = chain(thumb, 0.25, [0.4, 0.7]);
  // wrist: the palm is roughly 0.6 of a finger long behind the knuckles; the hand joint only ever moves back along the arm
  const knuckleA = rest.reduce((s, f) => s + (f.base[0] - 0.2 * f.len), 0) / rest.length;
  const fingerLen = rest.reduce((s, f) => s + 1.2 * f.len, 0) / rest.length;
  const wristA = Math.max(-0.4 * fore, Math.min(0, knuckleA - 0.6 * fingerLen));
  const wrist: Vec3 = [handJoint[0] + wristA * u[0], handJoint[1] + wristA * u[1], handJoint[2] + wristA * u[2]];
  return { fit: { chains, wrist }, warning: thumb ? undefined : 'Four fingers found but no separate thumb — the thumb moves with the hand.' };
}

// ================================================================================================ bird

/**
 * Bird: spine (Hips → Spine → Chest → Neck → Head), a tail, two wings of three segments (shoulder, elbow, wrist → tip)
 * and two legs. The body half-width is where the vertical thickness drops to the thin wing sheet; the wing line is the
 * centroid of slices across x beyond it; the legs are the two blobs between the body and the ground.
 */
export function fitBird(pts: Float32Array): RigSkeleton {
  const warnings: string[] = [];
  const { min: y0, h: H } = heightOf(pts);
  const cell = H / 100;
  const conf: Record<string, number> = {};
  let zMin = Infinity, zMax = -Infinity, xMax = 0;
  for (let i = 0; i < pts.length; i += 3) {
    zMin = Math.min(zMin, pts[i + 2]); zMax = Math.max(zMax, pts[i + 2]); xMax = Math.max(xMax, Math.abs(pts[i]));
  }
  const L = Math.max(1e-6, zMax - zMin);

  // ---- body half-width: vertical thickness across |x| (above the legs); the wing is a thin sheet
  const bins = 40, bw = Math.max(1e-6, xMax / bins);
  const lo = new Float32Array(bins).fill(Infinity), hi = new Float32Array(bins).fill(-Infinity);
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] < y0 + 0.2 * H) continue;
    const b = Math.min(bins - 1, Math.floor(Math.abs(pts[i]) / bw));
    lo[b] = Math.min(lo[b], pts[i + 1]); hi[b] = Math.max(hi[b], pts[i + 1]);
  }
  const thick = (b: number) => (hi[b] > lo[b] ? hi[b] - lo[b] : 0);
  const outer: number[] = [];
  for (let b = Math.floor(bins * 0.5); b < Math.floor(bins * 0.9); b++) if (thick(b) > 0) outer.push(thick(b));
  outer.sort((a, b) => a - b);
  const tw = outer.length ? outer[outer.length >> 1] : 0.05 * H;
  let xb = 0.15 * xMax;
  for (let b = 1; b < bins; b++) if (thick(b) > 0 && thick(b) < 3 * tw) { xb = b * bw; break; }
  xb = Math.min(0.5 * xMax, Math.max(0.05 * H, xb));

  // ---- legs: two blobs below the body, traced upwards until they join it
  const legRec: Array<{ y: number; l: Vec3; r: Vec3 }> = [];
  for (let f = 0.06; f < 0.8; f += 0.02) {
    const ya = y0 + f * H;
    const blobs = sliceBlobs(pts, ya, ya + 0.02 * H, cell, 4).filter((b) => b.count >= 4 && b.maxX - b.minX < 0.25 * H);
    const left = blobs.filter((b) => b.minX > 0.002 * H).sort((a, b) => b.count - a.count)[0];
    const right = blobs.filter((b) => b.maxX < -0.002 * H).sort((a, b) => b.count - a.count)[0];
    const all = sliceBlobs(pts, ya, ya + 0.02 * H, cell, 4);
    const centre = all.find((b) => b.minX < 0 && b.maxX > 0);
    if (left && right && !centre) legRec.push({ y: ya, l: [left.cx, ya, left.cz], r: [right.cx, ya, right.cz] });
    else if (legRec.length) break;
  }
  conf.legs = legRec.length >= 4 ? 0.85 : 0.4;
  if (conf.legs < 0.5) warnings.push('Two separate legs were not found under the body — check the leg joints.');
  const legTop = legRec.length ? legRec[legRec.length - 1].y + 0.02 * H : y0 + 0.35 * H;
  const midRec = legRec[legRec.length >> 1];
  const [lLeg] = midRec ? avgMirror(midRec.l, midRec.r) : [[0.3 * xb, 0, 0] as Vec3];
  const lx = Math.max(0.01 * H, lLeg[0]), lz = lLeg[2];
  let toeZ = lz + 0.08 * H;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] < y0 + 0.05 * H && Math.abs(Math.abs(pts[i]) - lx) < 0.06 * H) toeZ = Math.max(toeZ, pts[i + 2]);
  }

  // ---- wings: centroids of slices across x from the body edge to the tip
  const wing: Vec3[] = [];
  const span = xMax - xb;
  if (span > 0.1 * H) {
    for (let k = 0; k < 20; k++) {
      const x = xb + (k / 20) * span;
      const { c, n } = centroidIn(pts, [x, y0 + 0.15 * H, zMin - 1], [x + span / 20, y0 + H, zMax + 1]);
      if (n > 3) wing.push(c);
    }
  }
  conf.wings = wing.length >= 10 ? 0.85 : 0.35;
  if (conf.wings < 0.5) warnings.push('The wings were not found spread out to the sides — place the wing joints.');
  const wingAt = (t: number): Vec3 => {
    if (wing.length < 2) return [xb + t * Math.max(span, 0.3 * H), y0 + 0.6 * H, 0];
    return wing[Math.min(wing.length - 1, Math.max(0, Math.round(t * (wing.length - 1))))];
  };
  const w0 = wingAt(0), w1 = wingAt(1);
  const shoulder: Vec3 = [0.85 * xb, w0[1], w0[2]];
  const wingTip: Vec3 = [Math.max(w1[0], xMax * 0.99), w1[1], w1[2]];

  // ---- body, neck, head, tail
  const body = centroidIn(pts, [-xb, legTop, zMin], [xb, y0 + 0.75 * H, zMax]).c;
  const hips: Vec3 = [0, body[1], body[2] - 0.1 * L];
  const spine: Vec3 = [0, body[1], body[2] + 0.04 * L];
  const chest: Vec3 = [0, body[1] + 0.04 * H, body[2] + 0.16 * L];
  const headC = centroidIn(pts, [-1.5 * xb, y0 + 0.8 * H, zMin], [1.5 * xb, y0 + H, zMax]);
  const head: Vec3 = headC.n ? [0, headC.c[1] - 0.03 * H, headC.c[2] - 0.02 * L] : [0, y0 + 0.85 * H, body[2] + 0.3 * L];
  let beak: Vec3 = [0, head[1], head[2] + 0.1 * L];
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] > chest[1] + 0.1 * H && Math.abs(pts[i]) < xb && pts[i + 2] > beak[2]) beak = [0, pts[i + 1], pts[i + 2]];
  }
  const neck = lerp(chest, head, 0.45);
  conf.head = headC.n > 10 ? 0.85 : 0.5;
  const tailC = centroidIn(pts, [-1.5 * xb, y0 + 0.15 * H, zMin], [1.5 * xb, y0 + H, zMin + 0.12 * L]);
  conf.tail = tailC.n > 10 && tailC.c[2] < hips[2] ? 0.8 : 0;

  const bones: BoneDef[] = [];
  const add = (name: string, parent: string | null, p: Vec3) => {
    bones.push({ name, parent: parent ? bones.findIndex((b) => b.name === parent) : -1, head: p });
  };
  add('Hips', null, hips);
  add('Spine', 'Hips', spine);
  add('Chest', 'Spine', chest);
  add('Neck', 'Chest', neck);
  add('Head', 'Neck', head);
  add('HeadEnd', 'Head', beak);
  if (conf.tail > 0) {
    const t0: Vec3 = [0, hips[1], Math.min(hips[2] - 0.06 * L, (hips[2] + zMin) / 2)];
    add('Tail1', 'Hips', t0);
    add('TailEnd', 'Tail1', [0, tailC.c[1], zMin]);
  }
  for (const [side, m] of [['Left', (p: Vec3) => p], ['Right', mirror]] as const) {
    add(`${side}Wing1`, 'Chest', m(shoulder));
    add(`${side}Wing2`, `${side}Wing1`, m(wingAt(0.35)));
    add(`${side}Wing3`, `${side}Wing2`, m(wingAt(0.68)));
    add(`${side}WingEnd`, `${side}Wing3`, m(wingTip));
  }
  for (const [side, m] of [['Left', (p: Vec3) => p], ['Right', mirror]] as const) {
    add(`${side}UpLeg`, 'Hips', m([lx, Math.min(body[1], legTop + 0.08 * H), lz]));
    add(`${side}Leg`, `${side}UpLeg`, m([lx, legTop, lz]));
    add(`${side}Foot`, `${side}Leg`, m([lx, y0 + 0.05 * H, lz]));
    add(`${side}FootEnd`, `${side}Foot`, m([lx, y0 + 0.01 * H, toeZ]));
  }
  conf.spine = 0.8;
  return { category: 'bird', bones, confidence: conf, warnings };
}

// ================================================================================================ serpent

/** Bones of the serpent body chain (spine + neck + tail), front to back order not implied. */
export const SERPENT_BODY = /^(Hips|Spine\d+|Neck|Tail\d+)$/;

/**
 * Serpent (snake, eel, worm): a chain of 10–16 bones along the midline from the tail tip to the neck, rooted in the
 * middle of the body (`Hips`, `Spine1…`, `Neck` forward; `Tail1…` backward), a head and a jaw. The neck is the narrowest
 * cross-section just behind the head; more bones for thinner, longer bodies.
 */
export function fitSerpent(pts: Float32Array): RigSkeleton {
  const warnings: string[] = [];
  const conf: Record<string, number> = {};
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < pts.length; i += 3) { zMin = Math.min(zMin, pts[i]); zMax = Math.max(zMax, pts[i]); }
  const L = Math.max(1e-6, zMax - zMin);
  const nb = 48, bl = L / nb;
  const stat = Array.from({ length: nb }, () => ({ n: 0, x: 0, y: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }));
  for (let i = 0; i < pts.length; i += 3) {
    const s = stat[Math.min(nb - 1, Math.floor((pts[i + 2] - zMin) / bl))];
    s.n++; s.x += pts[i]; s.y += pts[i + 1];
    s.minX = Math.min(s.minX, pts[i]); s.maxX = Math.max(s.maxX, pts[i]);
    s.minY = Math.min(s.minY, pts[i + 1]); s.maxY = Math.max(s.maxY, pts[i + 1]);
  }
  const width = (b: number) => (stat[b].n ? stat[b].maxX - stat[b].minX : Infinity);
  /** Midline point at z (nearest non-empty bin). */
  const mid = (z: number): Vec3 => {
    const b0 = Math.min(nb - 1, Math.max(0, Math.floor((z - zMin) / bl)));
    for (let d = 0; d < nb; d++) {
      for (const b of [b0 - d, b0 + d]) {
        if (b >= 0 && b < nb && stat[b].n) return [stat[b].x / stat[b].n, stat[b].y / stat[b].n, z];
      }
    }
    return [0, 0, z];
  };
  const widths = stat.map((_, b) => width(b)).filter(Number.isFinite).sort((a, b) => a - b);
  const medianW = widths.length ? widths[widths.length >> 1] : 0.05 * L;

  // ---- neck: the front-most narrow slice in the front quarter, behind the head
  let narrow = Infinity;
  for (let b = Math.floor(0.72 * nb); b < nb - 2; b++) narrow = Math.min(narrow, width(b));
  let neckBin = Math.floor(0.9 * nb);
  for (let b = nb - 3; b >= Math.floor(0.72 * nb); b--) if (width(b) <= narrow * 1.05) { neckBin = b; break; }
  const neckZ = zMin + (neckBin + 0.5) * bl;
  let headW = 0, headTop = -Infinity, headBot = Infinity;
  for (let b = neckBin + 1; b < nb; b++) {
    if (!stat[b].n) continue;
    headW = Math.max(headW, width(b)); headTop = Math.max(headTop, stat[b].maxY); headBot = Math.min(headBot, stat[b].minY);
  }
  if (!Number.isFinite(headTop)) { headTop = mid(zMax)[1] + 0.02 * L; headBot = mid(zMax)[1] - 0.02 * L; }
  conf.head = headW > narrow * 1.1 ? 0.85 : 0.6;
  if (conf.head < 0.8) warnings.push('No wider head was found at the front — check the head and neck joints.');

  // ---- body chain: N joints from the tail tip to the neck, rooted at 45 % of the length
  const N = Math.max(10, Math.min(16, Math.round((0.8 * L) / Math.max(1e-6, medianW))));
  const Lb = neckZ - zMin;
  const joint = (i: number) => mid(zMin + (i / N) * Lb);
  const r = Math.round(0.45 * N);
  const bones: BoneDef[] = [];
  const add = (name: string, parent: string | null, p: Vec3) => {
    bones.push({ name, parent: parent ? bones.findIndex((b) => b.name === parent) : -1, head: p });
  };
  add('Hips', null, joint(r));
  let prev = 'Hips';
  for (let i = r + 1; i < N; i++) {
    const name = i === N - 1 ? 'Neck' : `Spine${i - r}`;
    add(name, prev, joint(i));
    prev = name;
  }
  const headJ = joint(N);
  add('Head', prev, headJ);
  add('HeadEnd', 'Head', [0, headJ[1], zMax]);
  const headLen = zMax - neckZ;
  const jawY = headBot + 0.3 * (headTop - headBot);
  add('Jaw', 'Head', [0, jawY, neckZ + 0.25 * headLen]);
  add('JawEnd', 'Jaw', [0, jawY - 0.05 * (headTop - headBot), zMax - 0.05 * headLen]);
  // tail: starts at the root (same joint) so the segment between the root and the next joint behind it deforms
  prev = 'Hips';
  for (let i = r, k = 1; i >= 1; i--, k++) {
    const name = `Tail${k}`;
    add(name, prev, joint(i));
    prev = name;
  }
  add('TailEnd', prev, joint(0));
  conf.spine = 0.85;
  return { category: 'serpent', bones, confidence: conf, warnings };
}

// ================================================================================================ quadruped

export function fitQuadruped(pts: Float32Array): RigSkeleton {
  const warnings: string[] = [];
  const { min: y0, h: H } = heightOf(pts);
  const cell = H / 100;
  const conf: Record<string, number> = {};
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < pts.length; i += 3) { zMin = Math.min(zMin, pts[i]); zMax = Math.max(zMax, pts[i]); }

  // ---- four legs at the bottom, traced upwards until they join the body
  const feet = sliceBlobs(pts, y0 + 0.04 * H, y0 + 0.1 * H, cell, 6).sort((a, b) => b.count - a.count).slice(0, 4);
  conf.legs = feet.length === 4 ? 0.9 : 0.35;
  if (feet.length !== 4) warnings.push(`${feet.length} feet found instead of 4 — check the leg joints.`);
  const front = feet.filter((f) => f.cz > 0).sort((a, b) => b.cx - a.cx)[0];
  const back = feet.filter((f) => f.cz <= 0).sort((a, b) => b.cx - a.cx)[0];
  const legTop = (f: { cx: number; cz: number } | undefined) => {
    if (!f) return y0 + 0.5 * H;
    let top = y0 + 0.1 * H;
    for (let y = y0 + 0.1 * H; y < y0 + 0.9 * H; y += 0.02 * H) {
      const blobs = sliceBlobs(pts, y, y + 0.02 * H, cell, 4);
      const leg = blobs.find((b) => Math.abs(b.cx - f.cx) < 0.12 * H && Math.abs(b.cz - f.cz) < 0.15 * H && b.maxX - b.minX < 0.25 * H);
      if (!leg) break;
      top = y;
    }
    return top;
  };
  const fTop = legTop(front), bTop = legTop(back);
  const fx = front ? front.cx : 0.1 * H, fz = front ? front.cz : zMax * 0.6;
  const bx = back ? back.cx : 0.1 * H, bz = back ? back.cz : zMin * 0.6;

  // ---- spine: centre line of the body between the leg tops
  const bodyY = (z: number) => centroidIn(pts, [-H, Math.min(fTop, bTop), z - 0.05 * H], [H, y0 + H, z + 0.05 * H]).c[1];
  const hips: Vec3 = [0, bodyY(bz), bz];
  const chest: Vec3 = [0, bodyY(fz), fz];
  const spine = lerp(hips, chest, 0.5);
  // head: the front-most part; neck between chest and head
  const headC = centroidIn(pts, [-H, y0 + 0.4 * H, zMax - 0.22 * (zMax - zMin)], [H, y0 + H, zMax]).c;
  const neck: Vec3 = lerp(chest, headC, 0.45);
  const head: Vec3 = [0, headC[1], headC[2] - 0.05 * (zMax - zMin)];
  const nose: Vec3 = [0, headC[1], zMax];
  // tail: everything behind the hips
  const tailC = centroidIn(pts, [-H, y0 + 0.3 * H, zMin], [H, y0 + H, bz - 0.12 * (zMax - zMin)]);
  conf.tail = tailC.n > 20 ? 0.8 : 0;
  conf.spine = 0.8;

  const bones: BoneDef[] = [];
  const add = (name: string, parent: string | null, head: Vec3) => {
    bones.push({ name, parent: parent ? bones.findIndex((b) => b.name === parent) : -1, head });
  };
  add('Hips', null, hips);
  add('Spine', 'Hips', spine);
  add('Chest', 'Spine', chest);
  add('Neck', 'Chest', neck);
  add('Head', 'Neck', head);
  add('HeadEnd', 'Head', nose);
  if (conf.tail > 0) {
    const t0: Vec3 = [0, hips[1], hips[2] - 0.08 * (zMax - zMin)];
    const tEnd: Vec3 = [0, tailC.c[1], zMin];
    add('Tail1', 'Hips', t0);
    add('Tail2', 'Tail1', lerp(t0, tEnd, 0.5));
    add('TailEnd', 'Tail2', tEnd);
  }
  for (const [pos, x, z, top, parent] of [['Front', fx, fz, fTop, 'Chest'], ['Back', bx, bz, bTop, 'Hips']] as const) {
    for (const [side, sx] of [['Left', 1], ['Right', -1]] as const) {
      const ax = Math.abs(x) * sx;
      const upper: Vec3 = [ax, top, z];
      const foot: Vec3 = [ax, y0 + 0.06 * H, z];
      add(`${side}${pos}UpLeg`, parent, upper);
      add(`${side}${pos}Leg`, `${side}${pos}UpLeg`, [ax, (top + foot[1]) / 2, z + (pos === 'Back' ? -0.02 : 0.01) * H]);
      add(`${side}${pos}Foot`, `${side}${pos}Leg`, foot);
      add(`${side}${pos}FootEnd`, `${side}${pos}Foot`, [ax, y0, z + 0.06 * H]);
    }
  }
  return { category: 'quadruped', bones, confidence: conf, warnings };
}

/** A single root bone (props: a rig that moves / bounces / squashes as one piece). */
export function fitProp(pts: Float32Array): RigSkeleton {
  const { min: y0, h: H } = heightOf(pts);
  return {
    category: 'prop',
    bones: [
      { name: 'Root', parent: -1, head: [0, y0, 0] },
      { name: 'Body', parent: 0, head: [0, y0 + 0.5 * H, 0] },
      { name: 'Top', parent: 1, head: [0, y0 + H, 0] },
    ],
    confidence: { body: 1 },
    warnings: [],
  };
}

/** `mesh` = the canonical mesh (optional): humanoid hands are sampled densely from it to find the fingers. */
export function fitSkeleton(category: CharacterCategory, pts: Float32Array, mesh?: MeshData): RigSkeleton {
  switch (category) {
    case 'humanoid': return fitHumanoid(pts, mesh);
    case 'quadruped': return fitQuadruped(pts);
    case 'bird': return fitBird(pts);
    case 'serpent': return fitSerpent(pts);
    default: return fitProp(pts);
  }
}

/** Bones that end a chain (no children): they only mark where their parent ends, they do not deform. */
export function isEndBone(bones: BoneDef[], i: number): boolean {
  return !bones.some((b) => b.parent === i);
}

/** Segment each deforming bone covers: from its joint to its (first / averaged) child joint. */
export function boneSegments(bones: BoneDef[]): Array<{ bone: number; a: Vec3; b: Vec3 } | null> {
  return bones.map((bone, i) => {
    const kids = bones.filter((b) => b.parent === i);
    if (!kids.length) return null;
    // Hips / chest have several children: the segment goes towards the spine child (first child), not into the legs.
    const end = kids[0].head;
    return { bone: i, a: bone.head, b: end };
  });
}
