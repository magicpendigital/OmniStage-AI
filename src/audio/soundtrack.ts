/**
 * Phase 10B — procedural film soundtrack: mood music, ambience and timed SFX rendered to stereo PCM in plain JS
 * (no WebAudio, no audio files). Deterministic: the same SceneSpec always gives the same samples, so Preview, the
 * OmniStage Player and the MP4 export sound identical, and node tests can measure it.
 *
 * Music is planned on a global bar grid, so consecutive film scenes with the same mood continue the same piece
 * sample-exactly across cuts (renderFilmSoundtrack passes each scene's start offset).
 */
import type { AmbienceId, MusicMood, SceneSpec, WorldSpec } from '../types/scene.schema';
import { BUILTIN_SFX_RECIPES, SfxRecipeDef } from './sfxRecipes';

export const MUSIC_MOODS: MusicMood[] = ['none', 'calm', 'happy', 'playful', 'adventure', 'epic', 'tense', 'sad', 'mysterious'];
export const AMBIENCE_IDS: AmbienceId[] = [
  'none', 'auto', 'forest', 'meadow', 'beach', 'river', 'waterfall', 'rain', 'wind', 'night', 'city', 'cave', 'space',
];
export const SOUNDTRACK_SAMPLE_RATE = 44100;
export const DEFAULT_MUSIC_VOLUME = 0.55;
export const DEFAULT_AMBIENCE_VOLUME = 0.5;

