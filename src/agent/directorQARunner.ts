/**
 * Phase 10D — Director QA in the studio: render the shot's keyframes on the exported Player, ask the active (vision-capable)
 * AI connection to score them through /api/agent/vision-qa (mode "director"), and, under the threshold, run one patch round
 * driven by the findings (src/agent/directorQA.ts). Studio-only (browser).
 */
import type { SceneSpec, SettingsConfig } from '../types/scene.schema';
import { autoFixSceneSpec, MEDIA_CRAFT_CODES, mediaQualityPenalty } from '../verification/sceneVerifier';
import { aiHeaders, providerInfo } from './aiClient';
import {
  DIRECTOR_QA_THRESHOLD,
  DirectorQAReport,
  DirectorQARoundResult,
  normalizeDirectorQAReport,
  pickDirectorKeyframes,
  runDirectorQARound,
} from './directorQA';
import type { PatchProposal } from './patchLoop';

export type DirectorQASettings = Pick<
  SettingsConfig,
  'geminiModel' | 'customSystemPrompt' | 'aiProvider' | 'aiModels' | 'aiApiKeys' | 'aiBaseUrl' | 'directorQA' | 'directorQAThreshold'
>;

/** Director QA runs only on connections that can see images (CLI providers cannot), unless switched off in Settings. */
export function directorQAAvailable(settings: Pick<SettingsConfig, 'aiProvider' | 'directorQA'>): boolean {
  return settings.directorQA !== false && providerInfo(settings.aiProvider || 'gemini').vision;
}

export function directorQAThreshold(settings: Pick<SettingsConfig, 'directorQAThreshold'>): number {
  const t = Number(settings.directorQAThreshold);
  return Number.isFinite(t) && t >= 1 && t <= 100 ? Math.round(t) : DIRECTOR_QA_THRESHOLD;
}

/** Renders the keyframes and asks the vision model. null when the shot cannot be captured or the model gives no score. */
export async function reviewFilmShot(spec: SceneSpec, settings: DirectorQASettings, signal?: AbortSignal): Promise<DirectorQAReport | null> {
  if (!providerInfo(settings.aiProvider || 'gemini').vision) return null;
  const keyframes = pickDirectorKeyframes(spec);
  if (!keyframes.length) return null;
  const { captureDirectorContactSheet } = await import('../media/directorKeyframes');
  const sheet = await captureDirectorContactSheet(spec, keyframes, { signal });
  if (!sheet || signal?.aborted) return null;
  const res = await fetch('/api/agent/vision-qa', {
    method: 'POST',
    headers: aiHeaders(settings),
    body: JSON.stringify({ mode: 'director', screenshotDataUrl: sheet.dataUrl, keyframes: sheet.keyframes, sceneSpec: spec, model: settings.geminiModel }),
    signal,
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const report = normalizeDirectorQAReport(json, sheet.keyframes);
  return report ? { ...report, provider: json?.provider, model: json?.model } : null;
}

/** Review + (score under threshold) one patch round. Never makes verification worse. */
export async function runDirectorQAForShot(spec: SceneSpec, prompt: string, settings: DirectorQASettings, signal?: AbortSignal): Promise<DirectorQARoundResult> {
  if (!directorQAAvailable(settings)) return { spec, review: null, changed: false, skipped: 'unavailable', diffSummary: [] };
  return runDirectorQARound({
    spec,
    prompt,
    threshold: directorQAThreshold(settings),
    review: (s) => reviewFilmShot(s, settings, signal),
    check: (s) => autoFixSceneSpec(s),
    qualityPenalty: mediaQualityPenalty,
    qualityCodes: MEDIA_CRAFT_CODES,
    propose: async (turn) => {
      try {
        const res = await fetch('/api/agent/patch', {
          method: 'POST',
          headers: aiHeaders(settings),
          body: JSON.stringify({
            prompt: turn.prompt,
            sceneSpec: turn.spec,
            round: turn.round,
            toolResults: turn.toolResults,
            model: settings.geminiModel,
            customSystemPrompt: settings.customSystemPrompt,
          }),
          signal,
        });
        return res.ok ? ((await res.json()) as PatchProposal) : null;
      } catch {
        return null;
      }
    },
  });
}
