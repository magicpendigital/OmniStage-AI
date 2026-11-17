/**
 * Phase 11A — Film eval: a deterministic 0-100 score for a generated film (the scenes of one storyboard).
 *
 * Why: every prompt or pipeline change used to be judged by eye. This module turns "is the film better?" into numbers that
 * can be tracked over a fixed set of golden prompts (`npm run eval:film`, scripts/eval-film.ts).
 *
 * It measures what can be read from the SceneSpecs themselves (story coverage, hook timing, acting variety, shot cadence,
 * sound, dialogue, continuity across cuts, verifier health). It does NOT judge looks: a vision judge (Director QA) is a
 * separate signal. Pure, no DOM / network.
 */
import { resolvePerformance, shotWindows } from '../runtime/cinematics';
import { MEDIA_CRAFT_CODES, verifySceneSpec } from '../verification/sceneVerifier';
import { lintStoryBible, MAX_HOOK_SECONDS, strictClipMatch } from './storyBible';
import { lintCuts } from './filmEditor';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import type { ActorNode, SceneSpec, StoryBible } from '../types/scene.schema';

export type EvalDimensionId = 'story' | 'hook' | 'acting' | 'camera' | 'sound' | 'dialogue' | 'continuity' | 'technical';

export interface EvalDimension {
  id: EvalDimensionId;
  label: string;
  /** Share of the total score (weights add up to 100). */
  weight: number;
  /** 0-100. */
  score: number;
  notes: string[];
}

export interface FilmEvalReport {
  /** 0-100 weighted total. */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  scenes: number;
  durationSeconds: number;
  hasBible: boolean;
  dimensions: EvalDimension[];
}

export const EVAL_WEIGHTS: Record<EvalDimensionId, { label: string; weight: number }> = {
  story: { label: 'Story', weight: 20 },
  hook: { label: 'Hook', weight: 8 },
  acting: { label: 'Acting', weight: 18 },
  camera: { label: 'Camera', weight: 14 },
  sound: { label: 'Sound', weight: 8 },
  dialogue: { label: 'Dialogue', weight: 6 },
  continuity: { label: 'Continuity', weight: 16 },
  technical: { label: 'Technical', weight: 10 },
};

export function filmGrade(score: number): FilmEvalReport['grade'] {
  return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[], empty = 0) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : empty);
const pct = (fraction: number) => clamp(fraction * 100);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (c: string) => c.toLowerCase().replace(/ing$/, '');

function dim(id: EvalDimensionId, score: number, notes: string[]): EvalDimension {
  return { id, ...EVAL_WEIGHTS[id], score: Math.round(clamp(score)), notes };
}

/** The scenes that make up the film: 3D media scenes in order (games and 2D levels are not films). */
function filmScenes(scenes: SceneSpec[]): SceneSpec[] {
  return scenes.filter((s) => s.mode === 'media' && s.engineType === '3d');
}

/** The scene's hero: the actor with the most performance steps (else the first actor). */
function heroOf(scene: SceneSpec): ActorNode | undefined {
  return [...(scene.actors || [])].sort((a, b) => (b.performance?.length || 0) - (a.performance?.length || 0))[0];
}

/** Distinct things an actor does in a scene (clips played, moving, turning to someone). */
function actionSet(actor: ActorNode): Set<string> {
  const set = new Set<string>();
  for (const step of actor.performance || []) {
    if (step.clip) set.add(norm(step.clip));
    if (step.arriveClip) set.add(norm(step.arriveClip));
    if (step.moveTo && !step.clip) set.add('walk');
    if (step.animation && !step.clip) set.add(`anim:${step.animation}`);
  }
  return set;
}

function sceneEvents(scene: SceneSpec): number[] {
  const times: number[] = [];
  for (const a of scene.actors || []) {
    for (const step of a.performance || []) {
      if (!Number.isFinite(step.time)) continue;
      if (step.moveTo || step.clip || step.animation) times.push(step.time);
    }
  }
  for (const l of scene.dialogue || []) if (Number.isFinite(l.time)) times.push(l.time);
  for (const c of scene.captions || []) if (Number.isFinite(c.start)) times.push(c.start);
  for (const w of shotWindows(scene).slice(1)) times.push(w.start);
  for (const v of scene.vfx || []) if (Number.isFinite(v.startTime) && (v.startTime as number) > 0) times.push(v.startTime as number);
  return times;
}

