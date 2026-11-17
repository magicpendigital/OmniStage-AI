/**
 * Script coverage (Phase 11E, P0 #2): did the scene really perform its script?
 *
 * The screenwriter step writes a shot script ("0-3 s | WIDE on Bolt | Bolt walks to the door | caption"), the scene author turns it
 * into performance steps, shots, dialogue and captions: two translations, and nothing checked that the second kept the first.
 * Each script line gets a stable id (`L1`, `L2`, … by order), and a line is COVERED when something happens in its time window:
 *  - the action: an actor performance step, or a dialogue line, starts in the window;
 *  - the caption (only when the line has one): a caption cue or dialogue line shows up in the window.
 * A line is UNPERFORMABLE when its action names something (dance, jump, wave …) that none of the actors' clips can do.
 * Pure (no AI, no DOM); the verifier turns it into `script.uncovered` / `script.unperformable` and the storyboard panel shows
 * "Script coverage 9/10".
 */
import type { ActorNode, SceneSpec } from '../types/scene.schema';
import { shotWindows } from '../runtime/cinematics';

export interface ScriptLine {
  /** `L1`, `L2` … in script order. */
  id: string;
  start: number;
  end: number;
  /** "WIDE on Bolt" */
  shot: string;
  action: string;
  caption?: string;
}

export interface ScriptLineCoverage extends ScriptLine {
  actionOk: boolean;
  captionOk: boolean;
  covered: boolean;
  /** Clip the action needs but no actor has (e.g. 'dance'). */
  missingClip?: string;
}

export interface ScriptCoverage {
  lines: ScriptLineCoverage[];
  covered: number;
  total: number;
  /** Lines whose action no actor can perform. */
  unperformable: ScriptLineCoverage[];
  uncovered: ScriptLineCoverage[];
}

const LINE = /^\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*s?\s*\|(.*)$/;

/** Script lines with ids. Free text between them is ignored; a script with no timed line has no lines. */
export function parseScript(script: string | undefined): ScriptLine[] {
  const out: ScriptLine[] = [];
  for (const raw of (script || '').split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const parts = m[3].split('|').map((p) => p.trim());
    const [shot = '', action = '', ...caption] = parts;
    if (!action && !shot) continue;
    out.push({ id: `L${out.length + 1}`, start, end, shot, action, ...(caption.join(' ').trim() ? { caption: caption.join(' ').trim() } : {}) });
  }
  return out;
}

/** What an action word needs from a rig: verb stems and the clip names that can do it. */
const ACTION_CLIPS: Array<{ verb: RegExp; clip: RegExp; label: string }> = [
  { verb: /\b(danc(e|es|ed|ing)|twirl(s|ed|ing)?|boogie)\b/i, clip: /danc/i, label: 'dance' },
  { verb: /\b(jump(s|ed|ing)?|leap(s|ed|ing|t)?|hop(s|ped|ping)?|bound(s|ed|ing)?)\b/i, clip: /jump|leap|hop/i, label: 'jump' },
  { verb: /\b(wav(e|es|ed|ing)|greet(s|ed|ing)?|hello)\b/i, clip: /wave|hello|greet/i, label: 'wave' },
  { verb: /\b(run(s|ning)?|ran|sprint(s|ed|ing)?|dash(es|ed|ing)?|chase(s|d)?|chasing|flee(s|ing)?|fled|race(s|d)?|racing)\b/i, clip: /run|sprint|gallop/i, label: 'run' },
  { verb: /\b(sit(s|ting)?|sat|seated|perch(es|ed)?)\b/i, clip: /sit/i, label: 'sit' },
  { verb: /\b(punch(es|ed|ing)?|fight(s|ing)?|fought|attack(s|ed|ing)?|kick(s|ed|ing)?|strike(s)?|struck)\b/i, clip: /punch|attack|fight|kick|bite|strike/i, label: 'fight' },
  { verb: /\b(thumbs?[- ]up|approv(e|es|ed|ing))\b/i, clip: /thumb/i, label: 'thumbs-up' },
  { verb: /\b(nod(s|ded|ding)?)\b/i, clip: /yes|nod/i, label: 'nod' },
  { verb: /\b(shak(e|es|ing) (its|his|her|their) head|refus(e|es|ed|ing))\b/i, clip: /\bno\b|shake/i, label: 'shake head' },
];

