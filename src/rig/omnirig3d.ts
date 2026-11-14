/**
 * Phase 9 — OmniRig in the browser: glTF scene → analysis → joints → skin → validation → clips → a rigged THREE.SkinnedMesh
 * (materials kept) → GLB. The maths lives in the pure modules next to this file; this one only converts to / from Three.js.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AnalysisReport, CharacterCategory, MeshData } from './analyze';
import type { BoneDef, RigSkeleton } from './skeleton';
import type { SkinWeights, RigValidation } from './skin';
import type { ClipData } from './animate';
import { rigMeshData, type CoreRigResult } from './pipeline';
import { lastRigJobThread, runRigJob } from './rigJobs';
import { mergeClips, type SourceClip, type SourceClipLibrary } from './clipLibrary';

export interface RigResult {
  report: AnalysisReport;
  skeleton: RigSkeleton;
  skin: SkinWeights;
  validation: RigValidation;
  /** Every clip of the character: procedural ones, replaced / extended by imported library clips. */
  clips: ClipData[];
  proceduralClips: ClipData[];
  importedClips: ClipData[];
  /** Triangles of the simplified copy that was skinned (meshes above 300k triangles). */
  proxyTriangles?: number;
  /** Where the heavy maths ran. */
  thread: 'worker' | 'main';
  /** Rigged character (SkinnedMesh + bones) in the canonical frame, ready to preview or export. */
  object: THREE.Group;
  mesh: THREE.SkinnedMesh;
  animations: THREE.AnimationClip[];
  /** What goes into the library next to the GLB (rig.json). */
  rigJson: RigJson;
}

export interface RigJson {
  version: 1;
  generator: 'OmniRig';
  category: CharacterCategory;
  height: number;
  frame: AnalysisReport['frame'];
  bones: Array<{ name: string; parent: string | null; head: number[] }>;
  confidence: Record<string, number>;
  grade: RigValidation['grade'];
  score: number;
  poses: RigValidation['poses'];
  clips: string[];
  /** Clips that came from an imported library (retargeted), not generated. */
  importedClips?: string[];
  warnings: string[];
  createdAt: string;
}

interface SourcePart { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }

/**
 * The same vertex format for every part (float32, not interleaved / quantised, indexed, position + normal + uv) so parts
 * of different exporters merge into one skinned mesh.
 */
function plainGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = src.attributes.position;
  const n = pos.count;
  const g = new THREE.BufferGeometry();
  const copy = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, size: number) => {
    const out = new Float32Array(n * size);
    if (!attr) return out;
    for (let i = 0; i < n; i++) {
      out[i * size] = attr.getX(i);
      if (size > 1) out[i * size + 1] = attr.getY(i);
      if (size > 2) out[i * size + 2] = attr.getZ(i);
    }
    return out;
  };
  g.setAttribute('position', new THREE.BufferAttribute(copy(pos, 3), 3));
  if (src.attributes.normal) g.setAttribute('normal', new THREE.BufferAttribute(copy(src.attributes.normal, 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(copy(src.attributes.uv, 2), 2));
  const index = src.index ? Array.from(src.index.array as ArrayLike<number>) : [...Array(n).keys()];
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  if (!src.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Collects every mesh of a glTF scene in world space (existing skins are ignored: the character is re-rigged). */
export function collectParts(root: THREE.Object3D): SourcePart[] {
  root.updateMatrixWorld(true);
  const parts: SourcePart[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    const g = plainGeometry(m.geometry);
    g.applyMatrix4(m.matrixWorld);
    // a multi-material mesh keeps its groups; others become one group
    parts.push({ geometry: g, material: m.material });
  });
  return parts;
}

function mergeParts(parts: SourcePart[]): { geometry: THREE.BufferGeometry; materials: THREE.Material[] } {
  const materials: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const list = Array.isArray(p.material) ? p.material : [p.material];
    if (Array.isArray(p.material) && p.geometry.groups.length) {
      // re-split a multi-material geometry by group so every group maps to its own material slot
      for (const grp of p.geometry.groups) {
        const g = p.geometry.clone();
        const idx = p.geometry.index!.array.slice(grp.start, grp.start + grp.count);
        g.setIndex(Array.from(idx));
        g.clearGroups();
        geos.push(g);
        materials.push(list[grp.materialIndex ?? 0] || list[0]);
      }
    } else {
      p.geometry.clearGroups();
      geos.push(p.geometry);
      materials.push(list[0]);
    }
  }
  const geometry = mergeGeometries(geos, true);
  if (!geometry) throw new Error('These meshes could not be merged (different vertex formats).');
  return { geometry, materials };
}

function toMeshData(g: THREE.BufferGeometry): MeshData {
  return { positions: new Float32Array(g.attributes.position.array as ArrayLike<number>), indices: new Uint32Array(g.index!.array as ArrayLike<number>) };
}

/** Bones as THREE objects: identity rotations, positions relative to the parent joint. */
function buildBones(bones: BoneDef[]): THREE.Bone[] {
  const objs = bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  bones.forEach((b, i) => {
    const parentHead = b.parent >= 0 ? bones[b.parent].head : [0, 0, 0];
    objs[i].position.set(b.head[0] - parentHead[0], b.head[1] - parentHead[1], b.head[2] - parentHead[2]);
    if (b.parent >= 0) objs[b.parent].add(objs[i]);
  });
  return objs;
}

export function clipToThree(clip: ClipData, bones: BoneDef[]): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    if (t.rotations) tracks.push(new THREE.QuaternionKeyframeTrack(`${t.bone}.quaternion`, t.times, t.rotations));
    if (t.positions) {
      const b = bones.find((x) => x.name === t.bone);
      const parentHead = b && b.parent >= 0 ? bones[b.parent].head : [0, 0, 0];
      const rest = b ? [b.head[0] - parentHead[0], b.head[1] - parentHead[1], b.head[2] - parentHead[2]] : [0, 0, 0];
      const values = t.positions.map((v, i) => v + rest[i % 3]);
      tracks.push(new THREE.VectorKeyframeTrack(`${t.bone}.position`, t.times, values));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Builds the skinned character from a fitted skeleton (also used after the user moves joints). */
export function assemble(geometry: THREE.BufferGeometry, materials: THREE.Material[], skeleton: RigSkeleton, skin: SkinWeights, clips: ClipData[]) {
  const g = geometry.clone();
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.indices, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin.weights, 4));
  const mesh = new THREE.SkinnedMesh(g, materials.length === 1 ? materials[0] : materials);
  mesh.name = 'OmniRigCharacter';
  mesh.castShadow = true;
  const bones = buildBones(skeleton.bones);
  const rootBones = bones.filter((_, i) => skeleton.bones[i].parent < 0);
  const object = new THREE.Group();
  object.name = 'OmniRig';
  for (const r of rootBones) object.add(r);
  object.add(mesh);
  object.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const animations = clips.map((c) => clipToThree(c, skeleton.bones));
  return { object, mesh, animations };
}

interface Prepared { geometry: THREE.BufferGeometry; materials: THREE.Material[]; data: MeshData }

/** Main-thread part 1: every mesh of the scene merged into one indexed geometry (+ its materials). */
export function prepareSource(root: THREE.Object3D): Prepared {
  const { geometry, materials } = mergeParts(collectParts(root));
  return { geometry, materials, data: toMeshData(geometry) };
}

function rigJsonOf(report: AnalysisReport, skeleton: RigSkeleton, validation: RigValidation, clips: ClipData[], warnings: string[]): RigJson {
  return {
    version: 1,
    generator: 'OmniRig',
    category: report.category,
    height: report.height,
    frame: report.frame,
    bones: skeleton.bones.map((b) => ({ name: b.name, parent: b.parent >= 0 ? skeleton.bones[b.parent].name : null, head: b.head.map((v) => +v.toFixed(4)) })),
    confidence: skeleton.confidence,
    grade: validation.grade,
    score: validation.score,
    poses: validation.poses,
    clips: clips.map((c) => c.name),
    warnings,
    createdAt: new Date().toISOString(),
  };
}

