/**
 * Film editor (Phase 11C, P0 #3 + #4b): deterministic checks and mechanical fixes for the CUTS between scenes.
 *
 * Every scene of a film is authored on its own, so the seams are where a film falls apart: a character that ended a walk at the
 * door starts the next scene back at the spawn point, the camera crosses the line between two people, two shots in a row sit on
 * the same spot. This module is pure (no AI, no DOM): `lintCuts` reports the seams, `carryFromPrevious` repairs the ones that can
 * be repaired without taste (character state), `editFilm` runs both over a finished film.
 */
import type { ActorNode, CameraShot, SceneSpec } from '../types/scene.schema';
import { resolvePerformance, resolveShot, shotWindows } from '../runtime/cinematics';
import { shareLocationWorlds } from './locations';
import { resolveSoundtrack } from '../audio/soundtrack';
import { dialogueTimeline } from '../audio/voices';

export type CutCode =
  | 'cut.position-jump' // a character starts the scene somewhere other than where it ended the previous one
  | 'cut.facing-jump' // ... or facing another way
  | 'cut.axis-flip' // 180° rule: the camera crosses the line between two characters on a straight cut
  | 'cut.jump-cut' // two shots of the same framing from (almost) the same spot
  | 'cut.light-jump' // a straight cut changes the lighting preset
  | 'cut.no-carryover'; // nobody in the previous scene appears in this one

export interface CutFinding {
  /** Index (in the film) of the scene the cut leads INTO. */
  cut: number;
  code: CutCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** `carryFromPrevious` / `editFilm` repairs it. */
  fixable: boolean;
}

export const CARRY_POSITION_TOLERANCE = 1.5; // metres, same as the film eval
const CARRY_YAW_TOLERANCE = (50 * Math.PI) / 180;
const JUMP_CUT_DISTANCE = 0.75; // metres between the two cameras
const AXIS_MIN_SPREAD = 0.6; // metres: the camera must be clearly off the line before a flip counts

const isFilmScene = (s: SceneSpec) => s.mode === 'media' && s.engineType === '3d';

function endOf(scene: SceneSpec, actor: ActorNode) {
  return resolvePerformance(actor, scene.durationSeconds || 8, scene.actors, scene.world);
}

function startOf(scene: SceneSpec, actor: ActorNode) {
  return { position: actor.position, yaw: actor.rotation?.[1] ?? 0 };
}

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** True when the two scenes take place in the same location (same biome / terrain and sky), so characters resume where they stood. */
export function sameLocation(a: SceneSpec, b: SceneSpec): boolean {
  const place = (s: SceneSpec) => s.world?.biome || s.world?.terrain?.type || '';
  return place(a) === place(b) && (a.world?.skybox || '') === (b.world?.skybox || '');
}

function sharedActors(a: SceneSpec, b: SceneSpec): Array<{ prev: ActorNode; next: ActorNode }> {
  const out: Array<{ prev: ActorNode; next: ActorNode }> = [];
  for (const next of b.actors || []) {
    const prev = (a.actors || []).find((x) => x.id === next.id);
    if (prev) out.push({ prev, next });
  }
  return out;
}

/** Which side of the line P→Q a point is on (+1 / -1), or 0 when it is within `minSpread` metres of the line. */
function sideOfLine(p: [number, number, number], q: [number, number, number], c: [number, number, number], minSpread: number): number {
  const lx = q[0] - p[0];
  const lz = q[2] - p[2];
  const len = Math.hypot(lx, lz);
  if (len < 0.3) return 0;
  const cross = (lx * (c[2] - p[2]) - lz * (c[0] - p[0])) / len; // signed distance from the line
  return Math.abs(cross) < minSpread ? 0 : Math.sign(cross);
}

function lastShot(scene: SceneSpec): CameraShot | undefined {
  const w = shotWindows(scene);
  return w[w.length - 1]?.shot;
}

function firstShot(scene: SceneSpec): CameraShot | undefined {
  return shotWindows(scene)[0]?.shot;
}

