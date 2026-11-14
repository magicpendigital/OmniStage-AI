/**
 * Phase 10C — dialogue: line timing, voices, the procedural "babble" voice, voice-clip registry, WAV coding,
 * talk levels and dialogue captions. Pure module (no DOM, no WebAudio): the studio, the OmniStage Player, the MP4 export
 * and node tests all use it, so a line is timed, heard, captioned and acted the same everywhere.
 *
 * Real voices (Piper, src/audio/piperVoice.ts) are generated in the studio and registered here as PCM clips by key; when a
 * line has no clip yet, the babble voice speaks it (deterministic, no download, works offline in exports).
 */
import type { ActorNode, ActorVoice, CaptionCue, DialogueEmotion, DialogueLine, SceneSpec, VoiceEngine } from '../types/scene.schema';

export const DIALOGUE_EMOTIONS: DialogueEmotion[] = ['neutral', 'happy', 'excited', 'sad', 'angry', 'scared', 'whisper'];
export const VOICE_CLIP_PREFIX = 'omni-voice:';

/** Piper voices offered in the studio (id → label). Vietnamese first. */
export const PIPER_VOICES: Array<{ id: string; label: string; lang: 'vi' | 'en' }> = [
  { id: 'vi_VN-vais1000-medium', label: 'Tiếng Việt — vais1000 (medium)', lang: 'vi' },
  { id: 'vi_VN-25hours_single-low', label: 'Tiếng Việt — 25hours (low)', lang: 'vi' },
  { id: 'vi_VN-vivos-x_low', label: 'Tiếng Việt — vivos (x-low, small)', lang: 'vi' },
  { id: 'en_US-hfc_female-medium', label: 'English — female (medium)', lang: 'en' },
  { id: 'en_US-ryan-medium', label: 'English — male (medium)', lang: 'en' },
];

type DialogueScene = Pick<SceneSpec, 'actors'> & Partial<Pick<SceneSpec, 'dialogue' | 'durationSeconds' | 'dialogueCaptions' | 'captions'>>;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const VI_CHARS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
/** Language of a line: Vietnamese when it carries Vietnamese letters / tone marks. */
export function lineLanguage(text: string): 'vi' | 'en' {
  return VI_CHARS.test(text) ? 'vi' : 'en';
}

/** Phase 10D: stock ElevenLabs voice used when a character has no ElevenLabs voice of its own (multilingual). */
export const DEFAULT_ELEVENLABS_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

/**
 * Voice settings of a speaker with defaults: Piper voice by language, a distinct pitch per character.
 * `lineEngine` (DialogueLine.engine) overrides the speaker's engine for one line. ElevenLabs voices are picked per
 * character, so they are never pitch-shifted.
 */
export function voiceFor(actor: Pick<ActorNode, 'id' | 'assetId' | 'voice'> | undefined, text = '', lineEngine?: VoiceEngine): Required<Pick<ActorVoice, 'engine' | 'voiceId' | 'pitch' | 'rate'>> {
  const v = actor?.voice || {};
  const lang = lineLanguage(text);
  const small = /fox|cat|bird|bunny|rabbit|chick|kid|child/i.test(actor?.assetId || '');
  const big = /horse|giant|golem|soldier|monster/i.test(actor?.assetId || '');
  const wanted = lineEngine || v.engine;
  const engine: VoiceEngine = wanted === 'babble' ? 'babble' : wanted === 'elevenlabs' ? 'elevenlabs' : 'piper';
  if (engine === 'elevenlabs') {
    const id = typeof v.elevenLabsVoiceId === 'string' && /^[A-Za-z0-9]{8,40}$/.test(v.elevenLabsVoiceId) ? v.elevenLabsVoiceId : DEFAULT_ELEVENLABS_VOICE;
    return { engine, voiceId: id, pitch: 0, rate: clamp(num(v.rate, 1), 0.7, 1.4) };
  }
  return {
    engine,
    voiceId: v.voiceId || (lang === 'vi' ? 'vi_VN-vais1000-medium' : 'en_US-hfc_female-medium'),
    pitch: clamp(num(v.pitch, small ? 4 : big ? -4 : 0), -8, 8),
    rate: clamp(num(v.rate, 1), 0.7, 1.4),
  };
}

/** Content key of a voice clip: same speaker voice + text + emotion → same clip. */
export function voiceClipKey(line: Pick<DialogueLine, 'text' | 'emotion'>, voice: ReturnType<typeof voiceFor>): string {
  return `${voice.engine}-${voice.voiceId}-${voice.pitch}-${hashString(`${line.text}|${line.emotion || ''}`).toString(36)}`;
}

