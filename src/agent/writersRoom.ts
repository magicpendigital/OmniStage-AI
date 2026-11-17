/**
 * Phase 11B — Writers' Room: the story editor of 11A split into a small company with named roles (the way the MCA
 * project runs departments): a lead who plans but does not write, specialists who each own one deliverable, and
 * quality desks that check the work. The user can read every desk, edit its output, lock it, or send it a note.
 *
 *   TEAM Story    showrunner (lead: plans, asks you questions — never writes)
 *                 architect  (logline, hook, stakes, turn, payoff, one beat per scene, motifs)
 *                 dialogue   (the lines of every scene)
 *   TEAM Look     character  (cast: want / flaw / manner / signature gesture / look for a 3D generator)
 *                 world      (where each scene happens, biome, props worth a real model)
 *   TEAM Quality  editor     (independent critique + the 11A rubric; may run on a different AI connection)
 *                 continuity (deterministic rules: speakers exist, props are placed, nobody is forgotten)
 *
 * Order: showrunner → architect → character ∥ world → dialogue → continuity → editor → (one fix round for the desks the
 * editor blames) → review. Everything here is pure; the network call (`ask`) is injected and the SERVER builds the prompts
 * (src/agent/writersRoomPrompts.ts), so the client never sends prompt text.
 */
import type { StoryBible, StoryBibleBeat, StoryCharacter, StoryTemplateId, StoryboardKind } from '../types/scene.schema';
import { lineLanguage } from '../audio/voices';
import { BIOME_IDS } from '../runtime/biomes';
import {
  autoFixStoryBible,
  buildLocalStoryBible,
  characterClips,
  cleanLines,
  deriveLocations,
  lintStoryBible,
  pickStoryTemplate,
  sanitizeStoryBible,
  STORY_BIBLE_PASS_SCORE,
  type BibleIssue,
} from './storyBible';

export type RoomRoleId = 'showrunner' | 'architect' | 'character' | 'world' | 'dialogue' | 'editor' | 'continuity';
export type RoomTeamId = 'story' | 'look' | 'quality';
export type DeskStatus = 'waiting' | 'working' | 'done' | 'needs-you' | 'error';
export type DeskSource = 'ai' | 'local' | 'user' | 'rules' | null;

export interface RoomRole {
  id: RoomRoleId;
  team: RoomTeamId;
  title: string;
  /** One sentence: what this desk owns. */
  mission: string;
  /** lead = plans only; writer = produces a deliverable; critic = judges; checker = deterministic rules. */
  kind: 'lead' | 'writer' | 'critic' | 'checker';
  /** Desks whose output this one reads (re-run when they change). */
  dependsOn: RoomRoleId[];
}

export const ROOM_TEAMS: Record<RoomTeamId, { title: string; blurb: string }> = {
  story: { title: 'Story team', blurb: 'Plans the film and writes what happens and what is said.' },
  look: { title: 'Look team', blurb: 'Decides who is on screen and where it happens (and what a 3D generator should build).' },
  quality: { title: 'Quality team', blurb: 'Checks the work independently before a single scene is produced.' },
};

export const ROOM_ROLES: RoomRole[] = [
  { id: 'showrunner', team: 'story', title: 'Showrunner', kind: 'lead', dependsOn: [], mission: 'Reads your request, picks the story shape, briefs every desk and asks you what only you can answer. Plans, never writes.' },
  { id: 'architect', team: 'story', title: 'Story architect', kind: 'writer', dependsOn: ['showrunner'], mission: 'Writes the spine: logline, hook, stakes, turn, payoff, one beat per scene and the motifs that come back.' },
  { id: 'character', team: 'look', title: 'Character designer', kind: 'writer', dependsOn: ['architect'], mission: 'Casts the film: want, flaw, manner, signature gesture, voice and a look brief a 3D generator can build.' },
  { id: 'world', team: 'look', title: 'Production designer', kind: 'writer', dependsOn: ['architect'], mission: 'Chooses where each scene happens, its biome and the props that deserve a real model.' },
  { id: 'dialogue', team: 'story', title: 'Dialogue writer', kind: 'writer', dependsOn: ['architect', 'character'], mission: 'Writes the few lines each scene needs, in each character’s own voice and in your language.' },
  { id: 'continuity', team: 'quality', title: 'Continuity supervisor', kind: 'checker', dependsOn: ['character', 'world', 'dialogue'], mission: 'Rule-based checks: speakers exist, props are placed, nobody is forgotten, scenes link up.' },
  { id: 'editor', team: 'quality', title: 'Script editor', kind: 'critic', dependsOn: ['architect', 'character', 'world', 'dialogue'], mission: 'Independent second opinion: scores the story with the rubric, names the desk that must fix each problem.' },
];

