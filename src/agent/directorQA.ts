/**
 * Phase 10D — vision-model "director QA" for film shots.
 *
 * The studio renders a few keyframes of a shot on the real OmniStage Player (one per camera shot, see
 * `src/media/directorKeyframes.ts`), tiles them into one contact sheet and sends it with a compact scene summary to a
 * vision-capable connection (`/api/agent/vision-qa`, mode "director"). The model scores the shot like a film director
 * (framing, staging, acting, lighting, continuity). When the score is under the threshold, the findings drive ONE extra
 * JSON Patch round through the normal tool-use loop (`runPatchLoop`), which still applies, auto-fixes and verifies every
 * edit and never accepts a round that makes verification worse.
 *
 * Pure module (no React, no store, no fetch): prompt builders are shared with the server, the browser parts are injected.
 */
import type { SceneSpec, VerificationReport } from '../types/scene.schema';
import { PatchCheck, PatchProposal, PatchTurn, runPatchLoop } from './patchLoop';

export type DirectorQACategory = 'framing' | 'composition' | 'staging' | 'acting' | 'lighting' | 'continuity' | 'readability';
export const DIRECTOR_QA_CATEGORIES: DirectorQACategory[] = ['framing', 'composition', 'staging', 'acting', 'lighting', 'continuity', 'readability'];

export interface DirectorKeyframe {
  /** Seconds from the scene start. */
  time: number;
  /** 0-based index into camera.shots, when the scene has a shot list. */
  shotIndex?: number;
  /** Short caption drawn on the tile and repeated in the prompt, e.g. "close-up on fox". */
  label: string;
}

export interface DirectorQAFinding {
  severity: 'high' | 'medium' | 'low';
  category: DirectorQACategory;
  /** 1-based keyframe (tile) number the finding refers to. */
  keyframe?: number;
  /** Actor id or other SceneSpec id the fix should touch. */
  targetId?: string;
  title: string;
  /** Concrete SceneSpec-level change, e.g. "make shot 2 a medium shot from three-quarter-left". */
  fix: string;
}

export interface DirectorQAReport {
  /** 0..100 */
  score: number;
  summary: string;
  findings: DirectorQAFinding[];
  keyframes: DirectorKeyframe[];
  provider?: string;
  model?: string;
}

/** Shots scoring below this get the extra patch round. */
export const DIRECTOR_QA_THRESHOLD = 70;
export const DIRECTOR_QA_MAX_KEYFRAMES = 4;
const MAX_FINDINGS = 8;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Contact-sheet layout shared by the capture and the prompt: tiles in reading order, 2 columns. */
export function contactSheetLayout(count: number): { cols: number; rows: number } {
  const cols = count <= 1 ? 1 : 2;
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

export function tilePosition(index: number, count: number): string {
  const { cols, rows } = contactSheetLayout(count);
  if (cols === 1) return 'full frame';
  const r = Math.floor(index / cols);
  const c = index % cols;
  const vert = rows === 1 ? '' : r === 0 ? 'top' : r === rows - 1 ? 'bottom' : `row ${r + 1}`;
  return `${vert ? `${vert}-` : ''}${c === 0 ? 'left' : 'right'}`;
}

/**
 * Times worth judging: the middle of each camera shot (shots are what a director reviews), sampled evenly when a scene
 * has more shots than tiles. Without a shot list: evenly through the scene.
 */
export function pickDirectorKeyframes(spec: Pick<SceneSpec, 'durationSeconds' | 'camera' | 'actors'>, max = DIRECTOR_QA_MAX_KEYFRAMES): DirectorKeyframe[] {
  const duration = Math.max(1, spec.durationSeconds || 5);
  const clampT = (t: number) => round1(Math.min(duration - 0.05, Math.max(0.05, t)));
  const limit = Math.max(1, Math.min(8, Math.floor(max)));
  const shots = [...(spec.camera?.shots || [])]
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => Number.isFinite(s.start) && s.start < duration)
    .sort((a, b) => a.s.start - b.s.start);
  const name = (id?: string) => (id ? spec.actors.find((a) => a.id === id)?.name || id : '');
  if (shots.length) {
    const picks = shots.length <= limit ? shots : Array.from({ length: limit }, (_, k) => shots[Math.round((k * (shots.length - 1)) / Math.max(1, limit - 1))]);
    const out: DirectorKeyframe[] = [];
    for (const { s, index } of picks) {
      const pos = shots.findIndex((x) => x.index === index);
      const end = Number.isFinite(s.end) && (s.end as number) > s.start ? (s.end as number) : shots[pos + 1]?.s.start ?? duration;
      const subject = name(s.subject);
      out.push({ time: clampT((s.start + Math.min(end, duration)) / 2), shotIndex: index, label: `${s.type}${subject ? ` on ${subject}` : ''}${s.move && s.move !== 'static' ? `, ${s.move}` : ''}` });
    }
    // Two shots can share a midpoint after clamping: keep one tile per time.
    return out.filter((k, i) => out.findIndex((o) => o.time === k.time) === i);
  }
  const n = Math.min(limit, duration < 3 ? 2 : 3);
  return Array.from({ length: n }, (_, k) => ({ time: clampT(((k + 0.5) / n) * duration), label: `moment ${k + 1}` }));
}

