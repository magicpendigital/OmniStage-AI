import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerQuestion,
  applyUserEdit,
  bibleForProduction,
  continuityCheck,
  createRoomSession,
  deskForCode,
  downstreamOf,
  evaluateRoom,
  mergeDeskOutput,
  planShowrunner,
  reviseDesk,
  roomReady,
  runDesk,
  runEditor,
  runRoom,
  setDeskLock,
  type RoomAsk,
  type RoomAskRequest,
  type WritersRoomSession,
} from '../src/agent/writersRoom';
import { buildLocalStoryBible } from '../src/agent/storyBible';
import { buildRoomSystemPrompt, buildRoomUserPrompt } from '../src/agent/writersRoomPrompts';
import type { StoryBible } from '../src/types/scene.schema';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const PROMPT = 'A funny film about a fox who wants to cross the river before night';
const intent = { sceneCount: 3, kind: 'film' as const };
const noop = () => {};
const local = (n = 3) => buildLocalStoryBible(PROMPT, { sceneCount: n, kind: 'film' });

/** A scripted "AI": every desk answers well. Records each request. */
function goodAsk(calls: RoomAskRequest[] = []): RoomAsk {
  return async (req) => {
    calls.push(req);
    const l = buildLocalStoryBible(req.prompt, { sceneCount: req.intent.sceneCount, kind: 'film' });
    if (req.desk === 'architect') return l;
    if (req.desk === 'character') return { characters: l.characters };
    if (req.desk === 'world') return { beats: l.beats.map((b) => ({ scene: b.scene, setting: `Place ${b.scene}`, biome: 'forest', props: [] })) };
    if (req.desk === 'dialogue') {
      const speaker = req.context.characters[0]?.actorId || l.characters[0].actorId;
      return { beats: l.beats.map((b) => ({ scene: b.scene, lines: b.scene === 1 ? [{ speaker, text: 'I can do this.', emotion: 'hopeful' }] : [] })) };
    }
    return { score: 90, findings: [], verdict: 'Tight.' };
  };
}

const run = (s: WritersRoomSession, ask: RoomAsk, askEditor?: RoomAsk) => runRoom(s, { ask, askEditor, update: noop });

test('showrunner asks only what the prompt leaves open', () => {
  assert.equal(planShowrunner(PROMPT, intent).questions.length, 0);
  const vague = planShowrunner('make a film', intent);
  assert.ok(vague.questions.length >= 1 && vague.questions.length <= 2);
  assert.ok(vague.questions.every((q) => q.desk === 'architect'));
});

test('a new session is a briefing with the showrunner done by rules', () => {
  const s = createRoomSession({ prompt: PROMPT, intent });
  assert.equal(s.stage, 'briefing');
  assert.equal(s.desks.showrunner.source, 'rules');
  assert.equal(s.bible.beats.length, 3);
  assert.deepEqual(roomReady(s), { ok: false, reason: 'Start the room first.' });
  assert.equal(createRoomSession({ prompt: PROMPT, intent: { ...intent, sceneCount: 1 } }).bible.beats.length, 2);
});

test('answering a question marks the showrunner done and is passed to the desks', async () => {
  const s0 = createRoomSession({ prompt: 'make a film', intent });
  assert.equal(s0.desks.showrunner.status, 'needs-you');
  const s1 = answerQuestion(s0, s0.questions[0].id, 'A sad lighthouse keeper');
  assert.equal(s1.desks.showrunner.status, 'done');
  const calls: RoomAskRequest[] = [];
  await run(s1, goodAsk(calls));
  const arch = calls.find((c) => c.desk === 'architect')!;
  assert.deepEqual(arch.answers?.map((a) => a.answer), ['A sad lighthouse keeper']);
});

