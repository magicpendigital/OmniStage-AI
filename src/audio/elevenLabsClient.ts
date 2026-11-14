/**
 * Phase 10D — studio side of ElevenLabs (BYO key): speaks dialogue lines, makes SFX / music, and records every generated
 * file with its licence in the project library (or the personal library outside a project). Studio-only: never imported
 * by the Player or the runtime. The key goes to the local OmniStage server as a header only.
 */
import type { DialogueLine, SettingsConfig } from '../types/scene.schema';
import { workspaceApi, type LibraryAsset } from '../workspace/workspaceClient';
import { DEFAULT_ELEVENLABS_TTS_MODEL, elevenLabsLicense, elevenLabsLicenseRecord, ElevenLabsTool, pcm16leToFloat32 } from './elevenLabs';
import { encodeWavMono16, VoiceClip } from './voices';

export type ElevenLabsSettings = Pick<SettingsConfig, 'elevenLabsApiKey' | 'elevenLabsModel'>;

export function elevenLabsHeaders(settings: ElevenLabsSettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = settings.elevenLabsApiKey?.trim();
  if (key) headers['x-elevenlabs-key'] = key;
  return headers;
}

/** Library scope for generated files: the open project, else the personal library. */
export function libraryScopeFor(projectId: string | null | undefined): string {
  return projectId ? `project:${projectId}` : 'personal';
}

async function errorOf(res: Response): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error || `ElevenLabs proxy returned ${res.status}`;
}

export async function elevenLabsStatus(settings: ElevenLabsSettings): Promise<{ configured: boolean; serverKey: boolean }> {
  try {
    const res = await fetch('/api/media/elevenlabs/status', { headers: elevenLabsHeaders(settings) });
    return res.ok ? await res.json() : { configured: false, serverKey: false };
  } catch {
    return { configured: false, serverKey: false };
  }
}

export async function listElevenLabsVoices(settings: ElevenLabsSettings): Promise<Array<{ id: string; name: string; category?: string }>> {
  const res = await fetch('/api/media/elevenlabs/voices', { headers: elevenLabsHeaders(settings) });
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()).voices || [];
}

/** One dialogue line spoken by an ElevenLabs voice, as a mono PCM clip. */
export async function synthesizeElevenLabsLine(
  line: Pick<DialogueLine, 'text' | 'emotion'>,
  voiceId: string,
  settings: ElevenLabsSettings
): Promise<{ clip: VoiceClip; model: string }> {
  const modelId = settings.elevenLabsModel?.trim() || DEFAULT_ELEVENLABS_TTS_MODEL;
  const res = await fetch('/api/media/elevenlabs/tts', {
    method: 'POST',
    headers: elevenLabsHeaders(settings),
    body: JSON.stringify({ text: line.text, voiceId, modelId, emotion: line.emotion }),
  });
  if (!res.ok) throw new Error(await errorOf(res));
  const sampleRate = Number(res.headers.get('x-sample-rate')) || 24000;
  const data = pcm16leToFloat32(new Uint8Array(await res.arrayBuffer()));
  if (!data.length) throw new Error('ElevenLabs returned no audio');
  return { clip: { sampleRate, data }, model: res.headers.get('x-model') || modelId };
}

/** SFX or music from a text prompt (MP3). */
export async function generateElevenLabsAudio(
  tool: Exclude<ElevenLabsTool, 'tts'>,
  prompt: string,
  settings: ElevenLabsSettings,
  seconds?: number
): Promise<Blob> {
  const res = await fetch(`/api/media/elevenlabs/${tool}`, {
    method: 'POST',
    headers: elevenLabsHeaders(settings),
    body: JSON.stringify(tool === 'sfx' ? { prompt, durationSeconds: seconds } : { prompt, lengthSeconds: seconds }),
  });
  if (!res.ok) throw new Error(await errorOf(res));
  return res.blob();
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';

/**
 * Saves a generated file in the library with source "elevenlabs", the short licence line and the full licence record
 * (`meta.licence`). Returns null when the local workspace is not reachable (the clip itself still works).
 */
export async function recordElevenLabsAsset(
  scope: string,
  tool: ElevenLabsTool,
  data: Blob,
  details: { prompt: string; model?: string; voiceId?: string; name?: string }
): Promise<LibraryAsset | null> {
  try {
    const ext = tool === 'tts' ? 'wav' : 'mp3';
    const file = new File([data], `${slug(details.name || details.prompt)}-${tool}.${ext}`, { type: tool === 'tts' ? 'audio/wav' : 'audio/mpeg' });
    const asset = await workspaceApi.uploadToLibrary(scope, file, { tags: ['elevenlabs', tool === 'tts' ? 'voice' : tool], source: 'elevenlabs', license: elevenLabsLicense(tool) });
    return await workspaceApi.updateAsset(scope, asset.id, { meta: { licence: elevenLabsLicenseRecord(tool, details) } });
  } catch {
    return null;
  }
}

/** WAV bytes of a voice clip, for the library copy. */
export function clipToWavBlob(clip: VoiceClip): Blob {
  return new Blob([encodeWavMono16(clip.data, clip.sampleRate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
}
