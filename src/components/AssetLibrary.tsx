import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AudioLines,
  Box,
  Check,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Plus,
  Star,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { useShellStore } from '../state/useShellStore';
import { ASSET_REGISTRY, PRESET_2D_ASSETS } from '../registry/assetRegistry';
import { resolveOnlineAssetUrl } from '../registry/onlineAssetHub';
import { AssetDefinition, AssetDefinitionKind, OnlineAssetResult } from '../types/scene.schema';
import { useClickAway } from './ui';

/**
 * Shared pieces of the user asset library, used by both the local Asset Library panel and the
 * Online Asset Hub: the Favorites / Local Folder / custom-label filter bar and the asset card
 * with its favorite and assign-label quick actions.
 */

export const LABEL_COLORS = ['#5aa9ff', '#43d9c0', '#7ddc8a', '#f2b441', '#ff9d5c', '#ff6b6b', '#f58fc0', '#b69cff'];

export function onlineResultToAsset(result: OnlineAssetResult): AssetDefinition {
  return {
    id: `hub-${result.provider}-${result.kind}-${result.id}`,
    name: result.name,
    kind: result.kind === 'hdri' ? 'hdri' : 'model',
    url: result.downloadUrl || '',
    source: result.provider,
    tags: [result.provider],
    thumbnailUrl: result.thumbnailUrl,
    author: result.author,
    license: result.license,
    sourcePageUrl: result.sourcePageUrl,
    addedAt: Date.now(),
    online: result,
  };
}

