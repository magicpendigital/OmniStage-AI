/**
 * Phase 7 — Logic graph interpreter + contact detection, shared by the studio stages and the OmniStage Player.
 * Reads / writes state through the bound runtime store (see ./host.ts), never the studio store directly.
 */
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { ActorNode, CameraMode, EngineType, LogicNode, Node2D, SceneSpec, Vector3Tuple, VFXNode, VFXType } from '../types/scene.schema';
import { runtimeStore } from './host';

export const DESIGN_WIDTH = 1000;
export const DESIGN_HEIGHT = 600;

export type RuntimeEvent = 'scene-start' | 'actor-click' | 'collision' | 'key-press' | 'timeline-cue';
export interface LogicEventContext {
  actorId?: string;
  otherActorId?: string;
  key?: string;
  code?: string;
  nodeId?: string;
  sceneTime?: number;
}

const eventAliases: Record<string, RuntimeEvent> = {
  'on-scene-start': 'scene-start', 'on-click-actor': 'actor-click', 'on-actor-click': 'actor-click',
  'on-collision': 'collision', 'on-key-press': 'key-press', 'on-timeline-keyframe': 'timeline-cue',
  'timeline-keyframe': 'timeline-cue', 'on-timeline-cue': 'timeline-cue',
};
const cameraModes: CameraMode[] = ['orbit-360', 'dolly-zoom-in', 'crane-reveal', 'top-down-isometric',
  'first-person-follow', 'orbit', 'cinematic-flythrough', 'follow-target', 'isometric-game'];
const vfxTypes: VFXType[] = ['sparkles', 'shockwave', 'floating-3d-badge', 'laser-beam', 'confetti'];

function finiteNumber(value: unknown, label: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '') || !Number.isFinite(Number(value))) {
    throw new Error(`${label} must be a finite number`);
  }
  return Number(value);
}

function checkedPosition(value: unknown, engine: EngineType, mode: SceneSpec['mode']): Vector3Tuple {
  if (!Array.isArray(value) || value.length !== (engine === '2d' ? 2 : 3)) {
    throw new Error(`Position requires ${engine === '2d' ? 2 : 3} coordinates`);
  }
  const position = value.map((v) => finiteNumber(v, 'Coordinate'));
  // 2D uses the schema's 1000x600 space; 3D games use the existing arena.
  // Media scenes have a bounded 1000-unit authoring envelope, with nonnegative height.
  const valid = engine === '2d'
    ? position[0] >= 0 && position[0] <= DESIGN_WIDTH && position[1] >= 0 && position[1] <= DESIGN_HEIGHT
    : Math.abs(position[0]) <= (mode === 'game' ? 5.5 : 1000) && position[1] >= 0 && position[1] <= 1000 &&
      Math.abs(position[2]) <= (mode === 'game' ? 5.5 : 1000);
  if (!valid) throw new Error(`Out-of-bounds ${engine} coordinate: [${position.join(', ')}]`);
  return [position[0], position[1], position[2] ?? 0];
}

/** Shared interpreter for both stages. Kept here to respect renderer-only file ownership.
 * Runtime patches go through the central store, without authoring undo entries or
 * syncGraphWithScene rewriting parameters of actions that have not executed yet.
 */
export class RuntimeLogicGraph {
  private sceneId = '';
  private previousTime = -1;
  private elapsed = 0;
  private cooldowns = new Map<string, number>();
  private contacts = new Set<string>();
  generation = 0;
  controlsCamera = false;

  constructor(private engine: EngineType, public runtimePosition?: (id: string) => Vector3Tuple | undefined) {}

  private prepare() {
    const state = runtimeStore.getState();
    if (!state.isPlaying || state.sceneSpec.engineType !== this.engine) return false;
    if (state.sceneSpec.id !== this.sceneId || state.currentTime < this.previousTime) {
      this.sceneId = state.sceneSpec.id;
      this.cooldowns.clear();
      this.contacts.clear();
      this.elapsed = 0;
      this.controlsCamera = false;
      this.generation++;
      this.previousTime = state.currentTime;
      this.dispatch('scene-start', {});
      this.timeline(-1, state.currentTime);
    }
    this.previousTime = state.currentTime;
    return true;
  }

