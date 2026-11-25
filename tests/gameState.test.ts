import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { createPlayerStore } from '../src/player/playerStore';
import { bindRuntimeStore } from '../src/runtime/host';
import { RuntimeLogicGraph } from '../src/runtime/logicGraph';
import { stepGameEntities2D } from '../src/runtime/game/entities2d';
import {
  clampVariable,
  compareNumbers,
  freshGameState,
  hash01,
  initialHealth,
  initialVariables,
  isInvulnerable,
  projectileLifetime,
  resolveHud,
  resolveVariables,
  stepProjectile,
  stepSpawner,
} from '../src/runtime/game/state';
import type { Node2D, SceneSpec } from '../src/types/scene.schema';
import type { RuntimeBody2D } from '../src/runtime/stage2d';

function node(over: Partial<Node2D> & { id: string }): Node2D {
  return {
    name: over.id, type: 'tile-platform', x: 100, y: 300, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', ...over,
  } as Node2D;
}

function game(...nodes: Node2D[]): SceneSpec {
  const spec = createBlankSceneSpec('2d', 'Phase 3');
  spec.mode = 'game';
  spec.gameRules = { winCondition: 'score-threshold', targetScore: 1000, timeLimitSeconds: 60, instructions: '' };
  spec.logicGraph = { nodes: [], edges: [] };
  spec.nodes2D = [node({ id: 'hero', physics2D: 'player-platformer', x: 100, y: 300, health: { max: 3, invulnerableSeconds: 0.5 } }), ...nodes];
  return spec;
}

function start(spec: SceneSpec) {
  const store = createPlayerStore([spec]);
  bindRuntimeStore(store);
  return store;
}

// ---- pure helpers -------------------------------------------------------------------------------

test('variables: bad ids and duplicates are dropped, values clamp to min / max', () => {
  const spec = { variables: [{ id: 'coins', initial: 0, max: 5 }, { id: 'coins', initial: 9 }, { id: '1bad', initial: 1 }, { id: 'lives', initial: 3, min: 0, max: 9 }, { id: 'nan', initial: NaN }] };
  assert.deepEqual(resolveVariables(spec).map((v) => v.id), ['coins', 'lives']);
  assert.deepEqual(initialVariables({ variables: [{ id: 'a', initial: 12, max: 10 }] }), { a: 10 });
  assert.equal(clampVariable({ min: 0, max: 5 }, -3), 0);
  assert.equal(clampVariable({ min: 0, max: 5 }, 99), 5);
  assert.equal(clampVariable({}, 99), 99);
});

test('compareNumbers covers every operator and rejects unknown ones', () => {
  assert.equal(compareNumbers('>=', 3, 3), true);
  assert.equal(compareNumbers('>', 3, 3), false);
  assert.equal(compareNumbers('<', 2, 3), true);
  assert.equal(compareNumbers('<=', 4, 3), false);
  assert.equal(compareNumbers('==', 3, 3), true);
  assert.equal(compareNumbers('!=', 3, 3), false);
  assert.throws(() => compareNumbers('~', 1, 1), /Unsupported comparison/);
});

test('immunity window: a second hit inside it is ignored, a time loop never blocks', () => {
  assert.equal(isInvulnerable(undefined, 5, 0.6), false);
  assert.equal(isInvulnerable(5, 5.3, 0.6), true);
  assert.equal(isInvulnerable(5, 5.7, 0.6), false);
  assert.equal(isInvulnerable(5, 1, 0.6), false, 'the clock wrapped around: no immunity');
});

test('hash01 is deterministic and spread over [0, 1)', () => {
  assert.equal(hash01('spawner', 3), hash01('spawner', 3));
  assert.notEqual(hash01('spawner', 3), hash01('spawner', 4));
  for (let i = 0; i < 50; i++) {
    const v = hash01('x', i);
    assert.ok(v >= 0 && v < 1);
  }
});

