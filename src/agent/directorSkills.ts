/**
 * Phase 4 — Director Skills: reusable, prompt-level know-how for the AI director.
 *
 * Inspired by Claude-Code / Hermes style skill files, but implemented natively for OmniStage:
 * - Built-in skills encode game & media craft (shot grammar, platformer level design, playable-ad hooks,
 *   kinetic typography, game juice/SFX) as SceneSpec-specific rules — never as executable code.
 * - Learned skills are distilled deterministically from a result the user approved ("Save as skill"),
 *   persisted in localStorage and re-injected when a similar prompt comes back.
 * Skills are selected per prompt and appended to the system prompt via `customSystemPrompt`, so the
 * server contract does not change.
 */
import type { DirectorSkill, EngineType, SceneSpec, StudioMode } from '../types/scene.schema';
import { MAX_GAP, MAX_STEP_UP } from '../verification/sceneVerifier';

export const BUILTIN_DIRECTOR_SKILLS: DirectorSkill[] = [
  {
    id: 'character-acting',
    title: 'Character Acting',
    description: 'Every character performs a small arc in each scene (performance steps), not a single looping clip.',
    triggers: ['phim', 'film', 'movie', 'nhân vật', 'character', 'story', 'câu chuyện', 'phiêu lưu', 'adventure', 'acting', 'diễn xuất', 'hoạt hình', 'cartoon'],
    engine: '3d',
    mode: 'media',
    source: 'builtin',
    guidance: `CHARACTER ACTING (actors[].performance):
- Each scene is a mini arc for the hero: a starting state, a change, a reaction. At least 3 different actions per scene,
  e.g. Sitting (0 s) → Standing (2 s) → walk with moveTo (3 s) → lookAt partner + Wave (6.5 s) → Yes / ThumbsUp (8.5 s).
- Motivate movement: walk TO something (a tree, the river, another character), then react there. Distances 2-5 m; ~1.2 m/s walking.
- Partners react: when the hero waves or speaks, the other actor lookAt the hero and answers (nod, run over, jump).
- Use only the asset's own clips (robot: Idle, Walking, Running, Sitting, Standing, Wave, Dance, Jump, Yes, No, ThumbsUp, Punch, Death;
  fox: Survey, Walk, Run). Non-rigged props use animation: 'bounce' | 'spin' | 'float'.
- Time the camera.shots to the actions: cut to a close-up right as the reaction happens.
- Put the key line of each action into captions (≤ 12 words, same start time) so the story reads even without sound.`,
  },
  {
    id: 'scene-dressing',
    title: 'Scene Dressing',
    description: 'Fill the frame with a believable place: terrain, layered props, sky, weather and light that match the story.',
    triggers: ['rừng', 'forest', 'bối cảnh', 'background', 'outdoor', 'núi', 'mountain', 'suối', 'river', 'biển', 'beach', 'thành phố', 'city', 'làng', 'village', 'đồi', 'hill', 'sa mạc', 'desert', 'tuyết', 'snow'],
    engine: '3d',
    mode: 'any',
    source: 'builtin',
    guidance: `SCENE DRESSING (sceneSpec.world + environment):
- Never leave a bare floor in a film: environment.groundGrid = false, reflectivePedestal = false; set world.terrain to the place
  (forest/hills → 'grassy-hills', snow → 'snow-mountains', coast → 'ocean-island', city → 'city-asphalt', desert → 'desert-dunes').
- Layer props: one dense layer (count 30-60, spreadRadius 18-26) + one accent layer (count 8-16), e.g. pine-trees + rocks-boulders.
- Sky, light and weather tell the time: morning 'daylight-sky' + clear; evening 'sunset-atmosphere' + 'floating-embers' (fireflies);
  night 'night-stars' + sparkles VFX near the characters. Progress the time of day across scenes.
- Add 1-2 vfx accents where the action is (sparkles on magic, shockwave on a landing), with startTime at that moment.`,
  },
  {
    id: 'cinematic-shot-grammar',
    title: 'Cinematic Shot Grammar',
    description: 'Script beat → shot list → camera keyframes with motivated easing.',
    triggers: ['cinematic', 'film', 'movie', 'trailer', 'shot', 'cutscene', 'phim', 'điện ảnh', 'cảnh quay', 'quay', 'teaser'],
    engine: '3d',
    mode: 'media',
    source: 'builtin',
    guidance: `CINEMATIC SHOT GRAMMAR (media scenes — use camera.shots, not camera.mode):
- Open the film with an 'establishing' shot (2-3 s, often move 'crane-up' or 'pull-out'), then cut closer: wide → medium → close-up.
- Change shot every 2-4 s and whenever the action changes; a 10 s scene has 3-4 shots. Never hold one framing for a whole scene.
- Emotion = 'close-up' (move 'push-in'); dialogue between two actors = alternating 'over-shoulder' shots (subject + partner);
  walking = 'tracking' or 'wide'; power / awe = 'low-angle'; loneliness / overview = 'high-angle'.
- Keep the 180° rule: when two actors face each other, keep angle on the same side ('three-quarter-left' for both, or right for both).
- Vary scene to scene: do not open every scene with the same shot type; end the film on a 'pull-out' or 'crane-up'.
- Transition into the next scene: 'cut' for continuous action, 'fade' for a time / place jump, 'fade-white' for dreams or magic.`,
  },
  {
    id: 'platformer-level-design',
    title: 'Platformer Level Design',
    description: 'Beatable 2D platformer layouts that respect the real jump physics.',
    triggers: ['platformer', 'level', 'màn', 'jump', 'nhảy', 'mario', 'side-scroller', 'game 2d', '2d game', 'coin', 'xu', 'collect'],
    engine: '2d',
    mode: 'game',
    source: 'builtin',
    guidance: `PLATFORMER LEVEL DESIGN (2D engine, 1000x600 stage, y grows downward):
- Physics envelope: maximum step-up between platform tops is ${MAX_STEP_UP}px, maximum horizontal gap ${MAX_GAP}px. Stay well under both for the first level.
- Always include a 'static-platform' ground under the player's start (x≈80-120) and one 'player-platformer' node.
- Teach → test → twist: first collectible on the ground, second needs one jump, third combines a gap and a step-up.
- Place collectibles 50-90px above the surface they belong to; never inside platforms.
- gameRules.targetScore must be ≤ the sum of collectible scoreValue (default 25 each).
- Use 'bouncing' nodes as moving hazards only after the player has learned to jump.`,
  },
  {
    id: 'playable-ad-hook',
    title: 'Playable Ad Hook & CTA',
    description: 'First-3-seconds hook, 15-30s loop and a well-timed CTA for ad networks.',
    triggers: ['playable', 'ad', 'ads', 'quảng cáo', 'cta', 'tiktok', 'meta', 'campaign', 'install', 'promo', 'khuyến mãi', 'marketing'],
    engine: 'any',
    mode: 'any',
    source: 'builtin',
    guidance: `PLAYABLE AD HOOK & CTA:
- The first 3 seconds must show the core interaction (a tappable collectible or a moving hero) — no idle intros.
- Keep gameRules.timeLimitSeconds between 15 and 30 and targetScore reachable in under 10 seconds of play.
- marketingOverlay: short headline (≤ 5 words), ctaText as a verb ("Play Now", "Get It", "Chơi ngay"), triggerCondition 'on-win' for games or 'after-3s' for media.
- Add a celebratory 'confetti' VFX near the end and set audio cues win:'win', collect:'coin' so the reward is felt.
- Never rely on window.open/alert — CTA is handled by the exporter's network bridge.`,
  },
  {
    id: 'kinetic-typography',
    title: 'Kinetic Typography',
    description: 'Motion-graphics text with rhythmic easing and readable timing.',
    triggers: ['typography', 'kinetic', 'text', 'chữ', 'title', 'tiêu đề', 'lyric', 'motion graphic', 'intro', 'logo'],
    engine: '2d',
    mode: 'media',
    source: 'builtin',
    guidance: `KINETIC TYPOGRAPHY (2D engine):
- Use 'text-kinetic' nodes, one idea per node, ≤ 4 words each, fontSize 48-96 for headlines.
- Animate with keyframeTrack: entrance 0.3-0.6s with ease 'back.out' or 'expo.out', hold ≥ 1.2s for reading, exit with 'power2.inOut'.
- Offset entrances by 0.15-0.25s to create rhythm; keep text inside x 80-920, y 80-520.
- Contrast: light fill on dark background (or vice versa); add a 'parallax-layer' backdrop for depth.
- Mirror the spoken/written message in sceneSpec.captions (style 'title' for the hero line, 'subtitle' for the rest).
- Accent reveals with a 'particle-emitter' (preset 'sparkle' or 'magic-trail') behind the headline.`,
  },
  {
    id: 'game-juice',
    title: 'Game Juice & SFX',
    description: 'Feedback loops: procedural SFX cues, bursts and squash for every player action.',
    triggers: ['juice', 'sfx', 'sound', 'âm thanh', 'tiếng', 'audio', 'feedback', 'fun', 'vui', 'hiệu ứng', 'effect'],
    engine: 'any',
    mode: 'game',
    source: 'builtin',
    guidance: `GAME JUICE & PROCEDURAL SFX:
- Set sceneSpec.audio = { enabled: true, masterVolume: 0.6, cues: { collect, jump, hit, win, lose, click, 'scene-start' } }.
- Available presets: 'coin' | 'jump' | 'hit' | 'powerup' | 'explosion' | 'laser' | 'win' | 'lose' | 'click' | 'whoosh' | 'none'.
- Pair every scoring action with a sound AND a visual (sparkles/confetti VFX or bouncing animation).
- Use 'powerup' for rare high-value collectibles, 'whoosh' for scene-start in fast-paced games.
- 2D: place a small 'particle-emitter' (preset 'sparkle') on high-value collectibles and 'confetti' near the goal; use 'fire'/'smoke' for hazards.`,
  },
];

