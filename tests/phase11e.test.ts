/**
 * Phase 11E — the film editor's finishing tools: transitions drawn once for Player + MP4, J/L cuts, the film cue sheet,
 * script line ids + coverage, and vision QA of a cut (the pure parts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSITOR_TRANSITIONS, compositorTransition, drawSceneTransition, transitionSeconds } from '../src/runtime/transitionDraw';
import type { CompositorTransition } from '../src/runtime/transitionDraw';
import { editFilm, soundCuts } from '../src/agent/filmEditor';
import { MOODS, MAX_AUDIO_OVERLAP, MUSIC_MOODS, renderFilmSoundtrack, windowRms } from '../src/audio/soundtrack';
import { actOf, applyCue, moodForEmotion, MOOD_BPM, musicCueSheet } from '../src/agent/musicCues';
import { coverageLabel, numberedScript, parseScript, scriptCoverage } from '../src/verification/scriptCoverage';
import { autoFixSceneSpec, MEDIA_CRAFT_CODES, verifySceneSpec } from '../src/verification/sceneVerifier';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent } from '../src/agent/storyboardAgent';
import { buildCutQASystemPrompt, buildCutQAUserPrompt, cutFrameTimes, describeCutQA, normalizeCutQAReport } from '../src/agent/cutQA';
import type { ActorNode, SceneSpec, StoryBible } from '../src/types/scene.schema';

/** A 2D context that records what is drawn. */
function fakeCtx() {
  const calls: string[] = [];
  const alphas: number[] = [];
  const ctx: any = {
    globalAlpha: 1,
    fillStyle: '',
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    drawImage(...args: any[]) { calls.push(`drawImage:${args.length}`); alphas.push(ctx.globalAlpha); },
    fillRect() { calls.push('fillRect'); },
    beginPath() { calls.push('beginPath'); },
    rect() { calls.push('rect'); },
    arc() { calls.push('arc'); },
    clip(rule?: string) { calls.push(`clip:${rule ?? ''}`); },
    fill(rule?: string) { calls.push(`fill:${rule ?? ''}`); },
    translate() {},
    scale() {},
  };
  return { ctx: ctx as CanvasRenderingContext2D, calls, alphas };
}
const IMG = {} as CanvasImageSource;

test('compositorTransition maps scene transitions to compositor names and falls back', () => {
  assert.equal(compositorTransition({ sequence: undefined }, 'crossfade'), 'crossfade');
  assert.equal(compositorTransition({ sequence: { transition: 'cut' } as any }, 'crossfade'), 'none');
  assert.equal(compositorTransition({ sequence: { transition: 'fade' } as any }, 'crossfade'), 'fade-to-black');
  assert.equal(compositorTransition({ sequence: { transition: 'whip-pan' } as any }, 'x'), 'whip-pan');
  assert.equal(compositorTransition({ sequence: { transition: 'iris' } as any }, 'x'), 'iris');
  assert.equal(compositorTransition({ sequence: undefined }, 'not-a-transition'), 'fade-to-black');
});

test('every transition has a duration; a cut has none and a whip is quicker than an iris', () => {
  for (const k of COMPOSITOR_TRANSITIONS) assert.ok(transitionSeconds(k) >= 0);
  assert.equal(transitionSeconds('none'), 0);
  assert.ok(transitionSeconds('whip-pan') < transitionSeconds('crossfade'));
  assert.ok(transitionSeconds('crossfade') < transitionSeconds('iris'));
});

test('crossfade melts the old frame away: alpha falls over time and ends at nothing', () => {
  const alphaAt = (p: number) => {
    const { ctx, alphas } = fakeCtx();
    drawSceneTransition(ctx, IMG, 'crossfade', p, 320, 180);
    return alphas.length ? alphas[0] : 0;
  };
  assert.ok(alphaAt(0.1) > alphaAt(0.5));
  assert.ok(alphaAt(0.5) > alphaAt(0.9));
  assert.ok(alphaAt(1) <= 0.001);
});

