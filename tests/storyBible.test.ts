import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBibleToScene,
  mapGeneratedClip,
  autoFixStoryBible,
  buildLocalStoryBible,
  buildStoryBiblePlannerSection,
  buildStoryBibleSystemPrompt,
  buildStoryBibleUserPrompt,
  castInventory,
  coerceBible,
  describeBibleForScene,
  lintStoryBible,
  pickStoryTemplate,
  sanitizeStoryBible,
  STORY_BIBLE_PASS_SCORE,
  strictClipMatch,
  writeStoryBible,
} from '../src/agent/storyBible';
import {
  buildLocalSceneForBeat,
  buildLocalStoryboardPlan,
  detectStoryboardIntent,
  generateStoryboardWithAgent,
  normalizeGeneratedSceneSpec,
} from '../src/agent/storyboardAgent';
import { buildStoryboardPlannerSystemPrompt, buildStoryboardSceneUserPrompt } from '../src/agent/systemPrompts';
import { DEFAULT_SETTINGS } from '../src/state/storeHelpers';
import type { StoryBible } from '../src/types/scene.schema';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const goodBible = (n = 3, prompt = 'Phim 3 cảnh về rô-bốt') => buildLocalStoryBible(prompt, { sceneCount: n, kind: 'film' });
const codes = (b: StoryBible, n: number) => lintStoryBible(b, n).issues.map((i) => i.code);

test('offline bible passes the rubric for every scene count, kind and language', () => {
  for (const n of [2, 3, 4, 5, 6, 8]) {
    for (const kind of ['film', 'ad-sequence'] as const) {
      for (const prompt of ['Phim hoạt hình về rô-bốt sợ nước', 'A film about a robot who is afraid of water']) {
        const bible = buildLocalStoryBible(prompt, { sceneCount: n, kind });
        const lint = lintStoryBible(bible, n);
        assert.deepEqual(lint.issues.filter((i) => i.severity === 'error'), [], `${kind} ${n} "${prompt}"`);
        assert.ok(lint.score >= STORY_BIBLE_PASS_SCORE, `score ${lint.score} for ${kind} ${n}`);
        assert.equal(bible.beats.length, n);
        assert.ok(bible.hookSeconds <= 3);
      }
    }
  }
});

test('offline bible speaks the prompt language', () => {
  assert.match(goodBible(3, 'Phim về chú rô-bốt').logline, /rô-bốt|Bốp/);
  assert.match(buildLocalStoryBible('A robot film', { sceneCount: 3, kind: 'film' }).logline, /Bolt/);
});

test('rubric flags each story weakness', () => {
  const base = goodBible(3);

  const late = clone(base); late.hookSeconds = 6;
  assert.ok(codes(late, 3).includes('bible.hook-late'));

  const noTurn = clone(base); noTurn.turn = '';
  assert.ok(codes(noTurn, 3).includes('bible.turn'));

  const noStakes = clone(base); noStakes.stakes = '  ';
  assert.ok(codes(noStakes, 3).includes('bible.stakes'));

  const flat = clone(base); flat.beats[1].emotionEnd = flat.beats[1].emotionStart;
  assert.ok(codes(flat, 3).includes('bible.beat-flat'));

  const noPull = clone(base); noPull.beats[0].endsOn = '';
  assert.ok(codes(noPull, 3).includes('bible.beat-no-ending'));

  const unperformable = clone(base); unperformable.characters[0].signatureClip = 'Backflip';
  assert.ok(codes(unperformable, 3).includes('bible.signature-unperformable'));

  const count = clone(base); count.beats.pop();
  assert.ok(codes(count, 3).includes('bible.beats-count'));

  const noMotif = clone(base); delete noMotif.motifs;
  assert.ok(codes(noMotif, 3).includes('bible.no-setup-payoff'));

  const backwards = clone(base); backwards.motifs = [{ what: 'x', setupScene: 3, payoffScene: 1 }];
  assert.ok(codes(backwards, 3).includes('bible.motif-order'));

  const unknown = clone(base); unknown.characters[0].assetId = 'no-such-rig';
  assert.ok(codes(unknown, 3).includes('bible.asset-unknown'));

  const short = clone(base); short.logline = 'A robot wins.';
  assert.ok(codes(short, 3).includes('bible.logline'));

  assert.ok(lintStoryBible(late, 3).score < lintStoryBible(base, 3).score);
});

test('strict clip match never falls back to Idle', () => {
  const clips = ['Idle', 'Walking', 'Wave'];
  assert.equal(strictClipMatch('wave', clips), 'Wave');
  assert.equal(strictClipMatch('Walk', clips), 'Walking');
  assert.equal(strictClipMatch('Backflip', clips), undefined);
  assert.equal(strictClipMatch(undefined, clips), undefined);
});