/** Lints the cut from `a` into `b` (the scene with film index `cut`). */
export function lintCut(a: SceneSpec, b: SceneSpec, cut: number): CutFinding[] {
  const findings: CutFinding[] = [];
  const transition = b.sequence?.transition || 'fade';
  const straight = transition === 'cut';
  const same = sameLocation(a, b);
  const shared = sharedActors(a, b);

  if (!shared.length) {
    findings.push({ cut, code: 'cut.no-carryover', severity: 'info', message: `Scene ${cut + 1}: no character from scene ${cut} appears in it.`, fixable: false });
  }

  if (same) {
    for (const { prev, next } of shared) {
      const end = endOf(a, prev);
      const start = startOf(b, next);
      const gap = Math.hypot(end.position[0] - start.position[0], end.position[2] - start.position[2]);
      if (gap > CARRY_POSITION_TOLERANCE) {
        findings.push({ cut, code: 'cut.position-jump', severity: 'warning', message: `${next.name || next.id} ends scene ${cut} ${gap.toFixed(1)} m from where scene ${cut + 1} starts it.`, fixable: true });
      } else if (angleDiff(end.yaw, start.yaw) > CARRY_YAW_TOLERANCE) {
        findings.push({ cut, code: 'cut.facing-jump', severity: 'info', message: `${next.name || next.id} turns around between scenes ${cut} and ${cut + 1}.`, fixable: true });
      }
    }
  }

  if (straight) {
    const sa = a.environment?.presetId;
    const sb = b.environment?.presetId;
    if (sa && sb && sa !== sb && same) {
      findings.push({ cut, code: 'cut.light-jump', severity: 'warning', message: `A straight cut into scene ${cut + 1} changes the lighting (${sa} → ${sb}) in the same place.`, fixable: false });
    }
    const la = lastShot(a);
    const fb = firstShot(b);
    if (la && fb) {
      // Camera positions on the last frame of A and the first frame of B (B's actors already stand where A's ended when carried).
      const ca = resolveShot(a, Math.max(0, (a.durationSeconds || 8) - 0.01));
      const cb = resolveShot(b, 0);
      if (ca && cb) {
        const dist = Math.hypot(ca.position[0] - cb.position[0], ca.position[2] - cb.position[2]);
        if (la.type === fb.type && dist < JUMP_CUT_DISTANCE && same) {
          findings.push({ cut, code: 'cut.jump-cut', severity: 'warning', message: `Scenes ${cut} and ${cut + 1} cut between two ${fb.type} shots from almost the same spot.`, fixable: false });
        }
        if (shared.length >= 2) {
          const [p, q] = shared;
          const pa = endOf(a, p.prev).position;
          const qa = endOf(a, q.prev).position;
          const pb = startOf(b, p.next).position;
          const qb = startOf(b, q.next).position;
          const sideA = sideOfLine(pa, qa, ca.position, AXIS_MIN_SPREAD);
          const sideB = sideOfLine(pb, qb, cb.position, AXIS_MIN_SPREAD);
          if (sideA !== 0 && sideB !== 0 && sideA !== sideB) {
            findings.push({ cut, code: 'cut.axis-flip', severity: 'warning', message: `The camera crosses the line between ${p.next.name || p.next.id} and ${q.next.name || q.next.id} on the cut into scene ${cut + 1} (180° rule).`, fixable: true });
          }
        }
      }
    }
  }
  return findings;
}

/** Every cut of a film. `scenes` may include non-film scenes (games, 2D): only 3D media scenes are checked, in order. */
export function lintCuts(scenes: SceneSpec[]): CutFinding[] {
  const film = scenes.filter(isFilmScene);
  const out: CutFinding[] = [];
  for (let i = 1; i < film.length; i++) out.push(...lintCut(film[i - 1], film[i], i));
  return out;
}

const MIRROR: Record<string, NonNullable<CameraShot['angle']>> = {
  'three-quarter-left': 'three-quarter-right',
  'three-quarter-right': 'three-quarter-left',
  left: 'right',
  right: 'left',
};

/**
 * Repairs the seam from `prev` into `next` and returns a COPY of `next` plus a note per repair (the input is not changed):
 *  - characters present in both scenes resume where (and facing how) they ended, when the scenes share a location;
 *  - on a straight cut that crosses the line, the first shot is mirrored (left ↔ right) so the camera stays on its side.
 * Anything that needs taste (lighting, jump cuts) is left to `lintCut` to report.
 */
export function carryFromPrevious(prev: SceneSpec, next: SceneSpec): { scene: SceneSpec; notes: string[] } {
  const pose = carryPose(prev, next);
  const sound = soundCuts(prev, pose.scene);
  return { scene: sound.scene, notes: [...pose.notes, ...sound.notes] };
}

/** Longest line of dialogue-overrun we treat as "still talking when the picture cuts". */
const L_CUT_SECONDS = 0.8;
const J_CUT_SECONDS = 0.8;

/**
 * J-cut / L-cut (Phase 11E): the sound of a cut does not have to land with the picture.
 *  - a change of place with its own ambience: the new place's ambience comes in `J_CUT_SECONDS` BEFORE the picture (J-cut);
 *  - a line of dialogue that is still being spoken when the scene ends keeps going over the next picture (L-cut).
 * Values already authored on `next.sequence` are kept. Returns a copy.
 */
