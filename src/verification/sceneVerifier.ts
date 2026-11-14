/**
 * Phase 4 — Deterministic SceneSpec Verifier (the "verification loop" for AI output).
 *
 * `verifySceneSpec` is a pure function: no store, no React, no network. It checks that a SceneSpec is
 * structurally sound AND playable (2D platformer reachability using the real jump physics of
 * StageCanvas2D, score goals that can actually be reached, arena bounds for the 3D WASD loop...).
 * `autoFixSceneSpec` repairs every issue flagged `fixable` and re-verifies, so the AI director only has
 * to be asked about what cannot be fixed mechanically.
 */
import type {
  ActorNode,
  Node2D,
  SceneSpec,
  VerificationIssue,
  VerificationReport,
} from '../types/scene.schema';
import { isEaseId } from '../animation/easing';
import { SFX_PRESET_IDS } from '../audio/audioBus';
import { PARTICLE_2D_PRESETS } from '../vfx/particles2D';
import { heroActor, performanceActionCount } from '../runtime/cinematics';
import { AMBIENCE_IDS, MUSIC_MOODS } from '../audio/soundtrack';
import { DIALOGUE_EMOTIONS, dialogueTimeline } from '../audio/voices';
import { BIOME_IDS, featureStageClearance } from '../runtime/biomes';

// --- Phase 10A: film craft (media 3D) ---
export const SHOT_TYPES = ['establishing', 'wide', 'medium', 'close-up', 'over-shoulder', 'low-angle', 'high-angle', 'tracking'];
export const SCENE_TRANSITIONS = ['cut', 'fade', 'crossfade', 'fade-white', 'wipe'];
const STAGE_3D = 12; // performances stay within ±12 m
/** Media craft hints: warnings the AI patch loop also tries to resolve (see `mediaQualityPenalty`). */
export const MEDIA_CRAFT_CODES = ['media.hero-static', 'media.single-shot', 'media.bare-stage', 'media.silent'];
export const WORLD_FEATURE_TYPES = ['waterfall', 'river', 'pond'];
/** Water landmarks must leave the acting area (and the cameras around it) free. */
export const FEATURE_STAGE_CLEARANCE = 6;

// --- 2D physics envelope (mirrors StageCanvas2D: jump vy = -520 px/s, gravity = 9.8 * 90 px/s², run 320 px/s) ---
export const PLATFORMER_PHYSICS = {
  jumpVelocity: 520,
  gravity: 9.8 * 90,
  runSpeed: 320,
  /** Safety margin for landing on platforms, so levels stay comfortable rather than pixel-perfect. */
  margin: 0.82,
  /** Platforms are one-way (land from above only), so a near-full jump can touch pickups through them. */
  pickupMargin: 0.95,
};
const JUMP_HEIGHT = (PLATFORMER_PHYSICS.jumpVelocity ** 2) / (2 * PLATFORMER_PHYSICS.gravity); // ≈ 153px
export const MAX_STEP_UP = Math.floor(JUMP_HEIGHT * PLATFORMER_PHYSICS.margin); // ≈ 125px
const AIR_TIME_SAME_LEVEL = (2 * PLATFORMER_PHYSICS.jumpVelocity) / PLATFORMER_PHYSICS.gravity; // ≈ 1.18s
export const MAX_GAP = Math.floor(AIR_TIME_SAME_LEVEL * PLATFORMER_PHYSICS.runSpeed * PLATFORMER_PHYSICS.margin); // ≈ 309px
const STAGE_W = 1000;
const STAGE_H = 600;
/** 3D WASD loop clamps the player to ±5.5 on X/Z (useStudioStore.movePlayerActor). */
const ARENA_3D = 5.5;
const DEFAULT_SCORE = 25;

export interface VerifyOptions {
  /** Whole storyboard, used to validate `sequence.nextSceneId`. */
  scenes?: SceneSpec[];
}

interface Surface {
  id: string;
  left: number;
  right: number;
  top: number;
}

function issue(
  code: string,
  severity: VerificationIssue['severity'],
  message: string,
  fixable: boolean,
  targetId?: string
): VerificationIssue {
  return { code, severity, message, fixable, targetId };
}

function surfaceOf(n: Node2D): Surface {
  const w = n.width * Math.abs(n.scaleX ?? 1);
  const h = n.height * Math.abs(n.scaleY ?? 1);
  return { id: n.id, left: n.x - w / 2, right: n.x + w / 2, top: n.y - h / 2 };
}

function horizontalGap(a: Surface, b: Surface): number {
  if (a.right < b.left) return b.left - a.right;
  if (b.right < a.left) return a.left - b.right;
  return 0;
}

/** Can a platformer player standing on `from` land on `to`? (y grows downward). */
export function canReachSurface(from: Surface, to: Surface): boolean {
  const rise = from.top - to.top; // > 0 when `to` is higher
  if (rise > MAX_STEP_UP) return false;
  const gap = horizontalGap(from, to);
  // Falling buys extra air time: t = sqrt(2*drop/g) added to the same-level arc.
  const drop = Math.max(0, -rise);
  const extraAir = Math.sqrt((2 * drop) / PLATFORMER_PHYSICS.gravity);
  const reach = MAX_GAP + extraAir * PLATFORMER_PHYSICS.runSpeed * PLATFORMER_PHYSICS.margin;
  return gap <= reach;
}