test('stepSpawner waits for the start delay, respects the cap and jitters deterministically', () => {
  const owner = { id: 'cannon', x: 500, y: 100 };
  const spec = { prefabId: 'bolt', everySeconds: 1, startDelay: 0.5, max: 2, offsetY: 20, jitterX: 30 };
  const run = () => {
    const clock = { t: 0, n: 0 };
    const out: Array<{ at: number; x: number; y: number }> = [];
    let alive = 0;
    for (let i = 1; i <= 400; i++) {
      const r = stepSpawner(owner, spec, clock, 0.01, alive);
      if (r) {
        alive += 1;
        out.push({ at: i / 100, x: r.x, y: r.y });
      }
    }
    return out;
  };
  const a = run();
  assert.deepEqual(a, run(), 'same inputs, same spawns');
  assert.equal(a.length, 2, 'the cap of 2 stops it (nothing dies in this test)');
  assert.ok(Math.abs(a[0].at - 0.5) < 0.02, `first spawn after the start delay (${a[0].at})`);
  assert.ok(Math.abs(a[1].at - 1.5) < 0.03, `then every second (${a[1].at})`);
  assert.equal(a[0].y, 120);
  assert.ok(Math.abs(a[0].x - 500) <= 30 && a[0].x !== a[1].x, 'jitter stays inside the range');
  assert.equal(stepSpawner(owner, { ...spec, everySeconds: 0 }, { t: 0, n: 0 }, 10, 0), undefined, 'a bad interval never spawns');
});

test('stepProjectile moves, falls under gravity and expires', () => {
  const spec = { vx: 100, vy: 0, gravity: 200, lifetimeSeconds: 0.95 };
  const clock = { age: 0, vy: 0 };
  let p = { x: 0, y: 0, expired: false };
  for (let i = 0; i < 30; i++) p = stepProjectile(spec, clock, p.x, p.y, 1 / 30);
  assert.ok(Math.abs(p.x - 100) < 0.01);
  assert.ok(p.y > 90 && p.y < 110, `fell about 100px in a second (${p.y})`);
  assert.equal(p.expired, true);
  assert.equal(projectileLifetime({ vx: 0, vy: 0 }), 3);
});

test('resolveHud binds score, time, variables and health; stale bindings draw nothing', () => {
  const spec = game();
  spec.variables = [{ id: 'coins', label: 'Coins', initial: 0, max: 10 }];
  spec.gameRules.targetScore = 200;
  spec.hud = [
    { id: 'h1', kind: 'bar', source: 'health', anchor: 'top-left' },
    { id: 'h2', kind: 'counter', source: 'variable', variableId: 'coins', anchor: 'top-right' },
    { id: 'h3', kind: 'counter', source: 'score', anchor: 'top-center' },
    { id: 'h4', kind: 'bar', source: 'time', anchor: 'bottom-center' },
    { id: 'h5', kind: 'counter', source: 'variable', variableId: 'ghost', anchor: 'top-right' },
    { id: 'h6', kind: 'bar', source: 'health', actorId: 'nobody', anchor: 'top-left' },
  ];
  const items = resolveHud(spec, { score: 50, timeRemaining: 30, variables: { coins: 4 }, health: { hero: 2 } });
  assert.deepEqual(items.map((i) => i.id), ['h1', 'h2', 'h3', 'h4']);
  assert.equal(items[0].text, '2/3');
  assert.ok(Math.abs(items[0].fraction - 2 / 3) < 1e-9);
  assert.equal(items[1].label, 'Coins');
  assert.equal(items[1].text, '4');
  assert.equal(items[1].fraction, 0.4);
  assert.equal(items[2].text, '50/200');
  assert.equal(items[3].fraction, 0.5);
});

test('freshGameState starts every variable and health pool from the scene', () => {
  const spec = game(node({ id: 'orc', health: { max: 5 } }));
  spec.variables = [{ id: 'keys', initial: 1 }];
  const f = freshGameState(spec);
  assert.deepEqual(f.gameVars, { keys: 1 });
  assert.deepEqual(f.gameHealth, { hero: 3, orc: 5 });
  assert.deepEqual(initialHealth(spec), f.gameHealth);
});

// ---- store rules --------------------------------------------------------------------------------

