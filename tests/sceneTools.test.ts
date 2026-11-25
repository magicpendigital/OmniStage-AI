import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScene, MAX_TOOL_RESULT_CHARS, SceneToolbox, SCENE_TOOL_DEFINITIONS, SCENE_TOOL_NAMES, sliceScene } from '../src/agent/tools/sceneTools';
import { cloneSceneSpec, createBlankSceneSpec } from '../src/registry/assetRegistry';
import { buildAgentSystemPrompt } from '../src/agent/systemPrompts';
import { finalizeLogicGraph } from '../src/agent/studioAgent';
import type { SceneSpec } from '../src/types/scene.schema';

function gameScene(): SceneSpec {
  const spec = createBlankSceneSpec('2d');
  spec.mode = 'game';
  return spec;
}

test('tool definitions: exactly the tools that exist, plain JSON-schema objects', () => {
  assert.deepEqual(SCENE_TOOL_DEFINITIONS.map((d) => d.name), [...SCENE_TOOL_NAMES]);
  for (const forbidden of ['generate_asset', 'playtest', 'screenshot', 'add_from_kit']) {
    assert.ok(!SCENE_TOOL_NAMES.includes(forbidden as never), `${forbidden} must not exist yet`);
  }
  for (const d of SCENE_TOOL_DEFINITIONS) {
    assert.equal(d.input_schema.type, 'object');
    assert.ok(d.description.length > 20);
  }
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(SCENE_TOOL_DEFINITIONS)));
});

test('get_scene_slice: only the requested sections, ids narrow lists, bad input is an ERROR string', () => {
  const spec = createBlankSceneSpec('2d');
  const tb = new SceneToolbox(spec);
  const summary = JSON.parse(tb.run('get_scene_slice', { sections: ['summary'] }));
  assert.deepEqual(Object.keys(summary), ['summary']);
  assert.equal(summary.summary.nodes2D, spec.nodes2D.length);

  const one = JSON.parse(tb.run('get_scene_slice', { sections: ['nodes2D'], ids: ['node2d-hero'] }));
  assert.deepEqual(one.nodes2D.map((n: any) => n.id), ['node2d-hero']);
  assert.ok(!('actors' in one) && !('logic' in one));

  const multi = JSON.parse(tb.run('get_scene_slice', { sections: ['world', 'rules', 'camera', 'variables', 'hud', 'audio', 'logic'] }));
  assert.deepEqual(Object.keys(multi).sort(), ['audio', 'camera', 'hud', 'logic', 'rules', 'variables', 'world']);
  assert.equal(multi.logic, null, 'no logic graph yet');

  assert.match(tb.run('get_scene_slice', { sections: ['nope'] }), /^ERROR: Unknown section/);
  assert.match(tb.run('get_scene_slice', {}), /^ERROR: "sections" is required/);
  assert.deepEqual(sliceScene(spec, ['actors'], ['missing']), { actors: [] });
});

test('buildUserPrompt starts from a summary and the id index, never the whole spec', () => {
  const spec = createBlankSceneSpec('3d');
  const text = new SceneToolbox(spec).buildUserPrompt('add rain');
  assert.match(text, /SCENE SUMMARY/);
  assert.ok(text.includes(spec.actors[0].id));
  assert.ok(!text.includes('"environment"'), 'bulk scene data is not in the first message');
});

test('apply_patch: happy path goes through the shared check and keeps the patch', () => {
  const spec = createBlankSceneSpec('3d');
  const hero = spec.actors[0].id;
  const tb = new SceneToolbox(spec);
  const out = tb.run('apply_patch', { ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [2, 0, 1] }] });
  assert.match(out, /^OK: patch applied \(1 op\(s\)\)/);
  assert.match(out, /Verifier/);
  assert.deepEqual(tb.spec.actors[0].position, [2, 0, 1]);
  const result = tb.result();
  assert.ok(result.changed && result.report.ok);
  assert.deepEqual(result.spec.actors[0].position, [2, 0, 1]);
  assert.deepEqual(spec.actors[0].position, createBlankSceneSpec('3d').actors[0].position, 'input spec untouched');
  const merged = tb.run('apply_patch', { mergePatch: { world: { weather: { type: 'snow', intensity: 0.5 } } } });
  assert.match(merged, /^OK: patch applied \(mergePatch\)/);
  assert.equal(tb.spec.world.weather.type, 'snow');
});

