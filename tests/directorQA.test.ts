import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectorPatchPrompt,
  buildDirectorQAUserPrompt,
  contactSheetLayout,
  describeDirectorReview,
  DirectorQAReport,
  needsDirectorRound,
  normalizeDirectorQAReport,
  pickDirectorKeyframes,
  runDirectorQARound,
} from '../src/agent/directorQA';
import { directorQAAvailable, directorQAThreshold } from '../src/agent/directorQARunner';
import { autoFixSceneSpec, MEDIA_CRAFT_CODES, mediaQualityPenalty } from '../src/verification/sceneVerifier';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { generate } from '../server/ai/index';
import { ProviderUnavailableError } from '../server/ai/types';
import {
  buildMusicRequest,
  buildSfxRequest,
  buildTtsRequest,
  DEFAULT_ELEVENLABS_TTS_MODEL,
  elevenLabsLicense,
  elevenLabsLicenseRecord,
  pcm16leToFloat32,
  redactSecret,
} from '../src/audio/elevenLabs';
import { callElevenLabs, ElevenLabsError, elevenLabsKey } from '../server/media/elevenLabs';
import { DEFAULT_ELEVENLABS_VOICE, voiceClipKey, voiceFor } from '../src/audio/voices';
import type { SceneSpec } from '../src/types/scene.schema';

function filmShot(): SceneSpec {
  const spec = createBlankSceneSpec('3d', 'Director test');
  spec.mode = 'media';
  spec.durationSeconds = 10;
  const hero = spec.actors[0].id;
  spec.camera = {
    ...spec.camera,
    shots: [
      { start: 0, type: 'wide', subject: hero, angle: 'front' },
      { start: 4, type: 'close-up', subject: hero, angle: 'front', move: 'push-in' },
      { start: 7, type: 'tracking', subject: hero },
    ],
  };
  return spec;
}

test('director keyframes: one per shot at its midpoint, sampled and deduplicated', () => {
  const spec = filmShot();
  const kf = pickDirectorKeyframes(spec);
  assert.deepEqual(kf.map((k) => k.time), [2, 5.5, 8.5]);
  assert.deepEqual(kf.map((k) => k.shotIndex), [0, 1, 2]);
  assert.match(kf[1].label, /close-up.*push-in/);
  // More shots than tiles → evenly sampled, first and last kept.
  spec.camera!.shots = Array.from({ length: 9 }, (_, i) => ({ start: i, type: 'medium' as const }));
  const sampled = pickDirectorKeyframes(spec, 4);
  assert.equal(sampled.length, 4);
  assert.equal(sampled[0].shotIndex, 0);
  assert.equal(sampled[3].shotIndex, 8);
  // No shot list → evenly spaced moments inside the duration.
  spec.camera!.shots = [];
  const moments = pickDirectorKeyframes(spec);
  assert.equal(moments.length, 3);
  assert.ok(moments.every((k) => k.time > 0 && k.time < 10));
  assert.deepEqual(contactSheetLayout(3), { cols: 2, rows: 2 });
  assert.deepEqual(contactSheetLayout(1), { cols: 1, rows: 1 });
  assert.match(buildDirectorQAUserPrompt(filmShot(), kf), /Tile 2/);
});

test('director report normalisation: scores, 0-10 scale, finding validation', () => {
  const kf = pickDirectorKeyframes(filmShot());
  assert.equal(normalizeDirectorQAReport({ summary: 'no score' }, kf), null);
  assert.equal(normalizeDirectorQAReport(null, kf), null);
  assert.equal(normalizeDirectorQAReport({ score: 6.5 }, kf)!.score, 65);
  assert.equal(normalizeDirectorQAReport({ score: 140 }, kf)!.score, 100);
  const r = normalizeDirectorQAReport(
    {
      score: 48,
      summary: 'Flat staging',
      findings: [
        { severity: 'low', category: 'lighting', title: 'Dim', fix: 'Raise the key light' },
        { severity: 'high', category: 'framing', keyframe: 2, targetId: 'hero-1', title: 'Head cut off', fix: 'Use a medium shot' },
        { severity: 'weird', category: 'nope', keyframe: 99, targetId: 'bad id; drop', title: 'Odd' },
        'not an object',
        {},
      ],
    },
    kf
  )!;
  assert.equal(r.findings.length, 3);
  assert.equal(r.findings[0].severity, 'high');
  assert.equal(r.findings[0].keyframe, 2);
  assert.equal(r.findings[0].targetId, 'hero-1');
  const odd = r.findings.find((f) => f.title === 'Odd')!;
  assert.equal(odd.severity, 'medium');
  assert.equal(odd.category, 'composition');
  assert.equal(odd.keyframe, undefined);
  assert.equal(odd.targetId, undefined);
  assert.ok(needsDirectorRound(r, 70));
  assert.ok(!needsDirectorRound({ ...r, findings: [] }, 70));
  assert.ok(!needsDirectorRound(r, 40));
  assert.match(buildDirectorPatchPrompt(r, 'A fox meets a robot'), /Head cut off/);
});

