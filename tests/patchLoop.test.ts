import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyJsonPatch, JsonPatchError } from '../src/utils/jsonPatch';
import { applyPatchProposal, buildPatchUserPrompt, PatchProposal, PatchTurn, runPatchLoop } from '../src/agent/patchLoop';
import { buildAgentSystemPrompt } from '../src/agent/systemPrompts';
import { autoFixSceneSpec } from '../src/verification/sceneVerifier';
import { finalizeLogicGraph } from '../src/agent/studioAgent';
import { cloneSceneSpec, createBlankSceneSpec } from '../src/registry/assetRegistry';
import type { SceneSpec } from '../src/types/scene.schema';

const check = (spec: SceneSpec) => autoFixSceneSpec(finalizeLogicGraph(cloneSceneSpec(spec)).spec);

test('JSON Patch: @id addressing, bare ids, move/copy and indexed errors', () => {
  const doc = { actors: [{ id: 'a', x: 1 }, { id: 'b', x: 2 }], world: { sky: 'day' } };
  const out = applyJsonPatch(doc, [
    { op: 'replace', path: '/actors/@b/x', value: 5 },
    { op: 'replace', path: '/actors/a/x', value: 7 },
    { op: 'copy', from: '/actors/@a', path: '/actors/-' },
    { op: 'move', from: '/world/sky', path: '/world/skybox' },
    { op: 'remove', path: '/actors/@b' },
  ]);
  assert.deepEqual(out.actors, [{ id: 'a', x: 7 }, { id: 'a', x: 7 }]);
  assert.deepEqual(out.world, { skybox: 'day' });
  assert.deepEqual(doc.actors[1], { id: 'b', x: 2 }, 'input untouched');
  assert.throws(() => applyJsonPatch(doc, [{ op: 'replace', path: '/actors/@nope/x', value: 1 }]), (e: unknown) =>
    e instanceof JsonPatchError && /ops\[0\]/.test(e.message) && /nope/.test(e.message));
  assert.throws(() => applyJsonPatch(doc, [{ op: 'replace', path: '/world/missing', value: 1 }]), /use "add"/);
});

test('applyPatchProposal: merge patch first, then ops; protects id and actors', () => {
  const spec = createBlankSceneSpec('3d');
  const hero = spec.actors[0].id;
  const next = applyPatchProposal(spec, {
    mergePatch: { world: { weather: { type: 'snow', intensity: 0.7 } } },
    ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [1, 0, 2] }],
  });
  assert.equal(next.world.weather.type, 'snow');
  assert.deepEqual(next.actors[0].position, [1, 0, 2]);
  assert.equal(next.world.terrain.type, spec.world.terrain.type, 'untouched keys survive the merge');
  assert.throws(() => applyPatchProposal(spec, { mergePatch: { id: 'other' } }), /scene id/);
  assert.throws(() => applyPatchProposal(spec, { ops: [{ op: 'remove', path: '/actors' }] }), /actors must stay an array/);
});

test('patch loop: rejected patch is reported back, then a valid patch is verified and kept', async () => {
  const spec = createBlankSceneSpec('3d');
  const hero = spec.actors[0].id;
  const turns: PatchTurn[] = [];
  const replies: PatchProposal[] = [
    { assistantMessage: 'Moved the hero', ops: [{ op: 'replace', path: '/actors/@ghost/position', value: [0, 0, 0] }] },
    { diffSummary: ['Hero moved to x=2'], ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [2, 0, 0] }], done: true },
  ];
  const result = await runPatchLoop({ prompt: 'move the hero right', spec, check, propose: async (t) => { turns.push(t); return replies[t.round] ?? null; } });
  assert.ok(result);
  assert.equal(result.rounds.length, 2);
  assert.match(result.rounds[0].rejected!, /ghost/);
  assert.match(turns[1].toolResults[0], /PATCH REJECTED/);
  assert.deepEqual(result.spec.actors[0].position, [2, 0, 0]);
  assert.equal(result.assistantMessage, 'Moved the hero');
  assert.ok(result.changed && result.report.ok);
});

test('patch loop: verifier errors become the next tool result; worse rounds are discarded', async () => {
  // Fake verifier: one error per actor named "bad".
  const fakeCheck = (spec: SceneSpec) => {
    const bad = spec.actors.filter((a) => a.name === 'bad');
    const issues = bad.map((a) => ({ code: 'BAD_ACTOR', severity: 'error' as const, message: 'rename it', targetId: a.id, fixable: false }));
    return { spec, fixes: [], report: { ok: !issues.length, errors: issues.length, warnings: 0, issues } };
  };
  const spec = createBlankSceneSpec('3d');
  const id = spec.actors[0].id;
  const replies: PatchProposal[] = [
    { diffSummary: ['renamed'], ops: [{ op: 'replace', path: `/actors/@${id}/name`, value: 'bad' }] },
    { ops: [{ op: 'add', path: '/actors/-', value: { ...spec.actors[0], id: 'x2', name: 'bad' } }] },
    { diffSummary: ['fixed name'], ops: [{ op: 'replace', path: `/actors/@${id}/name`, value: 'good' }], done: true },
  ];
  const seen: string[][] = [];
  const result = await runPatchLoop({ prompt: 'p', spec, maxRounds: 3, check: fakeCheck, propose: async (t) => { seen.push(t.toolResults); return replies[t.round]; } });
  assert.ok(result);
  assert.deepEqual(result.rounds.map((r) => r.errorsAfter), [1, 2, 0]);
  assert.match(seen[1][0], /BAD_ACTOR/, 'round 2 sees the verifier findings');
  assert.match(seen[2][1], /WORSE/, 'round 3 is told round 2 was discarded');
  assert.equal(result.spec.actors.length, 1, 'worse round discarded');
  assert.equal(result.spec.actors[0].name, 'good');
  assert.deepEqual(result.diffSummary, ['renamed', 'fixed name']);
  assert.ok(result.report.ok);
});

test('patch loop: provider failure on round 1 returns null (caller falls back); empty patch = nothing to change', async () => {
  const spec = createBlankSceneSpec('2d');
  assert.equal(await runPatchLoop({ prompt: 'x', spec, check, propose: async () => null }), null);
  const none = await runPatchLoop({ prompt: 'x', spec, check, propose: async () => ({ ops: [], done: true, assistantMessage: 'Already fine' }) });
  assert.ok(none && !none.changed);
  assert.equal(none.rounds.length, 1);
});

test('patch prompts: system prompt switches format, user prompt carries ids and tool results', () => {
  assert.match(buildAgentSystemPrompt(undefined, 'patch'), /JSON PATCH EDITS/);
  assert.doesNotMatch(buildAgentSystemPrompt(undefined, 'patch'), /complete, valid updated SceneSpec/);
  assert.match(buildAgentSystemPrompt(), /updatedSceneSpec: the complete/);
  const spec = createBlankSceneSpec('3d');
  const user = buildPatchUserPrompt({ prompt: 'add rain', spec, round: 1, toolResults: ['Round 1: PATCH REJECTED — x'] });
  assert.ok(user.includes(spec.actors[0].id));
  assert.match(user, /round 2/);
  assert.match(user, /PATCH REJECTED/);
  assert.ok(!user.includes('\n  "'), 'spec is sent as compact JSON');
});
