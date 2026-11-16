import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneSceneSpec, createBlankSceneSpec, SCENE_TEMPLATES } from '../src/registry/assetRegistry';
import { createPlayerStore } from '../src/player/playerStore';
import { bindRuntimeStore } from '../src/runtime/host';
import { RuntimeLogicGraph } from '../src/runtime/logicGraph';
import {
  MachineEntity,
  MachineInputs,
  MachineStepResult,
  sanitizeStateMachine,
  stateMachineIssues,
  StateMachineRuntime,
} from '../src/runtime/stateMachine';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import { normalizeGeneratedSceneSpec } from '../src/agent/storyboardAgent';
import type { ActorStateMachine, SceneSpec, Vector3Tuple } from '../src/types/scene.schema';

const GUARD: ActorStateMachine = {
  initial: 'patrol',
  states: {
    patrol: { move: 'patrol', points: [[-3, 0], [3, 0]], transitions: [{ to: 'chase', when: { type: 'player-near', distance: 3 } }] },
    chase: {
      move: 'chase-player', speed: 2.4,
      transitions: [{ to: 'attack', when: { type: 'collided' } }, { to: 'return', when: { type: 'player-far', distance: 6 } }],
    },
    attack: { clip: 'Attack', onEnter: [{ type: 'add-score', amount: -10 }, { type: 'play-sfx', sound: 'hit' }], transitions: [{ to: 'chase', when: { type: 'timer', seconds: 1 } }] },
    return: { move: 'return-home', transitions: [{ to: 'patrol', when: { type: 'arrived' } }, { to: 'chase', when: { type: 'player-near', distance: 3 } }] },
  },
};

function inputs(partial: Partial<MachineInputs> = {}): MachineInputs {
  return { engine: '3d', score: 0, clicked: new Set(), touching: new Set(), signals: new Set(), ...partial };
}

/** Steps the pure runtime, applying moves back onto the entities like the host does. */
function stepAll(rt: StateMachineRuntime, entities: MachineEntity[], input: MachineInputs, dt = 0.1): MachineStepResult {
  const result = rt.step(dt, entities, input);
  for (const e of entities) {
    const move = result.moves.get(e.id);
    if (move) e.position = move.position;
  }
  return result;
}

const dist = (a: Vector3Tuple, b: Vector3Tuple) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function guardScenario() {
  const rt = new StateMachineRuntime();
  const guard: MachineEntity = { id: 'guard', position: [0, 0, 0], machine: GUARD, clips: ['Idle', 'Walk', 'Run', 'Attack'], clip: 'Idle', animation: 'idle' };
  const log: string[] = [];
  const results: MachineStepResult[] = [];
  let player: Vector3Tuple = [5.5, 0, 5.5];
  const record = (r: MachineStepResult) => {
    results.push(r);
    for (const e of r.entered) log.push(e.to);
  };
  record(stepAll(rt, [guard], inputs({ player })));
  for (let i = 0; i < 10; i++) record(stepAll(rt, [guard], inputs({ player })));
  const patrolX = guard.position[0];
  // Player walks up to the guard → chase until touching → attack.
  player = [guard.position[0] + 2, 0, 0];
  for (let i = 0; i < 40 && !log.includes('attack'); i++) {
    const touching = new Set(dist(guard.position, player) <= 0.75 ? ['guard'] : []);
    record(stepAll(rt, [guard], inputs({ player, touching })));
  }
  // Player escapes far away → back to chase after the attack timer, then return home and patrol again.
  player = [5.5, 0, 5.5];
  for (let i = 0; i < 200 && log.filter((s) => s === 'patrol').length < 2; i++) record(stepAll(rt, [guard], inputs({ player })));
  return { rt, guard, log, results, patrolX };
}

