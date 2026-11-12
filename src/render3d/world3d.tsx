/** @jsxRuntime classic */
/** @jsx h */
/**
 * Phase 7B — the 3D world (shader sky, stars, height-field terrain, planar-reflection water, clouds, GPU weather,
 * scatter props) as plain Three.js. The studio WorldRenderer and the OmniStage Player both build it from here, so the
 * editor viewport and every export render the same world. HDRI image lighting stays host-specific (drei Environment in
 * the studio, RGBELoader in the Player).
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { ScatterLayerSpec, TerrainType, WorldSpec } from '../types/scene.schema';
import { computeTerrainHeight, SKY_PALETTES } from '../runtime/world';
import { createGpuParticles } from './gpuParticles';
import { disposeObject, h } from './h';
import type { Built3D, FrameContext, RenderQuality } from './types';
import { skyFragmentShader, skyVertexShader, waterShader } from './worldShaders';

export const DEFAULT_SCATTER_COLORS: Record<ScatterLayerSpec['type'], string> = {
  'pine-trees': '#15803d',
  'cyber-buildings': '#1e293b',
  'rocks-boulders': '#64748b',
  'street-lights': '#38bdf8',
  'ancient-pillars': '#cbd5e1',
  'crystal-clusters': '#ec4899',
};

// ------------------------------------------------------------------ sky
export function createSky(world: WorldSpec): Built3D<THREE.Mesh> {
  const uniforms = {
    uTime: { value: 0 }, uDuration: { value: 8 }, uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunStrength: { value: 1 },
  };
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: skyVertexShader, fragmentShader: skyFragmentShader,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'DynamicSky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  const [zenith, horizon, strength] = SKY_PALETTES[world.skybox] || SKY_PALETTES['sunset-atmosphere'];
  uniforms.uZenith.value.set(zenith);
  uniforms.uHorizon.value.set(horizon);
  uniforms.uSunStrength.value = strength;
  uniforms.uSun.value.set(...world.sunPosition);
  if (uniforms.uSun.value.lengthSq() < 0.0001) uniforms.uSun.value.set(0, 1, 0);
  return {
    object: mesh,
    update(ctx) {
      uniforms.uTime.value = ctx.time;
      uniforms.uDuration.value = ctx.duration;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// ------------------------------------------------------------------ stars (drei <Stars> look-alike)
export function createStars(count = 2500, radius = 65, depth = 25): Built3D<THREE.Points> {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 424242;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = radius + rnd() * depth;
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    positions.set([r * Math.sin(phi) * Math.cos(theta), Math.abs(r * Math.cos(phi)), r * Math.sin(phi) * Math.sin(theta)], i * 3);
    c.setHSL(i / count, 0.5, 0.85);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
  const points = new THREE.Points(geometry, material);
  points.name = 'Stars';
  return {
    object: points,
    update(ctx) { points.rotation.y = ctx.clock * 0.01; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// ------------------------------------------------------------------ terrain + water
export function waterLevelFor(world: WorldSpec): number | null {
  const { type, waterLevel } = world.terrain;
  const show = (waterLevel !== undefined && waterLevel > 0.01) || type === 'ocean-island';
  if (!show) return null;
  return waterLevel !== undefined && waterLevel > 0.01 ? waterLevel - 0.35 : -0.25;
}

export function createTerrain(world: WorldSpec): Built3D<THREE.Mesh> | null {
  const { type, color, elevationScale, roughness } = world.terrain;
  if (type === 'none') return null;
  const geo = new THREE.PlaneGeometry(120, 120, 88, 88);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c1 = new THREE.Color(color || '#111827');
  const c2 = c1.clone().offsetHSL(0.02, 0.05, 0.14);
  const snowCap = new THREE.Color('#f8fafc');
  for (let i = 0; i < pos.count; i++) {
    const vy = computeTerrainHeight(type, pos.getX(i), pos.getZ(i), elevationScale);
    pos.setY(i, vy);
    const t = THREE.MathUtils.clamp((vy + 1.5) / Math.max(2.0, elevationScale * 2.2), 0, 1);
    const mixed = c1.clone().lerp(c2, t);
    if (type === 'snow-mountains' && vy > elevationScale * 1.4) mixed.lerp(snowCap, 0.75);
    colors.set([mixed.r, mixed.g, mixed.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: type === 'city-asphalt' ? 0.25 : 0.08 });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'WorldTerrain';
  mesh.receiveShadow = true;
  mesh.position.y = -0.02;
  return { object: mesh, dispose() { geo.dispose(); material.dispose(); } };
}

/** Planar-reflection water (high quality) or a cheap tinted plane (low quality / weak phones). */
export function createWater(world: WorldSpec, level: number, quality: RenderQuality, reflectionSize = 512): Built3D {
  if (quality === 'low') {
    const geometry = new THREE.PlaneGeometry(140, 140);
    const material = new THREE.MeshStandardMaterial({ color: '#0b6f8c', transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.35 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ReflectiveWater';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = level;
    return {
      object: mesh,
      update(ctx) { mesh.position.y = level + Math.sin(ctx.time * 0.8) * 0.02; },
      dispose() { geometry.dispose(); material.dispose(); },
    };
  }
  const geometry = new THREE.PlaneGeometry(140, 140);
  const surface = new Reflector(geometry, {
    shader: waterShader, color: '#075d77', textureWidth: reflectionSize, textureHeight: reflectionSize,
    clipBias: 0.003, multisample: 0,
  });
  surface.name = 'ReflectiveWater';
  const material = surface.material as THREE.ShaderMaterial;
  material.fog = true;
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = level;
  const u = material.uniforms;
  u.uSun.value.set(...world.sunPosition).normalize();
  if (u.uSun.value.lengthSq() < 0.0001) u.uSun.value.set(0, 1, 0);
  u.uSunColor.value.set(world.skybox === 'sunset-atmosphere' ? '#ffbc78' : '#fff4d6');
  return {
    object: surface,
    update(ctx) { u.uTime.value = ctx.time; },
    dispose() { surface.dispose(); geometry.dispose(); },
  };
}

// ------------------------------------------------------------------ clouds
export function createClouds(world: WorldSpec): Built3D<THREE.Group> | null {
  const { enabled, density, speed, color } = world.clouds;
  if (!enabled) return null;
  const count = Math.max(4, Math.round(density * 24));
  const puffs: Array<[number, number, number, number]> = [[0, 0, 0, 1.8], [1.4, -0.2, 0.3, 1.35], [-1.4, -0.25, -0.2, 1.25], [0.5, 0.55, -0.4, 1.15]];
  const clouds = [];
  for (let i = 0; i < Math.min(count, 30); i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (i % 3) * 0.4;
    const radius = 14 + ((i * 7) % 38);
    clouds.push(
      <group position={[Math.cos(angle) * radius, 13 + ((i * 3) % 5) - 1.5, Math.sin(angle) * radius]} scale={0.8 + ((i * 13) % 10) * 0.14}>
        {puffs.map((p) => (
          <mesh position={[p[0], p[1], p[2]]} castShadow>
            <dodecahedronGeometry args={[p[3], 1]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.95} metalness={0.02} transparent opacity={0.86} />
          </mesh>
        ))}
      </group>,
    );
  }
  const group: THREE.Group = <group name="WorldClouds">{clouds}</group>;
  return {
    object: group,
    update(ctx) { group.rotation.y = ctx.time * 0.015 * speed; },
    dispose() { disposeObject(group); },
  };
}

// ------------------------------------------------------------------ weather
export function createWeather(world: WorldSpec): Built3D | null {
  const { type, intensity } = world.weather;
  if (type === 'clear' || intensity <= 0) return null;
  const color = type === 'rain' ? '#93c5fd' : type === 'snow' ? '#f8fafc' : type === 'floating-embers' ? '#fb923c' : '#cbd5e1';
  const size = type === 'rain' ? 0.32 : type === 'snow' ? 0.18 : type === 'floating-embers' ? 0.16 : 1.8;
  return createGpuParticles({ kind: type, count: Math.floor(900 * Math.min(4, intensity)), color, size });
}

// ------------------------------------------------------------------ scatter
function scatterItem(type: ScatterLayerSpec['type'], position: [number, number, number], scale: number, rotationY: number, color: string): THREE.Object3D | null {
  switch (type) {
    case 'pine-trees':
      return (
        <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.14, 0.2, 0.9, 8]} />
            <meshStandardMaterial color="#78350f" roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.35, 0]} castShadow receiveShadow>
            <coneGeometry args={[0.85, 1.5, 8]} />
            <meshStandardMaterial color={color} roughness={0.75} />
          </mesh>
          <mesh position={[0, 2.15, 0]} castShadow receiveShadow>
            <coneGeometry args={[0.62, 1.2, 8]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
        </group>
      );
    case 'cyber-buildings':
      return (
        <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
          <mesh position={[0, 2.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 4.4, 1.6]} />
            <meshStandardMaterial color={color} metalness={0.65} roughness={0.28} />
          </mesh>
          <mesh position={[0, 2.4, 0.82]}>
            <planeGeometry args={[1.1, 3.6]} />
            <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={1.2} roughness={0.2} />
          </mesh>
        </group>
      );
    case 'rocks-boulders':
      return (
        <mesh position={[position[0], position[1] + 0.35 * scale, position[2]]} scale={[scale * 1.1, scale * 0.75, scale]}
          rotation={[0.2, rotationY, 0.1]} castShadow receiveShadow>
          <dodecahedronGeometry args={[0.7, 1]} />
          <meshStandardMaterial color={color} roughness={0.88} metalness={0.08} />
        </mesh>
      );
    case 'street-lights':
      return (
        <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
          <mesh position={[0, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.07, 3.0, 8]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0.35, 2.95, 0]}>
            <boxGeometry args={[0.8, 0.08, 0.16]} />
            <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0.62, 2.88, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} />
          </mesh>
        </group>
      );
    case 'ancient-pillars':
      return (
        <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
          <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.9, 0.3, 0.9]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.55, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.32, 0.36, 2.5, 12]} />
            <meshStandardMaterial color={color} roughness={0.82} />
          </mesh>
          <mesh position={[0, 2.9, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.95, 0.28, 0.95]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
        </group>
      );
    case 'crystal-clusters':
      return (
        <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
          <mesh position={[0, 0.65, 0]} rotation={[0.1, 0, 0.15]} castShadow>
            <octahedronGeometry args={[0.5, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} metalness={0.4} roughness={0.15} />
          </mesh>
          <mesh position={[0.35, 0.4, 0.2]} rotation={[-0.2, 0.4, -0.25]} castShadow>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} metalness={0.4} roughness={0.15} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** Golden-angle placement keeps the play area (radius 5.2) clear; capped at 80 props per layer. */
export function scatterPlacements(layer: ScatterLayerSpec, terrainType: TerrainType, elevationScale: number) {
  const items: Array<{ pos: [number, number, number]; scale: number; rotY: number }> = [];
  const count = Math.min(layer.count, 80);
  const minRadius = 5.2;
  const outerRadius = Math.max(minRadius + 4, layer.spreadRadius || 22);
  for (let i = 0; i < count; i++) {
    const golden = i * 2.3999632;
    const r = minRadius + Math.sqrt((i + 0.5) / Math.max(1, count)) * (outerRadius - minRadius);
    const x = Math.cos(golden) * r;
    const z = Math.sin(golden) * r;
    const scale = layer.scaleRange[0] + (((i * 17) % 100) / 100) * Math.max(0.05, layer.scaleRange[1] - layer.scaleRange[0]);
    items.push({ pos: [x, computeTerrainHeight(terrainType, x, z, elevationScale), z], scale, rotY: ((i * 43) % 360) * (Math.PI / 180) });
  }
  return items;
}

export function createScatterLayer(layer: ScatterLayerSpec, terrainType: TerrainType, elevationScale: number): Built3D<THREE.Group> {
  const color = layer.color || DEFAULT_SCATTER_COLORS[layer.type] || '#15803d';
  const group = new THREE.Group();
  group.name = `ScatterLayer-${layer.id}`;
  for (const item of scatterPlacements(layer, terrainType, elevationScale)) {
    const obj = scatterItem(layer.type, item.pos, item.scale, item.rotY, color);
    if (obj) group.add(obj);
  }
  return { object: group, dispose: () => disposeObject(group) };
}

// ------------------------------------------------------------------ whole world
export interface WorldBuildOptions {
  quality: RenderQuality;
  /** Reflection texture size for high-quality water. */
  reflectionSize?: number;
  /** An HDRI is shown as background: skip the procedural sky and stars. */
  hdriBackground?: boolean;
}

export function createWorld(world: WorldSpec, opts: WorldBuildOptions): Built3D<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'OmniStageWorld';
  const parts: Built3D[] = [];
  const add = (b: Built3D | null) => {
    if (!b) return;
    parts.push(b);
    group.add(b.object);
  };
  if (world.skybox !== 'studio-hdri' && !opts.hdriBackground) add(createSky(world));
  if (!opts.hdriBackground && (world.skybox === 'night-stars' || world.skybox === 'cyber-void')) add(createStars());
  const terrain = createTerrain(world);
  add(terrain);
  const level = world.terrain.type === 'none' ? null : waterLevelFor(world);
  if (level !== null) add(createWater(world, level, opts.quality, opts.reflectionSize));
  add(createClouds(world));
  add(createWeather(world));
  for (const layer of world.scatterObjects || []) add(createScatterLayer(layer, world.terrain.type, world.terrain.elevationScale));
  return {
    object: group,
    update(ctx: FrameContext) {
      for (const p of parts) p.update?.(ctx);
    },
    dispose() {
      for (const p of parts) p.dispose();
    },
  };
}
