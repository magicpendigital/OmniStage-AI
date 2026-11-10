import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Captions,
  Clapperboard,
  Columns2,
  Diamond,
  Gamepad2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Rows2,
  Video,
  Workflow,
} from 'lucide-react';
import { StageCanvas } from '../renderer/StageCanvas';
import { StageCanvas2D } from '../renderer/StageCanvas2D';
import { NodeGraphView } from './NodeGraphView';
import { BottomDock } from './BottomDock';
import { RightAgentChat } from './RightAgentChat';
import { ActorInspectorPill, CtaBanner, EndCard, Node2DInspectorPill } from './StageOverlays';
import { speakText } from './panels/AudioPanel';
import { useStudioStore } from '../state/useStudioStore';
import { clamp, isTypingTarget, useShellStore } from '../state/useShellStore';
import { AspectRatioPreset, CameraMode, GameRule, SettingsConfig } from '../types/scene.schema';
import { exportCanvasSnapshotPNG, recordCanvasVideoWebM } from '../exporter/mediaExporter';
import { IconBtn, Kbd, Segmented, startDrag, useSize } from './ui';

const ASPECT: Record<AspectRatioPreset, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };
const PIP_HEAD = 30;
const DIVIDER = 5;

// ----------------------------------------------------------------------------
// Audio tracks + spoken captions, slaved to the timeline clock
// ----------------------------------------------------------------------------
function useMediaPlayback() {
  const tracks = useStudioStore((s) => s.sceneSpec.audioTracks);
  const players = useRef(new Map<string, HTMLAudioElement>());

  // Keep one <audio> per track, dropping players for tracks that were removed.
  useEffect(() => {
    const live = new Set((tracks || []).map((t) => t.id));
    players.current.forEach((audio, id) => {
      if (!live.has(id)) {
        audio.pause();
        players.current.delete(id);
      }
    });
    (tracks || []).forEach((t) => {
      let audio = players.current.get(t.id);
      if (!audio || audio.src !== new URL(t.url, window.location.href).href) {
        audio?.pause();
        audio = new Audio(t.url);
        audio.preload = 'auto';
        players.current.set(t.id, audio);
      }
      audio.loop = Boolean(t.loop);
      audio.volume = t.muted ? 0 : clamp(t.volume, 0, 1);
    });
  }, [tracks]);

  useEffect(() => {
    let lastTime = useStudioStore.getState().currentTime;
    const sync = () => {
      const { currentTime, isPlaying, sceneSpec } = useStudioStore.getState();
      (sceneSpec.audioTracks || []).forEach((t) => {
        const audio = players.current.get(t.id);
        if (!audio) return;
        const local = currentTime - t.startTime;
        if (!isPlaying || local < 0) {
          if (!audio.paused) audio.pause();
          return;
        }
        const length = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!t.loop && length > 0 && local >= length) {
          if (!audio.paused) audio.pause();
          return;
        }
        const wanted = t.loop && length > 0 ? local % length : local;
        if (audio.paused || Math.abs(audio.currentTime - wanted) > 0.45) {
          try {
            audio.currentTime = wanted;
          } catch {
            // metadata not ready yet; the next tick retries
          }
        }
        if (audio.paused) audio.play().catch(() => undefined);
      });

      // Speak each voiced caption once as the playhead crosses its start.
      if (isPlaying && currentTime > lastTime && currentTime - lastTime < 0.5) {
        const cue = (sceneSpec.captions || []).find((c) => c.speak && c.start > lastTime && c.start <= currentTime);
        if (cue) speakText(cue.text);
      }
      lastTime = currentTime;
    };
    const unsubscribe = useStudioStore.subscribe(sync);
    return () => {
      unsubscribe();
      players.current.forEach((audio) => audio.pause());
    };
  }, []);
}

