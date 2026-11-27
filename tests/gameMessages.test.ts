import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { createPlayerStore } from '../src/player/playerStore';
import { bindRuntimeStore } from '../src/runtime/host';
import { RuntimeLogicGraph } from '../src/runtime/logicGraph';
import { openHeadlessSession2D } from '../src/playtest/headless2d';
import {
  activeMessage,
  cleanMessage,
  DEFAULT_MESSAGE_SECONDS,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_SECONDS,
  MIN_MESSAGE_SECONDS,
} from '../src/runtime/game/messages';
import { freshGameState } from '../src/runtime/game/state';
import { stepGameEntities2D } from '../src/runtime/game/entities2d';
import { sanitizeStateMachine } from '../src/runtime/stateMachine';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { Node2D, SceneSpec } from '../src/types/scene.schema';

function node(over: Partial<Node2D> & { id: string }): Node2D {
  return {
    name: over.id, type: 'tile-platform', x: 100, y: 300, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', ...over,
  } as Node2D;
}

function game(...nodes: Node2D[]): SceneSpec {
  const spec = createBlankSceneSpec('2d', 'Messages');
  spec.mode = 'game';
  spec.gameRules = { winCondition: 'score-threshold', targetScore: 1000, timeLimitSeconds: 60, instructions: '' };
  spec.logicGraph = { nodes: [], edges: [] };
  spec.nodes2D = [node({ id: 'floor', x: 500, y: 560, width: 1000, height: 40, physics2D: 'static-platform' }), node({ id: 'hero', physics2D: 'player-platformer', x: 100, y: 500 }), ...nodes];
  return spec;
}

function start(spec: SceneSpec) {
  const store = createPlayerStore([spec]);
  bindRuntimeStore(store);
  return store;
}

function run(runtime: RuntimeLogicGraph, params: Record<string, unknown>) {
  const n = { id: 'n-action', type: 'action', title: 'action', params, inputs: [], outputs: [] };
  return (runtime as any).action(n, undefined);
}

test('cleanMessage trims, collapses whitespace, caps lengths and clamps seconds', () => {
  assert.equal(cleanMessage({ text: '   ' }), null);
  assert.equal(cleanMessage({}), null);
  assert.equal(cleanMessage({ text: 7 }), null);
  assert.deepEqual(cleanMessage({ text: '  The   door\n is locked ', speaker: ' Guard ' }), { text: 'The door is locked', speaker: 'Guard', seconds: DEFAULT_MESSAGE_SECONDS });
  assert.equal(cleanMessage({ text: 'x'.repeat(500) })!.text.length, MAX_MESSAGE_CHARS);
  assert.equal(cleanMessage({ text: 'hi', seconds: 0 })!.seconds, MIN_MESSAGE_SECONDS);
  assert.equal(cleanMessage({ text: 'hi', seconds: 999 })!.seconds, MAX_MESSAGE_SECONDS);
  assert.equal(cleanMessage({ text: 'hi', seconds: NaN })!.seconds, DEFAULT_MESSAGE_SECONDS);
  assert.equal(cleanMessage({ text: 'hi', speaker: '   ' })!.speaker, undefined);
});

test('activeMessage lasts until its scene time is up', () => {
  const m = { text: 'hi', until: 5 };
  assert.equal(activeMessage(m, 4.9), m);
  assert.equal(activeMessage(m, 5), null);
  assert.equal(activeMessage(null, 0), null);
});

test('the logic action show-message fills the message box in scene time and rejects empty text', () => {
  const store = start(game());
  const runtime = new RuntimeLogicGraph('2d');
  store.setState({ currentTime: 2 });
  assert.match(run(runtime, { actionType: 'show-message', text: 'The door is locked', speaker: 'Narrator', seconds: 4 }), /Message/);
  assert.deepEqual(store.getState().gameMessage, { text: 'The door is locked', speaker: 'Narrator', until: 6 });
  assert.equal(activeMessage(store.getState().gameMessage, 5.9) !== null, true);
  assert.equal(activeMessage(store.getState().gameMessage, 6.1), null);
  assert.throws(() => run(runtime, { actionType: 'show-message', text: '   ' }), /needs some text/);
  // A new message replaces the old one; a restart clears it.
  run(runtime, { actionType: 'show-message', text: 'Second' });
  assert.equal(store.getState().gameMessage!.text, 'Second');
  store.getState().resetGameSession();
  assert.equal(store.getState().gameMessage, null);
});

