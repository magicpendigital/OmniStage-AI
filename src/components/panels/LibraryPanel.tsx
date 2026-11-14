import React, { useMemo, useRef, useState } from 'react';
import { ChevronRight, FolderOpen, Link2, Search, Upload } from 'lucide-react';
import { ASSET_REGISTRY, PRESET_2D_ASSETS } from '../../registry/assetRegistry';
import { assetKindForFileName, useStudioStore } from '../../state/useStudioStore';
import { useShellStore } from '../../state/useShellStore';
import { AssetDefinition } from '../../types/scene.schema';
import {
  AssetCard,
  LibraryFilterBar,
  SavedAssetCard,
  useLibraryFilterPredicate,
  useSpawnSavedAsset,
} from '../AssetLibrary';
import { OmniRigModal } from '../OmniRigModal';
import { PersonalLibraryPanel } from '../PersonalLibraryPanel';

type KindFilter = 'all' | 'rigged' | 'procedural' | '2d' | 'audio';

const ACCEPTED = '.glb,.gltf,.svg,.png,.jpg,.jpeg,.webp,.mp3,.wav,.ogg,.hdr,.json,.omnistage';

interface PickedFile {
  file: File;
  relativePath: string;
}

/** Recursively reads a dropped directory entry (Chromium / Firefox / Safari `webkitGetAsEntry`). */
async function readEntry(entry: any, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, relativePath: String(entry.fullPath || file.name).replace(/^\//, '') });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries returns results in batches, so keep reading until it comes back empty.
    for (;;) {
      const batch: any[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await readEntry(child, out);
    }
  }
}

/** Walks a File System Access API directory handle. */
async function readDirectoryHandle(dir: any, prefix: string, out: PickedFile[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = `${prefix}/${name}`;
    if (handle.kind === 'file') out.push({ file: await handle.getFile(), relativePath: path });
    else if (handle.kind === 'directory') await readDirectoryHandle(handle, path, out);
  }
}

/** Asset Library: built-in GLTF rigs and 2D presets plus everything the user mounted, favorited or labelled. */
export const LibraryPanel: React.FC = () => {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [omniRigOpen, setOmniRigOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const is2D = useStudioStore((s) => s.sceneSpec.engineType === '2d');
  const customRegistryAssets = useStudioStore((s) => s.customRegistryAssets);
  const savedExternalAssets = useStudioStore((s) => s.savedExternalAssets);
  const mountedFolderNames = useStudioStore((s) => s.mountedFolderNames);

  const spawnAsset = useStudioStore((s) => s.spawnAsset);
  const spawnPreset2D = useStudioStore((s) => s.spawnPreset2D);
  const setEngineType = useStudioStore((s) => s.setEngineType);
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);
  const loadProjectBundle = useStudioStore((s) => s.loadProjectBundle);
  const importLocalDirectoryAssets = useStudioStore((s) => s.importLocalDirectoryAssets);
  const saveExternalAsset = useStudioStore((s) => s.saveExternalAsset);

  const filter = useShellStore((s) => s.libraryFilter);
  const setFilter = useShellStore((s) => s.setLibraryFilter);
  const matchesFilter = useLibraryFilterPredicate();
  const { spawn, busyId, error, clearError } = useSpawnSavedAsset();

  // Registry entries that mirror a saved library asset are shown once, as the saved card.
  const builtin3D = useMemo(
    () => [...customRegistryAssets.filter((a) => !a.assetId.startsWith('ext-')), ...Object.values(ASSET_REGISTRY)],
    [customRegistryAssets]
  );

  const localAssets = savedExternalAssets.filter((a) => a.source === 'local-folder' || a.source === 'local-file');
  const folders = useMemo(
    () => Array.from(new Set(localAssets.map((a) => a.folder).filter(Boolean) as string[])).sort(),
    [localAssets]
  );

  const q = query.trim().toLowerCase();
  const matchesQuery = (name: string, extra = '') => !q || `${name} ${extra}`.toLowerCase().includes(q);

  const savedVisible = savedExternalAssets.filter((a) => {
    if (!matchesFilter(a.id, a)) return false;
    if (filter === 'local' && folderFilter && a.folder !== folderFilter) return false;
    if (kindFilter === 'rigged' && a.kind !== 'model') return false;
    if (kindFilter === 'procedural') return false;
    if (kindFilter === '2d' && a.kind !== 'image' && a.kind !== 'svg') return false;
    if (kindFilter === 'audio' && a.kind !== 'audio') return false;
    return matchesQuery(a.name, `${a.folder || ''} ${a.tags.join(' ')}`);
  });

  const builtinVisible =
    kindFilter === '2d' || kindFilter === 'audio'
      ? []
      : builtin3D.filter((a) => {
          if (!matchesFilter(a.assetId)) return false;
          if (kindFilter === 'rigged' && !a.modelUrl) return false;
          if (kindFilter === 'procedural' && a.modelUrl) return false;
          return matchesQuery(a.name, a.description);
        });

  const presetsVisible =
    kindFilter === 'all' || kindFilter === '2d'
      ? PRESET_2D_ASSETS.filter((p) => matchesFilter(p.id) && matchesQuery(p.name, p.nodeTemplate.type))
      : [];

  const totalVisible = savedVisible.length + builtinVisible.length + presetsVisible.length;

  const ingest = async (picked: PickedFile[], mountedAsFolder: boolean) => {
    clearError();
    const assetFiles: PickedFile[] = [];
    let projectsLoaded = 0;
    for (const item of picked) {
      const lower = item.file.name.toLowerCase();
      if (lower.endsWith('.json') || lower.endsWith('.omnistage')) {
        if (mountedAsFolder) continue; // never swap the open project because a folder happened to contain JSON
        try {
          const parsed = JSON.parse(await item.file.text());
          if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
            loadProjectBundle(parsed.scenes, parsed.activeSceneId || parsed.id);
            projectsLoaded++;
          } else if (parsed && (parsed.actors || parsed.nodes2D) && parsed.environment) {
            setSceneSpec(parsed);
            projectsLoaded++;
          }
        } catch {
          // malformed JSON is skipped
        }
      } else if (assetKindForFileName(item.file.name)) {
        assetFiles.push(item);
      }
    }

    const imported = importLocalDirectoryAssets(
      assetFiles.map((p) => p.file),
      assetFiles.map((p) => p.relativePath)
    );

    if (mountedAsFolder) {
      setFilter('local');
      setFolderFilter(null);
      const skipped = assetFiles.length - imported.length;
      setNotice(
        imported.length > 0
          ? `Mounted ${imported.length} asset${imported.length === 1 ? '' : 's'} from the local folder${skipped > 0 ? ` (${skipped} already in the library)` : ''}.`
          : assetFiles.length > 0
            ? 'Every supported file in that folder is already in the library.'
            : 'No supported files (.glb, .gltf, .svg, .png, .jpg, .mp3, .wav) were found in that folder.'
      );
    } else {
      // A hand-picked file or two goes straight on stage, as before; bigger batches only fill the library.
      if (imported.length > 0 && imported.length <= 3) {
        for (const asset of imported) await spawn(asset);
      }
      setNotice(
        imported.length > 0
          ? `Imported ${imported.length} file${imported.length === 1 ? '' : 's'}${imported.length <= 3 ? ' and placed on stage' : ' into the library'}.`
          : projectsLoaded > 0
            ? 'Project loaded.'
            : picked.length > 0
              ? 'Nothing new to import from that selection.'
              : null
      );
    }
  };

  const handleInputFiles = (files: FileList | null, mountedAsFolder: boolean) => {
    if (!files || files.length === 0) return;
    ingest(
      Array.from(files).map((file) => ({ file, relativePath: file.webkitRelativePath || '' })),
      mountedAsFolder
    );
  };

  const handleLoadFolder = async () => {
    const supportsInput = 'webkitdirectory' in document.createElement('input');
    const picker = (window as any).showDirectoryPicker;
    if (!supportsInput && typeof picker === 'function') {
      try {
        const dir = await picker.call(window);
        const out: PickedFile[] = [];
        await readDirectoryHandle(dir, dir.name, out);
        await ingest(out, true);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setNotice('The folder could not be read.');
      }
      return;
    }
    folderInputRef.current?.click();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const items = Array.from(e.dataTransfer.items || []);
    const entries = items.map((it) => (it as any).webkitGetAsEntry?.()).filter(Boolean);
    if (entries.some((en: any) => en.isDirectory)) {
      const out: PickedFile[] = [];
      for (const en of entries) await readEntry(en, out);
      await ingest(out, true);
    } else {
      handleInputFiles(e.dataTransfer.files, false);
    }
  };

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = remoteUrl.trim();
    if (!url) return;
    const fileName = url.split(/[?#]/)[0].split('/').pop() || 'remote-asset';
    const kind = assetKindForFileName(fileName) ?? 'model';
    const asset: AssetDefinition = {
      id: `url-${Date.now().toString(36)}`,
      name: remoteName.trim() || fileName.replace(/\.[^/.]+$/, '') || 'Remote asset',
      kind,
      url,
      source: 'url',
      tags: ['remote'],
      thumbnailUrl: kind === 'image' || kind === 'svg' ? url : undefined,
      addedAt: Date.now(),
    };
    saveExternalAsset(asset);
    await spawn(asset);
    setRemoteUrl('');
    setRemoteName('');
    setShowUrlForm(false);
  };

  return (
    <>
      {/* Phase 9: OmniRig — auto-rig a character model */}
      <button
        type="button"
        className="btn"
        onClick={() => setOmniRigOpen(true)}
        title="Skeleton, skin weights and animations for a humanoid, four-legged or prop model"
      >
        🦴 Auto-rig a character (OmniRig)
      </button>
      {omniRigOpen && <OmniRigModal onClose={() => setOmniRigOpen(false)} />}
      {/* Phase 6: personal + project-shared library on this computer */}
      <PersonalLibraryPanel />
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className="btn" onClick={handleLoadFolder} title="Mount every asset inside a folder on this computer">
          <FolderOpen size={14} className="text-warn" /> Load Local Folder
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          title="Import individual files"
        >
          <Upload size={14} className="text-accent" /> Import Files
        </button>
      </div>
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        // Non-standard directory attributes; spread so React forwards them untouched.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          handleInputFiles(e.target.files, true);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          handleInputFiles(e.target.files, false);
          e.target.value = '';
        }}
      />

      <div
        className={`dropzone ${isDragging ? 'on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
      >
        <div className="text-[11px] font-medium">Drop a folder or files here</div>
        <div className="mt-0.5 text-[10px] text-dim">.glb · .gltf · .svg · .png · .jpg · .mp3 · .wav · .json</div>
      </div>

      <button type="button" className="btn ghost sm self-start" onClick={() => setShowUrlForm((v) => !v)}>
        <Link2 size={12} /> {showUrlForm ? 'Hide URL import' : 'Import from URL'}
      </button>
      {showUrlForm && (
        <form onSubmit={handleAddUrl} className="card space-y-1.5">
          <input
            className="field w-full"
            placeholder="Name (optional)"
            value={remoteName}
            onChange={(e) => setRemoteName(e.target.value)}
          />
          <input
            className="field w-full font-mono"
            type="url"
            required
            placeholder="https://…/model.glb"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
          />
          <button type="submit" className="btn primary sm w-full" disabled={!remoteUrl.trim() || busyId !== null}>
            Save to library &amp; place on stage
          </button>
        </form>
      )}

      {notice && <div className="text-[11px] text-ok" role="status">{notice}</div>}
      {error && <div className="rounded-md border border-err/30 bg-err/10 p-2 text-[11px] text-err" role="alert">{error}</div>}

      <LibraryFilterBar allCount={savedExternalAssets.length + builtin3D.length + PRESET_2D_ASSETS.length} />

      {filter === 'local' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-mute">
            <FolderOpen size={12} className="text-warn" />
            <button type="button" className="hover:text-fg" onClick={() => setFolderFilter(null)}>
              {mountedFolderNames.length > 0 ? mountedFolderNames.join(', ') : 'Local files'}
            </button>
            {folderFilter &&
              folderFilter.split('/').map((seg, i) => (
                <React.Fragment key={i}>
                  <ChevronRight size={11} className="text-dim" />
                  <span className="text-fg">{seg}</span>
                </React.Fragment>
              ))}
          </div>
          {folders.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`tag ${folderFilter === f ? 'on' : ''}`}
                  style={{ height: 20, fontSize: 10 }}
                  onClick={() => setFolderFilter(folderFilter === f ? null : f)}
                >
                  {f}
                  <span className="font-mono opacity-70">{localAssets.filter((a) => a.folder === f).length}</span>
                </button>
              ))}
            </div>
          )}
          {localAssets.length === 0 && (
            <p className="text-[11px] text-dim">
              No local folder mounted yet. Local files stay on this computer and need re-mounting after a page reload.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            className="field w-full"
            style={{ paddingLeft: 26 }}
            placeholder="Filter by name, folder or tag"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="field"
          aria-label="Asset type"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
        >
          <option value="all">All types</option>
          <option value="rigged">GLTF models</option>
          <option value="procedural">3D props</option>
          <option value="2d">2D</option>
          <option value="audio">Audio</option>
        </select>
      </div>

      {totalVisible === 0 ? (
        <p className="py-4 text-center text-[11px] text-dim">
          {filter === 'favorites'
            ? 'No favorites yet. Star any asset to pin it here.'
            : filter.startsWith('col:')
              ? 'Nothing carries this label yet. Use the tag button on any asset card.'
              : 'No assets match these filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {savedVisible.map((asset) => (
            <SavedAssetCard key={asset.id} asset={asset} busy={busyId === asset.id} onAdd={spawn} />
          ))}
          {builtinVisible.map((a) => (
            <AssetCard
              key={a.assetId}
              id={a.assetId}
              name={a.name}
              subtitle={a.modelUrl ? (a.embeddedClips || []).slice(0, 3).join(', ') || 'Static mesh' : a.category}
              kind="builtin"
              kindLabel={a.modelUrl ? 'glb' : 'pbr'}
              color={a.defaultPrimaryColor}
              onAdd={() => {
                if (is2D) setEngineType('3d');
                spawnAsset(a.assetId);
              }}
            />
          ))}
          {presetsVisible.map((p) => (
            <AssetCard
              key={p.id}
              id={p.id}
              name={p.name}
              subtitle={`${p.nodeTemplate.type} · ${p.nodeTemplate.physics2D}`}
              kind="2d"
              kindLabel="2d"
              color={p.nodeTemplate.fill}
              onAdd={() => {
                if (!is2D) setEngineType('2d');
                spawnPreset2D(p.id);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
};