function isPlayer2D(n: Node2D) {
  return n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown';
}

function visible<T extends { visible?: boolean }>(list: T[] | undefined): T[] {
  return (list || []).filter((n) => n.visible !== false);
}

/** Platform the player lands on when dropped from its start position (highest surface below it). */
function startSurface(player: Node2D, surfaces: Surface[]): Surface | undefined {
  const halfW = (player.width * Math.abs(player.scaleX ?? 1)) / 2;
  const feet = player.y + (player.height * Math.abs(player.scaleY ?? 1)) / 2;
  return surfaces
    .filter((s) => player.x + halfW > s.left && player.x - halfW < s.right && s.top >= feet - 24)
    .sort((a, b) => a.top - b.top)[0];
}

export function reachableSurfaces(player: Node2D, platforms: Node2D[]): { start?: Surface; reachable: Surface[]; all: Surface[] } {
  const all = platforms.map(surfaceOf);
  const start = startSurface(player, all);
  if (!start) return { start, reachable: [], all };
  const seen = new Set([start.id]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const s of all) {
      if (!seen.has(s.id) && canReachSurface(cur, s)) {
        seen.add(s.id);
        queue.push(s);
      }
    }
  }
  return { start, reachable: all.filter((s) => seen.has(s.id)), all };
}

/** A collectible is grabbable if the player's body can overlap it while standing on / jumping from a surface. */
function collectibleReachableFrom(c: Node2D, s: Surface, player: Node2D): boolean {
  const playerH = player.height * Math.abs(player.scaleY ?? 1);
  const playerW = player.width * Math.abs(player.scaleX ?? 1);
  const cH = c.height * Math.abs(c.scaleY ?? 1);
  const cW = c.width * Math.abs(c.scaleX ?? 1);
  const highestBodyTop = s.top - playerH - JUMP_HEIGHT * PLATFORMER_PHYSICS.pickupMargin;
  const withinY = c.y + cH / 2 >= highestBodyTop && c.y - cH / 2 <= s.top + 4;
  const reachX = (playerW + cW) / 2 + 60; // small jump drift past the edge
  const withinX = c.x >= s.left - reachX && c.x <= s.right + reachX;
  return withinX && withinY;
}

function verify2D(spec: SceneSpec, issues: VerificationIssue[]) {
  const nodes = visible(spec.nodes2D);
  for (const n of nodes) {
    if (n.x < 0 || n.x > STAGE_W || n.y < 0 || n.y > STAGE_H) {
      issues.push(issue('2d.out-of-bounds', 'warning', `"${n.name}" is outside the 1000x600 stage (${Math.round(n.x)}, ${Math.round(n.y)}).`, true, n.id));
    }
    if (n.type === 'particle-emitter' && (!n.emitter || !(PARTICLE_2D_PRESETS.includes(n.emitter.preset) || spec.particleLibrary?.[n.emitter.preset]))) {
      issues.push(issue('2d.unknown-particle', 'warning', `Particle emitter "${n.name}" has no valid preset (${PARTICLE_2D_PRESETS.join(', ')}).`, true, n.id));
    }
    const sheet = n.spriteSheet;
    if (sheet && (!n.imageUrl || !(sheet.frameWidth > 0) || !(sheet.frameHeight > 0) || !(sheet.columns > 0) || !(sheet.frameCount > 0) || !(sheet.fps > 0))) {
      issues.push(issue('2d.invalid-spritesheet', 'warning', `"${n.name}" has an invalid spriteSheet (needs imageUrl and positive frame size, columns, frameCount, fps).`, true, n.id));
    }
    for (const k of n.keyframeTrack || []) {
      if (k.ease !== undefined && !isEaseId(k.ease)) {
        issues.push(issue('keyframe.unknown-ease', 'warning', `"${n.name}" uses unknown ease "${k.ease}".`, true, n.id));
        break;
      }
    }
  }
  if (spec.mode !== 'game') return;

  const player = nodes.find(isPlayer2D);
  const collectibles = nodes.filter((n) => n.physics2D === 'collectible');
  if (!player) {
    issues.push(issue('2d.no-player', 'error', 'Game scene has no player node (physics2D "player-platformer" / "player-topdown").', true));
  }
  verifyScoreGoal(spec, collectibles.map((c) => c.scoreValue ?? DEFAULT_SCORE), issues);
  if (!player || player.physics2D !== 'player-platformer') return;

  const platforms = nodes.filter((n) => n.physics2D === 'static-platform');
  const { start, reachable } = reachableSurfaces(player, platforms);
  if (!start) {
    issues.push(issue('2d.player-no-ground', 'error', `Player "${player.name}" starts above no platform and would fall forever.`, true, player.id));
    return;
  }
  for (const c of collectibles) {
    if (!reachable.some((s) => collectibleReachableFrom(c, s, player))) {
      issues.push(issue('2d.collectible-unreachable', 'error', `Collectible "${c.name}" cannot be reached with the platformer jump (max step-up ${MAX_STEP_UP}px, gap ${MAX_GAP}px).`, true, c.id));
    }
  }
}

