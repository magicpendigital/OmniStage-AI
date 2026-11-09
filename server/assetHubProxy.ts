/**
 * Online Asset Hub Proxy — Poly Pizza · Sketchfab · Poly Haven
 *
 * Routes (all GET unless noted):
 *   /api/assets/search?provider=polypizza|sketchfab|polyhaven&kind=model|hdri&q=...&page=0
 *        headers: x-polypizza-key (Poly Pizza), x-sketchfab-token (optional for search)
 *   POST /api/assets/sketchfab/resolve  { uid }   header: x-sketchfab-token  -> { downloadUrl }
 *   /api/assets/proxy?url=<allow-listed https URL>       single-file binary passthrough (.glb, thumbnails)
 *   /api/assets/polyhaven/hdri/:id/:res.hdr               Poly Haven HDRI (.hdr) passthrough
 *   /api/assets/polyhaven/model/:id/scene.gltf            Poly Haven glTF with URIs rewritten to the proxy
 *   /api/assets/polyhaven/model/:id/files/*               buffers/textures referenced by that glTF
 *   /api/assets/cache/:file                               Sketchfab GLBs downloaded to the server cache
 *
 * API keys come from the user's Settings (sent per request as headers) or the server env
 * (POLY_PIZZA_API_KEY / SKETCHFAB_API_TOKEN). Keys are never written to logs or responses.
 * Upstream hosts are allow-listed so the proxy cannot be used to reach arbitrary URLs.
 */
import type { Express, Request, Response } from 'express';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { rename, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

type Provider = 'polypizza' | 'sketchfab' | 'polyhaven';
type Kind = 'model' | 'hdri';

interface AssetResult {
  provider: Provider;
  kind: Kind;
  id: string;
  name: string;
  thumbnailUrl?: string;
  author?: string;
  license?: string;
  animated?: boolean;
  triangleCount?: number;
  sourcePageUrl?: string;
  downloadUrl?: string;
}

const USER_AGENT = 'OmniStage-AI-Studio/1.0 (asset-hub-proxy)';
const PAGE_SIZE = 24;
const MAX_SKETCHFAB_BYTES = 150 * 1024 * 1024;
const CACHE_DIR = path.join(os.tmpdir(), 'omnistage-asset-cache');

const ALLOWED_HOSTS = new Set([
  'static.poly.pizza',
  'poly.pizza',
  'api.poly.pizza',
  'api.polyhaven.com',
  'dl.polyhaven.org',
  'cdn.polyhaven.com',
  'media.sketchfab.com',
  'api.sketchfab.com',
]);

/** Sketchfab download links are short-lived signed URLs on their storage hosts. */
function isAllowedHost(host: string, allowSketchfabStorage = false): boolean {
  if (ALLOWED_HOSTS.has(host)) return true;
  if (allowSketchfabStorage) {
    return (
      host.endsWith('.sketchfab.com') ||
      /^sketchfab-prod-media[\w.-]*\.s3[\w.-]*\.amazonaws\.com$/.test(host) ||
      host.endsWith('.cloudfront.net')
    );
  }
  return false;
}

function parseAllowedUrl(raw: unknown, allowSketchfabStorage = false): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return isAllowedHost(url.hostname, allowSketchfabStorage) ? url : null;
  } catch {
    return null;
  }
}