const review = (score: number): DirectorQAReport => ({
  score,
  summary: 'test',
  findings: [{ severity: 'high', category: 'framing', title: 'Too far', fix: 'Move closer' }],
  keyframes: [],
});

test('director round: unavailable, passed, applied and never worse', async () => {
  const spec = filmShot();
  const check = (s: SceneSpec) => autoFixSceneSpec(s);
  const base = { spec, prompt: 'shot', check, qualityPenalty: mediaQualityPenalty, qualityCodes: MEDIA_CRAFT_CODES };
  let proposals = 0;
  const unavailable = await runDirectorQARound({ ...base, review: async () => null, propose: async () => (proposals++, null) });
  assert.equal(unavailable.skipped, 'unavailable');
  const thrown = await runDirectorQARound({ ...base, review: async () => { throw new Error('capture failed'); }, propose: async () => null });
  assert.equal(thrown.skipped, 'unavailable');
  const passed = await runDirectorQARound({ ...base, review: async () => review(90), propose: async () => (proposals++, null) });
  assert.equal(passed.skipped, 'passed');
  assert.equal(proposals, 0, 'no patch round for a good shot or without vision');

  const hero = spec.actors[0].id;
  const prompts: string[] = [];
  const applied = await runDirectorQARound({
    ...base,
    review: async () => review(40),
    propose: async (t) => {
      prompts.push(t.prompt);
      return t.round === 0 ? { ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [1, 0, 1] }], done: true, diffSummary: ['Hero closer'] } : null;
    },
  });
  assert.ok(applied.changed);
  assert.match(prompts[0], /Move closer/);
  assert.deepEqual(applied.spec.actors[0].position, [1, 0, 1]);
  assert.equal(applied.spec.id, spec.id);
  assert.match(applied.diffSummary[0], /Director QA 40\/100/);
  assert.match(describeDirectorReview(applied.review, applied), /Applied 1 note/);

  // A patch that breaks the scene (more verifier errors) is discarded.
  const fakeCheck = (s: SceneSpec) => {
    const r = check(s);
    const broken = s.actors[0]?.position?.[0] === 99;
    return { ...r, report: broken ? { ...r.report, ok: false, errors: r.report.errors + 1 } : r.report };
  };
  const worse = await runDirectorQARound({
    ...base,
    check: fakeCheck,
    maxRounds: 1,
    review: async () => review(30),
    propose: async () => ({ ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [99, 0, 0] }], done: true }),
  });
  assert.equal(worse.changed, false);
  assert.equal(worse.spec, spec);
});

test('director QA needs a vision connection: CLIs are skipped and refuse requireVision', async () => {
  assert.equal(directorQAAvailable({ aiProvider: 'gemini' }), true);
  assert.equal(directorQAAvailable({ aiProvider: 'anthropic', directorQA: false }), false);
  assert.equal(directorQAAvailable({ aiProvider: 'cli-claude' }), false);
  assert.equal(directorQAThreshold({ directorQAThreshold: 85 }), 85);
  assert.equal(directorQAThreshold({ directorQAThreshold: 0 }), 70);
  await assert.rejects(
    generate({ provider: 'cli-claude' }, { system: 's', user: 'u', requireVision: true }),
    (e: unknown) => e instanceof ProviderUnavailableError && /vision-capable/.test((e as Error).message)
  );
});

test('ElevenLabs request builders validate input and keep v3 tags to v3 models', () => {
  const tts = buildTtsRequest({ text: ' Hello there ', voiceId: DEFAULT_ELEVENLABS_VOICE, emotion: 'happy' });
  assert.equal(tts.path, `/v1/text-to-speech/${DEFAULT_ELEVENLABS_VOICE}`);
  assert.equal(tts.query.output_format, 'pcm_24000');
  assert.equal(tts.body.text, 'Hello there');
  assert.equal(tts.body.model_id, DEFAULT_ELEVENLABS_TTS_MODEL);
  const v3 = buildTtsRequest({ text: 'Hi', voiceId: DEFAULT_ELEVENLABS_VOICE, modelId: 'eleven_v3', emotion: 'whisper' });
  assert.equal(v3.body.text, '[whispers] Hi');
  assert.throws(() => buildTtsRequest({ text: '', voiceId: DEFAULT_ELEVENLABS_VOICE }), /text is required/);
  assert.throws(() => buildTtsRequest({ text: 'x', voiceId: '../../v1/user' }), /voice id/);
  assert.throws(() => buildTtsRequest({ text: 'x'.repeat(2501), voiceId: DEFAULT_ELEVENLABS_VOICE }), /2500/);
  assert.equal(buildTtsRequest({ text: 'x', voiceId: DEFAULT_ELEVENLABS_VOICE, modelId: 'bad model; rm' }).body.model_id, DEFAULT_ELEVENLABS_TTS_MODEL);
  assert.equal(buildSfxRequest({ prompt: 'door', durationSeconds: 60 }).body.duration_seconds, 22);
  assert.equal(buildSfxRequest({ prompt: 'door' }).body.duration_seconds, undefined);
  assert.equal(buildMusicRequest({ prompt: 'piano', lengthSeconds: 2 }).body.music_length_ms, 10_000);
  assert.equal(buildMusicRequest({ prompt: 'piano' }).body.music_length_ms, 30_000);
  assert.throws(() => buildSfxRequest({ prompt: '  ' }), /prompt is required/);
});

