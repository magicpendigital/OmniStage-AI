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
 *   Meshy img POST https://api.meshy.ai/openapi/v1/image-to-3d {image_url: data URI, should_texture, enable_pbr} → {result}
 *             GET  https://api.meshy.ai/openapi/v1/image-to-3d/:id → same shape as text-to-3d
 *   Rodin     POST https://api.hyper3d.com/api/v2/rodin (multipart: prompt | images[], tier, geometry_file_format, material)
 *                  → {uuid, jobs:{uuids, subscription_key}}
 *             POST https://api.hyper3d.com/api/v2/status {subscription_key} → {jobs:[{uuid, status: Waiting|Generating|Done|Failed}]}
 *             POST https://api.hyper3d.com/api/v2/download {task_uuid} → {list:[{name, url}]}  (download host undocumented)
 *   OpenRouter POST https://openrouter.ai/api/v1/images {model, prompt, n, aspect_ratio, output_format} → {data:[{b64_json}]}
 *   ElevenLabs POST https://api.elevenlabs.io/v1/sound-generation | /v1/music (?output_format) → audio bytes (xi-api-key)
 *   (checked against the official docs 2026-11-14)
 */
import type { ExtensionGenerator, GenerationOutput, GenerationProviderId } from '../../src/extensions/types';
import { SPRITE_SHEET_FRAMES } from '../../src/extensions/types';
import { GENERATION_MODEL_RE } from '../../src/extensions/validate';
import { buildMusicRequest, buildSfxRequest, ELEVENLABS_API, elevenLabsLicense } from '../../src/audio/elevenLabs';

/** A file part of a multipart/form-data request (Rodin takes the prompt and images as form fields). */
export interface FormFile {
  filename: string;
  type: string;
  data: Buffer;
}

export interface UpstreamRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  /** JSON body. */
  body?: unknown;
  /** multipart/form-data body (instead of `body`). */
  form?: Record<string, string | FormFile | FormFile[]>;
  /** The response is the asset itself (audio bytes), not JSON. */
  binary?: boolean;
  timeoutMs?: number;
}

/** Where a running upstream task is; stored in the job (never contains the key). */
export interface TaskRef {
  stage: string;
  id: string;
  statusUrl?: string;
  responseUrl?: string;
  /** Rodin: the subscription key its status endpoint is polled with (not a secret of the user). */
  token?: string;
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
  /** Image-to-3D: the picture the user picked from the library (already sniffed as PNG / JPEG / WebP). */
  image?: { data: Buffer; mime: string };
}

/** What a one-shot (synchronous) provider answered: the file itself, or a URL to download it from. */
export interface SyncResult {
  data?: Buffer;
  resultUrl?: string;
  error?: string;
}

