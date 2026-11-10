/**
 * Studio 3D world. Phase 7B: every part is built by the framework-free src/render3d/world3d builders (also used by the
 * OmniStage Player), so the editor viewport and exports render the same sky, terrain, water, clouds, weather and props.
 * Each part rebuilds only when its own slice of WorldSpec changes. HDRI lighting stays on drei's <Environment>.
 */
import React, { Suspense } from 'react';
import { Environment } from '@react-three/drei';
import { useStudioStore } from '../state/useStudioStore';
import { DEFAULT_WORLD_SPEC } from '../registry/assetRegistry';
import {
  createClouds, createScatterLayer, createSky, createStars, createTerrain, createWater, createWeather, waterLevelFor,
} from '../render3d/world3d';
import { Built } from './Built';

export { computeTerrainHeight } from '../runtime/world';

export const WorldRenderer: React.FC = () => {
  const world = useStudioStore((s) => s.sceneSpec.world) ?? DEFAULT_WORLD_SPEC;
  const renderQuality = useStudioStore((s) => s.settings.renderQuality);
  const reflectionSize = renderQuality === 'draft' ? 256 : renderQuality === 'ultra-postprocessing' ? 1024 : 512;

  const hdri = world.hdri?.url ? world.hdri : undefined;
  const hdriBackground = Boolean(hdri?.showBackground);
  const showStars = !hdriBackground && (world.skybox === 'night-stars' || world.skybox === 'cyber-void');
  const waterLevel = world.terrain.type === 'none' ? null : waterLevelFor(world);
  const { terrain, clouds, weather } = world;

  return (
    <group name="OmniStageWorld">
      {/* External HDRI image-based lighting (Poly Haven via /api/assets proxy). */}
      {hdri && (
        <Suspense fallback={null}>
          <Environment key={hdri.url} files={hdri.url} background={hdriBackground}
            environmentIntensity={hdri.intensity ?? 1} backgroundIntensity={hdri.intensity ?? 1} />
        </Suspense>
      )}
      {world.skybox !== 'studio-hdri' && !hdriBackground && (
        <Built factory={() => createSky(world)} deps={[world.skybox, ...world.sunPosition]} />
      )}
      {showStars && <Built factory={() => createStars()} deps={[]} />}
      <Built factory={() => createTerrain(world)} deps={[terrain.type, terrain.color, terrain.elevationScale, terrain.roughness]} />
      {waterLevel !== null && (
        <Built factory={() => createWater(world, waterLevel, 'high', reflectionSize)}
          deps={[waterLevel, reflectionSize, world.skybox, ...world.sunPosition]} />
      )}
      <Built factory={() => createClouds(world)} deps={[clouds.enabled, clouds.density, clouds.speed, clouds.color]} />
      <Built factory={() => createWeather(world)} deps={[weather.type, weather.intensity]} />
      {(world.scatterObjects || []).map((layer) => (
        <Built key={layer.id} factory={() => createScatterLayer(layer, terrain.type, terrain.elevationScale)}
          deps={[layer, terrain.type, terrain.elevationScale]} />
      ))}
    </group>
  );
};
