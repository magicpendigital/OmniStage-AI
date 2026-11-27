import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { DOF_FALLOFF, DOF_GLSL, DOF_MAX_RADIUS, DOF_TAPS, dofCoc, focusDistanceFor } from '../src/runtime/lens';
import { GRADE_PRESETS, gradeProblems, resolveGrade, sanitizeGrade } from '../src/runtime/colorGrade';
import { resolveShot } from '../src/runtime/cinematics';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import type { SceneSpec } from '../src/types/scene.schema';

function film(): SceneSpec {
  const s = createBlankSceneSpec('3d');
  s.mode = 'media';
  s.durationSeconds = 8;
  s.camera.shots = [{ start: 0, type: 'close-up' }];
  return s;
}

test('depth of field is data: dof and focusDistance are ranged, clamped and repaired like the rest of the grade', () => {
  assert.deepEqual(sanitizeGrade({ dof: 5, focusDistance: -3 }), { dof: 1, focusDistance: 0 });
  assert.equal(sanitizeGrade({ dof: 'lots' }), undefined);
  assert.ok(gradeProblems({ dof: 2 }).some((p) => p.startsWith('dof')));
  assert.ok(gradeProblems({ focusDistance: 999 }).some((p) => p.startsWith('focusDistance')));
  assert.deepEqual(gradeProblems({ dof: 0.5, focusDistance: 4 }), []);
  const spec = film();
  spec.grade = { dof: 7 };
  assert.ok(verifySceneSpec(spec).issues.some((i) => i.code === 'grade.invalid'));
  assert.equal(autoFixSceneSpec(spec).spec.grade!.dof, 1);
});

test('a grade with only depth of field is not neutral (the lens pass runs), the portrait look carries it, 0 is neutral again', () => {
  assert.equal(resolveGrade({ dof: 0 }), null);
  assert.equal(resolveGrade({ dof: 0.4 })!.dof, 0.4);
  assert.equal(resolveGrade({ preset: 'portrait' })!.dof, GRADE_PRESETS.portrait.dof);
  assert.equal(resolveGrade({ preset: 'portrait', dof: 0 })!.dof, 0, 'an explicit 0 overrides the preset');
  assert.equal(resolveGrade({ preset: 'portrait', focusDistance: 3 })!.focusDistance, 3);
});

test('circle of confusion: zero at the focal plane, grows with distance from it, scaled by the amount, capped at the amount', () => {
  assert.equal(dofCoc(5, 5, 1), 0);
  assert.equal(dofCoc(5, 5, 0), 0);
  const near = dofCoc(4, 5, 1);
  const far = dofCoc(8, 5, 1);
  assert.ok(near > 0 && far > near, 'further off the plane is blurrier');
  assert.ok(Math.abs(dofCoc(8, 5, 0.5) - far * 0.5) < 1e-12, 'amount scales the blur');
  assert.equal(dofCoc(1000, 5, 1), 1, 'capped');
  assert.equal(dofCoc(1000, 5, 0.3), 0.3, 'capped at the amount');
  assert.equal(dofCoc(0, 5, 1), 1, 'a point at the lens is fully out of focus (no division by zero)');
  assert.ok(dofCoc(5.1, 5, 1) < 0.07, 'a hair off the plane stays almost sharp');
  assert.ok(Math.abs(dofCoc(10, 5, 1) - Math.min(1, (DOF_FALLOFF * 5) / 10)) < 1e-12);
});

test('focus distance: a manual distance wins, a shot focuses its subject, else the camera target', () => {
  const spec = film();
  const hero = spec.actors[0];
  const frame = resolveShot(spec, 0)!;
  const expected = Math.hypot(frame.position[0] - frame.target[0], frame.position[1] - frame.target[1], frame.position[2] - frame.target[2]);
  assert.ok(Math.abs(focusDistanceFor(spec, 0, [9, 9, 9], [0, 0, 0]) - expected) < 1e-9, 'the shot decides, not the editor camera');
  assert.ok(expected > 0.5 && expected < 6, `a close-up is focused close (${expected.toFixed(2)} m)`);
  assert.ok(hero, 'the blank scene has an actor to frame');
  spec.grade = { dof: 0.6, focusDistance: 12 };
  assert.equal(focusDistanceFor(spec, 0, [0, 0, 0]), 12);
  spec.grade = { dof: 0.6, focusDistance: 0 };
  assert.ok(Math.abs(focusDistanceFor(spec, 0, [0, 0, 0]) - expected) < 1e-9, '0 means automatic');
  spec.mode = 'game';
  assert.equal(focusDistanceFor(spec, 0, [0, 0, 10], [0, 0, 4]), 6, 'outside a film it is the distance to what the camera looks at');
  assert.equal(focusDistanceFor(spec, 0, [0, 0, 0], [0, 0, 0]), 0.3, 'never zero');
  assert.equal(focusDistanceFor(spec, 0, [0, 0, 1e6], [0, 0, 0]), 200);
  assert.equal(focusDistanceFor(spec, 0, [Number.NaN, 0, 0], [0, 0, 0]), 6, 'a broken camera falls back to a sane focus');
});

test('the WebGL pass carries the same constants the TSL port uses', () => {
  assert.ok(DOF_GLSL.includes(`${DOF_TAPS}`) && DOF_GLSL.includes(String(DOF_MAX_RADIUS)) && DOF_GLSL.includes(DOF_FALLOFF.toFixed(1)));
  assert.ok(!/Math\.random|random\(/.test(DOF_GLSL), 'no randomness: a frame renders the same every time');
});

test('focus: while the shot camera is not driving the view (free orbit) the camera target wins, shots or not', () => {
  const spec = film();
  const shotFocus = focusDistanceFor(spec, 0, [0, 0, 10], [0, 0, 3]);
  assert.equal(focusDistanceFor(spec, 0, [0, 0, 10], [0, 0, 3], false), 7);
  assert.notEqual(shotFocus, 7);
});