function clickCollects(a: ActorNode) {
  return a.onClickAction === 'collect' || a.onClickAction === 'collect-score';
}

function verify3D(spec: SceneSpec, issues: VerificationIssue[]) {
  const actors = visible(spec.actors);
  for (const k of spec.camera?.keyframes || []) {
    if (k.ease !== undefined && !isEaseId(k.ease)) {
      issues.push(issue('keyframe.unknown-ease', 'warning', `Camera keyframe at ${k.time}s uses unknown ease "${k.ease}".`, true));
      break;
    }
  }
  if (spec.camera?.followActorId && !spec.actors.some((a) => a.id === spec.camera.followActorId)) {
    issues.push(issue('camera.follow-missing', 'error', `camera.followActorId "${spec.camera.followActorId}" does not match any actor.`, true));
  }
  if (spec.mode !== 'game') return;

  const player = actors.find((a) => a.physicsRole === 'player');
  const scoring = actors.filter((a) => a.physicsRole === 'collectible' || clickCollects(a));
  if (!player && !scoring.some(clickCollects) && spec.gameRules?.winCondition !== 'unbox-reveal' && spec.gameRules?.winCondition !== 'survive-timer') {
    issues.push(issue('3d.no-player', 'error', 'Game scene has no player actor and nothing is tap-collectable, so the score can never change.', false));
  }
  if (player) {
    for (const a of scoring) {
      if (a.physicsRole === 'collectible' && !clickCollects(a) && (Math.abs(a.position[0]) > ARENA_3D + 0.6 || Math.abs(a.position[2]) > ARENA_3D + 0.6)) {
        issues.push(issue('3d.collectible-out-of-arena', 'error', `Collectible "${a.name}" is outside the ±${ARENA_3D}m player arena.`, true, a.id));
      }
    }
  }
  verifyScoreGoal(spec, scoring.map((a) => a.scoreValue ?? DEFAULT_SCORE), issues);
}

function isClip(actor: ActorNode, clip: string): boolean {
  const names = actor.availableClips || [];
  if (!names.length) return true; // clips unknown until the model loads
  const w = clip.toLowerCase();
  const alias: Record<string, string[]> = { walk: ['walk'], run: ['run', 'gallop'], idle: ['idle', 'survey'] };
  return names.some((n) => n.toLowerCase().includes(w) || w.includes(n.toLowerCase().replace(/[_\s]+$/, ''))) ||
    (alias[w] || []).some((a) => names.some((n) => n.toLowerCase().includes(a)));
}

/** Phase 10A: performance / shot validity and film craft hints for 3D media scenes. */
function verifyMedia(spec: SceneSpec, issues: VerificationIssue[]) {
  if (spec.engineType !== '3d' || spec.mode !== 'media') return;
  const duration = Math.max(1, spec.durationSeconds || 8);
  const ids = new Set(spec.actors.map((a) => a.id));
  for (const a of spec.actors) {
    for (const st of a.performance || []) {
      const badMove = st.moveTo !== undefined && (!Array.isArray(st.moveTo) || st.moveTo.length !== 3 || st.moveTo.some((v) => !Number.isFinite(v) || Math.abs(v) > STAGE_3D));
      if (!Number.isFinite(st.time) || st.time < 0 || st.time > duration || badMove || (st.ease !== undefined && !isEaseId(st.ease))) {
        issues.push(issue('media.performance-invalid', 'warning', `"${a.name}" has a performance step outside the scene (time ${st.time}s of ${duration}s) or an invalid moveTo / ease.`, true, a.id));
        break;
      }
    }
    let clipFlagged = false;
    let lookFlagged = false;
    for (const st of a.performance || []) {
      for (const clip of [st.clip, st.arriveClip]) {
        if (clip && !clipFlagged && !isClip(a, clip)) {
          clipFlagged = true;
          issues.push(issue('media.performance-clip', 'warning', `"${a.name}" has no clip "${clip}" (clips: ${(a.availableClips || []).join(', ')}).`, true, a.id));
        }
      }
      if (typeof st.lookAt === 'string' && !ids.has(st.lookAt) && !lookFlagged) {
        lookFlagged = true;
        issues.push(issue('media.lookat-missing', 'warning', `"${a.name}" looks at "${st.lookAt}", which is not an actor.`, true, a.id));
      }
    }
  }
  for (const sh of spec.camera?.shots || []) {
    if (!SHOT_TYPES.includes(sh.type) || !Number.isFinite(sh.start) || sh.start < 0 || sh.start >= duration ||
        (sh.subject && !ids.has(sh.subject)) || (sh.partner && !ids.has(sh.partner))) {
      issues.push(issue('media.shot-invalid', 'warning', `Camera shot at ${sh.start}s is invalid (type "${sh.type}", subject "${sh.subject ?? '-'}", partner "${sh.partner ?? '-'}").`, true));
      break;
    }
  }
  const t = spec.sequence?.transition;
  if (t !== undefined && !SCENE_TRANSITIONS.includes(t)) {
    issues.push(issue('media.transition-invalid', 'warning', `Unknown scene transition "${t}".`, true));
  }

  // Craft hints (not fixable mechanically: the director has to make a creative choice).
  const hero = heroActor(spec);
  if (hero && duration > 5 && hero.availableClips?.length && performanceActionCount(hero) < 2) {
    issues.push(issue('media.hero-static', 'warning', `"${hero.name}" does one thing for the whole ${duration}s scene. Add actors[].performance steps (clip changes, moveTo, lookAt) — at least 3 actions.`, false, hero.id));
  }
  if (spec.actors.length && duration > 6 && (spec.camera?.shots?.length || 0) < 2) {
    issues.push(issue('media.single-shot', 'warning', `One camera framing for ${duration}s. Add camera.shots (wide → medium → close-up, a cut every 2-4 s).`, false));
  }
  const w = spec.world;
  const bare = (!w || ['flat-grid', 'none'].includes(w.terrain?.type)) && !(w?.scatterObjects?.length) && !w?.hdri?.url && !w?.biome;
  if (spec.actors.length && bare) {
    issues.push(issue('media.bare-stage', 'warning', 'The scene has no place: set world.biome (forest, meadow, beach, desert, snowy-peaks, waterfall-valley, night-forest, city-night) or world.terrain + scatterObjects + sky / weather (or an HDRI), and turn off environment.groundGrid.', false));
  }
  // Phase 10B: a film scene needs sound.
  const st = spec.soundtrack;
  const silent = !st || ((!st.music || st.music.mood === 'none') && st.ambience?.type === 'none' && !(st.cues?.length));
  if (spec.actors.length && duration > 3 && silent) {
    issues.push(issue('media.silent', 'warning', 'The scene is silent. Add soundtrack: { music: { mood }, ambience: { type: "auto" }, cues: [{ time, sfx }] } — pick the mood from the beat (calm, happy, playful, adventure, epic, tense, sad, mysterious).', false));
  }
}