// ----------------------------------------------------------------------------------------------- dimensions

function evalStory(scenes: SceneSpec[], bible: StoryBible | undefined): EvalDimension {
  const notes: string[] = [];
  const withScript = scenes.filter((s) => s.sequence?.script?.trim()).length / scenes.length;
  const talkOrCaption = scenes.filter((s) => (s.dialogue?.length || 0) + (s.captions?.length || 0) > 0).length / scenes.length;
  if (!bible) {
    // Without a bible there is no plan to measure against: the structure alone can reach 40 at most.
    const distinctBeats = new Set(scenes.map((s) => s.sequence?.beat || '')).size / scenes.length;
    notes.push('no story bible: the film was not written against a logline, stakes, turn and payoff');
    return dim('story', 15 * withScript + 15 * talkOrCaption + 10 * distinctBeats, notes);
  }
  const lint = lintStoryBible(bible, scenes.length);
  for (const i of lint.issues.slice(0, 4)) notes.push(`bible ${i.code}: ${i.message}`);

  const chars = bible.characters;
  const presence = chars.map((c) => {
    const inScenes = scenes.filter((s) => s.actors.some((a) => a.id === c.actorId || a.assetId === c.assetId)).length;
    return inScenes / scenes.length >= 0.5 || inScenes === scenes.length ? 1 : inScenes / (scenes.length * 0.5);
  });
  const signature = chars
    .filter((c) => c.signatureClip)
    .map((c) => {
      const used = scenes.some((s) =>
        s.actors.some(
          (a) =>
            (a.id === c.actorId || a.assetId === c.assetId) &&
            (a.performance || []).some((st) => [st.clip, st.arriveClip].some((x) => x && strictClipMatch(c.signatureClip, [x]) ))
        )
      );
      if (!used) notes.push(`signature gesture "${c.signatureClip}" of ${c.actorId} never appears on screen`);
      return used ? 1 : 0;
    });
  if (presence.some((p) => p < 1)) notes.push('a bible character is missing from half or more of the scenes');
  const realisation = 15 * mean(presence, 0) + 10 * mean(signature, 0) + 8 * talkOrCaption + 7 * withScript;
  return dim('story', 0.6 * lint.score + realisation, notes);
}

function evalHook(first: SceneSpec): EvalDimension {
  const events = sceneEvents(first).filter((t) => t >= 0);
  const earliest = events.length ? Math.min(...events) : Infinity;
  const notes: string[] = [];
  let score: number;
  if (earliest <= 1) score = 100;
  else if (earliest <= MAX_HOOK_SECONDS) score = 85;
  else if (earliest <= 5) score = 50;
  else score = earliest === Infinity ? 0 : 15;
  notes.push(earliest === Infinity ? 'nothing happens in the opening scene' : `first action at ${earliest.toFixed(1)}s`);
  return dim('hook', score, notes);
}

