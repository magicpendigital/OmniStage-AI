/**
 * Film-wide music cue sheet (Phase 11E, P0 #4e). Scenes used to pick a mood each, so a film played five unrelated pieces at five
 * tempi. The cue sheet plans the score once from the story bible: ONE tempo for the whole film (every piece pulses together, so a
 * crossfade between moods does not clash) and a mood per ACT, not per scene (the music changes when the story turns).
 * Pure and deterministic; the soundtrack renderer already continues the same piece across scenes of the same mood.
 */
import type { SceneSpec, StoryBible } from '../types/scene.schema';
import type { MusicMood } from '../types/scene.schema';

/** Default tempo of each mood in `soundtrack.ts` (kept in sync by tests/musicCues.test.ts). */
export const MOOD_BPM: Record<Exclude<MusicMood, 'none'>, number> = {
  calm: 76, happy: 112, playful: 124, adventure: 118, epic: 88, tense: 100, sad: 68, mysterious: 72,
};

const RULES: Array<[RegExp, Exclude<MusicMood, 'none'>]> = [
  [/\b(afraid|fear|scared|nervous|anxious|panic|dread|tense|worr|danger|threat|sợ|lo lắng|hoảng|căng)/i, 'tense'],
  [/\b(sad|lonely|alone|grief|loss|lost|hurt|regret|cry|buồn|cô đơn|mất)/i, 'sad'],
  [/\b(mysteri|curious|wonder|puzzl|uncertain|secret|tò mò|bí ẩn)/i, 'mysterious'],
  [/\b(triumph|epic|determin|brave|courage|heroic|hùng|quyết tâm|dũng cảm)/i, 'epic'],
  [/\b(playful|mischiev|silly|giddy|funny|tinh nghịch|vui nhộn)/i, 'playful'],
  [/\b(joy|happy|proud|relief|delight|hope|warm|love|grateful|vui|hạnh phúc|tự hào|ấm áp|nhẹ nhõm)/i, 'happy'],
  [/\b(calm|peace|content|quiet|sleepy|yên|bình yên)/i, 'calm'],
  [/\b(excite|eager|adventur|explor|journey|hào hứng|phiêu lưu)/i, 'adventure'],
];

/** Mood of an emotion phrase from a beat ("afraid, then hopeful"): the LAST emotion it names wins (where the scene ends up). */
export function moodForEmotion(text: string | undefined): Exclude<MusicMood, 'none'> | undefined {
  if (!text) return undefined;
  let best: { mood: Exclude<MusicMood, 'none'>; at: number } | undefined;
  for (const [re, mood] of RULES) {
    const m = re.exec(text);
    if (m && (!best || m.index > best.at)) best = { mood, at: m.index };
  }
  return best?.mood;
}

export interface CueSheetEntry {
  /** Mood planned for this scene's act (undefined: leave the scene's own mood). */
  mood?: Exclude<MusicMood, 'none'>;
  /** The film's one tempo. */
  tempo: number;
  act: 1 | 2 | 3;
}

/** Act of scene `i` of `n` (thirds; two scenes: 1 and 3). */
export function actOf(i: number, n: number): 1 | 2 | 3 {
  if (n <= 1) return 1;
  const f = i / (n - 1);
  return f < 0.34 ? 1 : f < 0.67 ? 2 : 3;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * The score plan for a film of `n` scenes. With a bible each act gets the most frequent mood of its beats' closing emotions
 * (the later beat wins a tie); without one only the shared tempo is planned (`moods` = the scenes' own moods, when known).
 */
export function musicCueSheet(n: number, bible?: StoryBible, ownMoods: Array<MusicMood | undefined> = []): CueSheetEntry[] {
  const moods: Array<Exclude<MusicMood, 'none'> | undefined> = Array.from({ length: n }, (_, i) => {
    const own = ownMoods[i];
    return own && own !== 'none' ? own : undefined;
  });
  const actMood = new Map<1 | 2 | 3, Exclude<MusicMood, 'none'>>();
  if (bible?.beats.length) {
    for (const act of [1, 2, 3] as const) {
      const counts = new Map<Exclude<MusicMood, 'none'>, { n: number; last: number }>();
      for (let i = 0; i < n; i++) {
        if (actOf(i, n) !== act) continue;
        const beat = bible.beats[i];
        const mood = moodForEmotion(beat?.emotionEnd) || moodForEmotion(beat?.emotionStart);
        if (!mood) continue;
        const c = counts.get(mood) || { n: 0, last: -1 };
        counts.set(mood, { n: c.n + 1, last: i });
      }
      const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0];
      if (top) actMood.set(act, top[0]);
    }
  }
  const planned = Array.from({ length: n }, (_, i) => actMood.get(actOf(i, n)) ?? moods[i]);
  const bpms = planned.filter((m): m is Exclude<MusicMood, 'none'> => !!m).map((m) => MOOD_BPM[m]);
  const tempo = bpms.length ? median(bpms) : 104;
  return planned.map((mood, i) => ({ ...(mood ? { mood } : {}), tempo, act: actOf(i, n) }));
}

/** The scene with its music following the cue sheet entry (a scene without music, or one set to 'none', keeps its silence). */
export function applyCue(scene: SceneSpec, cue: CueSheetEntry | undefined): SceneSpec {
  const music = scene.soundtrack?.music;
  if (!cue || !music || music.mood === 'none') return scene;
  const mood = cue.mood || music.mood;
  if (music.mood === mood && music.tempo === cue.tempo) return scene;
  return { ...scene, soundtrack: { ...scene.soundtrack, music: { ...music, mood, tempo: cue.tempo } } };
}
