import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlaytestReport, keysToMask, maskToKeys, playtestScene, replayTape } from '../src/playtest/bot2d';
import { openHeadlessSession2D, runHeadless2D } from '../src/playtest/headless2d';
import { buildGenreKit } from '../src/agent/genreKits';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan } from '../src/agent/storyboardAgent';
import { buildStartScene, START_TEMPLATES } from '../src/state/startTemplates';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { checkScene } from '../src/agent/tools/sceneTools';
import { boundRuntimeStore } from '../src/runtime/host';
import { isSfxMuted } from '../src/audio/audioBus';

test('headless session: the real runtime runs, the host and mute are restored afterwards', () => {
  const before = boundRuntimeStore();
  const muted = isSfxMuted();
  const spec = buildGenreKit('platformer', { difficulty: 1 });
  const seen = runHeadless2D(spec, (s) => {
    assert.notEqual(boundRuntimeStore(), before, 'the headless store is bound while it runs');
    assert.equal(isSfxMuted(), true, 'sound is muted while a bot plays');
    s.keys.add('d');
    for (let i = 0; i < 60; i++) s.step();
    return Object.values(s.bodies).some((b) => b.x > 0);
  });
  assert.ok(seen);
  assert.equal(boundRuntimeStore(), before);
  assert.equal(isSfxMuted(), muted);
});

test('a game round is not frozen at durationSeconds: physics and the timer keep running until the round ends', () => {
  const spec = buildGenreKit('platformer', { difficulty: 1 });
  spec.durationSeconds = 2;
  const session = openHeadlessSession2D(spec);
  try {
    for (let i = 0; i < 60 * 6; i++) session.step();
    const state = session.store.getState();
    assert.equal(state.isPlaying, true, 'still playing after the scene duration');
    assert.ok(state.currentTime > 2, 'time went past the duration');
    assert.equal(state.gameEnded, false);
  } finally {
    session.dispose();
  }
});

test('input masks round-trip', () => {
  const keys = new Set<string>();
  for (const mask of [0, 1, 2, 3, 16, 18, 31]) {
    maskToKeys(mask, keys);
    assert.equal(keysToMask(keys), mask);
  }
});

test('every genre kit is won by a bot, never by doing nothing (except the gentle survival intro), and its tape replays', () => {
  for (const id of ['platformer', 'key-hunt', 'turret-dodge', 'survival'] as const) {
    for (const difficulty of [1, 2, 3, 6]) {
      const spec = buildGenreKit(id, { difficulty, index: difficulty - 1, total: 6 });
      const report = playtestScene(spec);
      const label = `${id} d${difficulty}`;
      assert.equal(report.outcome, 'won', `${label}: ${formatPlaytestReport(report)}`);
      assert.ok(report.winningTape && report.winningTape.length > 0, `${label}: a winning tape exists`);
      const replay = replayTape(spec, report.winningTape!);
      assert.equal(replay.won, true, `${label}: the tape reproduces the win`);
      const idle = report.runs.find((r) => r.strategy === 'idle');
      if (!(id === 'survival' && difficulty <= 2)) assert.equal(idle?.won, false, `${label}: idle must not win`);
    }
  }
});

test('the offline platformer levels and the game start templates are winnable by a bot', () => {
  const plan = buildLocalStoryboardPlan('platformer', { sceneCount: 3, kind: 'game-levels', engineType: '2d' });
  for (let i = 0; i < 3; i++) {
    const report = playtestScene(buildLocalSceneForBeat('platformer', plan, i));
    assert.equal(report.outcome, 'won', `level ${i + 1}: ${formatPlaytestReport(report)}`);
  }
  for (const t of START_TEMPLATES.filter((x) => x.tags.includes('Game') && x.tags.includes('2D'))) {
    const report = playtestScene(buildStartScene(t.id));
    assert.equal(report.outcome, 'won', `${t.id}: ${formatPlaytestReport(report)}`);
  }
});

test('the report is deterministic and carries evidence', () => {
  const spec = buildGenreKit('key-hunt', { difficulty: 2 });
  const a = playtestScene(spec);
  const b = playtestScene(spec);
  assert.deepEqual(a, b);
  assert.ok(a.best && a.best.seconds > 0 && a.best.travelled > 0);
  assert.match(formatPlaytestReport(a), /WON/);
});

test('a level nobody can win is "not-won" with a warning that carries numbers, never an error', () => {
  const spec = buildGenreKit('platformer', { difficulty: 1 });
  // More points than every star is worth: nothing a bot can collect wins it.
  spec.gameRules = { ...spec.gameRules!, winCondition: 'score-threshold', targetScore: 99999 };
  const report = playtestScene(spec, { strategies: ['goal', 'idle'] });
  assert.equal(report.outcome, 'not-won');
  const issue = report.issues.find((i) => i.code === 'playtest.not-won');
  assert.ok(issue, 'not-won is reported');
  assert.equal(issue!.severity, 'warn');
  assert.ok(Object.keys(issue!.evidence).length >= 4, 'with evidence');
  assert.ok(report.issues.every((i) => i.severity !== 'error'));
});

test('unsupported scenes are reported, not crashed on', () => {
  const media = createBlankSceneSpec('2d');
  assert.equal(playtestScene(media).outcome, 'unsupported');
  const three = createBlankSceneSpec('3d');
  three.mode = 'game';
  assert.equal(playtestScene(three).outcome, 'unsupported');
  const noPlayer = buildGenreKit('platformer', { difficulty: 1 });
  noPlayer.nodes2D = noPlayer.nodes2D.filter((n) => !n.physics2D.startsWith('player'));
  const report = playtestScene(noPlayer);
  assert.ok(report.issues.some((i) => i.code === 'playtest.no-player'));
});

