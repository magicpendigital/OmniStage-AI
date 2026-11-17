/**
 * Dependency-free GLB animation merge: copies the first animation of each "clip" GLB (Meshy's walking / running
 * GLBs, which carry the same skeleton as the rigged character) into the rigged character GLB, so one asset holds
 * the mesh, the skeleton and the clips.
 *
 * Joints are matched BY NODE NAME (an index match is only used when neither side has names). A clip is skipped,
 * never half-merged, when fewer than 80% of its channels land on a base node. The result is re-parsed and every
 * accessor range is bounds-checked before it is returned; callers keep the original GLB if this throws.
 */

export interface Glb {
  json: any;
  bin: Buffer;
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const ANIMATED_PATHS = new Set(['translation', 'rotation', 'scale', 'weights']);

export function parseGlb(buf: Buffer): Glb {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB file');
  if (buf.readUInt32LE(4) !== 2) throw new Error('unsupported GLB version');
  const total = Math.min(buf.readUInt32LE(8), buf.length);
  let json: any;
  let bin: Buffer | undefined;
  let off = 12;
  while (off + 8 <= total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const end = off + 8 + len;
    if (end > total) throw new Error('truncated GLB chunk');
    const data = buf.subarray(off + 8, end);
    if (type === JSON_CHUNK && json === undefined) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK && bin === undefined) bin = data;
    off = end;
  }
  if (!json || typeof json !== 'object') throw new Error('GLB has no JSON chunk');
  return { json, bin: bin ?? Buffer.alloc(0) };
}

const pad4 = (n: number) => (n + 3) & ~3;

export function buildGlb(json: any, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  if (bin.length) {
    const o = 20 + jsonLen;
    out.writeUInt32LE(binLen, o);
    out.writeUInt32LE(BIN_CHUNK, o + 4);
    bin.copy(out, o + 8);
  }
  return out;
}

export interface ClipSource {
  /** Clip name written into the merged file ("walking", "running"). */
  name: string;
  glb: Buffer;
}

export interface MergeResult {
  glb: Buffer;
  clips: string[];
  skipped: Array<{ name: string; reason: string }>;
}

function nodeNameIndex(json: any): Map<string, number | null> {
  const map = new Map<string, number | null>();
  (json.nodes || []).forEach((n: any, i: number) => {
    if (typeof n?.name !== 'string' || !n.name) return;
    map.set(n.name, map.has(n.name) ? null : i); // null = ambiguous name
  });
  return map;
}

/** Throws unless every bufferView / accessor of the GLB stays inside its binary chunk. */
export function assertGlbConsistent(glb: Buffer): void {
  const { json, bin } = parseGlb(glb);
  const views: any[] = json.bufferViews || [];
  views.forEach((v, i) => {
    const start = v.byteOffset || 0;
    if (v.buffer !== 0 || start < 0 || start + v.byteLength > bin.length) throw new Error(`bufferView ${i} is out of range`);
  });
  (json.accessors || []).forEach((a: any, i: number) => {
    if (a.bufferView === undefined) return;
    if (!views[a.bufferView]) throw new Error(`accessor ${i} points at a missing bufferView`);
  });
  for (const anim of json.animations || []) {
    for (const s of anim.samplers || []) {
      if (!json.accessors?.[s.input] || !json.accessors?.[s.output]) throw new Error('animation sampler points at a missing accessor');
    }
    for (const c of anim.channels || []) {
      if (!anim.samplers?.[c.sampler] || !json.nodes?.[c.target?.node]) throw new Error('animation channel points at a missing sampler or node');
    }
  }
}