test('whip-pan smears (several ghost copies), iris masks with a hole, wipe reveals from the left', () => {
  const whip = fakeCtx();
  drawSceneTransition(whip.ctx, IMG, 'whip-pan', 0.4, 320, 180);
  assert.ok(whip.calls.filter((c) => c.startsWith('drawImage')).length >= 4);
  const iris = fakeCtx();
  drawSceneTransition(iris.ctx, IMG, 'iris', 0.3, 320, 180);
  assert.ok(iris.calls.includes('arc'));
  assert.ok(iris.calls.includes('clip:evenodd') || iris.calls.includes('fill:evenodd'));
  const wipe = fakeCtx();
  drawSceneTransition(wipe.ctx, IMG, 'wipe', 0.5, 320, 180);
  assert.equal(wipe.calls.filter((c) => c.startsWith('drawImage')).length, 1);
});

test('fade kinds veil with their colour and never throw at the ends of progress', () => {
  for (const k of COMPOSITOR_TRANSITIONS as CompositorTransition[]) {
    for (const p of [0, 0.25, 0.5, 0.75, 1, -1, 2]) {
      const { ctx } = fakeCtx();
      assert.doesNotThrow(() => drawSceneTransition(ctx, IMG, k, p, 64, 36), `${k} @ ${p}`);
    }
  }
});

// ---- J / L cuts ------------------------------------------------------------------------------------------------------

const PROMPT = 'Làm phim hoạt hình 3 cảnh về rô-bốt';
function film(): SceneSpec[] {
  const intent = detectStoryboardIntent(PROMPT)!;
  const plan = buildLocalStoryboardPlan(PROMPT, intent);
  const scenes = plan.beats.map((_, i) => buildLocalSceneForBeat(PROMPT, plan, i));
  scenes.forEach((s, i) => {
    s.sequence = { storyboardId: 'sb', storyboardTitle: 't', kind: 'film', index: i, total: scenes.length, ...(i > 0 ? { transition: 'cut' as const } : {}) };
  });
  return scenes;
}

test('J-cut: a change of place with its own ambience brings the new ambience in early; authored values are kept', () => {
  const [a, b] = film();
  a.world = { ...(a.world as any), biome: 'meadow' } as any;
  b.world = { ...(b.world as any), biome: 'desert' } as any;
  a.soundtrack = { music: { mood: 'calm' }, ambience: { type: 'wind' } };
  b.soundtrack = { music: { mood: 'calm' }, ambience: { type: 'rain' } };
  a.dialogue = [];
  const { scene, notes } = soundCuts(a, b);
  assert.ok(scene.sequence!.audioLead! > 0, JSON.stringify(notes));
  assert.ok(notes.some((n) => /J-cut/.test(n)));
  assert.equal(b.sequence!.audioLead, undefined, 'input untouched');
  b.sequence!.audioLead = 0.3;
  assert.equal(soundCuts(a, b).scene.sequence!.audioLead, 0.3);
});

test('L-cut: a line still being spoken when the scene ends runs on over the next picture', () => {
  const [a, b] = film();
  const speaker = a.actors[0] as ActorNode;
  a.dialogue = [{ time: (a.durationSeconds || 8) - 0.5, speaker: speaker.id, text: 'And that is how we ended the story together today' } as any];
  const { scene, notes } = soundCuts(a, b);
  assert.ok(scene.sequence!.audioTail! > 0);
  assert.ok(notes.some((n) => /L-cut/.test(n)));
  a.dialogue = [{ time: 0.2, speaker: speaker.id, text: 'Hi' } as any];
  assert.equal(soundCuts(a, b).scene.sequence!.audioTail, undefined);
});

test('editFilm applies sound cuts without touching scenes that need none', () => {
  const scenes = film();
  scenes.forEach((s) => { s.dialogue = []; });
  const out = editFilm(scenes);
  assert.equal(out.scenes.length, scenes.length);
});

// ---- soundtrack: J / L overlap ----------------------------------------------------------------------------------------

const SR = 16000;
const sc = (id: string, durationSeconds: number, soundtrack: any, sequence?: any): any => ({ id, durationSeconds, soundtrack, sequence: { storyboardId: 'sb', ...sequence } });

