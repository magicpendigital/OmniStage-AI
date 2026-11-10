import React, { useMemo, useRef, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Search, Sun, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { useShellStore } from '../state/useShellStore';
import { ONLINE_ASSET_SOURCES, OnlineAssetSource, searchOnlineAssets } from '../registry/onlineAssetHub';
import { OnlineAssetResult } from '../types/scene.schema';
import {
  AssetCard,
  LibraryFilterBar,
  SavedAssetCard,
  onlineResultToAsset,
  useLibraryFilterPredicate,
  useSpawnSavedAsset,
} from './AssetLibrary';

const QUICK_QUERIES: Record<string, string[]> = {
  model: ['tree', 'car', 'house', 'character', 'rock', 'animal'],
  hdri: ['sunset', 'forest', 'studio', 'night', 'city', 'sky'],
};

/**
 * Searches Poly Pizza / Sketchfab / Poly Haven through the server proxy and mounts results
 * straight onto the stage: models become custom GLB actors, HDRIs become world.hdri lighting.
 * Any result can be starred or filed under a custom label, which bookmarks it in the user library.
 */
export const OnlineAssetBrowser: React.FC = () => {
  const settings = useStudioStore((s) => s.settings);
  const currentHdri = useStudioStore((s) => s.sceneSpec.world?.hdri);
  const savedExternalAssets = useStudioStore((s) => s.savedExternalAssets);
  const updateWorld = useStudioStore((s) => s.updateWorld);
  const setSettingsModalOpen = useStudioStore((s) => s.setSettingsModalOpen);

  const filter = useShellStore((s) => s.libraryFilter);
  const matchesFilter = useLibraryFilterPredicate();
  const { spawn, busyId, error: spawnError } = useSpawnSavedAsset();

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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const savedMatches = savedExternalAssets.filter((a) => matchesFilter(a.id, a));

  const filterBar = <LibraryFilterBar allLabel="Search Results" allCount={results.length} />;

  if (!source) {
    return (
      <>
        {filterBar}
        <div className="card text-[11px] text-mute">
          All online asset hubs are disabled.{' '}
          <button type="button" className="text-accent underline" onClick={() => setSettingsModalOpen(true)}>
            Enable them in Settings
          </button>
          .
        </div>
      </>
    );
  }

  const missingKey = source.needsKey && !settings[source.needsKey]?.trim();
  const blockSearch = Boolean(missingKey && source.keyRequiredFor === 'search');
  const error = searchError || spawnError;

  const runSearch = async (q: string, nextPage: number) => {
    if (blockSearch) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    setSearchError(null);
    try {
      const data = await searchOnlineAssets(source, q, nextPage, settings, controller.signal);
      setResults((prev) => (nextPage === 0 ? data.results : [...prev, ...data.results]));
      setTotal(data.total);
      setPage(nextPage);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setSearchError(e?.message || 'Search failed');
    } finally {
      if (abortRef.current === controller) setIsSearching(false);
    }
  };

  const handleUse = async (result: OnlineAssetResult) => {
    setNotice(null);
    const ok = await spawn(onlineResultToAsset(result));
    if (ok) {
      setNotice(
        result.kind === 'hdri'
          ? `HDRI "${result.name}" applied to the world lighting.`
          : `"${result.name}" mounted on the stage and saved to your library.`
      );
    }
  };

  return (
    <>
      {filterBar}

      {filter !== 'all' ? (
        savedMatches.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-dim">
            {filter === 'favorites'
              ? 'No favorites yet. Star a search result to keep it.'
              : filter === 'local'
                ? 'No local folder mounted. Use Load Local Folder in the Asset Library.'
                : 'Nothing carries this label yet. Use the tag button on any result.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {savedMatches.map((asset) => (
              <SavedAssetCard key={asset.id} asset={asset} busy={busyId === asset.id} onAdd={spawn} />
            ))}
          </div>
        )
      ) : (
        <>
          <select
            className="field w-full"
            aria-label="Asset source"
            value={source.id}
            onChange={(e) => {
              setSourceId(e.target.value);
              setResults([]);
              setTotal(0);
              setSearchError(null);
              setNotice(null);
            }}
          >
            {enabledSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          {missingKey && (
            <button
              type="button"
              onClick={() => setSettingsModalOpen(true)}
              className="flex w-full items-center gap-1.5 rounded-md border border-warn/30 bg-warn/10 p-2 text-left text-[11px] text-warn"
            >
              <KeyRound size={13} className="shrink-0" />
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
            <div className="relative min-w-0 flex-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={source.kind === 'hdri' ? 'sunset, forest, studio…' : 'tree, car, knight…'}
                className="field w-full"
                style={{ paddingLeft: 26 }}
              />
            </div>
            <button type="submit" disabled={isSearching || blockSearch} className="btn primary" style={{ height: 28 }}>
              {isSearching ? <Loader2 size={13} className="spin" /> : 'Search'}
            </button>
          </form>

          <div className="flex flex-wrap gap-1">
            {QUICK_QUERIES[source.kind].map((q) => (
              <button
                key={q}
                type="button"
                disabled={blockSearch}
                onClick={() => {
                  setQuery(q);
                  runSearch(q, 0);
                }}
                className="tag disabled:opacity-40"
                style={{ height: 20, fontSize: 10 }}
              >
                {q}
              </button>
            ))}
          </div>

          {source.kind === 'hdri' && currentHdri && (
            <div className="card space-y-1.5 text-[11px]" style={{ borderColor: 'rgb(var(--warn) / 0.35)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 truncate text-warn">
                  <Sun size={13} className="shrink-0" />
                  <span className="truncate">Active HDRI: {currentHdri.name}</span>
                </span>
                <button
                  type="button"
                  title="Remove HDRI"
                  aria-label="Remove HDRI"
                  onClick={() => updateWorld({ hdri: undefined })}
                  className="ibtn sm is-danger"
                >
                  <X size={13} />
                </button>
              </div>
              <label className="flex items-center justify-between text-mute">
                <span>Show as background</span>
                <input
                  type="checkbox"
                  checked={currentHdri.showBackground}
                  onChange={(e) => updateWorld({ hdri: { ...currentHdri, showBackground: e.target.checked } })}
                  className="accent-[rgb(var(--warn))]"
                />
              </label>
              <label className="flex items-center gap-2 text-mute">
                <span className="shrink-0">Intensity</span>
                <input
                  type="range"
                  min={0.1}
                  max={3}
                  step={0.1}
                  value={currentHdri.intensity}
                  onChange={(e) => updateWorld({ hdri: { ...currentHdri, intensity: parseFloat(e.target.value) } })}
                  className="rng flex-1"
                />
                <span className="w-7 text-right font-mono text-warn">{currentHdri.intensity.toFixed(1)}</span>
              </label>
            </div>
          )}

          {results.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {results.map((result) => {
                const asset = onlineResultToAsset(result);
                return (
                  <AssetCard
                    key={asset.id}
                    id={asset.id}
                    name={result.name}
                    subtitle={[result.author, result.license].filter(Boolean).join(' · ') || result.provider}
                    kind={asset.kind}
                    kindLabel={result.kind === 'hdri' ? 'hdri' : 'glb'}
                    badge={result.animated ? 'anim' : undefined}
                    thumbnailUrl={result.thumbnailUrl}
                    asset={asset}
                    busy={busyId === asset.id}
                    disabled={busyId !== null}
                    addLabel={result.kind === 'hdri' ? 'Apply as world lighting' : 'Add to stage'}
                    onAdd={() => handleUse(result)}
                    footer={
                      result.sourcePageUrl ? (
                        <a
                          href={result.sourcePageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] text-dim hover:text-fg"
                        >
                          <ExternalLink size={10} /> Source &amp; license
                        </a>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {results.length > 0 && results.length < total && (
            <button
              type="button"
              onClick={() => runSearch(query.trim(), page + 1)}
              disabled={isSearching}
              className="btn w-full"
            >
              {isSearching ? 'Loading…' : `Load more (${results.length}/${total})`}
            </button>
          )}

          {!isSearching && results.length === 0 && !error && (
            <p className="text-[10px] leading-relaxed text-dim">
              Results load through the studio server, so GLB / glTF / HDR files mount without CORS errors. Star a
              result or give it a label to keep it in your library. Check each asset's license before publishing.
            </p>
          )}
        </>
      )}

      {error && <div className="rounded-md border border-err/30 bg-err/10 p-2 text-[11px] text-err" role="alert">{error}</div>}
      {notice && <div className="text-[11px] text-ok" role="status">{notice}</div>}
    </>
  );
};