  emit(event: RuntimeEvent, context: LogicEventContext = {}) {
    return this.prepare() ? this.dispatch(event, context) : false;
  }

  advance(delta: number) {
    if (!this.prepare()) return;
    const state = runtimeStore.getState();
    const duration = Math.max(2, state.sceneSpec.durationSeconds || 8);
    const next = state.currentTime + delta;
    this.elapsed += delta;
    this.timeline(state.currentTime, Math.min(next, duration));
    if (next >= duration && state.isLooping) {
      this.contacts.clear();
      this.timeline(-1, next % duration);
    }
    state.advanceTimeline(delta);
    this.previousTime = runtimeStore.getState().currentTime;
  }

  collisions(pairs: Array<[string, string]>) {
    if (!this.prepare()) return new Set<string>();
    const next = new Set<string>();
    const handled = new Set<string>();
    for (const [actorId, otherActorId] of pairs) {
      const key = [actorId, otherActorId].sort().join('\u0000');
      next.add(key);
      // Return matching contacts even while held, so legacy handlers never double-fire.
      const matches = this.matching('collision', { actorId, otherActorId });
      if (matches.length) handled.add(otherActorId);
      if (!this.contacts.has(key)) this.dispatch('collision', { actorId, otherActorId });
    }
    this.contacts = next;
    return handled;
  }

  private matching(event: RuntimeEvent, context: LogicEventContext) {
    const scene = runtimeStore.getState().sceneSpec;
    return (scene.logicGraph?.nodes || []).filter((node) => {
      if (node.type !== 'trigger' || (context.nodeId && node.id !== context.nodeId)) return false;
      const p = node.params;
      if ((eventAliases[p.eventType] || p.eventType) !== event) return false;
      if ((event === 'actor-click' || event === 'collision') && p.actorId && p.actorId !== context.actorId &&
          (event !== 'collision' || p.actorId !== context.otherActorId)) return false;
      if (event === 'collision') {
        const targetId = this.collisionTarget(node, context);
        if (p.otherActorId && p.otherActorId !== targetId) return false;
        const target = scene.engineType === '2d' ? scene.nodes2D.find((a) => a.id === targetId) : scene.actors.find((a) => a.id === targetId);
        const role = target && ('physics2D' in target ? target.physics2D : target.physicsRole);
        if (p.targetRole && p.targetRole !== role) return false;
      }
      if (event === 'key-press') {
        const key = String(p.key ?? p.keyCombo ?? p.inputKey ?? '').toLowerCase();
        if (key === 'wasd / arrows') return ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(context.key || '');
        if (key && key !== context.key && key !== context.code?.toLowerCase() && !(key === 'space' && context.key === ' ')) return false;
      }
      return true;
    });
  }

  private collisionTarget(node: LogicNode, context: LogicEventContext) {
    const p = node.params;
    const scene = runtimeStore.getState().sceneSpec;
    const entities = this.engine === '2d' ? scene.nodes2D : scene.actors;
    const role = (id?: string) => {
      const entity = entities.find((a) => a.id === id);
      return entity && ('physics2D' in entity ? entity.physics2D : entity.physicsRole);
    };
    const targetId = p.actorId === context.otherActorId ? context.actorId : context.otherActorId;
    return !p.actorId && p.targetRole && role(targetId) !== p.targetRole && role(context.actorId) === p.targetRole
      ? context.actorId : targetId;
  }