export function soundCuts(prev: SceneSpec, next: SceneSpec): { scene: SceneSpec; notes: string[] } {
  if (!isFilmScene(prev) || !isFilmScene(next) || !next.sequence) return { scene: next, notes: [] };
  const notes: string[] = [];
  const seq = { ...next.sequence };
  const index = (seq.index ?? 0) + 1;
  if (seq.audioLead === undefined && !sameLocation(prev, next)) {
    const a = resolveSoundtrack(prev)?.ambience;
    const b = resolveSoundtrack(next)?.ambience;
    if (b && b !== 'none' && a !== b) {
      seq.audioLead = J_CUT_SECONDS;
      notes.push(`J-cut into scene ${index}: the ${b} ambience arrives ${J_CUT_SECONDS}s before the picture`);
    }
  }
  if (seq.audioTail === undefined && prev.dialogue?.length && prev.actors) {
    const duration = prev.durationSeconds || 8;
    const last = dialogueTimeline({ actors: prev.actors, dialogue: prev.dialogue, durationSeconds: duration }).pop();
    if (last && last.end >= duration - 0.05) {
      seq.audioTail = L_CUT_SECONDS;
      notes.push(`L-cut into scene ${index}: the last line of scene ${index - 1} runs on over the new picture`);
    }
  }
  return notes.length ? { scene: { ...next, sequence: seq }, notes } : { scene: next, notes };
}

function carryPose(prev: SceneSpec, next: SceneSpec): { scene: SceneSpec; notes: string[] } {
  const notes: string[] = [];
  const scene: SceneSpec = { ...next, actors: next.actors.map((a) => ({ ...a })) };
  if (!isFilmScene(prev) || !isFilmScene(next) || !sameLocation(prev, next)) return { scene, notes };

  for (const { prev: p, next: n } of sharedActors(prev, next)) {
    const target = scene.actors.find((a) => a.id === n.id);
    if (!target) continue;
    const end = endOf(prev, p);
    const gap = Math.hypot(end.position[0] - n.position[0], end.position[2] - n.position[2]);
    const turned = angleDiff(end.yaw, n.rotation?.[1] ?? 0) > CARRY_YAW_TOLERANCE;
    if (gap > CARRY_POSITION_TOLERANCE || turned) {
      target.position = [end.position[0], n.position[1], end.position[2]];
      target.rotation = [n.rotation?.[0] ?? 0, end.yaw, n.rotation?.[2] ?? 0];
      notes.push(`${n.name || n.id} resumes where scene ${(prev.sequence?.index ?? 0) + 1} left it`);
    }
  }

  // 180° rule on a straight cut: mirror the opening shot, but only keep the mirror when it really puts the camera back on its side.
  if ((next.sequence?.transition || 'fade') === 'cut' && scene.camera?.shots?.length) {
    const index = next.sequence?.index ?? 1;
    const opening = scene.camera.shots[0];
    if (lintCut(prev, scene, index).some((f) => f.code === 'cut.axis-flip') && opening.angle && MIRROR[opening.angle]) {
      const mirrored: SceneSpec = { ...scene, camera: { ...scene.camera, shots: scene.camera.shots.map((s, i) => (i === 0 ? { ...s, angle: MIRROR[opening.angle!] } : s)) } };
      if (!lintCut(prev, mirrored, index).some((f) => f.code === 'cut.axis-flip')) {
        scene.camera = mirrored.camera;
        notes.push('opening shot mirrored to stay on one side of the characters (180° rule)');
      }
    }
  }
  return { scene, notes };
}

export interface FilmEditResult {
  scenes: SceneSpec[];
  /** What the editor changed. */
  fixes: string[];
  /** What is left over, for the user (taste calls the editor does not make). */
  remaining: CutFinding[];
}

/** Runs `carryFromPrevious` down a finished film (in order, so a carried pose feeds the next cut) and lints what is left. */
export function editFilm(input: SceneSpec[]): FilmEditResult {
  const out: SceneSpec[] = [];
  const fixes: string[] = [];
  // Scenes at one bible location are dressed alike first, so the seams below see them as the same place.
  const shared = shareLocationWorlds(input);
  for (const n of shared.notes) fixes.push(`Location: ${n}`);
  const scenes = shared.scenes;
  let prevFilm: SceneSpec | undefined;
  for (const scene of scenes) {
    if (!isFilmScene(scene)) { out.push(scene); continue; }
    if (prevFilm) {
      const r = carryFromPrevious(prevFilm, scene);
      for (const n of r.notes) fixes.push(`Cut into scene ${(scene.sequence?.index ?? 0) + 1}: ${n}`);
      out.push(r.scene);
      prevFilm = r.scene;
    } else {
      out.push(scene);
      prevFilm = scene;
    }
  }
  return { scenes: out, fixes, remaining: lintCuts(out).filter((f) => !f.fixable || f.severity !== 'info') };
}
