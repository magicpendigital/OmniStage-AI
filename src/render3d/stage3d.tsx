/** @jsxRuntime classic */
/** @jsx h */
/**
 * Phase 7B — studio lighting rig, background / fog, studio reflection environment and reflective pedestal as plain
 * Three.js, shared by the studio SceneDirector and the OmniStage Player.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneSpec } from '../types/scene.schema';
import { disposeObject, h } from './h';
import type { Built3D } from './types';

type Env = SceneSpec['environment'];

/** Hemisphere + shadowed warm key + cool fill + rim spot (the studio's calibrated 3-point rig). */
export function createLightingRig(env: Env, shadows: boolean): Built3D<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'LightingRig';
  const hemi = new THREE.HemisphereLight(env.keyLightColor || '#FFFBEB', env.groundColor || '#0F172A', env.ambientIntensity ?? 0.75);
  const key = new THREE.DirectionalLight(env.keyLightColor || '#FFFBEB', env.keyLightIntensity ?? 2.2);
  key.position.set(5.5, 8.5, 6.0);
  key.castShadow = shadows;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { near: 0.5, far: 25, left: -7, right: 7, top: 7, bottom: -7 });
  key.shadow.bias = -0.0005;
  const fill = new THREE.DirectionalLight('#93C5FD', 0.9);
  fill.position.set(-5.0, 4.0, 3.5);
  const rim = new THREE.SpotLight(env.rimLightColor || '#38BDF8', 3.4, 0, 0.65, 0.8);
  rim.position.set(0, 6.5, -6.5);
  group.add(hemi, key, fill, rim, rim.target);
  return { object: group, dispose: () => { key.shadow.map?.dispose(); rim.shadow.map?.dispose(); } };
}

export function createPedestal(env: Env): Built3D<THREE.Group> {
  const group: THREE.Group = (
    <group position={[0, 0.005, 0]} name="Pedestal">
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[3.2, 64]} />
        <meshPhysicalMaterial color={env.groundColor || '#0F172A'} metalness={0.85} roughness={0.12} clearcoat={1} reflectivity={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <ringGeometry args={[3.14, 3.22, 64]} />
        <meshBasicMaterial color={env.rimLightColor || '#38BDF8'} transparent opacity={0.65} />
      </mesh>
    </group>
  );
  return { object: group, dispose: () => disposeObject(group) };
}

/** Simple ground grid for hosts without drei's shader grid (the Player). */
export function createGroundGrid(env: Env): Built3D<THREE.GridHelper> {
  const grid = new THREE.GridHelper(30, 30, env.rimLightColor || '#06B6D4', '#1E293B');
  grid.position.y = 0.008;
  const mats = (Array.isArray(grid.material) ? grid.material : [grid.material]) as THREE.Material[];
  for (const m of mats) Object.assign(m, { transparent: true, opacity: 0.55 });
  return { object: grid, dispose: () => { grid.geometry.dispose(); mats.forEach((m) => m.dispose()); } };
}

/** Background colour + horizon fog exactly as the studio sets them. */
export function applyBackgroundAndFog(scene: THREE.Scene, env: Env) {
  scene.background = new THREE.Color(env.backgroundColor || '#0B101B');
  scene.fog = new THREE.Fog(env.fogColor || env.backgroundColor || '#0B101B', env.fogNear || 14, env.fogFar || 45);
}

/** Procedural studio reflections (RoomEnvironment through PMREM). Returns a disposer. */
export function applyStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): () => void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.04).texture;
  scene.environment = texture;
  pmrem.dispose();
  (room as any).dispose?.();
  return () => {
    if (scene.environment === texture) scene.environment = null;
    texture.dispose();
  };
}

/** Renderer settings shared by the studio canvas and the Player. */
export function configureRenderer(renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
}