test('enemy guard: patrol → chase → attack → chase → return → patrol', () => {
  const { log, results, patrolX, guard } = guardScenario();
  assert.ok(patrolX < 0, `patrol walks to the first waypoint (x=${patrolX})`);
  assert.deepEqual(log, ['patrol', 'chase', 'attack', 'chase', 'return', 'patrol']);
  const attack = results.flatMap((r) => r.entered).find((e) => e.to === 'attack')!;
  assert.equal(attack.look.clip, 'Attack');
  const chase = results.flatMap((r) => r.entered).find((e) => e.to === 'chase')!;
  assert.equal(chase.look.clip, 'Walk', 'moving state without a clip plays Walk (speed 2.4 < run threshold)');
  assert.equal(chase.look.animation, 'walk');
  const actions = results.flatMap((r) => r.actions).map((a) => a.action.type);
  assert.deepEqual(actions, ['add-score', 'play-sfx']);
  assert.ok(results.some((r) => r.moves.get('guard')?.yaw !== undefined), 'moving 3D actors face their heading');
  assert.ok(Math.abs(guard.position[1]) < 1e-9, 'stays grounded');
});

test('interpreter is deterministic for the same inputs', () => {
  const a = guardScenario();
  const b = guardScenario();
  const plain = (rs: MachineStepResult[]) => JSON.stringify(rs.map((r) => ({ ...r, moves: [...r.moves.entries()] })));
  assert.equal(plain(a.results), plain(b.results));
});

test('random transitions are seeded: same seed same sequence, different seed differs', () => {
  const run = (seed: number) => {
    const machine: ActorStateMachine = {
      initial: 'idle', seed,
      states: {
        idle: { transitions: [{ to: 'blink', when: { type: 'random', chance: 0.4, every: 0.5 } }] },
        blink: { transitions: [{ to: 'idle', when: { type: 'timer', seconds: 0.2 } }] },
      },
    };
    const rt = new StateMachineRuntime();
    const e: MachineEntity = { id: 'npc', position: [0, 0, 0], machine };
    const out: string[] = [];
    for (let i = 0; i < 300; i++) out.push(...rt.step(0.1, [e], inputs()).entered.map((x) => `${i}:${x.to}`));
    return out.join(',');
  };
  assert.equal(run(1), run(1));
  assert.notEqual(run(1), run(7));
  assert.ok(run(1).includes('blink'));
});

test('door opens on score, waits for its timer and hides itself', () => {
  const door: ActorStateMachine = {
    initial: 'closed',
    states: {
      closed: { transitions: [{ to: 'opening', when: { type: 'score-at-least', value: 50 } }] },
      opening: { animation: 'spin', transitions: [{ to: 'open', when: { type: 'timer', seconds: 1 } }] },
      open: { onEnter: [{ type: 'set-visible', visible: false }] },
    },
  };
  const rt = new StateMachineRuntime();
  const e: MachineEntity = { id: 'door', position: [0, 0, 0], machine: door, animation: 'idle' };
  rt.step(0.1, [e], inputs({ score: 0 }));
  rt.step(0.1, [e], inputs({ score: 40 }));
  assert.equal(rt.stateOf('door'), 'closed');
  const opening = rt.step(0.1, [e], inputs({ score: 50 }));
  assert.equal(opening.entered[0].look.animation, 'spin');
  for (let i = 0; i < 9; i++) rt.step(0.1, [e], inputs({ score: 50 }));
  assert.equal(rt.stateOf('door'), 'opening', 'timer counts time in the state');
  const open = rt.step(0.11, [e], inputs({ score: 50 }));
  assert.equal(rt.stateOf('door'), 'open');
  assert.deepEqual(open.actions.map((a) => a.action), [{ type: 'set-visible', visible: false }]);
  assert.equal(open.entered[0].look.animation, 'idle', 'resting state keeps the base animation');
});