function evalActing(scenes: SceneSpec[]): EvalDimension {
  const notes: string[] = [];
  const perScene = scenes.map((s) => {
    const hero = heroOf(s);
    return hero ? Math.min(1, actionSet(hero).size / 3) : 0;
  });
  const lowScenes = perScene.map((v, i) => (v < 1 ? i + 1 : 0)).filter(Boolean);
  if (lowScenes.length) notes.push(`hero does fewer than 3 different things in scene(s) ${lowScenes.join(', ')}`);

  const moving = scenes.filter((s) => s.actors.some((a) => (a.performance || []).some((st) => st.moveTo))).length / scenes.length;
  const multi = scenes.filter((s) => s.actors.length >= 2);
  const interacting = multi.length
    ? multi.filter((s) => {
        const performers = s.actors.filter((a) => (a.performance?.length || 0) >= 2).length;
        const looks = s.actors.some((a) => (a.performance || []).some((st) => typeof st.lookAt === 'string'));
        return performers >= 2 || looks;
      }).length / multi.length
    : 1;
  if (multi.length && interacting < 1) notes.push('in some scenes the characters do not react to each other');

  let repeated = 0;
  let pairs = 0;
  for (let i = 1; i < scenes.length; i++) {
    const a = heroOf(scenes[i - 1]);
    const b = heroOf(scenes[i]);
    if (!a || !b) continue;
    pairs++;
    const sa = [...actionSet(a)].sort().join('|');
    const sb = [...actionSet(b)].sort().join('|');
    if (sa && sa === sb) repeated++;
  }
  if (repeated) notes.push(`the hero repeats the same set of actions across ${repeated} cut(s)`);
  const variety = pairs ? 1 - repeated / pairs : 1;
  return dim('acting', 55 * mean(perScene) + 15 * moving + 15 * interacting + 15 * variety, notes);
}

function evalCamera(scenes: SceneSpec[]): EvalDimension {
  const notes: string[] = [];
  const counts: number[] = [];
  const types: number[] = [];
  const cadence: number[] = [];
  const opens: string[] = [];
  for (const s of scenes) {
    const w = shotWindows(s);
    const duration = Math.max(1, s.durationSeconds || 8);
    counts.push(Math.min(1, w.length / Math.max(2, Math.floor(duration / 3.5))));
    types.push(Math.min(1, new Set(w.map((x) => x.shot.type)).size / 3));
    cadence.push(w.length ? w.filter((x) => x.end - x.start >= 1.2 && x.end - x.start <= 5.5).length / w.length : 0);
    opens.push(w[0]?.shot.type || 'none');
  }
  if (mean(counts) < 0.8) notes.push('too few shots per scene: the camera holds one framing too long');
  if (mean(cadence) < 0.7) notes.push('shot lengths are outside the 1.2-5.5 s range');
  const first = shotWindows(scenes[0])[0]?.shot;
  const lastWindows = shotWindows(scenes[scenes.length - 1]);
  const last = lastWindows[lastWindows.length - 1]?.shot;
  const opening = first && (first.type === 'establishing' || first.type === 'wide') ? 1 : 0;
  const ending = last && (last.move === 'pull-out' || last.move === 'crane-up' || last.type === 'establishing' || last.type === 'wide') ? 1 : 0;
  const distinctOpens = scenes.length > 1 ? new Set(opens).size / Math.min(scenes.length, 3) : 1;
  if (!opening) notes.push('the film does not open on an establishing / wide shot');
  if (!ending) notes.push('the film does not end on a pull-out / crane-up / wide shot');
  if (distinctOpens < 1 && scenes.length > 1) notes.push('several scenes open with the same shot type');
  return dim('camera', 35 * mean(counts) + 20 * mean(types) + 20 * mean(cadence) + 8 * opening + 8 * ending + 9 * Math.min(1, distinctOpens), notes);
}

function evalSound(scenes: SceneSpec[]): EvalDimension {
  const notes: string[] = [];
  const base = scenes.map((s) => {
    const music = s.soundtrack?.music?.mood && s.soundtrack.music.mood !== 'none' ? 1 : 0;
    const amb = s.soundtrack?.ambience?.type && s.soundtrack.ambience.type !== 'none' ? 1 : 0;
    return 0.6 * music + 0.4 * amb;
  });
  const cues = scenes.map((s) => Math.min(1, (s.soundtrack?.cues?.length || 0) / 2));
  const moods = new Set(scenes.map((s) => s.soundtrack?.music?.mood).filter((m) => m && m !== 'none'));
  const arc = scenes.length >= 3 ? (moods.size >= 2 ? 1 : 0) : moods.size >= 1 ? 1 : 0;
  if (mean(base) < 1) notes.push('some scenes have no music or ambience');
  if (mean(cues) < 0.8) notes.push('fewer than 2 sound cues per scene');
  if (scenes.length >= 3 && !arc) notes.push('one music mood for the whole film: no emotional arc in the score');
  return dim('sound', 50 * mean(base) + 30 * mean(cues) + 20 * arc, notes);
}

