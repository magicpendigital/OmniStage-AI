import React, { useEffect, useRef, useState } from 'react';
import { Bone, Loader2, Plus, Puzzle, Sparkles } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { GENERATION_PROVIDERS } from '../extensions/types';
import { generationKeyFor } from '../extensions/generationHelpers';
import { AvailableGenerator, GenerationJob, LibraryAsset, workspaceApi } from '../workspace/workspaceClient';

/**
 * Phase 6 Batch 3 — "Generate": text or picture → 3D model (Meshy / Tripo / Rodin), 2D sprite or animated sprite
 * sheet (fal.ai / Replicate / OpenRouter) and sound effects or music (ElevenLabs) through generator extensions.
 * The key stays in this browser and goes to the local server per request; results land in the library.
 */
export const GeneratePanel: React.FC<{
  scopeKey: string;
  /** Library pictures an image-to-3D generator can start from. */
  pictures: LibraryAsset[];
  onSaved: (asset: LibraryAsset) => void;
  onPlace: (asset: LibraryAsset) => void;
  onRig: (asset: LibraryAsset) => void;
}> = ({ scopeKey, pictures, onSaved, onPlace, onRig }) => {
  const installed = useStudioStore((s) => s.installedExtensions);
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const setExtensionsOpen = useStudioStore((s) => s.setExtensionsOpen);
  const [generators, setGenerators] = useState<AvailableGenerator[]>([]);
  const [selected, setSelected] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pictureId, setPictureId] = useState('');
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    workspaceApi.listGenerators().then(setGenerators).catch(() => setGenerators([]));
  }, [installed]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const gen = generators.find((g) => `${g.extensionId}/${g.id}` === selected) || generators[0];
  const provider = gen ? GENERATION_PROVIDERS[gen.provider] : null;
  const ownKey = gen ? settings.generationKeys?.[gen.provider] || '' : '';
  const key = gen ? generationKeyFor(settings, gen.provider) : '';
  const reusedKey = !!key && !ownKey;
  const running = job?.status === 'running';
  const fromPicture = gen?.input === 'image';
  const picture = pictures.find((p) => p.id === pictureId) || (fromPicture ? pictures[0] : undefined);
  const promptOk = fromPicture ? true : prompt.trim().length >= 3;

  const poll = (id: string, providerKey: string, delay: number) => {
    timer.current = window.setTimeout(async () => {
      try {
        const next = await workspaceApi.pollGeneration(id, providerKey);
        setJob(next);
        if (next.status === 'running') poll(id, providerKey, 3000);
        else if (next.status === 'succeeded' && next.asset) onSaved(next.asset);
      } catch (e: any) {
        setError(e?.message || 'Lost track of the generation');
        setJob((j) => (j ? { ...j, status: 'failed', error: e?.message } : j));
      }
    }, delay);
  };

  const generate = async () => {
    if (!gen) return;
    setError(null);
    if (fromPicture && !picture) {
      setError('Add a picture to the library first (PNG, JPEG or WebP).');
      return;
    }
    try {
      const started = await workspaceApi.startGeneration(
        { extensionId: gen.extensionId, generatorId: gen.id, prompt: prompt.trim(), scope: scopeKey, ...(fromPicture && picture ? { imageAssetId: picture.id, imageScope: scopeKey } : {}) },
        key
      );
      setJob(started);
      // One-shot providers (OpenRouter, ElevenLabs) usually finish within seconds.
      poll(started.id, key, gen.provider === 'openrouter' || gen.provider === 'elevenlabs' ? 1500 : 3000);
    } catch (e: any) {
      setError(e?.message || 'Could not start the generation');
    }
  };

  if (!generators.length) {
    return (
      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200"><Sparkles className="w-3.5 h-3.5 text-fuchsia-300" /> Generate with AI</div>
        <p className="text-[11px] text-slate-500">Install a generator (Meshy, Tripo, Rodin, fal.ai, Replicate, OpenRouter, ElevenLabs) to make 3D models, sprites, sprite sheets and sounds from a prompt with your own API key.</p>
        <button type="button" onClick={() => setExtensionsOpen(true)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-violet-500/40 text-violet-200">
          <Puzzle className="w-3 h-3" /> Extensions → Catalog
        </button>
      </div>
    );
  }

  const what = !gen
    ? 'asset'
    : gen.output === 'model'
      ? '3D model'
      : gen.output === 'audio'
        ? gen.audio === 'music' ? 'music' : 'sound'
        : gen.frames ? 'sprite sheet' : gen.sprite ? 'sprite' : 'image';
  const placeholder = !gen
    ? ''
    : fromPicture
      ? 'Optional: describe materials or details to guide the model'
      : gen.output === 'model'
        ? 'e.g. a low-poly wooden treasure chest with gold trim'
        : gen.output === 'audio'
          ? gen.audio === 'music' ? 'e.g. upbeat chiptune loop, 140 bpm, cheerful' : 'e.g. coin pickup, bright arcade chime'
          : gen.frames ? 'e.g. a pixel-art fox knight walking to the right' : 'e.g. a cute pixel-art fox knight with a tiny sword';

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
          value={ownKey}
          onChange={(e) => updateSettings({ generationKeys: { ...(settings.generationKeys || {}), [gen.provider]: e.target.value } })}
          placeholder={reusedKey ? `Using the ${provider.label} key from Settings` : provider.keyLabel}
          aria-label={`${provider.label} API key`}
          className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 font-mono placeholder-slate-600"
        />
      )}
      {fromPicture && (
        pictures.length ? (
          <div className="flex items-center gap-1.5">
            {picture && <img src={workspaceApi.assetUrl(scopeKey, picture.id)} alt="" className="w-9 h-9 object-contain rounded bg-slate-900 border border-slate-700" />}
            <select value={picture?.id || ''} onChange={(e) => setPictureId(e.target.value)} disabled={running} aria-label="Picture to turn into 3D" className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100">
              {pictures.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-[11px] text-amber-300">Add a picture to this library first (PNG, JPEG or WebP, one subject on a plain background).</p>
        )
      )}
      <textarea
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={running}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-600 resize-none"
      />
      <button
        type="button"
        onClick={generate}
        disabled={running || !promptOk || (fromPicture && !picture) || (!key && !gen?.serverKey)}
        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-fuchsia-600 text-white font-semibold disabled:opacity-40"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
        {running ? `${job!.stage} · ${job!.progress}%` : `Generate ${what}`}
      </button>
      {provider && (
        <p className="text-[10px] text-slate-500">
          Uses your {provider.label} credits. <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-cyan-400 underline">Get a key</a> · saved to {scopeKey === 'personal' ? 'your personal library' : 'this project'}.
        </p>
      )}
      {running && <div className="h-1 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${job!.progress}%` }} /></div>}
      {job?.status === 'succeeded' && job.asset && (
        <div className="flex items-center gap-1.5 text-emerald-300 text-[11px]">
          <span className="truncate">✓ Saved “{job.asset.name}”</span>
          <span className="ml-auto flex gap-1">
            {job.asset.kind === 'model' && (
              <button type="button" onClick={() => onRig(job.asset!)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-violet-500/40 text-violet-200" title="Auto-rig this model with OmniRig"><Bone className="w-3 h-3" /> Rig</button>
            )}
            <button type="button" onClick={() => onPlace(job.asset!)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-200"><Plus className="w-3 h-3" /> {job.asset.kind === 'audio' ? 'Add track' : 'Place'}</button>
          </span>
        </div>
      )}
      {(error || job?.status === 'failed') && <p className="text-rose-300 text-[11px]">{error || job?.error}</p>}
    </div>
  );
};
