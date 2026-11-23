import { useEffect } from 'react';
import { useStudioStore } from './useStudioStore';

/** Input types where Ctrl+Z means "undo my typing" (the browser handles it); everything else uses the scene history. */
const TEXT_INPUT = /^(text|search|url|tel|email|password|number|date|datetime-local|month|time|week)$/;

/** True when the key event comes from a field with its own native undo stack. */
export function hasNativeUndo(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUT.test((el as HTMLInputElement).type || 'text');
  return false;
}

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo for the open scene. */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (hasNativeUndo(e.target)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      e.preventDefault();
      const s = useStudioStore.getState();
      if (isUndo) s.undo();
      else s.redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
