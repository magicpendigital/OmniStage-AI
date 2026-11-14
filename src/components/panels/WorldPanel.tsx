import React from 'react';
import { CloudRain, Mountain, Trash2, Trees } from 'lucide-react';
import { DEFAULT_WORLD_SPEC, LIGHTING_PRESETS } from '../../registry/assetRegistry';
import { useStudioStore } from '../../state/useStudioStore';
import { BIOME_IDS, BIOME_PRESETS } from '../../runtime/biomes';
import {
  LightingPresetId,
  ScatterObjectType,
  SkyboxPreset,
  TerrainType,
  WeatherType,
} from '../../types/scene.schema';

/** World & Environment: terrain, sky, clouds, weather, scatter layers and lighting for WorldRenderer. */
export const WorldPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const updateWorld = useStudioStore((s) => s.updateWorld);
  const updateTerrain = useStudioStore((s) => s.updateTerrain);
  const updateClouds = useStudioStore((s) => s.updateClouds);
  const updateWeather = useStudioStore((s) => s.updateWeather);
  const addScatterLayer = useStudioStore((s) => s.addScatterLayer);
  const removeScatterLayer = useStudioStore((s) => s.removeScatterLayer);
  const setLightingPreset = useStudioStore((s) => s.setLightingPreset);
  const applyBiomePreset = useStudioStore((s) => s.applyBiomePreset);
  const addWorldFeature = useStudioStore((s) => s.addWorldFeature);
  const removeWorldFeature = useStudioStore((s) => s.removeWorldFeature);

  const world = sceneSpec.world ?? DEFAULT_WORLD_SPEC;

  return (
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
              { type: 'broadleaf-trees', label: '+ Leafy Trees' },
              { type: 'bushes', label: '+ Bushes' },
              { type: 'flowers', label: '+ Flowers' },
              { type: 'grass-tufts', label: '+ Grass Tufts' },
              { type: 'palm-trees', label: '+ Palm Trees' },
              { type: 'cacti', label: '+ Cacti' },
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

      {/* Phase 10B: biome presets + water landmarks */}
      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-slate-100">
            <Trees className="w-3.5 h-3.5 text-emerald-400" />
            <span>Biome & Water</span>
          </div>
          {world.biome && <span className="text-[10px] font-mono text-emerald-300">{world.biome}</span>}
        </div>
        <select
          value=""
          onChange={(e) => e.target.value && applyBiomePreset(e.target.value as (typeof BIOME_IDS)[number])}
          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-xs text-slate-100"
          title="Replaces sky, terrain, props, water and outdoor lighting"
        >
          <option value="">Dress the world from a biome…</option>
          {BIOME_IDS.map((b) => (
            <option key={b} value={b}>
              {BIOME_PRESETS[b].label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-1.5">
          {(['waterfall', 'river', 'pond'] as const).map((type) => (
            <button
              key={type}
              onClick={() => addWorldFeature(type)}
              className="px-2 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200 transition-colors capitalize"
            >
              + {type}
            </button>
          ))}
        </div>
        {(world.features || []).map((f) => (
          <div key={f.id} className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]">
            <span className="font-mono text-slate-300">
              {f.type} @ [{f.position.map((v) => Math.round(v)).join(', ')}]
            </span>
            <button onClick={() => removeWorldFeature(f.id)} className="text-slate-400 hover:text-rose-400" title="Remove">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
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
  );
};
