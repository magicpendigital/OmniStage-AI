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
import { createGpuParticles } from './gpuParticles';
import { sceneFogColor } from '../runtime/world';

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

/**
 * Phase 7C — anti-aliased shader grid with cell + section lines that fade with camera distance (same look and
 * parameters as drei's <Grid>, which the studio used before), shared by the studio and the Player.
 */
export function createGroundGrid(env: Env, opts: { size?: number; cellSize?: number; sectionSize?: number; fadeDistance?: number } = {}): Built3D<THREE.Mesh> {
  const size = opts.size ?? 30;
  const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      cellSize: { value: opts.cellSize ?? 1 },
      cellThickness: { value: 0.6 },
      cellColor: { value: new THREE.Color('#1E293B') },
      sectionSize: { value: opts.sectionSize ?? 5 },
      sectionThickness: { value: 1.1 },
      sectionColor: { value: new THREE.Color(env.rimLightColor || '#06B6D4') },
      fadeDistance: { value: opts.fadeDistance ?? 24 },
      fadeStrength: { value: 1.2 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorld;
      void main() {
        vLocal = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorld;
      uniform float cellSize, cellThickness, sectionSize, sectionThickness, fadeDistance, fadeStrength;
      uniform vec3 cellColor, sectionColor;
      float gridLine(float s, float thickness) {
        vec2 r = vLocal.xz / s;
        vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        float line = min(g.x, g.y) + 1.0 - thickness;
        return 1.0 - min(line, 1.0);
      }
      void main() {
        float g1 = gridLine(cellSize, cellThickness);
        float g2 = gridLine(sectionSize, sectionThickness);
        float d = 1.0 - min(distance(cameraPosition, vWorld) / fadeDistance, 1.0);
        vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));
        float alpha = (g1 + g2) * pow(d, fadeStrength);
        alpha = mix(0.75 * alpha, alpha, g2);
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const grid = new THREE.Mesh(geometry, material);
  grid.name = 'GroundGrid';
  grid.position.y = 0.008;
  grid.frustumCulled = false;
  return { object: grid, dispose: () => { geometry.dispose(); material.dispose(); } };
}

/** Phase 7C: the studio's subtle ambient sparkle dust (was drei <Sparkles>), now also in the Player. */
export function createAmbientDust(env: Env): Built3D<THREE.Points> {
  const dust = createGpuParticles({ kind: 'sparkles', count: 24, spread: 10, size: 0.06, color: env.rimLightColor || '#38BDF8' });
  dust.object.name = 'AmbientDust';
  return dust;
}

/** Background colour + horizon fog exactly as the studio sets them (fog follows the sky's horizon outdoors). */
export function applyBackgroundAndFog(scene: THREE.Scene, env: Env, world?: Pick<SceneSpec['world'], 'skybox'>) {
  scene.background = new THREE.Color(env.backgroundColor || '#0B101B');
  scene.fog = new THREE.Fog(sceneFogColor(env, world), env.fogNear || 14, env.fogFar || 45);
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
