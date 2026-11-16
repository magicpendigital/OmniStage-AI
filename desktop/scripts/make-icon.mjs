// Draws the app icon (desktop/build/icon.png, 1024x1024) with no dependencies: a dark rounded tile with the
// studio's cyan accent as an "O" ring over a stage line. electron-builder converts it to .ico / .icns.
// Re-run with `npm run icon --prefix desktop` after changing the drawing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 1024;
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;

/** Signed distance to a rounded square centred in the canvas (negative inside). */
function roundedSquare(x, y, half, r) {
  const qx = Math.abs(x) - half + r;
  const qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  raw[py * (SIZE * 4 + 1)] = 0; // filter: none
  for (let px = 0; px < SIZE; px++) {
    const x = px + 0.5 - SIZE / 2;
    const y = py + 0.5 - SIZE / 2;
    const tile = clamp01(0.5 - roundedSquare(x, y, 460, 200)); // anti-aliased tile mask
    // Background: zinc-950 to a deep teal at the bottom.
    const g = clamp01((y + 460) / 920);
    let r = mix(14, 8, g), gr = mix(16, 40, g), b = mix(22, 48, g);
    // Ring "O": cyan (#22d3ee) to violet (#a78bfa) top to bottom.
    const d = Math.hypot(x, y + 40);
    const ring = clamp01(0.5 - Math.abs(d - 270) + 62);
    const ang = clamp01((y + 40 + 332) / 664); // cyan at the top, violet at the bottom
    r = mix(r, mix(34, 167, ang), ring);
    gr = mix(gr, mix(211, 139, ang), ring);
    b = mix(b, mix(238, 250, ang), ring);
    // Stage floor line under the ring.
    const stage = clamp01(0.5 - Math.abs(y - 330) + 18) * clamp01(0.5 - (Math.abs(x) - 300));
    r = mix(r, 226, stage);
    gr = mix(gr, 232, stage);
    b = mix(b, 240, stage);
    const o = py * (SIZE * 4 + 1) + 1 + px * 4;
    raw[o] = Math.round(r);
    raw[o + 1] = Math.round(gr);
    raw[o + 2] = Math.round(b);
    raw[o + 3] = Math.round(tile * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Icon written to ${out} (${png.length} bytes)`);
