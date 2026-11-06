import { create } from 'zustand';
import {
  ASSET_REGISTRY,
  cloneSceneSpec,
  LIGHTING_PRESETS,
  SCENE_TEMPLATES,
} from '../registry/assetRegistry';
import {
  ActorNode,
  AspectRatioPreset,
  CameraMode,
  ChatMessage,
  LightingPresetId,
  SceneSpec,
  StudioMode,
  Vector3Tuple,
  VFXNode,
  VFXType,
  VisionQAReport,
} from '../types/scene.schema';

export interface FloatingScoreFeedback {
  id: string;
  text: string;
  color: string;
  createdAt: number;
}

interface StudioState {
  // Core SceneSpec + Undo/Redo History
  sceneSpec: SceneSpec;
  pastSpecs: SceneSpec[];
  futureSpecs: SceneSpec[];

  // Selection & Active UI Tabs
  selectedActorId: string | null;
  selectedVfxId: string | null;
  isPublishModalOpen: boolean;
  isBottomDockCollapsed: boolean;

  // Timeline & Playback State
  isPlaying: boolean;
  currentTime: number;

  // Playable Game Runtime State
  gameScore: number;
  gameTimeRemaining: number;
  gameWon: boolean;
  scorePopups: FloatingScoreFeedback[];

  // AI Agent & Vision QA State
  chatMessages: ChatMessage[];
  isAgentThinking: boolean;
  isVisionRunning: boolean;
  latestVisionReport: VisionQAReport | null;

  // WebGL Canvas Ref Registration (for Snapshot & MediaRecorder)
  canvasElement: HTMLCanvasElement | null;
  isRecordingVideo: boolean;
  recordingProgress: number;

  // Actions
  setCanvasElement: (el: HTMLCanvasElement | null) => void;
  setSceneSpec: (nextSpec: SceneSpec, summary?: string[]) => void;
  loadTemplate: (templateId: string) => void;
  undo: () => void;
  redo: () => void;

  setMode: (mode: StudioMode) => void;
  setAspectRatio: (ratio: AspectRatioPreset) => void;
  setLightingPreset: (presetId: LightingPresetId) => void;
  setCameraMode: (mode: CameraMode) => void;

  selectActor: (id: string | null) => void;
  spawnAsset: (assetId: string, customGlbUrl?: string, customName?: string) => void;
  updateActor: (actorId: string, patch: Partial<ActorNode>) => void;
  removeActor: (actorId: string) => void;

  spawnVFX: (type: VFXType) => void;
  removeVFX: (vfxId: string) => void;

  // Playback & Game Runtime Actions
  togglePlay: () => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  advanceTimeline: (deltaSeconds: number) => void;
  triggerActorInteraction: (actor: ActorNode) => void;
  resetGameSession: () => void;

  // Agent & Vision QA Actions
  addChatMessage: (msg: ChatMessage) => void;
  setAgentThinking: (thinking: boolean) => void;
  setVisionRunning: (running: boolean) => void;
  setLatestVisionReport: (report: VisionQAReport | null) => void;
  applyVisionFixes: (report: VisionQAReport) => void;

  // UI & Export Modals
  setPublishModalOpen: (open: boolean) => void;
  setBottomDockCollapsed: (collapsed: boolean) => void;
  setRecordingState: (recording: boolean, progress?: number) => void;
}

const initialSpec = cloneSceneSpec(SCENE_TEMPLATES['clean-studio-starter']);

