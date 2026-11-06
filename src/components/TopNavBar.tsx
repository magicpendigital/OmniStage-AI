import React from 'react';
import {
  Camera,
  Film,
  Gamepad2,
  Monitor,
  Redo2,
  Share2,
  Smartphone,
  Square,
  Undo2,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { AspectRatioPreset, StudioMode } from '../types/scene.schema';
import { exportCanvasSnapshotPNG } from '../exporter/mediaExporter';

export const TopNavBar: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const pastSpecs = useStudioStore((s) => s.pastSpecs);
  const futureSpecs = useStudioStore((s) => s.futureSpecs);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const setMode = useStudioStore((s) => s.setMode);
  const setAspectRatio = useStudioStore((s) => s.setAspectRatio);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);

  const modes: { id: StudioMode; label: string; icon: React.ReactNode }[] = [
    { id: 'game', label: 'Playable Game Mode', icon: <Gamepad2 className="w-3.5 h-3.5" /> },
    { id: 'media', label: 'Media Production Mode', icon: <Film className="w-3.5 h-3.5" /> },
  ];

  const ratios: { id: AspectRatioPreset; label: string; icon: React.ReactNode }[] = [
    { id: '16:9', label: '16:9 Landscape', icon: <Monitor className="w-3.5 h-3.5" /> },
    { id: '9:16', label: '9:16 TikTok / Reels', icon: <Smartphone className="w-3.5 h-3.5" /> },
    { id: '1:1', label: '1:1 Square', icon: <Square className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="h-14 px-5 bg-[#090D16] border-b border-slate-800/90 flex items-center justify-between gap-6 shrink-0 z-30">
      {/* Zone 1: Brand Title */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-display font-bold text-sm">
          OS
        </div>
        <span className="font-display font-bold text-base tracking-tight text-slate-100 whitespace-nowrap">
          OmniStage AI
        </span>
      </div>

      {/* Zone 2: Studio Mode Switcher & Aspect Ratio Framing Controls */}
      <div className="flex items-center gap-4 overflow-x-auto">
        {/* Mode Segmented Control */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          {modes.map((m) => {
            const active = sceneSpec.mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0 ${
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

      {/* Zone 3: Quick Snapshot & Primary Publish / Export Action */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={() => exportCanvasSnapshotPNG(canvasElement, sceneSpec.title)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
        >
          <Camera className="w-3.5 h-3.5 text-cyan-400" />
          <span>Snapshot PNG</span>
        </button>

        <button
          onClick={() => setPublishModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors shadow-sm whitespace-nowrap shrink-0"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Export & Publish</span>
        </button>
      </div>
    </header>
  );
};
