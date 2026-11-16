/**
 * Phase 6 Batch 3 — actor shader effects: a fixed set of presets (data only). Param sanitising, the dissolve clock, the
 * verifier rule + fix, the AI normaliser and the material swap of the shared builder (GLSL kit and node-backend kit).
 * Pixels: e2e/player.e2e.ts (WebGL) and e2e/webgpu.e2e.ts (WebGPU vs WebGL parity).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  resolveShaderEffect, sanitizeShaderEffect, shaderEffectCastsShadow, shaderEffectProblem, shaderEffectProgress, SHADER_EFFECT_PRESETS,
} from '../src/runtime/shaderEffects';
import { ActorShaderEffect, dissolveThreshold } from '../src/render3d/shaderEffects';
import { setNodeBackend, NodeBackend } from '../src/render3d/backend';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { ActorNode, SceneSpec } from '../src/types/scene.schema';

test('sanitizeShaderEffect keeps known presets, clamps numbers, normalises colours, drops junk', () => {
  assert.equal(sanitizeShaderEffect(null), null);
  assert.equal(sanitizeShaderEffect({ preset: 'glsl: void main(){}' }), null);
  assert.equal(sanitizeShaderEffect({ color: '#fff' }), null);
  assert.deepEqual(sanitizeShaderEffect({ preset: 'hologram' }), { preset: 'hologram' });
  assert.deepEqual(
    sanitizeShaderEffect({ preset: 'lava', color: '#F80', intensity: 9, speed: -1, progress: 2, code: 'x', progressTween: { from: 0 } }),
    { preset: 'lava', color: '#ff8800', intensity: 3, speed: 0, progress: 1 },
  );
  assert.deepEqual(sanitizeShaderEffect({ preset: 'toon', color: 'red', intensity: Number.NaN }), { preset: 'toon' });
  assert.deepEqual(
    sanitizeShaderEffect({ preset: 'dissolve', progressTween: { from: 1, to: -3, start: 2, duration: 1.5 } }),
    { preset: 'dissolve', progressTween: { from: 1, to: 0, start: 2, duration: 1.5 } },
  );
  for (const preset of SHADER_EFFECT_PRESETS) assert.deepEqual(sanitizeShaderEffect({ preset }), { preset });
});

test('shaderEffectProblem: clean effects pass, unknown presets and out-of-range values are explained', () => {
  assert.equal(shaderEffectProblem({ preset: 'forcefield', color: '#22d3ee', intensity: 1.5 }), null);
  assert.equal(shaderEffectProblem({ intensity: 1, preset: 'rainbow' }), null, 'key order does not matter');
  assert.match(String(shaderEffectProblem({ preset: 'fire' })), /unknown preset "fire"/);
  assert.match(String(shaderEffectProblem({ preset: 'toon', intensity: 7 })), /out of range/);
  assert.match(String(shaderEffectProblem({ preset: 'toon', shader: 'gl_FragColor = vec4(1);' })), /unknown fields/);
});

test('dissolve progress: static value, smoothstep tween, threshold and shadows', () => {
  assert.equal(shaderEffectProgress({ preset: 'dissolve' }, 3), 0);
  assert.equal(shaderEffectProgress({ preset: 'dissolve', progress: 0.4 }, 3), 0.4);
  const fx = { preset: 'dissolve' as const, progressTween: { from: 0, to: 1, start: 2, duration: 2 } };
  assert.equal(shaderEffectProgress(fx, 0), 0);
  assert.equal(shaderEffectProgress(fx, 3), 0.5);
  assert.equal(shaderEffectProgress(fx, 9), 1);
  assert.ok(shaderEffectProgress(fx, 2.5) < 0.25, 'eased in');
  assert.equal(shaderEffectProgress({ preset: 'dissolve', progressTween: { from: 1, to: 0, start: 1, duration: 0 } }, 1), 0);
  assert.equal(dissolveThreshold(0), -1, 'nothing discarded at 0');
  assert.equal(dissolveThreshold(1), 2, 'everything discarded at 1');
  assert.ok(dissolveThreshold(0.5) > 0.15 && dissolveThreshold(0.5) < 0.85);
  assert.equal(shaderEffectCastsShadow({ preset: 'hologram', progress: 0 }), false);
  assert.equal(shaderEffectCastsShadow({ preset: 'dissolve', progress: 0.2 }), true);
  assert.equal(shaderEffectCastsShadow({ preset: 'dissolve', progress: 0.7 }), false);
  assert.equal(shaderEffectCastsShadow({ preset: 'lava', progress: 0 }), true);
});

test('resolveShaderEffect: defaults, preset colour and the speed-scaled clock', () => {
  const r = resolveShaderEffect({ preset: 'hologram', speed: 2 }, 1.5);
  assert.deepEqual(r, { preset: 'hologram', color: '#38bdf8', intensity: 1, t: 3, progress: 0 });
  assert.equal(resolveShaderEffect({ preset: 'toon', color: '#123456', intensity: 2 }, 0).color, '#123456');
});

function spec3D(fx: unknown): SceneSpec {
  const spec = createBlankSceneSpec('3d', 'Shader fx fixture');
  const actor = { ...spec.actors[0], id: 'hero', name: 'Hero', shaderEffect: fx } as ActorNode;
  spec.actors = [actor];
  return spec;
}

test('verifier flags invalid shader effects and the fix cleans or removes them', () => {
  assert.ok(!verifySceneSpec(spec3D({ preset: 'hologram', intensity: 1.2 })).issues.some((i) => i.code === 'actor.shader-effect-invalid'));

  const bad = spec3D({ preset: 'lava', intensity: 12, source: 'void main(){}' });
  const issue = verifySceneSpec(bad).issues.find((i) => i.code === 'actor.shader-effect-invalid');
  assert.ok(issue && issue.fixable && issue.targetId === 'hero');
  const fixed = autoFixSceneSpec(bad);
  assert.deepEqual(fixed.spec.actors[0].shaderEffect, { preset: 'lava', intensity: 3 });
  assert.ok(!fixed.report.issues.some((i) => i.code === 'actor.shader-effect-invalid'));

  const unknown = autoFixSceneSpec(spec3D({ preset: 'portal' }));
  assert.equal(unknown.spec.actors[0].shaderEffect, undefined);
  assert.ok(unknown.fixes.some((f) => /shader effect/.test(f)));
});

test('AI normaliser keeps a clean shader effect and drops an unknown one', async () => {
  const { normalizeGeneratedSceneSpec } = await import('../src/agent/storyboardAgent');
  const base = createBlankSceneSpec('3d', 'Norm');
  const raw = { ...base, actors: [{ ...base.actors[0], shaderEffect: { preset: 'dissolve', progress: 4, color: '#abc' } }, { ...base.actors[0], id: 'b', shaderEffect: { preset: 'x' } }] };
  const out = normalizeGeneratedSceneSpec(raw, '3d');
  assert.deepEqual(out.actors[0].shaderEffect, { preset: 'dissolve', progress: 1, color: '#aabbcc' });
  assert.equal(out.actors[1].shaderEffect, undefined);
});

function actorGroup() {
  const root = new THREE.Group();
  const body = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: '#ff0000' }));
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5), [new THREE.MeshBasicMaterial(), new THREE.MeshLambertMaterial()]);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial());
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  badge.userData.omniNoShaderFx = true;
  root.add(body, head, water, badge);
  return { root, body, head, water, badge };
}

test('ActorShaderEffect swaps eligible materials (GLSL kit), follows the preset and restores everything', () => {
  const { root, body, head, water, badge } = actorGroup();
  const original = body.material;
  const fx = new ActorShaderEffect(root);
  fx.update({ preset: 'hologram' }, { time: 1 });
  assert.equal(fx.meshCount, 2, 'shader / opted-out meshes keep their own look');
  assert.notEqual(body.material, original);
  assert.equal((body.material as THREE.Material).transparent, true, 'hologram is see-through');
  assert.equal(typeof (body.material as THREE.Material).onBeforeCompile, 'function');
  assert.equal((body.material as THREE.Material).customProgramCacheKey(), 'omni-fx-hologram');
  assert.equal(body.castShadow, false, 'holograms cast no shadow');
  assert.ok(Array.isArray(head.material) && head.material.length === 2);
  assert.ok(water.material instanceof THREE.ShaderMaterial);
  assert.ok(!Array.isArray(badge.material) && badge.material.type === 'MeshBasicMaterial' && !(badge.material as THREE.Material).customProgramCacheKey().startsWith('omni'));

  fx.update({ preset: 'toon' }, { time: 2 });
  assert.equal((body.material as THREE.Material).customProgramCacheKey(), 'omni-fx-toon');
  assert.equal(body.castShadow, true);

  // A host re-render replaces the material: the new one becomes the original.
  const replaced = new THREE.MeshPhongMaterial();
  body.material = replaced;
  fx.update({ preset: 'toon' }, { time: 2.1 });
  assert.notEqual(body.material, replaced);
  fx.release(body);
  assert.equal(body.material, replaced, 'release gives back the original');
  assert.equal(fx.meshCount, 1);

  // Late-loaded meshes are picked up; removed ones restored.
  const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  root.add(late);
  fx.update({ preset: 'dissolve', progress: 0.8 }, { time: 3 });
  assert.equal(fx.meshCount, 3);
  assert.equal(body.castShadow, false, 'a mostly dissolved actor stops casting');
  fx.update(undefined, { time: 4 });
  assert.equal(fx.meshCount, 0);
  assert.equal(body.material, replaced);
  assert.equal(body.castShadow, true);
  assert.ok(!Array.isArray(late.material) && late.material.type === 'MeshStandardMaterial' && late.material.onBeforeCompile.toString().length > 0);
});

test('ActorShaderEffect works on a skinned mesh and uses the node backend kit when one is installed', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const n = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const bone = new THREE.Bone();
  const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  skinned.add(bone);
  skinned.bind(new THREE.Skeleton([bone]));
  const root = new THREE.Group();
  root.add(skinned);

  const calls: string[] = [];
  const sets: number[] = [];
  const backend = {
    name: 'webgpu',
    shaderFx: () => ({
      material: (m: THREE.Material, preset: string) => { calls.push(preset); return Object.assign(m.clone(), { name: 'node-fx' }); },
      set: (v: { t: number }) => { sets.push(v.t); },
      dispose: () => undefined,
    }),
  } as unknown as NodeBackend;
  setNodeBackend(backend);
  try {
    const fx = new ActorShaderEffect(root);
    fx.update({ preset: 'lava', speed: 2 }, { time: 1.25 });
    assert.deepEqual(calls, ['lava']);
    assert.equal((skinned.material as THREE.Material).name, 'node-fx');
    assert.deepEqual(sets, [2.5], 'deterministic clock = time × speed');
    fx.dispose();
    assert.equal((skinned.material as THREE.Material).name, '');
  } finally {
    setNodeBackend(null);
  }
});