test('every desk may only write its own fields', () => {
  const base = local();
  const hostile = { characters: [{ actorId: 'x', name: 'X', assetId: 'robot' }], logline: 'HIJACKED', beats: base.beats.map((b) => ({ ...b, setting: 'Moon', biome: 'forest', lines: [{ speaker: 'x', text: 'hi' }] })) };

  const w = mergeDeskOutput(base, 'world', hostile, 3)!;
  assert.equal(w.bible.logline, base.logline, 'world cannot rewrite the logline');
  assert.deepEqual(w.bible.characters, base.characters, 'world cannot touch the cast');
  assert.equal(w.bible.beats[0].setting, 'Moon');
  assert.equal(w.bible.beats[0].lines, undefined, 'world cannot write dialogue');

  const d = mergeDeskOutput(base, 'dialogue', hostile, 3)!;
  assert.equal(d.bible.logline, base.logline);
  assert.equal(d.bible.beats[0].setting, base.beats[0].setting, 'dialogue cannot place scenes');
  assert.ok(d.bible.beats[0].lines?.length);

  const a = mergeDeskOutput(base, 'architect', { ...local(), characters: [{ actorId: 'zzz', name: 'Z', assetId: 'robot' }] }, 3)!;
  assert.deepEqual(a.bible.characters, base.characters, 'architect cannot change the cast');
});

test('unusable desk output is rejected', () => {
  const base = local();
  assert.equal(mergeDeskOutput(base, 'architect', null, 3), null);
  assert.equal(mergeDeskOutput(base, 'architect', { logline: '' }, 3), null);
  assert.equal(mergeDeskOutput(base, 'character', { characters: [] }, 3), null);
  assert.equal(mergeDeskOutput(base, 'dialogue', {}, 3), null);
  assert.equal(mergeDeskOutput(base, 'editor', { score: 1 }, 3), null);
});

test('a character that already has a generated model keeps it when the character desk re-runs', () => {
  const base = local();
  const hero = clone(base.characters[0]);
  base.characters[0] = { ...hero, assetId: 'meshy:abc', generated: { provider: 'meshy', clips: ['walking', 'running'], modelUrl: '/api/assets/abc.glb' } };
  const merged = mergeDeskOutput(base, 'character', { characters: [{ ...hero, signatureClip: 'running' }] }, 3)!;
  const kept = merged.bible.characters.find((c) => c.actorId === hero.actorId)!;
  assert.equal(kept.assetId, 'meshy:abc');
  assert.equal(kept.generated?.provider, 'meshy');
  assert.equal(kept.signatureClip, 'running');
});

test('a full room run: desks done, score recorded, ready to produce', async () => {
  const calls: RoomAskRequest[] = [];
  const s = await run(createRoomSession({ prompt: PROMPT, intent }), goodAsk(calls));
  assert.equal(s.stage, 'review');
  assert.equal(s.busy, false);
  assert.equal(s.source, 'ai');
  for (const r of ['architect', 'character', 'world', 'dialogue'] as const) {
    assert.equal(s.desks[r].status, 'done', r);
    assert.equal(s.desks[r].source, 'ai', r);
  }
  assert.equal(s.editorScore, 90);
  assert.ok(s.score > 0);
  assert.equal(s.bible.beats[0].biome, 'forest');
  assert.ok(s.bible.beats[0].lines?.length);
  assert.equal(roomReady(s).ok, true);
  assert.ok(bibleForProduction(s));
  // dialogue read what character wrote
  const dlg = calls.find((c) => c.desk === 'dialogue')!;
  assert.ok(dlg.context.characters.length > 0 && dlg.context.logline);
});

test('with no AI the room falls back to offline templates and says so', async () => {
  const s = await run(createRoomSession({ prompt: PROMPT, intent }), async () => { throw new Error('503 no connection'); });
  assert.equal(s.stage, 'review');
  assert.equal(s.source, 'local');
  assert.equal(s.desks.architect.source, 'local');
  assert.ok(s.desks.architect.notes.some((n) => /offline/.test(n)));
  assert.equal(s.desks.dialogue.status, 'done', 'a silent film is a valid offline result, not an error');
  assert.ok(s.desks.dialogue.notes.some((n) => /silent/.test(n)));
  assert.ok(s.bible.logline);
  assert.equal(bibleForProduction(s), undefined, 'a pure template is not handed over as an approved bible');
  assert.equal(roomReady(s).ok, true);
});

test('garbage answers also fall back instead of corrupting the bible', async () => {
  const s = await run(createRoomSession({ prompt: PROMPT, intent }), async () => ({ nonsense: true }));
  assert.equal(s.source, 'local');
  assert.ok(s.bible.beats.every((b) => b.purpose));
});

test('an abort is not swallowed as an offline fallback', async () => {
  const ac = new AbortController();
  ac.abort();
  const s0 = createRoomSession({ prompt: PROMPT, intent });
  await assert.rejects(runDesk(s0, 'architect', { ask: async () => { throw new Error('aborted'); }, update: noop, signal: ac.signal }));
});

