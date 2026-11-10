import { create } from 'zustand';

/**
 * Workspace shell layout state (rail, flyout, AI Director mode, bottom dock, split and PiP geometry).
 * Pure UI chrome: nothing here is part of the SceneSpec contract, so it lives outside useStudioStore.
 */

export type RailPanelId = 'outliner' | 'world' | 'library' | 'hub' | 'logic' | 'audio';
export type AiDirectorMode = 'bar' | 'drawer';
export type AgentIntentMode = 'patch' | 'replace' | 'storyboard';
export type DockTabId = 'timeline' | 'storyboard' | 'captions' | 'logs';
export type SplitOrientation = 'row' | 'column';
/** 'all' | 'favorites' | 'local' | `col:<collectionId>` */
export type LibraryFilter = string;

export interface PipRect {
  /** Distance from the workspace's right and top edges, so the window stays anchored top-right on resize. */
  right: number;
  top: number;
  width: number;
}

interface PersistedShell {
  railPanel: RailPanelId | null;
  flyoutPinned: boolean;
  aiMode: AiDirectorMode;
  agentIntent: AgentIntentMode;
  dockTab: DockTabId;
  dockHeight: number;
  splitOrientation: SplitOrientation;
  splitRatio: number;
  pip: PipRect;
}

interface ShellState extends PersistedShell {
  focusMode: boolean;
  libraryFilter: LibraryFilter;

  togglePanel: (panel: RailPanelId) => void;
  closePanel: () => void;
  setFlyoutPinned: (pinned: boolean) => void;
  toggleFocusMode: () => void;
  setAiMode: (mode: AiDirectorMode) => void;
  setAgentIntent: (mode: AgentIntentMode) => void;
  setDockTab: (tab: DockTabId) => void;
  setDockHeight: (height: number) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  setSplitRatio: (ratio: number) => void;
  setPip: (patch: Partial<PipRect>) => void;
  setLibraryFilter: (filter: LibraryFilter) => void;
}

const STORAGE_KEY = 'omnistage_shell_layout_v1';

const DEFAULTS: PersistedShell = {
  railPanel: 'outliner',
  flyoutPinned: true,
  aiMode: 'bar',
  agentIntent: 'patch',
  dockTab: 'timeline',
  dockHeight: 220,
  splitOrientation: 'row',
  splitRatio: 0.5,
  pip: { right: 12, top: 12, width: 360 },
};

function loadShell(): PersistedShell {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, pip: { ...DEFAULTS.pip, ...(parsed.pip || {}) } };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: ShellState) {
  if (typeof window === 'undefined') return;
  try {
    const snapshot: PersistedShell = {
      railPanel: state.railPanel,
      flyoutPinned: state.flyoutPinned,
      aiMode: state.aiMode,
      agentIntent: state.agentIntent,
      dockTab: state.dockTab,
      dockHeight: state.dockHeight,
      splitOrientation: state.splitOrientation,
      splitRatio: state.splitRatio,
      pip: state.pip,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore quota errors
  }
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const useShellStore = create<ShellState>((set, get) => {
  const update = (patch: Partial<ShellState>) => {
    set(patch);
    persist(get());
  };

  return {
    ...loadShell(),
    focusMode: false,
    libraryFilter: 'all',

    togglePanel: (panel) => update({ railPanel: get().railPanel === panel ? null : panel, focusMode: false }),
    closePanel: () => update({ railPanel: null }),
    setFlyoutPinned: (flyoutPinned) => update({ flyoutPinned }),
    toggleFocusMode: () => set({ focusMode: !get().focusMode }),
    setAiMode: (aiMode) => update({ aiMode }),
    setAgentIntent: (agentIntent) => update({ agentIntent }),
    setDockTab: (dockTab) => update({ dockTab }),
    setDockHeight: (dockHeight) => update({ dockHeight: clamp(dockHeight, 120, 520) }),
    setSplitOrientation: (splitOrientation) => update({ splitOrientation }),
    setSplitRatio: (splitRatio) => update({ splitRatio: clamp(splitRatio, 0.2, 0.8) }),
    setPip: (patch) => update({ pip: { ...get().pip, ...patch } }),
    setLibraryFilter: (libraryFilter) => set({ libraryFilter }),
  };
});

/** True when a key event originates from a text field, so global shortcuts should stand down. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}