/** Phase 10C: dialogue lines — valid speakers, inside the scene, no two lines on top of each other. */
function verifyDialogue(spec: SceneSpec, issues: VerificationIssue[]) {
  const lines = spec.dialogue || [];
  if (!lines.length) return;
  const duration = Math.max(1, spec.durationSeconds || 8);
  const ids = new Set([...spec.actors.map((a) => a.id), ...(spec.nodes2D || []).map((n) => n.id)]);
  const bad = lines.filter((l) => !l || typeof l.text !== 'string' || !l.text.trim() || !ids.has(l.speaker) || !Number.isFinite(l.time) ||
    l.time < 0 || l.time >= duration || (l.emotion !== undefined && !DIALOGUE_EMOTIONS.includes(l.emotion)) || (l.listener !== undefined && !ids.has(l.listener)));
  if (bad.length) {
    issues.push(issue('dialogue.invalid', 'warning', `${bad.length} dialogue line(s) have no text, an unknown speaker / listener (use actor ids: ${spec.actors.map((a) => a.id).join(', ')}), an unknown emotion or a time outside 0..${duration}s.`, true));
  }
  const timeline = dialogueTimeline(spec);
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].start < timeline[i - 1].end - 0.05) {
      issues.push(issue('dialogue.overlap', 'warning', `Line "${timeline[i].line.text.slice(0, 40)}" starts at ${timeline[i].start}s while "${timeline[i - 1].line.text.slice(0, 40)}" is still being said (until ${timeline[i - 1].end.toFixed(1)}s). Give each line its own time.`, true, timeline[i].line.id));
      break;
    }
  }
  // Spoken length without the scene clamp: a line that would run past the end is cut off.
  const late = dialogueTimeline({ ...spec, durationSeconds: 1e9 }).find((t) => t.start < duration && t.end > duration + 0.05);
  if (late) {
    issues.push(issue('dialogue.cut-off', 'warning', `"${late.line.text.slice(0, 40)}" is cut off by the end of the scene; start it earlier or make the scene longer.`, true, late.line.id));
  }
}

/** Phase 10B: soundtrack values the renderer understands (any engine). */
function verifySoundtrack(spec: SceneSpec, issues: VerificationIssue[]) {
  const st = spec.soundtrack;
  if (!st) return;
  const duration = Math.max(1, spec.durationSeconds || 8);
  const badMood = st.music !== undefined && !MUSIC_MOODS.includes(st.music?.mood);
  const badAmb = st.ambience !== undefined && !AMBIENCE_IDS.includes(st.ambience?.type);
  const badCue = (st.cues || []).some((c) => !c || !Number.isFinite(c.time) || c.time < 0 || c.time >= duration ||
    (!(SFX_PRESET_IDS as string[]).includes(c.sfx) && !spec.sfxLibrary?.[c.sfx]));
  if (badMood || badAmb || badCue) {
    issues.push(issue('soundtrack.invalid', 'warning', `Soundtrack has ${[badMood && `an unknown mood "${st.music?.mood}"`, badAmb && `an unknown ambience "${st.ambience?.type}"`, badCue && 'cues outside the scene or with unknown sfx ids'].filter(Boolean).join(', ')}. Moods: ${MUSIC_MOODS.join(', ')}; ambiences: ${AMBIENCE_IDS.join(', ')}; sfx: ${SFX_PRESET_IDS.join(', ')}.`, true));
  }
}

