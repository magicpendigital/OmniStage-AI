import { create } from 'zustand';
import {
  ASSET_REGISTRY,
  cloneSceneSpec,
  createBlankSceneSpec,
  DEFAULT_WORLD_SPEC,
  LIGHTING_PRESETS,
  PRESET_2D_ASSETS,
  SCENE_TEMPLATES,
} from '../registry/assetRegistry';
import {
  ActorNode,
  AspectRatioPreset,
  CameraMode,
  ChatMessage,
  EngineType,
  LightingPresetId,
  Node2D,
  ScatterObjectType,
  SceneSpec,
  SemanticAssetEntry,
  SettingsConfig,
  StudioMode,
  TransformMode,
  Vector3Tuple,
  VFXNode,
  VFXType,
  VisionQAReport,
  WorldSpec,
} from '../types/scene.schema';

export interface FloatingScoreFeedback {
  id: string;
  text: string;
  color: string;
  createdAt: number;
}

export interface BurstVFXInstance {
  id: string;
  position: Vector3Tuple;
  color: string;
  createdAt: number;
}

const SETTINGS_STORAGE_KEY = 'omnistage_studio_settings_v3';

export const DEFAULT_SETTINGS: SettingsConfig = {
  geminiModel: 'gemini-3.8-flash',
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

function loadInitialSettings(): SettingsConfig {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface StudioState {
  // Multi-Scene Storyboard & Active SceneSpec
  scenes: SceneSpec[];
  activeSceneId: string;
  sceneSpec: SceneSpec;
  pastSpecs: SceneSpec[];
  futureSpecs: SceneSpec[];

  // Custom Imported Assets in Current Session
  customRegistryAssets: SemanticAssetEntry[];

  // Selection & Gizmo State (3D & 2D)
  selectedActorId: string | null;
  selectedNode2DId: string | null;
  selectedVfxId: string | null;
  transformMode: TransformMode;
  isDraggingGizmo: boolean;
  isPublishModalOpen: boolean;
  isSettingsModalOpen: boolean;
  isBottomDockCollapsed: boolean;

  // Persistent Studio Settings
  settings: SettingsConfig;

  // Timeline Sequencer & Playback State
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;

  // Playable Game Runtime State
  gameScore: number;
  gameTimeRemaining: number;
  gameWon: boolean;
  gameEnded: boolean;
  unboxTapCounts: Record<string, number>;
  scorePopups: FloatingScoreFeedback[];
  burstEffects: BurstVFXInstance[];

  // AI Agent & Vision QA State
  chatMessages: ChatMessage[];
  isAgentThinking: boolean;
  isVisionRunning: boolean;
  latestVisionReport: VisionQAReport | null;

  // WebGL / 2D Canvas Ref Registration (for Snapshot & MediaRecorder)
  canvasElement: HTMLCanvasElement | null;
  isRecordingVideo: boolean;
  recordingProgress: number;

  // Actions — Multi-Scene & Engine Authoring
  setCanvasElement: (el: HTMLCanvasElement | null) => void;
  setSceneSpec: (nextSpec: SceneSpec, summary?: string[]) => void;
  setEngineType: (engineType: EngineType) => void;
  createNewBlankScene: (engineType: EngineType, title?: string) => void;
  switchScene: (sceneId: string) => void;
  duplicateScene: (sceneId: string) => void;
  deleteScene: (sceneId: string) => void;
  loadProjectBundle: (scenes: SceneSpec[], activeSceneId?: string) => void;
  loadTemplate: (templateId: string) => void;
  undo: () => void;
  redo: () => void;

  setMode: (mode: StudioMode) => void;
  setAspectRatio: (ratio: AspectRatioPreset) => void;
  setLightingPreset: (presetId: LightingPresetId) => void;
  setCameraMode: (mode: CameraMode) => void;

  // World & Environment Builder Actions
  updateWorld: (patch: Partial<WorldSpec>) => void;
  updateTerrain: (patch: Partial<WorldSpec['terrain']>) => void;
  updateClouds: (patch: Partial<WorldSpec['clouds']>) => void;
  updateWeather: (patch: Partial<WorldSpec['weather']>) => void;
  addScatterLayer: (type: ScatterObjectType) => void;
  removeScatterLayer: (id: string) => void;

  // 3D Actor & Custom GLB Actions
  selectActor: (id: string | null) => void;
  setTransformMode: (mode: TransformMode) => void;
  setIsDraggingGizmo: (dragging: boolean) => void;
  updateActorTransform: (
    actorId: string,
    position: Vector3Tuple,
    rotation: Vector3Tuple,
    scale: Vector3Tuple
  ) => void;
  updateActorProperty: (actorId: string, partialProps: Partial<ActorNode>) => void;
  updateActor: (actorId: string, patch: Partial<ActorNode>) => void;
  registerActorClips: (actorId: string, clipNames: string[]) => void;
  duplicateActor: (actorId: string) => void;
  spawnAsset: (assetId: string, customGlbUrl?: string, customName?: string) => void;
  registerAndSpawnCustomAsset: (name: string, url: string, fileType: 'glb' | 'svg' | 'image') => void;
  removeActor: (actorId: string) => void;

  // 2D Node Authoring Actions
  selectNode2D: (id: string | null) => void;
  spawnPreset2D: (presetId: string) => void;
  addCustomNode2D: (node: Omit<Node2D, 'id'>) => void;
  updateNode2D: (nodeId: string, patch: Partial<Node2D>) => void;
  duplicateNode2D: (nodeId: string) => void;
  removeNode2D: (nodeId: string) => void;

  // VFX Actions
  spawnVFX: (type: VFXType) => void;
  removeVFX: (vfxId: string) => void;

  // Playback & Playable Game Runtime Actions
  togglePlay: () => void;
  setIsPlaying: (playing: boolean) => void;
  toggleLoop: () => void;
  setCurrentTime: (time: number) => void;
  advanceTimeline: (deltaSeconds: number) => void;
  movePlayerActor: (dx: number, dz: number) => void;
  handlePlayerCollision: (targetActorId: string) => void;
  triggerActorInteraction: (actor: ActorNode) => void;
  addGameScore: (points: number, label: string, color?: string) => void;
  resetGameSession: () => void;
  dismissEndCard: () => void;

  // Agent, Vision QA & Settings Actions
  addChatMessage: (msg: ChatMessage) => void;
  setAgentThinking: (thinking: boolean) => void;
  setVisionRunning: (running: boolean) => void;
  setLatestVisionReport: (report: VisionQAReport | null) => void;
  applyVisionFixes: (report: VisionQAReport) => void;
  updateSettings: (patch: Partial<SettingsConfig>) => void;

  // UI Modals
  setPublishModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setBottomDockCollapsed: (collapsed: boolean) => void;
  setRecordingState: (recording: boolean, progress?: number) => void;
}

// Launch with a clean From-Scratch 3D Authoring Scene + a secondary 2D Scene in the Storyboard!
const initialScene3D = createBlankSceneSpec('3d', 'Scene 1 · 3D Authoring Stage');
const initialScene2D = createBlankSceneSpec('2d', 'Scene 2 · 2D Vector & Platformer Stage');

function findUnoccupiedPosition(existingActors: ActorNode[]): Vector3Tuple {
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

export const useStudioStore = create<StudioState>((set, get) => ({
  scenes: [initialScene3D, initialScene2D],
  activeSceneId: initialScene3D.id,
  sceneSpec: cloneSceneSpec(initialScene3D),
  pastSpecs: [],
  futureSpecs: [],

  customRegistryAssets: [],

  selectedActorId: initialScene3D.actors[0]?.id ?? null,
  selectedNode2DId: null,
  selectedVfxId: null,
  transformMode: 'translate',
  isDraggingGizmo: false,
  isPublishModalOpen: false,
  isSettingsModalOpen: false,
  isBottomDockCollapsed: false,

  settings: loadInitialSettings(),

  isPlaying: true,
  isLooping: true,
  currentTime: 0,

  gameScore: 0,
  gameTimeRemaining: initialScene3D.gameRules.timeLimitSeconds,
  gameWon: false,
  gameEnded: false,
  unboxTapCounts: {},
  scorePopups: [],
  burstEffects: [],

  chatMessages: [
    {
      id: 'msg-welcome-v3',
      role: 'assistant',
      content:
        'Welcome to OmniStage AI (Phase 3 Dual-Engine Authoring Studio). You are on a clean 3D Authoring Stage with a rigged Expressive AI Robot (.GLB). Use the Left Panel to inspect the Scene Graph, sculpt 3D Terrains & Weather, import local .GLB / .SVG files, or switch between the 3D WebGL Engine and 2D Vector/Platformer Engine.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      diffSummary: [
        'Initialized Blank 3D Authoring Stage with rigged RobotExpressive.glb',
        'Enabled World Terrain Builder, 2D Vector/Sprite Engine & Multi-Scene Storyboard',
      ],
    },
  ],
  isAgentThinking: false,
  isVisionRunning: false,
  latestVisionReport: null,

  canvasElement: null,
  isRecordingVideo: false,
  recordingProgress: 0,

  setCanvasElement: (el) => set({ canvasElement: el }),

  setSceneSpec: (nextSpec) =>
    set((state) => {
      const cloned = cloneSceneSpec(nextSpec);
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? cloned : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: cloned,
        scenes: updatedScenes,
        gameTimeRemaining: cloned.gameRules.timeLimitSeconds,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        unboxTapCounts: {},
      };
    }),

  setEngineType: (engineType) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = engineType;
      if (engineType === '2d' && nextSpec.nodes2D.length === 0) {
        const blank2d = createBlankSceneSpec('2d');
        nextSpec.nodes2D = blank2d.nodes2D;
      }
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        selectedNode2DId: nextSpec.nodes2D[0]?.id ?? null,
      };
    }),

  createNewBlankScene: (engineType, title) =>
    set((state) => {
      const newScene = createBlankSceneSpec(
        engineType,
        title || `Scene ${state.scenes.length + 1} · ${engineType.toUpperCase()} Stage`
      );
      const nextScenes = [...state.scenes, newScene];
      return {
        scenes: nextScenes,
        activeSceneId: newScene.id,
        sceneSpec: cloneSceneSpec(newScene),
        pastSpecs: [],
        futureSpecs: [],
        selectedActorId: newScene.actors[0]?.id ?? null,
        selectedNode2DId: newScene.nodes2D[0]?.id ?? null,
        currentTime: 0,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
      };
    }),

  switchScene: (sceneId) =>
    set((state) => {
      // Save current sceneSpec into scenes array before switching
      const savedScenes = state.scenes.map((s) =>
        s.id === state.activeSceneId ? cloneSceneSpec(state.sceneSpec) : s
      );
      const target = savedScenes.find((s) => s.id === sceneId);
      if (!target) return state;
      const cloned = cloneSceneSpec(target);
      return {
        scenes: savedScenes,
        activeSceneId: cloned.id,
        sceneSpec: cloned,
        pastSpecs: [],
        futureSpecs: [],
        selectedActorId: cloned.actors[0]?.id ?? null,
        selectedNode2DId: cloned.nodes2D[0]?.id ?? null,
        currentTime: 0,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
      };
    }),

  duplicateScene: (sceneId) =>
    set((state) => {
      const source = state.scenes.find((s) => s.id === sceneId);
      if (!source) return state;
      const copy = cloneSceneSpec(source);
      copy.id = `scene-${Date.now().toString(36)}`;
      copy.title = `${source.title} (Copy)`;
      return {
        scenes: [...state.scenes, copy],
        activeSceneId: copy.id,
        sceneSpec: copy,
      };
    }),

  deleteScene: (sceneId) =>
    set((state) => {
      if (state.scenes.length <= 1) return state;
      const remaining = state.scenes.filter((s) => s.id !== sceneId);
      const nextActive =
        state.activeSceneId === sceneId ? remaining[0] : remaining.find((s) => s.id === state.activeSceneId) || remaining[0];
      return {
        scenes: remaining,
        activeSceneId: nextActive.id,
        sceneSpec: cloneSceneSpec(nextActive),
      };
    }),

  loadProjectBundle: (bundleScenes, preferredActiveId) =>
    set((state) => {
      if (!Array.isArray(bundleScenes) || bundleScenes.length === 0) return state;
      const sanitized = bundleScenes.map((s) => cloneSceneSpec(s));
      const active =
        sanitized.find((s) => s.id === preferredActiveId) || sanitized[0];
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        scenes: sanitized,
        activeSceneId: active.id,
        sceneSpec: cloneSceneSpec(active),
        selectedActorId: active.actors[0]?.id ?? null,
        selectedNode2DId: active.nodes2D[0]?.id ?? null,
        currentTime: 0,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        gameTimeRemaining: active.gameRules.timeLimitSeconds,
      };
    }),

  loadTemplate: (templateId) => {
    const template = SCENE_TEMPLATES[templateId];
    if (!template) return;
    const cloned = cloneSceneSpec(template);
    set((state) => {
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? cloned : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: cloned,
        scenes: updatedScenes,
        selectedActorId: cloned.actors[0]?.id ?? null,
        selectedNode2DId: cloned.nodes2D[0]?.id ?? null,
        currentTime: 0,
        isPlaying: true,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        unboxTapCounts: {},
        burstEffects: [],
        gameTimeRemaining: cloned.gameRules.timeLimitSeconds,
        latestVisionReport: null,
      };
    });
  },

  undo: () =>
    set((state) => {
      if (state.pastSpecs.length === 0) return state;
      const previous = state.pastSpecs[state.pastSpecs.length - 1];
      const remainingPast = state.pastSpecs.slice(0, -1);
      return {
        pastSpecs: remainingPast,
        futureSpecs: [cloneSceneSpec(state.sceneSpec), ...state.futureSpecs.slice(0, 19)],
        sceneSpec: cloneSceneSpec(previous),
      };
    }),

  redo: () =>
    set((state) => {
      if (state.futureSpecs.length === 0) return state;
      const next = state.futureSpecs[0];
      const remainingFuture = state.futureSpecs.slice(1);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: remainingFuture,
        sceneSpec: cloneSceneSpec(next),
      };
    }),

  setMode: (mode) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.mode = mode;
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        unboxTapCounts: {},
        gameTimeRemaining: nextSpec.gameRules.timeLimitSeconds,
      };
    }),

  setAspectRatio: (aspectRatio) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.aspectRatio = aspectRatio;
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  setLightingPreset: (presetId) =>
    set((state) => {
      const preset = LIGHTING_PRESETS[presetId];
      if (!preset) return state;
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.environment = {
        presetId: preset.presetId,
        backgroundColor: preset.backgroundColor,
        fogColor: preset.fogColor,
        fogNear: preset.fogNear,
        fogFar: preset.fogFar,
        groundGrid: preset.groundGrid,
        groundColor: preset.groundColor,
        reflectivePedestal: preset.reflectivePedestal,
        ambientIntensity: preset.ambientIntensity,
        keyLightColor: preset.keyLightColor,
        keyLightIntensity: preset.keyLightIntensity,
        rimLightColor: preset.rimLightColor,
      };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  setCameraMode: (mode) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.camera.mode = mode;
      if (mode === 'top-down-isometric' || mode === 'isometric-game') {
        nextSpec.camera.position = [0, 6.2, 8.2];
        nextSpec.camera.target = [0, 0.9, 0];
      } else if (mode === 'orbit-360' || mode === 'orbit') {
        nextSpec.camera.position = [0, 2.6, 6.4];
        nextSpec.camera.target = [0, 1.1, 0];
      } else if (mode === 'dolly-zoom-in') {
        nextSpec.camera.position = [0, 2.4, 5.8];
        nextSpec.camera.target = [0, 1.1, 0];
      } else if (mode === 'crane-reveal') {
        nextSpec.camera.position = [-2.4, 1.2, 5.2];
        nextSpec.camera.target = [0, 1.3, 0];
      }
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  // ================= WORLD & ENVIRONMENT BUILDER ACTIONS =================
  updateWorld: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world = { ...(nextSpec.world || DEFAULT_WORLD_SPEC), ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateTerrain: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.terrain = { ...nextSpec.world.terrain, ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateClouds: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.clouds = { ...nextSpec.world.clouds, ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateWeather: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.weather = { ...nextSpec.world.weather, ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  addScatterLayer: (type) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.scatterObjects.push({
        id: `scatter-${Date.now().toString(36)}`,
        type,
        count: type === 'pine-trees' ? 24 : 16,
        spreadRadius: 22,
        scaleRange: [0.8, 1.5],
      });
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  removeScatterLayer: (id) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.scatterObjects = nextSpec.world.scatterObjects.filter((s) => s.id !== id);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  // ================= 3D ACTOR & GIZMO ACTIONS =================
  selectActor: (id) => set({ selectedActorId: id }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setIsDraggingGizmo: (isDraggingGizmo) => set({ isDraggingGizmo }),

  updateActorTransform: (actorId, position, rotation, scale) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx === -1 || nextSpec.actors[idx].locked) return state;
      nextSpec.actors[idx] = {
        ...nextSpec.actors[idx],
        position: [
          Number(position[0].toFixed(2)),
          Number(Math.max(0, position[1]).toFixed(2)),
          Number(position[2].toFixed(2)),
        ],
        rotation: [
          Number(rotation[0].toFixed(2)),
          Number(rotation[1].toFixed(2)),
          Number(rotation[2].toFixed(2)),
        ],
        scale: [
          Number(Math.max(0.1, scale[0]).toFixed(2)),
          Number(Math.max(0.1, scale[1]).toFixed(2)),
          Number(Math.max(0.1, scale[2]).toFixed(2)),
        ],
      };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateActorProperty: (actorId, partialProps) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx === -1) return state;
      nextSpec.actors[idx] = { ...nextSpec.actors[idx], ...partialProps };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateActor: (actorId, patch) => get().updateActorProperty(actorId, patch),

  registerActorClips: (actorId, clipNames) =>
    set((state) => {
      const actor = state.sceneSpec.actors.find((a) => a.id === actorId);
      if (!actor) return state;
      const existing = actor.availableClips || [];
      if (existing.length === clipNames.length && existing.every((c, i) => c === clipNames[i])) {
        return state;
      }
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx !== -1) {
        nextSpec.actors[idx].availableClips = clipNames;
        if (!nextSpec.actors[idx].activeClip && clipNames.length > 0) {
          nextSpec.actors[idx].activeClip = clipNames[0];
        }
      }
      return { sceneSpec: nextSpec };
    }),

  duplicateActor: (actorId) =>
    set((state) => {
      const source = state.sceneSpec.actors.find((a) => a.id === actorId);
      if (!source) return state;
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const newPos = findUnoccupiedPosition(nextSpec.actors);
      const copy: ActorNode = {
        ...JSON.parse(JSON.stringify(source)),
        id: `actor-${Date.now().toString(36)}`,
        name: `${source.name} Copy`,
        position: newPos,
      };
      nextSpec.actors.push(copy);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId: copy.id,
      };
    }),

  spawnAsset: (assetId, customGlbUrl, customName) =>
    set((state) => {
      const customFound = state.customRegistryAssets.find((c) => c.assetId === assetId);
      const entry =
        customFound ?? ASSET_REGISTRY[assetId] ?? ASSET_REGISTRY['starter-primitive-showcase'];
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '3d';
      const spawnPos = findUnoccupiedPosition(nextSpec.actors);
      const newActor: ActorNode = {
        id: `actor-${Date.now().toString(36)}`,
        name: customName || `${entry.name}`,
        assetId: entry.assetId,
        modelUrl: customGlbUrl || entry.modelUrl,
        customGlbUrl,
        position: spawnPos,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        primaryColor: entry.defaultPrimaryColor,
        secondaryColor: entry.defaultSecondaryColor,
        metalness: entry.defaultMetalness,
        roughness: entry.defaultRoughness,
        activeAnimation: entry.defaultAnimation,
        activeClip: entry.defaultClip,
        availableClips: entry.embeddedClips,
        animationSpeed: 1,
        physicsRole: entry.defaultPhysicsRole,
        onClickAction: entry.defaultClickAction,
        scoreValue: entry.defaultScoreValue,
        startTime: 0,
        endTime: nextSpec.durationSeconds || 8,
        enterEffect: 'pop-in',
        unboxTapsRequired: entry.assetId === 'mystery-gift-box' ? 3 : undefined,
        revealAssetId: entry.assetId === 'mystery-gift-box' ? 'sports-sneaker-pro' : undefined,
      };
      nextSpec.actors.push(newActor);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId: newActor.id,
      };
    }),

  registerAndSpawnCustomAsset: (name, url, fileType) => {
    const state = get();
    if (fileType === 'glb') {
      const customId = `custom-glb-${Date.now().toString(36)}`;
      const newEntry: SemanticAssetEntry = {
        assetId: customId,
        name: name || 'Imported GLTF Asset',
        category: 'gltf-rigged',
        description: 'User-imported custom .GLB / .GLTF 3D model.',
        modelUrl: url,
        defaultPrimaryColor: '#06B6D4',
        defaultSecondaryColor: '#F59E0B',
        defaultMetalness: 0.6,
        defaultRoughness: 0.3,
        defaultAnimation: 'idle',
        defaultPhysicsRole: 'dynamic',
        defaultClickAction: 'bounce',
        defaultScoreValue: 25,
        boundingBox: { width: 1.5, height: 2.0, depth: 1.5 },
        attachmentSockets: { ground: [0, 0, 0], top_badge: [0, 2.3, 0] },
        supportedAnimations: ['idle', 'spin', 'float', 'bounce'],
      };
      set((s) => ({
        customRegistryAssets: [newEntry, ...s.customRegistryAssets],
      }));
      get().spawnAsset(customId, url, name);
    } else {
      // Spawn into 2D Engine as Sprite / SVG Node
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '2d';
      const newNode: Node2D = {
        id: `node2d-${Date.now().toString(36)}`,
        name: name || 'Imported 2D Sprite',
        type: 'sprite-actor',
        x: 480,
        y: 280,
        width: 110,
        height: 110,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        fill: '#06B6D4',
        stroke: '#F8FAFC',
        imageUrl: url,
        physics2D: 'bouncing',
        scoreValue: 25,
      };
      nextSpec.nodes2D.push(newNode);
      set((s) => ({
        pastSpecs: [...s.pastSpecs.slice(-19), cloneSceneSpec(s.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId: newNode.id,
      }));
    }
  },

  removeActor: (actorId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.actors = nextSpec.actors.filter((a) => a.id !== actorId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId:
          state.selectedActorId === actorId
            ? (nextSpec.actors[0]?.id ?? null)
            : state.selectedActorId,
      };
    }),

  // ================= 2D VECTOR / SPRITE NODE ACTIONS =================
  selectNode2D: (id) => set({ selectedNode2DId: id }),

  spawnPreset2D: (presetId) =>
    set((state) => {
      const preset = PRESET_2D_ASSETS.find((p) => p.id === presetId) ?? PRESET_2D_ASSETS[0];
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '2d';
      const offset = (nextSpec.nodes2D.length % 5) * 35;
      const newNode: Node2D = {
        ...JSON.parse(JSON.stringify(preset.nodeTemplate)),
        id: `node2d-${Date.now().toString(36)}`,
        x: Math.min(860, preset.nodeTemplate.x + offset),
        y: Math.min(500, preset.nodeTemplate.y - offset * 0.5),
      };
      nextSpec.nodes2D.push(newNode);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId: newNode.id,
      };
    }),

  addCustomNode2D: (nodeTemplate) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '2d';
      const newNode: Node2D = {
        ...nodeTemplate,
        id: `node2d-${Date.now().toString(36)}`,
      };
      nextSpec.nodes2D.push(newNode);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId: newNode.id,
      };
    }),

  updateNode2D: (nodeId, patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.nodes2D.findIndex((n) => n.id === nodeId);
      if (idx === -1 || (nextSpec.nodes2D[idx].locked && patch.locked === undefined)) return state;
      nextSpec.nodes2D[idx] = { ...nextSpec.nodes2D[idx], ...patch };
      return {
        sceneSpec: nextSpec,
      };
    }),

  duplicateNode2D: (nodeId) =>
    set((state) => {
      const source = state.sceneSpec.nodes2D.find((n) => n.id === nodeId);
      if (!source) return state;
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const copy: Node2D = {
        ...JSON.parse(JSON.stringify(source)),
        id: `node2d-${Date.now().toString(36)}`,
        name: `${source.name} Copy`,
        x: Math.min(900, source.x + 40),
        y: Math.min(520, source.y + 30),
      };
      nextSpec.nodes2D.push(copy);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId: copy.id,
      };
    }),

  removeNode2D: (nodeId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.nodes2D = nextSpec.nodes2D.filter((n) => n.id !== nodeId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedNode2DId:
          state.selectedNode2DId === nodeId
            ? (nextSpec.nodes2D[0]?.id ?? null)
            : state.selectedNode2DId,
      };
    }),

  // ================= VFX ACTIONS =================
  spawnVFX: (type) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const colorMap: Record<VFXType, string> = {
        sparkles: '#38BDF8',
        shockwave: '#06B6D4',
        'floating-3d-badge': '#F59E0B',
        'laser-beam': '#EC4899',
        confetti: '#FBBF24',
      };
      const newVfx: VFXNode = {
        id: `vfx-${Date.now().toString(36)}`,
        name: `${type.toUpperCase()} Node`,
        type,
        position: type === 'floating-3d-badge' ? [0, 2.5, 0] : [0, 0.2, 0],
        color: colorMap[type],
        intensity: 1.2,
        scale: 1,
        labelText: type === 'floating-3d-badge' ? 'SPECIAL OFFER · PLAY NOW' : undefined,
        startTime: 0,
        endTime: nextSpec.durationSeconds || 8,
        enterEffect: 'pop-in',
      };
      nextSpec.vfx.push(newVfx);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedVfxId: newVfx.id,
      };
    }),

  removeVFX: (vfxId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.vfx = nextSpec.vfx.filter((v) => v.id !== vfxId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  toggleLoop: () => set((state) => ({ isLooping: !state.isLooping })),
  setCurrentTime: (currentTime) => set({ currentTime }),

  advanceTimeline: (deltaSeconds) =>
    set((state) => {
      if (!state.isPlaying) return state;
      const duration = Math.max(2, state.sceneSpec.durationSeconds || 8);
      let nextTime = state.currentTime + deltaSeconds;
      let nextPlaying: boolean = state.isPlaying;

      if (nextTime >= duration) {
        if (state.isLooping) {
          nextTime = nextTime % duration;
        } else {
          nextTime = duration;
          nextPlaying = false;
        }
      }

      let nextRemaining = state.gameTimeRemaining;
      let nextEnded = state.gameEnded;
      let nextWon = state.gameWon;

      if (state.sceneSpec.mode === 'game' && !state.gameEnded) {
        nextRemaining = Math.max(0, state.gameTimeRemaining - deltaSeconds);
        if (nextRemaining === 0) {
          nextEnded = true;
          if (state.sceneSpec.gameRules.winCondition === 'survive-timer') {
            nextWon = true;
          }
        }
      }

      return {
        currentTime: nextTime,
        isPlaying: nextPlaying,
        gameTimeRemaining: nextRemaining,
        gameEnded: nextEnded,
        gameWon: nextWon,
      };
    }),

  movePlayerActor: (dx, dz) =>
    set((state) => {
      if (state.sceneSpec.mode !== 'game' || state.gameEnded) return state;
      const playerIdx = state.sceneSpec.actors.findIndex((a) => a.physicsRole === 'player');
      if (playerIdx === -1) return state;
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const player = nextSpec.actors[playerIdx];
      const nextX = Math.max(-5.5, Math.min(5.5, player.position[0] + dx));
      const nextZ = Math.max(-5.5, Math.min(5.5, player.position[2] + dz));
      const heading = Math.atan2(dx, dz);
      player.position = [Number(nextX.toFixed(2)), player.position[1], Number(nextZ.toFixed(2))];
      player.rotation = [0, Number(heading.toFixed(2)), 0];
      return { sceneSpec: nextSpec };
    }),

  handlePlayerCollision: (targetActorId) => {
    const state = get();
    if (state.sceneSpec.mode !== 'game' || state.gameEnded) return;
    const target = state.sceneSpec.actors.find((a) => a.id === targetActorId);
    if (!target || target.visible === false) return;

    if (target.physicsRole === 'collectible') {
      const pts = target.scoreValue ?? 25;
      const nextScore = state.gameScore + pts;
      const targetScore = state.sceneSpec.gameRules.targetScore || 100;
      const won = nextScore >= targetScore;

      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === targetActorId);
      const burstPos: Vector3Tuple = [...target.position];

      if (idx !== -1) {
        const rx = Number(((Math.random() - 0.5) * 4.4).toFixed(2));
        const rz = Number(((Math.random() - 0.5) * 4.4).toFixed(2));
        nextSpec.actors[idx].position = [rx, 0, rz];
      }

      const popup: FloatingScoreFeedback = {
        id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        text: `+${pts} PTS · ${target.name}`,
        color: target.primaryColor || '#FBBF24',
        createdAt: Date.now(),
      };

      const burst: BurstVFXInstance = {
        id: `burst-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        position: burstPos,
        color: target.primaryColor || '#FBBF24',
        createdAt: Date.now(),
      };

      set((s) => ({
        sceneSpec: nextSpec,
        gameScore: nextScore,
        gameWon: s.gameWon || won,
        gameEnded: s.gameEnded || won,
        scorePopups: [...s.scorePopups.slice(-4), popup],
        burstEffects: [...s.burstEffects.slice(-5), burst],
      }));
    } else if (target.physicsRole === 'hazard') {
      const penalty = 10;
      const nextScore = Math.max(0, state.gameScore - penalty);
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const pIdx = nextSpec.actors.findIndex((a) => a.physicsRole === 'player');
      if (pIdx !== -1) {
        const p = nextSpec.actors[pIdx];
        const dx = p.position[0] - target.position[0] || 0.8;
        const dz = p.position[2] - target.position[2] || 0.8;
        const len = Math.hypot(dx, dz) || 1;
        p.position = [
          Number((p.position[0] + (dx / len) * 1.1).toFixed(2)),
          0,
          Number((p.position[2] + (dz / len) * 1.1).toFixed(2)),
        ];
      }

      const popup: FloatingScoreFeedback = {
        id: `pop-haz-${Date.now()}`,
        text: `-${penalty} PTS · HAZARD HIT!`,
        color: '#EF4444',
        createdAt: Date.now(),
      };

      set((s) => ({
        sceneSpec: nextSpec,
        gameScore: nextScore,
        scorePopups: [...s.scorePopups.slice(-4), popup],
      }));
    }
  },

  triggerActorInteraction: (actor) => {
    const state = get();

    if (actor.onClickAction === 'unbox-tap' || actor.assetId === 'mystery-gift-box') {
      const currentTaps = (state.unboxTapCounts[actor.id] || 0) + 1;
      const required = actor.unboxTapsRequired || 3;

      if (currentTaps < required) {
        const popup: FloatingScoreFeedback = {
          id: `pop-unbox-${Date.now()}`,
          text: `UNBOXING TAP ${currentTaps}/${required} · KEEP TAPPING!`,
          color: '#A855F7',
          createdAt: Date.now(),
        };
        const burst: BurstVFXInstance = {
          id: `burst-${Date.now()}`,
          position: [...actor.position],
          color: '#FBBF24',
          createdAt: Date.now(),
        };
        set((s) => ({
          selectedActorId: actor.id,
          gameScore: s.gameScore + 25,
          unboxTapCounts: { ...s.unboxTapCounts, [actor.id]: currentTaps },
          scorePopups: [...s.scorePopups.slice(-4), popup],
          burstEffects: [...s.burstEffects.slice(-5), burst],
        }));
        return;
      }

      const revealId = actor.revealAssetId || 'sports-sneaker-pro';
      const revealEntry = ASSET_REGISTRY[revealId] || ASSET_REGISTRY['sports-sneaker-pro'];
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const aIdx = nextSpec.actors.findIndex((a) => a.id === actor.id);
      if (aIdx !== -1) {
        nextSpec.actors[aIdx] = {
          ...nextSpec.actors[aIdx],
          name: `UNBOXED: ${revealEntry.name}`,
          assetId: revealEntry.assetId,
          primaryColor: revealEntry.defaultPrimaryColor,
          secondaryColor: revealEntry.defaultSecondaryColor,
          activeAnimation: 'spin',
          onClickAction: 'trigger-cta',
          scale: [1.3, 1.3, 1.3],
        };
      }
      nextSpec.vfx.push({
        id: `vfx-confetti-${Date.now()}`,
        name: 'Unboxing Confetti Explosion',
        type: 'confetti',
        position: [actor.position[0], 0.8, actor.position[2]],
        color: '#FBBF24',
        intensity: 1.6,
        scale: 1.5,
      });

      const winScore = Math.max(state.gameScore + 50, state.sceneSpec.gameRules.targetScore || 100);
      const popup: FloatingScoreFeedback = {
        id: `pop-unbox-win-${Date.now()}`,
        text: `UNBOXED ${revealEntry.name.toUpperCase()}! +50 PTS`,
        color: '#10B981',
        createdAt: Date.now(),
      };

      set((s) => ({
        sceneSpec: nextSpec,
        selectedActorId: actor.id,
        gameScore: winScore,
        gameWon: true,
        gameEnded: true,
        unboxTapCounts: { ...s.unboxTapCounts, [actor.id]: required },
        scorePopups: [...s.scorePopups.slice(-4), popup],
      }));
      return;
    }

    const pts = actor.scoreValue ?? 20;
    const nextScore = state.gameScore + pts;
    const targetScore = state.sceneSpec.gameRules.targetScore || 100;
    const won =
      state.sceneSpec.mode === 'game' &&
      (nextScore >= targetScore ||
        actor.onClickAction === 'trigger-cta' ||
        actor.onClickAction === 'cta-redirect');

    const nextSpec = cloneSceneSpec(state.sceneSpec);
    if (
      state.sceneSpec.mode === 'game' &&
      (actor.onClickAction === 'collect' ||
        actor.onClickAction === 'collect-score' ||
        actor.onClickAction === 'destroy')
    ) {
      const idx = nextSpec.actors.findIndex((a) => a.id === actor.id);
      if (idx !== -1) {
        if (actor.onClickAction === 'destroy') {
          nextSpec.actors[idx].visible = false;
        } else {
          nextSpec.actors[idx].position = [
            Number(((Math.random() - 0.5) * 4.2).toFixed(2)),
            0,
            Number(((Math.random() - 0.5) * 4.2).toFixed(2)),
          ];
        }
      }
    }

    const popup: FloatingScoreFeedback = {
      id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text: `+${pts} PTS · ${actor.name}`,
      color: actor.primaryColor || '#F59E0B',
      createdAt: Date.now(),
    };

    const burst: BurstVFXInstance = {
      id: `burst-${Date.now()}`,
      position: [...actor.position],
      color: actor.primaryColor || '#06B6D4',
      createdAt: Date.now(),
    };

    set((s) => ({
      sceneSpec: nextSpec,
      selectedActorId: actor.id,
      gameScore: nextScore,
      gameWon: s.gameWon || won,
      gameEnded: s.gameEnded || won,
      scorePopups: [...s.scorePopups.slice(-4), popup],
      burstEffects: [...s.burstEffects.slice(-5), burst],
    }));
  },

  addGameScore: (points, label, color = '#FBBF24') =>
    set((state) => {
      const nextScore = Math.max(0, state.gameScore + points);
      const targetScore = state.sceneSpec.gameRules.targetScore || 100;
      const won = nextScore >= targetScore;
      const popup: FloatingScoreFeedback = {
        id: `pop-2d-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        text: `${points >= 0 ? '+' : ''}${points} PTS · ${label}`,
        color,
        createdAt: Date.now(),
      };
      return {
        gameScore: nextScore,
        gameWon: state.gameWon || won,
        gameEnded: state.gameEnded || won,
        scorePopups: [...state.scorePopups.slice(-4), popup],
      };
    }),

  resetGameSession: () =>
    set((state) => {
      const tpl = SCENE_TEMPLATES[state.sceneSpec.id];
      const restoredSpec = tpl ? cloneSceneSpec(tpl) : cloneSceneSpec(state.sceneSpec);
      restoredSpec.mode = state.sceneSpec.mode;
      restoredSpec.actors.forEach((a) => (a.visible = true));
      restoredSpec.nodes2D.forEach((n) => (n.visible = true));
      return {
        sceneSpec: restoredSpec,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        unboxTapCounts: {},
        gameTimeRemaining: restoredSpec.gameRules.timeLimitSeconds || 15,
        scorePopups: [],
        burstEffects: [],
      };
    }),

  dismissEndCard: () => set({ gameEnded: false }),

  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg],
    })),

  setAgentThinking: (isAgentThinking) => set({ isAgentThinking }),
  setVisionRunning: (isVisionRunning) => set({ isVisionRunning }),
  setLatestVisionReport: (latestVisionReport) => set({ latestVisionReport }),

  applyVisionFixes: (report) =>
    set((state) => {
      const patchedSpec = cloneSceneSpec(report.proposedSceneSpec);
      const appliedReport: VisionQAReport = { ...report, applied: true };
      const confirmationMsg: ChatMessage = {
        id: `msg-vision-apply-${Date.now()}`,
        role: 'assistant',
        content: `Applied Vision QA spatial fixes: ${report.issues
          .map((i) => i.suggestedFixSummary)
          .join(' · ')}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        diffSummary: report.issues.map((i) => `Fixed [${i.category}]: ${i.suggestedFixSummary}`),
        previousSpecSnapshot: cloneSceneSpec(state.sceneSpec),
        updatedSpecSnapshot: patchedSpec,
      };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: patchedSpec,
        latestVisionReport: appliedReport,
        chatMessages: [...state.chatMessages, confirmationMsg],
      };
    }),

  updateSettings: (patch) =>
    set((state) => {
      const next = { ...state.settings, ...patch };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore quota errors
        }
      }
      return { settings: next };
    }),

  setPublishModalOpen: (isPublishModalOpen) => set({ isPublishModalOpen }),
  setSettingsModalOpen: (isSettingsModalOpen) => set({ isSettingsModalOpen }),
  setBottomDockCollapsed: (isBottomDockCollapsed) => set({ isBottomDockCollapsed }),
  setRecordingState: (isRecordingVideo, recordingProgress = 0) =>
    set({ isRecordingVideo, recordingProgress }),
}));
