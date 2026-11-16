import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGpu,
  detectDeviceTier,
  DEVICE_PROFILES,
  effectivePixelRatio,
  QUALITY_LADDER,
  tierSettings,
} from '../src/runtime/deviceProfiles';
import { createQualityGovernor, formatPerfReport } from '../src/runtime/qualityGovernor';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { MOBILE_REFERENCE, mobileParticleCount, mobileRigBudget, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { Node2D, VFXNode } from '../src/types/scene.schema';

// --- profiles -------------------------------------------------------------

test('profiles: mid equals the original MOBILE_REFERENCE budget; tiers are ordered low < mid < high', () => {
  const mid = DEVICE_PROFILES.mid.budget;
  assert.equal(mid.maxActors3D, 60);
  assert.equal(mid.maxNodes2D, 300);
  assert.equal(mid.maxSkinnedVertices, 150_000);
  assert.equal(mid.maxSkinnedActors, 12);
  assert.equal(mid.maxBones, 100);
  assert.equal(mid.maxTextureSize, 2048);
  for (const k of Object.keys(mid) as (keyof typeof mid)[]) {
    assert.equal(MOBILE_REFERENCE[k], mid[k], `MOBILE_REFERENCE.${k}`);
    assert.ok(DEVICE_PROFILES.low.budget[k] < mid[k], `low.${k} < mid`);
    assert.ok(DEVICE_PROFILES.high.budget[k] > mid[k], `high.${k} > mid`);
  }
  // Start rungs: high is best, low is lowest; the ladder only gets cheaper.
  assert.ok(DEVICE_PROFILES.high.startRung < DEVICE_PROFILES.mid.startRung && DEVICE_PROFILES.mid.startRung < DEVICE_PROFILES.low.startRung);
  for (let i = 1; i < QUALITY_LADDER.length; i++) {
    const a = QUALITY_LADDER[i - 1];
    const b = QUALITY_LADDER[i];
    assert.ok(b.pixelRatioCap <= a.pixelRatioCap && b.particleScale <= a.particleScale && (!b.postFx || a.postFx), `rung ${i} not cheaper`);
  }
  assert.equal(tierSettings('low').shadows, 'off');
  assert.equal(tierSettings('high').postFx, true);
  assert.equal(effectivePixelRatio(3, tierSettings('mid')), 1.5);
  assert.equal(effectivePixelRatio(1, tierSettings('high')), 1);
});

// --- tier detection -------------------------------------------------------

test('detection: GPU strings are classified', () => {
  assert.equal(classifyGpu('Adreno (TM) 610'), 'low');
  assert.equal(classifyGpu('ANGLE (Qualcomm, Adreno (TM) 642L, OpenGL ES 3.2)'), 'mid');
  assert.equal(classifyGpu('Adreno (TM) 740'), 'high');
  assert.equal(classifyGpu('Mali-G52 MC2'), 'low');
  assert.equal(classifyGpu('Mali-T880'), 'low');
  assert.equal(classifyGpu('Mali-G78 MP14'), 'mid');
  assert.equal(classifyGpu('Mali-G710 MC10'), 'high');
  assert.equal(classifyGpu('Immortalis-G715'), 'high');
  assert.equal(classifyGpu('PowerVR Rogue GE8320'), 'low');
  assert.equal(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'software');
  assert.equal(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)'), 'high');
  assert.equal(classifyGpu('Apple GPU'), 'unknown');
  assert.equal(classifyGpu(''), 'unknown');
});

test('detection: fake devices land in the expected tier', () => {
  const phone = { width: 393, height: 873, dpr: 2.75 };
  // Budget phone: Mali-G52, 3 GB, 8 cores.
  assert.equal(detectDeviceTier({ gpu: 'Mali-G52 MC2', memoryGb: 4, cores: 8, screen: phone, touch: true }).tier, 'low');
  // Little memory alone is enough for low.
  assert.equal(detectDeviceTier({ gpu: 'Adreno (TM) 642L', memoryGb: 2, cores: 8, touch: true }).tier, 'low');
  // Few cores on a touch device.
  assert.equal(detectDeviceTier({ memoryGb: 4, cores: 4, touch: true }).tier, 'low');
  // Software rendering (headless / blocklisted GPU).
  assert.equal(detectDeviceTier({ gpu: 'SwiftShader', memoryGb: 8, cores: 16, touch: false }).tier, 'low');
  // Mid-range: Adreno 642L, 6 GB.
  const mid = detectDeviceTier({ gpu: 'Adreno (TM) 642L', memoryGb: 6, cores: 8, screen: phone, touch: true });
  assert.equal(mid.tier, 'mid');
  assert.equal(mid.gpuClass, 'mid');
  // Flagship: Adreno 740, 8 GB.
  assert.equal(detectDeviceTier({ gpu: 'Adreno (TM) 740', memoryGb: 8, cores: 8, screen: phone, touch: true }).tier, 'high');
  // High GPU but 4 GB stays mid.
  assert.equal(detectDeviceTier({ gpu: 'Mali-G710', memoryGb: 4, cores: 8, touch: true }).tier, 'mid');
  // iPhone: Safari hides GPU + memory → mid (the governor adapts from there).
  const iphone = detectDeviceTier({ gpu: 'Apple GPU', cores: 6, screen: { width: 390, height: 844, dpr: 3 }, touch: true });
  assert.equal(iphone.tier, 'mid');
  assert.ok(iphone.reasons.some((r) => /Apple GPU/.test(r)));
  // Hidden GPU but plenty of memory and cores.
  assert.equal(detectDeviceTier({ memoryGb: 8, cores: 8, touch: true }).tier, 'high');
  // Nothing known → mid.
  assert.equal(detectDeviceTier({}).tier, 'mid');
  // Desktop with a discrete GPU.
  assert.equal(detectDeviceTier({ gpu: 'NVIDIA GeForce RTX 4070', cores: 4, touch: false }).tier, 'high');
});

// --- governor -------------------------------------------------------------

/** Feeds `seconds` of frames at `ms` each; returns the steps taken. */
function run(gov: ReturnType<typeof createQualityGovernor>, clock: { t: number }, ms: number, seconds: number) {
  const steps = [];
  for (let n = Math.round((seconds * 1000) / ms); n > 0; n--) {
    clock.t += ms;
    const s = gov.sample(ms, clock.t);
    if (s) steps.push(s);
  }
  return steps;
}

test('governor: steps down on sustained slow frames, one rung per cooldown, not past the floor', () => {
  const gov = createQualityGovernor({ tier: 'high' });
  const clock = { t: 0 };
  assert.equal(gov.rung, 0);
  // Exactly on budget: nothing happens.
  assert.equal(run(gov, clock, 16.7, 20).length, 0);
  // 25 fps for 6 s → at most two steps (cooldown 3 s + a discarded window after each step).
  const slow = run(gov, clock, 40, 6);
  assert.ok(slow.length >= 1 && slow.length <= 2, `steps ${slow.length}`);
  assert.ok(slow.every((s) => s.reason === 'slow' && s.to === s.from + 1));
  // Keep it slow: reaches the floor and stays there.
  run(gov, clock, 40, 120);
  assert.equal(gov.rung, QUALITY_LADDER.length - 1);
  assert.equal(gov.settings().shadows, 'off');
  assert.equal(gov.settings().postFx, false);
});

test('governor: hitches and short spikes are ignored', () => {
  const gov = createQualityGovernor({ tier: 'mid' });
  const clock = { t: 0 };
  for (let i = 0; i < 2000; i++) {
    clock.t += 16.7;
    gov.sample(i % 120 === 0 ? 900 : 16.7, clock.t); // a 900 ms hitch every 2 s (tab switch / GC)
  }
  assert.equal(gov.rung, DEVICE_PROFILES.mid.startRung);
  // A single slow frame inside a window does not move the average past 1.2× budget.
  for (let i = 0; i < 2000; i++) {
    clock.t += 16.7;
    gov.sample(i % 90 === 0 ? 60 : 16.7, clock.t);
  }
  assert.equal(gov.rung, DEVICE_PROFILES.mid.startRung);
});

test('governor: recovers with hysteresis, never above the tier start, and locks after a failed climb', () => {
  const gov = createQualityGovernor({ tier: 'mid' });
  const clock = { t: 0 };
  const start = gov.rung;
  run(gov, clock, 30, 12); // ~33 fps against a 60 fps target
  assert.ok(gov.rung >= start + 2, `rung ${gov.rung}`);
  run(gov, clock, 18.5, 4); // let the last mixed window finish
  const low = gov.rung;
  // Between the up and down thresholds (≈ 55 fps): hold, no oscillation.
  assert.equal(run(gov, clock, 18.5, 30).length, 0);
  // Back on target: climbs one rung at a time, only after several good windows.
  const firstGood = run(gov, clock, 16.7, 5);
  assert.equal(firstGood.length, 0, 'needs several good windows before stepping up');
  run(gov, clock, 16.7, 60);
  assert.equal(gov.rung, start, 'climbs back to the tier start');
  assert.equal(run(gov, clock, 16.7, 60).length, 0, 'never above the tier start rung');
  assert.ok(low > start);

  // Oscillation lock: drop, climb, then drop again right after the climb → stays at the lower rung.
  const g2 = createQualityGovernor({ tier: 'high' });
  const c2 = { t: 0 };
  run(g2, c2, 30, 5);
  const dropped = g2.rung;
  assert.ok(dropped > 0);
  const ups = [];
  while (!ups.length) ups.push(...run(g2, c2, 16.7, 1));
  const climbedTo = g2.rung;
  assert.equal(climbedTo, dropped - 1);
  run(g2, c2, 30, 6);
  const lockedAt = g2.rung;
  assert.ok(lockedAt > climbedTo);
  run(g2, c2, 16.7, 120);
  assert.equal(g2.rung, lockedAt, 'ceiling locked after a failed climb');
  assert.equal(g2.report().ceiling, lockedAt);
});

test('governor: measure-only mode and the report', () => {
  const gov = createQualityGovernor({ tier: 'low', adaptive: false }, { reasons: ['entry-level GPU'], gpuClass: 'low' });
  const clock = { t: 0 };
  assert.equal(run(gov, clock, 100, 30).length, 0);
  const r = gov.report();
  assert.equal(r.tier, 'low');
  assert.equal(r.targetFps, 30);
  assert.equal(r.rung, DEVICE_PROFILES.low.startRung);
  assert.equal(r.fps.last, 10);
  assert.equal(r.fps.average, 10);
  assert.equal(r.frames, 300);
  assert.deepEqual(r.reasons, ['entry-level GPU']);
  const text = formatPerfReport(r);
  assert.match(text, /tier low · target 30 fps/);
  assert.match(text, /shadows off/);
});

// --- verifier per tier ----------------------------------------------------

test('verifier: mobile budgets follow the chosen device tier (default mid, same rule ids)', () => {
  const spec = createBlankSceneSpec('3d', 'Tier budget');
  const base = spec.actors[0];
  spec.actors = Array.from({ length: 40 }, (_, n) => ({ ...base, id: `a${n}`, name: `A${n}` }));
  const heavy = (tier?: 'low' | 'mid' | 'high') =>
    verifySceneSpec(spec, { target: 'mobile', deviceTier: tier }).issues.filter((i) => i.code === 'mobile.heavy-scene');
  assert.equal(heavy().length, 0, '40 actors fit the mid budget');
  assert.equal(heavy('mid').length, 0);
  assert.equal(heavy('low').length, 1);
  assert.match(heavy('low')[0].message, /keep under 30\).*low tier/);
  spec.actors = Array.from({ length: 80 }, (_, n) => ({ ...base, id: `a${n}`, name: `A${n}` }));
  assert.equal(heavy().length, 1);
  assert.equal(heavy('high').length, 0);

  // Rig cost per tier.
  const rigged = { ...base, id: 'hero', name: 'Hero', rigCost: { bones: 90, vertices: 90_000, textureSize: 2048 } };
  spec.actors = [rigged];
  assert.equal(mobileRigBudget(spec).issues.length, 0);
  assert.deepEqual(mobileRigBudget(spec, 'low').issues.map((i) => i.id).sort(), ['bones', 'texture', 'vertices']);
  assert.equal(mobileRigBudget(spec, 'high').issues.length, 0);
  assert.equal(verifySceneSpec(spec, { target: 'mobile', deviceTier: 'low' }).issues.filter((i) => i.code === 'mobile.rig-cost').length, 3);
});