export interface StereoPcm {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

export type SoundtrackScene = Pick<SceneSpec, 'soundtrack' | 'durationSeconds'> &
  Partial<Pick<SceneSpec, 'id' | 'world' | 'engineType' | 'sfxLibrary' | 'sequence'>>;

type ConcreteAmbience = Exclude<AmbienceId, 'auto'>;

export interface ResolvedSoundtrack {
  mood: MusicMood;
  musicGain: number;
  tempo?: number;
  ambience: ConcreteAmbience;
  ambienceGain: number;
  cues: Array<{ time: number; recipe: SfxRecipeDef; volume: number }>;
  volume: number;
  seed: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG in [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ambience that fits a world: water landmarks first, then rain, biome, sky and terrain. */
export function autoAmbience(world?: Partial<WorldSpec>): ConcreteAmbience {
  if (!world) return 'none';
  const features = world.features || [];
  if (features.some((f) => f.type === 'waterfall')) return 'waterfall';
  if (world.weather?.type === 'rain' && num(world.weather.intensity, 1) > 0) return 'rain';
  if (features.some((f) => f.type === 'river')) return 'river';
  switch (world.biome) {
    case 'forest': return 'forest';
    case 'meadow': return 'meadow';
    case 'beach': return 'beach';
    case 'desert':
    case 'snowy-peaks': return 'wind';
    case 'waterfall-valley': return 'waterfall';
    case 'night-forest': return 'night';
    case 'city-night': return 'city';
  }
  if (world.skybox === 'night-stars') return 'night';
  if (world.skybox === 'cyber-void') return 'space';
  const trees = (world.scatterObjects || []).some((l) => /tree/.test(l.type) && l.count > 0);
  switch (world.terrain?.type) {
    case 'grassy-hills': return trees ? 'forest' : 'meadow';
    case 'desert-dunes':
    case 'snow-mountains': return 'wind';
    case 'ocean-island': return 'beach';
    case 'city-asphalt': return 'city';
    default: return trees ? 'forest' : 'none';
  }
}

/** Effective soundtrack of a scene (defaults, 'auto' ambience, valid cues only), or null when it has none. */
export function resolveSoundtrack(scene: SoundtrackScene): ResolvedSoundtrack | null {
  const st = scene.soundtrack;
  if (!st) return null;
  const mood = MUSIC_MOODS.includes(st.music?.mood as MusicMood) ? (st.music!.mood as MusicMood) : 'none';
  const rawAmb = st.ambience?.type ?? 'auto';
  const ambience: ConcreteAmbience = rawAmb === 'auto' || !AMBIENCE_IDS.includes(rawAmb) ? autoAmbience(scene.world) : (rawAmb as ConcreteAmbience);
  const library: Record<string, SfxRecipeDef> = { ...(scene.sfxLibrary as any), ...BUILTIN_SFX_RECIPES };
  const duration = Math.max(0.1, num(scene.durationSeconds, 8));
  const cues = (st.cues || [])
    .filter((c) => c && library[c.sfx] && num(c.time, -1) >= 0 && c.time < duration)
    .map((c) => ({ time: c.time, recipe: library[c.sfx], volume: clamp(num(c.volume, 0.8), 0, 1) }));
  return {
    mood,
    musicGain: clamp(num(st.music?.volume, DEFAULT_MUSIC_VOLUME), 0, 1) / DEFAULT_MUSIC_VOLUME,
    tempo: st.music?.tempo ? clamp(st.music.tempo, 50, 180) : undefined,
    ambience,
    ambienceGain: clamp(num(st.ambience?.volume, DEFAULT_AMBIENCE_VOLUME), 0, 1) / DEFAULT_AMBIENCE_VOLUME,
    cues,
    volume: clamp(num(st.volume, 0.9), 0, 1),
    seed: hashString(scene.sequence?.storyboardId || scene.id || 'omnistage'),
  };
}

/** Cache key for a rendered scene soundtrack (only the inputs the renderer reads). */
export function soundtrackKey(scene: SoundtrackScene): string {
  const r = resolveSoundtrack(scene);
  if (!r) return '';
  return JSON.stringify([r.mood, r.musicGain, r.tempo, r.ambience, r.ambienceGain, r.volume, r.seed, num(scene.durationSeconds, 8),
    r.cues.map((c) => [c.time, c.volume, c.recipe])]);
}

// =====================================================================================================================
// Wavetables
// =====================================================================================================================
const TABLE = 2048;
function table(harmonics: number[]): Float32Array {
  const t = new Float32Array(TABLE + 1);
  let peak = 0;
  for (let i = 0; i <= TABLE; i++) {
    let v = 0;
    for (let k = 0; k < harmonics.length; k++) v += harmonics[k] * Math.sin((2 * Math.PI * (k + 1) * i) / TABLE);
    t[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i <= TABLE; i++) t[i] /= peak || 1;
  return t;
}
const SINE = table([1]);
const SOFT = table([1, 0.18, 0.06]);
const WARM = table([1, 0.42, 0.24, 0.14, 0.08, 0.05]);
const BRIGHT = table([1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.13, 0.11]);

function lookup(tab: Float32Array, phase: number): number {
  const p = (phase - Math.floor(phase)) * TABLE;
  const i = p | 0;
  return tab[i] + (tab[i + 1] - tab[i]) * (p - i);
}

// =====================================================================================================================
// Music
// =====================================================================================================================
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

type Inst = 'pad' | 'bass' | 'pluck' | 'bell' | 'flute' | 'kick' | 'snare' | 'hat' | 'tom';
interface NoteEvent { start: number; dur: number; midi: number; inst: Inst; vel: number; pan: number; id: number }

interface MoodDef {
  bpm: number;
  root: number;
  scale: number[];
  prog: number[];
  pad: number;
  padTable: Float32Array;
  bass: 'whole' | 'half' | 'eighths' | 'pulse';
  arp: 'none' | 'up' | 'updown' | 'broken' | 'sparse';
  arpRate: number;
  arpInst: 'pluck' | 'bell';
  drums: 'none' | 'soft' | 'drive' | 'epic' | 'tick';
  melody: number;
  lead: 'flute' | 'bell' | 'pluck';
}

const MOODS: Record<Exclude<MusicMood, 'none'>, MoodDef> = {
  calm: { bpm: 76, root: 53, scale: MAJOR, prog: [0, 5, 3, 4], pad: 0.9, padTable: SOFT, bass: 'whole', arp: 'up', arpRate: 2, arpInst: 'pluck', drums: 'none', melody: 0.45, lead: 'flute' },
  happy: { bpm: 112, root: 60, scale: MAJOR, prog: [0, 4, 5, 3], pad: 0.6, padTable: WARM, bass: 'half', arp: 'broken', arpRate: 2, arpInst: 'pluck', drums: 'soft', melody: 0.75, lead: 'pluck' },
  playful: { bpm: 124, root: 62, scale: MAJOR, prog: [0, 3, 4, 0], pad: 0.45, padTable: SOFT, bass: 'half', arp: 'updown', arpRate: 2, arpInst: 'bell', drums: 'soft', melody: 0.9, lead: 'bell' },
  adventure: { bpm: 118, root: 50, scale: DORIAN, prog: [0, 6, 2, 3], pad: 0.75, padTable: WARM, bass: 'eighths', arp: 'up', arpRate: 2, arpInst: 'pluck', drums: 'drive', melody: 0.7, lead: 'flute' },
  epic: { bpm: 88, root: 57, scale: MINOR, prog: [0, 5, 2, 6], pad: 1, padTable: BRIGHT, bass: 'whole', arp: 'none', arpRate: 1, arpInst: 'pluck', drums: 'epic', melody: 0.5, lead: 'flute' },
  tense: { bpm: 100, root: 52, scale: PHRYGIAN, prog: [0, 0, 1, 0], pad: 0.6, padTable: SOFT, bass: 'pulse', arp: 'sparse', arpRate: 1, arpInst: 'bell', drums: 'tick', melody: 0, lead: 'bell' },
  sad: { bpm: 68, root: 57, scale: MINOR, prog: [0, 3, 5, 4], pad: 0.8, padTable: SOFT, bass: 'whole', arp: 'up', arpRate: 1, arpInst: 'pluck', drums: 'none', melody: 0.5, lead: 'flute' },
  mysterious: { bpm: 72, root: 50, scale: PHRYGIAN, prog: [0, 1, 6, 0], pad: 0.7, padTable: SOFT, bass: 'whole', arp: 'sparse', arpRate: 1, arpInst: 'bell', drums: 'none', melody: 0.25, lead: 'bell' },
};

const degreeMidi = (m: MoodDef, deg: number) => m.root + 12 * Math.floor(deg / 7) + m.scale[((deg % 7) + 7) % 7];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const RHYTHMS: Array<Array<[number, number]>> = [
  [[0, 1], [1, 1], [2, 2]],
  [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
  [[0, 2], [2, 1], [3, 1]],
  [[1, 1], [2, 0.5], [2.5, 1.5]],
];

/** Note events of a mood on the global grid for [from, to) seconds (events starting a little earlier are included). */
function planMusic(mood: Exclude<MusicMood, 'none'>, tempo: number | undefined, seed: number, from: number, to: number): NoteEvent[] {
  const m = MOODS[mood];
  const beat = 60 / (tempo || m.bpm);
  const bar = beat * 4;
  const events: NoteEvent[] = [];
  let id = 0;
  const lastBar = Math.ceil(to / bar);
  const firstBar = Math.max(0, Math.floor((from - 3) / bar));
  const melodyRand = rng(seed ^ hashString(mood));
  let melodyDeg = 7 + m.prog[0] + 2;
  for (let b = 0; b <= lastBar; b++) {
    // The melody walk is sequential: run it from bar 0 so any window gives the same notes.
    const chordDeg = m.prog[b % m.prog.length];
    const intro = b < 2;
    const phrase = !intro && b % 4 !== 0 && melodyRand() < m.melody;
    const rhythm = RHYTHMS[Math.floor(melodyRand() * RHYTHMS.length)];
    const melodyNotes: Array<[number, number, number]> = [];
    if (phrase) {
      for (const [at, len] of rhythm) {
        const strong = at % 2 === 0;
        if (strong) {
          const tones = [chordDeg + 7, chordDeg + 9, chordDeg + 11];
          melodyDeg = tones.reduce((best, d) => (Math.abs(d - melodyDeg) < Math.abs(best - melodyDeg) ? d : best), tones[0]);
        } else {
          melodyDeg += [-2, -1, 1, 2][Math.floor(melodyRand() * 4)];
        }
        melodyDeg = clamp(melodyDeg, 5, 13);
        melodyNotes.push([at, len, melodyDeg]);
      }
    }
    if (b < firstBar) continue;
    const t0 = b * bar;
    const chord = [0, 2, 4].map((k) => degreeMidi(m, chordDeg + k));
    // pad: the chord held for the bar, voiced one octave up
    for (const [i, note] of chord.entries()) events.push({ start: t0, dur: bar + 0.25, midi: note, inst: 'pad', vel: m.pad, pan: (i - 1) * 0.35, id: id++ });
    // bass
    const bassNote = degreeMidi(m, chordDeg) - 12;
    const bassPattern = m.bass === 'whole' ? [[0, 4]] : m.bass === 'half' ? [[0, 2], [2, 2]] : m.bass === 'eighths' ? [0, 1, 1.5, 2, 3, 3.5].map((x) => [x, 0.5]) : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((x) => [x, 0.45]);
    for (const [at, len] of bassPattern) events.push({ start: t0 + at * beat, dur: len * beat * 0.95, midi: bassNote + (m.bass === 'half' && at === 2 ? 7 : 0), inst: 'bass', vel: 1, pan: 0, id: id++ });
    // arpeggio
    if (m.arp !== 'none' && !(intro && b === 0)) {
      const steps = 4 * m.arpRate;
      const up = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
      for (let s = 0; s < steps; s++) {
        if (m.arp === 'sparse' && s % 3 !== 0) continue;
        const idx = m.arp === 'up' ? s % 4 : m.arp === 'updown' ? [0, 1, 2, 3, 2, 1][s % 6] : m.arp === 'broken' ? [0, 2, 1, 3][s % 4] : (s * 2) % 4;
        events.push({ start: t0 + (s * beat) / m.arpRate, dur: beat * 1.5, midi: up[idx], inst: m.arpInst, vel: s % m.arpRate === 0 ? 1 : 0.7, pan: ((s % 4) - 1.5) * 0.25, id: id++ });
      }
    }
    // melody
    for (const [at, len, deg] of melodyNotes) events.push({ start: t0 + at * beat, dur: len * beat, midi: degreeMidi(m, deg), inst: m.lead, vel: 1, pan: 0.1, id: id++ });
    // drums
    if (!intro && m.drums !== 'none') {
      const hit = (step: number, inst: Inst, vel: number) => events.push({ start: t0 + (step * beat) / 4, dur: 0.6, midi: 0, inst, vel, pan: inst === 'hat' ? 0.25 : 0, id: id++ });
      if (m.drums === 'soft') {
        hit(0, 'kick', 0.8); hit(8, 'kick', 0.7);
        for (const s of [4, 12]) hit(s, 'hat', 0.6);
      } else if (m.drums === 'drive') {
        hit(0, 'kick', 1); hit(6, 'kick', 0.7); hit(8, 'kick', 0.9); hit(4, 'snare', 0.8); hit(12, 'snare', 0.85);
        for (let s = 0; s < 16; s += 2) hit(s, 'hat', s % 4 === 0 ? 0.55 : 0.4);
      } else if (m.drums === 'epic') {
        hit(0, 'kick', 1); hit(8, 'kick', 0.85); hit(0, 'tom', 0.8);
        if (b % 2 === 1) for (const s of [10, 12, 14]) hit(s, 'tom', 0.7);
      } else if (m.drums === 'tick') {
        hit(0, 'kick', 0.7);
        for (let s = 0; s < 16; s += 2) hit(s, 'hat', 0.35);
      }
    }
  }
  return events.filter((e) => e.start < to && e.start + e.dur + 2 > from);
}

/** Adds a mono generator into a stereo window. `gen(t)` gets seconds since the note start. */
function addVoice(out: StereoPcm, startSample: number, length: number, pan: number, gen: (t: number, i: number) => number) {
  const sr = out.sampleRate;
  const n = out.left.length;
  const from = Math.max(0, startSample);
  const to = Math.min(n, startSample + length);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = from; i < to; i++) {
    const k = i - startSample;
    const v = gen(k / sr, k);
    out.left[i] += v * gl;
    out.right[i] += v * gr;
  }
}

function noiseSource(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Karplus-Strong pluck, whole note precomputed (deterministic from its id). */
function pluck(freq: number, sr: number, dur: number, seed: number, bright: number): Float32Array {
  const n = Math.max(1, Math.round(dur * sr));
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(sr / freq));
  const buf = new Float32Array(period);
  const noise = noiseSource(seed);
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev = prev + bright * (noise() - prev);
    buf[i] = prev;
  }
  let idx = 0;
  const decay = 0.996;
  for (let i = 0; i < n; i++) {
    const next = (idx + 1) % period;
    const v = buf[idx];
    buf[idx] = 0.5 * (v + buf[next]) * decay;
    out[i] = v;
    idx = next;
  }
  return out;
}

function renderMusic(out: StereoPcm, mood: MusicMood, tempo: number | undefined, seed: number, offsetSamples: number, gain: number) {
  if (mood === 'none' || gain <= 0) return;
  const sr = out.sampleRate;
  const from = offsetSamples / sr;
  const to = (offsetSamples + out.left.length) / sr;
  for (const e of planMusic(mood, tempo, seed, from, to)) {
    const startSample = Math.round(e.start * sr) - offsetSamples;
    const f = midiHz(e.midi);
    const g = 1.25 * gain * e.vel;
    switch (e.inst) {
      case 'pad': {
        const len = Math.round((e.dur + 0.9) * sr);
        const tab = MOODS[mood as Exclude<MusicMood, 'none'>].padTable;
        addVoice(out, startSample, len, e.pan, (t) => {
          const env = Math.min(1, t / 0.55) * clamp((e.dur + 0.9 - t) / 0.9, 0, 1);
          return 0.05 * g * env * (lookup(tab, f * t * 1.0025) + lookup(tab, f * t * 0.9975));
        });
        break;
      }
      case 'bass': {
        const len = Math.round((e.dur + 0.12) * sr);
        addVoice(out, startSample, len, 0, (t) => {
          const env = Math.min(1, t / 0.012) * (0.6 + 0.4 * Math.exp(-t * 6)) * clamp((e.dur + 0.12 - t) / 0.12, 0, 1);
          return 0.17 * g * env * lookup(SOFT, f * t);
        });
        break;
      }
      case 'pluck': {
        const wave = pluck(f, sr, Math.min(2.2, e.dur + 0.8), seed ^ e.id ^ (e.midi << 8), 0.55);
        addVoice(out, startSample, wave.length, e.pan, (_t, k) => 0.22 * g * wave[k]);
        break;
      }
      case 'bell': {
        const len = Math.round(2.2 * sr);
        addVoice(out, startSample, len, e.pan, (t) => {
          const a = Math.min(1, t / 0.004);
          return 0.07 * g * a * (lookup(SINE, f * t) * Math.exp(-t * 1.6) + 0.4 * lookup(SINE, 2.76 * f * t) * Math.exp(-t * 3.2) + 0.18 * lookup(SINE, 5.4 * f * t) * Math.exp(-t * 6));
        });
        break;
      }
      case 'flute': {
        const len = Math.round((e.dur + 0.15) * sr);
        const breath = noiseSource(e.id + 77);
        let lp = 0;
        addVoice(out, startSample, len, e.pan, (t) => {
          const env = Math.min(1, t / 0.07) * clamp((e.dur + 0.15 - t) / 0.15, 0, 1);
          const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.3);
          lp += 0.08 * (breath() - lp);
          return 0.085 * g * env * (lookup(SOFT, f * t * vib) + 0.12 * lp);
        });
        break;
      }
      case 'kick': {
        const len = Math.round(0.4 * sr);
        let phase = 0;
        addVoice(out, startSample, len, 0, (t) => {
          const fr = 45 + 75 * Math.exp(-t * 28);
          phase += fr / sr;
          return 0.42 * g * Math.exp(-t * 9) * Math.sin(2 * Math.PI * phase);
        });
        break;
      }
      case 'tom': {
        const len = Math.round(0.5 * sr);
        let phase = 0;
        addVoice(out, startSample, len, -0.1, (t) => {
          const fr = 82 + 60 * Math.exp(-t * 14);
          phase += fr / sr;
          return 0.32 * g * Math.exp(-t * 6) * Math.sin(2 * Math.PI * phase);
        });
        break;
      }
      case 'snare': {
        const len = Math.round(0.25 * sr);
        const nz = noiseSource(e.id * 31 + 5);
        let lp = 0;
        addVoice(out, startSample, len, 0.05, (t) => {
          const w = nz();
          lp += 0.25 * (w - lp);
          return 0.2 * g * (Math.exp(-t * 18) * (w - lp) + 0.5 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 190 * t));
        });
        break;
      }
      case 'hat': {
        const len = Math.round(0.07 * sr);
        const nz = noiseSource(e.id * 17 + 3);
        let prev = 0;
        addVoice(out, startSample, len, e.pan, (t) => {
          const w = nz();
          const hp = w - prev;
          prev = w;
          return 0.07 * g * Math.exp(-t * 60) * hp;
        });
        break;
      }
    }
  }
}

// =====================================================================================================================
// Ambience
// =====================================================================================================================
const lpCoef = (fc: number, sr: number) => 1 - Math.exp((-2 * Math.PI * fc) / sr);

function rms(a: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}
function peak(a: Float32Array) {
  let p = 0;
  for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i]));
  return p;
}
/** Adds a layer scaled to a target level (RMS for beds, peak for sparse events) so levels never depend on guesswork. */
function mixLayer(out: StereoPcm, l: Float32Array, r: Float32Array, target: number, by: 'rms' | 'peak') {
  const m = by === 'rms' ? Math.max(rms(l), rms(r)) : Math.max(peak(l), peak(r));
  if (m < 1e-9) return;
  const k = target / m;
  for (let i = 0; i < l.length; i++) {
    out.left[i] += l[i] * k;
    out.right[i] += r[i] * k;
  }
}

