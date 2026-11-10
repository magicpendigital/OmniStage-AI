/**
 * Phase 7C — StudioState and the types shared by the store slices (src/state/slices/*).
 */
import { ActorNode, AspectRatioPreset, CameraMode, CaptionCue, ChatMessage, DirectorSkill, EngineType, ExecutionLogEntry, LightingPresetId, LogicEdge, LogicNode, Node2D, Particle2DPreset, ScatterObjectType, SceneAudioSpec, SceneSpec, SemanticAssetEntry, SettingsConfig, StudioMode, TransformMode, VFXType, Vector3Tuple, VisionQAReport, WorkspaceViewMode, WorldSpec } from '../types/scene.schema';
import type { BurstVFXInstance, FloatingScoreFeedback } from '../runtime/gameSlice';
import type { ExtensionManifest, InstalledExtension, ParticleRecipe, SfxRecipe } from '../extensions/types';
import { MemoryEntry, MemoryKind, ProjectMeta } from '../workspace/workspaceClient';
import type { StoreApi } from 'zustand';

export interface FullPreviewState {
  order: string[];
  index: number;
  originalSceneId: string;
  wasLooping: boolean;
  ended: boolean;
  /** Undo history of the scene that was open; switchScene() clears it, so it is restored on exit. */
  savedPast: SceneSpec[];
  savedFuture: SceneSpec[];
}

export type ProjectSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ExtensionReviewRequest {
  manifest: ExtensionManifest;
  source: InstalledExtension['source'];
  reason?: string;
}

/** Studio-compatible bundle of the open game (same shape as Export → .scenespec.json and the MCP server). */
export function buildProjectBundle(state: { sceneSpec: SceneSpec; scenes: SceneSpec[] }) {
  const scenes = state.scenes.length ? state.scenes.map((s) => (s.id === state.sceneSpec.id ? state.sceneSpec : s)) : [state.sceneSpec];
  return { ...state.sceneSpec, projectBundleVersion: '3.1.0', activeSceneId: state.sceneSpec.id, scenes };
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



export interface StudioState {
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

  // Phase 4: Learned Director Skills (persisted in localStorage)
  learnedSkills: DirectorSkill[];

  // Phase 6: local workspace (projects on disk), extensions and memory
  workspaceAvailable: boolean | null;
  workspaceHome: string | null;
  activeProject: ProjectMeta | null;
  activeGameId: string | null;
  projectSaveState: ProjectSaveState;
  installedExtensions: InstalledExtension[];
  memories: MemoryEntry[];
  memoryEnabled: boolean;
  isProjectHubOpen: boolean;
  isExtensionsOpen: boolean;
  extensionReview: ExtensionReviewRequest | null;

  // Phase 6 batch 2: play test, full preview, guide
  playTest: { startSceneId: string } | null;
  fullPreview: FullPreviewState | null;
  guide: { open: boolean; topicId: string | null };

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

  // Phase 4: Director Skills & Procedural Audio
  saveLearnedSkill: (prompt: string, spec: SceneSpec, title?: string) => DirectorSkill;
  removeLearnedSkill: (skillId: string) => void;
  markSkillsUsed: (skillIds: string[]) => void;
  /** `library` copies extension SFX recipes into SceneSpec.sfxLibrary in the same undo step. */
  updateSceneAudio: (patch: Partial<SceneAudioSpec>, library?: Record<string, SfxRecipe>) => void;

  // Phase 6 batch 2: play test, full preview, guide
  openPlayTest: (startSceneId?: string) => void;
  closePlayTest: () => void;
  startFullPreview: (fromSceneId?: string) => void;
  gotoFullPreviewScene: (index: number) => void;
  endFullPreview: () => void;
  stopFullPreview: () => void;
  openGuide: (topicId?: string | null) => void;
  closeGuide: () => void;

  // Phase 6: workspace, projects, extensions, memory
  initWorkspace: () => Promise<void>;
  setProjectHubOpen: (open: boolean) => void;
  setExtensionsOpen: (open: boolean) => void;
  openExtensionReview: (request: ExtensionReviewRequest | null) => void;
  openProjectGame: (project: ProjectMeta, gameId: string) => Promise<void>;
  closeProject: () => void;
  saveActiveGame: () => Promise<boolean>;
  markProjectDirty: () => void;
  refreshExtensions: () => Promise<void>;
  refreshMemory: () => Promise<void>;
  addMemoryEntry: (text: string, kind?: MemoryKind, source?: MemoryEntry['source'], scope?: string) => Promise<MemoryEntry | null>;
  setDisabledSkill: (skillId: string, disabled: boolean) => void;

  // Phase 5: 2D particles & captions
  /** `recipe` is given for extension presets and copied into SceneSpec.particleLibrary. */
  addParticleEmitter2D: (preset: Particle2DPreset | string, recipe?: ParticleRecipe) => void;
  updateCaptions: (captions: CaptionCue[]) => void;

  // UI Modals
  setPublishModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setBottomDockCollapsed: (collapsed: boolean) => void;
  setRecordingState: (recording: boolean, progress?: number) => void;
}

/** Zustand set/get bound to the full studio state; every slice receives these. */
export type StudioSet = StoreApi<StudioState>['setState'];
export type StudioGet = StoreApi<StudioState>['getState'];
/** A slice contributes part of StudioState (state fields and/or actions). */
export type StudioSlice = Partial<StudioState>;

