/**
 * Multi-Step Storyboard & Multi-Level Generation Pipeline
 *
 *   STEP 0  detectStoryboardIntent()   — "phim 3D gồm 3 cảnh", "game 2D 3 màn", "5-level platformer"...
 *   STEP 1  plan                        — /api/agent/storyboard/plan (Gemini) or buildLocalStoryboardPlan()
 *   STEP 2  scene 1..N (sequential)     — /api/agent/storyboard/scene with a continuity summary of the
 *                                         scenes already authored, or buildLocalSceneForBeat()
 *   STEP 3  normalize + link            — normalizeGeneratedSceneSpec() then the store links nextSceneId
 *
 * Every generated scene is a declarative SceneSpec; nothing here emits imperative renderer code.
 */
import { resolvePerformance } from '../runtime/cinematics';
import { describeReportForModel, PatchProposal, runPatchLoop } from './patchLoop';
import { MEDIA_CRAFT_CODES, mediaQualityPenalty } from '../verification/sceneVerifier';
import {
  ASSET_REGISTRY,
  createBlankSceneSpec,
  DEFAULT_WORLD_SPEC,
  LIGHTING_PRESETS,
} from '../registry/assetRegistry';
import {
  ActorNode,
  CameraMode,
  EngineType,
  LightingPresetId,
  Node2D,
  SceneSpec,
  SettingsConfig,
  SkyboxPreset,
  StoryboardBeat,
  StoryboardKind,
  StoryboardPlan,
  TerrainType,
  VFXNode,
  WeatherType,
  WorldSpec,
} from '../types/scene.schema';
import { autoFixSceneSpec } from '../verification/sceneVerifier';
import { aiHeaders } from './aiClient';

export const MIN_STORYBOARD_SCENES = 2;
export const MAX_STORYBOARD_SCENES = 8;

export interface StoryboardIntent {
  sceneCount: number;
  kind: StoryboardKind;
  engineType: EngineType;
}

export interface StoryboardProgress {
  phase: 'planning' | 'generating';
  completed: number;
  total: number;
  label: string;
}

export interface StoryboardGenerationCallbacks {
  onPlan?: (plan: StoryboardPlan, source: 'gemini' | 'local') => void;
  onProgress?: (progress: StoryboardProgress) => void;
  /** Called as soon as each scene is ready, in order, so the UI can show scenes appearing live. */
  onScene?: (scene: SceneSpec, index: number, source: 'gemini' | 'local') => void;
}

export interface StoryboardGenerationResult {
  storyboardId: string;
  plan: StoryboardPlan;
  scenes: SceneSpec[];
  assistantMessage: string;
  diffSummary: string[];
  source: 'gemini' | 'local' | 'mixed';
}

// ----------------------------------------------------------------------------
// STEP 0: Intent detection (Vietnamese + English, with or without diacritics)
// ----------------------------------------------------------------------------

function foldText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

const NUMBER_WORDS: Record<string, number> = {
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

const UNIT_PATTERN =
  '(?:phan\\s+canh|canh\\s+phim|man\\s+choi|canh|man|level|levels|scene|scenes|shot|shots|chapter|chapters|chuong|tap|stage|stages|episode|episodes|act|acts|màn)';

const GAME_HINTS = [
  'game',
  'level',
  'man choi',
  'platformer',
  'vuot chuong ngai',
  'chuong ngai',
  'obstacle',
  'playable',
  'tro choi',
  'stage',
];
const FILM_HINTS = ['phim', 'film', 'movie', 'cinematic', 'trailer', 'short', 'canh', 'shot', 'story', 'cau chuyen'];
const AD_HINTS = ['quang cao', 'commercial', ' ad ', 'ads', 'tvc', 'promo'];

export function detectStoryboardIntent(prompt: string): StoryboardIntent | null {
  const text = ` ${foldText(prompt)} `;

  let sceneCount: number | null = null;
  const numberMatch = text.match(new RegExp(`(\\d+)\\s*-?\\s*${UNIT_PATTERN}\\b`));
  if (numberMatch) sceneCount = parseInt(numberMatch[1], 10);

  if (sceneCount === null) {
    const wordAlternation = Object.keys(NUMBER_WORDS).join('|');
    const wordMatch = text.match(new RegExp(`\\b(${wordAlternation})\\s+${UNIT_PATTERN}\\b`));
    if (wordMatch) sceneCount = NUMBER_WORDS[wordMatch[1]];
  }

  const explicitStoryboard = /storyboard|multi-scene|multi scene|nhieu canh|nhieu man|chuoi canh/.test(text);
  if (sceneCount === null && explicitStoryboard) sceneCount = 3;
  if (sceneCount === null || sceneCount < MIN_STORYBOARD_SCENES) return null;
  sceneCount = Math.min(sceneCount, MAX_STORYBOARD_SCENES);

  const isGame = GAME_HINTS.some((h) => text.includes(h));
  const isAd = AD_HINTS.some((h) => text.includes(h));
  const isFilm = FILM_HINTS.some((h) => text.includes(h));
  const kind: StoryboardKind = isGame ? 'game-levels' : isAd && !isFilm ? 'ad-sequence' : 'film';

  const says2D = /\b2d\b|platformer|vector|sprite|side-scroll|side scroll/.test(text);
  const says3D = /\b3d\b|webgl/.test(text);
  const engineType: EngineType = says2D && !says3D ? '2d' : says3D ? '3d' : kind === 'game-levels' ? '2d' : '3d';

  return { sceneCount, kind, engineType };
}

// ----------------------------------------------------------------------------
// STEP 3 helper: Normalize partial / AI-authored SceneSpecs into valid contracts
// ----------------------------------------------------------------------------

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function normalizeActor(raw: any, index: number, durationSeconds: number): ActorNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = ASSET_REGISTRY[raw.assetId] ?? ASSET_REGISTRY['starter-primitive-showcase'];
  if (!entry) return null;
  const clips: string[] | undefined = Array.isArray(raw.availableClips)
    ? raw.availableClips
    : entry.embeddedClips
      ? [...entry.embeddedClips]
      : undefined;
  const activeClip =
    typeof raw.activeClip === 'string' && (!clips || clips.includes(raw.activeClip))
      ? raw.activeClip
      : entry.defaultClip;
  return {
    // Phase 10A: keep the model's id so camera.shots / performance lookAt references stay valid (duplicates are
    // renamed by the verifier's ids.duplicate fix).
    id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : uid(`actor-${index}`),
    name: str(raw.name, entry.name),
    assetId: entry.assetId,
    performance: Array.isArray(raw.performance)
      ? raw.performance.filter((st: any) => st && typeof st === 'object' && Number.isFinite(Number(st.time))).map((st: any) => ({ ...st, time: Number(st.time) })).slice(0, 24)
      : undefined,
    modelUrl: raw.customGlbUrl ? str(raw.modelUrl, raw.customGlbUrl) : entry.modelUrl,
    customGlbUrl: typeof raw.customGlbUrl === 'string' ? raw.customGlbUrl : undefined,
    position: isVec3(raw.position) ? [raw.position[0], 0, raw.position[2]] : [index * 1.8 - 1.8, 0, 0],
    rotation: isVec3(raw.rotation) ? raw.rotation : [0, 0, 0],
    scale: isVec3(raw.scale) ? raw.scale : [1, 1, 1],
    primaryColor: str(raw.primaryColor, entry.defaultPrimaryColor),
    secondaryColor: str(raw.secondaryColor, entry.defaultSecondaryColor),
    metalness: num(raw.metalness, entry.defaultMetalness),
    roughness: num(raw.roughness, entry.defaultRoughness),
    activeAnimation: entry.supportedAnimations.includes(raw.activeAnimation)
      ? raw.activeAnimation
      : entry.defaultAnimation,
    activeClip,
    availableClips: clips,
    animationSpeed: num(raw.animationSpeed, 1),
    physicsRole: str(raw.physicsRole, entry.defaultPhysicsRole) as ActorNode['physicsRole'],
    onClickAction: str(raw.onClickAction, entry.defaultClickAction) as ActorNode['onClickAction'],
    scoreValue: num(raw.scoreValue, entry.defaultScoreValue),
    startTime: num(raw.startTime, 0),
    endTime: num(raw.endTime, durationSeconds),
    enterEffect: raw.enterEffect ?? 'pop-in',
    visible: raw.visible !== false,
  };
}

