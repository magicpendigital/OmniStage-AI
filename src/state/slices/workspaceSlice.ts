/**
 * Phase 7C store slice — Play test, full preview, guide, local workspace projects, extensions and memory.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { SceneSpec } from '../../types/scene.schema';
import { workspaceApi } from '../../workspace/workspaceClient';
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
    } catch {
      set({ workspaceAvailable: false });
    }
  },

  setProjectHubOpen: (open) => set({ isProjectHubOpen: open }),
  setExtensionsOpen: (open) => set({ isExtensionsOpen: open }),
  openExtensionReview: (request) => set({ extensionReview: request }),

  openProjectGame: async (project, gameId) => {
    const { bundle } = await workspaceApi.loadGame(project.id, gameId);
    const scenes: SceneSpec[] = Array.isArray(bundle?.scenes) && bundle.scenes.length ? bundle.scenes : bundle?.id ? [bundle] : [];
    if (scenes.length) get().loadProjectBundle(scenes, bundle.activeSceneId);
    set({ activeProject: project, activeGameId: gameId, projectSaveState: 'saved', isProjectHubOpen: false });
  },

  closeProject: () => set({ activeProject: null, activeGameId: null, projectSaveState: 'idle' }),

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