export function buildDirectorQASystemPrompt(): string {
  return `You are the film director reviewing rendered frames of one shot made in OmniStage (a declarative 3D film studio).
You receive ONE contact-sheet image: numbered tiles, each a frame of the same scene at a given time, plus the scene summary.
Judge it like a director at a dailies screening, frame by frame:
- framing: is the subject in frame, sensible headroom, not cut off at joints, the shot type matches its label?
- composition: rule of thirds / balance, eyelines leading into the frame, clutter or empty frames.
- staging: actors overlapping or intersecting, floating or sunk into the ground, blocking that hides the subject.
- acting: characters face whom they talk to, poses read clearly, the hero visibly does something.
- lighting: subject readable, enough contrast between subject and background, mood fits the beat.
- continuity: frames tell the beat described; screen direction and 180-degree line kept across cuts.
- readability: would a viewer understand what happens from these frames alone?
Score 0-100 (90+ = ready to ship, 70-89 = acceptable with notes, under 70 = needs another pass).
Only report problems you can SEE in the frames; each fix must be a concrete SceneSpec change (camera.shots type/angle/move/subject/fov,
actor position/rotation/performance, environment lighting preset or colors). Never ask to change dialogue text or the story.
Reply with JSON only.`;
}

/** Compact, image-free description of the shot so the model can map what it sees to SceneSpec ids. */
export function summarizeShotForDirector(spec: SceneSpec): string {
  const actors = spec.actors.slice(0, 16).map((a) => `${a.id} "${a.name}" (${a.assetId}) at [${a.position.map((v) => round1(v)).join(', ')}]`);
  const shots = (spec.camera?.shots || []).slice(0, 12).map((s, i) => `${i + 1}. ${s.start}s ${s.type}${s.subject ? ` subject=${s.subject}` : ''}${s.partner ? ` partner=${s.partner}` : ''}${s.angle ? ` angle=${s.angle}` : ''}${s.move ? ` move=${s.move}` : ''}${s.fov ? ` fov=${s.fov}` : ''}`);
  const lines = (spec.dialogue || []).slice(0, 12).map((l) => `${l.time}s ${l.speaker}${l.listener ? `→${l.listener}` : ''}: "${l.text.slice(0, 80)}"`);
  return [
    `Title: ${spec.title}${spec.sequence ? ` (shot ${spec.sequence.index + 1}/${spec.sequence.total} of "${spec.sequence.storyboardTitle}")` : ''}`,
    spec.sequence?.beat ? `Beat: ${spec.sequence.beat.slice(0, 400)}` : '',
    `Duration: ${spec.durationSeconds || 5}s · lighting preset: ${spec.environment?.presetId || 'default'}`,
    `Actors: ${actors.join('; ') || 'none'}`,
    `Shot list: ${shots.length ? `\n${shots.join('\n')}` : 'none (camera mode only)'}`,
    lines.length ? `Dialogue:\n${lines.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export function buildDirectorQAUserPrompt(spec: SceneSpec, keyframes: DirectorKeyframe[]): string {
  const tiles = keyframes.map((k, i) => `Tile ${i + 1} (${tilePosition(i, keyframes.length)}): t=${k.time}s${k.shotIndex !== undefined ? `, shot ${k.shotIndex + 1}` : ''} — ${k.label}`);
  return `CONTACT SHEET TILES:
${tiles.join('\n')}

SCENE:
${summarizeShotForDirector(spec)}

Return JSON:
{
  "score": 0-100,
  "summary": "one or two sentences: what works, what does not",
  "findings": [
    { "severity": "high" | "medium" | "low", "category": "${DIRECTOR_QA_CATEGORIES.join('" | "')}",
      "keyframe": 1, "targetId": "actor or other SceneSpec id (optional)",
      "title": "short problem", "fix": "concrete SceneSpec change" }
  ]
}
At most ${MAX_FINDINGS} findings, most important first. An empty list is fine for a good shot.`;
}

/** Validates the model's answer. Returns null when it holds no usable score. */
export function normalizeDirectorQAReport(raw: any, keyframes: DirectorKeyframe[]): DirectorQAReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawScore = Number(raw.score ?? raw.overallScore);
  if (!Number.isFinite(rawScore)) return null;
  // Some models answer on a 0-10 scale.
  const score = Math.round(Math.max(0, Math.min(100, rawScore <= 10 && rawScore % 1 !== 0 ? rawScore * 10 : rawScore)));
  const list = Array.isArray(raw.findings) ? raw.findings : Array.isArray(raw.issues) ? raw.issues : [];
  const findings: DirectorQAFinding[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const title = String(f.title ?? f.problem ?? '').trim().slice(0, 160);
    const fix = String(f.fix ?? f.suggestedFixSummary ?? f.suggestion ?? '').trim().slice(0, 400);
    if (!title && !fix) continue;
    const severity = ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium';
    const category = DIRECTOR_QA_CATEGORIES.includes(f.category) ? f.category : 'composition';
    const kf = Number(f.keyframe);
    findings.push({
      severity,
      category,
      ...(Number.isInteger(kf) && kf >= 1 && kf <= keyframes.length ? { keyframe: kf } : {}),
      ...(typeof f.targetId === 'string' && /^[A-Za-z0-9_@-]{1,64}$/.test(f.targetId) ? { targetId: f.targetId } : {}),
      title: title || fix.slice(0, 80),
      fix: fix || title,
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    score,
    summary: String(raw.summary ?? '').trim().slice(0, 600),
    findings,
    keyframes,
  };
}

export function needsDirectorRound(report: DirectorQAReport | null, threshold = DIRECTOR_QA_THRESHOLD): boolean {
  return !!report && report.score < threshold && report.findings.length > 0;
}

/** The instruction for the extra patch round: the director's notes, mapped to tiles / shots / ids. */
export function buildDirectorPatchPrompt(report: DirectorQAReport, originalPrompt: string, threshold = DIRECTOR_QA_THRESHOLD): string {
  const notes = report.findings.map((f) => {
    const kf = f.keyframe ? report.keyframes[f.keyframe - 1] : undefined;
    const where = kf ? ` (frame ${f.keyframe} at ${kf.time}s${kf.shotIndex !== undefined ? `, camera.shots[${kf.shotIndex}]` : ''})` : '';
    return `- [${f.severity}][${f.category}]${where}${f.targetId ? ` {${f.targetId}}` : ''} ${f.title} → ${f.fix}`;
  });
  return `DIRECTOR QA — a vision model watched ${report.keyframes.length} rendered frame(s) of this shot and scored it ${report.score}/100 (needs ${threshold}).
${report.summary ? `Director's summary: ${report.summary}\n` : ''}Director's notes:
${notes.join('\n')}

Address these notes with ONE small patch: camera.shots (type, angle, move, subject, partner, fov, start), actor position / rotation /
performance, environment lighting. Keep the story, the dialogue text, scene id and every existing id. Original request: "${originalPrompt.slice(0, 400)}"`;
}

export interface DirectorQARoundOptions {
  spec: SceneSpec;
  /** The user's / storyboard's request, quoted in the patch instruction. */
  prompt: string;
  /** Renders keyframes and asks the vision model. null = no vision connection / capture failed (round skipped). */
  review: (spec: SceneSpec) => Promise<DirectorQAReport | null>;
  propose: (turn: PatchTurn) => Promise<PatchProposal | null>;
  check: (spec: SceneSpec) => PatchCheck;
  threshold?: number;
  /** Patch rounds for the director pass: 1 director patch + 1 verifier repair by default. */
  maxRounds?: number;
  qualityPenalty?: (report: VerificationReport) => number;
  qualityCodes?: string[];
}

export interface DirectorQARoundResult {
  spec: SceneSpec;
  review: DirectorQAReport | null;
  /** True when the director's patch was kept. */
  changed: boolean;
  /** Why no patch round ran / was kept. */
  skipped?: 'unavailable' | 'passed' | 'no-edits' | 'worse';
  diffSummary: string[];
}

/** One director pass: review → (score under threshold) → one patch round driven by the findings. */
export async function runDirectorQARound(opts: DirectorQARoundOptions): Promise<DirectorQARoundResult> {
  const threshold = opts.threshold ?? DIRECTOR_QA_THRESHOLD;
  let review: DirectorQAReport | null = null;
  try {
    review = await opts.review(opts.spec);
  } catch {
    review = null;
  }
  if (!review) return { spec: opts.spec, review: null, changed: false, skipped: 'unavailable', diffSummary: [] };
  if (!needsDirectorRound(review, threshold)) return { spec: opts.spec, review, changed: false, skipped: 'passed', diffSummary: [] };

  const before = opts.check(opts.spec);
  const loop = await runPatchLoop({
    prompt: buildDirectorPatchPrompt(review, opts.prompt, threshold),
    spec: before.spec,
    maxRounds: Math.max(1, opts.maxRounds ?? 2),
    propose: opts.propose,
    check: opts.check,
    qualityPenalty: opts.qualityPenalty,
    qualityCodes: opts.qualityCodes,
  });
  if (!loop || !loop.changed) return { spec: opts.spec, review, changed: false, skipped: 'no-edits', diffSummary: [] };
  // The director's taste never outranks the verifier: a pass that leaves more errors / craft issues is dropped.
  const penalty = (r: VerificationReport) => r.errors * 1000 + (opts.qualityPenalty?.(r) ?? 0);
  if (penalty(loop.report) > penalty(before.report)) return { spec: opts.spec, review, changed: false, skipped: 'worse', diffSummary: [] };
  return {
    // Identity the director must not change.
    spec: { ...loop.spec, id: opts.spec.id, title: opts.spec.title, sequence: opts.spec.sequence, mode: opts.spec.mode, engineType: opts.spec.engineType },
    review,
    changed: true,
    diffSummary: [`Director QA ${review.score}/100 → applied notes`, ...loop.diffSummary],
  };
}

export function describeDirectorReview(report: DirectorQAReport | null, result?: Pick<DirectorQARoundResult, 'changed' | 'skipped'>): string {
  if (!report) return 'Director QA skipped (needs a vision-capable AI connection).';
  const head = `Director QA ${report.score}/100${report.summary ? ` — ${report.summary}` : ''}`;
  if (!result) return head;
  if (result.changed) return `${head} Applied ${report.findings.length} note(s) in one patch round.`;
  if (result.skipped === 'passed') return `${head} Passed.`;
  if (result.skipped === 'worse') return `${head} The director's patch made verification worse, so it was discarded.`;
  return `${head} No edits were made.`;
}
