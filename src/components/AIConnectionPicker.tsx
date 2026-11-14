import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { AIProviderId } from '../types/scene.schema';
import { AI_PROVIDERS, fallbackChain, fetchProviderStatus, modelFor, providerInfo, providerReady, ProviderStatusResponse } from '../agent/aiClient';

/**
 * Phase 6 — connection picker under the AI Director prompt: choose which connection (API or local CLI) and model answers the
 * next message, and see / toggle the fallback chain that takes over when it fails. Changes are saved to Settings → AI.
 */
export const AIConnectionPicker: React.FC = () => {
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const [status, setStatus] = useState<ProviderStatusResponse | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProviderStatus(false).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  const provider = settings.aiProvider || 'gemini';
  const info = providerInfo(provider);
  const chain = fallbackChain(settings);
  const fallbackOn = settings.aiFallbackEnabled !== false;
  const cooling = (id: AIProviderId) => status?.health?.find((h) => h.provider === id);

  const setModel = (value: string) => {
    if (provider === 'gemini') updateSettings({ aiModels: { ...settings.aiModels, gemini: value } });
    else updateSettings({ aiModels: { ...settings.aiModels, [provider]: value } });
  };

  const chainTitle = !fallbackOn
    ? 'Fallback is off: if this connection fails, the offline director answers.'
    : chain.length
      ? `If ${info.label} fails, try: ${chain.map((c, i) => `${i + 1}. ${providerInfo(c.provider).label}${c.model ? ` · ${c.model}` : ''}`).join(', ')}. Edit the order in Settings → AI.`
      : 'Fallback is on but no backup connection is set. Add some in Settings → AI.';

  return (
    <div className="flex items-center gap-1.5" data-testid="ai-connection-picker">
      <select
        className="field sm min-w-0 flex-[1.4]"
        aria-label="AI connection for this chat"
        title="Connection that answers your next message"
        value={provider}
        onChange={(e) => updateSettings({ aiProvider: e.target.value as AIProviderId })}
      >
        {AI_PROVIDERS.map((p) => {
          const ready = providerReady(p.id, settings, status);
          const cool = cooling(p.id);
          return (
            <option key={p.id} value={p.id}>
              {ready ? '● ' : '○ '}
              {p.label}
              {cool ? ` (cooling down: ${cool.kind})` : ready ? '' : status ? ' (not set up)' : ''}
            </option>
          );
        })}
      </select>
      <input
        className="field sm min-w-0 flex-1 font-mono"
        aria-label="Model for this connection"
        title="Model id (empty = provider default)"
        value={provider === 'gemini' ? modelFor(settings, 'gemini') : settings.aiModels?.[provider] || ''}
        placeholder={info.modelHint}
        onChange={(e) => setModel(e.target.value)}
      />
      <button
        type="button"
        className={`chip shrink-0 ${fallbackOn && chain.length ? 'text-emerald-300' : ''}`}
        title={chainTitle}
        aria-pressed={fallbackOn}
        aria-label={`Fallback ${fallbackOn ? 'on' : 'off'}`}
        onClick={() => updateSettings({ aiFallbackEnabled: !fallbackOn })}
      >
        {fallbackOn ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
        <span className="ml-1">{fallbackOn ? `+${chain.length}` : 'off'}</span>
      </button>
    </div>
  );
};