/** Phase 10B: biome id and water landmarks. */
function verifyWorldFeatures(spec: SceneSpec, issues: VerificationIssue[]) {
  if (spec.engineType !== '3d' || !spec.world) return;
  if (spec.world.biome !== undefined && !BIOME_IDS.includes(spec.world.biome)) {
    issues.push(issue('world.biome-invalid', 'warning', `Unknown biome "${spec.world.biome}" (biomes: ${BIOME_IDS.join(', ')}).`, true));
  }
  for (const f of spec.world.features || []) {
    if (!f || !WORLD_FEATURE_TYPES.includes(f.type) || !Array.isArray(f.position) || f.position.length !== 3 || f.position.some((v) => !Number.isFinite(v))) {
      issues.push(issue('world.feature-invalid', 'warning', `World feature "${f?.id ?? '?'}" is invalid (types: ${WORLD_FEATURE_TYPES.join(', ')}; position [x, y, z]).`, true, f?.id));
      continue;
    }
    if (featureStageClearance(f) < FEATURE_STAGE_CLEARANCE) {
      issues.push(issue('world.feature-on-stage', 'warning', `The ${f.type} "${f.id}" covers the acting area; keep water landmarks ${FEATURE_STAGE_CLEARANCE}+ m from the stage centre (e.g. a waterfall at [0, 0, -15] behind the actors).`, true, f.id));
    }
  }
}

/** Phase 10A: how much film craft is missing (0 = none). The AI patch loop keeps going while this is > 0. */
export function mediaQualityPenalty(report: VerificationReport): number {
  return report.issues.filter((i) => MEDIA_CRAFT_CODES.includes(i.code)).length;
}

function verifyScoreGoal(spec: SceneSpec, values: number[], issues: VerificationIssue[]) {
  const rules = spec.gameRules;
  if (!rules) {
    issues.push(issue('rules.missing', 'error', 'Game scene has no gameRules.', true));
    return;
  }
  if (!(rules.timeLimitSeconds > 0)) {
    issues.push(issue('rules.time-limit', 'warning', `gameRules.timeLimitSeconds must be > 0 (got ${rules.timeLimitSeconds}).`, true));
  }
  if (rules.winCondition !== 'collect-all' && rules.winCondition !== 'score-threshold') return;
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total === 0) {
    issues.push(issue('rules.no-collectibles', 'error', `Win condition "${rules.winCondition}" needs collectibles but the scene has none.`, false));
  } else if ((rules.targetScore || 0) > total) {
    issues.push(issue('rules.target-unreachable', 'error', `targetScore ${rules.targetScore} exceeds the ${total} points available.`, true));
  }
}

function verifyCommon(spec: SceneSpec, issues: VerificationIssue[], opts: VerifyOptions) {
  for (const [label, list] of [['actor', spec.actors], ['node2D', spec.nodes2D], ['vfx', spec.vfx]] as const) {
    const seen = new Set<string>();
    for (const item of (list || []) as Array<{ id: string }>) {
      if (seen.has(item.id)) issues.push(issue('ids.duplicate', 'error', `Duplicate ${label} id "${item.id}".`, true, item.id));
      seen.add(item.id);
    }
  }
  const duration = Math.max(0.1, spec.durationSeconds || 0);
  for (const item of [...(spec.actors || []), ...(spec.vfx || [])] as Array<{ id: string; name: string; startTime?: number; endTime?: number }>) {
    const s = item.startTime;
    const e = item.endTime;
    if ((s !== undefined && (s < 0 || s > duration)) || (s !== undefined && e !== undefined && e <= s)) {
      issues.push(issue('timing.invalid', 'warning', `"${item.name}" has an invalid time window (${s ?? '-'}s → ${e ?? '-'}s, duration ${duration}s).`, true, item.id));
    }
  }
  const overlay = spec.marketingOverlay;
  if (overlay?.enabled && !String(overlay.ctaText || '').trim()) {
    issues.push(issue('cta.missing-text', 'warning', 'Marketing overlay is enabled but ctaText is empty.', true));
  }
  if (spec.audio) {
    for (const [event, cue] of Object.entries(spec.audio.cues || {})) {
      if (cue && cue !== 'none' && !(SFX_PRESET_IDS as string[]).includes(cue) && !spec.sfxLibrary?.[cue]) {
        issues.push(issue('audio.unknown-cue', 'warning', `Audio cue "${event}" uses unknown preset "${cue}".`, true));
      }
    }
  }
  for (const c of spec.captions || []) {
    if (!(c.end > c.start) || c.start < 0 || c.start >= duration || !String(c.text || '').trim()) {
      issues.push(issue('captions.invalid', 'warning', `Caption "${String(c.text || '').slice(0, 30)}" has an invalid time window or empty text (${c.start}s → ${c.end}s).`, true, c.id));
    }
  }
  const next = spec.sequence?.nextSceneId;
  if (next && opts.scenes && !opts.scenes.some((s) => s.id === next)) {
    issues.push(issue('sequence.next-missing', 'error', `sequence.nextSceneId "${next}" does not exist in the storyboard.`, true));
  }
}

