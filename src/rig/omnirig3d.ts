/**
 * Phase 9 — OmniRig in the browser: glTF scene → analysis → joints → skin → validation → clips → a rigged THREE.SkinnedMesh
 * (materials kept) → GLB. The maths lives in the pure modules next to this file; this one only converts to / from Three.js.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { analyzeMesh, AnalysisReport, canonicalPositions, CharacterCategory, MeshData } from './analyze';
import { BoneDef, fitSkeleton, RigSkeleton } from './skeleton';
import { computeSkinWeights, SkinWeights, validateRig, RigValidation } from './skin';
import { ClipData, proceduralClips } from './animate';

export interface RigResult {
  report: AnalysisReport;
  skeleton: RigSkeleton;
  skin: SkinWeights;
  validation: RigValidation;
  clips: ClipData[];
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

/** Full automatic pipeline. `forceCategory` = the user's answer when the classification was unsure. */
export function rigCharacter(root: THREE.Object3D, opts: { forceCategory?: CharacterCategory; skeleton?: RigSkeleton } = {}): RigResult {
  const { geometry, materials } = mergeParts(collectParts(root));
  const data = toMeshData(geometry);
  const { report, points } = analyzeMesh(data, { forceCategory: opts.forceCategory });
  // Bake the canonical frame (orientation, ground, size) into the geometry.
  const canon = canonicalPositions(data, report.frame);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(canon, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh: MeshData = { positions: canon, indices: data.indices };
  const skeleton = opts.skeleton || fitSkeleton(report.category, points);
  const skin = computeSkinWeights(mesh, skeleton);
  const validation = validateRig(mesh, skeleton, skin);
  const clips = proceduralClips(skeleton);
  const built = assemble(geometry, materials, skeleton, skin, clips);
  const rigJson: RigJson = {
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
    warnings: [...report.warnings, ...skeleton.warnings],
    createdAt: new Date().toISOString(),
  };
  // keep the canonical geometry for re-rigging after manual joint edits
  built.object.userData.omnirig = { geometry, materials, mesh };
  return { report, skeleton, skin, validation, clips, ...built, rigJson };
}

/** Re-runs skinning + validation + clips with edited joints (manual fix), reusing the analysed geometry. */
export function rerig(previous: RigResult, skeleton: RigSkeleton): RigResult {
  const { geometry, materials, mesh } = previous.object.userData.omnirig as { geometry: THREE.BufferGeometry; materials: THREE.Material[]; mesh: MeshData };
  const skin = computeSkinWeights(mesh, skeleton);
  const validation = validateRig(mesh, skeleton, skin);
  const clips = proceduralClips(skeleton);
  const built = assemble(geometry, materials, skeleton, skin, clips);
  built.object.userData.omnirig = { geometry, materials, mesh };
  return {
    ...previous,
    skeleton,
    skin,
    validation,
    clips,
    ...built,
    rigJson: {
      ...previous.rigJson,
      bones: skeleton.bones.map((b) => ({ name: b.name, parent: b.parent >= 0 ? skeleton.bones[b.parent].name : null, head: b.head.map((v) => +v.toFixed(4)) })),
      grade: validation.grade,
      score: validation.score,
      poses: validation.poses,
      warnings: [...previous.report.warnings, ...skeleton.warnings, 'Joints adjusted by hand.'],
      createdAt: new Date().toISOString(),
    },
  };
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
