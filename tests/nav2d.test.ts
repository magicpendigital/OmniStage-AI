import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, lineOfSight, NAV_AGENT_RADIUS, NavGrid, navSignature, segmentHitsBox, type NavInput } from '../src/runtime/nav2d';
import { sanitizeStateMachine, stateMachineIssues, StateMachineRuntime, type MachineEntity, type MachineInputs } from '../src/runtime/stateMachine';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import type { ActorStateMachine } from '../src/types/scene.schema';

/** A vertical wall in the middle of the 1000 x 600 world with a gap at the bottom. */
const WALL = { x: 500, y: 250, w: 40, h: 500 };
const NAV: NavInput = { blockers: [WALL], world: { width: 1000, height: 600 } };

test('line of sight: a box between two points blocks it, a box beside them does not, padding widens the box', () => {
  assert.equal(lineOfSight([WALL], [100, 100], [900, 100]), false);
  assert.equal(lineOfSight([WALL], [100, 100], [400, 100]), true, 'stops short of the wall');
  assert.equal(lineOfSight([WALL], [100, 520], [900, 520]), true, 'under the wall (it ends at y = 500)');
  assert.equal(lineOfSight([WALL], [100, 495], [900, 495]), false, 'grazing the wall');
  assert.equal(lineOfSight([WALL], [100, 510], [900, 510]), true);
  assert.equal(lineOfSight([WALL], [100, 510], [900, 510], 20), false, 'a body with a radius cannot squeeze past');
  assert.equal(segmentHitsBox([480, 0], [480, 600], WALL), true, 'a vertical segment inside the wall');
  assert.equal(lineOfSight([WALL], [Number.NaN, 0], [1, 1]), false, 'garbage is never "visible"');
});

test('findPath goes around a wall through its gap, deterministically, and string-pulls the route to a few legs', () => {
  const grid = new NavGrid(NAV);
  const a = findPath(grid, [100, 100], [900, 100])!;
  assert.ok(a, 'a route exists');
  assert.deepEqual(a[a.length - 1], [900, 100], 'it ends exactly at the goal');
  assert.ok(a.length <= 4, `pulled tight: ${a.length} legs`);
  assert.ok(a.some((p) => p[1] > 500), 'it passes under the wall');
  // every leg is clear of the (grown) wall
  let prev: [number, number] = [100, 100];
  for (const p of a) {
    assert.ok(lineOfSight(NAV.blockers, prev, p, NAV_AGENT_RADIUS * 0.8), `leg ${prev} -> ${p} is clear`);
    prev = p;
  }
  assert.deepEqual(findPath(new NavGrid(NAV), [100, 100], [900, 100]), a, 'same input, same route');
  assert.equal(navSignature(NAV), navSignature({ blockers: [{ ...WALL }], world: { ...NAV.world } }));
});

test('findPath: straight when nothing is in the way, no route when the goal is walled in, nearest free spot when inside a wall', () => {
  const grid = new NavGrid(NAV);
  assert.deepEqual(findPath(grid, [100, 100], [300, 100]), [[300, 100]]);
  const closed = new NavGrid({ blockers: [{ x: 500, y: 300, w: 1200, h: 100 }], world: { width: 1000, height: 600 } });
  assert.equal(findPath(closed, [100, 100], [900, 500]), null, 'a wall across the whole world');
  const inside = findPath(grid, [100, 100], [500, 200])!;
  assert.ok(inside, 'the goal is inside the wall, it still walks to the closest free spot');
  const end = inside[inside.length - 1];
  assert.ok(Math.abs(end[0] - 500) > 20 + NAV_AGENT_RADIUS - 6, `ends beside the wall, not in it (${end})`);
  assert.equal(findPath(grid, [Number.NaN, 0], [1, 1]), null);
});

const CHASER: ActorStateMachine = {
  initial: 'chase',
  states: { chase: { move: 'chase-player', speed: 200, pathfind: true, transitions: [{ to: 'done', when: { type: 'collided' } }] }, done: {} },
};
const input = (partial: Partial<MachineInputs>): MachineInputs => ({ engine: '2d', score: 0, clicked: new Set(), touching: new Set(), signals: new Set(), ...partial });

function run(machine: ActorStateMachine, start: [number, number], player: [number, number], nav: NavInput | undefined, seconds: number) {
  const rt = new StateMachineRuntime();
  const e: MachineEntity = { id: 'e', position: [start[0], start[1], 0], machine };
  const trail: Array<[number, number]> = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = rt.step(1 / 60, [e], input({ player: [player[0], player[1], 0], nav }));
    const m = r.moves.get('e');
    if (m) e.position = m.position;
    trail.push([e.position[0], e.position[1]]);
  }
  return { e, trail, rt };
}

