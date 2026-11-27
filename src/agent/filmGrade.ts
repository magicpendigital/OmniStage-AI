/**
 * Phase 6 — one look for a whole film. A film feels graded when every scene shares the same colour treatment, so the storyboard
 * gives them one: the grade of the first graded 3D scene if the director authored one, else (films only) a look chosen from the
 * film's dominant music mood. Pure and deterministic; scenes whose grade the director set differently on purpose are left alone.
 */
import { GRADE_FOR_MOOD } from '../runtime/colorGrade';
import type { ColorGrade, SceneSpec, StoryboardKind } from '../types/scene.schema';

export function dominantMood(moods: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const m of moods) if (m && m !== 'none') counts.set(m, (counts.get(m) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [m, n] of counts) {
    if (n > bestN) {
      best = m;
      bestN = n;
    }
  }
  return best;
}

/** Mutates `scenes` (3D scenes only); returns an editor note, or null when nothing changed. */
export function unifyFilmGrade(scenes: SceneSpec[], kind: StoryboardKind, moods: Array<string | undefined> = []): string | null {
  if (kind === 'game-levels') return null;
  const shots = scenes.filter((s) => s.engineType === '3d');
  if (shots.length < 2) return null;
  const authored = shots.find((s) => s.grade);
  let look: ColorGrade | undefined = authored?.grade ? JSON.parse(JSON.stringify(authored.grade)) : undefined;
  let how = 'the film\'s authored look';
  if (!look) {
    if (kind !== 'film') return null; // ads keep their own palette unless the director chose a grade
    const mood = dominantMood(moods.length ? moods : shots.map((s) => s.soundtrack?.music?.mood));
    const preset = (mood && GRADE_FOR_MOOD[mood]) || 'warm';
    look = { preset };
    how = `the "${preset}" look for a ${mood ?? 'warm'} film`;
  }
  let changed = 0;
  for (const s of shots) {
    if (s.grade) continue;
    s.grade = JSON.parse(JSON.stringify(look));
    changed++;
  }
  return changed ? `Editor: ${changed} scene(s) now share ${how} (colour grade).` : null;
}