function bed(n: number, sr: number, seed: number, fill: (ch: number, noise: () => number, out: Float32Array) => void) {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  fill(0, noiseSource(seed), l);
  fill(1, noiseSource(seed * 7 + 13), r);
  return [l, r] as const;
}

function windLayer(n: number, sr: number, seed: number) {
  return bed(n, sr, seed, (ch, nz, out) => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const gust = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.071 * t + ch) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.13 * t + 1.3));
      const k = lpCoef(180 + 520 * gust, sr);
      a += k * (nz() - a);
      b += k * (a - b);
      out[i] = b * (0.35 + 0.65 * gust);
    }
  });
}

function waterLayer(n: number, sr: number, seed: number, fc: number, low: number) {
  return bed(n, sr, seed, (_ch, nz, out) => {
    let a = 0;
    let b = 0;
    let hp = 0;
    for (let i = 0; i < n; i++) {
      const w = nz();
      a += lpCoef(fc, sr) * (w - a);
      b += lpCoef(fc, sr) * (a - b);
      hp += lpCoef(low, sr) * (b - hp);
      out[i] = b - hp;
    }
  });
}

function oceanLayer(n: number, sr: number, seed: number) {
  return bed(n, sr, seed, (ch, nz, out) => {
    let a = 0;
    let brown = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w1 = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 7.3 + ch * 0.4), 2);
      const w2 = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 11.1 + 2 + ch * 0.3), 2);
      const env = 0.15 + 0.85 * Math.max(w1, w2 * 0.8);
      const w = nz();
      a += lpCoef(300 + 1500 * env, sr) * (w - a);
      brown = (brown + 0.02 * w) / 1.02;
      out[i] = env * (a + brown * 2);
    }
  });
}

