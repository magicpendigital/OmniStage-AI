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
      if (cue && cue !== 'none' && !(SFX_PRESET_IDS as string[]).includes(cue)) {
        issues.push(issue('audio.unknown-cue', 'warning', `Audio cue "${event}" uses unknown preset "${cue}".`, true));
      }
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
          if (cue && cue !== 'none' && !(SFX_PRESET_IDS as string[]).includes(cue)) delete (spec.audio.cues as any)[event];
        }
      }
      return 'Removed unknown audio cues (defaults apply)';
    case 'keyframe.unknown-ease':
      for (const n of spec.nodes2D || []) for (const k of n.keyframeTrack || []) if (k.ease && !isEaseId(k.ease)) delete k.ease;
      for (const k of spec.camera?.keyframes || []) if (k.ease && !isEaseId(k.ease)) delete k.ease;
      return 'Reset unknown easings to linear';
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