export function verifySceneSpec(spec: SceneSpec, opts: VerifyOptions = {}): VerificationReport {
  const issues: VerificationIssue[] = [];
  verifyCommon(spec, issues, opts);
  if (spec.engineType === '2d') verify2D(spec, issues);
  else verify3D(spec, issues);
  verifyMedia(spec, issues);
  verifySoundtrack(spec, issues);
  verifyDialogue(spec, issues);
  verifyWorldFeatures(spec, issues);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

// ---------------------------------------------------------------------------
// Deterministic auto-fix
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function makeGround(): Node2D {
  return {
    id: `node2d-ground-${Math.random().toString(36).slice(2, 7)}`,
    name: 'Ground (auto-fix)',
    type: 'tile-platform',
    x: 500,
    y: 570,
    width: 1000,
    height: 40,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    fill: '#334155',
    stroke: '#64748B',
    physics2D: 'static-platform',
  };
}

function makePlayer2D(): Node2D {
  return {
    id: `node2d-player-${Math.random().toString(36).slice(2, 7)}`,
    name: 'Hero (auto-fix)',
    type: 'sprite-actor',
    x: 90,
    y: 480,
    width: 44,
    height: 56,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    fill: '#22D3EE',
    stroke: '#0E7490',
    shapeKind: 'capsule',
    physics2D: 'player-platformer',
  };
}

function applyFix(spec: SceneSpec, i: VerificationIssue, opts: VerifyOptions): string | null {
  switch (i.code) {
    case 'media.performance-invalid': {
      const a = spec.actors.find((x) => x.id === i.targetId);
      if (!a?.performance) return null;
      const duration = Math.max(1, spec.durationSeconds || 8);
      a.performance = a.performance
        .filter((st) => Number.isFinite(st.time))
        .map((st) => {
          const next = { ...st, time: clamp(st.time, 0, duration) };
          if (next.ease !== undefined && !isEaseId(next.ease)) delete next.ease;
          if (next.moveTo !== undefined) {
            if (!Array.isArray(next.moveTo) || next.moveTo.length !== 3 || next.moveTo.some((v) => !Number.isFinite(v))) delete next.moveTo;
            else next.moveTo = [clamp(next.moveTo[0], -STAGE_3D, STAGE_3D), next.moveTo[1], clamp(next.moveTo[2], -STAGE_3D, STAGE_3D)];
          }
          return next;
        });
      return `Clamped "${a.name}" performance to the scene`;
    }
    case 'media.performance-clip': {
      const a = spec.actors.find((x) => x.id === i.targetId);
      if (!a?.performance) return null;
      for (const st of a.performance) {
        if (st.clip && !isClip(a, st.clip)) delete st.clip;
        if (st.arriveClip && !isClip(a, st.arriveClip)) delete st.arriveClip;
      }
      return `Removed clips "${a.name}" does not have`;
    }
    case 'media.lookat-missing': {
      const a = spec.actors.find((x) => x.id === i.targetId);
      const ids = new Set(spec.actors.map((x) => x.id));
      for (const st of a?.performance || []) if (typeof st.lookAt === 'string' && !ids.has(st.lookAt)) delete st.lookAt;
      return a ? `Dropped lookAt targets that are not actors ("${a.name}")` : null;
    }
    case 'media.shot-invalid': {
      const duration = Math.max(1, spec.durationSeconds || 8);
      const ids = new Set(spec.actors.map((x) => x.id));
      spec.camera.shots = (spec.camera.shots || [])
        .filter((sh) => SHOT_TYPES.includes(sh.type) && Number.isFinite(sh.start) && sh.start < duration)
        .map((sh) => ({ ...sh, start: Math.max(0, sh.start), subject: sh.subject && ids.has(sh.subject) ? sh.subject : undefined, partner: sh.partner && ids.has(sh.partner) ? sh.partner : undefined }));
      return 'Removed / repaired invalid camera shots';
    }
    case 'dialogue.invalid': {
      const duration = Math.max(1, spec.durationSeconds || 8);
      const ids = new Set([...spec.actors.map((a) => a.id), ...(spec.nodes2D || []).map((n) => n.id)]);
      spec.dialogue = (spec.dialogue || [])
        .filter((l) => l && typeof l.text === 'string' && l.text.trim() && ids.has(l.speaker) && Number.isFinite(l.time) && l.time < duration)
        .map((l) => {
          const next = { ...l, time: Math.max(0, l.time) };
          if (next.emotion !== undefined && !DIALOGUE_EMOTIONS.includes(next.emotion)) delete next.emotion;
          if (next.listener !== undefined && !ids.has(next.listener)) delete next.listener;
          return next;
        });
      return 'Repaired dialogue lines (speakers, times, emotions)';
    }
    case 'dialogue.overlap': {
      // Push every line to start after the previous one ends (keeps the order the author wrote).
      const timeline = dialogueTimeline(spec);
      let free = 0;
      const shifted = new Map<string, number>();
      for (const t of timeline) {
        const start = Math.max(t.start, free);
        shifted.set(t.line.id, Math.round(start * 100) / 100);
        free = start + (t.end - t.start) + 0.2;
      }
      spec.dialogue = (spec.dialogue || []).map((l) => (shifted.has(l.id) ? { ...l, time: shifted.get(l.id)! } : l));
      return 'Spaced out overlapping dialogue lines';
    }
    case 'dialogue.cut-off': {
      const duration = Math.max(1, spec.durationSeconds || 8);
      const line = (spec.dialogue || []).find((l) => l.id === i.targetId);
      if (!line) return null;
      const t = dialogueTimeline({ ...spec, durationSeconds: 1e9 }).find((x) => x.line.id === line.id);
      const len = t ? t.end - t.start : 1;
      if (len + 0.2 <= duration) line.time = Math.round(Math.max(0, duration - len - 0.2) * 100) / 100;
      else spec.durationSeconds = Math.min(30, Math.ceil(line.time + len + 0.5));
      return `Moved "${line.text.slice(0, 30)}" so it is heard to the end`;
    }
    case 'soundtrack.invalid': {
      const st = spec.soundtrack;
      if (!st) return null;
      const duration = Math.max(1, spec.durationSeconds || 8);
      if (st.music && !MUSIC_MOODS.includes(st.music.mood)) st.music = { ...st.music, mood: 'calm' };
      if (st.ambience && !AMBIENCE_IDS.includes(st.ambience.type)) st.ambience = { ...st.ambience, type: 'auto' };
      if (st.cues) st.cues = st.cues.filter((c) => c && Number.isFinite(c.time) && c.time >= 0 && c.time < duration &&
        ((SFX_PRESET_IDS as string[]).includes(c.sfx) || !!spec.sfxLibrary?.[c.sfx]));
      return 'Repaired the soundtrack (mood / ambience / cues)';
    }
    case 'world.biome-invalid':
      delete spec.world.biome;
      return 'Removed the unknown biome';
    case 'world.feature-invalid':
      spec.world.features = (spec.world.features || []).filter((f) => f && f.id !== i.targetId);
      return 'Removed an invalid world feature';
    case 'world.feature-on-stage': {
      const f = (spec.world.features || []).find((x) => x.id === i.targetId);
      if (!f) return null;
      // Push the landmark straight away from the stage centre until it clears the acting area.
      const len = Math.hypot(f.position[0], f.position[2]);
      const dir: [number, number] = len > 0.01 ? [f.position[0] / len, f.position[2] / len] : [0, -1];
      for (let d = Math.max(len, 1); d < 60; d += 1) {
        f.position = [dir[0] * d, f.position[1], dir[1] * d];
        if (featureStageClearance(f) >= FEATURE_STAGE_CLEARANCE) break;
      }
      return `Moved the ${f.type} off the stage`;
    }
    case 'media.transition-invalid':
      if (spec.sequence) spec.sequence.transition = 'fade';
      return 'Scene transition set to fade';
    case 'ids.duplicate': {
      for (const list of [spec.actors, spec.nodes2D, spec.vfx] as Array<Array<{ id: string }>>) {
        const seen = new Set<string>();
        let n = 0;
        for (const item of list || []) {
          if (seen.has(item.id)) item.id = `${item.id}-dup${++n}`;
          seen.add(item.id);
        }
      }
      return 'Renamed duplicate ids';
    }
    case 'timing.invalid': {
      const duration = Math.max(0.1, spec.durationSeconds || 0);
      for (const item of [...spec.actors, ...spec.vfx] as Array<{ id: string; startTime?: number; endTime?: number }>) {
        if (item.id !== i.targetId) continue;
        item.startTime = clamp(item.startTime ?? 0, 0, Math.max(0, duration - 0.5));
        if (item.endTime !== undefined && item.endTime <= item.startTime) item.endTime = Math.min(duration, item.startTime + 1);
      }
      return `Clamped time window of ${i.targetId}`;
    }
    case 'cta.missing-text':
      spec.marketingOverlay.ctaText = 'Play Now';
      return 'Set CTA text to "Play Now"';
    case 'audio.unknown-cue':
      if (spec.audio) {
        for (const [event, cue] of Object.entries(spec.audio.cues)) {
          if (cue && cue !== 'none' && !(SFX_PRESET_IDS as string[]).includes(cue) && !spec.sfxLibrary?.[cue]) delete (spec.audio.cues as any)[event];
        }
      }
      return 'Removed unknown audio cues (defaults apply)';
    case 'keyframe.unknown-ease':
      for (const n of spec.nodes2D || []) for (const k of n.keyframeTrack || []) if (k.ease && !isEaseId(k.ease)) delete k.ease;
      for (const k of spec.camera?.keyframes || []) if (k.ease && !isEaseId(k.ease)) delete k.ease;
      return 'Reset unknown easings to linear';
    case '2d.unknown-particle': {
      const n = spec.nodes2D.find((x) => x.id === i.targetId);
      if (!n) return null;
      n.emitter = { ...(n.emitter || {}), preset: 'sparkle' } as Node2D['emitter'];
      return `Reset "${n.name}" particle preset to sparkle`;
    }
    case '2d.invalid-spritesheet': {
      const n = spec.nodes2D.find((x) => x.id === i.targetId);
      if (!n) return null;
      delete n.spriteSheet;
      return `Removed invalid spriteSheet from "${n.name}"`;
    }
    case 'captions.invalid': {
      const duration = Math.max(0.1, spec.durationSeconds || 0);
      spec.captions = (spec.captions || [])
        .filter((c) => String(c.text || '').trim() && c.start >= 0 && c.start < duration)
        .map((c) => (c.end > c.start ? c : { ...c, end: Math.min(duration, c.start + 2) }));
      return 'Repaired caption time windows';
    }
    case 'sequence.next-missing':
      if (spec.sequence) {
        const idx = opts.scenes?.findIndex((s) => s.id === spec.id) ?? -1;
        spec.sequence.nextSceneId = idx >= 0 ? opts.scenes?.[idx + 1]?.id : undefined;
      }
      return 'Relinked sequence.nextSceneId';
    case '2d.out-of-bounds': {
      const n = spec.nodes2D.find((x) => x.id === i.targetId);
      if (!n) return null;
      n.x = clamp(n.x, 20, STAGE_W - 20);
      n.y = clamp(n.y, 20, STAGE_H - 20);
      return `Moved "${n.name}" back inside the stage`;
    }
    case '2d.no-player':
      spec.nodes2D.push(makePlayer2D());
      return 'Added a platformer hero';
    case '2d.player-no-ground': {
      spec.nodes2D.push(makeGround());
      const player = spec.nodes2D.find((n) => n.id === i.targetId);
      if (player && player.y > 520) player.y = 480;
      return 'Added a full-width ground platform under the player';
    }
    case '2d.collectible-unreachable': {
      const c = spec.nodes2D.find((n) => n.id === i.targetId);
      const player = spec.nodes2D.find(isPlayer2D);
      if (!c || !player) return null;
      const { reachable } = reachableSurfaces(player, visible(spec.nodes2D).filter((n) => n.physics2D === 'static-platform'));
      const target = [...reachable].sort(
        (a, b) => Math.hypot(clamp(c.x, a.left, a.right) - c.x, a.top - c.y) - Math.hypot(clamp(c.x, b.left, b.right) - c.x, b.top - c.y)
      )[0];
      if (!target) return null;
      c.x = clamp(c.x, target.left + 20, target.right - 20);
      c.y = target.top - 70;
      return `Moved "${c.name}" onto a reachable platform`;
    }
    case '3d.collectible-out-of-arena': {
      const a = spec.actors.find((x) => x.id === i.targetId);
      if (!a) return null;
      a.position = [clamp(a.position[0], -5, 5), a.position[1], clamp(a.position[2], -5, 5)];
      return `Moved "${a.name}" inside the player arena`;
    }
    case 'camera.follow-missing':
      spec.camera.followActorId = spec.actors.find((a) => a.physicsRole === 'player')?.id;
      return 'Re-targeted camera follow to the player';
    case 'rules.missing':
      spec.gameRules = { winCondition: 'score-threshold', targetScore: 100, timeLimitSeconds: 60, instructions: 'Collect items to win!' };
      return 'Added default gameRules';
    case 'rules.time-limit':
      spec.gameRules.timeLimitSeconds = 60;
      return 'Set time limit to 60s';
    case 'rules.target-unreachable': {
      const values =
        spec.engineType === '2d'
          ? visible(spec.nodes2D).filter((n) => n.physics2D === 'collectible').map((n) => n.scoreValue ?? DEFAULT_SCORE)
          : visible(spec.actors).filter((a) => a.physicsRole === 'collectible' || clickCollects(a)).map((a) => a.scoreValue ?? DEFAULT_SCORE);
      const total = values.reduce((s, v) => s + Math.max(0, v), 0);
      spec.gameRules.targetScore = total;
      return `Lowered targetScore to the ${total} points available`;
    }
    default:
      return null;
  }
}

export interface AutoFixResult {
  spec: SceneSpec;
  fixes: string[];
  report: VerificationReport;
}

/** Applies every deterministic fix (up to 3 passes) and returns the re-verified spec. Input is not mutated. */
export function autoFixSceneSpec(input: SceneSpec, opts: VerifyOptions = {}): AutoFixResult {
  const spec: SceneSpec = JSON.parse(JSON.stringify(input));
  spec.nodes2D = spec.nodes2D || [];
  spec.actors = spec.actors || [];
  spec.vfx = spec.vfx || [];
  const fixes: string[] = [];
  let report = verifySceneSpec(spec, opts);
  for (let pass = 0; pass < 3 && report.issues.some((i) => i.fixable); pass++) {
    const done = new Set<string>();
    for (const i of report.issues.filter((x) => x.fixable)) {
      const key = `${i.code}:${i.targetId ?? ''}`;
      if (done.has(key)) continue;
      done.add(key);
      const note = applyFix(spec, i, opts);
      if (note) fixes.push(note);
    }
    const next = verifySceneSpec(spec, opts);
    const progressed = next.issues.length < report.issues.length;
    report = next;
    if (!progressed) break;
  }
  return { spec, fixes, report };
}

/** Compact, model-friendly description of the remaining problems (used for the AI repair round). */
export function describeIssuesForAgent(report: VerificationReport): string {
  return report.issues
    .map((i) => `- [${i.severity.toUpperCase()} ${i.code}]${i.targetId ? ` (${i.targetId})` : ''} ${i.message}`)
    .join('\n');
}
