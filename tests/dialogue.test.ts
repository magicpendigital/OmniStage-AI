/**
 * Phase 10C — dialogue: babble voice, timing, captions, clips (WAV round trip, export assets), talk motion, mixing,
 * verifier, AI normalisation and the offline director.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearVoiceClips, decodeWav, dialogueCaptions, dialogueTimeline, encodeWavMono16, estimateLineDuration, getVoiceClip,
  lineLanguage, registerVoiceAssets, registerVoiceClip, renderBabble, sceneCaptions, syllablesOf, talkLevelAt, voiceClipAssets, voiceFor,
} from '../src/audio/voices';
import { renderSceneSoundtrack, renderSoundtrackLayers, windowRms } from '../src/audio/soundtrack';
import { performedActor } from '../src/runtime/cinematics';
import { ASSET_REGISTRY, createBlankSceneSpec } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent, normalizeGeneratedSceneSpec } from '../src/agent/storyboardAgent';
import { buildAgentSystemPrompt } from '../src/agent/systemPrompts';
import type { ActorNode, DialogueLine, SceneSpec } from '../src/types/scene.schema';

const SR = 16000;

function actor(id: string, assetId: string, x: number): ActorNode {
  const e = ASSET_REGISTRY[assetId];
  return {
    id, name: id, assetId: e.assetId, modelUrl: e.modelUrl, position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    primaryColor: '#fff', activeAnimation: 'idle', activeClip: 'Idle', availableClips: [...(e.embeddedClips || [])],
    physicsRole: 'static', onClickAction: 'none',
  };
}

function talkScene(lines: DialogueLine[], extra: Partial<SceneSpec> = {}): SceneSpec {
  return {
    ...createBlankSceneSpec('3d', 'Talk'), mode: 'media', durationSeconds: 10,
    actors: [actor('robot', 'gltf-robot-expressive', -2), actor('fox', 'gltf-fox', 2)],
    dialogue: lines, ...extra,
  };
}

test('babble voice: Vietnamese syllables and tones, deterministic, length = estimate', () => {
  assert.equal(lineLanguage('Xin chào bạn!'), 'vi');
  assert.equal(lineLanguage('Hello there'), 'en');
  const syl = syllablesOf('Mình đi tìm thác nước nhé?');
  assert.equal(syl.length, 6);
  assert.deepEqual(syl.map((s) => s.tone), ['huyen', 'ngang', 'huyen', 'sac', 'sac', 'sac']);
  const line = { text: 'Ồ, nơi này đẹp quá!', emotion: 'excited' as const };
  const v = voiceFor(undefined, line.text);
  const a = renderBabble(line, v, SR);
  assert.deepEqual(a, renderBabble(line, v, SR));
  assert.equal(a.length, Math.ceil(estimateLineDuration(line, v) * SR));
  assert.ok(a.some((x) => Math.abs(x) > 0.3));
  // characters sound different: the fox is pitched up, a sad line is slower
  assert.ok(voiceFor({ id: 'f', assetId: 'gltf-fox' } as any).pitch > 0);
  assert.ok(estimateLineDuration({ text: 'một hai ba bốn', emotion: 'sad' }, v) > estimateLineDuration({ text: 'một hai ba bốn' }, v));
});

test('timeline, captions and talk levels follow the lines', () => {
  clearVoiceClips();
  const spec = talkScene([
    { id: 'b', time: 4, speaker: 'fox', text: 'Đi thôi!', listener: 'robot' },
    { id: 'a', time: 1, speaker: 'robot', text: 'Bạn có muốn đi cùng mình không?', listener: 'fox' },
    { id: 'x', time: 1, speaker: 'robot', text: '   ' },
  ]);
  const tl = dialogueTimeline(spec);
  assert.deepEqual(tl.map((t) => t.line.id), ['a', 'b']);
  assert.ok(tl[0].end > tl[0].start + 0.5);
  const caps = sceneCaptions(spec);
  assert.equal(caps.length, 2);
  assert.match(caps[0].text, /^robot: Bạn/);
  assert.equal(dialogueCaptions({ ...spec, dialogueCaptions: false }).length, 0);
  assert.ok(talkLevelAt(spec, 'robot', 1.3) > 0);
  assert.equal(talkLevelAt(spec, 'robot', 0.5), 0);
  assert.equal(talkLevelAt(spec, 'fox', 1.3), 0);
  // talk motion + the speaker turns to its listener (robot at x=-2 faces +x towards the fox)
  const during = performedActor(spec.actors[0], spec, 2);
  assert.ok((during.talkLevel || 0) > 0);
  assert.ok(Math.abs(during.rotation[1] - Math.PI / 2) < 0.05, `yaw ${during.rotation[1]}`);
  const after = performedActor(spec.actors[0], spec, 9);
  assert.equal(after.talkLevel, undefined);
  assert.ok(Math.abs(after.rotation[1]) < 0.01);
  // game mode ignores dialogue motion
  assert.equal(performedActor(spec.actors[0], { ...spec, mode: 'game' }, 2), spec.actors[0]);
});

test('generated clips: WAV round trip, export assets, timing from the clip and the pitch', () => {
  clearVoiceClips();
  const data = new Float32Array(SR); // 1 s
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 10) * 0.5;
  const back = decodeWav(encodeWavMono16(data, SR))!;
  assert.equal(back.sampleRate, SR);
  assert.ok(Math.abs(back.data[100] - data[100]) < 1e-3);
  registerVoiceClip('k1', { sampleRate: SR, data });
  const spec = talkScene([{ id: 'a', time: 2, speaker: 'robot', text: 'Xin chào', clip: 'k1' }, { id: 'b', time: 5, speaker: 'fox', text: 'Chào!', clip: 'k1' }]);
  const tl = dialogueTimeline(spec);
  assert.ok(Math.abs(tl[0].end - 3) < 1e-6);
  assert.ok(Math.abs(tl[1].end - tl[1].start - 1 / Math.pow(2, 4 / 12)) < 1e-6, 'the fox clip is pitched up and shorter');
  const assets = voiceClipAssets([spec]);
  assert.deepEqual(Object.keys(assets), ['omni-voice:k1']);
  clearVoiceClips();
  assert.equal(getVoiceClip('k1'), undefined);
  assert.equal(registerVoiceAssets(assets), 1);
  assert.equal(getVoiceClip('k1')!.data.length, SR);
  clearVoiceClips();
});

test('mixing: dialogue is heard on its own and the music ducks under it', () => {
  clearVoiceClips();
  const spec = talkScene([{ id: 'a', time: 2, speaker: 'robot', text: 'Mình là chú robot nhỏ, rất vui được gặp bạn.' }]);
  const voiceOnly = renderSceneSoundtrack(spec, SR)!;
  assert.ok(windowRms(voiceOnly, 2.1, 3) > 0.02);
  assert.ok(windowRms(voiceOnly, 0, 1.9) < 1e-6);
  const withMusic = { ...spec, soundtrack: { music: { mood: 'calm' as const }, ambience: { type: 'none' as const } } };
  const ducked = renderSoundtrackLayers(withMusic, 10 * SR, SR)!;
  const plain = renderSoundtrackLayers({ ...withMusic, dialogue: [] }, 10 * SR, SR)!;
  assert.ok(windowRms(ducked.music, 2.5, 3.5) < windowRms(plain.music, 2.5, 3.5) * 0.7);
  assert.ok(Math.abs(windowRms(ducked.music, 7, 9) - windowRms(plain.music, 7, 9)) < 1e-6);
});

test('verifier: invalid, overlapping and cut-off lines are repaired', () => {
  clearVoiceClips();
  const spec = talkScene([
    { id: 'a', time: 1, speaker: 'robot', text: 'Một câu khá dài để kiểm tra việc chồng lời thoại lên nhau.' },
    { id: 'b', time: 1.5, speaker: 'fox', text: 'Câu thứ hai.' },
    { id: 'c', time: 2, speaker: 'ghost', text: 'Ai đó?' },
    { id: 'd', time: 9.6, speaker: 'fox', text: 'Câu cuối cùng này sẽ bị cắt mất ở cuối cảnh phim.', emotion: 'shouty' as any },
  ]);
  const codes = verifySceneSpec(spec).issues.map((i) => i.code);
  for (const c of ['dialogue.invalid', 'dialogue.overlap', 'dialogue.cut-off']) assert.ok(codes.includes(c), c);
  const fixed = autoFixSceneSpec(spec).spec;
  const after = verifySceneSpec(fixed).issues.map((i) => i.code);
  for (const c of ['dialogue.invalid', 'dialogue.overlap', 'dialogue.cut-off']) assert.ok(!after.includes(c), c);
  assert.ok(!fixed.dialogue!.some((l) => l.speaker === 'ghost'));
  assert.equal(fixed.dialogue!.length, 3);
});

test('AI output keeps dialogue and voices; offline films talk in the prompt language', () => {
  const spec = normalizeGeneratedSceneSpec({
    engineType: '3d', mode: 'media',
    actors: [{ id: 'robot', assetId: 'gltf-robot-expressive', voice: { pitch: 12, engine: 'babble' } }],
    dialogue: [{ time: 1, speaker: 'robot', text: ' Xin chào! ', emotion: 'happy' }, { time: 2, speaker: 'robot' }, { time: 3, speaker: 'robot', text: 'Hi', emotion: 'meh' }],
  }, '3d');
  assert.deepEqual(spec.actors[0].voice, { engine: 'babble', pitch: 8 });
  assert.deepEqual(spec.dialogue!.map((l) => [l.text, l.emotion]), [['Xin chào!', 'happy'], ['Hi', undefined]]);

  const prompt = 'Phim 3D 3 cảnh: chú robot phiêu lưu trong rừng cùng bạn cáo';
  const plan = buildLocalStoryboardPlan(prompt, detectStoryboardIntent(prompt)!);
  for (let i = 0; i < plan.beats.length; i++) {
    const scene = autoFixSceneSpec(buildLocalSceneForBeat(prompt, plan, i)).spec;
    assert.ok(scene.dialogue && scene.dialogue.length >= 1, `scene ${i} talks`);
    assert.equal(lineLanguage(scene.dialogue![0].text), 'vi');
    assert.ok(!verifySceneSpec(scene).issues.some((x) => x.code.startsWith('dialogue.')), `scene ${i} dialogue clean`);
  }
  const p = buildAgentSystemPrompt();
  for (const word of ['DIALOGUE', 'speaker', 'listener', 'emotion']) assert.match(p, new RegExp(word));
});
