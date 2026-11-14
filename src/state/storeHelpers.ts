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

export const INITIAL_EXECUTION_LOGS: ExecutionLogEntry[] = [
  {
    id: 'log-init-1',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    sceneTime: 0.0,
    level: 'trigger',
    nodeId: 'node-scene-start',
    message: 'Fired [On Scene Start] -> Initialized 3D WebGL stage & WorldRenderer pipeline.',
    payload: { engine: '3d', skybox: initialScene3D.world.skybox },
  },
  {
    id: 'log-init-2',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    sceneTime: 0.2,
    level: 'action',
    nodeId: 'node-actor-motion',
    actorId: initialScene3D.actors[0]?.id,
    message: `Bound skeletal rig [${initialScene3D.actors[0]?.name || 'Expressive Robot'}] to clip '${initialScene3D.actors[0]?.activeClip || 'Idle'}'.`,
    payload: { speed: 1.0, scoreDelta: 25 },
  },
  {
    id: 'log-init-3',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    sceneTime: 0.4,
    level: 'action',
    nodeId: 'node-robot-servo',
    message: 'Phygital Bridge ready: Servo Ch 1 @ 45° · OLED Eye Expression = cyber-happy.',
    payload: { servoChannel: 'Ch 1', servoAngle: 45 },
  },
  {
    id: 'log-init-warn',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    sceneTime: 1.2,
    level: 'warn',
    nodeId: 'node-score-gate',
    actorId: initialScene3D.actors[0]?.id,
    message:
      'Condition [If Score >= 100] has only 1 collectible actor on stage (25 PTS per tap). Spawn more collectibles or lower targetScore for faster playable conversion.',
    payload: { currentTargetScore: 100, actorCount: initialScene3D.actors.length },
  },
];

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
