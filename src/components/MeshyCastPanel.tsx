import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { describeMeshyError, meshyApi, type MeshyEstimate, type MeshyJob, type MeshyLogin, type MeshyStatus } from '../agent/meshyClient';
import { workspaceApi } from '../workspace/workspaceClient';
import { DEFAULT_TEXTURE_SIZE, formatBytes, optimizeLibraryModel } from '../workspace/optimizeLibraryGlb';

export interface MeshyResult {
  assetId: string;
  modelUrl: string;
  clips: string[];
}

interface Props {
  /** The character's look brief (the generator prompt). */
  look: string;
  name: string;
  disabled?: boolean;
  onDone: (r: MeshyResult) => void;
}

const STAGE_LABEL: Record<MeshyJob['stage'], string> = {
  queued: 'Queued', preview: 'Sculpting the shape', remesh: 'Simplifying the mesh for rigging', retexture: 'Painting textures', refine: 'Painting textures', rigging: 'Rigging a skeleton', downloading: 'Downloading', saving: 'Saving to your library', done: 'Done',
};

/**
 * Connect Meshy (your own account, through the local CLI session), see what a model will cost, agree, generate.
 * Nothing is spent until you tick the box and press Generate.
 */
export const MeshyCastPanel: React.FC<Props> = ({ look, name, disabled, onDone }) => {
  const [status, setStatus] = useState<MeshyStatus | null>(null);
  const [login, setLogin] = useState<MeshyLogin | null>(null);
  const [estimate, setEstimate] = useState<MeshyEstimate | null>(null);
  const [agree, setAgree] = useState(false);
  const [job, setJob] = useState<MeshyJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [sizeNote, setSizeNote] = useState('');
  const alive = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await meshyApi.status();
      if (!alive.current) return;
      setStatus(s);
      setError('');
    } catch (e) {
      if (alive.current) setError(describeMeshyError(e));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // The estimate belongs to one look: changing the text invalidates it and the agreement.
  useEffect(() => { setEstimate(null); setAgree(false); }, [look]);

  // Poll the device login while the browser page is open.
  useEffect(() => {
    if (login?.state !== 'waiting') return;
    const t = setInterval(async () => {
      try {
        const l = await meshyApi.login();
        if (!alive.current) return;
        setLogin(l);
        if (l.state === 'logged_in') void refresh();
      } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  }, [login?.state, refresh]);

  // Poll the job while it runs.
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(async () => {
      try {
        const j = await meshyApi.job(job.id);
        if (!alive.current) return;
        setJob(j);
        if (j.status === 'succeeded' && j.asset) {
          void finish(j);
        }
        if (j.status === 'failed') setError(describeMeshyError({ code: j.errorCode, message: j.error }));
      } catch (e) {
        if (alive.current) setError(describeMeshyError(e));
      }
    }, 4000);
    return () => clearInterval(t);
  }, [job?.id, job?.status, refresh]);

  /** The generator's 4K textures make a 25 MB file: save a light copy and use that one in the film. */
  const finish = async (j: MeshyJob) => {
    const asset = j.asset!;
    let use = { id: asset.id, scope: j.scope };
    try {
      setOptimizing(true);
      const r = await optimizeLibraryModel(j.scope, asset, DEFAULT_TEXTURE_SIZE);
      if (r) {
        use = { id: r.asset.id, scope: j.scope };
        if (alive.current) setSizeNote(`Textures shrunk to ${DEFAULT_TEXTURE_SIZE}px: ${formatBytes(r.bytesBefore)} → ${formatBytes(r.bytesAfter)}. The original stays in your library.`);
      }
    } catch (e: any) {
      if (alive.current) setSizeNote(`Could not shrink the textures (${e?.message || 'unknown'}); using the full-size model.`);
    } finally {
      if (alive.current) setOptimizing(false);
    }
    doneRef.current({ assetId: use.id, modelUrl: workspaceApi.assetUrl(use.scope, use.id), clips: j.clips || [] });
    void refresh();
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { if (alive.current) setError(describeMeshyError(e)); } finally { if (alive.current) setBusy(false); }
  };

  const ready = status?.state === 'ready';
  const lookOk = look.trim().length >= 8;
  const running = job?.status === 'running';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-slate-200"><Sparkles className="w-3.5 h-3.5 text-violet-300" /> Real 3D model with Meshy <span className="font-normal text-slate-500">(optional, uses your Meshy credits)</span></div>

      {!status && !error && <div className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking Meshy…</div>}

      {status?.state === 'runner_unavailable' && <div className="text-amber-200">The Meshy CLI cannot start here: {status.runner.error || 'unknown reason'}.</div>}

      {(status?.state === 'login_required' || status?.state === 'unverified') && (
        <div className="space-y-1.5">
          <div className="text-slate-400">{status.state === 'unverified' ? 'The saved Meshy session could not be verified.' : 'Meshy is not connected on this computer.'}</div>
          {login?.state === 'waiting' && login.url ? (
            <div className="rounded border border-violet-500/40 bg-violet-500/10 p-2 space-y-1">
              <div className="text-slate-200">1. Open the Meshy page and sign in with your own account:</div>
              <a href={login.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-200 underline break-all">{login.url} <ExternalLink className="w-3 h-3" /></a>
              {login.code && <div className="text-slate-200">2. Enter this code: <span className="font-mono text-base text-violet-100 tracking-widest">{login.code}</span></div>}
              <div className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Waiting for you to approve…</div>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => guard(async () => { setLogin(await meshyApi.startLogin()); })} className="px-3 py-1.5 rounded-lg bg-violet-500 text-white font-semibold disabled:opacity-40">
              {busy ? 'Starting…' : 'Connect Meshy'}
            </button>
          )}
          {login && (login.state === 'failed' || login.state === 'expired') && <div className="text-amber-200">{login.message || 'The sign-in did not finish. Try again.'}</div>}
        </div>
      )}

      {ready && (
        <div className="space-y-1.5">
          <div className="text-slate-400">Connected{status?.balance !== null && status?.balance !== undefined ? ` · ${status.balance} credits available` : ''}.</div>
          {!lookOk && <div className="text-slate-500">Write a look brief above first (at least a short sentence).</div>}
          {lookOk && !estimate && !job && (
            <button type="button" disabled={busy || disabled} onClick={() => guard(async () => { setEstimate(await meshyApi.estimate(look.trim())); })} className="px-3 py-1.5 rounded-lg border border-violet-500/60 text-violet-200 hover:bg-violet-500/10 disabled:opacity-40">
              {busy ? 'Asking Meshy…' : `See the cost for ${name || 'this character'}`}
            </button>
          )}
          {estimate && !job && (
            <div className="space-y-1.5">
              <div className="rounded border border-slate-700 p-2 text-slate-200">
                {estimate.credits !== undefined ? <>Shape and texture: about <b>{estimate.credits} credits</b>, plus rigging (not included in this number).</> : <>Meshy did not give a number. The cost is unknown until it runs.</>}
                {estimate.notes.map((n, i) => <div key={i} className="text-slate-500">{n}</div>)}
              </div>
              <label className="flex items-start gap-1.5 text-slate-300">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
                I understand this spends credits from my Meshy account and cannot be refunded here.
              </label>
              <button type="button" disabled={!agree || busy || disabled} onClick={() => guard(async () => { setJob(await meshyApi.generateCharacter({ prompt: look.trim(), name })); setAgree(false); })} className="px-3 py-1.5 rounded-lg bg-violet-500 text-white font-semibold disabled:opacity-40">
                Generate the 3D model
              </button>
            </div>
          )}
        </div>
      )}

      {job && (
        <div className="space-y-1">
          <div className="h-1.5 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-violet-400 transition-all" style={{ width: `${job.status === 'succeeded' ? 100 : job.progress}%` }} /></div>
          <div className="text-slate-300 flex items-center gap-1.5">
            {running && <Loader2 className="w-3 h-3 animate-spin" />}
            {job.status === 'succeeded' ? `Model saved to your library${job.clips?.length ? ` with ${job.clips.join(', ')}` : ' (no animation clips)'}.` : job.status === 'failed' ? 'The model failed.' : `${STAGE_LABEL[job.stage]}… (this takes a few minutes)`}
          </div>
          {optimizing && <div className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Shrinking textures…</div>}
          {sizeNote && <div className="text-emerald-300">{sizeNote}</div>}
          {job.consumedCredits !== null && <div className="text-slate-500">Credits used so far: {job.consumedCredits}</div>}
          {job.warnings.map((w, i) => <div key={i} className="text-amber-200">{w}</div>)}
        </div>
      )}

      {error && <div className="text-red-300">{error}</div>}
    </div>
  );
};
