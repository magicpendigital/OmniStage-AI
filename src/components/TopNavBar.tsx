import React from 'react';
import {
  Box,
  BookOpen,
  Camera,
  FilePlus2,
  Play,
  FolderOpen,
  Puzzle,
  Film,
  Gamepad2,
  Layers,
  Monitor,
  Redo2,
  Settings,
  Share2,
  Smartphone,
  Square,
  Undo2,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { workspacePath } from '../workspace/workspaceClient';
import { AspectRatioPreset, EngineType, StudioMode } from '../types/scene.schema';
import { exportCanvasSnapshotPNG } from '../exporter/mediaExporter';
import { startPreview } from '../guide/guideActions';

export const TopNavBar: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const pastSpecs = useStudioStore((s) => s.pastSpecs);
  const futureSpecs = useStudioStore((s) => s.futureSpecs);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const setEngineType = useStudioStore((s) => s.setEngineType);
  const createNewBlankScene = useStudioStore((s) => s.createNewBlankScene);
  const setMode = useStudioStore((s) => s.setMode);
  const setAspectRatio = useStudioStore((s) => s.setAspectRatio);
  const activeProject = useStudioStore((s) => s.activeProject);
  const activeGameId = useStudioStore((s) => s.activeGameId);
  const projectSaveState = useStudioStore((s) => s.projectSaveState);
  const activeDraftId = useStudioStore((s) => s.activeDraftId);
  const draftSaveState = useStudioStore((s) => s.draftSaveState);
  const draftSavedAt = useStudioStore((s) => s.draftSavedAt);
  const workspaceHome = useStudioStore((s) => s.workspaceHome);
  const setProjectHubOpen = useStudioStore((s) => s.setProjectHubOpen);
  const setExtensionsOpen = useStudioStore((s) => s.setExtensionsOpen);
  const saveActiveGame = useStudioStore((s) => s.saveActiveGame);
  const activeGame = activeProject?.games.find((g) => g.id === activeGameId);
  const openPlayTest = useStudioStore((s) => s.openPlayTest);
  const openGuide = useStudioStore((s) => s.openGuide);
  const isGameMode = sceneSpec.mode === 'game';
  const projectLabel = activeProject ? activeProject.name + (activeGame ? ' / ' + activeGame.name : '') : 'Projects';
  const saveLabel = { saving: 'Saving…', dirty: 'Unsaved', error: 'Save failed', saved: 'Saved', idle: 'Saved' }[projectSaveState];
  const saveClass = 'text-[10px] font-mono px-1.5 py-0.5 rounded border ' + (projectSaveState === 'error' ? 'border-rose-500/50 text-rose-300' : projectSaveState === 'saved' ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-400');
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);
  const setSettingsModalOpen = useStudioStore((s) => s.setSettingsModalOpen);

  const currentEngine: EngineType = sceneSpec.engineType || '3d';

  const engines: { id: EngineType; label: string; icon: React.ReactNode }[] = [
    { id: '3d', label: '3D Engine', icon: <Box className="w-3.5 h-3.5" /> },
    { id: '2d', label: '2D Engine', icon: <Layers className="w-3.5 h-3.5" /> },
  ];

  const modes: { id: StudioMode; label: string; icon: React.ReactNode }[] = [
    { id: 'game', label: 'Game Mode', icon: <Gamepad2 className="w-3.5 h-3.5" /> },
    { id: 'media', label: 'Cinema / Media', icon: <Film className="w-3.5 h-3.5" /> },
  ];

  const ratios: { id: AspectRatioPreset; label: string; icon: React.ReactNode }[] = [
    { id: '16:9', label: '16:9', icon: <Monitor className="w-3.5 h-3.5" /> },
    { id: '9:16', label: '9:16', icon: <Smartphone className="w-3.5 h-3.5" /> },
    { id: '1:1', label: '1:1', icon: <Square className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="h-14 px-4 bg-[#090D16] border-b border-slate-800/90 flex items-center justify-between gap-3 shrink-0 z-30">
      {/* Zone 1: Brand Title + Quick Blank Scene Button */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-display font-bold text-sm">
          OS
        </div>
        <span className="font-display font-bold text-base tracking-tight text-slate-100 whitespace-nowrap">
          OmniStage AI
        </span>

        <button
          onClick={() => createNewBlankScene(currentEngine)}
          title={`Create New Blank ${currentEngine.toUpperCase()} Scene`}
          className="ml-2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-[11px] font-medium text-cyan-300 transition-colors whitespace-nowrap"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          <span>New Blank {currentEngine.toUpperCase()}</span>
        </button>

        {/* Phase 6: project hub + save status */}
        <button
          onClick={() => setProjectHubOpen(true)}
          data-tour="projects"
          title="Projects: create, open and organise your games"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-[11px] font-medium text-slate-200 transition-colors whitespace-nowrap max-w-[220px]"
        >
          <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="truncate">{projectLabel}</span>
        </button>
        {!activeGameId && activeDraftId && (
          <button
            onClick={() => setProjectHubOpen(true)}
            title={`Not in a project yet: autosaved as a draft in ${workspacePath(workspaceHome, 'drafts')}. Open Projects to save it into a project.`}
            className={'text-[10px] font-mono px-1.5 py-0.5 rounded border ' + (draftSaveState === 'error' ? 'border-rose-500/50 text-rose-300' : 'border-amber-500/40 text-amber-300')}
          >
            {draftSaveState === 'saving' ? 'Saving draft…' : draftSaveState === 'error' ? 'Draft save failed' : `Draft · ${draftSavedAt ? new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'autosave'}`}
          </button>
        )}
        {activeGameId && (
          <button
            onClick={() => saveActiveGame()}
            title="Save now (autosaves a few seconds after each change)"
            className={saveClass}
          >
            {saveLabel}
          </button>
        )}
      </div>

      {/* Zone 2: Dual Engine Switcher (3D / 2D) + Mode Switcher + Aspect Ratio + Undo/Redo */}
      <div className="flex items-center gap-2.5 overflow-x-auto" data-tour="engine-mode">
        {/* Dual Engine Switcher */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          {engines.map((eng) => {
            const active = currentEngine === eng.id;
            return (
              <button
                key={eng.id}
                onClick={() => setEngineType(eng.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? eng.id === '3d'
                      ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                      : 'bg-fuchsia-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {eng.icon}
                <span>{eng.label}</span>
              </button>
            );
          })}
        </div>

        {/* Mode Segmented Control */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          {modes.map((m) => {
            const active = sceneSpec.mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* Aspect Ratio Selector */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          {ratios.map((r) => {
            const active = sceneSpec.aspectRatio === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setAspectRatio(r.id)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r.icon}
                <span>{r.label}</span>
              </button>
            );
          })}
        </div>

        {/* Undo / Redo History Stack */}
        <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          <button
            onClick={undo}
            disabled={pastSpecs.length === 0}
            title="Undo SceneSpec Mutation"
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={futureSpecs.length === 0}
            title="Redo SceneSpec Mutation"
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Zone 3: Settings Gear, Quick Snapshot & Primary Publish / Export Action */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Phase 6 batch 2: Play Test (game) / full Preview (media) */}
        <button
          data-tour="play"
          onClick={() => (isGameMode ? openPlayTest() : startPreview())}
          title={isGameMode ? 'Play Test: run the exact build you publish (also on your phone)' : 'Preview: play every scene from start to end'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{isGameMode ? 'Play Test' : 'Preview'}</span>
        </button>

        <button
          data-tour="guide"
          onClick={() => openGuide()}
          title="Guide: how OmniStage works"
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors shrink-0"
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-300" />
          <span className="hidden xl:inline">Guide</span>
        </button>

        <button
          onClick={() => setExtensionsOpen(true)}
          title="Extensions: skills, VFX/SFX packs, asset libraries and tools"
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors shrink-0"
        >
          <Puzzle className="w-3.5 h-3.5 text-violet-400" />
          <span className="hidden xl:inline">Extensions</span>
        </button>

        <button
          onClick={() => setSettingsModalOpen(true)}
          title="Studio Settings, AI Models & External Asset Libraries"
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors shrink-0"
        >
          <Settings className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden xl:inline">Settings</span>
        </button>

        <button
          onClick={() => exportCanvasSnapshotPNG(canvasElement, sceneSpec.title)}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
        >
          <Camera className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden lg:inline">Snapshot</span>
        </button>

        <button
          onClick={() => setPublishModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors shadow-sm whitespace-nowrap shrink-0"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Export & Publish</span>
        </button>
      </div>
    </header>
  );
};
