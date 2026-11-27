import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import {
  GRADE_FOR_MOOD,
  GRADE_PRESET_IDS,
  GRADE_PRESETS,
  GRADE_RANGES,
  gradeProblems,
  gradeRgb,
  grainSeed,
  isNeutralGrade,
  resolveGrade,
  sanitizeGrade,
  vignetteMask,
  type ResolvedGrade,
} from '../src/runtime/colorGrade';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import { MUSIC_MOODS } from '../src/audio/soundtrack';
import { dominantMood, unifyFilmGrade } from '../src/agent/filmGrade';
import { normalizeGeneratedSceneSpec } from '../src/agent/storyboardAgent';
import type { ColorGrade, SceneSpec } from '../src/types/scene.schema';

const grade = (g: ColorGrade): ResolvedGrade => {
  const r = resolveGrade(g);
  assert.ok(r, 'expected a non-neutral grade');
  return r;
};
const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('no grade, the neutral preset and untouched numbers resolve to nothing (no pass is rendered)', () => {
  assert.equal(resolveGrade(undefined), null);
  assert.equal(resolveGrade(null), null);
  assert.equal(resolveGrade({}), null);
  assert.equal(resolveGrade({ preset: 'neutral' }), null);
  assert.equal(resolveGrade({ preset: 'neutral', contrast: 1, saturation: 1 }), null);
  for (const id of GRADE_PRESET_IDS.filter((p) => p !== 'neutral')) assert.ok(resolveGrade({ preset: id }), `${id} is a real look`);
});

test('presets are valid, in range and the numbers override them', () => {
  for (const id of GRADE_PRESET_IDS) {
    const preset = GRADE_PRESETS[id] as unknown as Record<string, number>;
    for (const [key, [lo, hi]] of Object.entries(GRADE_RANGES)) assert.ok(preset[key] >= lo && preset[key] <= hi, `${id}.${key}`);
    assert.deepEqual(gradeProblems({ preset: id }), []);
  }
  assert.equal(grade({ preset: 'noir' }).saturation, 0);
  assert.equal(grade({ preset: 'noir', saturation: 0.5 }).saturation, 0.5, 'a number beats the preset');
  assert.equal(grade({ contrast: 9 }).contrast, GRADE_RANGES.contrast[1], 'resolve clamps instead of trusting the data');
});

test('the film moods all have a look', () => {
  for (const mood of MUSIC_MOODS.filter((m) => m !== 'none')) assert.ok(GRADE_FOR_MOOD[mood], `mood ${mood}`);
  for (const preset of Object.values(GRADE_FOR_MOOD)) assert.ok(GRADE_PRESET_IDS.includes(preset));
});

test('gradeProblems / sanitizeGrade report and repair bad data', () => {
  assert.deepEqual(gradeProblems(undefined), []);
  assert.ok(gradeProblems('warm').length, 'a string is not a grade');
  assert.ok(gradeProblems({ preset: 'sparkly' }).some((p) => p.includes('unknown preset')));
  assert.ok(gradeProblems({ exposure: 5 }).some((p) => p.startsWith('exposure')));
  assert.ok(gradeProblems({ grain: Number.NaN }).some((p) => p.startsWith('grain')));
  assert.ok(gradeProblems({ shadows: 'teal' }).some((p) => p.startsWith('shadows')));
  const fixed = sanitizeGrade({ preset: 'sparkly', exposure: 5, contrast: 1.2, shadows: 'teal', highlights: '#ffaa00', junk: 1 })!;
  assert.deepEqual(fixed, { exposure: 2, contrast: 1.2, highlights: '#ffaa00' });
  assert.deepEqual(gradeProblems(fixed), []);
  assert.equal(sanitizeGrade({ preset: 'nope' }), undefined);
  assert.equal(sanitizeGrade([1]), undefined);
});

