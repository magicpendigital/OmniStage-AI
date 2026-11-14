/**
 * Drafts — autosaved work that is not in a project yet.
 *
 *   ~/OmniStage/drafts/<draftId>/draft.json   { meta, bundle }
 *
 * The studio saves the current scenes here a few seconds after every change while no project game is open, and restores the
 * latest draft when it starts. Saving the work into a project moves the draft into that project (`promoteDraft`) and removes it
 * from here. Drafts untouched for 30 days are reported as stale; the studio asks the user whether to keep or delete each one.
 * Deleting moves the folder to ~/OmniStage/.trash (never a hard delete).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createGame, ProjectGameEntry, ProjectMeta } from './projects';
import { assertId, moveToTrash, nowIso, omniHome, readJSON, WorkspaceError, writeJSON } from './store';

export const DRAFT_STALE_DAYS = 30;

export interface DraftMeta {
  id: string;
  title: string;
  sceneCount: number;
  engineType?: '2d' | '3d';
  mode?: 'game' | 'media';
  createdAt: string;
  updatedAt: string;
  /** When the user last chose "keep" in the stale-draft dialog (resets the 30-day clock). */
  keptAt?: string;
}

export interface DraftSummary extends DraftMeta {
  /** True when neither edited nor kept for DRAFT_STALE_DAYS. */
  stale: boolean;
  /** Days since the last edit / keep. */
  idleDays: number;
}

export function draftsRoot() {
  return join(omniHome(), 'drafts');
}

function draftFile(id: string) {
  return join(draftsRoot(), assertId(id, 'draft id'), 'draft.json');
}

function summarize(bundle: any) {
  const scenes = Array.isArray(bundle?.scenes) && bundle.scenes.length ? bundle.scenes : bundle?.id ? [bundle] : [];
  const first = scenes[0] || {};
  const storyboard = first.sequence?.storyboardTitle;
  return {
    title: String(storyboard || first.title || 'Untitled draft').slice(0, 80),
    sceneCount: scenes.length,
    engineType: first.engineType,
    mode: first.mode,
  };
}

/** Summary with the stale flag, judged at `now` (tests pass a fixed clock). */
export function summarizeDraft(meta: DraftMeta, now = Date.now()): DraftSummary {
  const last = Math.max(Date.parse(meta.updatedAt) || 0, Date.parse(meta.keptAt || '') || 0);
  const idleDays = Math.max(0, (now - last) / 86400000);
  return { ...meta, idleDays: Math.floor(idleDays), stale: idleDays >= DRAFT_STALE_DAYS };
}

export async function listDrafts(now = Date.now()): Promise<DraftSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(draftsRoot());
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  const files = await Promise.all(
    entries.filter((e) => /^[a-z0-9][a-z0-9-]*$/.test(e)).map((e) => readJSON<{ meta?: DraftMeta } | null>(join(draftsRoot(), e, 'draft.json'), null).catch(() => null))
  );
  return files
    .map((f) => f?.meta)
    .filter((m): m is DraftMeta => !!m && typeof m.id === 'string')
    .map((m) => summarizeDraft(m, now))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadDraft(id: string): Promise<{ meta: DraftMeta; bundle: unknown }> {
  const file = await readJSON<{ meta: DraftMeta; bundle: unknown } | null>(draftFile(id), null);
  if (!file) throw new WorkspaceError('Draft not found', 404);
  return file;
}

/** Creates or updates a draft (the id comes from the studio, so a session keeps writing the same draft). */
export async function saveDraft(id: string, bundle: unknown): Promise<DraftMeta> {
  if (!bundle || typeof bundle !== 'object') throw new WorkspaceError('Draft bundle must be a SceneSpec project object');
  const previous = await readJSON<{ meta: DraftMeta } | null>(draftFile(id), null);
  const meta: DraftMeta = {
    id: assertId(id, 'draft id'),
    ...summarize(bundle),
    createdAt: previous?.meta?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await writeJSON(draftFile(id), { meta, bundle });
  return meta;
}

/** "Keep" in the stale dialog: restarts the 30-day clock without touching the content. */
export async function keepDraft(id: string): Promise<DraftSummary> {
  const file = await loadDraft(id);
  file.meta.keptAt = nowIso();
  await writeJSON(draftFile(id), file);
  return summarizeDraft(file.meta);
}

export async function trashDraft(id: string): Promise<string> {
  await loadDraft(id);
  return moveToTrash(join(draftsRoot(), assertId(id, 'draft id')), `draft-${id}`);
}

/** Moves a draft into a project as a new game (the user picked where the work belongs). */
export async function promoteDraft(id: string, projectId: string, name?: string, bundle?: unknown): Promise<{ project: ProjectMeta; game: ProjectGameEntry }> {
  const draft = await loadDraft(id);
  // The studio may send the very latest state (edits newer than the last autosave).
  const content = bundle && typeof bundle === 'object' ? bundle : draft.bundle;
  const result = await createGame(projectId, String(name || draft.meta.title || 'Untitled game'), content);
  await moveToTrash(join(draftsRoot(), assertId(id, 'draft id')), `draft-${id}-saved-to-${projectId}`);
  return result;
}
