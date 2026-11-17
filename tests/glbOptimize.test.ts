import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlbBytes, optimizeGlbTextures, parseGlbBytes, type TextureCodec } from '../src/utils/glbOptimize';
import { assertGlbConsistent } from '../server/generate/glbMerge';

const fill = (n: number, v: number) => new Uint8Array(n).fill(v);

/** A GLB shaped like a Meshy character: an index/vertex buffer, then three big embedded images, then an animation buffer. */
function fixture() {
  const mesh = Uint8Array.from({ length: 36 }, (_, i) => i + 1); // bufferView 0: 36 bytes
  const baseColor = fill(10_001, 0xaa); // bufferView 1 (odd length: forces padding)
  const normal = fill(6_000, 0xbb); // bufferView 2
  const rough = fill(900, 0xcc); // bufferView 3 (already small)
  const anim = Uint8Array.from({ length: 24 }, (_, i) => 100 + i); // bufferView 4
  const parts = [mesh, baseColor, normal, rough, anim];
  const views: any[] = [];
  let off = 0;
  const bin: number[] = [];
  for (const p of parts) {
    while (off % 4) { bin.push(0); off++; }
    views.push({ buffer: 0, byteOffset: off, byteLength: p.length });
    bin.push(...p);
    off += p.length;
  }
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [{ bufferView: 0, componentType: 5123, count: 18, type: 'SCALAR' }, { bufferView: 4, componentType: 5126, count: 6, type: 'SCALAR' }],
    images: [
      { name: 'base', bufferView: 1, mimeType: 'image/jpeg' },
      { name: 'normal', bufferView: 2, mimeType: 'image/jpeg' },
      { name: 'rough', bufferView: 3, mimeType: 'image/jpeg' },
    ],
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
    nodes: [{ name: 'root' }],
    scenes: [{ nodes: [0] }],
  };
  return { glb: buildGlbBytes(json, Uint8Array.from(bin)), mesh, anim };
}

/** Pretend codec: 4096 -> maxSize, output is 1/16 of the input; images flagged "small" stay. */
const fakeCodec = (calls: string[] = []): TextureCodec => ({
  async shrink(bytes, mime, { maxSize }) {
    calls.push(`${bytes.length}:${maxSize}`);
    if (bytes.length < 1000) return null;
    return { bytes: fill(Math.ceil(bytes.length / 16), 0x11), mime: 'image/jpeg', width: maxSize, height: maxSize, originalWidth: 4096, originalHeight: 4096 };
  },
});

test('textures shrink, everything else is copied byte for byte, and the GLB stays valid', async () => {
  const { glb, mesh, anim } = fixture();
  const rep = await optimizeGlbTextures(glb, { codec: fakeCodec(), maxSize: 1024 });
  assert.equal(rep.changed, true);
  assert.ok(rep.after < rep.before / 2, `${rep.before} -> ${rep.after}`);
  assert.deepEqual(rep.images.map((i) => [i.name, !!i.to, i.kept]), [['base', true, undefined], ['normal', true, undefined], ['rough', false, 'already within 1024px']]);
  assert.deepEqual(rep.images[0].to, { width: 1024, height: 1024 });

  const out = parseGlbBytes(rep.glb);
  assertGlbConsistent(Buffer.from(rep.glb));
  const v = out.json.bufferViews;
  assert.ok(v.every((x: any) => x.byteOffset % 4 === 0), 'every bufferView is 4-byte aligned');
  assert.deepEqual(out.bin.subarray(v[0].byteOffset, v[0].byteOffset + v[0].byteLength), mesh);
  assert.deepEqual(out.bin.subarray(v[4].byteOffset, v[4].byteOffset + v[4].byteLength), anim);
  assert.equal(v[1].byteLength, Math.ceil(10_001 / 16));
  assert.equal(out.json.buffers[0].byteLength, out.bin.length);
  assert.deepEqual(out.json.accessors, fixture() && parseGlbBytes(glb).json.accessors, 'accessors untouched');
  assert.equal(out.json.images[0].mimeType, 'image/jpeg');
});

test('nothing to shrink returns the very same bytes', async () => {
  const { glb } = fixture();
  const rep = await optimizeGlbTextures(glb, { codec: { shrink: async () => null } });
  assert.equal(rep.changed, false);
  assert.equal(rep.glb, glb);
});

test('a re-encode that is not smaller is not used, and a failing decode keeps the original', async () => {
  const { glb } = fixture();
  const bigger: TextureCodec = { shrink: async (b) => ({ bytes: fill(b.length + 10, 1), mime: 'image/jpeg', width: 8, height: 8, originalWidth: 16, originalHeight: 16 }) };
  const r1 = await optimizeGlbTextures(glb, { codec: bigger });
  assert.equal(r1.changed, false);
  assert.ok(r1.images.every((i) => /not smaller/.test(i.kept || '')));

  const broken: TextureCodec = { shrink: async () => { throw new Error('bad jpeg'); } };
  const r2 = await optimizeGlbTextures(glb, { codec: broken });
  assert.equal(r2.changed, false);
  assert.ok(r2.images.every((i) => /could not decode/.test(i.kept || '')));
});

test('size and quality are clamped, and the requested size reaches the codec', async () => {
  const { glb } = fixture();
  const calls: string[] = [];
  await optimizeGlbTextures(glb, { codec: fakeCodec(calls), maxSize: 100_000 });
  assert.ok(calls.every((c) => c.endsWith(':4096')));
  const low: string[] = [];
  await optimizeGlbTextures(glb, { codec: fakeCodec(low), maxSize: 1 });
  assert.ok(low.every((c) => c.endsWith(':64')));
});

test('only embedded jpeg/png images are touched; external uris and other types are kept', async () => {
  const { glb } = fixture();
  const p = parseGlbBytes(glb);
  p.json.images[0] = { name: 'ext', uri: 'a.png' };
  p.json.images[1].mimeType = 'image/webp';
  const calls: string[] = [];
  const rep = await optimizeGlbTextures(buildGlbBytes(p.json, p.bin), { codec: fakeCodec(calls) });
  assert.equal(rep.changed, false);
  assert.deepEqual(rep.images.map((i) => i.kept), ['not embedded', 'unsupported type image/webp', 'already within 1024px']);
  assert.equal(calls.length, 1);
});

test('multi-buffer or non-GLB input is left alone or rejected', async () => {
  const { glb } = fixture();
  const p = parseGlbBytes(glb);
  p.json.bufferViews[1].buffer = 1;
  const rep = await optimizeGlbTextures(buildGlbBytes(p.json, p.bin), { codec: fakeCodec() });
  assert.equal(rep.changed, false);
  await assert.rejects(optimizeGlbTextures(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), { codec: fakeCodec() }), /not a GLB/);
});
