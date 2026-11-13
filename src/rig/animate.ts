/**
 * Phase 9 — OmniRig step 6: procedural animation clips for the fitted rig (no files, no licences) and a rest-pose
 * retargeter for library clips. Clip names follow the robot / soldier clips the AI already uses (Idle, Walking, Running,
 * Wave, Jump, Yes, No, Sitting, Dance), so `performance` steps and `matchClipName` work with OmniRig characters as is.
 *
 * Rest pose = the fitted T-pose with identity bone rotations (bone frames aligned with the canonical axes: up +Y,
 * facing +Z, left +X). Stride lengths come from the measured leg length.
 */
import type { Vec3 } from './analyze';
import { MIXAMO, type RigSkeleton } from './skeleton';
import { Quat, quatAxisAngle } from './skin';

export interface ClipTrack {
  bone: string;
  times: number[];
  /** xyzw per key (local rotation). */
  rotations?: number[];
  /** xyz per key: offset added to the bone's rest position (root motion bob / crouch). */
  positions?: number[];
}

export interface ClipData {
  name: string;
  duration: number;
  loop: boolean;
  tracks: ClipTrack[];
}

type PoseFn = (t: number) => { rot: Record<string, Quat>; root?: Vec3 };

function mul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
const X = (deg: number) => quatAxisAngle([1, 0, 0], deg);
const Y = (deg: number) => quatAxisAngle([0, 1, 0], deg);
const Z = (deg: number) => quatAxisAngle([0, 0, 1], deg);
const TAU = Math.PI * 2;

function sample(name: string, duration: number, loop: boolean, fn: PoseFn, rootBone: string, keys = 24): ClipData {
  const times: number[] = [];
  const frames: ReturnType<PoseFn>[] = [];
  for (let i = 0; i <= keys; i++) {
    const t = (i / keys) * duration;
    times.push(+t.toFixed(4));
    frames.push(fn(t / duration));
  }
  const bones = new Set<string>();
  frames.forEach((f) => Object.keys(f.rot).forEach((b) => bones.add(b)));
  const tracks: ClipTrack[] = [...bones].map((bone) => ({
    bone,
    times,
    rotations: frames.flatMap((f) => f.rot[bone] || [0, 0, 0, 1]),
  }));
  if (frames.some((f) => f.root)) tracks.push({ bone: rootBone, times, positions: frames.flatMap((f) => f.root || [0, 0, 0]) });
  return { name, duration, loop, tracks };
}

// ================================================================================================ humanoid