test('signals, clicks and health drive transitions', () => {
  const alarm: ActorStateMachine = {
    initial: 'watch',
    states: { watch: { transitions: [{ to: 'alarm', when: { type: 'clicked' } }] }, alarm: { onEnter: [{ type: 'send-signal', name: 'intruder' }] } },
  };
  const sleeper: ActorStateMachine = {
    initial: 'sleep', health: 100,
    states: {
      sleep: { transitions: [{ to: 'hurt', when: { type: 'signal', name: 'intruder' } }] },
      hurt: { onEnter: [{ type: 'add-health', amount: -60 }], transitions: [{ to: 'flee', when: { type: 'health-below', value: 50 } }] },
      flee: { move: 'flee-player' },
    },
  };
  const rt = new StateMachineRuntime();
  const a: MachineEntity = { id: 'a', position: [0, 0, 0], machine: alarm };
  const b: MachineEntity = { id: 'b', position: [1, 0, 0], machine: sleeper };
  stepAll(rt, [a, b], inputs({ player: [0, 0, 0] }));
  const clicked = stepAll(rt, [a, b], inputs({ player: [0, 0, 0], clicked: new Set(['a']) }));
  assert.deepEqual(clicked.signals, ['intruder']);
  assert.equal(rt.stateOf('b'), 'sleep', 'signals arrive on the next step');
  stepAll(rt, [a, b], inputs({ player: [0, 0, 0], signals: new Set(clicked.signals) }));
  assert.equal(rt.stateOf('b'), 'hurt');
  assert.equal(rt.healthOf('b'), 40);
  stepAll(rt, [a, b], inputs({ player: [0, 0, 0] }));
  assert.equal(rt.stateOf('b'), 'flee');
  const before = b.position[0];
  stepAll(rt, [a, b], inputs({ player: [0, 0, 0] }));
  assert.ok(b.position[0] > before, 'flees away from the player');
});

test('2D machines move in design pixels inside the stage, without yaw', () => {
  const rt = new StateMachineRuntime();
  const machine: ActorStateMachine = { initial: 'walk', states: { walk: { move: 'move-to', points: [[1400, 300]], speed: 200 } } };
  const e: MachineEntity = { id: 'slime', position: [900, 300, 0], machine, clips: ['idle', 'run'], clip: 'idle' };
  const first = stepAll(rt, [e], inputs({ engine: '2d' }));
  assert.equal(first.entered[0].look.clip, 'run');
  for (let i = 0; i < 20; i++) {
    const r = stepAll(rt, [e], inputs({ engine: '2d' }));
    assert.equal(r.moves.get('slime')?.yaw, undefined);
  }
  assert.equal(e.position[0], 1000, 'clamped to the 1000 px stage');
  assert.equal(e.position[1], 300);
});

test('sanitizeStateMachine drops unknown vocabulary and clamps numbers', () => {
  const clean = sanitizeStateMachine({
    initial: 'a',
    states: {
      a: {
        move: 'teleport', speed: -2, clip: 'Walk',
        onEnter: [{ type: 'eval', code: 'alert(1)' }, { type: 'add-score', amount: 5 }, { type: 'play-sfx', sound: 'boom' }],
        transitions: [{ to: 'b', when: { type: 'random', chance: 4 } }, { to: 'b', when: { type: 'script', src: 'x' } }, { when: { type: 'timer', seconds: 1 } }],
      },
      b: {},
      'bad name!': {},
    },
  })!;
  assert.deepEqual(Object.keys(clean.states), ['a', 'b']);
  assert.equal(clean.states.a.move, undefined);
  assert.equal(clean.states.a.speed, undefined);
  assert.deepEqual(clean.states.a.onEnter, [{ type: 'add-score', amount: 5 }]);
  assert.deepEqual(clean.states.a.transitions, [{ to: 'b', when: { type: 'random', chance: 1 } }]);
  assert.equal(sanitizeStateMachine({ initial: 'x', states: {} }), null);
  assert.equal(sanitizeStateMachine('patrol'), null);
});

// --- verifier --------------------------------------------------------------------------------------------------

function gameScene3D(machine: unknown): SceneSpec {
  const s = createBlankSceneSpec('3d', 'SM');
  s.mode = 'game';
  s.gameRules = { winCondition: 'score-threshold', targetScore: 10, timeLimitSeconds: 30, instructions: '' };
  const base = s.actors[0];
  s.actors = [
    { ...base, id: 'hero', name: 'Hero', physicsRole: 'player', onClickAction: 'none', position: [0, 0, 3] },
    { ...base, id: 'gem', name: 'Gem', physicsRole: 'collectible', onClickAction: 'none', position: [2, 0, 0], scoreValue: 10 },
    { ...base, id: 'guard', name: 'Guard', physicsRole: 'static', onClickAction: 'none', position: [0, 0, -3], availableClips: undefined,
      stateMachine: machine as ActorStateMachine },
  ];
  return s;
}