// =====================================================================================================================
// Voice clip registry (PCM by key). The studio fills it from Piper / IndexedDB; the Player from embedded WAV assets.
// =====================================================================================================================
export interface VoiceClip {
  sampleRate: number;
  data: Float32Array;
}
const clips = new Map<string, VoiceClip>();
export function registerVoiceClip(key: string, clip: VoiceClip) {
  clips.set(key, clip);
}
export function getVoiceClip(key: string | undefined): VoiceClip | undefined {
  return key ? clips.get(key) : undefined;
}
export function clearVoiceClips() {
  clips.clear();
}

// =====================================================================================================================
// WAV (mono PCM16) — embedded clips in exports
// =====================================================================================================================
export function encodeWavMono16(data: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + data.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.round(clamp(data[i], -1, 1) * 32767), true);
  return out;
}

/** Decodes PCM16 / float32 WAV (mono or the first channel). Returns null for anything else. */
export function decodeWav(bytes: Uint8Array): VoiceClip | null {
  if (bytes.length < 44) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  let fmt = 1, channels = 1, sampleRate = 22050, bits = 16;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true);
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === 'data') {
      const frame = (bits / 8) * channels;
      const n = Math.floor(Math.min(size, bytes.length - o - 8) / frame);
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = o + 8 + i * frame;
        data[i] = fmt === 3 && bits === 32 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : 0;
      }
      return { sampleRate, data };
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Base64 helpers that work in the browser and in node. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Registers `omni-voice:<key>` WAV data URIs (export assets) as clips. Returns how many were added. */
export function registerVoiceAssets(assets: Record<string, string> | undefined): number {
  let n = 0;
  for (const [url, dataUri] of Object.entries(assets || {})) {
    if (!url.startsWith(VOICE_CLIP_PREFIX) || clips.has(url.slice(VOICE_CLIP_PREFIX.length))) continue;
    const comma = dataUri.indexOf(',');
    const clip = comma > 0 ? decodeWav(base64ToBytes(dataUri.slice(comma + 1))) : null;
    if (clip) {
      clips.set(url.slice(VOICE_CLIP_PREFIX.length), clip);
      n++;
    }
  }
  return n;
}

/** Export assets for every generated clip the scenes use (`omni-voice:<key>` → WAV data URI). */
export function voiceClipAssets(scenes: Array<Pick<SceneSpec, 'dialogue'>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of scenes) {
    for (const line of s.dialogue || []) {
      const clip = getVoiceClip(line.clip);
      if (!clip || out[VOICE_CLIP_PREFIX + line.clip]) continue;
      out[VOICE_CLIP_PREFIX + line.clip] = `data:audio/wav;base64,${bytesToBase64(encodeWavMono16(clip.data, clip.sampleRate))}`;
    }
  }
  return out;
}

// =====================================================================================================================
// Babble voice — syllables with vowel formants and Vietnamese tone contours from the diacritics
// =====================================================================================================================
const TONES: Array<[RegExp, 'sac' | 'huyen' | 'hoi' | 'nga' | 'nang']> = [
  [/[áắấéếíóốớúứý]/i, 'sac'],
  [/[àằầèềìòồờùừỳ]/i, 'huyen'],
  [/[ảẳẩẻểỉỏổởủửỷ]/i, 'hoi'],
  [/[ãẵẫẽễĩõỗỡũữỹ]/i, 'nga'],
  [/[ạặậẹệịọộợụựỵ]/i, 'nang'],
];
const FORMANTS: Record<string, [number, number]> = {
  a: [800, 1250], e: [520, 1850], i: [300, 2250], o: [520, 900], u: [330, 800], y: [300, 2200],
};
function baseVowel(ch: string): string {
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace('đ', 'd');
  return FORMANTS[plain] ? plain : 'a';
}

interface Syllable { vowel: string; tone: string; pause: number; stress: number }

/** Splits a line into syllables (Vietnamese: one per word; English: vowel groups) with punctuation pauses. */
export function syllablesOf(text: string): Syllable[] {
  const out: Syllable[] = [];
  const vi = lineLanguage(text) === 'vi';
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const pause = /[.!?…]$/.test(raw) ? 0.32 : /[,;:]$/.test(raw) ? 0.16 : 0.025;
    const word = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (!word) continue;
    const groups = vi ? [word] : word.match(/[aeiouy]+[^aeiouy]*/gi) || [word];
    groups.forEach((g, gi) => {
      const v = [...g].find((c) => FORMANTS[baseVowel(c)] && /[aeiouyăâêôơưáàảãạ]/i.test(c.normalize('NFC'))) || g[0];
      const tone = (TONES.find(([re]) => re.test(g)) || [null, 'ngang'])[1] as string;
      out.push({ vowel: baseVowel(v), tone, pause: gi === groups.length - 1 ? pause : 0.01, stress: gi === 0 ? 1 : 0.8 });
    });
  }
  return out;
}

