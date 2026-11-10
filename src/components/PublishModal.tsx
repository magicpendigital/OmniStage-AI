import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Camera,
  Check,
  ChevronRight,
  Code2,
  Download,
  FileCode2,
  Film,
  Gamepad2,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Smartphone,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { formatBytes, PlayableBudgetReport } from '../exporter/playableBundle';
import {
  detectSupportedVideoMimes,
  exportCanvasSnapshotPNG,
  exportSceneSpecJSON,
  exportStandaloneGameZIP,
  exportStandalonePlayableHTML,
  MultiSceneRecordingProgress,
  recordCanvasVideoWebM,
  recordMultiSceneSequence,
  StandaloneAdNetwork,
} from '../exporter/mediaExporter';

type PublishTab = 'sequencer' | 'bundler' | 'snapshot';

export const PublishModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isPublishModalOpen);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const activeSceneId = useStudioStore((s) => s.activeSceneId);
  const switchScene = useStudioStore((s) => s.switchScene);
  const canvasElement = useStudioStore((s) => s.canvasElement);
  const isRecordingVideo = useStudioStore((s) => s.isRecordingVideo);
  const setRecordingState = useStudioStore((s) => s.setRecordingState);

  // Active Tab
  const [activeTab, setActiveTab] = useState<PublishTab>('sequencer');

  // Multi-Scene Sequencer Configuration
  const [videoFormat, setVideoFormat] = useState<'webm' | 'mp4'>('webm');
  const [durationMode, setDurationMode] = useState<'per-scene' | 'fixed'>('per-scene');
  const [fixedDurationSeconds, setFixedDurationSeconds] = useState<number>(5);
  const [transitionStyle, setTransitionStyle] = useState<'crossfade' | 'fade-to-black' | 'none'>('crossfade');
  const [resolutionPreset, setResolutionPreset] = useState<'1080p' | '720p' | 'native'>('1080p');
  const [includeWatermark, setIncludeWatermark] = useState<boolean>(true);
  const [sequencerProgress, setSequencerProgress] = useState<MultiSceneRecordingProgress | null>(null);

  // Standalone Game Bundler Options
  const [autoProgressLevels, setAutoProgressLevels] = useState<boolean>(true);
  const [enableMobileTouch, setEnableMobileTouch] = useState<boolean>(true);
  const [enableAudioSynth, setEnableAudioSynth] = useState<boolean>(true);
  const [offlineRuntime, setOfflineRuntime] = useState<boolean>(true);
  const [lastBudget, setLastBudget] = useState<PlayableBudgetReport | null>(null);

  // UI Feedback
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  if (!isOpen) return null;

  const is2D = sceneSpec.engineType === '2d';
  const engineLabel = is2D ? '2D Vector/Sprite Canvas' : '3D WebGL Stage';
  const supportedMimes = detectSupportedVideoMimes();

  const triggerToast = (msg: string) => {
    setExportNotice(msg);
    setTimeout(() => setExportNotice(null), 4500);
  };

  // Calculate total multi-scene sequencer runtime
  const calculateTotalDuration = () => {
    return scenes.reduce((acc, sc) => {
      const dur = durationMode === 'fixed' ? fixedDurationSeconds : Math.max(2, sc.durationSeconds || 5);
      return acc + dur;
    }, 0);
  };
  const totalSequencerDuration = calculateTotalDuration();

  // Resolution map based on active scene aspect ratio
  const getResolutionDimensions = () => {
    const isPortrait = sceneSpec.aspectRatio === '9:16';
    const isSquare = sceneSpec.aspectRatio === '1:1';

    if (resolutionPreset === '1080p') {
      if (isPortrait) return { width: 1080, height: 1920 };
      if (isSquare) return { width: 1080, height: 1080 };
      return { width: 1920, height: 1080 };
    }
    if (resolutionPreset === '720p') {
      if (isPortrait) return { width: 720, height: 1280 };
      if (isSquare) return { width: 720, height: 720 };
      return { width: 1280, height: 720 };
    }
    return { width: 1920, height: 1080 };
  };

  // Handler: Start Multi-Scene Video Sequencer
  const handleStartMultiSceneRecording = async () => {
    if (isRecordingVideo) return;
    abortControllerRef.current = new AbortController();

    setRecordingState(true, 0);
    setSequencerProgress({
      overallRatio: 0,
      percentage: 0,
      currentSceneIndex: 0,
      totalScenes: scenes.length,
      currentSceneTitle: scenes[0]?.title || 'Starting Sequencer...',
      elapsedSeconds: 0,
      totalDurationSeconds: totalSequencerDuration,
      phase: 'preparing',
    });

    const res = await recordMultiSceneSequence({
      scenes,
      initialActiveSceneId: activeSceneId,
      switchScene,
      getCanvasElement: () => canvasElement,
      durationMode,
      fixedDurationSeconds,
      format: videoFormat,
      fps: 60,
      transition: transitionStyle,
      transitionDurationSeconds: 0.5,
      resolution: getResolutionDimensions(),
      watermarkBadge: includeWatermark,
      abortSignal: abortControllerRef.current.signal,
      onProgress: (prog) => {
        setSequencerProgress(prog);
        setRecordingState(true, prog.percentage);
      },
    });

    setRecordingState(false, 0);
    setSequencerProgress(null);
    abortControllerRef.current = null;

    if (res.ok && res.filename) {
      triggerToast(`Successfully rendered Multi-Scene Video: ${res.filename}`);
    } else if (res.error) {
      triggerToast(`Video Sequencer: ${res.error}`);
    }
  };

  // Handler: Abort Multi-Scene Recording
  const handleCancelRecording = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      triggerToast('Recording cancelled by user');
    }
  };

  // Handler: Single-Scene Quick Video Record
  const handleQuickRecordActiveScene = async (seconds: number) => {
    if (isRecordingVideo) return;
    setRecordingState(true, 0);
    const ok = await recordCanvasVideoWebM(canvasElement, seconds, sceneSpec.title, (ratio) => {
      setRecordingState(true, Math.round(ratio * 100));
    });
    setRecordingState(false, 0);
    if (ok) {
      triggerToast(`Exported ${seconds}s video stream for active scene: ${sceneSpec.title}`);
    }
  };

  // Handler: Standalone Game HTML Export
  const handleExportStandaloneHTML = async (network: StandaloneAdNetwork) => {
    const { budget } = await exportStandalonePlayableHTML(sceneSpec, network, scenes, {
      autoProgressScenes: autoProgressLevels,
      enableMobileTouchControls: enableMobileTouch,
      enableProceduralAudio: enableAudioSynth,
      offline: offlineRuntime,
    });
    setLastBudget(budget);
    triggerToast(`Exported ${network.toUpperCase()} Standalone HTML5 Game (${scenes.length} scene${scenes.length > 1 ? 's' : ''})`);
  };

  // Handler: Standalone Game ZIP Export
  const handleExportStandaloneZIP = async (network: StandaloneAdNetwork) => {
    const { budget } = await exportStandaloneGameZIP(sceneSpec, network, scenes, {
      autoProgressScenes: autoProgressLevels,
      enableMobileTouchControls: enableMobileTouch,
      enableProceduralAudio: enableAudioSynth,
      offline: offlineRuntime,
    });
    setLastBudget(budget);
    triggerToast(`Exported complete ${network.toUpperCase()} Game ZIP Package`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#0B101B] border-b border-slate-800 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                <Film className="w-4 h-4" />
              </span>
              <h2 className="font-display font-bold text-base text-slate-100">
                Media Export & Standalone Game Bundler
              </h2>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
              <span>
                Active: <span className="text-slate-200 font-medium">{sceneSpec.title}</span>
              </span>
              <span>·</span>
              <span className="font-mono text-cyan-400">
                {(sceneSpec.engineType || '3d').toUpperCase()}
              </span>
              <span>·</span>
              <span className="font-mono text-amber-400">{scenes.length} Storyboard Scene(s)</span>
              <span>·</span>
              <span className="font-mono text-slate-300">{sceneSpec.aspectRatio}</span>
            </p>
          </div>
          <button
            onClick={() => setPublishModalOpen(false)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 py-2.5 bg-[#070B12] border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
          {[
            {
              id: 'sequencer' as const,
              label: 'Multi-Scene Video Sequencer',
              icon: <Film className="w-3.5 h-3.5 text-amber-400" />,
            },
            {
              id: 'bundler' as const,
              label: 'Standalone Game Bundler (HTML5 / ZIP)',
              icon: <Gamepad2 className="w-3.5 h-3.5 text-cyan-400" />,
            },
            {
              id: 'snapshot' as const,
              label: 'Snapshots & MCA Contract',
              icon: <Camera className="w-3.5 h-3.5 text-emerald-400" />,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 text-slate-200">
          {/* Toast Notice */}
          {exportNotice && (
            <div className="px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center gap-2 shadow-lg animate-in fade-in">
              <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{exportNotice}</span>
            </div>
          )}

          {/* TAB 1: MULTI-SCENE VIDEO SEQUENCER */}
          {activeTab === 'sequencer' && (
            <div className="space-y-5">
              {/* Sequencer Banner Info */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-slate-900 to-cyan-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-display font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Continuous Storyboard Video Sequencer</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    Automates playback across all <span className="text-slate-200 font-semibold">{scenes.length} scenes</span> (3D & 2D) on the timeline, rendering smooth transitions and exporting a single stitched master video.
                  </p>
                </div>
                <div className="text-right shrink-0 bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] font-mono text-slate-400 uppercase">Total Runtime</div>
                  <div className="text-sm font-mono font-bold text-amber-400">{totalSequencerDuration.toFixed(1)}s</div>
                </div>
              </div>

              {/* Storyboard Scenes Sequence Queue Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                  <span>Storyboard Recording Sequence ({scenes.length} Scenes)</span>
                  <span className="font-mono text-[11px] text-cyan-400">FPS: 60 · 12 Mbps High-Bitrate</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {scenes.map((sc, idx) => {
                    const dur = durationMode === 'fixed' ? fixedDurationSeconds : Math.max(2, sc.durationSeconds || 5);
                    const isCur = sc.id === activeSceneId;
                    return (
                      <div
                        key={sc.id}
                        className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 text-xs transition-colors ${
                          isCur
                            ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-200'
                            : 'bg-slate-900/80 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <div className="truncate">
                            <div className="font-semibold truncate text-[11px]">{sc.title}</div>
                            <div className="text-[10px] text-slate-400 font-mono uppercase">
                              {(sc.engineType || '3d')} · {sc.mode || 'game'}
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] font-bold text-amber-400 shrink-0">
                          {dur}s
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sequencer Settings Controls */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
                <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Sequencer Settings & Format</span>
                </h5>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                  {/* Format Selector */}
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Output Format</label>
                    <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => setVideoFormat('mp4')}
                        disabled={!supportedMimes.mp4}
                        className={`py-1.5 px-2 rounded font-mono text-[11px] font-semibold transition-colors ${
                          videoFormat === 'mp4'
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : supportedMimes.mp4
                            ? 'text-slate-300 hover:text-white'
                            : 'text-slate-600 cursor-not-allowed'
                        }`}
                        title={supportedMimes.mp4 ? 'Native H.264/AVC MP4' : 'MP4 not supported in current browser'}
                      >
                        .MP4 (AVC)
                      </button>
                      <button
                        onClick={() => setVideoFormat('webm')}
                        className={`py-1.5 px-2 rounded font-mono text-[11px] font-semibold transition-colors ${
                          videoFormat === 'webm'
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        .WebM (VP9)
                      </button>
                    </div>
                  </div>

                  {/* Duration Mode */}
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Per-Scene Timing</label>
                    <select
                      value={durationMode}
                      onChange={(e) => setDurationMode(e.target.value as any)}
                      className="w-full py-1.5 px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 outline-none focus:border-cyan-500 font-mono"
                    >
                      <option value="per-scene">Storyboard Scene Specs</option>
                      <option value="fixed">Uniform Duration per Scene</option>
                    </select>
                  </div>

                  {/* Transition Style */}
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium">Inter-Scene Transition</label>
                    <select
                      value={transitionStyle}
                      onChange={(e) => setTransitionStyle(e.target.value as any)}
                      className="w-full py-1.5 px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 outline-none focus:border-cyan-500 font-mono"
                    >
                      <option value="crossfade">Smooth Crossfade (0.5s)</option>
                      <option value="fade-to-black">Fade to Black (0.5s)</option>
                      <option value="none">Instant Cut</option>
                    </select>
                  </div>
                </div>

                {/* Second row of options */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeWatermark}
                        onChange={(e) => setIncludeWatermark(e.target.checked)}
                        className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                      />
                      <span className="text-slate-300">Overlay Scene HUD Badge</span>
                    </label>

                    <div className="flex items-center gap-2 text-slate-400">
                      <span>Resolution:</span>
                      <select
                        value={resolutionPreset}
                        onChange={(e) => setResolutionPreset(e.target.value as any)}
                        className="py-1 px-2 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200 outline-none font-mono"
                      >
                        <option value="1080p">1080p Full HD</option>
                        <option value="720p">720p HD</option>
                        <option value="native">Native Viewport</option>
                      </select>
                    </div>
                  </div>

                  {durationMode === 'fixed' && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Seconds each:</span>
                      {[3, 5, 8, 10].map((s) => (
                        <button
                          key={s}
                          onClick={() => setFixedDurationSeconds(s)}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                            fixedDurationSeconds === s
                              ? 'bg-cyan-500 text-slate-950 font-bold'
                              : 'bg-slate-800 text-slate-300 hover:text-white'
                          }`}
                        >
                          {s}s
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Sequencer Progress State */}
              {isRecordingVideo && sequencerProgress && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                      <span className="font-bold text-amber-300">
                        Recording Scene {sequencerProgress.currentSceneIndex + 1} of {sequencerProgress.totalScenes}:
                      </span>
                      <span className="text-slate-200 font-semibold">{sequencerProgress.currentSceneTitle}</span>
                    </div>
                    <span className="font-mono font-bold text-amber-400">{sequencerProgress.percentage}%</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-cyan-400 transition-all duration-150"
                      style={{ width: `${sequencerProgress.percentage}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>
                      Elapsed: <strong className="text-slate-200">{sequencerProgress.elapsedSeconds}s</strong> / {sequencerProgress.totalDurationSeconds}s
                    </span>
                    <span className="uppercase text-cyan-400 font-semibold">Phase: {sequencerProgress.phase}</span>
                    <button
                      onClick={handleCancelRecording}
                      className="text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancel Recording</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  onClick={handleStartMultiSceneRecording}
                  disabled={isRecordingVideo}
                  className="flex-1 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 disabled:opacity-50 text-slate-950 font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-[0.98]"
                >
                  <Film className="w-4 h-4" />
                  <span>
                    {isRecordingVideo
                      ? 'Sequencing Storyboard in Progress...'
                      : `Start Multi-Scene Video Recording (${totalSequencerDuration.toFixed(1)}s · ${scenes.length} Scenes)`}
                  </span>
                </button>

                <button
                  onClick={() => handleQuickRecordActiveScene(5)}
                  disabled={isRecordingVideo}
                  className="w-full sm:w-auto py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors shrink-0"
                >
                  <Camera className="w-4 h-4 text-cyan-400" />
                  <span>Quick Record Active Scene (5s)</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: STANDALONE GAME BUNDLER */}
          {activeTab === 'bundler' && (
            <div className="space-y-5">
              {/* Top Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 via-slate-900 to-fuchsia-500/10 border border-cyan-500/30 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-display font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                    <Gamepad2 className="w-4 h-4" />
                    <span>Independent Standalone Game Compiler</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    Packages your full multi-scene 3D WebGL and 2D Vector storyboard into self-contained single-file HTML5 games and itch.io / Ad Network ZIP bundles with zero runtime dependencies.
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hidden sm:block">
                  <Archive className="w-5 h-5" />
                </div>
              </div>

              {/* Game Bundler Options */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Gameplay & Standalone Runtime Features</span>
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer select-none hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={autoProgressLevels}
                      onChange={(e) => setAutoProgressLevels(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Auto Level Progression</div>
                      <div className="text-[10px] text-slate-400">Advances to next scene on target score</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer select-none hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={enableMobileTouch}
                      onChange={(e) => setEnableMobileTouch(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Mobile Virtual D-Pad</div>
                      <div className="text-[10px] text-slate-400">On-screen touch controls & jump</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer select-none hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={enableAudioSynth}
                      onChange={(e) => setEnableAudioSynth(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Procedural 8-bit Audio</div>
                      <div className="text-[10px] text-slate-400">Web Audio API synth SFX</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Target Platforms Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {[
                  {
                    id: 'itch' as const,
                    title: 'itch.io Game Package (.ZIP)',
                    badge: 'itch.io Ready',
                    color: 'text-rose-400',
                    border: 'border-rose-500/30',
                    desc: 'Full itch.io bundle including index.html, manifest.json & README.txt. Ready for direct ZIP upload to itch.io creator dashboard.',
                    supportsZip: true,
                    supportsHtml: false,
                  },
                  {
                    id: 'telegram' as const,
                    title: 'Telegram Mini App (TMA)',
                    badge: 'Telegram WebApp',
                    color: 'text-sky-400',
                    border: 'border-sky-500/30',
                    desc: 'Self-contained HTML5 with Telegram WebApp SDK, native HapticFeedback triggers, and theme color synchronization.',
                    supportsZip: true,
                    supportsHtml: true,
                  },
                  {
                    id: 'tiktok' as const,
                    title: 'TikTok Playable Ad (MRAID 3.0)',
                    badge: 'MRAID Compliant',
                    color: 'text-cyan-400',
                    border: 'border-cyan-500/30',
                    desc: 'Optimized for TikTok / Pangle / AppLovin. Embeds MRAID 3.0 lifecycle events and mraid.open() CTA redirect hook.',
                    supportsZip: true,
                    supportsHtml: true,
                  },
                  {
                    id: 'meta' as const,
                    title: 'Meta Interactive Ad',
                    badge: 'FbPlayableAd',
                    color: 'text-blue-400',
                    border: 'border-blue-500/30',
                    desc: 'Facebook & Instagram playable ad standard with FbPlayableAd.onCTAClick() hook and responsive viewport letterboxing.',
                    supportsZip: true,
                    supportsHtml: true,
                  },
                  {
                    id: 'universal' as const,
                    title: 'Universal Offline HTML5 Game',
                    badge: 'Universal Web',
                    color: 'text-emerald-400',
                    border: 'border-emerald-500/30',
                    desc: 'Zero-install single HTML5 file. Runs offline in any modern browser on mobile, tablet, or desktop with no server required.',
                    supportsZip: true,
                    supportsHtml: true,
                  },
                ].map((target) => (
                  <div
                    key={target.id}
                    className={`p-4 rounded-xl bg-slate-900/90 border ${target.border} flex flex-col justify-between gap-3`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <h5 className="font-semibold text-slate-100 text-sm flex items-center gap-2">
                          <span className={target.color}>●</span>
                          <span>{target.title}</span>
                        </h5>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-950 border border-slate-800 text-slate-300">
                          {target.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        {target.desc}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                      {target.supportsHtml && (
                        <button
                          onClick={() => handleExportStandaloneHTML(target.id)}
                          className="flex-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Export .HTML</span>
                        </button>
                      )}
                      {target.supportsZip && (
                        <button
                          onClick={() => handleExportStandaloneZIP(target.id)}
                          className="flex-1 py-2 px-3 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>Export .ZIP Bundle</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Phase 5: offline runtime toggle + size budget report */}
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
                <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={offlineRuntime}
                    onChange={(e) => setOfflineRuntime(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <span>Embed models & images for offline play (fits within the network size budget)</span>
                </label>
                {lastBudget && (
                  <div
                    className={`p-2.5 rounded-lg border font-mono text-[11px] space-y-1 ${
                      lastBudget.withinBudget && lastBudget.offlineReady
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                        : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <div>
                      {lastBudget.network.toUpperCase()}: {formatBytes(lastBudget.measuredBytes)} / {formatBytes(lastBudget.limitBytes)}{' '}
                      {lastBudget.withinBudget ? '✓ within budget' : '✗ over budget'} ·{' '}
                      {lastBudget.offlineReady ? 'offline-ready' : 'needs network'}
                    </div>
                    <div className="text-slate-400">
                      HTML {formatBytes(lastBudget.htmlBytes)}
                      {lastBudget.zipBytes !== undefined ? ` · ZIP ${formatBytes(lastBudget.zipBytes)}` : ''} · {lastBudget.limitLabel}
                    </div>
                    {lastBudget.notes.map((n) => (
                      <div key={n}>• {n}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SNAPSHOTS & MCA CONTRACT */}
          {activeTab === 'snapshot' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Instant PNG Capture */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                      <Camera className="w-4 h-4 text-cyan-400" />
                      <span>High-Resolution PNG Snapshot</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">
                      Directly captures the current {engineLabel} frame buffer at native resolution ({sceneSpec.aspectRatio}) for marketing promotional cards or thumbnails.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      exportCanvasSnapshotPNG(canvasElement, sceneSpec.title);
                      triggerToast(`Downloaded High-Res PNG Snapshot (${engineLabel})`);
                    }}
                    className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Native .PNG Snapshot</span>
                  </button>
                </div>

                {/* MCA Project Contract Exporter */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                      <Code2 className="w-4 h-4 text-emerald-400" />
                      <span>Multi-Coding-Agent Project Contract</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">
                      Downloads the complete declarative <code className="text-cyan-300">.scenespec.json</code> contract containing active <code className="text-slate-300">SceneSpec</code> and all {scenes.length} storyboard <code className="text-slate-300">scenes[]</code> for Claude Code, Antigravity, or Codex.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      exportSceneSpecJSON(sceneSpec, scenes);
                      triggerToast(`Exported .scenespec.json project contract (${scenes.length} scene${scenes.length > 1 ? 's' : ''})`);
                    }}
                    className="w-full py-2.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .scenespec.json Bundle</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-[#0B101B] border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Dual-Engine Export Pipeline Ready</span>
          </div>
          <button
            onClick={() => setPublishModalOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