test('sanitize + autofix repair structure but never invent story', () => {
  const raw = {
    bible: {
      ...goodBible(3),
      hookSeconds: 'abc',
      characters: [
        { actorId: 'hero', assetId: 'not-a-rig', name: 'A', want: 'w', flaw: 'f', manner: 'm', signatureGesture: 'g', signatureClip: 'wave' },
        { actorId: 'hero', assetId: 'gltf-fox', name: 'B', want: 'w', flaw: 'f', manner: 'm', signatureGesture: 'g', signatureClip: 'run' },
      ],
      beats: [...goodBible(3).beats, { ...goodBible(3).beats[0], scene: 9 }],
    },
  };
  const clean = sanitizeStoryBible(raw, 3)!;
  assert.equal(clean.beats.length, 3, 'extra beats are dropped');
  assert.deepEqual(clean.beats.map((b) => b.scene), [1, 2, 3]);
  const { bible, fixes } = autoFixStoryBible(clean, 3);
  assert.ok(fixes.length >= 2);
  assert.notEqual(bible.characters[0].assetId, 'not-a-rig');
  assert.equal(new Set(bible.characters.map((c) => c.actorId)).size, 2, 'duplicate actor ids renamed');
  assert.equal(bible.characters[1].signatureClip, 'Run', 'clip spelled like the rig');
  assert.ok(Number.isFinite(bible.hookSeconds));
  assert.equal(sanitizeStoryBible({ nope: true }, 3), null);
  assert.equal(coerceBible('junk', 3), undefined);
  assert.ok(coerceBible(goodBible(3), 3));
});

test('cast inventory lists real clips the writer is told about', () => {
  const cast = castInventory();
  assert.ok(cast.length >= 3);
  const robot = cast.find((c) => c.assetId === 'gltf-robot-expressive')!;
  assert.ok(robot.clips.includes('Wave'));
  assert.equal(cast[0].assetId, robot.assetId, 'richest rig first');
  const prompt = buildStoryBibleSystemPrompt(4);
  assert.match(prompt, /gltf-robot-expressive/);
  assert.match(prompt, /Wave/);
  assert.match(prompt, /EXACTLY 4/);
  assert.match(prompt, /HOOK/);
});

test('template picker follows the prompt, ads and scene count', () => {
  assert.equal(pickStoryTemplate('Quảng cáo nước uống', 'ad-sequence', 3), 'story-ad');
  assert.equal(pickStoryTemplate('phim hài về chú mèo', 'film', 3), 'visual-gag');
  assert.equal(pickStoryTemplate('Phim về tình bạn', 'film', 3), 'meet-cute');
  assert.equal(pickStoryTemplate('A mystery about a secret door', 'film', 4), 'reveal-twist');
  assert.equal(pickStoryTemplate('a robot walks', 'film', 2), 'visual-gag');
  assert.equal(pickStoryTemplate('a robot walks', 'film', 5), 'mini-journey');
  assert.equal(pickStoryTemplate('Làm phim hai cảnh', 'film', 2), 'visual-gag', '"hai" (two) is not a trigger');
});

test('writeStoryBible: good draft = one call; weak draft gets exactly one revise round', async () => {
  const calls: any[] = [];
  const good = await writeStoryBible({
    prompt: 'A robot film',
    intent: { sceneCount: 3, kind: 'film' },
    ask: async (req) => { calls.push(req); return goodBible(3, 'A robot film'); },
  });
  assert.equal(good.source, 'ai');
  assert.equal(calls.length, 1);

  const weak = goodBible(3, 'A robot film'); weak.turn = ''; weak.stakes = ''; weak.payoff = ''; weak.hook = '';
  const seen: any[] = [];
  const revised = await writeStoryBible({
    prompt: 'A robot film',
    intent: { sceneCount: 3, kind: 'film' },
    ask: async (req) => { seen.push(req); return seen.length === 1 ? weak : goodBible(3, 'A robot film'); },
  });
  assert.equal(seen.length, 2);
  assert.ok(seen[1].draft && seen[1].findings.length >= 4, 'revise round carries the draft and the findings');
  assert.equal(revised.source, 'ai');
  assert.ok(revised.lint.score >= STORY_BIBLE_PASS_SCORE);
  assert.ok(revised.notes.some((n) => /revise round/.test(n)));
});