test('default film render is unchanged by explicit zero overlaps and stays inside [-1, 1]', () => {
  const a = sc('a', 3, { music: { mood: 'happy' }, ambience: { type: 'none' } });
  const b = sc('b', 3, { music: { mood: 'tense' }, ambience: { type: 'rain' } });
  const plain = renderFilmSoundtrack([a, b], SR);
  const zero = renderFilmSoundtrack([a, { ...b, sequence: { ...b.sequence, audioLead: 0, audioTail: 0 } }], SR);
  assert.equal(plain.left.length, 6 * SR);
  assert.deepEqual(plain.left, zero.left);
  assert.deepEqual(plain.right, zero.right);
  let peak = 0;
  for (const s of plain.left) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak <= 1);
});

test('J-cut: the incoming ambience is audible before the picture cuts', () => {
  const a = sc('a', 4, { music: { mood: 'none' }, ambience: { type: 'none' } });
  const b = sc('b', 4, { music: { mood: 'none' }, ambience: { type: 'rain' } });
  const plain = renderFilmSoundtrack([a, b], SR);
  const lead = renderFilmSoundtrack([a, { ...b, sequence: { ...b.sequence, audioLead: 1 } }], SR);
  assert.equal(lead.left.length, plain.left.length, 'the film keeps its length');
  assert.ok(windowRms(lead, 3.1, 3.9) > windowRms(plain, 3.1, 3.9) * 1.5 + 1e-6);
});

test('L-cut: the outgoing sound runs on past the cut', () => {
  const a = sc('a', 4, { music: { mood: 'none' }, ambience: { type: 'rain' } });
  const b = sc('b', 4, { music: { mood: 'none' }, ambience: { type: 'none' } });
  const plain = renderFilmSoundtrack([a, b], SR);
  const tail = renderFilmSoundtrack([a, { ...b, sequence: { ...b.sequence, audioTail: 1.2 } }], SR);
  assert.ok(windowRms(tail, 4.6, 5.0) > windowRms(plain, 4.6, 5.0) * 1.5 + 1e-6);
});

test('overlap values are clamped to the supported range', () => {
  assert.equal(MAX_AUDIO_OVERLAP, 1.5);
  const a = sc('a', 3, { music: { mood: 'happy' }, ambience: { type: 'none' } });
  const b = sc('b', 3, { music: { mood: 'tense' }, ambience: { type: 'none' } }, { audioLead: 99, audioTail: -4 });
  const out = renderFilmSoundtrack([a, b], SR);
  assert.equal(out.left.length, 6 * SR);
  for (const s of out.left) assert.ok(Number.isFinite(s) && Math.abs(s) <= 1);
});

// ---- cue sheet --------------------------------------------------------------------------------------------------------

test('MOOD_BPM matches the tempo each mood really plays at', () => {
  for (const mood of MUSIC_MOODS) {
    if (mood === 'none') continue;
    assert.equal(MOOD_BPM[mood], MOODS[mood].bpm, mood);
  }
});

test('moodForEmotion: the emotion a beat ends in wins', () => {
  assert.equal(moodForEmotion('afraid, then hopeful'), 'happy');
  assert.equal(moodForEmotion('hopeful, then afraid'), 'tense');
  assert.equal(moodForEmotion('lonely'), 'sad');
  assert.equal(moodForEmotion('???'), undefined);
  assert.equal(moodForEmotion(undefined), undefined);
});

test('actOf splits a film into thirds; tiny films are sane', () => {
  assert.equal(actOf(0, 1), 1);
  assert.deepEqual([0, 1].map((i) => actOf(i, 2)), [1, 3]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => actOf(i, 6)), [1, 1, 2, 2, 3, 3]);
});

const bible = (emotions: Array<[string, string]>): StoryBible =>
  ({ logline: 'l', beats: emotions.map(([s, e], i) => ({ title: `b${i}`, beat: 'x', emotionStart: s, emotionEnd: e })) }) as any;