export const roleById = (id: RoomRoleId): RoomRole => ROOM_ROLES.find((r) => r.id === id)!;
export const WRITER_ORDER: RoomRoleId[] = ['architect', 'character', 'world', 'dialogue'];

export interface RoomDesk {
  role: RoomRoleId;
  status: DeskStatus;
  /** One line shown on the desk card. */
  summary: string;
  /** Short log of what the desk did (fixes, revise rounds, fallbacks). */
  notes: string[];
  /** What you told the desk (used on its next run). */
  userNote: string;
  /** Locked desks are never re-run or overwritten by the room; their output is treated as approved. */
  locked: boolean;
  source: DeskSource;
  revisions: number;
  ms?: number;
  error?: string;
}

export interface RoomFinding extends BibleIssue {
  desk: RoomRoleId;
}

export interface RoomQuestion {
  id: string;
  desk: RoomRoleId;
  text: string;
  answer: string;
}

export type RoomStage = 'briefing' | 'drafting' | 'review' | 'producing';

export interface RoomIntent {
  sceneCount: number;
  kind: StoryboardKind;
  engineType?: '2d' | '3d';
}

export interface WritersRoomSession {
  id: string;
  prompt: string;
  intent: RoomIntent;
  template: StoryTemplateId;
  stage: RoomStage;
  /** A desk is running; the UI disables the actions that would race it. */
  busy: boolean;
  desks: Record<RoomRoleId, RoomDesk>;
  bible: StoryBible;
  /** 0-100: the 11A rubric minus continuity problems (and blended with the editor's own score when it has one). */
  score: number;
  editorScore?: number;
  findings: RoomFinding[];
  questions: RoomQuestion[];
  source: 'ai' | 'local' | 'mixed';
  /** Whether a 3D character generator is connected (adds the "look" requirement to the character desk). */
  generatorConnected: boolean;
}

/** What the server needs to write one desk's prompt. Plain JSON: no prompt text. */
export interface RoomAskRequest {
  desk: Exclude<RoomRoleId, 'showrunner' | 'continuity'>;
  prompt: string;
  intent: RoomIntent;
  template: StoryTemplateId;
  /** The bible as the room has it so far (the desk reads what its dependencies wrote). */
  context: StoryBible;
  /** This desk's own previous output (a revise round); absent on the first draft. */
  current?: unknown;
  /** Your note to this desk. */
  userNote?: string;
  /** Answers you gave to the showrunner's questions. */
  answers?: Array<{ question: string; answer: string }>;
  /** Findings assigned to this desk (a fix round). */
  findings?: RoomFinding[];
  /** Desks you locked: their text is approved and must not be contradicted. */
  lockedDesks?: RoomRoleId[];
  generatorConnected?: boolean;
}

export type RoomAsk = (req: RoomAskRequest) => Promise<unknown>;

