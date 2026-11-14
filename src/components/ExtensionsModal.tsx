import React, { useRef, useState } from 'react';
import { Bot, Download, FileJson, Link2, Loader2, Play, Puzzle, Trash2, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { EXTENSION_CATALOG } from '../extensions/catalog';
import { BUILTIN_DIRECTOR_SKILLS } from '../agent/directorSkills';
import { workspaceApi } from '../workspace/workspaceClient';
import { runExtensionCommand, disposeExtensionSandbox } from '../extensions/commandRunner';
import { aiHeaders } from '../agent/aiClient';
import type { ExtensionManifest } from '../extensions/types';

type Tab = 'installed' | 'catalog' | 'add' | 'skills';

/** Phase 6 — Extensions manager: install / enable / disable / uninstall skills, VFX/SFX packs, asset libraries, tools. */
export const ExtensionsModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isExtensionsOpen);
  const setOpen = useStudioStore((s) => s.setExtensionsOpen);
  const installed = useStudioStore((s) => s.installedExtensions);
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const refreshExtensions = useStudioStore((s) => s.refreshExtensions);
  const openReview = useStudioStore((s) => s.openExtensionReview);
  const settings = useStudioStore((s) => s.settings);
  const setDisabledSkill = useStudioStore((s) => s.setDisabledSkill);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const appendLog = useStudioStore((s) => s.appendLog);
  const [tab, setTab] = useState<Tab>('installed');
  const [url, setUrl] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;
  const installedIds = installed.map((e) => e.manifest.id);

  const review = (manifest: ExtensionManifest, source: 'builtin-catalog' | 'url' | 'file' | 'ai-draft') => openReview({ manifest, source });

  const toggle = async (id: string, enabled: boolean) => {
    await workspaceApi.setExtensionEnabled(id, enabled);
    if (!enabled) disposeExtensionSandbox(id);
    await refreshExtensions();
  };

  const uninstall = async (id: string) => {
    if (!window.confirm('Uninstall this extension? Its folder moves to ~/OmniStage/.trash and can be restored from there.')) return;
    disposeExtensionSandbox(id);
    await workspaceApi.uninstallExtension(id);
    await refreshExtensions();
  };

  const runCommand = async (extId: string, commandId: string) => {
    const ext = installed.find((e) => e.manifest.id === extId);
    if (!ext) return;
    setBusy(`${extId}:${commandId}`);
    setMessage(null);
    try {
      const result = await runExtensionCommand(ext, commandId);
      setMessage(`✓ ${typeof result === 'string' ? result : 'Done'}`);
    } catch (e: any) {
      setMessage(`✗ ${e?.message || e}`);
      appendLog({ level: 'error', message: `Extension command failed: ${e?.message || e}` });
    } finally {
      setBusy(null);
    }
  };

  const fetchUrl = async () => {
    setBusy('url');
    setMessage(null);
    try {
      review(await workspaceApi.fetchExtensionManifest(url.trim()), 'url');
    } catch (e: any) {
      setMessage(`✗ ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const loadFile = async (file: File) => {
    try {
      review(JSON.parse(await file.text()), 'file');
    } catch {
      setMessage('✗ The file is not a valid JSON manifest');
    }
  };

  const draftWithAi = async () => {
    setBusy('draft');
    setMessage(null);
    try {
      const res = await fetch('/api/agent/extension/draft', {
        method: 'POST',
        headers: aiHeaders(settings),
        body: JSON.stringify({ prompt: draftPrompt, engineType: sceneSpec.engineType, mode: sceneSpec.mode }),
      });
      const json = await res.json();
      if (!res.ok || !json.manifest) throw new Error(json.error || 'The AI could not draft an extension');
      review(json.manifest, 'ai-draft');
    } catch (e: any) {
      setMessage(`✗ ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'installed', label: `Installed (${installed.length})` },
    { id: 'catalog', label: 'Catalog' },
    { id: 'add', label: 'Add / Create with AI' },
    { id: 'skills', label: 'Built-in skills' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Extensions">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-violet-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">Extensions</h2>
              <p className="text-slate-400">Skills, VFX & sound packs, asset libraries and tools. Turn on only what your game needs.</p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold ${tab === t.id ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40' : 'text-slate-400 border border-transparent hover:text-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {workspaceAvailable === false && (
            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200">
              Extensions are stored in your local workspace, which is only available when OmniStage runs on this computer (localhost).
            </div>
          )}
          {message && <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-200">{message}</div>}

          {tab === 'installed' &&
            (installed.length === 0 ? (
              <p className="text-slate-400">Nothing installed yet. Browse the Catalog or ask the AI director to create a skill pack for your game.</p>
            ) : (
              installed.map((ext) => (
                <div key={ext.manifest.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100">
                        {ext.manifest.name} <span className="font-mono text-slate-500">v{ext.manifest.version}</span>
                        <span className="ml-2 text-[10px] font-mono text-slate-500">{ext.manifest.kind} · {ext.source}</span>
                      </div>
                      <p className="text-slate-400">{ext.manifest.description}</p>
                      {ext.review && <p className="text-[10px] font-mono text-slate-500 mt-0.5">risk {ext.review.risk}{ext.review.aiRisk ? ` · AI ${ext.review.aiRisk}` : ''}</p>}
                    </div>
                    <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={ext.enabled} onChange={(e) => toggle(ext.manifest.id, e.target.checked)} className="accent-violet-500" />
                      On
                    </label>
                    <button type="button" onClick={() => uninstall(ext.manifest.id)} aria-label={`Uninstall ${ext.manifest.name}`} className="p-1 text-slate-400 hover:text-rose-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {ext.enabled && (ext.manifest.contributes?.commands || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {ext.manifest.contributes!.commands!.map((cmd) => (
                        <button
                          key={cmd.id}
                          type="button"
                          title={cmd.description}
                          onClick={() => runCommand(ext.manifest.id, cmd.id)}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/40 text-cyan-200 disabled:opacity-50"
                        >
                          {busy === `${ext.manifest.id}:${cmd.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          {cmd.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ))}

          {tab === 'catalog' &&
            EXTENSION_CATALOG.map((m) => (
              <div key={m.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                <div className="flex-1">
                  <div className="font-semibold text-slate-100">{m.name} <span className="text-[10px] font-mono text-slate-500">{m.kind}</span></div>
                  <p className="text-slate-400">{m.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(m.tags || []).slice(0, 6).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400">{t}</span>
                    ))}
                  </div>
                </div>
                {installedIds.includes(m.id) ? (
                  <span className="text-emerald-300 font-semibold">Installed</span>
                ) : (
                  <button type="button" onClick={() => review(m, 'builtin-catalog')} disabled={workspaceAvailable === false} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-100 font-semibold disabled:opacity-40">
                    <Download className="w-3 h-3" /> Review & install
                  </button>
                )}
              </div>
            ))}

          {tab === 'add' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-100 flex items-center gap-1.5"><Bot className="w-4 h-4 text-violet-300" /> Create with the AI director</div>
                <p className="text-slate-400">Describe your game's style or a tool you want. The AI drafts a skill/VFX/sound pack; you review it before anything is installed.</p>
                <textarea
                  rows={3}
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  placeholder="e.g. Một bộ skill cho game nông trại pixel dễ thương: bảng màu pastel, hiệu ứng lá rơi, âm thanh thu hoạch"
                  className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 resize-none"
                />
                <button type="button" onClick={draftWithAi} disabled={!draftPrompt.trim() || busy === 'draft' || workspaceAvailable === false} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white font-semibold disabled:opacity-40">
                  {busy === 'draft' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />} Draft extension
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-100 flex items-center gap-1.5"><Link2 className="w-4 h-4 text-cyan-300" /> Install from URL</div>
                <div className="flex gap-1.5">
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/omnistage-extension.json" className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono placeholder-slate-600" />
                  <button type="button" onClick={fetchUrl} disabled={!/^https:\/\//.test(url.trim()) || busy === 'url'} className="px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-200 disabled:opacity-40">
                    {busy === 'url' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Review'}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-100 flex items-center gap-1.5"><FileJson className="w-4 h-4 text-amber-300" /> Install from a manifest file</div>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200">Choose omnistage-extension.json…</button>
              </div>
            </div>
          )}

          {tab === 'skills' &&
            BUILTIN_DIRECTOR_SKILLS.map((s) => {
              const off = (settings.disabledSkills || []).includes(s.id);
              return (
                <label key={s.id} className="flex items-start gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                  <input type="checkbox" checked={!off} onChange={(e) => setDisabledSkill(s.id, !e.target.checked)} className="accent-violet-500 mt-0.5" />
                  <div>
                    <div className="font-semibold text-slate-100">{s.title}</div>
                    <p className="text-slate-400">{s.description}</p>
                  </div>
                </label>
              );
            })}
        </div>
      </div>
    </div>
  );
};
