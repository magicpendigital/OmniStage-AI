/**
 * Phase 5 (Director F) — game eval: a deterministic score for a generated game (a prompt's levels), so a change to the director,
 * the kits or the runtime shows up as a number. It does not judge looks. Each level is verified and played by the playtest bot.
 *
 *   verifier    30   no verifier errors, few warnings
 *   winnable    40   a bot can beat the level (proof), not just reach it
 *   engagement  20   something happens within seconds, the level does not play itself, nobody gets boxed in
 *   pacing      10   the bot is not out of time at the end, and is not set back again and again
 *
 * 3D levels cannot be played by the 2D bot: they count for the verifier and are listed as `unplayed` (not penalised in winnable).
 * Pure and deterministic; the bot never uses `Date` or `Math.random`.
 */
import type { SceneSpec } from '../types/scene.schema';
import { verifySceneSpec } from '../verification/sceneVerifier';
import { playtestScene } from '../playtest/bot2d';
import { buildLocalSceneForBeat, buildLocalStoryboardPlan, detectStoryboardIntent } from './storyboardAgent';
import { checkScene } from './tools/sceneTools';

export const GAME_EVAL_WEIGHTS = {
  verifier: { label: 'Verifier health', weight: 30 },
  winnable: { label: 'Winnable by a bot', weight: 40 },
  engagement: { label: 'Engagement', weight: 20 },
  pacing: { label: 'Pacing', weight: 10 },
} as const;
export type GameEvalDimensionId = keyof typeof GAME_EVAL_WEIGHTS;

export interface GameEvalLevel {
  id: string;
  title: string;
  engineType: string;
  verifierErrors: number;
  verifierWarnings: number;
  /** 'unplayed' = the bot cannot play this scene (3D, media). */
  outcome: 'won' | 'not-won' | 'unplayed';
  /** Playtest issue codes (warnings and info). */
  playtestIssues: string[];
  /** Seconds of the winning run (or the best run). */
  seconds?: number;
}

export interface GameEvalDimension {
  id: GameEvalDimensionId;
  label: string;
  weight: number;
  score: number;
  notes: string[];
}

export interface GameEvalReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  levels: GameEvalLevel[];
  dimensions: GameEvalDimension[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function gameGrade(score: number): GameEvalReport['grade'] {
  return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
}

const ENGAGEMENT_CODES = ['playtest.slow-start', 'playtest.nothing-happens', 'playtest.player-immobile', 'playtest.wins-without-input', 'playtest.stuck'];
const PACING_CODES = ['playtest.time-tight', 'playtest.punishing'];

export function evaluateGame(input: { scenes: SceneSpec[] }): GameEvalReport {
  const scenes = input.scenes.filter((s) => s && typeof s === 'object');
  const levels: GameEvalLevel[] = scenes.map((spec) => {
    const verified = verifySceneSpec(spec, { scenes });
    const report = playtestScene(spec);
    const played = report.supported && report.outcome !== 'unsupported';
    return {
      id: spec.id,
      title: spec.title,
      engineType: spec.engineType,
      verifierErrors: verified.errors,
      verifierWarnings: verified.warnings,
      outcome: !played ? 'unplayed' : report.outcome === 'won' ? 'won' : 'not-won',
      playtestIssues: report.issues.map((i) => i.code),
      seconds: report.best?.seconds,
    };
  });

  const played = levels.filter((l) => l.outcome !== 'unplayed');
  const dimension = (id: GameEvalDimensionId, score: number, notes: string[]): GameEvalDimension => ({ id, ...GAME_EVAL_WEIGHTS[id], score: clamp(score), notes });

  const verifier = levels.length
    ? dimension(
        'verifier',
        levels.reduce((n, l) => n + clamp(100 - l.verifierErrors * 35 - Math.min(30, l.verifierWarnings * 5)), 0) / levels.length,
        levels.filter((l) => l.verifierErrors > 0).map((l) => `${l.title}: ${l.verifierErrors} verifier error(s)`)
      )
    : dimension('verifier', 0, ['no levels']);

  const winnable = played.length
    ? dimension(
        'winnable',
        (played.filter((l) => l.outcome === 'won').length / played.length) * 100,
        played.filter((l) => l.outcome === 'not-won').map((l) => `${l.title}: no bot won it`)
      )
    : dimension('winnable', 0, levels.length ? ['no level could be played by the bot (3D or media)'] : ['no levels']);

  const share = (codes: string[], levelsOf: GameEvalLevel[]) => {
    if (!levelsOf.length) return { score: 0, notes: [] as string[] };
    const notes: string[] = [];
    let total = 0;
    for (const l of levelsOf) {
      const hits = l.playtestIssues.filter((c) => codes.includes(c));
      total += 100 - Math.min(100, hits.length * 40);
      if (hits.length) notes.push(`${l.title}: ${hits.join(', ')}`);
    }
    return { score: total / levelsOf.length, notes };
  };
  const engagement = share(ENGAGEMENT_CODES, played);
  const pacing = share(PACING_CODES, played);

  const dimensions = [verifier, winnable, dimension('engagement', engagement.score, engagement.notes), dimension('pacing', pacing.score, pacing.notes)];
  const score = clamp(dimensions.reduce((n, d) => n + d.score * d.weight, 0) / 100);
  return { score, grade: gameGrade(score), levels, dimensions };
}

/** Per-dimension and total change between two reports (positive = better). */
export function compareGameReports(previous: GameEvalReport, next: GameEvalReport): { score: number; dimensions: Record<GameEvalDimensionId, number> } {
  const dimensions = {} as Record<GameEvalDimensionId, number>;
  for (const id of Object.keys(GAME_EVAL_WEIGHTS) as GameEvalDimensionId[]) {
    dimensions[id] = (next.dimensions.find((d) => d.id === id)?.score ?? 0) - (previous.dimensions.find((d) => d.id === id)?.score ?? 0);
  }
  return { score: next.score - previous.score, dimensions };
}

/**
 * The levels the offline director (no AI key) builds for a prompt, after the shared check every edit path uses (logic graph repair, auto-fix),
 * i.e. the state the studio ships. null when the prompt is not a multi-level game request.
 */
export function offlineGameLevels(prompt: string): SceneSpec[] | null {
  const intent = detectStoryboardIntent(prompt);
  if (!intent || intent.kind !== 'game-levels') return null;
  const plan = buildLocalStoryboardPlan(prompt, intent);
  return plan.beats.map((_, i) => checkScene(buildLocalSceneForBeat(prompt, plan, i)).spec);
}
