import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUserEdit, continuityCheck, createRoomSession, mergeDeskOutput } from '../src/agent/writersRoom';
import { dressAs, locationOf, shareLocationWorld, shareLocationWorlds } from '../src/agent/locations';
import { editFilm, sameLocation } from '../src/agent/filmEditor';
import { autoFixStoryBible, buildLocalStoryBible, cleanLocations, describeBible, describeBibleForScene, deriveLocations, sanitizeStoryBible } from '../src/agent/storyBible';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent } from '../src/agent/storyboardAgent';
import { applyBiomeToScene } from '../src/runtime/biomes';
import type { SceneSpec, StoryBible } from '../src/types/scene.schema';

const PROMPT = 'Làm phim hoạt hình 4 cảnh về rô-bốt';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A bible whose 4 scenes are: forest, forest, meadow, forest (the film returns to the forest). */
function bible4(): StoryBible {
  const b = buildLocalStoryBible(PROMPT, { sceneCount: 4, kind: 'film' });
  const biomes = ['forest', 'forest', 'meadow', 'forest'];
  b.beats = b.beats.map((x, i) => ({ ...x, biome: biomes[i], setting: `place ${i + 1}` }));
  return b;
}

/** Four scenes, each dressed by its own beat's biome but with a different sky each time (what independent authoring does). */
function scenes4(bible: StoryBible): SceneSpec[] {
  const intent = detectStoryboardIntent(PROMPT)!;
  const plan = buildLocalStoryboardPlan(PROMPT, intent);
  return plan.beats.slice(0, 4).map((_, i) => {
    const s = buildLocalSceneForBeat(PROMPT, plan, i);
    const dressed = applyBiomeToScene(s, bible.beats[i].biome as any);
    dressed.world = { ...dressed.world, skybox: i === 1 ? 'night-stars' as const : dressed.world.skybox, scatterObjects: dressed.world.scatterObjects.map((l) => ({ ...l, count: l.count + i })) };
    dressed.sequence = { storyboardId: 'sb', storyboardTitle: 't', kind: 'film', index: i, total: 4, bible };
    dressed.mode = 'media';
    dressed.engineType = '3d';
    return dressed;
  });
}

test('a bible with biomes but no locations gets one location per biome, and the beats point at them', () => {
  const { bible, fixes } = autoFixStoryBible(bible4(), 4);
  assert.deepEqual(bible.locations!.map((l) => l.id), ['loc-forest', 'loc-meadow']);
  assert.deepEqual(bible.beats.map((b) => b.location), ['loc-forest', 'loc-forest', 'loc-meadow', 'loc-forest']);
  assert.ok(fixes.some((f) => /location/.test(f)));
});

test('a bible without any biome has no locations (nothing to share)', () => {
  const { bible } = autoFixStoryBible(buildLocalStoryBible(PROMPT, { sceneCount: 3, kind: 'film' }), 3);
  assert.equal(bible.locations, undefined);
});

test('named locations win: a beat takes the biome of its location, unknown references are dropped', () => {
  const raw = {
    ...bible4(),
    locations: [{ id: 'yard', name: 'The yard', setting: 'a sunny yard', biome: 'meadow' }, { id: 'yard', name: 'dup' }],
  };
  raw.beats = raw.beats.map((b, i) => ({ ...b, location: i === 3 ? 'nowhere' : 'yard' }));
  const clean = sanitizeStoryBible(raw, 4)!;
  assert.equal(clean.locations!.length, 1);
  assert.equal(clean.beats[3].location, undefined);
  const { bible } = autoFixStoryBible(clean, 4);
  assert.deepEqual(bible.beats.slice(0, 3).map((b) => [b.location, b.biome]), [['yard', 'meadow'], ['yard', 'meadow'], ['yard', 'meadow']]);
  // beat 4 had an unknown reference but a biome: it joins the location of that biome only when one exists (forest does not)
  assert.equal(bible.beats[3].location, undefined);
});

test('cleanLocations caps and sanitises', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: `Place ${i}`, setting: 'x'.repeat(500), biome: i % 2 ? 'forest' : 'mars' }));
  const out = cleanLocations([...many, null, { name: '' }]);
  assert.equal(out.length, 5);
  assert.equal(out[0].biome, undefined);
  assert.equal(out[1].biome, 'forest');
  assert.ok(out[0].setting.length <= 240);
});

test('deriveLocations returns the bible untouched when there is nothing to derive', () => {
  const b = buildLocalStoryBible(PROMPT, { sceneCount: 3, kind: 'film' });
  assert.equal(deriveLocations(b).bible, b);
});

test('the prompts name the location and tell later scenes to keep the set', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  assert.match(describeBible(bible), /LOCATIONS/);
  assert.match(describeBibleForScene(bible, 0, 4), /Build the set well/);
  assert.match(describeBibleForScene(bible, 1, 4), /Scene 1 already built this place/);
  assert.match(describeBibleForScene(bible, 2, 4), /Build the set well/);
  assert.match(describeBibleForScene(bible, 3, 4), /Scene 1 already built this place/);
});

