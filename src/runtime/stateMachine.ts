/**
 * Phase 9 — Behaviour state machines (`actors[].stateMachine`, `nodes2D[].stateMachine`).
 *
 * The AI director authors behaviour as data (patrol → chase → attack → return, idle → wave, door closed → opening → open).
 * This module is the ONLY place that interprets it:
 * - `StateMachineRuntime` is a pure interpreter: given the same entities, frame deltas and inputs it produces the same
 *   moves, state changes and actions (random rolls are seeded per actor). No store, no DOM, no Date / Math.random.
 * - `runStateMachines` is the thin host glue used by `RuntimeLogicGraph.advance` (studio Play mode, Play Test, phones and the
 *   exported OmniStage Player all go through it), reading / writing through the bound runtime store.
 * - `sanitizeStateMachine` / `stateMachineIssues` / `repairStateMachine` are the contract checks shared by the AI normaliser
 *   and the verifier (src/verification/sceneVerifier.ts).
 */
import type {
  ActorNode,
  ActorStateMachine,
  AnimationType,
  EngineType,
  GameAudioEvent,
  Node2D,
  SceneSpec,
  StateMachineAction,
  StateMachineCondition,
  StateMachineMove,
  StateMachineState,
  Vector3Tuple,
  VerificationIssue,
  VFXNode,
  VFXType,
} from '../types/scene.schema';
import { runtimeStore } from './host';
import { matchClipName, resolveClipName } from './cinematics';
import { playSceneSfx } from '../audio/audioBus';
import { healthMax } from './game/state';
import { cleanMessage } from './game/messages';
import { nodeBox2D } from './physics/nodeBox';
import { findPath, lineOfSight, NAV_CELL, NavGrid, navSignature, sweptBox, type NavInput } from './nav2d';
import { validMover } from './physics/mover';

// ---------------------------------------------------------------------------------------------------------------------
// Vocabulary (closed unions, mirrored in the agent prompt and the MCP contract)
// ---------------------------------------------------------------------------------------------------------------------

export const STATE_MACHINE_MOVES: StateMachineMove[] = ['stay', 'patrol', 'move-to', 'chase-player', 'flee-player', 'return-home'];
export const STATE_MACHINE_CONDITIONS: Array<StateMachineCondition['type']> = [
  'player-near', 'player-far', 'timer', 'arrived', 'health-below', 'score-at-least', 'signal', 'collided', 'clicked', 'random',
  'player-visible', 'player-hidden',
];
export const STATE_MACHINE_ACTIONS: Array<StateMachineAction['type']> = [
  'add-score', 'add-health', 'spawn-vfx', 'play-sfx', 'send-signal', 'set-visible', 'show-message', 'end-game',
];
const ANIMATIONS: AnimationType[] = ['idle', 'bounce', 'spin', 'walk', 'attack', 'float'];
const VFX_TYPES: VFXType[] = ['sparkles', 'shockwave', 'floating-3d-badge', 'laser-beam', 'confetti'];
const SOUNDS: GameAudioEvent[] = ['collect', 'jump', 'hit', 'win', 'lose', 'click', 'scene-start'];
const STATE_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const LIMITS = { states: 16, transitions: 12, actions: 8, points: 12 };
/** Defaults per engine: 3D metres (game arena ±5.5), 2D design px (1000x600). */
const ENGINE = {
  '3d': { speed: 1.5, stop: 0.7, min: [-5.5, 0, -5.5], max: [5.5, 1000, 5.5] },
  '2d': { speed: 120, stop: 28, min: [0, 0, 0], max: [1000, 600, 0] },
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Contract: sanitise AI output (drops unknown types, clamps numbers, keeps references for the verifier to judge)
// ---------------------------------------------------------------------------------------------------------------------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const signalName = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);

function sanitizeCondition(raw: any): StateMachineCondition | null {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.type) {
    case 'player-near':
    case 'player-far':
      return finite(raw.distance) && raw.distance > 0 ? { type: raw.type, distance: Math.min(raw.distance, 2000) } : null;
    case 'player-visible':
    case 'player-hidden':
      return { type: raw.type, ...(finite(raw.distance) && raw.distance > 0 ? { distance: Math.min(raw.distance, 2000) } : {}) };
    case 'timer':
      return finite(raw.seconds) ? { type: 'timer', seconds: clamp(raw.seconds, 0, 600) } : null;
    case 'health-below':
    case 'score-at-least':
      return finite(raw.value) ? { type: raw.type, value: raw.value } : null;
    case 'signal': {
      const name = signalName(raw.name);
      return name ? { type: 'signal', name } : null;
    }
    case 'arrived':
    case 'collided':
    case 'clicked':
      return { type: raw.type };
    case 'random':
      if (!finite(raw.chance)) return null;
      return { type: 'random', chance: clamp(raw.chance, 0, 1), ...(finite(raw.every) ? { every: clamp(raw.every, 0.1, 60) } : {}) };
    default:
      return null;
  }
}