// ----------------------------------------------------------------------------
// Session
// ----------------------------------------------------------------------------

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const uid = () => `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function freshDesk(role: RoomRoleId): RoomDesk {
  return { role, status: 'waiting', summary: 'Waiting for the briefing', notes: [], userNote: '', locked: false, source: null, revisions: 0 };
}

function emptyBible(sceneCount: number, template: StoryTemplateId): StoryBible {
  return {
    template,
    logline: '', theme: '', tone: '', hook: '', hookSeconds: 2, stakes: '', turn: '', payoff: '',
    characters: [],
    beats: Array.from({ length: sceneCount }, (_, i) => ({ scene: i + 1, purpose: '', conflict: '', emotionStart: '', emotionEnd: '', endsOn: '' })),
  };
}

const HERO_WORDS = /\b(robot|ro-bot|rô-bốt|rô bốt|cao|cáo|fox|co gai|cô gái|girl|boy|cau be|cậu bé|nhan vat|nhân vật|character|hero|chu |chú |meo|mèo|cat|dog|cho |chó)\b/i;

/** The showrunner: deterministic planning. Picks the shape and asks at most two questions the prompt cannot answer. */
export function planShowrunner(prompt: string, intent: RoomIntent): { template: StoryTemplateId; questions: RoomQuestion[] } {
  const vi = lineLanguage(prompt) === 'vi';
  const template = pickStoryTemplate(prompt, intent.kind, intent.sceneCount);
  const questions: RoomQuestion[] = [];
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  if (!HERO_WORDS.test(prompt) || words < 8) {
    questions.push({
      id: 'q-hero', desk: 'architect', answer: '',
      text: vi ? 'Nhân vật chính là ai và họ muốn gì? (để trống nếu muốn cả phòng tự quyết)' : 'Who is the hero and what do they want? (leave blank to let the room decide)',
    });
  }
  if (!/(vui|hai|funny|comedy|cam dong|touching|buon|sad|ky bi|mystery|bi an|phieu luu|adventure|ngot|warm|u am|tense|kich tinh)/i.test(fold(prompt))) {
    questions.push({
      id: 'q-tone', desk: 'architect', answer: '',
      text: vi ? 'Cảm xúc bạn muốn khán giả mang về? (vd. vui, ấm áp, hồi hộp, cảm động)' : 'What should the viewer feel at the end? (e.g. funny, warm, tense, touching)',
    });
  }
  return { template, questions: questions.slice(0, 2) };
}

export function createRoomSession(params: { prompt: string; intent: RoomIntent; generatorConnected?: boolean }): WritersRoomSession {
  const { prompt, intent } = params;
  const n = Math.max(2, intent.sceneCount);
  const plan = planShowrunner(prompt, { ...intent, sceneCount: n });
  const desks = Object.fromEntries(ROOM_ROLES.map((r) => [r.id, freshDesk(r.id)])) as Record<RoomRoleId, RoomDesk>;
  const vi = lineLanguage(prompt) === 'vi';
  desks.showrunner = {
    ...desks.showrunner,
    status: plan.questions.length ? 'needs-you' : 'done',
    source: 'rules',
    summary: `Shape: ${plan.template}. ${plan.questions.length ? `${plan.questions.length} question(s) for you (optional).` : 'No questions: the request is clear.'}`,
    notes: [vi ? 'Yêu cầu bằng tiếng Việt: mọi desk viết tiếng Việt.' : 'Request in English: every desk writes English.'],
  };
  return {
    id: uid(),
    prompt,
    intent: { ...intent, sceneCount: n },
    template: plan.template,
    stage: 'briefing',
    busy: false,
    desks,
    bible: emptyBible(n, plan.template),
    score: 0,
    findings: [],
    questions: plan.questions,
    source: 'ai',
    generatorConnected: !!params.generatorConnected,
  };
}

// ----------------------------------------------------------------------------
// Merging a desk's output into the bible
// ----------------------------------------------------------------------------

const text = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Applies one desk's raw JSON to the bible. Returns null when the output is unusable. Each desk may only touch its own fields,
 * so a confused model cannot overwrite another desk's work.
 */
export function mergeDeskOutput(bible: StoryBible, role: RoomRoleId, raw: unknown, sceneCount: number): { bible: StoryBible; note?: string } | null {
  const out = clone(bible);
  const src: any = raw && typeof raw === 'object' ? ((raw as any).bible && typeof (raw as any).bible === 'object' ? (raw as any).bible : raw) : null;
  if (!src) return null;

  if (role === 'architect') {
    const clean = sanitizeStoryBible({ ...src, characters: [] }, sceneCount);
    if (!clean || !clean.logline) return null;
    out.template = clean.template || out.template;
    for (const k of ['logline', 'theme', 'tone', 'hook', 'stakes', 'turn', 'payoff'] as const) out[k] = clean[k];
    out.hookSeconds = Number.isFinite(clean.hookSeconds) ? clean.hookSeconds : out.hookSeconds;
    out.beats = out.beats.map((b, i) => {
      const nb = clean.beats[i];
      return nb ? { ...b, purpose: nb.purpose, conflict: nb.conflict, emotionStart: nb.emotionStart, emotionEnd: nb.emotionEnd, endsOn: nb.endsOn } : b;
    });
    if (clean.motifs) out.motifs = clean.motifs;
    return { bible: out };
  }

  if (role === 'character') {
    const clean = sanitizeStoryBible({ logline: 'x', ...src, beats: [] }, sceneCount);
    if (!clean || !clean.characters.length) return null;
    // A character you already generated a model for keeps it (matched by actorId).
    out.characters = clean.characters.map((c) => {
      const prev = bible.characters.find((p) => p.actorId === c.actorId);
      return prev?.generated ? { ...c, assetId: prev.assetId, generated: prev.generated, signatureClip: strictKeep(c.signatureClip, prev) } : c;
    });
    return { bible: out };
  }

  if (role === 'world') {
    const clean = sanitizeStoryBible({ logline: 'x', characters: [], ...src, beats: src.beats }, sceneCount);
    if (!clean) return null;
    if (clean.props) out.props = clean.props;
    else delete out.props;
    if (clean.locations) out.locations = clean.locations;
    else delete out.locations;
    const propIds = new Set((out.props || []).map((p) => p.id));
    out.beats = out.beats.map((b, i) => {
      const nb: StoryBibleBeat | undefined = clean.beats[i];
      if (!nb) return b;
      const next: StoryBibleBeat = { ...b };
      if (nb.setting) next.setting = nb.setting; else delete next.setting;
      if (nb.biome) next.biome = nb.biome; else delete next.biome;
      if (nb.location) next.location = nb.location; else delete next.location;
      const props = (nb.props || []).filter((id) => propIds.has(id));
      if (props.length) next.props = props; else delete next.props;
      return next;
    });
    const placed = out.beats.some((b) => b.setting || b.biome);
    if (!placed && !out.props?.length) return null;
    return { bible: deriveLocations(out).bible };
  }

  if (role === 'dialogue') {
    const beats = Array.isArray(src.beats) ? src.beats : [];
    if (!beats.length) return null;
    out.beats = out.beats.map((b, i) => {
      const entry = beats.find((x: any) => Number(x?.scene) === i + 1) || beats[i];
      const lines = cleanLines(entry?.lines);
      const next: StoryBibleBeat = { ...b };
      if (lines.length) next.lines = lines; else delete next.lines;
      return next;
    });
    return { bible: out };
  }
  return null;
}

function strictKeep(clip: string | undefined, c: StoryCharacter): string | undefined {
  if (!clip) return undefined;
  return c.generated?.clips.includes(clip) ? clip : undefined;
}

// ----------------------------------------------------------------------------
// Continuity desk (rules, no AI) and finding routing
// ----------------------------------------------------------------------------

/** Which desk owns the fix for a lint code. */
export function deskForCode(code: string): RoomRoleId {
  if (/^bible\.(asset-|character|signature|no-hero|cast-|actor-)/.test(code)) return 'character';
  if (/^bible\.(dialogue|lines)/.test(code)) return 'dialogue';
  return 'architect';
}

export function continuityCheck(bible: StoryBible, opts: { requireLook?: boolean } = {}): RoomFinding[] {
  const out: RoomFinding[] = [];
  const add = (code: string, severity: RoomFinding['severity'], desk: RoomRoleId, message: string) => out.push({ code, severity, desk, message });
  const actors = new Set(bible.characters.map((c) => c.actorId));
  const propIds = new Set((bible.props || []).map((p) => p.id));
  const anyLines = bible.beats.some((b) => b.lines?.length);

  bible.beats.forEach((b) => {
    for (const l of b.lines || []) {
      if (!actors.has(l.speaker)) add('room.speaker-unknown', 'error', 'dialogue', `Scene ${b.scene}: "${l.speaker}" speaks but is not in the cast (${[...actors].join(', ') || 'empty'}).`);
    }
    for (const id of b.props || []) {
      if (!propIds.has(id)) add('room.prop-unknown', 'warning', 'world', `Scene ${b.scene} uses prop "${id}" that is not on the prop list.`);
    }
  });
  for (const p of bible.props || []) {
    if (!p.scenes.length) add('room.prop-orphan', 'warning', 'world', `Prop "${p.name}" is not placed in any scene.`);
    if (!p.look.trim()) add('room.prop-look', 'warning', 'world', `Prop "${p.name}" has no look brief.`);
  }
  const someSetting = bible.beats.some((b) => b.setting || b.biome);
  if (someSetting) {
    for (const b of bible.beats) if (!b.setting && !b.biome) add('room.setting-missing', 'warning', 'world', `Scene ${b.scene} has no setting.`);
  }
  if (bible.locations?.length) {
    for (const b of bible.beats) if (!b.location) add('room.location-missing', 'warning', 'world', `Scene ${b.scene} is not at any of the film's locations (${bible.locations.map((l) => l.name).join(', ')}).`);
  }
  // Nobody should be in the cast without ever appearing in the story text.
  const storyText = fold(bible.beats.map((b) => [b.purpose, b.conflict, b.endsOn, b.setting, ...(b.lines || []).map((l) => l.speaker + ' ' + l.text)].join(' ')).join(' ') + ' ' + bible.logline);
  for (const c of bible.characters) {
    const mentioned = [c.name, c.actorId].some((k) => k && storyText.includes(fold(k)));
    if (!mentioned) add('room.cast-unseen', 'warning', 'architect', `${c.name || c.actorId} is in the cast but the beats never mention them. Use them in a scene or cut them.`);
  }
  if (anyLines) {
    for (const c of bible.characters) {
      if (!bible.beats.some((b) => b.lines?.some((l) => l.speaker === c.actorId)) && bible.characters.length > 1) {
        add('room.silent-character', 'warning', 'dialogue', `${c.name || c.actorId} never speaks. Give them a line or let their acting carry it on purpose.`);
      }
    }
  }
  if (opts.requireLook) {
    for (const c of bible.characters) {
      if (!c.generated && !c.look?.trim()) add('room.look-missing', 'warning', 'character', `${c.name || c.actorId} has no look brief for the 3D generator.`);
    }
  }
  return out;
}

