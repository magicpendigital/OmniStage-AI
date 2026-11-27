import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import {
  applyInputMap,
  canonicalKeysFor,
  bindingConflicts,
  dropBindingConflicts,
  inputProblems,
  normalizeKey,
  repairInput,
  resolveBindings,
} from '../src/runtime/inputMap';
import { JOYSTICK_JUMP, joystickKeys, touchStyleFor } from '../src/runtime/touchLayout';
import { openHeadlessSession2D } from '../src/playtest/headless2d';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { Node2D, SceneSpec } from '../src/types/scene.schema';

function node(over: Partial<Node2D> & { id: string }): Node2D {
  return {
    name: over.id, type: 'tile-platform', x: 100, y: 300, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', ...over,
  } as Node2D;
}

function platformerScene(): SceneSpec {
  const spec = createBlankSceneSpec('2d', 'Input');
  spec.mode = 'game';
  spec.gameRules = { winCondition: 'score-threshold', targetScore: 1000, timeLimitSeconds: 60, instructions: '' };
  spec.logicGraph = { nodes: [], edges: [] };
  spec.nodes2D = [
    node({ id: 'floor', x: 500, y: 560, width: 1000, height: 40, physics2D: 'static-platform' }),
    node({ id: 'hero', physics2D: 'player-platformer', x: 500, y: 500 }),
  ];
  return spec;
}

test('normalizeKey: lower case, space aliases, junk rejected', () => {
  assert.equal(normalizeKey('K'), 'k');
  assert.equal(normalizeKey(' '), ' ');
  assert.equal(normalizeKey('Space'), ' ');
  assert.equal(normalizeKey('  Shift '), 'shift');
  assert.equal(normalizeKey(''), null);
  assert.equal(normalizeKey(7), null);
  assert.equal(normalizeKey('x'.repeat(40)), null);
});

test('applyInputMap adds the canonical key for a held bound key and never allocates without a remap', () => {
  const keys = new Set(['j']);
  assert.equal(applyInputMap(undefined, keys), keys, 'no input config: the same set back');
  assert.equal(applyInputMap({ touch: 'joystick' }, keys), keys, 'no bindings: the same set back');
  const mapped = applyInputMap({ bindings: { left: ['J'], jump: ['k', 'space'] } }, keys);
  assert.ok(mapped.has('arrowleft') && mapped.has('j'));
  assert.ok(!mapped.has(' '), 'jump is not pressed');
  assert.ok(keys.size === 1 && !keys.has('arrowleft'), 'the input set is never mutated');
  assert.ok(applyInputMap({ bindings: { jump: ['k'] } }, new Set(['k'])).has(' '));
  assert.equal(applyInputMap({ bindings: { left: ['j'] } }, new Set(['x'])).has('arrowleft'), false);
});

test('reserved keys, duplicates, unknown actions and too many keys are dropped by resolveBindings', () => {
  const b = resolveBindings({ bindings: { left: ['j', 'J', 'escape', 'tab', 5 as never], jump: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], fly: ['x'] } as never });
  assert.deepEqual(b.left, ['j']);
  assert.equal(b.jump!.length, 6);
  assert.equal((b as Record<string, unknown>).fly, undefined);
});

test('inputProblems / repairInput / conflicts', () => {
  const ok = { input: { bindings: { left: ['j'], right: ['l'], jump: ['k'] }, touch: 'joystick' as const } };
  assert.deepEqual(inputProblems(ok), []);
  assert.deepEqual(bindingConflicts(ok.input), []);

  const bad: Pick<SceneSpec, 'input'> = { input: { touch: 'wheel' as never, bindings: { left: ['j', 'escape'], fly: ['x'] } as never } };
  assert.ok(inputProblems(bad).length >= 3);
  assert.equal(repairInput(bad), true);
  assert.deepEqual(inputProblems(bad), []);
  assert.deepEqual(bad.input, { bindings: { left: ['j'] } });
  assert.equal(repairInput(bad), false, 'idempotent');
  const empty: Pick<SceneSpec, 'input'> = { input: { bindings: { fly: ['x'] } as never } };
  repairInput(empty);
  assert.equal(empty.input, undefined);

  const clash: Pick<SceneSpec, 'input'> = { input: { bindings: { left: ['j'], right: ['j', 'l'], up: ['i'], jump: ['i'] } } };
  assert.deepEqual(bindingConflicts(clash.input), ['"j" is bound to both left and right'], 'up and jump may share a key');
  assert.equal(dropBindingConflicts(clash), true);
  assert.deepEqual(clash.input!.bindings, { left: ['j'], right: ['l'], up: ['i'], jump: ['i'] });
});