test('variables: set / add clamp, an unknown id throws, reaching winVariable wins', () => {
  const spec = game();
  spec.variables = [{ id: 'keys', initial: 0, min: 0, max: 3 }];
  spec.gameRules.winCondition = 'variable-threshold';
  spec.gameRules.winVariable = { id: 'keys', atLeast: 3 };
  const store = start(spec);
  const s = () => store.getState();
  s().addGameVar('keys', 2);
  assert.equal(s().gameVars.keys, 2);
  assert.equal(s().gameEnded, false);
  s().addGameVar('keys', 5);
  assert.equal(s().gameVars.keys, 3, 'clamped to max');
  assert.equal(s().gameWon, true);
  assert.equal(s().gameEnded, true);
  assert.throws(() => s().setGameVar('nope', 1), /Unknown variable/);
  // Score no longer wins a variable-threshold game.
  s().resetGameSession();
  assert.equal(s().gameVars.keys, 0, 'a retry restarts the variables');
  s().addGameScore(5000, 'lots');
  assert.equal(s().gameEnded, false);
});

test('damage: immunity window, healing clamps, the dead player loses the game', () => {
  const store = start(game());
  const s = () => store.getState();
  assert.equal(s().damageEntity('hero', 1), 'hit');
  assert.equal(s().gameHealth.hero, 2);
  assert.equal(s().damageEntity('hero', 1), 'immune', 'same instant: still immune');
  store.setState({ currentTime: 1 });
  s().healEntity('hero', 10);
  assert.equal(s().gameHealth.hero, 3, 'heal stops at max');
  assert.equal(s().damageEntity('hero', 2), 'hit');
  store.setState({ currentTime: 2 });
  assert.equal(s().damageEntity('hero', 5), 'dead');
  assert.equal(s().gameHealth.hero, 0);
  assert.equal(s().gameEnded, true);
  assert.equal(s().gameWon, false);
  assert.equal(s().damageEntity('hero', 1), 'none', 'nothing left to hurt once the game is over');
  assert.equal(s().damageEntity('ghost', 1), 'none');
});

test('a killed enemy leaves the stage and pays its score', () => {
  const store = start(game(node({ id: 'orc', health: { max: 2 }, scoreValue: 40, physics2D: 'none' })));
  const s = () => store.getState();
  assert.equal(s().damageEntity('orc', 2), 'dead');
  assert.equal(s().sceneSpec.nodes2D.find((n) => n.id === 'orc')!.visible, false);
  assert.equal(s().gameScore, 40);
  assert.equal(s().gameEnded, false, 'only the player dying ends the game');
});

test('spawnPrefab clones a prefab with a unique id and health; despawn removes clones and hides authored nodes', () => {
  const store = start(game(node({ id: 'coin', prefab: true, health: { max: 4 }, physics2D: 'collectible' })));
  const s = () => store.getState();
  const a = s().spawnPrefab('coin', 300, 200)!;
  const b = s().spawnPrefab('coin', 320, 200)!;
  assert.deepEqual([a, b], ['coin#0', 'coin#1']);
  const clone = s().sceneSpec.nodes2D.find((n) => n.id === a)!;
  assert.equal(clone.x, 300);
  assert.equal(clone.prefab, undefined);
  assert.equal(s().gameHealth[a], 4);
  s().despawnEntity(a);
  assert.equal(s().sceneSpec.nodes2D.some((n) => n.id === a), false);
  s().despawnEntity('hero');
  assert.equal(s().sceneSpec.nodes2D.find((n) => n.id === 'hero')!.visible, false);
  assert.throws(() => s().spawnPrefab('hero'), /prefab/);
  s().resetGameSession();
  assert.equal(s().gameSpawnSerial, 0);
});

// ---- logic graph --------------------------------------------------------------------------------

function run(runtime: RuntimeLogicGraph, kind: 'condition' | 'action', params: Record<string, unknown>, actorId?: string) {
  const n = { id: `n-${kind}`, type: kind, title: kind, params, inputs: [], outputs: [] };
  return kind === 'condition' ? (runtime as any).condition(n, actorId, {}) : (runtime as any).action(n, actorId);
}

