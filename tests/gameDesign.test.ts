import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoFixGameDesign,
  buildGameDesignSystemPrompt,
  buildGameDesignUserPrompt,
  buildLocalGameDesign,
  coerceGameDesign,
  describeGameDesign,
  gameDesignFindingsForRevision,
  GAME_DESIGN_PASS_SCORE,
  lintGameDesign,
  sanitizeGameDesign,
  writeGameDesign,
} from '../src/agent/gameDesign';
import { createBlankSceneSpec, SCENE_TEMPLATES } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, MEDIA_CRAFT_CODES, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { GameDesign, Node2D, SceneSpec } from '../src/types/scene.schema';

const GOOD: GameDesign = {
  title: 'Coin Hop',
  genre: 'platformer',
  pitch: 'Jump across floating platforms to collect every coin without touching a hazard.',
  coreLoop: 'Run, jump to the next platform, grab a coin',
  goal: 'Collect every coin',
  win: 'collect-all',
  lose: 'hazard-reset',
  mechanics: ['jump', 'collect', 'avoid-hazards'],
  usesHealth: false,
  levels: [
    { name: 'One', teaches: 'jumping', introduces: ['jump'], uses: ['jump'], difficulty: 1 },
    { name: 'Two', teaches: 'coins', introduces: ['collect'], uses: ['jump', 'collect'], difficulty: 3 },
    { name: 'Three', teaches: 'hazards', introduces: ['avoid-hazards'], uses: ['jump', 'collect', 'avoid-hazards'], difficulty: 5 },
  ],
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- sanitize / autoFix / lint ----------------------------------------------------------------------

test('a clean design scores 100 and needs no fixes', () => {
  assert.equal(lintGameDesign(GOOD, 3).score, 100);
  assert.deepEqual(autoFixGameDesign(GOOD, 3).fixes, []);
});

test('sanitize drops unknown verbs / genres, clamps numbers and rejects junk', () => {
  assert.equal(sanitizeGameDesign(null, 3), null);
  assert.equal(sanitizeGameDesign({ foo: 1 }, 3), null);
  const d = sanitizeGameDesign(
    { pitch: 'x', genre: 'moba', win: 'nope', mechanics: ['jump', 'fly', 'jump', 'collect'], timeLimitSeconds: 9999, variables: [{ id: '1bad' }, { id: 'keys', label: 'Keys' }, { id: 'keys' }], levels: [{ difficulty: 99, introduces: ['teleport', 'jump'] }] },
    2
  )!;
  assert.equal(d.genre, 'platformer');
  assert.equal(d.win, 'collect-all');
  assert.deepEqual(d.mechanics, ['jump', 'collect']);
  assert.equal(d.timeLimitSeconds, 600);
  assert.deepEqual(d.variables, [{ id: 'keys', label: 'Keys' }]);
  assert.equal(d.levels[0].difficulty, 5);
  assert.deepEqual(d.levels[0].introduces, ['jump']);
});

test('autoFix pads levels, teaches every verb, makes uses cumulative and ramps a flat difficulty', () => {
  const raw = sanitizeGameDesign({ ...GOOD, levels: [{ name: 'Only', introduces: [], uses: [], difficulty: 2 }] }, 3)!;
  const { design, fixes } = autoFixGameDesign(raw, 3);
  assert.equal(design.levels.length, 3);
  const taught = design.levels.flatMap((l) => l.introduces).sort();
  assert.deepEqual(taught, ['avoid-hazards', 'collect', 'jump']);
  assert.deepEqual(design.levels[2].uses.slice().sort(), ['avoid-hazards', 'collect', 'jump']);
  assert.deepEqual(design.levels.map((l) => l.difficulty), [1, 3, 5]);
  assert.ok(fixes.length > 0);
  assert.equal(lintGameDesign(design, 3).issues.filter((i) => i.severity === 'error').length, 0);
});

test('autoFix completes the win / lose requirements', () => {
  const timed = autoFixGameDesign(sanitizeGameDesign({ ...GOOD, win: 'survive-timer', mechanics: ['avoid-hazards'] }, 3)!, 3).design;
  assert.equal(timed.timeLimitSeconds, 30);
  assert.ok(timed.mechanics.includes('survive'));
  const hp = autoFixGameDesign(sanitizeGameDesign({ ...GOOD, lose: 'health' }, 3)!, 3).design;
  assert.equal(hp.usesHealth, true);
  const keys = autoFixGameDesign(sanitizeGameDesign({ ...GOOD, win: 'variable-threshold' }, 3)!, 3).design;
  assert.deepEqual(keys.variables, [{ id: 'keys', label: 'Keys' }]);
  assert.ok(keys.mechanics.includes('unlock'));
});

test('lint reports each rule with a code', () => {
  const bad = clone(GOOD);
  bad.pitch = 'fun';
  bad.coreLoop = '';
  bad.goal = '';
  bad.mechanics = [];
  const codes = lintGameDesign(bad, 3).issues.map((i) => i.code);
  for (const c of ['design.pitch', 'design.core-loop', 'design.goal', 'design.no-mechanics']) assert.ok(codes.includes(c), c);

  const d = clone(GOOD);
  d.usesHealth = true; // nothing can hurt the player once avoid-hazards is gone
  d.mechanics = ['jump', 'collect'];
  assert.ok(lintGameDesign(d, 3).issues.some((i) => i.code === 'design.health-never-hurts'));

  const heavy = clone(GOOD);
  heavy.levels[0].introduces = ['jump', 'collect'];
  const heavyCodes = lintGameDesign(heavy, 3).issues.map((i) => i.code);
  assert.ok(heavyCodes.includes('design.first-level-heavy'));
  assert.ok(heavyCodes.includes('design.teach-one'));

  const untaught = clone(GOOD);
  untaught.levels[2].introduces = [];
  assert.ok(lintGameDesign(untaught, 3).issues.some((i) => i.code === 'design.verb-never-taught'));

  const flat = clone(GOOD);
  flat.levels.forEach((l) => (l.difficulty = 2));
  assert.ok(lintGameDesign(flat, 3).issues.some((i) => i.code === 'design.no-ramp'));
  assert.ok(lintGameDesign(GOOD, 4).issues.some((i) => i.code === 'design.levels-count'));
});

test('findings for revision: errors always, warnings only under the pass mark', () => {
  const warnOnly = { score: 94, issues: [{ code: 'a', severity: 'warning' as const, message: 'w' }] };
  assert.equal(gameDesignFindingsForRevision(warnOnly).length, 0);
  const low = { score: GAME_DESIGN_PASS_SCORE - 1, issues: warnOnly.issues };
  assert.equal(gameDesignFindingsForRevision(low).length, 1);
});

test('prompts are built from structured data and carry the rules', () => {
  const system = buildGameDesignSystemPrompt(4);
  assert.match(system, /exactly 4 items/);
  assert.match(system, /dodge-projectiles/);
  const user = buildGameDesignUserPrompt({ prompt: 'a cat game', levelCount: 4, draft: GOOD, findings: [{ code: 'design.pitch', severity: 'error', message: 'longer' }] });
  assert.match(user, /a cat game/);
  assert.match(user, /\[design.pitch\] longer/);
});

// ---- offline design + orchestration -----------------------------------------------------------------

test('the offline design is always a valid, lint-clean design', () => {
  for (const prompt of ['jump and collect coins', 'turret bullet dodge shooter', 'survive the timer', 'find keys and open the door', 'game nhặt xu vui nhộn', '']) {
    for (const n of [1, 2, 3, 5, 7]) {
      const d = buildLocalGameDesign(prompt, { sceneCount: n });
      const lint = lintGameDesign(d, n);
      assert.equal(d.levels.length, n, `${prompt}/${n}`);
      assert.equal(lint.issues.filter((i) => i.severity === 'error').length, 0, `${prompt}/${n}: ${lint.issues.map((i) => i.code)}`);
      assert.ok(lint.score >= GAME_DESIGN_PASS_SCORE, `${prompt}/${n} score ${lint.score}`);
    }
  }
  assert.equal(buildLocalGameDesign('turret bullet dodge shooter', { sceneCount: 3 }).genre, 'turret-dodge');
  assert.equal(buildLocalGameDesign('turret bullet dodge shooter', { sceneCount: 3 }).title, 'Turret Dodge');
  assert.equal(buildLocalGameDesign('find keys and open the door', { sceneCount: 3 }).win, 'variable-threshold');
  assert.equal(buildLocalGameDesign('survive the timer', { sceneCount: 3 }).usesHealth, true);
});

test('writeGameDesign: a good draft is used, a failing ask falls back offline', async () => {
  const ok = await writeGameDesign({ prompt: 'coins', intent: { sceneCount: 3 }, ask: async () => GOOD });
  assert.equal(ok.source, 'ai');
  assert.equal(ok.lint.score, 100);
  const off = await writeGameDesign({
    prompt: 'coins',
    intent: { sceneCount: 3 },
    ask: async () => {
      throw new Error('503');
    },
  });
  assert.equal(off.source, 'local');
  assert.equal(off.design.levels.length, 3);
  const junk = await writeGameDesign({ prompt: 'coins', intent: { sceneCount: 3 }, ask: async () => 'not json' });
  assert.equal(junk.source, 'local');
});

test('writeGameDesign runs exactly one revise round and keeps the better draft', async () => {
  const weak = { ...clone(GOOD), pitch: 'fun', coreLoop: 'go', goal: '' };
  const calls: unknown[] = [];
  const res = await writeGameDesign({
    prompt: 'coins',
    intent: { sceneCount: 3 },
    ask: async (req) => {
      calls.push(req);
      return req.draft ? GOOD : weak;
    },
  });
  assert.equal(calls.length, 2);
  assert.ok((calls[1] as { findings: unknown[] }).findings.length > 0);
  assert.equal(res.lint.score, 100);
  assert.ok(res.notes.some((n) => n.startsWith('design editor revise round: ')));
  // a revision that is worse is discarded
  const worse = await writeGameDesign({ prompt: 'coins', intent: { sceneCount: 3 }, ask: async (req) => (req.draft ? { ...weak, mechanics: [] } : { ...GOOD, pitch: 'fun', goal: '' }) });
  assert.ok(worse.lint.score >= 50 || worse.source === 'local');
});

test('coerceGameDesign accepts client data and describeGameDesign names the level', () => {
  assert.equal(coerceGameDesign('nope', 3), undefined);
  const d = coerceGameDesign(GOOD, 3)!;
  assert.equal(d.title, 'Coin Hop');
  const text = describeGameDesign(d, 1);
  assert.match(text, /THIS LEVEL \(2\/3\) "Two"/);
  assert.match(text, /contains jump, collect/);
  assert.match(describeGameDesign(d), /Level 3 "Three"/);
});

// ---- intent alignment verifier -----------------------------------------------------------------------

function node(over: Partial<Node2D> & { id: string }): Node2D {
  return {
    name: over.id, type: 'tile-platform', x: 100, y: 300, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', ...over,
  } as Node2D;
}

function level(design: GameDesign | undefined, index: number | undefined, ...extra: Node2D[]): SceneSpec {
  const spec = createBlankSceneSpec('2d', 'Level');
  spec.mode = 'game';
  spec.gameRules = { winCondition: 'collect-all', targetScore: 100, timeLimitSeconds: 0, instructions: '' };
  spec.logicGraph = { nodes: [], edges: [] };
  spec.nodes2D = [
    node({ id: 'ground', physics2D: 'static-platform', x: 500, y: 560, width: 1000, height: 40 }),
    node({ id: 'hero', physics2D: 'player-platformer', x: 100, y: 500 }),
    ...extra,
  ];
  if (design) spec.gameDesign = design;
  if (index !== undefined) spec.sequence = { storyboardId: 's', storyboardTitle: 'g', kind: 'game-levels', index, total: 3 };
  return spec;
}
const intent = (spec: SceneSpec) => verifySceneSpec(spec).issues.filter((i) => i.code.startsWith('intent.'));

test('scenes without a design (and every template) get no intent issues', () => {
  assert.equal(intent(level(undefined, undefined)).length, 0);
  for (const [id, spec] of Object.entries(SCENE_TEMPLATES)) assert.equal(intent(spec as SceneSpec).length, 0, id);
});

test('a level must contain the verbs its design level promises', () => {
  // level 2 promises jump + collect; the scene has no coin
  const issues = intent(level(GOOD, 1));
  assert.deepEqual(issues.map((i) => `${i.code}:${i.targetId}`), ['intent.mechanic-missing:collect']);
  const withCoin = level(GOOD, 1, node({ id: 'coin', physics2D: 'collectible', x: 300, y: 480 }));
  assert.equal(intent(withCoin).length, 0);
  // without a level index the whole-game verbs are required
  assert.equal(intent(level(GOOD, undefined, node({ id: 'coin', physics2D: 'collectible' }))).length, 1); // hazard missing
});

test('a level that uses a verb before it is taught is reported', () => {
  const early = level(GOOD, 0, node({ id: 'spikes', physics2D: 'hazard', x: 400, y: 540 }));
  assert.deepEqual(intent(early).map((i) => i.code), ['intent.verb-too-early']);
});

test('health, HUD, timer and counters are checked and fixable', () => {
  const design: GameDesign = { ...clone(GOOD), usesHealth: true, lose: 'health', win: 'survive-timer', timeLimitSeconds: 45, variables: [{ id: 'keys', label: 'Keys' }], mechanics: ['jump', 'avoid-hazards', 'survive'], levels: [] };
  design.levels = [{ name: 'A', teaches: 't', introduces: ['jump'], uses: ['jump', 'avoid-hazards', 'survive'], difficulty: 1 }];
  const spec = level(design, 0, node({ id: 'spikes', physics2D: 'hazard', x: 400, y: 540 }));
  spec.gameRules.winCondition = 'survive-timer';
  const codes = intent(spec).map((i) => i.code).sort();
  assert.deepEqual(codes, ['intent.health-missing', 'intent.timer-missing', 'intent.variable-missing']);

  const fixed = autoFixSceneSpec(spec).spec;
  const left = verifySceneSpec(fixed).issues.filter((i) => i.code.startsWith('intent.'));
  assert.deepEqual(left, []);
  const hero = fixed.nodes2D.find((n) => n.id === 'hero')!;
  assert.deepEqual(hero.health, { max: 3, invulnerableSeconds: 0.8 });
  assert.equal(fixed.gameRules.timeLimitSeconds, 45);
  assert.ok((fixed.variables || []).some((v) => v.id === 'keys'));
  assert.ok((fixed.hud || []).some((h) => h.source === 'health'));
});

test('a win rule that differs from the design is a (non-fixable) warning', () => {
  const spec = level(GOOD, undefined, node({ id: 'coin', physics2D: 'collectible' }), node({ id: 'spikes', physics2D: 'hazard' }));
  spec.gameRules.winCondition = 'score-threshold';
  const issue = intent(spec).find((i) => i.code === 'intent.win-mismatch');
  assert.ok(issue);
  assert.equal(issue!.fixable, false);
  assert.equal(issue!.severity, 'warning');
});

test('intent codes count as craft work for the patch loop', () => {
  for (const c of ['intent.mechanic-missing', 'intent.health-missing', 'intent.win-mismatch']) assert.ok(MEDIA_CRAFT_CODES.includes(c), c);
});