const codes = (s: SceneSpec) => verifySceneSpec(s).issues.filter((i) => i.code.startsWith('machine.')).map((i) => i.code).sort();

test('verifier accepts a well-formed machine', () => {
  assert.deepEqual(codes(gameScene3D(GUARD)), []);
  // Field order from the model does not matter.
  const reordered = JSON.parse(JSON.stringify({ states: GUARD.states, initial: GUARD.initial }));
  assert.deepEqual(codes(gameScene3D(reordered)), []);
});

test('verifier flags missing initial, unknown targets and unreachable states, and auto-fixes them', () => {
  const broken = {
    initial: 'sleep',
    states: {
      idle: { transitions: [{ to: 'wave', when: { type: 'player-near', distance: 2 } }, { to: 'ghost', when: { type: 'timer', seconds: 2 } }] },
      wave: { clip: 'Wave', transitions: [{ to: 'idle', when: { type: 'player-far', distance: 4 } }] },
      lost: {},
    },
  };
  const scene = gameScene3D(broken);
  scene.actors[2].availableClips = ['Idle', 'Walk'];
  assert.deepEqual(codes(scene), ['machine.clip-missing', 'machine.no-initial', 'machine.transition-missing']);
  const report = verifySceneSpec(scene);
  assert.equal(report.ok, false);
  const fixed = autoFixSceneSpec(scene);
  const machine = fixed.spec.actors.find((a) => a.id === 'guard')!.stateMachine!;
  assert.equal(machine.initial, 'idle');
  assert.deepEqual(machine.states.idle.transitions!.map((t) => t.to), ['wave']);
  assert.equal(machine.states.wave.clip, undefined);
  assert.equal(machine.states.lost, undefined, 'unreachable state removed once initial is known');
  assert.deepEqual(codes(fixed.spec), []);
});

test('verifier warns about unreachable states and removes them', () => {
  const scene = gameScene3D({ ...GUARD, states: { ...GUARD.states, dance: { clip: 'Dance' } } });
  assert.deepEqual(codes(scene), ['machine.unreachable']);
  assert.equal(verifySceneSpec(scene).ok, true, 'a warning, not an error');
  const fixed = autoFixSceneSpec(scene);
  assert.deepEqual(Object.keys(fixed.spec.actors.find((a) => a.id === 'guard')!.stateMachine!.states), ['patrol', 'chase', 'attack', 'return']);
});

test('verifier: unknown vocabulary is sanitised, unsent signals and missing players are warned', () => {
  const scene = gameScene3D({
    initial: 'wait',
    states: { wait: { transitions: [{ to: 'go', when: { type: 'signal', name: 'bell' } }, { to: 'go', when: { type: 'js', code: '1' } }] }, go: { move: 'chase-player' } },
  });
  scene.actors = scene.actors.filter((a) => a.id !== 'hero');
  assert.deepEqual(codes(scene), ['machine.invalid', 'machine.no-player', 'machine.signal-unsent']);
  const fixed = autoFixSceneSpec(scene);
  assert.deepEqual(codes(fixed.spec), ['machine.no-player', 'machine.signal-unsent']);
  assert.equal(fixed.spec.actors.find((a) => a.id === 'guard')!.stateMachine!.states.wait.transitions!.length, 1);
  const empty = gameScene3D({ initial: 'x', states: {} });
  assert.deepEqual(codes(empty), ['machine.invalid']);
  assert.equal(autoFixSceneSpec(empty).spec.actors.find((a) => a.id === 'guard')!.stateMachine, undefined);
});

test('stateMachineIssues warns when a machine is placed in a media scene', () => {
  const issues = stateMachineIssues({ id: 'g', stateMachine: GUARD, physicsRole: 'static' }, { mode: 'media', actors: [], nodes2D: [] });
  assert.ok(issues.some((i) => i.code === 'machine.media-mode'));
});