function normalizeNode2D(raw: any, index: number): Node2D | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    ...raw,
    id: uid(`node2d-${index}`),
    name: str(raw.name, `Node ${index + 1}`),
    type: str(raw.type, 'vector-shape') as Node2D['type'],
    x: num(raw.x, 500),
    y: num(raw.y, 300),
    width: Math.max(4, num(raw.width, 48)),
    height: Math.max(4, num(raw.height, 48)),
    rotation: num(raw.rotation, 0),
    scaleX: num(raw.scaleX, 1),
    scaleY: num(raw.scaleY, 1),
    opacity: num(raw.opacity, 1),
    fill: str(raw.fill, '#06B6D4'),
    stroke: str(raw.stroke, '#F8FAFC'),
    physics2D: str(raw.physics2D, 'none') as Node2D['physics2D'],
  };
}

export function normalizeGeneratedSceneSpec(raw: any, fallbackEngine: EngineType): SceneSpec {
  const engineType: EngineType = raw?.engineType === '2d' || raw?.engineType === '3d' ? raw.engineType : fallbackEngine;
  const base = createBlankSceneSpec(engineType);
  if (!raw || typeof raw !== 'object') return base;

  const durationSeconds = Math.min(30, Math.max(3, num(raw.durationSeconds, base.durationSeconds)));
  const rawWorld = (raw.world ?? {}) as Partial<WorldSpec>;
  const world: WorldSpec = {
    ...DEFAULT_WORLD_SPEC,
    ...rawWorld,
    sunPosition: isVec3(rawWorld.sunPosition) ? rawWorld.sunPosition : DEFAULT_WORLD_SPEC.sunPosition,
    clouds: { ...DEFAULT_WORLD_SPEC.clouds, ...(rawWorld.clouds ?? {}) },
    terrain: { ...DEFAULT_WORLD_SPEC.terrain, ...(rawWorld.terrain ?? {}) },
    weather: { ...DEFAULT_WORLD_SPEC.weather, ...(rawWorld.weather ?? {}) },
    scatterObjects: Array.isArray(rawWorld.scatterObjects)
      ? rawWorld.scatterObjects.map((l: any, i: number) => ({
          id: uid(`scatter-${i}`),
          type: l.type ?? 'pine-trees',
          count: Math.min(80, Math.max(1, num(l.count, 16))),
          spreadRadius: num(l.spreadRadius, 18),
          scaleRange: Array.isArray(l.scaleRange) && l.scaleRange.length === 2 ? l.scaleRange : [0.8, 1.4],
          color: l.color,
        }))
      : [],
  };

  const presetId = (raw.environment?.presetId as LightingPresetId) || base.environment.presetId;
  const environment = {
    ...(LIGHTING_PRESETS[presetId] ?? base.environment),
    ...(raw.environment ?? {}),
    presetId: LIGHTING_PRESETS[presetId] ? presetId : base.environment.presetId,
  };

  const rawCam = raw.camera ?? {};
  const camera = {
    ...base.camera,
    ...rawCam,
    position: isVec3(rawCam.position) ? rawCam.position : base.camera.position,
    target: isVec3(rawCam.target) ? rawCam.target : base.camera.target,
    fov: num(rawCam.fov, base.camera.fov),
    keyframes: Array.isArray(rawCam.keyframes)
      ? rawCam.keyframes.filter((k: any) => k && isVec3(k.position) && isVec3(k.target))
      : base.camera.keyframes,
  };

  const actors = Array.isArray(raw.actors)
    ? raw.actors.map((a: any, i: number) => normalizeActor(a, i, durationSeconds)).filter(Boolean)
    : engineType === '3d'
      ? base.actors
      : [];

  let nodes2D = Array.isArray(raw.nodes2D)
    ? raw.nodes2D.map((n: any, i: number) => normalizeNode2D(n, i)).filter(Boolean)
    : [];
  if (engineType === '2d' && nodes2D.length === 0) nodes2D = base.nodes2D.map((n, i) => normalizeNode2D(n, i)!);

  const vfx: VFXNode[] = Array.isArray(raw.vfx)
    ? raw.vfx
        .filter((v: any) => v && typeof v.type === 'string')
        .map((v: any, i: number) => ({
          ...v,
          id: uid(`vfx-${i}`),
          name: str(v.name, v.type),
          position: isVec3(v.position) ? v.position : [0, 1.5, 0],
          color: str(v.color, '#38BDF8'),
          intensity: num(v.intensity, 1),
        }))
    : [];

  return {
    ...base,
    title: str(raw.title, base.title),
    description: str(raw.description, base.description),
    engineType,
    mode: raw.mode === 'game' || raw.mode === 'media' ? raw.mode : base.mode,
    aspectRatio: ['16:9', '9:16', '1:1'].includes(raw.aspectRatio) ? raw.aspectRatio : base.aspectRatio,
    durationSeconds,
    environment,
    world,
    camera,
    actors: actors as ActorNode[],
    nodes2D: nodes2D as Node2D[],
    vfx,
    marketingOverlay: { ...base.marketingOverlay, ...(raw.marketingOverlay ?? {}) },
    gameRules: { ...base.gameRules, ...(raw.gameRules ?? {}) },
    timelineTracks: Array.isArray(raw.timelineTracks) ? raw.timelineTracks : base.timelineTracks,
  };
}

