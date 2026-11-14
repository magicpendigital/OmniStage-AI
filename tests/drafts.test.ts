/**
 * Drafts: autosaved work without a project — save / restore, moved into a project, 30-day stale detection with keep / delete
 * (to the trash), and generated voices travelling inside saved bundles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.OMNISTAGE_HOME = mkdtempSync(join(tmpdir(), 'omnistage-drafts-'));

const { saveDraft, loadDraft, listDrafts, keepDraft, trashDraft, promoteDraft, summarizeDraft, draftsRoot, DRAFT_STALE_DAYS } = await import('../server/workspace/drafts');
const { createProject, loadGame } = await import('../server/workspace/projects');
const { omniHome } = await import('../server/workspace/store');
const { createBlankSceneSpec } = await import('../src/registry/assetRegistry');
const { buildProjectBundle } = await import('../src/state/studioTypes');
const { clearVoiceClips, registerVoiceClip, registerVoiceAssets, getVoiceClip } = await import('../src/audio/voices');

function film(title: string) {
  const a = createBlankSceneSpec('3d', 'Robot lạc giữa rừng');
  a.sequence = { storyboardId: 'sb', storyboardTitle: title, kind: 'film', index: 0, total: 2 };
  const b = createBlankSceneSpec('3d', 'Cùng tới thác nước');
  return buildProjectBundle({ sceneSpec: a, scenes: [a, b] });
}

test('a draft is saved, listed with its storyboard title and restored as written', async () => {
  const meta = await saveDraft('draft-a', film('Robot và Cáo'));
  assert.equal(meta.title, 'Robot và Cáo');
  assert.equal(meta.sceneCount, 2);
  const again = await saveDraft('draft-a', film('Robot và Cáo'));
  assert.equal(again.createdAt, meta.createdAt, 'later autosaves update the same draft');
  const list = await listDrafts();
  assert.deepEqual(list.map((d) => [d.id, d.stale]), [['draft-a', false]]);
  const { bundle } = await loadDraft('draft-a');
  assert.equal((bundle as any).scenes[1].title, 'Cùng tới thác nước');
  await assert.rejects(() => saveDraft('../evil', film('x')));
  await assert.rejects(() => saveDraft('draft-b', null as any));
});

test('stale after 30 days without edits; keep restarts the clock; delete goes to the trash', async () => {
  await saveDraft('draft-old', film('Old idea'));
  const meta = (await loadDraft('draft-old')).meta;
  const later = Date.parse(meta.updatedAt) + (DRAFT_STALE_DAYS + 1) * 86400000;
  const stale = (await listDrafts(later)).find((d) => d.id === 'draft-old')!;
  assert.equal(stale.stale, true);
  assert.equal(stale.idleDays, DRAFT_STALE_DAYS + 1);
  assert.equal(summarizeDraft(meta, Date.parse(meta.updatedAt) + 29 * 86400000).stale, false);
  const kept = await keepDraft('draft-old');
  assert.equal(summarizeDraft(kept, Date.parse(kept.keptAt!) + 10 * 86400000).stale, false, 'keeping restarts the 30 days');
  const trashedTo = await trashDraft('draft-old');
  assert.ok(existsSync(trashedTo) && trashedTo.startsWith(join(omniHome(), '.trash')));
  assert.ok(!(await listDrafts()).some((d) => d.id === 'draft-old'));
});

test('saving a draft into a project moves it there (latest state wins) and removes the draft', async () => {
  const project = await createProject({ name: 'Phim Robot', kind: 'media' });
  await saveDraft('draft-move', film('Robot và Cáo'));
  const newest = film('Robot và Cáo (sửa)');
  const { game } = await promoteDraft('draft-move', project.id, 'Robot và Cáo', newest);
  assert.equal(game.sceneCount, 2);
  const saved: any = await loadGame(project.id, game.id);
  assert.equal(saved.scenes[0].sequence.storyboardTitle, 'Robot và Cáo (sửa)');
  assert.ok(!readdirSync(draftsRoot()).includes('draft-move'));
  await assert.rejects(() => promoteDraft('draft-a', 'no-such-project'));
  assert.ok(readdirSync(draftsRoot()).includes('draft-a'), 'a failed move keeps the draft');
});

test('generated voices travel inside saved bundles and come back when opened', () => {
  clearVoiceClips();
  const data = new Float32Array(2205).map((_, i) => Math.sin(i / 7) * 0.4);
  registerVoiceClip('clip-1', { sampleRate: 22050, data });
  const scene = createBlankSceneSpec('3d', 'Talk');
  scene.dialogue = [{ id: 'l', time: 1, speaker: scene.actors[0].id, text: 'Xin chào', clip: 'clip-1' }];
  const bundle: any = buildProjectBundle({ sceneSpec: scene, scenes: [scene] });
  assert.deepEqual(Object.keys(bundle.voiceClips), ['omni-voice:clip-1']);
  clearVoiceClips();
  registerVoiceAssets(bundle.voiceClips);
  assert.equal(getVoiceClip('clip-1')!.data.length, 2205);
  clearVoiceClips();
});

test('workspace paths keep the home folder separator', async () => {
  const { workspacePath } = await import('../src/workspace/workspaceClient');
  assert.equal(workspacePath(String.raw`C:\Users\me\OmniStage`, 'drafts'), String.raw`C:\Users\me\OmniStage\drafts`);
  assert.equal(workspacePath('/home/me/OmniStage/', '.trash'), '/home/me/OmniStage/.trash');
  assert.equal(workspacePath(null, 'drafts'), '~/OmniStage/drafts');
});
