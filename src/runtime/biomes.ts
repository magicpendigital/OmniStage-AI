/**
 * Phase 10B — biome presets: one word ("forest", "waterfall-valley") dresses a whole world — sky, terrain, weather,
 * scatter layers that fill the frame, and water landmarks. Pure data + functions, shared by the AI normaliser, the
 * offline director, the World panel and the verifier.
 */
import type { BiomeId, ScatterLayerSpec, WorldFeatureSpec, WorldSpec } from '../types/scene.schema';

export const BIOME_IDS: BiomeId[] = ['forest', 'meadow', 'beach', 'desert', 'snowy-peaks', 'waterfall-valley', 'night-forest', 'city-night'];

interface BiomePreset {
  label: string;
  skybox: WorldSpec['skybox'];
  sunPosition: WorldSpec['sunPosition'];
  clouds: WorldSpec['clouds'];
  terrain: WorldSpec['terrain'];
  weather: WorldSpec['weather'];
  scatter: Array<Omit<ScatterLayerSpec, 'id'>>;
  features: Array<Omit<WorldFeatureSpec, 'id'>>;
}

const clouds = (density: number, color = '#ffffff'): WorldSpec['clouds'] => ({ enabled: density > 0, density, speed: 0.6, color });
const layer = (type: ScatterLayerSpec['type'], count: number, spreadRadius: number, scaleRange: [number, number], color?: string) =>
  ({ type, count, spreadRadius, scaleRange, ...(color ? { color } : {}) });

export const BIOME_PRESETS: Record<BiomeId, BiomePreset> = {
  forest: {
    label: 'Forest',
    skybox: 'daylight-sky', sunPosition: [12, 18, 6], clouds: clouds(0.5),
    terrain: { type: 'grassy-hills', elevationScale: 1.2, roughness: 0.9, color: '#4f7d32' },
    weather: { type: 'clear', intensity: 0 },
    scatter: [
      layer('pine-trees', 34, 34, [0.9, 1.9]), layer('broadleaf-trees', 24, 28, [0.9, 1.6]), layer('bushes', 30, 22, [0.7, 1.3]),
      layer('grass-tufts', 70, 18, [0.7, 1.3]), layer('rocks-boulders', 10, 24, [0.5, 1.2]),
    ],
    features: [],
  },
  meadow: {
    label: 'Meadow',
    skybox: 'daylight-sky', sunPosition: [10, 20, 8], clouds: clouds(0.45),
    terrain: { type: 'grassy-hills', elevationScale: 0.7, roughness: 0.92, color: '#6a9a3c' },
    weather: { type: 'clear', intensity: 0 },
    scatter: [
      layer('flowers', 80, 18, [1.3, 2]), layer('grass-tufts', 80, 22, [0.7, 1.4]), layer('broadleaf-trees', 10, 34, [1.2, 2]),
      layer('bushes', 14, 26, [0.8, 1.4]),
    ],
    features: [{ type: 'pond', position: [9, 0, -9], size: 1 }],
  },
  beach: {
    label: 'Beach',
    skybox: 'daylight-sky', sunPosition: [8, 16, 12], clouds: clouds(0.3),
    terrain: { type: 'ocean-island', elevationScale: 1, roughness: 0.95, color: '#d8c08a' },
    weather: { type: 'clear', intensity: 0 },
    scatter: [layer('palm-trees', 14, 15, [1, 1.6]), layer('rocks-boulders', 8, 16, [0.4, 1]), layer('bushes', 8, 12, [0.6, 1])],
    features: [],
  },
  desert: {
    label: 'Desert',
    skybox: 'daylight-sky', sunPosition: [6, 22, 4], clouds: clouds(0.1),
    terrain: { type: 'desert-dunes', elevationScale: 1.2, roughness: 0.95, color: '#c8955a' },
    weather: { type: 'clear', intensity: 0 },
    scatter: [layer('cacti', 22, 30, [0.8, 1.6]), layer('rocks-boulders', 14, 28, [0.5, 1.4], '#a16207')],
    features: [],
  },
  'snowy-peaks': {
    label: 'Snowy peaks',
    skybox: 'overcast', sunPosition: [8, 14, 10], clouds: clouds(0.7, '#e2e8f0'),
    terrain: { type: 'snow-mountains', elevationScale: 1.4, roughness: 0.85, color: '#e2e8f0' },
    weather: { type: 'snow', intensity: 0.6 },
    scatter: [layer('pine-trees', 30, 32, [0.9, 1.8], '#1f5135'), layer('rocks-boulders', 12, 26, [0.6, 1.4])],
    features: [],
  },
  'waterfall-valley': {
    label: 'Waterfall valley',
    skybox: 'daylight-sky', sunPosition: [12, 18, 8], clouds: clouds(0.45),
    terrain: { type: 'grassy-hills', elevationScale: 1.2, roughness: 0.9, color: '#4f7d32' },
    weather: { type: 'clear', intensity: 0 },
    scatter: [
      layer('pine-trees', 26, 34, [1, 1.9]), layer('broadleaf-trees', 18, 28, [0.9, 1.6]), layer('bushes', 26, 22, [0.7, 1.3]),
      layer('rocks-boulders', 18, 24, [0.5, 1.3]), layer('grass-tufts', 50, 18, [0.7, 1.3]), layer('flowers', 30, 16, [1.2, 1.8]),
    ],
    features: [
      { type: 'waterfall', position: [-7, 0, -15], rotationDeg: 15, size: 1.2 },
      { type: 'river', position: [-9, 0, 6], rotationDeg: 8, size: 1 },
    ],
  },
  'night-forest': {
    label: 'Night forest',
    skybox: 'night-stars', sunPosition: [-6, 10, -8], clouds: clouds(0),
    terrain: { type: 'grassy-hills', elevationScale: 1.1, roughness: 0.9, color: '#2f4a2a' },
    weather: { type: 'floating-embers', intensity: 0.25 },
    scatter: [
      layer('pine-trees', 34, 34, [1, 1.9]), layer('broadleaf-trees', 18, 28, [0.9, 1.6]), layer('bushes', 24, 22, [0.7, 1.3]),
      layer('crystal-clusters', 6, 18, [0.5, 0.9], '#67e8f9'),
    ],
    features: [],
  },
  'city-night': {
    label: 'City at night',
    skybox: 'night-stars', sunPosition: [-6, 10, -8], clouds: clouds(0),
    terrain: { type: 'city-asphalt', elevationScale: 0, roughness: 0.6, color: '#374151' },
    weather: { type: 'clear', intensity: 0 },
    scatter: [layer('cyber-buildings', 30, 36, [1, 2.4]), layer('street-lights', 16, 14, [1, 1.2])],
    features: [],
  },
};

