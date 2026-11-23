/**
 * Phase 7C — initial studio state and small helpers shared by the store slices.
 */
import { createBlankSceneSpec } from '../registry/assetRegistry';
import { ActorNode, ExecutionLogEntry, SettingsConfig, Vector3Tuple } from '../types/scene.schema';
import { syncGraphWithScene } from '../runtime/graphSync';

export const SETTINGS_STORAGE_KEY = 'omnistage_studio_settings_v3';

export const DEFAULT_SETTINGS: SettingsConfig = {
  aiProvider: 'gemini',
  aiModels: {},
  aiApiKeys: {},
  aiBaseUrl: 'https://api.openai.com/v1',
  aiFallbackEnabled: true,
  aiFallbackOrder: [],
  aiEditMode: 'patch',
  disabledSkills: [],
  geminiModel: 'gemini-3.8-flash',
  polyPizzaApiKey: '',
  sketchfabApiToken: '',
  generationKeys: {},
  directorQA: true,
  writersRoomReview: true,
  directorQAThreshold: 70,
  elevenLabsApiKey: '',
  elevenLabsModel: '',
  customSystemPrompt: '',
  customAssetManifestUrl: '',
  enableThreeOfficialCdn: true,
  enableSketchfabHub: true,
  enablePolyPizzaHub: true,
  enablePolyHavenHub: true,
  defaultEngine: '3d',
  renderQuality: 'high',
  fpsCap: 60,
  enableShadows: true,
  enableBloom: true,
  physicsGravity: 9.8,
};

export function loadInitialSettings(): SettingsConfig {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // Gemini CLI was replaced by the Google Antigravity CLI.
    if ((parsed.aiProvider as string) === 'cli-gemini') parsed.aiProvider = 'cli-antigravity';
    return parsed;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const initialScene3D = syncGraphWithScene(
  createBlankSceneSpec('3d', 'Scene 1 · 3D Authoring Stage')
);
export const initialScene2D = syncGraphWithScene(
  createBlankSceneSpec('2d', 'Scene 2 · 2D Vector & Platformer Stage')
);

/** The log starts empty: it only shows what actually ran (no pretend servo/robot entries from an old demo). */
export const INITIAL_EXECUTION_LOGS: ExecutionLogEntry[] = [];

export function findUnoccupiedPosition(existingActors: ActorNode[]): Vector3Tuple {
  if (existingActors.length === 0) return [0, 0, 0];
  const candidateOffsets: Vector3Tuple[] = [
    [0, 0, 0],
    [-2.0, 0, 0.6],
    [2.0, 0, 0.6],
    [0, 0, -2.0],
    [-1.8, 0, -1.6],
    [1.8, 0, -1.6],
    [-3.0, 0, 0],
    [3.0, 0, 0],
  ];
  for (const candidate of candidateOffsets) {
    const tooClose = existingActors.some((a) => {
      const dx = a.position[0] - candidate[0];
      const dz = a.position[2] - candidate[2];
      return Math.hypot(dx, dz) < 1.35;
    });
    if (!tooClose) return candidate;
  }
  const angle = (existingActors.length * 1.1) % (Math.PI * 2);
  const radius = 2.2 + (existingActors.length % 3) * 0.7;
  return [
    Number((Math.cos(angle) * radius).toFixed(2)),
    0,
    Number((Math.sin(angle) * radius).toFixed(2)),
  ];
}