// ----------------------------------------------------------------------------
// Mode strip: what Game Mode / Media Mode reveal
// ----------------------------------------------------------------------------
const ModeBar: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const settings = useStudioStore((s) => s.settings);
  const workspaceView = useStudioStore((s) => s.workspaceView);
  const gameScore = useStudioStore((s) => s.gameScore);
  const gameTimeRemaining = useStudioStore((s) => s.gameTimeRemaining);
  const isRecordingVideo = useStudioStore((s) => s.isRecordingVideo);
  const recordingProgress = useStudioStore((s) => s.recordingProgress);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const updateGameRules = useStudioStore((s) => s.updateGameRules);
  const updateMarketingOverlay = useStudioStore((s) => s.updateMarketingOverlay);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const resetGameSession = useStudioStore((s) => s.resetGameSession);
  const setCameraMode = useStudioStore((s) => s.setCameraMode);
  const setSceneDuration = useStudioStore((s) => s.setSceneDuration);
  const addCameraKeyframe = useStudioStore((s) => s.addCameraKeyframe);
  const setRecordingState = useStudioStore((s) => s.setRecordingState);
  const setBottomDockCollapsed = useStudioStore((s) => s.setBottomDockCollapsed);

  const railPanel = useShellStore((s) => s.railPanel);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const setDockTab = useShellStore((s) => s.setDockTab);
  const splitOrientation = useShellStore((s) => s.splitOrientation);
  const setSplitOrientation = useShellStore((s) => s.setSplitOrientation);

  const is2D = sceneSpec.engineType === '2d';
  const isGame = sceneSpec.mode === 'game';
  const rules = sceneSpec.gameRules;
  const cta = sceneSpec.marketingOverlay;

  const getActiveCanvas = (): HTMLCanvasElement | null =>
    canvasElement && canvasElement.isConnected ? canvasElement : document.querySelector('canvas');

  const handleQuickRecord5s = async () => {
    const activeCanvas = getActiveCanvas();
    if (isRecordingVideo || !activeCanvas) return;
    setRecordingState(true, 0);
    await recordCanvasVideoWebM(activeCanvas, 5, sceneSpec.title, (ratio) => {
      setRecordingState(true, Math.round(ratio * 100));
    });
    setRecordingState(false, 0);
  };

  const openDock = (tab: 'timeline' | 'captions') => {
    setDockTab(tab);
    setBottomDockCollapsed(false);
  };

  return (
    <div className="modebar">
      {isGame ? (
        <>
          <span className="modebar-label game">
            <Gamepad2 size={12} /> Game rules
          </span>
          <label className="mb-f">
            Target
            <input
              type="number"
              className="field sm w-16 text-right font-mono"
              min={0}
              step={5}
              value={rules.targetScore}
              onChange={(e) => updateGameRules({ targetScore: Math.max(0, parseFloat(e.target.value) || 0) })}
            />
          </label>
          <label className="mb-f">
            Timer
            <input
              type="number"
              className="field sm w-14 text-right font-mono"
              min={1}
              value={rules.timeLimitSeconds}
              onChange={(e) => updateGameRules({ timeLimitSeconds: Math.max(1, parseFloat(e.target.value) || 1) })}
            />
            s
          </label>
          <label className="mb-f">
            Win
            <select
              className="field sm"
              value={rules.winCondition}
              onChange={(e) => updateGameRules({ winCondition: e.target.value as GameRule['winCondition'] })}
            >
              <option value="score-threshold">score threshold</option>
              <option value="collect-all">collect all</option>
              <option value="survive-timer">survive timer</option>
              <option value="unbox-reveal">unbox reveal</option>
            </select>
          </label>
          <label className="mb-f" title="Player physics: gravity used by the 2D platformer and jump impulses">
            Gravity
            <input
              type="number"
              className="field sm w-14 text-right font-mono"
              step={0.1}
              value={settings.physicsGravity}
              onChange={(e) => updateSettings({ physicsGravity: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <span className="mb-f">
            <Kbd>WASD</Kbd> move {is2D && <><Kbd>Space</Kbd> jump</>}
          </span>
          <span className="topbar-sep" />
          <label className="mb-f">
            <input
              type="checkbox"
              checked={cta.enabled}
              onChange={(e) => updateMarketingOverlay({ enabled: e.target.checked })}
              className="accent-[rgb(var(--game))]"
            />
            CTA
            <input
              className="field sm w-28"
              aria-label="Playable CTA label"
              value={cta.ctaText}
              onChange={(e) => updateMarketingOverlay({ ctaText: e.target.value })}
            />
          </label>
          <span className="topbar-sep" />
          <span className="mb-f font-mono text-game">
            {gameScore}/{rules.targetScore} pts
          </span>
          <span className={`mb-f font-mono ${gameTimeRemaining <= 5 ? 'text-err' : ''}`}>{Math.ceil(gameTimeRemaining)}s</span>
          <button type="button" className="btn ghost sm" onClick={resetGameSession} title="Reset score and timer">
            <RotateCcw size={11} /> Reset
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => railPanel !== 'logic' && togglePanel('logic')}
            title="Open When → Do rules and HUD settings"
          >
            <Workflow size={11} /> Rules
          </button>
        </>
      ) : (
        <>
          <span className="modebar-label media">
            <Clapperboard size={12} /> Cinematic
          </span>
          {!is2D ? (
            <label className="mb-f">
              Camera track
              <select
                className="field sm"
                value={sceneSpec.camera.mode}
                onChange={(e) => setCameraMode(e.target.value as CameraMode)}
              >
                <option value="orbit-360">orbit-360 (turntable)</option>
                <option value="dolly-zoom-in">dolly-zoom-in (hero push)</option>
                <option value="crane-reveal">crane-reveal (sweep up)</option>
                <option value="top-down-isometric">top-down-isometric</option>
                <option value="first-person-follow">first-person-follow</option>
                <option value="cinematic-flythrough">cinematic-flythrough (keyframes)</option>
              </select>
            </label>
          ) : (
            <span className="mb-f">2D stage · per-layer keyframe tracks</span>
          )}
          <label className="mb-f">
            Duration
            <input
              type="number"
              className="field sm w-14 text-right font-mono"
              min={2}
              max={120}
              value={sceneSpec.durationSeconds}
              onChange={(e) => setSceneDuration(parseFloat(e.target.value) || 2)}
            />
            s
          </label>
          {!is2D && (
            <button
              type="button"
              className="btn ghost sm"
              title="Add a camera keyframe at the playhead"
              onClick={() => {
                addCameraKeyframe();
                openDock('timeline');
              }}
            >
              <Diamond size={11} /> Keyframe
              <span className="font-mono text-dim">{(sceneSpec.camera.keyframes || []).length}</span>
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={() => openDock('timeline')}>
            Sequencer
          </button>
          <span className="topbar-sep" />
          <label className="mb-f" title="Post-processing bloom">
            <input
              type="checkbox"
              checked={settings.enableBloom}
              onChange={(e) => updateSettings({ enableBloom: e.target.checked })}
              className="accent-[rgb(var(--media))]"
            />
            Bloom
          </label>
          <label className="mb-f">
            Quality
            <select
              className="field sm"
              value={settings.renderQuality}
              onChange={(e) => updateSettings({ renderQuality: e.target.value as SettingsConfig['renderQuality'] })}
            >
              <option value="draft">draft</option>
              <option value="high">high</option>
              <option value="ultra-postprocessing">ultra + post</option>
            </select>
          </label>
          <span className="topbar-sep" />
          <button type="button" className="btn ghost sm" onClick={() => openDock('captions')} title="Voiceover captions and audio mixer">
            <Captions size={11} /> Captions
            <span className="font-mono text-dim">{(sceneSpec.captions || []).length}</span>
          </button>
          <button type="button" className="btn ghost sm" onClick={handleQuickRecord5s} disabled={isRecordingVideo}>
            <Video size={11} className="text-err" /> {isRecordingVideo ? `Rec ${recordingProgress}%` : 'Record 5s'}
          </button>
        </>
      )}

      <div className="flex-1" />
      {workspaceView === 'split' && (
        <Segmented
          label="Split orientation"
          small
          value={splitOrientation}
          onChange={setSplitOrientation}
          options={[
            { value: 'row', title: 'Side by side', icon: <Columns2 size={13} /> },
            { value: 'column', title: 'Stacked', icon: <Rows2 size={13} /> },
          ]}
        />
      )}
      <IconBtn small label="Snapshot PNG" onClick={() => exportCanvasSnapshotPNG(getActiveCanvas(), sceneSpec.title)}>
        <Camera size={14} />
      </IconBtn>
    </div>
  );
};

// ----------------------------------------------------------------------------
// The live stage: one mounted engine canvas, letterboxed to the scene aspect ratio
// ----------------------------------------------------------------------------
const StageBody: React.FC<{ compact: boolean; padBottom: number }> = ({ compact, padBottom }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const size = useSize(boxRef);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectedNode2DId = useStudioStore((s) => s.selectedNode2DId);
  const currentTime = useStudioStore((s) => s.currentTime);
  const gameScore = useStudioStore((s) => s.gameScore);
  const gameTimeRemaining = useStudioStore((s) => s.gameTimeRemaining);
  const gameEnded = useStudioStore((s) => s.gameEnded);
  const scorePopups = useStudioStore((s) => s.scorePopups);
  const isVisionRunning = useStudioStore((s) => s.isVisionRunning);
  const resetGameSession = useStudioStore((s) => s.resetGameSession);

  const is2D = sceneSpec.engineType === '2d';
  const isGame = sceneSpec.mode === 'game';
  const selectedActor = !is2D ? sceneSpec.actors.find((a) => a.id === selectedActorId) || null : null;
  const selectedNode2D = is2D ? (sceneSpec.nodes2D || []).find((n) => n.id === selectedNode2DId) || null : null;

  const pad = compact ? 0 : 12;
  const availW = Math.max(0, size.w - pad * 2);
  const availH = Math.max(0, size.h - pad * 2 - padBottom);
  const ratio = ASPECT[sceneSpec.aspectRatio] ?? 16 / 9;
  const frameW = Math.floor(Math.min(availW, availH * ratio));
  const frameH = Math.floor(frameW / ratio);
  const frameX = pad + (availW - frameW) / 2;
  const frameY = pad + (availH - frameH) / 2;

  const caption = (sceneSpec.captions || []).find((c) => currentTime >= c.start && currentTime <= c.end);

  return (
    <div ref={boxRef} className="stage-bg absolute inset-0 overflow-hidden">
      <div
        className="stage-frame"
        style={{ left: frameX, top: frameY, width: Math.max(frameW, 1), height: Math.max(frameH, 1), borderRadius: compact ? 0 : 6 }}
      >
        {/* Dual engine rendering: 3D WebGL vs 2D vector / sprite canvas */}
        {is2D ? <StageCanvas2D /> : <StageCanvas />}

        {!compact && (
          <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex max-w-[60%] items-center gap-2">
            <span className="chip glass-s">
              <span className={`font-mono font-semibold ${is2D ? 'text-media' : 'text-accent'}`}>{is2D ? '2D' : '3D'}</span>
              <span className="truncate text-fg">{sceneSpec.title}</span>
              <span className="font-mono text-dim">{sceneSpec.aspectRatio}</span>
              {!is2D && <span className="hidden font-mono text-dim lg:inline">{sceneSpec.camera.mode}</span>}
            </span>
          </div>
        )}

        {isGame && (
          <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
            <span className="chip glass-s font-mono" style={{ borderColor: 'rgb(var(--game) / 0.45)' }}>
              <span className="font-semibold text-game">
                {gameScore}/{sceneSpec.gameRules.targetScore}
              </span>
              <span className={gameTimeRemaining <= 5 ? 'font-bold text-err' : 'text-fg'}>{Math.ceil(gameTimeRemaining)}s</span>
            </span>
            {!compact && (
              <button type="button" className="chip glass-s" onClick={resetGameSession} title="Reset playable score & timer" aria-label="Reset playable score and timer">
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        )}

        {!compact && selectedActor && <ActorInspectorPill selectedActor={selectedActor} />}
        {!compact && selectedNode2D && <Node2DInspectorPill selectedNode2D={selectedNode2D} />}

        {!compact && isGame && !gameEnded && sceneSpec.gameRules.instructions && (
          <div className="pointer-events-none absolute left-2.5 top-24 z-10 max-w-[70%] rounded-md px-2.5 py-1 text-[11px] text-mute glass-s">
            {sceneSpec.gameRules.instructions}
          </div>
        )}

        <div className="pointer-events-none absolute right-3 top-24 z-10 flex flex-col items-end gap-1.5">
          {scorePopups.slice(-3).map((p) => (
            <div key={p.id} className="rise rounded px-2.5 py-1 font-mono text-xs font-semibold text-game glass-s">
              {p.text}
            </div>
          ))}
        </div>

        {caption && (
          <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4" style={{ bottom: compact ? '5%' : '9%' }}>
            <span className="cap" style={{ fontSize: clamp(frameW * 0.022, 10, 22) }}>
              {caption.text}
            </span>
          </div>
        )}

        {isGame && gameEnded &&
          (compact ? (
            <div className="absolute inset-0 z-30 grid place-items-center bg-black/70">
              <button type="button" className="btn warn sm" onClick={resetGameSession}>
                <RotateCcw size={11} /> Replay
              </button>
            </div>
          ) : (
            <EndCard />
          ))}

        {!compact && sceneSpec.marketingOverlay.enabled && !gameEnded && <CtaBanner raised={Boolean(caption)} />}

        {isVisionRunning && (
          <div className="scan">
            <span>Vision QA · scanning canvas</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Workspace: Stage / Node Graph + live PiP / Split View, with the unified dock below
// ----------------------------------------------------------------------------
export const CenterViewport: React.FC = () => {
  const wsRef = useRef<HTMLDivElement | null>(null);
  const ws = useSize(wsRef);
  const [draggingDivider, setDraggingDivider] = useState(false);
  const dragStart = useRef({ ratio: 0.5, right: 0, top: 0, width: 0 });

  const workspaceView = useStudioStore((s) => s.workspaceView);
  const aspectRatio = useStudioStore((s) => s.sceneSpec.aspectRatio);
  const is2D = useStudioStore((s) => s.sceneSpec.engineType === '2d');
  const setWorkspaceView = useStudioStore((s) => s.setWorkspaceView);

  const focusMode = useShellStore((s) => s.focusMode);
  const toggleFocusMode = useShellStore((s) => s.toggleFocusMode);
  const aiMode = useShellStore((s) => s.aiMode);
  const splitOrientation = useShellStore((s) => s.splitOrientation);
  const splitRatio = useShellStore((s) => s.splitRatio);
  const setSplitRatio = useShellStore((s) => s.setSplitRatio);
  const pip = useShellStore((s) => s.pip);
  const setPip = useShellStore((s) => s.setPip);

  useMediaPlayback();

  // Global shell shortcuts: [\] focus mode, [`] collapse dock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '\\') {
        e.preventDefault();
        useShellStore.getState().toggleFocusMode();
      } else if (e.key === '`') {
        e.preventDefault();
        const s = useStudioStore.getState();
        s.setBottomDockCollapsed(!s.isBottomDockCollapsed);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const W = ws.w;
  const H = ws.h;
  const isSplit = workspaceView === 'split';
  const isPip = workspaceView === 'node-graph';
  const isRow = splitOrientation === 'row';

  // Geometry of the two panes. The stage element is always mounted, only its rectangle changes,
  // so switching views never tears down the WebGL context.
  let stageStyle: React.CSSProperties = { left: 0, top: 0, width: W, height: H };
  let graphStyle: React.CSSProperties | null = null;
  let dividerStyle: React.CSSProperties | null = null;

  if (isSplit) {
    if (isRow) {
      const cut = Math.round(W * splitRatio);
      stageStyle = { left: 0, top: 0, width: cut - DIVIDER / 2, height: H };
      graphStyle = { left: cut + DIVIDER / 2, top: 0, width: W - cut - DIVIDER / 2, height: H };
      dividerStyle = { left: cut - DIVIDER / 2, top: 0, height: H };
    } else {
      const cut = Math.round(H * splitRatio);
      stageStyle = { left: 0, top: 0, width: W, height: cut - DIVIDER / 2 };
      graphStyle = { left: 0, top: cut + DIVIDER / 2, width: W, height: H - cut - DIVIDER / 2 };
      dividerStyle = { left: 0, top: cut - DIVIDER / 2, width: W };
    }
  } else if (isPip) {
    const ratio = ASPECT[aspectRatio] ?? 16 / 9;
    const maxBodyH = Math.max(120, H - PIP_HEAD - 24);
    const width = clamp(Math.min(pip.width, maxBodyH * ratio), 200, Math.max(200, W - 24));
    const height = Math.round(width / ratio) + PIP_HEAD;
    const right = clamp(pip.right, 8, Math.max(8, W - width - 8));
    const top = clamp(pip.top, 8, Math.max(8, H - height - 8));
    stageStyle = { left: W - right - width, top, width, height, zIndex: 30 };
    graphStyle = { left: 0, top: 0, width: W, height: H };
  }

  // The command bar floats over the bottom edge, so give the frame room when the stage reaches it.
  const stageReachesBottom = workspaceView === 'viewport' || (isSplit && isRow);
  const padBottom = !focusMode && aiMode === 'bar' && stageReachesBottom ? 58 : 0;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!focusMode && <ModeBar />}

      <div ref={wsRef} className="stage-bg relative min-h-0 flex-1 overflow-hidden">
        {graphStyle && (
          <div className="absolute overflow-hidden" style={graphStyle}>
            <NodeGraphView />
          </div>
        )}

        <div className={`absolute ${isPip ? 'pip glass' : ''}`} style={stageStyle}>
          {isPip && (
            <div
              key="pip-head"
              className="pip-head"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                dragStart.current = { ...dragStart.current, right: pip.right, top: pip.top };
                startDrag(e, (dx, dy) =>
                  setPip({ right: Math.max(8, dragStart.current.right - dx), top: Math.max(8, dragStart.current.top + dy) })
                );
              }}
            >
              <span className="live-dot" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">Live {is2D ? '2D' : '3D'} stage</span>
              <IconBtn small label="Split view" onClick={() => setWorkspaceView('split')}>
                <Columns2 size={12} />
              </IconBtn>
              <IconBtn small label="Expand to full stage" onClick={() => setWorkspaceView('viewport')}>
                <Maximize2 size={12} />
              </IconBtn>
            </div>
          )}
          <div key="stage-body" className="absolute inset-x-0 bottom-0" style={{ top: isPip ? PIP_HEAD : 0 }}>
            <StageBody compact={isPip} padBottom={padBottom} />
          </div>
          {isPip && (
            <div
              key="pip-resize"
              className="pip-resize"
              role="separator"
              aria-label="Resize live stage window"
              onPointerDown={(e) => {
                dragStart.current = { ...dragStart.current, width: Number(stageStyle.width) || pip.width };
                startDrag(e, (dx) => setPip({ width: clamp(dragStart.current.width - dx, 200, 900) }));
              }}
            />
          )}
        </div>

        {dividerStyle && (
          <div
            className={`divider ${splitOrientation} ${draggingDivider ? 'drag' : ''}`}
            style={dividerStyle}
            role="separator"
            tabIndex={0}
            aria-orientation={isRow ? 'vertical' : 'horizontal'}
            aria-label="Resize stage and node graph (double-click to reset)"
            onDoubleClick={() => setSplitRatio(0.5)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.03 : 0;
              if (step) {
                e.preventDefault();
                setSplitRatio(splitRatio + step);
              }
            }}
            onPointerDown={(e) => {
              dragStart.current = { ...dragStart.current, ratio: splitRatio };
              setDraggingDivider(true);
              startDrag(
                e,
                (dx, dy) => setSplitRatio(dragStart.current.ratio + (isRow ? dx / Math.max(1, W) : dy / Math.max(1, H))),
                () => setDraggingDivider(false)
              );
            }}
          >
            <span />
          </div>
        )}

        {focusMode && (
          <button type="button" className="chip glass-s focus-exit" onClick={toggleFocusMode}>
            <Minimize2 size={12} /> Exit focus <Kbd>\</Kbd>
          </button>
        )}

        <RightAgentChat hidden={focusMode} />
      </div>

      {!focusMode && <BottomDock />}
    </main>
  );
};
