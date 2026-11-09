import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerAssetHubRoutes } from './server/assetHubProxy.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Prompt builders are imported lazily so the port binds before the agent modules load. */
const loadPrompts = () => import('./src/agent/systemPrompts.ts');

const SUPPORTED_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
]);
const DEFAULT_MODEL = 'gemini-3.8-flash';

function resolveModel(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_MODELS.has(requested) ? requested : DEFAULT_MODEL;
}

/** Gemini JSON mode occasionally wraps output in ```json fences; strip them before parsing. */
function parseModelJSON(raw: string | undefined): any {
  const text = (raw ?? '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(text);
}

async function getGenAIClient(overrideKey?: string) {
  const apiKey = (overrideKey && overrideKey.trim()) || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

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

  // 1. Conversational SceneSpec Mutation Endpoint
  app.post('/api/agent/mutate', async (req, res) => {
    try {
      const { prompt, sceneSpec, model, customSystemPrompt } = req.body;
      const headerKey = req.headers['x-ai-key'] as string | undefined;
      const headerModel = req.headers['x-ai-model'] as string | undefined;
      const ai = await getGenAIClient(headerKey);
      if (!ai) {
        res
          .status(503)
          .json({ error: 'Gemini API key not configured on server; using studio fallback.' });
        return;
      }

      const { buildAgentSystemPrompt } = await loadPrompts();

      // A model chosen in Settings (x-ai-model header) wins over the request body.
      const selectedModel = resolveModel(headerModel || model);

      const userPrompt = `USER INSTRUCTION: "${prompt}"

CURRENT SCENESPEC JSON:
${JSON.stringify(sceneSpec, null, 2)}

Return a JSON object with:
{
  "assistantMessage": "string explaining what was updated in the 3D/2D scene",
  "diffSummary": ["bullet 1", "bullet 2"],
  "updatedSceneSpec": { ...complete valid SceneSpec object... }
}`;

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: userPrompt,
        config: {
          systemInstruction: buildAgentSystemPrompt(customSystemPrompt),
          responseMimeType: 'application/json',
        },
      });

      res.json(parseModelJSON(response.text));
    } catch (error: any) {
      console.error('Error in /api/agent/mutate:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Agent mutation failed' });
    }
  });

  // 1b. Multi-Step Storyboard — STEP 1: plan N beats (film shots / game levels)
  app.post('/api/agent/storyboard/plan', async (req, res) => {
    try {
      const { prompt, intent, model, customSystemPrompt } = req.body ?? {};
      const headerKey = req.headers['x-ai-key'] as string | undefined;
      const headerModel = req.headers['x-ai-model'] as string | undefined;
      const ai = await getGenAIClient(headerKey);
      if (!ai) {
        res.status(503).json({ error: 'Gemini API key not configured on server; using studio fallback.' });
        return;
      }
      const { buildStoryboardPlannerSystemPrompt } = await loadPrompts();
      const count = Math.max(2, Math.min(8, Number(intent?.sceneCount) || 3));
      const response = await ai.models.generateContent({
        model: resolveModel(headerModel || model),
        contents: `USER REQUEST: "${String(prompt ?? '').slice(0, 2000)}"

Detected intent: ${JSON.stringify({ sceneCount: count, kind: intent?.kind, engineType: intent?.engineType })}
Plan EXACTLY ${count} beats.`,
        config: {
          systemInstruction: buildStoryboardPlannerSystemPrompt(customSystemPrompt),
          responseMimeType: 'application/json',
        },
      });
      res.json(parseModelJSON(response.text));
    } catch (error: any) {
      console.error('Error in /api/agent/storyboard/plan:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Storyboard planning failed' });
    }
  });

  // 1c. Multi-Step Storyboard — STEP 2: author one complete SceneSpec per beat (called sequentially)
  app.post('/api/agent/storyboard/scene', async (req, res) => {
    try {
      const { prompt, storyboardTitle, kind, beatIndex, total, beat, previousScenes, model, customSystemPrompt } =
        req.body ?? {};
      const headerKey = req.headers['x-ai-key'] as string | undefined;
      const headerModel = req.headers['x-ai-model'] as string | undefined;
      const ai = await getGenAIClient(headerKey);
      if (!ai) {
        res.status(503).json({ error: 'Gemini API key not configured on server; using studio fallback.' });
        return;
      }
      if (!beat || typeof beat.title !== 'string') {
        res.status(400).json({ error: 'beat is required' });
        return;
      }
      const { buildAgentSystemPrompt, buildStoryboardSceneRules, buildStoryboardSceneUserPrompt } =
        await loadPrompts();
      const response = await ai.models.generateContent({
        model: resolveModel(headerModel || model),
        contents: buildStoryboardSceneUserPrompt({
          prompt: String(prompt ?? '').slice(0, 2000),
          storyboardTitle: String(storyboardTitle ?? 'Storyboard'),
          kind: String(kind ?? 'film'),
          beatIndex: Number(beatIndex) || 0,
          total: Number(total) || 1,
          beat,
          previousScenes: Array.isArray(previousScenes) ? previousScenes.slice(-8) : [],
        }),
        config: {
          systemInstruction: buildAgentSystemPrompt(customSystemPrompt) + buildStoryboardSceneRules(),
          responseMimeType: 'application/json',
        },
      });
      const parsed = parseModelJSON(response.text);
      // Accept either { sceneSpec } or { updatedSceneSpec } from the model
      res.json({
        assistantMessage: parsed.assistantMessage,
        sceneSpec: parsed.sceneSpec ?? parsed.updatedSceneSpec ?? null,
      });
    } catch (error: any) {
      console.error('Error in /api/agent/storyboard/scene:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Storyboard scene generation failed' });
    }
  });

  // 1d. Online Asset Hub proxy (Poly Pizza / Sketchfab / Poly Haven) — CORS-free model & HDRI loading
  registerAssetHubRoutes(app);

  // 2. Multimodal Vision QA Endpoint
  app.post('/api/agent/vision-qa', async (req, res) => {
    try {
      const { screenshotDataUrl, actorCoordinates, sceneSpec } = req.body;
      const headerKey = req.headers['x-ai-key'] as string | undefined;
      const ai = await getGenAIClient(headerKey);
      if (!ai || !screenshotDataUrl) {
        res.status(503).json({ error: 'Vision QA fallback active' });
        return;
      }

      const { buildVisionQASystemPrompt } = await import('./src/agent/systemPrompts.ts');
      const base64Data = String(screenshotDataUrl).replace(/^data:image\/\w+;base64,/, '');

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: base64Data,
              },
            },
            {
              text: `Inspect this viewport screenshot, the Actor World Coordinates & Bounding Boxes summary:\n${JSON.stringify(
                actorCoordinates || [],
                null,
                2
              )}\n\nand the full SceneSpec JSON:\n${JSON.stringify(
                sceneSpec,
                null,
                2
              )}\n\nDetect any overlapping objects, off-frame cameras, ungrounded actors, or low-contrast lighting, and return a JSON object with:
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
            },
          ],
        },
        config: {
          systemInstruction: buildVisionQASystemPrompt(),
          responseMimeType: 'application/json',
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error: any) {
      console.error('Error in /api/agent/vision-qa:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Vision QA failed' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
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
