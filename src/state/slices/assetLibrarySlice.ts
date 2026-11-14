/**
 * Adaptive docking shell — the user's asset library: favorites, labels (collections), local folder mounts and Online Hub
 * bookmarks, plus the project name shown in the top bar when no workspace project is open.
 * Persisted to localStorage under `omnistage_asset_library_v1` (`blob:` URLs are never written: they die with the tab).
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { AssetCollection, AssetDefinition, AssetDefinitionKind, SemanticAssetEntry } from '../../types/scene.schema';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

const LIBRARY_STORAGE_KEY = 'omnistage_asset_library_v1';
const PROJECT_NAME_STORAGE_KEY = 'omnistage_project_name_v1';

interface PersistedLibrary {
  favoriteAssetIds: string[];
  savedExternalAssets: AssetDefinition[];
  assetCollections: AssetCollection[];
}

export function loadInitialLibrary(): PersistedLibrary {
  const empty: PersistedLibrary = { favoriteAssetIds: [], savedExternalAssets: [], assetCollections: [] };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      favoriteAssetIds: Array.isArray(parsed.favoriteAssetIds) ? parsed.favoriteAssetIds : [],
      savedExternalAssets: Array.isArray(parsed.savedExternalAssets) ? parsed.savedExternalAssets : [],
      assetCollections: Array.isArray(parsed.assetCollections) ? parsed.assetCollections : [],
    };
  } catch {
    return empty;
  }
}

function persistLibrary(lib: PersistedLibrary) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({
        favoriteAssetIds: lib.favoriteAssetIds,
        assetCollections: lib.assetCollections,
        savedExternalAssets: lib.savedExternalAssets.filter((a) => !a.url.startsWith('blob:')),
      })
    );
  } catch {
    // ignore quota errors
  }
}

export function loadInitialProjectName(): string {
  if (typeof window === 'undefined') return 'Untitled Project';
  try {
    return window.localStorage.getItem(PROJECT_NAME_STORAGE_KEY) || 'Untitled Project';
  } catch {
    return 'Untitled Project';
  }
}

const LOCAL_ASSET_EXTENSIONS: Record<string, AssetDefinitionKind> = {
  glb: 'model',
  gltf: 'model',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  hdr: 'hdri',
};

export function assetKindForFileName(fileName: string): AssetDefinitionKind | null {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  return LOCAL_ASSET_EXTENSIONS[ext] ?? null;
}

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const createAssetLibrarySlice = (set: StudioSet, get: StudioGet): StudioSlice => ({
  setProjectName: (projectName) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PROJECT_NAME_STORAGE_KEY, projectName);
      } catch {
        // ignore quota errors
      }
    }
    set({ projectName });
  },

  saveExternalAsset: (asset) =>
    set((state) => {
      if (state.savedExternalAssets.some((a) => a.id === asset.id)) return state;
      const savedExternalAssets = [asset, ...state.savedExternalAssets];
      persistLibrary({ ...state, savedExternalAssets });
      return { savedExternalAssets };
    }),

  removeExternalAsset: (assetId) =>
    set((state) => {
      const removed = state.savedExternalAssets.find((a) => a.id === assetId);
      if (removed?.url.startsWith('blob:')) URL.revokeObjectURL(removed.url);
      const next = {
        savedExternalAssets: state.savedExternalAssets.filter((a) => a.id !== assetId),
        favoriteAssetIds: state.favoriteAssetIds.filter((id) => id !== assetId),
        assetCollections: state.assetCollections.map((c) => ({ ...c, assetIds: c.assetIds.filter((id) => id !== assetId) })),
      };
      persistLibrary(next);
      return next;
    }),

  toggleFavoriteAsset: (asset) => {
    const assetId = typeof asset === 'string' ? asset : asset.id;
    // Favoriting a hub search result bookmarks it so it survives the search being cleared.
    if (typeof asset !== 'string') get().saveExternalAsset(asset);
    set((state) => {
      const favoriteAssetIds = state.favoriteAssetIds.includes(assetId)
        ? state.favoriteAssetIds.filter((id) => id !== assetId)
        : [...state.favoriteAssetIds, assetId];
      persistLibrary({ ...state, favoriteAssetIds });
      return { favoriteAssetIds };
    });
  },

  createAssetCollection: (name, color) => {
    const id = `col-${Date.now().toString(36)}`;
    set((state) => {
      const assetCollections = [...state.assetCollections, { id, name: name.trim() || 'Untitled Label', color, assetIds: [] }];
      persistLibrary({ ...state, assetCollections });
      return { assetCollections };
    });
    return id;
  },

  deleteAssetCollection: (id) =>
    set((state) => {
      const assetCollections = state.assetCollections.filter((c) => c.id !== id);
      persistLibrary({ ...state, assetCollections });
      return { assetCollections };
    }),

  assignAssetToCollection: (assetId, collectionId) =>
    set((state) => {
      const assetCollections = state.assetCollections.map((c) => {
        if (c.id !== collectionId) return c;
        return c.assetIds.includes(assetId)
          ? { ...c, assetIds: c.assetIds.filter((id) => id !== assetId) }
          : { ...c, assetIds: [...c.assetIds, assetId] };
      });
      persistLibrary({ ...state, assetCollections });
      return { assetCollections };
    }),

  importLocalDirectoryAssets: (files, relativePaths) => {
    const list = Array.from(files as ArrayLike<File>);
    const existing = new Set(get().savedExternalAssets.map((a) => a.id));
    const imported: AssetDefinition[] = [];
    const roots = new Set<string>();

    list.forEach((file, index) => {
      const kind = assetKindForFileName(file.name);
      if (!kind) return;
      const relativePath = relativePaths?.[index] || file.webkitRelativePath || '';
      const segments = relativePath.split('/').filter(Boolean);
      const isFolderMount = segments.length > 1;
      const root = isFolderMount ? segments[0] : '';
      // "Pack/Robots/Arms/claw.glb" -> folder "Robots/Arms"; files at the mount root use the root name.
      const subPath = segments.slice(1, -1);
      const folder = isFolderMount ? (subPath.length > 0 ? subPath.join('/') : root) : undefined;
      const id = `local-${hashString(`${relativePath || file.name}:${file.size}:${file.lastModified}`)}`;
      if (existing.has(id)) return;
      existing.add(id);
      if (root) roots.add(root);
      const url = URL.createObjectURL(file);
      imported.push({
        id,
        name: file.name.replace(/\.[^/.]+$/, ''),
        kind,
        url,
        source: isFolderMount ? 'local-folder' : 'local-file',
        folder,
        tags: isFolderMount ? Array.from(new Set([root, ...subPath])) : [],
        thumbnailUrl: kind === 'image' || kind === 'svg' ? url : undefined,
        sizeBytes: file.size,
        addedAt: Date.now(),
      });
    });

    if (imported.length > 0) {
      set((state) => ({
        savedExternalAssets: [...imported, ...state.savedExternalAssets],
        mountedFolderNames: Array.from(new Set([...state.mountedFolderNames, ...roots])),
      }));
    }
    return imported;
  },

  spawnSavedAsset: (assetId, resolvedUrl) => {
    const state = get();
    const asset = state.savedExternalAssets.find((a) => a.id === assetId);
    if (!asset) return;
    const url = resolvedUrl || asset.url;
    if (!url) return;

    if (asset.kind === 'model') {
      // One registry entry per library asset, however many times it is placed on stage.
      const registryId = `ext-${asset.id}`;
      if (!state.customRegistryAssets.some((c) => c.assetId === registryId)) {
        const entry: SemanticAssetEntry = {
          assetId: registryId,
          name: asset.name,
          category: 'gltf-rigged',
          description: `Library model (${asset.folder || asset.source}).`,
          modelUrl: url,
          defaultPrimaryColor: '#5AA9FF',
          defaultSecondaryColor: '#F2B441',
          defaultMetalness: 0.6,
          defaultRoughness: 0.3,
          defaultAnimation: 'idle',
          defaultPhysicsRole: 'dynamic',
          defaultClickAction: 'bounce',
          defaultScoreValue: 25,
          boundingBox: { width: 1.5, height: 2.0, depth: 1.5 },
          attachmentSockets: { ground: [0, 0, 0], top_badge: [0, 2.3, 0] },
          supportedAnimations: ['idle', 'spin', 'float', 'bounce'],
        };
        set((s) => ({ customRegistryAssets: [entry, ...s.customRegistryAssets] }));
      }
      get().spawnAsset(registryId, url, asset.name);
    } else if (asset.kind === 'image' || asset.kind === 'svg') {
      get().registerAndSpawnCustomAsset(asset.name, url, asset.kind === 'svg' ? 'svg' : 'image');
    } else if (asset.kind === 'audio') {
      const lower = asset.name.toLowerCase();
      get().addAudioTrack({
        name: asset.name,
        url,
        kind: /voice|dialog|narrat/.test(lower) ? 'voice' : /sfx|hit|click|pickup/.test(lower) ? 'sfx' : 'music',
        startTime: 0,
        volume: 0.8,
        loop: false,
      });
    } else if (asset.kind === 'hdri') {
      const current = state.sceneSpec.world?.hdri;
      if (state.sceneSpec.engineType === '2d') get().setEngineType('3d');
      get().updateWorld({
        hdri: {
          url,
          name: asset.name,
          source: asset.online?.provider ?? 'custom',
          showBackground: current?.showBackground ?? true,
          intensity: current?.intensity ?? 1,
        },
      });
    }
  },
});
