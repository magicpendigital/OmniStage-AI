import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { COALESCE_WINDOW_MS, HISTORY_CAP, editKey, pushPast, resetHistoryBurst } from '../src/state/history';
import { useStudioStore } from '../src/state/useStudioStore';

const spec = (title: string) => createBlankSceneSpec('3d', title);

test('pushPast: edits to the same target inside the window are one undo step', () => {
  resetHistoryBurst();
  let past = [spec('base')];
  const key = editKey('actor:a1', { primaryColor: '#fff' });
  past = pushPast(past, spec('v1'), key, 1000);
  assert.equal(past.length, 2, 'first edit of a burst pushes the pre-edit snapshot');
  past = pushPast(past, spec('v2'), key, 1100);
  past = pushPast(past, spec('v3'), key, 1250);
  assert.equal(past.length, 2, 'slider ticks coalesce');
  assert.equal(past[1].title, 'v1', 'the snapshot kept is the one from before the burst');
  past = pushPast(past, spec('v4'), key, 1250 + COALESCE_WINDOW_MS + 1);
  assert.equal(past.length, 3, 'a pause starts a new step');
});

test('pushPast: different targets and unkeyed edits never coalesce', () => {
  resetHistoryBurst();
  let past: ReturnType<typeof pushPast> = [];
  past = pushPast(past, spec('a'), editKey('actor:a1', { x: 1 }), 0);
  past = pushPast(past, spec('b'), editKey('actor:a2', { x: 1 }), 10);
  past = pushPast(past, spec('c'), undefined, 20);
  past = pushPast(past, spec('d'), undefined, 30);
  assert.equal(past.length, 4);
});

test('pushPast: history is capped', () => {
  resetHistoryBurst();
  let past: ReturnType<typeof pushPast> = [];
  for (let i = 0; i < HISTORY_CAP + 20; i++) past = pushPast(past, spec(`s${i}`), undefined, i);
  assert.equal(past.length, HISTORY_CAP);
  assert.equal(past[past.length - 1].title, `s${HISTORY_CAP + 19}`);
});

test('store: dragging a 2D node is undoable and one drag is one step', () => {
  const s = useStudioStore.getState();
  s.createNewBlankScene('2d', 'History 2D');
  useStudioStore.getState().spawnPreset2D('2d-neon-platform');
  const st = () => useStudioStore.getState();
  const node = st().sceneSpec.nodes2D[st().sceneSpec.nodes2D.length - 1];
  resetHistoryBurst();
  const before = st().pastSpecs.length;
  for (let i = 1; i <= 5; i++) st().updateNode2D(node.id, { x: node.x + i * 10, y: node.y });
  assert.equal(st().pastSpecs.length, before + 1, 'five drag moves = one history entry');
  st().undo();
  assert.equal(st().sceneSpec.nodes2D.find((n) => n.id === node.id)!.x, node.x, 'undo returns the node to where the drag began');
});
