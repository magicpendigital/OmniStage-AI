/**
 * Phase 7 — WebGPU backend switch: builders hand their custom-shader parts to the installed node backend (and only then),
 * contact shadows step aside, and exports embed the WebGPU runtime only when asked. Pixel parity runs in the browser:
 * e2e/webgpu.e2e.ts (npm run test:e2e:gpu).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nodeBackend, setNodeBackend, NodeBackend } from '../src/render3d/backend';
import { createSky, createWater } from '../src/render3d/world3d';
import { createGroundGrid, createAmbientDust } from '../src/render3d/stage3d';
import { createGpuParticles } from '../src/render3d/gpuParticles';
import { createContactShadows } from '../src/render3d/contactShadows';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { buildStandalonePlayable } from '../src/exporter/mediaExporter';
import { PLAYER_RUNTIME } from '../src/exporter/generated/playerRuntime';
import { PLAYER_RUNTIME_WEBGPU } from '../src/exporter/generated/playerRuntimeWebgpu';

function fakeBackend(calls: string[]): NodeBackend {
  const built = (name: string) => () => {
    calls.push(name);
    const object = new THREE.Mesh();
    object.name = `node-${name}`;
    return { object, dispose: () => undefined };
  };
  return {
    name: 'webgpu',
    sky: built('sky'),
    water: built('water'),
    grid: built('grid'),
    particles: built('particles'),
    studioEnvironment: () => { calls.push('env'); return () => undefined; },
    bloom: () => ({ render: () => undefined, setSize: () => undefined, setCamera: () => undefined, dispose: () => undefined }),
  };
}

test('without a backend the WebGL builders are used; with one, custom-shader parts go to it', () => {
  const world = createBlankSceneSpec('3d').world;
  world.skybox = 'daylight-sky';
  setNodeBackend(null);
  assert.equal(nodeBackend(), null);
  assert.equal(createSky(world).object.name, 'DynamicSky');
  assert.ok((createGpuParticles({ kind: 'snow', count: 10, size: 0.2, color: '#fff' }).object as THREE.Points).isPoints);
  assert.ok(createContactShadows().object.children.length > 0);

  const calls: string[] = [];
  setNodeBackend(fakeBackend(calls));
  try {
    assert.equal(createSky(world).object.name, 'node-sky');
    assert.equal(createWater(world, 0, 'high').object.name, 'node-water');
    assert.equal(createGroundGrid({ rimLightColor: '#0ff' } as any).object.name, 'node-grid');
    assert.equal(createAmbientDust({} as any).object.name, 'AmbientDust'); // renamed on top of the node particles
    assert.equal(createGpuParticles({ kind: 'rain', count: 10, size: 0.2, color: '#fff' }).object.name, 'node-particles');
    assert.equal(createContactShadows().object.children.length, 0, 'contact shadows step aside under WebGPU');
    assert.deepEqual(calls, ['sky', 'water', 'grid', 'particles', 'particles']);
  } finally {
    setNodeBackend(null);
  }
});

test('exports embed the WebGPU runtime only when the renderer asks for it', async () => {
  const scene = createBlankSceneSpec('3d', 'Export');
  const noFetch = async () => { throw new Error('offline test'); };
  const gl = await buildStandalonePlayable(scene, 'universal', [scene], { fetcher: noFetch });
  assert.ok(gl.html.includes('"renderer":"webgl"'));
  assert.ok(gl.html.length < PLAYER_RUNTIME_WEBGPU.length, 'default export stays on the small WebGL runtime');
  const gpu = await buildStandalonePlayable(scene, 'universal', [scene], { fetcher: noFetch, renderer: 'auto' });
  assert.ok(gpu.html.includes('"renderer":"auto"'));
  assert.ok(gpu.html.length > gl.html.length + (PLAYER_RUNTIME_WEBGPU.length - PLAYER_RUNTIME.length) * 0.9);
});