test('AI normaliser keeps machines on actors and 2D nodes', () => {
  const raw = gameScene3D(GUARD) as any;
  raw.actors[2].stateMachine = { ...GUARD, states: { ...GUARD.states, patrol: { ...GUARD.states.patrol, move: 'warp' } } };
  const spec = normalizeGeneratedSceneSpec(raw, '3d');
  const guard = spec.actors.find((a) => a.name === 'Guard')!;
  assert.equal(guard.stateMachine!.initial, 'patrol');
  assert.equal(guard.stateMachine!.states.patrol.move, undefined, 'unknown move dropped');
  const raw2D = { ...createBlankSceneSpec('2d', 'n'), mode: 'game', nodes2D: [{ name: 'Slime', x: 300, y: 400, physics2D: 'hazard', stateMachine: { initial: 'a', states: { a: { move: 'patrol', points: [[100, 400], [400, 400]] } } } }] };
  const spec2D = normalizeGeneratedSceneSpec(raw2D, '2d');
  assert.deepEqual(spec2D.nodes2D[0].stateMachine!.states.a.points, [[100, 400], [400, 400]]);
});

// --- host glue (shared by the studio and the exported Player) ------------------------------------------------

test('RuntimeLogicGraph runs machines through the bound store (positions, clips, score, state map, signals)', () => {
  const scene = gameScene3D(GUARD);
  scene.gameRules.targetScore = 1000;
  scene.actors.find((a) => a.id === 'hero')!.position = [0, 0, 5];
  scene.actors.push({ ...scene.actors[2], id: 'bell', name: 'Bell', position: [4, 0, 4], stateMachine: {
    initial: 'quiet', states: { quiet: { transitions: [{ to: 'ring', when: { type: 'signal', name: 'bell' } }] }, ring: { onEnter: [{ type: 'add-score', amount: 7 }] } },
  } });
  scene.logicGraph = { nodes: [], edges: [] };
  const store = createPlayerStore([scene]);
  bindRuntimeStore(store);
  const runtime = new RuntimeLogicGraph('3d');
  runtime.advance(0.1);
  assert.deepEqual(store.getState().machineStates, { guard: 'patrol', bell: 'quiet' });
  for (let i = 0; i < 10; i++) runtime.advance(0.1);
  const guard = () => store.getState().sceneSpec.actors.find((a) => a.id === 'guard')!;
  assert.ok(guard().position[0] < -1, `guard patrols toward x=-3 (x=${guard().position[0]})`);
  assert.equal(guard().activeAnimation, 'walk');
  // Player steps next to the guard → chase.
  store.setState((s) => ({ sceneSpec: { ...s.sceneSpec, actors: s.sceneSpec.actors.map((a) => (a.id === 'hero' ? { ...a, position: [guard().position[0] + 1.5, 0, -3] as Vector3Tuple } : a)) } }));
  runtime.advance(0.1);
  assert.equal(store.getState().machineStates!.guard, 'chase');
  // Touching (collision pairs come from the game loop) → attack: -10 score.
  runtime.collisions([['hero', 'guard']]);
  runtime.advance(0.1);
  assert.equal(store.getState().machineStates!.guard, 'attack');
  assert.equal(store.getState().gameScore, 0, 'score never goes below zero');
  assert.ok(store.getState().executionLogs.some((l) => l.message.includes('chase → attack')));
  // A logic-graph 'send-signal' action reaches machines waiting for it.
  store.getState().addGameScore(20, 'test');
  (runtime as any).action({ id: 'n', type: 'action', title: 'Ring', params: { actionType: 'send-signal', signal: 'bell' }, inputs: [], outputs: [] });
  runtime.advance(0.1);
  assert.equal(store.getState().machineStates!.bell, 'ring');
  assert.equal(store.getState().gameScore, 27);
  // Retry restarts every machine from its initial state.
  store.getState().resetGameSession();
  store.setState({ isPlaying: true });
  runtime.advance(0.1);
  assert.equal(store.getState().machineStates!.guard, 'patrol');
  // ... and the moved guard is back at its authored spot (resetGameSession alone keeps moved poses of non-template scenes).
  assert.deepEqual(guard().position, [0, 0, -3]);
});