export interface RoomEvaluation {
  score: number;
  findings: RoomFinding[];
}

/** Rubric (11A) + continuity rules, each finding routed to the desk that owns it. */
export function evaluateRoom(bible: StoryBible, sceneCount: number, opts: { requireLook?: boolean } = {}): RoomEvaluation {
  const lint = lintStoryBible(bible, sceneCount);
  const lintFindings: RoomFinding[] = lint.issues.map((i) => ({ ...i, desk: deskForCode(i.code) }));
  const cont = continuityCheck(bible, opts);
  const penalty = cont.reduce((n, f) => n + (f.severity === 'error' ? 10 : 3), 0);
  return { score: Math.max(0, lint.score - penalty), findings: [...lintFindings, ...cont] };
}

// ----------------------------------------------------------------------------
// Local fallback per desk (no AI): a real structure so the room still works offline
// ----------------------------------------------------------------------------

function guessBiome(prompt: string, i: number): string {
  const f = fold(prompt);
  if (/thac|waterfall/.test(f)) return 'waterfall-valley';
  if (/bien|beach|sea|dai duong/.test(f)) return 'beach';
  if (/tuyet|snow|bang|ice/.test(f)) return 'snowy-peaks';
  if (/sa mac|desert/.test(f)) return 'desert';
  if (/dem|night/.test(f)) return i === 0 ? 'city-night' : 'night-forest';
  if (/rung|forest|cay/.test(f)) return 'forest';
  return BIOME_IDS[(i + 1) % 3] || 'meadow';
}

