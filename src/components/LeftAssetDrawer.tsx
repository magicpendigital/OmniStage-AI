import React, { useRef, useState } from 'react';
import {
  Box,
  CloudRain,
  Copy,
  Eye,
  EyeOff,
  FilePlus2,
  Film,
  Globe2,
  Layers,
  Link2,
  Lock,
  Mountain,
  Plus,
  Sparkles as SparklesIcon,
  Trash2,
  Trees,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  ASSET_REGISTRY,
  DEFAULT_WORLD_SPEC,
  LIGHTING_PRESETS,
  PRESET_2D_ASSETS,
  SCENE_TEMPLATES,
} from '../registry/assetRegistry';
import { useStudioStore } from '../state/useStudioStore';
import {
  LightingPresetId,
  ScatterObjectType,
  SkyboxPreset,
  TerrainType,
  WeatherType,
} from '../types/scene.schema';

type AuthoringTab = 'outliner' | 'world' | 'library' | 'storyboard';

export const LeftAssetDrawer: React.FC = () => {
  // Default to 'outliner' (Scene Graph) for From-Scratch Authoring First workflow
  const [activeTab, setActiveTab] = useState<AuthoringTab>('outliner');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'rigged' | 'procedural' | '2d'>('all');
  const [customGlbUrl, setCustomGlbUrl] = useState('');
  const [customGlbName, setCustomGlbName] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const activeSceneId = useStudioStore((s) => s.activeSceneId);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectedNode2DId = useStudioStore((s) => s.selectedNode2DId);
  const customRegistryAssets = useStudioStore((s) => s.customRegistryAssets);

  const selectActor = useStudioStore((s) => s.selectActor);
  const updateActorProperty = useStudioStore((s) => s.updateActorProperty);
  const duplicateActor = useStudioStore((s) => s.duplicateActor);
  const removeActor = useStudioStore((s) => s.removeActor);
  const spawnAsset = useStudioStore((s) => s.spawnAsset);
  const registerAndSpawnCustomAsset = useStudioStore((s) => s.registerAndSpawnCustomAsset);
  const spawnVFX = useStudioStore((s) => s.spawnVFX);
  const removeVFX = useStudioStore((s) => s.removeVFX);

  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const spawnPreset2D = useStudioStore((s) => s.spawnPreset2D);
  const updateNode2D = useStudioStore((s) => s.updateNode2D);
  const duplicateNode2D = useStudioStore((s) => s.duplicateNode2D);
  const removeNode2D = useStudioStore((s) => s.removeNode2D);

  const updateWorld = useStudioStore((s) => s.updateWorld);
  const updateTerrain = useStudioStore((s) => s.updateTerrain);
  const updateClouds = useStudioStore((s) => s.updateClouds);
  const updateWeather = useStudioStore((s) => s.updateWeather);
  const addScatterLayer = useStudioStore((s) => s.addScatterLayer);
  const removeScatterLayer = useStudioStore((s) => s.removeScatterLayer);
  const setLightingPreset = useStudioStore((s) => s.setLightingPreset);
  const setEngineType = useStudioStore((s) => s.setEngineType);
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);

  const createNewBlankScene = useStudioStore((s) => s.createNewBlankScene);
  const switchScene = useStudioStore((s) => s.switchScene);
  const duplicateScene = useStudioStore((s) => s.duplicateScene);
  const deleteScene = useStudioStore((s) => s.deleteScene);
  const loadProjectBundle = useStudioStore((s) => s.loadProjectBundle);
  const loadTemplate = useStudioStore((s) => s.loadTemplate);

  const is2D = sceneSpec.engineType === '2d';
  const world = sceneSpec.world ?? DEFAULT_WORLD_SPEC;
  const nodes2D = sceneSpec.nodes2D || [];
  const all3DAssets = [...customRegistryAssets, ...Object.values(ASSET_REGISTRY)];

  const handleAddCustomGlb = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customGlbUrl.trim()) return;
    registerAndSpawnCustomAsset(
      customGlbName.trim() || 'Custom GLTF Model',
      customGlbUrl.trim(),
      'glb'
    );
    setCustomGlbUrl('');
    setCustomGlbName('');
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
        const blobUrl = URL.createObjectURL(file);
        if (is2D) setEngineType('3d');
        registerAndSpawnCustomAsset(baseName, blobUrl, 'glb');
      } else if (lower.endsWith('.svg')) {
        const blobUrl = URL.createObjectURL(file);
        registerAndSpawnCustomAsset(baseName, blobUrl, 'svg');
      } else if (
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp')
      ) {
        const blobUrl = URL.createObjectURL(file);
        registerAndSpawnCustomAsset(baseName, blobUrl, 'image');
      } else if (lower.endsWith('.json')) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
            loadProjectBundle(parsed.scenes, parsed.activeSceneId || parsed.id);
          } else if (parsed && (parsed.actors || parsed.nodes2D) && parsed.environment) {
            setSceneSpec(parsed);
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    }
  };

  return (
    <aside className="w-80 bg-[#0F172A] border-r border-slate-800/90 flex flex-col h-full shrink-0 select-none">
      {/* Drawer Header & 4 From-Scratch Authoring Tabs */}
      <div className="p-3 border-b border-slate-800/90">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-semibold text-xs uppercase tracking-wider text-slate-200">
            {is2D ? '2D Vector & Game Outliner' : '3D Scene & World Studio'}
          </h2>
          <span className="text-[11px] font-mono text-cyan-400 tabular-nums">
            {is2D
              ? `${nodes2D.length} Layers`
              : `${sceneSpec.actors.length} Actors · ${sceneSpec.vfx.length} VFX`}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800/80">
          {[
            { id: 'outliner', label: 'Outliner', icon: <Layers className="w-3.5 h-3.5" /> },
            { id: 'world', label: 'World', icon: <Globe2 className="w-3.5 h-3.5" /> },
            { id: 'library', label: 'Assets', icon: <Box className="w-3.5 h-3.5" /> },
            { id: 'storyboard', label: 'Scenes', icon: <Film className="w-3.5 h-3.5" /> },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as AuthoringTab)}
                className={`flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* =========================================================
            TAB 1: SCENE GRAPH (OUTLINER) & FROM-SCRATCH SPAWNER
           ========================================================= */}
        {activeTab === 'outliner' && (
          <div className="space-y-3">
            {/* Quick Add From Scratch Bar */}
            <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase text-slate-400">
                  + Add Node From Scratch
                </span>
                <span className="text-[10px] font-mono text-cyan-400">
                  {is2D ? '2D Engine' : '3D Engine'}
                </span>
              </div>

              {!is2D ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => spawnAsset('gltf-robot-expressive')}
                    className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-[11px] font-medium text-cyan-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Rigged Robot</span>
                  </button>
                  <button
                    onClick={() => spawnAsset('gltf-fox')}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] font-medium text-emerald-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Rigged Fox</span>
                  </button>
                  <button
                    onClick={() => spawnAsset('starter-primitive-showcase')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>3D Primitive</span>
                  </button>
                  <button
                    onClick={() => spawnVFX('sparkles')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-amber-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>VFX Emitter</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => spawnPreset2D('2d-hero-runner')}
                    className="px-2.5 py-1.5 rounded-lg bg-fuchsia-500/15 hover:bg-fuchsia-500/25 border border-fuchsia-500/40 text-[11px] font-medium text-fuchsia-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>2D Player</span>
                  </button>
                  <button
                    onClick={() => spawnPreset2D('2d-neon-platform')}
                    className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-[11px] font-medium text-cyan-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>2D Platform</span>
                  </button>
                  <button
                    onClick={() => spawnPreset2D('2d-star-coin')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-amber-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Star Pickup</span>
                  </button>
                  <button
                    onClick={() => spawnPreset2D('2d-kinetic-headline')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Kinetic Text</span>
                  </button>
                </div>
              )}
            </div>

            {/* 3D Actors Outliner List */}
            {!is2D && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase text-slate-400">
                  <span>3D Actors ({sceneSpec.actors.length})</span>
                  <span>Click to Inspect</span>
                </div>

                {sceneSpec.actors.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-dashed border-slate-800 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      Blank 3D Stage — Add a rigged GLTF character, primitive, or ask the AI Director to build a world from scratch.
                    </p>
                  </div>
                ) : (
                  sceneSpec.actors.map((actor) => {
                    const selected = actor.id === selectedActorId;
                    const visible = actor.visible !== false;
                    return (
                      <div
                        key={actor.id}
                        onClick={() => selectActor(actor.id)}
                        className={`px-2.5 py-2 rounded-lg border cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                          selected
                            ? 'bg-slate-900 border-cyan-500/70 text-cyan-200'
                            : 'bg-slate-900/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: actor.primaryColor || '#06b6d4' }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{actor.name}</div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              {actor.activeClip
                                ? `GLTF Clip: ${actor.activeClip}`
                                : `${actor.physicsRole} · [${actor.position
                                    .map((n) => n.toFixed(1))
                                    .join(',')}]`}
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              updateActorProperty(actor.id, { visible: !visible })
                            }
                            title={visible ? 'Hide Actor' : 'Show Actor'}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                          >
                            {visible ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                            )}
                          </button>
                          <button
                            onClick={() =>
                              updateActorProperty(actor.id, { locked: !actor.locked })
                            }
                            title={actor.locked ? 'Unlock Actor' : 'Lock Actor'}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-300"
                          >
                            {actor.locked ? (
                              <Lock className="w-3.5 h-3.5 text-amber-400" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => duplicateActor(actor.id)}
                            title="Duplicate Actor"
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-300"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeActor(actor.id)}
                            title="Delete Actor"
                            className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Active VFX & 3D Text Callouts in Outliner */}
                {sceneSpec.vfx.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <div className="text-[11px] font-mono uppercase text-slate-400">
                      VFX & 3D Callouts ({sceneSpec.vfx.length})
                    </div>
                    {sceneSpec.vfx.map((vfx) => (
                      <div
                        key={vfx.id}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <SparklesIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="font-mono text-slate-300 truncate">{vfx.name}</span>
                        </div>
                        <button
                          onClick={() => removeVFX(vfx.id)}
                          className="p-1 text-slate-400 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2D Layers Outliner List */}
            {is2D && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase text-slate-400">
                  <span>2D Canvas Layers ({nodes2D.length})</span>
                  <span>1000×600 Space</span>
                </div>

                {nodes2D.map((node) => {
                  const selected = node.id === selectedNode2DId;
                  const visible = node.visible !== false;
                  return (
                    <div
                      key={node.id}
                      onClick={() => selectNode2D(node.id)}
                      className={`px-2.5 py-2 rounded-lg border cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                        selected
                          ? 'bg-slate-900 border-fuchsia-500/70 text-fuchsia-200'
                          : 'bg-slate-900/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: node.fill }}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{node.name}</div>
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            {node.type} · ({Math.round(node.x)}, {Math.round(node.y)})
                          </div>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => updateNode2D(node.id, { visible: !visible })}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        >
                          {visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                          )}
                        </button>
                        <button
                          onClick={() => duplicateNode2D(node.id)}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-fuchsia-300"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeNode2D(node.id)}
                          className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            TAB 2: WORLD & ENVIRONMENT BUILDER (Terrain, Sky, Weather, Scatter)
           ========================================================= */}
        {activeTab === 'world' && (
          <div className="space-y-4 text-xs">
            {/* Procedural Terrain Selector */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                <Mountain className="w-3.5 h-3.5 text-emerald-400" />
                <span>3D Terrain & Water Generator</span>
              </div>

              <select
                value={world.terrain.type}
                onChange={(e) => {
                  const type = e.target.value as TerrainType;
                  const palette: Record<TerrainType, { c: string; w: number }> = {
                    'flat-grid': { c: '#111827', w: 0 },
                    'grassy-hills': { c: '#15803d', w: 0 },
                    'desert-dunes': { c: '#b45309', w: 0 },
                    'snow-mountains': { c: '#64748b', w: 0 },
                    'ocean-island': { c: '#15803d', w: 0.25 },
                    'city-asphalt': { c: '#090d16', w: 0 },
                    none: { c: '#090d16', w: 0 },
                  };
                  const chosen = palette[type];
                  updateTerrain({
                    type,
                    color: chosen.c,
                    waterLevel: chosen.w,
                  });
                }}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-xs text-slate-100"
              >
                <option value="flat-grid">flat-grid (Clean Studio Floor)</option>
                <option value="grassy-hills">grassy-hills (Rolling Nature Hills)</option>
                <option value="desert-dunes">desert-dunes (Cinematic Sand Ridges)</option>
                <option value="snow-mountains">snow-mountains (Alpine Peaks)</option>
                <option value="ocean-island">ocean-island (Island + Animated Water)</option>
                <option value="city-asphalt">city-asphalt (Urban Cyber Grid)</option>
              </select>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
                  <span>Elevation Scale</span>
                  <span>{world.terrain.elevationScale.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={3.5}
                  step={0.1}
                  value={world.terrain.elevationScale}
                  onChange={(e) =>
                    updateTerrain({ elevationScale: parseFloat(e.target.value) })
                  }
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>

              <label className="flex items-center justify-between pt-1 cursor-pointer">
                <span className="text-[11px] text-slate-300">Animated Ocean / Water Plane</span>
                <input
                  type="checkbox"
                  checked={Boolean(world.terrain.waterLevel && world.terrain.waterLevel > 0.01)}
                  onChange={(e) =>
                    updateTerrain({ waterLevel: e.target.checked ? 0.25 : 0 })
                  }
                  className="accent-cyan-400"
                />
              </label>
            </div>

            {/* Skybox, Sun & Volumetric Clouds */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                <CloudRain className="w-3.5 h-3.5 text-cyan-400" />
                <span>Sky Dome, Clouds & Weather</span>
              </div>

              <select
                value={world.skybox}
                onChange={(e) => updateWorld({ skybox: e.target.value as SkyboxPreset })}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-xs text-slate-100"
              >
                <option value="studio-hdri">studio-hdri (Controlled Studio)</option>
                <option value="daylight-sky">daylight-sky (Atmospheric Rayleigh Sky)</option>
                <option value="sunset-atmosphere">sunset-atmosphere (Golden Horizon)</option>
                <option value="night-stars">night-stars (2,500 Deep Starfield)</option>
                <option value="cyber-void">cyber-void (Neon Starfield)</option>
                <option value="overcast">overcast (Moody Cinema Sky)</option>
              </select>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[11px] text-slate-300">Volumetric Drifting Clouds</span>
                <input
                  type="checkbox"
                  checked={world.clouds.enabled}
                  onChange={(e) => updateClouds({ enabled: e.target.checked })}
                  className="accent-cyan-400"
                />
              </label>

              <div className="space-y-1 pt-1">
                <span className="text-[11px] text-slate-400 block">Weather Particle System:</span>
                <select
                  value={world.weather.type}
                  onChange={(e) =>
                    updateWeather({
                      type: e.target.value as WeatherType,
                      intensity: e.target.value === 'clear' ? 0 : 0.75,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-xs text-slate-100"
                >
                  <option value="clear">clear (No Precipitation)</option>
                  <option value="rain">rain (Downpour Streaks)</option>
                  <option value="snow">snow (Drifting Snowflakes)</option>
                  <option value="floating-embers">floating-embers (Rising Fire Sparks)</option>
                  <option value="foggy-mist">foggy-mist (Atmospheric Dust)</option>
                </select>
              </div>
            </div>

            {/* Environment Scatter Props */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                  <Trees className="w-3.5 h-3.5 text-amber-400" />
                  <span>World Scatter Props</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {world.scatterObjects.length} Layers
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { type: 'pine-trees', label: '+ Pine Forest' },
                    { type: 'cyber-buildings', label: '+ Cyber City' },
                    { type: 'rocks-boulders', label: '+ Boulders' },
                    { type: 'crystal-clusters', label: '+ Crystals' },
                    { type: 'ancient-pillars', label: '+ Pillars' },
                    { type: 'street-lights', label: '+ Street Lamps' },
                  ] as { type: ScatterObjectType; label: string }[]
                ).map((sc) => (
                  <button
                    key={sc.type}
                    onClick={() => addScatterLayer(sc.type)}
                    className="px-2 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200 transition-colors text-left truncate"
                  >
                    {sc.label}
                  </button>
                ))}
              </div>

              {world.scatterObjects.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  {world.scatterObjects.map((layer) => (
                    <div
                      key={layer.id}
                      className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]"
                    >
                      <span className="font-mono text-slate-300">
                        {layer.type} ({layer.count})
                      </span>
                      <button
                        onClick={() => removeScatterLayer(layer.id)}
                        className="text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Studio Lighting Presets */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                3-Point Lighting Presets
              </div>
              {(Object.keys(LIGHTING_PRESETS) as LightingPresetId[]).map((presetKey) => {
                const preset = LIGHTING_PRESETS[presetKey];
                const active = sceneSpec.environment.presetId === preset.presetId;
                return (
                  <button
                    key={preset.presetId}
                    onClick={() => setLightingPreset(preset.presetId)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                      active
                        ? 'bg-slate-900 border-cyan-500/60'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-100">{preset.name}</span>
                      {active && (
                        <span className="text-[10px] font-mono text-cyan-400">ACTIVE</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{preset.subtitle}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 3: ASSET LIBRARY & DRAG-AND-DROP IMPORTER
           ========================================================= */}
        {activeTab === 'library' && (
          <div className="space-y-3.5">
            {/* Drag & Drop File Upload Zone (.glb, .gltf, .svg, .png, .json) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFile(false);
                handleFilesSelected(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`p-3.5 rounded-xl border-2 border-dashed cursor-pointer transition-colors text-center space-y-1.5 ${
                isDraggingFile
                  ? 'bg-cyan-500/15 border-cyan-400 text-cyan-200'
                  : 'bg-slate-950/80 border-slate-800 hover:border-cyan-500/50 text-slate-300'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".glb,.gltf,.svg,.png,.jpg,.jpeg,.webp,.json"
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <Upload className="w-5 h-5 text-cyan-400 mx-auto" />
              <div className="text-xs font-semibold">
                Drop .GLB / .GLTF / .SVG / .PNG / .JSON
              </div>
              <div className="text-[10px] text-slate-400">
                Instantly mounts local 3D skeletal models or 2D sprites onto the stage
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
              {[
                { id: 'all', label: 'All' },
                { id: 'rigged', label: 'GLTF Rig' },
                { id: 'procedural', label: '3D Props' },
                { id: '2d', label: '2D Vector' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setLibraryFilter(f.id as any)}
                  className={`py-1 rounded font-medium transition-colors ${
                    libraryFilter === f.id
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* 3D GLTF & Procedural Assets */}
            {libraryFilter !== '2d' && (
              <div className="space-y-2">
                {all3DAssets
                  .filter((a) => {
                    if (libraryFilter === 'rigged') return Boolean(a.modelUrl);
                    if (libraryFilter === 'procedural') return !a.modelUrl;
                    return true;
                  })
                  .map((asset) => (
                    <div
                      key={asset.assetId}
                      className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: asset.defaultPrimaryColor }}
                            />
                            <h3 className="text-xs font-semibold text-slate-100 truncate">
                              {asset.name}
                            </h3>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            {asset.description}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            if (is2D) setEngineType('3d');
                            spawnAsset(asset.assetId);
                          }}
                          className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center gap-1 shrink-0 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </button>
                      </div>

                      <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span className="truncate">
                          {asset.modelUrl
                            ? `GLB · Clips: ${(asset.embeddedClips || []).slice(0, 3).join(', ') || 'Mesh'}`
                            : `3D PBR · ${asset.category}`}
                        </span>
                        <span className="text-cyan-400 shrink-0">
                          {asset.modelUrl ? 'Three/Khronos CDN' : 'Built-in'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* 2D Vector & Sprite Presets */}
            {(libraryFilter === 'all' || libraryFilter === '2d') && (
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-mono uppercase text-fuchsia-300">
                  2D Engine Vector & Sprite Presets
                </div>
                {PRESET_2D_ASSETS.map((p) => (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-sm"
                          style={{ backgroundColor: p.nodeTemplate.fill }}
                        />
                        <span className="text-xs font-semibold text-slate-100">{p.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {p.nodeTemplate.type} · {p.nodeTemplate.physics2D}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        if (!is2D) setEngineType('2d');
                        spawnPreset2D(p.id);
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-fuchsia-500/15 hover:bg-fuchsia-500/25 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-medium shrink-0"
                    >
                      + Add 2D
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Direct Custom .GLB URL Spawner */}
            <form
              onSubmit={handleAddCustomGlb}
              className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Link2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Mount Remote .GLB / .GLTF URL</span>
              </div>
              <input
                type="text"
                value={customGlbName}
                onChange={(e) => setCustomGlbName(e.target.value)}
                placeholder="Model Name (e.g. Custom Hero)"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-100"
              />
              <input
                type="url"
                value={customGlbUrl}
                onChange={(e) => setCustomGlbUrl(e.target.value)}
                placeholder="https://.../model.glb"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs font-mono text-slate-100"
              />
              <button
                type="submit"
                className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-300 transition-colors"
              >
                Mount GLTF URL onto Stage
              </button>
            </form>
          </div>
        )}

        {/* =========================================================
            TAB 4: MULTI-SCENE STORYBOARD & SAMPLE PROJECTS
           ========================================================= */}
        {activeTab === 'storyboard' && (
          <div className="space-y-4">
            {/* Multi-Scene Storyboard / Level Manager */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase text-slate-300">
                  Project Storyboard / Levels ({scenes.length})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => createNewBlankScene('3d', `3D Scene ${scenes.length + 1}`)}
                  className="py-2 px-2.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-semibold text-cyan-300 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  <span>+ Blank 3D</span>
                </button>
                <button
                  onClick={() => createNewBlankScene('2d', `2D Level ${scenes.length + 1}`)}
                  className="py-2 px-2.5 rounded-lg bg-fuchsia-500/15 hover:bg-fuchsia-500/25 border border-fuchsia-500/40 text-xs font-semibold text-fuchsia-300 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  <span>+ Blank 2D</span>
                </button>
              </div>

              <div className="space-y-1.5 pt-1">
                {scenes.map((sc, idx) => {
                  const active = sc.id === activeSceneId;
                  return (
                    <div
                      key={sc.id}
                      onClick={() => switchScene(sc.id)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-slate-900 border-cyan-500/70'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                            #{(idx + 1).toString().padStart(2, '0')} · {(sc.engineType || '3d').toUpperCase()}
                          </span>
                          <span className="text-xs font-semibold text-slate-100 truncate">
                            {sc.title}
                          </span>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => duplicateScene(sc.id)}
                          title="Duplicate Scene"
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-300"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {scenes.length > 1 && (
                          <button
                            onClick={() => deleteScene(sc.id)}
                            title="Delete Scene"
                            className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Secondary Starter Sample Projects */}
            <div className="pt-3 border-t border-slate-800 space-y-2.5">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Sample Reference Projects (Optional)
              </div>
              {Object.values(SCENE_TEMPLATES).map((tpl) => {
                const isCurrent = sceneSpec.id === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={`p-2.5 rounded-lg border transition-colors ${
                      isCurrent
                        ? 'bg-slate-900 border-cyan-500/60'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-100 truncate">
                        {tpl.title}
                      </h3>
                      <span className="text-[10px] font-mono text-cyan-400 uppercase shrink-0">
                        {tpl.engineType || '3d'} · {tpl.mode}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                      {tpl.description}
                    </p>
                    <button
                      onClick={() => loadTemplate(tpl.id)}
                      className="mt-2 w-full py-1.5 rounded bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-xs font-semibold text-slate-200 transition-colors"
                    >
                      {isCurrent ? 'Reload Sample' : 'Open Sample Scene'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