test('verifier: particle budget counts 3D GPU particles and 2D emitters', () => {
  const s3 = createBlankSceneSpec('3d', 'Particles');
  const vfx = (id: string, type: VFXNode['type'], intensity = 1): VFXNode => ({ id, name: id, type, position: [0, 0, 0], color: '#fff', intensity });
  s3.vfx = [vfx('a', 'sparkles'), vfx('b', 'confetti', 2)];
  assert.equal(mobileParticleCount(s3), 24 + 96 + 320);
  const p3 = (tier?: 'low' | 'mid' | 'high') =>
    verifySceneSpec(s3, { target: 'mobile', deviceTier: tier }).issues.filter((i) => i.code === 'mobile.heavy-scene' && /particles/.test(i.message));
  assert.equal(p3().length, 0);
  assert.equal(p3('low').length, 1);
  s3.vfx.push(vfx('c', 'confetti', 3));
  assert.equal(p3().length, 1);
  assert.equal(p3('high').length, 0);

  const s2 = createBlankSceneSpec('2d', 'Rain');
  const emitter = (id: string): Node2D =>
    ({ id, name: id, type: 'particle-emitter', x: 500, y: 300, width: 1000, height: 600, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', emitter: { preset: 'rain', seed: 3, rate: 400 } }) as Node2D;
  s2.nodes2D = [emitter('r1')];
  const one = mobileParticleCount(s2);
  assert.ok(one > 200 && one <= 420, `rain ${one}`);
  s2.nodes2D.push(emitter('r2'), emitter('r3'));
  assert.ok(mobileParticleCount(s2) > DEVICE_PROFILES.mid.budget.maxParticles);
  assert.ok(verifySceneSpec(s2, { target: 'mobile' }).issues.some((i) => i.code === 'mobile.heavy-scene' && /particles/.test(i.message)));
  assert.ok(!verifySceneSpec(s2).issues.some((i) => i.code.startsWith('mobile.')), 'opt-in');
});