function rainLayer(n: number, sr: number, seed: number) {
  return bed(n, sr, seed, (ch, nz, out) => {
    let lp = 0;
    let top = 0;
    const drops = rng(seed + ch * 101);
    let nextDrop = 0;
    let dropT = 1;
    let dropF = 3000;
    for (let i = 0; i < n; i++) {
      const w = nz();
      lp += lpCoef(900, sr) * (w - lp);
      top += lpCoef(7000, sr) * (w - lp - top);
      if (i >= nextDrop) {
        nextDrop = i + Math.round(sr * (0.01 + drops() * 0.06));
        dropT = 0;
        dropF = 2000 + drops() * 3500;
      }
      const drop = dropT < 0.012 ? Math.sin(2 * Math.PI * dropF * dropT) * Math.exp(-dropT * 400) * 0.6 : 0;
      dropT += 1 / sr;
      out[i] = top + drop;
    }
  });
}

function rumbleLayer(n: number, sr: number, seed: number) {
  return bed(n, sr, seed, (_ch, nz, out) => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      a += lpCoef(140, sr) * (nz() - a);
      b += lpCoef(140, sr) * (a - b);
      out[i] = b;
    }
  });
}

/** Sparse events (chirps, drips, cars) placed by a seeded clock; `ev` returns a mono sample for t seconds into the event. */
function eventsLayer(n: number, sr: number, seed: number, gap: [number, number], len: number, ev: (t: number, r: () => number) => (t: number) => number, panSpread = 0.7) {
  const l = new Float32Array(n);
  const rr = new Float32Array(n);
  const r = rng(seed);
  let at = Math.round(sr * (0.2 + r() * gap[0]));
  while (at < n) {
    const voice = ev(0, r);
    const pan = (r() * 2 - 1) * panSpread;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const m = Math.min(n, at + Math.round(len * sr));
    for (let i = at; i < m; i++) {
      const v = voice((i - at) / sr);
      l[i] += v * gl;
      rr[i] += v * gr;
    }
    at += Math.round(sr * (gap[0] + r() * (gap[1] - gap[0])));
  }
  return [l, rr] as const;
}

