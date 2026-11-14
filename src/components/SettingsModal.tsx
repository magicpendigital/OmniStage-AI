import React, { useEffect, useState } from 'react';
import { GENERATION_PROVIDERS, GenerationProviderId } from '../extensions/types';
import {
  Brain,
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
  Trash2,
  X,
} from 'lucide-react';
import { BUILTIN_DIRECTOR_SKILLS } from '../agent/directorSkills';
import { AIProviderPanel } from './AIProviderPanel';
import { MemoryPanel } from './MemoryPanel';
import { ProductionToolsPanel } from './ProductionToolsPanel';
import { SETTINGS_TAB_EVENT } from '../guide/guideActions';
import { DEFAULT_SETTINGS, useStudioStore } from '../state/useStudioStore';
import { EngineType, SettingsConfig } from '../types/scene.schema';

type SettingsTab = 'ai' | 'libraries' | 'engine' | 'memory' | 'production';

export const SettingsModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isSettingsModalOpen);
  const setOpen = useStudioStore((s) => s.setSettingsModalOpen);
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const learnedSkills = useStudioStore((s) => s.learnedSkills);
  const removeLearnedSkill = useStudioStore((s) => s.removeLearnedSkill);

  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  // Guide "Try it" buttons can open a specific tab.
  useEffect(() => {
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent<SettingsTab>).detail;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener(SETTINGS_TAB_EVENT, onTab);
    return () => window.removeEventListener(SETTINGS_TAB_EVENT, onTab);
  }, []);
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
            { id: 'memory', label: '4. Memory', icon: <Brain className="w-3.5 h-3.5" /> },
            { id: 'production', label: '5. Production tools', icon: <KeyRound className="w-3.5 h-3.5" /> },
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
              {/* Phase 6: provider picker (API keys, OpenRouter, OpenAI-compatible, local coding-agent CLIs) */}
              <AIProviderPanel />

              {/* Phase 7C: patch edits vs full rewrites */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-200">How the AI edits your scene</label>
                <select
                  value={settings.aiEditMode || 'patch'}
                  onChange={(e) => updateSettings({ aiEditMode: e.target.value as 'patch' | 'full' })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="patch">Small edits, checked in a loop (recommended)</option>
                  <option value="full">Rewrite the whole scene each time</option>
                </select>
                <p className="text-[11px] text-slate-400">
                  Small edits are faster and never drop parts of your scene. OmniStage checks each edit and asks the AI to fix
                  problems (up to 3 rounds). Use "Rewrite" only if your model can't follow the edit format.
                </p>
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

              {/* Phase 4: Director Skills */}
              <div className="space-y-2">
                <label className="block font-semibold text-slate-200">Director Skills</label>
                <p className="text-[11px] text-slate-400">
                  Up to 3 skills matching your prompt are injected automatically. Use
                  <span className="font-mono text-violet-300"> Save as skill </span>
                  in the chat to teach the director a reusable recipe.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BUILTIN_DIRECTOR_SKILLS.map((skill) => (
                    <span
                      key={skill.id}
                      title={skill.description}
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 border border-slate-700 text-slate-300"
                    >
                      {skill.title}
                    </span>
                  ))}
                </div>
                {learnedSkills.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">No learned skills yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {learnedSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-slate-900 border border-violet-500/30"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-violet-200 truncate">{skill.title}</div>
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            {skill.engine.toUpperCase()} · {skill.mode} · used {skill.uses || 0}× · {skill.triggers.join(', ')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLearnedSkill(skill.id)}
                          title="Forget this skill"
                          className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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

              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <KeyRound className="w-3.5 h-3.5 text-fuchsia-400" />
                  <span>Generation keys (Meshy · Tripo · fal.ai · Replicate)</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Used by generator extensions (My Library → Generate). Stored only in this browser and sent to the local
                  OmniStage server, which calls the provider for you. Each generation uses your credits with that provider.
                </p>
                {(Object.keys(GENERATION_PROVIDERS) as GenerationProviderId[]).map((id) => (
                  <div key={id} className="space-y-1">
                    <label className="block text-slate-300">
                      {GENERATION_PROVIDERS[id].label}{' '}
                      <a href={GENERATION_PROVIDERS[id].keyUrl} target="_blank" rel="noreferrer" className="text-cyan-400 underline">(get one)</a>
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={settings.generationKeys?.[id] || ''}
                      onChange={(e) => updateSettings({ generationKeys: { ...(settings.generationKeys || {}), [id]: e.target.value } })}
                      placeholder={GENERATION_PROVIDERS[id].keyLabel}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                ))}
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

          {activeTab === 'memory' && <MemoryPanel />}
          {activeTab === 'production' && <ProductionToolsPanel />}

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
