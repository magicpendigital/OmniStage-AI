/**
 * Phase 10D — ElevenLabs (paid production tool, bring your own key): request builders, PCM decoding and the licence
 * record saved with every generated file. Pure module shared by the local server proxy (server/media/elevenLabs.ts) and
 * the studio (src/audio/elevenLabsClient.ts). The key never passes through here: the server adds it as `xi-api-key`.
 */
import type { DialogueEmotion } from '../types/scene.schema';

export const ELEVENLABS_API = 'https://api.elevenlabs.io';
export const DEFAULT_ELEVENLABS_TTS_MODEL = 'eleven_multilingual_v2';
/** Raw 16-bit mono PCM: decodes without WebAudio and is available on every ElevenLabs plan. */
export const ELEVENLABS_TTS_FORMAT = 'pcm_24000';
export const ELEVENLABS_TTS_SAMPLE_RATE = 24000;
export const ELEVENLABS_MEDIA_FORMAT = 'mp3_44100_128';
export const ELEVENLABS_TERMS_URL = 'https://elevenlabs.io/terms-of-use';

export type ElevenLabsTool = 'tts' | 'sfx' | 'music';

export function isElevenLabsVoiceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9]{8,40}$/.test(id);
}

export function isElevenLabsModelId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9_]{3,60}$/.test(id);
}

/** Delivery per emotion through voice settings (works on every TTS model). */
export function emotionVoiceSettings(emotion: DialogueEmotion | undefined): { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean } {
  switch (emotion) {
    case 'excited':
    case 'angry':
      return { stability: 0.3, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true };
    case 'happy':
      return { stability: 0.4, similarity_boost: 0.75, style: 0.45, use_speaker_boost: true };
    case 'sad':
    case 'scared':
      return { stability: 0.45, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true };
    case 'whisper':
      return { stability: 0.6, similarity_boost: 0.8, style: 0.2, use_speaker_boost: false };
    default:
      return { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true };
  }
}

/** Audio tags understood by Eleven v3 models (other models would read them aloud, so they only get voice settings). */
const V3_TAGS: Partial<Record<DialogueEmotion, string>> = {
  happy: '[happy]',
  excited: '[excited]',
  sad: '[sad]',
  angry: '[angry]',
  scared: '[nervous]',
  whisper: '[whispers]',
};

export interface ElevenLabsRequest {
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
}

export function buildTtsRequest(input: { text: string; voiceId: string; modelId?: string; emotion?: DialogueEmotion }): ElevenLabsRequest {
  const text = String(input.text ?? '').trim();
  if (!text) throw new Error('text is required');
  if (text.length > 2500) throw new Error('A dialogue line must be under 2500 characters');
  if (!isElevenLabsVoiceId(input.voiceId)) throw new Error('Invalid ElevenLabs voice id');
  const modelId = isElevenLabsModelId(input.modelId) ? input.modelId : DEFAULT_ELEVENLABS_TTS_MODEL;
  const tag = /^eleven_v3/.test(modelId) && input.emotion ? V3_TAGS[input.emotion] : undefined;
  return {
    path: `/v1/text-to-speech/${input.voiceId}`,
    query: { output_format: ELEVENLABS_TTS_FORMAT },
    body: { text: tag ? `${tag} ${text}` : text, model_id: modelId, voice_settings: emotionVoiceSettings(input.emotion) },
  };
}

export function buildSfxRequest(input: { prompt: string; durationSeconds?: number }): ElevenLabsRequest {
  const prompt = String(input.prompt ?? '').trim().slice(0, 450);
  if (!prompt) throw new Error('prompt is required');
  const d = Number(input.durationSeconds);
  return {
    path: '/v1/sound-generation',
    query: { output_format: ELEVENLABS_MEDIA_FORMAT },
    body: { text: prompt, ...(Number.isFinite(d) && d > 0 ? { duration_seconds: Math.max(0.5, Math.min(22, d)) } : {}), prompt_influence: 0.4 },
  };
}

export function buildMusicRequest(input: { prompt: string; lengthSeconds?: number }): ElevenLabsRequest {
  const prompt = String(input.prompt ?? '').trim().slice(0, 2000);
  if (!prompt) throw new Error('prompt is required');
  const len = Number(input.lengthSeconds);
  const seconds = Number.isFinite(len) && len > 0 ? Math.max(10, Math.min(300, len)) : 30;
  return {
    path: '/v1/music',
    query: { output_format: ELEVENLABS_MEDIA_FORMAT },
    body: { prompt, music_length_ms: Math.round(seconds * 1000) },
  };
}

/** Little-endian signed 16-bit PCM → float samples. */
export function pcm16leToFloat32(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Short licence line for the library index (the workspace keeps at most 80 characters). */
export function elevenLabsLicense(tool: ElevenLabsTool): string {
  return `ElevenLabs AI ${tool === 'tts' ? 'voice' : tool === 'sfx' ? 'SFX' : 'music'} · commercial use per your plan`;
}

export interface ElevenLabsLicenseRecord {
  provider: 'elevenlabs';
  tool: ElevenLabsTool;
  model?: string;
  voiceId?: string;
  /** The text spoken or the prompt (what was generated). */
  prompt: string;
  generatedAt: string;
  terms: string;
  note: string;
}

/** Full licence record kept in the library asset's `meta.licence` so a project can prove where each file came from. */
export function elevenLabsLicenseRecord(tool: ElevenLabsTool, details: { prompt: string; model?: string; voiceId?: string; now?: Date }): ElevenLabsLicenseRecord {
  return {
    provider: 'elevenlabs',
    tool,
    ...(details.model ? { model: details.model } : {}),
    ...(details.voiceId ? { voiceId: details.voiceId } : {}),
    prompt: String(details.prompt ?? '').slice(0, 2000),
    generatedAt: (details.now ?? new Date()).toISOString(),
    terms: ELEVENLABS_TERMS_URL,
    note: 'Generated with the creator\'s own ElevenLabs key. Paid plans include a commercial licence; free plans require attribution and are non-commercial.',
  };
}

/** Removes a secret from text that might be shown or logged (upstream errors sometimes echo request headers). */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('[redacted]');
}
