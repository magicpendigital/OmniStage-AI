import { useEffect } from 'react';
import { useStudioStore } from './useStudioStore';
import { isTypingTarget } from './useShellStore';
import { startPreview } from '../guide/guideActions';

/** What the main Play button does for the open scene: Play Test (games) or full Preview (films). */
export function runCurrent() {
  const s = useStudioStore.getState();
  if (s.sceneSpec.mode === 'game') s.openPlayTest();
  else startPreview();
}

/**
 * Global play shortcuts.
 *  F5     run the build: Play Test for a game, Preview for a film (F5 again closes it).
 *  Space  play / pause the timeline in the editor (never while typing, on a focused control, or inside a full-screen run).
 */
export function usePlayShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStudioStore.getState();
      if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (s.playTest) s.closePlayTest();
        else if (s.fullPreview) s.stopFullPreview();
        else runCurrent();
        return;
      }
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e) || s.playTest || s.fullPreview) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('button, a, summary, [role="tab"], [role="separator"], input, select, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      s.togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