test('finalized 2D levels (what the studio ships after the logic graph is wired) are still winnable: pickups are collected by the runtime', () => {
  for (const id of ['platformer', 'key-hunt', 'turret-dodge', 'survival'] as const) {
    const checked = checkScene(buildGenreKit(id, { difficulty: 2 }));
    const report = playtestScene(checked.spec);
    assert.equal(report.outcome, 'won', `${id}: ${formatPlaytestReport(report)}`);
  }
  for (const t of START_TEMPLATES.filter((x) => x.tags.includes('Game') && x.tags.includes('2D'))) {
    const report = playtestScene(checkScene(buildStartScene(t.id)).spec);
    assert.equal(report.outcome, 'won', `${t.id}: ${formatPlaytestReport(report)}`);
  }
});

test('the logic finalizer wires no pickup chain for 2D (it would take over collection without removing the pickup) and no 3D-only animation params', () => {
  const checked = checkScene(buildGenreKit('platformer', { difficulty: 1 })).spec;
  const nodes = checked.logicGraph?.nodes ?? [];
  assert.ok(!nodes.some((n) => /collectible/.test(n.id)), 'no collectible chain for 2D pickups');
  for (const n of nodes.filter((x) => x.type === 'action')) {
    assert.equal(n.params.animation, undefined, `${n.id} has no skeletal animation param`);
    assert.equal(n.params.activeClip, undefined, `${n.id} has no clip`);
  }
});

test('a 2D scene saved with the old generated pickup chain is cleaned: the chain is removed and the level plays again', () => {
  const spec = buildGenreKit('platformer', { difficulty: 1 });
  const star = spec.nodes2D.find((n) => n.physics2D === 'collectible')!;
  const port = (id: string) => ({ id, label: id, dataType: 'flow' as const });
  const node = (id: string, type: 'trigger' | 'condition' | 'action', params: Record<string, unknown>) =>
    ({ id, type, category: 'logic-gate', title: id, position: { x: 0, y: 0 }, inputs: [port('in-flow')], outputs: [port('out-flow')], params, status: 'idle', runCount: 0 }) as never;
  spec.logicGraph = {
    nodes: [
      node('node-collectible-star-1-collision', 'trigger', { eventType: 'collision', node2DId: star.id }),
      node('node-collectible-star-1-collect', 'action', { node2DId: star.id, animation: 'bounce', speed: 1.2, scoreDelta: 25, onClickAction: 'collect' }),
      node('node-keep-me', 'action', { node2DId: star.id, animation: 'idle', scoreDelta: 0 }),
    ],
    edges: [{ id: 'e1', sourceNodeId: 'node-collectible-star-1-collision', sourcePortId: 'out-flow', targetNodeId: 'node-collectible-star-1-collect', targetPortId: 'in-flow', active: true }],
  };
  const checked = checkScene(spec).spec;
  const ids = (checked.logicGraph?.nodes ?? []).map((n) => n.id);
  assert.ok(!ids.some((id) => /collectible-star-1/.test(id)), 'generated pickup nodes are gone');
  assert.ok(ids.includes('node-keep-me'), 'authored nodes stay');
  assert.equal(checked.logicGraph!.nodes.find((n) => n.id === 'node-keep-me')!.params.animation, undefined, 'no 3D-only params on 2D actions');
  assert.equal(playtestScene(checked).outcome, 'won');
});

test('a huge scene is refused instead of blocking the process; a busy one still plays within a sane time', () => {
  const huge = buildGenreKit('platformer', { difficulty: 1 });
  const proto = huge.nodes2D.find((n) => n.physics2D === 'static-platform')!;
  for (let i = 0; i < 120; i++) huge.nodes2D.push({ ...proto, id: `pad-${i}`, x: 100 + (i % 20) * 40, y: 100 });
  const refused = playtestScene(huge);
  assert.equal(refused.outcome, 'unsupported');
  assert.match(refused.reason ?? '', /at most/);

  const busy = buildGenreKit('platformer', { difficulty: 6 });
  busy.gameRules = { ...busy.gameRules!, targetScore: 99999 };
  for (let i = 0; i < 40; i++) busy.nodes2D.push({ ...proto, id: `pad-${i}`, x: 80 + (i % 20) * 45, y: 60 + Math.floor(i / 20) * 40 });
  const started = Date.now();
  playtestScene(busy);
  assert.ok(Date.now() - started < 10000, 'bounded work');
});

test('when a round ends after the timeline length the clock stays where it ended', () => {
  const spec = buildGenreKit('survival', { difficulty: 1 });
  spec.durationSeconds = 2;
  spec.gameRules = { ...spec.gameRules!, timeLimitSeconds: 5 };
  const session = openHeadlessSession2D(spec);
  try {
    for (let i = 0; i < 60 * 7 && !session.store.getState().gameEnded; i++) session.step();
    session.step();
    session.step();
    const state = session.store.getState();
    assert.equal(state.gameEnded, true);
    assert.ok(state.currentTime > 4, `time stayed on the round clock (${state.currentTime})`);
    assert.equal(state.isPlaying, false);
  } finally {
    session.dispose();
  }
});
