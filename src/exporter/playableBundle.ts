/**
 * Phase 5 — Playable bundle hardening: offline check, per-network size budget and DEFLATE ZIP packaging.
 * Pure helpers (no DOM) so they run in node tests and in the browser.
 */
import type { StandaloneAdNetwork } from './mediaExporter';

/**
 * Typical upper bounds used as a pre-flight check. Networks change these and sometimes measure the zipped
 * package instead of the HTML — always confirm against the network's current spec before shipping.
 */
export const PLAYABLE_SIZE_LIMITS: Record<StandaloneAdNetwork, { bytes: number; label: string; measuredOn: 'html' | 'zip' }> = {
  meta: { bytes: 2 * 1024 * 1024, label: 'Meta playable (single HTML, typically ≤ 2 MB)', measuredOn: 'html' },
  tiktok: { bytes: 5 * 1024 * 1024, label: 'TikTok / Pangle playable (typically ≤ 5 MB)', measuredOn: 'zip' },
  universal: { bytes: 5 * 1024 * 1024, label: 'Generic ad network (typically ≤ 5 MB)', measuredOn: 'html' },
  telegram: { bytes: 20 * 1024 * 1024, label: 'Telegram Mini App (self-hosted; soft 20 MB budget)', measuredOn: 'html' },
  itch: { bytes: 200 * 1024 * 1024, label: 'itch.io HTML upload (ZIP, generous limit)', measuredOn: 'zip' },
};

/** Scripts the hosting platform injects itself; they don't break offline play. */
const PLATFORM_PROVIDED = [/^mraid\.js$/i, /telegram\.org\/js\/telegram-web-app\.js/i];

export interface PlayableBudgetReport {
  network: StandaloneAdNetwork;
  htmlBytes: number;
  zipBytes?: number;
  limitBytes: number;
  limitLabel: string;
  measuredBytes: number;
  withinBudget: boolean;
  /** Remote URLs the bundle needs at runtime (excluding platform-provided SDKs). */
  externalDependencies: string[];
  offlineReady: boolean;
  notes: string[];
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function findExternalDependencies(html: string): string[] {
  const urls = new Set<string>();
  const re = /<(?:script|link|img|audio|video|source)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/^(https?:)?\/\//i.test(url) && !PLATFORM_PROVIDED.some((p) => p.test(url))) urls.add(url);
  }
  return [...urls];
}

export function analyzePlayableBudget(html: string, network: StandaloneAdNetwork, zipBytes?: number): PlayableBudgetReport {
  const limit = PLAYABLE_SIZE_LIMITS[network];
  const htmlBytes = byteLength(html);
  const measuredBytes = limit.measuredOn === 'zip' && zipBytes !== undefined ? zipBytes : htmlBytes;
  const externalDependencies = findExternalDependencies(html);
  const notes: string[] = [];
  if (externalDependencies.length) notes.push(`Needs network at runtime: ${externalDependencies.join(', ')}`);
  if (measuredBytes > limit.bytes) notes.push(`Over budget by ${formatBytes(measuredBytes - limit.bytes)}.`);
  if (limit.measuredOn === 'zip' && zipBytes === undefined) notes.push('Budget measured on HTML; ZIP size not computed.');
  return {
    network,
    htmlBytes,
    zipBytes,
    limitBytes: limit.bytes,
    limitLabel: limit.label,
    measuredBytes,
    withinBudget: measuredBytes <= limit.bytes,
    externalDependencies,
    offlineReady: externalDependencies.length === 0,
    notes,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// ZIP (PKZIP 2.0) with DEFLATE via the standard CompressionStream API
// ---------------------------------------------------------------------------

export interface ZipInput {
  name: string;
  content: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Builds a ZIP archive. Entries are DEFLATE-compressed when that makes them smaller and CompressionStream
 * exists; otherwise they are stored. `date` is injectable for reproducible archives.
 */
export async function buildZip(files: ZipInput[], opts: { compress?: boolean; date?: Date } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const date = opts.date ?? new Date();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    const crc = crc32(raw);
    const deflated = opts.compress === false ? null : await deflateRaw(raw);
    const useDeflate = !!deflated && deflated.length < raw.length;
    const data = useDeflate ? deflated! : raw;
    const method = useDeflate ? 8 : 0;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    local.push(new Uint8Array(lh.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }

  const cdBytes = concat(central);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdBytes.length, true);
  eocd.setUint32(16, offset, true);
  return concat([...local, cdBytes, new Uint8Array(eocd.buffer)]);
}

/** Lazily loads the inlined Three.js runtime (kept out of the main app chunk). */
export async function loadThreePlayableRuntime(): Promise<string> {
  const mod = await import('./generated/threePlayableRuntime');
  return mod.THREE_PLAYABLE_RUNTIME;
}

/** Safe to place inside an inline <script>: neutralises any `</script` sequence in the source. */
export function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}