/** fetch that re-validates every redirect hop against the allow-list. */
async function safeFetch(
  url: URL,
  init: { headers?: Record<string, string>; allowSketchfabStorage?: boolean } = {}
): Promise<globalThis.Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = new URL(response.headers.get('location')!, current);
      if (next.protocol !== 'https:' || !isAllowedHost(next.hostname, init.allowSketchfabStorage)) {
        throw new HttpError(502, `Upstream redirected to a non allow-listed host (${next.hostname})`);
      }
      current = next;
      continue;
    }
    return response;
  }
  throw new HttpError(502, 'Too many upstream redirects');
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function sendError(res: Response, error: unknown, context: string) {
  const status = error instanceof HttpError ? error.status : 502;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[asset-hub] ${context}: ${message}`);
  if (!res.headersSent) res.status(status).json({ error: message });
  else res.end();
}

async function streamUpstream(res: Response, upstream: globalThis.Response, fallbackType: string) {
  if (!upstream.ok || !upstream.body) {
    throw new HttpError(upstream.status === 404 ? 404 : 502, `Upstream responded ${upstream.status}`);
  }
  res.setHeader('Content-Type', upstream.headers.get('content-type') || fallbackType);
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  await pipeline(Readable.fromWeb(upstream.body as any), res);
}

function headerValue(req: Request, name: string, envFallback?: string): string {
  const fromHeader = req.get(name);
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();
  return (envFallback && process.env[envFallback]?.trim()) || '';
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.glb': 'model/gltf-binary',
      '.gltf': 'model/gltf+json',
      '.bin': 'application/octet-stream',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.hdr': 'application/octet-stream',
    }[ext] ?? 'application/octet-stream'
  );
}

const proxied = (url: string) => `/api/assets/proxy?url=${encodeURIComponent(url)}`;

// ----------------------------------------------------------------------------
// Poly Pizza
// ----------------------------------------------------------------------------

async function searchPolyPizza(req: Request, q: string, page: number): Promise<{ total: number; results: AssetResult[] }> {
  const key = headerValue(req, 'x-polypizza-key', 'POLY_PIZZA_API_KEY');
  if (!key) throw new HttpError(401, 'Poly Pizza API key missing — add it in Settings → External Asset CDNs.');
  const url = new URL(`https://api.poly.pizza/v1.1/search/${encodeURIComponent(q || 'character')}`);
  url.searchParams.set('Limit', String(PAGE_SIZE));
  url.searchParams.set('Page', String(page));
  const response = await safeFetch(url, { headers: { 'x-auth-token': key, Accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) throw new HttpError(401, 'Poly Pizza rejected the API key.');
  if (!response.ok) throw new HttpError(502, `Poly Pizza search failed (${response.status})`);
  const data: any = await response.json();
  const rows: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  const results = rows
    .map((r): AssetResult | null => {
      const download: string | undefined = r.Download ?? r.download;
      const id = String(r.ID ?? r.id ?? r.PublicID ?? '');
      if (!download || !id || !parseAllowedUrl(download)) return null;
      const thumb: string | undefined = r.Thumbnail ?? r.thumbnail;
      return {
        provider: 'polypizza',
        kind: 'model',
        id,
        name: String(r.Title ?? r.title ?? 'Poly Pizza Model'),
        thumbnailUrl: thumb && parseAllowedUrl(thumb) ? proxied(thumb) : thumb,
        author: r.Creator?.Username ?? r.Attribution,
        license: r.Licence ?? r.License,
        animated: Boolean(r.Animated),
        triangleCount: typeof r['Tri Count'] === 'number' ? r['Tri Count'] : undefined,
        sourcePageUrl: `https://poly.pizza/m/${id}`,
        downloadUrl: proxied(download),
      };
    })
    .filter((r): r is AssetResult => r !== null);
  return { total: typeof data?.total === 'number' ? data.total : results.length, results };
}

// ----------------------------------------------------------------------------
// Sketchfab
// ----------------------------------------------------------------------------

async function searchSketchfab(req: Request, q: string, page: number): Promise<{ total: number; results: AssetResult[] }> {
  const token = headerValue(req, 'x-sketchfab-token', 'SKETCHFAB_API_TOKEN');
  const url = new URL('https://api.sketchfab.com/v3/search');
  url.searchParams.set('type', 'models');
  url.searchParams.set('downloadable', 'true');
  url.searchParams.set('q', q || 'low poly');
  url.searchParams.set('count', String(PAGE_SIZE));
  if (page > 0) url.searchParams.set('cursor', String(page * PAGE_SIZE));
  const response = await safeFetch(url, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
  });
  if (!response.ok) throw new HttpError(502, `Sketchfab search failed (${response.status})`);
  const data: any = await response.json();
  const results: AssetResult[] = (Array.isArray(data?.results) ? data.results : [])
    .filter((m: any) => m?.uid && m.isDownloadable !== false && (!m.archives || m.archives.glb))
    .map((m: any) => {
      const images: any[] = m.thumbnails?.images ?? [];
      const thumb = [...images].sort((a, b) => Math.abs((a.width ?? 0) - 256) - Math.abs((b.width ?? 0) - 256))[0]?.url;
      return {
        provider: 'sketchfab' as const,
        kind: 'model' as const,
        id: m.uid,
        name: m.name ?? 'Sketchfab Model',
        thumbnailUrl: thumb && parseAllowedUrl(thumb) ? proxied(thumb) : thumb,
        author: m.user?.username,
        license: m.license?.label,
        animated: (m.animationCount ?? 0) > 0,
        triangleCount: m.faceCount,
        sourcePageUrl: m.viewerUrl,
        // GLB needs an authenticated resolve step: POST /api/assets/sketchfab/resolve
      };
    });
  return { total: results.length + (data?.next ? PAGE_SIZE : 0), results };
}

async function resolveSketchfabGlb(req: Request, uid: string): Promise<string> {
  if (!/^[a-zA-Z0-9]{16,64}$/.test(uid)) throw new HttpError(400, 'Invalid Sketchfab model uid');
  const fileName = `sketchfab-${uid}.glb`;
  const finalPath = path.join(CACHE_DIR, fileName);
  if (existsSync(finalPath) && statSync(finalPath).size > 0) return `/api/assets/cache/${fileName}`;

  const token = headerValue(req, 'x-sketchfab-token', 'SKETCHFAB_API_TOKEN');
  if (!token) throw new HttpError(401, 'Sketchfab API token missing — add it in Settings → External Asset CDNs.');
  const infoResponse = await safeFetch(new URL(`https://api.sketchfab.com/v3/models/${uid}/download`), {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
  });
  if (infoResponse.status === 401 || infoResponse.status === 403) {
    throw new HttpError(401, 'Sketchfab rejected the token or the model is not downloadable for this account.');
  }
  if (!infoResponse.ok) throw new HttpError(502, `Sketchfab download lookup failed (${infoResponse.status})`);
  const info: any = await infoResponse.json();
  const glb = info?.glb;
  if (!glb?.url) {
    throw new HttpError(422, 'This Sketchfab model only offers a zipped glTF archive (no single-file GLB).');
  }
  if (typeof glb.size === 'number' && glb.size > MAX_SKETCHFAB_BYTES) {
    throw new HttpError(413, `Model is ${(glb.size / 1048576).toFixed(0)} MB — above the ${MAX_SKETCHFAB_BYTES / 1048576} MB studio limit.`);
  }
  const glbUrl = parseAllowedUrl(glb.url, true);
  if (!glbUrl) throw new HttpError(502, 'Sketchfab returned a download host outside the allow-list.');

  const download = await safeFetch(glbUrl, { allowSketchfabStorage: true });
  if (!download.ok || !download.body) throw new HttpError(502, `Sketchfab GLB download failed (${download.status})`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmpPath = `${finalPath}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(download.body as any), createWriteStream(tmpPath));
    await rename(tmpPath, finalPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
  return `/api/assets/cache/${fileName}`;
}

// ----------------------------------------------------------------------------
// Poly Haven (no key required; public API asks for a descriptive User-Agent)
// ----------------------------------------------------------------------------

const polyHavenIndexCache = new Map<Kind, { at: number; entries: Array<[string, any]> }>();
const POLY_HAVEN_INDEX_TTL = 60 * 60 * 1000;

async function getPolyHavenIndex(kind: Kind): Promise<Array<[string, any]>> {
  const cached = polyHavenIndexCache.get(kind);
  if (cached && Date.now() - cached.at < POLY_HAVEN_INDEX_TTL) return cached.entries;
  const url = new URL('https://api.polyhaven.com/assets');
  url.searchParams.set('type', kind === 'hdri' ? 'hdris' : 'models');
  const response = await safeFetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new HttpError(502, `Poly Haven index failed (${response.status})`);
  const data: any = await response.json();
  const entries = Object.entries(data ?? {}).sort(
    (a: any, b: any) => (b[1]?.download_count ?? 0) - (a[1]?.download_count ?? 0)
  );
  polyHavenIndexCache.set(kind, { at: Date.now(), entries });
  return entries;
}

async function searchPolyHaven(kind: Kind, q: string, page: number): Promise<{ total: number; results: AssetResult[] }> {
  const entries = await getPolyHavenIndex(kind);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? entries.filter(([id, a]) => {
        const haystack = [id, a.name, ...(a.tags ?? []), ...(a.categories ?? [])].join(' ').toLowerCase();
        return terms.every((t) => haystack.includes(t));
      })
    : entries;
  const slice = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return {
    total: matches.length,
    results: slice.map(([id, a]) => ({
      provider: 'polyhaven' as const,
      kind,
      id,
      name: a.name ?? id,
      thumbnailUrl: proxied(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`),
      author: Object.keys(a.authors ?? {}).join(', ') || undefined,
      license: 'CC0',
      sourcePageUrl: `https://polyhaven.com/a/${id}`,
      downloadUrl:
        kind === 'hdri'
          ? `/api/assets/polyhaven/hdri/${encodeURIComponent(id)}/1k.hdr`
          : `/api/assets/polyhaven/model/${encodeURIComponent(id)}/scene.gltf`,
    })),
  };
}

