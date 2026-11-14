/**
 * Phase 7 — WebGPU backend for the shared 3D builders: the custom GLSL parts ported to TSL node materials (sky, reflective
 * water, shader grid, GPU particles), node-based PMREM and bloom, and the renderer factory. Only the WebGPU build of the
 * OmniStage Player imports this module.
 *
 * Every port keeps the maths of its GLSL twin (same uniforms, same constants) so WebGL and WebGPU frames match.
 */
import * as THREE from 'three';
import {
  AdditiveBlending, InstancedBufferAttribute, MeshBasicNodeMaterial, NormalBlending, PMREMGenerator, RenderPipeline,
  SpriteNodeMaterial, WebGPURenderer,
} from 'three/webgpu';
import {
  abs, cameraPosition, clamp, cos, dot, float, fract, Fn, fwidth, instancedBufferAttribute, length, max, min, mix, mod,
  normalize, pass, positionLocal, positionWorld, pow, reflect, reflector, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { bloom as bloomNode } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { NodeBackend } from '../backend';
import { SKY_PALETTES } from '../../runtime/world';
import type { Built3D, FrameContext } from '../types';
import type { GpuParticleOptions } from '../gpuParticles';
import { PARTICLE_KINDS } from '../gpuParticles';
import { DEFAULT_BLOOM } from '../postfx';

const TAU = 6.283185;

// ------------------------------------------------------------------------------------------------ sky
function sky(world: Parameters<NodeBackend['sky']>[0]): Built3D<THREE.Mesh> {
  const uTime = uniform(0), uDuration = uniform(8), uStrength = uniform(1);
  // (typed loosely: the TSL typings do not model colour × vec3)
  const uZenith: any = uniform(new THREE.Color()), uHorizon: any = uniform(new THREE.Color()), uSun = uniform(new THREE.Vector3(0, 1, 0));
  const [zenith, horizon, strength] = SKY_PALETTES[world.skybox] || SKY_PALETTES['sunset-atmosphere'];
  uZenith.value.set(zenith);
  uHorizon.value.set(horizon);
  uStrength.value = strength;
  uSun.value.set(...world.sunPosition);
  if (uSun.value.lengthSq() < 0.0001) uSun.value.set(0, 1, 0);
  const material = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  // Follow the camera (the sky stays at infinity, like the GLSL version that drops the view translation).
  material.positionNode = positionLocal.mul(300).add(cameraPosition);
  material.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const cycle = float(0.5).sub(cos(uTime.div(max(uDuration, 2)).mul(TAU)).mul(0.5));
    const elevation = pow(max(dir.y, 0), 0.45);
    const hz = mix(uHorizon, uHorizon.mul(vec3(1.16, 0.82, 0.78)), cycle.mul(0.55));
    const zn = mix(uZenith, uZenith.mul(vec3(0.72, 0.78, 1.15)), cycle.mul(0.65));
    const color = mix(hz, zn, elevation).toVar();
    const solar = max(dot(dir, normalize(uSun)), 0);
    color.addAssign(vec3(1, 0.65, 0.32).mul(pow(solar, 18)).mul(0.35).mul(uStrength));
    color.addAssign(vec3(1, 0.9, 0.68).mul(smoothstep(0.9993, 0.9998, solar)).mul(2).mul(uStrength));
    return color;
  })();
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'DynamicSky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return {
    object: mesh,
    update(ctx) {
      uTime.value = ctx.time;
      uDuration.value = ctx.duration;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ------------------------------------------------------------------------------------------------ water
function water(world: Parameters<NodeBackend['water']>[0], level: number, quality: Parameters<NodeBackend['water']>[2], reflectionSize: number): Built3D {
  const geometry = new THREE.PlaneGeometry(140, 140);
  if (quality === 'low') {
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
  const uTime = uniform(0);
  const uColor = uniform(new THREE.Color('#075d77'));
  const sun = new THREE.Vector3(...world.sunPosition).normalize();
  if (sun.lengthSq() < 0.0001) sun.set(0, 1, 0);
  const uSun = uniform(sun);
  const uSunColor = uniform(new THREE.Color(world.skybox === 'sunset-atmosphere' ? '#ffbc78' : '#fff4d6'));
  const reflection = reflector({ resolutionScale: Math.min(1, reflectionSize / 1024) } as any);
  const material = new MeshBasicNodeMaterial({ fog: true });
  const slopeOf = () => {
    const p = positionWorld.xz;
    const a = dot(p, vec2(0.75, 0.42)).add(uTime.mul(1.15));
    const b = dot(p, vec2(-0.38, 1.12)).sub(uTime.mul(0.85));
    const c = dot(p, vec2(2.3, 1.7)).add(uTime.mul(1.8));
    const slope = vec2(0.75, 0.42).mul(cos(a).mul(0.08)).add(vec2(-0.38, 1.12).mul(cos(b).mul(0.045))).add(vec2(2.3, 1.7).mul(cos(c).mul(0.012)));
    return { a, b, slope };
  };
  // ripple the reflection lookup like the GLSL version (uv + slope · 0.018)
  reflection.uvNode = reflection.uvNode!.add(slopeOf().slope.mul(0.018));
  material.colorNode = Fn(() => {
    const { a, b, slope } = slopeOf();
    const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
    const eye = normalize(cameraPosition.sub(positionWorld));
    const fresnel = float(0.025).add(float(0.975).mul(pow(float(1).sub(max(dot(eye, normal), 0)), 5)));
    const specular = pow(max(dot(reflect(uSun.negate(), normal), eye), 0), 180);
    const ripple = float(0.5).add(sin(a).mul(sin(b)).mul(0.5));
    const body = uColor.mul(float(0.75).add(ripple.mul(0.25)));
    return mix(body, reflection.rgb, float(0.2).add(fresnel.mul(0.8))).add(uSunColor.mul(specular).mul(1.4));
  })();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ReflectiveWater';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = level;
  mesh.add(reflection.target);
  return {
    object: mesh,
    update(ctx) { uTime.value = ctx.time; },
    dispose() { geometry.dispose(); material.dispose(); (reflection as any).dispose?.(); },
  };
}

// ------------------------------------------------------------------------------------------------ grid
function grid(env: Parameters<NodeBackend['grid']>[0], opts: Parameters<NodeBackend['grid']>[1]): Built3D<THREE.Mesh> {
  const geometry = new THREE.PlaneGeometry(opts.size, opts.size).rotateX(-Math.PI / 2);
  const cellColor = uniform(new THREE.Color('#1E293B'));
  const sectionColor = uniform(new THREE.Color(env.rimLightColor || '#06B6D4'));
  const line = (s: number, thickness: number) => {
    const r = positionLocal.xz.div(s);
    const g = abs(fract(r.sub(0.5)).sub(0.5)).div(fwidth(r));
    const l = min(g.x, g.y).add(1 - thickness);
    return float(1).sub(min(l, 1));
  };
  const g1 = line(opts.cellSize, 0.6);
  const g2 = line(opts.sectionSize, 1.1);
  const d = float(1).sub(min(length(cameraPosition.sub(positionWorld)).div(opts.fadeDistance), 1));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  material.colorNode = mix(cellColor, sectionColor, min(1, g2.mul(1.1)));
  const alpha = g1.add(g2).mul(pow(d, 1.2));
  material.opacityNode = mix(alpha.mul(0.75), alpha, g2);
  material.alphaTest = 0.001;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'GroundGrid';
  mesh.position.y = 0.005;
  return { object: mesh, dispose() { geometry.dispose(); material.dispose(); } };
}

// ------------------------------------------------------------------------------------------------ particles
/** Same seeds and motion as the GLSL point shader, drawn as instanced sprites (WebGPU has no large points). */
function particles(opts: GpuParticleOptions): Built3D {
  const count = Math.min(4096, Math.max(0, Math.floor(Number.isFinite(opts.count) ? opts.count : 0)));
  const spread = opts.spread ?? 48;
  const positions = new Float32Array(Math.max(1, count) * 3);
  const seeds = new Float32Array(Math.max(1, count) * 4);
  let seed = 1234567;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const x = random(), y = random(), z = random(), w = random();
    seeds.set([x, y, z, w], i * 4);
    positions.set([(x - 0.5) * spread, y * (spread > 10 ? 24 : 3.6), (z - 0.5) * spread], i * 3);
  }
  const p0: any = instancedBufferAttribute(new InstancedBufferAttribute(positions, 3));
  const s: any = instancedBufferAttribute(new InstancedBufferAttribute(seeds, 4));
  const t = uniform(0);
  const uColor = uniform(new THREE.Color(opts.color));
  const kind = PARTICLE_KINDS.indexOf(opts.kind);
  const speed = float(0.6).add(s.w.mul(0.8));
  let pos: any = p0;
  let alpha: any = float(1);
  switch (kind) {
    case 0: // rain
      pos = vec3(mod(p0.x.sub(t.mul(1.5)).add(24), 48).sub(24), mod(p0.y.sub(t.mul(18).mul(speed)), 24), p0.z);
      break;
    case 1: // snow
      pos = vec3(p0.x.add(sin(t.mul(0.6).add(s.x.mul(TAU))).mul(0.8)), mod(p0.y.sub(t.mul(2.6).mul(speed)), 24), p0.z.add(cos(t.mul(0.4).add(s.z.mul(TAU))).mul(0.5)));
      break;
    case 2: { // embers
      const y = mod(p0.y.add(t.mul(2.2).mul(speed)), 24);
      pos = vec3(p0.x.add(sin(t.add(s.x.mul(TAU))).mul(0.6)), y, p0.z);
      alpha = sin(y.div(24).mul(3.14159));
      break;
    }
    case 3: // mist
      pos = vec3(p0.x.add(sin(t.mul(0.2).add(s.x.mul(TAU))).mul(2)), p0.y.mul(0.25), p0.z);
      alpha = float(0.2);
      break;
    case 4: // sparkles
      pos = p0.add(vec3(sin(t.mul(0.7).add(s.x.mul(TAU))), cos(t.mul(0.5).add(s.y.mul(TAU))), sin(t.mul(0.4).add(s.z.mul(TAU)))).mul(0.3));
      alpha = float(0.3).add(pow(float(0.5).add(sin(t.mul(2).add(s.w.mul(20))).mul(0.5)), 3).mul(0.7));
      break;
    case 5: // confetti
      pos = vec3(p0.x.add(sin(t.add(s.x.mul(TAU))).mul(0.5)), mod(p0.y.sub(t.mul(speed)), 3.6), p0.z);
      break;
    default: { // burst
      const age = clamp(t, 0, 1);
      const dir = normalize(vec3(s.x.sub(0.5), s.y.mul(0.7).add(0.1), s.z.sub(0.5)));
      const out = dir.mul(age).mul(float(1.5).add(s.w.mul(2)));
      pos = vec3(out.x, out.y.sub(age.mul(age).mul(1.6)), out.z);
      alpha = float(1).sub(age).mul(float(1).sub(age));
    }
  }
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: true, blending: (opts.kind === 'floating-embers' || opts.kind === 'sparkles' || opts.kind === 'burst') ? AdditiveBlending : NormalBlending });
  material.positionNode = pos;
  material.scaleNode = float(opts.size);
  const q = uv().sub(0.5);
  let shape: any;
  let color: any = uColor;
  if (kind === 0) {
    shape = float(1).sub(smoothstep(0.025, 0.1, abs(q.x))).mul(float(1).sub(smoothstep(0.3, 0.5, abs(q.y))));
  } else if (kind === 5) {
    const a = s.w.mul(TAU);
    const r = vec2(cos(a).mul(q.x).sub(sin(a).mul(q.y)), sin(a).mul(q.x).add(cos(a).mul(q.y)));
    shape = float(1).sub(smoothstep(0.22, 0.28, abs(r.x))).mul(float(1).sub(smoothstep(0.1, 0.16, abs(r.y))));
    color = mix(uColor, cos(vec3(0, 2.1, 4.2).add(s.w.mul(TAU))).mul(0.5).add(0.5), 0.7);
  } else {
    shape = pow(max(float(0), float(1).sub(length(q).mul(2))), 2);
  }
  material.colorNode = vec4(color, 1).rgb;
  material.opacityNode = shape.mul(alpha).mul(opts.size > 0 ? 1 : 0);
  material.alphaTest = 0.01;
  const sprite = new THREE.Sprite(material as unknown as THREE.SpriteMaterial);
  (sprite as any).count = count;
  sprite.name = `GPU-${opts.kind}`;
  sprite.frustumCulled = false;
  sprite.scale.setScalar(opts.scale ?? 1);
  return {
    object: sprite,
    update(ctx: FrameContext) {
      t.value = opts.createdAt === undefined ? Math.max(0, ctx.time - (opts.startTime ?? 0)) : Math.max(0, (ctx.nowMs - opts.createdAt) / 600);
    },
    dispose() { material.dispose(); },
  };
}

