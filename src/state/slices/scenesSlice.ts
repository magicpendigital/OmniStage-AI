/**
 * Phase 7C store slice — Multi-scene projects, templates, undo/redo, mode, aspect ratio, lighting and camera.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { LIGHTING_PRESETS, SCENE_TEMPLATES, cloneSceneSpec, createBlankSceneSpec } from '../../registry/assetRegistry';
import { syncGraphWithScene } from '../../runtime/graphSync';
import { Vector3Tuple } from '../../types/scene.schema';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createScenesSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({

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

  // ================= DOCKING SHELL: storyboard order, HUD rules, duration, camera keyframes =================
  renameScene: (sceneId, title) =>
    set((state) => {
      const scenes = state.scenes.map((s) => (s.id === sceneId ? { ...s, title } : s));
      return sceneId === state.activeSceneId ? { scenes, sceneSpec: { ...state.sceneSpec, title } } : { scenes };
    }),

  moveScene: (sceneId, direction) =>
    set((state) => {
      const from = state.scenes.findIndex((s) => s.id === sceneId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= state.scenes.length) return state;
      const scenes = state.scenes.slice();
      const [moved] = scenes.splice(from, 1);
      scenes.splice(to, 0, moved);
      return { scenes };
    }),

  updateGameRules: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.gameRules = { ...nextSpec.gameRules, ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
        ...(patch.timeLimitSeconds !== undefined && !state.gameEnded ? { gameTimeRemaining: nextSpec.gameRules.timeLimitSeconds } : {}),
      };
    }),

  updateMarketingOverlay: (patch) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.marketingOverlay = { ...nextSpec.marketingOverlay, ...patch };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  setSceneDuration: (seconds) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.durationSeconds = Math.max(2, Math.min(120, seconds || 2));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        currentTime: Math.min(state.currentTime, nextSpec.durationSeconds),
      };
    }),

  addCameraKeyframe: () =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const time = Number(state.currentTime.toFixed(2));
      const keyframes = (nextSpec.camera.keyframes || []).filter((k) => Math.abs(k.time - time) > 0.01);
      keyframes.push({
        id: `kf-${Date.now().toString(36)}`,
        time,
        position: [...nextSpec.camera.position] as Vector3Tuple,
        target: [...nextSpec.camera.target] as Vector3Tuple,
        fov: nextSpec.camera.fov,
        label: `Shot @ ${time.toFixed(1)}s`,
      });
      nextSpec.camera.keyframes = keyframes.sort((a, b) => a.time - b.time);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  removeCameraKeyframe: (index) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.camera.keyframes = (nextSpec.camera.keyframes || []).filter((_, i) => i !== index);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),
});