test('writeStoryBible: failures and hopeless drafts fall back to the offline bible', async () => {
  const thrown = await writeStoryBible({ prompt: 'x', intent: { sceneCount: 3, kind: 'film' }, ask: async () => { throw new Error('503'); } });
  assert.equal(thrown.source, 'local');
  assert.ok(thrown.lint.score >= STORY_BIBLE_PASS_SCORE);

  const junk = await writeStoryBible({ prompt: 'x', intent: { sceneCount: 3, kind: 'film' }, ask: async () => ({ hello: 'world' }) });
  assert.equal(junk.source, 'local');

  const hopeless = { logline: 'short', characters: [], beats: [] };
  const bad = await writeStoryBible({ prompt: 'x', intent: { sceneCount: 3, kind: 'film' }, ask: async () => hopeless });
  assert.equal(bad.source, 'local');
});

test('prompts carry the bible to the planner and to every scene author', () => {
  const bible = goodBible(3);
  const planner = buildStoryboardPlannerSystemPrompt(undefined, bible);
  assert.match(planner, /SCREENWRITER/);
  assert.match(planner, /PLAN RULES FROM THE BIBLE/);
  assert.ok(planner.includes(bible.logline));
  assert.doesNotMatch(buildStoryboardPlannerSystemPrompt(), /STORY BIBLE/);
  assert.match(buildStoryBiblePlannerSection(bible), /HOOK|hook/i);

  const beat = { title: 't', description: 'd', engineType: '3d', mode: 'media', beat: 'b' };
  const first = buildStoryboardSceneUserPrompt({ prompt: 'p', storyboardTitle: 'T', kind: 'film', beatIndex: 0, total: 3, beat, previousScenes: [], bible });
  assert.match(first, /THIS SCENE \(1 of 3\)/);
  assert.match(first, /FIRST scene: the hook/);
  const last = buildStoryboardSceneUserPrompt({ prompt: 'p', storyboardTitle: 'T', kind: 'film', beatIndex: 2, total: 3, beat, previousScenes: [], bible });
  assert.match(last, /LAST scene/);
  assert.match(last, /pay it off now/);
  assert.match(describeBibleForScene(bible, 0, 3), /plant it visibly now/);
  const without = buildStoryboardSceneUserPrompt({ prompt: 'p', storyboardTitle: 'T', kind: 'film', beatIndex: 0, total: 3, beat, previousScenes: [] });
  assert.doesNotMatch(without, /STORY BIBLE/);
  assert.match(buildStoryBibleUserPrompt({ prompt: 'p', sceneCount: 3, kind: 'film', template: 'visual-gag', draft: bible, findings: [{ code: 'bible.turn', severity: 'error', message: 'no turn' }] }), /REJECTED/);
});

test('applyBibleToScene gives bible characters their voice pitch without overriding the model', () => {
  const bible = goodBible(3);
  const spec = normalizeGeneratedSceneSpec(
    { engineType: '3d', mode: 'media', actors: [{ id: 'hero', assetId: 'gltf-robot-expressive' }, { id: 'x', assetId: 'gltf-fox', voice: { pitch: 6 } }] },
    '3d'
  );
  const out = applyBibleToScene(spec, bible);
  assert.equal(out.actors.find((a) => a.id === 'hero')!.voice?.pitch, bible.characters[0].pitch);
  assert.equal(out.actors.find((a) => a.id === 'x')!.voice?.pitch, 6, 'an explicit pitch is kept');
  assert.equal(applyBibleToScene(spec, undefined), spec);
});

