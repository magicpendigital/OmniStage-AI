import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, AnimationMixer, NumberKeyframeTrack, Object3D } from 'three';
import { AnimationCrossFade } from '../src/renderer/animationCrossFade';

function fixture() {
  const root = new Object3D();
  const mixer = new AnimationMixer(root);
  const actions = [0, 10, 20].map((value, index) => mixer.clipAction(new AnimationClip(
    ['Idle', 'Run', 'Attack'][index], 2,
    [new NumberKeyframeTrack('.position[x]', [0, 2], [value, value])],
  )));
  const fade = new AnimationCrossFade(mixer);
  const step = (delta: number) => { mixer.update(delta); fade.update(); mixer.update(0); };
  return { root, mixer, actions, fade, step };
}

test('Idle to Run blends bones and stops the outgoing action', () => {
  const { root, actions: [idle, run], fade, step } = fixture();
  fade.select(idle); step(0.1);
  fade.select(run); step(0.15);
  assert.ok(root.position.x > 4.9 && root.position.x < 5.1);
  step(0.16);
  assert.equal(root.position.x, 10);
  assert.equal(idle.isRunning(), false);
  assert.equal(run.getEffectiveWeight(), 1);
});

test('paused mixer freezes clip time and cross-fade, then resumes', () => {
  const { mixer, actions: [idle, run], fade, step } = fixture();
  fade.select(idle); step(0.2); fade.select(run); step(0.1);
  const time = run.time, weight = run.getEffectiveWeight();
  mixer.timeScale = 0; step(5);
  assert.equal(run.time, time);
  assert.equal(run.getEffectiveWeight(), weight);
  mixer.timeScale = 1; step(0.3);
  assert.equal(run.getEffectiveWeight(), 1);
});

test('selecting the same clip and changing speed preserves playback position', () => {
  const { actions: [idle], fade, step } = fixture();
  fade.select(idle); step(0.5);
  fade.select(idle);
  assert.equal(idle.time, 0.5);
  idle.setEffectiveTimeScale(2); step(0.25);
  assert.equal(idle.time, 1);
});

test('rapid Idle to Run to Attack preserves the current pose and normalized weights', () => {
  const { root, actions: [idle, run, attack], fade, step } = fixture();
  fade.select(idle); step(0.1); fade.select(run); step(0.1);
  const before = root.position.x;
  fade.select(attack); step(0);
  assert.ok(Math.abs(root.position.x - before) < 0.0001);
  step(0.15);
  const total = [idle, run, attack].reduce((sum, action) => sum + (action.enabled ? action.getEffectiveWeight() : 0), 0);
  assert.ok(Math.abs(total - 1) < 0.0001);
  step(0.2);
  assert.equal(root.position.x, 20);
  assert.equal(idle.isRunning(), false);
  assert.equal(run.isRunning(), false);
});

test('returning to an outgoing clip preserves pose; disposal releases all actions', () => {
  const { root, actions: [idle, run], fade, step } = fixture();
  fade.select(idle); step(0.1); fade.select(run); step(0.12);
  const before = root.position.x;
  fade.select(idle); step(0);
  assert.ok(Math.abs(root.position.x - before) < 0.0001);
  step(0.4);
  assert.equal(root.position.x, 0);
  fade.dispose();
  assert.equal(idle.isRunning(), false);
  assert.equal(run.isRunning(), false);
});

test('two actors use independent mixers and clip transitions', () => {
  const a = fixture(), b = fixture();
  a.fade.select(a.actions[0]); b.fade.select(b.actions[0]);
  a.step(0.1); b.step(0.1);
  a.fade.select(a.actions[1]); a.step(0.4); b.step(0.4);
  assert.equal(a.root.position.x, 10);
  assert.equal(b.root.position.x, 0);
});