function localDeskOutput(role: RoomRoleId, prompt: string, intent: RoomIntent): unknown {
  const local = buildLocalStoryBible(prompt, intent);
  if (role === 'architect') return local;
  if (role === 'character') return { characters: local.characters };
  if (role === 'world') return { beats: local.beats.map((b, i) => ({ scene: b.scene, setting: '', biome: guessBiome(prompt, i), props: [] })) };
  return null;
}

// ----------------------------------------------------------------------------
// Running desks
// ----------------------------------------------------------------------------

export type RoomUpdate = (session: WritersRoomSession) => void;

interface RunCtx {
  ask: RoomAsk;
  update: RoomUpdate;
  signal?: AbortSignal;
}

function answersOf(s: WritersRoomSession) {
  return s.questions.filter((q) => q.answer.trim()).map((q) => ({ question: q.text, answer: q.answer.trim() }));
}

function patchDesk(s: WritersRoomSession, role: RoomRoleId, patch: Partial<RoomDesk>): WritersRoomSession {
  return { ...s, desks: { ...s.desks, [role]: { ...s.desks[role], ...patch } } };
}

function summarise(role: RoomRoleId, b: StoryBible): string {
  if (role === 'architect') return b.logline ? `“${b.logline.slice(0, 140)}${b.logline.length > 140 ? '…' : ''}”` : 'No spine yet';
  if (role === 'character') return b.characters.length ? b.characters.map((c) => `${c.name || c.actorId}${c.generated ? ' (3D model)' : ''}`).join(', ') : 'No cast yet';
  if (role === 'world') {
    const biomes = [...new Set(b.beats.map((x) => x.biome).filter(Boolean))];
    return `${biomes.join(' → ') || 'no biome'}${b.props?.length ? ` · ${b.props.length} prop(s)` : ''}`;
  }
  if (role === 'dialogue') {
    const n = b.beats.reduce((a, x) => a + (x.lines?.length || 0), 0);
    return n ? `${n} line(s) across ${b.beats.filter((x) => x.lines?.length).length} scene(s)` : 'Silent film: acting carries the story';
  }
  return '';
}

