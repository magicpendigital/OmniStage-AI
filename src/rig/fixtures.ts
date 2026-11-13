/**
 * Phase 9 — synthetic characters built from boxes with KNOWN joint positions. Used by tests and by the OmniRig dialog's
 * "try with a sample" button. A box helper keeps everything as plain arrays (no Three.js needed).
 */
import type { MeshData, Vec3 } from './analyze';

interface Builder { positions: number[]; indices: number[] }

/** Adds a subdivided box (segments per axis) centred at c with half-sizes h. */
function box(b: Builder, c: Vec3, h: Vec3, seg = 4) {
  const faces: Array<[number, number, number]> = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  for (const [axis, u, v] of faces) {
    for (const sign of [-1, 1]) {
      const base = b.positions.length / 3;
      for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++) {
        const p: Vec3 = [0, 0, 0];
        p[axis] = c[axis] + sign * h[axis];
        p[u] = c[u] + (i / seg * 2 - 1) * h[u];
        p[v] = c[v] + (j / seg * 2 - 1) * h[v];
        b.positions.push(...p);
      }
      for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j, bb = a + seg + 1;
        if (sign > 0) b.indices.push(a, bb, a + 1, a + 1, bb, bb + 1);
        else b.indices.push(a, a + 1, bb, a + 1, bb + 1, bb);
      }
    }
  }
}

function done(b: Builder): MeshData {
  return { positions: new Float32Array(b.positions), indices: new Uint32Array(b.indices) };
}

/** Rotates a mesh about the Y axis (degrees) and scales it — to test facing / unit detection. */
export function transformMesh(mesh: MeshData, yawDeg: number, scale = 1, lieDown = false): MeshData {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i += 3) {
    let x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
    if (lieDown) [y, z] = [-z, y]; // on its back
    out[i] = (c * x + s * z) * scale;
    out[i + 1] = y * scale;
    out[i + 2] = (-s * x + c * z) * scale;
  }
  return { positions: out, indices: mesh.indices };
}

/** Joints of the sample humanoid (canonical frame: +Y up, facing +Z, left = +X, height 1.8). */
export const SAMPLE_HUMANOID_JOINTS: Record<string, Vec3> = {
  hips: [0, 0.95, 0], neck: [0, 1.5, 0], head: [0, 1.62, 0],
  leftShoulder: [0.2, 1.42, 0], leftElbow: [0.48, 1.42, 0], leftHand: [0.74, 1.42, 0],
  rightShoulder: [-0.2, 1.42, 0], rightElbow: [-0.48, 1.42, 0], rightHand: [-0.74, 1.42, 0],
  leftHip: [0.1, 0.92, 0], leftKnee: [0.1, 0.5, 0], leftAnkle: [0.1, 0.08, 0],
  rightHip: [-0.1, 0.92, 0], rightKnee: [-0.1, 0.5, 0], rightAnkle: [-0.1, 0.08, 0],
};

/** A blocky T-pose humanoid, 1.8 m, facing +Z (toes forward). */
export function sampleHumanoid(): MeshData {
  const b: Builder = { positions: [], indices: [] };
  box(b, [0, 1.2, 0], [0.19, 0.3, 0.11], 6); // torso 0.9..1.5
  box(b, [0, 1.53, 0], [0.05, 0.04, 0.05]); // neck
  box(b, [0, 1.68, 0.01], [0.11, 0.12, 0.12], 5); // head 1.56..1.8
  for (const side of [1, -1]) {
    box(b, [side * 0.46, 1.42, 0], [0.27, 0.05, 0.05], 8); // arm 0.19..0.73
    box(b, [side * 0.78, 1.42, 0], [0.05, 0.05, 0.04]); // hand
    box(b, [side * 0.1, 0.5, 0], [0.065, 0.42, 0.065], 8); // leg 0.08..0.92
    box(b, [side * 0.1, 0.04, 0.07], [0.065, 0.04, 0.14]); // foot, toes forward
  }
  return done(b);
}

/** A blocky quadruped (dog-like), 1.0 m tall to the head, 1.4 m long, facing +Z. */
export function sampleQuadruped(): MeshData {
  const b: Builder = { positions: [], indices: [] };
  box(b, [0, 0.62, 0], [0.16, 0.14, 0.45], 6); // body z -0.45..0.45
  box(b, [0, 0.82, 0.55], [0.1, 0.1, 0.14]); // head, forward and up
  box(b, [0, 0.86, 0.72], [0.05, 0.04, 0.06]); // snout
  box(b, [0, 0.7, -0.62], [0.03, 0.03, 0.18]); // tail
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    box(b, [sx * 0.1, 0.25, sz * 0.33], [0.045, 0.25, 0.045], 6); // leg
    box(b, [sx * 0.1, 0.02, sz * 0.33 + 0.04], [0.05, 0.02, 0.08]); // paw forward
  }
  return done(b);
}
