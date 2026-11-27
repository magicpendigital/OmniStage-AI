/**
 * Phase 6 — the multi-track view of a scene's timeline.
 *
 * Nothing here is stored: the lanes are DERIVED from the SceneSpec fields that already drive playback (shots, actor performance,
 * captions + dialogue, soundtrack, VFX windows, colour grade), so the timeline can never disagree with what plays. The dock draws
 * them; clicking a clip seeks to its start. Pure and deterministic.
 */
import { shotWindows } from './cinematics';
import { sceneCaptions } from '../audio/voices';
import type { SceneSpec } from '../types/scene.schema';

export type LaneKind = 'shots' | 'actor' | 'captions' | 'music' | 'ambience' | 'sfx' | 'vfx' | 'look';

export interface TimelineClip {
  id: string;
  start: number;
  end: number;
  label: string;
}

export interface TimelineLane {
  id: string;
  kind: LaneKind;
  label: string;
  color: string;
  /** Actor / VFX id this lane belongs to, when it has one (selects it when clicked). */
  targetId?: string;
  clips: TimelineClip[];
}

const LANE_COLOR: Record<LaneKind, string> = {
  shots: '#f58fc0',
  actor: '#5aa9ff',
  captions: '#b79cff',
  music: '#4fd1a5',
  ambience: '#7fc8b2',
  sfx: '#f2b441',
  vfx: '#f2b441',
  look: '#e8a96a',
};

const MIN_CLIP = 0.2;
const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const timelineDuration = (spec: Pick<SceneSpec, 'durationSeconds'>) => Math.max(2, spec.durationSeconds || 8);

/** Lanes for everything that is on the scene's timeline, in a stable order (shots, actors, captions, sound, vfx, look). */
export function deriveTimeline(spec: SceneSpec): TimelineLane[] {
  const duration = timelineDuration(spec);
  const clamp = (t: number) => Math.min(duration, Math.max(0, t));
  const lanes: TimelineLane[] = [];
  const clip = (id: string, start: number, end: number, label: string): TimelineClip => {
    const s = clamp(start);
    return { id, start: s, end: Math.max(s + MIN_CLIP > duration ? duration : s + MIN_CLIP, clamp(end)), label };
  };

  if (spec.engineType === '3d' && spec.camera?.shots?.length) {
    lanes.push({
      id: 'shots',
      kind: 'shots',
      label: 'Shots',
      color: LANE_COLOR.shots,
      clips: shotWindows({ ...spec, durationSeconds: duration }).map((w, i) =>
        clip(`shot-${i}`, w.start, w.end, w.shot.label || `${w.shot.type}${w.shot.move && w.shot.move !== 'static' ? ` · ${w.shot.move}` : ''}`)
      ),
    });
  }

  if (spec.engineType === '3d') {
    for (const actor of spec.actors || []) {
      const steps = [...(actor.performance || [])].filter((s) => finite(s.time) && s.time < duration).sort((a, b) => a.time - b.time);
      if (!steps.length) continue;
      lanes.push({
        id: `actor-${actor.id}`,
        kind: 'actor',
        label: actor.name,
        color: actor.primaryColor || LANE_COLOR.actor,
        targetId: actor.id,
        clips: steps.map((st, i) => {
          const next = steps[i + 1];
          // A step lasts until the next one starts; the last one until its walk arrives (or the scene ends).
          const end = next ? next.time : st.moveTo ? st.time + (finite(st.duration) && st.duration > 0 ? st.duration : 2) : duration;
          return clip(`${actor.id}-step-${i}`, st.time, end, st.label || st.clip || (st.moveTo ? 'walk' : st.animation) || 'hold');
        }),
      });
    }
  }

  const captions = sceneCaptions(spec as never);
  if (captions.some((c) => finite(c.start) && c.start < duration)) {
    lanes.push({
      id: 'captions',
      kind: 'captions',
      label: 'Captions',
      color: LANE_COLOR.captions,
      clips: captions.filter((c) => finite(c.start) && finite(c.end) && c.start < duration).map((c, i) => clip(c.id || `caption-${i}`, c.start, c.end, short(c.text))),
    });
  }

  const st = spec.soundtrack;
  if (st?.music && st.music.mood !== 'none') lanes.push({ id: 'music', kind: 'music', label: 'Music', color: LANE_COLOR.music, clips: [clip('music', 0, duration, `${st.music.mood}${st.music.tempo ? ` · ${st.music.tempo} BPM` : ''}`)] });
  if (st?.ambience && st.ambience.type !== 'none') lanes.push({ id: 'ambience', kind: 'ambience', label: 'Ambience', color: LANE_COLOR.ambience, clips: [clip('ambience', 0, duration, st.ambience.type)] });
  const cues = (st?.cues || []).filter((c) => finite(c.time) && c.time < duration);
  if (cues.length) lanes.push({ id: 'sfx', kind: 'sfx', label: 'Sound cues', color: LANE_COLOR.sfx, clips: cues.map((c, i) => clip(`cue-${i}`, c.time, c.time + 0.4, String(c.sfx))) });

  if (spec.engineType === '3d') {
    for (const v of spec.vfx || []) {
      if ((!finite(v.startTime) && !finite(v.endTime)) || (finite(v.startTime) && v.startTime >= duration)) continue;
      lanes.push({ id: `vfx-${v.id}`, kind: 'vfx', label: v.name, color: v.color || LANE_COLOR.vfx, targetId: v.id, clips: [clip(`vfx-${v.id}`, v.startTime ?? 0, v.endTime ?? duration, v.type)] });
    }
    if (spec.grade) lanes.push({ id: 'look', kind: 'look', label: 'Look', color: LANE_COLOR.look, clips: [clip('look', 0, duration, spec.grade.preset ?? 'custom grade')] });
  }
  return lanes;
}

/** Clips of one lane that overlap each other (what the editor flags: two walks / two captions on top of each other). */
export function overlappingClips(lane: TimelineLane): Array<[TimelineClip, TimelineClip]> {
  if (lane.kind === 'music' || lane.kind === 'ambience' || lane.kind === 'look' || lane.kind === 'sfx') return [];
  const sorted = [...lane.clips].sort((a, b) => a.start - b.start);
  const out: Array<[TimelineClip, TimelineClip]> = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end - 1e-6) out.push([sorted[i - 1], sorted[i]]);
  return out;
}
