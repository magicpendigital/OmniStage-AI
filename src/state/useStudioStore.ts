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
  ActorClickAction,
  ActorNode,
  AnimationType,
  AspectRatioPreset,
  CameraMode,
  ChatMessage,
  EngineType,
  ExecutionLogEntry,
  LightingPresetId,
  LogicEdge,
  LogicGraphSpec,
  LogicNode,
  Node2D,
  ScatterObjectType,
  SceneSpec,
  SemanticAssetEntry,
  SettingsConfig,
  SkyboxPreset,
  StudioMode,
  TransformMode,
  Vector3Tuple,
  VFXNode,
  VFXType,
  VisionQAReport,
  WeatherType,
  WorkspaceViewMode,
  WorldSpec,
} from '../types/scene.schema';

export interface FloatingScoreFeedback {
  id: string;
  text: string;
  color: string;
  createdAt: number;
}

export interface StoryboardJobState {
  storyboardId: string;
  title: string;
  status: 'planning' | 'generating' | 'done' | 'error';
  total: number;
  completed: number;
  currentLabel: string;
  source: 'gemini' | 'local';
  error?: string;
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
  polyPizzaApiKey: '',
  sketchfabApiToken: '',
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

/**
 * Bidirectional Sync Helper (`syncGraphWithScene`):
 * Populates a rich ComfyUI / n8n style visual LogicGraphSpec from any SceneSpec
 * if `scene.logicGraph` is missing or empty, and keeps actor/camera/rule references valid.
 */
export function syncGraphWithScene(scene: SceneSpec): SceneSpec {
  const cloned = cloneSceneSpec(scene);
  const existingNodes = cloned.logicGraph?.nodes || [];
  const existingEdges = cloned.logicGraph?.edges || [];

  if (existingNodes.length > 0) {
    // Sync existing node params with latest SceneSpec values
    const syncedNodes = existingNodes.map((node) => {
      const nextParams = { ...node.params };
      if (nextParams.actorId) {
        const actor = cloned.actors.find((a) => a.id === nextParams.actorId);
        if (actor) {
          nextParams.actorName = actor.name;
          if (node.category === 'actor-action') {
            nextParams.animation = actor.activeAnimation;
            nextParams.activeClip = actor.activeClip || actor.availableClips?.[0] || 'Idle';
            nextParams.speed = actor.animationSpeed ?? 1;
            nextParams.scoreDelta = actor.scoreValue ?? 25;
            nextParams.onClickAction = actor.onClickAction;
          }
        }
      }
      if (node.id === 'node-camera-track') {
        nextParams.cameraMode = cloned.camera.mode;
        nextParams.fov = cloned.camera.fov;
      }
      if (node.id === 'node-score-gate') {
        nextParams.targetScore = cloned.gameRules.targetScore;
        nextParams.timeLimitSeconds = cloned.gameRules.timeLimitSeconds;
      }
      if (node.id === 'node-world-stage') {
        nextParams.skybox = cloned.world?.skybox || 'daylight-sky';
        nextParams.weatherType = cloned.world?.weather?.type || 'clear';
        nextParams.terrainType = cloned.world?.terrain?.type || 'flat-grid';
      }
      return { ...node, params: nextParams };
    });

    cloned.logicGraph = {
      nodes: syncedNodes,
      edges: existingEdges,
    };
    return cloned;
  }

  // Build default visual node graph from SceneSpec
  const primaryActor = cloned.actors[0];
  const secondaryActor = cloned.actors[1] || cloned.actors[0];
  const firstVfx = cloned.vfx[0];

  const nodes: LogicNode[] = [
    {
      id: 'node-scene-start',
      type: 'trigger',
      title: 'On Scene Start',
      category: 'event-trigger',
      position: { x: 60, y: 70 },
      inputs: [],
      outputs: [
        { id: 'out-flow', label: 'Exec Flow', dataType: 'flow' },
        { id: 'out-signal', label: 'Init Signal', dataType: 'signal' },
      ],
      params: {
        eventType: 'scene-start',
        engineType: cloned.engineType,
        autoPlay: true,
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-actor-interact',
      type: 'trigger',
      title: 'On Actor Click / Tap',
      category: 'event-trigger',
      position: { x: 60, y: 300 },
      inputs: [],
      outputs: [
        { id: 'out-flow', label: 'Tap Flow', dataType: 'flow' },
        { id: 'out-actor', label: 'Clicked Actor', dataType: 'actor' },
      ],
      params: {
        eventType: 'actor-click',
        actorId: primaryActor?.id || '',
        actorName: primaryActor?.name || 'Stage Actor',
        inputKey: 'Pointer / WASD',
      },
      status: 'running',
      runCount: 2,
    },
    {
      id: 'node-world-stage',
      type: 'media-pipeline',
      title: 'World Stage & Atmosphere',
      category: 'camera-vfx',
      position: { x: 370, y: 50 },
      inputs: [{ id: 'in-flow', label: 'Init Flow', dataType: 'flow' }],
      outputs: [{ id: 'out-flow', label: 'Stage Ready', dataType: 'flow' }],
      params: {
        skybox: cloned.world?.skybox || 'daylight-sky',
        terrainType: cloned.world?.terrain?.type || 'flat-grid',
        weatherType: cloned.world?.weather?.type || 'clear',
        aspectRatio: cloned.aspectRatio,
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-actor-motion',
      type: 'action',
      title: `Play Animation · ${primaryActor?.name || 'Hero Rig'}`,
      category: 'actor-action',
      position: { x: 370, y: 270 },
      inputs: [
        { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
        { id: 'in-actor', label: 'Target Actor', dataType: 'actor' },
      ],
      outputs: [
        { id: 'out-flow', label: 'Next Action', dataType: 'flow' },
        { id: 'out-score', label: 'Score Delta', dataType: 'number' },
      ],
      params: {
        actorId: primaryActor?.id || '',
        actorName: primaryActor?.name || 'Hero Rig',
        animation: primaryActor?.activeAnimation || 'idle',
        activeClip: primaryActor?.activeClip || primaryActor?.availableClips?.[0] || 'Idle',
        speed: primaryActor?.animationSpeed ?? 1,
        scoreDelta: primaryActor?.scoreValue ?? 25,
        onClickAction: primaryActor?.onClickAction || 'collect',
      },
      status: 'running',
      runCount: 3,
    },
    {
      id: 'node-score-gate',
      type: 'condition',
      title: 'If Score >= Target Goal',
      category: 'logic-gate',
      position: { x: 690, y: 250 },
      inputs: [
        { id: 'in-flow', label: 'Check Flow', dataType: 'flow' },
        { id: 'in-val', label: 'Current Score', dataType: 'number' },
      ],
      outputs: [
        { id: 'out-true', label: 'Goal Met (True)', dataType: 'flow' },
        { id: 'out-false', label: 'Keep Playing', dataType: 'flow' },
      ],
      params: {
        conditionType: 'score-threshold',
        targetScore: cloned.gameRules.targetScore || 100,
        timeLimitSeconds: cloned.gameRules.timeLimitSeconds || 30,
        cooldownMs: 250,
      },
      status: 'idle',
      runCount: 2,
    },
    {
      id: 'node-camera-track',
      type: 'action',
      title: 'Switch Camera & Spawn VFX',
      category: 'camera-vfx',
      position: { x: 690, y: 40 },
      inputs: [{ id: 'in-flow', label: 'Stage Flow', dataType: 'flow' }],
      outputs: [{ id: 'out-flow', label: 'Render Out', dataType: 'flow' }],
      params: {
        cameraMode: cloned.camera.mode,
        fov: cloned.camera.fov || 45,
        vfxId: firstVfx?.id || '',
        vfxType: firstVfx?.type || 'sparkles',
        actorId: secondaryActor?.id || primaryActor?.id || '',
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-robot-servo',
      type: 'robot-hardware',
      title: 'Phygital Bridge · Servo & OLED',
      category: 'robot-servo-io',
      position: { x: 1000, y: 60 },
      inputs: [
        { id: 'in-flow', label: 'Sync Signal', dataType: 'flow' },
        { id: 'in-angle', label: 'Angle (deg)', dataType: 'number' },
      ],
      outputs: [{ id: 'out-telemetry', label: 'HW Telemetry', dataType: 'signal' }],
      params: {
        servoChannel: 'Ch 1 (Head Pan)',
        servoAngle: 45,
        oledExpression: 'cyber-happy',
        voiceTtsText: 'Target locked! Ready for action.',
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-cta-endcard',
      type: 'media-pipeline',
      title: 'Trigger CTA & MRAID Output',
      category: 'audio-caption',
      position: { x: 1000, y: 280 },
      inputs: [{ id: 'in-flow', label: 'On Goal Met', dataType: 'flow' }],
      outputs: [],
      params: {
        headline: cloned.marketingOverlay.headline,
        ctaText: cloned.marketingOverlay.ctaText,
        exportFormat: 'TikTok MRAID 3.0 / WebM 60fps',
      },
      status: 'idle',
      runCount: 0,
    },
  ];

  const edges: LogicEdge[] = [
    {
      id: 'edge-start-world',
      sourceNodeId: 'node-scene-start',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-world-stage',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-world-cam',
      sourceNodeId: 'node-world-stage',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-camera-track',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-cam-robot',
      sourceNodeId: 'node-camera-track',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-robot-servo',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-tap-motion',
      sourceNodeId: 'node-actor-interact',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-actor-motion',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-tap-actor-ref',
      sourceNodeId: 'node-actor-interact',
      sourcePortId: 'out-actor',
      targetNodeId: 'node-actor-motion',
      targetPortId: 'in-actor',
      active: true,
    },
    {
      id: 'edge-motion-gate',
      sourceNodeId: 'node-actor-motion',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-score-gate',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-score-val',
      sourceNodeId: 'node-actor-motion',
      sourcePortId: 'out-score',
      targetNodeId: 'node-score-gate',
      targetPortId: 'in-val',
      active: true,
    },
    {
      id: 'edge-gate-cta',
      sourceNodeId: 'node-score-gate',
      sourcePortId: 'out-true',
      targetNodeId: 'node-cta-endcard',
      targetPortId: 'in-flow',
      active: false,
    },
  ];

  cloned.logicGraph = { nodes, edges };
  return cloned;
}

interface StudioState {
  // Multi-Scene Storyboard & Active SceneSpec
  scenes: SceneSpec[];
  activeSceneId: string;
  sceneSpec: SceneSpec;
  pastSpecs: SceneSpec[];
  futureSpecs: SceneSpec[];

  // Phase 5: Workspace View Mode & Logic Graph Execution Console
  workspaceView: WorkspaceViewMode;
  focusedLogicNodeId: string | null;
  executionLogs: ExecutionLogEntry[];
  isConsoleOpen: boolean;
  pendingAgentFixPrompt: string | null;

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

  // Actions — Phase 5 Workspace View, Node Graph & Execution Console
  setWorkspaceView: (view: WorkspaceViewMode) => void;
  setFocusedLogicNodeId: (nodeId: string | null) => void;
  setConsoleOpen: (open: boolean) => void;
  appendLog: (
    entry: Omit<ExecutionLogEntry, 'id' | 'timestamp' | 'sceneTime'> & {
      id?: string;
      timestamp?: string;
      sceneTime?: number;
    }
  ) => void;
  clearLogs: () => void;
  markNodeExecution: (
    nodeId: string,
    status: 'idle' | 'running' | 'success' | 'error',
    errorMessage?: string
  ) => void;
  addLogicNode: (node: Omit<LogicNode, 'id'> & { id?: string }) => void;
  updateLogicNode: (id: string, partial: Partial<LogicNode>) => void;
  removeLogicNode: (id: string) => void;
  connectLogicEdge: (edge: Omit<LogicEdge, 'id'> & { id?: string }) => void;
  removeLogicEdge: (edgeId: string) => void;
  autoLayoutLogicGraph: () => void;
  simulateNodeExecution: (nodeId: string) => void;
  triggerAgentAutoFix: (logEntry: ExecutionLogEntry) => void;
  clearPendingAgentFixPrompt: () => void;

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

  // Multi-Scene Storyboard Generation (AI Director multi-step pipeline)
  storyboardJob: StoryboardJobState | null;
  setStoryboardJob: (job: StoryboardJobState | null) => void;
  appendStoryboardScene: (spec: SceneSpec, activate?: boolean) => void;
  linkStoryboardScenes: (storyboardId: string, activateFirst?: boolean) => void;
  advanceToNextScene: () => boolean;

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

const initialScene3D = syncGraphWithScene(
  createBlankSceneSpec('3d', 'Scene 1 · 3D Authoring Stage')
);
const initialScene2D = syncGraphWithScene(
  createBlankSceneSpec('2d', 'Scene 2 · 2D Vector & Platformer Stage')
);

const INITIAL_EXECUTION_LOGS: ExecutionLogEntry[] = [
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

  workspaceView: 'viewport',
  focusedLogicNodeId: null,
  executionLogs: INITIAL_EXECUTION_LOGS,
  isConsoleOpen: true,
  pendingAgentFixPrompt: null,

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
      id: 'msg-welcome-v5',
      role: 'assistant',
      content:
        'Welcome to OmniStage AI (Phase 5 Visual Logic Node Graph & Execution Console). Switch between [3D/2D Viewport], [Logic Node Graph (n8n/ComfyUI)], and [Split View] at the top of the stage to wire triggers, conditions, actions, and Phygital Robot Servo I/O nodes bidirectionally with your live scene.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      diffSummary: [
        'Initialized Bidirectional LogicGraphSpec (8 nodes, 8 cubic Bezier wires)',
        'Connected Real-Time Execution Console with One-Click AI Auto-Fix',
      ],
    },
  ],
  isAgentThinking: false,
  storyboardJob: null,
  isVisionRunning: false,
  latestVisionReport: null,

  canvasElement: null,
  isRecordingVideo: false,
  recordingProgress: 0,

  // ================= PHASE 5: NODE GRAPH & EXECUTION CONSOLE ACTIONS =================
  setWorkspaceView: (workspaceView) => set({ workspaceView }),

  setFocusedLogicNodeId: (focusedLogicNodeId) =>
    set((state) => ({
      focusedLogicNodeId,
      workspaceView:
        focusedLogicNodeId && state.workspaceView === 'viewport' ? 'split' : state.workspaceView,
    })),

  setConsoleOpen: (isConsoleOpen) => set({ isConsoleOpen }),

  appendLog: (entry) =>
    set((state) => {
      const fullEntry: ExecutionLogEntry = {
        id: entry.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp:
          entry.timestamp ||
          new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        sceneTime: entry.sceneTime ?? Number(state.currentTime.toFixed(2)),
        level: entry.level,
        nodeId: entry.nodeId,
        actorId: entry.actorId,
        message: entry.message,
        payload: entry.payload,
      };
      return {
        executionLogs: [...state.executionLogs.slice(-99), fullEntry],
      };
    }),

  clearLogs: () => set({ executionLogs: [] }),

  markNodeExecution: (nodeId, status, errorMessage) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          status,
          runCount: status === 'running' || status === 'success' ? (n.runCount || 0) + 1 : n.runCount,
          errorMessage: status === 'error' ? errorMessage || 'Execution fault detected' : undefined,
        };
      });
      nextSpec.logicGraph.edges = nextSpec.logicGraph.edges.map((e) =>
        e.sourceNodeId === nodeId ? { ...e, active: status !== 'error' } : e
      );
      return { sceneSpec: nextSpec };
    }),

  addLogicNode: (nodeInput) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      const graph: LogicGraphSpec = nextSpec.logicGraph || { nodes: [], edges: [] };
      const newNode: LogicNode = {
        ...nodeInput,
        id: nodeInput.id || `node-${Date.now().toString(36)}`,
        status: nodeInput.status || 'idle',
        runCount: nodeInput.runCount ?? 0,
      };
      graph.nodes.push(newNode);
      nextSpec.logicGraph = graph;
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));

      const logEntry: ExecutionLogEntry = {
        id: `log-add-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'info',
        nodeId: newNode.id,
        message: `Added [${newNode.type.toUpperCase()}] node "${newNode.title}" to Logic Graph.`,
      };

      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        focusedLogicNodeId: newNode.id,
        executionLogs: [...state.executionLogs.slice(-99), logEntry],
      };
    }),

  updateLogicNode: (nodeId, partial) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      const graph = nextSpec.logicGraph!;
      const idx = graph.nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) return state;

      const prevNode = graph.nodes[idx];
      const mergedParams = partial.params
        ? { ...prevNode.params, ...partial.params }
        : prevNode.params;

      const updatedNode: LogicNode = {
        ...prevNode,
        ...partial,
        params: mergedParams,
      };
      graph.nodes[idx] = updatedNode;

      // Bidirectional Sync: Apply node parameter edits directly to SceneSpec!
      let syncLogMessage: string | null = null;

      if (partial.params) {
        const p = mergedParams;
        const targetActorId = p.actorId || state.selectedActorId || nextSpec.actors[0]?.id;
        const actorIdx = nextSpec.actors.findIndex((a) => a.id === targetActorId);

        if (actorIdx !== -1 && updatedNode.category === 'actor-action') {
          const actor = nextSpec.actors[actorIdx];
          if (p.animation && p.animation !== actor.activeAnimation) {
            actor.activeAnimation = p.animation as AnimationType;
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" animation = ${p.animation}`;
          }
          if (p.activeClip && p.activeClip !== actor.activeClip) {
            actor.activeClip = String(p.activeClip);
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" GLTF skeletal clip = ${p.activeClip}`;
          }
          if (p.speed !== undefined) {
            const spd = Number(p.speed);
            if (!Number.isNaN(spd) && spd > 0) {
              actor.animationSpeed = spd;
              syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" animationSpeed = ${spd}x`;
            }
          }
          if (p.scoreDelta !== undefined) {
            actor.scoreValue = Number(p.scoreDelta) || 0;
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" scoreValue = +${actor.scoreValue} PTS`;
          }
          if (p.onClickAction) {
            actor.onClickAction = p.onClickAction as ActorClickAction;
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" onClickAction = ${p.onClickAction}`;
          }
        }

        if (p.cameraMode && p.cameraMode !== nextSpec.camera.mode) {
          nextSpec.camera.mode = p.cameraMode as CameraMode;
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Camera Rig mode = ${p.cameraMode}`;
        }

        if (p.fov !== undefined && Number(p.fov) !== nextSpec.camera.fov) {
          nextSpec.camera.fov = Math.max(20, Math.min(110, Number(p.fov) || 45));
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Camera FOV = ${nextSpec.camera.fov}°`;
        }

        if (p.targetScore !== undefined && updatedNode.category === 'logic-gate') {
          nextSpec.gameRules.targetScore = Math.max(10, Number(p.targetScore) || 100);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> GameRule targetScore = ${nextSpec.gameRules.targetScore} PTS`;
        }

        if (p.timeLimitSeconds !== undefined && updatedNode.category === 'logic-gate') {
          nextSpec.gameRules.timeLimitSeconds = Math.max(5, Number(p.timeLimitSeconds) || 30);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> GameRule timeLimit = ${nextSpec.gameRules.timeLimitSeconds}s`;
        }

        if (p.skybox && p.skybox !== nextSpec.world.skybox) {
          nextSpec.world.skybox = p.skybox as SkyboxPreset;
          syncLogMessage = `Synced Node [${updatedNode.title}] -> World skybox = ${p.skybox}`;
        }

        if (p.weatherType && p.weatherType !== nextSpec.world.weather.type) {
          nextSpec.world.weather.type = p.weatherType as WeatherType;
          syncLogMessage = `Synced Node [${updatedNode.title}] -> World weather = ${p.weatherType}`;
        }

        if (p.headline !== undefined && updatedNode.type === 'media-pipeline') {
          nextSpec.marketingOverlay.headline = String(p.headline);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Marketing Headline = "${p.headline}"`;
        }

        if (p.ctaText !== undefined && updatedNode.type === 'media-pipeline') {
          nextSpec.marketingOverlay.ctaText = String(p.ctaText);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Marketing CTA = "${p.ctaText}"`;
        }

        if (updatedNode.type === 'robot-hardware') {
          const angle = Number(p.servoAngle ?? 45);
          if (angle < 0 || angle > 180) {
            updatedNode.status = 'error';
            updatedNode.errorMessage = `Servo angle ${angle}° exceeds safe mechanical range [0°..180°]`;
            syncLogMessage = `Hardware Limit Fault on [${updatedNode.title}]: Servo angle ${angle}° out of bounds [0°..180°]!`;
          } else {
            updatedNode.status = 'success';
            updatedNode.errorMessage = undefined;
            syncLogMessage = `Phygital I/O Sync [${updatedNode.title}]: ${p.servoChannel || 'Ch 1'} -> ${angle}°, OLED="${p.oledExpression || 'cyber-happy'}"`;
          }
        }
      }

      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      const nextLogs = [...state.executionLogs];

      if (syncLogMessage) {
        nextLogs.push({
          id: `log-sync-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          sceneTime: Number(state.currentTime.toFixed(2)),
          level: updatedNode.status === 'error' ? 'error' : 'action',
          nodeId: updatedNode.id,
          actorId: mergedParams.actorId,
          message: syncLogMessage,
          payload: mergedParams,
        });
      }

      return {
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        executionLogs: nextLogs.slice(-100),
      };
    }),

  removeLogicNode: (id) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      const target = nextSpec.logicGraph.nodes.find((n) => n.id === id);
      nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.filter((n) => n.id !== id);
      nextSpec.logicGraph.edges = nextSpec.logicGraph.edges.filter(
        (e) => e.sourceNodeId !== id && e.targetNodeId !== id
      );
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      const nextLogs = [
        ...state.executionLogs.slice(-99),
        {
          id: `log-rm-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          sceneTime: Number(state.currentTime.toFixed(2)),
          level: 'warn' as const,
          message: `Removed logic node "${target?.title || id}" and disconnected its wires.`,
        },
      ];
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        executionLogs: nextLogs,
      };
    }),

  connectLogicEdge: (edgeInput) =>
    set((state) => {
      if (edgeInput.sourceNodeId === edgeInput.targetNodeId) return state;
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      const graph = nextSpec.logicGraph!;
      const exists = graph.edges.some(
        (e) =>
          e.sourceNodeId === edgeInput.sourceNodeId &&
          e.sourcePortId === edgeInput.sourcePortId &&
          e.targetNodeId === edgeInput.targetNodeId &&
          e.targetPortId === edgeInput.targetPortId
      );
      if (exists) return state;

      const newEdge: LogicEdge = {
        ...edgeInput,
        id: edgeInput.id || `edge-${Date.now().toString(36)}`,
        active: true,
      };
      graph.edges.push(newEdge);

      const srcNode = graph.nodes.find((n) => n.id === newEdge.sourceNodeId);
      const dstNode = graph.nodes.find((n) => n.id === newEdge.targetNodeId);

      const logEntry: ExecutionLogEntry = {
        id: `log-wire-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'info',
        nodeId: dstNode?.id,
        message: `Connected wire: [${srcNode?.title || newEdge.sourceNodeId}] -> [${dstNode?.title || newEdge.targetNodeId}].`,
      };

      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        executionLogs: [...state.executionLogs.slice(-99), logEntry],
      };
    }),

  removeLogicEdge: (edgeId) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      nextSpec.logicGraph.edges = nextSpec.logicGraph.edges.filter((e) => e.id !== edgeId);
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        sceneSpec: nextSpec,
        scenes: updatedScenes,
      };
    }),

  autoLayoutLogicGraph: () =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      const columnMap: Record<LogicNode['type'], number> = {
        trigger: 60,
        condition: 380,
        action: 700,
        'media-pipeline': 1020,
        'robot-hardware': 1020,
      };
      const rowCounters: Record<number, number> = {};

      nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.map((node) => {
        const colX = columnMap[node.type] ?? 380;
        const rowIndex = rowCounters[colX] ?? 0;
        rowCounters[colX] = rowIndex + 1;
        return {
          ...node,
          position: {
            x: colX,
            y: 60 + rowIndex * 230,
          },
        };
      });
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        sceneSpec: nextSpec,
        scenes: updatedScenes,
      };
    }),

  simulateNodeExecution: (nodeId) => {
    const state = get();
    const graph = state.sceneSpec.logicGraph;
    if (!graph) return;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Validate potential errors so debugger & AI Auto-Fix can be tested
    if (
      node.type === 'robot-hardware' &&
      (Number(node.params.servoAngle) < 0 || Number(node.params.servoAngle) > 180)
    ) {
      state.markNodeExecution(
        node.id,
        'error',
        `Servo angle ${node.params.servoAngle}° out of safe bounds [0°..180°]`
      );
      state.appendLog({
        level: 'error',
        nodeId: node.id,
        message: `Execution Error in [${node.title}]: Servo angle ${node.params.servoAngle}° exceeds hardware limit [0°..180°].`,
        payload: node.params,
      });
      return;
    }

    if (
      node.category === 'actor-action' &&
      node.params.actorId &&
      !state.sceneSpec.actors.some((a) => a.id === node.params.actorId)
    ) {
      state.markNodeExecution(node.id, 'error', `Missing target actor ID: ${node.params.actorId}`);
      state.appendLog({
        level: 'error',
        nodeId: node.id,
        actorId: node.params.actorId,
        message: `Null Actor Reference in [${node.title}]: Target actor '${node.params.actorId}' no longer exists on stage.`,
        payload: node.params,
      });
      return;
    }

    // Normal execution pulse
    state.markNodeExecution(node.id, 'success');

    if (node.category === 'actor-action') {
      const targetActor =
        state.sceneSpec.actors.find((a) => a.id === node.params.actorId) ||
        state.sceneSpec.actors[0];
      if (targetActor) {
        state.triggerActorInteraction(targetActor);
      }
    } else if (node.type === 'condition') {
      const met = state.gameScore >= (Number(node.params.targetScore) || 100);
      state.appendLog({
        level: met ? 'trigger' : 'warn',
        nodeId: node.id,
        message: `Evaluated [${node.title}]: Score ${state.gameScore} / ${node.params.targetScore || 100} -> ${met ? 'TRUE (Goal Met)' : 'FALSE (Below Threshold)'}.`,
        payload: { currentScore: state.gameScore, targetScore: node.params.targetScore },
      });
    } else {
      state.appendLog({
        level: node.type === 'trigger' ? 'trigger' : 'action',
        nodeId: node.id,
        message: `Executed node [${node.title}] (${node.category}) successfully.`,
        payload: node.params,
      });
    }
  },

  triggerAgentAutoFix: (logEntry) =>
    set((state) => {
      const brokenNode = state.sceneSpec.logicGraph?.nodes.find((n) => n.id === logEntry.nodeId);
      const fixPrompt = `Auto-Fix Execution Issue on Node "${brokenNode?.title || logEntry.nodeId || 'Stage Logic'}": ${logEntry.message} (Please update the SceneSpec actors, gameRules, or logicGraph parameters so this node executes cleanly without warnings or errors).`;
      return {
        pendingAgentFixPrompt: fixPrompt,
      };
    }),

  clearPendingAgentFixPrompt: () => set({ pendingAgentFixPrompt: null }),

  // ================= MULTI-SCENE & ENGINE AUTHORING ACTIONS =================
  setCanvasElement: (el) => set({ canvasElement: el }),

  setSceneSpec: (nextSpec) =>
    set((state) => {
      const synced = syncGraphWithScene(nextSpec);
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? synced : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: synced,
        scenes: updatedScenes,
        gameTimeRemaining: synced.gameRules.timeLimitSeconds,
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
      const synced = syncGraphWithScene(nextSpec);
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? synced : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: synced,
        scenes: updatedScenes,
        selectedNode2DId: synced.nodes2D[0]?.id ?? null,
      };
    }),

  createNewBlankScene: (engineType, title) =>
    set((state) => {
      const newScene = syncGraphWithScene(
        createBlankSceneSpec(
          engineType,
          title || `Scene ${state.scenes.length + 1} · ${engineType.toUpperCase()} Stage`
        )
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
      const savedScenes = state.scenes.map((s) =>
        s.id === state.activeSceneId ? cloneSceneSpec(state.sceneSpec) : s
      );
      const target = savedScenes.find((s) => s.id === sceneId);
      if (!target) return state;
      const cloned = syncGraphWithScene(target);
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
      const copy = syncGraphWithScene(source);
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
        state.activeSceneId === sceneId
          ? remaining[0]
          : remaining.find((s) => s.id === state.activeSceneId) || remaining[0];
      return {
        scenes: remaining,
        activeSceneId: nextActive.id,
        sceneSpec: syncGraphWithScene(nextActive),
      };
    }),

  loadProjectBundle: (bundleScenes, preferredActiveId) =>
    set((state) => {
      if (!Array.isArray(bundleScenes) || bundleScenes.length === 0) return state;
      const sanitized = bundleScenes.map((s) => syncGraphWithScene(s));
      const active = sanitized.find((s) => s.id === preferredActiveId) || sanitized[0];
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
    cloned.logicGraph = undefined; // Force fresh graph generation for the loaded template
    const synced = syncGraphWithScene(cloned);
    set((state) => {
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? synced : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: synced,
        scenes: updatedScenes,
        selectedActorId: synced.actors[0]?.id ?? null,
        selectedNode2DId: synced.nodes2D[0]?.id ?? null,
        currentTime: 0,
        isPlaying: true,
        gameScore: 0,
        gameWon: false,
        gameEnded: false,
        unboxTapCounts: {},
        burstEffects: [],
        gameTimeRemaining: synced.gameRules.timeLimitSeconds,
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
        sceneSpec: syncGraphWithScene(previous),
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
        sceneSpec: syncGraphWithScene(next),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
      };
    }),

  updateTerrain: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.terrain = { ...nextSpec.world.terrain, ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
      return { sceneSpec: syncGraphWithScene(nextSpec) };
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
        sceneSpec: syncGraphWithScene(nextSpec),
        selectedActorId: copy.id,
      };
    }),

  spawnAsset: (assetId, customGlbUrl, customName) =>
    set((state) => {
      const customFound = state.customRegistryAssets.find((c) => c.assetId === assetId);
      const entry =
        customFound ?? ASSET_REGISTRY[assetId] ?? ASSET_REGISTRY['starter-primitive-showcase'];
      const nextSpec = syncGraphWithScene(state.sceneSpec);
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

      // Automatically add an Action node for the newly spawned actor in the LogicGraph
      if (nextSpec.logicGraph) {
        const nodeCount = nextSpec.logicGraph.nodes.length;
        const newNodeId = `node-actor-${newActor.id}`;
        nextSpec.logicGraph.nodes.push({
          id: newNodeId,
          type: 'action',
          title: `Actor · ${newActor.name}`,
          category: 'actor-action',
          position: { x: 370, y: 120 + (nodeCount % 4) * 190 },
          inputs: [
            { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
            { id: 'in-actor', label: 'Actor Ref', dataType: 'actor' },
          ],
          outputs: [
            { id: 'out-flow', label: 'Next Action', dataType: 'flow' },
            { id: 'out-score', label: 'Score Delta', dataType: 'number' },
          ],
          params: {
            actorId: newActor.id,
            actorName: newActor.name,
            animation: newActor.activeAnimation,
            activeClip: newActor.activeClip || 'Idle',
            speed: 1,
            scoreDelta: newActor.scoreValue ?? 25,
            onClickAction: newActor.onClickAction,
          },
          status: 'success',
          runCount: 1,
        });
        nextSpec.logicGraph.edges.push({
          id: `edge-spawn-${newActor.id}`,
          sourceNodeId: 'node-actor-interact',
          sourcePortId: 'out-flow',
          targetNodeId: newNodeId,
          targetPortId: 'in-flow',
          active: true,
        });
      }

      const spawnLog: ExecutionLogEntry = {
        id: `log-spawn-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'action',
        actorId: newActor.id,
        nodeId: `node-actor-${newActor.id}`,
        message: `Spawned 3D Actor "${newActor.name}" at [${spawnPos.join(', ')}] and linked Action Node in Logic Graph.`,
      };

      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId: newActor.id,
        executionLogs: [...state.executionLogs.slice(-99), spawnLog],
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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
        sceneSpec: syncGraphWithScene(nextSpec),
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

      const logEntry: ExecutionLogEntry = {
        id: `log-col-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'trigger',
        nodeId: 'node-score-gate',
        actorId: target.id,
        message: `Collision Trigger: Collected "${target.name}" (+${pts} PTS -> Total: ${nextScore}/${targetScore}).`,
      };

      set((s) => ({
        sceneSpec: nextSpec,
        gameScore: nextScore,
        gameWon: s.gameWon || won,
        gameEnded: s.gameEnded || won,
        scorePopups: [...s.scorePopups.slice(-4), popup],
        burstEffects: [...s.burstEffects.slice(-5), burst],
        executionLogs: [...s.executionLogs.slice(-99), logEntry],
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

      const logEntry: ExecutionLogEntry = {
        id: `log-haz-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'warn',
        nodeId: 'node-actor-interact',
        actorId: target.id,
        message: `Hazard Collision on "${target.name}": -${penalty} PTS penalty applied.`,
      };

      set((s) => ({
        sceneSpec: nextSpec,
        gameScore: nextScore,
        scorePopups: [...s.scorePopups.slice(-4), popup],
        executionLogs: [...s.executionLogs.slice(-99), logEntry],
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
        sceneSpec: syncGraphWithScene(nextSpec),
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

    // Pulse matching LogicGraph nodes on interaction
    if (nextSpec.logicGraph) {
      nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.map((n) => {
        if (
          n.id === 'node-actor-interact' ||
          n.id === 'node-actor-motion' ||
          n.params.actorId === actor.id ||
          (won && (n.id === 'node-score-gate' || n.id === 'node-cta-endcard'))
        ) {
          return {
            ...n,
            status: 'success',
            runCount: (n.runCount || 0) + 1,
          };
        }
        return n;
      });
      nextSpec.logicGraph.edges = nextSpec.logicGraph.edges.map((e) =>
        e.id === 'edge-gate-cta' && won ? { ...e, active: true } : e
      );
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

    const logEntry: ExecutionLogEntry = {
      id: `log-tap-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      sceneTime: Number(state.currentTime.toFixed(2)),
      level: 'trigger',
      nodeId: 'node-actor-interact',
      actorId: actor.id,
      message: `Fired [On Actor Click] on "${actor.name}" -> Action [${actor.onClickAction}] (+${pts} PTS, Total: ${nextScore}/${targetScore}).`,
    };

    set((s) => ({
      sceneSpec: nextSpec,
      selectedActorId: actor.id,
      gameScore: nextScore,
      gameWon: s.gameWon || won,
      gameEnded: s.gameEnded || won,
      scorePopups: [...s.scorePopups.slice(-4), popup],
      burstEffects: [...s.burstEffects.slice(-5), burst],
      executionLogs: [...s.executionLogs.slice(-99), logEntry],
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
      const restoredSpec = tpl
        ? syncGraphWithScene(cloneSceneSpec(tpl))
        : syncGraphWithScene(cloneSceneSpec(state.sceneSpec));
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
      const patchedSpec = syncGraphWithScene(cloneSceneSpec(report.proposedSceneSpec));
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

  setStoryboardJob: (storyboardJob) => set({ storyboardJob }),

  appendStoryboardScene: (spec, activate = true) => {
    const cloned = cloneSceneSpec(spec);
    set((state) => {
      // Persist in-progress edits of the active scene before appending
      const savedScenes = state.scenes.map((s) =>
        s.id === state.activeSceneId ? cloneSceneSpec(state.sceneSpec) : s
      );
      const withoutDup = savedScenes.filter((s) => s.id !== cloned.id);
      return { scenes: [...withoutDup, cloned] };
    });
    if (activate) get().switchScene(cloned.id);
  },

  linkStoryboardScenes: (storyboardId, activateFirst = true) => {
    set((state) => {
      const savedScenes = state.scenes.map((s) =>
        s.id === state.activeSceneId ? cloneSceneSpec(state.sceneSpec) : s
      );
      const members = savedScenes
        .filter((s) => s.sequence?.storyboardId === storyboardId)
        .sort((a, b) => (a.sequence!.index ?? 0) - (b.sequence!.index ?? 0));
      if (members.length === 0) return state;
      const linkedById = new Map<string, SceneSpec>();
      members.forEach((m, i) => {
        const next = cloneSceneSpec(m);
        next.sequence = {
          ...next.sequence!,
          index: i,
          total: members.length,
          nextSceneId: members[i + 1]?.id,
        };
        linkedById.set(next.id, next);
      });
      const scenes = savedScenes.map((s) => linkedById.get(s.id) ?? s);
      const active = linkedById.get(state.activeSceneId);
      return active ? { scenes, sceneSpec: cloneSceneSpec(active) } : { scenes };
    });
    if (activateFirst) {
      const first = get().scenes.find(
        (s) => s.sequence?.storyboardId === storyboardId && s.sequence.index === 0
      );
      if (first) get().switchScene(first.id);
    }
  },

  advanceToNextScene: () => {
    const state = get();
    const nextId = state.sceneSpec.sequence?.nextSceneId;
    if (!nextId || !state.scenes.some((s) => s.id === nextId)) return false;
    get().switchScene(nextId);
    const target = get().sceneSpec;
    set({
      isPlaying: true,
      gameEnded: false,
      gameWon: false,
      gameScore: 0,
      unboxTapCounts: {},
      burstEffects: [],
      gameTimeRemaining: target.gameRules.timeLimitSeconds,
    });
    return true;
  },

  setPublishModalOpen: (isPublishModalOpen) => set({ isPublishModalOpen }),
  setSettingsModalOpen: (isSettingsModalOpen) => set({ isSettingsModalOpen }),
  setBottomDockCollapsed: (isBottomDockCollapsed) => set({ isBottomDockCollapsed }),
  setRecordingState: (isRecordingVideo, recordingProgress = 0) =>
    set({ isRecordingVideo, recordingProgress }),
}));
