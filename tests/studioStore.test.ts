import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { useStudioStore } from '../src/state/useStudioStore';

// Phase 7C: the store is composed from slices with a single `as StudioState` cast, so check at runtime that every
// field and action declared on StudioState is actually provided by some slice.
test('studio store slices provide every StudioState field and action', () => {
  const src = fs.readFileSync(new URL('../src/state/studioTypes.ts', import.meta.url), 'utf8').replace(/\r/g, '');
  const body = src.slice(src.indexOf('export interface StudioState {'));
  const block = body.slice(0, body.indexOf('\n}\n'));
  const fields = [...block.matchAll(/^  (\w+)\??: (.*)$/gm)].map((m) => ({ name: m[1], action: m[2].trim().startsWith('(') }));
  assert.ok(fields.length > 100, `parsed ${fields.length} StudioState members`);
  const state = useStudioStore.getState() as unknown as Record<string, unknown>;
  for (const f of fields) {
    assert.ok(f.name in state, `missing ${f.name}`);
    if (f.action) assert.equal(typeof state[f.name], 'function', `${f.name} is an action`);
  }
});

test('store actions still mutate through slices (scene + world + actor + undo)', () => {
  const s = useStudioStore.getState();
  s.createNewBlankScene('3d', 'Slice test');
  const before = useStudioStore.getState().sceneSpec.actors.length;
  useStudioStore.getState().spawnAsset('mystery-gift-box');
  assert.equal(useStudioStore.getState().sceneSpec.actors.length, before + 1);
  useStudioStore.getState().updateTerrain({ type: 'desert-dunes' });
  assert.equal(useStudioStore.getState().sceneSpec.world.terrain.type, 'desert-dunes');
  useStudioStore.getState().undo();
  assert.notEqual(useStudioStore.getState().sceneSpec.world.terrain.type, 'desert-dunes');
});

test('click rule shared by studio and Player: graph-handled clicks keep unbox progress only', async () => {
  const { clickRunsBuiltIn } = await import('../src/runtime/gameSlice');
  const box = { assetId: 'mystery-gift-box', onClickAction: 'unbox-tap' as const };
  const coin = { assetId: 'gold-coin', onClickAction: 'collect' as any };
  assert.equal(clickRunsBuiltIn(box, 'game', true), true, 'unbox still counts taps when the graph reacts');
  assert.equal(clickRunsBuiltIn(coin, 'game', true), false, 'graph replaces other built-in effects (no double score)');
  assert.equal(clickRunsBuiltIn(coin, 'game', false), true);
  assert.equal(clickRunsBuiltIn({ assetId: 'x', onClickAction: 'none' }, 'media', false), false);
});