/** Main-thread part 2: the pipeline's plain-data result → a skinned THREE character. */
function finish(prep: Prepared, core: CoreRigResult, thread: RigResult['thread']): RigResult {
  const { geometry, materials, data } = prep;
  // Bake the canonical frame (orientation, ground, size) into the geometry.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(core.positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh: MeshData = { positions: core.positions, indices: data.indices };
  const built = assemble(geometry, materials, core.skeleton, core.skin, core.clips);
  const rigJson = rigJsonOf(core.report, core.skeleton, core.validation, core.clips, [...core.report.warnings, ...core.skeleton.warnings]);
  // keep the canonical geometry for re-rigging after manual joint edits
  built.object.userData.omnirig = { geometry, materials, mesh };
  return {
    report: core.report, skeleton: core.skeleton, skin: core.skin, validation: core.validation,
    clips: core.clips, proceduralClips: core.clips, importedClips: [], proxyTriangles: core.proxyTriangles, thread,
    ...built, rigJson,
  };
}

/** Full automatic pipeline on the main thread (tests / fallback). `forceCategory` = the user's answer when unsure. */
export function rigCharacter(root: THREE.Object3D, opts: { forceCategory?: CharacterCategory; skeleton?: RigSkeleton } = {}): RigResult {
  const prep = prepareSource(root);
  return finish(prep, rigMeshData(prep.data, opts), 'main');
}

/** Full automatic pipeline with the heavy maths in the OmniRig Web Worker (falls back to the main thread). */
export async function rigCharacterAsync(root: THREE.Object3D, opts: { forceCategory?: CharacterCategory; skeleton?: RigSkeleton } = {}): Promise<RigResult> {
  const prep = prepareSource(root);
  const core = await runRigJob({ kind: 'rig', data: prep.data, opts });
  return finish(prep, core, lastRigJobThread);
}

/** Re-runs skinning + validation + clips with edited joints (manual fix) in the worker, reusing the analysed geometry. */
export async function rerigAsync(previous: RigResult, skeleton: RigSkeleton): Promise<RigResult> {
  const { geometry, materials, mesh } = previous.object.userData.omnirig as { geometry: THREE.BufferGeometry; materials: THREE.Material[]; mesh: MeshData };
  const stage = await runRigJob({ kind: 'skin', mesh, skeleton });
  const built = assemble(geometry, materials, skeleton, stage.skin, stage.clips);
  built.object.userData.omnirig = { geometry, materials, mesh };
  return {
    ...previous,
    skeleton,
    skin: stage.skin,
    validation: stage.validation,
    clips: stage.clips,
    proceduralClips: stage.clips,
    importedClips: [],
    proxyTriangles: stage.proxyTriangles,
    thread: lastRigJobThread,
    ...built,
    rigJson: rigJsonOf(previous.report, skeleton, stage.validation, stage.clips, [...previous.report.warnings, ...skeleton.warnings, 'Joints adjusted by hand.']),
  };
}

/** The same rig with retargeted library clips added (same-named procedural clips are replaced). */
export function withImportedClips(result: RigResult, imported: ClipData[]): RigResult {
  const clips = mergeClips(result.proceduralClips, imported);
  return {
    ...result,
    clips,
    importedClips: imported,
    animations: clips.map((c) => clipToThree(c, result.skeleton.bones)),
    rigJson: { ...result.rigJson, clips: clips.map((c) => c.name), importedClips: imported.map((c) => c.name) },
  };
}

// ================================================================================================ clip library import

/**
 * A loaded glTF with animations (e.g. a Mixamo character or clip exported as GLB) → plain clip data for `retargetLibrary`.
 * Rest pose = the skin's bind pose (node transforms when there is no skin). Clips are resampled at `fps`; root bones carry
 * their armature's rotation so every world rotation is in scene space.
 */