test('machines do nothing in media mode or after the game ended', () => {
  const scene = gameScene3D(GUARD);
  scene.mode = 'media';
  const store = createPlayerStore([scene]);
  bindRuntimeStore(store);
  const runtime = new RuntimeLogicGraph('3d');
  for (let i = 0; i < 5; i++) runtime.advance(0.1);
  assert.equal(store.getState().machineStates, undefined);
  assert.deepEqual(store.getState().sceneSpec.actors.find((a) => a.id === 'guard')!.position, [0, 0, -3]);
});

// --- OmniRig bird / serpent clips (Flying, Gliding, Peck, Attack) -----------------------------------------------

test('bird / serpent clip names resolve through synonyms in the verifier and at runtime', async () => {
  const { lookForState } = await import('../src/runtime/stateMachine');
  const { matchClipName, resolveClipName } = await import('../src/runtime/cinematics');
  const bird = ['Idle', 'Walking', 'Flying', 'Gliding', 'Peck'];
  const serpent = ['Idle', 'Walking', 'Running', 'Attack'];
  assert.equal(matchClipName('Flying', bird), 'Flying');
  assert.equal(matchClipName('Fly', bird), 'Flying');
  assert.equal(matchClipName('flap', bird), 'Flying');
  assert.equal(matchClipName('Glide', bird), 'Gliding');
  assert.equal(matchClipName('Soar', bird), 'Gliding');
  assert.equal(matchClipName('Peck', bird), 'Peck');
  assert.equal(matchClipName('Bite', serpent), 'Attack');
  assert.equal(matchClipName('Slither', serpent), 'Walking');
  assert.equal(matchClipName('Teleport', bird), 'Idle', 'unknown still falls back to idle');
  assert.equal(resolveClipName('Teleport', bird), undefined, 'strict form has no fallback');

  // Verifier: "Fly" on a bird is fine, a clip the rig does not have still warns.
  const scene = gameScene3D({ initial: 'a', states: { a: { clip: 'Fly', transitions: [{ to: 'b', when: { type: 'timer', seconds: 1 } }] }, b: { clip: 'Attack' } } });
  scene.actors[2].availableClips = bird;
  const issues = verifySceneSpec(scene).issues.filter((i) => i.code === 'machine.clip-missing');
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /b: Attack/);
  assert.doesNotMatch(issues[0].message, /Fly/);

  // Runtime: the state's clip resolves to the real clip; a fast chase picks the serpent's Running clip.
  assert.equal(lookForState({ clip: 'Fly' }, { clips: bird }, { clip: 'Idle' }, '3d').clip, 'Flying');
  assert.equal(lookForState({ clip: 'Bite' }, { clips: serpent }, { clip: 'Idle' }, '3d').clip, 'Attack');
  assert.equal(lookForState({ move: 'chase-player', speed: 3 }, { clips: serpent }, { clip: 'Idle' }, '3d').clip, 'Running');
});

test('Player replay restores the authored scene, also when it started from a built-in template (machines included)', () => {
  const scene = cloneSceneSpec(SCENE_TEMPLATES['coin-rush-playable']);
  const hero = scene.actors.find((a) => a.physicsRole === 'player')!;
  scene.actors.push({ ...hero, id: 'e2e-enemy', name: 'Enemy', physicsRole: 'static', onClickAction: 'none', position: [3, 0, 3], stateMachine: GUARD });
  const store = createPlayerStore([scene]);
  bindRuntimeStore(store);
  const runtime = new RuntimeLogicGraph('3d');
  for (let i = 0; i < 20; i++) runtime.advance(0.1);
  const enemy = () => store.getState().sceneSpec.actors.find((a) => a.id === 'e2e-enemy');
  assert.notDeepEqual(enemy()!.position, [3, 0, 3], 'the machine moved the enemy');
  store.getState().resetGameSession();
  assert.ok(enemy(), 'the user-added actor survives a replay (not replaced by the template)');
  assert.deepEqual(enemy()!.position, [3, 0, 3]);
  assert.deepEqual(enemy()!.stateMachine, GUARD);
});
