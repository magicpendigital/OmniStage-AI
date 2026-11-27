/**
 * Phase 3 — runtime entities of a 2D game scene: spawners, projectiles and contact damage.
 * Runs once per frame from `drawStage2D` (game mode, playing), shared by the studio and the OmniStage Player.
 * Positions of spawned clones live in the scene (`runtimeStore`), the clocks live on the stage's body map, so a
 * restart (bodies cleared + scene reset) replays the same spawns.
 */
import type { Node2D } from '../../types/scene.schema';
import { runtimeStore } from '../host';
import { overlaps } from '../physics/collide2d';
import { nodeBox2D } from '../physics/nodeBox';
import { healthMax, isPlayerEntity, stepProjectile, stepSpawner } from './state';
import { resolveWaves, stepWaves } from './waves';
import type { RuntimeBody2D } from '../stage2d';

type Bodies = Record<string, RuntimeBody2D>;

const bodyOf = (bodies: Bodies, n: Node2D): RuntimeBody2D => (bodies[n.id] ||= { x: n.x, y: n.y, vx: 0, vy: 0, onGround: false });

/** The live position of a node: the player is simulated in `bodies`, everything else lives in the spec. */
function livePos(n: Node2D, bodies: Bodies): { x: number; y: number } {
  const b = bodies[n.id];
  return isPlayerEntity(n) && b ? { x: b.x, y: b.y } : { x: n.x, y: n.y };
}

/** Phase 7B: runs the scene's wave schedule — spawns what is due and ends the round when the last wave is over (`survive-waves`). */
function stepWaveSchedule(dt: number) {
  const state = runtimeStore.getState();
  const waves = resolveWaves(state.sceneSpec);
  if (!waves.length || state.gameWave.phase === 'done' || state.gameEnded) return;
  const nodes = state.sceneSpec.nodes2D;
  const alive = (prefabId: string) => nodes.filter((n) => n.id.startsWith(`${prefabId}#`)).length;
  const step = stepWaves(waves, state.gameWave, dt, alive);
  const next = step.next;
  for (const spawn of step.spawns) {
    const prefab = nodes.find((n) => n.id === spawn.prefabId && n.prefab);
    if (!prefab) continue;
    try {
      const id = runtimeStore.getState().spawnPrefab(spawn.prefabId, (spawn.x ?? prefab.x) + spawn.dx, (spawn.y ?? prefab.y) + spawn.dy);
      // The scene is full (clone cap): give the spawn back, so it is tried again next frame instead of silently lost.
      if (id === undefined && next.spawned[spawn.group] > 0) next.spawned[spawn.group] -= 1;
    } catch (error) {
      runtimeStore.getState().appendLog({ level: 'error', message: `[Waves] ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const before = state.gameWave;
  if (step.next.index !== before.index || step.next.phase !== before.phase) {
    const entered = step.next.phase === 'active' ? waves[step.next.index]?.name : undefined;
    if (entered) runtimeStore.getState().appendLog({ level: 'info', message: `[Waves] ${entered} starts` });
  }
  runtimeStore.setState({ gameWave: next });
  if (step.finished && state.sceneSpec.gameRules?.winCondition === 'survive-waves') runtimeStore.getState().endGame(true);
}

export function stepGameEntities2D(bodies: Bodies, dt: number) {
  const first = runtimeStore.getState();
  if (first.sceneSpec.mode !== 'game' || !first.isPlaying || first.gameEnded) return;

  // --- spawners ---
  for (const owner of first.sceneSpec.nodes2D) {
    if (!owner.spawner || owner.prefab || owner.visible === false) continue;
    const body = bodyOf(bodies, owner);
    const clock = (body.spawnClock ||= { t: 0, n: 0 });
    const alive = runtimeStore.getState().sceneSpec.nodes2D.filter((n) => n.id.startsWith(`${owner.spawner!.prefabId}#`)).length;
    const request = stepSpawner(owner, owner.spawner, clock, dt, alive);
    if (!request) continue;
    try {
      runtimeStore.getState().spawnPrefab(request.prefabId, request.x, request.y);
    } catch (error) {
      runtimeStore.getState().appendLog({ level: 'error', actorId: owner.id, message: `[Spawner] ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // --- waves (Phase 7B) ---
  stepWaveSchedule(dt);

  // --- projectiles ---
  let state = runtimeStore.getState();
  const moved = new Map<string, { x: number; y: number }>();
  const gone: Array<{ id: string; hit?: Node2D; damage: number }> = [];
  const solids = state.sceneSpec.nodes2D.filter((n) => n.visible !== false && !n.prefab && n.physics2D === 'solid');
  const targets = state.sceneSpec.nodes2D.filter((n) => n.visible !== false && !n.prefab && healthMax(n) !== undefined);
  for (const p of state.sceneSpec.nodes2D) {
    if (!p.projectile || p.prefab || p.visible === false) continue;
    const body = bodyOf(bodies, p);
    const clock = (body.projClock ||= { age: 0, vy: 0 });
    const next = stepProjectile(p.projectile, clock, p.x, p.y, dt);
    const box = nodeBox2D(p, next);
    if (next.expired) {
      gone.push({ id: p.id, damage: 0 });
      continue;
    }
    if (solids.some((s) => overlaps(box, nodeBox2D(s, s)))) {
      gone.push({ id: p.id, damage: 0 });
      continue;
    }
    const aim = p.projectile.target ?? 'any';
    const victim = targets.find((t) => {
      if (t.id === p.id) return false;
      const player = isPlayerEntity(t);
      if ((aim === 'player' && !player) || (aim === 'enemy' && player)) return false;
      return overlaps(box, nodeBox2D(t, livePos(t, bodies)));
    });
    if (victim) {
      const damage = p.projectile.damage ?? 1;
      runtimeStore.getState().damageEntity(victim.id, damage);
      if (p.projectile.destroyOnHit !== false) {
        gone.push({ id: p.id, hit: victim, damage });
        continue;
      }
    }
    moved.set(p.id, next);
  }
  if (moved.size) {
    runtimeStore.setState((s) => ({ sceneSpec: { ...s.sceneSpec, nodes2D: s.sceneSpec.nodes2D.map((n) => (moved.has(n.id) ? { ...n, ...moved.get(n.id)! } : n)) } }));
  }
  for (const g of gone) runtimeStore.getState().despawnEntity(g.id);

  // --- contact damage on the player ---
  state = runtimeStore.getState();
  if (state.gameEnded) return;
  const player = state.sceneSpec.nodes2D.find((n) => isPlayerEntity(n) && n.visible !== false);
  if (!player || healthMax(player) === undefined) return;
  const playerBox = nodeBox2D(player, livePos(player, bodies));
  for (const n of state.sceneSpec.nodes2D) {
    if (n.id === player.id || n.visible === false || n.prefab || !(n.contactDamage && n.contactDamage > 0) || n.physics2D === 'hazard') continue;
    if (overlaps(playerBox, nodeBox2D(n, livePos(n, bodies)))) {
      runtimeStore.getState().damageEntity(player.id, n.contactDamage);
      break;
    }
  }
}
