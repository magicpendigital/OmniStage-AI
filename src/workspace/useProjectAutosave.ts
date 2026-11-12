/**
 * Phase 6 — Autosave: when a project game is open, any scene change marks it dirty and saves ~2.5 s later.
 * Also saves on Ctrl/Cmd+S and when the tab is hidden. Without an open project nothing is saved, so leaving the page after
 * real work (an AI film takes minutes) asks the browser to confirm first.
 */
import { useEffect } from 'react';
import { useStudioStore } from '../state/useStudioStore';

const DEBOUNCE_MS = 2500;

export function useProjectAutosave() {
  useEffect(() => {
    let timer: number | undefined;
    // Changes made before the user touches anything (workspace boot, template load) are not "work".
    let touched = false;
    let unsavedWithoutProject = false;
    const onTouch = () => { touched = true; };
    const unsubscribe = useStudioStore.subscribe((state, prev) => {
      const changed = state.sceneSpec !== prev.sceneSpec || state.scenes !== prev.scenes;
      if (!state.activeGameId) {
        if (changed && touched) unsavedWithoutProject = true;
        return;
      }
      unsavedWithoutProject = false;
      const justOpened = state.activeGameId !== prev.activeGameId;
      if (!changed || justOpened) return;
      state.markProjectDirty();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => useStudioStore.getState().saveActiveGame(), DEBOUNCE_MS);
    });
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && useStudioStore.getState().activeGameId) {
        e.preventDefault();
        window.clearTimeout(timer);
        useStudioStore.getState().saveActiveGame();
      }
    };
    const onHide = () => {
      const s = useStudioStore.getState();
      if (document.visibilityState === 'hidden' && s.activeGameId && s.projectSaveState === 'dirty') s.saveActiveGame();
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!unsavedWithoutProject || useStudioStore.getState().activeGameId) return;
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