// ----------------------------------------------------------------------------
// Deterministic local planner + scene builders (offline / no API key fallback)
// ----------------------------------------------------------------------------

const FILM_ARC = [
  { beat: 'Establishing shot', title: 'Opening Vista' },
  { beat: 'Hero introduction', title: 'The Hero Appears' },
  { beat: 'Rising action', title: 'The Journey Begins' },
  { beat: 'Conflict escalates', title: 'Storm on the Horizon' },
  { beat: 'Climax', title: 'The Showdown' },
  { beat: 'Aftermath', title: 'Quiet After the Storm' },
  { beat: 'Resolution', title: 'Homecoming' },
  { beat: 'Epilogue', title: 'Under the Stars' },
];

function pickFilmArc(count: number) {
  if (count <= 2) return [FILM_ARC[0], FILM_ARC[4]];
  if (count === 3) return [FILM_ARC[0], FILM_ARC[4], FILM_ARC[6]];
  if (count === 4) return [FILM_ARC[0], FILM_ARC[2], FILM_ARC[4], FILM_ARC[6]];
  return FILM_ARC.slice(0, count);
}

export function buildLocalStoryboardPlan(prompt: string, intent: StoryboardIntent): StoryboardPlan {
  const n = intent.sceneCount;
  if (intent.kind === 'game-levels') {
    const engine = intent.engineType;
    return {
      storyboardTitle: engine === '2d' ? 'Neon Obstacle Run' : '3D Collector Quest',
      kind: 'game-levels',
      engineType: engine,
      beats: Array.from({ length: n }, (_, i) => ({
        title: `Level ${i + 1} · ${['Warm-Up Run', 'Gap Jumper', 'Sky Stairs', 'Pit Gauntlet', 'Tower Climb', 'Night Sprint', 'Final Ascent', 'Boss Rush'][i] ?? 'Challenge'}`,
        description:
          i === 0
            ? 'A gentle opening course to learn jumping and collecting stars.'
            : `Harder course: ${i + 1}x the pits, narrower ledges and a tighter timer.`,
        engineType: engine,
        mode: 'game' as const,
        beat: i === n - 1 ? 'Final level — clear every pit to win the run.' : `Reach the target score to unlock level ${i + 2}.`,
        difficulty: i + 1,
      })),
    };
  }

  const arc = pickFilmArc(n);
  return {
    storyboardTitle: intent.kind === 'ad-sequence' ? 'Product Story Commercial' : 'OmniStage Short Film',
    kind: intent.kind,
    engineType: intent.engineType,
    beats: arc.map((a, i) => ({
      title: `Shot ${i + 1} · ${a.title}`,
      description: `${a.beat} for: ${prompt.slice(0, 120)}`,
      engineType: intent.engineType,
      mode: 'media' as const,
      beat: a.beat,
      difficulty: i + 1,
    })),
  };
}

const LEVEL_PALETTES = [
  { accent: '#06B6D4', platform: '#1E293B', star: '#FBBF24', bg: 'Cyan' },
  { accent: '#EC4899', platform: '#2A1636', star: '#FDE047', bg: 'Magenta' },
  { accent: '#F59E0B', platform: '#2B1D0E', star: '#FEF08A', bg: 'Amber' },
  { accent: '#10B981', platform: '#0F2A22', star: '#FCD34D', bg: 'Emerald' },
  { accent: '#8B5CF6', platform: '#1F1838', star: '#FBBF24', bg: 'Violet' },
  { accent: '#F43F5E', platform: '#2B1018', star: '#FDE68A', bg: 'Rose' },
];

function makeNode(partial: Partial<Node2D> & Pick<Node2D, 'name' | 'type' | 'x' | 'y' | 'width' | 'height' | 'physics2D'>): Node2D {
  return {
    id: uid('node2d'),
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    fill: '#1E293B',
    stroke: '#06B6D4',
    strokeWidth: 2,
    ...partial,
  };
}

