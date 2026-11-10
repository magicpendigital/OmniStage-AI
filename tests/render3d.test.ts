import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { h } from '../src/render3d/h';
import { buildCompositeActor } from '../src/render3d/compositeActors';
import { actorInTimeline, actorMotion } from '../src/render3d/actorMotion';
import { createWorld, scatterPlacements, waterLevelFor } from '../src/render3d/world3d';
import { createLightingRig } from '../src/render3d/stage3d';
import { createGpuParticles } from '../src/render3d/gpuParticles';
import { ASSET_REGISTRY, createBlankSceneSpec, DEFAULT_WORLD_SPEC } from '../src/registry/assetRegistry';
import type { ActorNode, WorldSpec } from '../src/types/scene.schema';

function actor(assetId: string, extra: Partial<ActorNode> = {}): ActorNode {
  return { ...createBlankSceneSpec('3d').actors[0], assetId, ...extra };
}

function count(root: THREE.Object3D, pred: (o: THREE.Object3D) => boolean) {
  let n = 0;
  root.traverse((o) => { if (pred(o)) n++; });
  return n;
}

test('h() builds plain Three.js objects from R3F-style JSX calls', () => {
  const g = h('group', { position: [1, 2, 3], rotation: [0, 1, 0] },
    h('mesh', { castShadow: true }, h('boxGeometry', { args: [2, 1, 1] }), h('meshStandardMaterial', { color: '#ff0000', emissiveIntensity: 2 })),
    [h('pointLight', { intensity: 3, distance: 4 })], null, false) as THREE.Group;
  assert.ok(g instanceof THREE.Group);
  assert.deepEqual(g.position.toArray(), [1, 2, 3]);
  const mesh = g.children[0] as THREE.Mesh;
  assert.ok(mesh.geometry instanceof THREE.BoxGeometry);
  assert.equal((mesh.geometry as THREE.BoxGeometry).parameters.width, 2);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(), 'ff0000');
  assert.equal(mesh.castShadow, true);
  assert.ok(g.children[1] instanceof THREE.PointLight);
  assert.throws(() => h('notAThing', null), /unsupported tag/);
});

test('every procedural registry asset builds the studio composite (no stand-ins)', () => {
  const procedural = Object.keys(ASSET_REGISTRY).filter((id) => !ASSET_REGISTRY[id].modelUrl);
  assert.ok(procedural.includes('mystery-gift-box') && procedural.includes('cyber-mecha-bot'));
  for (const id of [...procedural, 'unknown-asset']) {
    const obj = buildCompositeActor(actor(id));
    assert.ok(count(obj, (o) => (o as THREE.Mesh).isMesh) >= 2, `${id} has meshes`);
  }
  // Gift box reacts to taps: brighter ribbons and a lifted lid.
  const closed = buildCompositeActor(actor('mystery-gift-box'), 0);
  const tapped = buildCompositeActor(actor('mystery-gift-box'), 2);
  const light = (o: THREE.Object3D) => { let l: THREE.PointLight | undefined; o.traverse((x) => { if (x instanceof THREE.PointLight) l = x; }); return l!; };
  assert.ok(light(tapped).intensity > light(closed).intensity);
});

test('actor motion matches the studio rules (rig suppresses procedural walk, pulse, enter effects)', () => {
  const a = actor('cyber-mecha-bot', { activeAnimation: 'walk' });
  assert.notEqual(actorMotion(a, 'game', 0.3, false).offset[1], 0, 'procedural walk bob');
  assert.equal(actorMotion(a, 'game', 0.3, true).offset[1], 0, 'skeletal clip owns walk');
  assert.ok(Math.abs(actorMotion({ ...a, activeAnimation: 'spin' }, 'game', 1, true).rotation[1] - 1.8) < 1e-9, 'spin still applies to rigs');
  assert.ok(actorMotion(a, 'game', 0, false, 1).offset[1] >= 0.6, 'click jump');
  const media = { ...a, startTime: 2, enterEffect: 'pop-in' as const };
  assert.equal(actorMotion(media, 'media', 2, false).scale, 0);
  assert.equal(actorMotion(media, 'media', 3, false).scale, 1);
  assert.equal(actorInTimeline({ ...a, startTime: 2, endTime: 4 }, 'media', 5), false);
  assert.equal(actorInTimeline({ ...a, startTime: 2, endTime: 4 }, 'game', 5), true);
});

