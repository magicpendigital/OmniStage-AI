import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Gauge, Loader2, Maximize2, Monitor, RotateCcw, Smartphone, Tablet, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { buildStandalonePlayable } from '../exporter/mediaExporter';
import { verifySceneSpec } from '../verification/sceneVerifier';
import { previewOrder } from '../playtest/previewOrder';

type Device = 'fit' | 'phone-portrait' | 'phone-landscape' | 'tablet';
const DEVICES: Record<Exclude<Device, 'fit'>, { w: number; h: number; label: string }> = {
  'phone-portrait': { w: 390, h: 844, label: 'Phone' },
  'phone-landscape': { w: 844, h: 390, label: 'Phone ↔' },
  tablet: { w: 820, h: 1180, label: 'Tablet' },
};

interface PhoneSession {
  urls: string[];
  qrs: string[];
  localUrl: string;
  expiresInMinutes: number;
}

/**
 * Phase 6 batch 2 — Play Test: runs the exported playable (the exact build you publish) in a sandboxed iframe,
 * with device frames, FPS meter, per-level verifier status and "Play on phone" (LAN + QR).
 */
export const PlayTestModal: React.FC = () => {
  const playTest = useStudioStore((s) => s.playTest);
  const closePlayTest = useStudioStore((s) => s.closePlayTest);
  const scenes = useStudioStore((s) => s.scenes);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const activeSceneId = useStudioStore((s) => s.activeSceneId);
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const [startId, setStartId] = useState<string>('');
  const [device, setDevice] = useState<Device>('fit');
  const [showFps, setShowFps] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [html, setHtml] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState<PhoneSession | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [areaSize, setAreaSize] = useState({ w: 800, h: 600 });

  // Live scenes: the open scene's edits may not be synced into scenes[] yet.
  const liveScenes = useMemo(
    () => (scenes.length ? scenes.map((s) => (s.id === activeSceneId ? sceneSpec : s)) : [sceneSpec]),
    [scenes, sceneSpec, activeSceneId]
  );
  const order = useMemo(() => previewOrder(liveScenes, activeSceneId), [liveScenes, activeSceneId]);
  const ordered = useMemo(() => order.map((id) => liveScenes.find((s) => s.id === id)!).filter(Boolean), [order, liveScenes]);
  const reports = useMemo(() => ordered.map((s) => ({ scene: s, report: verifySceneSpec(s, { scenes: liveScenes }) })), [ordered, liveScenes]);

  useEffect(() => {
    if (playTest) {
      setStartId(playTest.startSceneId);
      setPhone(null);
      setPhoneError(null);
    }
  }, [playTest?.startSceneId]);

  useEffect(() => {
    if (!playTest || !startId) return;
    let cancelled = false;
    setBuilding(true);
    setError(null);
    const start = liveScenes.find((s) => s.id === startId) || ordered[0] || sceneSpec;
    buildStandalonePlayable(start, 'universal', ordered.length ? ordered : liveScenes, { offline: true, showFps })
      .then((r) => !cancelled && setHtml(r.html))
      .catch((e) => !cancelled && setError(e?.message || 'Build failed'))
      .finally(() => !cancelled && setBuilding(false));
    return () => {
      cancelled = true;
    };
    // Rebuild when the start level, FPS toggle or restart key changes (not on every scene edit).
  }, [playTest, startId, showFps, reloadKey]);

  useEffect(() => {
    if (!playTest || !areaRef.current) return;
    const el = areaRef.current;
    const ro = new ResizeObserver(() => setAreaSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [playTest]);

  useEffect(() => {
    if (!playTest) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && closePlayTest();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playTest]);

  if (!playTest) return null;

  const frame = device === 'fit' ? null : DEVICES[device];
  const scale = frame ? Math.min(1, (areaSize.w - 24) / frame.w, (areaSize.h - 24) / frame.h) : 1;

  const playOnPhone = async () => {
    if (!html) return;
    setPhoneBusy(true);
    setPhoneError(null);
    try {
      const res = await fetch('/api/play/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, title: sceneSpec.title }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create a phone link');
      if (!json.urls?.length) throw new Error('No Wi-Fi / LAN address found on this computer. Connect to a network and try again.');
      setPhone(json);
    } catch (e: any) {
      setPhoneError(e?.message || 'Could not create a phone link');
    } finally {
      setPhoneBusy(false);
    }
  };

  const failing = reports.filter((r) => !r.report.ok).length;

  return (
    <div ref={rootRef} className="fixed inset-0 z-[90] bg-[#05070D] flex flex-col text-xs" role="dialog" aria-modal="true" aria-label="Play Test">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-800 bg-[#090D16]">
        <span className="font-bold text-slate-100 text-sm">▶ Play Test</span>
        <span className="text-slate-500 hidden md:inline">the exact build that Export publishes</span>

        <label className="flex items-center gap-1 text-slate-300 ml-2">
          Start from
          <select value={startId} onChange={(e) => setStartId(e.target.value)} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 max-w-[180px]">
            {ordered.map((s, i) => (
              <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center rounded-lg border border-slate-700 overflow-hidden">
          {([
            ['fit', 'Fit', Monitor],
            ['phone-portrait', 'Phone', Smartphone],
            ['phone-landscape', 'Phone ↔', Smartphone],
            ['tablet', 'Tablet', Tablet],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setDevice(id)} className={`inline-flex items-center gap-1 px-2 py-1 ${device === id ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon className={`w-3 h-3 ${id === 'phone-landscape' ? 'rotate-90' : ''}`} /> {label}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => setShowFps((v) => !v)} className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${showFps ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
          <Gauge className="w-3 h-3" /> FPS
        </button>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} title="Restart" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-white">
          <RotateCcw className="w-3 h-3" /> Restart
        </button>
        <button
          type="button"
          onClick={playOnPhone}
          disabled={!html || phoneBusy || workspaceAvailable === false}
          title={workspaceAvailable === false ? 'Needs OmniStage running on this computer' : 'Open on a phone on the same Wi-Fi'}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-violet-500/20 border border-violet-500/40 text-violet-100 font-semibold disabled:opacity-40"
        >
          {phoneBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />} Play on phone
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] border ${failing ? 'border-amber-500/40 text-amber-300' : 'border-emerald-500/40 text-emerald-300'}`}>
            <Activity className="w-3 h-3" /> {failing ? `${failing}/${reports.length} level(s) need attention` : `${reports.length} level(s) verified`}
          </span>
          <button type="button" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen?.())} title="Full screen" className="p-1.5 rounded border border-slate-700 text-slate-300 hover:text-white">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={closePlayTest} aria-label="Close Play Test" className="p-1.5 rounded border border-slate-700 text-slate-300 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div ref={areaRef} className="flex-1 min-w-0 relative flex items-center justify-center overflow-hidden">
          {building && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Building playable…</div>
          )}
          {error && <div className="text-rose-300 p-4">{error}</div>}
          {html && !error && (
            <div
              style={
                frame
                  ? { width: frame.w, height: frame.h, transform: `scale(${scale})`, transformOrigin: 'center' }
                  : { width: '100%', height: '100%' }
              }
              className={frame ? 'shrink-0 rounded-[28px] border-[6px] border-slate-700 overflow-hidden shadow-2xl bg-black' : 'w-full h-full'}
            >
              <iframe
                ref={iframeRef}
                key={`${reloadKey}-${startId}-${showFps}`}
                title="OmniStage playable"
                srcDoc={html}
                sandbox="allow-scripts allow-pointer-lock"
                allow="autoplay; gamepad; fullscreen"
                onLoad={() => iframeRef.current?.focus()}
                className="w-full h-full border-0 bg-black"
              />
            </div>
          )}
        </div>

        <aside className="w-64 shrink-0 border-l border-slate-800 bg-[#090D16] p-3 space-y-3 overflow-y-auto hidden md:block">
          <div>
            <div className="font-semibold text-slate-200 mb-1">Levels</div>
            {reports.map(({ scene, report }, i) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => setStartId(scene.id)}
                className={`w-full text-left px-2 py-1.5 rounded mb-1 border ${scene.id === startId ? 'border-cyan-500/50 bg-cyan-950/30' : 'border-slate-800 bg-slate-900'}`}
                title={report.issues.map((x) => x.message).join('\n') || 'No issues'}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${report.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-slate-200 truncate">{i + 1}. {scene.title}</span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 pl-3">
                  {scene.engineType.toUpperCase()} · {scene.mode}{report.ok ? '' : ` · ${report.errors} error(s)`}{report.warnings ? ` · ${report.warnings} warn` : ''}
                </div>
              </button>
            ))}
          </div>

          <div className="text-slate-400 space-y-1">
            <div className="font-semibold text-slate-200">Controls</div>
            <div>2D: A/D or ←/→ run · W/↑/Space jump</div>
            <div>3D: WASD move · click / tap actors</div>
            <div>Touch screens show on-screen buttons.</div>
          </div>

          {phoneError && <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-rose-200">{phoneError}</div>}
          {phone && (
            <div className="p-2.5 rounded-lg bg-slate-900 border border-violet-500/40 space-y-2">
              <div className="font-semibold text-violet-200">📱 Scan with your phone</div>
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(phone.qrs[0])}`}
                alt={`QR code for ${phone.urls[0]}`}
                className="w-full bg-white rounded p-1.5"
              />
              <div className="font-mono text-[10px] text-slate-300 break-all">{phone.urls[0]}</div>
              {phone.urls.length > 1 && (
                <details className="text-[10px] text-slate-400">
                  <summary>Other network addresses</summary>
                  {phone.urls.slice(1).map((u) => <div key={u} className="font-mono break-all">{u}</div>)}
                </details>
              )}
              <p className="text-[10px] text-slate-400">
                Same Wi-Fi as this computer. Allow Node.js on "Private networks" if Windows asks. Read-only link, expires in {Math.round(phone.expiresInMinutes / 60)} h.
                Rebuild (Restart) and scan again after edits.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