function sanitizeAction(raw: any): StateMachineAction | null {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.type) {
    case 'add-score':
    case 'add-health':
      return finite(raw.amount) ? { type: raw.type, amount: clamp(raw.amount, -10000, 10000) } : null;
    case 'spawn-vfx':
      return VFX_TYPES.includes(raw.vfx) ? { type: 'spawn-vfx', vfx: raw.vfx, ...(typeof raw.color === 'string' ? { color: raw.color.slice(0, 32) } : {}) } : null;
    case 'play-sfx':
      return SOUNDS.includes(raw.sound) ? { type: 'play-sfx', sound: raw.sound } : null;
    case 'send-signal': {
      const name = signalName(raw.name);
      return name ? { type: 'send-signal', name } : null;
    }
    case 'show-message': {
      const msg = cleanMessage(raw);
      return msg ? { type: 'show-message', text: msg.text, ...(msg.speaker ? { speaker: msg.speaker } : {}), ...(finite(raw.seconds) ? { seconds: msg.seconds } : {}) } : null;
    }
    case 'set-visible':
    case 'end-game': {
      const key = raw.type === 'set-visible' ? 'visible' : 'won';
      return typeof raw[key] === 'boolean' ? ({ type: raw.type, [key]: raw[key] } as StateMachineAction) : null;
    }
    default:
      return null;
  }
}

function sanitizeState(raw: any): StateMachineState {
  const out: StateMachineState = {};
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.clip === 'string' && raw.clip.trim()) out.clip = raw.clip.trim().slice(0, 64);
  if (ANIMATIONS.includes(raw.animation)) out.animation = raw.animation;
  if (STATE_MACHINE_MOVES.includes(raw.move)) out.move = raw.move;
  if (Array.isArray(raw.points)) {
    const points = raw.points
      .filter((p: unknown) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every(finite))
      .slice(0, LIMITS.points)
      .map((p: number[]) => [...p]);
    if (points.length) out.points = points;
  }
  if (finite(raw.speed) && raw.speed > 0) out.speed = Math.min(raw.speed, 1000);
  if (raw.pathfind === true) out.pathfind = true;
  if (Array.isArray(raw.onEnter)) {
    const actions = raw.onEnter.map(sanitizeAction).filter(Boolean).slice(0, LIMITS.actions) as StateMachineAction[];
    if (actions.length) out.onEnter = actions;
  }
  if (Array.isArray(raw.transitions)) {
    const transitions = raw.transitions
      .map((t: any) => {
        const when = t && typeof t.to === 'string' && t.to ? sanitizeCondition(t.when) : null;
        return when ? { to: t.to, when } : null;
      })
      .filter(Boolean)
      .slice(0, LIMITS.transitions);
    if (transitions.length) out.transitions = transitions;
  }
  return out;
}