test('the display maths (CPU reference of the GLSL / TSL passes)', () => {
  const mid: [number, number, number] = [0.4, 0.5, 0.6];
  const id = grade({ vignette: 0.001 });
  const same = gradeRgb(mid, { ...id, vignette: 0 });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(same[i] - mid[i]) < 1e-9, 'a neutral grade leaves colour alone');
  // exposure: +1 stop doubles a dark value
  assert.ok(Math.abs(gradeRgb([0.2, 0.2, 0.2], grade({ exposure: 1 }))[0] - 0.4) < 1e-9);
  // saturation 0 = grey of equal luma
  const grey = gradeRgb([0.8, 0.3, 0.1], grade({ saturation: 0 }));
  assert.ok(spread(grey) < 1e-9);
  assert.ok(Math.abs(grey[0] - luma([0.8, 0.3, 0.1])) < 1e-9, 'saturation keeps luma');
  // warm / cool move red against blue
  const warm = gradeRgb([0.5, 0.5, 0.5], grade({ temperature: 1 }));
  assert.ok(warm[0] > 0.5 && warm[2] < 0.5);
  const cool = gradeRgb([0.5, 0.5, 0.5], grade({ temperature: -1 }));
  assert.ok(cool[0] < 0.5 && cool[2] > 0.5);
  // contrast pivots on mid grey
  assert.ok(Math.abs(gradeRgb([0.5, 0.5, 0.5], grade({ contrast: 1.5 }))[1] - 0.5) < 1e-9);
  assert.ok(gradeRgb([0.7, 0.7, 0.7], grade({ contrast: 1.5 }))[1] > 0.7);
  assert.ok(gradeRgb([0.3, 0.3, 0.3], grade({ contrast: 1.5 }))[1] < 0.3);
  // fade lifts blacks
  assert.ok(Math.abs(gradeRgb([0, 0, 0], grade({ fade: 0.2 }))[0] - 0.2) < 1e-9);
  // vignette: centre untouched, far corner black
  const v = grade({ vignette: 1 });
  assert.ok(Math.abs(gradeRgb([0.6, 0.6, 0.6], v, 0.5, 0.5)[0] - 0.6) < 1e-9);
  assert.ok(gradeRgb([0.6, 0.6, 0.6], v, 0, 0)[0] < 1e-9);
  assert.equal(vignetteMask(0.5, 0.5), 0);
  assert.ok(vignetteMask(0, 0) > 0.99);
  // grain is zero-mean noise on every channel alike
  const g = grade({ grain: 1 });
  assert.ok(gradeRgb([0.5, 0.5, 0.5], g, 0.5, 0.5, 1)[0] > 0.5);
  assert.ok(gradeRgb([0.5, 0.5, 0.5], g, 0.5, 0.5, 0)[0] < 0.5);
  assert.equal(gradeRgb([0.5, 0.5, 0.5], g, 0.5, 0.5, 0.5)[0], 0.5);
  // split toning: teal in the shadows, orange in the highlights, mids stay put
  const to = grade({ preset: 'teal-orange', vignette: 0, contrast: 1, saturation: 1 });
  const dark = gradeRgb([0.1, 0.1, 0.1], to);
  assert.ok(dark[2] > dark[0], 'shadows lean teal (more blue than red)');
  const bright = gradeRgb([0.9, 0.9, 0.9], to);
  assert.ok(bright[0] > bright[2], 'highlights lean orange (more red than blue)');
  // output is always displayable
  for (const id of GRADE_PRESET_IDS) {
    const r = resolveGrade({ preset: id });
    if (!r) continue;
    for (const px of [[0, 0, 0], [1, 1, 1], [0.9, 0.1, 0.4]] as Array<[number, number, number]>) {
      for (const c of gradeRgb(px, r, 0.2, 0.9, 0.7)) assert.ok(c >= 0 && c <= 1, `${id} stays in 0..1`);
    }
  }
  assert.ok(isNeutralGrade({ ...id, vignette: 0 }));
});

test('noir is a real black-and-white look', () => {
  const noir = grade({ preset: 'noir', grain: 0 });
  assert.ok(spread(gradeRgb([0.9, 0.4, 0.2], noir, 0.5, 0.5)) < 1e-9);
  assert.ok(luma(gradeRgb([0.5, 0.5, 0.5], noir, 0.5, 0.5)) < 0.5, 'a little darker than the source');
});

test('grain seed changes once per film frame and repeats for the same time', () => {
  assert.equal(grainSeed(1.0), grainSeed(1.0));
  assert.equal(grainSeed(1.0), grainSeed(1.0 + 0.01), 'inside one 1/24 s frame');
  assert.notEqual(grainSeed(1.0), grainSeed(1.0 + 1 / 24));
  assert.equal(grainSeed(-3), grainSeed(0));
  for (const t of [0, 0.5, 7.3, 1234.5]) assert.ok(grainSeed(t) >= 0 && grainSeed(t) < 1);
});

