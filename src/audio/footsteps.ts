/**
 * Footsteps synced to walk cycles (Phase 10B follow-up). Pure and deterministic: the performers are sampled with the same
 * `resolvePerformance` the renderers draw, and a step lands every half stride of distance actually travelled — so an eased walk
 * starts and ends with slower steps, a run with faster, longer ones, and a stop is silent. Mixed into the film soundtrack as
 * ordinary cues (studio, Preview, Player and the MP4 export hear the same thing).
 */
import { actorHeight, hasPerformance, resolvePerformance } from '../runtime/cinematics';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import type { ActorNode, SceneSpec } from '../types/scene.schema';

export interface FootstepCue {
  time: number;
  /** 0..1 */
  volume: number;
  actorId: string;
}

export type FootstepScene = Partial<Pick<SceneSpec, 'mode' | 'actors' | 'world' | 'durationSeconds'>>;

/** Sampling rate of the walk (Hz). */
const SAMPLE_HZ = 60;
/** One step (half a stride) as a share of the actor's height. */
const WALK_STEP = 0.4;
const RUN_STEP = 0.55;
export const MAX_FOOTSTEPS = 400;
/** Things that do not walk. */
const SILENT_CATEGORIES = new Set(['product', 'collectible', 'environment-prop', 'vehicle']);

export function walksOnFeet(actor: ActorNode): boolean {
  const cat = ASSET_REGISTRY[actor.assetId]?.category as string | undefined;
  return !cat || !SILENT_CATEGORIES.has(cat);
}

const cache = new WeakMap<object, { world: unknown; duration: number; mode: unknown; cues: FootstepCue[] }>();

/** Footstep cues for every walking performer of a film scene, sorted by time. Empty outside media mode. */
export function footstepCues(scene: FootstepScene): FootstepCue[] {
  const actors = scene.actors;
  if (!actors?.length || scene.mode !== 'media') return [];
  const duration = Math.max(0.1, Number(scene.durationSeconds) || 8);
  const hit = cache.get(actors);
  if (hit && hit.world === scene.world && hit.duration === duration && hit.mode === scene.mode) return hit.cues;
  const cues: FootstepCue[] = [];
  for (const actor of actors) {
    if (!hasPerformance(actor) || !walksOnFeet(actor) || actor.visible === false) continue;
    if (!actor.performance!.some((s) => Array.isArray(s.moveTo))) continue;
    const height = actorHeight(actor);
    const loud = Math.min(1, Math.max(0.35, height / 1.8));
    let prev = resolvePerformance(actor, 0, actors, scene.world);
    let travelled = 0;
    let wasMoving = false;
    let n = 0;
    const frames = Math.ceil(duration * SAMPLE_HZ);
    for (let f = 1; f <= frames; f++) {
      const t = f / SAMPLE_HZ;
      const pose = resolvePerformance(actor, t, actors, scene.world);
      const running = /run/i.test(pose.clip || '');
      const step = height * (running ? RUN_STEP : WALK_STEP);
      if (pose.moving) {
        if (!wasMoving) {
          // First contact as the walk starts.
          travelled = step;
        }
        travelled += Math.hypot(pose.position[0] - prev.position[0], pose.position[2] - prev.position[2]);
        while (travelled >= step && t < duration) {
          travelled -= step;
          cues.push({ time: +t.toFixed(4), volume: +((running ? 0.75 : 0.55) * loud * (n % 2 ? 0.9 : 1)).toFixed(3), actorId: actor.id });
          n++;
        }
      } else if (wasMoving) {
        // Settling step on arrival.
        cues.push({ time: +t.toFixed(4), volume: +(0.4 * loud).toFixed(3), actorId: actor.id });
        n = 0;
      }
      wasMoving = pose.moving;
      prev = pose;
    }
  }
  cues.sort((a, b) => a.time - b.time);
  const out = cues.slice(0, MAX_FOOTSTEPS);
  cache.set(actors, { world: scene.world, duration, mode: scene.mode, cues: out });
  return out;
}