/** Runs one writer desk. Locked desks are skipped. A failed ask falls back to the local structure (marked source "local"). */
export async function runDesk(
  session: WritersRoomSession,
  role: Exclude<RoomRoleId, 'showrunner' | 'continuity' | 'editor'>,
  ctx: RunCtx,
  opts: { findings?: RoomFinding[]; revise?: boolean } = {}
): Promise<WritersRoomSession> {
  if (session.desks[role].locked) return session;
  const n = session.intent.sceneCount;
  const started = Date.now();
  let s = patchDesk(session, role, { status: 'working', error: undefined, summary: opts.revise ? 'Revising…' : 'Writing…' });
  ctx.update(s);

  const req: RoomAskRequest = {
    desk: role,
    prompt: s.prompt,
    intent: s.intent,
    template: s.template,
    context: s.bible,
    ...(opts.revise ? { current: currentOf(s.bible, role) } : {}),
    ...(s.desks[role].userNote.trim() ? { userNote: s.desks[role].userNote.trim() } : {}),
    ...(answersOf(s).length ? { answers: answersOf(s) } : {}),
    ...(opts.findings?.length ? { findings: opts.findings } : {}),
    lockedDesks: (Object.keys(s.desks) as RoomRoleId[]).filter((r) => s.desks[r].locked),
    generatorConnected: s.generatorConnected,
  };

  let merged: { bible: StoryBible } | null = null;
  let source: DeskSource = 'ai';
  const notes: string[] = [];
  try {
    const raw = await ctx.ask(req);
    merged = mergeDeskOutput(s.bible, role, raw, n);
    if (!merged) notes.push('the answer was unusable');
  } catch (e: any) {
    if (ctx.signal?.aborted) throw e;
    notes.push(`AI unavailable (${String(e?.message || e).slice(0, 80)})`);
  }
  if (!merged) {
    const local = localDeskOutput(role, s.prompt, s.intent);
    merged = local ? mergeDeskOutput(s.bible, role, local, n) : null;
    // Offline there is no dialogue template: a silent film (acting carries the story) is a valid result, not a failure.
    if (!merged && role === 'dialogue') merged = { bible: s.bible };
    source = merged ? 'local' : null;
    if (merged) notes.push(local || role !== 'dialogue' ? 'used the offline template' : 'no dialogue written: the scenes stay silent');
  }
  if (merged) {
    const fixed = autoFixStoryBible(merged.bible, n);
    merged = { bible: fixed.bible };
    notes.push(...fixed.fixes);
  }
  const bible = merged?.bible || s.bible;
  s = { ...s, bible };
  s = patchDesk(s, role, {
    status: merged ? 'done' : 'error',
    source,
    summary: merged ? summarise(role, bible) : 'No usable output. Edit it by hand or send a note and retry.',
    notes: [...s.desks[role].notes.slice(-6), ...notes],
    revisions: s.desks[role].revisions + (opts.revise || opts.findings?.length ? 1 : 0),
    ms: Date.now() - started,
    error: merged ? undefined : notes.join('; '),
  });
  s = { ...s, source: deriveSource(s.desks) };
  ctx.update(s);
  return s;
}

/** ai = every writer desk used the AI (or you); local = none did; mixed = some fell back to the offline template. */
export function deriveSource(desks: Record<RoomRoleId, RoomDesk>): WritersRoomSession['source'] {
  const sources = WRITER_ORDER.map((r) => desks[r].source).filter(Boolean);
  const local = sources.includes('local');
  const ai = sources.some((x) => x === 'ai' || x === 'user');
  return local ? (ai ? 'mixed' : 'local') : 'ai';
}

function currentOf(b: StoryBible, role: RoomRoleId): unknown {
  if (role === 'architect') return { template: b.template, logline: b.logline, theme: b.theme, tone: b.tone, hook: b.hook, hookSeconds: b.hookSeconds, stakes: b.stakes, turn: b.turn, payoff: b.payoff, beats: b.beats.map(({ scene, purpose, conflict, emotionStart, emotionEnd, endsOn }) => ({ scene, purpose, conflict, emotionStart, emotionEnd, endsOn })), motifs: b.motifs };
  if (role === 'character') return { characters: b.characters };
  if (role === 'world') return { props: b.props, locations: b.locations, beats: b.beats.map(({ scene, setting, biome, props, location }) => ({ scene, setting, biome, props, location })) };
  if (role === 'dialogue') return { beats: b.beats.map(({ scene, lines }) => ({ scene, lines })) };
  return undefined;
}

/** Deterministic desks: continuity findings + the rubric. Never calls the AI. */
export function runChecks(session: WritersRoomSession): WritersRoomSession {
  const ev = evaluateRoom(session.bible, session.intent.sceneCount, { requireLook: session.generatorConnected });
  const cont = ev.findings.filter((f) => f.code.startsWith('room.'));
  let s: WritersRoomSession = { ...session, findings: mergeEditorFindings(ev.findings, session.findings), score: blendScore(ev.score, session.editorScore) };
  s = patchDesk(s, 'continuity', {
    status: cont.some((f) => f.severity === 'error') ? 'needs-you' : 'done',
    source: 'rules',
    summary: cont.length ? `${cont.length} continuity note(s)` : 'Everything lines up',
    notes: cont.slice(0, 4).map((f) => f.message),
  });
  return s;
}

const blendScore = (rubric: number, editor?: number) => Math.round(editor === undefined ? rubric : 0.6 * rubric + 0.4 * editor);

/** Rubric + rules are recomputed every time; the editor's own findings are kept until the editor runs again. */
function mergeEditorFindings(fresh: RoomFinding[], previous: RoomFinding[]): RoomFinding[] {
  const editorOnes = previous.filter((f) => f.code.startsWith('editor.'));
  return [...fresh, ...editorOnes];
}