test('pause / resume: only a running game round can pause; resume restores play; a restart clears the pause', () => {
  const store = start(game());
  const s = () => store.getState();
  assert.equal(s().isPlaying, true);
  s().pauseGame();
  assert.deepEqual([s().isPlaying, s().gamePaused], [false, true]);
  s().pauseGame();
  assert.equal(s().gamePaused, true, 'pausing twice changes nothing');
  s().resumeGame();
  assert.deepEqual([s().isPlaying, s().gamePaused], [true, false]);
  s().resumeGame();
  assert.equal(s().isPlaying, true, 'resume without a pause is a no-op');

  s().pauseGame();
  s().resetGameSession();
  assert.equal(s().gamePaused, false, 'restart clears the pause flag');

  store.setState({ isPlaying: true, gameEnded: true });
  s().pauseGame();
  assert.equal(s().gamePaused, false, 'an ended round cannot be paused');

  const media = start({ ...game(), mode: 'media' });
  media.getState().pauseGame();
  assert.equal(media.getState().gamePaused, false, 'media scenes have no pause menu');
  assert.deepEqual(freshGameState(game()).gamePaused, false);
});

test('a paused round freezes: scene time stops, so a message stays on screen', () => {
  const spec = game();
  const session = openHeadlessSession2D(spec);
  try {
    for (let i = 0; i < 10; i++) session.step();
    session.store.getState().showMessage('Hold on', { seconds: 2 });
    session.store.getState().pauseGame();
    const t = session.store.getState().currentTime;
    for (let i = 0; i < 120; i++) session.step();
    assert.equal(session.store.getState().currentTime, t, 'time did not move while paused');
    assert.ok(activeMessage(session.store.getState().gameMessage, session.store.getState().currentTime), 'the message is still due');
    session.store.getState().resumeGame();
    for (let i = 0; i < 180; i++) session.step();
    assert.equal(activeMessage(session.store.getState().gameMessage, session.store.getState().currentTime), null, 'and expires after play resumes');
  } finally {
    session.dispose();
  }
});

test('state machine: show-message is a sanitised onEnter action and the real runtime raises it', () => {
  const machine = sanitizeStateMachine({
    initial: 'talk',
    states: {
      talk: { onEnter: [{ type: 'show-message', text: '  Halt!  ', speaker: 'Guard', seconds: 2 }, { type: 'show-message', text: '' }, { type: 'show-message' }] },
    },
  });
  assert.ok(machine);
  assert.deepEqual(machine!.states.talk.onEnter, [{ type: 'show-message', text: 'Halt!', speaker: 'Guard', seconds: 2 }]);

  const spec = game(node({ id: 'guard', x: 700, y: 500, stateMachine: machine! }));
  const session = openHeadlessSession2D(spec);
  try {
    for (let i = 0; i < 10; i++) session.step();
    const m = session.store.getState().gameMessage;
    assert.ok(m, 'the guard spoke');
    assert.equal(m!.text, 'Halt!');
    assert.equal(m!.speaker, 'Guard');
  } finally {
    session.dispose();
  }
});

test('verifier: a show-message logic node without text is flagged', () => {
  const spec = game();
  spec.logicGraph = {
    nodes: [{ id: 'm1', type: 'action', category: 'actor-action', title: 'Say', params: { actionType: 'show-message' }, inputs: [], outputs: [] } as never],
    edges: [],
  };
  const codes = verifySceneSpec(spec).issues.map((i) => i.code);
  assert.ok(codes.includes('message.empty'));
  // Not auto-fixable, but it never breaks the fixer.
  assert.doesNotThrow(() => autoFixSceneSpec(spec));
  spec.logicGraph.nodes[0].params = { actionType: 'show-message', text: 'Hello' };
  assert.ok(!verifySceneSpec(spec).issues.some((i) => i.code === 'message.empty'));
});


test('a studio restart (no pristine copy) drops the runtime clones and starts the waves from scratch', async () => {
  const { useStudioStore } = await import('../src/state/useStudioStore');
  const spec = game(node({ id: 'imp', prefab: true, x: 900, y: 40 }));
  spec.waves = [{ delaySeconds: 0, spawns: [{ prefabId: 'imp', count: 3, everySeconds: 0.2 }] }];
  spec.gameRules.winCondition = 'survive-waves';
  const store = useStudioStore;
  store.getState().createNewBlankScene('2d', 'Waves reset');
  store.setState((s) => ({ sceneSpec: { ...spec, id: s.sceneSpec.id }, isPlaying: true, ...freshGameState(spec) }));
  bindRuntimeStore(store as never);
  for (let i = 0; i < 90; i++) {
    store.setState((s) => ({ currentTime: s.currentTime + 1 / 60 }));
    stepGameEntities2D({}, 1 / 60);
  }
  assert.ok(store.getState().sceneSpec.nodes2D.some((n) => n.id.startsWith('imp#')), 'clones exist');
  store.getState().resetGameSession();
  const after = store.getState();
  assert.equal(after.sceneSpec.nodes2D.some((n) => n.id.includes('#')), false, 'no stale clones');
  assert.equal(after.gameWave.index, 0);
  assert.equal(after.gameSpawnSerial, 0);
});
