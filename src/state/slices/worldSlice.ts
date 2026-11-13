/**
 * Phase 7C store slice — 3D world builder: terrain, sky, clouds, weather and scatter layers.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { DEFAULT_WORLD_SPEC, cloneSceneSpec } from '../../registry/assetRegistry';
import { syncGraphWithScene } from '../../runtime/graphSync';
import { applyBiomeToScene } from '../../runtime/biomes';
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

  applyBiomePreset: (biome) =>
    set((state) => {
      const nextSpec = applyBiomeToScene(cloneSceneSpec(state.sceneSpec), biome);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
      };
    }),

  addWorldFeature: (type) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const features = nextSpec.world.features || [];
      // Default spots behind / beside the stage, clear of the acting area.
      const spots: Record<typeof type, [number, number, number]> = { waterfall: [0, 0, -15], river: [-9, 0, 4], pond: [9, 0, -8] };
      nextSpec.world.features = [...features, { id: `${type}-${Date.now().toString(36)}`, type, position: spots[type], size: 1 }];
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  removeWorldFeature: (id) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.world.features = (nextSpec.world.features || []).filter((f) => f.id !== id);
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
