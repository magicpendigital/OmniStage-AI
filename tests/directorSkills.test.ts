import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import {
  buildSkillContext,
  distillLearnedSkill,
  extractKeywords,
  inferSkillContext,
  mergeSystemPrompt,
  selectDirectorSkills,
} from '../src/agent/directorSkills';

const ctx3dMedia = { engineType: '3d' as const, mode: 'media' as const };

test('Vietnamese storyboard prompt selects cinematic skill', () => {
  const prompt = 'Làm một bộ phim 3D gồm 3 cảnh quay về chú robot';
  const ctx = inferSkillContext(prompt, { engineType: '2d', mode: 'game' });
  assert.deepEqual(ctx, { engineType: '3d', mode: 'media' });
  const ids = selectDirectorSkills(prompt, ctx).map((s) => s.id);
  assert.equal(ids[0], 'cinematic-shot-grammar');
});

test('2D platformer prompt selects level design, sound prompt adds game juice', () => {
  const prompt = 'Tạo game 2D platformer 3 màn có âm thanh khi nhặt xu';
  const ctx = inferSkillContext(prompt, ctx3dMedia);
  assert.deepEqual(ctx, { engineType: '2d', mode: 'game' });
  const ids = selectDirectorSkills(prompt, ctx).map((s) => s.id);
  assert.ok(ids.includes('platformer-level-design'), ids.join(','));
  assert.ok(ids.includes('game-juice'), ids.join(','));
  assert.ok(ids.length <= 3);
});

test('short trigger "ad" matches whole words only', () => {
  assert.equal(selectDirectorSkills('add a red cube', ctx3dMedia).some((s) => s.id === 'playable-ad-hook'), false);
  assert.equal(selectDirectorSkills('turn this into a playable ad', ctx3dMedia)[0].id, 'playable-ad-hook');
});

test('unrelated prompt selects nothing and leaves the system prompt untouched', () => {
  assert.deepEqual(selectDirectorSkills('rename the scene', ctx3dMedia), []);
  assert.equal(mergeSystemPrompt('Pastel palette', []), 'Pastel palette');
  assert.equal(buildSkillContext([]), '');
});

test('learned skill is distilled deterministically and wins for similar prompts', () => {
  const spec = createBlankSceneSpec('2d', 'Neon Rooftop Run');
  spec.mode = 'game';
  const prompt = 'neon rooftop runner with glowing coins';
  const skill = distillLearnedSkill(prompt, spec);
  assert.equal(skill.source, 'learned');
  assert.equal(skill.engine, '2d');
  assert.ok(skill.triggers.includes('rooftop'));
  assert.match(skill.guidance, /nodes2D by role/);

  const picked = selectDirectorSkills('another neon rooftop level', { engineType: '2d', mode: 'game' }, [skill]);
  assert.equal(picked[0].id, skill.id);
  assert.match(mergeSystemPrompt('', picked), /APPROVED RECIPE/);
});

test('keyword extraction drops stopwords and keeps diacritics', () => {
  const kw = extractKeywords('Tạo cảnh rừng thông với chú cáo đang chạy và rừng sương');
  assert.equal(kw[0], 'rừng');
  assert.ok(!kw.includes('với'));
});