function evalDialogue(scenes: SceneSpec[], reports: ReturnType<typeof verifySceneSpec>[]): EvalDimension {
  const notes: string[] = [];
  const talking = scenes.filter((s) => (s.dialogue?.length || 0) > 0);
  if (!talking.length) {
    const captions = scenes.some((s) => (s.captions?.length || 0) > 0);
    notes.push(captions ? 'silent film with captions' : 'no dialogue and no captions');
    return dim('dialogue', captions ? 70 : 50, notes);
  }
  const lines = talking.flatMap((s) => s.dialogue || []);
  const lineOk = lines.filter((l) => words(l.text) <= 14).length / lines.length;
  const countOk = talking.filter((s) => (s.dialogue?.length || 0) >= 2 && (s.dialogue?.length || 0) <= 5).length / talking.length;
  const speakers = new Map<string, number | undefined>();
  for (const s of scenes) for (const l of s.dialogue || []) speakers.set(l.speaker, s.actors.find((a) => a.id === l.speaker)?.voice?.pitch);
  const pitches = [...speakers.values()];
  const voiceVariety = speakers.size < 2 ? 1 : new Set(pitches.map((p) => p ?? 0)).size / speakers.size;
  const issues = reports.reduce((n, r) => n + r.issues.filter((i) => i.code.startsWith('dialogue.')).length, 0);
  if (lineOk < 1) notes.push('some lines are longer than 14 words');
  if (countOk < 1) notes.push('some scenes have fewer than 2 or more than 5 lines');
  if (voiceVariety < 1) notes.push('characters share the same voice pitch');
  if (issues) notes.push(`${issues} dialogue verifier issue(s)`);
  return dim('dialogue', 40 * lineOk + 30 * countOk + 30 * voiceVariety - 15 * issues, notes);
}

function horizontalDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function evalContinuity(scenes: SceneSpec[]): EvalDimension {
  if (scenes.length < 2) return dim('continuity', 100, ['single scene']);
  const notes: string[] = [];
  const position: number[] = [];
  const identity: number[] = [];
  const worldLogic: number[] = [];
  const music: number[] = [];
  const transitions = new Set<string>();
  let sharedNone = 0;
  for (let i = 1; i < scenes.length; i++) {
    const a = scenes[i - 1];
    const b = scenes[i];
    const transition = b.sequence?.transition || 'fade';
    transitions.add(transition);
    const shared = b.actors.filter((x) => a.actors.some((y) => y.id === x.id));
    if (!shared.length) {
      sharedNone++;
      position.push(0.3);
      identity.push(0.3);
    } else {
      for (const bx of shared) {
        const ax = a.actors.find((y) => y.id === bx.id)!;
        const end = resolvePerformance(ax, a.durationSeconds || 8, a.actors, a.world).position;
        // Where B's performance starts from: its base position (steps apply from there).
        position.push(horizontalDistance(end, [bx.position[0], 0, bx.position[2]]) <= 1.5 ? 1 : 0);
        identity.push(ax.assetId === bx.assetId && (ax.voice?.pitch ?? 0) === (bx.voice?.pitch ?? 0) ? 1 : 0);
      }
    }
    const sameWorld = (a.world?.biome || a.world?.terrain?.type) === (b.world?.biome || b.world?.terrain?.type) && a.world?.skybox === b.world?.skybox;
    worldLogic.push(transition === 'cut' && !sameWorld ? 0 : 1);
    const ma = a.soundtrack?.music?.mood;
    const mb = b.soundtrack?.music?.mood;
    music.push(transition === 'cut' && ma && mb && ma !== mb ? 0 : 1);
  }
  if (sharedNone) notes.push(`${sharedNone} cut(s) where no character carries over`);
  if (mean(position) < 0.9) notes.push('a character starts a scene somewhere other than where it ended the previous one');
  if (mean(identity) < 1) notes.push('a character changes rig or voice pitch between scenes');
  if (mean(worldLogic) < 1) notes.push('a straight cut jumps to a different place');
  if (mean(music) < 1) notes.push('the music mood changes on a straight cut');
  const variety = scenes.length >= 3 ? Math.min(1, transitions.size / 2) : 1;
  if (variety < 1) notes.push('every transition is the same');
  // Phase 11C cut grammar: the film editor's seam checks (180° rule, jump cuts, lighting jumps on a straight cut).
  const grammar = lintCuts(scenes).filter((f) => f.code === 'cut.axis-flip' || f.code === 'cut.jump-cut' || f.code === 'cut.light-jump');
  const grammarScore = Math.max(0, 1 - grammar.length / (scenes.length - 1));
  for (const f of grammar.slice(0, 2)) notes.push(f.message);
  return dim('continuity', 35 * mean(position) + 20 * mean(identity) + 15 * mean(worldLogic) + 10 * mean(music) + 5 * variety + 15 * grammarScore, notes);
}

