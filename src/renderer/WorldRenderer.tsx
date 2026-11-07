import React, { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Sky, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from '../state/useStudioStore';
import { ScatterLayerSpec, TerrainType, WeatherType } from '../types/scene.schema';
import { DEFAULT_WORLD_SPEC } from '../registry/assetRegistry';

function computeTerrainHeight(type: TerrainType, x: number, z: number, elevationScale: number): number {
  const distFromOrigin = Math.sqrt(x * x + z * z);
  // Keep a smooth playable clearing near the center stage (radius 4m)
  const centerMask = THREE.MathUtils.smoothstep(distFromOrigin, 3.5, 14.0);

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
      const islandFalloff = 1.0 - THREE.MathUtils.smoothstep(distFromOrigin, 8.0, 32.0);
      const bumps = Math.sin(x * 0.15) * Math.cos(z * 0.15) * 0.6;
      return (islandFalloff * 2.4 - 1.2 + bumps * islandFalloff) * Math.max(0.5, elevationScale * 0.5);
    }
    case 'city-asphalt':
      return 0;
    default:
      return 0;
  }
}

const ProceduralTerrain: React.FC = () => {
  const world = useStudioStore((s) => s.sceneSpec.world) ?? DEFAULT_WORLD_SPEC;
  const { type, color, elevationScale, roughness, waterLevel } = world.terrain;
  const waterRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(120, 120, 88, 88);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(color || '#111827');
    const c2 = c1.clone().offsetHSL(0.02, 0.05, 0.14);
    const snowCap = new THREE.Color('#f8fafc');

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const vy = computeTerrainHeight(type, vx, vz, elevationScale);
      pos.setY(i, vy);

      const t = THREE.MathUtils.clamp((vy + 1.5) / Math.max(2.0, elevationScale * 2.2), 0, 1);
      const mixed = c1.clone().lerp(c2, t);
      if (type === 'snow-mountains' && vy > elevationScale * 1.4) {
        mixed.lerp(snowCap, 0.75);
      }
      colors[i * 3] = mixed.r;
      colors[i * 3 + 1] = mixed.g;
      colors[i * 3 + 2] = mixed.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [type, color, elevationScale]);

  const showWater =
    (waterLevel !== undefined && waterLevel > 0.01) || type === 'ocean-island';
  const activeWaterY = waterLevel !== undefined && waterLevel > 0.01 ? waterLevel - 0.35 : -0.25;

  useFrame(({ clock }) => {
    if (waterRef.current && showWater) {
      waterRef.current.position.y = activeWaterY + Math.sin(clock.getElapsedTime() * 1.6) * 0.04;
    }
  });

  if (type === 'none') return null;

  return (
    <group name="WorldTerrain">
      <mesh geometry={geometry} receiveShadow position={[0, -0.02, 0]}>
        <meshStandardMaterial
          vertexColors
          roughness={roughness}
          metalness={type === 'city-asphalt' ? 0.25 : 0.08}
        />
      </mesh>

      {showWater && (
        <mesh
          ref={waterRef}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, activeWaterY, 0]}
          receiveShadow
        >
          <planeGeometry args={[140, 140, 24, 24]} />
          <meshStandardMaterial
            color="#0ea5e9"
            emissive="#0369a1"
            emissiveIntensity={0.25}
            roughness={0.12}
            metalness={0.75}
            transparent
            opacity={0.76}
          />
        </mesh>
      )}
    </group>
  );
};

