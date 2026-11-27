import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareGameReports, evaluateGame, GAME_EVAL_WEIGHTS, gameGrade, offlineGameLevels } from '../src/agent/gameEval';
import { buildGenreKit } from '../src/agent/genreKits';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';

const golden = JSON.parse(fs.readFileSync('eval/game-prompts.json', 'utf-8')) as { prompts: Array<{ id: string; prompt: string }> };

test('weights add up to 100 and every report covers each dimension once', () => {
  assert.equal(Object.values(GAME_EVAL_WEIGHTS).reduce((n, w) => n + w.weight, 0), 100);
  const report = evaluateGame({ scenes: [buildGenreKit('platformer', { difficulty: 1 })] });
  assert.deepEqual(report.dimensions.map((d) => d.id).sort(), Object.keys(GAME_EVAL_WEIGHTS).sort());
  for (const d of report.dimensions) assert.ok(d.score >= 0 && d.score <= 100);
});

test('the offline director clears every golden game prompt: verified, bot-winnable levels', () => {
  assert.ok(golden.prompts.length >= 8);
  for (const p of golden.prompts) {
    const levels = offlineGameLevels(p.prompt);
    assert.ok(levels && levels.length >= 3, `${p.id}: a multi-level game is built`);
    const report = evaluateGame({ scenes: levels! });
    assert.deepEqual(report.levels.filter((l) => l.outcome !== 'won').map((l) => l.title), [], `${p.id}: every level is won by a bot`);
    assert.equal(report.levels.reduce((n, l) => n + l.verifierErrors, 0), 0, `${p.id}: no verifier errors`);
    assert.ok(report.score >= 85, `${p.id}: ${report.score}`);
  }
});

test('the eval can fail: an unwinnable or broken level lowers the score and says why', () => {
  const good = buildGenreKit('platformer', { difficulty: 2 });
  const impossible = buildGenreKit('platformer', { difficulty: 2, title: 'Impossible' });
  impossible.gameRules = { ...impossible.gameRules!, winCondition: 'score-threshold', targetScore: 99999 };
  const base = evaluateGame({ scenes: [good, good] });
  const worse = evaluateGame({ scenes: [good, impossible] });
  assert.ok(worse.score < base.score, `${worse.score} < ${base.score}`);
  const winnable = worse.dimensions.find((d) => d.id === 'winnable')!;
  assert.equal(winnable.score, 50);
  assert.ok(winnable.notes.some((n) => /Impossible/.test(n)));
  assert.deepEqual(compareGameReports(base, worse).dimensions.winnable, -50);
  assert.ok(compareGameReports(base, worse).score < 0);
});

test('3D levels are verified but not played (and not penalised as unwinnable); empty input scores 0', () => {
  const three = createBlankSceneSpec('3d');
  three.mode = 'game';
  const report = evaluateGame({ scenes: [three] });
  assert.equal(report.levels[0].outcome, 'unplayed');
  assert.equal(report.dimensions.find((d) => d.id === 'winnable')!.score, 0);
  assert.equal(evaluateGame({ scenes: [] }).score, 0);
  assert.equal(evaluateGame({ scenes: [] }).grade, 'D');
});

test('evaluation is deterministic; grades follow the score; a film prompt is not a game request', () => {
  const levels = offlineGameLevels(golden.prompts[0].prompt)!;
  assert.deepEqual(evaluateGame({ scenes: levels }), evaluateGame({ scenes: JSON.parse(JSON.stringify(levels)) }));
  assert.deepEqual([90, 75, 60, 10].map(gameGrade), ['A', 'B', 'C', 'D']);
  assert.equal(offlineGameLevels('Làm phim hoạt hình 3 cảnh về rô-bốt'), null);
});
