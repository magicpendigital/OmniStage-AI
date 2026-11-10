import React, { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../state/useStudioStore';
import { playSceneSfx } from '../audio/audioBus';
import { sampleKeyframes } from '../animation/easing';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { ActorNode, CameraMode, EngineType, LogicNode, Node2D, SceneSpec, Vector3Tuple, VFXNode, VFXType } from '../types/scene.schema';

const DESIGN_WIDTH = 1000;
const DESIGN_HEIGHT = 600;

type RuntimeEvent = 'scene-start' | 'actor-click' | 'collision' | 'key-press' | 'timeline-cue';
interface LogicEventContext {
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
    const state = useStudioStore.getState();
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
    const state = useStudioStore.getState();
    const duration = Math.max(2, state.sceneSpec.durationSeconds || 8);
    const next = state.currentTime + delta;
    this.elapsed += delta;
    this.timeline(state.currentTime, Math.min(next, duration));
    if (next >= duration && state.isLooping) {
      this.contacts.clear();
      this.timeline(-1, next % duration);
    }
    state.advanceTimeline(delta);
    this.previousTime = useStudioStore.getState().currentTime;
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
    const scene = useStudioStore.getState().sceneSpec;
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
    const scene = useStudioStore.getState().sceneSpec;
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
    const scene = useStudioStore.getState().sceneSpec;
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
    const graph = useStudioStore.getState().sceneSpec.logicGraph;
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
        const state = useStudioStore.getState();
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
    const state = useStudioStore.getState();
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
    const state = useStudioStore.getState();
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
    if (changed) useStudioStore.setState((current) => ({ sceneSpec: { ...current.sceneSpec, camera, vfx,
      actors: current.sceneSpec.actors.map((a) => a.id === id ? { ...a, ...actorPatch } : a),
      nodes2D: current.sceneSpec.nodes2D.map((a) => a.id === id ? { ...a, ...nodePatch } : a) } }));
    if (camera !== scene.camera) this.controlsCamera = true;
    if (score !== undefined) useStudioStore.getState().addGameScore(score, node.title);
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
  const time = useStudioStore.getState().currentTime;
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

const sharedRuntimes = new Map<EngineType, RuntimeLogicGraph>();
let mountedStages = 0;
let detachedFrame: number | undefined;
let detachedDisposed = false;
function sharedRuntime(engine: EngineType) {
  if (!sharedRuntimes.has(engine)) sharedRuntimes.set(engine, new RuntimeLogicGraph(engine));
  return sharedRuntimes.get(engine)!;
}

// The graph-only workspace unmounts both stages. Keep graph time/events alive
// there, and retain interpreter state when switching between viewport and split.
function updateDetachedRuntime() {
  if (detachedDisposed || typeof window === 'undefined') return;
  if (mountedStages || !useStudioStore.getState().isPlaying) {
    if (detachedFrame !== undefined) cancelAnimationFrame(detachedFrame);
    detachedFrame = undefined;
    return;
  }
  if (detachedFrame !== undefined) return;
  let lastTime = performance.now();
  const frame = (now: number) => {
    detachedFrame = undefined;
    const state = useStudioStore.getState();
    if (detachedDisposed || mountedStages || !state.isPlaying) return;
    const runtime = sharedRuntime(state.sceneSpec.engineType);
    runtime.advance(Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    runtime.collisions(findLogicContacts(useStudioStore.getState().sceneSpec));
    if (useStudioStore.getState().isPlaying) detachedFrame = requestAnimationFrame(frame);
  };
  detachedFrame = requestAnimationFrame(frame);
}

if (typeof window !== 'undefined') {
  const unsubscribe = useStudioStore.subscribe((state, previous) => {
    if (state.isPlaying !== previous.isPlaying) updateDetachedRuntime();
  });
  const keyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (mountedStages || e.repeat || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) return;
    sharedRuntime(useStudioStore.getState().sceneSpec.engineType).emit('key-press', { key: e.key.toLowerCase(), code: e.code });
  };
  window.addEventListener('keydown', keyDown);
  import.meta.hot?.dispose(() => {
    detachedDisposed = true;
    unsubscribe();
    window.removeEventListener('keydown', keyDown);
    if (detachedFrame !== undefined) cancelAnimationFrame(detachedFrame);
  });
}

export function useRuntimeLogicGraph(engine: EngineType, bodies?: React.RefObject<Record<string, RuntimeBody2D>>) {
  const [runtime] = useState(() => sharedRuntime(engine));
  useEffect(() => {
    mountedStages++;
    runtime.runtimePosition = bodies ? (id) => {
      const state = useStudioStore.getState();
      const node = state.sceneSpec.nodes2D.find((n) => n.id === id);
      if (!node) return undefined;
      const p = displayedPosition2D(node, state.isPlaying, state.currentTime, state.sceneSpec.mode, bodies.current);
      return [p.x, p.y, 0];
    } : undefined;
    updateDetachedRuntime();
    return () => {
      mountedStages--;
      runtime.runtimePosition = undefined;
      updateDetachedRuntime();
    };
  }, [runtime, bodies]);
  return runtime;
}

interface RuntimeBody2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  collected?: boolean;
  specX?: number;
  specY?: number;
}

export const StageCanvas2D: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const bodiesRef = useRef<Record<string, RuntimeBody2D>>({});
  const logicRuntime = useRuntimeLogicGraph('2d', bodiesRef);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const setCanvasElement = useStudioStore((s) => s.setCanvasElement);
  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const updateNode2D = useStudioStore((s) => s.updateNode2D);

  // Register 2D canvas element for 4K PNG snapshots & 60fps WebM video capture
  useEffect(() => {
    if (canvasRef.current) {
      setCanvasElement(canvasRef.current);
    }
    return () => setCanvasElement(null);
  }, [setCanvasElement]);

  // Graph telemetry clones the scene; only scene changes reset physics bodies.
  useEffect(() => {
    bodiesRef.current = {};
  }, [sceneSpec.id, sceneSpec.mode]);

  // Keyboard listeners for 2D Platformer / Top-Down Game Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      pressedKeysRef.current.add(e.key.toLowerCase());
      if (!e.repeat) logicRuntime.emit('key-press', { key: e.key.toLowerCase(), code: e.code });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(e.key.toLowerCase());
    };
    const onBlur = () => pressedKeysRef.current.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [logicRuntime]);

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / DESIGN_WIDTH, rect.height / DESIGN_HEIGHT);
    return {
      x: (e.clientX - rect.left - (rect.width - DESIGN_WIDTH * scale) / 2) / scale,
      y: (e.clientY - rect.top - (rect.height - DESIGN_HEIGHT * scale) / 2) / scale,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e);
    const state = useStudioStore.getState();
    const nodes = [...(state.sceneSpec.nodes2D || [])].filter((n) => n.visible !== false &&
      !(state.isPlaying && bodiesRef.current[n.id]?.collected)).reverse();

    const hit = nodes.find(
      (n) => {
        const position = displayedPosition2D(n, state.isPlaying, state.currentTime, state.sceneSpec.mode, bodiesRef.current);
        const angle = -n.rotation * Math.PI / 180;
        const dx = x - position.x, dy = y - position.y;
        return Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) <= n.width * Math.abs(n.scaleX) / 2 &&
          Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) <= n.height * Math.abs(n.scaleY) / 2;
      }
    );

    if (hit) {
      selectNode2D(hit.id);
      if (state.isPlaying) {
        logicRuntime.emit('actor-click', { actorId: hit.id });
        return;
      }
      if (!hit.locked) {
        setDraggingId(hit.id);
        dragOffsetRef.current = { dx: x - hit.x, dy: y - hit.y };
      }
    } else {
      selectNode2D(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingId) return;
    const { x, y } = toCanvasCoords(e);
    updateNode2D(draggingId, {
      x: Math.round(x - dragOffsetRef.current.dx),
      y: Math.round(y - dragOffsetRef.current.dy),
    });
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const generation = logicRuntime.generation;
      logicRuntime.advance(dt);
      if (generation !== logicRuntime.generation) bodiesRef.current = {};
      const storeState = useStudioStore.getState();
      const liveIds = new Set(storeState.sceneSpec.nodes2D.map((n) => n.id));
      for (const id of Object.keys(bodiesRef.current)) if (!liveIds.has(id)) delete bodiesRef.current[id];
      for (const node of storeState.sceneSpec.nodes2D) {
        const body = bodiesRef.current[node.id];
        if (!body) bodiesRef.current[node.id] = { x: node.x, y: node.y, vx: 0, vy: 0, onGround: false, specX: node.x, specY: node.y };
        else if (body.specX !== node.x || body.specY !== node.y || !storeState.isPlaying) {
          Object.assign(body, { x: node.x, y: node.y, specX: node.x, specY: node.y, vx: 0, vy: 0, onGround: false });
        }
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawStage2D(
            ctx,
            storeState.sceneSpec.nodes2D || [],
            storeState.sceneSpec.environment.backgroundColor || '#0B101B',
            storeState.sceneSpec.environment.groundGrid,
            storeState.selectedNode2DId,
            storeState.isPlaying,
            storeState.currentTime,
            storeState.sceneSpec.mode,
            dt,
            pressedKeysRef.current,
            bodiesRef.current,
            imageCacheRef.current,
            Math.abs(storeState.settings.physicsGravity || 9.8) * 90,
            logicRuntime
          );
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [logicRuntime]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        width={DESIGN_WIDTH}
        height={DESIGN_HEIGHT}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full object-contain cursor-crosshair shadow-2xl"
      />

      <div className="pointer-events-none absolute bottom-16 left-4 flex items-center gap-2 px-2.5 py-1 rounded bg-slate-900/85 border border-fuchsia-500/40 text-[11px] font-mono text-fuchsia-300">
        <span>2D VECTOR & SPRITE ENGINE (1000×600)</span>
        <span className="text-slate-500">·</span>
        <span>
          {sceneSpec.mode === 'game'
            ? 'WASD / SPACE to Jump & Collect'
            : 'Click & Drag 2D Layers directly on Canvas'}
        </span>
      </div>
    </div>
  );
};

