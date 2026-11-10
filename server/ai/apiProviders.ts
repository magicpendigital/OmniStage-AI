/**
 * Phase 6 — API-key providers: Gemini, Anthropic (official SDK), OpenAI-compatible and OpenRouter (/chat/completions).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ApiProviderId, GenerateRequest, GenerateResult, ProviderConfig } from './types';
import { ProviderUnavailableError } from './types';

export const DEFAULT_MODELS: Record<ApiProviderId, string> = {
  gemini: 'gemini-3.8-flash',
  anthropic: 'claude-opus-5-5',
  openrouter: 'anthropic/claude-sonnet-5.5',
  'openai-compatible': 'gpt-5',
};

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function keyFor(cfg: ProviderConfig): string | undefined {
  const fromHeader = cfg.apiKey?.trim();
  if (fromHeader) return fromHeader;
  switch (cfg.provider) {
    case 'gemini': {
      const k = process.env.GEMINI_API_KEY;
      return k && k !== 'MY_GEMINI_API_KEY' ? k : undefined;
    }
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || undefined;
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY || undefined;
    case 'openai-compatible':
      return process.env.OPENAI_API_KEY || undefined;
    default:
      return undefined;
  }
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(cfg: ProviderConfig, req: GenerateRequest): Promise<GenerateResult> {
  const apiKey = keyFor(cfg);
  if (!apiKey) throw new ProviderUnavailableError('Gemini API key not configured (Settings → AI or GEMINI_API_KEY).');
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  const model = cfg.model || DEFAULT_MODELS.gemini;
  const parts: any[] = [];
  if (req.image) parts.push({ inlineData: { mimeType: req.image.mimeType, data: req.image.base64 } });
  parts.push({ text: req.user });
  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: { systemInstruction: req.system, responseMimeType: 'application/json' },
  });
  return { text: response.text ?? '', provider: 'gemini', model };
}

/**
 * Anthropic via the official SDK. Streams (long SceneSpec outputs) and collects the final message.
 * Server-side refusal fallbacks are enabled by default ("default" routing) so a policy decline is retried on a
 * fallback model inside the same call.
 */
async function callAnthropic(cfg: ProviderConfig, req: GenerateRequest): Promise<GenerateResult> {
  const apiKey = keyFor(cfg);
  if (!apiKey) throw new ProviderUnavailableError('Anthropic API key not configured (Settings → AI or ANTHROPIC_API_KEY).');
  const client = new Anthropic({ apiKey, timeout: req.timeoutMs ?? 300_000 });
  const model = cfg.model || DEFAULT_MODELS.anthropic;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: req.image.mimeType as 'image/png' | 'image/jpeg', data: req.image.base64 },
    });
  }
  content.push({ type: 'text', text: req.user });
  const message = await client.beta.messages
    .stream({
      model,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: req.system,
      messages: [{ role: 'user', content }],
    })
    .finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error(`Anthropic declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`);
  }
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { text, provider: 'anthropic', model: message.model || model };
}

/** OpenAI Chat Completions shape — used for OpenAI, OpenRouter, Ollama, LM Studio, vLLM, Groq, DeepSeek... */
async function callChatCompletions(cfg: ProviderConfig, req: GenerateRequest): Promise<GenerateResult> {
  const isOpenRouter = cfg.provider === 'openrouter';
  const base = (isOpenRouter ? OPENROUTER_BASE : cfg.baseUrl?.trim() || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL must start with http:// or https://');
  const apiKey = keyFor(cfg);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(base + '/');
  if (!apiKey && !isLocal) {
    throw new ProviderUnavailableError(`${isOpenRouter ? 'OpenRouter' : 'OpenAI-compatible'} API key not configured.`);
  }
  const model = cfg.model || DEFAULT_MODELS[cfg.provider as ApiProviderId];
  const userContent: any = req.image
    ? [
        { type: 'image_url', image_url: { url: `data:${req.image.mimeType};base64,${req.image.base64}` } },
        { type: 'text', text: req.user },
      ]
    : req.user;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (isOpenRouter) headers['X-Title'] = 'OmniStage';
  const body = {
    model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  };
  const json = await withTimeout(req.timeoutMs ?? 300_000, async (signal) => {
    let res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (res.status === 400) {
      // Some OpenAI-compatible servers reject response_format; retry once without it.
      const { response_format: _drop, ...plain } = body;
      res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(plain), signal });
    }
    if (!res.ok) throw new Error(`${base} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<any>;
  });
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('Chat completion returned no message content');
  return { text, provider: cfg.provider, model: json.model || model };
}

export async function callApiProvider(cfg: ProviderConfig, req: GenerateRequest): Promise<GenerateResult> {
  switch (cfg.provider) {
    case 'gemini':
      return callGemini(cfg, req);
    case 'anthropic':
      return callAnthropic(cfg, req);
    case 'openrouter':
    case 'openai-compatible':
      return callChatCompletions(cfg, req);
    default:
      throw new Error(`Not an API provider: ${cfg.provider}`);
  }
}

export function apiProviderConfigured(cfg: ProviderConfig): boolean {
  if (cfg.provider === 'openai-compatible' && /localhost|127\.0\.0\.1/.test(cfg.baseUrl || '')) return true;
  return !!keyFor(cfg);
}
