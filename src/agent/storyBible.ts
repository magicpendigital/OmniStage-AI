/**
 * Phase 11A — Story Bible: the "writers' room" step that runs BEFORE the storyboard planner.
 *
 *   draft (LLM)  →  sanitize  →  autoFix (deterministic)  →  lint (rubric)  →  one revise round with the findings
 *
 * The bible (logline, theme, hook, stakes, turn, payoff, cast with want / flaw / signature gesture, one beat per scene,
 * planted motifs) is handed VERBATIM to the planner and to every scene author, so scene 3 is written against the same
 * story as scene 1. The writer is also given the cast's real clip inventory, so it only writes gestures the rigs can perform.
 *
 * Everything here is pure (no DOM, store or network): the rubric is deterministic and unit-tested, and an offline bible
 * keeps the pipeline usable without any AI key.
 */
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { lineLanguage } from '../audio/voices';
import { BIOME_IDS } from '../runtime/biomes';
import type {
  SceneSpec,
  StoryBible,
  StoryBibleBeat,
  StoryCharacter,
  StoryLine,
  StoryMotif,
  StoryProp,
  StoryTemplateId,
  StoryboardKind,
} from '../types/scene.schema';

export const STORY_TEMPLATE_IDS: StoryTemplateId[] = ['visual-gag', 'mini-journey', 'meet-cute', 'reveal-twist', 'story-ad'];
export const MAX_BIBLE_CHARACTERS = 4;
/** A bible at or above this score goes to the planner as is; below it gets one revise round. */
export const STORY_BIBLE_PASS_SCORE = 80;
/** The hook must land inside this many seconds. */
export const MAX_HOOK_SECONDS = 3;

// ----------------------------------------------------------------------------
// Story templates
// ----------------------------------------------------------------------------

export interface StoryTemplate {
  id: StoryTemplateId;
  title: string;
  /** Folded (lower-case, no diacritics) words in the prompt that pick this template. */
  triggers: string[];
  structure: string;
}

export const STORY_TEMPLATES: StoryTemplate[] = [
  {
    id: 'visual-gag',
    title: 'Visual gag (silent comedy)',
    triggers: ['vui', 'funny', 'gag', 'comedy', 'meo', 'prank', 'tro dua', 'bat ngo'],
    structure:
      'Setup an expectation in the first seconds → escalate it with one rule of the joke → break it with a surprise → pay off with a reaction shot. Almost no dialogue: acting, music and timing carry it.',
  },
  {
    id: 'mini-journey',
    title: 'Mini journey',
    triggers: ['phieu luu', 'adventure', 'journey', 'hanh trinh', 'quest', 'kham pha', 'explore', 'tim kiem', 'find', 'search'],
    structure:
      'The hero WANTS something concrete → leaves its comfort zone → meets an obstacle that exposes its flaw → a small helper / lesson / sacrifice turns it → returns changed with a visible payoff of what it wanted (or needed instead).',
  },
  {
    id: 'meet-cute',
    title: 'Meet-cute (two characters)',
    triggers: ['ban', 'friend', 'gap', 'meet', 'tinh ban', 'friendship', 'lam quen', 'cung nhau', 'together', 'love', 'yeu'],
    structure:
      'Two very different characters cross paths → a misunderstanding or clash → forced to cooperate on one small problem → a moment of trust → they part (or stay) as friends, with a gesture from the first scene coming back.',
  },
  {
    id: 'reveal-twist',
    title: 'Mystery and reveal',
    triggers: ['bi an', 'mystery', 'bi mat', 'secret', 'twist', 'dao chieu', 'kho bau', 'treasure', 'what is', 'la gi'],
    structure:
      'A strange sign hooks the viewer → the hero investigates, clues are planted → a false answer → the real reveal re-reads the earlier clues → a quiet closing image on the consequence.',
  },
  {
    id: 'story-ad',
    title: 'Story ad',
    triggers: ['quang cao', 'advert', 'commercial', 'tvc', 'promo', 'san pham', 'product', 'thuong hieu', 'brand'],
    structure:
      'A relatable problem in the first 3 seconds → the product enters as the simple solution → a delight beat (the reward the viewer would want) → one clear line / call to action. One emotion, one product benefit.',
  },
];