const MOVING_CLIP_OR_STEP = (a: ActorNode, from: number, to: number) =>
  (a.performance || []).some((s) => (s.clip || s.moveTo || s.animation || s.lookAt !== undefined || s.faceDeg !== undefined) && s.time >= from && s.time <= to);

const knownClips = (a: ActorNode) => (a.availableClips || []).length > 0;

/**
 * Which script lines the scene covers. `slack` seconds of tolerance on both sides of a line's window, because a step that begins
 * a moment before the line ("walks in" at 2.8 for a 3 s line) still performs it.
 */
export function scriptCoverage(scene: Pick<SceneSpec, 'sequence' | 'actors' | 'dialogue' | 'captions' | 'durationSeconds' | 'camera'>, slack = 0.6): ScriptCoverage {
  const lines = parseScript(scene.sequence?.script);
  const actors = scene.actors || [];
  const clipsKnown = actors.length > 0 && actors.every(knownClips);
  const allClips = actors.flatMap((a) => a.availableClips || []);
  const covered: ScriptLineCoverage[] = lines.map((l) => {
    const from = l.start - slack;
    const to = l.end + slack;
    const spoke = (scene.dialogue || []).some((d) => d.time >= from && d.time <= to);
    // A scenery line (no actor named: "the sun rises over the meadow") is performed by the camera: a shot that begins in its window.
    const text = l.action.toLowerCase();
    // A line that names an actor ('Bolt walks to the door') needs THAT actor to act: someone else moving does not perform it.
    const named = actors.filter((a) => (a.name && text.includes(a.name.toLowerCase())) || text.includes(a.id.toLowerCase()));
    const scenic = !named.length;
    const shotHere = scenic && shotWindows(scene).some((w) => w.start >= from && w.start <= to);
    const actionOk = spoke || shotHere || (named.length ? named : actors).some((a) => MOVING_CLIP_OR_STEP(a, from, to));
    const captionOk = !l.caption || spoke || (scene.captions || []).some((c) => c.start <= to && c.end >= from);
    const need = clipsKnown ? ACTION_CLIPS.find((r) => r.verb.test(l.action) && !allClips.some((c) => r.clip.test(c))) : undefined;
    return { ...l, actionOk, captionOk, covered: actionOk && captionOk, ...(need ? { missingClip: need.label } : {}) };
  });
  return {
    lines: covered,
    covered: covered.filter((l) => l.covered).length,
    total: covered.length,
    unperformable: covered.filter((l) => l.missingClip),
    uncovered: covered.filter((l) => !l.covered),
  };
}

/** The label for the storyboard panel ("9/10"), or undefined when the scene has no timed script. */
export function coverageLabel(scene: Pick<SceneSpec, 'sequence' | 'actors' | 'dialogue' | 'captions' | 'durationSeconds' | 'camera'>): { text: string; ok: boolean } | undefined {
  const c = scriptCoverage(scene);
  return c.total ? { text: `${c.covered}/${c.total}`, ok: c.covered === c.total && !c.unperformable.length } : undefined;
}

/** The script with its line ids, for the scene author's prompt: "L1 0-3 s | WIDE on Bolt | …". */
export function numberedScript(script: string | undefined): string {
  const lines = parseScript(script);
  return lines.map((l) => `${l.id} ${l.start}-${l.end} s | ${[l.shot, l.action, l.caption].filter(Boolean).join(' | ')}`).join('\n');
}