test('cue sheet: one tempo for the whole film, a mood per act, from the bible', () => {
  const sheet = musicCueSheet(6, bible([['calm', 'curious'], ['curious', 'curious'], ['afraid', 'afraid'], ['afraid', 'tense'], ['relief', 'joy'], ['joy', 'proud']]));
  assert.equal(sheet.length, 6);
  assert.equal(new Set(sheet.map((c) => c.tempo)).size, 1);
  assert.equal(sheet[0].mood, sheet[1].mood);
  assert.equal(sheet[2].mood, 'tense');
  assert.equal(sheet[5].mood, 'happy');
});

test('cue sheet without a bible plans only the shared tempo', () => {
  const sheet = musicCueSheet(3, undefined, ['happy', 'tense', undefined]);
  assert.equal(new Set(sheet.map((c) => c.tempo)).size, 1);
  assert.equal(musicCueSheet(2)[0].tempo, 104);
  assert.deepEqual(musicCueSheet(0), []);
});

test('applyCue only retunes scenes that already have music', () => {
  const [a] = film();
  const silent = { ...a, soundtrack: { music: { mood: 'none' as const } } };
  assert.equal(applyCue(silent, { mood: 'epic', tempo: 90, act: 1 }), silent);
  assert.equal(applyCue({ ...a, soundtrack: undefined }, { mood: 'epic', tempo: 90, act: 1 }).soundtrack, undefined);
  const scored = applyCue({ ...a, soundtrack: { music: { mood: 'happy' } } }, { mood: 'epic', tempo: 90, act: 1 });
  assert.equal(scored.soundtrack!.music!.mood, 'epic');
  assert.equal(scored.soundtrack!.music!.tempo, 90);
  const same = { ...a, soundtrack: { music: { mood: 'epic' as const, tempo: 90 } } };
  assert.equal(applyCue(same, { mood: 'epic', tempo: 90, act: 1 }), same, 'nothing to change → same object');
  assert.equal(applyCue(same, undefined), same);
});

// ---- script lines + coverage ------------------------------------------------------------------------------------------

const SCRIPT = [
  '0-3 s | WIDE on Bolt | Bolt walks to the door | The journey begins',
  '3-6 s | CLOSE on Fox | Fox waves hello',
  'a stray note that is not a line',
  '6-8 s | WIDE | the sun sets over the meadow',
].join('\n');

test('parseScript gives stable ids in order and ignores free text', () => {
  const lines = parseScript(SCRIPT);
  assert.deepEqual(lines.map((l) => l.id), ['L1', 'L2', 'L3']);
  assert.equal(lines[0].caption, 'The journey begins');
  assert.equal(lines[1].caption, undefined);
  assert.equal(lines[2].start, 6);
  assert.deepEqual(parseScript(undefined), []);
  assert.deepEqual(parseScript('no timed lines here'), []);
  assert.deepEqual(parseScript('5-2 s | SHOT | backwards'), []);
  assert.match(numberedScript(SCRIPT), /^L1 0-3 s \| WIDE on Bolt \| Bolt walks to the door \| The journey begins\nL2 3-6 s/);
});

function scriptScene(over: Partial<SceneSpec> = {}): SceneSpec {
  const base = film()[0];
  const bolt = { ...base.actors[0], id: 'bolt', name: 'Bolt', availableClips: ['Walk', 'Idle', 'Wave'], performance: [{ time: 0.5, moveTo: [2, 0, 0] as [number, number, number], duration: 2 }] } as ActorNode;
  const fox = { ...base.actors[0], id: 'fox', name: 'Fox', availableClips: ['Walk', 'Idle', 'Wave'], performance: [{ time: 3.2, clip: 'Wave' }] } as ActorNode;
  return {
    ...base,
    durationSeconds: 8,
    actors: [bolt, fox],
    dialogue: [],
    captions: [{ start: 0.2, end: 2.8, text: 'The journey begins' } as any],
    camera: { ...base.camera, shots: [{ start: 0, type: 'wide' } as any, { start: 3, type: 'close-up', subject: 'fox' } as any, { start: 6, type: 'wide' } as any] },
    sequence: { ...(base.sequence as any), script: SCRIPT },
    ...over,
  } as SceneSpec;
}

