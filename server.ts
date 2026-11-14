import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerAssetHubRoutes } from './server/assetHubProxy.ts';
import { aiErrorStatus, generateJSON, registerAiRoutes } from './server/ai/index.ts';
import { registerWorkspaceRoutes } from './server/workspace/routes.ts';
import { registerPlayRoutes } from './server/play/playSessions.ts';
import { registerElevenLabsRoutes } from './server/media/elevenLabs.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Prompt builders are imported lazily so the port binds before the agent modules load. */
const loadPrompts = () => import('./src/agent/systemPrompts.ts');

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // 0. Bind port 3000 immediately on startup so health checks succeed in <200ms
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'omnistage-ai-studio' });
  });

  // Phase 6: provider status + connection test (Gemini, OpenAI-compatible, OpenRouter, Anthropic, local CLIs)
  registerAiRoutes(app);

  // Phase 6: local workspace (projects, games, personal/project libraries, extensions, memory) — localhost only
  registerWorkspaceRoutes(app);

  // Phase 6 batch 2: Play on phone (token-gated read-only /play/:token over the LAN)
  registerPlayRoutes(app);

  // Phase 10D: paid production tools with the creator's own key (ElevenLabs voice / SFX / music)
  registerElevenLabsRoutes(app);

  const fail = (res: express.Response, route: string, error: any) => {
    const status = aiErrorStatus(error);
    if (status === 500) console.error(`Error in ${route}:`, error?.message || error);
    res.status(status).json({ error: error?.message || `${route} failed` });
  };

  // 1. Conversational SceneSpec Mutation Endpoint
  app.post('/api/agent/mutate', async (req, res) => {
    try {
      const { prompt, sceneSpec, model, customSystemPrompt } = req.body ?? {};
      const { buildAgentSystemPrompt } = await loadPrompts();
      const { data, meta } = await generateJSON(
        req,
        {
          system: buildAgentSystemPrompt(customSystemPrompt),
          user: `USER INSTRUCTION: "${prompt}"

CURRENT SCENESPEC JSON:
${JSON.stringify(sceneSpec, null, 2)}

Return a JSON object with:
{
  "assistantMessage": "string explaining what was updated in the 3D/2D scene",
  "diffSummary": ["bullet 1", "bullet 2"],
  "updatedSceneSpec": { ...complete valid SceneSpec object... }
}`,
        },
        model
      );
      res.json({ ...data, provider: meta.provider, model: meta.model, fallbackNote: meta.fallbackNote });
    } catch (error: any) {
      fail(res, '/api/agent/mutate', error);
    }
  });

  // 1a. Phase 7C: one round of the JSON Patch tool-use loop. The studio applies the patch, verifies, and calls again
  // with the verifier's TOOL RESULT until the scene passes (src/agent/patchLoop.ts).
  app.post('/api/agent/patch', async (req, res) => {
    try {
      const { prompt, sceneSpec, toolResults, round, model, customSystemPrompt } = req.body ?? {};
      if (!sceneSpec || !Array.isArray(sceneSpec.actors)) {
        res.status(400).json({ error: 'sceneSpec is required' });
        return;
      }
      const { buildAgentSystemPrompt } = await loadPrompts();
      const { buildPatchUserPrompt } = await import('./src/agent/patchLoop.ts');
      const { data, meta } = await generateJSON(
        req,
        {
          system: buildAgentSystemPrompt(customSystemPrompt, 'patch'),
          user: buildPatchUserPrompt({ prompt: String(prompt ?? ''), spec: sceneSpec, round: Number(round) || 0, toolResults: Array.isArray(toolResults) ? toolResults : [] }),
        },
        model
      );
      res.json({ ...data, provider: meta.provider, model: meta.model, fallbackNote: meta.fallbackNote });
    } catch (error: any) {
      fail(res, '/api/agent/patch', error);
    }
  });

  // 1b. Multi-Step Storyboard — STEP 1: plan N beats (film shots / game levels)
  app.post('/api/agent/storyboard/plan', async (req, res) => {
    try {
      const { prompt, intent, model, customSystemPrompt } = req.body ?? {};
      const { buildStoryboardPlannerSystemPrompt } = await loadPrompts();
      const count = Math.max(2, Math.min(8, Number(intent?.sceneCount) || 3));
      const { data } = await generateJSON(
        req,
        {
          system: buildStoryboardPlannerSystemPrompt(customSystemPrompt),
          user: `USER REQUEST: "${String(prompt ?? '').slice(0, 2000)}"

Detected intent: ${JSON.stringify({ sceneCount: count, kind: intent?.kind, engineType: intent?.engineType })}
Plan EXACTLY ${count} beats.`,
        },
        model
      );
      res.json(data);
    } catch (error: any) {
      fail(res, '/api/agent/storyboard/plan', error);
    }
  });

  // 1c. Multi-Step Storyboard — STEP 2: author one complete SceneSpec per beat (called sequentially)
  app.post('/api/agent/storyboard/scene', async (req, res) => {
    try {
      const { prompt, storyboardTitle, kind, beatIndex, total, beat, previousScenes, model, customSystemPrompt } =
        req.body ?? {};
      if (!beat || typeof beat.title !== 'string') {
        res.status(400).json({ error: 'beat is required' });
        return;
      }
      const { buildAgentSystemPrompt, buildStoryboardSceneRules, buildStoryboardSceneUserPrompt } = await loadPrompts();
      const { data: parsed } = await generateJSON(
        req,
        {
          system: buildAgentSystemPrompt(customSystemPrompt) + buildStoryboardSceneRules(),
          user: buildStoryboardSceneUserPrompt({
            prompt: String(prompt ?? '').slice(0, 2000),
            storyboardTitle: String(storyboardTitle ?? 'Storyboard'),
            kind: String(kind ?? 'film'),
            beatIndex: Number(beatIndex) || 0,
            total: Number(total) || 1,
            beat,
            previousScenes: Array.isArray(previousScenes) ? previousScenes.slice(-8) : [],
          }),
        },
        model
      );
      // Accept either { sceneSpec } or { updatedSceneSpec } from the model
      res.json({ assistantMessage: parsed.assistantMessage, sceneSpec: parsed.sceneSpec ?? parsed.updatedSceneSpec ?? null });
    } catch (error: any) {
      fail(res, '/api/agent/storyboard/scene', error);
    }
  });

  // Phase 6: AI drafts an extension from a description (returned for review — never installed here)
  app.post('/api/agent/extension/draft', async (req, res) => {
    try {
      const { prompt, engineType, mode } = req.body ?? {};
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }
      const { buildExtensionDraftSystemPrompt } = await loadPrompts();
      const { data } = await generateJSON(req, {
        system: buildExtensionDraftSystemPrompt(),
        user: `Creator request: "${prompt.slice(0, 2000)}"\nCurrent scene: engine ${engineType || '2d'}, mode ${mode || 'game'}.`,
      });
      res.json({ manifest: data });
    } catch (error: any) {
      fail(res, '/api/agent/extension/draft', error);
    }
  });

  // Phase 6: AI plain-language review of an extension before the user approves it
  app.post('/api/agent/extension/review', async (req, res) => {
    try {
      const { manifest, language } = req.body ?? {};
      const { buildExtensionReviewSystemPrompt } = await loadPrompts();
      const { mainSource, ...rest } = manifest || {};
      const { data } = await generateJSON(req, {
        system: buildExtensionReviewSystemPrompt(),
        user: `Answer in ${language === 'vi' ? 'Vietnamese' : 'English'}.\nMANIFEST:\n${JSON.stringify(rest, null, 2).slice(0, 20000)}\n\nSCRIPT:\n${String(mainSource || '(none)').slice(0, 40000)}`,
      });
      res.json({ aiRisk: ['low', 'medium', 'high'].includes(data?.aiRisk) ? data.aiRisk : 'medium', aiSummary: String(data?.aiSummary || '').slice(0, 1500) });
    } catch (error: any) {
      fail(res, '/api/agent/extension/review', error);
    }
  });

  // 1d. Online Asset Hub proxy (Poly Pizza / Sketchfab / Poly Haven) — CORS-free model & HDRI loading
  registerAssetHubRoutes(app);

  // 2. Multimodal Vision QA Endpoint (CLI providers get the coordinates/SceneSpec audit without the image)
  app.post('/api/agent/vision-qa', async (req, res) => {
    try {
      const { screenshotDataUrl, actorCoordinates, sceneSpec, mode, keyframes } = req.body ?? {};
      if (!screenshotDataUrl) {
        res.status(503).json({ error: 'Vision QA fallback active' });
        return;
      }
      // Phase 10D: director QA — a contact sheet of rendered keyframes of a film shot, scored like dailies.
      if (mode === 'director') {
        if (!sceneSpec || !Array.isArray(sceneSpec.actors) || !Array.isArray(keyframes) || !keyframes.length) {
          res.status(400).json({ error: 'sceneSpec and keyframes are required' });
          return;
        }
        const qa = await import('./src/agent/directorQA.ts');
        const frames = keyframes.slice(0, 8).map((k: any) => ({
          time: Number(k?.time) || 0,
          label: String(k?.label ?? '').slice(0, 80),
          ...(Number.isInteger(k?.shotIndex) ? { shotIndex: k.shotIndex } : {}),
        }));
        const match = /^data:(image\/\w+);base64,/.exec(String(screenshotDataUrl));
        const { data, meta } = await generateJSON(req, {
          system: qa.buildDirectorQASystemPrompt(),
          image: { mimeType: match?.[1] || 'image/jpeg', base64: String(screenshotDataUrl).replace(/^data:image\/\w+;base64,/, '') },
          user: qa.buildDirectorQAUserPrompt(sceneSpec, frames),
          requireVision: true,
          timeoutMs: 180_000,
        });
        const report = qa.normalizeDirectorQAReport(data, frames);
        if (!report) {
          res.status(502).json({ error: 'The vision model returned no director score' });
          return;
        }
        res.json({ ...report, provider: meta.provider, model: meta.model });
        return;
      }
      const { buildVisionQASystemPrompt } = await loadPrompts();
      const match = /^data:(image\/\w+);base64,/.exec(String(screenshotDataUrl));
      const { data } = await generateJSON(req, {
        system: buildVisionQASystemPrompt(),
        image: { mimeType: match?.[1] || 'image/png', base64: String(screenshotDataUrl).replace(/^data:image\/\w+;base64,/, '') },
        user: `Inspect this viewport screenshot, the Actor World Coordinates & Bounding Boxes summary:
${JSON.stringify(actorCoordinates || [], null, 2)}

and the full SceneSpec JSON:
${JSON.stringify(sceneSpec, null, 2)}

Detect any overlapping objects, off-frame cameras, ungrounded actors, or low-contrast lighting, and return a JSON object with:
{
  "overallScore": 88,
  "summary": "Diagnostic summary of framing, actor spacing, and lighting contrast",
  "issues": [
    {
      "id": "issue-1",
      "severity": "high",
      "category": "framing",
      "title": "Short issue title",
      "description": "Detailed spatial explanation",
      "suggestedFixSummary": "Concise action taken in proposedSceneSpec"
    }
  ],
  "proposedSceneSpec": { ...complete corrected SceneSpec JSON... }
}`,
      });
      res.json(data);
    } catch (error: any) {
      fail(res, '/api/agent/vision-qa', error);
    }
  });

  // `npm start` passes --prod (cross-platform; no NODE_ENV syntax needed on Windows) and serves the built dist/.
  const production = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
  if (!production) {
    let viteInstance: any = null;
    const viteInitPromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      viteInstance = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
          watch: process.env.DISABLE_HMR === 'true' ? null : {},
        },
        appType: 'spa',
      });
      return viteInstance;
    })();

    app.use(async (req, res, next) => {
      if (viteInstance) {
        viteInstance.middlewares(req, res, next);
        return;
      }
      // If control-plane health check hits '/' while Vite is still booting in the first ~800ms,
      // respond immediately with 200 OK if it's a HEAD request, or await Vite for asset requests.
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      try {
        const v = await viteInitPromise;
        v.middlewares(req, res, next);
      } catch (err) {
        const indexHtml = path.join(__dirname, 'index.html');
        if (fs.existsSync(indexHtml)) {
          res.sendFile(indexHtml);
        } else {
          next(err);
        }
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

startServer();