function humanoidClips(sk: RigSkeleton): ClipData[] {
  const m = MIXAMO;
  const head = (n: string) => sk.bones.find((b) => b.name === m(n))!.head;
  const legLen = Math.max(0.2, head('LeftUpLeg')[1] - head('LeftFoot')[1]);
  const H = Math.max(...sk.bones.map((b) => b.head[1]));
  const hips = m('Hips');
  // arms from T-pose down to the sides (A-ish), shared by most clips
  const down = (side: 'Left' | 'Right', extra: Quat = [0, 0, 0, 1]) => mul(extra, Z(side === 'Left' ? -72 : 72));
  const relaxed = (): Record<string, Quat> => ({
    [m('LeftArm')]: down('Left'),
    [m('RightArm')]: down('Right'),
    [m('LeftForeArm')]: Y(-12),
    [m('RightForeArm')]: Y(12),
  });
  const gait = (u: number, amp: number, knee: number, armAmp: number, lean: number, bob: number) => {
    const ph = u * TAU;
    const s = Math.sin(ph);
    const l = -amp * s; // left thigh forward (negative about X) when s > 0
    const r = amp * s;
    const kneeL = knee * Math.max(0, Math.sin(ph - Math.PI / 2 + 0.3)) + 6;
    const kneeR = knee * Math.max(0, Math.sin(ph + Math.PI / 2 + 0.3)) + 6;
    return {
      rot: {
        [m('LeftUpLeg')]: X(l),
        [m('RightUpLeg')]: X(r),
        [m('LeftLeg')]: X(kneeL),
        [m('RightLeg')]: X(kneeR),
        [m('LeftFoot')]: X(-l * 0.3),
        [m('RightFoot')]: X(-r * 0.3),
        [m('LeftArm')]: down('Left', X(armAmp * s)),
        [m('RightArm')]: down('Right', X(-armAmp * s)),
        [m('LeftForeArm')]: Y(-15 - armAmp * 0.4),
        [m('RightForeArm')]: Y(15 + armAmp * 0.4),
        [m('Spine')]: mul(X(lean), Y(6 * s)),
        [m('Spine2')]: Y(-6 * s),
        [m('Head')]: Y(-3 * s),
      },
      root: [0, -bob * Math.abs(Math.cos(ph)), 0] as Vec3,
    };
  };
  const stride = Math.min(32, 18 + legLen * 12);
  return [
    sample('Idle', 2.4, true, (u) => ({
      rot: { ...relaxed(), [m('Spine1')]: X(2 * Math.sin(u * TAU)), [m('Head')]: Y(4 * Math.sin(u * TAU)), [m('LeftArm')]: down('Left', X(2 * Math.sin(u * TAU))), [m('RightArm')]: down('Right', X(-2 * Math.sin(u * TAU))) },
      root: [0, -0.004 * H * (1 - Math.cos(u * TAU)), 0],
    }), hips),
    sample('Walking', 1.05, true, (u) => gait(u, stride, 38, 22, 3, 0.012 * H), hips),
    sample('Running', 0.66, true, (u) => gait(u, stride * 1.5, 75, 40, 12, 0.03 * H), hips),
    sample('Wave', 2.0, true, (u) => ({
      rot: { ...relaxed(), [m('RightArm')]: Z(-150), [m('RightForeArm')]: Z(-25 + 22 * Math.sin(u * TAU * 2)), [m('Head')]: Z(4) },
    }), hips),
    sample('Jump', 1.1, false, (u) => {
      const crouch = u < 0.25 ? u / 0.25 : u < 0.4 ? 1 - (u - 0.25) / 0.15 : u > 0.82 ? Math.sin(((u - 0.82) / 0.18) * Math.PI) : 0;
      const air = u >= 0.35 && u <= 0.85 ? Math.sin(((u - 0.35) / 0.5) * Math.PI) : 0;
      return {
        rot: {
          [m('LeftUpLeg')]: X(-45 * crouch - 15 * air), [m('RightUpLeg')]: X(-45 * crouch - 15 * air),
          [m('LeftLeg')]: X(80 * crouch + 30 * air), [m('RightLeg')]: X(80 * crouch + 30 * air),
          [m('Spine')]: X(20 * crouch),
          [m('LeftArm')]: down('Left', Z(140 * air)), [m('RightArm')]: down('Right', Z(-140 * air)),
        },
        root: [0, -0.16 * legLen * crouch + 0.45 * legLen * air, 0],
      };
    }, hips),
    sample('Yes', 1.2, true, (u) => ({ rot: { ...relaxed(), [m('Head')]: X(14 * Math.sin(u * TAU * 2)), [m('Neck')]: X(6 * Math.sin(u * TAU * 2)) } }), hips),
    sample('No', 1.2, true, (u) => ({ rot: { ...relaxed(), [m('Head')]: Y(26 * Math.sin(u * TAU * 2)) } }), hips),
    sample('Sitting', 2.0, true, (u) => ({
      rot: {
        ...relaxed(),
        [m('LeftUpLeg')]: X(-88), [m('RightUpLeg')]: X(-88),
        [m('LeftLeg')]: X(8), [m('RightLeg')]: X(8),
        [m('Spine')]: X(-8 + 1.5 * Math.sin(u * TAU)),
        [m('LeftArm')]: down('Left', X(-25)), [m('RightArm')]: down('Right', X(-25)),
      },
      root: [0, -(head('Hips')[1] - 0.12 * H), -0.05 * H],
    }), hips),
    sample('Dance', 1.6, true, (u) => {
      const b = Math.sin(u * TAU * 2);
      return {
        rot: {
          [m('LeftArm')]: Z(-30 + 60 * Math.max(0, b)), [m('RightArm')]: Z(30 - 60 * Math.max(0, -b)),
          [m('LeftForeArm')]: Y(-60), [m('RightForeArm')]: Y(60),
          [m('Spine')]: Z(8 * Math.sin(u * TAU)), [m('Head')]: Z(-8 * Math.sin(u * TAU)),
          [m('LeftUpLeg')]: X(-15 * Math.max(0, b)), [m('RightUpLeg')]: X(-15 * Math.max(0, -b)),
          [m('LeftLeg')]: X(30 * Math.max(0, b)), [m('RightLeg')]: X(30 * Math.max(0, -b)),
        },
        root: [0.03 * H * Math.sin(u * TAU), -0.02 * H * Math.abs(b), 0],
      };
    }, hips),
  ];
}

// ================================================================================================ quadruped

