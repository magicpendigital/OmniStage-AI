import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { openHeadlessSession2D } from '../src/playtest/headless2d';
import { freshGameState, resolveHud } from '../src/runtime/game/state';
import {
  freshWaveProgress,
  MAX_WAVE_COUNT,
  repairWaves,
  resolveWaves,
  stepWaves,
  waveProblems,
  waveStatus,
  wavesMinSeconds,
  type WaveProgress,
} from '../src/runtime/game/waves';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { Node2D, SceneSpec, WaveSpec } from '../src/types/scene.schema';

function node(over: Partial<Node2D> & { id: string }): Node2D {
  return {
    name: over.id, type: 'tile-platform', x: 100, y: 300, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', ...over,
  } as Node2D;
}

function waveScene(waves: WaveSpec[], win: SceneSpec['gameRules']['winCondition'] = 'survive-waves', limit = 60): SceneSpec {
  const spec = createBlankSceneSpec('2d', 'Waves');
  spec.mode = 'game';
  spec.gameRules = { winCondition: win, targetScore: 1000, timeLimitSeconds: limit, instructions: '' };
  spec.logicGraph = { nodes: [], edges: [] };
  spec.nodes2D = [
    node({ id: 'floor', x: 0, y: 560, width: 1000, height: 40, physics2D: 'static-platform' }),
    node({ id: 'hero', physics2D: 'player-platformer', x: 100, y: 500, health: { max: 3, invulnerableSeconds: 0.5 } }),
    node({ id: 'drone', prefab: true, x: 900, y: 40, width: 20, height: 20, physics2D: 'none' }),
  ];
  spec.waves = waves;
  return spec;
}

const noneAlive = () => 0;

/** Runs the schedule for `seconds` at 60 fps, returning every spawn with the time it happened. */
function run(waves: ReturnType<typeof resolveWaves>, seconds: number, alive: (id: string) => number = noneAlive) {
  let p: WaveProgress = freshWaveProgress();
  const events: { t: number; prefabId: string; dx: number; dy: number }[] = [];
  let finishedAt: number | null = null;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const step = stepWaves(waves, p, dt, alive);
    const t = (i + 1) * dt;
    for (const s of step.spawns) events.push({ t, prefabId: s.prefabId, dx: s.dx, dy: s.dy });
    if (step.finished && finishedAt === null) finishedAt = t;
    p = step.next;
  }
  return { p, events, finishedAt };
}

test('resolveWaves clamps counts and numbers, drops unusable groups and names waves', () => {
  const waves = resolveWaves({
    waves: [
      { spawns: [{ prefabId: 'drone', count: 999 }, { prefabId: '', count: 2 }, { prefabId: 'drone', count: 0 }] },
      { name: '  Boss  ', spawns: [{ prefabId: 'drone', count: 2, everySeconds: 0 }], delaySeconds: 500, durationSeconds: 9999 },
      { spawns: [] },
    ],
  });
  assert.equal(waves.length, 2);
  assert.equal(waves[0].groups.length, 1);
  assert.equal(waves[0].groups[0].count, MAX_WAVE_COUNT);
  assert.equal(waves[0].name, 'Wave 1');
  assert.equal(waves[1].name, 'Boss');
  assert.equal(waves[1].delaySeconds, 60);
  assert.equal(waves[1].durationSeconds, 300);
  assert.equal(waves[1].groups[0].everySeconds, 1, 'a zero interval falls back to the default');
  assert.deepEqual(resolveWaves({}), []);
});

test('stepWaves: delay, then spawns at their cadence, then the wave ends after its tail', () => {
  const waves = resolveWaves({ waves: [{ delaySeconds: 1, spawns: [{ prefabId: 'drone', count: 3, everySeconds: 0.5 }] }] });
  assert.equal(wavesMinSeconds(waves), 1 + 1 + 2, 'delay + last spawn offset + tail');
  const { events, finishedAt, p } = run(waves, 6);
  assert.equal(events.length, 3);
  const times = events.map((e) => Math.round(e.t * 10) / 10);
  assert.deepEqual(times, [1, 1.5, 2], 'first spawn right after the delay, then every 0.5 s');
  assert.ok(finishedAt !== null && Math.abs(finishedAt - 4) < 0.05, `finished near 4 s (${finishedAt})`);
  assert.equal(p.phase, 'done');
  // Once done, stepping does nothing.
  const after = stepWaves(waves, p, 1, noneAlive);
  assert.equal(after.spawns.length, 0);
  assert.equal(after.finished, false);
});

