import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, KeyRound, Loader2, Plus, RefreshCw, Terminal, X, XCircle } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { AIProviderId, SettingsConfig } from '../types/scene.schema';
import {
  AI_PROVIDERS,
  fetchProviderStatus,
  providerInfo,
  providerReady,
  ProviderStatusResponse,
  testProviderConnection,
} from '../agent/aiClient';

/** Phase 6 — Settings → AI: provider picker (API keys, OpenRouter, OpenAI-compatible, local coding-agent CLIs). */
export const AIProviderPanel: React.FC = () => {
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const [status, setStatus] = useState<ProviderStatusResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; model?: string; ms: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const provider = settings.aiProvider || 'gemini';
  const info = providerInfo(provider);

  const refresh = async (force = false) => {
    setRefreshing(true);
    setStatus(await fetchProviderStatus(force));
    setRefreshing(false);
  };

  useEffect(() => {
    refresh(false);
  }, []);

  const select = (id: AIProviderId) => {
    updateSettings({ aiProvider: id });
    setTestResult(null);
  };

  const cliStatus = (id: AIProviderId) => status?.cli.find((c) => c.id === id);
  const apiStatus = (id: AIProviderId) => status?.api.find((a) => a.id === id);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestResult(await testProviderConnection(useStudioStore.getState().settings));
    setTesting(false);
  };

  const fallbackOn = settings.aiFallbackEnabled !== false;
  const order = (settings.aiFallbackOrder || []).filter((id) => id !== provider);
  const setOrder = (next: AIProviderId[]) => updateSettings({ aiFallbackOrder: next });
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const candidates = AI_PROVIDERS.filter((p) => p.id !== provider && !order.includes(p.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block font-semibold text-slate-200">AI Provider</label>
        <button
          type="button"
          onClick={() => refresh(true)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Detect CLIs
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {AI_PROVIDERS.map((p) => {
          const cli = p.kind === 'cli' ? cliStatus(p.id) : undefined;
          const api = p.kind === 'api' ? apiStatus(p.id) : undefined;
          const ready = providerReady(p.id, settings, status);
          const active = provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              className={`text-left p-2 rounded-lg border transition-colors ${
                active ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800 bg-slate-900 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-slate-100 text-[11px] flex items-center gap-1">
                  {p.kind === 'cli' ? <Terminal className="w-3 h-3 text-violet-300" /> : <KeyRound className="w-3 h-3 text-amber-300" />}
                  {p.label}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-slate-600'}`} title={ready ? 'Ready' : 'Not configured'} />
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                {p.kind === 'cli'
                  ? cli?.installed
                    ? cli.version
                    : status && !status.local
                      ? 'Local only'
                      : 'Not installed'
                  : api?.serverKeyConfigured
                    ? 'Server key set'
                    : settings.aiApiKeys?.[p.id]
                      ? 'Key in Settings'
                      : 'Needs key'}
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
        <p className="text-slate-300 leading-relaxed">{info.description}</p>

        {info.kind === 'cli' && (
          <div className="text-[11px] text-slate-400 space-y-1">
            {cliStatus(provider)?.installed ? (
              <p>
                Detected <span className="font-mono text-slate-200">{cliStatus(provider)?.version}</span>. Sign-in is checked on the
                first request; if it fails, run the CLI once in a terminal to log in.
              </p>
            ) : (
              <p>
                Install: <span className="font-mono text-slate-200">{cliStatus(provider)?.install || 'see the CLI docs'}</span>
              </p>
            )}
            <p className="text-amber-300/90">
              Runs on this computer only, with your own CLI account and its usage limits. No images are sent, so Vision QA uses
              the coordinate audit. Follow the CLI provider's terms for automated use.
            </p>
          </div>
        )}

        {provider === 'gemini' ? (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-300">Model</label>
            <select
              value={settings.aiModels?.gemini || settings.geminiModel}
              onChange={(e) =>
                updateSettings({
                  geminiModel: e.target.value as SettingsConfig['geminiModel'],
                  aiModels: { ...settings.aiModels, gemini: e.target.value },
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-xs"
            >
              <option value="gemini-3.8-flash">gemini-3.8-flash (recommended)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (fastest)</option>
              <option value="gemini-flash-latest">gemini-flash-latest</option>
              <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-300">Model (empty = provider default)</label>
            <input
              type="text"
              value={settings.aiModels?.[provider] || ''}
              placeholder={info.modelHint}
              onChange={(e) => updateSettings({ aiModels: { ...settings.aiModels, [provider]: e.target.value } })}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-600"
            />
          </div>
        )}

        {info.needsBaseUrl && (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-300">Base URL</label>
            <input
              type="text"
              value={settings.aiBaseUrl}
              placeholder="https://api.openai.com/v1 · http://localhost:11434/v1"
              onChange={(e) => updateSettings({ aiBaseUrl: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-600"
            />
          </div>
        )}

        {info.needsKey && (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-300">
              API key {apiStatus(provider)?.serverKeyConfigured ? '(optional, server key is set)' : ''}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={settings.aiApiKeys?.[provider] || ''}
              placeholder="Stored in this browser only"
              onChange={(e) => updateSettings({ aiApiKeys: { ...settings.aiApiKeys, [provider]: e.target.value } })}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 font-mono text-xs placeholder-slate-600"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 text-[11px] font-semibold disabled:opacity-60"
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Test connection
          </button>
          {testResult && (
            <span className={`inline-flex items-center gap-1 text-[11px] ${testResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {testResult.ok ? `OK${testResult.model ? ` · ${testResult.model}` : ''} · ${(testResult.ms / 1000).toFixed(1)}s` : testResult.error}
            </span>
          )}
        </div>
      </div>

      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2" data-testid="ai-fallback-order">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-200">Fallback connections</label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
            <input type="checkbox" checked={fallbackOn} onChange={(e) => updateSettings({ aiFallbackEnabled: e.target.checked })} />
            On
          </label>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          If <span className="text-slate-200">{info.label}</span> fails (not set up, not signed in, rate limit, timeout or an
          unusable answer), the director tries these next, in order. A connection that just failed is tried last for a few minutes.
          The chat shows which connection answered.
        </p>
        {order.length === 0 && <p className="text-[11px] text-slate-500">No backups yet — add one below.</p>}
        <ol className="space-y-1">
          {order.map((id, i) => {
            const p = providerInfo(id);
            const ready = providerReady(id, settings, status);
            return (
              <li key={id} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-800 bg-slate-950 ${fallbackOn ? '' : 'opacity-50'}`}>
                <span className="w-4 text-[10px] text-slate-500 font-mono">{i + 1}.</span>
                <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-slate-600'}`} title={ready ? 'Ready' : 'Not configured — will be skipped'} />
                <span className="flex-1 text-[11px] text-slate-100 truncate">
                  {p.label}
                  {settings.aiModels?.[id] ? <span className="font-mono text-slate-500"> · {settings.aiModels[id]}</span> : null}
                </span>
                <button type="button" aria-label={`Move ${p.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="text-slate-400 hover:text-cyan-300 disabled:opacity-30">
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button type="button" aria-label={`Move ${p.label} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="text-slate-400 hover:text-cyan-300 disabled:opacity-30">
                  <ArrowDown className="w-3 h-3" />
                </button>
                <button type="button" aria-label={`Remove ${p.label}`} onClick={() => setOrder(order.filter((x) => x !== id))} className="text-slate-400 hover:text-rose-300">
                  <X className="w-3 h-3" />
                </button>
              </li>
            );
          })}
        </ol>
        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOrder([...order, p.id])}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-700 text-[10px] text-slate-300 hover:border-cyan-500"
                title={providerReady(p.id, settings, status) ? 'Ready' : 'Not configured yet — set it up above first'}
              >
                <Plus className="w-3 h-3" /> {p.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-500">Each backup uses the model, key and base URL you set for it above (select it to edit).</p>
      </div>
    </div>
  );
};
