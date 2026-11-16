/**
 * Rig generators (Meshy / Tripo rig + animation): the providers name their clips after their own presets
 * ("Casual_Walk", "preset:idle", "Armature|mixamo.com|Layer0" …). OmniRig characters, the AI director and
 * `matchClipName` expect Idle / Walking / Running …, so the GLB's JSON chunk is rewritten with those names before the
 * file is saved. Pure Buffer code: the binary chunk is copied untouched.
 */
import { RIG_CLIP_NAMES, type RigClipName } from '../../src/extensions/types';

const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const CANONICAL: Array<[RigClipName, RegExp]> = [
  ['Idle', /idle|breath|stand/i],
  ['Running', /run|sprint|jog/i],
  ['Walking', /walk/i],
  ['Jump', /jump|hop/i],
  ['Wave', /wav|hello|greet/i],
  ['Dance', /danc/i],
];

/** Canonical clip name for a provider clip name, or null when it is not one of RIG_CLIP_NAMES. */
export function canonicalClipName(raw: string): RigClipName | null {
  const hit = CANONICAL.find(([, re]) => re.test(raw));
  return hit ? hit[0] : null;
}

export interface GlbJson {
  json: any;
  bin: Buffer | null;
}

/** Splits a GLB into its JSON and BIN chunks; throws on anything that is not a well-formed GLB 2.0 header. */
export function readGlb(data: Buffer): GlbJson {
  if (data.length < 20 || data.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error('Not a GLB file');
  const length = Math.min(data.readUInt32LE(8), data.length);
  const jsonLen = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== JSON_CHUNK || 20 + jsonLen > length) throw new Error('GLB has no JSON chunk');
  const json = JSON.parse(data.subarray(20, 20 + jsonLen).toString('utf8').replace(/[\s\u0000]+$/, ''));
  let bin: Buffer | null = null;
  const binAt = 20 + jsonLen;
  if (binAt + 8 <= length) {
    const binLen = data.readUInt32LE(binAt);
    bin = data.subarray(binAt + 8, Math.min(length, binAt + 8 + binLen));
  }
  return { json, bin };
}

export function writeGlb({ json, bin }: GlbJson): Buffer {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const parts: Buffer[] = [];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(text.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  parts.push(jsonHeader, text);
  if (bin) {
    const binPad = (4 - (bin.length % 4)) % 4;
    const body = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(body.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
    parts.push(binHeader, body);
  }
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + parts.reduce((n, p) => n + p.length, 0), 8);
  return Buffer.concat([header, ...parts]);
}

/**
 * Renames the GLB's animations to OmniRig names. A clip whose own name means Idle / Walking … takes that name;
 * otherwise, when the file has exactly one clip per requested name, clips take the requested names in order (the
 * providers return one clip per requested action, in request order). Duplicates get a number. Returns the new file
 * and the final clip names; a file without animations is returned unchanged.
 */
export function renameGlbClips(data: Buffer, wanted: readonly string[]): { data: Buffer; clips: string[] } {
  const glb = readGlb(data);
  const anims: any[] = Array.isArray(glb.json?.animations) ? glb.json.animations : [];
  if (!anims.length) return { data, clips: [] };
  const byOrder = anims.length === wanted.length;
  const used = new Map<string, number>();
  const clips = anims.map((a, i) => {
    const own = canonicalClipName(String(a?.name || ''));
    let name: string = own || (byOrder ? wanted[i] : '') || String(a?.name || '').split('|').pop()!.replace(/^preset:/, '').slice(0, 40) || `Clip ${i + 1}`;
    const n = (used.get(name) || 0) + 1;
    used.set(name, n);
    if (n > 1) name = `${name} ${n}`;
    if (a && typeof a === 'object') a.name = name;
    return name;
  });
  return { data: writeGlb(glb), clips };
}

export const DEFAULT_RIG_CLIPS: RigClipName[] = ['Idle', 'Walking', 'Running'];

/** The clip list a rig generator asks for (manifest value re-checked; unknown names dropped). */
export function rigClips(clips: unknown): RigClipName[] {
  const list = Array.isArray(clips) ? clips.filter((c): c is RigClipName => (RIG_CLIP_NAMES as readonly string[]).includes(c)) : [];
  return list.length ? [...new Set(list)].slice(0, 5) : DEFAULT_RIG_CLIPS;
}
