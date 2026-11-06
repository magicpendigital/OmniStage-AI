import React, { useState } from 'react';
import {
  Box,
  Flame,
  FolderKanban,
  Link2,
  Plus,
  Sparkles as SparklesIcon,
  SunMedium,
  Trash2,
} from 'lucide-react';
import {
  ASSET_REGISTRY,
  LIGHTING_PRESETS,
  SCENE_TEMPLATES,
  VFX_PRESETS,
} from '../registry/assetRegistry';
import { useStudioStore } from '../state/useStudioStore';
import { LightingPresetId } from '../types/scene.schema';

type DrawerTab = 'templates' | 'assets' | 'lighting' | 'vfx';

export const LeftAssetDrawer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DrawerTab>('assets');
  const [customGlbUrl, setCustomGlbUrl] = useState('');
  const [customGlbName, setCustomGlbName] = useState('');

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const loadTemplate = useStudioStore((s) => s.loadTemplate);
  const spawnAsset = useStudioStore((s) => s.spawnAsset);
  const setLightingPreset = useStudioStore((s) => s.setLightingPreset);
  const spawnVFX = useStudioStore((s) => s.spawnVFX);
  const removeVFX = useStudioStore((s) => s.removeVFX);

  const handleAddCustomGlb = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customGlbUrl.trim()) return;
    spawnAsset(
      'starter-primitive-showcase',
      customGlbUrl.trim(),
      customGlbName.trim() || 'Custom GLB Actor'
    );
    setCustomGlbUrl('');
    setCustomGlbName('');
  };

  return (
    <aside className="w-80 bg-[#0F172A] border-r border-slate-800/90 flex flex-col h-full shrink-0 select-none">
      {/* Drawer Header & Segmented Navigation */}
      <div className="p-3.5 border-b border-slate-800/90">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-display font-semibold text-xs uppercase tracking-wider text-slate-300">
            Semantic Asset Library
          </h2>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            {sceneSpec.actors.length} Actors · {sceneSpec.vfx.length} VFX
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800/80">
          {[
            { id: 'assets', label: '3D Models', icon: <Box className="w-3.5 h-3.5" /> },
            { id: 'templates', label: 'Scenes', icon: <FolderKanban className="w-3.5 h-3.5" /> },
            { id: 'lighting', label: 'Studios', icon: <SunMedium className="w-3.5 h-3.5" /> },
            { id: 'vfx', label: 'VFX', icon: <SparklesIcon className="w-3.5 h-3.5" /> },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as DrawerTab)}
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
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* TAB 1: SEMANTIC 3D ASSETS */}
        {activeTab === 'assets' && (
          <>
            <div className="space-y-2.5">
              {Object.values(ASSET_REGISTRY).map((asset) => (
                <div
                  key={asset.assetId}
                  className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: asset.defaultPrimaryColor }}
                        />
                        <h3 className="text-xs font-semibold text-slate-100">{asset.name}</h3>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {asset.description}
                      </p>
                    </div>
                    <button
                      onClick={() => spawnAsset(asset.assetId)}
                      className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-medium flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>

                  {/* Semantic Metadata Footer (Unboxed clean text with separators) */}
                  <div className="pt-1.5 border-t border-slate-800/80 flex items-center gap-1.5 text-[10px] font-mono text-slate-400 tabular-nums overflow-x-auto whitespace-nowrap">
                    <span className="capitalize text-slate-300">{asset.category}</span>
                    <span>·</span>
                    <span>
                      BBox {asset.boundingBox.width}×{asset.boundingBox.height}×
                      {asset.boundingBox.depth}m
                    </span>
                    <span>·</span>
                    <span>+{asset.defaultScoreValue} PTS</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Hybrid Custom .GLB URL Spawner */}
            <form
              onSubmit={handleAddCustomGlb}
              className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2.5 mt-4"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Link2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Mount Custom .GLB Asset URL</span>
              </div>
              <input
                type="text"
                value={customGlbName}
                onChange={(e) => setCustomGlbName(e.target.value)}
                placeholder="Actor Name (e.g. Custom Drone)"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <input
                type="url"
                value={customGlbUrl}
                onChange={(e) => setCustomGlbUrl(e.target.value)}
                placeholder="https://example.com/model.glb"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
              >
                Spawn Custom GLB with Fallback Safety
              </button>
            </form>
          </>
        )}

        {/* TAB 2: STARTER SCENE TEMPLATES */}
        {activeTab === 'templates' && (
          <div className="space-y-2.5">
            {Object.values(SCENE_TEMPLATES).map((tpl) => {
              const isCurrent = sceneSpec.id === tpl.id;
              return (
                <div
                  key={tpl.id}
                  className={`p-3 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'bg-slate-900 border-cyan-500/60'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-100">{tpl.title}</h3>
                    <span className="text-[11px] font-mono text-cyan-400">
                      {tpl.aspectRatio} · {tpl.mode.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                    {tpl.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-400">
                      {tpl.actors.length} Actors · {tpl.vfx.length} VFX
                    </span>
                    <button
                      onClick={() => loadTemplate(tpl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        isCurrent
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      {isCurrent ? 'Reload Stage' : 'Load Template'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 3: LIGHTING STUDIOS */}
        {activeTab === 'lighting' && (
          <div className="space-y-2.5">
            {(Object.keys(LIGHTING_PRESETS) as LightingPresetId[]).map((presetKey) => {
              const preset = LIGHTING_PRESETS[presetKey];
              const active = sceneSpec.environment.presetId === preset.presetId;
              return (
                <button
                  key={preset.presetId}
                  onClick={() => setLightingPreset(preset.presetId)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    active
                      ? 'bg-slate-900 border-cyan-500/60'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: preset.previewAccent }}
                      />
                      <span className="text-xs font-semibold text-slate-100">{preset.name}</span>
                    </div>
                    {active && (
                      <span className="text-[10px] font-mono text-cyan-400 uppercase">Active</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{preset.subtitle}</p>
                  <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-slate-400">
                    <span>Key {preset.keyLightColor}</span>
                    <span>·</span>
                    <span>Rim {preset.rimLightColor}</span>
                    <span>·</span>
                    <span>BG {preset.backgroundColor}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* TAB 4: VFX & 3D TEXT CALLOUTS */}
        {activeTab === 'vfx' && (
          <div className="space-y-3">
            <div className="space-y-2">
              {VFX_PRESETS.map((vfx) => (
                <div
                  key={vfx.type}
                  className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Flame className="w-3.5 h-3.5" style={{ color: vfx.defaultColor }} />
                      <h3 className="text-xs font-semibold text-slate-100">{vfx.name}</h3>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{vfx.description}</p>
                  </div>
                  <button
                    onClick={() => spawnVFX(vfx.type)}
                    className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-300 shrink-0 transition-colors"
                  >
                    + Spawn
                  </button>
                </div>
              ))}
            </div>

            {sceneSpec.vfx.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <h4 className="text-[11px] font-mono uppercase text-slate-400">
                  Active Stage VFX ({sceneSpec.vfx.length})
                </h4>
                {sceneSpec.vfx.map((node) => (
                  <div
                    key={node.id}
                    className="px-2.5 py-2 rounded bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <span className="font-mono text-slate-300 truncate">{node.name}</span>
                    <button
                      onClick={() => removeVFX(node.id)}
                      className="text-slate-400 hover:text-rose-400 p-1"
                      title="Remove VFX Node"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
