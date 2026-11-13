/**
 * Phase 7C store slice — Play test, full preview, guide, local workspace projects, extensions and memory.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { SceneSpec } from '../../types/scene.schema';
import { DraftSummary, workspaceApi } from '../../workspace/workspaceClient';
import { registerVoiceAssets } from '../../audio/voices';

const LAST_DRAFT_KEY = 'omnistage-last-draft';
function rememberDraft(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_DRAFT_KEY, id);
    else localStorage.removeItem(LAST_DRAFT_KEY);
  } catch {
    /* storage blocked: the draft still exists on disk and is listed in Projects */
  }
}
function lastDraftId(): string | null {
  try {
    return localStorage.getItem(LAST_DRAFT_KEY);
  } catch {
    return null;
  }
}
function newDraftId() {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
import { previewOrder } from '../../playtest/previewOrder';
import { buildProjectBundle } from '../studioTypes';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createWorkspaceSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({
  openPlayTest: (startSceneId) => {
    const { activeSceneId, fullPreview } = get();
    if (fullPreview) get().stopFullPreview();
    set({ playTest: { startSceneId: startSceneId || activeSceneId }, isPlaying: false });
  },
  closePlayTest: () => set({ playTest: null }),

  startFullPreview: (fromSceneId) => {
    const state = get();
    const order = previewOrder(state.scenes.length ? state.scenes : [state.sceneSpec], state.activeSceneId);
    const startIndex = Math.max(0, fromSceneId ? order.indexOf(fromSceneId) : 0);
    set({
      fullPreview: {
        order,
        index: startIndex,
        originalSceneId: state.activeSceneId,
        wasLooping: state.isLooping,
        ended: false,
        savedPast: state.pastSpecs,
        savedFuture: state.futureSpecs,
      },
      playTest: null,
      isLooping: false,
    });
    get().gotoFullPreviewScene(startIndex);
  },

  gotoFullPreviewScene: (index) => {
    const fp = get().fullPreview;
    if (!fp) return;
    const clamped = Math.max(0, Math.min(fp.order.length - 1, index));
    const id = fp.order[clamped];
    if (id !== get().activeSceneId) get().switchScene(id);
    set({ fullPreview: { ...fp, index: clamped, ended: false }, currentTime: 0, isLooping: false, isPlaying: true });
  },

  endFullPreview: () => {
    const fp = get().fullPreview;
    if (fp) set({ fullPreview: { ...fp, ended: true }, isPlaying: false });
  },

  stopFullPreview: () => {
    const fp = get().fullPreview;
    if (!fp) return;
    set({ fullPreview: null, isPlaying: false, isLooping: fp.wasLooping });
    if (fp.originalSceneId !== get().activeSceneId && get().scenes.some((s) => s.id === fp.originalSceneId)) get().switchScene(fp.originalSceneId);
    set({ currentTime: 0, pastSpecs: fp.savedPast, futureSpecs: fp.savedFuture });
  },

  openGuide: (topicId = null) => set({ guide: { open: true, topicId } }),
  closeGuide: () => set({ guide: { open: false, topicId: null } }),

  initWorkspace: async () => {
    try {
      const info = await workspaceApi.info();
      set({ workspaceAvailable: true, workspaceHome: info.home });
      await Promise.all([get().refreshExtensions(), get().refreshMemory()]);
      // Reopen the work from last time (autosaved draft) and find drafts nobody touched for 30 days.
      await get().restoreDrafts();
    } catch {
      set({ workspaceAvailable: false });
    }
  },

  setProjectHubOpen: (open) => set({ isProjectHubOpen: open }),
  setExtensionsOpen: (open) => set({ isExtensionsOpen: open }),
  openExtensionReview: (request) => set({ extensionReview: request }),

  openProjectGame: async (project, gameId) => {
    const { bundle } = await workspaceApi.loadGame(project.id, gameId);
    registerVoiceAssets(bundle?.voiceClips);
    const scenes: SceneSpec[] = Array.isArray(bundle?.scenes) && bundle.scenes.length ? bundle.scenes : bundle?.id ? [bundle] : [];
    // The project game takes over: the draft that was open stays on disk (listed in Projects), edits now save to the game.
    if (scenes.length) get().loadProjectBundle(scenes, bundle.activeSceneId);
    set({ activeProject: project, activeGameId: gameId, projectSaveState: 'saved', isProjectHubOpen: false, activeDraftId: null, draftSaveState: 'idle' });
    rememberDraft(null);
  },

  closeProject: () => set({ activeProject: null, activeGameId: null, projectSaveState: 'idle' }),

  saveDraft: async () => {
    const state = get();
    if (state.activeGameId || state.workspaceAvailable === false) return false;
    const id = state.activeDraftId || newDraftId();
    set({ activeDraftId: id, draftSaveState: 'saving' });
    rememberDraft(id);
    try {
      const meta = await workspaceApi.saveDraft(id, buildProjectBundle(get()));
      // A project may have been opened while the request was in flight.
      if (get().activeDraftId === id) set({ draftSaveState: 'saved', draftSavedAt: meta.updatedAt });
      return true;
    } catch {
      if (get().activeDraftId === id) set({ draftSaveState: 'error' });
      return false;
    }
  },

  restoreDrafts: async () => {
    let drafts: DraftSummary[] = [];
    try {
      drafts = await workspaceApi.listDrafts();
    } catch {
      return;
    }
    const last = lastDraftId();
    const target = drafts.find((d) => d.id === last && !d.stale);
    if (target && !get().activeGameId) await get().openDraft(target.id);
    set({ staleDrafts: drafts.filter((d) => d.stale && d.id !== get().activeDraftId) });
  },

  openDraft: async (id) => {
    const { meta, bundle } = await workspaceApi.loadDraft(id);
    registerVoiceAssets(bundle?.voiceClips);
    const scenes: SceneSpec[] = Array.isArray(bundle?.scenes) && bundle.scenes.length ? bundle.scenes : bundle?.id ? [bundle] : [];
    set({ activeProject: null, activeGameId: null, projectSaveState: 'idle', activeDraftId: id, draftSaveState: 'saved', draftSavedAt: meta?.updatedAt || null, isProjectHubOpen: false });
    if (scenes.length) get().loadProjectBundle(scenes, bundle.activeSceneId);
    rememberDraft(id);
  },

  promoteDraftToProject: async (project, name) => {
    const state = get();
    const bundle = buildProjectBundle(state);
    try {
      const { project: updated, game } = state.activeDraftId
        ? await workspaceApi.promoteDraft(state.activeDraftId, project.id, name, bundle)
        : await workspaceApi.createGame(project.id, name, bundle);
      set({ activeProject: updated, activeGameId: game.id, projectSaveState: 'saved', isProjectHubOpen: false, activeDraftId: null, draftSaveState: 'idle' });
      rememberDraft(null);
      return true;
    } catch {
      return false;
    }
  },

  resolveStaleDraft: async (id, action) => {
    try {
      if (action === 'keep') await workspaceApi.keepDraft(id);
      else await workspaceApi.deleteDraft(id);
    } finally {
      set({ staleDrafts: get().staleDrafts.filter((d) => d.id !== id) });
    }
  },

  startNewDraft: () => {
    set({ activeDraftId: null, draftSaveState: 'idle', draftSavedAt: null });
    rememberDraft(null);
  },

  saveActiveGame: async () => {
    const { activeProject, activeGameId } = get();
    if (!activeProject || !activeGameId) return false;
    set({ projectSaveState: 'saving' });
    try {
      await workspaceApi.saveGame(activeProject.id, activeGameId, buildProjectBundle(get()));
      set({ projectSaveState: 'saved' });
      return true;
    } catch {
      set({ projectSaveState: 'error' });
      return false;
    }
  },

  markProjectDirty: () => {
    if (get().activeGameId && get().projectSaveState !== 'dirty') set({ projectSaveState: 'dirty' });
  },

  refreshExtensions: async () => {
    try {
      set({ installedExtensions: await workspaceApi.listExtensions() });
    } catch {
      // workspace unavailable: keep current list
    }
  },

  refreshMemory: async () => {
    try {
      const file = await workspaceApi.readMemory();
      set({ memories: file.entries, memoryEnabled: file.enabled });
    } catch {
      // workspace unavailable
    }
  },

  addMemoryEntry: async (text, kind = 'preference', source = 'explicit', scope) => {
    try {
      const entry = await workspaceApi.addMemory({ text, kind, source, scope: scope || 'global' });
      set({ memories: [entry, ...get().memories.filter((m) => m.id !== entry.id)] });
      return entry;
    } catch {
      return null;
    }
  },

  setDisabledSkill: (skillId, disabled) => {
    const current = get().settings.disabledSkills || [];
    const next = disabled ? [...new Set([...current, skillId])] : current.filter((s) => s !== skillId);
    get().updateSettings({ disabledSkills: next });
  },
});
