/**
 * Phase 5 (Director C) — genre kits: parameterised 2D game levels that are verified AND playtested before they ship.
 *
 * A kit is a small pure builder (`difficulty`, `index`, `total`, `title` → SceneSpec) for one `GameGenre`. The director chooses a kit
 * and tunes its parameters instead of writing a level from nothing; the offline director builds its levels from kits, and the tool layer
 * exposes them as `add_from_kit`. Every kit at every difficulty must verify clean and be won by the playtest bot (`tests/genreKits.test.ts`),
 * so adding a kit means adding it to that test. Kits use only what the engine runs (see `GAME_VERBS`); deterministic, no random, no Date.
 */
import { createBlankSceneSpec } from '../registry/assetRegistry';
import type { GameGenre, HudElement, Node2D, SceneSpec } from '../types/scene.schema';

export type GenreKitId = 'platformer' | 'key-hunt' | 'turret-dodge' | 'survival';

export interface GenreKitInfo {
  id: GenreKitId;
  genre: GameGenre;
  name: string;
  summary: string;
  /** What the level asks of the player, in the design's own verbs. */
  verbs: string[];
}

export const GENRE_KITS: GenreKitInfo[] = [
  { id: 'platformer', genre: 'platformer', name: 'Platformer', summary: 'Stairs of floating ledges over pits; collect the stars to win.', verbs: ['jump', 'collect'] },
  { id: 'key-hunt', genre: 'key-hunt', name: 'Key hunt', summary: 'Keys on ledges, spikes on the ground between them; collect every key.', verbs: ['jump', 'collect', 'avoid-hazards'] },
  { id: 'turret-dodge', genre: 'turret-dodge', name: 'Turret dodge', summary: 'Turrets fire along the floor; jump the shots, grab every coin, keep your health.', verbs: ['jump', 'collect', 'dodge-projectiles'] },
  { id: 'survival', genre: 'survival', name: 'Survival', summary: 'Hazards rain from above; stay alive until the timer ends.', verbs: ['survive', 'dodge-projectiles'] },
];

export function kitForGenre(genre: GameGenre): GenreKitId {
  return GENRE_KITS.find((k) => k.genre === genre)?.id ?? 'platformer';
}

export function isGenreKitId(value: unknown): value is GenreKitId {
  return GENRE_KITS.some((k) => k.id === value);
}

export interface KitParams {
  /** 1 = gentle … 6 = hard. Default: `index + 1`. */
  difficulty?: number;
  /** Position in a multi-level game (palette, level title). Default 0. */
  index?: number;
  total?: number;
  title?: string;
  description?: string;
  /** The "how to play" line; a sensible one is written when omitted. */
  beat?: string;
}

export const LEVEL_PALETTES = [
  { accent: '#06B6D4', platform: '#1E293B', star: '#FBBF24', bg: 'Cyan' },
  { accent: '#EC4899', platform: '#2A1636', star: '#FDE047', bg: 'Magenta' },
  { accent: '#F59E0B', platform: '#2B1D0E', star: '#FEF08A', bg: 'Amber' },
  { accent: '#10B981', platform: '#0F2A22', star: '#FCD34D', bg: 'Emerald' },
  { accent: '#8B5CF6', platform: '#1F1838', star: '#FBBF24', bg: 'Violet' },
  { accent: '#F43F5E', platform: '#2B1018', star: '#FDE68A', bg: 'Rose' },
];

type Palette = (typeof LEVEL_PALETTES)[number];

const GROUND_Y = 540;
const GROUND_H = 36;
const GROUND_TOP = GROUND_Y - GROUND_H / 2;

/** Stable ids per kit scene: a patch can address them, and a replay tape does not depend on them. */
function nodeMaker() {
  let counter = 0;
  return (partial: Partial<Node2D> & Pick<Node2D, 'name' | 'type' | 'x' | 'y' | 'width' | 'height' | 'physics2D'>): Node2D => ({
    id: `kit-${String(++counter).padStart(2, '0')}-${partial.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}`,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    fill: '#1E293B',
    stroke: '#06B6D4',
    strokeWidth: 2,
    ...partial,
  });
}

type Maker = ReturnType<typeof nodeMaker>;

function frame(params: KitParams, kit: GenreKitInfo, defaultBeat: string) {
  const index = Math.max(0, Math.floor(params.index ?? 0));
  const total = Math.max(index + 1, Math.floor(params.total ?? index + 1));
  const d = Math.max(1, Math.min(6, Math.round(params.difficulty ?? index + 1)));
  const pal = LEVEL_PALETTES[index % LEVEL_PALETTES.length];
  const title = params.title?.trim() || `${kit.name} ${index + 1}`;
  const spec = createBlankSceneSpec('2d', title);
  spec.mode = 'game';
  spec.description = params.description?.trim() || kit.summary;
  spec.durationSeconds = 10;
  spec.logicGraph = { nodes: [], edges: [] };
  const beat = params.beat?.trim() || defaultBeat;
  return { spec, index, total, d, pal, beat };
}

