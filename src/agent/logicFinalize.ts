/**
 * Visual logic graph: mechanic wiring, structural validation and execution repair (pure, no store / DOM / fetch).
 * Extracted from studioAgent.ts so the MCP server and the tool loop run the exact same `finalizeLogicGraph`.
 * studioAgent re-exports the public names, so existing imports keep working.
 */
import { ASSET_REGISTRY, cloneSceneSpec } from '../registry/assetRegistry';
import type { ActorNode, AnimationType, LogicEdge, LogicGraphSpec, LogicNode, LogicNodePort, LogicNodeType, PhysicsRole, SceneSpec } from '../types/scene.schema';

// ============================================================================
// VISUAL LOGIC GRAPH: MECHANIC WIRING, STRUCTURAL VALIDATION & EXECUTION REPAIR
// ============================================================================

const GRAPH_COLUMN_X: Record<LogicNodeType, number> = {
  trigger: 60,
  condition: 380,
  action: 700,
  'media-pipeline': 1020,
  'robot-hardware': 1020,
};

// Flow always runs left -> right, so linking only from a strictly lower rank can never create a cycle.
const GRAPH_RANK: Record<LogicNodeType, number> = {
  trigger: 0,
  condition: 1,
  action: 2,
  'media-pipeline': 3,
  'robot-hardware': 3,
};

const GRAPH_ROW_HEIGHT = 230;
const VALID_ANIMATIONS: AnimationType[] = ['idle', 'bounce', 'spin', 'walk', 'attack', 'float'];
const CINEMATIC_CAMERA_MODES = ['orbit-360', 'dolly-zoom-in', 'crane-reveal', 'cinematic-flythrough'];

const round1 = (n: number) => Math.round(n * 10) / 10;
const port = (id: string, label: string, dataType: LogicNodePort['dataType']): LogicNodePort => ({
  id,
  label,
  dataType,
});
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'item';

function pickPort(ports: LogicNodePort[], id: string, dataType: LogicNodePort['dataType']) {
  return ports.find((p) => p.id === id) ?? ports.find((p) => p.dataType === dataType);
}

/** Mutable helper for adding nodes / edges to a graph with unique ids and collision-free grid placement. */
class GraphBuilder {
  nodes: LogicNode[];
  edges: LogicEdge[];
  added: LogicNode[] = [];
  row = 0;
  private usedIds: Set<string>;
  private occupied = new Set<string>();

  constructor(graph: LogicGraphSpec) {
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.usedIds = new Set(graph.nodes.map((n) => n.id));
    const maxY = graph.nodes.reduce((m, n) => Math.max(m, n.position?.y ?? 0), -Infinity);
    this.row = graph.nodes.length ? Math.ceil((maxY + GRAPH_ROW_HEIGHT - 60) / GRAPH_ROW_HEIGHT) : 0;
  }

  uid(base: string): string {
    let id = base;
    for (let i = 2; this.usedIds.has(id); i++) id = `${base}-${i}`;
    this.usedIds.add(id);
    return id;
  }

  node(
    base: string,
    type: LogicNodeType,
    category: LogicNode['category'],
    title: string,
    inputs: LogicNodePort[],
    outputs: LogicNodePort[],
    params: Record<string, any>
  ): LogicNode {
    const x = GRAPH_COLUMN_X[type];
    let y = 60 + this.row * GRAPH_ROW_HEIGHT;
    while (this.occupied.has(`${x}:${y}`)) y += GRAPH_ROW_HEIGHT;
    this.occupied.add(`${x}:${y}`);
    const node: LogicNode = {
      id: this.uid(base),
      type,
      title,
      category,
      position: { x, y },
      inputs,
      outputs,
      params,
      status: 'idle',
      runCount: 0,
    };
    this.nodes.push(node);
    this.added.push(node);
    return node;
  }

  link(src: LogicNode, srcPortId: string, tgt: LogicNode, tgtPortId: string): void {
    const from = pickPort(src.outputs, srcPortId, 'flow');
    const to = pickPort(tgt.inputs, tgtPortId, from?.dataType ?? 'flow');
    if (!from || !to || from.dataType !== to.dataType || src.id === tgt.id) return;
    if (
      this.edges.some(
        (e) =>
          e.sourceNodeId === src.id &&
          e.sourcePortId === from.id &&
          e.targetNodeId === tgt.id &&
          e.targetPortId === to.id
      )
    ) {
      return;
    }
    this.edges.push({
      id: `edge-${src.id}-${from.id}-${tgt.id}-${to.id}`,
      sourceNodeId: src.id,
      sourcePortId: from.id,
      targetNodeId: tgt.id,
      targetPortId: to.id,
      active: true,
    });
  }
}

function actorRadius(a: ActorNode): number {
  const bb = ASSET_REGISTRY[a.assetId]?.boundingBox || { width: 1.4, height: 1.8, depth: 1.4 };
  const s = (Math.abs(a.scale?.[0] ?? 1) + Math.abs(a.scale?.[2] ?? 1)) / 2;
  return (Math.max(bb.width, bb.depth) / 2) * s;
}

/** Distance (m) at which two actors' bounding boxes touch. Any collision / distance check below this can never fire. */
function contactDistanceFor(spec: SceneSpec, actor: ActorNode): number {
  const others = spec.actors.filter(
    (a) =>
      a.id !== actor.id &&
      (a.physicsRole === 'player' ||
        a.physicsRole === 'collectible' ||
        a.physicsRole === 'hazard' ||
        a.physicsRole === 'dynamic')
  );
  const biggestOther = others.reduce((m, a) => Math.max(m, actorRadius(a)), 0.5);
  return actorRadius(actor) + biggestOther;
}

