import type { AnimationAction, AnimationMixer } from 'three';

/** Mixer-time transitions freeze with playback and keep interrupted blend weights. */
export class AnimationCrossFade {
  private current: AnimationAction | null = null;
  private fading = new Map<AnimationAction, number>();
  private startedAt = 0;
  private manual = false;

  constructor(private mixer: AnimationMixer, private duration = 0.3) {}

  select(next: AnimationAction) {
    if (next === this.current) return;
    this.update();
    const previous = this.current;
    const interrupted = this.fading.size > 0;
    const weights = new Map<AnimationAction, number>();
    for (const action of this.fading.keys()) weights.set(action, action.getEffectiveWeight());
    if (previous) weights.set(previous, previous.getEffectiveWeight());

    if (!next.isRunning()) next.reset();
    next.enabled = true;
    next.play();
    this.current = next;
    this.startedAt = this.mixer.time;

    if (!previous) {
      next.setEffectiveWeight(1);
      return;
    }

    // Normal transitions use Three's mixer cross-fade with no time warping.
    next.setEffectiveWeight(1);
    previous.crossFadeTo(next, this.duration, false);
    this.fading = weights;
    this.manual = interrupted;
    if (interrupted) {
      // crossFadeTo always starts at 1/0. Preserve the current pose on rapid
      // Idle -> Run -> Attack edits, including a return to an outgoing clip.
      if (!weights.has(next)) weights.set(next, 0);
      for (const [action, weight] of weights) action.stopFading().setEffectiveWeight(weight);
    }
  }

  update() {
    if (!this.current || this.fading.size === 0) return;
    const progress = Math.min(1, Math.max(0, (this.mixer.time - this.startedAt) / this.duration));
    if (this.manual) {
      for (const [action, weight] of this.fading) {
        action.setEffectiveWeight(weight * (1 - progress) + (action === this.current ? progress : 0));
      }
    }
    if (progress >= 1) {
      for (const action of this.fading.keys()) if (action !== this.current) action.stop();
      this.current.stopFading().setEffectiveWeight(1);
      this.fading.clear();
      this.manual = false;
    }
  }

  dispose() {
    for (const action of this.fading.keys()) action.stop();
    this.current?.stop();
    this.current = null;
    this.fading.clear();
  }
}
