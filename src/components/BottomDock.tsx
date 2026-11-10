import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Camera,
  Captions,
  ChevronDown,
  ChevronUp,
  Copy,
  Diamond,
  Film,
  ListVideo,
  Pause,
  Play,
  Plus,
  Repeat,
  Terminal,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { DockTabId, useShellStore } from '../state/useShellStore';
import { ExecutionConsole, useLogIssueCounts } from './ExecutionConsole';
import { AUDIO_KIND_COLOR, canSpeak, speakText } from './panels/AudioPanel';
import { IconBtn, Kbd, startDrag } from './ui';

const HEAD_HEIGHT = 34;

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
};

/** Click or drag anywhere on a lane to scrub the playhead. */
function useScrub(duration: number) {
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);
  return (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const seek = (clientX: number) =>
      setCurrentTime(Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration)));
    seek(e.clientX);
    const startX = e.clientX;
    startDrag(e, (dx) => seek(startX + dx));
  };
}

/** A scrubbable track lane with its own playhead, so only lanes repaint as the clock advances. */
const Lane: React.FC<{ duration: number; children?: React.ReactNode }> = ({ duration, children }) => {
  const currentTime = useStudioStore((s) => s.currentTime);
  const scrub = useScrub(duration);
  return (
    <div className="lane" onPointerDown={scrub} style={{ cursor: 'ew-resize', touchAction: 'none' }}>
      {children}
      <div className="playhead" style={{ left: `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%` }} />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Tab 1 · Timeline & camera keyframe sequencer
// ----------------------------------------------------------------------------
const TimelineTab: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectedNode2DId = useStudioStore((s) => s.selectedNode2DId);
  const selectActor = useStudioStore((s) => s.selectActor);
  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);
  const addCameraKeyframe = useStudioStore((s) => s.addCameraKeyframe);
  const removeCameraKeyframe = useStudioStore((s) => s.removeCameraKeyframe);

  const is2D = sceneSpec.engineType === '2d';
  const duration = Math.max(2, sceneSpec.durationSeconds || 8);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;
  const keyframes = sceneSpec.camera.keyframes || [];
  const ticks = Array.from({ length: 11 }, (_, i) => (duration / 10) * i);

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-[560px]">
        {/* Ruler */}
        <div className="tl-row sticky top-0 z-10 bg-panel" style={{ height: 22 }}>
          <div className="tl-name font-mono text-[10px]">{duration.toFixed(1)}s total</div>
          <Lane duration={duration}>
            {ticks.map((t, i) => (
              <span
                key={i}
                className="absolute top-1 font-mono text-[9px] text-dim"
                style={{ left: pct(t), transform: i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(3px)' }}
              >
                {t.toFixed(1)}
              </span>
            ))}
          </Lane>
        </div>

        {/* Camera track with keyframes (3D only) */}
        {!is2D && (
          <div className="tl-row">
            <div className="tl-name">
              <Camera size={12} className="shrink-0 text-media" />
              <span className="min-w-0 flex-1 truncate">{sceneSpec.camera.mode}</span>
              <button
                type="button"
                className="orow-b keep"
                title="Add camera keyframe at the playhead"
                aria-label="Add camera keyframe at the playhead"
                onClick={addCameraKeyframe}
              >
                <Diamond size={11} />
              </button>
            </div>
            <Lane duration={duration}>
              <div className="clip" style={{ left: 0, right: 0, ['--c' as any]: '#f58fc0', opacity: 0.55 }}>
                {keyframes.length === 0 ? 'Preset camera track · add keyframes for a custom spline' : `${keyframes.length} keyframes`}
              </div>
              {keyframes.map((kf, i) => (
                <button
                  key={kf.id || i}
                  type="button"
                  className="kf"
                  style={{ left: pct(kf.time), zIndex: 6 }}
                  title={`${kf.label || 'Keyframe'} @ ${kf.time.toFixed(1)}s: click to jump, Shift+click to delete`}
                  aria-label={`Camera keyframe at ${kf.time.toFixed(1)} seconds`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => (e.shiftKey ? removeCameraKeyframe(i) : setCurrentTime(kf.time))}
                />
              ))}
            </Lane>
          </div>
        )}

        {/* Actor / layer tracks */}
        {!is2D &&
          sceneSpec.actors.map((actor) => {
            const st = actor.startTime ?? 0;
            const et = actor.endTime ?? duration;
            return (
              <div key={actor.id} className="tl-row">
                <button type="button" className={`tl-name text-left ${actor.id === selectedActorId ? 'sel' : ''}`} onClick={() => selectActor(actor.id)}>
                  <i className="tag-dot" style={{ background: actor.primaryColor }} />
                  <span className="truncate">{actor.name}</span>
                </button>
                <Lane duration={duration}>
                  <div
                    className="clip"
                    style={{ left: pct(st), width: `${Math.max(3, ((et - st) / duration) * 100)}%`, ['--c' as any]: actor.primaryColor || '#5aa9ff' }}
                  >
                    {actor.activeClip || actor.activeAnimation} · {st.toFixed(1)}–{et.toFixed(1)}s
                  </div>
                </Lane>
              </div>
            );
          })}
        {is2D &&
          (sceneSpec.nodes2D || []).map((node) => (
            <div key={node.id} className="tl-row">
              <button type="button" className={`tl-name text-left ${node.id === selectedNode2DId ? 'sel' : ''}`} onClick={() => selectNode2D(node.id)}>
                <i className="tag-dot" style={{ background: node.fill }} />
                <span className="truncate">{node.name}</span>
              </button>
              <Lane duration={duration}>
                <div className="clip" style={{ left: 0, right: 0, ['--c' as any]: node.fill || '#f58fc0' }}>
                  {node.type} · {node.physics2D}
                </div>
                {(node.keyframeTrack || []).map((kf, i) => (
                  <span key={i} className="kf" style={{ left: pct(kf.time), pointerEvents: 'none' }} />
                ))}
              </Lane>
            </div>
          ))}

        {/* VFX cues */}
        {!is2D &&
          sceneSpec.vfx.map((vfx) => {
            const st = vfx.startTime ?? 0;
            const et = vfx.endTime ?? duration;
            return (
              <div key={vfx.id} className="tl-row">
                <div className="tl-name">
                  <i className="tag-dot" style={{ background: vfx.color }} />
                  <span className="truncate">{vfx.name}</span>
                </div>
                <Lane duration={duration}>
                  <div className="clip" style={{ left: pct(st), width: `${Math.max(3, ((et - st) / duration) * 100)}%`, ['--c' as any]: vfx.color || '#f2b441' }}>
                    {vfx.type}
                  </div>
                </Lane>
              </div>
            );
          })}

        {(is2D ? (sceneSpec.nodes2D || []).length : sceneSpec.actors.length) === 0 && (
          <p className="p-4 text-center text-[11px] text-dim">Nothing on stage yet. Tracks appear here as you add actors and layers.</p>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Tab 2 · Multi-scene storyboard strip
// ----------------------------------------------------------------------------
const StoryboardTab: React.FC = () => {
  const scenes = useStudioStore((s) => s.scenes);
  const activeSceneId = useStudioStore((s) => s.activeSceneId);
  const activeSpec = useStudioStore((s) => s.sceneSpec);
  const switchScene = useStudioStore((s) => s.switchScene);
  const duplicateScene = useStudioStore((s) => s.duplicateScene);
  const deleteScene = useStudioStore((s) => s.deleteScene);
  const moveScene = useStudioStore((s) => s.moveScene);
  const renameScene = useStudioStore((s) => s.renameScene);
  const createNewBlankScene = useStudioStore((s) => s.createNewBlankScene);

  return (
    <div className="flex h-full items-stretch gap-2 overflow-x-auto p-2.5">
      {scenes.map((stored, idx) => {
        const active = stored.id === activeSceneId;
        const sc = active ? activeSpec : stored;
        const count = sc.engineType === '2d' ? (sc.nodes2D || []).length : sc.actors.length;
        return (
          <div
            key={sc.id}
            className={`scene-card ${active ? 'on' : ''}`}
            onClick={() => !active && switchScene(sc.id)}
            role="button"
            tabIndex={0}
            aria-current={active}
            onKeyDown={(e) => e.key === 'Enter' && !active && switchScene(sc.id)}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-accent">{String(idx + 1).padStart(2, '0')}</span>
              <span className="rounded bg-bg px-1 font-mono text-[9px] uppercase text-mute">{sc.engineType || '3d'}</span>
              <span className={`rounded px-1 font-mono text-[9px] uppercase ${sc.mode === 'game' ? 'bg-game/15 text-game' : 'bg-media/15 text-media'}`}>
                {sc.mode}
              </span>
              {sc.sequence && (
                <span className="ml-auto font-mono text-[9px] text-dim" title={sc.sequence.storyboardTitle}>
                  {sc.sequence.kind === 'game-levels' ? 'Lv' : 'Shot'} {sc.sequence.index + 1}/{sc.sequence.total}
                </span>
              )}
            </div>
            <input
              className="proj w-full"
              style={{ width: '100%', padding: '2px 4px' }}
              aria-label={`Scene ${idx + 1} title`}
              value={sc.title}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => renameScene(sc.id, e.target.value)}
            />
            <div className="font-mono text-[10px] text-dim">
              {count} {sc.engineType === '2d' ? 'layers' : 'actors'} · {(sc.durationSeconds || 8).toFixed(0)}s · {sc.aspectRatio}
            </div>
            <div className="mt-auto flex items-center" onClick={(e) => e.stopPropagation()}>
              <IconBtn small label="Move scene earlier" disabled={idx === 0} onClick={() => moveScene(sc.id, -1)}>
                <ArrowLeft size={12} />
              </IconBtn>
              <IconBtn small label="Move scene later" disabled={idx === scenes.length - 1} onClick={() => moveScene(sc.id, 1)}>
                <ArrowRight size={12} />
              </IconBtn>
              <div className="flex-1" />
              <IconBtn small label="Duplicate scene" onClick={() => duplicateScene(sc.id)}>
                <Copy size={12} />
              </IconBtn>
              <IconBtn small danger label="Delete scene" disabled={scenes.length <= 1} onClick={() => deleteScene(sc.id)}>
                <Trash2 size={12} />
              </IconBtn>
            </div>
          </div>
        );
      })}
      <div className="flex shrink-0 flex-col justify-center gap-1.5">
        <button type="button" className="btn" onClick={() => createNewBlankScene('3d', `3D Scene ${scenes.length + 1}`)}>
          <Plus size={13} className="text-accent" /> 3D scene
        </button>
        <button type="button" className="btn" onClick={() => createNewBlankScene('2d', `2D Level ${scenes.length + 1}`)}>
          <Plus size={13} className="text-media" /> 2D level
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Tab 3 · Captions & audio mixer
// ----------------------------------------------------------------------------
const CaptionsAudioTab: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const currentTime = useStudioStore((s) => s.currentTime);
  const addCaption = useStudioStore((s) => s.addCaption);
  const updateCaption = useStudioStore((s) => s.updateCaption);
  const removeCaption = useStudioStore((s) => s.removeCaption);
  const updateAudioTrack = useStudioStore((s) => s.updateAudioTrack);
  const removeAudioTrack = useStudioStore((s) => s.removeAudioTrack);
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const railPanel = useShellStore((s) => s.railPanel);

  const duration = Math.max(2, sceneSpec.durationSeconds || 8);
  const captions = sceneSpec.captions || [];
  const tracks = sceneSpec.audioTracks || [];
  const scrub = useScrub(duration);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Captions */}
      <div className="flex min-h-0 flex-1 flex-col border-line md:border-r">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1">
          <Captions size={13} className="text-media" />
          <span className="text-[11px] font-medium">Captions</span>
          <span className="font-mono text-[10px] text-dim">{captions.length}</span>
          <div className="flex-1" />
          <button type="button" className="btn sm" onClick={() => addCaption()}>
            <Plus size={11} /> At playhead
          </button>
        </div>
        <div className="lane h-6 shrink-0 border-b border-line" onPointerDown={scrub} style={{ flex: 'none', cursor: 'ew-resize', touchAction: 'none' }}>
          {captions.map((c) => (
            <div key={c.id} className="clip" style={{ left: pct(c.start), width: `${Math.max(2, ((c.end - c.start) / duration) * 100)}%`, top: 3, bottom: 3, ['--c' as any]: '#f58fc0' }}>
              {c.text}
            </div>
          ))}
          <div className="playhead" style={{ left: pct(currentTime) }} />
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {captions.length === 0 && (
            <p className="p-2 text-center text-[11px] text-dim">No captions. Add one at the playhead; it shows over the stage during its time window.</p>
          )}
          {captions.map((c) => {
            const live = currentTime >= c.start && currentTime <= c.end;
            return (
              <div key={c.id} className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 ${live ? 'bg-media/10' : ''}`}>
                <input
                  type="number"
                  className="field sm w-14 text-right font-mono"
                  aria-label="Caption start (s)"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={c.start}
                  onChange={(e) => updateCaption(c.id, { start: Math.max(0, parseFloat(e.target.value) || 0) })}
                />
                <input
                  type="number"
                  className="field sm w-14 text-right font-mono"
                  aria-label="Caption end (s)"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={c.end}
                  onChange={(e) => updateCaption(c.id, { end: Math.max(c.start + 0.1, parseFloat(e.target.value) || 0) })}
                />
                <input
                  className="field sm min-w-0 flex-1"
                  aria-label="Caption text"
                  value={c.text}
                  onChange={(e) => updateCaption(c.id, { text: e.target.value })}
                  onFocus={() => setCurrentTime(c.start)}
                />
                <IconBtn
                  small
                  label={c.speak ? 'Voiceover on: read aloud during playback' : 'Voiceover off'}
                  active={Boolean(c.speak)}
                  disabled={!canSpeak()}
                  onClick={() => updateCaption(c.id, { speak: !c.speak })}
                >
                  <Volume2 size={12} />
                </IconBtn>
                <IconBtn small label="Preview voiceover" disabled={!canSpeak()} onClick={() => speakText(c.text)}>
                  <Play size={11} />
                </IconBtn>
                <IconBtn small danger label="Delete caption" onClick={() => removeCaption(c.id)}>
                  <Trash2 size={12} />
                </IconBtn>
              </div>
            );
          })}
        </div>
      </div>

      {/* Audio mixer */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1">
          <AudioLines size={13} className="text-accent" />
          <span className="text-[11px] font-medium">Audio mixer</span>
          <span className="font-mono text-[10px] text-dim">{tracks.length}</span>
          <div className="flex-1" />
          <button type="button" className="btn sm" onClick={() => railPanel !== 'audio' && togglePanel('audio')}>
            <Plus size={11} /> Import audio
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tracks.length === 0 && (
            <p className="p-4 text-center text-[11px] text-dim">No audio tracks. Import music, SFX or voice from the Audio &amp; Voiceover panel.</p>
          )}
          {tracks.map((t) => (
            <div key={t.id} className="tl-row" style={{ height: 32 }}>
              <div className="tl-name" style={{ width: 210 }}>
                <i className="tag-dot" style={{ background: AUDIO_KIND_COLOR[t.kind] }} />
                <span className="min-w-0 flex-1 truncate" title={t.name}>{t.name}</span>
                <button
                  type="button"
                  className={`orow-b keep ${t.muted ? 'text-warn' : ''}`}
                  aria-pressed={Boolean(t.muted)}
                  aria-label={t.muted ? `Unmute ${t.name}` : `Mute ${t.name}`}
                  onClick={() => updateAudioTrack(t.id, { muted: !t.muted })}
                >
                  {t.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
                <button type="button" className="orow-b keep danger" aria-label={`Remove ${t.name}`} onClick={() => removeAudioTrack(t.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
                <input
                  type="range"
                  className="rng w-20 shrink-0"
                  aria-label={`${t.name} volume`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={t.volume}
                  onChange={(e) => updateAudioTrack(t.id, { volume: parseFloat(e.target.value) })}
                />
                <div className="lane h-full" onPointerDown={scrub} style={{ cursor: 'ew-resize', touchAction: 'none' }}>
                  <div className="clip" style={{ left: pct(t.startTime), right: 0, ['--c' as any]: AUDIO_KIND_COLOR[t.kind], opacity: t.muted ? 0.4 : 1 }}>
                    {t.kind} · from {t.startTime.toFixed(1)}s{t.loop ? ' · loop' : ''}
                  </div>
                  <div className="playhead" style={{ left: pct(currentTime) }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Dock frame
// ----------------------------------------------------------------------------
export const BottomDock: React.FC = () => {
  const [dragging, setDragging] = useState(false);
  const startHeight = useRef(0);

  const collapsed = useStudioStore((s) => s.isBottomDockCollapsed);
  const setCollapsed = useStudioStore((s) => s.setBottomDockCollapsed);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const isLooping = useStudioStore((s) => s.isLooping);
  const currentTime = useStudioStore((s) => s.currentTime);
  const duration = useStudioStore((s) => Math.max(2, s.sceneSpec.durationSeconds || 8));
  const sceneCount = useStudioStore((s) => s.scenes.length);
  const captionCount = useStudioStore((s) => (s.sceneSpec.captions || []).length + (s.sceneSpec.audioTracks || []).length);
  const togglePlay = useStudioStore((s) => s.togglePlay);
  const toggleLoop = useStudioStore((s) => s.toggleLoop);
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);

  const dockTab = useShellStore((s) => s.dockTab);
  const dockHeight = useShellStore((s) => s.dockHeight);
  const setDockTab = useShellStore((s) => s.setDockTab);
  const setDockHeight = useShellStore((s) => s.setDockHeight);
  const { errors, warnings } = useLogIssueCounts();

  const tabs: { id: DockTabId; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { id: 'timeline', label: 'Timeline', icon: <Film size={13} /> },
    { id: 'storyboard', label: 'Storyboard', icon: <ListVideo size={13} />, badge: <span className="font-mono text-[10px] text-dim">{sceneCount}</span> },
    { id: 'captions', label: 'Captions & Audio', icon: <Captions size={13} />, badge: captionCount > 0 ? <span className="font-mono text-[10px] text-dim">{captionCount}</span> : null },
    {
      id: 'logs',
      label: 'Logs',
      icon: <Terminal size={13} />,
      badge: (
        <>
          {errors > 0 && <span className="badge-err">{errors}</span>}
          {warnings > 0 && <span className="badge-warn">{warnings}</span>}
        </>
      ),
    },
  ];

  return (
    <section className="dock" style={{ height: collapsed ? HEAD_HEIGHT : dockHeight }} aria-label="Bottom dock">
      {!collapsed && (
        <div
          className={`dock-grip ${dragging ? 'drag' : ''}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize dock"
          onPointerDown={(e) => {
            startHeight.current = dockHeight;
            setDragging(true);
            startDrag(e, (_dx, dy) => setDockHeight(startHeight.current - dy), () => setDragging(false));
          }}
        />
      )}

      <div className="dock-head">
        {/* Transport: always reachable, even with the dock collapsed */}
        <button type="button" className="send ml-1" style={{ width: 24, height: 24 }} onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
        </button>
        <IconBtn small label="Loop playback" active={isLooping} onClick={toggleLoop}>
          <Repeat size={13} />
        </IconBtn>
        <span className="shrink-0 font-mono text-[11px] text-fg">{fmtTime(currentTime)}</span>
        <input
          type="range"
          className="rng hidden w-28 shrink-0 lg:block"
          aria-label="Scrub timeline"
          min={0}
          max={duration}
          step={0.05}
          value={Math.min(currentTime, duration)}
          onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
        />
        <span className="shrink-0 font-mono text-[10px] text-dim">/ {fmtTime(duration)}</span>
        <span className="topbar-sep mx-1" />

        <div role="tablist" aria-label="Dock sections" className="flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={dockTab === t.id && !collapsed}
              className={`dock-tab ${dockTab === t.id && !collapsed ? 'on' : ''}`}
              onClick={() => {
                setDockTab(t.id);
                if (collapsed) setCollapsed(false);
              }}
            >
              {t.icon}
              <span className={t.id === dockTab ? '' : 'hidden md:inline'}>{t.label}</span>
              {t.badge}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <Kbd>`</Kbd>
        <IconBtn small label={collapsed ? 'Expand dock  [`]' : 'Collapse dock  [`]'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </IconBtn>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1" role="tabpanel">
          {dockTab === 'timeline' && <TimelineTab />}
          {dockTab === 'storyboard' && <StoryboardTab />}
          {dockTab === 'captions' && <CaptionsAudioTab />}
          {dockTab === 'logs' && <ExecutionConsole />}
        </div>
      )}
    </section>
  );
};
