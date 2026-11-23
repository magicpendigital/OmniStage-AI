import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_TEMPLATES, buildStartScene } from '../src/state/startTemplates';
import { verifySceneSpec } from '../src/verification/sceneVerifier';

for (const t of START_TEMPLATES) {
  test(`start template "${t.id}" opens in the right mode and verifies without errors`, () => {
    const spec = buildStartScene(t.id);
    const isGame = t.tags.includes('Game');
    assert.equal(spec.mode, isGame ? 'game' : 'media', 'mode matches the card');
    assert.equal(spec.engineType, t.tags.includes('2D') ? '2d' : '3d', 'engine matches the card');
    const report = verifySceneSpec(spec);
    assert.deepEqual(report.issues.filter((i) => i.severity === 'error').map((i) => i.message), [], 'no verifier errors');
  });
}

test('start templates build independent copies', () => {
  const a = buildStartScene('playable-ad');
  const b = buildStartScene('playable-ad');
  a.title = 'changed';
  assert.notEqual(b.title, 'changed');
});

import { pickTemplate } from '../src/state/startTemplates';

test('pickTemplate routes an idea to the closest card', () => {
  assert.equal(pickTemplate('a 2D platformer with spikes').id, 'platformer-2d');
  assert.equal(pickTemplate('A short film about a robot, 4 scenes').id, 'short-film');
  assert.equal(pickTemplate('product turntable for headphones').id, 'showcase-3d');
  assert.equal(pickTemplate('tap to collect coins').id, 'playable-ad');
  assert.equal(pickTemplate('something fun').id, 'playable-ad');
});
