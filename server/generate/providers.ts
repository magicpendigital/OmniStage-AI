/**
 * Phase 6 Batch 3 — asset-generation provider adapters (pure: they build upstream requests and parse responses;
 * the job runner in ./jobs.ts does the I/O). API hosts, auth schemes and the hosts results may be downloaded
 * from are fixed here, never taken from an extension manifest, so a manifest cannot redirect the user's key.
 *
 * Upstream APIs (re-check when a provider changes its API):
 *   Meshy     POST https://api.meshy.ai/openapi/v2/text-to-3d  {mode:'preview'|'refine'}  → {result: taskId}
 *             GET  https://api.meshy.ai/openapi/v2/text-to-3d/:id → {status, progress, model_urls.glb, thumbnail_url, task_error}
 *   Tripo     POST https://api.tripo3d.ai/v2/openapi/task {type:'text_to_model'} → {code:0, data:{task_id}}
 *             GET  https://api.tripo3d.ai/v2/openapi/task/:id → {code:0, data:{status, progress, output:{pbr_model|model}}}
 *   fal.ai    POST https://queue.fal.run/<model> → {request_id, status_url, response_url}; GET status_url → {status};
 *             GET response_url → {images:[{url}]} | {image:{url}}   (auth header "Key <id:secret>")
 *   Replicate POST https://api.replicate.com/v1/models/<owner>/<name>/predictions → {id, status}
 *             GET  https://api.replicate.com/v1/predictions/:id → {status, output, error}
 */
import type { ExtensionGenerator, GenerationProviderId } from '../../src/extensions/types';
import { GENERATION_MODEL_RE } from '../../src/extensions/validate';

export interface UpstreamRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

/** Where a running upstream task is; stored in the job (never contains the key). */
export interface TaskRef {
  stage: string;
  id: string;
  statusUrl?: string;
  responseUrl?: string;
}

export interface PollResult {
  status: 'running' | 'succeeded' | 'failed';
  progress?: number;
  resultUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface GenerateInput {
  prompt: string;
  generator: ExtensionGenerator;
}

export interface ProviderSpec {
  id: GenerationProviderId;
  label: string;
  output: 'model' | 'image';
  envKey: string;
  /** Licence note saved with every asset (<= 80 chars). */
  license: string;
  /** Hosts (exact or parent domains) results may be downloaded from. */
  resultHosts: string[];
  /** Hosts upstream status/response URLs may point at. */
  apiHosts: string[];
  create(input: GenerateInput, key: string): UpstreamRequest;
  parseCreate(json: any, stage: string): TaskRef;
  poll(ref: TaskRef, key: string): UpstreamRequest;
  parsePoll(json: any, ref: TaskRef): PollResult;
  /** fal.ai: the result has to be fetched separately once the queue says COMPLETED. */
  result?(ref: TaskRef, key: string): UpstreamRequest;
  parseResult?(json: any): PollResult;
  /** A follow-up stage (Meshy refine / fal background removal) or null when the asset is final. */
  next?(ref: TaskRef, done: PollResult, input: GenerateInput, key: string): { stage: string; request: UpstreamRequest } | null;
}

export class GenerationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_PROMPT = 800;
const TASK_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

export function cleanPrompt(raw: unknown): string {
  const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 3) throw new GenerationError('Describe what to generate (at least 3 characters).');
  return text.slice(0, MAX_PROMPT);
}

/** Framing words that make image models draw one usable game sprite instead of a scene. */
export function spritePrompt(prompt: string): string {
  return `${prompt}. Single game sprite, one subject centred, full body in frame, clean silhouette, plain solid white background, no text, no border, no shadow on the ground`;
}

function taskId(v: unknown, provider: string): string {
  const id = String(v ?? '');
  if (!TASK_ID_RE.test(id)) throw new GenerationError(`${provider} returned an unexpected task id`, 502);
  return id;
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/** https only, on one of the provider's hosts; IP literals and localhost are never fetched. */
export function safeUrl(raw: unknown, allowed: string[]): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || u.hostname === 'localhost') return null;
    return hostAllowed(u.hostname, allowed) ? u : null;
  } catch {
    return null;
  }
}

function model(generator: ExtensionGenerator, fallback: string): string {
  const m = generator.model || fallback;
  if (!GENERATION_MODEL_RE.test(m) || m.includes('..')) throw new GenerationError('Invalid model id');
  return m;
}

const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : undefined);

