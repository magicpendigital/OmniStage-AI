/**
 * Phase 4 (Director D) — POST /api/agent/tools: the native tool-use edit loop for the Anthropic API provider.
 *
 * Same conventions as /api/agent/patch: provider and key come from the x-ai-* headers (or env), the system prompt comes from
 * `buildAgentSystemPrompt(custom, 'tools')`, errors map through `aiErrorStatus` (503 = no connection configured).
 * Extra statuses the studio maps:
 *   400  sceneSpec missing
 *   501  tool mode is not available for this connection (primary is not the Anthropic API, or has no key): the studio uses the patch loop
 *   500  any other failure of the loop: the studio falls back to the patch loop and says so
 * Agent modules load lazily (like the other routes) so the port binds first. Keys are never logged or echoed.
 */
import type { Express } from 'express';
import { aiErrorStatus, resolveProviderConfig } from './index';
import { resolveToolLoopConnection } from './toolLoop';

/** Caps for client-supplied lists. */
const MAX_SCENES = 30;
const MAX_EXTRA_ASSETS = 80;
/** Hard wall-clock limit for the whole loop (each model call has its own 5 minute timeout). */
const LOOP_DEADLINE_MS = 10 * 60_000;

function cleanString(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

/** Extra searchable assets from the studio (personal library / hub names). Anything malformed is dropped. */
export function sanitizeExtraAssets(raw: unknown): Array<{ id: string; name: string; kind: any; category?: string; clips?: string[]; tags?: string[]; url?: string; source?: string }> {
  if (!Array.isArray(raw)) return [];
  const kinds = ['3d', '2d-preset', 'particle', 'sfx', 'image', 'audio', 'hdri'];
  const out: ReturnType<typeof sanitizeExtraAssets> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = cleanString((item as any).id, 160);
    const name = cleanString((item as any).name, 160);
    const kind = kinds.includes((item as any).kind) ? (item as any).kind : '3d';
    if (!id || !name) continue;
    const url = cleanString((item as any).url, 400);
    out.push({
      id,
      name,
      kind,
      category: cleanString((item as any).category, 60),
      clips: Array.isArray((item as any).clips) ? (item as any).clips.map((c: unknown) => cleanString(c, 60)).filter(Boolean).slice(0, 24) : undefined,
      tags: Array.isArray((item as any).tags) ? (item as any).tags.map((c: unknown) => cleanString(c, 40)).filter(Boolean).slice(0, 12) : undefined,
      // Only library-served or https urls are kept; the model is told to reuse them verbatim.
      url: url && (/^https:\/\//i.test(url) || url.startsWith('/')) ? url : undefined,
      source: cleanString((item as any).source, 40) || 'library',
    });
    if (out.length >= MAX_EXTRA_ASSETS) break;
  }
  return out;
}

export function registerToolRoutes(app: Express) {
  app.post('/api/agent/tools', async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    let secret: string | undefined;
    try {
      const { prompt, sceneSpec, scenes, customSystemPrompt, extraAssets, model } = req.body ?? {};
      if (!sceneSpec || !Array.isArray(sceneSpec.actors)) {
        res.status(400).json({ error: 'sceneSpec is required' });
        return;
      }
      const primary = resolveProviderConfig(req, model);
      const conn = resolveToolLoopConnection(primary);
      if (!conn) {
        res.status(501).json({
          error: 'Tool use needs the Anthropic API (with a key) as the primary AI connection. Use the JSON patch edit mode instead.',
          toolsUnavailable: true,
        });
        return;
      }
      secret = conn.apiKey;
      const [{ buildAgentSystemPrompt }, { SceneToolbox }, { createAnthropicToolClient, runToolLoop }] = await Promise.all([
        import('../../src/agent/systemPrompts'),
        import('../../src/agent/tools/sceneTools'),
        import('./toolLoop'),
      ]);
      const toolbox = new SceneToolbox(sceneSpec, {
        scenes: Array.isArray(scenes) ? scenes.filter((s: any) => s && typeof s === 'object' && typeof s.id === 'string').slice(0, MAX_SCENES) : undefined,
        assets: sanitizeExtraAssets(extraAssets),
      });
      const result = await runToolLoop({
        client: createAnthropicToolClient(conn.apiKey),
        model: conn.model,
        system: buildAgentSystemPrompt(typeof customSystemPrompt === 'string' ? customSystemPrompt : undefined, 'tools'),
        userPrompt: toolbox.buildUserPrompt(String(prompt ?? '')),
        toolbox,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(LOOP_DEADLINE_MS)]),
      });
      const usedModel = result.model || conn.model;
      res.setHeader('x-ai-used-provider', 'anthropic');
      res.setHeader('x-ai-used-model', encodeURIComponent(usedModel));
      res.json({
        updatedSceneSpec: result.spec,
        report: result.report,
        assistantMessage: result.assistantMessage,
        diffSummary: result.diffSummary,
        transcript: result.transcript,
        fixes: result.fixes,
        notes: result.notes,
        changed: result.changed,
        stopped: result.stopped,
        turns: result.turns,
        toolCalls: result.toolCalls,
        usage: result.usage,
        provider: 'anthropic',
        model: usedModel,
      });
    } catch (error: any) {
      if (abort.signal.aborted) return; // the client went away (Stop button)
      const status = aiErrorStatus(error);
      let message: string = error?.message || '/api/agent/tools failed';
      if (secret) message = message.split(secret).join('[key]');
      if (status === 500) console.error('Error in /api/agent/tools:', message);
      if (!res.headersSent) res.status(status).json({ error: message });
    }
  });
}