test('a pathfinding chaser walks around the wall and reaches the player; without pathfind it walks straight through', () => {
  const player: [number, number] = [900, 100];
  const around = run(CHASER, [100, 100], player, NAV, 12);
  assert.ok(Math.hypot(around.e.position[0] - 900, around.e.position[1] - 100) < 40, `caught up (${around.e.position})`);
  for (const [x, y] of around.trail) assert.ok(!(Math.abs(x - 500) < 20 && y < 500), `never inside the wall (${x},${y})`);
  assert.ok(around.trail.some(([, y]) => y > 480), 'it went down to the gap');

  const straight = run({ initial: 'chase', states: { chase: { move: 'chase-player', speed: 200 } } }, [100, 100], player, NAV, 12);
  assert.ok(straight.trail.some(([x, y]) => Math.abs(x - 500) < 20 && y < 400), 'plain chase ignores the wall (unchanged behaviour)');
  assert.deepEqual(run(CHASER, [100, 100], player, NAV, 12).trail, around.trail, 'deterministic');
});

test('pathfind with no route stands still instead of pushing into the wall; no walls = plain straight movement', () => {
  const sealed: NavInput = { blockers: [{ x: 500, y: 300, w: 60, h: 700 }], world: { width: 1000, height: 600 } };
  const stuck = run(CHASER, [100, 100], [900, 100], sealed, 3);
  assert.ok(stuck.e.position[0] < 460, `held back by the wall (${stuck.e.position})`);
  const free = run(CHASER, [100, 100], [900, 100], undefined, 6);
  assert.ok(Math.hypot(free.e.position[0] - 900, free.e.position[1] - 100) < 40, 'no walls: it just walks');
});

test('player-visible / player-hidden: a wall hides the player, distance limits sight, 3D has distance only', () => {
  const watcher: ActorStateMachine = {
    initial: 'idle',
    states: {
      idle: { transitions: [{ to: 'alert', when: { type: 'player-visible', distance: 600 } }] },
      alert: { transitions: [{ to: 'idle', when: { type: 'player-hidden' } }] },
    },
  };
  const rt = new StateMachineRuntime();
  const e: MachineEntity = { id: 'e', position: [100, 100, 0], machine: watcher };
  const state = (player: [number, number, number], nav?: NavInput, engine: '2d' | '3d' = '2d') => {
    rt.step(0.1, [e], input({ player, nav, engine }));
    rt.step(0.1, [e], input({ player, nav, engine }));
    return rt.stateOf('e');
  };
  assert.equal(state([900, 100, 0], NAV), 'idle', 'behind the wall');
  assert.equal(state([450, 100, 0], NAV), 'alert', 'same side, within 600');
  assert.equal(state([900, 100, 0], NAV), 'idle', 'hidden again once the wall is between them');
  assert.equal(state([900, 100, 0], undefined), 'idle', 'no walls but beyond the 600 range');
  assert.equal(state([500, 100, 0], undefined), 'alert');
  const e3: MachineEntity = { id: 'e3', position: [0, 0, 0], machine: watcher };
  rt.step(0.1, [e3], input({ player: [1, 0, 1], engine: '3d' }));
  rt.step(0.1, [e3], input({ player: [1, 0, 1], engine: '3d' }));
  assert.equal(rt.stateOf('e3'), 'alert', '3D: visible when in range (there are no walls)');
});

test('the contract carries the new fields: sanitised, repaired, and the verifier flags pathfind in 3D', () => {
  const m = sanitizeStateMachine({ initial: 'a', states: { a: { move: 'patrol', points: [[1, 1], [2, 2]], pathfind: true, transitions: [{ to: 'a', when: { type: 'player-visible', distance: 99999 } }, { to: 'a', when: { type: 'player-hidden' } }] } } })!;
  assert.equal(m.states.a.pathfind, true);
  assert.deepEqual(m.states.a.transitions!.map((t) => t.when), [{ type: 'player-visible', distance: 2000 }, { type: 'player-hidden' }]);
  assert.equal(sanitizeStateMachine({ initial: 'a', states: { a: { pathfind: 'yes' } } })!.states.a.pathfind, undefined);
  const spec = createBlankSceneSpec('3d');
  spec.mode = 'game';
  const hero = spec.actors[0];
  hero.stateMachine = { initial: 'a', states: { a: { move: 'chase-player', pathfind: true } } };
  assert.ok(stateMachineIssues(hero, spec).some((i) => i.code === 'machine.pathfind-3d'));
});
