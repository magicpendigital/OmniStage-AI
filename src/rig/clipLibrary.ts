/**
 * Phase 9 — OmniRig clip library import (pure): Mixamo-format clips (any skeleton with Mixamo-style bone names) →
 * the fitted rig with `retargetClip`. Bone names are matched loosely ("mixamorig:LeftArm", "mixamorig1_LeftArm",
 * "Armature|LeftArm" → LeftArm), clip names are canonicalised to the ones the AI already uses (Walking, Running …) so an
 * imported walk replaces the procedural one, and hips motion is scaled to the target and kept in place.
 */
import type { Vec3 } from './analyze';
import type { RigSkeleton } from './skeleton';
import { ClipData, retargetClip, SourceSkeleton } from './animate';

export interface SourceClip {
  name: string;
  duration: number;
  times: number[];
  /** Local rotations (xyzw per key) per source bone; root bones include the armature rotation. */
  local: Record<string, number[]>;
  /** Root (hips) joint position in scene space per key (xyz), when the clip moves the hips. */
  rootPositions?: number[];
}

export interface SourceClipLibrary {
  skeleton: SourceSkeleton;
  /** The source's hips / root bone. */
  rootBone: string;
  clips: SourceClip[];
}

export interface ImportedClips {
  clips: ClipData[];
  /** Target bones that received a track / all target bones. */
  matched: number;
  total: number;
  unmatchedTarget: string[];
}

/** "mixamorig:LeftArm" / "mixamorig1_LeftArm" / "Armature|LeftArm" / "Character1_LeftArm" → "leftarm". */
export function boneKey(name: string): string {
  let n = name.split(/[:|/]/).pop() || name;
  n = n.replace(/^mixamorig\d*_?/i, '');
  return n.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Source bone name → target bone name (by `boneKey`), or null when the target has no such bone. */
export function boneMapper(targetNames: string[]): (source: string) => string | null {
  const byKey = new Map(targetNames.map((t) => [boneKey(t), t]));
  return (s) => byKey.get(boneKey(s)) ?? null;
}

/** Names the AI and `matchClipName` know; an imported clip that means one of them takes that name. */
const CANONICAL: Array<[string, RegExp]> = [
  ['Idle', /idle|breath|stand/i],
  ['Running', /run|sprint|jog/i],
  ['Walking', /walk/i],
  ['Wave', /wav|hello|greet/i],
  ['Jump', /jump|hop/i],
  ['Sitting', /sit/i],
  ['Dance', /danc|samba|hip ?hop|salsa/i],
  ['Yes', /^yes$|nod/i],
  ['No', /^no$|shak.*head|head.*shak/i],
];
const GENERIC = /mixamo\.com|^take\s*\d*$|^animation\s*\d*$|^armature|layer\s*0|^clip\s*\d*$|^action\s*\d*$|^default$/i;

/** A clip's display name: generic exporter names ("mixamo.com", "Armature|mixamo.com|Layer0") fall back to the file name. */
export function importedClipName(raw: string, fileName: string, index = 0, count = 1): string {
  const stem = fileName.replace(/\.[^.]+$/, '').split('@').pop()!.replace(/[_-]+/g, ' ').trim() || 'Clip';
  let name = raw && !GENERIC.test(raw.trim()) ? raw.split('|').filter((p) => !GENERIC.test(p)).pop() || stem : stem;
  if (name === stem && count > 1 && GENERIC.test(raw || '')) name = `${stem} ${index + 1}`;
  const canon = CANONICAL.find(([, re]) => re.test(name));
  return canon ? canon[0] : name.replace(/\s+/g, ' ').slice(0, 40);
}

/** Hips motion → target offsets: scaled by hip height, horizontal travel removed (clips play in place; `moveTo` moves actors). */
export function retargetRootMotion(rootPositions: number[], sourceRest: Vec3, targetHipsY: number): number[] {
  const n = rootPositions.length / 3;
  if (!n) return [];
  const s = targetHipsY / Math.max(1e-6, sourceRest[1]);
  const out: number[] = [];
  const first = [rootPositions[0], rootPositions[2]], last = [rootPositions[(n - 1) * 3], rootPositions[(n - 1) * 3 + 2]];
  for (let k = 0; k < n; k++) {
    const u = n > 1 ? k / (n - 1) : 0;
    // remove the straight-line travel from the first to the last key, keep the sway around it
    const dx = rootPositions[k * 3] - (first[0] + (last[0] - first[0]) * u);
    const dz = rootPositions[k * 3 + 2] - (first[1] + (last[1] - first[1]) * u);
    out.push(dx * s, (rootPositions[k * 3 + 1] - sourceRest[1]) * s, dz * s);
  }
  return out;
}

/** Retargets every clip of the library to the fitted rig. Throws when too few bones match (wrong skeleton). */
export function retargetLibrary(lib: SourceClipLibrary, target: RigSkeleton, fileName: string): ImportedClips {
  const map = boneMapper(target.bones.map((b) => b.name));
  const hit = new Set(lib.skeleton.bones.map((b) => map(b.name)).filter((x): x is string => !!x));
  // end bones (HeadTop_End, Toe_End …) carry no motion; count the ones that move the mesh
  const moving = target.bones.filter((b, i) => target.bones.some((c) => c.parent === i) || b.parent < 0);
  const matched = moving.filter((b) => hit.has(b.name)).length;
  if (!lib.clips.length) throw new Error(`${fileName} has no animations.`);
  if (matched < Math.max(3, moving.length * 0.5)) {
    throw new Error(`Only ${matched} of ${moving.length} bones match by name — ${fileName} does not look like a ${target.category === 'humanoid' ? 'Mixamo-format humanoid' : target.category} clip file.`);
  }
  const targetRoot = map(lib.rootBone);
  const rootDef = target.bones.find((b) => b.name === targetRoot);
  const srcRoot = lib.skeleton.bones.find((b) => b.name === lib.rootBone);
  const used = new Set<string>();
  const clips = lib.clips.map((c, i) => {
    const out = retargetClip(c, lib.skeleton, target, map, { matchRestDirections: true });
    let name = importedClipName(c.name, fileName, i, lib.clips.length);
    for (let k = 2; used.has(name); k++) name = `${importedClipName(c.name, fileName, i, lib.clips.length)} ${k}`;
    used.add(name);
    out.name = name;
    out.loop = !/jump|death|die|fall|hit|attack|punch|kick|throw|stand ?up|sit ?down/i.test(name + ' ' + c.name);
    if (c.rootPositions && rootDef && srcRoot?.head) {
      out.tracks.push({ bone: rootDef.name, times: c.times, positions: retargetRootMotion(c.rootPositions, srcRoot.head, rootDef.head[1]) });
    }
    return out;
  });
  return { clips, matched, total: moving.length, unmatchedTarget: moving.filter((b) => !hit.has(b.name)).map((b) => b.name) };
}

/** Imported clips win over procedural ones with the same name; the rest are appended. */
export function mergeClips(procedural: ClipData[], imported: ClipData[]): ClipData[] {
  const names = new Set(imported.map((c) => c.name));
  return [...procedural.filter((c) => !names.has(c.name)), ...imported];
}