const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'that', 'this', 'from', 'into', 'make', 'create', 'add', 'scene', 'please',
  'một', 'các', 'những', 'cho', 'với', 'của', 'và', 'tạo', 'thêm', 'hãy', 'trong', 'là', 'có', 'được', 'cảnh',
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lower-case keywords from a prompt (keeps Vietnamese diacritics, drops stopwords/short tokens). */
export function extractKeywords(prompt: string, max = 8): string[] {
  const tokens = normalize(prompt)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([t]) => t);
}

export interface SkillSelectionContext {
  engineType: EngineType;
  mode: StudioMode;
}

export function scoreSkill(skill: DirectorSkill, prompt: string, ctx: SkillSelectionContext): number {
  const text = ` ${normalize(prompt)} `;
  let hits = 0;
  for (const trigger of skill.triggers) {
    const t = normalize(trigger);
    if (!t) continue;
    if (t.includes(' ') ? text.includes(t) : new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(text)) hits++;
  }
  if (hits === 0) return 0;
  let score = hits * 10;
  if (skill.engine === ctx.engineType) score += 4;
  else if (skill.engine !== 'any') score -= 6;
  if (skill.mode === ctx.mode) score += 3;
  else if (skill.mode !== 'any') score -= 2;
  if (skill.source === 'learned') score += 2 + Math.min(3, skill.uses || 0); // proven recipes rank higher
  return score;
}

