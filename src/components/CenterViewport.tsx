import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Maximize2,
  Move,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Trash2,
  Trophy,
  Video,
} from 'lucide-react';
import { StageCanvas } from '../renderer/StageCanvas';
import { useStudioStore } from '../state/useStudioStore';
import { AnimationType, CameraMode, TransformMode } from '../types/scene.schema';
import { runVisionQAInspection } from '../agent/studioAgent';
import { recordCanvasVideoWebM } from '../exporter/mediaExporter';

export const CenterViewport: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const transformMode = useStudioStore((s) => s.transformMode);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const isLooping = useStudioStore((s) => s.isLooping);
  const currentTime = useStudioStore((s) => s.currentTime);
  const gameScore = useStudioStore((s) => s.gameScore);
  const gameTimeRemaining = useStudioStore((s) => s.gameTimeRemaining);
  const gameWon = useStudioStore((s) => s.gameWon);
  const gameEnded = useStudioStore((s) => s.gameEnded);
  const scorePopups = useStudioStore((s) => s.scorePopups);
  const isBottomDockCollapsed = useStudioStore((s) => s.isBottomDockCollapsed);
  const isVisionRunning = useStudioStore((s) => s.isVisionRunning);
  const isRecordingVideo = useStudioStore((s) => s.isRecordingVideo);
  const recordingProgress = useStudioStore((s) => s.recordingProgress);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const setTransformMode = useStudioStore((s) => s.setTransformMode);
  const updateActorProperty = useStudioStore((s) => s.updateActorProperty);
  const duplicateActor = useStudioStore((s) => s.duplicateActor);
  const removeActor = useStudioStore((s) => s.removeActor);
  const togglePlay = useStudioStore((s) => s.togglePlay);
  const toggleLoop = useStudioStore((s) => s.toggleLoop);
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);
  const setCameraMode = useStudioStore((s) => s.setCameraMode);
  const resetGameSession = useStudioStore((s) => s.resetGameSession);
  const dismissEndCard = useStudioStore((s) => s.dismissEndCard);
  const setBottomDockCollapsed = useStudioStore((s) => s.setBottomDockCollapsed);
  const setVisionRunning = useStudioStore((s) => s.setVisionRunning);
  const setLatestVisionReport = useStudioStore((s) => s.setLatestVisionReport);
  const addChatMessage = useStudioStore((s) => s.addChatMessage);
  const setRecordingState = useStudioStore((s) => s.setRecordingState);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);

  const selectedActor = sceneSpec.actors.find((a) => a.id === selectedActorId) || null;
  const duration = Math.max(2, sceneSpec.durationSeconds || 8);

  const handleRunVisionQA = async () => {
    if (isVisionRunning) return;
    setVisionRunning(true);
    try {
      const report = await runVisionQAInspection(canvasElement, sceneSpec);
      setLatestVisionReport(report);
      addChatMessage({
        id: `msg-vision-${Date.now()}`,
        role: 'assistant',
        content: `Vision QA Diagnostic Complete (Score: ${report.overallScore}/100). ${report.summary} Review the diagnostic report and click "Apply Recommended Fixes" to update the SceneSpec.`,
        timestamp: report.timestamp,
        visionReport: report,
      });
    } finally {
      setVisionRunning(false);
    }
  };

  const handleQuickRecord5s = async () => {
    if (isRecordingVideo || !canvasElement) return;
    setRecordingState(true, 0);
    await recordCanvasVideoWebM(canvasElement, 5, sceneSpec.title, (ratio) => {
      setRecordingState(true, Math.round(ratio * 100));
    });
    setRecordingState(false, 0);
  };

  const getStageFrameClass = () => {
    switch (sceneSpec.aspectRatio) {
      case '9:16':
        return 'h-full aspect-[9/16] max-w-full';
      case '1:1':
        return 'h-full aspect-square max-w-full';
      case '16:9':
      default:
        return 'w-full h-full';
    }
  };

  return (
    <main className="flex-1 h-full bg-[#060911] relative flex flex-col items-center justify-center overflow-hidden">
      {/* Aspect-Ratio Framed 3D Viewport Stage */}
      <div className="flex-1 w-full h-full flex items-center justify-center p-3 overflow-hidden">
        <div
          className={`relative rounded-xl overflow-hidden border border-slate-800/90 shadow-2xl bg-[#0B101B] transition-all duration-300 ${getStageFrameClass()}`}
        >
          {/* R3F WebGL Canvas */}
          <StageCanvas />

          {/* Top Bar Inside Viewport: Scene Info + Playable Score/Timer */}
          <div className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between pointer-events-none z-10 gap-2">
            <div className="px-3 py-1.5 rounded-lg bg-[#090D16E6] border border-slate-800 flex items-center gap-2 text-xs truncate">
              <span className="font-display font-semibold text-slate-100 truncate">
                {sceneSpec.title}
              </span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-cyan-400 tabular-nums">{sceneSpec.aspectRatio}</span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-slate-400">{sceneSpec.camera.mode}</span>
            </div>

            {sceneSpec.mode === 'game' && (
              <div className="flex items-center gap-2 pointer-events-auto shrink-0">
                <div className="px-3 py-1.5 rounded-lg bg-[#090D16F0] border border-amber-500/40 flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="text-amber-400 font-semibold">
                    SCORE: {gameScore} / {sceneSpec.gameRules.targetScore}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span
                    className={
                      gameTimeRemaining <= 5 ? 'text-rose-400 font-bold' : 'text-slate-200'
                    }
                  >
                    {Math.ceil(gameTimeRemaining)}s
                  </span>
                </div>
                <button
                  onClick={resetGameSession}
                  title="Reset Playable Score & Timer"
                  className="p-1.5 rounded-lg bg-[#090D16F0] hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* PHASE 2 FLOATING ACTOR INSPECTOR & GIZMO TOOLBAR */}
          {selectedActor && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl bg-[#090D16F2] border border-cyan-500/40 shadow-2xl flex items-center gap-2.5 z-20 max-w-[95%] overflow-x-auto">
              <span className="text-xs font-semibold text-cyan-300 whitespace-nowrap pr-1 border-r border-slate-800">
                {selectedActor.name}
              </span>

              {/* Gizmo Mode Buttons: Move [W], Rotate [E], Scale [R] */}
              <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                {(
                  [
                    { id: 'translate', label: 'Move [W]', icon: <Move className="w-3 h-3" /> },
                    { id: 'rotate', label: 'Rotate [E]', icon: <RotateCw className="w-3 h-3" /> },
                    { id: 'scale', label: 'Scale [R]', icon: <Maximize2 className="w-3 h-3" /> },
                  ] as { id: TransformMode; label: string; icon: React.ReactNode }[]
                ).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setTransformMode(g.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      transformMode === g.id
                        ? 'bg-cyan-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {g.icon}
                    <span>{g.label}</span>
                  </button>
                ))}
              </div>

              {/* Color Swatch Picker */}
              <label
                title="Change Actor Primary Color"
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800 cursor-pointer shrink-0"
              >
                <input
                  type="color"
                  value={selectedActor.primaryColor}
                  onChange={(e) =>
                    updateActorProperty(selectedActor.id, { primaryColor: e.target.value })
                  }
                  className="w-4 h-4 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="text-[10px] font-mono text-slate-300">
                  {selectedActor.primaryColor}
                </span>
              </label>

              {/* Active Animation Selector */}
              <select
                value={selectedActor.activeAnimation}
                onChange={(e) =>
                  updateActorProperty(selectedActor.id, {
                    activeAnimation: e.target.value as AnimationType,
                  })
                }
                className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {(['idle', 'bounce', 'spin', 'walk', 'attack', 'float'] as AnimationType[]).map(
                  (anim) => (
                    <option key={anim} value={anim}>
                      Anim: {anim}
                    </option>
                  )
                )}
              </select>

              {/* Duplicate & Delete Buttons */}
              <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
                <button
                  onClick={() => duplicateActor(selectedActor.id)}
                  title="Duplicate Actor"
                  className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => removeActor(selectedActor.id)}
                  title="Delete Actor"
                  className="p-1.5 rounded bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Game Mode Instructions Helper Bar */}
          {sceneSpec.mode === 'game' && !gameEnded && (
            <div className="absolute top-28 left-3.5 px-3 py-1 rounded-md bg-[#090D16D9] border border-slate-800/80 text-[11px] text-slate-300 pointer-events-none z-10">
              {sceneSpec.gameRules.instructions}
            </div>
          )}

          {/* Floating Score Popups on Actor Click / Collision */}
          <div className="absolute top-28 right-4 flex flex-col items-end gap-1.5 pointer-events-none z-10">
            {scorePopups.slice(-3).map((p) => (
              <div
                key={p.id}
                className="px-2.5 py-1 rounded bg-[#090D16E6] border border-amber-500/50 text-xs font-mono font-semibold text-amber-300 shadow-lg"
              >
                {p.text}
              </div>
            ))}
          </div>

          {/* PHASE 2 PLAYABLE AD END-CARD OVERLAY (Triggered on Win or Timer Expiry) */}
          {sceneSpec.mode === 'game' && gameEnded && (
            <div className="absolute inset-0 bg-black/75 flex items-center justify-center p-6 z-30">
              <div className="w-full max-w-md p-6 rounded-2xl bg-[#090D16] border-2 border-amber-400/80 shadow-2xl flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400">
                  <Trophy className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-400">
                    {gameWon ? 'PLAYABLE GOAL UNLOCKED' : 'TIME UP · PLAYABLE END-CARD'}
                  </div>
                  <h3 className="font-display font-bold text-xl text-white">
                    {sceneSpec.marketingOverlay.headline}
                  </h3>
                  <p className="text-xs text-slate-300">
                    {sceneSpec.marketingOverlay.subheadline}
                  </p>
                </div>

                <div className="w-full py-2.5 px-4 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-around text-xs font-mono tabular-nums">
                  <div>
                    <span className="text-slate-400 block text-[10px]">FINAL SCORE</span>
                    <span className="text-amber-400 font-bold text-sm">{gameScore} PTS</span>
                  </div>
                  <div className="h-6 w-px bg-slate-800" />
                  <div>
                    <span className="text-slate-400 block text-[10px]">TARGET GOAL</span>
                    <span className="text-cyan-300 font-bold text-sm">
                      {sceneSpec.gameRules.targetScore} PTS
                    </span>
                  </div>
                </div>

                <div className="w-full flex flex-col sm:flex-row gap-2.5 pt-1">
                  <button
                    onClick={() => setPublishModalOpen(true)}
                    className="flex-1 py-2.5 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider text-slate-950 shadow-lg transition-transform active:scale-95"
                    style={{
                      backgroundColor: sceneSpec.marketingOverlay.brandColor || '#F59E0B',
                    }}
                  >
                    {sceneSpec.marketingOverlay.ctaText}
                  </button>
                  <button
                    onClick={resetGameSession}
                    className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
                  >
                    Replay Game
                  </button>
                  <button
                    onClick={dismissEndCard}
                    className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Edit Stage
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Programmatic Marketing CTA Banner (When End-Card is not covering) */}
          {sceneSpec.marketingOverlay.enabled && !gameEnded && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 w-[min(460px,92%)] px-4 py-2.5 rounded-xl bg-[#090D16EB] border border-slate-800 shadow-xl flex items-center justify-between gap-4 z-10 transition-all ${
                isBottomDockCollapsed ? 'bottom-5' : 'bottom-24'
              }`}
            >
              <div className="min-w-0">
                {sceneSpec.marketingOverlay.badgeText && (
                  <div
                    className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-0.5"
                    style={{ color: sceneSpec.marketingOverlay.brandColor || '#F59E0B' }}
                  >
                    {sceneSpec.marketingOverlay.badgeText}
                  </div>
                )}
                <div className="font-display font-bold text-sm text-slate-100 truncate">
                  {sceneSpec.marketingOverlay.headline}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {sceneSpec.marketingOverlay.subheadline}
                </div>
              </div>
              <button
                onClick={() => setPublishModalOpen(true)}
                className="px-3.5 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-wide text-slate-950 shrink-0 transition-transform active:scale-95"
                style={{ backgroundColor: sceneSpec.marketingOverlay.brandColor || '#F59E0B' }}
              >
                {sceneSpec.marketingOverlay.ctaText}
              </button>
            </div>
          )}

          {/* PHASE 2 INTERACTIVE TIMELINE SEQUENCER & CAMERA TRACK DOCK */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(900px,96%)] z-20 flex flex-col items-center">
            <button
              onClick={() => setBottomDockCollapsed(!isBottomDockCollapsed)}
              className="px-3 py-1 rounded-t-md bg-[#090D16F0] border border-b-0 border-slate-800 text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              {isBottomDockCollapsed ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  <span>Show Sequencer & Camera Dock</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>Hide Dock</span>
                </>
              )}
            </button>

            {!isBottomDockCollapsed && (
              <div className="w-full px-3.5 py-2.5 rounded-xl bg-[#090D16F5] border border-slate-800 shadow-2xl flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  {/* Play / Pause + Loop Toggle + Scrubber */}
                  <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                    <button
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center shrink-0 transition-colors"
                      title={isPlaying ? 'Pause Sequencer' : 'Play Sequencer'}
                    >
                      {isPlaying ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={toggleLoop}
                      title="Toggle Loop Playback"
                      className={`p-2 rounded-lg border text-xs transition-colors shrink-0 ${
                        isLooping
                          ? 'bg-slate-800 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Repeat className="w-3.5 h-3.5" />
                    </button>

                    {/* Timeline Scrubber with Visual Trigger Markers */}
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-300 tabular-nums">
                        <span className="text-slate-400">Timeline Sequencer</span>
                        <span>
                          {currentTime.toFixed(1).padStart(4, '0')}s /{' '}
                          {duration.toFixed(1).padStart(4, '0')}s
                        </span>
                      </div>

                      <div className="relative flex items-center">
                        <input
                          type="range"
                          min={0}
                          max={duration}
                          step={0.05}
                          value={currentTime}
                          onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                          className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg relative z-10"
                        />
                      </div>

                      {/* Visual Actor/VFX Cue Track Markers */}
                      <div className="relative h-2 w-full bg-slate-900/90 rounded overflow-hidden flex items-center">
                        {sceneSpec.actors.map((act) => {
                          const st = act.startTime ?? 0;
                          const et = act.endTime ?? duration;
                          const leftPct = Math.min(100, Math.max(0, (st / duration) * 100));
                          const widthPct = Math.min(
                            100 - leftPct,
                            Math.max(4, ((et - st) / duration) * 100)
                          );
                          return (
                            <div
                              key={act.id}
                              title={`${act.name}: ${st.toFixed(1)}s – ${et.toFixed(1)}s`}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                backgroundColor: act.primaryColor || '#06B6D4',
                              }}
                              className="absolute top-0.5 bottom-0.5 rounded-sm opacity-65"
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Camera Track Selector Dropdown */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                      Camera:
                    </span>
                    <select
                      value={sceneSpec.camera.mode}
                      onChange={(e) => setCameraMode(e.target.value as CameraMode)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="orbit-360">orbit-360 (Turntable)</option>
                      <option value="dolly-zoom-in">dolly-zoom-in (Hero Push)</option>
                      <option value="crane-reveal">crane-reveal (Sweep Up)</option>
                      <option value="top-down-isometric">top-down-isometric (Arena)</option>
                      <option value="first-person-follow">first-person-follow</option>
                      <option value="cinematic-flythrough">cinematic-flythrough (Spline)</option>
                    </select>
                  </div>

                  {/* Record 5s WebM & Visual QA Snapshot Triggers */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleQuickRecord5s}
                      disabled={isRecordingVideo}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
                    >
                      <Video className="w-3.5 h-3.5 text-rose-400" />
                      <span>
                        {isRecordingVideo ? `Rec ${recordingProgress}%` : 'Record 5s WebM'}
                      </span>
                    </button>

                    <button
                      onClick={handleRunVisionQA}
                      disabled={isVisionRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-semibold text-cyan-300 transition-colors whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isVisionRunning ? 'Scanning...' : 'Visual QA Snapshot'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};