/** Builds a guaranteed-beatable 2D platformer level whose difficulty scales with `difficulty`. */
function buildLocal2DLevel(beat: StoryboardBeat, index: number, total: number): SceneSpec {
  const spec = createBlankSceneSpec('2d', beat.title);
  const d = Math.max(1, beat.difficulty ?? index + 1);
  const pal = LEVEL_PALETTES[index % LEVEL_PALETTES.length];
  const GROUND_Y = 540;
  const GROUND_H = 36;
  const groundTop = GROUND_Y - GROUND_H / 2;
  const nodes: Node2D[] = [];

  // Ground split into segments separated by pits (obstacles). Pit width stays <= 170px (reach ~350px).
  const pitCount = Math.min(3, d - 1);
  const pitWidth = Math.min(170, 110 + d * 15);
  const segCount = pitCount + 1;
  const usable = 1000 - pitCount * pitWidth;
  const segWidth = usable / segCount;
  for (let s = 0; s < segCount; s++) {
    const left = s * (segWidth + pitWidth);
    nodes.push(
      makeNode({
        name: segCount === 1 ? 'Ground Floor' : `Ground Segment ${s + 1}`,
        type: 'tile-platform',
        x: left + segWidth / 2,
        y: GROUND_Y,
        width: segWidth,
        height: GROUND_H,
        fill: pal.platform,
        stroke: pal.accent,
        shapeKind: 'rect',
        physics2D: 'static-platform',
      })
    );
  }

  // Floating ledge staircase: rises then falls, step-up <= 100px, edge gap <= 180px.
  const ledgeCount = Math.min(7, 2 + d);
  const ledgeWidth = Math.max(100, 220 - d * 22);
  const stepUp = Math.min(100, 70 + d * 8);
  const spanStart = 150;
  const spanEnd = 880;
  const stepX = ledgeCount > 1 ? (spanEnd - spanStart) / (ledgeCount - 1) : 0;
  const peak = Math.floor((ledgeCount - 1) / 2);
  let starTotal = 0;
  for (let i = 0; i < ledgeCount; i++) {
    const tier = i <= peak ? i + 1 : Math.max(1, ledgeCount - i);
    const topY = Math.max(150, groundTop - stepUp * tier);
    const x = spanStart + stepX * i;
    nodes.push(
      makeNode({
        name: `Ledge ${i + 1}`,
        type: 'tile-platform',
        x,
        y: topY + 14,
        width: ledgeWidth,
        height: 28,
        fill: pal.platform,
        stroke: pal.accent,
        shapeKind: 'rect',
        physics2D: 'static-platform',
      })
    );
    const isBonus = i === peak;
    const value = isBonus ? 50 : 25;
    starTotal += value;
    nodes.push(
      makeNode({
        name: isBonus ? 'Summit Bonus Star' : `Star ${i + 1}`,
        type: 'vector-shape',
        x,
        y: topY - 45,
        width: isBonus ? 52 : 44,
        height: isBonus ? 52 : 44,
        fill: pal.star,
        stroke: '#FEF9C3',
        shapeKind: 'star',
        physics2D: 'collectible',
        scoreValue: value,
      })
    );
  }

  // Player spawns on the first ground segment.
  nodes.push(
    makeNode({
      name: 'Hero Runner',
      type: 'sprite-actor',
      x: 60,
      y: groundTop - 29,
      width: 58,
      height: 58,
      fill: pal.accent,
      stroke: '#F8FAFC',
      strokeWidth: 3,
      shapeKind: 'capsule',
      physics2D: 'player-platformer',
    })
  );

  nodes.push(
    makeNode({
      name: 'Level Title',
      type: 'text-kinetic',
      x: 500,
      y: 60,
      width: 600,
      height: 60,
      fill: '#F8FAFC',
      stroke: pal.accent,
      text: `LEVEL ${index + 1} / ${total}`,
      fontSize: 36,
      physics2D: 'none',
    })
  );

  const target = Math.max(25, Math.floor((starTotal * Math.min(0.9, 0.6 + d * 0.08)) / 25) * 25);
  spec.mode = 'game';
  spec.description = beat.description;
  spec.nodes2D = nodes;
  spec.durationSeconds = 10;
  spec.gameRules = {
    winCondition: 'score-threshold',
    targetScore: target,
    timeLimitSeconds: Math.max(15, 34 - d * 3),
    instructions: `${beat.beat} Collect ${target} PTS — A/D to run, W/Space to jump, avoid the pits!`,
  };
  spec.marketingOverlay = {
    ...spec.marketingOverlay,
    enabled: false,
    headline: index === total - 1 ? 'RUN COMPLETE!' : `LEVEL ${index + 1} CLEARED`,
    subheadline: index === total - 1 ? 'You conquered every level.' : `Next up: level ${index + 2}`,
    ctaText: index === total - 1 ? 'Play Again' : 'Next Level',
    brandColor: pal.accent,
    badgeText: `LEVEL ${index + 1}`,
  };
  return spec;
}

interface FilmTheme {
  terrain: TerrainType;
  skyboxes: SkyboxPreset[];
  weatherClimax: WeatherType;
  scatter: WorldSpec['scatterObjects'][number]['type'][];
  terrainColor: string;
}

function pickFilmTheme(prompt: string): FilmTheme {
  const t = foldText(prompt);
  // Explicit landscapes win over character hints (e.g. "robot trong rung" is a forest film).
  if (/\brung\b|forest|jungle|woods|nature|thien nhien/.test(t))
    return { terrain: 'grassy-hills', skyboxes: ['daylight-sky', 'sunset-atmosphere', 'night-stars'], weatherClimax: 'rain', scatter: ['pine-trees', 'rocks-boulders'], terrainColor: '#3f6212' };
  if (/desert|sa mac|dune/.test(t))
    return { terrain: 'desert-dunes', skyboxes: ['daylight-sky', 'sunset-atmosphere', 'night-stars'], weatherClimax: 'floating-embers', scatter: ['rocks-boulders', 'ancient-pillars'], terrainColor: '#b45309' };
  if (/snow|tuyet|winter|mua dong|mountain|nui/.test(t))
    return { terrain: 'snow-mountains', skyboxes: ['overcast', 'daylight-sky', 'night-stars'], weatherClimax: 'snow', scatter: ['pine-trees', 'rocks-boulders'], terrainColor: '#64748b' };
  if (/city|thanh pho|cyber|neon|robot/.test(t))
    return { terrain: 'city-asphalt', skyboxes: ['sunset-atmosphere', 'cyber-void', 'night-stars'], weatherClimax: 'rain', scatter: ['cyber-buildings', 'street-lights'], terrainColor: '#1f2937' };
  if (/ocean|bien|island|dao|beach/.test(t))
    return { terrain: 'ocean-island', skyboxes: ['daylight-sky', 'sunset-atmosphere', 'night-stars'], weatherClimax: 'foggy-mist', scatter: ['rocks-boulders', 'crystal-clusters'], terrainColor: '#a16207' };
  return { terrain: 'grassy-hills', skyboxes: ['daylight-sky', 'sunset-atmosphere', 'night-stars'], weatherClimax: 'rain', scatter: ['pine-trees', 'rocks-boulders'], terrainColor: '#3f6212' };
}