const EMOTION: Record<DialogueEmotion, { pitch: number; rate: number; gain: number; range: number }> = {
  neutral: { pitch: 0, rate: 1, gain: 1, range: 1 },
  happy: { pitch: 2, rate: 1.08, gain: 1.05, range: 1.3 },
  excited: { pitch: 4, rate: 1.18, gain: 1.15, range: 1.6 },
  sad: { pitch: -2, rate: 0.85, gain: 0.85, range: 0.6 },
  angry: { pitch: 1, rate: 1.1, gain: 1.25, range: 1.2 },
  scared: { pitch: 3, rate: 1.2, gain: 0.95, range: 1.4 },
  whisper: { pitch: 0, rate: 0.95, gain: 0.7, range: 0.8 },
};
const SYLLABLE = 0.16;

function emotionOf(line: Pick<DialogueLine, 'emotion'>) {
  return EMOTION[line.emotion && EMOTION[line.emotion] ? line.emotion : 'neutral'];
}

/** Babble length of a line in seconds (also the timing estimate before a real voice exists). */
export function estimateLineDuration(line: Pick<DialogueLine, 'text' | 'emotion'>, voice: { rate: number }): number {
  const e = emotionOf(line);
  const syl = syllablesOf(line.text);
  let t = 0.08;
  for (const s of syl) t += SYLLABLE / (voice.rate * e.rate) + s.pause;
  return Math.max(0.4, t);
}

/** RBJ band-pass biquad state. */
function bandpass(f: number, q: number, sr: number) {
  const w = (2 * Math.PI * f) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/** The babble voice of a line as mono PCM (deterministic). */
export function renderBabble(line: Pick<DialogueLine, 'text' | 'emotion'>, voice: ReturnType<typeof voiceFor>, sampleRate: number, robotic = false): Float32Array {
  const e = emotionOf(line);
  const syl = syllablesOf(line.text);
  const n = Math.max(1, Math.ceil(estimateLineDuration(line, voice) * sampleRate));
  const out = new Float32Array(n);
  const f0 = 190 * Math.pow(2, (voice.pitch + e.pitch) / 12);
  const whisper = line.emotion === 'whisper';
  let seed = hashString(line.text) || 1;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };
  let pos = Math.round(0.04 * sampleRate);
  let phase = 0;
  syl.forEach((s, si) => {
    const len = Math.round((SYLLABLE / (voice.rate * e.rate)) * sampleRate);
    const [F1, F2] = FORMANTS[s.vowel];
    const bp1 = bandpass(F1, 5, sampleRate);
    const bp2 = bandpass(F2, 7, sampleRate);
    const decl = 1 - 0.12 * (si / Math.max(1, syl.length)); // declination over the phrase
    const question = /\?\s*$/.test(line.text) && si === syl.length - 1;
    for (let k = 0; k < len && pos + k < n; k++) {
      const u = k / len;
      let st = 0;
      switch (s.tone) {
        case 'sac': st = 3.5 * u * e.range; break;
        case 'huyen': st = -2.5 * u * e.range - 0.5; break;
        case 'hoi': st = -3 * Math.sin(Math.PI * Math.min(1, u * 1.3)) * e.range; break;
        case 'nga': st = (u < 0.45 ? 1 : 4 * e.range) * u; break;
        case 'nang': st = -4 * e.range * u; break;
        default: st = 0;
      }
      if (question) st += 5 * u;
      const f = f0 * decl * Math.pow(2, st / 12) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * (k / sampleRate)));
      phase += f / sampleRate;
      const p = phase - Math.floor(phase);
      // glottal-ish source: saw with a soft corner, or noise for whispers
      let src = whisper ? noise() * 0.6 : (2 * p - 1) * (1 - p * 0.3);
      if (robotic) src *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 38 * ((pos + k) / sampleRate));
      const env = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.25) * s.stress;
      out[pos + k] += env * (bp1(src) * 1.0 + bp2(src) * 0.55) * e.gain;
    }
    pos += len + Math.round(s.pause * sampleRate);
  });
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = peak > 0 ? 0.55 / peak : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