test('joystickKeys: dead zone, diagonals, platformer vs free movement', () => {
  assert.deepEqual(joystickKeys(0.1, -0.1, 'dpad'), []);
  assert.deepEqual(joystickKeys(-1, 0, 'dpad'), ['arrowleft']);
  assert.deepEqual(joystickKeys(0.8, 0.8, 'dpad'), ['arrowright', 'arrowdown']);
  assert.deepEqual(joystickKeys(0, -0.9, 'dpad'), ['arrowup']);
  assert.deepEqual(joystickKeys(0.9, 0.9, 'platformer'), ['arrowright'], 'a platformer stick never walks down');
  assert.deepEqual(joystickKeys(0, -(JOYSTICK_JUMP + 0.05), 'platformer'), ['arrowup']);
  assert.deepEqual(joystickKeys(0, -0.4, 'platformer'), [], 'a small upward push does not jump');
  assert.deepEqual(joystickKeys(1, 0, 'none'), []);
  assert.deepEqual(joystickKeys(NaN, 0, 'dpad'), []);
});

test('touchStyleFor: auto = stick for free movement, buttons for platformers; the scene can force either', () => {
  assert.equal(touchStyleFor({}, 'dpad'), 'joystick');
  assert.equal(touchStyleFor({}, 'platformer'), 'buttons');
  assert.equal(touchStyleFor({ input: { touch: 'joystick' } }, 'platformer'), 'joystick');
  assert.equal(touchStyleFor({ input: { touch: 'buttons' } }, 'dpad'), 'buttons');
  assert.equal(touchStyleFor({ input: { touch: 'joystick' } }, 'none'), 'buttons');
});

test('headless: a remapped key walks the real 2D player; unmapped keys still work', () => {
  const run = (keys: string[], input?: SceneSpec['input']) => {
    const spec = platformerScene();
    if (input) spec.input = input;
    const session = openHeadlessSession2D(spec);
    try {
      for (const k of keys) session.keys.add(k);
      for (let i = 0; i < 60; i++) session.step();
      return Object.values(session.bodies).find((b) => b.ctl)?.ctl?.x ?? 0;
    } finally {
      session.dispose();
    }
  };
  const start = run([]);
  assert.ok(run(['l'], { bindings: { right: ['l'] } }) > start + 100, 'L walks right when bound');
  assert.ok(run(['l']) < start + 5, 'L does nothing without the binding');
  assert.ok(run(['d'], { bindings: { right: ['l'] } }) > start + 100, 'D still works');
  assert.ok(run(['j'], { bindings: { left: ['j'] } }) < start - 100, 'J walks left when bound');
});

test('verifier: input problems are reported and auto-fixed; input outside a game is removed', () => {
  const spec = platformerScene();
  spec.input = { bindings: { left: ['j'], right: ['j'], fly: ['x'] } as never };
  const codes = (s: SceneSpec) => verifySceneSpec(s).issues.map((i) => i.code);
  assert.ok(codes(spec).includes('input.invalid'));
  const fixed = autoFixSceneSpec(spec).spec;
  assert.deepEqual(codes(fixed).filter((c) => c.startsWith('input.')), []);

  const clash = platformerScene();
  clash.input = { bindings: { left: ['j'], right: ['j'] } };
  assert.ok(codes(clash).includes('input.conflict'));
  assert.deepEqual(codes(autoFixSceneSpec(clash).spec).filter((c) => c.startsWith('input.')), []);

  const media = platformerScene();
  media.mode = 'media';
  media.input = { touch: 'joystick' };
  assert.ok(codes(media).includes('input.unsupported'));
  assert.equal(autoFixSceneSpec(media).spec.input, undefined);

  const fine = platformerScene();
  fine.input = { bindings: { left: ['j'], right: ['l'], jump: ['k'] }, touch: 'buttons' };
  assert.deepEqual(codes(fine).filter((c) => c.startsWith('input.')), []);
});


// ---- review findings ----------------------------------------------------------------------------------

test('canonicalKeysFor: a remapped key also stands for the key it replaces in the logic graph', () => {
  const input = { bindings: { jump: ['k'], left: ['j'] } };
  assert.deepEqual(canonicalKeysFor(input, 'k'), [' ']);
  assert.deepEqual(canonicalKeysFor(input, 'j'), ['arrowleft']);
  assert.deepEqual(canonicalKeysFor(input, 'x'), []);
  assert.deepEqual(canonicalKeysFor(undefined, 'k'), []);
});

test('a binding may not steal a built-in key for another action (left on D would cancel right)', () => {
  const input = { bindings: { left: ['d', 'j'] } };
  assert.deepEqual(bindingConflicts(input), ['"d" is bound to both right and left']);
  const spec: Pick<SceneSpec, 'input'> = { input: { bindings: { left: ['d', 'j'], jump: ['w', 'k'] } } };
  assert.equal(dropBindingConflicts(spec), true);
  assert.deepEqual(spec.input!.bindings, { left: ['j'], jump: ['w', 'k'] }, 'W may serve jump (up and jump are one press)');
});