interface MechanicSubject {
  role: 'collectible' | 'hazard' | 'boss' | 'unbox' | 'player';
  kind: '3d' | '2d';
  name: string;
  slug: string;
  ids: string[];
  scoreValue: number;
  clip?: string;
  animation: string;
  onClickAction: string;
  tapsRequired: number;
  contact: number;
}

function collectMechanicSubjects(spec: SceneSpec): MechanicSubject[] {
  const groups = new Map<string, MechanicSubject>();
  const add = (key: string, make: () => MechanicSubject, id: string) => {
    const existing = groups.get(key);
    if (existing) existing.ids.push(id);
    else groups.set(key, make());
  };

  for (const a of spec.actors) {
    let role: MechanicSubject['role'] | null = null;
    if (a.onClickAction === 'unbox-tap') role = 'unbox';
    else if (a.physicsRole === 'hazard') role = /boss|dragon|titan|golem|overlord/i.test(a.name) ? 'boss' : 'hazard';
    else if (a.physicsRole === 'collectible') role = 'collectible';
    else if (a.physicsRole === 'player') role = 'player';
    if (!role) continue;
    const r = role;
    add(
      `${r}:${a.assetId}`,
      () => ({
        role: r,
        kind: '3d',
        name: a.name,
        slug: slugify(`${r}-${a.name}`),
        ids: [a.id],
        scoreValue: a.scoreValue ?? (r === 'collectible' ? 25 : 0),
        clip: a.activeClip || a.availableClips?.[0],
        animation: a.activeAnimation || 'idle',
        onClickAction: a.onClickAction,
        tapsRequired: a.unboxTapsRequired ?? 3,
        contact: contactDistanceFor(spec, a),
      }),
      a.id
    );
  }

  for (const n of spec.nodes2D || []) {
    const role: MechanicSubject['role'] | null =
      n.physics2D === 'collectible'
        ? 'collectible'
        : n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown'
          ? 'player'
          : null;
    if (!role) continue;
    add(
      `2d-${role}:${n.type}:${n.shapeKind ?? ''}`,
      () => ({
        role,
        kind: '2d',
        name: n.name,
        slug: slugify(`${role}-${n.name}`),
        ids: [n.id],
        scoreValue: n.scoreValue ?? (role === 'collectible' ? 25 : 0),
        animation: 'idle',
        onClickAction: 'none',
        tapsRequired: 3,
        contact: Math.max(n.width, n.height) / 100 + 0.6,
      }),
      n.id
    );
  }
  return [...groups.values()];
}

function isSubjectWired(graph: LogicGraphSpec, s: MechanicSubject): boolean {
  return graph.nodes.some((n) => {
    const p = n.params || {};
    return (
      s.ids.includes(p.actorId) ||
      s.ids.includes(p.node2DId) ||
      (Array.isArray(p.actorIds) && p.actorIds.some((id: string) => s.ids.includes(id)))
    );
  });
}

/**
 * Wires every un-represented gameplay mechanic (collecting, hazards / boss, tap-to-unbox, player control,
 * camera cutscene, world stage) into connected trigger -> condition -> action chains on `spec.logicGraph`.
 * Existing nodes (and the user's tweaks to them) are never touched. Returns human-readable notes.
 */
