/**
 * Phase 6 — Autosave: when a project game is open, any scene change marks it dirty and saves ~2.5 s later.
 * Also saves on Ctrl/Cmd+S and when the tab is hidden.
 */
import { useEffect } from 'react';
import { useStudioStore } from '../state/useStudioStore';

const DEBOUNCE_MS = 2500;

export function useProjectAutosave() {
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = useStudioStore.subscribe((state, prev) => {
      if (!state.activeGameId) return;
      const changed = state.sceneSpec !== prev.sceneSpec || state.scenes !== prev.scenes;
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
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
}