test('storyboard pipeline: bible is requested, sent to the planner and scenes, and stored on every scene', async () => {
  const realFetch = globalThis.fetch;
  const prompt = 'Làm phim hoạt hình 3 cảnh về rô-bốt';
  const intent = detectStoryboardIntent(prompt)!;
  const localPlan = buildLocalStoryboardPlan(prompt, intent);
  const bible = goodBible(3, prompt);
  const bodies: Record<string, any[]> = {};
  globalThis.fetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    (bodies[url] ||= []).push(body);
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.endsWith('/storyboard/bible')) return json(bible);
    if (url.endsWith('/storyboard/plan')) return json(localPlan);
    if (url.endsWith('/storyboard/scene')) return json({ sceneSpec: buildLocalSceneForBeat(prompt, localPlan, body.beatIndex) });
    return new Response('{}', { status: 503 });
  }) as typeof fetch;
  try {
    const result = await generateStoryboardWithAgent(prompt, intent, { ...DEFAULT_SETTINGS, directorQA: false });
    assert.equal(bodies['/api/agent/storyboard/bible'].length, 1);
    assert.equal(bodies['/api/agent/storyboard/plan'][0].bible.logline, bible.logline);
    const sceneCalls = bodies['/api/agent/storyboard/scene'];
    assert.equal(sceneCalls.length, 3);
    assert.ok(sceneCalls.every((c) => c.bible?.logline === bible.logline), 'every scene author gets the bible');
    assert.ok(sceneCalls[1].previousScenes[0].dialogue?.length > 0, 'earlier dialogue is part of the continuity summary');
    assert.ok(result.bible);
    assert.ok((result.bibleScore ?? 0) >= STORY_BIBLE_PASS_SCORE);
    assert.ok(result.scenes.every((s) => s.sequence?.bible?.logline === bible.logline));
    assert.match(result.assistantMessage, /^Story:/);
    assert.ok(result.diffSummary.some((l) => l.startsWith('Story:')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('offline pipeline attaches no bible (the offline scenes would not match a placeholder story)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
  try {
    const prompt = 'Phim 3 cảnh về rô-bốt';
    const result = await generateStoryboardWithAgent(prompt, detectStoryboardIntent(prompt)!, { ...DEFAULT_SETTINGS, directorQA: false });
    assert.equal(result.bible, undefined);
    assert.ok(result.scenes.every((s) => !s.sequence?.bible));
    assert.equal(result.source, 'local');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('game levels skip the story editor', async () => {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => { urls.push(url); return new Response('{}', { status: 503 }); }) as typeof fetch;
  try {
    const prompt = 'game 2D 3 màn platformer';
    await generateStoryboardWithAgent(prompt, detectStoryboardIntent(prompt)!, { ...DEFAULT_SETTINGS, directorQA: false });
    assert.ok(!urls.some((u) => u.endsWith('/bible')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('generated character models replace the stand-in rig in the authored scene, with clips mapped to what the model has', () => {
  const bible = goodBible(3);
  const hero = bible.characters[0];
  hero.generated = { provider: 'meshy', clips: ['walking', 'running'], modelUrl: '/api/library/file/personal/abc', libraryAssetId: 'abc' };
  const spec: any = {
    actors: [{
      id: hero.actorId, name: hero.name, assetId: hero.assetId, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], primaryColor: '#fff',
      activeAnimation: 'none', physicsRole: 'none', onClickAction: 'none', activeClip: 'Idle', availableClips: ['Idle', 'Walk', 'Run'],
      performance: [{ time: 0, clip: 'Walk', arriveClip: 'Idle', moveTo: [1, 0, 0] }, { time: 2, clip: 'Run' }, { time: 3, animation: 'bounce' }],
    }],
  };
  const out: any = applyBibleToScene(spec, bible);
  const a = out.actors[0];
  assert.equal(a.modelUrl, '/api/library/file/personal/abc');
  assert.equal(a.customGlbUrl, a.modelUrl);
  assert.deepEqual(a.availableClips, ['walking', 'running']);
  assert.equal(a.assetId, hero.assetId, 'the stand-in id stays so the verifier and offline director keep working');
  assert.deepEqual(a.performance.map((p: any) => p.clip), ['walking', 'running', undefined]);
  assert.equal(a.performance[0].arriveClip, 'walking', 'Idle falls back to a clip the model has');
  assert.equal(a.performance[2].animation, 'bounce');
  assert.equal(a.activeClip, 'walking');
  assert.equal(applyBibleToScene(out, bible), out, 'idempotent');
  assert.equal(spec.actors[0].modelUrl, undefined, 'the input scene is not mutated');
});

test('a character without a generated model is left alone, and a static model drops clip requests', () => {
  const bible = goodBible(3);
  const hero = bible.characters[0];
  const spec: any = { actors: [{ id: hero.actorId, name: 'H', assetId: hero.assetId, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], primaryColor: '#fff', activeAnimation: 'none', physicsRole: 'none', onClickAction: 'none', performance: [{ time: 0, clip: 'Walk' }] }] };
  assert.equal((applyBibleToScene(spec, bible) as any).actors[0].modelUrl, undefined);
  hero.generated = { provider: 'meshy', clips: [], modelUrl: '/x' };
  const out: any = applyBibleToScene(spec, bible);
  assert.equal(out.actors[0].availableClips, undefined);
  assert.equal(out.actors[0].performance[0].clip, undefined);
  assert.equal(mapGeneratedClip('Walk', ['walking', 'running']), 'walking');
  assert.equal(mapGeneratedClip('sprint', ['walking', 'running']), 'running');
  assert.equal(mapGeneratedClip('Wave', ['walking']), 'walking');
  assert.equal(mapGeneratedClip('Walk', []), undefined);
});
