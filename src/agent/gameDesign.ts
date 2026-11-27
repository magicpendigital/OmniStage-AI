/**
 * Phase 4 — Game design document (GDD): the "game designer" step that runs BEFORE the level planner.
 *
 *   draft (LLM)  →  sanitize  →  autoFix (deterministic)  →  lint (rubric)  →  one revise round with the findings
 *
 * The design (genre, pitch, core loop, win / lose, the verbs the player uses, a per-level teaching ramp) is handed VERBATIM
 * to the level planner and to every level author, and it is attached to each scene so the intent-alignment verifier
 * (src/verification/intentAlignment.ts) can check "does this level really contain what the design promised?".
 *
 * Everything here is pure (no DOM, store or network); an offline design keeps the pipeline usable without any AI key.
 * It mirrors the Story Bible pipeline (src/agent/storyBible.ts) on purpose.
 */
import { lineLanguage } from '../audio/voices';
import { MAX_VARIABLES, VARIABLE_ID } from '../runtime/game/state';
import type { EngineType, GameDesign, GameDesignLevel, GameGenre, GameVerb, StoryboardKind } from '../types/scene.schema';

export const GAME_GENRES: GameGenre[] = ['platformer', 'survival', 'turret-dodge', 'key-hunt'];
export const GAME_VERBS: GameVerb[] = ['jump', 'collect', 'avoid-hazards', 'dodge-projectiles', 'unlock', 'survive'];
const WINS: GameDesign['win'][] = ['collect-all', 'score-threshold', 'survive-timer', 'variable-threshold'];
const LOSES: GameDesign['lose'][] = ['health', 'hazard-reset', 'timer'];
/** A design at or above this score goes to the planner as is; below it gets one revise round. */
export const GAME_DESIGN_PASS_SCORE = 80;
export const MAX_DESIGN_VERBS = 5;
export const MAX_DESIGN_VARIABLES = 4;

const VERB_HELP: Record<GameVerb, string> = {
  jump: 'jumping between platforms',
  collect: 'collecting pickups (coins, gems)',
  'avoid-hazards': 'avoiding hazards and enemies that touch the player',
  'dodge-projectiles': 'dodging projectiles fired by turrets',
  unlock: 'collecting counters (keys) that open a door / goal',
  survive: 'staying alive until a timer runs out',
};