function drawStage2D(
  ctx: CanvasRenderingContext2D,
  nodes: Node2D[],
  bgColor: string,
  showGrid: boolean,
  selectedId: string | null,
  isPlaying: boolean,
  currentTime: number,
  mode: 'game' | 'media',
  dt: number,
  keys: Set<string>,
  bodies: Record<string, RuntimeBody2D>,
  imageCache: Record<string, HTMLImageElement>,
  gravityPx: number,
  logicRuntime: RuntimeLogicGraph
) {
  ctx.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

  const grad = ctx.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
  grad.addColorStop(0, bgColor);
  grad.addColorStop(1, '#050811');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

  if (showGrid) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const step = 50;
    for (let x = 0; x <= DESIGN_WIDTH; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, DESIGN_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= DESIGN_HEIGHT; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(DESIGN_WIDTH, y);
      ctx.stroke();
    }
  }

  // 2D Physics Simulation Step
  if (mode === 'game' && isPlaying) {
    const playerNode = nodes.find(
      (n) =>
        (n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown') &&
        n.visible !== false
    );
    const platforms = nodes.filter(
      (n) => n.physics2D === 'static-platform' && n.visible !== false
    );

    if (playerNode) {
      const b =
        bodies[playerNode.id] ||
        (bodies[playerNode.id] = {
          x: playerNode.x,
          y: playerNode.y,
          vx: 0,
          vy: 0,
          onGround: false,
        });

      const moveSpeed = 320;
      if (keys.has('a') || keys.has('arrowleft')) b.vx = -moveSpeed;
      else if (keys.has('d') || keys.has('arrowright')) b.vx = moveSpeed;
      else b.vx *= 0.82;

      if (playerNode.physics2D === 'player-topdown') {
        if (keys.has('w') || keys.has('arrowup')) b.vy = -moveSpeed;
        else if (keys.has('s') || keys.has('arrowdown')) b.vy = moveSpeed;
        else b.vy *= 0.82;
      } else {
        if ((keys.has('w') || keys.has('arrowup') || keys.has(' ')) && b.onGround) {
          b.vy = -520;
          b.onGround = false;
          playSceneSfx(useStudioStore.getState().sceneSpec, 'jump');
        }
        b.vy += gravityPx * dt;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.onGround = false;

      const halfW = playerNode.width / 2;
      const halfH = playerNode.height / 2;

      for (const plat of platforms) {
        const pLeft = plat.x - plat.width / 2;
        const pRight = plat.x + plat.width / 2;
        const pTop = plat.y - plat.height / 2;
        const pBottom = plat.y + plat.height / 2;

        if (b.x + halfW > pLeft && b.x - halfW < pRight) {
          if (
            b.vy >= 0 &&
            b.y + halfH >= pTop &&
            b.y - halfH < pTop &&
            b.y + halfH <= pBottom + 24
          ) {
            b.y = pTop - halfH;
            b.vy = 0;
            b.onGround = true;
          }
        }
      }

      if (b.x < halfW) b.x = halfW;
      if (b.x > DESIGN_WIDTH - halfW) b.x = DESIGN_WIDTH - halfW;
      if (b.y > DESIGN_HEIGHT + 100) {
        b.x = playerNode.x;
        b.y = playerNode.y;
        b.vx = 0;
        b.vy = 0;
      }

    }
  }

  if (isPlaying) {
    const live = nodes.filter((n) => n.visible !== false && !bodies[n.id]?.collected);
    const pairs = findLogicContacts({ ...useStudioStore.getState().sceneSpec, nodes2D: live }, logicRuntime.runtimePosition);
    const handled = logicRuntime.collisions(pairs);
    for (const [id, otherId] of pairs) {
      const player = live.find((n) => n.id === id);
      const other = live.find((n) => n.id === otherId);
      if (mode === 'game' && !handled.has(otherId) && player?.physics2D.startsWith('player-') && other?.physics2D === 'collectible') {
        if (bodies[other.id]) bodies[other.id].collected = true;
        useStudioStore.getState().addGameScore(other.scoreValue ?? 25, other.name, other.fill);
      }
    }
    // Collision actions can move/hide nodes or spawn effects in this same frame.
    nodes = useStudioStore.getState().sceneSpec.nodes2D;
  }

  for (const node of nodes) {
    if (node.visible === false) continue;
    const body = bodies[node.id];
    if (mode === 'game' && isPlaying && body?.collected) continue;

    const position = displayedPosition2D(node, isPlaying, currentTime, mode, bodies);
    const drawX = position.x;
    const drawY = position.y;
    let drawRot = (node.rotation * Math.PI) / 180;
    let drawScaleX = node.scaleX ?? 1;
    let drawScaleY = node.scaleY ?? 1;

    if (isPlaying) {
      if (!node.keyframeTrack?.length && (node.physics2D === 'collectible' || node.shapeKind === 'star')) {
        drawRot += currentTime * 1.4;
      } else if (node.type === 'text-kinetic') {
        const pulse = 1 + Math.sin(currentTime * 3.0) * 0.04;
        drawScaleX *= pulse;
        drawScaleY *= pulse;
      }
    }

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(drawRot);
    ctx.scale(drawScaleX, drawScaleY);
    ctx.globalAlpha = node.opacity ?? 1;

    const w = node.width;
    const h = node.height;

    if (node.imageUrl) {
      let img = imageCache[node.imageUrl];
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = node.imageUrl;
        imageCache[node.imageUrl] = img;
      }
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = node.fill;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
    } else if (node.type === 'text-kinetic') {
      ctx.font = `800 ${node.fontSize || 34}px "Space Grotesk", Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (node.stroke) {
        ctx.lineWidth = (node.strokeWidth || 2) * 2;
        ctx.strokeStyle = node.stroke;
        ctx.strokeText(node.text || node.name, 0, 0);
      }
      ctx.fillStyle = node.fill;
      ctx.fillText(node.text || node.name, 0, 0);
    } else if (node.shapeKind === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#ffffff';
        ctx.stroke();
      }
    } else if (node.shapeKind === 'star') {
      drawStarPath(ctx, 0, 0, 5, Math.min(w, h) / 2, Math.min(w, h) / 4.2);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#ffffff';
        ctx.stroke();
      }
    } else if (node.shapeKind === 'capsule' || node.type === 'sprite-actor') {
      drawRoundedRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.35);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#ffffff';
        ctx.stroke();
      }
      if (node.type === 'sprite-actor') {
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, -w * 0.22, -h * 0.26, w * 0.52, h * 0.22, 6);
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(w * 0.12, -h * 0.15, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      drawRoundedRect(ctx, -w / 2, -h / 2, w, h, 8);
      ctx.fillStyle = node.fill;
      ctx.fill();
      if (node.strokeWidth) {
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeStyle = node.stroke || '#38bdf8';
        ctx.stroke();
      }
    }

    if (node.id === selectedId) {
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // Render graph-created effects from the same declarative VFX contract as 3D.
  for (const effect of useStudioStore.getState().sceneSpec.vfx) {
    if (effect.visible === false || !isPlaying || currentTime < (effect.startTime ?? 0) || currentTime > (effect.endTime ?? Infinity)) continue;
    const age = currentTime - (effect.startTime ?? 0);
    ctx.save();
    ctx.translate(effect.position[0], effect.position[1]);
    ctx.strokeStyle = ctx.fillStyle = effect.color;
    ctx.globalAlpha = Math.max(0, 1 - age);
    if (effect.type === 'floating-3d-badge') {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(effect.labelText || effect.name, 0, -age * 40);
    } else if (effect.type === 'laser-beam') {
      ctx.fillRect(-3, -80, 6, 160);
    } else if (effect.type === 'shockwave') {
      ctx.beginPath(); ctx.arc(0, 0, 10 + age * 90, 0, Math.PI * 2); ctx.stroke();
    } else {
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        ctx.fillRect(Math.cos(angle) * age * 90, Math.sin(angle) * age * 90 + (effect.type === 'confetti' ? age * age * 80 : 0), 4, 4);
      }
    }
    ctx.restore();
  }
}

function displayedPosition2D(node: Node2D, isPlaying: boolean, time: number, mode: 'game' | 'media', bodies: Record<string, RuntimeBody2D>) {
  const body = bodies[node.id];
  let x = node.x, y = node.y;
  if (isPlaying && mode === 'game' && body && node.physics2D.startsWith('player-') && body.specX === node.x && body.specY === node.y) {
    x = body.x; y = body.y;
  }
  if (isPlaying && node.keyframeTrack?.length) {
    // Phase 4: per-keyframe easing (GSAP-style curves from src/animation/easing.ts).
    const seg = sampleKeyframes(node.keyframeTrack, time);
    if (seg) {
      x = seg.from.x + (seg.to.x - seg.from.x) * seg.progress;
      y = seg.from.y + (seg.to.y - seg.from.y) * seg.progress;
    }
  } else if (isPlaying && (node.physics2D === 'collectible' || node.shapeKind === 'star')) {
    y += Math.sin(time * 3.5 + node.x * 0.02) * 8;
  }
  return { x, y };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number
) {
  let rot = (Math.PI / 2) * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}