test('world builder: sky, terrain, water, clouds, weather and scatter from WorldSpec', () => {
  const world: WorldSpec = structuredClone(DEFAULT_WORLD_SPEC);
  world.terrain = { ...world.terrain, type: 'ocean-island', waterLevel: 0.6 };
  world.clouds = { ...world.clouds, enabled: true, density: 0.5 };
  world.weather = { type: 'snow', intensity: 1 };
  world.skybox = 'night-stars';
  world.scatterObjects = [{ id: 'trees', type: 'pine-trees', count: 12, spreadRadius: 20, scaleRange: [0.8, 1.2] }];
  const built = createWorld(world, { quality: 'low' });
  const names = new Set<string>();
  built.object.traverse((o) => names.add(o.name));
  for (const n of ['DynamicSky', 'Stars', 'WorldTerrain', 'ReflectiveWater', 'WorldClouds', 'GPU-snow', 'ScatterLayer-trees']) assert.ok(names.has(n), n);
  assert.equal(built.object.getObjectByName('ReflectiveWater')!.position.y, 0.6 - 0.35);
  built.update?.({ time: 3, duration: 8, nowMs: 0, clock: 1, viewportHeight: 720 });
  assert.ok(built.object.getObjectByName('WorldClouds')!.rotation.y > 0, 'clouds drift with the timeline');
  built.dispose();

  assert.equal(waterLevelFor({ ...world, terrain: { ...world.terrain, type: 'flat-grid', waterLevel: 0 } }), null);
  const placements = scatterPlacements(world.scatterObjects[0], 'flat-grid', 1);
  assert.equal(placements.length, 12);
  assert.ok(placements.every((p) => Math.hypot(p.pos[0], p.pos[2]) >= 5.2), 'play area stays clear');
});

test('lighting rig and GPU particles', () => {
  const env = createBlankSceneSpec('3d').environment;
  const rig = createLightingRig(env, true);
  assert.equal(count(rig.object, (o) => (o as THREE.Light).isLight), 4);
  const p = createGpuParticles({ kind: 'burst', count: 99999, color: '#fff', size: 0.1, createdAt: 1000 });
  assert.equal(p.object.geometry.getAttribute('position').count, 4096, 'capped');
  p.update?.({ time: 0, duration: 8, nowMs: 1300, clock: 0, viewportHeight: 600 });
  assert.equal((p.object.material as THREE.ShaderMaterial).uniforms.uTime.value, 0.5);
});

test('Phase 7C shared builders: shader grid, contact shadows, ambient dust', async () => {
  const { createGroundGrid, createAmbientDust } = await import('../src/render3d/stage3d');
  const { createContactShadows } = await import('../src/render3d/contactShadows');
  const env = createBlankSceneSpec('3d').environment;
  const grid = createGroundGrid({ ...env, rimLightColor: '#ff0000' });
  const mat = grid.object.material as THREE.ShaderMaterial;
  assert.equal(mat.uniforms.sectionColor.value.getHexString(), new THREE.Color('#ff0000').getHexString());
  assert.equal(mat.uniforms.fadeDistance.value, 24);
  grid.dispose();

  const shadows = createContactShadows({ scale: 10, far: 4 });
  const plane = shadows.object.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
  const cam = shadows.object.children.find((c) => (c as THREE.OrthographicCamera).isOrthographicCamera) as THREE.OrthographicCamera;
  assert.equal(cam.far, 4);
  assert.equal(cam.right - cam.left, 10);
  assert.ok((plane.material as THREE.MeshBasicMaterial).map, 'plane shows the shadow render target');
  assert.equal(typeof shadows.prerender, 'function');
  // Camera looks straight up (+y): local -z maps to world +y.
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation);
  assert.ok(dir.y > 0.999);
  shadows.dispose();

  const dust = createAmbientDust(env);
  assert.equal(dust.object.geometry.getAttribute('position').count, 24);
  dust.dispose();
});
