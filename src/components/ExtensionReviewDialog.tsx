import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { reviewExtension, validateManifest } from '../extensions/validate';
import { ExtensionPermission, PERMISSION_INFO } from '../extensions/types';
import { workspaceApi } from '../workspace/workspaceClient';
import { aiHeaders } from '../agent/aiClient';

const RISK_STYLE = {
  low: 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200',
  medium: 'bg-amber-950/50 border-amber-500/40 text-amber-200',
  high: 'bg-rose-950/50 border-rose-500/40 text-rose-200',
};

/**
 * Phase 6 — Human approval gate. Every install (catalog, URL, file, AI draft or AI recommendation) lands here:
 * the user sees what the extension adds, the risk review and each permission, and must approve explicitly.
 */
export const ExtensionReviewDialog: React.FC = () => {
  const request = useStudioStore((s) => s.extensionReview);
  const close = () => useStudioStore.getState().openExtensionReview(null);
  const refreshExtensions = useStudioStore((s) => s.refreshExtensions);
  const appendLog = useStudioStore((s) => s.appendLog);
  const [approved, setApproved] = useState<ExtensionPermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ aiRisk?: 'low' | 'medium' | 'high'; aiSummary?: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const manifest = request?.manifest;
  const errors = useMemo(() => (manifest ? validateManifest(manifest) : []), [manifest]);
  const review = useMemo(() => (manifest && !errors.length ? reviewExtension(manifest) : null), [manifest, errors]);
  if (!request || !manifest) return null;

  const permissions = (manifest.permissions || []) as ExtensionPermission[];
  const allApproved = permissions.every((p) => approved.includes(p));
  const togglePermission = (p: ExtensionPermission) => setApproved((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const askAi = async () => {
    setAiBusy(true);
    try {
      const res = await fetch('/api/agent/extension/review', {
        method: 'POST',
        headers: aiHeaders(useStudioStore.getState().settings),
        body: JSON.stringify({ manifest, language: navigator.language?.startsWith('vi') ? 'vi' : 'en' }),
      });
      const json = await res.json();
      setAi(res.ok ? json : { aiSummary: json.error || 'AI review unavailable' });
    } catch (e: any) {
      setAi({ aiSummary: e?.message || 'AI review unavailable' });
    } finally {
      setAiBusy(false);
    }
  };

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await workspaceApi.installExtension({
        manifest,
        source: request.source,
        approvedPermissions: approved,
        aiReview: ai?.aiRisk ? { aiRisk: ai.aiRisk, aiSummary: ai.aiSummary } : undefined,
      });
      await refreshExtensions();
      appendLog({ level: 'info', message: `Installed extension "${manifest.name}" v${manifest.version} (${request.source}).` });
      setApproved([]);
      setAi(null);
      close();
    } catch (e: any) {
      setError(e?.message || 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  const c = manifest.contributes || {};
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review extension">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800">
          <div>
            <div className="text-[10px] font-mono uppercase text-cyan-400">Review before installing · {request.source}</div>
            <h3 className="text-base font-bold text-slate-100">{manifest.name || manifest.id} <span className="text-slate-500 font-mono text-xs">v{manifest.version}</span></h3>
            <p className="text-slate-300 mt-1">{manifest.description}</p>
            {request.reason && <p className="text-violet-300 mt-1">Suggested because: {request.reason}</p>}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {errors.length > 0 ? (
            <div className={`p-3 rounded-lg border ${RISK_STYLE.high}`}>
              <div className="font-semibold mb-1">This extension is invalid and cannot be installed:</div>
              {errors.map((e) => <div key={e}>• {e}</div>)}
            </div>
          ) : (
            review && (
              <div className={`p-3 rounded-lg border ${RISK_STYLE[review.risk]}`}>
                <div className="flex items-center gap-1.5 font-semibold">
                  {review.risk === 'low' ? <ShieldCheck className="w-4 h-4" /> : review.risk === 'medium' ? <AlertTriangle className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                  Risk: {review.risk.toUpperCase()}
                </div>
                <p className="mt-1">{review.summary}</p>
                <ul className="mt-2 space-y-0.5">
                  {review.findings.map((f, i) => (
                    <li key={i} className={f.level === 'danger' ? 'text-rose-300' : f.level === 'warn' ? 'text-amber-200' : 'text-slate-300'}>• {f.message}</li>
                  ))}
                </ul>
              </div>
            )
          )}

          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">Skills: {c.skills?.length || 0}</div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">Particle presets: {Object.keys(c.particlePresets || {}).length}</div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">Sound presets: {Object.keys(c.sfxPresets || {}).length}</div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">Commands: {c.commands?.length || 0}</div>
          </div>

          {permissions.length > 0 && (
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-200">Approve each permission:</div>
              {permissions.map((p) => (
                <label key={p} className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800 cursor-pointer">
                  <input type="checkbox" checked={approved.includes(p)} onChange={() => togglePermission(p)} className="accent-cyan-500" />
                  <span className="text-slate-200">{PERMISSION_INFO[p]?.label || p}</span>
                  <span className={`ml-auto text-[10px] font-mono ${PERMISSION_INFO[p]?.risk === 'high' ? 'text-rose-300' : PERMISSION_INFO[p]?.risk === 'medium' ? 'text-amber-300' : 'text-slate-500'}`}>
                    {PERMISSION_INFO[p]?.risk}
                  </span>
                </label>
              ))}
            </div>
          )}

          {manifest.mainSource && (
            <button type="button" onClick={() => setShowCode((v) => !v)} className="text-[11px] text-cyan-300 hover:underline">
              {showCode ? 'Hide script' : 'Show script'} ({(manifest.mainSource.length / 1024).toFixed(1)} KB)
            </button>
          )}
          {showCode && (
            <pre className="max-h-48 overflow-auto p-2 rounded bg-black/60 border border-slate-800 text-[10px] text-slate-300 whitespace-pre-wrap">{manifest.mainSource}</pre>
          )}

          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
            <button
              type="button"
              onClick={askAi}
              disabled={aiBusy || errors.length > 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-violet-500/40 text-violet-200 disabled:opacity-50"
            >
              {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />} Ask the AI director to explain this extension
            </button>
            {ai && (
              <div className="text-slate-300">
                {ai.aiRisk && <span className="font-mono text-[10px] mr-1">AI risk: {ai.aiRisk.toUpperCase()} —</span>}
                {ai.aiSummary}
              </div>
            )}
          </div>

          {error && <div className="text-rose-300">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          <button type="button" onClick={close} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button>
          <button
            type="button"
            onClick={install}
            disabled={busy || errors.length > 0 || !allApproved}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {permissions.length ? 'Approve & install' : 'Install'}
          </button>
        </div>
      </div>
    </div>
  );
};
