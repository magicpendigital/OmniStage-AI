/**
 * Phase 7 — Game runtime slice: timeline clock, playable game rules (score, hazards, timers, unbox, win/lose),
 * execution log and level progression. Framework-free: composed into the studio store (React/zustand) AND into
 * the OmniStage Player's vanilla store, so a game behaves identically in the editor, Play Test, phones and exports.
 */
import { ASSET_REGISTRY, cloneSceneSpec, SCENE_TEMPLATES } from '../registry/assetRegistry';
import type { ActorNode, ExecutionLogEntry, LogicNode, SceneSpec, Vector3Tuple } from '../types/scene.schema';
import { syncGraphWithScene } from './graphSync';

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

export interface GameRuntimeState {
  sceneSpec: SceneSpec;
  scenes: SceneSpec[];
  activeSceneId: string;
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  gameScore: number;
  gameTimeRemaining: number;
  gameWon: boolean;
  gameEnded: boolean;
  unboxTapCounts: Record<string, number>;
  scorePopups: FloatingScoreFeedback[];
  burstEffects: BurstVFXInstance[];
  executionLogs: ExecutionLogEntry[];
  /** Provided by the host store: the studio's version also manages undo history. */
  switchScene: (sceneId: string) => void;

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
  appendLog: (entry: Omit<ExecutionLogEntry, 'id' | 'timestamp' | 'sceneTime'> & Partial<Pick<ExecutionLogEntry, 'id' | 'timestamp' | 'sceneTime'>>) => void;
  clearLogs: () => void;
  markNodeExecution: (nodeId: string, status: NonNullable<LogicNode['status']>, errorMessage?: string) => void;
  advanceToNextScene: () => boolean;
}

type SetState<S> = (partial: Partial<S> | S | ((state: S) => Partial<S> | S)) => void;
type GetState<S> = () => S;

/**
 * Phase 7C: should a click/tap on a 3D actor run its built-in interaction (collect, unbox, ...)?
 * When the logic graph handled the click, built-in effects are skipped to avoid double scoring — except unbox
 * progress, which is the actor's own state (the gift box must still count taps while the graph adds VFX/camera).
 * Shared by the studio ActorRenderer and the Player so both behave the same.
 */
export function clickRunsBuiltIn(actor: Pick<ActorNode, 'onClickAction' | 'assetId'>, mode: 'game' | 'media', graphHandled: boolean): boolean {
  const unbox = actor.onClickAction === 'unbox-tap' || actor.assetId === 'mystery-gift-box';
  if (graphHandled && !unbox) return false;
  return mode === 'game' || actor.onClickAction !== 'none';
}

export function createGameRuntimeSlice<S extends GameRuntimeState>(setRaw: SetState<S>, getRaw: GetState<S>) {
  // The slice only touches GameRuntimeState fields; widen for the implementation.
  const set = setRaw as unknown as SetState<GameRuntimeState>;
  const get = getRaw as unknown as GetState<GameRuntimeState>;
  return {
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
  } satisfies Partial<GameRuntimeState>;
}