test('verifier: a bad grade is a fixable warning, a 2D scene ignoring it is flagged', () => {
  const scene = createBlankSceneSpec('3d');
  assert.ok(!verifySceneSpec(scene).issues.some((i) => i.code.startsWith('grade.')));
  scene.grade = { preset: 'warm', vignette: 0.2 };
  assert.ok(!verifySceneSpec(scene).issues.some((i) => i.code.startsWith('grade.')), 'a good grade is quiet');
  scene.grade = { preset: 'warm', exposure: 7, shadows: 'x' } as ColorGrade;
  const bad = verifySceneSpec(scene).issues.find((i) => i.code === 'grade.invalid');
  assert.ok(bad && bad.fixable && bad.severity === 'warning');
  const fixed = autoFixSceneSpec(scene).spec;
  assert.deepEqual(fixed.grade, { preset: 'warm', exposure: 2 });
  assert.ok(!verifySceneSpec(fixed).issues.some((i) => i.code.startsWith('grade.')));

  const flat = createBlankSceneSpec('2d');
  flat.grade = { preset: 'noir' };
  const ignored = verifySceneSpec(flat).issues.find((i) => i.code === 'grade.2d-ignored');
  assert.ok(ignored && ignored.fixable);
  assert.equal(autoFixSceneSpec(flat).spec.grade, undefined);
});

function filmScenes(moods: Array<string | undefined>, grades: Array<ColorGrade | undefined> = []): SceneSpec[] {
  return moods.map((mood, i) => {
    const s = createBlankSceneSpec('3d');
    s.id = `scene-${i}`;
    if (mood) s.soundtrack = { music: { mood: mood as never } };
    if (grades[i]) s.grade = grades[i];
    return s;
  });
}

test('a film gets one look: authored grade is shared, else it follows the dominant mood', () => {
  assert.equal(dominantMood([undefined, 'none']), undefined);
  assert.equal(dominantMood(['calm', 'tense', 'tense']), 'tense');

  const noGrade = filmScenes(['calm', 'adventure', 'adventure']);
  const note = unifyFilmGrade(noGrade, 'film', ['calm', 'adventure', 'adventure']);
  assert.ok(note && /3 scene/.test(note));
  assert.ok(noGrade.every((s) => s.grade?.preset === 'teal-orange'));
  noGrade[0].grade!.vignette = 0.9;
  assert.equal(noGrade[1].grade?.vignette, undefined, 'scenes get their own copy');

  const authored = filmScenes(['calm', 'calm', 'calm'], [undefined, { preset: 'noir' }, { preset: 'cool' }]);
  unifyFilmGrade(authored, 'film');
  assert.equal(authored[0].grade?.preset, 'noir', 'the first authored look is shared with ungraded scenes');
  assert.equal(authored[2].grade?.preset, 'cool', 'a deliberately different scene is left alone');

  const ad = filmScenes(['happy', 'happy']);
  assert.equal(unifyFilmGrade(ad, 'ad-sequence'), null, 'ads are not graded unless the director chose a look');
  assert.ok(ad.every((s) => !s.grade));
  assert.equal(unifyFilmGrade(filmScenes(['calm']), 'film'), null, 'a single scene is not a film');
  const levels = [createBlankSceneSpec('2d'), createBlankSceneSpec('2d')];
  assert.equal(unifyFilmGrade(levels, 'game-levels'), null);
  assert.ok(levels.every((s) => !s.grade));
  const mixed = [createBlankSceneSpec('2d'), ...filmScenes(['calm', 'calm'])];
  unifyFilmGrade(mixed, 'film');
  assert.equal(mixed[0].grade, undefined, '2D scenes never get a grade');
});

test('AI output: a director-authored grade survives storyboard normalisation, bad values are cleaned', () => {
  const kept = normalizeGeneratedSceneSpec({ engineType: '3d', mode: 'media', durationSeconds: 8, grade: { preset: 'noir', vignette: 9, grain: 'lots', shadows: 'blue' } }, '3d');
  assert.equal(kept.grade?.preset, 'noir');
  assert.equal(kept.grade?.vignette, GRADE_RANGES.vignette[1], 'clamped into range');
  assert.equal(kept.grade?.grain, undefined, 'a non-number is dropped');
  assert.equal(kept.grade?.shadows, undefined, 'a non-hex colour is dropped');
  assert.equal(normalizeGeneratedSceneSpec({ engineType: '3d', mode: 'media', grade: 'noir' }, '3d').grade, undefined);
});