test('stepWaves is deterministic and its jitter is bounded and stable', () => {
  const waves = resolveWaves({ waves: [{ delaySeconds: 0, spawns: [{ prefabId: 'drone', count: 6, everySeconds: 0.2, jitterX: 50, jitterY: 10 }] }] });
  const a = run(waves, 4);
  const b = run(waves, 4);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.events.length, 6);
  for (const e of a.events) {
    assert.ok(Math.abs(e.dx) <= 50 && Math.abs(e.dy) <= 10);
  }
  assert.ok(new Set(a.events.map((e) => e.dx)).size > 3, 'the spread actually varies');
  assert.ok(a.events.some((e) => e.dx !== 0));
});

test('a long frame spawns every spawn that became due, never fewer', () => {
  const waves = resolveWaves({ waves: [{ delaySeconds: 0, spawns: [{ prefabId: 'drone', count: 4, everySeconds: 0.5 }] }] });
  const step = stepWaves(waves, freshWaveProgress(), 5, noneAlive);
  assert.equal(step.spawns.length, 4);
});

test('untilCleared holds the wave open while its clones are alive, then lets the next one start', () => {
  const waves = resolveWaves({
    waves: [
      { delaySeconds: 0, untilCleared: true, spawns: [{ prefabId: 'drone', count: 1 }] },
      { delaySeconds: 0, spawns: [{ prefabId: 'drone', count: 1 }] },
    ],
  });
  let alive = 1;
  const early = run(waves, 10, () => alive);
  assert.equal(early.p.index, 0, 'still on wave 1: a drone is alive');
  assert.equal(early.finishedAt, null);
  alive = 0;
  const late = run(waves, 10, () => alive);
  assert.ok(late.finishedAt !== null);
  assert.equal(late.p.phase, 'done');
});

test('waveStatus and the HUD wave item report current/total', () => {
  const spec = waveScene([
    { delaySeconds: 0, spawns: [{ prefabId: 'drone', count: 1 }] },
    { delaySeconds: 0, spawns: [{ prefabId: 'drone', count: 1 }] },
  ]);
  assert.deepEqual(waveStatus(spec, undefined), { current: 1, total: 2, done: false, name: 'Wave 1' });
  assert.equal(waveStatus({}, undefined), null);
  spec.hud = [{ id: 'w', kind: 'counter', source: 'wave', anchor: 'top-left' }];
  const snap = { score: 0, timeRemaining: 10, variables: {}, health: {}, wave: { index: 1, phase: 'active' as const, t: 0.3, spawned: [0] } };
  const item = resolveHud(spec, snap).find((h) => h.id === 'w');
  assert.ok(item, 'the wave item shows');
  assert.equal(item!.text, '2/2');
  const none = createBlankSceneSpec('2d', 'No waves');
  none.hud = [{ id: 'w', kind: 'counter', source: 'wave', anchor: 'top-left' }];
  assert.equal(resolveHud(none, snap).find((h) => h.id === 'w'), undefined, 'no waves, no item');
});

test('a fresh game session starts the wave schedule from the beginning', () => {
  const state = freshGameState(waveScene([{ spawns: [{ prefabId: 'drone', count: 1 }] }]));
  assert.deepEqual(state.gameWave, freshWaveProgress());
});

test('waveProblems reports what resolveWaves silently drops, and repairWaves fixes it', () => {
  const spec: Pick<SceneSpec, 'waves'> = {
    waves: [
      { spawns: [{ prefabId: 'drone', count: 2.5 }] },
      { spawns: [] },
      { spawns: [{ prefabId: 'drone', count: 3, everySeconds: 0.001 }], delaySeconds: -4 },
      { spawns: [{ prefabId: 'drone', count: 3 }], durationSeconds: 5 },
    ],
  };
  assert.ok(waveProblems(spec).length >= 3);
  assert.equal(repairWaves(spec), true);
  assert.deepEqual(waveProblems(spec), []);
  assert.equal(spec.waves!.length, 3, 'the empty wave is dropped');
  assert.equal(repairWaves(spec), false, 'repair is idempotent');
  const empty: Pick<SceneSpec, 'waves'> = { waves: [{ spawns: [] }] };
  repairWaves(empty);
  assert.equal(empty.waves, undefined);
});

