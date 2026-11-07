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
  TransformMode,
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

export interface BurstVFXInstance {
  id: string;
  position: Vector3Tuple;
  color: string;
  createdAt: number;
}

interface StudioState {
  // Core SceneSpec + Undo/Redo History
  sceneSpec: SceneSpec;
  pastSpecs: SceneSpec[];
  futureSpecs: SceneSpec[];

  // Phase 2 Selection & 3D Gizmo State
  selectedActorId: string | null;
  selectedVfxId: string | null;
  transformMode: TransformMode;
  isDraggingGizmo: boolean;
  isPublishModalOpen: boolean;
  isBottomDockCollapsed: boolean;

  // Timeline Sequencer & Playback State
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;

  // Phase 2 Real Playable Game Runtime State
  gameScore: number;
  gameTimeRemaining: number;
  gameWon: boolean;
  gameEnded: boolean; // Triggers Playable Ad End-Card Overlay
  unboxTapCounts: Record<string, number>;
  scorePopups: FloatingScoreFeedback[];
  burstEffects: BurstVFXInstance[];

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

  // Phase 2 Gizmo & Actor Transform/Property Actions
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
  duplicateActor: (actorId: string) => void;
  spawnAsset: (assetId: string, customGlbUrl?: string, customName?: string) => void;
  removeActor: (actorId: string) => void;

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
  resetGameSession: () => void;
  dismissEndCard: () => void;

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
  sceneSpec: initialSpec,
  pastSpecs: [],
  futureSpecs: [],

  selectedActorId: initialSpec.actors[0]?.id ?? null,
  selectedVfxId: null,
  transformMode: 'translate',
  isDraggingGizmo: false,
  isPublishModalOpen: false,
  isBottomDockCollapsed: false,

  isPlaying: true,
  isLooping: true,
  currentTime: 0,

  gameScore: 0,
  gameTimeRemaining: initialSpec.gameRules.timeLimitSeconds,
  gameWon: false,
  gameEnded: false,
  unboxTapCounts: {},
  scorePopups: [],
  burstEffects: [],

  chatMessages: [
    {
      id: 'msg-welcome',
      role: 'assistant',
      content:
        'OmniStage AI Phase 2 is active. Click any 3D actor to manipulate it with Move [W], Rotate [E], and Scale [R] Gizmos, scrub the cinematic camera timeline, or test the 4 One-Click Starter Templates in the Left Drawer.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      diffSummary: [
        'Enabled 3D TransformControls Gizmos (Translate / Rotate / Scale)',
        'Activated CatmullRomCurve3 Camera Sequencer & Bounding-Box Game Loop',
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
    set((state) => ({
      pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
      futureSpecs: [],
      sceneSpec: cloneSceneSpec(nextSpec),
      gameTimeRemaining: nextSpec.gameRules.timeLimitSeconds,
      gameScore: 0,
      gameWon: false,
      gameEnded: false,
      unboxTapCounts: {},
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
      isPlaying: true,
      gameScore: 0,
      gameWon: false,
      gameEnded: false,
      unboxTapCounts: {},
      burstEffects: [],
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

  selectActor: (id) => set({ selectedActorId: id }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setIsDraggingGizmo: (isDraggingGizmo) => set({ isDraggingGizmo }),

  updateActorTransform: (actorId, position, rotation, scale) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx === -1) return state;
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
          Number(Math.max(0.2, scale[0]).toFixed(2)),
          Number(Math.max(0.2, scale[1]).toFixed(2)),
          Number(Math.max(0.2, scale[2]).toFixed(2)),
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

      // Tick playable game timer when in Game Mode
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
      const nextX = Math.max(-3.6, Math.min(3.6, player.position[0] + dx));
      const nextZ = Math.max(-3.6, Math.min(3.6, player.position[2] + dz));
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

      // Respawn collectible at a random arena coordinate so player can keep collecting or win
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
      // Push player slightly away from hazard
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

    // Special Tap-to-Unbox Mini-Game Mechanic (3 taps -> Confetti Explosion + Product Reveal!)
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

      // 3rd Tap Reached! Transform Mystery Box into Revealed Hero Product + Spawn Confetti!
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

    // Standard Collectible / Destroy / Trigger CTA Click Actions
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
          // Respawn collectible at new position
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

  resetGameSession: () =>
    set((state) => {
      // If current template is in SCENE_TEMPLATES, restore initial collectibles/unbox state cleanly
      const tpl = SCENE_TEMPLATES[state.sceneSpec.id];
      const restoredSpec = tpl ? cloneSceneSpec(tpl) : cloneSceneSpec(state.sceneSpec);
      restoredSpec.mode = state.sceneSpec.mode;
      restoredSpec.actors.forEach((a) => (a.visible = true));
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

  setPublishModalOpen: (isPublishModalOpen) => set({ isPublishModalOpen }),
  setBottomDockCollapsed: (isBottomDockCollapsed) => set({ isBottomDockCollapsed }),
  setRecordingState: (isRecordingVideo, recordingProgress = 0) =>
    set({ isRecordingVideo, recordingProgress }),
}));
