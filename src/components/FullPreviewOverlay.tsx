import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { transitionInto, transitionOverlay } from '../runtime/cinematics';
import { useStudioStore } from '../state/useStudioStore';
import { StageCanvas } from '../renderer/StageCanvas';
import { StageCanvas2D } from '../renderer/StageCanvas2D';
import { activeCaptions } from '../media/captions';

const FADE_MS = 450;

/**
 * Phase 6 batch 2 — Full preview: plays every scene of the storyboard (or project) from start to end, full screen,
 * with fade transitions, captions and audio cues. The main viewport unmounts its canvas while this is open, so only
 * one renderer drives the timeline.
 */
export const FullPreviewOverlay: React.FC = () => {
  const fp = useStudioStore((s) => s.fullPreview);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const currentTime = useStudioStore((s) => s.currentTime);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const goto = useStudioStore((s) => s.gotoFullPreviewScene);
  const end = useStudioStore((s) => s.endFullPreview);
  const stop = useStudioStore((s) => s.stopFullPreview);
  const setIsPlaying = useStudioStore((s) => s.setIsPlaying);
  const [fading, setFading] = useState(false);
  const [fadeStyle, setFadeStyle] = useState({ color: '#000000', ms: FADE_MS });
  // The pending scene change lives in a ref: later currentTime updates must not cancel it (that left the
  // preview stuck at the end of a scene).
  const advanceTimer = useRef<number | null>(null);

  const duration = Math.max(1, sceneSpec.durationSeconds || 8);

  const cancelAdvance = () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    setFading(false);
  };

  // Auto-advance at the end of each scene.
  useEffect(() => {
    if (!fp || fp.ended || advanceTimer.current !== null) return;
    if (currentTime < duration - 0.05) return;
    const index = fp.index;
    const count = fp.order.length;
    // Phase 10A: the next scene's own transition (cut / fade / fade-white …).
    const nextScene = index + 1 < count ? scenes.find((s) => s.id === fp.order[index + 1]) : undefined;
    const overlay = nextScene ? transitionOverlay(transitionInto(nextScene)) : { color: '#000000', ms: FADE_MS };
    setFadeStyle(overlay || { color: '#000000', ms: 0 });
    setFading(!!overlay);
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null;
      if (index + 1 < count) goto(index + 1);
      else end();
      window.setTimeout(() => setFading(false), 60);
    }, overlay ? overlay.ms : 0);
  }, [currentTime, duration, fp?.index, fp?.ended]);

  // Manual navigation or closing the preview cancels a pending transition.
  useEffect(() => cancelAdvance, [fp?.index]);
  useEffect(() => () => cancelAdvance(), []);

  useEffect(() => {
    if (!fp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowRight') goto(fp.index + 1);
      else if (e.key === 'ArrowLeft') goto(fp.index - 1);
      else if (e.key === ' ' && sceneSpec.mode === 'media') {
        e.preventDefault();
        setIsPlaying(!useStudioStore.getState().isPlaying);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fp?.index, sceneSpec.mode]);

  if (!fp) return null;

  const is2D = sceneSpec.engineType === '2d';
  const frameClass =
    sceneSpec.aspectRatio === '9:16' ? 'h-full aspect-[9/16] max-w-full' : sceneSpec.aspectRatio === '1:1' ? 'h-full aspect-square max-w-full' : 'w-full max-h-full aspect-video';
  const durations = fp.order.map((id) => Math.max(1, scenes.find((s) => s.id === id)?.durationSeconds || 8));
  const total = durations.reduce((a, b) => a + b, 0);
  const elapsed = durations.slice(0, fp.index).reduce((a, b) => a + b, 0) + Math.min(currentTime, duration);

  return (
    <div className="fixed inset-0 z-[85] bg-black flex flex-col text-xs" role="dialog" aria-modal="true" aria-label="Full preview">
      <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-b from-black/90 to-transparent absolute top-0 inset-x-0 z-20">
        <span className="font-bold text-slate-100">▶ Preview</span>
        <span className="text-slate-300 truncate">
          Scene {fp.index + 1}/{fp.order.length} · {sceneSpec.title}
        </span>
        <span className="ml-auto font-mono text-slate-400">
          {elapsed.toFixed(1)}s / {total.toFixed(1)}s
        </span>
        <button type="button" onClick={stop} aria-label="Exit preview" className="p-1.5 rounded border border-slate-700 text-slate-200 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        <div className={`relative overflow-hidden bg-[#0B101B] ${frameClass}`}>
          {is2D ? <StageCanvas2D /> : <StageCanvas />}
          {!is2D &&
            activeCaptions(sceneSpec.captions, currentTime).map((cue, i) => (
              <div key={cue.id || i} className={`pointer-events-none absolute inset-x-0 flex justify-center px-6 ${cue.position === 'top' ? 'top-[8%]' : cue.position === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-[9%]'}`}>
                <span className={cue.style === 'title' ? 'text-3xl font-extrabold text-white text-center [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]' : 'px-3 py-1.5 rounded bg-slate-950/75 text-sm font-semibold text-slate-50 text-center'}>{cue.text}</span>
              </div>
            ))}
          <div className="pointer-events-none absolute inset-0 transition-opacity" style={{ background: fadeStyle.color, opacity: fading ? 1 : 0, transitionDuration: `${fadeStyle.ms}ms` }} />
          {fp.ended && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3">
              <div className="text-2xl font-bold text-white">The end</div>
              <div className="text-slate-400">{fp.order.length} scene(s) · {total.toFixed(1)} s</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => goto(0)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold">
                  <RotateCcw className="w-3.5 h-3.5" /> Replay
                </button>
                <button type="button" onClick={stop} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200">Back to editor</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-3 pt-1 space-y-2">
        <div className="flex gap-1" aria-label="Scenes">
          {fp.order.map((id, i) => {
            const pct = i < fp.index ? 100 : i === fp.index ? Math.min(100, (currentTime / duration) * 100) : 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => goto(i)}
                title={scenes.find((s) => s.id === id)?.title}
                style={{ flexGrow: durations[i] }}
                className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
              >
                <div className="h-full bg-cyan-400" style={{ width: `${pct}%` }} />
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => goto(fp.index - 1)} disabled={fp.index === 0} aria-label="Previous scene" className="p-2 rounded-full border border-slate-700 text-slate-200 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setIsPlaying(!isPlaying)} aria-label={isPlaying ? 'Pause' : 'Play'} className="p-2.5 rounded-full bg-cyan-500 text-slate-950">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button type="button" onClick={() => goto(fp.index + 1)} disabled={fp.index >= fp.order.length - 1} aria-label="Next scene" className="p-2 rounded-full border border-slate-700 text-slate-200 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="text-center text-[10px] text-slate-500">Space pause · ←/→ scene · Esc exit</div>
      </div>
    </div>
  );
};
