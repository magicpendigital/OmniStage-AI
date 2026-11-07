import React, { useState } from 'react';
import {
  Camera,
  Check,
  Code2,
  Download,
  FileCode2,
  Film,
  Layers,
  Smartphone,
  X,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import {
  exportCanvasSnapshotPNG,
  exportSceneSpecJSON,
  exportStandalonePlayableHTML,
  recordCanvasVideoWebM,
} from '../exporter/mediaExporter';

export const PublishModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isPublishModalOpen);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const canvasElement = useStudioStore((s) => s.canvasElement);
  const isRecordingVideo = useStudioStore((s) => s.isRecordingVideo);
  const recordingProgress = useStudioStore((s) => s.recordingProgress);
  const setRecordingState = useStudioStore((s) => s.setRecordingState);

  const [selectedDuration, setSelectedDuration] = useState<number>(5);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const is2D = sceneSpec.engineType === '2d';
  const engineLabel = is2D ? '2D Vector/Sprite Canvas' : '3D WebGL Stage';

  const triggerToast = (msg: string) => {
    setExportNotice(msg);
    setTimeout(() => setExportNotice(null), 4000);
  };

  const handleRecordVideo = async (seconds: number) => {
    if (isRecordingVideo) return;
    setRecordingState(true, 0);
    const ok = await recordCanvasVideoWebM(canvasElement, seconds, sceneSpec.title, (ratio) => {
      setRecordingState(true, Math.round(ratio * 100));
    });
    setRecordingState(false, 0);
    if (ok) {
      triggerToast(`Downloaded ${seconds}s 60fps WebM Video Stream (${engineLabel})`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-xl bg-[#0F172A] border border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#090D16] border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-base text-slate-100">
              Export Media & Publish Multi-Scene Playable Bundle
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>
                Active Scene: <span className="text-slate-200 font-medium">{sceneSpec.title}</span>
              </span>
              <span>·</span>
              <span className="font-mono text-cyan-400">
                {(sceneSpec.engineType || '3d').toUpperCase()} Engine
              </span>
              <span>·</span>
              <span className="font-mono text-amber-400">{scenes.length} Storyboard Scene(s)</span>
              <span>·</span>
              <span className="font-mono text-slate-300">{sceneSpec.aspectRatio}</span>
            </p>
          </div>
          <button
            onClick={() => setPublishModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
          {exportNotice && (
            <div className="px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{exportNotice}</span>
            </div>
          )}

          {/* Section 1: Programmatic Video & High-Res Snapshot */}
          <div className="space-y-3">
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-slate-300">
              01. Programmatic {is2D ? '2D Canvas' : '3D WebGL'} Video & Snapshot Capture
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Instant PNG Capture */}
              <div className="p-4 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                    <Camera className="w-4 h-4 text-cyan-400" />
                    <span>High-Res PNG Snapshot</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Captures the live {engineLabel} buffer at native resolution (
                    {sceneSpec.aspectRatio}).
                  </p>
                </div>
                <button
                  onClick={() => {
                    exportCanvasSnapshotPNG(canvasElement, sceneSpec.title);
                    triggerToast(`Downloaded High-Res PNG Snapshot (${engineLabel})`);
                  }}
                  className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .PNG Snapshot</span>
                </button>
              </div>

              {/* WebM Video Stream Recorder */}
              <div className="p-4 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                      <Film className="w-4 h-4 text-amber-400" />
                      <span>Record WebM Video Stream</span>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded border border-slate-800">
                      {[3, 5, 10].map((sec) => (
                        <button
                          key={sec}
                          onClick={() => setSelectedDuration(sec)}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                            selectedDuration === sec
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Streams 60fps {engineLabel} via MediaRecorder while running animations.
                  </p>
                </div>

                <button
                  onClick={() => handleRecordVideo(selectedDuration)}
                  disabled={isRecordingVideo}
                  className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>
                    {isRecordingVideo
                      ? `Recording ${selectedDuration}s Stream (${recordingProgress}%)...`
                      : `Record & Download ${selectedDuration}s .WebM`}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Ad Network Playable HTML5 Bundles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-slate-300">
                02. Standalone HTML5 Playable Ad Distribution (3D + 2D + Multi-Scene)
              </h3>
              <span className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                <span>Bundles all {scenes.length} scene(s)</span>
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  id: 'tiktok' as const,
                  title: 'TikTok Playable Ad',
                  spec: '9:16 Vertical · MRAID 3.0 Hook',
                },
                {
                  id: 'meta' as const,
                  title: 'Meta Interactive Ad',
                  spec: 'FbPlayableAd.onCTAClick Ready',
                },
                {
                  id: 'telegram' as const,
                  title: 'Telegram Mini App',
                  spec: 'WebApp Self-Contained HTML5',
                },
              ].map((net) => (
                <div
                  key={net.id}
                  className="p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                      <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                      <span>{net.title}</span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 mt-1">{net.spec}</p>
                  </div>
                  <button
                    onClick={() => {
                      exportStandalonePlayableHTML(sceneSpec, net.id, scenes);
                      triggerToast(
                        `Exported ${net.title} HTML5 Bundle (${scenes.length} scene${scenes.length > 1 ? 's' : ''})`
                      );
                    }}
                    className="w-full py-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>Export .HTML</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Multi-Coding-Agent (MCA) Contract Export */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Code2 className="w-4 h-4 text-cyan-400" />
                <span>Multi-Coding-Agent (MCA) Project & SceneSpec Bundle</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Download the declarative <code className="text-cyan-300">.scenespec.json</code>{' '}
                contract (including active <code className="text-slate-300">SceneSpec</code> and all{' '}
                {scenes.length} <code className="text-slate-300">scenes[]</code>) for Claude Code,
                Antigravity, or Codex.
              </p>
            </div>
            <button
              onClick={() => {
                exportSceneSpecJSON(sceneSpec, scenes);
                triggerToast(
                  `Exported .scenespec.json project bundle (${scenes.length} scene${scenes.length > 1 ? 's' : ''})`
                );
              }}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 shrink-0 transition-colors"
            >
              Download JSON Bundle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
