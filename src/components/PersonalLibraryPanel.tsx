import React, { useEffect, useRef, useState } from 'react';
import { HardDrive, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { LibraryAsset, workspaceApi } from '../workspace/workspaceClient';
import { GeneratePanel } from './GeneratePanel';

/**
 * Phase 6 — "My Library": personal assets on this computer (shared by every project) and the open project's
 * shared assets. Click + to place an asset in the scene.
 */
export const PersonalLibraryPanel: React.FC = () => {
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const activeProject = useStudioStore((s) => s.activeProject);
  const registerAndSpawnCustomAsset = useStudioStore((s) => s.registerAndSpawnCustomAsset);
  const [scope, setScope] = useState<'personal' | 'project'>('personal');
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const scopeKey = scope === 'project' && activeProject ? `project:${activeProject.id}` : 'personal';

  const reload = async () => {
    if (!workspaceAvailable) return;
    try {
      setAssets(await workspaceApi.listLibrary(scopeKey));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load library');
    }
  };

  useEffect(() => {
    reload();
  }, [scopeKey, workspaceAvailable]);

  if (workspaceAvailable === false) {
    return <p className="text-[11px] text-slate-500">My Library stores files on this computer; run OmniStage locally to use it.</p>;
  }

  const upload = async (files: FileList) => {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) await workspaceApi.uploadToLibrary(scopeKey, file);
      await reload();
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const place = (a: LibraryAsset) => {
    const url = workspaceApi.assetUrl(scopeKey, a.id);
    if (a.kind === 'model') registerAndSpawnCustomAsset(a.name, url, 'glb');
    else if (a.mime === 'image/svg+xml') registerAndSpawnCustomAsset(a.name, url, 'svg');
    else if (a.kind === 'image' || a.kind === 'spritesheet') registerAndSpawnCustomAsset(a.name, url, 'image');
    else setError(`${a.kind} assets can't be placed in a scene yet`);
  };

  const remove = async (a: LibraryAsset) => {
    if (!window.confirm(`Delete "${a.name}" from the library? Scenes that use it will lose the file.`)) return;
    await workspaceApi.deleteAsset(scopeKey, a.id);
    await reload();
  };

  return (
    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
          <HardDrive className="w-3.5 h-3.5 text-cyan-400" /> My Library
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => setScope('personal')} className={`px-2 py-0.5 rounded text-[10px] ${scope === 'personal' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'}`}>Personal</button>
          <button type="button" onClick={() => setScope('project')} disabled={!activeProject} title={activeProject ? `Shared by games in ${activeProject.name}` : 'Open a project first'} className={`px-2 py-0.5 rounded text-[10px] disabled:opacity-40 ${scope === 'project' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'}`}>Project</button>
        </div>
      </div>
      <GeneratePanel scopeKey={scopeKey} onSaved={() => reload()} onPlace={place} />
      <input ref={fileRef} type="file" multiple className="hidden" accept=".glb,.gltf,.png,.jpg,.jpeg,.webp,.svg,.gif,.mp3,.wav,.ogg,.hdr" onChange={(e) => e.target.files && upload(e.target.files)} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-slate-600 text-slate-300 hover:border-cyan-400 disabled:opacity-50">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Add files (.glb, .png, .svg, .mp3…)
      </button>
      {error && <p className="text-rose-300 text-[11px]">{error}</p>}
      {assets.length === 0 ? (
        <p className="text-[11px] text-slate-500">Empty. Files you add here are reusable in every {scope === 'personal' ? 'project' : 'game of this project'}.</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {assets.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 p-1.5 rounded bg-slate-950 border border-slate-800">
              {a.kind === 'image' || a.kind === 'spritesheet' ? (
                <img src={workspaceApi.assetUrl(scopeKey, a.id)} alt="" className="w-7 h-7 object-contain rounded bg-slate-900" />
              ) : (
                <span className="w-7 h-7 flex items-center justify-center rounded bg-slate-900 text-[9px] font-mono text-slate-400 uppercase">{a.kind.slice(0, 3)}</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-slate-200 truncate">{a.name}</div>
                <div className="text-[9px] text-slate-500 font-mono">{a.source} · {(a.size / 1024).toFixed(0)} KB{a.license ? ` · ${a.license}` : ''}</div>
              </div>
              <button type="button" onClick={() => place(a)} aria-label={`Place ${a.name}`} className="p-1 text-cyan-300 hover:text-cyan-100"><Plus className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} className="p-1 text-slate-500 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