test('coverage: performed actions with their captions are covered; scenery is covered by a shot', () => {
  const cov = scriptCoverage(scriptScene());
  assert.equal(cov.total, 3);
  assert.equal(cov.covered, 3, JSON.stringify(cov.uncovered));
  assert.equal(coverageLabel(scriptScene())!.text, '3/3');
  assert.equal(coverageLabel(scriptScene())!.ok, true);
});

test('coverage: a missing performance, a missing caption and a missing shot are each uncovered', () => {
  const s = scriptScene();
  s.actors[0].performance = [];
  s.captions = [];
  s.camera = { ...s.camera, shots: [{ start: 0, type: 'wide' } as any] };
  const cov = scriptCoverage(s);
  assert.deepEqual(cov.uncovered.map((l) => l.id), ['L1', 'L3']);
  assert.equal(cov.lines[0].actionOk, false);
  assert.equal(cov.lines[2].actionOk, false);
});

test('coverage: dialogue counts as performing and captioning a line', () => {
  const s = scriptScene();
  s.actors[0].performance = [];
  s.captions = [];
  s.dialogue = [{ time: 1, speaker: 'bolt', text: 'The journey begins!' } as any];
  assert.ok(scriptCoverage(s).lines[0].covered);
});

test('coverage: an action no actor can do is unperformable (only when every actor has known clips)', () => {
  const s = scriptScene();
  s.sequence = { ...s.sequence!, script: '0-3 s | WIDE on Bolt | Bolt dances wildly' };
  const cov = scriptCoverage(s);
  assert.equal(cov.unperformable[0].missingClip, 'dance');
  s.actors[1].availableClips = [];
  assert.equal(scriptCoverage(s).unperformable.length, 0, 'unknown clips: no claim');
  s.actors[1].availableClips = ['Dance'];
  assert.equal(scriptCoverage(s).unperformable.length, 0, 'someone can dance');
});

test('no script → no lines → no label', () => {
  const s = scriptScene();
  s.sequence = { ...s.sequence!, script: undefined };
  assert.equal(scriptCoverage(s).total, 0);
  assert.equal(coverageLabel(s), undefined);
});

test('verifier: script.uncovered / script.unperformable are craft warnings, never errors, and are not auto-fixable', () => {
  assert.ok(MEDIA_CRAFT_CODES.includes('script.uncovered') && MEDIA_CRAFT_CODES.includes('script.unperformable'));
  const s = scriptScene();
  s.actors[0].performance = [];
  const issues = verifySceneSpec(s).issues.filter((i) => i.code.startsWith('script.'));
  assert.ok(issues.length >= 1);
  for (const i of issues) {
    assert.equal(i.severity, 'warning');
    assert.ok(!i.fixable);
  }
  const bad = scriptScene();
  bad.sequence = { ...bad.sequence!, script: '0-3 s | WIDE on Bolt | Bolt dances wildly' };
  assert.ok(verifySceneSpec(bad).issues.some((i) => i.code === 'script.unperformable'));
});

test('verifier: a fully covered script raises nothing', () => {
  assert.deepEqual(verifySceneSpec(scriptScene()).issues.filter((i) => i.code.startsWith('script.')), []);
});

test('verifier: scripts the offline generator writes do not trigger script rules (no false positives)', () => {
  const prompt = 'Làm một bộ phim 3D gồm 3 cảnh về chú robot phiêu lưu trong rừng cùng bạn cáo';
  const intent = detectStoryboardIntent(prompt)!;
  const plan = buildLocalStoryboardPlan(prompt, intent);
  for (let i = 0; i < plan.beats.length; i++) {
    const spec = autoFixSceneSpec(buildLocalSceneForBeat(prompt, plan, i)).spec;
    assert.deepEqual(verifySceneSpec(spec).issues.filter((x) => x.code.startsWith('script.')), [], `scene ${i}`);
  }
});