const CHARACTER_KEYWORDS: Array<{ kw: RegExp; id: string; walk: string; run: string; hero: string }> = [
  { kw: /robot|ro bot|android/, id: 'gltf-robot-expressive', walk: 'Walking', run: 'Running', hero: 'Dance' },
  { kw: /soldier|linh|chien binh|warrior/, id: 'gltf-soldier', walk: 'Walk', run: 'Run', hero: 'Idle' },
  { kw: /fox|cao/, id: 'gltf-fox', walk: 'Walk', run: 'Run', hero: 'Survey' },
  { kw: /horse|ngua/, id: 'gltf-horse', walk: 'horse_A_', run: 'horse_A_', hero: 'horse_A_' },
  { kw: /flamingo|bird|chim|hac/, id: 'gltf-flamingo', walk: 'flamingo_flyA_', run: 'flamingo_flyA_', hero: 'flamingo_flyA_' },
  { kw: /parrot|vet/, id: 'gltf-parrot', walk: 'parrot_A_', run: 'parrot_A_', hero: 'parrot_A_' },
];

function buildActor(assetId: string, clip: string | undefined, position: [number, number, number], duration: number, rotY = 0): ActorNode | null {
  const entry = ASSET_REGISTRY[assetId];
  if (!entry) return null;
  return {
    id: uid('actor'),
    name: entry.name,
    assetId: entry.assetId,
    modelUrl: entry.modelUrl,
    position,
    rotation: [0, rotY, 0],
    scale: [1, 1, 1],
    primaryColor: entry.defaultPrimaryColor,
    secondaryColor: entry.defaultSecondaryColor,
    metalness: entry.defaultMetalness,
    roughness: entry.defaultRoughness,
    activeAnimation: entry.defaultAnimation,
    activeClip: clip && entry.embeddedClips?.includes(clip) ? clip : entry.defaultClip,
    availableClips: entry.embeddedClips ? [...entry.embeddedClips] : undefined,
    animationSpeed: 1,
    physicsRole: entry.defaultPhysicsRole,
    onClickAction: entry.defaultClickAction,
    scoreValue: entry.defaultScoreValue,
    startTime: 0,
    endTime: duration,
    enterEffect: 'pop-in',
  };
}

const FILM_CAMERAS: CameraMode[] = ['crane-reveal', 'dolly-zoom-in', 'orbit-360', 'cinematic-flythrough', 'first-person-follow'];
const FILM_LIGHTING: LightingPresetId[] = ['clean-apple-studio', 'sunset-cinematic', 'cyberpunk-neon', 'arcade-vibrant'];

function buildLocal3DFilmShot(prompt: string, beat: StoryboardBeat, index: number, total: number): SceneSpec {
  const spec = createBlankSceneSpec('3d', beat.title);
  const theme = pickFilmTheme(prompt);
  const t = foldText(prompt);
  const progress = total <= 1 ? 0 : index / (total - 1); // 0 = opening, 1 = finale
  const isClimax = /climax|showdown|conflict/i.test(beat.beat) || (total >= 3 && index === total - 2);
  const isFinale = index === total - 1;
  const duration = 10;

  const characters = CHARACTER_KEYWORDS.filter((c) => c.kw.test(t));
  if (characters.length === 0) characters.push(CHARACTER_KEYWORDS[0], CHARACTER_KEYWORDS[2]);

  spec.description = beat.description;
  spec.durationSeconds = duration;
  spec.mode = 'media';
  spec.world = {
    ...JSON.parse(JSON.stringify(DEFAULT_WORLD_SPEC)),
    skybox: theme.skyboxes[Math.min(theme.skyboxes.length - 1, Math.round(progress * (theme.skyboxes.length - 1)))],
    sunPosition: [18, Math.max(2, 24 - progress * 22), 14],
    clouds: { enabled: !isFinale, density: isClimax ? 0.85 : 0.45, speed: isClimax ? 0.9 : 0.3, color: isClimax ? '#94A3B8' : '#E2E8F0' },
    terrain: { type: theme.terrain, elevationScale: 1.6, roughness: 0.75, color: theme.terrainColor, waterLevel: theme.terrain === 'ocean-island' ? 0.25 : 0 },
    weather: { type: isClimax ? theme.weatherClimax : 'clear', intensity: isClimax ? 0.85 : 0.5 },
    scatterObjects: theme.scatter.map((type, i) => ({
      id: uid(`scatter-${i}`),
      type,
      count: i === 0 ? 24 : 12,
      spreadRadius: 20,
      scaleRange: [0.8, 1.5] as [number, number],
    })),
  };
  const lighting = isClimax ? 'cyberpunk-neon' : progress > 0.5 ? 'sunset-cinematic' : FILM_LIGHTING[index % 2];
  spec.environment = { ...LIGHTING_PRESETS[lighting] };

  const cameraMode = isFinale ? 'orbit-360' : FILM_CAMERAS[index % FILM_CAMERAS.length];
  spec.camera = {
    ...spec.camera,
    mode: cameraMode,
    position: index === 0 ? [0, 6.5, 14] : [0, 2.8, 7.2],
    target: [0, 1.1, 0],
    keyframes: [],
  };

  const actors: ActorNode[] = [];
  characters.slice(0, 3).forEach((c, i) => {
    const clip = isFinale ? c.hero : isClimax || index > 0 ? c.run : c.walk;
    const x = (i - (Math.min(characters.length, 3) - 1) / 2) * 2.2;
    const actor = buildActor(c.id, clip, [x, 0, index === 0 ? -1 : 0], duration, isClimax ? Math.PI / 2 : 0);
    if (actor) actors.push(actor);
  });
  if (isClimax) {
    const hazard = buildActor('hazard-laser-mine', undefined, [0, 0, -3.2], duration);
    if (hazard) actors.push(hazard);
  }
  spec.actors = actors;
  // Phase 10A: offline acting + shot list so even keyless films have movement and cuts.
  const performers = actors.filter((a) => a.availableClips?.length);
  directOfflineShot(spec, performers, characters, { index, isClimax, isFinale, duration });
  spec.environment.groundGrid = false;
  spec.environment.reflectivePedestal = false;

  spec.vfx = [];
  if (isClimax) {
    spec.vfx.push(
      { id: uid('vfx'), name: 'Climax Shockwave', type: 'shockwave', position: [0, 0.1, 0], color: '#EC4899', intensity: 1.4 },
      { id: uid('vfx'), name: 'Sky Beacon', type: 'laser-beam', position: [0, 0, -3.2], color: '#F43F5E', intensity: 1.5 }
    );
  } else if (isFinale) {
    spec.vfx.push({ id: uid('vfx'), name: 'Finale Sparkles', type: 'sparkles', position: [0, 1.5, 0], color: '#FBBF24', intensity: 1.2 });
  }

  spec.marketingOverlay = {
    ...spec.marketingOverlay,
    enabled: index === 0 || isFinale,
    headline: index === 0 ? beat.title.replace(/^Shot \d+ · /, '').toUpperCase() : 'THE END',
    subheadline: beat.beat,
    badgeText: `SHOT ${index + 1}/${total}`,
    triggerCondition: 'always',
  };
  spec.timelineTracks = [
    { id: uid('track'), label: `Camera · ${cameraMode}`, type: 'camera', startTime: 0, endTime: duration, color: '#06B6D4' },
    { id: uid('track'), label: 'Character Action', type: 'actor-anim', startTime: 0, endTime: duration, color: '#F59E0B' },
  ];
  return spec;
}

