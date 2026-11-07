import React, { useMemo, useRef, useState } from 'react';
import { ExternalLink, Image as ImageIcon, KeyRound, Loader2, Plus, Search, Sun, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import {
  ONLINE_ASSET_SOURCES,
  OnlineAssetSource,
  resolveOnlineAssetUrl,
  searchOnlineAssets,
} from '../registry/onlineAssetHub';
import { OnlineAssetResult } from '../types/scene.schema';

const QUICK_QUERIES: Record<string, string[]> = {
  model: ['tree', 'car', 'house', 'character', 'rock', 'animal'],
  hdri: ['sunset', 'forest', 'studio', 'night', 'city', 'sky'],
};

/**
 * Searches Poly Pizza / Sketchfab / Poly Haven through the server proxy and mounts results
 * straight onto the stage: models become custom GLB actors, HDRIs become world.hdri lighting.
 */
export const OnlineAssetBrowser: React.FC = () => {
  const settings = useStudioStore((s) => s.settings);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const registerAndSpawnCustomAsset = useStudioStore((s) => s.registerAndSpawnCustomAsset);
  const setEngineType = useStudioStore((s) => s.setEngineType);
  const updateWorld = useStudioStore((s) => s.updateWorld);
  const setSettingsModalOpen = useStudioStore((s) => s.setSettingsModalOpen);

  const enabledSources = useMemo(
    () => ONLINE_ASSET_SOURCES.filter((src) => Boolean(settings[src.settingsToggle])),
    [settings]
  );
  const [sourceId, setSourceId] = useState<string>(enabledSources[0]?.id ?? 'polyhaven-model');
  const source: OnlineAssetSource | undefined =
    enabledSources.find((s) => s.id === sourceId) ?? enabledSources[0];

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OnlineAssetResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!source) {
    return (
      <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] text-slate-400">
        All online asset hubs are disabled.{' '}
        <button className="text-cyan-300 underline" onClick={() => setSettingsModalOpen(true)}>
          Enable them in Settings
        </button>
        .
      </div>
    );
  }

  const missingKey = source.needsKey && !settings[source.needsKey]?.trim();
  const blockSearch = missingKey && source.keyRequiredFor === 'search';
  const currentHdri = sceneSpec.world?.hdri;

  const runSearch = async (q: string, nextPage: number) => {
    if (blockSearch) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    setError(null);
    try {
      const data = await searchOnlineAssets(source, q, nextPage, settings, controller.signal);
      setResults((prev) => (nextPage === 0 ? data.results : [...prev, ...data.results]));
      setTotal(data.total);
      setPage(nextPage);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Search failed');
    } finally {
      if (abortRef.current === controller) setIsSearching(false);
    }
  };

  const handleUse = async (asset: OnlineAssetResult) => {
    setBusyId(asset.id);
    setError(null);
    setNotice(null);
    try {
      const url = await resolveOnlineAssetUrl(asset, settings);
      if (asset.kind === 'hdri') {
        if (sceneSpec.engineType === '2d') setEngineType('3d');
        updateWorld({
          hdri: {
            url,
            name: asset.name,
            source: asset.provider,
            showBackground: currentHdri?.showBackground ?? true,
            intensity: currentHdri?.intensity ?? 1,
          },
        });
        setNotice(`HDRI "${asset.name}" applied to the world lighting.`);
      } else {
        if (sceneSpec.engineType === '2d') setEngineType('3d');
        registerAndSpawnCustomAsset(asset.name, url, 'glb');
        setNotice(`"${asset.name}" mounted on the stage.`);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load this asset');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Search className="w-3.5 h-3.5 text-emerald-400" />
          <span>Online Asset Hub</span>
        </div>
        <span className="text-[10px] font-mono text-slate-500">via /api/assets proxy</span>
      </div>

      <select
        value={source.id}
        onChange={(e) => {
          setSourceId(e.target.value);
          setResults([]);
          setTotal(0);
          setError(null);
          setNotice(null);
        }}
        className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-100"
      >
        {enabledSources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      {missingKey && (
        <button
          onClick={() => setSettingsModalOpen(true)}
          className="w-full p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-center gap-1.5 text-left"
        >
          <KeyRound className="w-3.5 h-3.5 shrink-0" />
          <span>
            {source.keyRequiredFor === 'search'
              ? 'Add your Poly Pizza API key in Settings to search.'
              : 'Search works without a key; add a Sketchfab API token in Settings to download models.'}
          </span>
        </button>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query.trim(), 0);
        }}
        className="flex gap-1.5"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={source.kind === 'hdri' ? 'sunset, forest, studio…' : 'tree, car, knight…'}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-100"
        />
        <button
          type="submit"
          disabled={isSearching || blockSearch}
          className="px-2.5 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-medium disabled:opacity-40"
        >
          {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        {QUICK_QUERIES[source.kind].map((q) => (
          <button
            key={q}
            disabled={blockSearch}
            onClick={() => {
              setQuery(q);
              runSearch(q, 0);
            }}
            className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>

      {source.kind === 'hdri' && currentHdri && (
        <div className="p-2 rounded bg-slate-900 border border-amber-500/30 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-amber-200 truncate">
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Active HDRI: {currentHdri.name}</span>
            </span>
            <button
              title="Remove HDRI"
              onClick={() => updateWorld({ hdri: undefined })}
              className="p-0.5 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <label className="flex items-center justify-between text-slate-300">
            <span>Show as background</span>
            <input
              type="checkbox"
              checked={currentHdri.showBackground}
              onChange={(e) => updateWorld({ hdri: { ...currentHdri, showBackground: e.target.checked } })}
              className="accent-amber-400"
            />
          </label>
          <label className="flex items-center gap-2 text-slate-300">
            <span className="shrink-0">Intensity</span>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={currentHdri.intensity}
              onChange={(e) => updateWorld({ hdri: { ...currentHdri, intensity: parseFloat(e.target.value) } })}
              className="flex-1 accent-amber-400"
            />
            <span className="font-mono text-amber-300 w-7 text-right">{currentHdri.intensity.toFixed(1)}</span>
          </label>
        </div>
      )}

      {error && <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded p-2">{error}</div>}
      {notice && <div className="text-[11px] text-emerald-300">{notice}</div>}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {results.map((asset) => (
            <div
              key={`${asset.provider}-${asset.id}`}
              className="rounded-md bg-slate-900 border border-slate-800 overflow-hidden flex flex-col"
            >
              <div className="aspect-square bg-slate-950 flex items-center justify-center relative">
                {asset.thumbnailUrl ? (
                  <img
                    src={asset.thumbnailUrl}
                    alt={asset.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-5 h-5 text-slate-600" />
                )}
                {asset.animated && (
                  <span className="absolute top-1 left-1 px-1 rounded bg-cyan-500/80 text-[9px] font-bold text-slate-950">
                    ANIM
                  </span>
                )}
              </div>
              <div className="p-1.5 space-y-1 flex-1 flex flex-col">
                <div className="text-[11px] font-semibold text-slate-100 truncate" title={asset.name}>
                  {asset.name}
                </div>
                <div className="text-[9px] text-slate-500 truncate" title={`${asset.author ?? ''} · ${asset.license ?? ''}`}>
                  {[asset.author, asset.license].filter(Boolean).join(' · ') || asset.provider}
                </div>
                <div className="flex items-center gap-1 mt-auto">
                  <button
                    onClick={() => handleUse(asset)}
                    disabled={busyId !== null}
                    className="flex-1 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-[10px] font-medium flex items-center justify-center gap-1 disabled:opacity-40"
                  >
                    {busyId === asset.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    <span>{asset.kind === 'hdri' ? 'Apply' : 'Add'}</span>
                  </button>
                  {asset.sourcePageUrl && (
                    <a
                      href={asset.sourcePageUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open source page (license & attribution)"
                      className="p-1 rounded text-slate-500 hover:text-slate-200"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && results.length < total && (
        <button
          onClick={() => runSearch(query.trim(), page + 1)}
          disabled={isSearching}
          className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 disabled:opacity-40"
        >
          {isSearching ? 'Loading…' : `Load more (${results.length}/${total})`}
        </button>
      )}

      {!isSearching && results.length === 0 && !error && (
        <p className="text-[10px] text-slate-500">
          Results load through the studio server, so GLB / glTF / HDR files mount without CORS errors. Check each
          asset's license before publishing.
        </p>
      )}
    </div>
  );
};