test('a locked desk is never re-run and is reported as locked to the others', async () => {
  const s0 = await run(createRoomSession({ prompt: PROMPT, intent }), goodAsk());
  const before = clone(s0.bible.characters);
  const locked = setDeskLock(s0, 'character', true);
  const calls: RoomAskRequest[] = [];
  const after = await runDesk(locked, 'character', { ask: goodAsk(calls), update: noop });
  assert.equal(calls.length, 0);
  assert.deepEqual(after.bible.characters, before);
  await runDesk(locked, 'dialogue', { ask: goodAsk(calls), update: noop });
  assert.deepEqual(calls[0].lockedDesks, ['character']);
});

test('your note reaches the desk, and the desks that read it re-run (locked ones do not)', async () => {
  const s0 = await run(createRoomSession({ prompt: PROMPT, intent }), goodAsk());
  const locked = setDeskLock(s0, 'dialogue', true);
  const calls: RoomAskRequest[] = [];
  const s1 = await reviseDesk(locked, 'architect', 'Make the ending sadder', { ask: goodAsk(calls), update: noop });
  const order = calls.map((c) => c.desk);
  assert.equal(order[0], 'architect');
  assert.equal(calls[0].userNote, 'Make the ending sadder');
  assert.ok(calls[0].current, 'a revise round sends the desk its own previous output');
  assert.ok(order.includes('character') && order.includes('world'));
  assert.ok(!order.includes('dialogue'), 'locked dialogue stays as is');
  assert.equal(s1.busy, false);
  assert.equal(s1.desks.architect.revisions, 1);
});

test('downstream order follows the dependencies', () => {
  const s = createRoomSession({ prompt: PROMPT, intent });
  assert.deepEqual(downstreamOf('architect', s), ['character', 'world', 'dialogue']);
  assert.deepEqual(downstreamOf('character', s), ['dialogue']);
  assert.deepEqual(downstreamOf('dialogue', s), []);
  assert.deepEqual(downstreamOf('architect', setDeskLock(s, 'world', true)), ['character', 'dialogue']);
});

test('continuity: unknown speakers are errors for the dialogue desk, orphan props are warnings for the world desk', () => {
  const b = local();
  b.beats[0].lines = [{ speaker: 'ghost', text: 'Boo' }];
  b.props = [{ id: 'lamp', name: 'Lamp', look: 'a brass lamp', scenes: [] }];
  b.beats[1].props = ['missing-prop'];
  const f = continuityCheck(b);
  const speaker = f.find((x) => x.code === 'room.speaker-unknown')!;
  assert.equal(speaker.severity, 'error');
  assert.equal(speaker.desk, 'dialogue');
  assert.equal(f.find((x) => x.code === 'room.prop-orphan')?.desk, 'world');
  assert.equal(f.find((x) => x.code === 'room.prop-unknown')?.severity, 'warning');
  const clean = continuityCheck(local());
  assert.equal(clean.filter((x) => x.severity === 'error').length, 0);
});

test('continuity asks for a look only when a generator is connected', () => {
  const b = local();
  assert.equal(continuityCheck(b).some((f) => f.code === 'room.look-missing'), false);
  const asked = continuityCheck(b, { requireLook: true });
  assert.ok(asked.some((f) => f.code === 'room.look-missing' && f.desk === 'character'));
  b.characters.forEach((c) => { c.look = 'a small round orange fox, big ears'; });
  assert.equal(continuityCheck(b, { requireLook: true }).some((f) => f.code === 'room.look-missing'), false);
});

test('continuity errors lower the score and are routed to a writer desk', () => {
  const b = local();
  const base = evaluateRoom(b, 3).score;
  b.beats[0].lines = [{ speaker: 'ghost', text: 'Boo' }];
  const ev = evaluateRoom(b, 3);
  assert.ok(ev.score < base);
  assert.ok(ev.findings.every((f) => ['architect', 'character', 'world', 'dialogue', 'editor', 'continuity'].includes(f.desk)));
  assert.equal(deskForCode('bible.asset-unknown'), 'character');
  assert.equal(deskForCode('bible.hook-late'), 'architect');
});

