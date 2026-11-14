/**
 * Autosave.
 * - A project game is open: any scene change marks it dirty and saves it into the project folder ~2.5 s later.
 * - No project yet: the work is saved as a draft in ~/OmniStage/drafts (restored when the studio opens again, moved into a
 *   project when the user saves it there).
 * Also saves on Ctrl/Cmd+S and when the tab is hidden. Leaving the page with changes not yet on disk asks first.
 */
import { useEffect } from 'react';
import { useStudioStore } from '../state/useStudioStore';

const DEBOUNCE_MS = 2500;

export function useProjectAutosave() {
  useEffect(() => {
    let timer: number | undefined;
    // Changes made before the user touches anything (workspace boot, template load, draft restore) are not new work.
    let touched = false;
    let pendingDraft = false;
    const onTouch = () => { touched = true; };

    const saveDraftNow = async () => {
      window.clearTimeout(timer);
      if (!pendingDraft) return;
      pendingDraft = false;
      const ok = await useStudioStore.getState().saveDraft();
      if (!ok && !useStudioStore.getState().activeGameId) pendingDraft = true;
    };

    const unsubscribe = useStudioStore.subscribe((state, prev) => {
      const changed = state.sceneSpec !== prev.sceneSpec || state.scenes !== prev.scenes;
      if (!state.activeGameId) {
        if (!changed || !touched || state.workspaceAvailable === false) return;
        pendingDraft = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(saveDraftNow, DEBOUNCE_MS);
        return;
      }
      pendingDraft = false;
      const justOpened = state.activeGameId !== prev.activeGameId;
      if (!changed || justOpened) return;
      state.markProjectDirty();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => useStudioStore.getState().saveActiveGame(), DEBOUNCE_MS);
    });
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.clearTimeout(timer);
        if (useStudioStore.getState().activeGameId) useStudioStore.getState().saveActiveGame();
        else {
          pendingDraft = true;
          void saveDraftNow();
        }
      }
    };
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      const s = useStudioStore.getState();
      if (s.activeGameId && s.projectSaveState === 'dirty') s.saveActiveGame();
      else if (!s.activeGameId) void saveDraftNow();
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      const s = useStudioStore.getState();
      const unsaved = s.activeGameId ? s.projectSaveState === 'dirty' || s.projectSaveState === 'saving' : pendingDraft || s.draftSaveState === 'saving';
      if (!unsaved) return;
      void saveDraftNow();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onTouch, true);
    window.addEventListener('keydown', onTouch, true);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onTouch, true);
      window.removeEventListener('keydown', onTouch, true);
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
}
