import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { buildAgentSystemPrompt, buildVisionQASystemPrompt } from './src/agent/systemPrompts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
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
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  // 1. Conversational SceneSpec Mutation Endpoint
  app.post('/api/agent/mutate', async (req, res) => {
    try {
      const { prompt, sceneSpec } = req.body;
      const ai = getGenAIClient();
      if (!ai) {
        res.status(503).json({ error: 'Gemini API key not configured on server; using studio fallback.' });
        return;
      }

      const userPrompt = `USER INSTRUCTION: "${prompt}"

CURRENT SCENESPEC JSON:
${JSON.stringify(sceneSpec, null, 2)}

Return a JSON object with:
{
  "assistantMessage": "string explaining what was updated in the 3D scene",
  "diffSummary": ["bullet 1", "bullet 2"],
  "updatedSceneSpec": { ...complete valid SceneSpec object... }
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: userPrompt,
        config: {
          systemInstruction: buildAgentSystemPrompt(),
          responseMimeType: 'application/json',
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error: any) {
      console.error('Error in /api/agent/mutate:', error?.message || error);
      res.status(500).json({ error: error?.message || 'Agent mutation failed' });
    }
  });

  // 2. Multimodal Vision QA Endpoint (WebGL Canvas Base64 PNG + SceneSpec JSON)
  app.post('/api/agent/vision-qa', async (req, res) => {
    try {
      const { screenshotDataUrl, sceneSpec } = req.body;
      const ai = getGenAIClient();
      if (!ai || !screenshotDataUrl) {
        res.status(503).json({ error: 'Vision QA fallback active' });
        return;
      }

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
              text: `Inspect this 3D WebGL viewport screenshot and its current SceneSpec JSON:\n${JSON.stringify(
                sceneSpec,
                null,
                2
              )}\n\nReturn a JSON object with:
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
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OmniStage AI Studio Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