/** Places a saved library asset on the stage, resolving a hub download first when it has no URL yet. */
export function useSpawnSavedAsset() {
  const settings = useStudioStore((s) => s.settings);
  const saveExternalAsset = useStudioStore((s) => s.saveExternalAsset);
  const spawnSavedAsset = useStudioStore((s) => s.spawnSavedAsset);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spawn = async (asset: AssetDefinition): Promise<boolean> => {
    setBusyId(asset.id);
    setError(null);
    try {
      let url = asset.url;
      if (!url && asset.online) url = await resolveOnlineAssetUrl(asset.online, settings);
      if (!url) throw new Error('This asset has no loadable file. Re-mount its folder to use it again.');
      saveExternalAsset(asset);
      spawnSavedAsset(asset.id, url);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Could not load this asset');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return { spawn, busyId, error, clearError: () => setError(null) };
}

// ----------------------------------------------------------------------------
// Filter bar: All · ★ Favorites · 📂 Local Folder · custom labels · + New Label
// ----------------------------------------------------------------------------

/**
 * Counts for the filter bar. Favorites and labels keep the ids of local files across reloads
 * (so re-mounting the same folder restores them), but only assets that are loaded right now count.
 */
export function useLibraryCounts() {
  const savedExternalAssets = useStudioStore((s) => s.savedExternalAssets);
  const customRegistryAssets = useStudioStore((s) => s.customRegistryAssets);
  const favoriteAssetIds = useStudioStore((s) => s.favoriteAssetIds);
  const collections = useStudioStore((s) => s.assetCollections);
  return useMemo(() => {
    const known = new Set<string>([
      ...savedExternalAssets.map((a) => a.id),
      ...customRegistryAssets.map((a) => a.assetId),
      ...Object.keys(ASSET_REGISTRY),
      ...PRESET_2D_ASSETS.map((p) => p.id),
    ]);
    const byCollection: Record<string, number> = {};
    collections.forEach((c) => {
      byCollection[c.id] = c.assetIds.filter((id) => known.has(id)).length;
    });
    return {
      favoriteCount: favoriteAssetIds.filter((id) => known.has(id)).length,
      localCount: savedExternalAssets.filter((a) => a.source === 'local-folder' || a.source === 'local-file').length,
      byCollection,
    };
  }, [savedExternalAssets, customRegistryAssets, favoriteAssetIds, collections]);
}

export const LibraryFilterBar: React.FC<{
  allLabel?: string;
  allCount?: number;
}> = ({ allLabel = 'All Assets', allCount }) => {
  const { favoriteCount, localCount, byCollection } = useLibraryCounts();
  const filter = useShellStore((s) => s.libraryFilter);
  const setFilter = useShellStore((s) => s.setLibraryFilter);
  const collections = useStudioStore((s) => s.assetCollections);
  const createAssetCollection = useStudioStore((s) => s.createAssetCollection);
  const deleteAssetCollection = useStudioStore((s) => s.deleteAssetCollection);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = createAssetCollection(name, color);
    setFilter(`col:${id}`);
    setName('');
    setColor(LABEL_COLORS[(collections.length + 1) % LABEL_COLORS.length]);
    setCreating(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`tag ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          {allLabel}
          {allCount !== undefined && <span className="font-mono text-[10px] opacity-70">{allCount}</span>}
        </button>
        <button
          type="button"
          className={`tag ${filter === 'favorites' ? 'on' : ''}`}
          onClick={() => setFilter('favorites')}
        >
          <Star size={11} fill={filter === 'favorites' ? 'currentColor' : 'none'} /> Favorites
          <span className="font-mono text-[10px] opacity-70">{favoriteCount}</span>
        </button>
        <button type="button" className={`tag ${filter === 'local' ? 'on' : ''}`} onClick={() => setFilter('local')}>
          <FolderOpen size={11} /> Local Folder
          <span className="font-mono text-[10px] opacity-70">{localCount}</span>
        </button>
        {collections.map((c) => {
          const on = filter === `col:${c.id}`;
          return (
            <span key={c.id} className={`tag ${on ? 'on' : ''}`} style={{ paddingRight: on ? 4 : undefined }}>
              <button type="button" className="flex items-center gap-1.5" onClick={() => setFilter(`col:${c.id}`)}>
                <i className="tag-dot" style={{ background: c.color }} />
                {c.name}
                <span className="font-mono text-[10px] opacity-70">{byCollection[c.id] ?? 0}</span>
              </button>
              {on && (
                <button
                  type="button"
                  title={`Delete label "${c.name}" (assets stay in the library)`}
                  aria-label={`Delete label ${c.name}`}
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-err/20 hover:text-err"
                  onClick={() => {
                    deleteAssetCollection(c.id);
                    setFilter('all');
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </span>
          );
        })}
        <button type="button" className="tag" style={{ borderStyle: 'dashed' }} onClick={() => setCreating((v) => !v)}>
          <Plus size={11} /> New Label / Topic
        </button>
      </div>

      {creating && (
        <form onSubmit={submit} className="card space-y-2">
          <input
            autoFocus
            className="field w-full"
            placeholder='Label name, e.g. "Hero Characters"'
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex items-center gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Label color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className="h-5 w-5 rounded-full"
                style={{ background: c, boxShadow: color === c ? '0 0 0 2px rgb(var(--panel)), 0 0 0 4px #fff' : undefined }}
              />
            ))}
            <button type="submit" className="btn primary sm ml-auto" disabled={!name.trim()}>
              Create
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Assign-label popover (fixed-positioned so it is never clipped by the scrolling panel)
// ----------------------------------------------------------------------------

const LabelMenu: React.FC<{
  assetId: string;
  anchor: DOMRect;
  onBeforeAssign: () => void;
  onClose: () => void;
}> = ({ assetId, anchor, onBeforeAssign, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const collections = useStudioStore((s) => s.assetCollections);
  const assignAssetToCollection = useStudioStore((s) => s.assignAssetToCollection);
  const createAssetCollection = useStudioStore((s) => s.createAssetCollection);
  const [name, setName] = useState('');
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  useClickAway(ref, onClose);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8)),
      top: anchor.bottom + 4 + r.height > window.innerHeight - 8 ? Math.max(8, anchor.top - r.height - 4) : anchor.bottom + 4,
    });
  }, [anchor, collections.length]);

  // Portalled to <body>: the card's hover transform and the glass flyout would otherwise
  // become the containing block for position: fixed.
  return createPortal(
    <div ref={ref} className="menu w-52" style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 90 }}>
      <div className="menu-h">Assign label / topic</div>
      {collections.length === 0 && <div className="px-2 pb-1 text-[11px] text-dim">No labels yet. Create one below.</div>}
      {collections.map((c) => {
        const on = c.assetIds.includes(assetId);
        return (
          <button
            key={c.id}
            type="button"
            className={`menu-i ${on ? 'on' : ''}`}
            onClick={() => {
              onBeforeAssign();
              assignAssetToCollection(assetId, c.id);
            }}
          >
            <i className="tag-dot" style={{ background: c.color }} />
            <span className="flex-1 truncate">{c.name}</span>
            {on && <Check size={13} />}
          </button>
        );
      })}
      <form
        className="mt-1 flex gap-1 border-t border-line2 p-1 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onBeforeAssign();
          const id = createAssetCollection(name, LABEL_COLORS[collections.length % LABEL_COLORS.length]);
          assignAssetToCollection(assetId, id);
          setName('');
        }}
      >
        <input
          className="field sm min-w-0 flex-1"
          placeholder="New label…"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn sm" disabled={!name.trim()} aria-label="Create label and assign">
          <Plus size={12} />
        </button>
      </form>
    </div>,
    document.body
  );
};

// ----------------------------------------------------------------------------
// Asset card
// ----------------------------------------------------------------------------

const KIND_ICON: Record<AssetDefinitionKind | 'builtin' | '2d', React.ReactNode> = {
  model: <Box size={22} />,
  builtin: <Box size={22} />,
  '2d': <ImageIcon size={22} />,
  image: <ImageIcon size={22} />,
  svg: <ImageIcon size={22} />,
  audio: <AudioLines size={22} />,
  hdri: <Sun size={22} />,
};

export interface AssetCardProps {
  /** Stable library id: registry assetId, 2D preset id, or AssetDefinition id. */
  id: string;
  name: string;
  subtitle?: string;
  kind: AssetDefinitionKind | 'builtin' | '2d';
  kindLabel?: string;
  thumbnailUrl?: string;
  color?: string;
  badge?: string;
  /** Present for external assets: favoriting or labelling one saves it into the library first. */
  asset?: AssetDefinition;
  busy?: boolean;
  disabled?: boolean;
  addLabel?: string;
  onAdd: () => void;
  onRemove?: () => void;
  footer?: React.ReactNode;
}

export const AssetCard: React.FC<AssetCardProps> = ({
  id,
  name,
  subtitle,
  kind,
  kindLabel,
  thumbnailUrl,
  color = '#5aa9ff',
  badge,
  asset,
  busy,
  disabled,
  addLabel = 'Add to stage',
  onAdd,
  onRemove,
  footer,
}) => {
  const isFavorite = useStudioStore((s) => s.favoriteAssetIds.includes(id));
  const collections = useStudioStore((s) => s.assetCollections);
  const toggleFavoriteAsset = useStudioStore((s) => s.toggleFavoriteAsset);
  const saveExternalAsset = useStudioStore((s) => s.saveExternalAsset);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const memberOf = collections.filter((c) => c.assetIds.includes(id));

  return (
    <div className="asset" title={subtitle ? `${name} · ${subtitle}` : name}>
      <button
        type="button"
        className={`asset-q fav ${isFavorite ? 'on' : ''}`}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => toggleFavoriteAsset(asset ?? id)}
      >
        <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        className={`asset-q lbl ${memberOf.length > 0 ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-label={`Assign label or topic to ${name}`}
        title="Assign label / topic"
        onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <Tag size={12} />
      </button>
      <button
        type="button"
        className="asset-add"
        aria-label={`${addLabel}: ${name}`}
        title={addLabel}
        disabled={disabled || busy}
        onClick={onAdd}
      >
        {busy ? <Loader2 size={13} className="spin" /> : <Plus size={14} />}
      </button>

      <div className="asset-t" onDoubleClick={onAdd}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid h-full w-full place-items-center" style={{ background: `${color}22`, color }}>
            {KIND_ICON[kind]}
          </span>
        )}
        {memberOf.length > 0 && (
          <span className="asset-dots">
            {memberOf.slice(0, 5).map((c) => (
              <i key={c.id} style={{ background: c.color }} title={c.name} />
            ))}
          </span>
        )}
        <span className="asset-kind">{badge || kindLabel || kind}</span>
      </div>

      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">{name}</span>
        {onRemove && (
          <button
            type="button"
            className="orow-b keep danger"
            style={{ width: 18, height: 18 }}
            aria-label={`Remove ${name} from library`}
            title="Remove from library"
            onClick={onRemove}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {subtitle && <span className="truncate text-[10px] text-dim">{subtitle}</span>}
      {footer}

      {menuAnchor && (
        <LabelMenu
          assetId={id}
          anchor={menuAnchor}
          onBeforeAssign={() => asset && saveExternalAsset(asset)}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>
  );
};

/** Card for an AssetDefinition already in (or about to enter) the user library. */
export const SavedAssetCard: React.FC<{
  asset: AssetDefinition;
  busy: boolean;
  onAdd: (asset: AssetDefinition) => void;
  removable?: boolean;
}> = ({ asset, busy, onAdd, removable = true }) => {
  const removeExternalAsset = useStudioStore((s) => s.removeExternalAsset);
  const addLabel =
    asset.kind === 'hdri' ? 'Apply as world lighting' : asset.kind === 'audio' ? 'Add to audio mixer' : 'Add to stage';
  const origin =
    asset.source === 'local-folder'
      ? asset.folder || 'Local folder'
      : asset.source === 'local-file'
        ? 'Local file'
        : asset.source === 'url'
          ? 'Remote URL'
          : [asset.author, asset.license].filter(Boolean).join(' · ') || asset.source;
  return (
    <AssetCard
      id={asset.id}
      name={asset.name}
      subtitle={origin}
      kind={asset.kind}
      kindLabel={asset.kind === 'model' ? 'glb' : asset.kind}
      thumbnailUrl={asset.thumbnailUrl}
      color={asset.kind === 'audio' ? '#f58fc0' : asset.kind === 'hdri' ? '#f2b441' : '#5aa9ff'}
      asset={asset}
      busy={busy}
      addLabel={addLabel}
      onAdd={() => onAdd(asset)}
      onRemove={removable ? () => removeExternalAsset(asset.id) : undefined}
    />
  );
};

/** Applies the shared Favorites / Local Folder / label filter to a list of library ids. */
export function useLibraryFilterPredicate(): (id: string, asset?: AssetDefinition) => boolean {
  const filter = useShellStore((s) => s.libraryFilter);
  const favoriteAssetIds = useStudioStore((s) => s.favoriteAssetIds);
  const collections = useStudioStore((s) => s.assetCollections);
  return (id, asset) => {
    if (filter === 'favorites') return favoriteAssetIds.includes(id);
    if (filter === 'local') return asset?.source === 'local-folder' || asset?.source === 'local-file';
    if (filter.startsWith('col:')) {
      const col = collections.find((c) => `col:${c.id}` === filter);
      return Boolean(col?.assetIds.includes(id));
    }
    return true;
  };
}