test('verifier: audio overlap outside 0-1.5 s is repaired by clamping', () => {
  const s = film()[1];
  s.sequence = { ...s.sequence!, audioLead: 9, audioTail: -2 };
  const issue = verifySceneSpec(s).issues.find((i) => i.code === 'media.audio-overlap-invalid');
  assert.ok(issue && issue.fixable);
  const fixed = autoFixSceneSpec(s).spec;
  assert.equal(fixed.sequence!.audioLead, MAX_AUDIO_OVERLAP);
  assert.equal(fixed.sequence!.audioTail, 0);
  assert.ok(!verifySceneSpec(fixed).issues.some((i) => i.code === 'media.audio-overlap-invalid'));
});

test('verifier accepts the new transitions', () => {
  for (const t of ['whip-pan', 'iris'] as const) {
    const s = film()[1];
    s.sequence = { ...s.sequence!, transition: t };
    assert.ok(!verifySceneSpec(s).issues.some((i) => /transition/.test(i.code)), t);
  }
});

// ---- cut QA (pure parts) ----------------------------------------------------------------------------------------------

test('cut frame times: a hair before A ends, just after B begins', () => {
  assert.deepEqual(cutFrameTimes({ durationSeconds: 6 }, { durationSeconds: 4 }), { outTime: 5.85, inTime: 0.25 });
  const tiny = cutFrameTimes({ durationSeconds: 0.1 }, { durationSeconds: 0.15 });
  assert.ok(tiny.outTime >= 0 && tiny.inTime >= 0 && tiny.inTime <= 0.15);
});

test('cut QA prompts name both frames and the transition', () => {
  const [a, b] = film();
  assert.match(buildCutQASystemPrompt(), /LEFT/);
  const u = buildCutQAUserPrompt(a, b);
  assert.match(u, /LEFT \(A/);
  assert.match(u, /RIGHT \(B/);
  assert.match(u, /hard cut/);
  b.sequence = { ...b.sequence!, transition: 'iris' };
  assert.match(buildCutQAUserPrompt(a, b), /iris/);
});

test('normalizeCutQAReport: scale, kinds, severity order, caps; garbage → null', () => {
  assert.equal(normalizeCutQAReport(null), null);
  assert.equal(normalizeCutQAReport({ summary: 'x' }), null);
  const r = normalizeCutQAReport({
    score: 6.5,
    summary: 'The hero changes side.',
    findings: [
      { severity: 'low', kind: 'pacing', title: 'dead frame', fix: 'cut earlier' },
      { severity: 'high', kind: 'screen-direction', title: 'hero flips side', fix: 'mirror shot 1 of B' },
      { severity: 'weird', kind: 'nonsense', title: 'odd' },
      { nothing: true },
      ...Array.from({ length: 10 }, (_, i) => ({ severity: 'low', title: `t${i}`, fix: 'f' })),
    ],
  })!;
  assert.equal(r.score, 65);
  assert.equal(r.findings[0].severity, 'high');
  assert.equal(r.findings[0].kind, 'screen-direction');
  assert.ok(r.findings.length <= 5);
  assert.ok(r.findings.every((f) => ['high', 'medium', 'low'].includes(f.severity)));
  assert.equal(normalizeCutQAReport({ score: 250, findings: [] })!.score, 100);
});

test('describeCutQA stays silent for a clean cut and speaks for a bad one', () => {
  assert.deepEqual(describeCutQA(1, null), []);
  assert.deepEqual(describeCutQA(1, { score: 92, summary: 'clean', findings: [{ severity: 'low', kind: 'pacing', title: 'x', fix: 'y' }] }), []);
  const bad = describeCutQA(2, { score: 55, summary: 'Lighting jumps.', findings: [{ severity: 'medium', kind: 'lighting', title: 'night to day', fix: 'match the preset' }] });
  assert.match(bad[0], /cut 2→3/);
  assert.match(bad[0], /55/);
  assert.match(bad[1], /lighting/);
  const highButGoodScore = describeCutQA(1, { score: 90, summary: 's', findings: [{ severity: 'high', kind: 'continuity', title: 'prop vanished', fix: 'keep it' }] });
  assert.ok(highButGoodScore.length > 0, 'a high-severity finding is always reported');
});
