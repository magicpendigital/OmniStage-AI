import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Puzzle, Sparkles } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { GENERATION_PROVIDERS } from '../extensions/types';
import { AvailableGenerator, GenerationJob, LibraryAsset, workspaceApi } from '../workspace/workspaceClient';

/**
 * Phase 6 Batch 3 — "Generate": text → 3D model (Meshy / Tripo) or 2D sprite (fal.ai / Replicate) through generator
 * extensions. The key stays in this browser and goes to the local server per request; results land in the library.
 */
export const GeneratePanel: React.FC<{ scopeKey: string; onSaved: (asset: LibraryAsset) => void; onPlace: (asset: LibraryAsset) => void }> = ({ scopeKey, onSaved, onPlace }) => {
  const installed = useStudioStore((s) => s.installedExtensions);
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const setExtensionsOpen = useStudioStore((s) => s.setExtensionsOpen);
  const [generators, setGenerators] = useState<AvailableGenerator[]>([]);
  const [selected, setSelected] = useState('');
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    workspaceApi.listGenerators().then(setGenerators).catch(() => setGenerators([]));
  }, [installed]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const gen = generators.find((g) => `${g.extensionId}/${g.id}` === selected) || generators[0];
  const provider = gen ? GENERATION_PROVIDERS[gen.provider] : null;
  const key = gen ? settings.generationKeys?.[gen.provider] || '' : '';
  const running = job?.status === 'running';

  const poll = (id: string, providerKey: string) => {
    timer.current = window.setTimeout(async () => {
      try {
        const next = await workspaceApi.pollGeneration(id, providerKey);
        setJob(next);
        if (next.status === 'running') poll(id, providerKey);
        else if (next.status === 'succeeded' && next.asset) onSaved(next.asset);
      } catch (e: any) {
        setError(e?.message || 'Lost track of the generation');
        setJob((j) => (j ? { ...j, status: 'failed', error: e?.message } : j));
      }
    }, 3000);
  };

  const generate = async () => {
    if (!gen) return;
    setError(null);
    try {
      const started = await workspaceApi.startGeneration({ extensionId: gen.extensionId, generatorId: gen.id, prompt: prompt.trim(), scope: scopeKey }, key);
      setJob(started);
      poll(started.id, key);
    } catch (e: any) {
      setError(e?.message || 'Could not start the generation');
    }
  };

  if (!generators.length) {
    return (
      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200"><Sparkles className="w-3.5 h-3.5 text-fuchsia-300" /> Generate with AI</div>
        <p className="text-[11px] text-slate-500">Install a generator (Meshy, Tripo, fal.ai, Replicate) to make 3D models and sprites from a prompt with your own API key.</p>
        <button type="button" onClick={() => setExtensionsOpen(true)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-violet-500/40 text-violet-200">
          <Puzzle className="w-3 h-3" /> Extensions → Catalog
        </button>
      </div>
    );
  }

  return (
    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
      <div className="flex items-center gap-1.5 font-semibold text-slate-200"><Sparkles className="w-3.5 h-3.5 text-fuchsia-300" /> Generate with AI</div>
      <select value={gen ? `${gen.extensionId}/${gen.id}` : ''} onChange={(e) => setSelected(e.target.value)} disabled={running} aria-label="Generator" className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100">
        {generators.map((g) => (
          <option key={`${g.extensionId}/${g.id}`} value={`${g.extensionId}/${g.id}`}>{g.title}</option>
        ))}
      </select>
      {gen?.description && <p className="text-[10px] text-slate-500">{gen.description}</p>}
      {gen && provider && !gen.serverKey && (
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => updateSettings({ generationKeys: { ...(settings.generationKeys || {}), [gen.provider]: e.target.value } })}
          placeholder={provider.keyLabel}
          aria-label={`${provider.label} API key`}
          className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono placeholder-slate-600"
        />
      )}
      <textarea
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={running}
        placeholder={gen?.output === 'model' ? 'e.g. a low-poly wooden treasure chest with gold trim' : 'e.g. a cute pixel-art fox knight with a tiny sword'}
        className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-600 resize-none"
      />
      <button
        type="button"
        onClick={generate}
        disabled={running || prompt.trim().length < 3 || (!key && !gen?.serverKey)}
        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-fuchsia-600 text-white font-semibold disabled:opacity-40"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
        {running ? `${job!.stage} · ${job!.progress}%` : `Generate ${gen?.output === 'model' ? '3D model' : 'sprite'}`}
      </button>
      {provider && (
        <p className="text-[10px] text-slate-500">
          Uses your {provider.label} credits. <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-cyan-400 underline">Get a key</a> · saved to {scopeKey === 'personal' ? 'your personal library' : 'this project'}.
        </p>
      )}
      {running && <div className="h-1 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${job!.progress}%` }} /></div>}
      {job?.status === 'succeeded' && job.asset && (
        <div className="flex items-center gap-1.5 text-emerald-300 text-[11px]">
          ✓ Saved “{job.asset.name}”
          <button type="button" onClick={() => onPlace(job.asset!)} className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-200"><Plus className="w-3 h-3" /> Place</button>
        </div>
      )}
      {(error || job?.status === 'failed') && <p className="text-rose-300 text-[11px]">{error || job?.error}</p>}
    </div>
  );
};
