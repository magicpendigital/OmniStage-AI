/**
 * The studio store. State and actions live in slices (src/state/slices/*); this file composes them with the shared
 * game runtime slice (src/runtime/gameSlice.ts) into one Zustand store. All SceneSpec mutations go through here.
 */
import { create } from 'zustand';
import { cloneSceneSpec } from '../registry/assetRegistry';
import { createGameRuntimeSlice } from '../runtime/gameSlice';
import { bindRuntimeStore } from '../runtime/host';
import { loadLearnedSkills } from '../agent/directorSkills';
import { INITIAL_EXECUTION_LOGS, initialScene2D, initialScene3D, loadInitialSettings } from './storeHelpers';
import type { StudioState } from './studioTypes';
import { createLogicGraphSlice } from './slices/logicGraphSlice';
import { createScenesSlice } from './slices/scenesSlice';
import { createWorldSlice } from './slices/worldSlice';
import { createActorsSlice } from './slices/actorsSlice';
import { createStageContentSlice } from './slices/stageContentSlice';
import { createAgentSlice } from './slices/agentSlice';
import { createWorkspaceSlice } from './slices/workspaceSlice';
import { createAssetLibrarySlice, loadInitialLibrary, loadInitialProjectName } from './slices/assetLibrarySlice';
export { assetKindForFileName } from './slices/assetLibrarySlice';
export { withCaptionIds } from './slices/stageContentSlice';

const initialLibrary = loadInitialLibrary();
export type { FloatingScoreFeedback, BurstVFXInstance } from '../runtime/gameSlice';
export { syncGraphWithScene } from '../runtime/graphSync';
export { DEFAULT_SETTINGS } from './storeHelpers';
export { buildProjectBundle } from './studioTypes';
export type { FullPreviewState, ProjectSaveState, ExtensionReviewRequest, StoryboardJobState, StudioState } from './studioTypes';

export const useStudioStore = create<StudioState>((set, get) => ({
  // Phase 7: game runtime (timeline, rules, logs, level progression) shared with the OmniStage Player.
  ...createGameRuntimeSlice<StudioState>(set, get),

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

  projectName: loadInitialProjectName(),
  favoriteAssetIds: initialLibrary.favoriteAssetIds,
  savedExternalAssets: initialLibrary.savedExternalAssets,
  assetCollections: initialLibrary.assetCollections,
  mountedFolderNames: [],

  selectedActorId: initialScene3D.actors[0]?.id ?? null,
  selectedNode2DId: null,
  selectedVfxId: null,
  transformMode: 'translate',
  isDraggingGizmo: false,
  isPublishModalOpen: false,
  isSettingsModalOpen: false,
  isBottomDockCollapsed: false,

  settings: loadInitialSettings(),
  learnedSkills: loadLearnedSkills(),
  workspaceAvailable: null,
  workspaceHome: null,
  activeProject: null,
  activeGameId: null,
  projectSaveState: 'idle',
  activeDraftId: null,
  draftSaveState: 'idle',
  draftSavedAt: null,
  staleDrafts: [],
  installedExtensions: [],
  memories: [],
  memoryEnabled: true,
  isProjectHubOpen: false,
  isExtensionsOpen: false,
  extensionReview: null,
  playTest: null,
  fullPreview: null,
  guide: { open: false, topicId: null },

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

  ...createLogicGraphSlice(set, get),
  ...createScenesSlice(set, get),
  ...createWorldSlice(set, get),
  ...createActorsSlice(set, get),
  ...createStageContentSlice(set, get),
  ...createAgentSlice(set, get),
  ...createWorkspaceSlice(set, get),
  ...createAssetLibrarySlice(set, get),

  setPublishModalOpen: (isPublishModalOpen) => set({ isPublishModalOpen }),
  setSettingsModalOpen: (isSettingsModalOpen) => set({ isSettingsModalOpen }),
  setBottomDockCollapsed: (isBottomDockCollapsed) => set({ isBottomDockCollapsed }),
  setRecordingState: (isRecordingVideo, recordingProgress = 0) =>
    set({ isRecordingVideo, recordingProgress }),
}) as StudioState);

// Phase 7: the shared runtime (logic graph, 2D simulation, game rules) talks to this store in the studio.
bindRuntimeStore(useStudioStore);
