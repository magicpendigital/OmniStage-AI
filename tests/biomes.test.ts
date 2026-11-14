/**
 * Phase 10B — biomes, water landmarks, soundtrack contract: AI normalisation, verifier rules and the offline director.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBiome, applyBiomeToScene, BIOME_IDS, BIOME_PRESETS, expandBiome, featureFootprint, featureStageClearance } from '../src/runtime/biomes';
import { scatterPlacements } from '../src/render3d/world3d';
import { createBlankSceneSpec, SCENE_TEMPLATES } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, FEATURE_STAGE_CLEARANCE, MEDIA_CRAFT_CODES, verifySceneSpec } from '../src/verification/sceneVerifier';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent, normalizeGeneratedSceneSpec } from '../src/agent/storyboardAgent';
import { resolveSoundtrack } from '../src/audio/soundtrack';
import { buildAgentSystemPrompt } from '../src/agent/systemPrompts';

const film = () => ({ ...createBlankSceneSpec('3d', 'Biome film'), mode: 'media' as const, durationSeconds: 10 });

test('every biome dresses the world, keeps its landmarks off the stage and props out of the water', () => {
  for (const id of BIOME_IDS) {
    const world = applyBiome(createBlankSceneSpec('3d').world, id);
    assert.equal(world.biome, id);
    assert.ok(world.scatterObjects.length >= 2, `${id} scatter`);
    assert.notEqual(world.terrain.type, 'flat-grid');
    for (const f of world.features || []) {
      assert.ok(featureStageClearance(f) >= FEATURE_STAGE_CLEARANCE, `${id} ${f.type} clearance`);
      const fp = featureFootprint(f);
      for (const layer of world.scatterObjects) {
        for (const p of scatterPlacements(layer, world.terrain.type, world.terrain.elevationScale, world.features)) {
          assert.ok(!fp.contains(p.pos[0], p.pos[2]), `${id}: ${layer.type} inside ${f.type}`);
        }
      }
    }
    const scene = applyBiomeToScene(film(), id);
    assert.equal(scene.environment.groundGrid, false);
    assert.ok(scene.environment.fogFar > 60);
  }
  assert.ok(BIOME_PRESETS['waterfall-valley'].features.some((f) => f.type === 'waterfall'));
  // An AI world that only names a biome gets the dressing; explicit layers stay.
  const named = expandBiome({ ...createBlankSceneSpec('3d').world, biome: 'beach', scatterObjects: [] });
  assert.ok(named.scatterObjects.some((l) => l.type === 'palm-trees'));
  const kept = expandBiome({ ...createBlankSceneSpec('3d').world, biome: 'forest', scatterObjects: [{ id: 'x', type: 'cacti', count: 3, spreadRadius: 10, scaleRange: [1, 1] }] });
  assert.deepEqual(kept.scatterObjects.map((l) => l.type), ['cacti']);
});

test('AI output: biome, features and soundtrack survive normalisation', () => {
  const spec = normalizeGeneratedSceneSpec({
    engineType: '3d', mode: 'media', durationSeconds: 8,
    world: { biome: 'waterfall-valley' },
    soundtrack: { music: 'epic', ambience: 'jungle', cues: [{ time: 2, sfx: 'splash' }, { time: 'x', sfx: 'pop' }] },
  }, '3d');
  assert.equal(spec.world.biome, 'waterfall-valley');
  assert.ok(spec.world.features!.some((f) => f.type === 'waterfall'));
  assert.ok(spec.world.scatterObjects.length > 3);
  assert.equal(spec.environment.groundGrid, false);
  assert.deepEqual(spec.soundtrack, { music: { mood: 'epic' }, ambience: { type: 'auto' }, cues: [{ time: 2, sfx: 'splash' }] });
  assert.equal(resolveSoundtrack(spec)!.ambience, 'waterfall');
  const feature = normalizeGeneratedSceneSpec({ engineType: '3d', world: { features: [{ type: 'pond', position: [8, 0, -8], size: 9 }, { type: 'volcano' }] } }, '3d');
  assert.deepEqual(feature.world.features!.map((f) => [f.type, f.size]), [['pond', 3]]);
});

test('verifier: silent films, broken soundtracks, landmarks on the stage', () => {
  const spec = film();
  assert.ok(MEDIA_CRAFT_CODES.includes('media.silent'));
  assert.ok(verifySceneSpec(spec).issues.some((i) => i.code === 'media.silent'));
  spec.soundtrack = { music: { mood: 'joyful' as any }, ambience: { type: 'jungle' as any }, cues: [{ time: 3, sfx: 'pop' }, { time: 50, sfx: 'pop' }, { time: 1, sfx: 'boing' }] };
  spec.world = { ...spec.world, biome: 'moon' as any, features: [{ id: 'w', type: 'waterfall', position: [0, 0, -2] }, { id: 'v', type: 'volcano' as any, position: [9, 0, 9] }] };
  const codes = verifySceneSpec(spec).issues.map((i) => i.code);
  for (const c of ['soundtrack.invalid', 'world.biome-invalid', 'world.feature-invalid', 'world.feature-on-stage']) assert.ok(codes.includes(c), c);
  assert.ok(!codes.includes('media.silent'));
  const fixed = autoFixSceneSpec(spec).spec;
  assert.deepEqual(fixed.soundtrack, { music: { mood: 'calm' }, ambience: { type: 'auto' }, cues: [{ time: 3, sfx: 'pop' }] });
  assert.equal(fixed.world.biome, undefined);
  assert.deepEqual(fixed.world.features!.map((f) => f.id), ['w']);
  assert.ok(featureStageClearance(fixed.world.features![0]) >= FEATURE_STAGE_CLEARANCE);
  const after = verifySceneSpec(fixed).issues.map((i) => i.code);
  for (const c of ['soundtrack.invalid', 'world.biome-invalid', 'world.feature-invalid', 'world.feature-on-stage']) assert.ok(!after.includes(c), c);
  // Templates stay free of the new structural warnings.
  for (const [id, t] of Object.entries(SCENE_TEMPLATES)) {
    const tc = verifySceneSpec(t).issues.map((i) => i.code);
    assert.ok(!tc.some((c) => c.startsWith('soundtrack.') || c.startsWith('world.')), id);
  }
});

test('offline director: films get a biome set and a soundtrack (waterfall when asked)', () => {
  const prompt = 'Làm phim 3D 3 cảnh: chú robot đi tìm thác nước trong rừng cùng bạn cáo';
  const plan = buildLocalStoryboardPlan(prompt, detectStoryboardIntent(prompt)!);
  for (let i = 0; i < plan.beats.length; i++) {
    const spec = autoFixSceneSpec(buildLocalSceneForBeat(prompt, plan, i)).spec;
    assert.equal(spec.world.biome, 'waterfall-valley');
    assert.ok(spec.world.features!.some((f) => f.type === 'waterfall'));
    assert.ok(spec.soundtrack?.music && spec.soundtrack.music.mood !== 'none');
    assert.ok(!verifySceneSpec(spec).issues.some((x) => x.code === 'media.silent' || x.code.startsWith('world.')));
  }
});

test('the AI prompt teaches soundtrack, biomes and water features', () => {
  const p = buildAgentSystemPrompt();
  for (const word of ['soundtrack', 'biome', 'waterfall', 'mood', 'ambience', 'cues']) assert.match(p, new RegExp(word), word);
});
