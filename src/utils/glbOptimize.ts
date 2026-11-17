/**
 * GLB texture optimizer (pure bytes in, bytes out; the image codec is injected).
 *
 * Generated characters ship 4K textures (a Meshy rigged fox: 25 MB, 22.5 MB of it JPEG). A playable ad has a size budget and a phone
 * has little GPU memory, so the textures are shrunk to a maximum edge (default 1024) and the file is rebuilt. Geometry, skins and
 * animations are copied byte for byte; only image bufferViews change, and every bufferView is re-packed 4-byte aligned.
 *
 * The browser codec lives in `glbTextureCodec.ts` (createImageBitmap + OffscreenCanvas), so no image library is needed.
 */

export interface ShrunkTexture {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export interface TextureCodec {
  /** Re-encode the image so its longest edge is at most `maxSize`. Return null to keep the original (already small, undecodable). */
  shrink(bytes: Uint8Array, mime: string, opts: { maxSize: number; quality: number }): Promise<ShrunkTexture | null>;
}

export interface ImageReport {
  index: number;
  name?: string;
  mime: string;
  bytesBefore: number;
  bytesAfter: number;
  from?: { width: number; height: number };
  to?: { width: number; height: number };
  /** Why the original was kept (when it was). */
  kept?: string;
}

export interface OptimizeReport {
  glb: Uint8Array;
  before: number;
  after: number;
  changed: boolean;
  images: ImageReport[];
}

export interface OptimizeOptions {
  codec: TextureCodec;
  /** Longest texture edge in pixels. Default 1024. */
  maxSize?: number;
  /** JPEG quality 0-1. Default 0.85. */
  quality?: number;
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const pad4 = (n: number) => (n + 3) & ~3;

interface ParsedGlb {
  json: any;
  bin: Uint8Array;
}

export function parseGlbBytes(buf: Uint8Array): ParsedGlb {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('unsupported GLB version');
  const total = Math.min(dv.getUint32(8, true), buf.length);
  let json: any;
  let bin: Uint8Array | undefined;
  let off = 12;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const end = off + 8 + len;
    if (end > total) throw new Error('truncated GLB chunk');
    const data = buf.subarray(off + 8, end);
    if (type === JSON_CHUNK && json === undefined) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === BIN_CHUNK && bin === undefined) bin = data;
    off = end;
  }
  if (!json || typeof json !== 'object') throw new Error('GLB has no JSON chunk');
  return { json, bin: bin ?? new Uint8Array(0) };
}

export function buildGlbBytes(json: any, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  if (bin.length) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, BIN_CHUNK, true);
    out.set(bin, o + 8);
  }
  return out;
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);

/** Shrinks every embedded JPEG/PNG whose longest edge exceeds `maxSize`; returns the original bytes when nothing got smaller. */
export async function optimizeGlbTextures(input: Uint8Array, opts: OptimizeOptions): Promise<OptimizeReport> {
  const maxSize = Math.max(64, Math.min(4096, Math.round(opts.maxSize ?? 1024)));
  const quality = Math.max(0.3, Math.min(0.98, opts.quality ?? 0.85));
  const { json, bin } = parseGlbBytes(input);
  const views: any[] = json.bufferViews || [];
  const images: any[] = json.images || [];
  const unchanged = (reports: ImageReport[]): OptimizeReport => ({ glb: input, before: input.length, after: input.length, changed: false, images: reports });

  // Only single-buffer GLBs (the GLB BIN chunk) are rewritten; anything else is left alone.
  if (views.some((v) => (v.buffer ?? 0) !== 0) || (json.buffers || []).length > 1) return unchanged([]);

  const reports: ImageReport[] = [];
  const replaced = new Map<number, Uint8Array>();
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const view = im.bufferView !== undefined ? views[im.bufferView] : undefined;
    const base: ImageReport = { index: i, name: im.name, mime: im.mimeType || '', bytesBefore: view?.byteLength ?? 0, bytesAfter: view?.byteLength ?? 0 };
    if (!view || im.uri) { reports.push({ ...base, kept: 'not embedded' }); continue; }
    if (!IMAGE_MIMES.has(im.mimeType)) { reports.push({ ...base, kept: `unsupported type ${im.mimeType || 'unknown'}` }); continue; }
    if (replaced.has(im.bufferView)) { reports.push({ ...base, kept: 'shares data with another image' }); continue; }
    const start = view.byteOffset || 0;
    if (start + view.byteLength > bin.length) throw new Error(`image ${i} is outside the binary chunk`);
    const src = bin.subarray(start, start + view.byteLength);
    let out: ShrunkTexture | null = null;
    try {
      out = await opts.codec.shrink(src, im.mimeType, { maxSize, quality });
    } catch (e: any) {
      reports.push({ ...base, kept: `could not decode (${String(e?.message || e).slice(0, 60)})` });
      continue;
    }
    if (!out) { reports.push({ ...base, kept: `already within ${maxSize}px` }); continue; }
    if (out.bytes.length >= src.length) { reports.push({ ...base, from: { width: out.originalWidth, height: out.originalHeight }, kept: 'smaller image was not smaller in bytes' }); continue; }
    replaced.set(im.bufferView, out.bytes);
    im.mimeType = out.mime;
    reports.push({
      ...base,
      mime: out.mime,
      bytesAfter: out.bytes.length,
      from: { width: out.originalWidth, height: out.originalHeight },
      to: { width: out.width, height: out.height },
    });
  }
  if (!replaced.size) return unchanged(reports);

  // Re-pack every bufferView in index order, 4-byte aligned.
  const parts: Uint8Array[] = [];
  let offset = 0;
  views.forEach((v, i) => {
    const start = v.byteOffset || 0;
    const data = replaced.get(i) ?? bin.subarray(start, start + v.byteLength);
    if (start + v.byteLength > bin.length && !replaced.has(i)) throw new Error(`bufferView ${i} is outside the binary chunk`);
    const aligned = pad4(offset);
    if (aligned > offset) { parts.push(new Uint8Array(aligned - offset)); offset = aligned; }
    v.byteOffset = offset;
    v.byteLength = data.length;
    parts.push(data);
    offset += data.length;
  });
  const total = pad4(offset);
  const newBin = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { newBin.set(p, at); at += p.length; }
  if (json.buffers?.[0]) json.buffers[0].byteLength = total;

  const glb = buildGlbBytes(json, newBin);
  return { glb, before: input.length, after: glb.length, changed: true, images: reports };
}
