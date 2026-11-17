/**
 * Phase 11B — client side of the Writers' Room: turns a RoomAskRequest into the call to /api/agent/storyboard/room with the
 * user's AI connection headers. The Script editor is meant to be an independent second opinion, so it runs on the first backup
 * connection when the user configured one (Settings → AI → fallback chain), and says so in the UI when it cannot.
 */
import { aiHeaders, fallbackChain, providerInfo } from './aiClient';
import type { RoomAsk, RoomAskRequest } from './writersRoom';
import type { SettingsConfig } from '../types/scene.schema';

export type RoomSettings = Pick<SettingsConfig, 'geminiModel' | 'customSystemPrompt' | 'aiProvider' | 'aiModels' | 'aiApiKeys' | 'aiBaseUrl' | 'aiFallbackEnabled' | 'aiFallbackOrder'>;

/** Settings whose primary connection is the first backup (so the editor is not the writer's own model). */
export function secondOpinionSettings<T extends RoomSettings>(settings: T): { settings: T; independent: boolean; label: string } {
  const chain = fallbackChain(settings);
  const primary = settings.aiProvider || 'gemini';
  const other = chain[0];
  if (!other) return { settings, independent: false, label: providerInfo(primary).label };
  const next: T = {
    ...settings,
    aiProvider: other.provider,
    aiModels: { ...(settings.aiModels || {}), ...(other.model ? { [other.provider]: other.model } : {}) },
    aiApiKeys: { ...(settings.aiApiKeys || {}), ...(other.apiKey ? { [other.provider]: other.apiKey } : {}) },
    aiFallbackOrder: [primary, ...(settings.aiFallbackOrder || []).filter((id) => id !== primary && id !== other.provider)],
  };
  return { settings: next, independent: true, label: providerInfo(other.provider).label };
}

export function makeRoomAsk(settings: RoomSettings, signal?: AbortSignal): RoomAsk {
  return async (req: RoomAskRequest) => {
    const response = await fetch('/api/agent/storyboard/room', {
      method: 'POST',
      headers: aiHeaders(settings),
      body: JSON.stringify({ ...req, model: settings.geminiModel, customSystemPrompt: settings.customSystemPrompt }),
      signal,
    });
    if (!response.ok) throw new Error(`room returned ${response.status}`);
    return response.json();
  };
}