const birdChirps = (_t: number, r: () => number) => {
  const count = 2 + Math.floor(r() * 4);
  const base = 2300 + r() * 1900;
  const len = 0.05 + r() * 0.07;
  const gapLen = 0.04 + r() * 0.06;
  const dir = r() < 0.5 ? 1 : -1;
  return (t: number) => {
    const slot = len + gapLen;
    const k = Math.floor(t / slot);
    if (k >= count) return 0;
    const u = (t - k * slot) / len;
    if (u > 1) return 0;
    const f = base * (1 + dir * 0.3 * u) * (1 - k * 0.03);
    return Math.pow(Math.sin(Math.PI * u), 2) * Math.sin(2 * Math.PI * f * t);
  };
};

const cricketTrain = (_t: number, r: () => number) => {
  const f = 4200 + r() * 700;
  return (t: number) => {
    if (t > 0.3) return 0;
    const pulse = (t * 28) % 1;
    return pulse < 0.5 ? Math.pow(Math.sin(Math.PI * pulse * 2), 2) * Math.sin(2 * Math.PI * f * t) : 0;
  };
};

const drip = (_t: number, r: () => number) => {
  const f = 900 + r() * 600;
  const one = (t: number) => (t < 0 ? 0 : Math.sin(2 * Math.PI * f * (1 + 1.2 * Math.min(t, 0.04) / 0.04) * t) * Math.exp(-t * 22));
  return (t: number) => one(t) + 0.35 * one(t - 0.23) + 0.12 * one(t - 0.46);
};