/** The independent critic: AI critique (optional) merged with the deterministic rubric. */
export async function runEditor(session: WritersRoomSession, ctx: RunCtx & { askEditor?: RoomAsk }): Promise<WritersRoomSession> {
  let s = patchDesk(session, 'editor', { status: 'working', summary: 'Reading the whole script…' });
  ctx.update(s);
  const started = Date.now();
  const ev = evaluateRoom(s.bible, s.intent.sceneCount, { requireLook: s.generatorConnected });
  let aiFindings: RoomFinding[] = [];
  let editorScore: number | undefined;
  const notes: string[] = [];
  let source: DeskSource = 'rules';
  const ask = ctx.askEditor || ctx.ask;
  try {
    const raw: any = await ask({
      desk: 'editor',
      prompt: s.prompt,
      intent: s.intent,
      template: s.template,
      context: s.bible,
      lockedDesks: (Object.keys(s.desks) as RoomRoleId[]).filter((r) => s.desks[r].locked),
      findings: ev.findings,
    });
    const sc = Number(raw?.score);
    if (Number.isFinite(sc)) editorScore = Math.max(0, Math.min(100, Math.round(sc)));
    aiFindings = (Array.isArray(raw?.findings) ? raw.findings : [])
      .filter((f: any) => f && typeof f.message === 'string' && f.message.trim())
      .slice(0, 6)
      .map((f: any, i: number): RoomFinding => ({
        code: `editor.${i + 1}`,
        severity: f.severity === 'error' ? 'error' : 'warning',
        message: text(f.message, 300),
        desk: (['architect', 'character', 'world', 'dialogue'] as RoomRoleId[]).includes(f.desk) ? f.desk : 'architect',
      }));
    if (editorScore !== undefined || aiFindings.length) source = 'ai';
    if (typeof raw?.verdict === 'string' && raw.verdict.trim()) notes.push(text(raw.verdict, 240));
  } catch (e: any) {
    if (ctx.signal?.aborted) throw e;
    notes.push('AI critique unavailable: rubric and rules only');
  }
  s = {
    ...s,
    editorScore,
    findings: [...ev.findings, ...aiFindings],
    score: blendScore(ev.score, editorScore),
  };
  const blocking = s.findings.filter((f) => f.severity === 'error').length;
  s = patchDesk(s, 'editor', {
    status: s.score >= STORY_BIBLE_PASS_SCORE && !blocking ? 'done' : 'needs-you',
    source,
    summary: `Score ${s.score}/100${editorScore !== undefined ? ` (editor ${editorScore})` : ''} · ${s.findings.length} note(s)`,
    notes,
    ms: Date.now() - started,
    revisions: s.desks.editor.revisions + 1,
  });
  ctx.update(s);
  return s;
}

type Writer = Exclude<RoomRoleId, 'showrunner' | 'continuity' | 'editor'>;
const isWriter = (r: RoomRoleId): r is Writer => (WRITER_ORDER as RoomRoleId[]).includes(r);

/** Desks that must re-run when `role` changes (its dependants, transitively), in run order, minus locked ones. */
export function downstreamOf(role: RoomRoleId, session?: WritersRoomSession): Writer[] {
  const out = new Set<RoomRoleId>();
  const visit = (r: RoomRoleId) => {
    for (const d of ROOM_ROLES) if (d.dependsOn.includes(r) && !out.has(d.id)) { out.add(d.id); visit(d.id); }
  };
  visit(role);
  return WRITER_ORDER.filter((r) => out.has(r) && !session?.desks[r].locked) as Writer[];
}

/** First draft: architect → character ∥ world → dialogue → checks → editor → one fix round for the desks the editor blames. */
export async function runRoom(session: WritersRoomSession, ctx: RunCtx & { askEditor?: RoomAsk }): Promise<WritersRoomSession> {
  let s: WritersRoomSession = { ...session, stage: 'drafting', busy: true };
  ctx.update(s);
  s = await runDesk(s, 'architect', ctx);
  const [c, w] = await Promise.all([
    runDesk(s, 'character', ctx),
    runDesk(s, 'world', ctx),
  ]);
  // The two run side by side from the same bible; merge their separate fields.
  s = mergeParallel(s, c, w);
  ctx.update(s);
  s = await runDesk(s, 'dialogue', ctx);
  s = runChecks(s);
  ctx.update(s);
  s = await runEditor(s, ctx);
  s = await fixRound(s, ctx);
  s = { ...s, stage: 'review', busy: false };
  ctx.update(s);
  return s;
}

