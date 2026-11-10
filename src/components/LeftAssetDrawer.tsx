import React, { useEffect, useRef } from 'react';
import {
  AudioLines,
  Globe2,
  Library,
  ListTree,
  Maximize,
  Mountain,
  Pin,
  PinOff,
  Workflow,
  X,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { RailPanelId, useShellStore } from '../state/useShellStore';
import { OnlineAssetBrowser } from './OnlineAssetBrowser';
import { OutlinerPanel } from './panels/OutlinerPanel';
import { WorldPanel } from './panels/WorldPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { LogicPanel } from './panels/LogicPanel';
import { AudioPanel } from './panels/AudioPanel';
import { IconBtn, Kbd } from './ui';

const PANELS: { id: RailPanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'outliner', label: 'Scene Graph (Outliner)', icon: <ListTree size={18} /> },
  { id: 'world', label: 'World & Environment', icon: <Mountain size={18} /> },
  { id: 'library', label: 'Asset Library', icon: <Library size={18} /> },
  { id: 'hub', label: 'Online Asset Hub', icon: <Globe2 size={18} /> },
  { id: 'logic', label: 'Game Logic & Events', icon: <Workflow size={18} /> },
  { id: 'audio', label: 'Audio & Voiceover', icon: <AudioLines size={18} /> },
];

/** 48px icon rail: six authoring panels plus the Focus Mode toggle. */
export const IconRail: React.FC = () => {
  const railPanel = useShellStore((s) => s.railPanel);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const toggleFocusMode = useShellStore((s) => s.toggleFocusMode);

  return (
    <nav className="rail" aria-label="Authoring panels">
      {PANELS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`rail-b ${railPanel === p.id ? 'on' : ''}`}
          title={p.label}
          aria-label={p.label}
          aria-pressed={railPanel === p.id}
          onClick={() => togglePanel(p.id)}
        >
          {p.icon}
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        className="rail-b"
        title="Focus Mode: hide all panels  [\]"
        aria-label="Focus Mode: hide all panels"
        onClick={toggleFocusMode}
      >
        <Maximize size={18} />
      </button>
      <Kbd>\</Kbd>
    </nav>
  );
};

/** The active rail panel, either pinned beside the workspace or floating over it. */
export const PanelFlyout: React.FC = () => {
  const ref = useRef<HTMLElement | null>(null);
  const railPanel = useShellStore((s) => s.railPanel);
  const pinned = useShellStore((s) => s.flyoutPinned);
  const setFlyoutPinned = useShellStore((s) => s.setFlyoutPinned);
  const closePanel = useShellStore((s) => s.closePanel);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const is2D = sceneSpec.engineType === '2d';

  // A floating flyout dismisses itself on Escape or a click on the workspace behind it.
  useEffect(() => {
    if (pinned || !railPanel) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest('.rail, .menu')) return;
      closePanel();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePanel();
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinned, railPanel, closePanel]);

  if (!railPanel) return null;
  const meta = PANELS.find((p) => p.id === railPanel)!;

  const summary =
    railPanel === 'outliner'
      ? is2D
        ? `${(sceneSpec.nodes2D || []).length} layers`
        : `${sceneSpec.actors.length} actors · ${sceneSpec.vfx.length} vfx`
      : railPanel === 'logic'
        ? `${sceneSpec.logicGraph?.nodes.length || 0} nodes`
        : '';

  return (
    <aside ref={ref} className={`flyout ${pinned ? 'pinned' : 'float glass'}`} aria-label={meta.label}>
      <div className="flyout-head">
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg">{meta.label}</h2>
        {summary && <span className="mr-1 shrink-0 font-mono text-[10px] text-dim">{summary}</span>}
        <IconBtn
          small
          label={pinned ? 'Unpin: float over the stage' : 'Pin: dock beside the stage'}
          active={pinned}
          onClick={() => setFlyoutPinned(!pinned)}
        >
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </IconBtn>
        <IconBtn small label="Close panel" onClick={closePanel}>
          <X size={14} />
        </IconBtn>
      </div>
      <div className="flyout-body">
        {railPanel === 'outliner' && <OutlinerPanel />}
        {railPanel === 'world' && <WorldPanel />}
        {railPanel === 'library' && <LibraryPanel />}
        {railPanel === 'hub' && <OnlineAssetBrowser />}
        {railPanel === 'logic' && <LogicPanel />}
        {railPanel === 'audio' && <AudioPanel />}
      </div>
    </aside>
  );
};