/** The world dressed by a biome. Keeps the HDRI; replaces sky, terrain, weather, scatter and water features. */
export function applyBiome(world: WorldSpec, biome: BiomeId): WorldSpec {
  const p = BIOME_PRESETS[biome];
  if (!p) return world;
  return {
    ...world,
    biome,
    skybox: p.skybox,
    sunPosition: [...p.sunPosition],
    clouds: { ...p.clouds },
    terrain: { ...p.terrain },
    weather: { ...p.weather },
    scatterObjects: p.scatter.map((l) => ({ ...l, id: `${biome}-${l.type}`, scaleRange: [...l.scaleRange] as [number, number] })),
    features: p.features.map((f, i) => ({ ...f, id: `${biome}-${f.type}-${i}`, position: [...f.position] })),
  };
}

/**
 * AI / imported worlds that name a biome but leave the dressing empty get the preset's dressing; anything the author
 * set explicitly (sky, terrain type, scatter layers, features) is kept.
 */
export function expandBiome(world: WorldSpec): WorldSpec {
  if (!world.biome || !BIOME_PRESETS[world.biome]) return world;
  const dressed = applyBiome(world, world.biome);
  const hasScatter = (world.scatterObjects || []).length > 0;
  return {
    ...dressed,
    skybox: world.skybox && world.skybox !== 'studio-hdri' ? world.skybox : dressed.skybox,
    terrain: world.terrain && world.terrain.type !== 'flat-grid' && world.terrain.type !== 'none' ? { ...dressed.terrain, ...world.terrain } : dressed.terrain,
    weather: world.weather && world.weather.type !== 'clear' ? world.weather : dressed.weather,
    scatterObjects: hasScatter ? world.scatterObjects : dressed.scatterObjects,
    features: world.features && world.features.length ? world.features : dressed.features,
  };
}

/** Footprint of a water feature on the ground plane (scatter props keep out of it). */
export function featureFootprint(f: WorldFeatureSpec): { contains: (x: number, z: number) => boolean } {
  const s = Math.max(0.3, f.size || 1);
  const [fx, , fz] = f.position;
  const yaw = ((f.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (x: number, z: number) => {
    const dx = x - fx;
    const dz = z - fz;
    return [dx * cos - dz * sin, dx * sin + dz * cos] as const;
  };
  switch (f.type) {
    case 'waterfall':
      return { contains: (x, z) => { const [lx, lz] = local(x, z); return Math.abs(lx) < 5 * s && lz > -3.5 * s && lz < 5.5 * s; } };
    case 'river':
      return { contains: (x, z) => { const [lx, lz] = local(x, z); return Math.abs(lx) < 2.6 * s && Math.abs(lz) < 21 * s; } };
    default:
      return { contains: (x, z) => Math.hypot(x - fx, z - fz) < 3.6 * s };
  }
}

/** Distance from the stage centre to the nearest point of a feature (verifier: landmarks must not sit on the stage). */
export function featureStageClearance(f: WorldFeatureSpec): number {
  const fp = featureFootprint(f);
  for (let r = 0; r <= 40; r += 0.5) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      if (fp.contains(Math.cos(ang) * r, Math.sin(ang) * r)) return r;
    }
  }
  return 40;
}

/** Environment settings a biome needs to read as outdoors: no studio grid / pedestal, distant haze instead of studio fog. */
export function biomeEnvironmentPatch(biome: BiomeId): Record<string, number | boolean | string> {
  const night = biome === 'night-forest' || biome === 'city-night';
  return night
    ? { groundGrid: false, reflectivePedestal: false, fogNear: 24, fogFar: 95, ambientIntensity: 0.45, keyLightIntensity: 1.6, keyLightColor: '#c7d2fe' }
    : { groundGrid: false, reflectivePedestal: false, fogNear: 34, fogFar: 140, ambientIntensity: 0.6, keyLightIntensity: 2.8 };
}

/** A scene dressed by a biome (world + outdoor environment). */
export function applyBiomeToScene<T extends { world: WorldSpec; environment: Record<string, any> }>(scene: T, biome: BiomeId): T {
  return { ...scene, world: applyBiome(scene.world, biome), environment: { ...scene.environment, ...biomeEnvironmentPatch(biome), groundColor: BIOME_PRESETS[biome].terrain.color } };
}