const VolumetricClouds: React.FC = () => {
  const world = useStudioStore((s) => s.sceneSpec.world) ?? DEFAULT_WORLD_SPEC;
  const groupRef = useRef<THREE.Group>(null);
  const { enabled, density, speed, color } = world.clouds;
  const count = Math.max(4, Math.round(density * 24));

  const clouds = useMemo(() => {
    if (!enabled) return [];
    const list: Array<{
      id: number;
      pos: [number, number, number];
      scale: number;
      puffs: Array<[number, number, number, number]>;
    }> = [];
    for (let i = 0; i < Math.min(count, 30); i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + (i % 3) * 0.4;
      const radius = 14 + ((i * 7) % 38);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 13 + ((i * 3) % 5) - 1.5;
      const scale = 0.8 + ((i * 13) % 10) * 0.14;
      list.push({
        id: i,
        pos: [x, y, z],
        scale,
        puffs: [
          [0, 0, 0, 1.8],
          [1.4, -0.2, 0.3, 1.35],
          [-1.4, -0.25, -0.2, 1.25],
          [0.5, 0.55, -0.4, 1.15],
        ],
      });
    }
    return list;
  }, [enabled, count]);

  useFrame((_, delta) => {
    if (!groupRef.current || !enabled) return;
    groupRef.current.rotation.y += delta * 0.015 * speed;
  });

  if (!enabled) return null;

  return (
    <group ref={groupRef} name="WorldClouds">
      {clouds.map((c) => (
        <group key={c.id} position={c.pos} scale={c.scale}>
          {c.puffs.map((p, idx) => (
            <mesh key={idx} position={[p[0], p[1], p[2]]} castShadow>
              <dodecahedronGeometry args={[p[3], 1]} />
              <meshStandardMaterial
                color={color}
                roughness={0.95}
                metalness={0.02}
                transparent
                opacity={0.86}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
};

const WeatherSystem: React.FC<{ type: WeatherType; intensity: number }> = ({ type, intensity }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const count = Math.floor(450 * Math.max(0.15, intensity));

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 48;
      pos[i * 3 + 1] = Math.random() * 24;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 48;
      vel[i] = 0.6 + Math.random() * 0.8;
    }
    return { positions: pos, velocities: vel };
  }, [count]);

  useFrame((_, delta) => {
    if (!pointsRef.current || type === 'clear') return;
    const attr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      if (type === 'rain') {
        arr[idx + 1] -= delta * 18 * velocities[i];
        arr[idx] -= delta * 1.5;
        if (arr[idx + 1] < 0) arr[idx + 1] = 24;
      } else if (type === 'snow') {
        arr[idx + 1] -= delta * 2.6 * velocities[i];
        arr[idx] += Math.sin(arr[idx + 1] * 0.5 + i) * delta * 0.6;
        if (arr[idx + 1] < 0) arr[idx + 1] = 24;
      } else if (type === 'floating-embers') {
        arr[idx + 1] += delta * 2.2 * velocities[i];
        arr[idx] += Math.cos(arr[idx + 1] * 0.7 + i) * delta * 0.5;
        if (arr[idx + 1] > 22) arr[idx + 1] = 0.2;
      } else if (type === 'foggy-mist') {
        arr[idx] += Math.sin(i + arr[idx + 2] * 0.1) * delta * 0.35;
      }
    }
    attr.needsUpdate = true;
  });

  if (type === 'clear') return null;

  const particleColor =
    type === 'rain'
      ? '#93c5fd'
      : type === 'snow'
      ? '#f8fafc'
      : type === 'floating-embers'
      ? '#fb923c'
      : '#cbd5e1';

  const particleSize =
    type === 'rain' ? 0.11 : type === 'snow' ? 0.18 : type === 'floating-embers' ? 0.16 : 0.32;

  return (
    <points ref={pointsRef} key={`${type}-${count}`}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={particleColor}
        size={particleSize}
        transparent
        opacity={type === 'foggy-mist' ? 0.35 : 0.85}
        depthWrite={false}
      />
    </points>
  );
};

const DEFAULT_SCATTER_COLORS: Record<ScatterLayerSpec['type'], string> = {
  'pine-trees': '#15803d',
  'cyber-buildings': '#1e293b',
  'rocks-boulders': '#64748b',
  'street-lights': '#38bdf8',
  'ancient-pillars': '#cbd5e1',
  'crystal-clusters': '#ec4899',
};

const ScatterPropItem: React.FC<{
  type: ScatterLayerSpec['type'];
  position: [number, number, number];
  scale: number;
  rotationY: number;
  color: string;
}> = ({ type, position, scale, rotationY, color }) => {
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
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0284c7"
              emissiveIntensity={1.2}
              roughness={0.2}
            />
          </mesh>
        </group>
      );

    case 'rocks-boulders':
      return (
        <mesh
          position={[position[0], position[1] + 0.35 * scale, position[2]]}
          scale={[scale * 1.1, scale * 0.75, scale]}
          rotation={[0.2, rotationY, 0.1]}
          castShadow
          receiveShadow
        >
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
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.85}
              metalness={0.4}
              roughness={0.15}
            />
          </mesh>
          <mesh position={[0.35, 0.4, 0.2]} rotation={[-0.2, 0.4, -0.25]} castShadow>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.7}
              metalness={0.4}
              roughness={0.15}
            />
          </mesh>
        </group>
      );

    default:
      return null;
  }
};