/** Phase 10A: a small acting arc + shot list for an offline film shot. */
function directOfflineShot(
  spec: SceneSpec,
  performers: ActorNode[],
  characters: Array<{ walk: string; run: string; hero: string }>,
  o: { index: number; isClimax: boolean; isFinale: boolean; duration: number }
) {
  const [hero, partner] = performers;
  let heroDest: [number, number, number] | undefined;
  let heroAway = 1;
  const has = (a: ActorNode, clip: string) => !!a.availableClips?.includes(clip);
  const pick = (a: ActorNode, ...clips: string[]) => clips.find((c) => has(a, c));
  const d = o.duration;
  if (hero) {
    const c = characters[0];
    const startClip = o.index === 0 ? pick(hero, 'Sitting', 'Survey', 'Idle') : pick(hero, 'Idle', 'Survey');
    const react = o.isFinale ? pick(hero, 'Dance', c.hero) : o.isClimax ? pick(hero, 'Jump', 'Punch', c.hero) : pick(hero, 'Wave', 'Yes', c.hero);
    const [hx, , hz] = hero.position;
    // Walk away from the partner (never through it), towards the camera side.
    const away = partner ? Math.sign(hx - partner.position[0]) || -1 : o.index % 2 ? -1 : 1;
    const dest: [number, number, number] = [Number((hx + away * 2.2).toFixed(2)), 0, Number((hz + 1.6).toFixed(2))];
    heroDest = dest;
    heroAway = away;
    hero.activeClip = startClip || hero.activeClip;
    hero.performance = [
      { time: 0, clip: startClip, label: 'opening pose' },
      ...(o.index === 0 && has(hero, 'Standing') ? [{ time: d * 0.2, clip: 'Standing', label: 'gets up' }] : []),
      { time: d * 0.3, moveTo: dest, duration: d * 0.28, clip: o.isClimax ? pick(hero, c.run, 'Running', 'Run') : undefined, label: 'sets off' },
      // Turn to the partner as the walk ends, before the over-shoulder shot cuts in at 0.66·d.
      { time: d * 0.6, ...(partner ? { lookAt: partner.id } : { faceDeg: 0 }), clip: react, label: 'reacts' },
      { time: d * 0.88, clip: o.isFinale ? react : pick(hero, 'ThumbsUp', 'Yes', 'Idle', 'Survey'), label: 'beat ends' },
    ];
  }
  if (partner && hero) {
    partner.performance = [
      { time: 0, lookAt: hero.id, label: 'watches' },
      // Follow the hero and stop 2.4 m beside where it arrives (on the side the partner came from).
      ...(heroDest ? [{ time: d * 0.45, moveTo: [Number((heroDest[0] - heroAway * 2.4).toFixed(2)), 0, Number((heroDest[2] - 0.4).toFixed(2))] as [number, number, number], duration: d * 0.25, label: 'follows' }] : []),
      { time: d * 0.75, lookAt: hero.id, clip: pick(partner, 'Survey', 'Idle', 'Wave'), label: 'answers' },
    ];
  }
  const subject = hero?.id;
  spec.camera.shots = [
    { start: 0, type: o.index === 0 ? 'establishing' : 'wide', subject, move: o.index === 0 ? 'crane-up' : 'pull-out', label: 'open' },
    { start: d * 0.3, type: 'tracking', subject, move: 'static', label: 'journey' },
    { start: d * 0.66, type: partner ? 'over-shoulder' : 'medium', subject, partner: partner?.id, angle: 'three-quarter-left', label: 'meeting' },
    { start: d * 0.8, type: o.isClimax ? 'low-angle' : 'close-up', subject, move: o.isFinale ? 'pull-out' : 'push-in', label: 'reaction' },
  ];
}

function buildLocal3DGameLevel(beat: StoryboardBeat, index: number, total: number): SceneSpec {
  const spec = createBlankSceneSpec('3d', beat.title);
  const d = Math.max(1, beat.difficulty ?? index + 1);
  const duration = 10;
  spec.mode = 'game';
  spec.durationSeconds = duration;
  spec.description = beat.description;
  spec.camera = { ...spec.camera, mode: 'isometric-game', position: [0, 9, 9], target: [0, 0, 0], keyframes: [] };
  spec.world = {
    ...JSON.parse(JSON.stringify(DEFAULT_WORLD_SPEC)),
    skybox: (['daylight-sky', 'sunset-atmosphere', 'night-stars'] as SkyboxPreset[])[index % 3],
    terrain: { type: 'flat-grid', elevationScale: 1, roughness: 0.7, color: '#111827', waterLevel: 0 },
  };
  const actors: ActorNode[] = [];
  const player = buildActor('gltf-robot-expressive', 'Running', [0, 0, 0], duration);
  if (player) actors.push({ ...player, physicsRole: 'player' });
  const coins = 3 + d * 2;
  for (let i = 0; i < coins; i++) {
    const angle = (i / coins) * Math.PI * 2;
    const r = 2.6 + (i % 2) * 1.6;
    const coin = buildActor('gold-coin-collectible', undefined, [Math.cos(angle) * r, 0, Math.sin(angle) * r], duration);
    if (coin) actors.push(coin);
  }
  for (let h = 0; h < Math.min(4, d); h++) {
    const angle = (h / Math.max(1, d)) * Math.PI * 2 + 0.6;
    const hazard = buildActor('hazard-laser-mine', undefined, [Math.cos(angle) * 4.6, 0, Math.sin(angle) * 4.6], duration);
    if (hazard) actors.push(hazard);
  }
  spec.actors = actors;
  const coinValue = ASSET_REGISTRY['gold-coin-collectible']?.defaultScoreValue ?? 25;
  spec.gameRules = {
    winCondition: 'score-threshold',
    targetScore: Math.max(coinValue, Math.floor(coins * 0.8) * coinValue),
    timeLimitSeconds: Math.max(15, 35 - d * 4),
    instructions: `${beat.beat} WASD to move, collect coins, dodge the laser mines.`,
  };
  spec.marketingOverlay = {
    ...spec.marketingOverlay,
    headline: index === total - 1 ? 'QUEST COMPLETE!' : `LEVEL ${index + 1} CLEARED`,
    subheadline: index === total - 1 ? 'Every level conquered.' : `Next up: level ${index + 2}`,
    ctaText: index === total - 1 ? 'Play Again' : 'Next Level',
    badgeText: `LEVEL ${index + 1}`,
  };
  return spec;
}