test('logic graph: variable and health conditions, set / add / damage / heal / win / lose / spawn / despawn actions', () => {
  const spec = game(node({ id: 'bolt', prefab: true }));
  spec.variables = [{ id: 'coins', initial: 0, max: 10 }];
  const store = start(spec);
  const runtime = new RuntimeLogicGraph('2d');
  const s = () => store.getState();

  assert.equal(run(runtime, 'condition', { conditionType: 'variable-compare', variableId: 'coins', op: '>=', value: 1 }), false);
  run(runtime, 'action', { actionType: 'add-variable', variableId: 'coins', value: 3 });
  run(runtime, 'action', { actionType: 'set-variable', variableId: 'coins', value: 7 });
  assert.equal(s().gameVars.coins, 7);
  assert.equal(run(runtime, 'condition', { conditionType: 'variable-compare', variableId: 'coins', op: '>', value: 5 }), true);
  assert.throws(() => run(runtime, 'condition', { conditionType: 'variable-compare', variableId: 'ghost', op: '>', value: 5 }), /Unknown variable/);
  assert.throws(() => run(runtime, 'action', { actionType: 'add-variable', variableId: 'ghost', value: 1 }), /Unknown variable/);

  // health defaults to the player; an entity without health is an error, not a silent false
  assert.equal(run(runtime, 'condition', { conditionType: 'health-check', op: '<=', value: 1 }), false);
  run(runtime, 'action', { actionType: 'damage', amount: 2 });
  assert.equal(s().gameHealth.hero, 1);
  assert.equal(run(runtime, 'condition', { conditionType: 'health-check', op: '<=', value: 1 }), true);
  store.setState({ currentTime: 5 });
  run(runtime, 'action', { actionType: 'heal', amount: 1, actorId: 'hero' });
  assert.equal(s().gameHealth.hero, 2);
  assert.throws(() => run(runtime, 'condition', { conditionType: 'health-check', actorId: 'bolt', op: '<=', value: 1 }), /needs an entity with health/);

  assert.match(run(runtime, 'action', { actionType: 'spawn', prefabId: 'bolt', x: 10, y: 20 }), /Spawned bolt#0/);
  assert.match(run(runtime, 'action', { actionType: 'despawn', actorId: 'bolt#0' }), /Despawned/);
  assert.equal(s().sceneSpec.nodes2D.some((n) => n.id === 'bolt#0'), false);

  run(runtime, 'action', { actionType: 'win' });
  assert.deepEqual([s().gameEnded, s().gameWon], [true, true]);
  s().resetGameSession();
  run(runtime, 'action', { actionType: 'lose' });
  assert.deepEqual([s().gameEnded, s().gameWon], [true, false]);
});

test('random-chance is seeded: the same scene replays the same dice and the chance is respected', () => {
  start(game());
  const rolls = (chance: number) => {
    const rt = new RuntimeLogicGraph('2d');
    (rt as any).sceneId = 'fixed';
    return Array.from({ length: 200 }, () => run(rt, 'condition', { conditionType: 'random-chance', chance }) as boolean);
  };
  assert.deepEqual(rolls(0.3), rolls(0.3));
  const hits = rolls(0.3).filter(Boolean).length;
  assert.ok(hits > 30 && hits < 90, `about 30% (${hits}/200)`);
  assert.ok(rolls(0).every((r) => !r));
  assert.ok(rolls(1).every(Boolean));
  assert.throws(() => run(new RuntimeLogicGraph('2d'), 'condition', { conditionType: 'random-chance', chance: 2 }), /between 0 and 1/);
});

// ---- the frame step: spawners, projectiles, contact damage -----------------------------------------

function frames(store: ReturnType<typeof start>, bodies: Record<string, RuntimeBody2D>, seconds: number, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    store.setState((s) => ({ currentTime: s.currentTime + dt }));
    stepGameEntities2D(bodies, dt);
  }
}

test('a spawner makes clones of its prefab on a timer, up to its cap', () => {
  const spec = game(
    node({ id: 'bolt', prefab: true, x: 0, y: 0 }),
    node({ id: 'turret', x: 700, y: 100, spawner: { prefabId: 'bolt', everySeconds: 0.5, max: 3, offsetX: -40 } }),
  );
  const store = start(spec);
  const bodies: Record<string, RuntimeBody2D> = {};
  frames(store, bodies, 0.4);
  assert.equal(store.getState().sceneSpec.nodes2D.filter((n) => n.id.startsWith('bolt#')).length, 0, 'not yet');
  frames(store, bodies, 0.2);
  const clones = () => store.getState().sceneSpec.nodes2D.filter((n) => n.id.startsWith('bolt#'));
  assert.equal(clones().length, 1);
  assert.equal(clones()[0].x, 660);
  assert.equal(clones()[0].prefab, undefined);
  frames(store, bodies, 5);
  assert.equal(clones().length, 3, 'capped');
});

