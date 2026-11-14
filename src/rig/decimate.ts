/**
 * Phase 9 — OmniRig: decimation for big meshes (above MAX_TRIANGLES). Skin weights and the stress-pose check run on a
 * simplified copy (uniform vertex clustering, deterministic), then the weights go back to every original vertex through
 * the vertex → cluster map — so the character keeps its full detail, only the expensive maths gets cheaper.
 */
import type { MeshData } from './analyze';
import type { SkinWeights } from './skin';

/** Triangle budget of the simplified copy used for skinning / validation. */
export const DECIMATE_TARGET = 100_000;

export interface Decimated {
  mesh: MeshData;
  /** Original vertex → vertex of the simplified mesh. */
  map: Uint32Array;
  /** Cluster cell size (model units). */
  cell: number;
}

function bounds(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    if (p[i + k] < min[k]) min[k] = p[i + k];
    if (p[i + k] > max[k]) max[k] = p[i + k];
  }
  return { min, max };
}

/** Vertex → cluster id for a grid of `cell`-sized boxes. Returns the ids and how many clusters there are. */
function cluster(p: Float32Array, min: number[], cell: number): { ids: Uint32Array; count: number } {
  const n = p.length / 3;
  const ids = new Uint32Array(n);
  const keyToId = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const x = Math.floor((p[i * 3] - min[0]) / cell);
    const y = Math.floor((p[i * 3 + 1] - min[1]) / cell);
    const z = Math.floor((p[i * 3 + 2] - min[2]) / cell);
    // < 2^21 cells per axis → the key stays an exact integer (63 bits would overflow; 3 × 17 bits = 51 is plenty)
    const key = (x * 131072 + y) * 131072 + z;
    let id = keyToId.get(key);
    if (id === undefined) { id = keyToId.size; keyToId.set(key, id); }
    ids[i] = id;
  }
  return { ids, count: keyToId.size };
}

function countTriangles(indices: Uint32Array, ids: Uint32Array): number {
  let n = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = ids[indices[t]], b = ids[indices[t + 1]], c = ids[indices[t + 2]];
    if (a !== b && b !== c && a !== c) n++;
  }
  return n;
}

/**
 * Uniform vertex clustering: every vertex snaps to the mean of its grid cell, triangles that collapse are dropped and
 * duplicates removed. The cell size is found by bisection so the result has at most `target` triangles.
 */
export function decimateMesh(mesh: MeshData, target = DECIMATE_TARGET): Decimated {
  const { positions, indices } = mesh;
  const { min, max } = bounds(positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // bisection on log(cell) between extent / 100000 (no change) and extent / 8 (a handful of cells)
  let lo = Math.log(extent / 100000), hi = Math.log(extent / 8);
  let best = Math.exp(hi);
  for (let it = 0; it < 18; it++) {
    const mid = (lo + hi) / 2;
    const { ids } = cluster(positions, min, Math.exp(mid));
    if (countTriangles(indices, ids) <= target) { best = Math.exp(mid); hi = mid; } else lo = mid;
  }
  const { ids, count } = cluster(positions, min, best);
  const sum = new Float64Array(count * 3);
  const members = new Uint32Array(count);
  for (let i = 0; i < ids.length; i++) {
    const c = ids[i];
    sum[c * 3] += positions[i * 3]; sum[c * 3 + 1] += positions[i * 3 + 1]; sum[c * 3 + 2] += positions[i * 3 + 2];
    members[c]++;
  }
  const out = new Float32Array(count * 3);
  for (let c = 0; c < count; c++) for (let k = 0; k < 3; k++) out[c * 3 + k] = sum[c * 3 + k] / members[c];
  const tris: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = ids[indices[t]], b = ids[indices[t + 1]], c = ids[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    // same three clusters (either winding) = one triangle
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) continue;
    seen.add(s);
    tris.push(a, b, c);
  }
  return { mesh: { positions: out, indices: new Uint32Array(tris) }, map: ids, cell: best };
}

/** Skin weights of the simplified mesh → every original vertex (each takes the weights of its cluster). */
export function transferSkin(skin: SkinWeights, map: Uint32Array): SkinWeights {
  const n = map.length;
  const indices = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = map[i];
    for (let k = 0; k < 4; k++) {
      indices[i * 4 + k] = skin.indices[c * 4 + k];
      weights[i * 4 + k] = skin.weights[c * 4 + k];
    }
  }
  return { indices, weights };
}
