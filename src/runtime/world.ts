/**
 * Phase 7 — World math shared by the studio WorldRenderer and the OmniStage Player (terrain height field, sky palettes).
 */
import type { TerrainType, WorldSpec } from '../types/scene.schema';

function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

export const SKY_PALETTES: Record<WorldSpec['skybox'], [string, string, number]> = {
  'daylight-sky': ['#2476cb', '#c2e5f5', 1],
  'sunset-atmosphere': ['#342e69', '#f89861', 1],
  'overcast': ['#667687', '#c8d0d7', 0.12],
  'night-stars': ['#030719', '#172342', 0],
  'cyber-void': ['#120825', '#34204f', 0],
  'studio-hdri': ['#0b101b', '#172342', 0],
};

export function computeTerrainHeight(type: TerrainType, x: number, z: number, elevationScale: number): number {
  const distFromOrigin = Math.sqrt(x * x + z * z);
  // Keep a smooth playable clearing near the center stage (radius 4m)
  const centerMask = smoothstep(distFromOrigin, 3.5, 14.0);

  switch (type) {
    case 'flat-grid':
    case 'none':
      return 0;
    case 'grassy-hills': {
      const h =
        Math.sin(x * 0.08) * Math.cos(z * 0.08) * 1.4 +
        Math.sin(x * 0.19 + z * 0.14) * 0.55;
      return h * elevationScale * centerMask;
    }
    case 'desert-dunes': {
      const ridge = Math.abs(Math.sin(x * 0.07 + Math.cos(z * 0.05) * 1.5)) * 1.8;
      const ripple = Math.sin(x * 0.35 + z * 0.2) * 0.18;
      return (ridge + ripple - 0.3) * elevationScale * centerMask;
    }
    case 'snow-mountains': {
      const peak =
        Math.pow(Math.abs(Math.sin(x * 0.055) * Math.cos(z * 0.055)), 1.3) * 3.8 +
        Math.sin(x * 0.15 - z * 0.12) * 0.8;
      return peak * elevationScale * centerMask;
    }
    case 'ocean-island': {
      const islandFalloff = 1.0 - smoothstep(distFromOrigin, 8.0, 32.0);
      const bumps = Math.sin(x * 0.15) * Math.cos(z * 0.15) * 0.6;
      return (islandFalloff * 2.4 - 1.2 + bumps * islandFalloff) * Math.max(0.5, elevationScale * 0.5);
    }
    case 'city-asphalt':
      return 0;
    default:
      return 0;
  }
}