function fold(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

export function pickStoryTemplate(prompt: string, kind: StoryboardKind, sceneCount: number): StoryTemplateId {
  if (kind === 'ad-sequence') return 'story-ad';
  const text = ` ${fold(prompt)} `;
  let best: { id: StoryTemplateId; hits: number } | null = null;
  for (const t of STORY_TEMPLATES) {
    const hits = t.triggers.filter((w) => text.includes(` ${w} `)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { id: t.id, hits };
  }
  if (best) return best.id;
  return sceneCount <= 3 ? 'visual-gag' : 'mini-journey';
}

// ----------------------------------------------------------------------------
// Cast inventory: what the rigs can actually perform
// ----------------------------------------------------------------------------

export interface CastEntry {
  assetId: string;
  name: string;
  clips: string[];
}

/** Rigged characters with their clip names, richest first. The writer may only use these. */
export function castInventory(): CastEntry[] {
  return Object.values(ASSET_REGISTRY)
    .filter((a) => a.category === 'gltf-rigged' && (a.embeddedClips?.length ?? 0) > 0)
    .map((a) => ({ assetId: a.assetId, name: a.name, clips: [...(a.embeddedClips || [])] }))
    .sort((a, b) => b.clips.length - a.clips.length || a.assetId.localeCompare(b.assetId));
}

function clipsOf(assetId: string): string[] {
  return ASSET_REGISTRY[assetId]?.embeddedClips ? [...(ASSET_REGISTRY[assetId].embeddedClips as string[])] : [];
}

/** Clips a bible character can perform: its generated model's own clips, else the stock rig's. */
export function characterClips(c: Pick<StoryCharacter, 'assetId' | 'generated'>): string[] {
  return c.generated?.clips?.length ? [...c.generated.clips] : clipsOf(c.assetId);
}

/** Strict clip lookup: exact, case-insensitive, or contains. Unlike matchClipName it never falls back to Idle. */
export function strictClipMatch(wanted: string | undefined, clips: string[]): string | undefined {
  if (!wanted || !clips.length) return undefined;
  const w = wanted.trim().toLowerCase();
  if (!w) return undefined;
  return clips.find((c) => c.toLowerCase() === w) || clips.find((c) => c.toLowerCase().includes(w) || w.includes(c.toLowerCase()));
}

function describeCast(): string {
  return castInventory()
    .map((c) => `- ${c.assetId} (${c.name}): clips [${c.clips.join(', ')}]`)
    .join('\n');
}

// ----------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------

export function buildStoryBibleSystemPrompt(sceneCount: number): string {
  return `You are the OmniStage AI Story Editor: a screenwriter for very short animated films (${sceneCount} scenes, 8-12 s each, 30-60 s in total).
Your job is to write the STORY BIBLE that every scene will be authored against. You do NOT write SceneSpec JSON, camera or timing here.

WHAT MAKES A SHORT FILM WORK
1. HOOK: something intriguing is already happening in the first ${MAX_HOOK_SECONDS} seconds (an action, a problem, a mystery) — never a quiet establishing tableau.
2. WANT: the hero wants one concrete thing. The flaw is what gets in its own way. Stakes = what is lost if it fails.
3. CHANGE: every scene changes something (emotion, knowledge or situation). emotionStart and emotionEnd of a beat must differ.
4. PULL: every scene except the last ENDS ON a question, a turn or an image that makes the viewer want the next one.
5. TURN: around the middle, a reversal makes the hero re-think what it wants.
6. PAYOFF: the last image answers the hook and cashes in a motif planted earlier (setupScene < payoffScene). Plant at least one motif (an object, a gesture or a line).
7. Specific beats generic: a robot who is afraid of water, not "a brave hero". Funny / touching comes from specific details and reactions.
8. Keep the cast small (1-3 characters). Each has its own manner and a signature gesture that returns.

SHORT-FILM SHAPES (pick one for "template", follow its structure):
${STORY_TEMPLATES.map((t) => `- ${t.id}: ${t.title}. ${t.structure}`).join('\n')}

CAST YOU MAY USE (assetId and the ONLY clips each rig can perform — signature gestures and beats must be playable with these):
${describeCast()}
Prefer characters with many clips for the hero. Give each character a stable actorId ("hero", "friend", "rival"); scenes will reuse it.

LANGUAGE: write every free-text field in the user's language (Vietnamese prompt → Vietnamese text). assetId, actorId, signatureClip and template stay exact English identifiers.

Return ONLY JSON:
{
  "template": "${STORY_TEMPLATE_IDS.join('" | "')}",
  "logline": "one sentence: WHO wants WHAT, what stands in the way, what is at stake (>= 8 words)",
  "theme": "the idea the film is about, a few words",
  "tone": "e.g. warm and funny / tense then tender",
  "hook": "what the viewer sees in the first ${MAX_HOOK_SECONDS} seconds",
  "hookSeconds": 2,
  "stakes": "what is lost if the hero fails",
  "turn": "the reversal around the middle",
  "payoff": "the final image / line that answers the hook",
  "characters": [
    { "actorId": "hero", "assetId": "<from the cast list>", "name": "short name", "want": "...", "flaw": "...", "manner": "how it talks and moves",
      "signatureGesture": "plain words", "signatureClip": "<exact clip of that asset>", "pitch": 0 }
  ],
  "beats": [   // EXACTLY ${sceneCount}, in order
    { "scene": 1, "purpose": "what changes", "conflict": "what stands in the way", "emotionStart": "curious", "emotionEnd": "worried", "endsOn": "the image / question the scene ends on" }
  ],
  "motifs": [ { "what": "the thing planted", "setupScene": 1, "payoffScene": ${sceneCount} } ]
}`;
}

export function buildStoryBibleUserPrompt(params: {
  prompt: string;
  sceneCount: number;
  kind: StoryboardKind;
  template: StoryTemplateId;
  /** Revise round: the previous draft and the editor's findings. */
  draft?: StoryBible;
  findings?: BibleIssue[];
}): string {
  const { prompt, sceneCount, kind, template, draft, findings } = params;
  const base = `USER REQUEST: "${prompt.slice(0, 2000)}"
Film kind: ${kind}. Scenes: EXACTLY ${sceneCount}. Suggested shape: "${template}" (change it if the request clearly needs another).`;
  if (!draft) return `${base}\n\nWrite the story bible.`;
  return `${base}

YOUR PREVIOUS DRAFT:
${JSON.stringify(draft, null, 2)}

THE STORY EDITOR REJECTED IT FOR THESE REASONS (fix every one, keep what already works):
${(findings || []).map((f) => `- [${f.code}] ${f.message}`).join('\n')}

Return the complete corrected story bible JSON.`;
}

/** Planner section: the beats and cast the plan must follow. Appended to the planner's system prompt. */
export function buildStoryBiblePlannerSection(bible: StoryBible): string {
  return `
STORY BIBLE (written by the story editor — the plan MUST serve it, do not invent a different story):
${describeBible(bible)}

PLAN RULES FROM THE BIBLE:
- beat i of the plan realises bible beat i: same purpose, conflict and emotional change; its title may be rewritten but "beat" keeps the bible's endsOn.
- Scene 1's script shows the HOOK within the first ${MAX_HOOK_SECONDS} seconds.
- Every script action must be playable by the cast's clips (listed in the bible's cast). Put each signature gesture on screen at least once.
- Plant and pay off the motifs at the scenes the bible names. The last scene's final shot is the PAYOFF.`;
}

export function describeBible(bible: StoryBible): string {
  const cast = bible.characters
    .map(
      (c) =>
        `- ${c.actorId} | ${c.assetId} "${c.name}": wants ${c.want}; flaw ${c.flaw}; manner ${c.manner}; signature: ${c.signatureGesture}${c.signatureClip ? ` (clip "${c.signatureClip}")` : ''}${c.pitch ? `; voice pitch ${c.pitch}` : ''}${c.look ? `; look: ${c.look}` : ''}${c.generated ? `; custom model (clips: ${c.generated.clips.join(', ') || 'none'})` : ''}`
    )
    .join('\n');
  const motifs = (bible.motifs || []).map((m) => `- "${m.what}": planted in scene ${m.setupScene}, pays off in scene ${m.payoffScene}`).join('\n');
  const propLine = (bible.props || []).map((p) => `- ${p.id} "${p.name}" (scenes ${p.scenes.join(', ') || '-'})${p.look ? `: ${p.look}` : ''}`).join('\n');
  const beats = bible.beats
    .map((b) => {
      const where = [b.setting, b.biome ? `biome ${b.biome}` : '', b.props?.length ? `props ${b.props.join(', ')}` : ''].filter(Boolean).join('; ');
      const lines = (b.lines || []).map((l) => `    ${l.speaker}${l.emotion ? ` (${l.emotion})` : ''}: "${l.text}"`).join('\n');
      return `- Scene ${b.scene}: ${b.purpose} | conflict: ${b.conflict} | ${b.emotionStart} → ${b.emotionEnd} | ends on: ${b.endsOn}${where ? ` | set: ${where}` : ''}${lines ? `\n  lines:\n${lines}` : ''}`;
    })
    .join('\n');
  return `Logline: ${bible.logline}
Theme: ${bible.theme}. Tone: ${bible.tone}.${bible.template ? ` Shape: ${bible.template}.` : ''}
Hook (by ${bible.hookSeconds}s): ${bible.hook}
Stakes: ${bible.stakes}
Turn: ${bible.turn}
Payoff: ${bible.payoff}
CAST:
${cast}
${motifs ? `MOTIFS:\n${motifs}\n` : ''}${propLine ? `PROPS:\n${propLine}\n` : ''}BEATS:
${beats}`;
}

/** Scene-author section: the whole bible plus the highlighted beat of THIS scene. */
export function describeBibleForScene(bible: StoryBible, beatIndex: number, total: number): string {
  const beat = bible.beats[beatIndex];
  const motifsHere = (bible.motifs || []).filter((m) => m.setupScene === beatIndex + 1 || m.payoffScene === beatIndex + 1);
  const hookRule =
    beatIndex === 0
      ? `\n- This is the FIRST scene: the hook ("${bible.hook}") must be on screen by ${bible.hookSeconds}s — start with the action, not a still.`
      : '';
  const payoffRule = beatIndex === total - 1 ? `\n- This is the LAST scene: its final shot is the payoff ("${bible.payoff}").` : '';
  return `STORY BIBLE (the film's contract — this scene must serve it):
${describeBible(bible)}

THIS SCENE (${beatIndex + 1} of ${total}):${
    beat
      ? `
- Purpose: ${beat.purpose}
- Conflict: ${beat.conflict}
- Emotion: ${beat.emotionStart} → ${beat.emotionEnd} (acting, music and framing must show the change)
- Ends on: ${beat.endsOn}${beat.setting ? `\n- Set: ${beat.setting}` : ''}${beat.biome ? `\n- Use world.biome "${beat.biome}" for this scene.` : ''}${
          beat.props?.length ? `\n- Props on stage: ${beat.props.join(', ')} (see PROPS above).` : ''
        }${
          beat.lines?.length
            ? `\n- DIALOGUE decided by the writers (put these lines in "dialogue" in this order, speaker = actor id, keep the wording; you may only retime them):\n${beat.lines.map((l) => `  * ${l.speaker}${l.emotion ? ` (${l.emotion})` : ''}: "${l.text}"`).join('\n')}`
            : ''
        }`
      : ''
  }${motifsHere.map((m) => `\n- Motif "${m.what}": ${m.setupScene === beatIndex + 1 ? 'plant it visibly now' : 'pay it off now'}.`).join('')}${hookRule}${payoffRule}
- Use the cast's exact actor ids and assetIds; each character's voice.pitch and manner stay the same as in earlier scenes.`;
}

export function formatBibleSummary(bible: StoryBible, score: number): string[] {
  return [
    `Story: ${bible.logline}`,
    `Hook (${bible.hookSeconds}s): ${bible.hook} · Turn: ${bible.turn} · Payoff: ${bible.payoff} · Bible score ${score}/100`,
  ];
}

// ----------------------------------------------------------------------------
// Sanitize raw model output
// ----------------------------------------------------------------------------

const text = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function sanitizeStoryBible(raw: any, sceneCount: number): StoryBible | null {
  const src = raw && typeof raw === 'object' ? (raw.bible && typeof raw.bible === 'object' ? raw.bible : raw) : null;
  if (!src || typeof src.logline !== 'string') return null;
  const characters: StoryCharacter[] = (Array.isArray(src.characters) ? src.characters : [])
    .filter((c: any) => c && typeof c === 'object')
    .slice(0, MAX_BIBLE_CHARACTERS)
    .map((c: any, i: number) => ({
      actorId: typeof c.actorId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.actorId) ? c.actorId : i === 0 ? 'hero' : `character-${i + 1}`,
      assetId: text(c.assetId, 80),
      name: text(c.name, 60),
      want: text(c.want),
      flaw: text(c.flaw),
      manner: text(c.manner),
      signatureGesture: text(c.signatureGesture),
      ...(typeof c.signatureClip === 'string' && c.signatureClip.trim() ? { signatureClip: c.signatureClip.trim().slice(0, 60) } : {}),
      ...(finite(c.pitch) ? { pitch: Math.max(-8, Math.min(8, c.pitch)) } : {}),
      ...(typeof c.look === 'string' && c.look.trim() ? { look: c.look.trim().slice(0, 300) } : {}),
      ...(cleanGenerated(c.generated) ? { generated: cleanGenerated(c.generated) } : {}),
    }));
  const beats: StoryBibleBeat[] = (Array.isArray(src.beats) ? src.beats : [])
    .filter((b: any) => b && typeof b === 'object')
    .slice(0, sceneCount)
    .map((b: any, i: number) => ({
      scene: i + 1,
      purpose: text(b.purpose),
      conflict: text(b.conflict),
      emotionStart: text(b.emotionStart, 60),
      emotionEnd: text(b.emotionEnd, 60),
      endsOn: text(b.endsOn),
      ...(text(b.setting) ? { setting: text(b.setting, 240) } : {}),
      ...(BIOME_IDS.includes(b.biome) ? { biome: String(b.biome) } : {}),
      ...(Array.isArray(b.props) ? { props: b.props.filter((x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, 6) } : {}),
      ...(cleanLines(b.lines).length ? { lines: cleanLines(b.lines) } : {}),
    }));
  const props = cleanProps(src.props, sceneCount);
  const motifs: StoryMotif[] = (Array.isArray(src.motifs) ? src.motifs : [])
    .filter((m: any) => m && typeof m.what === 'string' && finite(Number(m.setupScene)) && finite(Number(m.payoffScene)))
    .slice(0, 4)
    .map((m: any) => ({ what: text(m.what, 120), setupScene: Math.round(Number(m.setupScene)), payoffScene: Math.round(Number(m.payoffScene)) }));
  return {
    ...(STORY_TEMPLATE_IDS.includes(src.template) ? { template: src.template as StoryTemplateId } : {}),
    logline: text(src.logline, 500),
    theme: text(src.theme, 160),
    tone: text(src.tone, 160),
    hook: text(src.hook),
    hookSeconds: finite(Number(src.hookSeconds)) ? Number(src.hookSeconds) : Number.NaN,
    stakes: text(src.stakes),
    turn: text(src.turn),
    payoff: text(src.payoff),
    characters,
    beats,
    ...(motifs.length ? { motifs } : {}),
    ...(props.length ? { props } : {}),
  };
}

function cleanGenerated(g: any): StoryCharacter['generated'] | undefined {
  if (!g || typeof g !== 'object' || typeof g.provider !== 'string') return undefined;
  const clips = (Array.isArray(g.clips) ? g.clips : []).filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 60)).slice(0, 60);
  return {
    provider: g.provider.slice(0, 30),
    clips,
    ...(typeof g.modelUrl === 'string' && g.modelUrl.length < 600 ? { modelUrl: g.modelUrl } : {}),
    ...(typeof g.libraryAssetId === 'string' ? { libraryAssetId: g.libraryAssetId.slice(0, 120) } : {}),
  };
}

