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

/** Which field of the SceneSpec a clip is drawn from, so the timeline can write an edit back to it (Phase 6B). */
export type ClipSource =
  | { kind: 'shot'; index: number }
  | { kind: 'step'; actorId: string; index: number }
  | { kind: 'caption'; index: number }
  | { kind: 'dialogue'; lineId: string }
  | { kind: 'cue'; index: number }
  | { kind: 'vfx'; id: string };

/** What a clip allows: drag it (move) and / or pull its left / right edge. */
export interface ClipEditable {
  move: boolean;
  start: boolean;
  end: boolean;
}

export interface TimelineClip {
  id: string;
  start: number;
  end: number;
  label: string;
  source?: ClipSource;
  edit?: ClipEditable;
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
  const clip = (id: string, start: number, end: number, label: string, source?: ClipSource, edit?: ClipEditable): TimelineClip => {
    const s = clamp(start);
    const out: TimelineClip = { id, start: s, end: Math.max(s + MIN_CLIP > duration ? duration : s + MIN_CLIP, clamp(end)), label };
    if (source) out.source = source;
    if (edit) out.edit = edit;
    return out;
  };
  const MOVE_ONLY: ClipEditable = { move: true, start: false, end: false };
  const RESIZABLE: ClipEditable = { move: true, start: true, end: true };

  if (spec.engineType === '3d' && spec.camera?.shots?.length) {
    lanes.push({
      id: 'shots',
      kind: 'shots',
      label: 'Shots',
      color: LANE_COLOR.shots,
      clips: shotWindows({ ...spec, durationSeconds: duration }).map((w, i) =>
        clip(
          `shot-${i}`,
          w.start,
          w.end,
          w.shot.label || `${w.shot.type}${w.shot.move && w.shot.move !== 'static' ? ` · ${w.shot.move}` : ''}`,
          { kind: 'shot', index: (spec.camera.shots || []).indexOf(w.shot) },
          RESIZABLE
        )
      ),
    });
  }

  if (spec.engineType === '3d') {
    for (const actor of spec.actors || []) {
      const steps = (actor.performance || [])
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => finite(step.time) && step.time < duration)
        .sort((a, b) => a.step.time - b.step.time);
      if (!steps.length) continue;
      lanes.push({
        id: `actor-${actor.id}`,
        kind: 'actor',
        label: actor.name,
        color: actor.primaryColor || LANE_COLOR.actor,
        targetId: actor.id,
        clips: steps.map(({ step: st, index }, i) => {
          const next = steps[i + 1]?.step;
          // A walk with a set `duration` lasts that long; any other step lasts until the next one starts; the last one until its walk
          // arrives (2 s default) or the scene ends.
          const walkLen = finite(st.duration) && st.duration > 0 ? st.duration : null;
          const end = st.moveTo && walkLen !== null ? st.time + walkLen : next ? next.time : st.moveTo ? st.time + 2 : duration;
          // Its length is the walk (`duration`), so only a walking step can be pulled longer / shorter; any step can be moved.
          return clip(`${actor.id}-step-${i}`, st.time, end, st.label || st.clip || (st.moveTo ? 'walk' : st.animation) || 'hold', { kind: 'step', actorId: actor.id, index }, st.moveTo ? { move: true, start: false, end: true } : MOVE_ONLY);
        }),
      });
    }
  }

  const captions = sceneCaptions(spec as never);
  const authoredCaptions = spec.captions || [];
  if (captions.some((c) => finite(c.start) && c.start < duration)) {
    lanes.push({
      id: 'captions',
      kind: 'captions',
      label: 'Captions',
      color: LANE_COLOR.captions,
      clips: captions
        .filter((c) => finite(c.start) && finite(c.end) && c.start < duration)
        .map((c, i) => {
          const authored = authoredCaptions.indexOf(c);
          const lineId = c.id?.startsWith('dlg-') ? c.id.slice(4) : undefined;
          // Authored captions are fully editable; a dialogue caption follows its line, so it can only be moved.
          const source: ClipSource | undefined = authored >= 0 ? { kind: 'caption', index: authored } : lineId ? { kind: 'dialogue', lineId } : undefined;
          return clip(c.id || `caption-${i}`, c.start, c.end, short(c.text), source, source?.kind === 'caption' ? RESIZABLE : source ? MOVE_ONLY : undefined);
        }),
    });
  }

  const st = spec.soundtrack;
  if (st?.music && st.music.mood !== 'none') lanes.push({ id: 'music', kind: 'music', label: 'Music', color: LANE_COLOR.music, clips: [clip('music', 0, duration, `${st.music.mood}${st.music.tempo ? ` · ${st.music.tempo} BPM` : ''}`)] });
  if (st?.ambience && st.ambience.type !== 'none') lanes.push({ id: 'ambience', kind: 'ambience', label: 'Ambience', color: LANE_COLOR.ambience, clips: [clip('ambience', 0, duration, st.ambience.type)] });
  const cues = (st?.cues || []).map((cue, index) => ({ cue, index })).filter(({ cue }) => finite(cue.time) && cue.time < duration);
  if (cues.length) {
    lanes.push({
      id: 'sfx',
      kind: 'sfx',
      label: 'Sound cues',
      color: LANE_COLOR.sfx,
      clips: cues.map(({ cue, index }, i) => clip(`cue-${i}`, cue.time, cue.time + 0.4, String(cue.sfx), { kind: 'cue', index }, MOVE_ONLY)),
    });
  }

  if (spec.engineType === '3d') {
    for (const v of spec.vfx || []) {
      if ((!finite(v.startTime) && !finite(v.endTime)) || (finite(v.startTime) && v.startTime >= duration)) continue;
      lanes.push({ id: `vfx-${v.id}`, kind: 'vfx', label: v.name, color: v.color || LANE_COLOR.vfx, targetId: v.id, clips: [clip(`vfx-${v.id}`, v.startTime ?? 0, v.endTime ?? duration, v.type, { kind: 'vfx', id: v.id }, RESIZABLE)] });
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
