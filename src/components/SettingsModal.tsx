import React, { useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Database,
  Globe,
  KeyRound,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { DEFAULT_SETTINGS, useStudioStore } from '../state/useStudioStore';
import { EngineType, SettingsConfig } from '../types/scene.schema';

type SettingsTab = 'ai' | 'libraries' | 'engine';

export const SettingsModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isSettingsModalOpen);
  const setOpen = useStudioStore((s) => s.setSettingsModalOpen);
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);

  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  const [savedNotice, setSavedNotice] = useState(false);

  if (!isOpen) return null;

  const handleResetDefaults = () => {
    updateSettings(DEFAULT_SETTINGS);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-slate-100">
                Studio Settings & External Library Hub
              </h2>
              <p className="text-xs text-slate-400">
                Configure Gemini AI Director models, external 3D/2D asset CDNs, and engine physics
              </p>
            </div>
          </div>

          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-slate-800 bg-slate-900/40 flex items-center gap-2">
          {[
            { id: 'ai', label: '1. AI Director & Prompts', icon: <Sparkles className="w-3.5 h-3.5" /> },
            { id: 'libraries', label: '2. External Asset CDNs', icon: <Database className="w-3.5 h-3.5" /> },
            { id: 'engine', label: '3. Engine & Render Quality', icon: <Sliders className="w-3.5 h-3.5" /> },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SettingsTab)}
                className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-xs font-medium transition-colors ${
                  active
                    ? 'border-cyan-400 text-cyan-300 font-semibold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {activeTab === 'ai' && (
            <div className="space-y-4">
              {/* Server-Side API Key Security Badge */}
              <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-emerald-300">
                    Server-Side Gemini API Key Active (GEMINI_API_KEY)
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Credentials are securely injected via the backend Express proxy (
                    <code className="text-emerald-300 font-mono">/api/agent/mutate</code> &{' '}
                    <code className="text-emerald-300 font-mono">/api/agent/vision-qa</code>) so keys are never exposed in client bundles.
                  </p>
                </div>
              </div>

              {/* Gemini Model Selector */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-200">
                  Gemini Reasoning & Spatial Authoring Model
                </label>
                <select
                  value={settings.geminiModel}
                  onChange={(e) =>
                    updateSettings({
                      geminiModel: e.target.value as SettingsConfig['geminiModel'],
                    })
                  }
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                >
                  <option value="gemini-3.8-flash">
                    gemini-3.8-flash (Recommended · Fast Spatial & World Authoring)
                  </option>
                  <option value="gemini-3.1-flash-lite">
                    gemini-3.1-flash-lite (Ultra-Fast Interactive Turnaround)
                  </option>
                  <option value="gemini-flash-latest">
                    gemini-flash-latest (Latest Stable Multimodal Flash)
                  </option>
                </select>
              </div>

              {/* Custom System Prompt Extension */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-200">
                  Custom Studio Art Direction / System Prompt Rules (Optional)
                </label>
                <textarea
                  rows={4}
                  value={settings.customSystemPrompt}
                  onChange={(e) => updateSettings({ customSystemPrompt: e.target.value })}
                  placeholder="e.g., Always use low-poly pastel palettes, place pine trees around the perimeter, or favor 2D kinetic typography..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                />
                <p className="text-[11px] text-slate-400">
                  Appended to the AI Director system instructions whenever you generate or mutate a 3D or 2D scene.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'libraries' && (
            <div className="space-y-4">
              <p className="text-slate-300 leading-relaxed">
                Enable or configure external 3D GLTF/GLB & 2D SVG/Sprite asset repositories. Models from enabled hubs appear in the <strong>Asset Library & Importer</strong> tab.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    key: 'enableThreeOfficialCdn',
                    title: 'Three.js / Khronos Official GLTF CDN',
                    desc: 'Rigged skeletal characters (RobotExpressive, Soldier, Fox, Horse, Parrot, DamagedHelmet)',
                  },
                  {
                    key: 'enablePolyPizzaHub',
                    title: 'Poly Pizza Low-Poly Game Hub',
                    desc: 'CORS-enabled game props, vehicles, and stylized environment meshes',
                  },
                  {
                    key: 'enablePolyHavenHub',
                    title: 'Poly Haven PBR & World Props',
                    desc: 'Nature boulders, pine foliage, and calibrated studio lighting rigs',
                  },
                  {
                    key: 'enableSketchfabHub',
                    title: 'Custom / Sketchfab Direct GLB URLs',
                    desc: 'Allow direct URL & drag-and-drop .glb / .gltf / .svg / .png asset ingestion',
                  },
                ].map((hub) => {
                  const checked = Boolean(settings[hub.key as keyof SettingsConfig]);
                  return (
                    <label
                      key={hub.key}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-start gap-3 ${
                        checked
                          ? 'bg-slate-900/90 border-cyan-500/50'
                          : 'bg-slate-950/60 border-slate-800 opacity-70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          updateSettings({ [hub.key]: e.target.checked } as Partial<SettingsConfig>)
                        }
                        className="mt-0.5 accent-cyan-400"
                      />
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-100">{hub.title}</div>
                        <div className="text-[11px] text-slate-400">{hub.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Asset Hub API Keys</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Stored only in this browser (localStorage) and sent to the studio server per request, which calls
                  the provider on your behalf so models and HDRIs load without CORS errors.
                </p>
                <div className="space-y-1">
                  <label className="block text-slate-300">
                    Poly Pizza API key{' '}
                    <a href="https://poly.pizza/settings/api" target="_blank" rel="noreferrer" className="text-cyan-400 underline">
                      (get one)
                    </a>{' '}
                    — required to search
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings.polyPizzaApiKey}
                    onChange={(e) => updateSettings({ polyPizzaApiKey: e.target.value })}
                    placeholder="x-auth-token"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-300">
                    Sketchfab API token{' '}
                    <a href="https://sketchfab.com/settings/password" target="_blank" rel="noreferrer" className="text-cyan-400 underline">
                      (get one)
                    </a>{' '}
                    — search is public, token needed to download GLB
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings.sketchfabApiToken}
                    onChange={(e) => updateSettings({ sketchfabApiToken: e.target.value })}
                    placeholder="Sketchfab API token"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Poly Haven (CC0 models & HDRIs) needs no key.
                </p>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Custom Studio Asset Manifest URL (JSON / CDN Endpoint)</span>
                </label>
                <input
                  type="url"
                  value={settings.customAssetManifestUrl}
                  onChange={(e) => updateSettings({ customAssetManifestUrl: e.target.value })}
                  placeholder="https://cdn.yourstudio.com/omnistage-assets.json"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {activeTab === 'engine' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-200">
                    Default Authoring Engine
                  </label>
                  <select
                    value={settings.defaultEngine}
                    onChange={(e) =>
                      updateSettings({ defaultEngine: e.target.value as EngineType })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono"
                  >
                    <option value="3d">3D WebGL Engine (Three.js / R3F)</option>
                    <option value="2d">2D Vector & Sprite Engine (Canvas2D)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-200">
                    Viewport Render Quality
                  </label>
                  <select
                    value={settings.renderQuality}
                    onChange={(e) =>
                      updateSettings({
                        renderQuality: e.target.value as SettingsConfig['renderQuality'],
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono"
                  >
                    <option value="draft">Draft (1x DPR · Fast Mobile Preview)</option>
                    <option value="high">High (2x Retina DPR · Soft Shadows)</option>
                    <option value="ultra-postprocessing">
                      Ultra Cinema (High DPR + Bloom & Reflections)
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between cursor-pointer">
                  <span className="font-medium text-slate-200">Real-Time Shadow Maps</span>
                  <input
                    type="checkbox"
                    checked={settings.enableShadows}
                    onChange={(e) => updateSettings({ enableShadows: e.target.checked })}
                    className="accent-cyan-400"
                  />
                </label>

                <label className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between cursor-pointer">
                  <span className="font-medium text-slate-200">Emissive Glow & Rim Highlights</span>
                  <input
                    type="checkbox"
                    checked={settings.enableBloom}
                    onChange={(e) => updateSettings({ enableBloom: e.target.checked })}
                    className="accent-cyan-400"
                  />
                </label>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between font-mono">
                  <span className="font-sans font-semibold text-slate-200">
                    Game Mode Gravity Acceleration
                  </span>
                  <span className="text-cyan-400">{settings.physicsGravity.toFixed(1)} m/s²</span>
                </div>
                <input
                  type="range"
                  min={-25}
                  max={0}
                  step={0.5}
                  value={settings.physicsGravity}
                  onChange={(e) =>
                    updateSettings({ physicsGravity: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <button
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <div className="flex items-center gap-3">
            {savedNotice && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved</span>
              </span>
            )}
            <button
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-colors"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Done & Apply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