function mergeParallel(base: WritersRoomSession, a: WritersRoomSession, b: WritersRoomSession): WritersRoomSession {
  const bible: StoryBible = clone(a.bible);
  // world owns beats' setting/biome/props and bible.props; character owns characters.
  bible.beats = bible.beats.map((beat, i) => {
    const wb = b.bible.beats[i];
    const next = { ...beat };
    for (const k of ['setting', 'biome', 'props', 'location'] as const) { if (wb?.[k] !== undefined) (next as any)[k] = wb[k]; else delete (next as any)[k]; }
    return next;
  });
  if (b.bible.props) bible.props = b.bible.props; else delete bible.props;
  if (b.bible.locations) bible.locations = b.bible.locations; else delete bible.locations;
  const desks = { ...base.desks, character: a.desks.character, world: b.desks.world };
  return { ...base, bible, desks, source: deriveSource(desks) };
}

/** One round: the desks named by error findings (and, when the score is under the pass mark, by warnings) fix their part. */
export async function fixRound(session: WritersRoomSession, ctx: RunCtx & { askEditor?: RoomAsk }): Promise<WritersRoomSession> {
  const pending = session.findings.filter((f) => f.severity === 'error' || session.score < STORY_BIBLE_PASS_SCORE);
  const byDesk = new Map<Writer, RoomFinding[]>();
  for (const f of pending) {
    if (!isWriter(f.desk) || session.desks[f.desk].locked) continue;
    byDesk.set(f.desk, [...(byDesk.get(f.desk) || []), f]);
  }
  if (!byDesk.size) return session;
  let s = session;
  const before = s.score;
  for (const role of WRITER_ORDER) {
    const findings = byDesk.get(role as Writer);
    if (!findings || !isWriter(role)) continue;
    s = await runDesk(s, role, ctx, { findings, revise: true });
  }
  s = runChecks(s);
  const lintOnly = evaluateRoom(s.bible, s.intent.sceneCount, { requireLook: s.generatorConnected });
  s = { ...s, findings: [...lintOnly.findings], score: blendScore(lintOnly.score, s.editorScore) };
  s = patchDesk(s, 'editor', { notes: [...s.desks.editor.notes, `fix round: ${before} → ${s.score}`], summary: `Score ${s.score}/100 · ${s.findings.length} note(s)` });
  ctx.update(s);
  return s;
}

/** You sent a note to one desk (or answered the showrunner): re-run it and the desks that read it, then the checks. */
export async function reviseDesk(session: WritersRoomSession, role: Writer, note: string, ctx: RunCtx & { askEditor?: RoomAsk }): Promise<WritersRoomSession> {
  let s: WritersRoomSession = { ...patchDesk(session, role, { userNote: note.trim(), locked: false }), busy: true };
  ctx.update(s);
  s = await runDesk(s, role, ctx, { revise: true });
  for (const d of downstreamOf(role, s)) s = await runDesk(s, d, ctx, { revise: true });
  s = runChecks(s);
  s = { ...s, busy: false };
  ctx.update(s);
  return s;
}

/** Your manual edit of the bible: it wins over every desk. The edited desk is marked "user" and the checks run again. */
export function applyUserEdit(session: WritersRoomSession, role: RoomRoleId, bible: StoryBible): WritersRoomSession {
  const fixed = autoFixStoryBible(bible, session.intent.sceneCount);
  let s: WritersRoomSession = { ...session, bible: fixed.bible };
  s = patchDesk(s, role, { source: 'user', status: 'done', summary: summarise(role, fixed.bible), notes: [...s.desks[role].notes.slice(-6), 'edited by you', ...fixed.fixes] });
  return runChecks(s);
}

export function setDeskLock(session: WritersRoomSession, role: RoomRoleId, locked: boolean): WritersRoomSession {
  return patchDesk(session, role, { locked });
}

export function answerQuestion(session: WritersRoomSession, id: string, answer: string): WritersRoomSession {
  const questions = session.questions.map((q) => (q.id === id ? { ...q, answer } : q));
  return { ...session, questions, desks: { ...session.desks, showrunner: { ...session.desks.showrunner, status: 'done' } } };
}

export function roomReady(s: WritersRoomSession): { ok: boolean; reason?: string } {
  if (s.busy) return { ok: false, reason: 'A desk is still working.' };
  if (s.stage === 'briefing') return { ok: false, reason: 'Start the room first.' };
  if (!s.bible.logline.trim() || !s.bible.beats.length) return { ok: false, reason: 'The story spine is empty.' };
  return { ok: true };
}

/** The bible to hand to the storyboard pipeline (undefined when the room is only an offline template). */
export function bibleForProduction(s: WritersRoomSession): StoryBible | undefined {
  if (s.source === 'local' && !Object.values(s.desks).some((d) => d.source === 'user')) return undefined;
  return clone(s.bible);
}

export { characterClips };
