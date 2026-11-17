import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFilmReports, EVAL_WEIGHTS, evaluateFilm, filmGrade, unknownAssets } from '../src/agent/filmEval';
import { buildLocalStoryBible } from '../src/agent/storyBible';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent } from '../src/agent/storyboardAgent';
import type { SceneSpec } from '../src/types/scene.schema';

function offlineFilm(prompt: string): SceneSpec[] {
  const intent = detectStoryboardIntent(prompt)!;
  const plan = buildLocalStoryboardPlan(prompt, intent);
  return plan.beats.map((_, i) => buildLocalSceneForBeat(prompt, plan, i));
}

const PROMPT = 'Làm phim hoạt hình 3 cảnh về rô-bốt';

test('weights add up to 100 and cover every dimension once', () => {
  assert.equal(Object.values(EVAL_WEIGHTS).reduce((n, w) => n + w.weight, 0), 100);
  const report = evaluateFilm({ scenes: offlineFilm(PROMPT) });
  assert.deepEqual(report.dimensions.map((d) => d.id).sort(), Object.keys(EVAL_WEIGHTS).sort());
  for (const d of report.dimensions) {
    assert.ok(d.score >= 0 && d.score <= 100, `${d.id} ${d.score}`);
    assert.equal(d.weight, EVAL_WEIGHTS[d.id].weight);
  }
});

test('evaluation is deterministic and bounded', () => {
  const film = offlineFilm(PROMPT);
  const a = evaluateFilm({ scenes: film });
  const b = evaluateFilm({ scenes: JSON.parse(JSON.stringify(film)) });
  assert.deepEqual(a, b);
  assert.ok(a.score > 0 && a.score <= 100);
  assert.equal(a.scenes, 3);
  assert.ok(a.durationSeconds > 0);
  assert.equal(a.hasBible, false);
});

test('empty input scores 0 without throwing', () => {
  const r = evaluateFilm({ scenes: [] });
  assert.equal(r.score, 0);
  assert.equal(r.grade, 'D');
  assert.equal(r.scenes, 0);
  assert.equal(r.dimensions.length, Object.keys(EVAL_WEIGHTS).length);
});

test('grades follow the thresholds', () => {
  assert.equal(filmGrade(90), 'A');
  assert.equal(filmGrade(85), 'A');
  assert.equal(filmGrade(70), 'B');
  assert.equal(filmGrade(55), 'C');
  assert.equal(filmGrade(54), 'D');
});

test('a story bible lifts the story dimension and is detected from sequence meta', () => {
  const film = offlineFilm(PROMPT);
  const plain = evaluateFilm({ scenes: film });
  const bible = buildLocalStoryBible(PROMPT, { sceneCount: film.length, kind: 'film' });
  const withBible = evaluateFilm({ scenes: film, bible });
  const story = (r: typeof plain) => r.dimensions.find((d) => d.id === 'story')!.score;
  assert.ok(withBible.hasBible);
  assert.ok(story(withBible) > story(plain), `${story(withBible)} should beat ${story(plain)}`);
  assert.ok(withBible.score > plain.score);

  const tagged = film.map((s) => ({ ...s, sequence: { ...(s.sequence || {}), bible } })) as SceneSpec[];
  const viaMeta = evaluateFilm({ scenes: tagged });
  assert.ok(viaMeta.hasBible);
  assert.equal(story(viaMeta), story(withBible));
});

test('without a bible the story score stays capped so offline films cannot look finished', () => {
  const report = evaluateFilm({ scenes: offlineFilm(PROMPT) });
  assert.ok(report.dimensions.find((d) => d.id === 'story')!.score <= 40);
});

test('compare reports per dimension', () => {
  const film = offlineFilm(PROMPT);
  const before = evaluateFilm({ scenes: film });
  const after = evaluateFilm({ scenes: film, bible: buildLocalStoryBible(PROMPT, { sceneCount: film.length, kind: 'film' }) });
  const diff = compareFilmReports(before, after);
  assert.equal(diff.total, after.score - before.score);
  assert.ok(diff.dimensions.story > 0);
  assert.equal(diff.dimensions.technical, 0);
});

test('stripping acting, shots and dialogue lowers the score', () => {
  const film = offlineFilm(PROMPT);
  const good = evaluateFilm({ scenes: film });
  const flat = film.map((s) => ({
    ...s,
    actors: (s.actors || []).map((a) => ({ ...a, performance: [] })),
    shots: [],
    dialogue: [],
    captions: [],
  })) as SceneSpec[];
  const bad = evaluateFilm({ scenes: flat });
  assert.ok(bad.score < good.score, `${bad.score} should be under ${good.score}`);
  const diff = compareFilmReports(good, bad);
  assert.ok(diff.dimensions.acting < 0);
});

test('unknownAssets lists assets missing from the registry', () => {
  const film = offlineFilm(PROMPT);
  assert.deepEqual(unknownAssets(film), []);
  const bad = [{ ...film[0], actors: [...(film[0].actors || []), { ...(film[0].actors![0]), id: 'ghost', assetId: 'nope-1' }] }] as SceneSpec[];
  assert.deepEqual(unknownAssets(bad), ['nope-1']);
});
