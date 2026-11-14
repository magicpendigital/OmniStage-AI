/**
 * Phase 10D — ElevenLabs proxy for the studio (paid production tool, bring your own key).
 *
 * The key arrives in the `x-elevenlabs-key` header (Settings → Production tools) or from ELEVENLABS_API_KEY on the server
 * (used only for requests from this computer, so devices on the LAN cannot spend it). It is sent upstream as `xi-api-key`
 * and never logged, echoed, or stored. Responses are the raw audio; the studio saves files and licence records to the
 * project library.
 */
import express, { type Express, type Request, type Response } from 'express';
import { isLoopbackRequest } from '../ai/index';
import {
  buildMusicRequest,
  buildSfxRequest,
  buildTtsRequest,
  ELEVENLABS_API,
  ELEVENLABS_TTS_SAMPLE_RATE,
  ElevenLabsRequest,
  elevenLabsLicense,
  redactSecret,
} from '../../src/audio/elevenLabs';

export class ElevenLabsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ElevenLabsError';
  }
}

/** Key for this request, or undefined when none is configured. */
export function elevenLabsKey(req: Pick<Request, 'headers' | 'socket'>): string | undefined {
  const v = req.headers['x-elevenlabs-key'];
  const fromHeader = (Array.isArray(v) ? v[0] : v)?.trim();
  if (fromHeader) return fromHeader;
  const env = process.env.ELEVENLABS_API_KEY?.trim();
  return env && isLoopbackRequest(req) ? env : undefined;
}

/** Calls ElevenLabs and returns the response bytes. Errors never contain the key. */
export async function callElevenLabs(
  key: string,
  request: ElevenLabsRequest | { path: string; method: 'GET'; query?: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 180_000
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const query = new URLSearchParams(request.query || {}).toString();
  const url = `${ELEVENLABS_API}${request.path}${query ? `?${query}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isGet = 'method' in request;
    const res = await fetchImpl(url, {
      method: isGet ? 'GET' : 'POST',
      headers: { 'xi-api-key': key, ...(isGet ? {} : { 'Content-Type': 'application/json' }) },
      body: isGet ? undefined : JSON.stringify((request as ElevenLabsRequest).body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = redactSecret((await res.text().catch(() => '')).slice(0, 300), key);
      const status = res.status === 401 || res.status === 403 ? 401 : res.status === 429 ? 429 : 502;
      throw new ElevenLabsError(`ElevenLabs returned ${res.status}${detail ? `: ${detail}` : ''}`, status);
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
  } catch (e: any) {
    if (e instanceof ElevenLabsError) throw e;
    throw new ElevenLabsError(redactSecret(e?.name === 'AbortError' ? 'ElevenLabs timed out' : `ElevenLabs request failed: ${e?.message || e}`, key), 502);
  } finally {
    clearTimeout(timer);
  }
}

function fail(res: Response, error: any) {
  const status = error instanceof ElevenLabsError ? error.status : 400;
  res.status(status).json({ error: error?.message || 'ElevenLabs request failed' });
}

export function registerElevenLabsRoutes(app: Express, fetchImpl: typeof fetch = fetch) {
  const r = express.Router();
  const withKey = (handler: (key: string, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    const key = elevenLabsKey(req);
    if (!key) {
      res.status(503).json({ error: 'ElevenLabs key not configured (Settings → Production tools, or ELEVENLABS_API_KEY).' });
      return;
    }
    try {
      await handler(key, req, res);
    } catch (e) {
      fail(res, e);
    }
  };
  const sendAudio = (res: Response, bytes: Uint8Array, contentType: string, tool: 'tts' | 'sfx' | 'music', extra: Record<string, string> = {}) => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('x-omni-license', encodeURIComponent(elevenLabsLicense(tool)));
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(Buffer.from(bytes));
  };

  r.get('/status', (req, res) => {
    res.json({ configured: !!elevenLabsKey(req), serverKey: !!process.env.ELEVENLABS_API_KEY?.trim() && isLoopbackRequest(req) });
  });

  r.get('/voices', withKey(async (key, _req, res) => {
    const { bytes } = await callElevenLabs(key, { path: '/v1/voices', method: 'GET' }, fetchImpl, 30_000);
    const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const voices = (Array.isArray(json?.voices) ? json.voices : []).slice(0, 200).map((v: any) => ({
      id: String(v.voice_id || ''),
      name: String(v.name || '').slice(0, 60),
      category: v.category ? String(v.category) : undefined,
      labels: v.labels && typeof v.labels === 'object' ? v.labels : undefined,
    })).filter((v: any) => v.id);
    res.json({ voices });
  }));

  r.post('/tts', withKey(async (key, req, res) => {
    const body = req.body ?? {};
    const request = buildTtsRequest({ text: body.text, voiceId: body.voiceId, modelId: body.modelId, emotion: body.emotion });
    const { bytes } = await callElevenLabs(key, request, fetchImpl);
    sendAudio(res, bytes, 'audio/pcm', 'tts', { 'x-sample-rate': String(ELEVENLABS_TTS_SAMPLE_RATE), 'x-model': String(request.body.model_id) });
  }));

  r.post('/sfx', withKey(async (key, req, res) => {
    const { bytes, contentType } = await callElevenLabs(key, buildSfxRequest({ prompt: req.body?.prompt, durationSeconds: req.body?.durationSeconds }), fetchImpl);
    sendAudio(res, bytes, contentType.startsWith('audio/') ? contentType : 'audio/mpeg', 'sfx');
  }));

  r.post('/music', withKey(async (key, req, res) => {
    const { bytes, contentType } = await callElevenLabs(key, buildMusicRequest({ prompt: req.body?.prompt, lengthSeconds: req.body?.lengthSeconds }), fetchImpl, 300_000);
    sendAudio(res, bytes, contentType.startsWith('audio/') ? contentType : 'audio/mpeg', 'music');
  }));

  app.use('/api/media/elevenlabs', r);
}