// ---- verifier -----------------------------------------------------------------------------------------

const codes = (spec: SceneSpec) => verifySceneSpec(spec).issues.map((i) => i.code);

test('a valid survive-waves scene raises no wave issue', () => {
  const spec = waveScene([{ delaySeconds: 1, spawns: [{ prefabId: 'drone', count: 3, everySeconds: 0.5 }] }]);
  assert.deepEqual(codes(spec).filter((c) => c.startsWith('wave.')), []);
});

test('wave issues are reported and every one of them is auto-fixed', () => {
  const spec = waveScene([
    { spawns: [{ prefabId: 'ghost', count: 2 }] },
    { spawns: [{ prefabId: 'drone', count: 3.5 }] },
  ], 'survive-waves', 4);
  const found = codes(spec);
  for (const c of ['wave.prefab-missing', 'wave.invalid', 'wave.too-long']) assert.ok(found.includes(c), `${c} reported (${found.join(',')})`);
  const fixed = autoFixSceneSpec(spec).spec;
  assert.deepEqual(codes(fixed).filter((c) => c.startsWith('wave.')), []);
  assert.ok(!fixed.nodes2D.some((n) => n.id === 'ghost'), 'a missing prefab is not invented as a node');
  assert.ok((fixed.gameRules.timeLimitSeconds ?? 0) >= wavesMinSeconds(resolveWaves(fixed)) + 1);
});

test('survive-waves without waves is an error that falls back to survive-timer; waves outside a 2D game are removed', () => {
  const noWaves = waveScene([]);
  delete noWaves.waves;
  assert.ok(codes(noWaves).includes('wave.win-without-waves'));
  assert.equal(autoFixSceneSpec(noWaves).spec.gameRules.winCondition, 'survive-timer');

  const media = waveScene([{ spawns: [{ prefabId: 'drone', count: 1 }] }], 'score-threshold');
  media.mode = 'media';
  assert.ok(codes(media).includes('wave.unsupported'));
  assert.equal(autoFixSceneSpec(media).spec.waves, undefined);
});

// ---- the real runtime -------------------------------------------------------------------------------------

test('headless: the waves spawn clones, the last one ends the round as a win, and a short clock loses', () => {
  const spec = waveScene([
    { name: 'Opening', delaySeconds: 1, spawns: [{ prefabId: 'drone', count: 2, everySeconds: 1 }] },
    { name: 'Finale', delaySeconds: 1, spawns: [{ prefabId: 'drone', count: 1 }] },
  ]);
  const needed = wavesMinSeconds(resolveWaves(spec));
  const session = openHeadlessSession2D(spec);
  try {
    const clones = () => session.store.getState().sceneSpec.nodes2D.filter((n) => n.id.startsWith('drone#')).length;
    let sawWave2 = false;
    for (let i = 0; i < Math.ceil((needed + 2) * 60); i++) {
      session.step();
      if (session.store.getState().gameWave.index === 1) sawWave2 = true;
      if (session.store.getState().gameEnded) break;
    }
    const s = session.store.getState();
    assert.equal(s.gameEnded, true);
    assert.equal(s.gameWon, true, 'surviving every wave wins');
    assert.ok(sawWave2, 'wave 2 ran');
    assert.equal(clones(), 3, '2 + 1 drones were spawned');
    assert.ok(s.executionLogs.some((l) => /\[Waves\] Finale starts/.test(l.message)), 'the wave start is logged');
  } finally {
    session.dispose();
  }

  // The clock is shorter than the waves: the round is lost, not won.
  const short = waveScene(spec.waves!, 'survive-waves', 3);
  const lost = openHeadlessSession2D(short);
  try {
    for (let i = 0; i < 60 * 6; i++) lost.step();
    const s = lost.store.getState();
    assert.equal(s.gameEnded, true);
    assert.equal(s.gameWon, false, 'time ran out before the last wave ended');
  } finally {
    lost.dispose();
  }
});