export function extractClipLibrary(scene: THREE.Object3D, animations: THREE.AnimationClip[], fps = 30): SourceClipLibrary {
  let skeleton: THREE.Skeleton | undefined;
  scene.traverse((o) => { if (!skeleton && (o as THREE.SkinnedMesh).isSkinnedMesh) skeleton = (o as THREE.SkinnedMesh).skeleton; });
  scene.updateMatrixWorld(true);
  if (skeleton) { skeleton.pose(); scene.updateMatrixWorld(true); }
  const animated = new Set<string>();
  for (const a of animations) for (const t of a.tracks) animated.add(THREE.PropertyBinding.parseTrackName(t.name).nodeName);
  const skinBones = new Set<THREE.Object3D>(skeleton?.bones || []);
  const nodes: THREE.Object3D[] = [];
  scene.traverse((o) => { if (skinBones.size ? skinBones.has(o) : ((o as THREE.Bone).isBone || animated.has(o.name))) nodes.push(o); });
  if (!nodes.length) throw new Error('No skeleton found in this file.');
  const index = new Map(nodes.map((n, i) => [n, i]));
  const parentOf = (n: THREE.Object3D) => { let p = n.parent; while (p && !index.has(p)) p = p.parent; return p ? index.get(p)! : -1; };
  const armature = (n: THREE.Object3D) => (n.parent ? n.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion());
  const q4 = (q: THREE.Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];
  const bones = nodes.map((n) => {
    const parent = parentOf(n);
    const rest = parent < 0 ? armature(n).multiply(n.quaternion) : n.quaternion.clone();
    const head = n.getWorldPosition(new THREE.Vector3());
    return { name: n.name, parent, restLocal: q4(rest), head: [head.x, head.y, head.z] as [number, number, number] };
  });
  const root = nodes.find((n) => parentOf(n) < 0)!;
  const clips: SourceClip[] = animations.map((a) => {
    const duration = Math.max(a.duration, 1 / fps);
    const count = Math.max(2, Math.round(duration * fps) + 1);
    const times = Array.from({ length: count }, (_, k) => +((k / (count - 1)) * duration).toFixed(4));
    const local: Record<string, number[]> = {};
    let rootPositions: number[] | undefined;
    for (const t of a.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(t.name);
      const node = nodes.find((n) => n.name === nodeName);
      if (!node) continue;
      // set by KeyframeTrack.setInterpolation at runtime (slerp for quaternions), not in the typings
      const interp = (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
      if (propertyName === 'quaternion') {
        const pre = parentOf(node) < 0 ? armature(node) : null;
        const out: number[] = [];
        for (const time of times) {
          const v = interp.evaluate(time);
          const q = new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize();
          out.push(...q4(pre ? pre.clone().multiply(q) : q));
        }
        local[node.name] = out;
      } else if (propertyName === 'position' && node === root) {
        rootPositions = [];
        const toWorld = node.parent ? node.parent.matrixWorld : new THREE.Matrix4();
        for (const time of times) {
          const v = interp.evaluate(time);
          const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(toWorld);
          rootPositions.push(p.x, p.y, p.z);
        }
      }
    }
    return { name: a.name, duration, times, local, rootPositions };
  });
  return { skeleton: { bones }, rootBone: root.name, clips };
}

/** Rigged character → binary glTF (with every clip). */
export async function exportRiggedGlb(result: RigResult): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  // Opaque textures as JPEG (the exporter would re-encode them as large PNGs), at most 2048 px.
  result.mesh.traverse((o) => {
    const mats = ([] as THREE.Material[]).concat((o as THREE.Mesh).material || []);
    for (const m of mats) {
      for (const key of ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'normalMap'] as const) {
        const tex = (m as any)[key] as THREE.Texture | undefined;
        if (tex && !tex.userData.mimeType && !(key === 'map' && (m.transparent || m.alphaTest > 0))) tex.userData.mimeType = key === 'normalMap' ? 'image/png' : 'image/jpeg';
      }
    }
  });
  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(result.object, { binary: true, animations: result.animations, onlyVisible: false, maxTextureSize: 2048 });
  return out as ArrayBuffer;
}