function levelTitle(make: Maker, pal: Palette, index: number, total: number): Node2D {
  return make({
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
  });
}

function overlay(spec: SceneSpec, pal: Palette, index: number, total: number) {
  spec.marketingOverlay = {
    ...spec.marketingOverlay,
    enabled: false,
    headline: index === total - 1 ? 'RUN COMPLETE!' : `LEVEL ${index + 1} CLEARED`,
    subheadline: index === total - 1 ? 'You conquered every level.' : `Next up: level ${index + 2}`,
    ctaText: index === total - 1 ? 'Play Again' : 'Next Level',
    brandColor: pal.accent,
    badgeText: `LEVEL ${index + 1}`,
  };
}

const healthHud = (): HudElement => ({ id: 'hud-health', kind: 'bar', source: 'health', anchor: 'top-left' });
const scoreHud = (): HudElement => ({ id: 'hud-score', kind: 'counter', source: 'score', label: 'Score', anchor: 'top-right' });
const timeHud = (): HudElement => ({ id: 'hud-time', kind: 'counter', source: 'time', label: 'Time', anchor: 'top-center' });

function ground(make: Maker, pal: Palette, from = 0, to = 1000, name = 'Ground Floor'): Node2D {
  return make({
    name,
    type: 'tile-platform',
    x: (from + to) / 2,
    y: GROUND_Y,
    width: to - from,
    height: GROUND_H,
    fill: pal.platform,
    stroke: pal.accent,
    shapeKind: 'rect',
    physics2D: 'static-platform',
  });
}

function hero(make: Maker, pal: Palette, health = false): Node2D {
  return make({
    name: 'Hero Runner',
    type: 'sprite-actor',
    x: 60,
    y: GROUND_TOP - 29,
    width: 58,
    height: 58,
    fill: pal.accent,
    stroke: '#F8FAFC',
    strokeWidth: 3,
    shapeKind: 'capsule',
    physics2D: 'player-platformer',
    ...(health ? { health: { max: 3, invulnerableSeconds: 0.8 } } : {}),
  });
}

/** A rising-then-falling staircase of ledges with a collectible over each. Step-up <= 100 px, edge gap <= 180 px (inside the verifier's reach). */
function ledgeStairs(make: Maker, pal: Palette, count: number, ledgeWidth: number, stepUp: number, label: string, shape: 'star' | 'key' = 'star') {
  const nodes: Node2D[] = [];
  const spanStart = 150;
  const spanEnd = 880;
  const stepX = count > 1 ? (spanEnd - spanStart) / (count - 1) : 0;
  const peak = Math.floor((count - 1) / 2);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const tier = i <= peak ? i + 1 : Math.max(1, count - i);
    const topY = Math.max(150, GROUND_TOP - stepUp * tier);
    const x = spanStart + stepX * i;
    nodes.push(make({ name: `Ledge ${i + 1}`, type: 'tile-platform', x, y: topY + 14, width: ledgeWidth, height: 28, fill: pal.platform, stroke: pal.accent, shapeKind: 'rect', physics2D: 'static-platform' }));
    const bonus = i === peak;
    const value = bonus ? 50 : 25;
    total += value;
    nodes.push(
      make({
        name: bonus ? `Summit Bonus ${label}` : `${label} ${i + 1}`,
        type: 'vector-shape',
        x,
        y: topY - 45,
        width: bonus ? 52 : 44,
        height: bonus ? 52 : 44,
        fill: pal.star,
        stroke: '#FEF9C3',
        shapeKind: shape === 'key' ? 'capsule' : 'star',
        physics2D: 'collectible',
        scoreValue: value,
      })
    );
  }
  return { nodes, total, stepX, spanStart };
}