test('ElevenLabs PCM decoding, licence records and secret redaction', () => {
  const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff]);
  const pcm = pcm16leToFloat32(bytes);
  assert.deepEqual(Array.from(pcm), [0.5, -0.5]);
  for (const tool of ['tts', 'sfx', 'music'] as const) assert.ok(elevenLabsLicense(tool).length <= 80);
  const rec = elevenLabsLicenseRecord('tts', { prompt: 'Hello', voiceId: 'abcdefgh12', model: 'eleven_v3', now: new Date('2026-01-02T03:04:05Z') });
  assert.equal(rec.provider, 'elevenlabs');
  assert.equal(rec.generatedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(rec.voiceId, 'abcdefgh12');
  assert.match(rec.terms, /elevenlabs\.io/);
  assert.equal(redactSecret('key sk_secret123 leaked sk_secret123', 'sk_secret123'), 'key [redacted] leaked [redacted]');
  assert.equal(redactSecret('short', 'ab'), 'short');
});

test('ElevenLabs proxy: key from header, env only for this computer, errors never echo the key', async () => {
  const req = (headers: Record<string, string>, remoteAddress = '127.0.0.1'): any => ({ headers, socket: { remoteAddress } });
  const saved = process.env.ELEVENLABS_API_KEY;
  try {
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(elevenLabsKey(req({})), undefined);
    assert.equal(elevenLabsKey(req({ 'x-elevenlabs-key': ' k1 ' })), 'k1');
    process.env.ELEVENLABS_API_KEY = 'env-key';
    assert.equal(elevenLabsKey(req({})), 'env-key');
    assert.equal(elevenLabsKey(req({}, '192.168.1.9')), undefined, 'LAN devices cannot spend the server key');
    assert.equal(elevenLabsKey(req({ 'x-forwarded-for': '1.2.3.4' })), undefined);
  } finally {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
  }

  const secret = 'sk_live_secret_value';
  let sentHeaders: any;
  let sentUrl = '';
  const okFetch: any = async (url: string, init: any) => {
    sentUrl = url;
    sentHeaders = init.headers;
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/pcm' } });
  };
  const out = await callElevenLabs(secret, buildTtsRequest({ text: 'Hi', voiceId: DEFAULT_ELEVENLABS_VOICE }), okFetch);
  assert.equal(out.bytes.length, 4);
  assert.equal(sentHeaders['xi-api-key'], secret);
  assert.match(sentUrl, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/.+\?output_format=pcm_24000$/);

  const badFetch: any = async () => new Response(`invalid api key ${secret}`, { status: 401 });
  await assert.rejects(callElevenLabs(secret, buildSfxRequest({ prompt: 'boom' }), badFetch), (e: unknown) => {
    assert.ok(e instanceof ElevenLabsError);
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes(secret));
    return true;
  });
  const throwFetch: any = async () => { throw new Error(`socket closed for ${secret}`); };
  await assert.rejects(callElevenLabs(secret, buildSfxRequest({ prompt: 'boom' }), throwFetch), (e: unknown) => {
    assert.ok(e instanceof ElevenLabsError && e.status === 502 && !e.message.includes(secret));
    return true;
  });
});

test('voices: ElevenLabs per character or per line, with its own clip key', () => {
  const actor = { id: 'a', assetId: 'fox', voice: { engine: 'piper' as const, elevenLabsVoiceId: 'AbCdEfGh12345678' } };
  const piper = voiceFor(actor, 'Hello');
  assert.equal(piper.engine, 'piper');
  const line = voiceFor(actor, 'Hello', 'elevenlabs');
  assert.deepEqual(line, { engine: 'elevenlabs', voiceId: 'AbCdEfGh12345678', pitch: 0, rate: 1 });
  assert.notEqual(voiceClipKey({ text: 'Hello' }, piper), voiceClipKey({ text: 'Hello' }, line));
  const fallback = voiceFor({ id: 'b', assetId: 'robot', voice: { engine: 'elevenlabs', elevenLabsVoiceId: 'bad/id' } }, 'Hi');
  assert.equal(fallback.voiceId, DEFAULT_ELEVENLABS_VOICE);
  assert.equal(voiceFor(actor, 'Hi', 'babble').engine, 'babble');
});