test('scenes at one location reuse the first scene’s world; other places stay as they are', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  const scenes = scenes4(bible);
  assert.ok(!sameLocation(scenes[0], scenes[1]), 'precondition: authored apart, the two forests differ');
  const { scenes: shared, notes } = shareLocationWorlds(scenes);
  assert.ok(sameLocation(shared[0], shared[1]));
  assert.ok(sameLocation(shared[0], shared[3]));
  assert.deepEqual(shared[1].world.scatterObjects, scenes[0].world.scatterObjects);
  assert.equal(shared[2].world.biome, 'meadow');
  assert.deepEqual(shared[2].world, scenes[2].world, 'the meadow is the only scene there: untouched');
  assert.equal(notes.length, 2);
  assert.match(notes[0], /scene 2 reuses the set of scene 1/);
});

test('sharing keeps the scene’s own weather, clouds, lighting, camera and actors; the input is not mutated', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  const scenes = scenes4(bible);
  scenes[1].world.weather = { type: 'rain', intensity: 0.9 };
  const before = JSON.stringify(scenes);
  const shared = shareLocationWorlds(scenes).scenes;
  assert.equal(JSON.stringify(scenes), before);
  assert.deepEqual(shared[1].world.weather, { type: 'rain', intensity: 0.9 });
  assert.equal(shared[1].environment.presetId, scenes[1].environment.presetId);
  assert.deepEqual(shared[1].camera, scenes[1].camera);
  assert.deepEqual(shared[1].actors, scenes[1].actors);
});

test('already matching scenes come back as the same object, and non-film or location-less scenes are skipped', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  const scenes = scenes4(bible);
  const once = shareLocationWorld([scenes[0]], scenes[1], bible).scene;
  assert.equal(shareLocationWorld([scenes[0], once], once, bible).scene, once);
  assert.equal(shareLocationWorld([scenes[0]], scenes[1], undefined).scene, scenes[1]);
  const game = { ...scenes[1], mode: 'game' as const };
  assert.equal(shareLocationWorld([scenes[0]], game, bible).scene, game);
  assert.equal(locationOf(scenes[0], undefined), undefined);
});

test('dressAs copies the place, not the clouds', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  const scenes = scenes4(bible);
  const out = dressAs(scenes[0], scenes[2]);
  assert.equal(out.world.biome, 'forest');
  assert.deepEqual(out.world.clouds, scenes[2].world.clouds);
  out.world.scatterObjects[0].count = 999;
  assert.notEqual(scenes[0].world.scatterObjects[0].count, 999, 'copied by value');
});

test('the film editor shares locations first, so characters then carry between the scenes', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  const scenes = scenes4(bible);
  const r = editFilm(scenes);
  assert.ok(r.fixes.some((f) => /^Location: scene 2 reuses/.test(f)), r.fixes.join('\n'));
  assert.ok(sameLocation(r.scenes[0], r.scenes[1]));
});

test('the Writers’ Room keeps locations through a user edit and the world desk owns them', () => {
  const session = createRoomSession({ prompt: PROMPT, intent: { sceneCount: 4, kind: 'film' } });
  const edited = applyUserEdit(session, 'world', bible4());
  assert.equal(edited.bible.locations!.length, 2);
  assert.ok(!edited.findings.some((f) => f.code === 'room.location-missing'));

  // The world desk's JSON can name places and point beats at them.
  const raw = {
    locations: [{ id: 'shed', name: 'The shed', setting: 'a leaning shed', biome: 'forest' }],
    beats: edited.bible.beats.map((b) => ({ scene: b.scene, setting: 'in the shed', biome: 'forest', location: 'shed' })),
  };
  const merged = mergeDeskOutput(edited.bible, 'world', raw, 4)!;
  assert.deepEqual(merged.bible.locations!.map((l) => l.id), ['shed']);
  assert.ok(merged.bible.beats.every((b) => b.location === 'shed'));
  // ... and another desk cannot rewrite them
  const arch = mergeDeskOutput(merged.bible, 'architect', { logline: 'A robot wants to cross the forest, but fear stops it, so it must ask a friend.', beats: [], locations: [{ id: 'x', name: 'X' }] }, 4);
  assert.deepEqual((arch?.bible || merged.bible).locations!.map((l) => l.id), ['shed']);
});

test('continuity notes a beat that is at none of the locations', () => {
  const { bible } = autoFixStoryBible(bible4(), 4);
  delete bible.beats[1].location;
  const f = continuityCheck(bible);
  assert.ok(f.some((x) => x.code === 'room.location-missing' && x.desk === 'world' && /Scene 2/.test(x.message)), JSON.stringify(f));
});