// =====================================================================================================================
// Timeline: when each line plays, who is talking, captions
// =====================================================================================================================
export interface TimedLine {
  line: DialogueLine;
  start: number;
  end: number;
  speaker?: ActorNode;
  voice: ReturnType<typeof voiceFor>;
}

/** Valid lines in time order with their spoken windows (duration = generated clip, else the estimate). */
export function dialogueTimeline(scene: DialogueScene): TimedLine[] {
  const duration = Math.max(0.1, num(scene.durationSeconds, 1e9));
  return (scene.dialogue || [])
    .filter((l) => l && typeof l.text === 'string' && l.text.trim() && Number.isFinite(l.time) && l.time >= 0 && l.time < duration)
    .map((line) => {
      const speaker = scene.actors.find((a) => a.id === line.speaker);
      const voice = voiceFor(speaker, line.text, line.engine);
      const clip = getVoiceClip(line.clip);
      // Pitch shifts keep the tempo (WSOLA), so a clip lasts as long as it was spoken.
      const spoken = clip ? clip.data.length / clip.sampleRate : num(line.duration, estimateLineDuration(line, voice));
      return { line, start: line.time, end: Math.min(duration, line.time + spoken), speaker, voice };
    })
    .sort((a, b) => a.start - b.start);
}

/** The line an actor is saying at `t`, if any. */
export function speakingLine(scene: DialogueScene, actorId: string, t: number): TimedLine | undefined {
  return dialogueTimeline(scene).find((tl) => tl.line.speaker === actorId && t >= tl.start && t < tl.end);
}

/** 0..1 how loud an actor is talking at `t` (clip envelope when generated, syllable rhythm otherwise). */
export function talkLevelAt(scene: DialogueScene, actorId: string, t: number): number {
  const tl = speakingLine(scene, actorId, t);
  if (!tl) return 0;
  const local = t - tl.start;
  const clip = getVoiceClip(tl.line.clip);
  if (clip) {
    const c = Math.floor(local * clip.sampleRate);
    const w = Math.round(clip.sampleRate * 0.03);
    let s = 0;
    for (let i = Math.max(0, c - w); i < Math.min(clip.data.length, c + w); i++) s += clip.data[i] * clip.data[i];
    return clamp(Math.sqrt(s / Math.max(1, 2 * w)) * 6, 0, 1);
  }
  const syl = SYLLABLE / (tl.voice.rate * emotionOf(tl.line).rate);
  return 0.35 + 0.65 * Math.abs(Math.sin((Math.PI * local) / syl));
}

/** Dialogue as caption cues (speaker name prefixed when several characters talk). */
export function dialogueCaptions(scene: DialogueScene): CaptionCue[] {
  if (scene.dialogueCaptions === false) return [];
  const timeline = dialogueTimeline(scene);
  const speakers = new Set(timeline.map((t) => t.line.speaker));
  return timeline.map((t) => ({
    id: `dlg-${t.line.id}`,
    start: t.start,
    end: Math.max(t.end + 0.25, t.start + 1.2),
    text: speakers.size > 1 && t.speaker ? `${t.speaker.name}: ${t.line.text}` : t.line.text,
    position: 'bottom',
    style: 'subtitle',
  } as CaptionCue));
}

/** Authored captions plus dialogue captions — what every host draws. */
export function sceneCaptions(scene: DialogueScene): CaptionCue[] {
  return [...(scene.captions || []), ...dialogueCaptions(scene)];
}

// =====================================================================================================================
// Mixing helpers for the soundtrack renderer
// =====================================================================================================================
function resampleTo(clip: VoiceClip, sampleRate: number, pitch: number): Float32Array {
  const step = (clip.sampleRate / sampleRate) * Math.pow(2, pitch / 12);
  return resampleRaw(clip, step);
}

function resampleRaw(clip: VoiceClip, step: number): Float32Array {
  const n = Math.max(1, Math.floor(clip.data.length / step));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const j = Math.floor(p);
    const a = clip.data[j] || 0;
    const b = clip.data[j + 1] ?? a;
    out[i] = a + (b - a) * (p - j);
  }
  return out;
}

/**
 * WSOLA time-stretch: plays `data` `factor` times longer (factor > 1 = slower) without changing its pitch. Overlap-adds
 * Hann-windowed 30 ms frames, each shifted (±7 ms) to line up with the previous one, so speech stays smooth.
 */