function fold(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// ----------------------------------------------------------------------------
// Prompts (the server route builds them from structured data only)
// ----------------------------------------------------------------------------

export interface GameDesignIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface GameDesignLint {
  /** 0-100. */
  score: number;
  issues: GameDesignIssue[];
}

export function buildGameDesignSystemPrompt(levelCount: number): string {
  return `You are the GAME DESIGNER of a small 2D browser game studio. You write the game design document BEFORE any level exists. Answer with ONE JSON object, nothing else.

The engine can only run these verbs (use ONLY these ids in "mechanics", "introduces" and "uses"):
${GAME_VERBS.map((v) => `- ${v}: ${VERB_HELP[v]}`).join('\n')}
There is NO player shooting, pathfinding or melee yet: do not design around them.

JSON shape:
{
  "title": string,
  "genre": ${GAME_GENRES.map((g) => `"${g}"`).join(' | ')},
  "pitch": string (one sentence: what the player does and why it is fun, >= 6 words),
  "coreLoop": string (what the player repeats every few seconds, >= 5 words),
  "goal": string (player-facing goal),
  "win": ${WINS.map((w) => `"${w}"`).join(' | ')},
  "lose": ${LOSES.map((w) => `"${w}"`).join(' | ')},
  "mechanics": GameVerb[] (2-${MAX_DESIGN_VERBS} verbs the whole game uses),
  "usesHealth": boolean (true when damage, not instant respawn, is the failure),
  "timeLimitSeconds": number (required for win "survive-timer" or lose "timer", 10-300),
  "variables": [{ "id": string (letters/digits/_), "label": string }] (counters such as keys; max ${MAX_DESIGN_VARIABLES}; required for win "variable-threshold" and the verb "unlock"),
  "levels": exactly ${levelCount} items { "name": string, "teaches": string (the ONE new thing), "introduces": GameVerb[], "uses": GameVerb[] (cumulative), "difficulty": 1-5 }
}

Design rules:
- Teach ONE new verb per level; level 1 introduces at most one and is nearly impossible to fail.
- Every verb in "mechanics" must be introduced by some level. Difficulty rises across the levels; the last level is the hardest.
- "lose": "health" needs usesHealth true; "survive-timer" needs timeLimitSeconds; "variable-threshold" needs variables and the verb "unlock"; "collect-all" needs the verb "collect".
- Health only matters when something can hurt the player: pair usesHealth with "avoid-hazards" or "dodge-projectiles".
- Write in the language of the user's idea.`;
}

export function buildGameDesignUserPrompt(params: {
  prompt: string;
  levelCount: number;
  draft?: GameDesign;
  findings?: GameDesignIssue[];
}): string {
  const { prompt, levelCount, draft, findings } = params;
  const lines = [`Game idea: ${clip(prompt, 1200)}`, `Number of levels: ${levelCount}`];
  if (draft && findings?.length) {
    lines.push(
      '',
      'Your previous draft:',
      JSON.stringify(draft),
      '',
      'The editor found these problems; fix every one and keep what already works:',
      ...findings.map((f) => `- [${f.code}] ${f.message}`)
    );
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// Sanitize (untrusted JSON -> typed design) and deterministic auto-fix
// ----------------------------------------------------------------------------

function cleanVerbs(raw: unknown): GameVerb[] {
  const out: GameVerb[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    if (typeof v === 'string' && (GAME_VERBS as string[]).includes(v) && !out.includes(v as GameVerb)) out.push(v as GameVerb);
  }
  return out;
}

export function sanitizeGameDesign(raw: any, levelCount: number): GameDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const genre: GameGenre = GAME_GENRES.includes(raw.genre) ? raw.genre : 'platformer';
  const win: GameDesign['win'] = WINS.includes(raw.win) ? raw.win : 'collect-all';
  const lose: GameDesign['lose'] = LOSES.includes(raw.lose) ? raw.lose : 'hazard-reset';
  const variables: { id: string; label: string }[] = [];
  for (const v of Array.isArray(raw.variables) ? raw.variables : []) {
    const id = clip(v?.id, 32);
    if (!VARIABLE_ID.test(id) || variables.some((x) => x.id === id) || variables.length >= Math.min(MAX_DESIGN_VARIABLES, MAX_VARIABLES)) continue;
    variables.push({ id, label: clip(v?.label, 24) || id });
  }
  const limit = Number(raw.timeLimitSeconds);
  const n = Math.max(1, levelCount);
  const levels: GameDesignLevel[] = (Array.isArray(raw.levels) ? raw.levels : []).slice(0, n).map((l: any, i: number) => ({
    name: clip(l?.name, 40) || `Level ${i + 1}`,
    teaches: clip(l?.teaches, 120),
    introduces: cleanVerbs(l?.introduces),
    uses: cleanVerbs(l?.uses),
    difficulty: Math.max(1, Math.min(5, Math.round(Number(l?.difficulty) || 1))),
  }));
  const design: GameDesign = {
    title: clip(raw.title, 60),
    genre,
    pitch: clip(raw.pitch, 240),
    coreLoop: clip(raw.coreLoop, 200),
    goal: clip(raw.goal, 160),
    win,
    lose,
    mechanics: cleanVerbs(raw.mechanics),
    usesHealth: raw.usesHealth === true,
    levels,
  };
  if (Number.isFinite(limit) && limit > 0) design.timeLimitSeconds = Math.max(5, Math.min(600, Math.round(limit)));
  if (variables.length) design.variables = variables;
  // A design with no text at all is junk, not a draft.
  return design.pitch || design.coreLoop || design.mechanics.length ? design : null;
}

/** Forces the parts of the design that must be consistent: level count, cumulative verbs, each verb taught, a rising ramp. */
export function autoFixGameDesign(input: GameDesign, levelCount: number): { design: GameDesign; fixes: string[] } {
  const fixes: string[] = [];
  const n = Math.max(1, levelCount);
  const d: GameDesign = JSON.parse(JSON.stringify(input));

  if (!d.title) {
    d.title = d.pitch.split(/[.!?]/)[0].split(' ').slice(0, 4).join(' ') || 'Untitled game';
    fixes.push('title filled in');
  }
  if (d.lose === 'health' && !d.usesHealth) {
    d.usesHealth = true;
    fixes.push('usesHealth switched on (lose is "health")');
  }
  if ((d.win === 'survive-timer' || d.lose === 'timer') && !(d.timeLimitSeconds && d.timeLimitSeconds >= 5)) {
    d.timeLimitSeconds = 30;
    fixes.push('timeLimitSeconds set to 30');
  }
  if (d.win === 'variable-threshold' && !d.variables?.length) {
    d.variables = [{ id: 'keys', label: 'Keys' }];
    fixes.push('added the "keys" counter the win rule needs');
  }
  if (d.variables?.length && !d.mechanics.includes('unlock') && d.win === 'variable-threshold') {
    d.mechanics.push('unlock');
    fixes.push('added the "unlock" verb');
  }
  if (d.win === 'survive-timer' && !d.mechanics.includes('survive')) {
    d.mechanics.push('survive');
    fixes.push('added the "survive" verb');
  }
  if (d.win === 'collect-all' && !d.mechanics.includes('collect')) {
    d.mechanics.push('collect');
    fixes.push('added the "collect" verb');
  }
  d.mechanics = d.mechanics.slice(0, MAX_DESIGN_VERBS);

  // Level count
  while (d.levels.length < n) {
    d.levels.push({ name: `Level ${d.levels.length + 1}`, teaches: '', introduces: [], uses: [], difficulty: 1 });
    fixes.push(`level ${d.levels.length} added`);
  }
  if (d.levels.length > n) {
    d.levels = d.levels.slice(0, n);
    fixes.push(`levels trimmed to ${n}`);
  }
  // Every verb is taught by some level: spread untaught verbs over the levels that have no introduction yet.
  const taught = new Set(d.levels.flatMap((l) => l.introduces));
  const untaught = d.mechanics.filter((v) => !taught.has(v));
  untaught.forEach((v) => {
    const slot = d.levels.find((l) => !l.introduces.length) ?? d.levels[Math.min(d.levels.length - 1, d.mechanics.indexOf(v))];
    slot.introduces.push(v);
    fixes.push(`verb "${v}" is now introduced by "${slot.name}"`);
  });
  // Cumulative `uses`, limited to the design's verbs.
  const seen: GameVerb[] = [];
  for (const l of d.levels) {
    l.introduces = l.introduces.filter((v) => d.mechanics.includes(v));
    for (const v of [...l.introduces, ...l.uses]) if (d.mechanics.includes(v) && !seen.includes(v)) seen.push(v);
    const before = l.uses.join();
    l.uses = [...seen];
    if (before !== l.uses.join() && before) fixes.push(`"${l.name}" uses made cumulative`);
  }
  // A ramp that does not rise (flat, or the last level is not harder than the first) becomes a rising one.
  if (n >= 3 && d.levels[n - 1].difficulty <= d.levels[0].difficulty) {
    d.levels.forEach((l, i) => (l.difficulty = Math.round(1 + (4 * i) / (n - 1))));
    fixes.push('difficulty ramp added (it did not rise)');
  }
  return { design: d, fixes };
}

export function coerceGameDesign(raw: unknown, levelCount: number): GameDesign | undefined {
  const clean = sanitizeGameDesign(raw, Math.max(1, levelCount));
  return clean ? autoFixGameDesign(clean, Math.max(1, levelCount)).design : undefined;
}

// ----------------------------------------------------------------------------
// Lint: the design rubric
// ----------------------------------------------------------------------------

export function lintGameDesign(design: GameDesign, levelCount: number): GameDesignLint {
  const issues: GameDesignIssue[] = [];
  const add = (code: string, severity: GameDesignIssue['severity'], message: string) => issues.push({ code, severity, message });
  const verbs = new Set(design.mechanics);

  if (wordCount(design.pitch) < 6) add('design.pitch', 'error', 'The pitch must say what the player does and why it is fun (>= 6 words).');
  if (wordCount(design.coreLoop) < 5) add('design.core-loop', 'error', 'Describe the core loop: what the player repeats every few seconds (>= 5 words).');
  if (!design.goal.trim()) add('design.goal', 'error', 'Write the player-facing goal.');
  if (!design.title.trim()) add('design.title', 'warning', 'Give the game a title.');
  if (!design.mechanics.length) add('design.no-mechanics', 'error', `List the verbs the game uses (${GAME_VERBS.join(', ')}).`);
  if (design.mechanics.length > MAX_DESIGN_VERBS) add('design.too-many-verbs', 'warning', `Keep the game to ${MAX_DESIGN_VERBS} verbs or fewer.`);

  if (design.lose === 'health' && !design.usesHealth) add('design.lose-health', 'error', 'lose "health" needs usesHealth true.');
  if (design.usesHealth && !verbs.has('avoid-hazards') && !verbs.has('dodge-projectiles')) {
    add('design.health-never-hurts', 'warning', 'The player has health but nothing can hurt them: add "avoid-hazards" or "dodge-projectiles".');
  }
  if ((design.win === 'survive-timer' || design.lose === 'timer') && !(design.timeLimitSeconds && design.timeLimitSeconds >= 5)) {
    add('design.timer', 'error', 'A timed game needs timeLimitSeconds (>= 5).');
  }
  if (design.win === 'variable-threshold' && !design.variables?.length) add('design.win-variable', 'error', 'win "variable-threshold" needs a declared counter in "variables".');
  if (design.win === 'variable-threshold' && !verbs.has('unlock')) add('design.win-unlock', 'warning', 'win "variable-threshold" should use the verb "unlock".');
  if (design.win === 'collect-all' && !verbs.has('collect')) add('design.win-collect', 'error', 'win "collect-all" needs the verb "collect".');
  if (design.win === 'survive-timer' && !verbs.has('survive')) add('design.win-survive', 'warning', 'win "survive-timer" should use the verb "survive".');
  if (verbs.has('unlock') && !design.variables?.length) add('design.unlock-variable', 'error', 'The verb "unlock" needs a counter in "variables" (e.g. keys).');

  if (design.levels.length !== levelCount) add('design.levels-count', 'error', `The design has ${design.levels.length} levels but the game has ${levelCount}.`);
  const taught = new Set(design.levels.flatMap((l) => l.introduces));
  for (const v of design.mechanics) {
    if (!taught.has(v)) add('design.verb-never-taught', 'error', `The verb "${v}" is never introduced by a level.`);
  }
  design.levels.forEach((l, i) => {
    const n = i + 1;
    if (!l.teaches.trim()) add('design.level-teaches', 'warning', `Level ${n} must say what it teaches.`);
    // With fewer levels than verbs, teaching one verb per level is impossible: skip the pacing rules.
    if (design.levels.length < design.mechanics.length) return;
    if (l.introduces.length > 1) add('design.teach-one', 'warning', `Level ${n} introduces ${l.introduces.length} verbs; teach one at a time.`);
    if (i === 0 && l.introduces.length > 1) add('design.first-level-heavy', 'error', 'Level 1 must introduce at most one verb.');
  });
  if (levelCount >= 3) {
    const first = design.levels[0]?.difficulty ?? 1;
    const last = design.levels[levelCount - 1]?.difficulty ?? 1;
    if (last <= first) add('design.no-ramp', 'warning', 'Difficulty must rise: the last level has to be harder than the first.');
  }

  const penalty = issues.reduce((sum, i) => sum + (i.severity === 'error' ? 15 : 6), 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

/** Issues the designer must fix (the revise round). Warnings only count when the score is under the pass mark. */
export function gameDesignFindingsForRevision(lint: GameDesignLint): GameDesignIssue[] {
  return lint.score >= GAME_DESIGN_PASS_SCORE ? lint.issues.filter((i) => i.severity === 'error') : lint.issues;
}

// ----------------------------------------------------------------------------
// Offline design (no AI key): a real structure, so the pipeline still works
// ----------------------------------------------------------------------------

interface GenrePreset {
  genre: GameGenre;
  triggers: string[];
  win: GameDesign['win'];
  lose: GameDesign['lose'];
  usesHealth: boolean;
  timeLimitSeconds?: number;
  variables?: { id: string; label: string }[];
  /** Verbs in teaching order. */
  verbs: GameVerb[];
  en: { pitch: string; loop: string; goal: string; teaches: Partial<Record<GameVerb, string>>; names: string[] };
  vi: { pitch: string; loop: string; goal: string; teaches: Partial<Record<GameVerb, string>>; names: string[] };
}

const PRESETS: GenrePreset[] = [
  {
    genre: 'key-hunt',
    triggers: ['key', 'keys', 'door', 'chia khoa', 'cua', 'unlock', 'mo khoa', 'puzzle', 'giai do'],
    win: 'variable-threshold',
    lose: 'hazard-reset',
    usesHealth: false,
    variables: [{ id: 'keys', label: 'Keys' }],
    verbs: ['jump', 'collect', 'unlock', 'avoid-hazards'],
    en: {
      pitch: 'Hop across the level to find every key, then open the exit before the hazards get you.',
      loop: 'Jump to a platform, grab a key, dodge the hazard in the way',
      goal: 'Collect all the keys to open the exit',
      teaches: { jump: 'Jumping between platforms', collect: 'Keys are the goal: grab them', unlock: 'The exit only opens with enough keys', 'avoid-hazards': 'Hazards guard the last keys' },
      names: ['First Steps', 'Key Run', 'Locked Door', 'Hazard Alley', 'The Vault'],
    },
    vi: {
      pitch: 'Nhảy qua màn chơi để tìm đủ chìa khoá rồi mở cửa thoát trước khi bẫy chặn đường.',
      loop: 'Nhảy lên bệ, nhặt chìa khoá, né bẫy chắn đường',
      goal: 'Nhặt đủ chìa khoá để mở cửa thoát',
      teaches: { jump: 'Nhảy giữa các bệ', collect: 'Chìa khoá là mục tiêu: hãy nhặt', unlock: 'Cửa chỉ mở khi đủ chìa khoá', 'avoid-hazards': 'Bẫy canh giữ những chìa khoá cuối' },
      names: ['Bước đầu', 'Tìm chìa khoá', 'Cánh cửa khoá', 'Hành lang bẫy', 'Căn hầm'],
    },
  },
  {
    genre: 'turret-dodge',
    triggers: ['shoot', 'shooter', 'bullet', 'turret', 'ban', 'dan', 'projectile', 'dodge', 'ne dan', 'tru'],
    win: 'collect-all',
    lose: 'health',
    usesHealth: true,
    verbs: ['jump', 'collect', 'dodge-projectiles', 'avoid-hazards'],
    en: {
      pitch: 'Weave through turret fire to grab every coin while your health slowly runs out.',
      loop: 'Wait for a gap in the fire, dash to the next coin, jump over the hazard',
      goal: 'Collect every coin without losing all your health',
      teaches: { jump: 'Jumping between platforms', collect: 'Coins are the goal: grab them', 'dodge-projectiles': 'Turrets fire on a rhythm you can read', 'avoid-hazards': 'Spikes punish a careless landing' },
      names: ['Warm Up', 'First Shots', 'Crossfire', 'Spike Gauntlet', 'Bullet Hell Lite'],
    },
    vi: {
      pitch: 'Né đạn của các tháp pháo để nhặt đủ xu trong khi máu hao dần.',
      loop: 'Chờ khoảng hở giữa các loạt đạn, lao tới đồng xu kế tiếp, nhảy qua bẫy',
      goal: 'Nhặt hết xu mà không hết máu',
      teaches: { jump: 'Nhảy giữa các bệ', collect: 'Xu là mục tiêu: hãy nhặt', 'dodge-projectiles': 'Tháp pháo bắn theo nhịp có thể đọc được', 'avoid-hazards': 'Gai phạt cú tiếp đất ẩu' },
      names: ['Khởi động', 'Phát đạn đầu', 'Giao hoả', 'Hành lang gai', 'Mưa đạn'],
    },
  },
  {
    genre: 'survival',
    triggers: ['survive', 'survival', 'sinh ton', 'song sot', 'timer', 'wave', 'dem nguoc', 'chong chiu'],
    win: 'survive-timer',
    lose: 'health',
    usesHealth: true,
    timeLimitSeconds: 30,
    verbs: ['survive', 'avoid-hazards', 'collect', 'dodge-projectiles'],
    en: {
      pitch: 'Stay alive until the timer ends while hazards close in and pickups restore your score.',
      loop: 'Keep moving, dodge the threat, grab a pickup when it is safe',
      goal: 'Survive until the timer reaches zero',
      teaches: { survive: 'Stay alive until the timer ends', 'avoid-hazards': 'Hazards drain your health', collect: 'Pickups are worth the risk', 'dodge-projectiles': 'Turrets add moving danger' },
      names: ['Hold On', 'Closing In', 'Greed', 'Crossfire', 'Last Stand'],
    },
    vi: {
      pitch: 'Sống sót đến khi hết giờ trong lúc bẫy áp sát và vật phẩm giúp tăng điểm.',
      loop: 'Liên tục di chuyển, né nguy hiểm, nhặt vật phẩm khi an toàn',
      goal: 'Sống sót đến khi đồng hồ về 0',
      teaches: { survive: 'Sống sót đến khi hết giờ', 'avoid-hazards': 'Bẫy làm hao máu', collect: 'Vật phẩm đáng để mạo hiểm', 'dodge-projectiles': 'Tháp pháo thêm nguy hiểm di động' },
      names: ['Trụ vững', 'Bị áp sát', 'Tham lam', 'Giao hoả', 'Trận cuối'],
    },
  },
  {
    genre: 'platformer',
    triggers: [],
    win: 'collect-all',
    lose: 'hazard-reset',
    usesHealth: false,
    verbs: ['jump', 'collect', 'avoid-hazards'],
    en: {
      pitch: 'Jump across floating platforms to collect every coin and reach the end without touching a hazard.',
      loop: 'Run, jump to the next platform, grab a coin, dodge a hazard',
      goal: 'Collect every coin in the level',
      teaches: { jump: 'Jumping between platforms', collect: 'Coins are the goal: grab them', 'avoid-hazards': 'Hazards send you back to the checkpoint' },
      names: ['First Jump', 'Coin Trail', 'Spike Pit', 'Sky Steps', 'Grand Finale'],
    },
    vi: {
      pitch: 'Nhảy qua các bệ lơ lửng để nhặt hết xu và về đích mà không chạm bẫy.',
      loop: 'Chạy, nhảy sang bệ kế tiếp, nhặt xu, né bẫy',
      goal: 'Nhặt hết xu trong màn',
      teaches: { jump: 'Nhảy giữa các bệ', collect: 'Xu là mục tiêu: hãy nhặt', 'avoid-hazards': 'Bẫy đưa bạn về điểm hồi sinh' },
      names: ['Cú nhảy đầu', 'Đường xu', 'Hố gai', 'Bậc thang trời', 'Màn cuối'],
    },
  },
];

function presetForPrompt(prompt: string): GenrePreset {
  const text = ` ${fold(prompt)} `;
  return PRESETS.find((p) => p.triggers.some((t) => text.includes(` ${t} `) || (t.length > 4 && text.includes(t)))) ?? PRESETS[PRESETS.length - 1];
}

/** The genre the offline director picks for a prompt (keyword match, platformer by default). Genre kits are chosen from it. */
export function detectGameGenre(prompt: string): GameGenre {
  return presetForPrompt(prompt).genre;
}

export function buildLocalGameDesign(prompt: string, intent: { sceneCount: number }): GameDesign {
  const n = Math.max(1, intent.sceneCount);
  const vi = lineLanguage(prompt) === 'vi';
  const preset = presetForPrompt(prompt);
  const words = vi ? preset.vi : preset.en;
  const levels: GameDesignLevel[] = Array.from({ length: n }, (_, i) => {
    const verb = preset.verbs[i] ?? undefined;
    return {
      name: words.names[i % words.names.length] + (i >= words.names.length ? ` ${Math.floor(i / words.names.length) + 1}` : ''),
      teaches: verb ? words.teaches[verb] || '' : vi ? 'Kết hợp mọi thứ đã học' : 'Combine everything learned so far',
      introduces: verb ? [verb] : [],
      uses: [],
      difficulty: n === 1 ? 1 : Math.max(1, Math.min(5, Math.round(1 + (4 * i) / (n - 1)))),
    };
  });
  const GENRE_TITLES: Record<GameGenre, string> = { platformer: 'Platformer', survival: 'Survival', 'turret-dodge': 'Turret Dodge', 'key-hunt': 'Key Hunt' };
  const design: GameDesign = {
    title: (vi ? 'Game ' : '') + GENRE_TITLES[preset.genre],
    genre: preset.genre,
    pitch: words.pitch,
    coreLoop: words.loop,
    goal: words.goal,
    win: preset.win,
    lose: preset.lose,
    mechanics: preset.verbs.slice(0, Math.max(2, Math.min(preset.verbs.length, n + 1))),
    usesHealth: preset.usesHealth,
    levels,
  };
  if (preset.timeLimitSeconds) design.timeLimitSeconds = preset.timeLimitSeconds;
  if (preset.variables) design.variables = preset.variables;
  return autoFixGameDesign(design, n).design;
}

// ----------------------------------------------------------------------------
// Orchestration
// ----------------------------------------------------------------------------

export interface GameDesignWriteResult {
  design: GameDesign;
  lint: GameDesignLint;
  source: 'ai' | 'local';
  /** Deterministic fixes + whether a revise round ran. */
  notes: string[];
}

export interface GameDesignAskRequest {
  /** Present on the revise round: the previous draft and the editor's findings. */
  draft?: GameDesign;
  findings?: GameDesignIssue[];
}

/**
 * Writes the game design. `ask` is the LLM call (throws / returns junk → offline design). Draft → fix → lint → at most one
 * revise round; the better of the two drafts wins, and a draft under half the pass mark falls back to the offline design.
 */
export async function writeGameDesign(params: {
  prompt: string;
  intent: { sceneCount: number };
  ask: (req: GameDesignAskRequest) => Promise<unknown>;
}): Promise<GameDesignWriteResult> {
  const { prompt, intent, ask } = params;
  const n = Math.max(1, intent.sceneCount);
  const notes: string[] = [];

  const finish = (raw: unknown): { design: GameDesign; lint: GameDesignLint } | null => {
    const clean = sanitizeGameDesign(raw, n);
    if (!clean) return null;
    const fixed = autoFixGameDesign(clean, n);
    notes.push(...fixed.fixes);
    return { design: fixed.design, lint: lintGameDesign(fixed.design, n) };
  };

  let best: { design: GameDesign; lint: GameDesignLint } | null = null;
  try {
    best = finish(await ask({}));
  } catch {
    best = null;
  }
  if (best && best.lint.score < GAME_DESIGN_PASS_SCORE) {
    const before = best.lint.score;
    try {
      const revised = finish(await ask({ draft: best.design, findings: gameDesignFindingsForRevision(best.lint) }));
      notes.push(`design editor revise round: ${before} → ${revised ? revised.lint.score : 'no usable answer'}`);
      if (revised && revised.lint.score > best.lint.score) best = revised;
    } catch {
      notes.push('design editor revise round failed');
    }
  }
  if (best && best.lint.score >= GAME_DESIGN_PASS_SCORE / 2) return { ...best, source: 'ai', notes };

  const local = buildLocalGameDesign(prompt, { sceneCount: n });
  return { design: local, lint: lintGameDesign(local, n), source: 'local', notes };
}

// ----------------------------------------------------------------------------
// Text for the director / the review modal
// ----------------------------------------------------------------------------

/** The design as a prompt section. With `levelIndex`, the section for that level is spelled out. */
export function describeGameDesign(design: GameDesign, levelIndex?: number): string {
  const lines = [
    `GAME DESIGN "${design.title}" (${design.genre}): ${design.pitch}`,
    `Core loop: ${design.coreLoop}. Goal: ${design.goal}.`,
    `Win: ${design.win}${design.timeLimitSeconds ? ` (${design.timeLimitSeconds}s)` : ''}. Lose: ${design.lose}${design.usesHealth ? ' (the player has health)' : ''}.`,
    `Verbs: ${design.mechanics.join(', ')}.`,
  ];
  if (design.variables?.length) lines.push(`Counters (sceneSpec.variables): ${design.variables.map((v) => v.id).join(', ')}.`);
  const level = levelIndex !== undefined ? design.levels[levelIndex] : undefined;
  if (level) {
    lines.push(
      `THIS LEVEL (${levelIndex! + 1}/${design.levels.length}) "${level.name}": teaches "${level.teaches}"; introduces ${level.introduces.join(', ') || 'nothing new'}; contains ${level.uses.join(', ') || 'the basics'}; difficulty ${level.difficulty}/5. The level MUST contain every verb listed and nothing the player has not been taught yet.`
    );
  } else {
    design.levels.forEach((l, i) => lines.push(`Level ${i + 1} "${l.name}": ${l.teaches || '-'} [${l.introduces.join(', ') || '-'}] difficulty ${l.difficulty}/5`));
  }
  return lines.join('\n');
}

export function formatGameDesignSummary(design: GameDesign, score: number): string[] {
  return [
    `${design.title} · ${design.genre} · design score ${score}/100`,
    design.pitch,
    `Loop: ${design.coreLoop}`,
    `Win: ${design.win} · Lose: ${design.lose}${design.usesHealth ? ' · health' : ''}`,
    `Verbs: ${design.mechanics.join(', ')}`,
    ...design.levels.map((l, i) => `${i + 1}. ${l.name} — ${l.teaches || '—'} (${l.difficulty}/5)`),
  ];
}

// ----------------------------------------------------------------------------
// Review session (the modal at the app root; the chat produces the game when you approve)
// ----------------------------------------------------------------------------

export interface GameDesignSession {
  prompt: string;
  intent: { sceneCount: number; kind: StoryboardKind; engineType: EngineType };
  /** 'writing': the designer is working; 'review': read, edit and approve. */
  status: 'writing' | 'review';
  design?: GameDesign;
  score?: number;
  issues?: GameDesignIssue[];
  source?: 'ai' | 'local';
  notes: string[];
}

export function createGameDesignSession(params: { prompt: string; intent: GameDesignSession['intent'] }): GameDesignSession {
  return { prompt: params.prompt, intent: params.intent, status: 'writing', notes: [] };
}

/** Re-checks a design after you edited it (no auto-fix: what you typed stays; the fixes run when you approve). */
export function relintGameDesign(design: GameDesign, levelCount: number): { score: number; issues: GameDesignIssue[] } {
  const lint = lintGameDesign(design, levelCount);
  return { score: lint.score, issues: lint.issues };
}

/** The design that goes to production: your edits plus the mechanical consistency fixes. */
export function gameDesignForProduction(design: GameDesign, levelCount: number): GameDesign {
  return autoFixGameDesign(design, levelCount).design;
}
