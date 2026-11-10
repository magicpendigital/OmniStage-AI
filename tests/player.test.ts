import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { createPlayerStore, nextSceneIdFor } from '../src/player/playerStore';
import { generateStandaloneHTMLContent, buildStandalonePlayable } from '../src/exporter/mediaExporter';
import { collectAssetUrls, embedAssets, inlineJSON } from '../src/exporter/playerHtml';
import { analyzePlayableBudget } from '../src/exporter/playableBundle';
import { PLAYER_RUNTIME, PLAYER_RUNTIME_VERSION } from '../src/exporter/generated/playerRuntime';
import type { SceneSpec } from '../src/types/scene.schema';

function gameScene(engine: '2d' | '3d', title: string): SceneSpec {
  const s = createBlankSceneSpec(engine, title);
  s.mode = 'game';
  s.gameRules = { winCondition: 'score-threshold', targetScore: 25, timeLimitSeconds: 30, instructions: '' };
  return s;
}

test('the generated Player runtime is up to date with src/player + src/runtime', async () => {
  // @ts-ignore — plain ESM build script
  const { buildPlayer } = await import('../scripts/build-player.mjs');
  const { hash } = await buildPlayer();
  assert.equal(hash, PLAYER_RUNTIME_VERSION, 'run `npm run build:player` and commit src/exporter/generated/playerRuntime.ts');
});

test('player store runs the same game slice as the studio (score, win, retry, timer)', () => {
  const a = gameScene('2d', 'Level A');
  const store = createPlayerStore([a]);
  const s = store.getState();
  assert.equal(s.isPlaying, true);
  assert.equal(s.gameTimeRemaining, 30);
  s.addGameScore(25, 'Star');
  assert.equal(store.getState().gameScore, 25);
  assert.equal(store.getState().gameWon, true, 'targetScore reached');
  assert.equal(store.getState().gameEnded, true);
  store.getState().resetGameSession();
  assert.equal(store.getState().gameScore, 0);
  assert.equal(store.getState().gameEnded, false);
  store.setState({ isPlaying: true });
  store.getState().advanceTimeline(31);
  assert.equal(store.getState().gameEnded, true, 'timer runs out');
  assert.equal(store.getState().gameWon, false);
});

test('3D collisions use the shared rules: collectible scores, hazard penalises', () => {
  const scene = gameScene('3d', '3D');
  const base = scene.actors[0];
  scene.actors = [
    { ...base, id: 'hero', physicsRole: 'player', onClickAction: 'none', position: [0, 0, 0] },
    { ...base, id: 'gem', physicsRole: 'collectible', onClickAction: 'none', position: [1, 0, 0], scoreValue: 10 },
    { ...base, id: 'spike', physicsRole: 'hazard', onClickAction: 'none', position: [-1, 0, 0] },
  ];
  scene.gameRules.targetScore = 100;
  const store = createPlayerStore([scene]);
  store.getState().handlePlayerCollision('gem');
  assert.equal(store.getState().gameScore, 10);
  assert.notDeepEqual(store.getState().sceneSpec.actors.find((x) => x.id === 'gem')!.position, [1, 0, 0], 'collected gem respawns elsewhere (studio rule)');
  assert.equal(store.getState().burstEffects.length, 1, 'collect burst');
  store.getState().handlePlayerCollision('spike');
  assert.equal(store.getState().gameScore, 0, 'hazard penalty');
  store.getState().movePlayerActor(9, 0);
  assert.equal(store.getState().sceneSpec.actors.find((x) => x.id === 'hero')!.position[0], 5.5, 'arena clamp');
});

test('level progression follows nextSceneId, else bundle order', () => {
  const a = gameScene('2d', 'A');
  const b = gameScene('3d', 'B');
  const c = gameScene('2d', 'C');
  a.sequence = { storyboardId: 's', storyboardTitle: 'S', kind: 'game-levels', index: 0, total: 2, nextSceneId: c.id };
  const store = createPlayerStore([a, b, c], a.id);
  assert.equal(nextSceneIdFor(store.getState()), c.id);
  store.getState().switchScene(b.id);
  assert.equal(store.getState().sceneSpec.title, 'B');
  assert.equal(store.getState().gameTimeRemaining, 30);
  assert.equal(nextSceneIdFor(store.getState()), c.id, 'bundle order after B');
  store.getState().switchScene(c.id);
  assert.equal(nextSceneIdFor(store.getState()), undefined);
});

test('exported HTML: Player runtime inlined, data escaped, offline, compiles', () => {
  const a = gameScene('2d', 'Neon </script> Level');
  a.captions = [{ start: 0, end: 2, text: 'Collect the stars' }];
  const b = gameScene('3d', 'Arena');
  const html = generateStandaloneHTMLContent(a, 'meta', [a, b], { playerRuntimeSource: PLAYER_RUNTIME, showFps: true });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const src of scripts) assert.doesNotThrow(() => new Function(src));
  assert.ok(html.includes('OmniPlayer.createOmniPlayer'));
  assert.ok(html.includes('Neon &lt;/script&gt; Level'), 'title escaped');
  assert.equal((html.match(/<\/script>/g) || []).length, scripts.length + 0, 'no extra </script> from scene data');
  assert.ok(html.includes('id="omniFps"'));
  const budget = analyzePlayableBudget(html, 'meta');
  assert.equal(budget.offlineReady, true);
  assert.equal(budget.withinBudget, true, `HTML is ${budget.htmlBytes} bytes`);
  assert.throws(() => generateStandaloneHTMLContent(a, 'meta', [a]), /playerRuntimeSource/);
});

test('inlineJSON neutralises script breakouts and line separators', () => {
  const s = inlineJSON({ a: '</script><b>', b: `x${String.fromCharCode(0x2028)}y` });
  assert.ok(!s.includes('<'));
  assert.equal(JSON.parse(s).a, '</script><b>');
  assert.equal(new Function(`return ${s}`)().b.length, 3);
});

test('assets are embedded smallest-first within the budget; the rest stay online', async () => {
  const scene = gameScene('3d', 'Models');
  const base = scene.actors[0];
  scene.actors = [
    { ...base, id: 'a', modelUrl: 'https://cdn.test/small.glb' },
    { ...base, id: 'b', modelUrl: 'https://cdn.test/huge.glb' },
    { ...base, id: 'c', modelUrl: 'https://cdn.test/small.glb' },
  ];
  scene.nodes2D = [];
  assert.deepEqual(collectAssetUrls([scene]).sort(), ['https://cdn.test/huge.glb', 'https://cdn.test/small.glb']);
  const sizes: Record<string, number> = { 'https://cdn.test/small.glb': 1000, 'https://cdn.test/huge.glb': 3_000_000 };
  const fetcher = async (url: string) => ({ bytes: new Uint8Array(sizes[url]), contentType: 'model/gltf-binary' });
  const r = await embedAssets(collectAssetUrls([scene]), 1_500_000, fetcher);
  assert.deepEqual(Object.keys(r.assets), ['https://cdn.test/small.glb']);
  assert.match(r.assets['https://cdn.test/small.glb'], /^data:model\/gltf-binary;base64,/);
  assert.equal(r.skipped[0].url, 'https://cdn.test/huge.glb');

  const built = await buildStandalonePlayable(scene, 'meta', [scene], { playerRuntimeSource: PLAYER_RUNTIME, fetcher });
  assert.equal(built.budget.offlineReady, false, 'the huge model is still fetched online');
  assert.ok(built.budget.externalDependencies.includes('https://cdn.test/huge.glb'));
  assert.ok(built.html.includes('data:model/gltf-binary;base64,'));
});