  private timeline(from: number, to: number) {
    const scene = runtimeStore.getState().sceneSpec;
    const due: Array<{ nodeId: string; time: number }> = [];
    for (const node of scene.logicGraph?.nodes || []) {
      if (node.type !== 'trigger' || (eventAliases[node.params.eventType] || node.params.eventType) !== 'timeline-cue') continue;
      const p = node.params;
      const keyframe = p.keyframeId ? scene.camera.keyframes.find((k) => k.id === p.keyframeId) : undefined;
      const time = Number(p.cueTimeSeconds ?? p.time ?? keyframe?.time);
      if (Number.isFinite(time) && time >= 0 && time > from && time <= to) {
        due.push({ nodeId: node.id, time });
      }
    }
    due.sort((a, b) => a.time - b.time);
    for (const { nodeId, time } of due) this.dispatch('timeline-cue', { nodeId, sceneTime: time });
  }

  private dispatch(event: RuntimeEvent, context: LogicEventContext) {
    const roots = this.matching(event, context);
    const graph = runtimeStore.getState().sceneSpec.logicGraph;
    if (!graph) return false;
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const outgoing = new Map<string, typeof graph.edges>();
    for (const edge of graph.edges) {
      // `active` is a graph-editor visualization flag, not an enabled/disabled wire.
      const source = nodes.get(edge.sourceNodeId)?.outputs.find((p) => p.id === edge.sourcePortId);
      const target = nodes.get(edge.targetNodeId)?.inputs.find((p) => p.id === edge.targetPortId);
      // Actor/number wires carry references, never a second execution pulse.
      if (source?.dataType !== 'flow' || target?.dataType !== 'flow') continue;
      outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge]);
    }
    let budget = 512;
    for (const root of roots) {
      const queue = [{ node: root, path: new Set<string>(), actorId: event === 'collision' ? this.collisionTarget(root, context) : context.actorId }];
      while (queue.length) {
        const item = queue.shift()!;
        const { node, path } = item;
        const state = runtimeStore.getState();
        if (!state.isPlaying || state.sceneSpec.id !== this.sceneId) break;
        const fail = (reason: string) => {
          state.markNodeExecution(node.id, 'error', reason);
          state.appendLog({ level: 'error', nodeId: node.id, actorId: node.params.actorId || item.actorId, sceneTime: context.sceneTime,
            message: `[${node.title}] ${reason}`, payload: node.params });
        };
        if (--budget < 0 || path.has(node.id)) {
          fail('Logic graph cycle or execution budget exceeded');
          if (budget < 0) return roots.length > 0;
          continue;
        }
        try {
          let result: boolean | undefined;
          let actionSummary = '';
          if (node.type === 'condition') result = this.condition(node, item.actorId, context);
          else if (node.type !== 'trigger') actionSummary = this.action(node, item.actorId, context.sceneTime);
          state.markNodeExecution(node.id, 'success');
          state.appendLog({ level: node.type === 'trigger' ? 'trigger' : node.type === 'condition' ? 'info' : 'action',
            nodeId: node.id, actorId: node.params.actorId || item.actorId, sceneTime: context.sceneTime,
            message: node.type === 'trigger' ? `[${node.title}] ${event}${context.key ? ` (${context.key})` : ''}` :
              `[${node.title}] ${result === undefined ? actionSummary : `Condition = ${result}`}`, payload: node.params });
          const nextPath = new Set(path).add(node.id);
          for (const edge of outgoing.get(node.id) || []) {
            const port = edge.sourcePortId.toLowerCase();
            if (result !== undefined && (port.includes('false') ? result : !result)) continue;
            const target = nodes.get(edge.targetNodeId);
            if (target && target.type !== 'trigger') {
              // Follow actor data wires only when explicitly connected to this target.
              const actorWire = graph.edges.some((e) => e.sourceNodeId === node.id && e.targetNodeId === target.id &&
                node.outputs.some((p) => p.id === e.sourcePortId && p.dataType === 'actor') &&
                target.inputs.some((p) => p.id === e.targetPortId && p.dataType === 'actor'));
              queue.push({ node: target, path: nextPath,
                actorId: actorWire && node.type !== 'trigger' ? node.params.actorId || item.actorId : item.actorId });
            }
          }
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      }
    }
    return roots.length > 0;
  }

  private condition(node: LogicNode, actorId: string | undefined, context: LogicEventContext) {
    const state = runtimeStore.getState();
    const p = node.params;
    switch (p.conditionType) {
      case 'score-threshold': return state.gameScore >= finiteNumber(p.targetScore ?? state.sceneSpec.gameRules.targetScore, 'Target score');
      case 'cooldown': {
        const milliseconds = finiteNumber(p.cooldownMs ?? 500, 'Cooldown');
        if (milliseconds < 0) throw new Error('Cooldown must be nonnegative');
        const last = this.cooldowns.get(node.id) ?? -Infinity;
        const ready = (this.elapsed - last) * 1000 >= milliseconds;
        if (ready) this.cooldowns.set(node.id, this.elapsed);
        return ready;
      }
      case 'distance-check': {
        const scene = state.sceneSpec;
        const entities = this.engine === '2d' ? scene.nodes2D : scene.actors;
        const first = entities.find((a) => a.id === (p.actorId || actorId));
        const second = entities.find((a) => a.id === (p.targetActorId || p.otherActorId ||
          (first?.id === context.otherActorId ? context.actorId : context.otherActorId)));
        if (!first || !second) throw new Error('Distance check references a missing actor ID');
        const position = (a: ActorNode | Node2D) => this.runtimePosition?.(a.id) ?? ('position' in a ? a.position : [a.x, a.y, 0]);
        const a = position(first), b = position(second);
        const distance = finiteNumber(p.distanceMeters ?? p.distance ?? 2, 'Distance');
        if (distance < 0) throw new Error('Distance must be nonnegative');
        return Math.hypot(...a.map((v, i) => v - b[i])) < distance;
      }
      default: throw new Error(`Unsupported condition: ${p.conditionType}`);
    }
  }

  private action(node: LogicNode, eventActorId?: string, sceneTime?: number) {
    const state = runtimeStore.getState();
    const scene = state.sceneSpec;
    const p = node.params;
    if (node.type === 'robot-hardware') throw new Error('Hardware execution requires a connected hardware runtime');
    const id = p.actorId || eventActorId;
    const actor = scene.actors.find((a) => a.id === id);
    const node2D = scene.nodes2D.find((a) => a.id === id);
    const entity = this.engine === '2d' ? node2D : actor;
    if (p.actorId && !entity) throw new Error(`Missing target actor ID: ${p.actorId}`);
    const kind = p.actionType || '';
    const needsActor = ['play-animation', 'move-actor', 'set-animation'].includes(kind) ||
      p.position !== undefined || p.targetPosition !== undefined || p.x !== undefined || p.y !== undefined || p.z !== undefined ||
      p.animation !== undefined || p.activeClip !== undefined || p.impulseY !== undefined;
    if (needsActor && !entity) throw new Error(`Missing target actor ID: ${id || '(unset)'}`);
    if (needsActor && entity?.locked) throw new Error(`Target actor is locked: ${id}`);

    const actorPatch: Partial<ActorNode> = {};
    const nodePatch: Partial<Node2D> = {};
    let camera = scene.camera;
    let vfx = scene.vfx;
    let changed = false;
    if (p.activeClip !== undefined || p.animation !== undefined) {
      if (!actor || this.engine !== '3d') throw new Error('Skeletal animation is only supported by 3D actors');
      if (p.activeClip !== undefined) {
        if (!actor.availableClips?.includes(p.activeClip)) throw new Error(`Invalid animation clip '${p.activeClip}' for actor '${id}'`);
        actorPatch.activeClip = p.activeClip;
      }
      if (p.animation !== undefined) {
        if (!['idle', 'bounce', 'spin', 'walk', 'attack', 'float'].includes(p.animation)) throw new Error(`Invalid animation: ${p.animation}`);
        actorPatch.activeAnimation = p.animation;
      }
      if (p.speed !== undefined) {
        actorPatch.animationSpeed = finiteNumber(p.speed, 'Animation speed');
        if (actorPatch.animationSpeed < 0) throw new Error('Animation speed must be nonnegative');
      }
      changed = true;
    }
    if (p.position !== undefined || p.targetPosition !== undefined || p.x !== undefined || p.y !== undefined || p.z !== undefined || p.impulseY !== undefined) {
      const fallback = this.runtimePosition?.(id) ?? (this.engine === '2d' ? [node2D!.x, node2D!.y] : actor!.position);
      const target = p.targetPosition ?? p.position ?? [p.x ?? fallback[0], p.y ?? fallback[1], ...(this.engine === '3d' ? [p.z ?? fallback[2]] : [])];
      const position = checkedPosition(target, this.engine, scene.mode);
      if (p.impulseY !== undefined) position[1] += finiteNumber(p.impulseY, 'Vertical impulse') * (this.engine === '2d' ? -1 : 1);
      checkedPosition(this.engine === '2d' ? position.slice(0, 2) : position, this.engine, scene.mode);
      if (this.engine === '2d') Object.assign(nodePatch, { x: position[0], y: position[1] });
      else actorPatch.position = position;
      changed = true;
    }
    if (p.cameraMode !== undefined || p.fov !== undefined) {
      if (this.engine !== '3d') throw new Error('Camera tracks are only supported by the 3D stage');
      if (p.cameraMode !== undefined && !cameraModes.includes(p.cameraMode)) throw new Error(`Invalid camera track: ${p.cameraMode}`);
      const fov = finiteNumber(p.fov ?? camera.fov, 'Camera FOV');
      if (fov < 1 || fov > 179) throw new Error('Camera FOV is out of bounds [1..179]');
      if (p.followActorId && !scene.actors.some((a) => a.id === p.followActorId)) throw new Error(`Missing target actor ID: ${p.followActorId}`);
      camera = { ...camera, mode: p.cameraMode ?? camera.mode, fov, followActorId: p.followActorId ?? camera.followActorId };
      changed = true;
    }
    if (p.vfxType !== undefined || p.vfxId || kind === 'spawn-vfx') {
      const existing = p.vfxId ? vfx.find((v) => v.id === p.vfxId) : undefined;
      if (p.vfxId && !existing) throw new Error(`Missing VFX ID: ${p.vfxId}`);
      const type = p.vfxType ?? existing?.type ?? 'sparkles';
      if (!vfxTypes.includes(type)) throw new Error(`Invalid VFX type: ${type}`);
      const livePosition = id ? this.runtimePosition?.(id) : undefined;
      const origin = p.vfxPosition ?? (this.engine === '2d'
        ? [nodePatch.x ?? livePosition?.[0] ?? node2D?.x ?? 500, nodePatch.y ?? livePosition?.[1] ?? node2D?.y ?? 300]
        : actorPatch.position ?? actor?.position ?? existing?.position ?? [0, 0.2, 0]);
      const position = checkedPosition(origin, this.engine, scene.mode);
      const effect: VFXNode = { ...(existing || {}), id: existing?.id || `runtime-vfx-${node.id}`,
        name: node.title, type, position, color: p.color || existing?.color || '#38BDF8', intensity: 1,
        visible: true, startTime: sceneTime ?? state.currentTime, endTime: (sceneTime ?? state.currentTime) + 1 };
      vfx = [...vfx.filter((v) => v.id !== effect.id), effect];
      changed = true;
    }
    const score = p.scoreDelta !== undefined || kind === 'add-score' ? finiteNumber(p.scoreDelta ?? 0, 'Score delta') : undefined;
    if (!changed && score === undefined && node.type !== 'media-pipeline') throw new Error(`Unsupported action: ${kind || node.title}`);
    if (node.type === 'media-pipeline' && !changed && score === undefined) {
      // Declarative world stages are already rendered; external export/audio are not runtime actions.
      if (p.skybox || p.weatherType || p.terrainType) return 'Declarative world stage is ready';
      throw new Error('This media pipeline requires an external output runtime');
    }
    // Validate the complete action before applying any side effects.
    if (changed) runtimeStore.setState((current) => ({ sceneSpec: { ...current.sceneSpec, camera, vfx,
      actors: current.sceneSpec.actors.map((a) => a.id === id ? { ...a, ...actorPatch } : a),
      nodes2D: current.sceneSpec.nodes2D.map((a) => a.id === id ? { ...a, ...nodePatch } : a) } }));
    if (camera !== scene.camera) this.controlsCamera = true;
    if (score !== undefined) runtimeStore.getState().addGameScore(score, node.title);
    const effects = [
      actorPatch.activeClip ? `clip=${actorPatch.activeClip}` : actorPatch.activeAnimation ? `animation=${actorPatch.activeAnimation}` : '',
      actorPatch.position ? `position=[${actorPatch.position.join(', ')}]` : nodePatch.x !== undefined ? `position=[${nodePatch.x}, ${nodePatch.y}]` : '',
      camera !== scene.camera ? `camera=${camera.mode}, fov=${camera.fov}` : '',
      vfx !== scene.vfx ? `VFX=${p.vfxType || p.vfxId || 'sparkles'}` : '',
      score !== undefined ? `score ${score >= 0 ? '+' : ''}${score}` : '',
    ].filter(Boolean);
    return `Executed: ${effects.join('; ')}`;
  }
}