test('apply_patch: a rejected patch changes nothing and says how to retry', () => {
  const spec = createBlankSceneSpec('3d');
  const tb = new SceneToolbox(spec);
  const out = tb.run('apply_patch', { ops: [{ op: 'replace', path: '/actors/@ghost/position', value: [0, 0, 0] }] });
  assert.match(out, /^ERROR: PATCH REJECTED/);
  assert.match(out, /ghost/);
  assert.deepEqual(tb.spec, spec);
  assert.match(tb.run('apply_patch', { mergePatch: { id: 'other' } }), /^ERROR: PATCH REJECTED.*scene id/);
  assert.match(tb.run('apply_patch', { ops: 'nope' }), /^ERROR: "ops" must be an array/);
  assert.match(tb.run('apply_patch', {}), /^ERROR: Nothing to apply/);
  const result = tb.result();
  assert.equal(result.changed, false);
  assert.ok(result.patches.every((p) => !p.ok));
});

test('apply_patch: a patch that makes verification worse is reverted', () => {
  const spec = gameScene();
  const tb = new SceneToolbox(spec);
  // Switching the win rule without the matching data adds a verifier error that autofix cannot repair.
  const worse = tb.run('apply_patch', { mergePatch: { gameRules: { winCondition: 'variable-threshold', winVariable: { id: 'nope', atLeast: 1 } } } });
  assert.match(worse, /^ERROR: PATCH REVERTED/);
  assert.match(worse, /worse \(0 -> 1 errors\)/);
  assert.equal(tb.spec.gameRules.winCondition, spec.gameRules.winCondition, 'scene unchanged');
  assert.equal(tb.result().changed, false);
  assert.equal(tb.result().patches[0].reason, 'worse');
  // A patch that is not worse is kept.
  assert.match(tb.run('apply_patch', { mergePatch: { title: 'Renamed' } }), /^OK:/);
  assert.equal(tb.spec.title, 'Renamed');
});

test('verify returns the current report; finish ends the loop', () => {
  const tb = new SceneToolbox(createBlankSceneSpec('2d'));
  assert.match(tb.run('verify', {}), /^Verifier passed/);
  assert.equal(tb.finished, false);
  assert.equal(tb.run('finish', { summary: ' Added a coin. ' }), 'OK: finished.');
  assert.equal(tb.finished, true);
  assert.equal(tb.result().summary, 'Added a coin.');
});

test('search_assets: built-ins, kind filter, extra library assets, scene recipes', () => {
  const spec = createBlankSceneSpec('2d');
  spec.particleLibrary = { 'my-spark': { rate: 10, life: 1, speed: [1, 2], angle: [0, 360], gravity: 0, size: [1, 2], shape: 'circle', colors: ['#fff'] } } as any;
  const tb = new SceneToolbox(spec, { assets: [{ id: 'lib-dragon', name: 'Cute Dragon', kind: '3d', tags: ['monster'], url: '/api/library/file/dragon.glb', source: 'library' }, { id: 'lib-click', name: 'Soft Click', kind: 'audio' }] });
  const robot = JSON.parse(tb.run('search_assets', { query: 'robot' }));
  assert.ok(robot.some((h: any) => h.id === 'gltf-robot-expressive' && h.clips.includes('Walking')));
  const dragon = JSON.parse(tb.run('search_assets', { query: 'dragon monster' }));
  assert.equal(dragon[0].id, 'lib-dragon');
  assert.equal(dragon[0].url, '/api/library/file/dragon.glb');
  const sfx = JSON.parse(tb.run('search_assets', { query: 'coin', kind: 'sfx' }));
  assert.ok(sfx.length && sfx.every((h: any) => h.kind === 'sfx'));
  const particles = JSON.parse(tb.run('search_assets', { query: 'spark', kind: 'particle' }));
  assert.ok(particles.some((h: any) => h.id === 'my-spark' && h.source === 'this scene'));
  assert.match(tb.run('search_assets', { query: 'click', kind: '3d' }), /^No assets matched/, 'audio library entries are not 3d');
  assert.match(tb.run('search_assets', { query: 'zzzzqqq' }), /^No assets matched/);
  assert.match(tb.run('search_assets', { query: 'x', kind: 'nope' }), /^ERROR: Unknown kind/);
});