function findUnoccupiedPosition(existingActors: ActorNode[]): Vector3Tuple {
  if (existingActors.length === 0) return [0, 0, 0];
  const candidateOffsets: Vector3Tuple[] = [
    [0, 0, 0],
    [-2.2, 0, 0.8],
    [2.2, 0, 0.8],
    [0, 0, -2.2],
    [-1.8, 0, -1.6],
    [1.8, 0, -1.6],
    [-3.2, 0, 0],
    [3.2, 0, 0],
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
  const radius = 2.4 + (existingActors.length % 3) * 0.7;
  return [
    Number((Math.cos(angle) * radius).toFixed(2)),
    0,
    Number((Math.sin(angle) * radius).toFixed(2)),
  ];
}

export const useStudioStore = create<StudioState>((set, get) => ({
  sceneSpec: initialSpec,
  pastSpecs: [],
  futureSpecs: [],

  selectedActorId: initialSpec.actors[0]?.id ?? null,
  selectedVfxId: null,
  isPublishModalOpen: false,
  isBottomDockCollapsed: false,

  isPlaying: true,
  currentTime: 0,

  gameScore: 0,
  gameTimeRemaining: initialSpec.gameRules.timeLimitSeconds,
  gameWon: false,
  scorePopups: [],

  chatMessages: [
    {
      id: 'msg-welcome',
      role: 'assistant',
      content:
        'Welcome to OmniStage AI. Your Clean Studio Stage is initialized with a grounded Calibration Monolith. Ask me to build a playable mini-game, spawn 3D products, choreograph camera flythroughs, or run a Vision QA check.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      diffSummary: ['Initialized Clean Studio Stage (16:9)', 'Mounted Studio Calibration Monolith at [0, 0, 0]'],
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
    set((state) => ({
      pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
      futureSpecs: [],
      sceneSpec: cloneSceneSpec(nextSpec),
      gameTimeRemaining: nextSpec.gameRules.timeLimitSeconds,
    })),

  loadTemplate: (templateId) => {
    const template = SCENE_TEMPLATES[templateId];
    if (!template) return;
    const cloned = cloneSceneSpec(template);
    set((state) => ({
      pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
      futureSpecs: [],
      sceneSpec: cloned,
      selectedActorId: cloned.actors[0]?.id ?? null,
      currentTime: 0,
      gameScore: 0,
      gameWon: false,
      gameTimeRemaining: cloned.gameRules.timeLimitSeconds,
      latestVisionReport: null,
    }));
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
      if (mode === 'isometric-game') {
        nextSpec.camera.position = [0, 5.4, 8.2];
        nextSpec.camera.target = [0, 1.0, 0];
      } else if (mode === 'orbit') {
        nextSpec.camera.position = [0, 2.8, 6.4];
        nextSpec.camera.target = [0, 1.1, 0];
      }
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  selectActor: (id) => set({ selectedActorId: id }),

  spawnAsset: (assetId, customGlbUrl, customName) =>
    set((state) => {
      const entry = ASSET_REGISTRY[assetId] ?? ASSET_REGISTRY['starter-primitive-showcase'];
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const spawnPos = findUnoccupiedPosition(nextSpec.actors);
      const newActor: ActorNode = {
        id: `actor-${Date.now().toString(36)}`,
        name: customName || `${entry.name} ${nextSpec.actors.length + 1}`,
        assetId: entry.assetId,
        customGlbUrl,
        position: spawnPos,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        primaryColor: entry.defaultPrimaryColor,
        secondaryColor: entry.defaultSecondaryColor,
        metalness: entry.defaultMetalness,
        roughness: entry.defaultRoughness,
        activeAnimation: entry.defaultAnimation,
        animationSpeed: 1,
        physicsRole: entry.defaultPhysicsRole,
        onClickAction: entry.defaultClickAction,
        scoreValue: entry.defaultScoreValue,
      };
      nextSpec.actors.push(newActor);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId: newActor.id,
      };
    }),

  updateActor: (actorId, patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx === -1) return state;
      nextSpec.actors[idx] = { ...nextSpec.actors[idx], ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  removeActor: (actorId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.actors = nextSpec.actors.filter((a) => a.id !== actorId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId:
          state.selectedActorId === actorId ? (nextSpec.actors[0]?.id ?? null) : state.selectedActorId,
      };
    }),

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
  setCurrentTime: (currentTime) => set({ currentTime }),

  advanceTimeline: (deltaSeconds) =>
    set((state) => {
      if (!state.isPlaying) return state;
      const duration = Math.max(2, state.sceneSpec.durationSeconds || 8);
      const nextTime = (state.currentTime + deltaSeconds) % duration;

      // Also tick game timer if in game mode and not yet won
      let nextRemaining = state.gameTimeRemaining;
      if (state.sceneSpec.mode === 'game' && !state.gameWon) {
        nextRemaining = Math.max(0, state.gameTimeRemaining - deltaSeconds);
        if (nextRemaining === 0 && state.sceneSpec.gameRules.winCondition === 'survive-timer') {
          return {
            currentTime: nextTime,
            gameTimeRemaining: 0,
            gameWon: true,
          };
        }
      }

      return {
        currentTime: nextTime,
        gameTimeRemaining: nextRemaining,
      };
    }),

  triggerActorInteraction: (actor) => {
    const state = get();
    const pts = actor.scoreValue ?? 15;
    const nextScore = state.gameScore + pts;
    const targetScore = state.sceneSpec.gameRules.targetScore || 50;
    const won = nextScore >= targetScore;

    const popup: FloatingScoreFeedback = {
      id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text:
        actor.onClickAction === 'cta-redirect'
          ? `CTA CLICKED · +${pts} PTS`
          : `+${pts} PTS · ${actor.name}`,
      color: actor.primaryColor || '#F59E0B',
      createdAt: Date.now(),
    };

    set((s) => ({
      selectedActorId: actor.id,
      gameScore: nextScore,
      gameWon: s.gameWon || won,
      scorePopups: [...s.scorePopups.slice(-4), popup],
    }));
  },

  resetGameSession: () =>
    set((state) => ({
      gameScore: 0,
      gameWon: false,
      gameTimeRemaining: state.sceneSpec.gameRules.timeLimitSeconds || 30,
      scorePopups: [],
    })),

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

  setPublishModalOpen: (isPublishModalOpen) => set({ isPublishModalOpen }),
  setBottomDockCollapsed: (isBottomDockCollapsed) => set({ isBottomDockCollapsed }),
  setRecordingState: (isRecordingVideo, recordingProgress = 0) =>
    set({ isRecordingVideo, recordingProgress }),
}));