/** Picks up to `max` skills relevant to the prompt (deterministic, ties broken by id). */
export function selectDirectorSkills(
  prompt: string,
  ctx: SkillSelectionContext,
  learned: DirectorSkill[] = [],
  max = 3,
  disabled: string[] = []
): DirectorSkill[] {
  return [...BUILTIN_DIRECTOR_SKILLS.filter((s) => !disabled.includes(s.id)), ...learned]
    .map((skill) => ({ skill, score: scoreSkill(skill, prompt, ctx) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, max)
    .map((s) => s.skill);
}

/** Text appended to `customSystemPrompt` for the selected skills. */
export function buildSkillContext(skills: DirectorSkill[]): string {
  if (!skills.length) return '';
  return `ACTIVE DIRECTOR SKILLS (follow these rules strictly; they encode proven OmniStage recipes):\n\n${skills
    .map((s) => `### ${s.title} [${s.source}]\n${s.guidance}`)
    .join('\n\n')}`;
}

export function mergeSystemPrompt(customSystemPrompt: string | undefined, skills: DirectorSkill[], extra: string[] = []): string {
  return [customSystemPrompt?.trim(), buildSkillContext(skills), ...extra.map((e) => e.trim())].filter(Boolean).join('\n\n');
}

/** Structural fingerprint of a scene, used as the "recipe" part of a learned skill. */
export function describeSceneRecipe(spec: SceneSpec): string {
  const lines: string[] = [`- Engine ${spec.engineType.toUpperCase()}, mode ${spec.mode}, aspect ${spec.aspectRatio}, duration ${spec.durationSeconds}s.`];
  if (spec.engineType === '2d') {
    const roles = new Map<string, number>();
    for (const n of spec.nodes2D || []) roles.set(n.physics2D, (roles.get(n.physics2D) || 0) + 1);
    lines.push(`- nodes2D by role: ${[...roles.entries()].map(([r, c]) => `${r}×${c}`).join(', ') || 'none'}.`);
    const animated = (spec.nodes2D || []).filter((n) => n.keyframeTrack?.length);
    if (animated.length) {
      const eases = new Set(animated.flatMap((n) => n.keyframeTrack!.map((k) => k.ease || 'linear')));
      lines.push(`- ${animated.length} keyframed node(s), eases: ${[...eases].join(', ')}.`);
    }
  } else {
    const assets = new Map<string, number>();
    for (const a of spec.actors || []) assets.set(`${a.assetId}/${a.physicsRole}`, (assets.get(`${a.assetId}/${a.physicsRole}`) || 0) + 1);
    lines.push(`- actors: ${[...assets.entries()].map(([k, c]) => `${k}×${c}`).join(', ') || 'none'}.`);
    lines.push(`- camera ${spec.camera?.mode}${spec.camera?.keyframes?.length ? ` with ${spec.camera.keyframes.length} keyframes` : ''}, fov ${spec.camera?.fov}.`);
    if (spec.world) lines.push(`- world: terrain ${spec.world.terrain?.type}, skybox ${spec.world.skybox}, weather ${spec.world.weather?.type}.`);
  }
  if (spec.vfx?.length) lines.push(`- vfx: ${[...new Set(spec.vfx.map((v) => v.type))].join(', ')}.`);
  if (spec.mode === 'game' && spec.gameRules) {
    lines.push(`- gameRules: ${spec.gameRules.winCondition}, targetScore ${spec.gameRules.targetScore}, ${spec.gameRules.timeLimitSeconds}s.`);
  }
  if (spec.audio?.enabled) {
    lines.push(`- audio cues: ${Object.entries(spec.audio.cues).map(([e, c]) => `${e}=${c}`).join(', ')}.`);
  }
  if (spec.marketingOverlay?.enabled) lines.push(`- CTA "${spec.marketingOverlay.ctaText}" (${spec.marketingOverlay.triggerCondition}).`);
  if (spec.logicGraph?.nodes?.length) lines.push(`- logic graph: ${spec.logicGraph.nodes.length} nodes / ${spec.logicGraph.edges.length} edges.`);
  return lines.join('\n');
}

/**
 * Distils a learned skill from a prompt + the approved resulting scene (Hermes-style self-accumulated skill).
 * Deterministic: no model call, so it works offline and is reproducible.
 */
export function distillLearnedSkill(prompt: string, spec: SceneSpec, title?: string): DirectorSkill {
  const triggers = extractKeywords(prompt, 6);
  const name = title?.trim() || spec.title || triggers.slice(0, 3).join(' ') || 'Learned recipe';
  return {
    id: `learned-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: name.slice(0, 60),
    description: `Learned from: "${prompt.slice(0, 90)}${prompt.length > 90 ? '…' : ''}"`,
    triggers,
    engine: spec.engineType,
    mode: spec.mode,
    source: 'learned',
    createdAt: new Date().toISOString(),
    uses: 0,
    guidance: `APPROVED RECIPE "${name}" — the user approved a scene built for a similar request. Reproduce this structure unless the new prompt says otherwise:\n${describeSceneRecipe(spec)}`,
  };
}

