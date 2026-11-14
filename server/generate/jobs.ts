/**
 * Phase 6 Batch 3 — generation jobs. A job runs one provider task (or a short chain: Meshy preview → refine,
 * fal image → background cut-out) and, when it succeeds, downloads the result and saves it to the personal or
 * project library with source + licence + the prompt.
 *
 * Keys are never stored: the studio sends the key with every start/poll request (header `x-generate-key`),
 * and it is only used to build the upstream request. Jobs live in memory and expire after JOB_TTL_MS.
 */
import { randomBytes } from 'node:crypto';
import type { ExtensionGenerator, GenerationOutput, GenerationProviderId } from '../../src/extensions/types';
import { GENERATION_PROVIDERS } from '../../src/extensions/types';
import { elevenLabsLicenseRecord } from '../../src/audio/elevenLabs';
import type { AssetStore, LibraryAsset } from '../workspace/assets';
import { MAX_ASSET_BYTES } from '../workspace/assets';
import {
  cleanPrompt,
  firstStage,
  GenerateInput,
  GenerationError,
  PollResult,
  PROVIDERS,
  sheetFrames,
  SyncResult,
  ProviderSpec,
  safeUrl,
  TaskRef,
  upstreamErrorMessage,
  UpstreamRequest,
} from './providers';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export interface GenerationJobView {
  id: string;
  provider: GenerationProviderId;
  extensionId: string;
  generatorId: string;
  prompt: string;
  scope: string;
  stage: string;
  status: 'running' | 'succeeded' | 'failed';
  /** 0–100 across all stages. */
  progress: number;
  error?: string;
  asset?: LibraryAsset;
  createdAt: string;
}

interface Job extends GenerationJobView {
  input: GenerateInput;
  ref: TaskRef;
  stageIndex: number;
  stageCount: number;
  thumbnailUrl?: string;
  lastPolledAt: number;
  polling?: Promise<GenerationJobView>;
  /** One-shot providers: the request runs in the background; polls only report where it is. */
  sync?: boolean;
  expiresAt: number;
}

export const JOB_TTL_MS = 2 * 60 * 60 * 1000;
export const MIN_POLL_MS = 2000;
export const MAX_ACTIVE_JOBS = 8;
const jobs = new Map<string, Job>();

export interface JobDeps {
  fetch: FetchLike;
  store: AssetStore;
  now?: () => number;
}

function view(job: Job): GenerationJobView {
  const { id, provider, extensionId, generatorId, prompt, scope, stage, status, progress, error, asset, createdAt } = job;
  return { id, provider, extensionId, generatorId, prompt, scope, stage, status, progress, error, asset, createdAt };
}

function sweep(now: number) {
  for (const [id, job] of jobs) if (job.expiresAt < now) jobs.delete(id);
}

function formBody(form: NonNullable<UpstreamRequest['form']>): FormData {
  const fd = new FormData();
  for (const [name, value] of Object.entries(form)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string') fd.append(name, v);
      else fd.append(name, new Blob([new Uint8Array(v.data)], { type: v.type }), v.filename);
    }
  }
  return fd;
}

async function call(spec: ProviderSpec, req: UpstreamRequest, key: string, deps: JobDeps): Promise<any> {
  const host = new URL(req.url).hostname;
  if (!spec.apiHosts.includes(host)) throw new GenerationError(`Refusing to call ${host} for ${spec.label}`, 502);
  const timeoutMs = req.timeoutMs ?? 30_000;
  let res: Response;
  try {
    const jsonBody = req.body !== undefined && !req.form;
    res = await deps.fetch(req.url, {
      method: req.method,
      headers: { Accept: 'application/json', ...(jsonBody ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'OmniStage/1.0 (generate)', ...req.headers },
      body: req.form ? (formBody(req.form) as any) : jsonBody ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    throw new GenerationError(`Could not reach ${spec.label} (${e?.name === 'TimeoutError' ? 'timeout' : 'network error'})`, 502);
  }
  if (req.binary && res.ok) {
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_ASSET_BYTES) throw new GenerationError('The generated file is larger than 200 MB', 413);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_ASSET_BYTES) throw new GenerationError('The generated file is larger than 200 MB', 413);
    return { bytes, contentType: res.headers.get('content-type') || '' };
  }
  const text = await res.text();
  if (!res.ok) throw new GenerationError(upstreamErrorMessage(spec.label, res.status, text, key), res.status === 401 || res.status === 403 ? 401 : 502);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new GenerationError(`${spec.label} returned something that is not JSON`, 502);
  }
}

