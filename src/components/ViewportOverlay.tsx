/**
 * Phase 7B — studio viewport overlay: FPS / frame-time meter, render-quality selector and on-screen touch controls.
 * Touch buttons dispatch synthetic key events on `window`, so the studio's existing 2D/3D game input (and logic-graph
 * key-press events) handle them exactly like a keyboard — the same buttons the OmniStage Player shows on phones.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../state/useStudioStore';
import { touchButtons, touchLayoutFor } from '../runtime/touchLayout';
import type { SettingsConfig } from '../types/scene.schema';

const KEY_EVENT_NAME: Record<string, string> = { arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', ' ': ' ' };

function sendKey(type: 'keydown' | 'keyup', key: string) {
  const name = KEY_EVENT_NAME[key] || key;
  window.dispatchEvent(new KeyboardEvent(type, { key: name, code: name === ' ' ? 'Space' : name, bubbles: true }));
}

function TouchKey({ label, keyName, style, big }: { label: string; keyName: string; style?: React.CSSProperties; big?: boolean }) {
  const [down, setDown] = useState(false);
  const release = () => {
    if (!down) return;
    setDown(false);
    sendKey('keyup', keyName);
  };
  return (
    <button
      type="button"
      style={{ ...style, touchAction: 'none' }}
      className={`${big ? 'w-16 h-16 text-xs' : 'w-12 h-12 text-base'} rounded-full font-bold select-none border backdrop-blur ${
        down ? 'bg-cyan-400/50 border-cyan-200 text-white' : 'bg-slate-900/55 border-slate-500/60 text-slate-100'
      }`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setDown(true);
        sendKey('keydown', keyName);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      {label}
    </button>
  );
}

function useFpsMeter(enabled: boolean) {
  const [stats, setStats] = useState({ fps: 0, ms: 0, worst: 0 });
  const frames = useRef<number[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = performance.now();
    let lastReport = last;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      frames.current.push(now - last);
      last = now;
      if (now - lastReport > 500) {
        const list = frames.current.splice(0);
        const avg = list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
        setStats({ fps: Math.round(1000 / Math.max(1, avg)), ms: Math.round(avg * 10) / 10, worst: Math.round(Math.max(0, ...list)) });
        lastReport = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
  return stats;
}

export const ViewportOverlay: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const gameEnded = useStudioStore((s) => s.gameEnded);
  const quality = useStudioStore((s) => s.settings.renderQuality);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const [showPerf, setShowPerf] = useState(false);
  const [forceTouch, setForceTouch] = useState(false);
  const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || (window.matchMedia?.('(pointer: coarse)').matches ?? false));
  const stats = useFpsMeter(showPerf);

  const layout = isPlaying && (isTouch || forceTouch) ? touchLayoutFor(sceneSpec, gameEnded) : 'none';
  const buttons = touchButtons(layout);
  const fpsColor = stats.fps >= 50 ? 'text-emerald-300' : stats.fps >= 30 ? 'text-amber-300' : 'text-rose-300';

  return (
    <>
      <div className="absolute top-1/2 right-2 -translate-y-1/2 z-20 flex flex-col items-end gap-1.5 text-[10px] font-mono">
        <button type="button" onClick={() => setShowPerf((v) => !v)} title="Show frame rate and frame time"
          className={`px-2 py-1 rounded border ${showPerf ? 'border-cyan-500/60 text-cyan-200 bg-cyan-500/10' : 'border-slate-700 text-slate-400 bg-[#090D16E6]'}`}>
          {showPerf ? <span className={fpsColor} title={`avg ${stats.ms} ms · worst ${stats.worst} ms`}>{stats.fps} FPS · {stats.worst} ms</span> : 'FPS'}
        </button>
        <select value={quality} title="Render quality (shadows, pixel ratio, reflections)"
          onChange={(e) => updateSettings({ renderQuality: e.target.value as SettingsConfig['renderQuality'] })}
          className="px-1.5 py-1 rounded border border-slate-700 bg-[#090D16E6] text-slate-300">
          <option value="draft">Draft</option>
          <option value="high">High</option>
          <option value="ultra-postprocessing">Ultra</option>
        </select>
        {sceneSpec.mode === 'game' && !isTouch && (
          <button type="button" onClick={() => setForceTouch((v) => !v)} title="Show the on-screen phone controls"
            className={`px-2 py-1 rounded border ${forceTouch ? 'border-fuchsia-500/60 text-fuchsia-200 bg-fuchsia-500/10' : 'border-slate-700 text-slate-400 bg-[#090D16E6]'}`}>
            📱 Touch
          </button>
        )}
      </div>
      {layout !== 'none' && (
        <>
          <div className="absolute bottom-12 left-4 z-30 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(3, 3rem)', gridTemplateRows: 'repeat(2, 3rem)' }}>
            {buttons.pad.map(([label, key, col, row]) => (
              <TouchKey key={key} label={label} keyName={key} style={{ gridColumn: col, gridRow: row }} />
            ))}
          </div>
          {buttons.action && (
            <div className="absolute bottom-14 right-5 z-30">
              <TouchKey big label={buttons.action[0]} keyName={buttons.action[1]} />
            </div>
          )}
        </>
      )}
    </>
  );
};