const carPass = (_t: number, r: () => number) => {
  const nz = noiseSource(Math.floor(r() * 1e9));
  let a = 0;
  let b = 0;
  return (t: number) => {
    const w = nz();
    a += 0.1 * (w - a);
    b += 0.03 * (a - b);
    return Math.exp(-Math.pow((t - 1.6) / 0.7, 2)) * (a - b);
  };
};

function droneLayer(n: number, sr: number, freqs: number[]) {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let vl = 0;
    let vr = 0;
    for (let k = 0; k < freqs.length; k++) {
      const amp = 0.6 + 0.4 * Math.sin(2 * Math.PI * (0.05 + k * 0.023) * t + k);
      vl += amp * lookup(SINE, freqs[k] * t) / (k + 1);
      vr += amp * lookup(SINE, freqs[k] * 1.003 * t) / (k + 1);
    }
    l[i] = vl;
    r[i] = vr;
  }
  return [l, r] as const;
}

function renderAmbience(out: StereoPcm, type: ConcreteAmbience, seed: number, gain: number) {
  if (type === 'none' || gain <= 0) return;
  const n = out.left.length;
  const sr = out.sampleRate;
  const add = (layer: readonly [Float32Array, Float32Array], level: number, by: 'rms' | 'peak') => mixLayer(out, layer[0], layer[1], level * gain, by);
  const wind = (lv: number) => add(windLayer(n, sr, seed + 1), 0.07 * lv, 'rms');
  const birds = (lv: number, gap: [number, number] = [1.2, 4.5]) => add(eventsLayer(n, sr, seed + 2, gap, 0.8, birdChirps), 0.16 * lv, 'peak');
  const crickets = (lv: number) => add(eventsLayer(n, sr, seed + 3, [0.45, 0.9], 0.32, cricketTrain, 0.8), 0.06 * lv, 'peak');
  switch (type) {
    case 'forest': wind(0.7); birds(1); break;
    case 'meadow': wind(0.5); birds(0.7, [2, 6]); crickets(0.4); break;
    case 'beach': add(oceanLayer(n, sr, seed + 4), 0.1, 'rms'); wind(0.35); break;
    case 'river': add(waterLayer(n, sr, seed + 5, 1500, 160), 0.065, 'rms'); birds(0.5, [2.5, 7]); break;
    case 'waterfall': add(waterLayer(n, sr, seed + 6, 3200, 90), 0.11, 'rms'); add(rumbleLayer(n, sr, seed + 7), 0.05, 'rms'); birds(0.35, [3, 8]); break;
    case 'rain': add(rainLayer(n, sr, seed + 8), 0.07, 'rms'); wind(0.3); break;
    case 'wind': wind(1.3); break;
    case 'night': crickets(1); wind(0.3); break;
    case 'city': add(rumbleLayer(n, sr, seed + 9), 0.05, 'rms'); add(eventsLayer(n, sr, seed + 10, [3.5, 8], 3.2, carPass, 0.9), 0.1, 'peak'); break;
    case 'cave': add(droneLayer(n, sr, [55, 82.4, 110]), 0.035, 'rms'); add(eventsLayer(n, sr, seed + 11, [1.5, 4], 0.8, drip), 0.16, 'peak'); break;
    case 'space': add(droneLayer(n, sr, [41.2, 61.7, 82.4, 123.5, 1760]), 0.045, 'rms'); break;
  }
}