const MAGIC: Array<{ ext: string; output: GenerationOutput; test: (b: Buffer) => boolean }> = [
  { ext: '.glb', output: 'model', test: (b) => b.subarray(0, 4).toString('latin1') === 'glTF' },
  { ext: '.png', output: 'image', test: (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' },
  { ext: '.jpg', output: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.webp', output: 'image', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: '.wav', output: 'audio', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { ext: '.mp3', output: 'audio', test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) },
  { ext: '.ogg', output: 'audio', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
];

const EXPECTED: Record<GenerationOutput, string> = { model: 'a GLB model', image: 'a PNG/JPEG/WebP image', audio: 'an MP3/WAV/OGG audio file' };

/** File extension from the bytes (never from the URL or Content-Type); throws when it isn't what we asked for. */
export function sniffResult(data: Buffer, output: GenerationOutput): string {
  const hit = MAGIC.find((m) => m.test(data));
  if (!hit || hit.output !== output) throw new GenerationError(`The provider returned an unexpected file (expected ${EXPECTED[output]})`, 502);
  return hit.ext;
}

/** Pixel size of a PNG or JPEG (null for anything else); used to describe generated sprite sheets. */
export function imageSize(data: Buffer): { width: number; height: number } | null {
  if (data.length > 24 && data[0] === 0x89 && data.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** SpriteSheetSpec for a generated strip of `frames` cells (2D nodes animate it when placed). */
export function sheetMeta(data: Buffer, frames: number) {
  const size = imageSize(data);
  if (!size || !frames) return undefined;
  const frameWidth = Math.floor(size.width / frames);
  return { frameWidth, frameHeight: size.height, columns: frames, frameCount: frames, fps: 8, loop: true };
}

async function download(spec: ProviderSpec, rawUrl: string | undefined, deps: JobDeps): Promise<Buffer> {
  const url = safeUrl(rawUrl, spec.resultHosts);
  if (!url) throw new GenerationError(`${spec.label} returned a result URL OmniStage will not download`, 502);
  let res: Response;
  try {
    res = await deps.fetch(url.toString(), { method: 'GET', headers: { 'User-Agent': 'OmniStage/1.0 (generate)' }, signal: AbortSignal.timeout(180_000) });
  } catch {
    throw new GenerationError(`Could not download the result from ${spec.label}`, 502);
  }
  if (!res.ok) throw new GenerationError(`Downloading the result from ${spec.label} failed (${res.status})`, 502);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_ASSET_BYTES) throw new GenerationError('The generated file is larger than 200 MB', 413);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_ASSET_BYTES) throw new GenerationError('The generated file is larger than 200 MB', 413);
  return data;
}

function nameFromPrompt(prompt: string): string {
  const words = prompt.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return (words || 'Generated asset').slice(0, 60);
}

export interface StartInput {
  extensionId: string;
  generator: ExtensionGenerator;
  prompt: unknown;
  scope: string;
  /** Image-to-3D: the library picture (already read and sniffed by the route). */
  image?: { data: Buffer; mime: string };
}

export async function startGeneration(input: StartInput, key: string, deps: JobDeps): Promise<GenerationJobView> {
  const now = (deps.now || Date.now)();
  sweep(now);
  const spec = PROVIDERS[input.generator.provider];
  if (!spec) throw new GenerationError('Unknown generation provider');
  if (spec.output !== input.generator.output) throw new GenerationError(`${spec.label} generates ${spec.output}s`);
  const imageMode = input.generator.input === 'image';
  if (imageMode && !GENERATION_PROVIDERS[spec.id].imageInput) throw new GenerationError(`${spec.label} cannot start from a picture`);
  if (imageMode && !input.image) throw new GenerationError('Pick a picture from your library to turn into a 3D model.');
  if (!key) throw new GenerationError(`Add your ${spec.label} API key in Settings → Generation keys first.`, 401);
  const active = [...jobs.values()].filter((j) => j.status === 'running').length;
  if (active >= MAX_ACTIVE_JOBS) throw new GenerationError(`At most ${MAX_ACTIVE_JOBS} generations can run at once`, 429);
  // An image-to-3D prompt is optional (it only guides the texture); everything else needs one.
  const prompt = imageMode && String(input.prompt ?? '').trim().length < 3 ? '' : cleanPrompt(input.prompt);
  const genInput: GenerateInput = { prompt, generator: input.generator, ...(imageMode ? { image: input.image } : {}) };
  const stage = firstStage(spec.id, input.generator);
  const base = {
    id: randomBytes(12).toString('hex'),
    provider: spec.id,
    extensionId: input.extensionId,
    generatorId: input.generator.id,
    prompt: prompt || 'Model from a picture',
    scope: input.scope,
    stage,
    status: 'running' as const,
    progress: 1,
    createdAt: new Date(now).toISOString(),
    input: genInput,
    stageIndex: 0,
    stageCount: Math.max(1, spec.stageCount?.(genInput) ?? 1),
    lastPolledAt: now,
    expiresAt: now + JOB_TTL_MS,
  };
  if (spec.sync) {
    // One request returns the asset; run it in the background so a poll never waits on it.
    const job: Job = { ...base, ref: { stage, id: 'sync' }, sync: true, progress: 5 };
    jobs.set(job.id, job);
    void runSync(job, spec, key, deps);
    return view(job);
  }
  const ref = spec.parseCreate(await call(spec, spec.create(genInput, key), key, deps), stage);
  const job: Job = { ...base, ref };
  // The picture is only needed for the create request; do not keep it in memory for two hours.
  delete job.input.image;
  jobs.set(job.id, job);
  return view(job);
}

async function runSync(job: Job, spec: ProviderSpec, key: string, deps: JobDeps): Promise<void> {
  try {
    const res = await call(spec, spec.create(job.input, key), key, deps);
    const out: SyncResult = spec.parseSync ? spec.parseSync(res?.bytes ? res : { json: res }) : { error: 'Provider answered nothing usable' };
    if (out.error) throw new GenerationError(out.error, 502);
    const data = out.data ?? (out.resultUrl ? await download(spec, out.resultUrl, deps) : undefined);
    if (!data?.length) throw new GenerationError(`${spec.label} returned an empty file`, 502);
    if (data.length > MAX_ASSET_BYTES) throw new GenerationError('The generated file is larger than 200 MB', 413);
    await saveResult(job, spec, data, deps);
  } catch (e: any) {
    job.status = 'failed';
    job.error = e?.message || 'Generation failed';
  }
}

async function advance(job: Job, key: string, deps: JobDeps): Promise<void> {
  const spec = PROVIDERS[job.provider];
  let result: PollResult = spec.parsePoll(await call(spec, spec.poll(job.ref, key), key, deps), job.ref);
  if (result.status === 'succeeded' && !result.resultUrl && spec.result && spec.parseResult) {
    result = spec.parseResult(await call(spec, spec.result(job.ref, key), key, deps));
  }
  if (result.status === 'running') {
    const within = (result.progress ?? 0) / 100;
    job.progress = Math.max(job.progress, Math.min(99, Math.round(((job.stageIndex + within) / job.stageCount) * 100)));
    return;
  }
  if (result.status === 'failed') {
    job.status = 'failed';
    job.error = result.error || `${spec.label} could not generate this`;
    return;
  }
  if (result.thumbnailUrl) job.thumbnailUrl = result.thumbnailUrl;
  const next = spec.next?.(job.ref, result, job.input, key);
  if (next) {
    job.ref = spec.parseCreate(await call(spec, next.request, key, deps), next.stage);
    job.stage = next.stage;
    job.stageIndex += 1;
    job.progress = Math.round((job.stageIndex / job.stageCount) * 100);
    return;
  }
  job.stage = 'saving';
  await saveResult(job, spec, await download(spec, result.resultUrl, deps), deps);
}

const TAG_BY_OUTPUT: Record<GenerationOutput, string> = { model: '3d', image: '2d', audio: 'audio' };

/** Sniffs the bytes and saves them to the library with source, licence and the prompt. */
async function saveResult(job: Job, spec: ProviderSpec, data: Buffer, deps: JobDeps): Promise<void> {
  job.stage = 'saving';
  const generator = job.input.generator;
  const output = generator.output;
  const ext = sniffResult(data, output);
  const frames = output === 'image' ? sheetFrames(generator) : 0;
  const sheet = frames ? sheetMeta(data, frames) : undefined;
  const name = nameFromPrompt(job.prompt);
  const audioTool = generator.audio === 'music' ? 'music' : 'sfx';
  const kind = output === 'model' ? 'model' : output === 'audio' ? 'audio' : sheet || generator.sprite ? 'spritesheet' : 'image';
  const tags = ['generated', spec.id, TAG_BY_OUTPUT[output]];
  if (output === 'audio') tags.push(audioTool);
  if (sheet) tags.push('animated');
  if (generator.input === 'image') tags.push('from-image');
  job.asset = await deps.store.add({
    filename: `${name}${ext}`,
    data,
    name,
    kind,
    tags,
    source: spec.id,
    license: spec.licenseFor?.(job.input) ?? spec.license,
    meta: {
      generated: true,
      prompt: job.prompt,
      provider: spec.id,
      extensionId: job.extensionId,
      generatorId: job.generatorId,
      model: generator.model,
      ...(job.ref.id !== 'sync' ? { taskId: job.ref.id } : {}),
      ...(sheet ? { spriteSheet: sheet } : generator.sprite ? { spriteSheet: { columns: 1, rows: 1 } } : {}),
      ...(output === 'image' && (generator.sprite || sheet) ? { transparent: !!generator.removeBackground } : {}),
      ...(spec.id === 'elevenlabs' ? { audioKind: audioTool, licence: elevenLabsLicenseRecord(audioTool, { prompt: job.prompt }) } : {}),
      generatedAt: new Date().toISOString(),
    },
  });
  delete job.input.image;
  job.stage = 'done';
  job.status = 'succeeded';
  job.progress = 100;
}

/**
 * Advances a job by at most one upstream poll (throttled to MIN_POLL_MS; concurrent callers share the same
 * poll). Errors fail the job, except a rejected key, which the user can fix and retry.
 */
export async function pollGeneration(id: string, key: string, deps: JobDeps): Promise<GenerationJobView> {
  const job = jobs.get(String(id));
  if (!job) throw new GenerationError('Generation not found (it may have expired)', 404);
  if (job.status !== 'running' || job.sync) return view(job);
  if (job.polling) return job.polling;
  const now = (deps.now || Date.now)();
  if (now - job.lastPolledAt < MIN_POLL_MS) return view(job);
  if (!key) throw new GenerationError(`Missing the ${PROVIDERS[job.provider].label} API key`, 401);
  job.lastPolledAt = now;
  job.polling = advance(job, key, deps)
    .catch((e: any) => {
      if (e instanceof GenerationError && e.status === 401) throw e;
      job.status = 'failed';
      job.error = e?.message || 'Generation failed';
    })
    .then(() => view(job))
    .finally(() => {
      job.polling = undefined;
    });
  return job.polling;
}

export function listGenerations(): GenerationJobView[] {
  return [...jobs.values()].map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Test helper. */
export function _resetGenerationJobs() {
  jobs.clear();
}
