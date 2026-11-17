/**
 * Phase 11E — vision QA of a CUT: the last frame of scene A beside the first frame of scene B, judged like an editor at the
 * moving table ("does this cut work?"). Complements the deterministic cut lint (`filmEditor.ts`), which cannot see pictures:
 * it catches a character that changes size / side / colour, a lighting or time-of-day jump, a screen-direction flip, a cut
 * between two near-identical frames. Findings are reported as editor notes only; a taste call is never auto-applied.
 *
 * Pure module (no React, no fetch, no DOM): the prompt builders are shared with the server (`/api/agent/vision-qa`, mode "cut"),
 * the capture lives in `src/media/directorKeyframes.ts` and the runner in `directorQARunner.ts`.
 */
import type { SceneSpec } from '../types/scene.schema';

export type CutQAKind = 'continuity' | 'screen-direction' | 'lighting' | 'scale' | 'jump-cut' | 'graphic-match' | 'pacing';
export const CUT_QA_KINDS: CutQAKind[] = ['continuity', 'screen-direction', 'lighting', 'scale', 'jump-cut', 'graphic-match', 'pacing'];

export interface CutQAFinding {
  severity: 'high' | 'medium' | 'low';
  kind: CutQAKind;
  /** What is wrong, as the editor would say it. */
  title: string;
  /** What to change: a different shot, a transition, a lighting preset. */
  fix: string;
}

export interface CutQAReport {
  /** 0..100: how well the cut works. */
  score: number;
  summary: string;
  findings: CutQAFinding[];
  provider?: string;
  model?: string;
}

/** A cut scoring under this is worth a note. */
export const CUT_QA_NOTE_THRESHOLD = 75;
const MAX_FINDINGS = 5;

/** The two moments that are compared: a hair before A ends, and just after B begins (the scene has settled). */
export function cutFrameTimes(a: Pick<SceneSpec, 'durationSeconds'>, b: Pick<SceneSpec, 'durationSeconds'>): { outTime: number; inTime: number } {
  const da = a.durationSeconds || 5;
  const db = b.durationSeconds || 5;
  return { outTime: Math.max(0, Math.round((da - 0.15) * 100) / 100), inTime: Math.min(0.25, Math.max(0, db - 0.1)) };
}

export function buildCutQASystemPrompt(): string {
  return `You are the film editor at the cutting table. You receive ONE image: two frames side by side.
LEFT = the last frame of the outgoing scene (A). RIGHT = the first frame of the incoming scene (B). The cut goes from LEFT to RIGHT.
Judge only what you can SEE, like an editor deciding whether the cut works:
- continuity: the same character keeps the same look, size, colour and position when both scenes show them; props and set stay put when it is the same place.
- screen-direction: characters / motion keep the same side of the frame (180-degree rule); no unmotivated flip.
- lighting: time of day, colour temperature and brightness do not jump unless the story says time passed.
- scale: the two frames are not a near-identical shot (jump cut) and not an extreme size jump without a reason.
- jump-cut: same subject, almost the same framing, a visible pop.
- graphic-match: shapes, colours or motion that line up across the cut (a good thing: score it up).
- pacing: an empty or cluttered frame that makes the cut feel dead.
Score 0-100 (90+ = clean cut, 75-89 = fine with notes, under 75 = the editor would stop and fix it).
Each fix is a concrete change (a different shot size or angle for B, a cross-dissolve or fade between the scenes, matching the lighting preset, keeping the character on the same side). Never ask to change the story or the dialogue.
Reply with JSON only.`;
}

const brief = (s: SceneSpec) =>
  `${s.title}${s.sequence ? ` (scene ${s.sequence.index + 1}/${s.sequence.total})` : ''}: ${(s.sequence?.beat || '').slice(0, 200)} · lighting ${s.environment?.presetId || 'default'} · ${s.actors.map((a) => a.name || a.id).slice(0, 6).join(', ') || 'no actors'}`;

export function buildCutQAUserPrompt(a: SceneSpec, b: SceneSpec): string {
  const transition = b.sequence?.transition || 'cut';
  const { outTime, inTime } = cutFrameTimes(a, b);
  return `LEFT (A, last frame at ${outTime}s): ${brief(a)}
RIGHT (B, first frame at ${inTime}s): ${brief(b)}
Transition between them: ${transition}${transition === 'cut' ? ' (a hard cut)' : ''}

Return JSON:
{
  "score": 0-100,
  "summary": "one sentence: does the cut work and why",
  "findings": [
    { "severity": "high" | "medium" | "low", "kind": "${CUT_QA_KINDS.join('" | "')}", "title": "short problem", "fix": "concrete change" }
  ]
}
At most ${MAX_FINDINGS} findings, most important first. An empty list is fine for a clean cut.`;
}

/** Validates the model's answer. Returns null when it holds no usable score. */
export function normalizeCutQAReport(raw: any): CutQAReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawScore = Number(raw.score ?? raw.overallScore);
  if (!Number.isFinite(rawScore)) return null;
  const score = Math.round(Math.max(0, Math.min(100, rawScore <= 10 && rawScore % 1 !== 0 ? rawScore * 10 : rawScore)));
  const list = Array.isArray(raw.findings) ? raw.findings : Array.isArray(raw.issues) ? raw.issues : [];
  const findings: CutQAFinding[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const title = String(f.title ?? f.problem ?? '').trim().slice(0, 160);
    const fix = String(f.fix ?? f.suggestion ?? '').trim().slice(0, 300);
    if (!title && !fix) continue;
    findings.push({
      severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
      kind: CUT_QA_KINDS.includes(f.kind ?? f.category) ? (f.kind ?? f.category) : 'continuity',
      title: title || fix.slice(0, 80),
      fix: fix || title,
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((x, y) => order[x.severity] - order[y.severity]);
  return { score, summary: String(raw.summary ?? '').trim().slice(0, 400), findings };
}

/** Editor notes for the storyboard summary. Empty when the cut is clean (a good score with no findings says nothing). */
export function describeCutQA(index: number, report: CutQAReport | null, threshold = CUT_QA_NOTE_THRESHOLD): string[] {
  if (!report) return [];
  const worth = report.score < threshold || report.findings.some((f) => f.severity === 'high');
  if (!worth) return [];
  const head = `Editor, cut ${index}→${index + 1} (vision ${report.score}/100): ${report.summary || 'check this cut'}`;
  return [head, ...report.findings.slice(0, 3).map((f) => `  · [${f.severity}][${f.kind}] ${f.title} → ${f.fix}`)];
}