// ---------------------------------------------------------------------------------------------- Meshy
const MESHY_API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const meshy: ProviderSpec = {
  id: 'meshy',
  label: 'Meshy',
  output: 'model',
  envKey: 'MESHY_API_KEY',
  license: 'AI-generated with Meshy; rights per your Meshy plan (free plan: CC BY 4.0)',
  resultHosts: ['meshy.ai'],
  apiHosts: ['api.meshy.ai'],
  create: (input, key) => ({
    url: MESHY_API,
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: { mode: 'preview', prompt: input.prompt.slice(0, 600), art_style: 'realistic', should_remesh: true, target_polycount: 30000, target_formats: ['glb'] },
  }),
  parseCreate: (json, stage) => ({ stage, id: taskId(json?.result, 'Meshy') }),
  poll: (ref, key) => ({ url: `${MESHY_API}/${encodeURIComponent(ref.id)}`, method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
  parsePoll: (json) => {
    const s = String(json?.status || '').toUpperCase();
    if (s === 'SUCCEEDED') return { status: 'succeeded', progress: 100, resultUrl: json?.model_urls?.glb, thumbnailUrl: json?.thumbnail_url };
    if (s === 'FAILED' || s === 'CANCELED' || s === 'EXPIRED') return { status: 'failed', error: json?.task_error?.message || `Meshy task ${s.toLowerCase()}` };
    return { status: 'running', progress: pct(json?.progress) };
  },
  next: (ref, _done, input, key) =>
    ref.stage === 'preview' && input.generator.texture !== false
      ? {
          stage: 'refine',
          request: { url: MESHY_API, method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: { mode: 'refine', preview_task_id: ref.id, enable_pbr: true, target_formats: ['glb'] } },
        }
      : null,
};

// ---------------------------------------------------------------------------------------------- Tripo
const TRIPO_API = 'https://api.tripo3d.ai/v2/openapi/task';
const tripoData = (json: any, what: string) => {
  if (json?.code !== undefined && json.code !== 0) throw new GenerationError(`Tripo ${what} failed: ${String(json?.message || json.code).slice(0, 160)}`, 502);
  return json?.data ?? {};
};
const tripo: ProviderSpec = {
  id: 'tripo',
  label: 'Tripo',
  output: 'model',
  envKey: 'TRIPO_API_KEY',
  license: 'AI-generated with Tripo; rights per your Tripo plan (free plan: CC BY 4.0)',
  resultHosts: ['tripo3d.com', 'tripo3d.ai', 'bcebos.com', 'cloudfront.net'],
  apiHosts: ['api.tripo3d.ai'],
  create: (input, key) => ({
    url: TRIPO_API,
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: { type: 'text_to_model', prompt: input.prompt.slice(0, 1000), texture: input.generator.texture !== false, pbr: input.generator.texture !== false },
  }),
  parseCreate: (json, stage) => ({ stage, id: taskId(tripoData(json, 'request').task_id, 'Tripo') }),
  poll: (ref, key) => ({ url: `${TRIPO_API}/${encodeURIComponent(ref.id)}`, method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
  parsePoll: (json) => {
    const d = tripoData(json, 'task');
    const s = String(d.status || '').toLowerCase();
    if (s === 'success') {
      const out = d.output || {};
      return { status: 'succeeded', progress: 100, resultUrl: out.pbr_model || out.model || out.base_model, thumbnailUrl: out.rendered_image };
    }
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(s)) return { status: 'failed', error: `Tripo task ${s}` };
    return { status: 'running', progress: pct(d.progress) };
  },
};

// ---------------------------------------------------------------------------------------------- fal.ai
const FAL_QUEUE = 'https://queue.fal.run';
const FAL_REMBG = 'fal-ai/imageutils/rembg';
const falHeaders = (key: string) => ({ Authorization: `Key ${key}` });
const falImage = (json: any): string | undefined => json?.images?.[0]?.url || json?.image?.url;
const fal: ProviderSpec = {
  id: 'fal',
  label: 'fal.ai',
  output: 'image',
  envKey: 'FAL_KEY',
  license: 'AI-generated (FLUX schnell, Apache-2.0) via fal.ai; free to use',
  resultHosts: ['fal.media', 'fal.run', 'fal.ai'],
  apiHosts: ['queue.fal.run'],
  create: (input, key) => ({
    url: `${FAL_QUEUE}/${model(input.generator, 'fal-ai/flux/schnell')}`,
    method: 'POST',
    headers: falHeaders(key),
    body: {
      prompt: input.generator.sprite ? spritePrompt(input.prompt) : input.prompt,
      image_size: input.generator.sprite ? 'square_hd' : 'landscape_16_9',
      num_images: 1,
      enable_safety_checker: true,
      output_format: 'png',
    },
  }),
  parseCreate: (json, stage) => {
    const ref: TaskRef = { stage, id: taskId(json?.request_id, 'fal.ai') };
    const status = safeUrl(json?.status_url, fal.apiHosts);
    const response = safeUrl(json?.response_url, fal.apiHosts);
    if (!status || !response) throw new GenerationError('fal.ai returned unexpected queue URLs', 502);
    ref.statusUrl = status.toString();
    ref.responseUrl = response.toString();
    return ref;
  },
  poll: (ref, key) => ({ url: ref.statusUrl!, method: 'GET', headers: falHeaders(key) }),
  parsePoll: (json) => {
    const s = String(json?.status || '').toUpperCase();
    if (s === 'COMPLETED') return json?.error ? { status: 'failed', error: String(json.error).slice(0, 200) } : { status: 'succeeded', progress: 100 };
    if (s === 'IN_QUEUE' || s === 'IN_PROGRESS') return { status: 'running', progress: s === 'IN_PROGRESS' ? 50 : 5 };
    return { status: 'failed', error: `fal.ai status ${s || 'unknown'}` };
  },
  result: (ref, key) => ({ url: ref.responseUrl!, method: 'GET', headers: falHeaders(key) }),
  parseResult: (json) => {
    const url = falImage(json);
    return url ? { status: 'succeeded', progress: 100, resultUrl: url } : { status: 'failed', error: String(json?.detail?.[0]?.msg || json?.detail || 'fal.ai returned no image').slice(0, 200) };
  },
  next: (ref, done, input, key) =>
    ref.stage === 'image' && input.generator.removeBackground && done.resultUrl
      ? { stage: 'cutout', request: { url: `${FAL_QUEUE}/${FAL_REMBG}`, method: 'POST', headers: falHeaders(key), body: { image_url: done.resultUrl } } }
      : null,
};

// ---------------------------------------------------------------------------------------------- Replicate
const REPLICATE_API = 'https://api.replicate.com/v1';
const replicate: ProviderSpec = {
  id: 'replicate',
  label: 'Replicate',
  output: 'image',
  envKey: 'REPLICATE_API_TOKEN',
  license: 'AI-generated (FLUX schnell, Apache-2.0) via Replicate; free to use',
  resultHosts: ['replicate.delivery', 'replicate.com'],
  apiHosts: ['api.replicate.com'],
  create: (input, key) => ({
    url: `${REPLICATE_API}/models/${model(input.generator, 'black-forest-labs/flux-schnell')}/predictions`,
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: { input: { prompt: input.generator.sprite ? spritePrompt(input.prompt) : input.prompt, aspect_ratio: input.generator.sprite ? '1:1' : '16:9', output_format: 'png', num_outputs: 1 } },
  }),
  parseCreate: (json, stage) => ({ stage, id: taskId(json?.id, 'Replicate') }),
  poll: (ref, key) => ({ url: `${REPLICATE_API}/predictions/${encodeURIComponent(ref.id)}`, method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
  parsePoll: (json) => {
    const s = String(json?.status || '').toLowerCase();
    if (s === 'succeeded') {
      const out = Array.isArray(json.output) ? json.output[0] : json.output;
      return { status: 'succeeded', progress: 100, resultUrl: typeof out === 'string' ? out : undefined };
    }
    if (s === 'failed' || s === 'canceled') return { status: 'failed', error: String(json?.error || `Replicate prediction ${s}`).slice(0, 200) };
    return { status: 'running', progress: s === 'processing' ? 50 : 10 };
  },
};

export const PROVIDERS: Record<GenerationProviderId, ProviderSpec> = { meshy, tripo, fal, replicate };

/** First stage name per provider (Meshy starts with a mesh preview, fal with the raw image). */
export function firstStage(provider: GenerationProviderId): string {
  return provider === 'meshy' ? 'preview' : provider === 'fal' ? 'image' : 'generate';
}

/** Plain-language message for an upstream HTTP error; the key is scrubbed from anything echoed back. */
export function upstreamErrorMessage(label: string, status: number, text: string, key: string): string {
  if (status === 401 || status === 403) return `${label} rejected the API key (check it in Settings → Generation keys).`;
  if (status === 402) return `${label} says the account is out of credits.`;
  if (status === 429) return `${label} is rate-limiting requests; wait a moment and try again.`;
  let detail = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (key) detail = detail.split(key).join('***');
  return `${label} returned ${status}${detail ? `: ${detail}` : ''}`;
}