test('headless: two runs of the same scene spawn the same clones at the same places', () => {
  const spec = waveScene([{ delaySeconds: 0.5, spawns: [{ prefabId: 'drone', count: 5, everySeconds: 0.3, jitterX: 80, jitterY: 20 }] }]);
  const runIt = () => {
    const session = openHeadlessSession2D(structuredClone(spec));
    try {
      for (let i = 0; i < 60 * 4; i++) session.step();
      return session.store.getState().sceneSpec.nodes2D.filter((n) => n.id.startsWith('drone#')).map((n) => [n.id, n.x, n.y]);
    } finally {
      session.dispose();
    }
  };
  const a = runIt();
  assert.equal(a.length, 5);
  assert.deepEqual(a, runIt());
});


// ---- review findings (Phase 7 reviewer) ---------------------------------------------------------------

test('a non-list waves value never throws: it resolves to nothing and the verifier reports it', () => {
  const spec = waveScene([]);
  (spec as { waves: unknown }).waves = { spawns: [{ prefabId: 'drone', count: 1 }] };
  assert.deepEqual(resolveWaves(spec), []);
  assert.doesNotThrow(() => verifySceneSpec(spec));
  assert.ok(verifySceneSpec(spec).issues.some((i) => i.code === 'wave.invalid' || i.code === 'wave.win-without-waves'));
});

test('survive-waves is never won by the score: killing rewarded enemies does not end the round early', () => {
  const spec = waveScene([{ delaySeconds: 1, spawns: [{ prefabId: 'drone', count: 2 }] }, { delaySeconds: 1, spawns: [{ prefabId: 'drone', count: 1 }] }]);
  spec.gameRules.targetScore = 0; // falls back to 100
  const session = openHeadlessSession2D(spec);
  try {
    for (let i = 0; i < 30; i++) session.step();
    session.store.getState().addGameScore(500, 'reward');
    assert.equal(session.store.getState().gameEnded, false, 'a big score does not win survive-waves');
    assert.equal(session.store.getState().gameScore, 500);
  } finally {
    session.dispose();
  }
});

test('a wave spawn the scene has no room for is given back and tried again, not lost', () => {
  const spec = waveScene([{ delaySeconds: 0, spawns: [{ prefabId: 'drone', count: 4, everySeconds: 0.1 }] }]);
  const session = openHeadlessSession2D(spec);
  try {
    // Fill the clone budget with something else first.
    const filler = Array.from({ length: 62 }, (_, i) => node({ id: 'pad#' + i, x: 0, y: 0, visible: false }));
    session.store.setState((s) => ({ sceneSpec: { ...s.sceneSpec, nodes2D: [...s.sceneSpec.nodes2D, ...filler] } }));
    for (let i = 0; i < 60; i++) session.step();
    const count = () => session.store.getState().sceneSpec.nodes2D.filter((n) => n.id.startsWith('drone#')).length;
    assert.ok(count() <= 2, `only the free room was used (${count()})`);
    session.store.setState((s) => ({ sceneSpec: { ...s.sceneSpec, nodes2D: s.sceneSpec.nodes2D.filter((n) => !n.id.startsWith('pad#')) } }));
    for (let i = 0; i < 60; i++) session.step();
    assert.equal(count(), 4, 'the missed spawns happened once there was room');
  } finally {
    session.dispose();
  }
});

test('verifier: untilCleared waves whose clones can never be removed are flagged', () => {
  const spec = waveScene([{ delaySeconds: 0, untilCleared: true, spawns: [{ prefabId: 'drone', count: 1 }] }]);
  assert.ok(verifySceneSpec(spec).issues.some((i) => i.code === 'wave.uncleared'));
  spec.nodes2D.find((n) => n.id === 'drone')!.health = { max: 1 };
  assert.ok(!verifySceneSpec(spec).issues.some((i) => i.code === 'wave.uncleared'));
});