export function buildLocalSceneForBeat(prompt: string, plan: StoryboardPlan, index: number): SceneSpec {
  const beat = plan.beats[index];
  const total = plan.beats.length;
  if (beat.mode === 'game' || plan.kind === 'game-levels') {
    return beat.engineType === '2d' ? buildLocal2DLevel(beat, index, total) : buildLocal3DGameLevel(beat, index, total);
  }
  if (beat.engineType === '2d') {
    // 2D motion-graphics shot: reuse the blank 2D stage with a kinetic title card per beat.
    const spec = createBlankSceneSpec('2d', beat.title);
    spec.mode = 'media';
    spec.description = beat.description;
    spec.nodes2D = [
      makeNode({
        name: 'Shot Title',
        type: 'text-kinetic',
        x: 500,
        y: 260,
        width: 760,
        height: 80,
        fill: '#F8FAFC',
        stroke: LEVEL_PALETTES[index % LEVEL_PALETTES.length].accent,
        text: beat.title.replace(/^Shot \d+ · /, '').toUpperCase(),
        fontSize: 48,
        physics2D: 'none',
      }),
      makeNode({
        name: 'Beat Caption',
        type: 'text-kinetic',
        x: 500,
        y: 350,
        width: 760,
        height: 40,
        fill: '#CBD5E1',
        stroke: '',
        text: beat.beat,
        fontSize: 22,
        physics2D: 'none',
      }),
    ];
    return spec;
  }
  return buildLocal3DFilmShot(prompt, beat, index, total);
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------

function summarizeSceneForContinuity(spec: SceneSpec) {
  return {
    title: spec.title,
    engineType: spec.engineType,
    mode: spec.mode,
    camera: spec.camera.shots?.length ? spec.camera.shots.map((sh) => sh.type).join(' → ') : spec.camera.mode,
    world: spec.engineType === '3d' ? { skybox: spec.world.skybox, terrain: spec.world.terrain.type, weather: spec.world.weather.type } : undefined,
    lighting: spec.environment.presetId,
    // Phase 10A: where each character ends up and what it last did, so the next scene continues the action.
    actors: spec.actors.map((a) => {
      const last = a.performance?.length ? resolvePerformance(a, spec.durationSeconds || 8, spec.actors) : undefined;
      return { id: a.id, name: a.name, assetId: a.assetId, primaryColor: a.primaryColor, activeClip: a.activeClip,
        endsAt: last?.position.map((v) => Number(v.toFixed(1))), endsDoing: last?.clip };
    }),
    script: spec.sequence?.script,
    nodes2D: spec.engineType === '2d' ? { count: spec.nodes2D.length, palette: Array.from(new Set(spec.nodes2D.map((n) => n.stroke))).slice(0, 4) } : undefined,
    gameRules: spec.mode === 'game' ? { targetScore: spec.gameRules.targetScore, timeLimitSeconds: spec.gameRules.timeLimitSeconds } : undefined,
  };
}

function isValidPlan(data: any, expected: number): data is StoryboardPlan {
  return (
    data &&
    Array.isArray(data.beats) &&
    data.beats.length >= Math.min(expected, MIN_STORYBOARD_SCENES) &&
    data.beats.every((b: any) => b && typeof b.title === 'string')
  );
}

function sanitizePlan(raw: StoryboardPlan, intent: StoryboardIntent, fallback: StoryboardPlan): StoryboardPlan {
  const beats: StoryboardBeat[] = [];
  for (let i = 0; i < intent.sceneCount; i++) {
    const b: any = raw.beats[i] ?? fallback.beats[i];
    const engineType: EngineType = b.engineType === '2d' || b.engineType === '3d' ? b.engineType : intent.engineType;
    beats.push({
      title: str(b.title, fallback.beats[i].title),
      description: str(b.description, fallback.beats[i].description),
      engineType,
      mode: b.mode === 'game' || b.mode === 'media' ? b.mode : intent.kind === 'game-levels' ? 'game' : 'media',
      beat: str(b.beat, fallback.beats[i].beat),
      difficulty: num(b.difficulty, i + 1),
      script: typeof b.script === 'string' && b.script.trim() ? b.script.trim().slice(0, 1200) : fallback.beats[i].script,
      transition: ['cut', 'fade', 'crossfade', 'fade-white', 'wipe'].includes(b.transition) ? b.transition : i === 0 ? undefined : 'fade',
    });
  }
  return {
    storyboardTitle: str(raw.storyboardTitle, fallback.storyboardTitle),
    kind: ['film', 'game-levels', 'ad-sequence'].includes(raw.kind) ? raw.kind : intent.kind,
    engineType: raw.engineType === '2d' || raw.engineType === '3d' ? raw.engineType : intent.engineType,
    beats,
  };
}

async function postJSON(url: string, body: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

/**
 * Phase 10A: one or two JSON Patch rounds that add acting, shots and a place when the verifier's craft hints fire.
 * Never makes the scene worse (the loop discards rounds that raise errors or craft issues).
 */
async function polishFilmShot(
  spec: SceneSpec,
  prompt: string,
  beat: StoryboardBeat,
  settings: Pick<SettingsConfig, 'geminiModel' | 'customSystemPrompt' | 'aiProvider' | 'aiModels' | 'aiApiKeys' | 'aiBaseUrl'>,
  signal?: AbortSignal
): Promise<SceneSpec> {
  const check = (s: SceneSpec) => autoFixSceneSpec(s);
  const first = check(spec);
  if (mediaQualityPenalty(first.report) === 0 && first.report.ok) return spec;
  const ask = `Polish this film shot so it plays like a real scene (do not change the story).
Shot: "${beat.title}" — ${beat.beat}${beat.script ? `\nScript:\n${beat.script}` : ''}
Original request: "${prompt.slice(0, 400)}"
${describeReportForModel(first.report, 8, MEDIA_CRAFT_CODES)}`;
  const loop = await runPatchLoop({
    prompt: ask,
    spec: first.spec,
    maxRounds: 2,
    check,
    qualityPenalty: mediaQualityPenalty,
    qualityCodes: MEDIA_CRAFT_CODES,
    propose: async (turn) => {
      try {
        return (await postJSON(
          '/api/agent/patch',
          { prompt: turn.prompt, sceneSpec: turn.spec, round: turn.round, toolResults: turn.toolResults, model: settings.geminiModel, customSystemPrompt: settings.customSystemPrompt },
          signal,
          aiHeaders(settings)
        )) as PatchProposal;
      } catch {
        return null;
      }
    },
  });
  if (!loop?.changed) return first.spec;
  // Keep the storyboard identity the loop must not change.
  return { ...loop.spec, id: spec.id, title: spec.title, sequence: spec.sequence, mode: spec.mode, engineType: spec.engineType };
}

export async function generateStoryboardWithAgent(
  prompt: string,
  intent: StoryboardIntent,
  settings: Pick<SettingsConfig, 'geminiModel' | 'customSystemPrompt' | 'aiProvider' | 'aiModels' | 'aiApiKeys' | 'aiBaseUrl'>,
  callbacks: StoryboardGenerationCallbacks = {},
  signal?: AbortSignal
): Promise<StoryboardGenerationResult> {
  const storyboardId = uid('storyboard');
  const localPlan = buildLocalStoryboardPlan(prompt, intent);

  // STEP 1: Plan
  callbacks.onProgress?.({ phase: 'planning', completed: 0, total: intent.sceneCount, label: 'Planning storyboard beats' });
  let plan = localPlan;
  let planSource: 'gemini' | 'local' = 'local';
  try {
    const data = await postJSON(
      '/api/agent/storyboard/plan',
      { prompt, intent, model: settings.geminiModel, customSystemPrompt: settings.customSystemPrompt },
      signal,
      aiHeaders(settings)
    );
    if (isValidPlan(data, intent.sceneCount)) {
      plan = sanitizePlan(data, intent, localPlan);
      planSource = 'gemini';
    }
  } catch {
    // fall back to deterministic local plan
  }
  callbacks.onPlan?.(plan, planSource);

  // STEP 2: Author each scene sequentially, feeding continuity from the scenes already built
  const scenes: SceneSpec[] = [];
  const sources = new Set<'gemini' | 'local'>();
  let geminiAvailable = planSource === 'gemini';
  for (let i = 0; i < plan.beats.length; i++) {
    if (signal?.aborted) break;
    const beat = plan.beats[i];
    callbacks.onProgress?.({ phase: 'generating', completed: i, total: plan.beats.length, label: beat.title });

    let spec: SceneSpec | null = null;
    let source: 'gemini' | 'local' = 'local';
    if (geminiAvailable) {
      try {
        const data = await postJSON(
          '/api/agent/storyboard/scene',
          {
            prompt,
            storyboardTitle: plan.storyboardTitle,
            kind: plan.kind,
            beatIndex: i,
            total: plan.beats.length,
            beat,
            previousScenes: scenes.map(summarizeSceneForContinuity),
            model: settings.geminiModel,
            customSystemPrompt: settings.customSystemPrompt,
          },
          signal,
          aiHeaders(settings)
        );
        if (data && data.sceneSpec && typeof data.sceneSpec === 'object') {
          spec = normalizeGeneratedSceneSpec(data.sceneSpec, beat.engineType);
          source = 'gemini';
        }
      } catch {
        // A failing server (no key / quota) is unlikely to recover mid-run: stay local for the rest.
        geminiAvailable = false;
      }
    }
    if (!spec) spec = buildLocalSceneForBeat(prompt, plan, i);
    // Phase 4 verification loop: every generated level/shot must pass the deterministic verifier.
    spec = autoFixSceneSpec(spec).spec;

    spec.id = uid(`scene-${i + 1}`);
    spec.title = beat.title;
    spec.engineType = beat.engineType;
    spec.mode = beat.mode;
    spec.sequence = {
      storyboardId,
      storyboardTitle: plan.storyboardTitle,
      kind: plan.kind,
      index: i,
      total: plan.beats.length,
      beat: beat.beat,
      ...(beat.transition && i > 0 ? { transition: beat.transition } : {}),
      ...(beat.script ? { script: beat.script } : {}),
    };
    // Phase 10A: AI film shots that still look static / empty get up to 2 polish rounds through the patch loop.
    if (source === 'gemini' && spec.engineType === '3d' && spec.mode === 'media' && !signal?.aborted) {
      callbacks.onProgress?.({ phase: 'generating', completed: i, total: plan.beats.length, label: `Polishing ${beat.title}` });
      spec = await polishFilmShot(spec, prompt, beat, settings, signal);
    }
    scenes.push(spec);
    sources.add(source);
    callbacks.onScene?.(spec, i, source);
  }

  const source = sources.size > 1 ? 'mixed' : (sources.values().next().value ?? 'local');
  const unit = plan.kind === 'game-levels' ? 'level' : 'scene';
  return {
    storyboardId,
    plan,
    scenes,
    source,
    assistantMessage: `Generated storyboard "${plan.storyboardTitle}" with ${scenes.length} ${unit}s (${
      source === 'local' ? 'offline studio generator' : source === 'gemini' ? settings.aiProvider : `${settings.aiProvider} + offline fallback`
    }). ${
      plan.kind === 'game-levels'
        ? 'Reaching each level\'s target score unlocks a "Next Level" button on the end-card.'
        : 'Scenes are linked in order — open the Scenes tab to review each shot.'
    }`,
    diffSummary: scenes.map((s, i) => `#${i + 1} ${s.title} (${s.engineType.toUpperCase()} · ${s.mode})`),
  };
}