export const LEARNED_SKILLS_STORAGE_KEY = 'omnistage-learned-director-skills';
export const MAX_LEARNED_SKILLS = 24;

export function loadLearnedSkills(): DirectorSkill[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LEARNED_SKILLS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.id && s.guidance && Array.isArray(s.triggers)) : [];
  } catch {
    return [];
  }
}

export function persistLearnedSkills(skills: DirectorSkill[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LEARNED_SKILLS_STORAGE_KEY, JSON.stringify(skills.slice(0, MAX_LEARNED_SKILLS)));
  } catch {
    // storage full / disabled — skills stay in memory for this session
  }
}

/** Engine/mode the prompt is asking for, falling back to the current scene (e.g. "game 2D" on a 3D scene → 2d/game). */
export function inferSkillContext(prompt: string, current: SkillSelectionContext): SkillSelectionContext {
  const text = normalize(prompt);
  const engineType: EngineType = /\b2d\b|vector|platformer|side-scroller/.test(text)
    ? '2d'
    : /\b3d\b|webgl|gltf|glb/.test(text)
      ? '3d'
      : current.engineType;
  const mode: StudioMode = /\b(game|level|playable|score|điểm|trò chơi)\b|màn chơi|\d+\s*màn/u.test(text)
    ? 'game'
    : /\b(film|movie|video|trailer|cinematic|phim|typography|intro)\b/u.test(text)
      ? 'media'
      : current.mode;
  return { engineType, mode };
}