export function findLogicContacts(scene: SceneSpec, positionFor?: (id: string) => Vector3Tuple | undefined) {
  const time = runtimeStore.getState().currentTime;
  const entities = scene.engineType === '2d' ? scene.nodes2D : scene.actors;
  const live = entities.filter((a) => a.visible !== false && ('physics2D' in a || scene.mode === 'game' ||
    ((a.startTime ?? 0) <= time && (a.endTime ?? Infinity) >= time)));
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const pa = positionFor?.(a.id) ?? ('position' in a ? a.position : [a.x, a.y, 0]);
      const pb = positionFor?.(b.id) ?? ('position' in b ? b.position : [b.x, b.y, 0]);
      let overlaps = false;
      if ('physics2D' in a && 'physics2D' in b) {
        overlaps = Math.abs(pa[0] - pb[0]) <= (a.width * Math.abs(a.scaleX) + b.width * Math.abs(b.scaleX)) / 2 &&
          Math.abs(pa[1] - pb[1]) <= (a.height * Math.abs(a.scaleY) + b.height * Math.abs(b.scaleY)) / 2;
      } else if ('position' in a && 'position' in b) {
        const boxA = ASSET_REGISTRY[a.assetId]?.boundingBox || { width: 1, height: 2, depth: 1 };
        const boxB = ASSET_REGISTRY[b.assetId]?.boundingBox || { width: 1, height: 2, depth: 1 };
        const radiusA = Math.max(boxA.width * Math.abs(a.scale[0]), boxA.depth * Math.abs(a.scale[2])) * 0.42;
        const radiusB = Math.max(boxB.width * Math.abs(b.scale[0]), boxB.depth * Math.abs(b.scale[2])) * 0.42;
        overlaps = Math.hypot(pa[0] - pb[0], pa[2] - pb[2]) < radiusA + radiusB &&
          pa[1] <= pb[1] + boxB.height * Math.abs(b.scale[1]) && pb[1] <= pa[1] + boxA.height * Math.abs(a.scale[1]);
      }
      if (overlaps) {
        const aIsPlayer = 'physics2D' in a ? a.physics2D.startsWith('player-') : a.physicsRole === 'player';
        pairs.push(aIsPlayer ? [a.id, b.id] : [b.id, a.id]);
      }
    }
  }
  return pairs;
}