export function timeStretch(data: Float32Array, sampleRate: number, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-3 || data.length < 64) return data.slice();
  const N = Math.max(64, Math.round(0.03 * sampleRate));
  const Hs = Math.floor(N / 2);
  const Ha = Hs / factor;
  const tol = Math.round(0.007 * sampleRate);
  const outLen = Math.round(data.length * factor);
  const out = new Float32Array(outLen + N);
  const norm = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let prevIn = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // the natural continuation of the previous frame
      const want = prevIn + Hs;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const pos = nominal + d;
        if (pos < 0 || pos + N > data.length) continue;
        let score = 0;
        for (let i = 0; i < N; i += 4) score += data[pos + i] * (data[want + i] || 0);
        if (score > bestScore) { bestScore = score; best = pos; }
      }
    }
    best = Math.max(0, Math.min(data.length - 1, best));
    const o = k * Hs;
    for (let i = 0; i < N && best + i < data.length; i++) {
      out[o + i] += data[best + i] * win[i];
      norm[o + i] += win[i];
    }
    prevIn = best;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}

const pitched = new Map<string, Float32Array>();
/** A generated clip at `sampleRate`, shifted by `semitones` with its tempo kept (cached). */
export function pitchedClip(key: string, clip: VoiceClip, sampleRate: number, semitones: number): Float32Array {
  const id = `${key}|${sampleRate}|${semitones}`;
  let pcm = pitched.get(id);
  if (!pcm) {
    const ratio = Math.pow(2, semitones / 12);
    // resample: higher and shorter by `ratio`, then stretch back to the spoken length
    const raw = resampleRaw(clip, (clip.sampleRate / sampleRate) * ratio);
    pcm = semitones ? timeStretch(raw, sampleRate, ratio) : raw;
    if (pitched.size > 64) pitched.clear();
    pitched.set(id, pcm);
  }
  return pcm;
}

/** Mono voice track of a scene at `sampleRate` plus a 0..1 "someone is talking" envelope (for music ducking). */
export function renderDialogueTrack(scene: DialogueScene, samples: number, sampleRate: number): { voice: Float32Array; duck: Float32Array; pans: Array<{ from: number; to: number; pan: number }> } | null {
  const timeline = dialogueTimeline(scene);
  if (!timeline.length) return null;
  const voice = new Float32Array(samples);
  const duck = new Float32Array(samples);
  const pans: Array<{ from: number; to: number; pan: number }> = [];
  for (const tl of timeline) {
    const clip = getVoiceClip(tl.line.clip);
    const robotic = /robot|droid|mech/i.test(tl.speaker?.assetId || '');
    const pcm = clip ? pitchedClip(tl.line.clip!, clip, sampleRate, tl.voice.pitch) : renderBabble(tl.line, tl.voice, sampleRate, robotic);
    const start = Math.round(tl.start * sampleRate);
    // Dialogue sits on top of the mix: every line is levelled to the same loudness (RMS of its voiced part).
    let e = 0;
    let voiced = 0;
    for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.02) { e += pcm[i] * pcm[i]; voiced++; }
    const level = voiced ? Math.sqrt(e / voiced) : 0;
    const gain = level > 1e-4 ? Math.min(4, (tl.line.emotion === 'whisper' ? 0.1 : 0.16) / level) : 0;
    for (let i = 0; i < pcm.length && start + i < samples; i++) voice[start + i] += pcm[i] * gain;
    const from = start;
    const to = Math.min(samples, start + pcm.length);
    // speakers left / right of the stage are panned a little
    const x = tl.speaker?.position?.[0] ?? 0;
    pans.push({ from, to, pan: clamp(x / 10, -0.35, 0.35) });
    const att = Math.round(0.12 * sampleRate);
    const rel = Math.round(0.4 * sampleRate);
    for (let i = Math.max(0, from - att); i < Math.min(samples, to + rel); i++) {
      const g = i < from ? (i - (from - att)) / att : i >= to ? 1 - (i - to) / rel : 1;
      duck[i] = Math.max(duck[i], clamp(g, 0, 1));
    }
  }
  return { voice, duck, pans };
}

/** Cache key part for anything that changes the dialogue audio (lines, voices, which clips are available). */
export function dialogueKey(scene: DialogueScene): string {
  const tl = dialogueTimeline(scene);
  if (!tl.length) return '';
  return JSON.stringify(tl.map((t) => [t.start, t.line.text, t.line.emotion, t.voice, t.line.clip && getVoiceClip(t.line.clip) ? t.line.clip : '', t.speaker?.position?.[0]]));
}