function quadrupedClips(sk: RigSkeleton): ClipData[] {
  const has = (n: string) => sk.bones.some((b) => b.name === n);
  const H = Math.max(...sk.bones.map((b) => b.head[1]));
  const tail = (u: number, amp: number): Record<string, Quat> => (has('Tail1') ? { Tail1: Y(amp * Math.sin(u * TAU)), Tail2: Y(amp * 0.7 * Math.sin(u * TAU - 0.8)) } : {});
  const gait = (u: number, amp: number, knee: number, bob: number, gallop: boolean) => {
    const ph = u * TAU;
    // walk / trot: diagonal pairs move together; gallop: front pair, then back pair
    const a = Math.sin(ph), b = gallop ? Math.sin(ph - 1.2) : -a;
    return {
      rot: {
        LeftFrontUpLeg: X(-amp * a), RightBackUpLeg: X(-amp * (gallop ? b : a)),
        RightFrontUpLeg: X(-amp * (gallop ? a * 0.9 : -a)), LeftBackUpLeg: X(-amp * (gallop ? b * 0.9 : -a)),
        LeftFrontLeg: X(-knee * Math.max(0, -a)), RightFrontLeg: X(-knee * Math.max(0, a)),
        LeftBackLeg: X(knee * Math.max(0, a)), RightBackLeg: X(knee * Math.max(0, -a)),
        Neck: X(4 * Math.sin(ph * 2)),
        Spine: X(gallop ? 6 * Math.sin(ph) : 0),
        ...tail(u * 2, gallop ? 12 : 18),
      },
      root: [0, -bob * Math.abs(Math.sin(ph)), 0] as Vec3,
    };
  };
  return [
    sample('Idle', 2.4, true, (u) => ({ rot: { Spine: X(1.5 * Math.sin(u * TAU)), Head: Y(10 * Math.sin(u * TAU)), Neck: X(-4 + 3 * Math.sin(u * TAU)), ...tail(u * 2, 22) } }), 'Hips'),
    sample('Walking', 1.0, true, (u) => gait(u, 22, 30, 0.01 * H, false), 'Hips'),
    sample('Running', 0.55, true, (u) => gait(u, 38, 50, 0.04 * H, true), 'Hips'),
    sample('Sitting', 2.0, true, (u) => ({
      rot: { LeftBackUpLeg: X(-70), RightBackUpLeg: X(-70), LeftBackLeg: X(120), RightBackLeg: X(120), Hips: X(-28), Neck: X(-12), ...tail(u, 10) },
      root: [0, -0.18 * H, -0.05 * H],
    }), 'Hips'),
  ];
}

function propClips(): ClipData[] {
  return [
    sample('Idle', 2.0, true, (u) => ({ rot: { Body: Z(3 * Math.sin(u * TAU)) }, root: [0, 0.02 * Math.sin(u * TAU), 0] }), 'Root'),
    sample('Bounce', 0.8, true, (u) => ({ rot: {}, root: [0, 0.25 * Math.abs(Math.sin(u * Math.PI)), 0] }), 'Root'),
    sample('Spin', 1.6, true, (u) => ({ rot: { Root: Y(360 * u) } }), 'Root'),
  ];
}

export function proceduralClips(sk: RigSkeleton): ClipData[] {
  return sk.category === 'humanoid' ? humanoidClips(sk) : sk.category === 'quadruped' ? quadrupedClips(sk) : propClips();
}

// ================================================================================================ retargeting

/**
 * Rest-pose retargeting of a clip from another skeleton (e.g. a Mixamo-format clip). For every mapped bone the source's
 * world-space rotation change from its rest pose is applied to the target's rest pose, then made local again — so bone
 * roll and rest orientation differences (the usual `retargetClip` problems) do not leak into the result.
 *
 * Inputs are plain data: for each source bone its rest world rotation and parent, and per key its local rotation.
 */
export interface SourceSkeleton {
  bones: Array<{ name: string; parent: number; restLocal: Quat }>;
}

export function retargetClip(
  clip: { name: string; duration: number; times: number[]; local: Record<string, number[]> /* xyzw per key */ },
  source: SourceSkeleton,
  target: RigSkeleton,
  map: (sourceBone: string) => string | null = (n) => n
): ClipData {
  const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
  // source rest world rotations
  const restWorld: Quat[] = [];
  source.bones.forEach((b, i) => { restWorld[i] = b.parent < 0 ? b.restLocal : mul(restWorld[b.parent], b.restLocal); });
  const targetIndex = new Map(target.bones.map((b, i) => [b.name, i]));
  const tracks: ClipTrack[] = [];
  const keyCount = clip.times.length;
  // target rest rotations are identity, so its rest world rotations are identity too.
  const targetWorld: Array<Quat[]> = target.bones.map(() => Array.from({ length: keyCount }, () => [0, 0, 0, 1] as Quat));
  const mapped = new Set<number>();
  for (let k = 0; k < keyCount; k++) {
    const world: Quat[] = [];
    source.bones.forEach((b, i) => {
      const arr = clip.local[b.name];
      const local: Quat = arr ? [arr[k * 4], arr[k * 4 + 1], arr[k * 4 + 2], arr[k * 4 + 3]] : b.restLocal;
      world[i] = b.parent < 0 ? local : mul(world[b.parent], local);
      const tName = map(b.name);
      const ti = tName ? targetIndex.get(tName) : undefined;
      if (ti === undefined) return;
      // delta from rest, in world space: world · restWorld⁻¹ (applied on the target's identity rest)
      targetWorld[ti][k] = mul(world[i], conj(restWorld[i]));
      mapped.add(ti);
    });
  }
  target.bones.forEach((b, i) => {
    if (!mapped.has(i)) return;
    const rotations: number[] = [];
    for (let k = 0; k < keyCount; k++) {
      // local = parentWorld⁻¹ · world (parents without a mapping keep identity)
      let p = b.parent;
      while (p >= 0 && !mapped.has(p)) p = target.bones[p].parent;
      const parentWorld: Quat = p >= 0 ? targetWorld[p][k] : [0, 0, 0, 1];
      rotations.push(...mul(conj(parentWorld), targetWorld[i][k]));
    }
    tracks.push({ bone: b.name, times: clip.times, rotations });
  });
  return { name: clip.name, duration: clip.duration, loop: true, tracks };
}