test('error strings: unknown tool and bad input never throw', () => {
  const tb = new SceneToolbox(createBlankSceneSpec('2d'));
  assert.match(tb.run('generate_asset', {}), /^ERROR: Unknown tool "generate_asset"/);
  for (const input of [null, undefined, 5, 'x', [], { sections: 5 }]) {
    for (const name of SCENE_TOOL_NAMES) assert.doesNotThrow(() => tb.run(name, input), `${name}(${JSON.stringify(input)})`);
  }
});

test('results are capped', () => {
  const spec = createBlankSceneSpec('3d');
  spec.description = 'x'.repeat(20_000);
  const tb = new SceneToolbox(spec);
  const out = tb.run('get_scene_slice', { sections: ['summary', 'actors', 'world', 'rules', 'camera', 'other'] });
  assert.ok(out.length <= MAX_TOOL_RESULT_CHARS);
  const big = createBlankSceneSpec('3d');
  big.actors = Array.from({ length: 200 }, (_, i) => ({ ...big.actors[0], id: `a${i}`, name: `Actor number ${i} with a long name to take space` }));
  const sliced = new SceneToolbox(big).run('get_scene_slice', { sections: ['actors'] });
  assert.ok(sliced.length <= MAX_TOOL_RESULT_CHARS);
  assert.match(sliced, /truncated/);
});

test('Phase 3 fields pass through the shared check unchanged', () => {
  const spec = gameScene();
  spec.variables = [{ id: 'coins', initial: 0, min: 0, max: 99 }];
  spec.hud = [{ id: 'hud-coins', kind: 'text', source: 'variable', variableId: 'coins', anchor: 'top-left', label: 'Coins' }];
  const tb = new SceneToolbox(spec);
  const before = checkScene(spec).spec;
  assert.deepEqual(before.variables, spec.variables);
  assert.deepEqual(before.hud, spec.hud);
  assert.match(tb.run('apply_patch', { mergePatch: { title: 'Coin run' } }), /^OK:/);
  assert.deepEqual(tb.spec.variables, spec.variables);
  assert.deepEqual(tb.spec.hud, spec.hud);
  const slice = JSON.parse(tb.run('get_scene_slice', { sections: ['variables', 'hud'], ids: ['coins', 'hud-coins'] }));
  assert.equal(slice.variables[0].id, 'coins');
  assert.equal(slice.hud[0].id, 'hud-coins');
});

test('checkScene is the single path: finalizeLogicGraph + autofix, input untouched, recipes hook runs first', () => {
  const spec = createBlankSceneSpec('2d');
  const snapshot = JSON.stringify(spec);
  const seen: string[] = [];
  const checked = checkScene(spec, { recipes: (draft) => { seen.push(draft.id); draft.title = 'hooked'; return ['preset-x']; } });
  assert.equal(JSON.stringify(spec), snapshot, 'input is never mutated');
  assert.deepEqual(seen, [spec.id]);
  assert.equal(checked.spec.title, 'hooked');
  assert.deepEqual(checked.presets, ['preset-x']);
  const direct = finalizeLogicGraph(cloneSceneSpec(spec));
  assert.equal(checked.spec.logicGraph?.nodes.length, direct.spec.logicGraph?.nodes.length, 'same logic graph as finalizeLogicGraph');
});

test('tools system prompt: compact, names the tools, keeps the data contracts', () => {
  const prompt = buildAgentSystemPrompt('keep it neon', 'tools');
  for (const name of SCENE_TOOL_NAMES) assert.ok(prompt.includes(name), name);
  assert.match(prompt, /VISUAL LOGIC GRAPH/);
  assert.match(prompt, /GAME STATE/);
  assert.match(prompt, /keep it neon/);
  assert.doesNotMatch(prompt, /AVAILABLE 3D RIGGED GLTF/);
  assert.ok(prompt.length < buildAgentSystemPrompt().length, 'smaller than the full prompt');
  assert.match(buildAgentSystemPrompt(undefined, 'patch'), /JSON PATCH EDITS/, 'other modes untouched');
});
