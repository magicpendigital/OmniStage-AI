import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenreKit, GENRE_KITS, isGenreKitId, kitForGenre, KIT_SCENE_FIELDS } from '../src/agent/genreKits';
import { buildLocalGameDesign, detectGameGenre } from '../src/agent/gameDesign';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan } from '../src/agent/storyboardAgent';
import { verifySceneSpec } from '../src/verification/sceneVerifier';

test('every kit at every difficulty verifies with no errors and stays a 2D game', () => {
  for (const kit of GENRE_KITS) {
    for (let d = 1; d <= 6; d++) {
      const spec = buildGenreKit(kit.id, { difficulty: d, index: d - 1, total: 6 });
      assert.equal(spec.engineType, '2d');
      assert.equal(spec.mode, 'game');
      const errors = verifySceneSpec(spec).issues.filter((i) => i.severity === 'error');
      assert.deepEqual(errors.map((e) => e.message), [], `${kit.id} d${d}`);
    }
  }
});

test('kits are deterministic and independent copies; difficulty changes the level', () => {
  const strip = (s: ReturnType<typeof buildGenreKit>) => JSON.stringify({ ...s, id: undefined, nodes2D: s.nodes2D.map((n) => ({ ...n, id: undefined })) });
  for (const kit of GENRE_KITS) {
    assert.equal(strip(buildGenreKit(kit.id, { difficulty: 3 })), strip(buildGenreKit(kit.id, { difficulty: 3 })), kit.id);
    assert.notEqual(strip(buildGenreKit(kit.id, { difficulty: 1 })), strip(buildGenreKit(kit.id, { difficulty: 6 })), `${kit.id} scales`);
  }
});

test('kit ids, genres and the unknown-kit error', () => {
  assert.ok(isGenreKitId('survival'));
  assert.ok(!isGenreKitId('racing'));
  assert.equal(kitForGenre('key-hunt'), 'key-hunt');
  assert.equal(kitForGenre('rpg' as never), 'platformer');
  assert.throws(() => buildGenreKit('racing' as never), /Unknown genre kit "racing"/);
  assert.ok(KIT_SCENE_FIELDS.includes('nodes2D'));
});

test('the offline director picks a kit from the prompt and the level comes from it', () => {
  assert.equal(detectGameGenre('a survival game, last 30 seconds'), 'survival');
  assert.equal(detectGameGenre('collect keys and open the door'), 'key-hunt');
  assert.equal(detectGameGenre('dodge turret bullets'), 'turret-dodge');
  assert.equal(detectGameGenre('a cute jumping game'), 'platformer');
  assert.equal(buildLocalGameDesign('survival game', { sceneCount: 2 }).genre, 'survival');

  const plan = buildLocalStoryboardPlan('survive the storm', { sceneCount: 2, kind: 'game-levels', engineType: '2d' });
  const level = buildLocalSceneForBeat('survive the storm', plan, 0);
  assert.equal(level.gameRules?.winCondition, 'survive-timer');
  assert.deepEqual(verifySceneSpec(level).issues.filter((i) => i.severity === 'error'), []);
});
