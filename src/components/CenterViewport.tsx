import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Video,
} from 'lucide-react';
import { StageCanvas } from '../renderer/StageCanvas';
import { useStudioStore } from '../state/useStudioStore';
import { CameraMode } from '../types/scene.schema';
import { runVisionQAInspection } from '../agent/studioAgent';
import { recordCanvasVideoWebM } from '../exporter/mediaExporter';

export const CenterViewport: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const currentTime = useStudioStore((s) => s.currentTime);
  const gameScore = useStudioStore((s) => s.gameScore);
  const gameTimeRemaining = useStudioStore((s) => s.gameTimeRemaining);
  const gameWon = useStudioStore((s) => s.gameWon);
  const scorePopups = useStudioStore((s) => s.scorePopups);
  const isBottomDockCollapsed = useStudioStore((s) => s.isBottomDockCollapsed);
  const isVisionRunning = useStudioStore((s) => s.isVisionRunning);
  const isRecordingVideo = useStudioStore((s) => s.isRecordingVideo);
  const recordingProgress = useStudioStore((s) => s.recordingProgress);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const togglePlay = useStudioStore((s) => s.togglePlay);
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);
  const setCameraMode = useStudioStore((s) => s.setCameraMode);
  const resetGameSession = useStudioStore((s) => s.resetGameSession);
  const setBottomDockCollapsed = useStudioStore((s) => s.setBottomDockCollapsed);
  const setVisionRunning = useStudioStore((s) => s.setVisionRunning);
  const setLatestVisionReport = useStudioStore((s) => s.setLatestVisionReport);
  const addChatMessage = useStudioStore((s) => s.addChatMessage);
  const setRecordingState = useStudioStore((s) => s.setRecordingState);

  const handleRunVisionQA = async () => {
    if (isVisionRunning) return;
    setVisionRunning(true);
    try {
      const report = await runVisionQAInspection(canvasElement, sceneSpec);
      setLatestVisionReport(report);
      addChatMessage({
        id: `msg-vision-${Date.now()}`,
        role: 'assistant',
        content: `Vision QA Diagnostic Complete (Score: ${report.overallScore}/100). ${report.summary} Review the diagnostic report below and click "Apply Recommended Fixes" to update the SceneSpec.`,
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

  // Aspect ratio container styling so 16:9, 9:16, and 1:1 frame accurately inside the stage
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

          {/* Top-Left Minimal Spec & Playable Score Overlay (Solid dark surface — no backdrop-filter over WebGL) */}
          <div className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between pointer-events-none z-10">
            <div className="px-3 py-1.5 rounded-lg bg-[#090D16E6] border border-slate-800 flex items-center gap-2.5 text-xs">
              <span className="font-display font-semibold text-slate-100">{sceneSpec.title}</span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-cyan-400 tabular-nums">{sceneSpec.aspectRatio}</span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-slate-400 uppercase">{sceneSpec.camera.mode}</span>
            </div>

            {sceneSpec.mode === 'game' && (
              <div className="flex items-center gap-2 pointer-events-auto">
                <div className="px-3 py-1.5 rounded-lg bg-[#090D16F0] border border-amber-500/40 flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="text-amber-400 font-semibold">
                    SCORE: {gameScore} / {sceneSpec.gameRules.targetScore}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-200">
                    TIME: {Math.ceil(gameTimeRemaining)}s
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

          {/* Floating Score Popups on Actor Click */}
          <div className="absolute top-16 right-4 flex flex-col items-end gap-1.5 pointer-events-none z-10">
            {scorePopups.slice(-3).map((p) => (
              <div
                key={p.id}
                className="px-2.5 py-1 rounded bg-[#090D16E6] border border-amber-500/50 text-xs font-mono font-semibold text-amber-300 shadow-lg"
              >
                {p.text}
              </div>
            ))}
          </div>

          {/* Playable Victory Banner when Target Score Reached */}
          {sceneSpec.mode === 'game' && gameWon && (
            <div className="absolute inset-x-0 top-1/4 flex justify-center pointer-events-none z-20">
              <div className="px-6 py-4 rounded-xl bg-[#090D16F5] border-2 border-amber-400 shadow-2xl flex flex-col items-center gap-2 pointer-events-auto">
                <div className="flex items-center gap-2 text-amber-400 font-display font-bold text-base">
                  <Trophy className="w-5 h-5" />
                  <span>STAGE COMPLETE · {gameScore} PTS!</span>
                </div>
                <p className="text-xs text-slate-300">
                  Playable Ad conversion goal unlocked. Ready for CTA redirect!
                </p>
                <button
                  onClick={resetGameSession}
                  className="mt-1 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors"
                >
                  Replay Mini-Game
                </button>
              </div>
            </div>
          )}

          {/* Programmatic Marketing CTA Overlay Banner */}
          {sceneSpec.marketingOverlay.enabled && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 w-[min(460px,92%)] px-4 py-3 rounded-xl bg-[#090D16EB] border border-slate-800 shadow-xl flex items-center justify-between gap-4 z-10 transition-all ${
                isBottomDockCollapsed ? 'bottom-5' : 'bottom-20'
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
                onClick={() => setBottomDockCollapsed(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-wide text-slate-950 shrink-0 transition-transform active:scale-95"
                style={{ backgroundColor: sceneSpec.marketingOverlay.brandColor || '#F59E0B' }}
              >
                {sceneSpec.marketingOverlay.ctaText}
              </button>
            </div>
          )}

          {/* Collapsible Unified Bottom Timeline & Camera Control Dock */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(860px,96%)] z-20 flex flex-col items-center">
            <button
              onClick={() => setBottomDockCollapsed(!isBottomDockCollapsed)}
              className="px-3 py-1 rounded-t-md bg-[#090D16F0] border border-b-0 border-slate-800 text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              {isBottomDockCollapsed ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  <span>Show Timeline & QA Controls</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>Hide Dock</span>
                </>
              )}
            </button>

            {!isBottomDockCollapsed && (
              <div className="w-full px-3.5 py-2.5 rounded-xl bg-[#090D16F2] border border-slate-800 shadow-2xl flex items-center justify-between gap-4">
                {/* Play / Pause & Scrubber */}
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <button
                    onClick={togglePlay}
                    className="w-8 h-8 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center shrink-0 transition-colors"
                    title={isPlaying ? 'Pause Timeline' : 'Play Timeline'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>

                  <div className="flex-1 flex flex-col gap-1 min-w-[120px]">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                      <span>Timeline Keyframes</span>
                      <span>
                        {currentTime.toFixed(1)}s / {sceneSpec.durationSeconds.toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={sceneSpec.durationSeconds || 8}
                      step={0.1}
                      value={currentTime}
                      onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                  </div>
                </div>

                {/* Camera Rig Selector */}
                <div className="hidden xl:flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 shrink-0">
                  {(
                    [
                      { id: 'orbit', label: 'Orbit' },
                      { id: 'cinematic-flythrough', label: 'Flythrough' },
                      { id: 'follow-target', label: 'Follow' },
                      { id: 'isometric-game', label: 'Isometric' },
                    ] as { id: CameraMode; label: string }[]
                  ).map((cam) => (
                    <button
                      key={cam.id}
                      onClick={() => setCameraMode(cam.id)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                        sceneSpec.camera.mode === cam.id
                          ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}
                </div>

                {/* Quick 5s Video Record & Vision QA Snapshot Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleQuickRecord5s}
                    disabled={isRecordingVideo}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
                  >
                    <Video className="w-3.5 h-3.5 text-rose-400" />
                    <span>
                      {isRecordingVideo ? `Recording ${recordingProgress}%` : 'Record 5s WebM'}
                    </span>
                  </button>

                  <button
                    onClick={handleRunVisionQA}
                    disabled={isVisionRunning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-semibold text-cyan-300 transition-colors whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isVisionRunning ? 'Scanning Stage...' : 'Visual QA Snapshot'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};
