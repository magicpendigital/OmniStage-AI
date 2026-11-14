/**
 * Phase 6 — Client side of the provider layer: turns Settings → AI into the request headers the local server
 * reads (x-ai-provider / x-ai-model / x-ai-key / x-ai-base-url). Every /api/agent/* call goes through here.
 */
import type { AIProviderId, SettingsConfig } from '../types/scene.schema';

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  kind: 'api' | 'cli';
  needsKey: boolean;
  needsBaseUrl?: boolean;
  modelHint: string;
  vision: boolean;
  description: string;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', kind: 'api', needsKey: true, modelHint: 'gemini-3.8-flash', vision: true, description: 'Default. Key from Google AI Studio, or GEMINI_API_KEY on the server.' },
  { id: 'anthropic', label: 'Anthropic Claude', kind: 'api', needsKey: true, modelHint: 'claude-opus-5-5', vision: true, description: 'Official SDK, adaptive thinking, refusal fallback enabled.' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'api', needsKey: true, modelHint: 'anthropic/claude-sonnet-5.5', vision: true, description: 'One key, hundreds of models (provider/model ids).' },
  { id: 'openai-compatible', label: 'OpenAI-compatible', kind: 'api', needsKey: true, needsBaseUrl: true, modelHint: 'gpt-5', vision: true, description: 'OpenAI, Ollama, LM Studio, vLLM, Groq, DeepSeek… any /chat/completions endpoint. Local URLs need no key.' },
  { id: 'cli-claude', label: 'Claude Code (CLI)', kind: 'cli', needsKey: false, modelHint: 'sonnet', vision: false, description: 'Uses the Claude Code CLI signed in on this computer.' },
  { id: 'cli-codex', label: 'Codex CLI', kind: 'cli', needsKey: false, modelHint: 'gpt-5-codex', vision: false, description: 'Uses `codex exec` signed in on this computer.' },
  { id: 'cli-antigravity', label: 'Antigravity CLI', kind: 'cli', needsKey: false, modelHint: 'see `agy models`', vision: false, description: 'Uses the Google Antigravity CLI (`agy`) signed in on this computer.' },
  { id: 'cli-opencode', label: 'OpenCode (CLI)', kind: 'cli', needsKey: false, modelHint: 'opencode/big-pickle', vision: false, description: 'Uses `opencode run` with any model configured in OpenCode (provider/model).' },
];

export function providerInfo(id: AIProviderId): AIProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}

type AISettings = Pick<SettingsConfig, 'aiProvider' | 'aiModels' | 'aiApiKeys' | 'aiBaseUrl' | 'geminiModel'>;

export function effectiveModel(settings: AISettings): string {
  const explicit = settings.aiModels?.[settings.aiProvider]?.trim();
  if (explicit) return explicit;
  return settings.aiProvider === 'gemini' ? settings.geminiModel : '';
}

/** Headers for /api/agent/* and /api/ai/test. Values are never logged by the server. */
export function aiHeaders(settings: AISettings): Record<string, string> {
  const provider = settings.aiProvider || 'gemini';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-ai-provider': provider };
  const model = effectiveModel(settings);
  if (model) headers['x-ai-model'] = model;
  const key = settings.aiApiKeys?.[provider]?.trim();
  if (key) headers['x-ai-key'] = key;
  if (provider === 'openai-compatible' && settings.aiBaseUrl?.trim()) headers['x-ai-base-url'] = settings.aiBaseUrl.trim();
  return headers;
}

export function providerLabel(settings: AISettings): string {
  const info = providerInfo(settings.aiProvider || 'gemini');
  const model = effectiveModel(settings);
  return model ? `${info.label} · ${model}` : info.label;
}

export interface ProviderStatusResponse {
  local: boolean;
  api: Array<{ id: AIProviderId; defaultModel: string; serverKeyConfigured: boolean }>;
  cli: Array<{ id: AIProviderId; label: string; installed: boolean; version?: string; install: string; available: boolean }>;
}

export async function fetchProviderStatus(refresh = false): Promise<ProviderStatusResponse | null> {
  try {
    const res = await fetch(`/api/ai/providers${refresh ? '?refresh=1' : ''}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function testProviderConnection(settings: AISettings): Promise<{ ok: boolean; error?: string; model?: string; ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch('/api/ai/test', { method: 'POST', headers: aiHeaders(settings), body: '{}' });
    const json = await res.json().catch(() => ({}));
    return { ok: !!json.ok, error: json.error, model: json.model, ms: json.ms ?? Date.now() - started };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error', ms: Date.now() - started };
  }
}