export function mergeGlbAnimations(baseBuf: Buffer, sources: ClipSource[]): MergeResult {
  const base = parseGlb(baseBuf);
  if (base.json.buffers?.[0]?.uri) throw new Error('the rigged GLB keeps its data in an external buffer');
  if (!Array.isArray(base.json.nodes) || !base.json.nodes.length) throw new Error('the rigged GLB has no nodes');
  const byName = nodeNameIndex(base.json);
  const baseHasNames = byName.size > 0;
  const chunks: Buffer[] = [base.bin];
  let binLen = base.bin.length;
  const append = (data: Buffer): number => {
    const start = pad4(binLen);
    if (start > binLen) chunks.push(Buffer.alloc(start - binLen));
    chunks.push(data);
    binLen = start + data.length;
    return start;
  };
  base.json.bufferViews = base.json.bufferViews || [];
  base.json.accessors = base.json.accessors || [];
  base.json.animations = base.json.animations || [];

  const clips: string[] = [];
  const skipped: MergeResult['skipped'] = [];

  for (const src of sources) {
    try {
      const donor = parseGlb(src.glb);
      const anim = (donor.json.animations || []).find((a: any) => Array.isArray(a?.channels) && a.channels.length && Array.isArray(a.samplers));
      if (!anim) throw new Error('no animation in that file');
      const donorHasNames = (donor.json.nodes || []).some((n: any) => typeof n?.name === 'string' && n.name);
      const mapNode = (d: number): number | undefined => {
        const dn = donor.json.nodes?.[d];
        if (!dn) return undefined;
        if (baseHasNames && donorHasNames) {
          const hit = typeof dn.name === 'string' ? byName.get(dn.name) : undefined;
          return typeof hit === 'number' ? hit : undefined;
        }
        if (!baseHasNames && !donorHasNames && (donor.json.nodes || []).length === base.json.nodes.length) return d;
        return undefined;
      };
      const channels = anim.channels.filter((c: any) => c?.target && ANIMATED_PATHS.has(c.target.path) && !c.target.extensions);
      const mapped = channels.map((c: any) => ({ c, node: mapNode(c.target.node) })).filter((m: { c: any; node: number | undefined }) => m.node !== undefined);
      if (!mapped.length || mapped.length / anim.channels.length < 0.8) throw new Error(`only ${mapped.length} of ${anim.channels.length} channels match the rigged skeleton`);

      const viewCache = new Map<number, number>();
      const accCache = new Map<number, number>();
      const copyAccessor = (ai: number): number => {
        const cached = accCache.get(ai);
        if (cached !== undefined) return cached;
        const acc = donor.json.accessors?.[ai];
        if (!acc || acc.bufferView === undefined || acc.sparse) throw new Error('unsupported animation accessor');
        let bv = viewCache.get(acc.bufferView);
        if (bv === undefined) {
          const view = donor.json.bufferViews?.[acc.bufferView];
          const start = view?.byteOffset || 0;
          if (!view || view.buffer !== 0 || start + view.byteLength > donor.bin.length) throw new Error('animation data is out of range');
          const offset = append(donor.bin.subarray(start, start + view.byteLength));
          const copy: any = { buffer: 0, byteOffset: offset, byteLength: view.byteLength };
          if (view.byteStride) copy.byteStride = view.byteStride;
          base.json.bufferViews.push(copy);
          bv = base.json.bufferViews.length - 1;
          viewCache.set(acc.bufferView, bv);
        }
        const { extensions: _e, extras: _x, ...rest } = acc;
        base.json.accessors.push({ ...rest, bufferView: bv });
        const idx = base.json.accessors.length - 1;
        accCache.set(ai, idx);
        return idx;
      };
      const samplerMap = new Map<number, number>();
      const samplers: any[] = [];
      const outChannels: any[] = [];
      for (const { c, node } of mapped as Array<{ c: any; node: number }>) {
        let s = samplerMap.get(c.sampler);
        if (s === undefined) {
          const ds = anim.samplers[c.sampler];
          if (!ds) throw new Error('channel points at a missing sampler');
          samplers.push({ input: copyAccessor(ds.input), output: copyAccessor(ds.output), interpolation: ds.interpolation || 'LINEAR' });
          s = samplers.length - 1;
          samplerMap.set(c.sampler, s);
        }
        outChannels.push({ sampler: s, target: { node, path: c.target.path } });
      }
      base.json.animations.push({ name: src.name, samplers, channels: outChannels });
      clips.push(src.name);
    } catch (e: any) {
      skipped.push({ name: src.name, reason: String(e?.message || e).slice(0, 160) });
    }
  }

  if (!clips.length) return { glb: baseBuf, clips, skipped };
  const bin = Buffer.concat(chunks);
  base.json.buffers = base.json.buffers?.length ? base.json.buffers : [{ byteLength: bin.length }];
  base.json.buffers[0] = { ...base.json.buffers[0], byteLength: bin.length };
  const glb = buildGlb(base.json, bin);
  assertGlbConsistent(glb);
  return { glb, clips, skipped };
}

/** Names of the animations a GLB carries (for asset metadata). */
export function listClipNames(glb: Buffer): string[] {
  try {
    return (parseGlb(glb).json.animations || []).map((a: any, i: number) => (typeof a?.name === 'string' && a.name ? a.name : `clip${i + 1}`));
  } catch {
    return [];
  }
}