export const MAX_LINES_PER_BEAT = 4;

export function cleanLines(raw: unknown): StoryLine[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((l: any) => l && typeof l.speaker === 'string' && typeof l.text === 'string' && l.text.trim())
    .slice(0, MAX_LINES_PER_BEAT)
    .map((l: any) => ({
      speaker: l.speaker.trim().slice(0, 64),
      text: l.text.trim().slice(0, 160),
      ...(typeof l.emotion === 'string' && l.emotion.trim() ? { emotion: l.emotion.trim().slice(0, 40) } : {}),
    }));
}

function cleanProps(raw: unknown, sceneCount: number): StoryProp[] {
  const seen = new Set<string>();
  const out: StoryProp[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) continue;
    const id = typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.id) ? p.id : `prop-${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const scenes = (Array.isArray(p.scenes) ? p.scenes : []).map((n: unknown) => Math.round(Number(n))).filter((n: number) => Number.isFinite(n) && n >= 1 && n <= sceneCount);
    const gen = p.generated && typeof p.generated === 'object' && typeof p.generated.provider === 'string' ? p.generated : null;
    out.push({
      id,
      name: p.name.trim().slice(0, 60),
      look: typeof p.look === 'string' ? p.look.trim().slice(0, 300) : '',
      scenes: [...new Set<number>(scenes)],
      ...(gen ? { generated: { provider: String(gen.provider).slice(0, 30), ...(typeof gen.modelUrl === 'string' ? { modelUrl: gen.modelUrl } : {}), ...(typeof gen.libraryAssetId === 'string' ? { libraryAssetId: gen.libraryAssetId } : {}) } } : {}),
    });
    if (out.length >= 6) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Deterministic repair: fixes structure only, never invents story
// ----------------------------------------------------------------------------

export function autoFixStoryBible(input: StoryBible, sceneCount: number): { bible: StoryBible; fixes: string[] } {
  const bible: StoryBible = JSON.parse(JSON.stringify(input));
  const fixes: string[] = [];
  const cast = castInventory();

  if (!Number.isFinite(bible.hookSeconds) || bible.hookSeconds <= 0) {
    bible.hookSeconds = Number.isFinite(bible.hookSeconds) && bible.hookSeconds <= 0 ? 1 : MAX_HOOK_SECONDS;
    fixes.push('hookSeconds set');
  }
  // A hook later than the limit is a story problem the lint reports (it needs a rewrite, not a number change).

  const seen = new Set<string>();
  bible.characters.forEach((c, i) => {
    if (!c.generated && (!ASSET_REGISTRY[c.assetId] || !clipsOf(c.assetId).length)) {
      const pick = cast[Math.min(i, cast.length - 1)];
      if (pick) {
        fixes.push(`${c.actorId}: unknown rig "${c.assetId}" → ${pick.assetId}`);
        c.assetId = pick.assetId;
        delete c.signatureClip;
      }
    }
    if (seen.has(c.actorId)) {
      const renamed = `${c.actorId}-${i + 1}`;
      fixes.push(`duplicate actorId ${c.actorId} → ${renamed}`);
      c.actorId = renamed;
    }
    seen.add(c.actorId);
    const clips = characterClips(c);
    const exact = strictClipMatch(c.signatureClip, clips);
    if (c.signatureClip && exact && exact !== c.signatureClip) {
      c.signatureClip = exact;
      fixes.push(`${c.actorId}: signature clip spelled "${exact}"`);
    }
  });

  bible.beats = bible.beats.slice(0, sceneCount).map((b, i) => ({ ...b, scene: i + 1 }));
  if (bible.motifs) {
    bible.motifs = bible.motifs.map((m) => ({
      ...m,
      setupScene: Math.max(1, Math.min(sceneCount, m.setupScene)),
      payoffScene: Math.max(1, Math.min(sceneCount, m.payoffScene)),
    }));
  }
  return { bible, fixes };
}

/** A bible received over the wire (planner / scene routes): sanitised and structurally fixed, or undefined. */
export function coerceBible(raw: unknown, sceneCount: number): StoryBible | undefined {
  const clean = sanitizeStoryBible(raw, Math.max(1, sceneCount));
  return clean ? autoFixStoryBible(clean, Math.max(1, sceneCount)).bible : undefined;
}

// ----------------------------------------------------------------------------
// Lint: the story rubric
// ----------------------------------------------------------------------------

export interface BibleIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface BibleLint {
  /** 0-100. */
  score: number;
  issues: BibleIssue[];
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sameText = (a: string, b: string) => fold(a).replace(/[^a-z0-9]/g, '') === fold(b).replace(/[^a-z0-9]/g, '');

export function lintStoryBible(bible: StoryBible, sceneCount: number): BibleLint {
  const issues: BibleIssue[] = [];
  const add = (code: string, severity: BibleIssue['severity'], message: string) => issues.push({ code, severity, message });

  if (wordCount(bible.logline) < 8) add('bible.logline', 'error', 'The logline must say who wants what, what stands in the way and what is at stake (>= 8 words).');
  if (!bible.theme.trim()) add('bible.theme', 'warning', 'Name the theme (what the film is about).');
  if (!bible.tone.trim()) add('bible.tone', 'warning', 'Name the tone.');
  if (!bible.hook.trim()) add('bible.hook', 'error', `Write the hook: what the viewer sees in the first ${MAX_HOOK_SECONDS} seconds.`);
  else if (!(bible.hookSeconds <= MAX_HOOK_SECONDS)) add('bible.hook-late', 'error', `The hook lands at ${bible.hookSeconds}s; it must land within ${MAX_HOOK_SECONDS}s. Start with the action.`);
  if (!bible.stakes.trim()) add('bible.stakes', 'error', 'Say what is lost if the hero fails (stakes).');
  if (!bible.turn.trim()) add('bible.turn', 'error', 'Add a turn: a reversal around the middle of the film.');
  if (!bible.payoff.trim()) add('bible.payoff', 'error', 'Add the payoff: the final image that answers the hook.');

  if (!bible.characters.length) add('bible.no-hero', 'error', 'The bible has no characters.');
  if (bible.characters.length > MAX_BIBLE_CHARACTERS) add('bible.cast-large', 'warning', `Keep the cast to ${MAX_BIBLE_CHARACTERS} or fewer.`);
  const ids = new Set<string>();
  for (const c of bible.characters) {
    if (ids.has(c.actorId)) add('bible.actor-duplicate', 'error', `Two characters share the actorId "${c.actorId}".`);
    ids.add(c.actorId);
    const clips = characterClips(c);
    if ((!c.generated && !ASSET_REGISTRY[c.assetId]) || !clips.length) {
      add('bible.asset-unknown', 'error', `${c.actorId}: "${c.assetId}" is not a rigged character with clips. Pick one from the cast list.`);
      continue;
    }
    if (!c.want.trim() || !c.flaw.trim()) add('bible.character-want', 'error', `${c.actorId} needs a want and a flaw.`);
    if (!c.signatureGesture.trim()) add('bible.signature-missing', 'warning', `${c.actorId} needs a signature gesture.`);
    if (!c.signatureClip) add('bible.signature-clip', 'warning', `${c.actorId} has no signatureClip; choose a clip of ${c.assetId}: ${clips.join(', ')}.`);
    else if (!strictClipMatch(c.signatureClip, clips)) {
      add('bible.signature-unperformable', 'error', `${c.actorId}: ${c.assetId} has no clip "${c.signatureClip}". Its clips: ${clips.join(', ')}.`);
    }
  }

  if (bible.beats.length !== sceneCount) add('bible.beats-count', 'error', `The bible has ${bible.beats.length} beats but the film has ${sceneCount} scenes.`);
  bible.beats.forEach((b, i) => {
    const n = i + 1;
    if (!b.purpose.trim() || !b.conflict.trim()) add('bible.beat-empty', 'warning', `Scene ${n} needs a purpose and a conflict.`);
    if (!b.emotionStart.trim() || !b.emotionEnd.trim() || sameText(b.emotionStart, b.emotionEnd)) {
      add('bible.beat-flat', 'warning', `Scene ${n} changes nothing: emotionStart and emotionEnd must differ.`);
    }
    if (i < bible.beats.length - 1 && !b.endsOn.trim()) add('bible.beat-no-ending', 'warning', `Scene ${n} must end on a question, turn or image that pulls into scene ${n + 1}.`);
  });

  const motifs = bible.motifs || [];
  if (sceneCount >= 3 && !motifs.length) add('bible.no-setup-payoff', 'warning', 'Plant at least one motif in an early scene and pay it off in a later one.');
  for (const m of motifs) {
    if (m.setupScene < 1 || m.payoffScene > sceneCount || m.payoffScene <= m.setupScene) {
      add('bible.motif-order', 'warning', `Motif "${m.what}" must pay off in a later scene than it is planted (1..${sceneCount}).`);
    }
  }

  const penalty = issues.reduce((sum, i) => sum + (i.severity === 'error' ? 15 : 6), 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

/** Issues the writer must fix (the revise round). Warnings only count when the score is under the pass mark. */
export function bibleFindingsForRevision(lint: BibleLint): BibleIssue[] {
  return lint.score >= STORY_BIBLE_PASS_SCORE ? lint.issues.filter((i) => i.severity === 'error') : lint.issues;
}

// ----------------------------------------------------------------------------
// Offline bible (no AI key): a real structure, so the pipeline and the eval still work
// ----------------------------------------------------------------------------

interface Stage {
  vi: { purpose: string; conflict: string; start: string; end: string; ends: string };
  en: { purpose: string; conflict: string; start: string; end: string; ends: string };
}

const STAGES: Stage[] = [
  {
    vi: { purpose: '{hero} bắt đầu hành động ngay: một vấn đề nhỏ xuất hiện', conflict: 'mọi thứ không theo ý {hero}', start: 'tò mò', end: 'lo lắng', ends: '{hero} nhìn thấy thứ khiến mình phải đuổi theo' },
    en: { purpose: '{hero} is already in action: a small problem appears', conflict: 'nothing goes {hero}\'s way', start: 'curious', end: 'worried', ends: '{hero} spots the thing it has to chase' },
  },
  {
    vi: { purpose: '{hero} thử cách đầu tiên và thất bại vì điểm yếu của mình', conflict: 'điểm yếu của {hero} làm hỏng kế hoạch', start: 'tự tin', end: 'bối rối', ends: 'một người bạn xuất hiện, nhìn {hero} khó hiểu' },
    en: { purpose: '{hero} tries the first plan and fails because of its flaw', conflict: '{hero}\'s flaw ruins the plan', start: 'confident', end: 'confused', ends: 'a stranger appears, puzzled by {hero}' },
  },
  {
    vi: { purpose: '{hero} và {friend} buộc phải hợp tác; {hero} đổi cách nghĩ', conflict: 'hai bên hiểu lầm nhau', start: 'ngờ vực', end: 'tin tưởng', ends: 'cả hai nhìn về phía thử thách lớn nhất' },
    en: { purpose: '{hero} and {friend} are forced to cooperate; {hero} changes its mind', conflict: 'they misunderstand each other', start: 'suspicious', end: 'trusting', ends: 'both look toward the biggest challenge' },
  },
  {
    vi: { purpose: '{hero} đối mặt điểm yếu của chính mình ở thời khắc quyết định', conflict: 'nếu thất bại sẽ mất điều quan trọng', start: 'sợ hãi', end: 'quyết tâm', ends: '{hero} làm động tác đặc trưng — lần đầu tiên là tự nguyện' },
    en: { purpose: '{hero} faces its own flaw at the decisive moment', conflict: 'failing means losing what matters', start: 'afraid', end: 'determined', ends: '{hero} makes its signature gesture — willingly for the first time' },
  },
  {
    vi: { purpose: '{hero} đạt được điều mình cần và nhắc lại chi tiết đã gieo từ đầu', conflict: 'một khoảnh khắc yên lặng để cảm xúc lắng xuống', start: 'hồi hộp', end: 'ấm áp', ends: 'hình ảnh cuối cùng trả lời cảnh mở đầu' },
    en: { purpose: '{hero} gets what it needed and echoes the detail planted at the start', conflict: 'a quiet moment lets the feeling settle', start: 'tense', end: 'warm', ends: 'the last image answers the opening' },
  },
];

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

export function buildLocalStoryBible(prompt: string, intent: { sceneCount: number; kind: StoryboardKind }): StoryBible {
  const vi = lineLanguage(prompt) === 'vi';
  const n = Math.max(2, intent.sceneCount);
  const template = pickStoryTemplate(prompt, intent.kind, n);
  const robot = ASSET_REGISTRY['gltf-robot-expressive'] ? 'gltf-robot-expressive' : castInventory()[0]?.assetId || 'gltf-robot-expressive';
  const fox = ASSET_REGISTRY['gltf-fox'] ? 'gltf-fox' : castInventory()[1]?.assetId || robot;
  const robotClips = clipsOf(robot);
  const foxClips = clipsOf(fox);
  const heroClip = strictClipMatch('Wave', robotClips) || robotClips[0];
  const friendClip = strictClipMatch('Run', foxClips) || foxClips[0];
  const names = vi ? { hero: 'Bốp', friend: 'Cáo Nhỏ' } : { hero: 'Bolt', friend: 'Fox' };
  const vars = { hero: names.hero, friend: names.friend };
  const topic = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);

  const beats: StoryBibleBeat[] = Array.from({ length: n }, (_, i) => {
    const stageIndex = n === 1 ? 0 : Math.round((i * (STAGES.length - 1)) / (n - 1));
    const s = STAGES[stageIndex][vi ? 'vi' : 'en'];
    return {
      scene: i + 1,
      purpose: fill(s.purpose, vars),
      conflict: fill(s.conflict, vars),
      emotionStart: s.start,
      emotionEnd: s.end,
      endsOn: fill(s.ends, vars),
    };
  });

  const tpl = STORY_TEMPLATES.find((t) => t.id === template)!;
  return {
    template,
    logline: vi
      ? `${names.hero}, một rô-bốt nhỏ vụng về, muốn hoàn thành "${topic}" một mình, nhưng nỗi sợ của mình cản đường và nó phải học cách nhờ ${names.friend} giúp, nếu không sẽ mất điều quý giá nhất.`
      : `${names.hero}, a clumsy little robot, wants to finish "${topic}" all by itself, but its own fear gets in the way and it must learn to ask ${names.friend} for help or lose what matters most.`,
    theme: vi ? 'dám nhờ giúp đỡ' : 'daring to ask for help',
    tone: vi ? `ấm áp, hài hước nhẹ (${tpl.title})` : `warm and lightly funny (${tpl.title})`,
    hook: vi ? `${names.hero} đang vật lộn với một thứ nó không với tới ngay từ giây đầu tiên` : `${names.hero} is already struggling with something just out of reach from the first second`,
    hookSeconds: 2,
    stakes: vi ? `${names.hero} sẽ mất cơ hội và ${names.friend} sẽ rời đi` : `${names.hero} loses its chance and ${names.friend} walks away`,
    turn: vi ? `${names.hero} nhận ra tự làm một mình không phải là mạnh mẽ` : `${names.hero} realises doing it alone is not the same as being strong`,
    payoff: vi ? `${names.hero} chủ động vẫy tay nhờ giúp, đúng cử chỉ bị bỏ qua ở cảnh đầu` : `${names.hero} waves for help on purpose — the gesture it ignored in scene 1`,
    characters: [
      {
        actorId: 'hero', assetId: robot, name: names.hero,
        want: vi ? 'tự mình hoàn thành việc' : 'to finish the job alone',
        flaw: vi ? 'sợ nhờ vả, sợ bị coi là yếu' : 'afraid to ask, afraid of looking weak',
        manner: vi ? 'bước ngắn, tay hay lúng túng, nói nhỏ' : 'short steps, fidgety hands, speaks softly',
        signatureGesture: vi ? 'vẫy tay ngượng ngùng' : 'a shy little wave',
        ...(heroClip ? { signatureClip: heroClip } : {}), pitch: -2,
      },
      ...(n >= 3 || template === 'meet-cute'
        ? [{
            actorId: 'friend', assetId: fox, name: names.friend,
            want: vi ? 'tìm một người bạn đồng hành' : 'to find someone to travel with',
            flaw: vi ? 'nóng vội, hay chạy trước' : 'impatient, always runs ahead',
            manner: vi ? 'nhanh nhẹn, tò mò, nói nhanh' : 'quick, curious, talks fast',
            signatureGesture: vi ? 'chạy vòng quanh khi vui' : 'circles around when happy',
            ...(friendClip ? { signatureClip: friendClip } : {}), pitch: 4,
          }]
        : []),
    ],
    beats,
    motifs: [{ what: vi ? 'cái vẫy tay ngượng ngùng của Bốp' : "Bolt's shy wave", setupScene: 1, payoffScene: n }],
  };
}

// ----------------------------------------------------------------------------
// Orchestrator (the network call is injected so it stays testable; the SERVER builds the prompts)
// ----------------------------------------------------------------------------

export interface BibleWriteResult {
  bible: StoryBible;
  lint: BibleLint;
  source: 'ai' | 'local';
  /** Deterministic fixes + whether a revise round ran. */
  notes: string[];
}

export interface BibleAskRequest {
  /** Present on the revise round: the previous draft and the editor's findings. */
  draft?: StoryBible;
  findings?: BibleIssue[];
}

/**
 * Writes the story bible. `ask` is the LLM call (throws / returns junk → offline bible). Draft → fix → lint → at most one
 * revise round; the better of the two drafts wins, and a draft under half the pass mark falls back to the offline bible.
 */
export async function writeStoryBible(params: {
  prompt: string;
  intent: { sceneCount: number; kind: StoryboardKind };
  ask: (req: BibleAskRequest) => Promise<unknown>;
}): Promise<BibleWriteResult> {
  const { prompt, intent, ask } = params;
  const n = Math.max(2, intent.sceneCount);
  const notes: string[] = [];

  const finish = (raw: unknown): { bible: StoryBible; lint: BibleLint } | null => {
    const clean = sanitizeStoryBible(raw, n);
    if (!clean) return null;
    const fixed = autoFixStoryBible(clean, n);
    notes.push(...fixed.fixes);
    return { bible: fixed.bible, lint: lintStoryBible(fixed.bible, n) };
  };

  let best: { bible: StoryBible; lint: BibleLint } | null = null;
  try {
    best = finish(await ask({}));
  } catch {
    best = null;
  }
  if (best && best.lint.score < STORY_BIBLE_PASS_SCORE) {
    const before = best.lint.score;
    try {
      const revised = finish(await ask({ draft: best.bible, findings: bibleFindingsForRevision(best.lint) }));
      notes.push(`story editor revise round: ${before} → ${revised ? revised.lint.score : 'no usable answer'}`);
      if (revised && revised.lint.score > best.lint.score) best = revised;
    } catch {
      notes.push('story editor revise round failed');
    }
  }
  if (best && best.lint.score >= STORY_BIBLE_PASS_SCORE / 2) return { ...best, source: 'ai', notes };

  const local = buildLocalStoryBible(prompt, { sceneCount: n, kind: intent.kind });
  return { bible: local, lint: lintStoryBible(local, n), source: 'local', notes };
}

/**
 * Keeps characters consistent across scenes without trusting the model: an actor that is a bible character (same id, or the
 * only actor on that rig) gets the bible's voice pitch when it has none. Pure; returns the same spec object when nothing changes.
 */
/** Maps a stock-rig clip name onto the closest clip a generated model actually has ('Walk' -> 'walking', 'Run' -> 'running'). */
export function mapGeneratedClip(clip: string | undefined, clips: string[]): string | undefined {
  if (!clip || !clips.length) return undefined;
  const hit = clips.find((c) => c.toLowerCase() === clip.toLowerCase());
  if (hit) return hit;
  const w = clip.toLowerCase();
  const find = (re: RegExp) => clips.find((c) => re.test(c.toLowerCase()));
  if (/run|sprint|dash|chase/.test(w)) return find(/run|sprint/) || find(/walk/) || clips[0];
  return find(/walk/) || clips[0];
}

/**
 * Applies the bible to a freshly authored scene: voices, and generated models. The scene is written against the stand-in rig
 * (so the AI, the verifier and the offline director keep working on registry assets); here the actor of a character with a
 * generated model is pointed at that model, and every clip it asks for is mapped onto a clip the model really has.
 */
export function applyBibleToScene(spec: SceneSpec, bible: StoryBible | undefined): SceneSpec {
  if (!bible?.characters.length || !spec.actors?.length) return spec;
  let changed = false;
  const actors = spec.actors.map((a) => {
    const byId = bible.characters.find((c) => c.actorId === a.id);
    const sameRig = bible.characters.filter((c) => c.assetId === a.assetId);
    const character = byId || (sameRig.length === 1 && spec.actors.filter((x) => x.assetId === a.assetId).length === 1 ? sameRig[0] : undefined);
    if (!character) return a;
    let next = a;
    if (character.pitch !== undefined && a.voice?.pitch === undefined) {
      next = { ...next, voice: { ...(next.voice || {}), pitch: character.pitch } };
    }
    const gen = character.generated;
    if (gen?.modelUrl && next.modelUrl !== gen.modelUrl) {
      const clips = gen.clips || [];
      const map = (c?: string) => mapGeneratedClip(c, clips);
      const performance = next.performance?.map((st) => {
        const { clip, arriveClip, ...rest } = st;
        const mc = map(clip);
        const ma = map(arriveClip);
        return { ...rest, ...(mc ? { clip: mc } : {}), ...(ma ? { arriveClip: ma } : {}) };
      });
      const activeClip = map(next.activeClip) || (clips.length ? clips[0] : undefined);
      next = {
        ...next,
        modelUrl: gen.modelUrl,
        customGlbUrl: gen.modelUrl,
        availableClips: clips.length ? [...clips] : undefined,
        activeClip,
        ...(performance ? { performance } : {}),
      };
    }
    if (next !== a) changed = true;
    return next;
  });
  return changed ? { ...spec, actors } : spec;
}
