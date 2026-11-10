/**
 * Phase 7C store slice — 3D world builder: terrain, sky, clouds, weather and scatter layers.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { DEFAULT_WORLD_SPEC, cloneSceneSpec } from '../../registry/assetRegistry';
import { syncGraphWithScene } from '../../runtime/graphSync';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createWorldSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({

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
});
