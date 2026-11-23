import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { createPlayerStore } from '../src/player/playerStore';
import { bindRuntimeStore } from '../src/runtime/host';
import { RuntimeLogicGraph } from '../src/runtime/logicGraph';
import type { LogicNode } from '../src/types/scene.schema';

// The AI prompt and the mechanic wiring emit a `tap-count` condition; the interpreter used to throw "Unsupported condition".
function conditionNode(params: Record<string, unknown>): LogicNode {
  return { id: 'n-tap', type: 'condition', title: 'Taps', params, inputs: [], outputs: [] } as unknown as LogicNode;
}

test('tap-count condition is true once the actor was tapped enough times', () => {
  const scene = createBlankSceneSpec('3d', 'Tap');
  scene.mode = 'game';
  scene.actors = [{ ...createBlankSceneSpec('3d', 'x').actors[0], id: 'box', unboxTapsRequired: 3 } as any];
  const store = createPlayerStore([scene]);
  bindRuntimeStore(store);
  const runtime = new RuntimeLogicGraph('3d');
  const check = (params: Record<string, unknown>) => (runtime as any).condition(conditionNode(params), undefined, {});

  assert.equal(check({ conditionType: 'tap-count', actorId: 'box' }), false, 'no taps yet');
  store.setState({ unboxTapCounts: { box: 2 } });
  assert.equal(check({ conditionType: 'tap-count', actorId: 'box' }), false, '2 of the actor\'s 3 taps');
  store.setState({ unboxTapCounts: { box: 3 } });
  assert.equal(check({ conditionType: 'tap-count', actorId: 'box' }), true, 'uses the actor unboxTapsRequired');
  assert.equal(check({ conditionType: 'tap-count', actorId: 'box', tapsRequired: 5 }), false, 'explicit tapsRequired wins');
});

test('tap-count condition reports a missing actor instead of silently passing', () => {
  const scene = createBlankSceneSpec('3d', 'Tap');
  const store = createPlayerStore([scene]);
  bindRuntimeStore(store);
  const runtime = new RuntimeLogicGraph('3d');
  assert.throws(() => (runtime as any).condition(conditionNode({ conditionType: 'tap-count', actorId: 'ghost' }), undefined, {}), /missing actor/);
});