export function ensureMechanicLogicGraph(spec: SceneSpec): string[] {
  const notes: string[] = [];
  if (!spec.logicGraph) spec.logicGraph = { nodes: [], edges: [] };
  const graph = spec.logicGraph;
  const fresh = graph.nodes.length === 0;
  const b = new GraphBuilder(graph);
  const hasIntent = (pred: (n: LogicNode) => boolean) => graph.nodes.some(pred);

  let sceneStart = graph.nodes.find((n) => n.params?.eventType === 'scene-start');
  let gate = graph.nodes.find(
    (n) => n.id === 'node-score-gate' || (n.type === 'condition' && n.params?.conditionType === 'score-threshold')
  );
  let endCard = graph.nodes.find(
    (n) => n.id === 'node-cta-endcard' || (n.type === 'media-pipeline' && n.category === 'audio-caption')
  );

  const getSceneStart = () =>
    (sceneStart ??= b.node(
      'node-scene-start',
      'trigger',
      'event-trigger',
      'On Scene Start',
      [],
      [port('out-flow', 'Exec Flow', 'flow'), port('out-signal', 'Init Signal', 'signal')],
      { eventType: 'scene-start', engineType: spec.engineType, autoPlay: true }
    ));
  const getEndCard = () =>
    (endCard ??= b.node(
      'node-cta-endcard',
      'media-pipeline',
      'audio-caption',
      'Trigger CTA & MRAID Output',
      [port('in-flow', 'On Goal Met', 'flow')],
      [],
      {
        headline: spec.marketingOverlay?.headline ?? '',
        ctaText: spec.marketingOverlay?.ctaText ?? 'Play Now',
        exportFormat: 'TikTok MRAID 3.0 / WebM 60fps',
      }
    ));
  const getGate = () => {
    if (!gate) {
      gate = b.node(
        'node-score-gate',
        'condition',
        'logic-gate',
        'If Score >= Target Goal',
        [port('in-flow', 'Check Flow', 'flow'), port('in-val', 'Current Score', 'number')],
        [port('out-true', 'Goal Met (True)', 'flow'), port('out-false', 'Keep Playing', 'flow')],
        {
          conditionType: 'score-threshold',
          targetScore: spec.gameRules.targetScore || 100,
          timeLimitSeconds: spec.gameRules.timeLimitSeconds || 30,
        }
      );
    }
    b.link(gate, 'out-true', getEndCard(), 'in-flow');
    return gate;
  };

  const refParams = (s: MechanicSubject): Record<string, any> => {
    const key = s.kind === '3d' ? 'actorId' : 'node2DId';
    const ref: Record<string, any> = { [key]: s.ids[0] };
    if (s.kind === '3d') ref.actorName = s.name;
    if (s.ids.length > 1) ref.actorIds = [...s.ids];
    return ref;
  };
  const playAnimation = (id: string, title: string, s: MechanicSubject, extra: Record<string, any>) => {
    const params: Record<string, any> = {
      ...refParams(s),
      animation: s.animation,
      activeClip: s.clip,
      speed: 1,
      scoreDelta: s.scoreValue,
      onClickAction: s.onClickAction,
      ...extra,
    };
    // Skeletal animation is 3D-only: the runtime refuses it for a 2D node, and the refusal aborted the whole action (the score never counted).
    if (s.kind === '2d') {
      delete params.animation;
      delete params.activeClip;
      delete params.speed;
    }
    return b.node(
      id,
      'action',
      'actor-action',
      title,
      [port('in-flow', 'Exec In', 'flow'), port('in-actor', 'Target Actor', 'actor')],
      [port('out-flow', 'Next Action', 'flow'), port('out-score', 'Score Delta', 'number')],
      params
    );
  };
  const vfxNode = (id: string, title: string, vfxType: string, s?: MechanicSubject) =>
    b.node(
      id,
      'action',
      'camera-vfx',
      title,
      [port('in-flow', 'Exec In', 'flow')],
      [port('out-flow', 'Next Flow', 'flow')],
      { cameraMode: spec.camera.mode, fov: spec.camera.fov || 45, vfxType, ...(s ? refParams(s) : {}) }
    );
  const collisionTrigger = (s: MechanicSubject, targetRole: string) =>
    b.node(
      `node-${s.slug}-collision`,
      'trigger',
      'event-trigger',
      `On Collision · ${s.name}`,
      [],
      [port('out-flow', 'Hit Flow', 'flow'), port('out-actor', 'Other Actor', 'actor')],
      { eventType: 'collision', targetRole, ...refParams(s) }
    );
  const rangeCondition = (s: MechanicSubject) => {
    const meters = round1(Math.max(1.2, s.contact + 0.6));
    return b.node(
      `node-${s.slug}-range`,
      'condition',
      'logic-gate',
      `Distance Check < ${meters}m · ${s.name}`,
      [port('in-flow', 'Exec In', 'flow'), port('in-actor', 'Actor Ref', 'actor')],
      [port('out-true', 'Within Range', 'flow'), port('out-false', 'Out of Range', 'flow')],
      { conditionType: 'distance-check', distanceMeters: meters, ...refParams(s) }
    );
  };
  const cooldownCondition = (s: MechanicSubject, ms: number) =>
    b.node(
      `node-${s.slug}-cooldown`,
      'condition',
      'logic-gate',
      'Cooldown Gate',
      [port('in-flow', 'Exec In', 'flow')],
      [port('out-flow', 'Ready Flow', 'flow')],
      { conditionType: 'cooldown', cooldownMs: ms }
    );

  const subjects = collectMechanicSubjects(spec).filter((s) => !isSubjectWired(graph, s));

  if (fresh) {
    const world = b.node(
      'node-world-stage',
      'media-pipeline',
      'camera-vfx',
      'World Stage & Atmosphere',
      [port('in-flow', 'Init Flow', 'flow')],
      [port('out-flow', 'Stage Ready', 'flow')],
      {
        skybox: spec.world?.skybox || 'daylight-sky',
        terrainType: spec.world?.terrain?.type || 'flat-grid',
        weatherType: spec.world?.weather?.type || 'clear',
        aspectRatio: spec.aspectRatio,
      }
    );
    b.link(getSceneStart(), 'out-flow', world, 'in-flow');
    notes.push('Logic graph: added On Scene Start -> World Stage chain');
  }

  const wantsCutscene =
    spec.engineType === '3d' &&
    !hasIntent((n) => n.params?.cameraMode !== undefined) &&
    (CINEMATIC_CAMERA_MODES.includes(spec.camera.mode) || (spec.camera.keyframes?.length ?? 0) > 1);
  if (wantsCutscene) {
    b.row += fresh ? 1 : 0;
    const trig = b.node(
      'node-camera-cue',
      'trigger',
      'event-trigger',
      'On Timeline At (s)',
      [],
      [port('out-flow', 'Cue Flow', 'flow')],
      { eventType: 'timeline-cue', cueTimeSeconds: spec.camera.keyframes?.[1]?.time ?? 0.5 }
    );
    const cd = b.node(
      'node-camera-cue-gate',
      'condition',
      'logic-gate',
      'Cooldown Gate',
      [port('in-flow', 'Exec In', 'flow')],
      [port('out-flow', 'Ready Flow', 'flow')],
      { conditionType: 'cooldown', cooldownMs: 500 }
    );
    const cam = b.node(
      'node-camera-track',
      'action',
      'camera-vfx',
      'Switch Camera & Spawn VFX',
      [port('in-flow', 'Stage Flow', 'flow')],
      [port('out-flow', 'Render Out', 'flow')],
      {
        cameraMode: spec.camera.mode,
        fov: spec.camera.fov || 45,
        vfxId: spec.vfx[0]?.id || '',
        vfxType: spec.vfx[0]?.type || 'sparkles',
      }
    );
    b.link(trig, 'out-flow', cd, 'in-flow');
    b.link(cd, 'out-flow', cam, 'in-flow');
    notes.push(`Logic graph: wired camera cutscene (${spec.camera.mode}) as timeline cue -> cooldown -> camera`);
  }

  for (const s of subjects) {
    // A 2D pickup is collected by the runtime itself (contact -> removed -> score -> win rule). A wired chain would take over the pickup
    // (the runtime skips its own collection for contacts a logic graph handles) without ever removing it, so the star could be farmed.
    if (s.kind === '2d' && s.role === 'collectible') continue;
    b.row += 1;
    if (s.role === 'collectible') {
      const trig = collisionTrigger(s, 'collectible');
      const range = rangeCondition(s);
      const collect = playAnimation(`node-${s.slug}-collect`, `Collect · ${s.name}`, s, {
        animation: 'bounce',
        speed: 1.2,
        onClickAction: s.kind === '3d' ? s.onClickAction : 'collect',
      });
      const g = getGate();
      b.link(trig, 'out-flow', range, 'in-flow');
      b.link(trig, 'out-actor', range, 'in-actor');
      b.link(range, 'out-true', collect, 'in-flow');
      b.link(collect, 'out-flow', g, 'in-flow');
      b.link(collect, 'out-score', g, 'in-val');
      notes.push(`Logic graph: wired "${s.name}" collection (collision -> range check -> +${s.scoreValue} score -> goal gate)`);
    } else if (s.role === 'hazard' || s.role === 'boss') {
      const trig = collisionTrigger(s, 'hazard');
      const range = rangeCondition(s);
      const hit = playAnimation(`node-${s.slug}-hit`, `Hit · ${s.name}`, s, {});
      const vfx = vfxNode(`node-${s.slug}-vfx`, `Impact VFX · ${s.name}`, 'shockwave', s);
      b.link(trig, 'out-flow', range, 'in-flow');
      b.link(trig, 'out-actor', range, 'in-actor');
      b.link(range, 'out-true', hit, 'in-flow');
      b.link(hit, 'out-flow', vfx, 'in-flow');
      if (s.role === 'boss') {
        b.row += 1;
        const cue = b.node(
          `node-${s.slug}-attack-cue`,
          'trigger',
          'event-trigger',
          `On Timeline At (s) · ${s.name} attacks`,
          [],
          [port('out-flow', 'Cue Flow', 'flow')],
          { eventType: 'timeline-cue', cueTimeSeconds: 3, ...refParams(s) }
        );
        const cd = cooldownCondition({ ...s, slug: `${s.slug}-attack` }, 1500);
        const attack = playAnimation(`node-${s.slug}-attack`, `Attack · ${s.name}`, s, { animation: 'attack' });
        b.link(cue, 'out-flow', cd, 'in-flow');
        b.link(cd, 'out-flow', attack, 'in-flow');
        b.link(attack, 'out-flow', vfx, 'in-flow');
      }
      notes.push(`Logic graph: wired ${s.role} "${s.name}" (${s.role === 'boss' ? 'timeline attack + ' : ''}collision -> range check -> hit -> VFX)`);
    } else if (s.role === 'unbox') {
      const tap = b.node(
        `node-${s.slug}-tap`,
        'trigger',
        'event-trigger',
        `On Actor Click/Tap · ${s.name}`,
        [],
        [port('out-flow', 'Tap Flow', 'flow'), port('out-actor', 'Clicked Actor', 'actor')],
        { eventType: 'actor-click', inputKey: 'Pointer / Tap', ...refParams(s) }
      );
      const counter = b.node(
        `node-${s.slug}-taps`,
        'condition',
        'logic-gate',
        `Tap Counter >= ${s.tapsRequired} · ${s.name}`,
        [port('in-flow', 'Exec In', 'flow')],
        [port('out-true', 'Unlocked (True)', 'flow'), port('out-false', 'Keep Tapping', 'flow')],
        { conditionType: 'tap-count', tapsRequired: s.tapsRequired, ...refParams(s) }
      );
      const reveal = playAnimation(`node-${s.slug}-reveal`, `Reveal · ${s.name}`, s, { animation: 'bounce' });
      const confetti = vfxNode(`node-${s.slug}-confetti`, 'Confetti Burst', 'confetti', s);
      b.link(tap, 'out-flow', counter, 'in-flow');
      b.link(counter, 'out-true', reveal, 'in-flow');
      b.link(reveal, 'out-flow', confetti, 'in-flow');
      b.link(confetti, 'out-flow', getEndCard(), 'in-flow');
      notes.push(`Logic graph: wired tap-to-unbox "${s.name}" (tap -> ${s.tapsRequired}-tap counter -> reveal -> confetti -> end card)`);
    } else if (s.role === 'player') {
      const key = b.node(
        `node-${s.slug}-input`,
        'trigger',
        'event-trigger',
        `On Key Press (WASD) · ${s.name}`,
        [],
        [port('out-flow', 'Move Flow', 'flow')],
        { eventType: 'key-press', keyCombo: 'WASD / Arrows', ...refParams(s) }
      );
      const cd = cooldownCondition(s, 120);
      const move = playAnimation(`node-${s.slug}-move`, `Move · ${s.name}`, s, {
        animation: s.kind === '3d' ? 'walk' : 'idle',
        scoreDelta: 0,
      });
      b.link(key, 'out-flow', cd, 'in-flow');
      b.link(cd, 'out-flow', move, 'in-flow');
      notes.push(`Logic graph: wired player "${s.name}" controls (key press -> cooldown -> animation)`);
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Structural validation & repair (shared by the AI-output sanitizer and fixExecutionIssue)
// ---------------------------------------------------------------------------

export interface RepairContext {
  draft: SceneSpec;
  focus?: LogicNode;
  scope: LogicNode[];
  message: string;
  touched: Set<string>;
  fixes: string[];
  unresolved: string[];
}

export function createRepairContext(draft: SceneSpec, focus: LogicNode | undefined, message: string): RepairContext {
  const nodes = draft.logicGraph?.nodes ?? [];
  return { draft, focus, scope: focus ? [focus] : nodes, message, touched: new Set(), fixes: [], unresolved: [] };
}

function describeNode(n: LogicNode) {
  return `[${n.title}]`;
}

function matchClip(wanted: string | undefined, clips: string[]): string | undefined {
  if (!wanted) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const w = norm(wanted);
  if (!w) return undefined;
  return (
    clips.find((c) => norm(c) === w) ??
    clips.find((c) => norm(c).length >= 3 && (norm(c).includes(w) || w.includes(norm(c)))) ??
    (w.length >= 4 ? clips.find((c) => norm(c).startsWith(w.slice(0, 4))) : undefined) // "Dancing" -> "Dance"
  );
}

function resolveActorForNode(draft: SceneSpec, node: LogicNode): ActorNode | undefined {
  const p = node.params || {};
  const byId = draft.actors.find((a) => a.id === p.actorId);
  if (byId) return byId;
  const name = String(p.actorName || '').toLowerCase().trim();
  if (name) {
    const byName =
      draft.actors.find((a) => a.name.toLowerCase() === name) ??
      draft.actors.find((a) => a.name.toLowerCase().includes(name) || name.includes(a.name.toLowerCase()));
    if (byName) return byName;
  }
  const role = p.targetRole as PhysicsRole | undefined;
  return (
    (role ? draft.actors.find((a) => a.physicsRole === role) : undefined) ??
    draft.actors.find((a) => a.physicsRole === 'player') ??
    draft.actors[0]
  );
}

/** Missing / stale actor references on nodes (and on the follow-camera). */
export function repairActorReferences(ctx: RepairContext): void {
  const { draft } = ctx;
  for (const node of ctx.scope) {
    const id = node.params?.actorId;
    if (id && !draft.actors.some((a) => a.id === id)) {
      const replacement = resolveActorForNode(draft, node);
      if (!replacement) {
        ctx.unresolved.push(`${describeNode(node)} targets missing actor "${id}" and the scene has no actors to rebind to.`);
      } else {
        node.params = { ...node.params, actorId: replacement.id, actorName: replacement.name };
        ctx.touched.add(node.id);
        ctx.fixes.push(
          `${describeNode(node)} targeted missing actor "${id}" -> rebound to "${replacement.name}" (${replacement.id})`
        );
      }
    }
    if (Array.isArray(node.params?.actorIds)) {
      const alive = node.params.actorIds.filter((x: string) => draft.actors.some((a) => a.id === x));
      if (alive.length !== node.params.actorIds.length) {
        node.params = { ...node.params, actorIds: alive };
        ctx.touched.add(node.id);
        ctx.fixes.push(`${describeNode(node)} dropped ${node.params.actorIds.length === 0 ? 'all' : 'stale'} deleted actor ids from actorIds`);
      }
    }
  }
  const follow = draft.camera.followActorId;
  if (!ctx.focus && follow && !draft.actors.some((a) => a.id === follow)) {
    const next = draft.actors.find((a) => a.physicsRole === 'player') ?? draft.actors[0];
    if (next) draft.camera.followActorId = next.id;
    else delete draft.camera.followActorId;
    ctx.fixes.push(`Camera followed missing actor "${follow}" -> now follows ${next ? `"${next.name}"` : 'nothing'}`);
  }
}

/** Wrong animation clip names / invalid AnimationType on actors and the nodes that play them. */
export function repairAnimations(ctx: RepairContext): void {
  const { draft } = ctx;
  const actorIds = new Set<string>();
  ctx.scope.forEach((n) => n.params?.actorId && actorIds.add(n.params.actorId));
  if (!ctx.focus) draft.actors.forEach((a) => actorIds.add(a.id));

  for (const id of actorIds) {
    const actor = draft.actors.find((a) => a.id === id);
    if (!actor) continue;
    const registry = ASSET_REGISTRY[actor.assetId];
    if (!actor.availableClips?.length && registry?.embeddedClips?.length) {
      actor.availableClips = [...registry.embeddedClips];
    }
    const clips = actor.availableClips ?? [];

    if (!VALID_ANIMATIONS.includes(actor.activeAnimation)) {
      ctx.fixes.push(`"${actor.name}" had invalid animation "${actor.activeAnimation}" -> "idle"`);
      actor.activeAnimation = 'idle';
    }
    if (!clips.length) continue;

    const fallbackClip = () =>
      (actor.activeClip && clips.includes(actor.activeClip) ? actor.activeClip : undefined) ??
      (registry?.defaultClip && clips.includes(registry.defaultClip) ? registry.defaultClip : undefined) ??
      clips[0];

    if (actor.activeClip && !clips.includes(actor.activeClip)) {
      const next = matchClip(actor.activeClip, clips) ?? fallbackClip();
      ctx.fixes.push(`"${actor.name}" played unknown clip "${actor.activeClip}" -> "${next}" (available: ${clips.join(', ')})`);
      actor.activeClip = next;
    }

    for (const node of ctx.scope) {
      if (node.params?.actorId !== actor.id || node.category !== 'actor-action') continue;
      if (node.params.activeClip && !clips.includes(node.params.activeClip)) {
        const next = matchClip(node.params.activeClip, clips) ?? fallbackClip();
        ctx.fixes.push(
          `${describeNode(node)} used wrong clip "${node.params.activeClip}" -> "${next}" (available: ${clips.join(', ')})`
        );
        node.params = { ...node.params, activeClip: next };
        actor.activeClip = next; // the store re-syncs node params from the actor, so keep both aligned
        ctx.touched.add(node.id);
      }
      if (node.params.animation && !VALID_ANIMATIONS.includes(node.params.animation)) {
        ctx.fixes.push(`${describeNode(node)} had invalid animation "${node.params.animation}" -> "${actor.activeAnimation}"`);
        node.params = { ...node.params, animation: actor.activeAnimation };
        ctx.touched.add(node.id);
      }
    }
  }
}

export function repairServoAngles(ctx: RepairContext): void {
  for (const node of ctx.scope) {
    if (node.type !== 'robot-hardware' || node.params?.servoAngle === undefined) continue;
    const raw = Number(node.params.servoAngle);
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(180, raw)) : 90;
    if (clamped !== raw) {
      ctx.fixes.push(`${describeNode(node)} servo angle ${node.params.servoAngle}° out of [0°..180°] -> ${clamped}°`);
      node.params = { ...node.params, servoAngle: clamped };
      ctx.touched.add(node.id);
    }
  }
}

function spawnRegistryActor(spec: SceneSpec, assetId: string, index: number): ActorNode | undefined {
  const entry = ASSET_REGISTRY[assetId];
  if (!entry) return undefined;
  return {
    id: `actor-${assetId}-${Date.now().toString(36)}-${index}`,
    name: entry.name,
    assetId: entry.assetId,
    modelUrl: entry.modelUrl,
    activeClip: entry.defaultClip,
    availableClips: entry.embeddedClips ? [...entry.embeddedClips] : undefined,
    position: [-3 + index * 1.8, 0, -2.4],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    primaryColor: entry.defaultPrimaryColor,
    secondaryColor: entry.defaultSecondaryColor,
    metalness: entry.defaultMetalness,
    roughness: entry.defaultRoughness,
    activeAnimation: entry.defaultAnimation,
    animationSpeed: 1,
    physicsRole: entry.defaultPhysicsRole,
    onClickAction: entry.defaultClickAction,
    scoreValue: entry.defaultScoreValue,
    startTime: 0,
    endTime: spec.durationSeconds || 8,
    enterEffect: 'pop-in',
  };
}

/** Score goals that can never be reached, collectibles worth 0, and timers that are already expired. */
export function repairScoreGoal(ctx: RepairContext): void {
  const { draft } = ctx;
  const rules = draft.gameRules;
  const collectibles3d = draft.actors.filter((a) => a.physicsRole === 'collectible');
  const collectibles2d = (draft.nodes2D || []).filter((n) => n.physics2D === 'collectible');

  for (const a of collectibles3d) {
    if (!(Number(a.scoreValue) > 0)) {
      ctx.fixes.push(`Collectible "${a.name}" was worth ${a.scoreValue ?? 0} points -> 25`);
      a.scoreValue = 25;
    }
  }
  for (const n of collectibles2d) {
    if (!(Number(n.scoreValue) > 0)) {
      ctx.fixes.push(`2D collectible "${n.name}" was worth ${n.scoreValue ?? 0} points -> 25`);
      n.scoreValue = 25;
    }
  }

  const sum = () =>
    collectibles3d.reduce((s, a) => s + (a.scoreValue ?? 0), 0) +
    collectibles2d.reduce((s, n) => s + (n.scoreValue ?? 0), 0);
  let total = sum();

  const needsGoal = rules.winCondition === 'collect-all' || rules.winCondition === 'score-threshold';
  if (needsGoal && rules.targetScore > total) {
    const original = rules.targetScore;
    const coinValue = ASSET_REGISTRY['gold-coin-collectible']?.defaultScoreValue || 25;
    const needed = Math.ceil((original - total) / coinValue);
    const canSpawn = draft.engineType === '3d' && !!ASSET_REGISTRY['gold-coin-collectible'];
    if (canSpawn && (needed <= 4 || total === 0)) {
      const count = Math.min(needed, 4);
      for (let i = 0; i < count; i++) {
        const coin = spawnRegistryActor(draft, 'gold-coin-collectible', collectibles3d.length + i);
        if (coin) {
          draft.actors.push(coin);
          collectibles3d.push(coin);
        }
      }
      total = sum();
      ctx.fixes.push(`Target score ${original} was unreachable (max ${total - count * coinValue}) -> spawned ${count} Gold Coin collectible(s) (+${coinValue} each)`);
      if (original > total) {
        rules.targetScore = total;
        ctx.fixes.push(`Target score still above reachable total -> lowered to ${total}`);
      }
    } else if (total > 0) {
      rules.targetScore = total;
      ctx.fixes.push(`Target score ${original} exceeded the reachable ${total} -> lowered to ${total}`);
    } else {
      ctx.unresolved.push(`Target score ${original} is unreachable: the scene has no collectibles to award points.`);
    }
  }
  if (rules.winCondition === 'survive-timer' && !(rules.timeLimitSeconds > 0)) {
    ctx.fixes.push(`Survive-timer goal had time limit ${rules.timeLimitSeconds}s -> 30s`);
    rules.timeLimitSeconds = 30;
  }

  for (const node of draft.logicGraph?.nodes ?? []) {
    if (node.type !== 'condition' || node.params?.conditionType !== 'score-threshold') continue;
    if (node.params.targetScore !== rules.targetScore || node.params.timeLimitSeconds !== rules.timeLimitSeconds) {
      ctx.fixes.push(`${describeNode(node)} goal ${node.params.targetScore} -> synced to gameRules (${rules.targetScore})`);
      node.params = {
        ...node.params,
        targetScore: rules.targetScore,
        timeLimitSeconds: rules.timeLimitSeconds,
      };
      ctx.touched.add(node.id);
    }
  }
}

/** Distance checks smaller than the actors' touching distance, and collision triggers that target a role nobody has. */
export function repairCollisionThresholds(ctx: RepairContext): void {
  const { draft } = ctx;
  for (const node of ctx.scope) {
    if (node.params?.conditionType === 'distance-check') {
      const actor = draft.actors.find((a) => a.id === node.params.actorId);
      const raw = Number(node.params.distanceMeters);
      if (!actor) {
        if (!Number.isFinite(raw) || raw <= 0) {
          node.params = { ...node.params, distanceMeters: 2 };
          ctx.touched.add(node.id);
          ctx.fixes.push(`${describeNode(node)} distance ${node.params.distanceMeters} was invalid -> 2m`);
        }
        continue;
      }
      const contact = contactDistanceFor(draft, actor);
      let next = raw;
      if (!Number.isFinite(raw) || raw < contact) next = round1(contact + 0.6);
      else if (raw > 25) next = 25;
      if (next !== raw) {
        ctx.fixes.push(
          `${describeNode(node)} threshold ${node.params.distanceMeters}m is below the ${round1(contact)}m bounding-box contact distance (can never trigger) -> ${next}m`
        );
        node.params = {
          ...node.params,
          distanceMeters: next,
        };
        node.title = node.title.replace(/<\s*[\d.]+\s*m/, `< ${next}m`);
        ctx.touched.add(node.id);
      }
    }
    if (node.params?.eventType === 'collision' && node.params.targetRole) {
      const role = node.params.targetRole as PhysicsRole;
      if (!draft.actors.some((a) => a.physicsRole === role)) {
        const alt = (['collectible', 'hazard', 'dynamic'] as PhysicsRole[]).find((r) =>
          draft.actors.some((a) => a.physicsRole === r)
        );
        if (alt) {
          node.params = { ...node.params, targetRole: alt };
          ctx.touched.add(node.id);
          ctx.fixes.push(`${describeNode(node)} listened for "${role}" but no such actor exists -> now listens for "${alt}"`);
        } else {
          ctx.unresolved.push(`${describeNode(node)} listens for "${role}" collisions but the scene has no collidable actors.`);
        }
      }
    }
  }
}

/** Edges that point at deleted nodes / ports or join incompatible port types. */
export function repairEdges(ctx: RepairContext): void {
  const graph = ctx.draft.logicGraph;
  if (!graph) return;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inScope = (e: LogicEdge) =>
    !ctx.focus || e.sourceNodeId === ctx.focus.id || e.targetNodeId === ctx.focus.id;
  let removed = 0;
  let remapped = 0;

  graph.edges = graph.edges.filter((edge) => {
    if (!inScope(edge)) return true;
    const src = byId.get(edge.sourceNodeId);
    const tgt = byId.get(edge.targetNodeId);
    if (!src || !tgt || src.id === tgt.id) {
      removed++;
      return false;
    }
    let from = src.outputs.find((p) => p.id === edge.sourcePortId);
    let to = tgt.inputs.find((p) => p.id === edge.targetPortId);
    if (!from && to) from = src.outputs.find((p) => p.dataType === to!.dataType);
    if (!to && from) to = tgt.inputs.find((p) => p.dataType === from!.dataType);
    if (from && to && from.dataType !== to.dataType) to = tgt.inputs.find((p) => p.dataType === from!.dataType);
    if (!from || !to) {
      removed++;
      return false;
    }
    if (from.id !== edge.sourcePortId || to.id !== edge.targetPortId) {
      edge.sourcePortId = from.id;
      edge.targetPortId = to.id;
      remapped++;
    }
    return true;
  });
  if (removed) ctx.fixes.push(`Removed ${removed} broken edge(s) pointing at missing nodes / ports / incompatible types`);
  if (remapped) ctx.fixes.push(`Re-pointed ${remapped} edge(s) to valid ports of the same data type`);
}

/** Orphans: nodes with nothing feeding them, and triggers that feed nothing. Links only run low rank -> high rank. */
export function repairConnectivity(ctx: RepairContext): void {
  const graph = ctx.draft.logicGraph;
  if (!graph) return;
  const b = new GraphBuilder(graph);
  const flowOut = (n: LogicNode) =>
    n.outputs.find((o) => o.dataType === 'flow' && o.id !== 'out-false') ?? n.outputs.find((o) => o.dataType === 'flow');
  const flowIn = (n: LogicNode) => n.inputs.find((i) => i.dataType === 'flow');
  const hasIncoming = (n: LogicNode) => graph.edges.some((e) => e.targetNodeId === n.id);
  const hasOutgoing = (n: LogicNode) => graph.edges.some((e) => e.sourceNodeId === n.id);
  const same = (n: LogicNode, o: LogicNode) =>
    !!n.params?.actorId && n.params.actorId === o.params?.actorId ? 0 : 1;

  for (const node of ctx.scope) {
    if (node.type !== 'trigger' && flowIn(node) && !hasIncoming(node)) {
      const rank = GRAPH_RANK[node.type];
      const upstream = graph.nodes
        .filter((o) => o.id !== node.id && GRAPH_RANK[o.type] < rank && flowOut(o))
        .sort(
          (a, c) =>
            GRAPH_RANK[c.type] - GRAPH_RANK[a.type] ||
            same(node, a) - same(node, c) ||
            Math.abs(a.position.y - node.position.y) - Math.abs(c.position.y - node.position.y)
        )[0];
      if (upstream) {
        b.link(upstream, flowOut(upstream)!.id, node, flowIn(node)!.id);
        ctx.touched.add(node.id);
        ctx.fixes.push(`${describeNode(node)} had no incoming connection -> wired from ${describeNode(upstream)}`);
      } else {
        ctx.unresolved.push(`${describeNode(node)} is unreachable and the graph has no upstream trigger to connect it to.`);
      }
    } else if (node.type === 'trigger' && !hasOutgoing(node) && flowOut(node)) {
      const downstream = graph.nodes
        .filter((o) => o.id !== node.id && o.type !== 'trigger' && flowIn(o))
        .sort(
          (a, c) =>
            Number(hasIncoming(a)) - Number(hasIncoming(c)) ||
            same(node, a) - same(node, c) ||
            GRAPH_RANK[a.type] - GRAPH_RANK[c.type]
        )[0];
      if (downstream) {
        b.link(node, flowOut(node)!.id, downstream, flowIn(downstream)!.id);
        ctx.touched.add(node.id);
        ctx.fixes.push(`${describeNode(node)} triggered nothing -> wired to ${describeNode(downstream)}`);
      }
    }
  }
}

/** Structure-only sanitizer used on freshly generated scenes (no gameplay rebalancing). */
function sanitizeLogicGraph(draft: SceneSpec): string[] {
  const ctx = createRepairContext(draft, undefined, '');
  repairActorReferences(ctx);
  repairAnimations(ctx);
  repairServoAngles(ctx);
  repairEdges(ctx);
  repairConnectivity(ctx);
  return ctx.fixes;
}

/**
 * Post-processes any generated SceneSpec (Gemini or local heuristics): validates the logic graph and wires every
 * mechanic that has no node yet, so non-coders always get connected trigger -> condition -> action chains to inspect.
 */
/**
 * Scenes saved before 2D pickups were left to the runtime carry the old generated collection chain (`node-collectible-*-collision|range|collect`) and 3D-only
 * animation params on 2D actions. The chain takes over the pickup without removing it, and the params make every action throw: drop both.
 */
function repairLegacy2DChains(spec: SceneSpec): string[] {
  const graph = spec.logicGraph;
  if (spec.engineType !== '2d' || !graph || !Array.isArray(graph.nodes)) return [];
  const notes: string[] = [];
  const generated = new Set(
    graph.nodes.filter((n) => /^node-collectible-.+-(collision|range|collect)$/.test(n.id) && typeof n.params?.node2DId === 'string').map((n) => n.id)
  );
  if (generated.size) {
    graph.nodes = graph.nodes.filter((n) => !generated.has(n.id));
    graph.edges = (graph.edges || []).filter((e) => !generated.has(e.sourceNodeId) && !generated.has(e.targetNodeId));
    notes.push(`Logic graph: removed ${generated.size} generated 2D pickup node(s); the runtime collects 2D pickups itself`);
  }
  let stripped = 0;
  for (const n of graph.nodes) {
    if (n.type !== 'action' || !n.params) continue;
    for (const key of ['animation', 'activeClip', 'speed']) {
      if (n.params[key] !== undefined && (typeof n.params.node2DId === 'string' || n.params.actorId === undefined)) {
        delete n.params[key];
        stripped++;
      }
    }
  }
  if (stripped) notes.push(`Logic graph: removed ${stripped} 3D-only animation param(s) from 2D actions`);
  return notes;
}

export function finalizeLogicGraph(spec: SceneSpec): { spec: SceneSpec; notes: string[] } {
  const next = cloneSceneSpec(spec);
  const notes: string[] = [];
  if (next.logicGraph && !Array.isArray(next.logicGraph.nodes)) next.logicGraph = undefined;
  if (next.logicGraph) {
    next.logicGraph.edges = Array.isArray(next.logicGraph.edges) ? next.logicGraph.edges : [];
    const fixes = sanitizeLogicGraph(next);
    if (fixes.length) notes.push(`Logic graph auto-repaired: ${fixes.length} issue(s) (${fixes[0]}${fixes.length > 1 ? ', ...' : ''})`);
  }
  notes.push(...repairLegacy2DChains(next));
  notes.push(...ensureMechanicLogicGraph(next));
  return { spec: next, notes };
}
