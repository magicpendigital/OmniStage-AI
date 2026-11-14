/**
 * Phase 9 — OmniRig steps 2 + 3: find the joints on the canonical point cloud and fit a skeleton template.
 *
 * Humanoid bones use Mixamo names (`mixamorig:Hips` …) so Mixamo-format clips retarget by name. Joints are found from
 * cross-sections: legs from horizontal slices (two blobs below the crotch), arms from slices across the left / right
 * axis (T- or A-pose), the neck at the narrowest slice above the shoulders. Left / right are averaged (mirror symmetry)
 * and every joint gets a confidence so the UI can ask the user to check the doubtful ones.
 */
import { CharacterCategory, sliceBlobs, Vec3 } from './analyze';

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

export function fitHumanoid(pts: Float32Array): RigSkeleton {
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
    add(`${side}HandEnd`, `${side}Hand`, m(lHandEnd));
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

export function fitSkeleton(category: CharacterCategory, pts: Float32Array): RigSkeleton {
  return category === 'humanoid' ? fitHumanoid(pts) : category === 'quadruped' ? fitQuadruped(pts) : fitProp(pts);
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