// ------------------------------------------------------------------------------------------------ environment + bloom
function studioEnvironment(renderer: unknown, scene: THREE.Scene): () => void {
  const pmrem = new PMREMGenerator(renderer as WebGPURenderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room as unknown as THREE.Scene, 0.04).texture;
  scene.environment = texture;
  pmrem.dispose();
  (room as any).dispose?.();
  return () => {
    if (scene.environment === texture) scene.environment = null;
    texture.dispose();
  };
}

function bloom(renderer: unknown, scene: THREE.Scene, camera: THREE.Camera, opts: Parameters<NodeBackend['bloom']>[3] = {}) {
  const o = { ...DEFAULT_BLOOM, ...opts };
  const post = new RenderPipeline(renderer as WebGPURenderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  post.outputNode = color.add(bloomNode(color, o.strength, o.radius, o.threshold));
  return {
    render: () => post.render(),
    setSize: () => undefined, // follows the renderer size
    setCamera: (c: THREE.Camera) => { scenePass.camera = c; },
    dispose: () => post.dispose(),
  };
}

export const webgpuBackend: NodeBackend = { name: 'webgpu', sky, water, grid, particles, studioEnvironment, bloom };

/**
 * A WebGPU renderer, or null when this device has no WebGPU adapter (the caller keeps WebGL). The renderer is ready to
 * render synchronously (init awaited), which the Player's frame-stepped capture relies on.
 */
export async function createWebGPURenderer(opts: { antialias: boolean }): Promise<WebGPURenderer | null> {
  const gpu = (navigator as any).gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const renderer = new WebGPURenderer({ antialias: opts.antialias, powerPreference: 'high-performance' });
    await renderer.init();
    if (!(renderer.backend as any)?.isWebGPUBackend) {
      renderer.dispose();
      return null;
    }
    return renderer;
  } catch {
    return null;
  }
}