function spike(make: Maker, x: number, name: string): Node2D {
  return make({ name, type: 'vector-shape', x, y: GROUND_TOP - 14, width: 46, height: 28, fill: '#EF4444', stroke: '#FECACA', shapeKind: 'triangle', physics2D: 'hazard', contactDamage: 1 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Kits
// ---------------------------------------------------------------------------------------------------------------------

/** Floating ledges over pits; difficulty widens the pits and narrows the ledges. Pit width <= 170 px (reach ~350 px). */
function platformer(params: KitParams): SceneSpec {
  const kit = GENRE_KITS[0];
  const { spec, index, total, d, pal, beat } = frame(params, kit, 'Hop the pits, climb the ledges, collect the stars.');
  const make = nodeMaker();
  const nodes: Node2D[] = [];
  const pitCount = Math.min(3, d - 1);
  const pitWidth = Math.min(170, 110 + d * 15);
  const segCount = pitCount + 1;
  const segWidth = (1000 - pitCount * pitWidth) / segCount;
  for (let s = 0; s < segCount; s++) {
    const from = s * (segWidth + pitWidth);
    nodes.push(ground(make, pal, from, from + segWidth, segCount === 1 ? 'Ground Floor' : `Ground Segment ${s + 1}`));
  }
  const stairs = ledgeStairs(make, pal, Math.min(7, 2 + d), Math.max(100, 220 - d * 22), Math.min(100, 70 + d * 8), 'Star');
  nodes.push(...stairs.nodes, hero(make, pal), levelTitle(make, pal, index, total));
  const target = Math.max(25, Math.floor((stairs.total * Math.min(0.9, 0.6 + d * 0.08)) / 25) * 25);
  spec.nodes2D = nodes;
  spec.gameRules = { winCondition: 'score-threshold', targetScore: target, timeLimitSeconds: Math.max(15, 34 - d * 3), instructions: `${beat} Collect ${target} PTS — A/D to run, W/Space to jump, avoid the pits!` };
  overlay(spec, pal, index, total);
  return spec;
}

/** Keys on a ledge staircase and spikes on the floor between the climbs: every key is needed. */
function keyHunt(params: KitParams): SceneSpec {
  const kit = GENRE_KITS[1];
  const { spec, index, total, d, pal, beat } = frame(params, kit, 'Find every key and hop the spikes.');
  const make = nodeMaker();
  const nodes: Node2D[] = [ground(make, pal)];
  const stairs = ledgeStairs(make, pal, Math.min(6, 2 + d), Math.max(110, 210 - d * 18), Math.min(100, 66 + d * 7), 'Key', 'key');
  nodes.push(...stairs.nodes);
  // Spikes sit on the floor in the gaps between ledges (never under a ledge, so a drop from one cannot land on them, and never near the start).
  const ledges = Math.min(6, 2 + d);
  const gapWidth = stairs.stepX - Math.max(110, 210 - d * 18);
  const spikes = gapWidth >= 56 ? Math.min(3, d, ledges - 2) : 0;
  for (let i = 0; i < spikes; i++) nodes.push(spike(make, stairs.spanStart + stairs.stepX * (i + 1.5), `Spikes ${i + 1}`));
  nodes.push(hero(make, pal, true), levelTitle(make, pal, index, total));
  spec.nodes2D = nodes;
  spec.hud = [healthHud(), scoreHud()];
  spec.gameRules = { winCondition: 'score-threshold', targetScore: stairs.total, timeLimitSeconds: Math.max(25, 50 - d * 3), instructions: `${beat} Collect all ${stairs.total} PTS of keys — A/D to run, W/Space to jump.` };
  overlay(spec, pal, index, total);
  return spec;
}

/** Turrets on both walls fire along the floor: jump the shots while collecting every coin. */
function turretDodge(params: KitParams): SceneSpec {
  const kit = GENRE_KITS[2];
  const { spec, index, total, d, pal, beat } = frame(params, kit, 'Read the turrets, jump the shots, grab every coin.');
  const make = nodeMaker();
  const nodes: Node2D[] = [ground(make, pal)];
  const stairs = ledgeStairs(make, pal, Math.min(5, 2 + Math.ceil(d / 2)), Math.max(130, 220 - d * 14), Math.min(96, 62 + d * 6), 'Coin');
  nodes.push(...stairs.nodes);
  // One shot prefab per side; a turret per side cycles it. Slower shots and longer gaps early on.
  const speed = 220 + d * 22;
  const every = Math.max(1.5, 3.1 - d * 0.22);
  const shotY = GROUND_TOP - 22;
  const prefab = (name: string, dir: 1 | -1) =>
    make({ name, type: 'vector-shape', x: dir > 0 ? 40 : 960, y: shotY, width: 26, height: 22, fill: '#FB923C', stroke: '#FED7AA', shapeKind: 'circle', physics2D: 'none', prefab: true, projectile: { vx: dir * speed, vy: 0, damage: 1, lifetimeSeconds: 5, target: 'player' } });
  const shotL = prefab('Shot Left', 1);
  const shotR = prefab('Shot Right', -1);
  const turret = (name: string, x: number, prefabId: string, delay: number) =>
    make({ name, type: 'vector-shape', x, y: GROUND_TOP - 24, width: 44, height: 48, fill: '#475569', stroke: pal.accent, shapeKind: 'rect', physics2D: 'none', spawner: { prefabId, everySeconds: every, max: 3, startDelay: delay } });
  nodes.push(shotL, shotR, turret('Turret Left', 22, shotL.id, 2.2), turret('Turret Right', 978, shotR.id, 2.2 + every / 2));
  if (d >= 3) nodes.push(spike(make, 520, 'Spikes'));
  nodes.push(hero(make, pal, true), levelTitle(make, pal, index, total));
  spec.nodes2D = nodes;
  spec.hud = [healthHud(), scoreHud()];
  spec.gameRules = { winCondition: 'score-threshold', targetScore: stairs.total, timeLimitSeconds: Math.max(30, 56 - d * 3), instructions: `${beat} Collect ${stairs.total} PTS of coins — A/D to run, W/Space to jump.` };
  overlay(spec, pal, index, total);
  return spec;
}

/** Hazards fall from the ceiling in a lane around the player's start; survive until the clock runs out. */
function survival(params: KitParams): SceneSpec {
  const kit = GENRE_KITS[3];
  const { spec, index, total, d, pal, beat } = frame(params, kit, 'Keep moving: nothing falling on you for the whole clock wins.');
  const make = nodeMaker();
  const nodes: Node2D[] = [ground(make, pal)];
  const fall = 260 + d * 30;
  const every = Math.max(0.6, 1.1 - d * 0.08);
  const rock = make({ name: 'Falling Rock', type: 'vector-shape', x: 500, y: 20, width: 34, height: 34, fill: '#94A3B8', stroke: '#E2E8F0', shapeKind: 'circle', physics2D: 'none', prefab: true, projectile: { vx: 0, vy: fall, damage: 1, lifetimeSeconds: 4, target: 'player' } });
  nodes.push(rock);
  nodes.push(make({ name: 'Rock Dropper', type: 'vector-shape', x: 330, y: 36, width: 80, height: 28, fill: '#475569', stroke: pal.accent, shapeKind: 'rect', physics2D: 'none', spawner: { prefabId: rock.id, everySeconds: every, max: 8, startDelay: 1, jitterX: 300 } }));
  // A couple of ledges give somewhere to climb to; pickups pay a little for the risk.
  nodes.push(make({ name: 'Ledge Left', type: 'tile-platform', x: 220, y: 440, width: 180, height: 28, fill: pal.platform, stroke: pal.accent, shapeKind: 'rect', physics2D: 'static-platform' }));
  nodes.push(make({ name: 'Ledge Right', type: 'tile-platform', x: 780, y: 440, width: 180, height: 28, fill: pal.platform, stroke: pal.accent, shapeKind: 'rect', physics2D: 'static-platform' }));
  nodes.push(make({ name: 'Bonus Coin', type: 'vector-shape', x: 220, y: 395, width: 40, height: 40, fill: pal.star, stroke: '#FEF9C3', shapeKind: 'star', physics2D: 'collectible', scoreValue: 25 }));
  nodes.push(make({ name: 'Bonus Coin 2', type: 'vector-shape', x: 780, y: 395, width: 40, height: 40, fill: pal.star, stroke: '#FEF9C3', shapeKind: 'star', physics2D: 'collectible', scoreValue: 25 }));
  nodes.push(hero(make, pal, true), levelTitle(make, pal, index, total));
  spec.nodes2D = nodes;
  spec.hud = [healthHud(), timeHud()];
  spec.gameRules = { winCondition: 'survive-timer', targetScore: 0, timeLimitSeconds: 14 + d * 2, instructions: `${beat} A/D to run, W/Space to jump.` };
  overlay(spec, pal, index, total);
  return spec;
}

const BUILDERS: Record<GenreKitId, (params: KitParams) => SceneSpec> = {
  platformer,
  'key-hunt': keyHunt,
  'turret-dodge': turretDodge,
  survival,
};

/** A fresh, deterministic 2D game level from the kit. Throws only for an unknown kit id. */
export function buildGenreKit(id: GenreKitId, params: KitParams = {}): SceneSpec {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown genre kit "${String(id)}". Kits: ${GENRE_KITS.map((k) => k.id).join(', ')}.`);
  return build(params);
}

/** The scene fields a kit decides: replacing them turns an existing 2D scene into the kit's level while keeping its id, title and links. */
export const KIT_SCENE_FIELDS = ['nodes2D', 'gameRules', 'hud', 'variables', 'description', 'durationSeconds', 'marketingOverlay'] as const;
