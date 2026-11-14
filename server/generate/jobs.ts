/**
 * Phase 6 Batch 3 — generation jobs. A job runs one provider task (or a short chain: Meshy preview → refine,
 * fal image → background cut-out) and, when it succeeds, downloads the result and saves it to the personal or
 * project library with source + licence + the prompt.
 *
 * Keys are never stored: the studio sends the key with every start/poll request (header `x-generate-key`),
 * and it is only used to build the upstream request. Jobs live in memory and expire after JOB_TTL_MS.
 */
import { randomBytes } from 'node:crypto';
import type { ExtensionGenerator, GenerationProviderId } from '../../src/extensions/types';
import type { AssetStore, LibraryAsset } from '../workspace/assets';
import { MAX_ASSET_BYTES } from '../workspace/assets';
import {
  cleanPrompt,
  firstStage,
  GenerateInput,
  GenerationError,
  PollResult,
  PROVIDERS,
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

async function call(spec: ProviderSpec, req: UpstreamRequest, key: string, deps: JobDeps): Promise<any> {
  const host = new URL(req.url).hostname;
  if (!spec.apiHosts.includes(host)) throw new GenerationError(`Refusing to call ${host} for ${spec.label}`, 502);
  let res: Response;
  try {
    res = await deps.fetch(req.url, {
      method: req.method,
      headers: { Accept: 'application/json', ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'OmniStage/1.0 (generate)', ...req.headers },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    throw new GenerationError(`Could not reach ${spec.label} (${e?.name === 'TimeoutError' ? 'timeout' : 'network error'})`, 502);
  }
  const text = await res.text();
  if (!res.ok) throw new GenerationError(upstreamErrorMessage(spec.label, res.status, text, key), res.status === 401 || res.status === 403 ? 401 : 502);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new GenerationError(`${spec.label} returned something that is not JSON`, 502);
  }
}

const MAGIC: Array<{ ext: string; test: (b: Buffer) => boolean }> = [
  { ext: '.glb', test: (b) => b.subarray(0, 4).toString('latin1') === 'glTF' },
  { ext: '.png', test: (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG' },
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/** File extension from the bytes (never from the URL or Content-Type); throws when it isn't what we asked for. */
export function sniffResult(data: Buffer, output: 'model' | 'image'): string {
  const hit = MAGIC.find((m) => m.test(data));
  if (!hit || (output === 'model') !== (hit.ext === '.glb')) throw new GenerationError(`The provider returned an unexpected file (expected ${output === 'model' ? 'a GLB model' : 'a PNG/JPEG/WebP image'})`, 502);
  return hit.ext;
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
}

export async function startGeneration(input: StartInput, key: string, deps: JobDeps): Promise<GenerationJobView> {
  const now = (deps.now || Date.now)();
  sweep(now);
  const spec = PROVIDERS[input.generator.provider];
  if (!spec) throw new GenerationError('Unknown generation provider');
  if (spec.output !== input.generator.output) throw new GenerationError(`${spec.label} generates ${spec.output}s`);
  if (!key) throw new GenerationError(`Add your ${spec.label} API key in Settings → Generation keys first.`, 401);
  const active = [...jobs.values()].filter((j) => j.status === 'running').length;
  if (active >= MAX_ACTIVE_JOBS) throw new GenerationError(`At most ${MAX_ACTIVE_JOBS} generations can run at once`, 429);
  const genInput: GenerateInput = { prompt: cleanPrompt(input.prompt), generator: input.generator };
  const stage = firstStage(spec.id);
  const ref = spec.parseCreate(await call(spec, spec.create(genInput, key), key, deps), stage);
  const stageCount = (spec.id === 'meshy' && input.generator.texture !== false) || (spec.id === 'fal' && input.generator.removeBackground) ? 2 : 1;
  const job: Job = {
    id: randomBytes(12).toString('hex'),
    provider: spec.id,
    extensionId: input.extensionId,
    generatorId: input.generator.id,
    prompt: genInput.prompt,
    scope: input.scope,
    stage,
    status: 'running',
    progress: 1,
    createdAt: new Date(now).toISOString(),
    input: genInput,
    ref,
    stageIndex: 0,
    stageCount,
    lastPolledAt: now,
    expiresAt: now + JOB_TTL_MS,
  };
  jobs.set(job.id, job);
  return view(job);
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
  const data = await download(spec, result.resultUrl, deps);
  const ext = sniffResult(data, job.input.generator.output);
  const name = nameFromPrompt(job.prompt);
  job.asset = await deps.store.add({
    filename: `${name}${ext}`,
    data,
    name,
    kind: job.input.generator.output === 'model' ? 'model' : job.input.generator.sprite ? 'spritesheet' : 'image',
    tags: ['generated', spec.id, job.input.generator.output === 'model' ? '3d' : '2d'],
    source: spec.id,
    license: spec.license,
    meta: {
      generated: true,
      prompt: job.prompt,
      provider: spec.id,
      extensionId: job.extensionId,
      generatorId: job.generatorId,
      model: job.input.generator.model,
      taskId: job.ref.id,
      ...(job.input.generator.sprite ? { spriteSheet: { columns: 1, rows: 1 }, transparent: !!job.input.generator.removeBackground } : {}),
      generatedAt: new Date().toISOString(),
    },
  });
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
  if (job.status !== 'running') return view(job);
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