// =====================================================================================================================
// SFX cues (offline twin of the WebAudio voice in sfxRuntime)
// =====================================================================================================================
export function renderSfxRecipe(r: SfxRecipeDef, sampleRate: number, seed = 1337): Float32Array {
  const dur = Math.max(0.01, r.dur);
  const n = Math.ceil((dur + 0.02) * sampleRate);
  const out = new Float32Array(n);
  const voice = (rec: SfxRecipeDef, vol: number) => {
    const attack = Math.min(rec.attack || 0.004, dur * 0.9);
    const nz = noiseSource(seed);
    let phase = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      if (t > dur) break;
      const env = t < attack ? 0.0001 * Math.pow(vol / 0.0001, t / attack) : vol * Math.pow(0.0001 / vol, (t - attack) / Math.max(1e-3, dur - attack));
      let f = rec.f0 || 440;
      if (rec.notes && rec.notes.length) f = rec.notes[Math.min(rec.notes.length - 1, Math.floor(t / (rec.step || 0.08)))];
      else f = (rec.f0 || 440) * Math.pow(Math.max(20, rec.f1 || rec.f0 || 440) / (rec.f0 || 440), t / dur);
      phase += f / sampleRate;
      const p = phase - Math.floor(phase);
      let s: number;
      switch (rec.wave) {
        case 'noise': s = nz(); break;
        case 'square': s = p < 0.5 ? 0.8 : -0.8; break;
        case 'sawtooth': s = (2 * p - 1) * 0.8; break;
        case 'triangle': s = 1 - 4 * Math.abs(p - 0.5); break;
        default: s = Math.sin(2 * Math.PI * p);
      }
      if (rec.lp0) {
        const fc = rec.lp0 * Math.pow(Math.max(40, rec.lp1 || rec.lp0) / rec.lp0, t / dur);
        const k = lpCoef(fc, sampleRate);
        a += k * (s - a);
        b += k * (a - b);
        s = b;
      }
      out[i] += s * env;
    }
  };
  voice(r, r.vol);
  if (r.layer) voice({ ...r, ...r.layer, dur } as SfxRecipeDef, r.vol * 0.6);
  return out;
}

function renderCues(out: StereoPcm, cues: ResolvedSoundtrack['cues'], gain: number) {
  const sr = out.sampleRate;
  cues.forEach((c, i) => {
    const wave = renderSfxRecipe(c.recipe, sr, 1337 + i);
    // Recipes are mixed for a game; film cues get a little more presence.
    addVoice(out, Math.round(c.time * sr), wave.length, 0, (_t, k) => 1.4 * gain * c.volume * wave[k]);
  });
}

// =====================================================================================================================
// Mixing
// =====================================================================================================================
function empty(n: number, sampleRate: number): StereoPcm {
  return { sampleRate, left: new Float32Array(n), right: new Float32Array(n) };
}

/** Soft knee limiter: linear below 0.6, smoothly saturates towards 1.0 (never clips). */
function limit(x: number) {
  const a = Math.abs(x);
  if (a <= 0.6) return x;
  return Math.sign(x) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
}

function ramp(pcm: StereoPcm, from: number, len: number, up: boolean) {
  const n = pcm.left.length;
  for (let k = 0; k < len; k++) {
    const i = up ? from + k : from - len + k;
    if (i < 0 || i >= n) continue;
    const g = up ? k / len : 1 - k / len;
    pcm.left[i] *= g;
    pcm.right[i] *= g;
  }
}

export interface SceneLayers {
  music: StereoPcm;
  ambience: StereoPcm;
  cues: StereoPcm;
  resolved: ResolvedSoundtrack;
}