export interface ProviderSpec {
  id: GenerationProviderId;
  label: string;
  output: GenerationOutput;
  envKey: string;
  /** One request answers with the finished asset (OpenRouter images, ElevenLabs audio); no task to poll. */
  sync?: boolean;
  parseSync?(res: { json?: any; bytes?: Buffer; contentType?: string }): SyncResult;
  /** Licence line per generation (defaults to `license`). */
  licenseFor?(input: GenerateInput): string;
  /** Number of upstream stages this generation runs (progress is spread over them). Default 1. */
  stageCount?(input: GenerateInput): number;
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

/** Frames for a sprite-sheet generator, or 0 for a single image. */
export function sheetFrames(generator: ExtensionGenerator): number {
  const n = Math.round(Number(generator.frames) || 0);
  return n >= SPRITE_SHEET_FRAMES.min ? Math.min(SPRITE_SHEET_FRAMES.max, n) : 0;
}

/** One horizontal strip of N frames of the same subject, so the result can be cut into equal cells. */
export function spriteSheetPrompt(prompt: string, frames: number): string {
  return `${prompt}. Game sprite sheet: exactly ${frames} animation frames of the same character in ONE horizontal row, left to right, equal-width cells, same size, same position and same design in every frame, a smooth looping cycle, full body in every frame, plain solid white background, no text, no numbers, no grid lines, no borders`;
}

/** Prompt sent to an image model for this generator. */
export function imagePrompt(input: GenerateInput): string {
  const frames = sheetFrames(input.generator);
  if (frames) return spriteSheetPrompt(input.prompt, frames);
  return input.generator.sprite ? spritePrompt(input.prompt) : input.prompt;
}

/** fal.ai pixel size for a sprite sheet: square cells, at most 2048 px wide, multiples of 16. */
export function sheetPixelSize(frames: number): { width: number; height: number } {
  const cell = Math.max(256, Math.min(384, Math.floor(2048 / frames / 16) * 16));
  return { width: Math.min(2048, cell * frames), height: cell };
}

const dataUri = (img: { data: Buffer; mime: string }) => `data:${img.mime};base64,${img.data.toString('base64')}`;

function taskId(v: unknown, provider: string): string {
  const id = String(v ?? '');
  if (!TASK_ID_RE.test(id)) throw new GenerationError(`${provider} returned an unexpected task id`, 502);
  return id;
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/** `resultHosts` value for a provider whose download CDN is undocumented: any public https host (no key is ever sent there). */
export const ANY_PUBLIC_HOST = '*';
const PRIVATE_SUFFIX_RE = /(^|\.)(localhost|local|internal|lan|home|intranet|corp)$/i;

/** https only, on one of the provider's hosts; IP literals, ports and local names are never fetched. */
export function safeUrl(raw: unknown, allowed: string[]): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || PRIVATE_SUFFIX_RE.test(u.hostname) || !u.hostname.includes('.')) return null;
    if (allowed.includes(ANY_PUBLIC_HOST)) return u;
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
const MESHY_IMAGE_API = 'https://api.meshy.ai/openapi/v1/image-to-3d';
const meshyTextured = (input: GenerateInput) => input.generator.texture !== false;
const meshy: ProviderSpec = {
  id: 'meshy',
  label: 'Meshy',
  output: 'model',
  envKey: 'MESHY_API_KEY',
  license: 'AI-generated with Meshy; rights per your Meshy plan (free plan: CC BY 4.0)',
  resultHosts: ['meshy.ai'],
  apiHosts: ['api.meshy.ai'],
  stageCount: (input) => (input.generator.input !== 'image' && meshyTextured(input) ? 2 : 1),
  create: (input, key) => {
    if (input.generator.input === 'image') {
      if (!input.image) throw new GenerationError('Pick a picture from your library to turn into a 3D model.');
      return {
        url: MESHY_IMAGE_API,
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: { image_url: dataUri(input.image), should_texture: meshyTextured(input), enable_pbr: meshyTextured(input), should_remesh: true, target_polycount: 30000, ...(input.prompt ? { texture_prompt: input.prompt.slice(0, 600) } : {}) },
      };
    }
    return {
      url: MESHY_API,
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: { mode: 'preview', prompt: input.prompt.slice(0, 600), art_style: 'realistic', should_remesh: true, target_polycount: 30000, target_formats: ['glb'] },
    };
  },
  parseCreate: (json, stage) => ({ stage, id: taskId(json?.result, 'Meshy') }),
  poll: (ref, key) => ({ url: `${ref.stage === 'image' ? MESHY_IMAGE_API : MESHY_API}/${encodeURIComponent(ref.id)}`, method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
  parsePoll: (json) => {
    const s = String(json?.status || '').toUpperCase();
    if (s === 'SUCCEEDED') return { status: 'succeeded', progress: 100, resultUrl: json?.model_urls?.glb, thumbnailUrl: json?.thumbnail_url };
    if (s === 'FAILED' || s === 'CANCELED' || s === 'EXPIRED') return { status: 'failed', error: json?.task_error?.message || `Meshy task ${s.toLowerCase()}` };
    return { status: 'running', progress: pct(json?.progress) };
  },
  next: (ref, _done, input, key) =>
    ref.stage === 'preview' && meshyTextured(input)
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

// ---------------------------------------------------------------------------------------------- Rodin (Hyper3D)
const RODIN_API = 'https://api.hyper3d.com/api/v2';
const RODIN_TOKEN_RE = /^[A-Za-z0-9._:-]{4,4096}$/;
const rodinHeaders = (key: string) => ({ Authorization: `Bearer ${key}` });
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const rodin: ProviderSpec = {
  id: 'rodin',
  label: 'Rodin',
  output: 'model',
  envKey: 'RODIN_API_KEY',
  license: 'AI-generated with Hyper3D Rodin; rights per your Rodin plan',
  // The download CDN is not documented (signed, expiring links); the key is never sent to it.
  resultHosts: [ANY_PUBLIC_HOST],
  apiHosts: ['api.hyper3d.com'],
  create: (input, key) => {
    const form: NonNullable<UpstreamRequest['form']> = {
      tier: 'Gen-2.5-Low',
      geometry_file_format: 'glb',
      material: input.generator.texture === false ? 'Shaded' : 'PBR',
      quality: 'medium',
    };
    if (input.generator.input === 'image') {
      if (!input.image) throw new GenerationError('Pick a picture from your library to turn into a 3D model.');
      form.images = [{ filename: `reference.${IMAGE_EXT[input.image.mime] || 'png'}`, type: input.image.mime, data: input.image.data }];
      if (input.prompt) form.prompt = input.prompt.slice(0, 800);
    } else {
      form.prompt = input.prompt.slice(0, 800);
    }
    return { url: `${RODIN_API}/rodin`, method: 'POST', headers: rodinHeaders(key), form, timeoutMs: 60_000 };
  },
  parseCreate: (json, stage) => {
    if (json?.error) throw new GenerationError(`Rodin: ${String(json.error).slice(0, 160)}`, 502);
    const token = String(json?.jobs?.subscription_key ?? '');
    if (!RODIN_TOKEN_RE.test(token)) throw new GenerationError('Rodin returned no subscription key', 502);
    return { stage, id: taskId(json?.uuid, 'Rodin'), token };
  },
  poll: (ref, key) => ({ url: `${RODIN_API}/status`, method: 'POST', headers: rodinHeaders(key), body: { subscription_key: ref.token } }),
  parsePoll: (json) => {
    const list: any[] = Array.isArray(json?.jobs) ? json.jobs : [];
    if (!list.length) return { status: 'running', progress: 5 };
    const states = list.map((j) => String(j?.status || '').toLowerCase());
    if (states.includes('failed')) return { status: 'failed', error: 'Rodin could not generate this model' };
    const done = states.filter((s) => s === 'done').length;
    if (done === states.length) return { status: 'succeeded', progress: 100 };
    return { status: 'running', progress: Math.round(10 + (done / states.length) * 80) };
  },
  result: (ref, key) => ({ url: `${RODIN_API}/download`, method: 'POST', headers: rodinHeaders(key), body: { task_uuid: ref.id } }),
  parseResult: (json) => {
    const files: any[] = Array.isArray(json?.list) ? json.list : [];
    const glb = files.find((f) => /\.glb$/i.test(String(f?.name || ''))) || files.find((f) => /\.glb(\?|$)/i.test(String(f?.url || '')));
    return glb?.url ? { status: 'succeeded', progress: 100, resultUrl: String(glb.url) } : { status: 'failed', error: 'Rodin finished but returned no GLB file' };
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
  stageCount: (input) => (input.generator.removeBackground ? 2 : 1),
  create: (input, key) => ({
    url: `${FAL_QUEUE}/${model(input.generator, 'fal-ai/flux/schnell')}`,
    method: 'POST',
    headers: falHeaders(key),
    body: {
      prompt: imagePrompt(input),
      image_size: sheetFrames(input.generator) ? sheetPixelSize(sheetFrames(input.generator)) : input.generator.sprite ? 'square_hd' : 'landscape_16_9',
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
    body: { input: { prompt: imagePrompt(input), aspect_ratio: sheetFrames(input.generator) ? '21:9' : input.generator.sprite ? '1:1' : '16:9', output_format: 'png', num_outputs: 1 } },
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

// ---------------------------------------------------------------------------------------------- OpenRouter (images)
const OPENROUTER_API = 'https://openrouter.ai/api/v1/images';
const B64_RE = /^[A-Za-z0-9+/=\s]+$/;
const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp);base64,(.+)$/s;
/** Largest base64 image accepted in an answer (the decoded file is size-checked again). */
const MAX_B64 = 40 * 1024 * 1024;
const openrouter: ProviderSpec = {
  id: 'openrouter',
  label: 'OpenRouter',
  output: 'image',
  envKey: 'OPENROUTER_API_KEY',
  license: 'AI-generated via OpenRouter; rights per the terms of the chosen model',
  resultHosts: [],
  apiHosts: ['openrouter.ai'],
  sync: true,
  create: (input, key) => {
    const frames = sheetFrames(input.generator);
    return {
      url: OPENROUTER_API,
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://omnistage.local', 'X-Title': 'OmniStage' },
      body: {
        model: model(input.generator, 'google/gemini-2.5-flash-image'),
        prompt: imagePrompt(input),
        n: 1,
        aspect_ratio: frames ? '21:9' : input.generator.sprite ? '1:1' : '16:9',
        output_format: 'png',
      },
      timeoutMs: 180_000,
    };
  },
  parseCreate: (_json, stage) => ({ stage, id: 'sync' }),
  poll: () => {
    throw new GenerationError('OpenRouter images are not polled', 500);
  },
  parsePoll: () => ({ status: 'failed', error: 'not polled' }),
  parseSync: ({ json }) => {
    if (json?.error) return { error: `OpenRouter: ${String(json.error?.message || json.error).slice(0, 200)}` };
    let b64: unknown = json?.data?.[0]?.b64_json;
    // Chat-completions shape (some routes): a data URL in choices[0].message.images[0].image_url.url
    const chatUrl = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (typeof b64 !== 'string' && typeof chatUrl === 'string' && chatUrl.length <= MAX_B64 + 64) b64 = DATA_IMAGE_RE.exec(chatUrl)?.[1];
    if (typeof b64 !== 'string' || !b64 || b64.length > MAX_B64 || !B64_RE.test(b64)) {
      return { error: 'The model returned no image. Pick an image model such as google/gemini-2.5-flash-image.' };
    }
    return { data: Buffer.from(b64.replace(/\s+/g, ''), 'base64') };
  },
};

// ---------------------------------------------------------------------------------------------- ElevenLabs (audio)
const elevenTool = (input: GenerateInput): 'sfx' | 'music' => (input.generator.audio === 'music' ? 'music' : 'sfx');
const elevenlabs: ProviderSpec = {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  output: 'audio',
  envKey: 'ELEVENLABS_API_KEY',
  license: elevenLabsLicense('sfx'),
  licenseFor: (input) => elevenLabsLicense(elevenTool(input)),
  resultHosts: [],
  apiHosts: ['api.elevenlabs.io'],
  sync: true,
  create: (input, key) => {
    const tool = elevenTool(input);
    const req =
      tool === 'music'
        ? buildMusicRequest({ prompt: input.prompt, lengthSeconds: input.generator.durationSeconds })
        : buildSfxRequest({ prompt: input.prompt, durationSeconds: input.generator.durationSeconds });
    return {
      url: `${ELEVENLABS_API}${req.path}?${new URLSearchParams(req.query).toString()}`,
      method: 'POST',
      headers: { 'xi-api-key': key, Accept: 'audio/mpeg' },
      body: req.body,
      binary: true,
      timeoutMs: tool === 'music' ? 300_000 : 120_000,
    };
  },
  parseCreate: (_json, stage) => ({ stage, id: 'sync' }),
  poll: () => {
    throw new GenerationError('ElevenLabs audio is not polled', 500);
  },
  parsePoll: () => ({ status: 'failed', error: 'not polled' }),
  parseSync: ({ bytes }) => (bytes?.length ? { data: bytes } : { error: 'ElevenLabs returned an empty file' }),
};

export const PROVIDERS: Record<GenerationProviderId, ProviderSpec> = { meshy, tripo, rodin, fal, replicate, openrouter, elevenlabs };

/** First stage name per provider (Meshy starts with a mesh preview, fal with the raw image). */
export function firstStage(provider: GenerationProviderId, generator?: ExtensionGenerator): string {
  if (provider === 'meshy') return generator?.input === 'image' ? 'image' : 'preview';
  return provider === 'fal' ? 'image' : 'generate';
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