test('a projectile flies, hurts the player, and is removed on a hit, a wall or after its lifetime', () => {
  const bolt = (id: string, x: number, y: number, over: Partial<Node2D> = {}) =>
    node({ id, x, y, width: 16, height: 8, projectile: { vx: 300, vy: 0, damage: 1, lifetimeSeconds: 2 }, ...over });
  const spec = game(
    node({ id: 'wall', x: 520, y: 100, width: 20, height: 200, physics2D: 'solid' }),
    bolt('shot-wall', 300, 100),
    bolt('shot-hero', 60, 300),
    bolt('shot-late', 0, 20, { projectile: { vx: 10, vy: 0, lifetimeSeconds: 0.2 } }),
  );
  const store = start(spec);
  const bodies: Record<string, RuntimeBody2D> = {};
  const alive = () => store.getState().sceneSpec.nodes2D.filter((n) => n.visible !== false).map((n) => n.id);
  frames(store, bodies, 0.1);
  const early = store.getState().sceneSpec.nodes2D.find((n) => n.id === 'shot-wall')!;
  assert.ok(early.x > 320 && early.x < 340, `moved ~30px (${early.x})`);
  assert.equal(alive().includes('shot-late'), true);
  frames(store, bodies, 0.2);
  assert.equal(alive().includes('shot-late'), false, 'expired');
  assert.equal(alive().includes('shot-hero'), false, 'hit the player');
  assert.equal(store.getState().gameHealth.hero, 2);
  frames(store, bodies, 1);
  assert.equal(alive().includes('shot-wall'), false, 'stopped by the wall');
  assert.equal(store.getState().gameHealth.hero, 2);
});

test('projectile target filter: enemy shots ignore the player, player shots hurt enemies', () => {
  const spec = game(
    node({ id: 'orc', x: 400, y: 100, width: 40, height: 40, health: { max: 2 }, scoreValue: 10 }),
    node({ id: 'arrow', x: 300, y: 100, width: 16, height: 8, projectile: { vx: 400, vy: 0, damage: 1, target: 'enemy' } }),
    node({ id: 'friendly', x: 60, y: 300, width: 16, height: 8, projectile: { vx: 0, vy: 0, damage: 1, target: 'enemy' } }),
  );
  const store = start(spec);
  const bodies: Record<string, RuntimeBody2D> = {};
  frames(store, bodies, 0.4);
  assert.equal(store.getState().gameHealth.orc, 1);
  assert.equal(store.getState().gameHealth.hero, 3, 'an enemy-targeting shot passes through the player');
  assert.equal(store.getState().sceneSpec.nodes2D.find((n) => n.id === 'arrow')!.visible, false, 'the arrow is spent');
});

test('contact damage hurts the player once per immunity window and the death rule ends the game', () => {
  const spec = game(node({ id: 'spikeball', x: 100, y: 300, width: 40, height: 40, contactDamage: 1 }));
  const store = start(spec);
  const bodies: Record<string, RuntimeBody2D> = { hero: { x: 100, y: 300, vx: 0, vy: 0, onGround: true } };
  frames(store, bodies, 0.3);
  assert.equal(store.getState().gameHealth.hero, 2, 'one hit, then immune');
  frames(store, bodies, 0.4);
  assert.equal(store.getState().gameHealth.hero, 1, 'immunity over: hit again');
  frames(store, bodies, 1);
  assert.equal(store.getState().gameHealth.hero, 0);
  assert.equal(store.getState().gameEnded, true);
  assert.equal(store.getState().gameWon, false);
});

test('prefabs and media scenes do nothing: no contact damage, no spawns', () => {
  const spec = game(node({ id: 'ghost', prefab: true, x: 100, y: 300, contactDamage: 5, spawner: { prefabId: 'ghost', everySeconds: 0.1 } }));
  const store = start(spec);
  const bodies: Record<string, RuntimeBody2D> = { hero: { x: 100, y: 300, vx: 0, vy: 0, onGround: true } };
  frames(store, bodies, 1);
  assert.equal(store.getState().gameHealth.hero, 3);
  assert.equal(store.getState().sceneSpec.nodes2D.length, 2);
  store.setState((s) => ({ sceneSpec: { ...s.sceneSpec, mode: 'media' } }));
  frames(store, bodies, 1);
  assert.equal(store.getState().sceneSpec.nodes2D.length, 2);
});