/** Renders a scene's three layers for `samples` samples. `musicOffsetSamples` places the music on the global grid. */
export function renderSoundtrackLayers(scene: SoundtrackScene, samples: number, sampleRate = SOUNDTRACK_SAMPLE_RATE, musicOffsetSamples = 0): SceneLayers | null {
  const r = resolveSoundtrack(scene);
  if (!r) return null;
  const music = empty(samples, sampleRate);
  const ambience = empty(samples, sampleRate);
  const cues = empty(samples, sampleRate);
  renderMusic(music, r.mood, r.tempo, r.seed, musicOffsetSamples, r.musicGain);
  renderAmbience(ambience, r.ambience, r.seed + hashString(r.ambience), r.ambienceGain);
  renderCues(cues, r.cues, 1);
  return { music, ambience, cues, resolved: r };
}

/** One scene's soundtrack, faded in and out (live Preview / Player playback). Null when the scene has none. */
export function renderSceneSoundtrack(scene: SoundtrackScene, sampleRate = SOUNDTRACK_SAMPLE_RATE): StereoPcm | null {
  const n = Math.max(1, Math.round(Math.max(0.1, num(scene.durationSeconds, 8)) * sampleRate));
  const layers = renderSoundtrackLayers(scene, n, sampleRate, 0);
  if (!layers) return null;
  const out = empty(n, sampleRate);
  const v = layers.resolved.volume;
  for (let i = 0; i < n; i++) {
    out.left[i] = (layers.music.left[i] + layers.ambience.left[i] + layers.cues.left[i]) * v;
    out.right[i] = (layers.music.right[i] + layers.ambience.right[i] + layers.cues.right[i]) * v;
  }
  ramp(out, 0, Math.round(0.3 * sampleRate), true);
  ramp(out, n, Math.round(Math.min(0.8, n / sampleRate / 4) * sampleRate), false);
  for (let i = 0; i < n; i++) {
    out.left[i] = limit(out.left[i]);
    out.right[i] = limit(out.right[i]);
  }
  return out;
}

/**
 * A whole film (scenes in order) as one track: same-mood scenes continue the music across cuts, a mood change
 * crossfades, ambience crossfades at every cut, fade in at the start and out at the end.
 */
export function renderFilmSoundtrack(scenes: SoundtrackScene[], sampleRate = SOUNDTRACK_SAMPLE_RATE): StereoPcm {
  const lengths = scenes.map((s) => Math.max(1, Math.round(Math.max(0.1, num(s.durationSeconds, 8)) * sampleRate)));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out = empty(total, sampleRate);
  const xf = Math.round(0.5 * sampleRate);
  let start = 0;
  let musicOffset = 0;
  let prevMood: string | null = null;
  scenes.forEach((scene, i) => {
    const n = lengths[i];
    const r = resolveSoundtrack(scene);
    const moodKey = r ? `${r.mood}|${r.tempo || ''}|${r.seed}` : null;
    const continues = moodKey !== null && moodKey === prevMood && r!.mood !== 'none';
    if (!continues) musicOffset = 0;
    const last = i === scenes.length - 1;
    const tail = last ? 0 : xf;
    const layers = renderSoundtrackLayers(scene, n + tail, sampleRate, musicOffset);
    const nextR = last ? null : resolveSoundtrack(scenes[i + 1]);
    const nextContinues = !!(r && nextR && nextR.mood === r.mood && r.mood !== 'none' && (nextR.tempo || '') === (r.tempo || '') && nextR.seed === r.seed);
    if (layers) {
      const v = layers.resolved.volume;
      // music: no seam when the next scene continues it; otherwise fade over the tail
      const music = layers.music;
      if (!continues && i > 0) ramp(music, 0, xf, true);
      if (nextContinues) {
        music.left.fill(0, n);
        music.right.fill(0, n);
      } else if (tail) ramp(music, n + tail, tail, false);
      const amb = layers.ambience;
      if (i > 0) ramp(amb, 0, xf, true);
      if (tail) ramp(amb, n + tail, tail, false);
      for (let k = 0; k < n + tail && start + k < total; k++) {
        out.left[start + k] += (music.left[k] + amb.left[k] + (k < n ? layers.cues.left[k] : 0)) * v;
        out.right[start + k] += (music.right[k] + amb.right[k] + (k < n ? layers.cues.right[k] : 0)) * v;
      }
    }
    prevMood = moodKey;
    musicOffset += n;
    start += n;
  });
  ramp(out, 0, Math.round(0.4 * sampleRate), true);
  ramp(out, total, Math.round(Math.min(1.5, total / sampleRate / 4) * sampleRate), false);
  for (let i = 0; i < total; i++) {
    out.left[i] = limit(out.left[i]);
    out.right[i] = limit(out.right[i]);
  }
  return out;
}

/** RMS of a window (seconds), both channels — used by tests and the verifier-free QA tools. */
export function windowRms(pcm: StereoPcm, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * pcm.sampleRate));
  const b = Math.min(pcm.left.length, Math.floor(to * pcm.sampleRate));
  let s = 0;
  for (let i = a; i < b; i++) s += pcm.left[i] * pcm.left[i] + pcm.right[i] * pcm.right[i];
  return Math.sqrt(s / Math.max(1, 2 * (b - a)));
}