function evalTechnical(reports: ReturnType<typeof verifySceneSpec>[]): EvalDimension {
  const notes: string[] = [];
  const perScene = reports.map((r) => {
    const errors = r.issues.filter((i) => i.severity === 'error').length;
    const craft = r.issues.filter((i) => i.severity !== 'error' && MEDIA_CRAFT_CODES.includes(i.code)).length;
    const other = r.issues.filter((i) => i.severity !== 'error' && !MEDIA_CRAFT_CODES.includes(i.code)).length;
    return { errors, craft, score: clamp(100 - 25 * errors - 10 * craft - 3 * other) };
  });
  const errors = perScene.reduce((n, s) => n + s.errors, 0);
  const craft = perScene.reduce((n, s) => n + s.craft, 0);
  if (errors) notes.push(`${errors} verifier error(s)`);
  if (craft) notes.push(`${craft} craft hint(s) (static hero / single shot / bare stage / silent)`);
  return dim('technical', mean(perScene.map((s) => s.score)), notes);
}

// ----------------------------------------------------------------------------------------------- entry

export function evaluateFilm(input: { scenes: SceneSpec[]; bible?: StoryBible }): FilmEvalReport {
  const scenes = filmScenes(input.scenes);
  const bible = input.bible || input.scenes.find((s) => s.sequence?.bible)?.sequence?.bible;
  if (!scenes.length) {
    return {
      score: 0, grade: 'D', scenes: 0, durationSeconds: 0, hasBible: !!bible,
      dimensions: (Object.keys(EVAL_WEIGHTS) as EvalDimensionId[]).map((id) => dim(id, 0, ['no 3D media scenes to evaluate'])),
    };
  }
  const reports = scenes.map((s) => verifySceneSpec(s));
  const dimensions = [
    evalStory(scenes, bible),
    evalHook(scenes[0]),
    evalActing(scenes),
    evalCamera(scenes),
    evalSound(scenes),
    evalDialogue(scenes, reports),
    evalContinuity(scenes),
    evalTechnical(reports),
  ];
  const score = Math.round(dimensions.reduce((sum, d) => sum + (d.score * d.weight) / 100, 0));
  return {
    score,
    grade: filmGrade(score),
    scenes: scenes.length,
    durationSeconds: Math.round(scenes.reduce((n, s) => n + (s.durationSeconds || 0), 0)),
    hasBible: !!bible,
    dimensions,
  };
}

/** Per-dimension and total change between two reports (positive = better). */
export function compareFilmReports(before: FilmEvalReport, after: FilmEvalReport): { total: number; dimensions: Record<string, number> } {
  const dimensions: Record<string, number> = {};
  for (const d of after.dimensions) {
    const prev = before.dimensions.find((x) => x.id === d.id);
    dimensions[d.id] = d.score - (prev?.score ?? 0);
  }
  return { total: after.score - before.score, dimensions };
}

/** Assets used by the film that are not in the registry (an eval sanity check for authored films). */
export function unknownAssets(scenes: SceneSpec[]): string[] {
  const out = new Set<string>();
  for (const s of scenes) for (const a of s.actors || []) if (!ASSET_REGISTRY[a.assetId]) out.add(a.assetId);
  return [...out];
}
