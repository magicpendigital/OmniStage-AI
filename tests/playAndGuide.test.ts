import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGuideQuestion, GUIDE_TOPICS, formatGuideAnswer } from '../src/guide/guideContent';
import { previewOrder, previewDuration } from '../src/playtest/previewOrder';
import { createPlaySession, getPlaySession, lanAddresses, SESSION_TTL_MS } from '../server/play/playSessions';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { generateStandaloneHTMLContent } from '../src/exporter/mediaExporter';

test('chat answers app-usage questions from the Guide, not creative requests', () => {
  const cases: Array<[string, string | null]> = [
    ['làm sao chơi thử trên điện thoại?', 'phone-preview'],
    ['How do I play on my phone?', 'phone-preview'],
    ['làm thế nào để xem trước toàn bộ phim?', 'media-preview'],
    ['How do I export to TikTok?', 'export'],
    ['where is memory?', 'memory'],
    ['cách cài extension?', 'extensions'],
    ['làm sao để chơi thử game?', 'play-test'],
    ['how do I use Claude Code CLI as the AI?', 'providers'],
    ['Tạo game 2D vượt chướng ngại vật 3 màn', null],
    ['Make a forest scene with a running fox', null],
    ['add three stars', null],
  ];
  for (const [prompt, expected] of cases) {
    assert.equal(matchGuideQuestion(prompt)?.id ?? null, expected, prompt);
  }
});

test('every guide topic is complete in both languages', () => {
  for (const t of GUIDE_TOPICS) {
    for (const lang of ['vi', 'en'] as const) {
      assert.ok(t.title[lang] && t.summary[lang], `${t.id} ${lang}`);
      assert.equal(t.steps[lang].length, t.steps.vi.length, `${t.id} step count matches across languages`);
    }
    assert.ok(t.keywords.length > 0);
  }
  assert.match(formatGuideAnswer(GUIDE_TOPICS[0], 'vi'), /^🚀 .+\n1\. /);
});

test('preview order follows the storyboard chain, else project order', () => {
  const a = createBlankSceneSpec('3d', 'A');
  const b = createBlankSceneSpec('3d', 'B');
  const c = createBlankSceneSpec('3d', 'C');
  const loose = createBlankSceneSpec('2d', 'Loose');
  const seq = (index: number, next?: string) => ({ storyboardId: 'sb', storyboardTitle: 'Film', kind: 'film' as const, index, total: 3, nextSceneId: next });
  a.sequence = seq(0, b.id);
  b.sequence = seq(1, c.id);
  c.sequence = seq(2);
  const scenes = [loose, c, a, b];
  assert.deepEqual(previewOrder(scenes, b.id), [a.id, b.id, c.id]);
  assert.deepEqual(previewOrder(scenes, loose.id), scenes.map((s) => s.id));
  b.sequence.nextSceneId = 'missing';
  assert.deepEqual(previewOrder(scenes, a.id), [a.id, b.id, c.id], 'broken chain falls back to index order');
  assert.equal(previewDuration(scenes, [a.id, b.id]), a.durationSeconds + b.durationSeconds);
});

test('phone play sessions: unguessable tokens, expiry, validation', () => {
  const html = '<!DOCTYPE html><html><body>game</body></html>';
  const now = 1_000_000;
  const token = createPlaySession(html, 'Demo', now);
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal(getPlaySession(token, now + 1000)?.html, html);
  assert.equal(getPlaySession(token, now + SESSION_TTL_MS + 1), null, 'expired');
  assert.equal(getPlaySession('../../etc/passwd'), null);
  assert.throws(() => createPlaySession('not html', 'x'));
  assert.ok(Array.isArray(lanAddresses()));
  for (const ip of lanAddresses()) assert.match(ip, /^(192\.168\.|10\.|172\.)/);
});

test('play test build includes the FPS meter and still compiles', () => {
  const spec = { ...createBlankSceneSpec('2d'), mode: 'game' as const };
  const html = generateStandaloneHTMLContent(spec, 'universal', [spec], { showFps: true });
  assert.ok(html.includes('id="omniFps"'));
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  assert.ok(!generateStandaloneHTMLContent(spec, 'universal', [spec]).includes('omniFps'), 'off by default for real exports');
});

test('guide answers follow the language of the question', async () => {
  const { guideLangFor } = await import('../src/guide/guideContent');
  assert.equal(guideLangFor('làm sao chơi thử trên điện thoại?'), 'vi');
  assert.equal(guideLangFor('how do I export?'), 'en');
});