const POLY_HAVEN_ID = /^[A-Za-z0-9_-]{2,80}$/;
const polyHavenFilesCache = new Map<string, { at: number; files: any }>();

async function getPolyHavenFiles(id: string): Promise<any> {
  if (!POLY_HAVEN_ID.test(id)) throw new HttpError(400, 'Invalid Poly Haven asset id');
  const cached = polyHavenFilesCache.get(id);
  if (cached && Date.now() - cached.at < POLY_HAVEN_INDEX_TTL) return cached.files;
  const response = await safeFetch(new URL(`https://api.polyhaven.com/files/${id}`), {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) throw new HttpError(404, `Poly Haven asset "${id}" not found`);
  if (!response.ok) throw new HttpError(502, `Poly Haven files lookup failed (${response.status})`);
  const files = await response.json();
  polyHavenFilesCache.set(id, { at: Date.now(), files });
  return files;
}

function pickResolution(table: Record<string, any> | undefined, preferred: string): string | null {
  if (!table) return null;
  const order = [preferred, '1k', '2k', '4k', '8k'];
  return order.find((r) => table[r]) ?? Object.keys(table)[0] ?? null;
}

// ----------------------------------------------------------------------------
// Route registration
// ----------------------------------------------------------------------------

export function registerAssetHubRoutes(app: Express) {
  app.get('/api/assets/search', async (req, res) => {
    try {
      const provider = String(req.query.provider || '') as Provider;
      const kind: Kind = req.query.kind === 'hdri' ? 'hdri' : 'model';
      const q = String(req.query.q || '').slice(0, 120).trim();
      const page = Math.max(0, Math.min(50, parseInt(String(req.query.page || '0'), 10) || 0));

      let out: { total: number; results: AssetResult[] };
      if (provider === 'polyhaven') out = await searchPolyHaven(kind, q, page);
      else if (kind === 'hdri') throw new HttpError(400, 'HDRI search is only available from Poly Haven.');
      else if (provider === 'polypizza') out = await searchPolyPizza(req, q, page);
      else if (provider === 'sketchfab') out = await searchSketchfab(req, q, page);
      else throw new HttpError(400, 'provider must be polypizza, sketchfab or polyhaven');

      res.json({ provider, kind, query: q, ...out });
    } catch (error) {
      sendError(res, error, 'search');
    }
  });

  app.post('/api/assets/sketchfab/resolve', async (req, res) => {
    try {
      const downloadUrl = await resolveSketchfabGlb(req, String(req.body?.uid || ''));
      res.json({ downloadUrl });
    } catch (error) {
      sendError(res, error, 'sketchfab-resolve');
    }
  });

  app.get('/api/assets/proxy', async (req, res) => {
    try {
      const target = parseAllowedUrl(req.query.url);
      if (!target) throw new HttpError(400, 'url must be an https URL on an allow-listed asset host');
      const upstream = await safeFetch(target);
      await streamUpstream(res, upstream, contentTypeFor(target.pathname));
    } catch (error) {
      sendError(res, error, 'proxy');
    }
  });

  app.get('/api/assets/polyhaven/hdri/:id/:res.hdr', async (req, res) => {
    try {
      const files = await getPolyHavenFiles(req.params.id);
      const resKey = pickResolution(files?.hdri, req.params.res);
      const url = resKey ? parseAllowedUrl(files.hdri[resKey]?.hdr?.url) : null;
      if (!url) throw new HttpError(404, 'No .hdr file available for this HDRI');
      await streamUpstream(res, await safeFetch(url), 'application/octet-stream');
    } catch (error) {
      sendError(res, error, 'polyhaven-hdri');
    }
  });

  // Poly Haven ships glTF whose buffers/textures live in unrelated CDN folders, so relative
  // URIs inside the .gltf do not resolve. Rewrite them to sibling proxy paths under ./files/.
  app.get('/api/assets/polyhaven/model/:id/scene.gltf', async (req, res) => {
    try {
      const id = req.params.id;
      const files = await getPolyHavenFiles(id);
      const resKey = pickResolution(files?.gltf, String(req.query.res || '1k'));
      const entry = resKey ? files.gltf[resKey]?.gltf : null;
      const gltfUrl = entry ? parseAllowedUrl(entry.url) : null;
      if (!gltfUrl) throw new HttpError(404, 'No glTF export available for this Poly Haven model');
      const upstream = await safeFetch(gltfUrl);
      if (!upstream.ok) throw new HttpError(502, `Poly Haven glTF fetch failed (${upstream.status})`);
      const gltf: any = await upstream.json();
      const include: Record<string, { url: string }> = entry.include ?? {};
      const rewrite = (uri: unknown) => {
        if (typeof uri !== 'string' || uri.startsWith('data:')) return uri;
        const decoded = decodeURIComponent(uri);
        const hit = include[decoded] ?? include[uri];
        return hit ? `files/${encodeURIComponent(decoded)}?res=${resKey}` : uri;
      };
      for (const buffer of gltf.buffers ?? []) buffer.uri = rewrite(buffer.uri);
      for (const image of gltf.images ?? []) if (image.uri) image.uri = rewrite(image.uri);
      res.setHeader('Content-Type', 'model/gltf+json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(JSON.stringify(gltf));
    } catch (error) {
      sendError(res, error, 'polyhaven-gltf');
    }
  });

  app.get('/api/assets/polyhaven/model/:id/files/:file', async (req, res) => {
    try {
      const files = await getPolyHavenFiles(req.params.id);
      const resKey = pickResolution(files?.gltf, String(req.query.res || '1k'));
      const include = resKey ? files.gltf[resKey]?.gltf?.include ?? {} : {};
      const target = parseAllowedUrl(include[req.params.file]?.url);
      if (!target) throw new HttpError(404, 'File is not part of this Poly Haven model');
      await streamUpstream(res, await safeFetch(target), contentTypeFor(req.params.file));
    } catch (error) {
      sendError(res, error, 'polyhaven-file');
    }
  });

  app.get('/api/assets/cache/:file', (req, res) => {
    const file = req.params.file;
    if (!/^sketchfab-[a-zA-Z0-9]+\.glb$/.test(file)) {
      res.status(400).json({ error: 'Invalid cache file name' });
      return;
    }
    const full = path.join(CACHE_DIR, file);
    if (!existsSync(full)) {
      res.status(404).json({ error: 'Not cached — resolve the model again.' });
      return;
    }
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(full);
  });
}