const ScatterObjectsLayer: React.FC<{
  layer: ScatterLayerSpec;
  terrainType: TerrainType;
  elevationScale: number;
}> = ({ layer, terrainType, elevationScale }) => {
  const instances = useMemo(() => {
    const items: Array<{
      id: number;
      pos: [number, number, number];
      scale: number;
      rotY: number;
    }> = [];
    const safeCount = Math.min(layer.count, 80);
    const minRadius = 5.2;
    const outerRadius = Math.max(minRadius + 4, layer.spreadRadius || 22);

    for (let i = 0; i < safeCount; i++) {
      const goldenAngle = i * 2.3999632;
      const normalized = (i + 0.5) / Math.max(1, safeCount);
      const r = minRadius + Math.sqrt(normalized) * (outerRadius - minRadius);
      const x = Math.cos(goldenAngle) * r;
      const z = Math.sin(goldenAngle) * r;
      const y = computeTerrainHeight(terrainType, x, z, elevationScale);
      const scale =
        layer.scaleRange[0] +
        (((i * 17) % 100) / 100) * Math.max(0.05, layer.scaleRange[1] - layer.scaleRange[0]);
      const rotY = ((i * 43) % 360) * (Math.PI / 180);
      items.push({ id: i, pos: [x, y, z], scale, rotY });
    }
    return items;
  }, [layer, terrainType, elevationScale]);

  const resolvedColor = layer.color || DEFAULT_SCATTER_COLORS[layer.type] || '#15803d';

  return (
    <group name={`ScatterLayer-${layer.id}`}>
      {instances.map((item) => (
        <ScatterPropItem
          key={item.id}
          type={layer.type}
          position={item.pos}
          scale={item.scale}
          rotationY={item.rotY}
          color={resolvedColor}
        />
      ))}
    </group>
  );
};

export const WorldRenderer: React.FC = () => {
  const world = useStudioStore((s) => s.sceneSpec.world) ?? DEFAULT_WORLD_SPEC;

  const hdri = world.hdri?.url ? world.hdri : undefined;
  const hdriBackground = Boolean(hdri?.showBackground);

  const showDaySky =
    !hdriBackground &&
    (world.skybox === 'daylight-sky' ||
    world.skybox === 'sunset-atmosphere' ||
    world.skybox === 'overcast');

  const showStars =
    !hdriBackground && (world.skybox === 'night-stars' || world.skybox === 'cyber-void');

  return (
    <group name="OmniStageWorld">
      {/* External HDRI image-based lighting (Poly Haven via /api/assets proxy). Suspense keeps the
          stage rendering with the procedural RoomEnvironment while the .hdr streams in. */}
      {hdri && (
        <Suspense fallback={null}>
          <Environment
            key={hdri.url}
            files={hdri.url}
            background={hdriBackground}
            environmentIntensity={hdri.intensity ?? 1}
            backgroundIntensity={hdri.intensity ?? 1}
          />
        </Suspense>
      )}

      {showDaySky && (
        <Sky
          distance={450000}
          sunPosition={world.sunPosition || [18, 24, 14]}
          turbidity={
            world.skybox === 'sunset-atmosphere' ? 10 : world.skybox === 'overcast' ? 14 : 4
          }
          rayleigh={world.skybox === 'sunset-atmosphere' ? 3.2 : 1.2}
        />
      )}

      {showStars && (
        <Stars
          radius={80}
          depth={45}
          count={2500}
          factor={4}
          saturation={0.5}
          fade
          speed={0.8}
        />
      )}

      <ProceduralTerrain />
      <VolumetricClouds />
      <WeatherSystem type={world.weather.type} intensity={world.weather.intensity} />

      {(world.scatterObjects || []).map((layer) => (
        <ScatterObjectsLayer
          key={layer.id}
          layer={layer}
          terrainType={world.terrain.type}
          elevationScale={world.terrain.elevationScale}
        />
      ))}
    </group>
  );
};
