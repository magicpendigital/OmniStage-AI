/**
 * Phase 9 — OmniRig pipeline on plain arrays: analysis → canonical positions → skeleton → skin weights → validation →
 * procedural clips. Pure (no Three.js, no DOM) so it runs in node tests and inside the rig Web Worker (`rig.worker.ts`).
 * Meshes above MAX_TRIANGLES are skinned and validated on a decimated copy; the weights are transferred back.
 */
import { analyzeMesh, AnalysisReport, canonicalPositions, CharacterCategory, MAX_TRIANGLES, MeshData } from './analyze';
import { fitSkeleton, RigSkeleton } from './skeleton';
import { computeSkinWeights, RigValidation, SkinWeights, validateRig } from './skin';
import { ClipData, proceduralClips } from './animate';
import { decimateMesh, DECIMATE_TARGET, transferSkin } from './decimate';

export interface SkinStage {
  skin: SkinWeights;
  validation: RigValidation;
  clips: ClipData[];
  /** Triangles of the simplified copy when the mesh was decimated for skinning. */
  proxyTriangles?: number;
}

export interface CoreRigResult extends SkinStage {
  report: AnalysisReport;
  /** Every vertex in the canonical frame (same order as the input). */
  positions: Float32Array;
  skeleton: RigSkeleton;
}

/** Skin weights + stress validation + clips for a canonical mesh (decimated first when it is too big). */
export function skinStage(mesh: MeshData, skeleton: RigSkeleton, opts: { maxTriangles?: number; target?: number } = {}): SkinStage {
  const triangles = mesh.indices.length / 3;
  const clips = proceduralClips(skeleton);
  if (triangles <= (opts.maxTriangles ?? MAX_TRIANGLES)) {
    const skin = computeSkinWeights(mesh, skeleton);
    return { skin, validation: validateRig(mesh, skeleton, skin), clips };
  }
  const d = decimateMesh(mesh, opts.target ?? DECIMATE_TARGET);
  const proxySkin = computeSkinWeights(d.mesh, skeleton);
  return {
    skin: transferSkin(proxySkin, d.map),
    validation: validateRig(d.mesh, skeleton, proxySkin),
    clips,
    proxyTriangles: d.mesh.indices.length / 3,
  };
}

/** The whole automatic rig on plain data. `skeleton` = joints the user already placed (skips fitting). */
export function rigMeshData(data: MeshData, opts: { forceCategory?: CharacterCategory; skeleton?: RigSkeleton; maxTriangles?: number; target?: number } = {}): CoreRigResult {
  const { report, points } = analyzeMesh(data, { forceCategory: opts.forceCategory });
  const positions = canonicalPositions(data, report.frame);
  const skeleton = opts.skeleton || fitSkeleton(report.category, points);
  const stage = skinStage({ positions, indices: data.indices }, skeleton, opts);
  return { report, positions, skeleton, ...stage };
}