test('the fix round sends the error back to the desk that owns it', async () => {
  const bad = goodAsk();
  let dialogueCalls = 0;
  const ask: RoomAsk = async (req) => {
    if (req.desk === 'dialogue') {
      dialogueCalls++;
      // first draft: a line from someone who does not exist; the fix round gets it right
      const speaker = dialogueCalls === 1 ? 'ghost' : req.context.characters[0].actorId;
      return { beats: req.context.beats.map((b) => ({ scene: b.scene, lines: b.scene === 1 ? [{ speaker, text: 'Hello.' }] : [] })) };
    }
    return bad(req);
  };
  const s = await run(createRoomSession({ prompt: PROMPT, intent }), ask);
  assert.equal(dialogueCalls, 2, 'dialogue desk ran again for the fix round');
  assert.equal(s.desks.dialogue.revisions, 1);
  assert.ok(!s.findings.some((f) => f.code === 'room.speaker-unknown'));
});

test('the editor runs on its own connection and its findings are routed', async () => {
  const s0 = await run(createRoomSession({ prompt: PROMPT, intent }), goodAsk());
  const editorOnly: RoomAsk = async () => ({ score: 10, findings: [{ severity: 'warning', desk: 'world', message: 'Scene 2 looks like scene 1.' }, { message: 'Nothing is at stake.', desk: 'nonsense' }] });
  const calls: RoomAskRequest[] = [];
  const s = await runEditor(s0, { ask: async (r) => { calls.push(r); return {}; }, askEditor: editorOnly, update: noop });
  assert.equal(calls.length, 0, 'the writers connection is not used for the critique');
  assert.equal(s.editorScore, 10);
  const e = s.findings.filter((f) => f.code.startsWith('editor.'));
  assert.equal(e[0].desk, 'world');
  assert.equal(e[1].desk, 'architect', 'an unknown desk falls back to the architect');
  assert.equal(s.desks.editor.status, 'needs-you');
  assert.ok(s.score < s0.score);
});

test('when the editor fails the rubric and rules still score the story', async () => {
  const s0 = await run(createRoomSession({ prompt: PROMPT, intent }), goodAsk());
  const s = await runEditor(s0, { ask: async () => { throw new Error('boom'); }, update: noop });
  assert.equal(s.editorScore, undefined);
  assert.equal(s.desks.editor.source, 'rules');
  assert.ok(s.score > 0);
});

test('your own edit wins, is marked as yours, and re-runs the checks', async () => {
  const s0 = await run(createRoomSession({ prompt: PROMPT, intent }), async () => { throw new Error('offline'); });
  assert.equal(bibleForProduction(s0), undefined);
  const edited = clone(s0.bible);
  edited.logline = 'A fox who is afraid of the river learns that fear shrinks when shared.';
  edited.beats[0].lines = [{ speaker: 'nobody', text: 'x' }];
  const s1 = applyUserEdit(s0, 'architect', edited);
  assert.equal(s1.desks.architect.source, 'user');
  assert.match(s1.bible.logline, /afraid of the river/);
  assert.ok(bibleForProduction(s1), 'once you edit, the room is handed over');
  assert.ok(s1.findings.some((f) => f.code === 'room.speaker-unknown') || s1.bible.beats[0].lines === undefined, 'the continuity desk reacts to the edit (or auto-fix removed the bad line)');
});

test('room is not ready while busy or with an empty spine', () => {
  const s = createRoomSession({ prompt: PROMPT, intent });
  assert.equal(roomReady({ ...s, stage: 'review', busy: true }).ok, false);
  assert.equal(roomReady({ ...s, stage: 'review' }).ok, false);
});

test('room prompts are built from structured input and keep each desk in its lane', () => {
  const s = createRoomSession({ prompt: PROMPT, intent });
  const base: RoomAskRequest = { desk: 'architect', prompt: PROMPT, intent: s.intent, template: s.template, context: s.bible as StoryBible };
  for (const desk of ['architect', 'character', 'world', 'dialogue', 'editor'] as const) {
    const sys = buildRoomSystemPrompt({ ...base, desk });
    assert.ok(sys.length > 200, desk);
    assert.match(sys, /JSON/i, desk);
    const user = buildRoomUserPrompt({ ...base, desk, userNote: 'Make it sadder', lockedDesks: ['character'] });
    assert.match(user, /Make it sadder/);
    assert.match(user, new RegExp(PROMPT.slice(0, 20)));
  }
});