/** Cleans an AI-authored machine: unknown types / bad numbers are dropped or clamped. Returns null when nothing usable is left. */
export function sanitizeStateMachine(raw: unknown): ActorStateMachine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (!r.states || typeof r.states !== 'object' || Array.isArray(r.states)) return null;
  const states: Record<string, StateMachineState> = {};
  for (const [name, state] of Object.entries(r.states)) {
    if (!STATE_NAME_RE.test(name) || Object.keys(states).length >= LIMITS.states) continue;
    states[name] = sanitizeState(state);
  }
  if (!Object.keys(states).length) return null;
  return {
    initial: typeof r.initial === 'string' ? r.initial : '',
    states,
    ...(finite(r.health) ? { health: clamp(r.health, 1, 100000) } : {}),
    ...(finite(r.seed) ? { seed: Math.trunc(r.seed) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Verifier rules (pure). Codes: machine.invalid | machine.no-initial | machine.transition-missing | machine.unreachable |
// machine.clip-missing | machine.signal-unsent | machine.no-player | machine.media-mode
// ---------------------------------------------------------------------------------------------------------------------

type MachineHost = Pick<ActorNode, 'id' | 'stateMachine'> & Partial<Pick<ActorNode, 'availableClips' | 'physicsRole'>> & Partial<Pick<Node2D, 'spriteSheet' | 'physics2D'>>;

function isHost2D(host: MachineHost) {
  return 'physics2D' in host && host.physics2D !== undefined;
}

/** Every signal name something in the scene can send (machine actions + logic-graph 'send-signal' nodes). */
export function sentSignals(spec: Pick<SceneSpec, 'actors' | 'nodes2D' | 'logicGraph'>): Set<string> {
  const out = new Set<string>();
  for (const host of [...(spec.actors || []), ...(spec.nodes2D || [])]) {
    for (const st of Object.values(host.stateMachine?.states || {})) for (const a of st?.onEnter || []) if (a?.type === 'send-signal') out.add(a.name);
  }
  for (const node of spec.logicGraph?.nodes || []) if (node.params?.actionType === 'send-signal' && node.params.signal) out.add(String(node.params.signal));
  return out;
}

function reachableStates(machine: ActorStateMachine): Set<string> {
  const seen = new Set<string>();
  const queue = machine.states[machine.initial] ? [machine.initial] : [];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const t of machine.states[name]?.transitions || []) if (machine.states[t.to] && !seen.has(t.to)) queue.push(t.to);
  }
  return seen;
}

function clipNames(host: MachineHost): string[] | null {
  if (isHost2D(host)) return Object.keys(host.spriteSheet?.clips || {});
  return host.availableClips?.length ? host.availableClips : null;
}

/** Key-order independent JSON (AI output lists fields in any order). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const kept = (v: unknown) => v !== undefined && !(Array.isArray(v) && !v.length);
    return `{${Object.keys(value).filter((k) => kept((value as any)[k])).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 3D clips resolve like `matchClipName` ("Fly" -> Flying, "Bite" -> Attack); 2D sprite clips need the exact (case-insensitive) key. */
const hasClip = (names: string[], clip: string, loose: boolean) =>
  names.some((n) => n.toLowerCase() === clip.toLowerCase()) || (loose && resolveClipName(clip, names) !== undefined);

export interface MachineIssue {
  code: string;
  severity: VerificationIssue['severity'];
  message: string;
  fixable: boolean;
}

/** Problems with one actor's / node's machine. Pure and deterministic (verifier contract). */
export function stateMachineIssues(host: MachineHost, spec: Pick<SceneSpec, 'mode' | 'actors' | 'nodes2D' | 'logicGraph'>): MachineIssue[] {
  const raw = host.stateMachine;
  if (raw === undefined) return [];
  const clean = sanitizeStateMachine(raw);
  if (!clean) return [{ code: 'machine.invalid', severity: 'error', message: 'stateMachine has no usable states', fixable: true }];
  const out: MachineIssue[] = [];
  const asAuthored = { ...(raw as object), initial: typeof (raw as ActorStateMachine).initial === 'string' ? (raw as ActorStateMachine).initial : '' };
  if (canonicalJson(clean) !== canonicalJson(asAuthored)) {
    out.push({ code: 'machine.invalid', severity: 'error', message: 'stateMachine has unknown condition / action / move types or bad numbers', fixable: true });
  }
  const m = clean;
  if (!m.states[m.initial]) {
    out.push({ code: 'machine.no-initial', severity: 'error', message: `initial state "${m.initial}" is not one of: ${Object.keys(m.states).join(', ')}`, fixable: true });
  }
  const missing = new Set<string>();
  for (const st of Object.values(m.states)) for (const t of st.transitions || []) if (!m.states[t.to]) missing.add(t.to);
  if (missing.size) out.push({ code: 'machine.transition-missing', severity: 'error', message: `transitions go to unknown states: ${[...missing].join(', ')}`, fixable: true });
  if (m.states[m.initial]) {
    const reach = reachableStates(m);
    const dead = Object.keys(m.states).filter((s) => !reach.has(s));
    if (dead.length) out.push({ code: 'machine.unreachable', severity: 'warning', message: `states no transition leads to: ${dead.join(', ')}`, fixable: true });
  }
  const names = clipNames(host);
  if (names) {
    const bad = Object.entries(m.states).filter(([, st]) => st.clip && !hasClip(names, st.clip, !isHost2D(host))).map(([n, st]) => `${n}: ${st.clip}`);
    if (bad.length) out.push({ code: 'machine.clip-missing', severity: 'warning', message: `clips the ${isHost2D(host) ? 'spritesheet' : 'model'} does not have (${bad.join(', ')})`, fixable: true });
  }
  const signals = sentSignals(spec);
  const waiting = new Set<string>();
  for (const st of Object.values(m.states)) for (const t of st.transitions || []) if (t.when.type === 'signal' && !signals.has(t.when.name)) waiting.add(t.when.name);
  if (waiting.size) out.push({ code: 'machine.signal-unsent', severity: 'warning', message: `waits for signals nothing sends: ${[...waiting].join(', ')}`, fixable: false });
  const usesPlayer = Object.values(m.states).some((st) =>
    st.move === 'chase-player' || st.move === 'flee-player' ||
    (st.transitions || []).some((t) => ['player-near', 'player-far', 'collided', 'player-visible', 'player-hidden'].includes(t.when.type)));
  const hasPlayer = isHost2D(host)
    ? (spec.nodes2D || []).some((n) => n.physics2D?.startsWith('player-'))
    : (spec.actors || []).some((a) => a.physicsRole === 'player');
  if (usesPlayer && !hasPlayer) out.push({ code: 'machine.no-player', severity: 'warning', message: 'reacts to the player but the scene has no player', fixable: false });
  if (!isHost2D(host) && Object.values(m.states).some((st) => st.pathfind)) {
    out.push({ code: 'machine.pathfind-3d', severity: 'warning', message: 'pathfind only works in 2D scenes (3D arenas have no walls to walk around)', fixable: false });
  }
  if (spec.mode !== 'game') out.push({ code: 'machine.media-mode', severity: 'warning', message: 'state machines only run in game mode (use performance for films)', fixable: false });
  return out;
}

/** Deterministic auto-fix for one issue code. Returns the repaired machine, or null to remove it. */
export function repairStateMachine(host: MachineHost, code: string): ActorStateMachine | null {
  const m = sanitizeStateMachine(host.stateMachine);
  if (!m) return null;
  const names = Object.keys(m.states);
  if (code === 'machine.no-initial' && !m.states[m.initial]) m.initial = names[0];
  if (code === 'machine.transition-missing') {
    for (const st of Object.values(m.states)) {
      if (!st.transitions) continue;
      st.transitions = st.transitions.filter((t) => m.states[t.to]);
      if (!st.transitions.length) delete st.transitions;
    }
  }
  if (code === 'machine.unreachable') {
    const reach = reachableStates(m);
    for (const n of names) if (!reach.has(n)) delete m.states[n];
  }
  if (code === 'machine.clip-missing') {
    const clips = clipNames(host);
    if (clips) for (const st of Object.values(m.states)) if (st.clip && !hasClip(clips, st.clip, !isHost2D(host))) delete st.clip;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure interpreter
// ---------------------------------------------------------------------------------------------------------------------

export interface MachineEntity {
  id: string;
  /** 3D: [x, y, z]; 2D: [x, y, 0]. */
  position: Vector3Tuple;
  machine: ActorStateMachine;
  /** Clips the entity can play (3D availableClips / 2D spritesheet clips). */
  clips?: string[];
  clip?: string;
  animation?: AnimationType;
}

export interface MachineInputs {
  engine: EngineType;
  /** Live player position (undefined: no player). */
  player?: Vector3Tuple;
  score: number;
  /** Entity ids clicked since the previous step. */
  clicked: ReadonlySet<string>;
  /** Entity ids touching the player. */
  touching: ReadonlySet<string>;
  /** Signals sent since the previous step. */
  signals: ReadonlySet<string>;
  /** Phase 3: real hit points of an entity that has `health` (the machine's own counter is used otherwise). */
  healthOf?: (id: string) => number | undefined;
  /** Phase 7A (2D): the walls, for `pathfind` and `player-visible`. Absent = no walls. */
  nav?: NavInput;
}

export interface MachineLook {
  clip?: string;
  animation?: AnimationType;
}

export interface MachineStepResult {
  moves: Map<string, { position: Vector3Tuple; yaw?: number }>;
  /** State changes this step, in entity order (the first entry per entity on its first step has no `from`). */
  entered: Array<{ id: string; from?: string; to: string; look: MachineLook }>;
  actions: Array<{ id: string; action: StateMachineAction }>;
  /** Signals sent this step; deliver them on the next step. */
  signals: string[];
}

interface MachineRun {
  state: string;
  time: number;
  home: Vector3Tuple;
  health: number;
  rng: number;
  patrol: number;
  arrived: boolean;
  rolls: number[];
  base: MachineLook;
  /** Phase 7A: the route being walked (re-planned when the goal moves or every PLAN_SECONDS). */
  path?: { goal: [number, number]; points: Array<[number, number]>; age: number; /** No route was found: do not search again until the goal moves or PLAN_SECONDS pass. */ failed?: boolean };
}

/** Seconds a planned route is trusted before it is planned again (walls may move). */
const PLAN_SECONDS = 0.5;
/** A waypoint counts as reached inside this many px. */
const WAYPOINT_REACHED = 6;

/** FNV-1a: stable seed from an id. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 step: returns [0, 1) and the next state. */
function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

const toVec = (p: number[], engine: EngineType, fallback: Vector3Tuple): Vector3Tuple =>
  engine === '2d' ? [p[0], p[1], 0] : p.length === 3 ? [p[0], p[1], p[2]] : [p[0], fallback[1], p[1]];

/** Planar distance used by every distance rule: x/z in 3D, x/y in 2D. */
export function machineDistance(a: Vector3Tuple, b: Vector3Tuple, engine: EngineType): number {
  return engine === '2d' ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function findClip(clips: string[] | undefined, wanted: string, loose = false): string | undefined {
  if (!clips?.length) return wanted;
  return clips.find((c) => c.toLowerCase() === wanted.toLowerCase()) ?? (loose ? resolveClipName(wanted, clips) : undefined);
}

/** Clip / procedural animation for a state: authored values first, else Walk / Run while moving and the actor's own look at rest. */
export function lookForState(state: StateMachineState, entity: Pick<MachineEntity, 'clips'>, base: MachineLook, engine: EngineType): MachineLook {
  const moving = !!state.move && state.move !== 'stay';
  let clip = state.clip ? findClip(entity.clips, state.clip, engine === '3d') : undefined;
  if (!clip && entity.clips?.length && engine === '3d') {
    clip = moving ? matchClipName((state.speed ?? ENGINE['3d'].speed) > 2.6 ? 'Run' : 'Walk', entity.clips) : base.clip ?? matchClipName('Idle', entity.clips);
  }
  if (!clip && engine === '2d' && entity.clips?.length) clip = findClip(entity.clips, moving ? 'run' : 'idle') ?? base.clip;
  return { clip: clip ?? base.clip, animation: state.animation ?? (moving ? 'walk' : base.animation) };
}

export class StateMachineRuntime {
  private runs = new Map<string, MachineRun>();
  private grid?: { key: string; grid: NavGrid };

  reset() {
    this.runs.clear();
    this.grid = undefined;
  }

  private gridFor(nav: NavInput): NavGrid {
    const key = navSignature(nav);
    if (this.grid?.key !== key) this.grid = { key, grid: new NavGrid(nav) };
    return this.grid.grid;
  }

  /**
   * Where to walk next to reach `goal` around the walls: the goal itself when nothing is in the way, else the next waypoint of the
   * planned route. `final` is true when the point returned IS the goal. Null = no route exists (stand still).
   */
  private steer(run: MachineRun, position: Vector3Tuple, goal: Vector3Tuple, nav: NavInput, dt: number): { target: Vector3Tuple; final: boolean } | null {
    const from: [number, number] = [position[0], position[1]];
    const to: [number, number] = [goal[0], goal[1]];
    if (lineOfSight(nav.blockers, from, to, 10)) {
      run.path = undefined;
      return { target: goal, final: true };
    }
    let p = run.path;
    if (!p || Math.hypot(p.goal[0] - to[0], p.goal[1] - to[1]) > NAV_CELL * 1.5 || p.age >= PLAN_SECONDS) {
      const points = findPath(this.gridFor(nav), from, to);
      if (!points) {
        run.path = { goal: to, points: [], age: 0, failed: true };
        return null;
      }
      p = run.path = { goal: to, points, age: 0 };
    }
    p.age += dt;
    if (p.failed) return null;
    while (p.points.length > 1 && Math.hypot(p.points[0][0] - from[0], p.points[0][1] - from[1]) < WAYPOINT_REACHED) p.points.shift();
    const next = p.points[0];
    if (!next) return { target: goal, final: true };
    return { target: [next[0], next[1], 0], final: p.points.length === 1 };
  }

  /** Where each running entity started (its authored pose), for putting it back when the session restarts. */
  startPoses(): Map<string, { position: Vector3Tuple; clip?: string; animation?: AnimationType }> {
    return new Map([...this.runs].map(([id, r]) => [id, { position: [...r.home] as Vector3Tuple, clip: r.base.clip, animation: r.base.animation }]));
  }

  /** Current state of an entity (undefined before its first step). */
  stateOf(id: string): string | undefined {
    return this.runs.get(id)?.state;
  }

  healthOf(id: string): number | undefined {
    return this.runs.get(id)?.health;
  }

  step(dt: number, entities: MachineEntity[], inputs: MachineInputs): MachineStepResult {
    const result: MachineStepResult = { moves: new Map(), entered: [], actions: [], signals: [] };
    const cfg = ENGINE[inputs.engine];
    const live = new Set(entities.map((e) => e.id));
    for (const id of [...this.runs.keys()]) if (!live.has(id)) this.runs.delete(id);

    for (const entity of entities) {
      const m = entity.machine;
      const names = Object.keys(m.states || {});
      if (!names.length) continue;
      let run = this.runs.get(entity.id);
      if (!run || !m.states[run.state]) {
        const initial = m.states[m.initial] ? m.initial : names[0];
        run = {
          state: initial, time: 0, home: [...entity.position], health: m.health ?? 100,
          rng: (hashString(entity.id) ^ (m.seed ?? 1)) >>> 0, patrol: 0, arrived: false, rolls: [],
          base: { clip: entity.clip, animation: entity.animation },
        };
        this.runs.set(entity.id, run);
        this.enter(entity, run, initial, undefined, result, inputs.engine);
        continue;
      }

      run.time += dt;
      const state = m.states[run.state];
      // --- movement ---
      const position: Vector3Tuple = [...entity.position];
      const move = state.move ?? 'stay';
      const speed = state.speed ?? cfg.speed;
      let target: Vector3Tuple | undefined;
      let stop = 0;
      let planar = false;
      if (move === 'stay') run.arrived = true;
      else if (move === 'move-to') target = state.points?.length ? toVec(state.points[0], inputs.engine, position) : undefined;
      else if (move === 'return-home') target = run.home;
      else if (move === 'patrol' && state.points?.length) target = toVec(state.points[run.patrol % state.points.length], inputs.engine, position);
      else if (move === 'chase-player' && inputs.player) {
        target = inputs.player;
        stop = cfg.stop;
        planar = true;
      } else if (move === 'flee-player' && inputs.player) {
        const d = machineDistance(position, inputs.player, inputs.engine) || 1;
        const away = inputs.engine === '2d'
          ? [(position[0] - inputs.player[0]) / d, (position[1] - inputs.player[1]) / d, 0]
          : [(position[0] - inputs.player[0]) / d, 0, (position[2] - inputs.player[2]) / d];
        target = [position[0] + away[0] * speed, position[1] + away[1] * speed, position[2] + away[2] * speed];
        planar = true;
      }
      // Phase 7A: with `pathfind` a 2D walker goes around the walls; `leg` is true while it heads for a waypoint, not the goal.
      let leg = false;
      let noRoute = false;
      if (target && state.pathfind && inputs.engine === '2d' && inputs.nav?.blockers.length && move !== 'flee-player') {
        const route = this.steer(run, position, target, inputs.nav, dt);
        if (route) {
          leg = !route.final;
          target = route.target;
        } else {
          target = undefined;
          noRoute = true;
        }
      } else run.path = undefined;
      if (!target && !noRoute && move !== 'stay' && move !== 'flee-player') run.arrived = true;
      if (target && dt > 0) {
        const axes = inputs.engine === '2d' ? [0, 1] : planar ? [0, 2] : [0, 1, 2];
        const delta = axes.map((i) => target![i] - position[i]);
        const dist = Math.hypot(...delta);
        const travel = Math.max(0, dist - (leg ? 0 : stop));
        const stepLen = Math.min(travel, speed * dt);
        if (travel <= 1e-6) {
          if (move !== 'flee-player' && !leg) run.arrived = true;
        } else {
          axes.forEach((axis, k) => (position[axis] += (delta[k] / dist) * stepLen));
          for (let i = 0; i < 3; i++) position[i] = clamp(position[i], cfg.min[i], cfg.max[i]);
          const yaw = inputs.engine === '3d' ? Math.atan2(delta[0], delta[axes.length === 3 ? 2 : 1]) : undefined;
          result.moves.set(entity.id, { position, yaw });
          if (stepLen >= travel - 1e-6 && move !== 'flee-player' && !leg) {
            if (move === 'patrol' && state.points?.length) {
              run.patrol = (run.patrol + 1) % state.points.length;
              if (run.patrol === 0) run.arrived = true;
            } else run.arrived = true;
          }
        }
      }

      // --- transitions (first true wins, at most one per step) ---
      const transitions = state.transitions || [];
      for (let i = 0; i < transitions.length; i++) {
        const t = transitions[i];
        if (!m.states[t.to]) continue;
        if (this.check(t.when, i, entity, run, { ...inputs, player: inputs.player }, position)) {
          this.enter(entity, run, t.to, run.state, result, inputs.engine, position);
          break;
        }
      }
    }
    return result;
  }

  /** Is the player within `distance` (if given) and not behind a wall? (2D only has walls.) */
  private sees(position: Vector3Tuple, inputs: MachineInputs, distance?: number): boolean {
    if (!inputs.player) return false;
    if (distance !== undefined && machineDistance(position, inputs.player, inputs.engine) > distance) return false;
    if (inputs.engine !== '2d' || !inputs.nav) return true;
    return lineOfSight(inputs.nav.blockers, [position[0], position[1]], [inputs.player[0], inputs.player[1]]);
  }

  private check(c: StateMachineCondition, index: number, entity: MachineEntity, run: MachineRun, inputs: MachineInputs, position: Vector3Tuple): boolean {
    switch (c.type) {
      case 'player-near':
        return !!inputs.player && machineDistance(position, inputs.player, inputs.engine) <= c.distance;
      case 'player-far':
        return !inputs.player || machineDistance(position, inputs.player, inputs.engine) > c.distance;
      case 'player-visible':
        return this.sees(position, inputs, c.distance);
      case 'player-hidden':
        return !this.sees(position, inputs, c.distance);
      case 'timer':
        return run.time >= c.seconds;
      case 'arrived':
        return run.arrived;
      case 'health-below':
        return (inputs.healthOf?.(entity.id) ?? run.health) < c.value;
      case 'score-at-least':
        return inputs.score >= c.value;
      case 'signal':
        return inputs.signals.has(c.name);
      case 'collided':
        return inputs.touching.has(entity.id);
      case 'clicked':
        return inputs.clicked.has(entity.id);
      case 'random': {
        const every = Math.max(0.1, c.every ?? 1);
        const due = Math.floor(run.time / every + 1e-9);
        let hit = false;
        while ((run.rolls[index] ?? 0) < due) {
          run.rolls[index] = (run.rolls[index] ?? 0) + 1;
          const [roll, next] = nextRandom(run.rng);
          run.rng = next;
          if (roll < c.chance) hit = true;
        }
        return hit;
      }
      default:
        return false;
    }
  }

  private enter(entity: MachineEntity, run: MachineRun, to: string, from: string | undefined, result: MachineStepResult, engine: EngineType, position: Vector3Tuple = entity.position) {
    const state = entity.machine.states[to];
    run.state = to;
    run.time = 0;
    run.arrived = false;
    run.rolls = [];
    if (state.move === 'patrol' && state.points?.length) {
      // Resume the loop at the nearest waypoint (after a chase the guard walks back onto its route).
      let best = 0;
      let bestDist = Infinity;
      state.points.forEach((p, i) => {
        const d = machineDistance(position, toVec(p, engine, position), engine);
        if (d < bestDist) [best, bestDist] = [i, d];
      });
      run.patrol = best;
    }
    result.entered.push({ id: entity.id, from, to, look: lookForState(state, entity, run.base, engine) });
    for (const action of state.onEnter || []) {
      if (action.type === 'add-health') run.health += action.amount;
      if (action.type === 'send-signal') result.signals.push(action.name);
      result.actions.push({ id: entity.id, action });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Host glue: called from RuntimeLogicGraph.advance (studio + Player), reads / writes the bound runtime store
// ---------------------------------------------------------------------------------------------------------------------

export interface MachineFrameInputs {
  clicked: Set<string>;
  signals: Set<string>;
  /** Contact pairs from the last `collisions()` call. */
  contacts: Array<[string, string]>;
  positionFor?: (id: string) => Vector3Tuple | undefined;
}

function restoreStartPoses(engine: EngineType, starts: ReturnType<StateMachineRuntime['startPoses']>) {
  runtimeStore.setState((current) => {
    const s = current.sceneSpec;
    if (engine === '3d') {
      return { sceneSpec: { ...s, actors: s.actors.map((a) => {
        const p = starts.get(a.id);
        return p && a.stateMachine ? { ...a, position: p.position, activeClip: p.clip ?? a.activeClip, activeAnimation: p.animation ?? a.activeAnimation } : a;
      }) } };
    }
    return { sceneSpec: { ...s, nodes2D: s.nodes2D.map((n) => {
      const p = starts.get(n.id);
      return p && n.stateMachine ? { ...n, x: p.position[0], y: p.position[1], ...(p.clip && n.spriteSheet?.clips?.[p.clip] ? { spriteSheet: { ...n.spriteSheet, activeClip: p.clip } } : {}) } : n;
    }) } };
  });
}

/** One frame of every state machine in the active game scene. Consumes `clicked` and `signals`. */
export function runStateMachines(machines: StateMachineRuntime, engine: EngineType, dt: number, frame: MachineFrameInputs) {
  const state = runtimeStore.getState();
  const spec = state.sceneSpec;
  if (spec.mode !== 'game' || !state.isPlaying || state.gameEnded || spec.engineType !== engine) return;
  const hosts: Array<ActorNode | Node2D> = engine === '3d' ? spec.actors.filter((a) => a.stateMachine) : spec.nodes2D.filter((n) => n.stateMachine);
  if (!hosts.length) {
    frame.clicked.clear();
    frame.signals.clear();
    return;
  }
  // resetGameSession / scene switch clear `machineStates`: restart every machine from its initial state.
  if (!state.machineStates) {
    // ... and put the machine-driven actors back where they started (resetGameSession keeps the moved poses of non-template scenes).
    const starts = machines.startPoses();
    if (starts.size) restoreStartPoses(engine, starts);
    machines.reset();
  }
  const fresh = runtimeStore.getState().sceneSpec;
  const liveHosts: Array<ActorNode | Node2D> = engine === '3d' ? fresh.actors.filter((a) => a.stateMachine) : fresh.nodes2D.filter((n) => n.stateMachine);
  const entities: MachineEntity[] = liveHosts.map((h) => 'physics2D' in h
    ? { id: h.id, position: [h.x, h.y, 0], machine: h.stateMachine!, clips: Object.keys(h.spriteSheet?.clips || {}), clip: h.spriteSheet?.activeClip }
    : { id: h.id, position: [...h.position], machine: h.stateMachine!, clips: h.availableClips, clip: h.activeClip, animation: h.activeAnimation });
  const player = engine === '3d'
    ? spec.actors.find((a) => a.physicsRole === 'player' && a.visible !== false)
    : spec.nodes2D.find((n) => n.physics2D.startsWith('player-') && n.visible !== false);
  const playerPos: Vector3Tuple | undefined = player
    ? frame.positionFor?.(player.id) ?? ('position' in player ? player.position : [player.x, player.y, 0])
    : undefined;
  const touching = new Set<string>();
  if (player) for (const [a, b] of frame.contacts) if (a === player.id) touching.add(b); else if (b === player.id) touching.add(a);

  // Phase 7A: the walls (solid nodes, current positions) for pathfinding and line of sight.
  const nav: NavInput | undefined = engine === '2d'
    ? (() => {
        const blockers = fresh.nodes2D.filter((n) => n.physics2D === 'solid' && n.visible !== false && !n.prefab).map((n) => sweptBox(nodeBox2D(n, { x: n.x, y: n.y }), validMover(n.mover) ? n.mover : undefined));
        return blockers.length ? { blockers, world: { width: fresh.world2D?.width ?? 1000, height: fresh.world2D?.height ?? 600 } } : undefined;
      })()
    : undefined;

  const result = machines.step(dt, entities, {
    engine, player: playerPos, nav, score: state.gameScore, clicked: new Set(frame.clicked), touching, signals: new Set(frame.signals),
    healthOf: (id) => {
      const e = fresh.nodes2D.find((n) => n.id === id) ?? fresh.actors.find((a) => a.id === id);
      const max = healthMax(e);
      return max === undefined ? undefined : runtimeStore.getState().gameHealth[id] ?? max;
    },
  });
  frame.clicked.clear();
  frame.signals.clear();
  for (const name of result.signals) frame.signals.add(name);
  if (!result.moves.size && !result.entered.length && !result.actions.length) return;

  const looks = new Map(result.entered.map((e) => [e.id, e.look]));
  const visibility = new Map<string, boolean>();
  for (const { id, action } of result.actions) if (action.type === 'set-visible') visibility.set(id, action.visible);
  runtimeStore.setState((current) => {
    const s = current.sceneSpec;
    const patchActor = (a: ActorNode): ActorNode => {
      const move = result.moves.get(a.id);
      const look = looks.get(a.id);
      if (!move && !look && !visibility.has(a.id)) return a;
      return {
        ...a,
        ...(move ? { position: move.position, rotation: [a.rotation[0], move.yaw ?? a.rotation[1], a.rotation[2]] as Vector3Tuple } : {}),
        ...(look ? { activeClip: look.clip ?? a.activeClip, activeAnimation: look.animation ?? a.activeAnimation } : {}),
        ...(visibility.has(a.id) ? { visible: visibility.get(a.id) } : {}),
      };
    };
    const patchNode = (n: Node2D): Node2D => {
      const move = result.moves.get(n.id);
      const look = looks.get(n.id);
      if (!move && !look && !visibility.has(n.id)) return n;
      return {
        ...n,
        ...(move ? { x: move.position[0], y: move.position[1] } : {}),
        ...(look?.clip && n.spriteSheet?.clips?.[look.clip] ? { spriteSheet: { ...n.spriteSheet, activeClip: look.clip } } : {}),
        ...(visibility.has(n.id) ? { visible: visibility.get(n.id) } : {}),
      };
    };
    const machineStates = { ...(current.machineStates || {}) };
    for (const e of result.entered) machineStates[e.id] = e.to;
    return {
      sceneSpec: { ...s, ...(engine === '3d' ? { actors: s.actors.map(patchActor) } : { nodes2D: s.nodes2D.map(patchNode) }) },
      ...(result.entered.length ? { machineStates } : {}),
    };
  });

  const names = new Map(hosts.map((h) => [h.id, h.name]));
  for (const e of result.entered) {
    if (!e.from) continue;
    runtimeStore.getState().appendLog({ level: 'info', actorId: e.id, message: `[State Machine] ${names.get(e.id)}: ${e.from} → ${e.to}` });
  }
  for (const { id, action } of result.actions) {
    const now = runtimeStore.getState();
    if (now.gameEnded) break;
    const label = names.get(id) || id;
    switch (action.type) {
      case 'add-score':
        now.addGameScore(action.amount, label);
        break;
      case 'add-health':
        // With real hit points (Phase 3) the machine's heal / damage goes through the shared health rules.
        if (action.amount >= 0) now.healEntity(id, action.amount);
        else now.damageEntity(id, -action.amount);
        break;
      case 'play-sfx':
        playSceneSfx(now.sceneSpec, action.sound);
        break;
      case 'spawn-vfx': {
        const host = engine === '3d' ? now.sceneSpec.actors.find((a) => a.id === id) : now.sceneSpec.nodes2D.find((n) => n.id === id);
        if (!host) break;
        const position: Vector3Tuple = 'position' in host ? [host.position[0], host.position[1] + 0.2, host.position[2]] : [host.x, host.y, 0];
        const effect: VFXNode = { id: `runtime-vfx-sm-${id}`, name: `${label} ${action.vfx}`, type: action.vfx, position, color: action.color || '#38BDF8',
          intensity: 1, visible: true, startTime: now.currentTime, endTime: now.currentTime + 1 };
        runtimeStore.setState((current) => ({ sceneSpec: { ...current.sceneSpec, vfx: [...current.sceneSpec.vfx.filter((v) => v.id !== effect.id), effect] } }));
        break;
      }
      case 'show-message':
        runtimeStore.getState().showMessage(action.text, { speaker: action.speaker, seconds: action.seconds });
        break;
      case 'end-game':
        runtimeStore.setState({ gameEnded: true, gameWon: action.won });
        break;
      default:
        break; // send-signal / set-visible are handled by the interpreter and the patch above.
    }
  }
}
