/**
 * Phase 4 — intent alignment: does a game level really contain what its game design promised?
 *
 * The scene may carry `sceneSpec.gameDesign` (written by the game-design step, src/agent/gameDesign.ts). These rules compare the
 * design with the level: the verbs it promised are present, the failure mode exists (health + HUD, timer), the counters are
 * declared, and a level does not use verbs the player has not been taught yet. Pure and deterministic; scenes without a design
 * (and every built-in template) produce no issues at all.
 */
import { healthMax, isPlayerEntity, MAX_HUD } from '../runtime/game/state';
import type { GameVerb, Node2D, SceneSpec } from '../types/scene.schema';

export const INTENT_CODES = ['intent.mechanic-missing', 'intent.verb-too-early', 'intent.health-missing', 'intent.hud-health-missing', 'intent.timer-missing', 'intent.variable-missing', 'intent.win-mismatch'];

export interface IntentIssue {
  code: string;
  severity: 'warning';
  message: string;
  fixable: boolean;
  targetId?: string;
}

const real = (nodes: Node2D[]) => nodes.filter((n) => n.visible !== false);

/** Whether a 2D scene contains the thing each verb needs. `jump` and `survive` are about the player / rules, not objects. */
function hasVerb(spec: SceneSpec, verb: GameVerb): boolean {
  const all = spec.nodes2D || [];
  switch (verb) {
    case 'jump':
      return all.some((n) => n.physics2D === 'player-platformer');
    case 'collect':
      // Prefabs count: a spawner can make the collectibles.
      return all.some((n) => n.physics2D === 'collectible' && n.visible !== false);
    case 'avoid-hazards':
      return real(all).some((n) => !n.prefab && (n.physics2D === 'hazard' || (n.contactDamage ?? 0) > 0 || n.projectile));
    case 'dodge-projectiles':
      return all.some((n) => n.projectile && (n.projectile.target ?? 'player') !== 'enemy');
    case 'unlock': {
      if (!spec.variables?.length) return false;
      if (spec.gameRules?.winCondition === 'variable-threshold') return true;
      return (spec.logicGraph?.nodes || []).some((n) => n.params?.conditionType === 'variable-compare' || n.params?.actionType === 'add-variable');
    }
    case 'survive':
      return (spec.gameRules?.timeLimitSeconds ?? 0) > 0;
  }
}

/** Verbs checked for "too early": the ones a level visibly adds (jump and survive are always implied). */
const OBJECT_VERBS: GameVerb[] = ['collect', 'avoid-hazards', 'dodge-projectiles', 'unlock'];

function playerOf(spec: SceneSpec) {
  return (spec.nodes2D || []).find((n) => isPlayerEntity(n) && n.visible !== false);
}

export function intentIssues(spec: SceneSpec): IntentIssue[] {
  const design = spec.gameDesign;
  if (!design || spec.mode !== 'game' || spec.engineType !== '2d') return [];
  const out: IntentIssue[] = [];
  const add = (code: string, message: string, fixable: boolean, targetId?: string) => out.push({ code, severity: 'warning', message, fixable, targetId });

  const index = spec.sequence?.kind === 'game-levels' ? spec.sequence.index : undefined;
  const level = index !== undefined ? design.levels[index] : undefined;
  const required = level ? level.uses : design.mechanics;

  const timed = design.win === 'survive-timer' || design.lose === 'timer';
  for (const verb of required) {
    if (verb === 'survive' && timed) continue; // reported as intent.timer-missing, which is fixable
    if (!hasVerb(spec, verb)) {
      add('intent.mechanic-missing', `The game design promises "${verb}"${level ? ` in level ${index! + 1} "${level.name}"` : ''} but the scene has nothing for it.`, false, verb);
    }
  }
  if (level) {
    for (const verb of OBJECT_VERBS) {
      if (!level.uses.includes(verb) && hasVerb(spec, verb)) {
        add('intent.verb-too-early', `Level ${index! + 1} "${level.name}" uses "${verb}" before the design teaches it. Remove it or move it to a later level.`, false, verb);
      }
    }
  }

  const player = playerOf(spec);
  if (design.usesHealth && player && healthMax(player) === undefined) {
    add('intent.health-missing', `The design says the player has health but "${player.name}" has none.`, true, player.id);
  }
  if (design.usesHealth && player && healthMax(player) !== undefined && !(spec.hud || []).some((h) => h.source === 'health')) {
    add('intent.hud-health-missing', 'The player has health but the HUD shows no health bar.', (spec.hud || []).length < MAX_HUD, 'hud');
  }
  if ((design.win === 'survive-timer' || design.lose === 'timer') && !((spec.gameRules?.timeLimitSeconds ?? 0) > 0)) {
    add('intent.timer-missing', 'The design is timed but gameRules.timeLimitSeconds is not set.', true, 'rules');
  }
  const declared = new Set((spec.variables || []).map((v) => v.id));
  for (const v of design.variables || []) {
    if (!declared.has(v.id)) add('intent.variable-missing', `The design needs the counter "${v.id}" but sceneSpec.variables does not declare it.`, true, v.id);
  }
  if (spec.gameRules && spec.gameRules.winCondition !== design.win && spec.gameRules.winCondition !== 'unbox-reveal') {
    add('intent.win-mismatch', `The design wins by "${design.win}" but gameRules.winCondition is "${spec.gameRules.winCondition}".`, false, 'rules');
  }
  return out;
}

/** Repairs one fixable intent issue in place; returns a description, or null when it cannot. */
export function fixIntent(spec: SceneSpec, issue: { code: string; targetId?: string }): string | null {
  const design = spec.gameDesign;
  if (!design) return null;
  switch (issue.code) {
    case 'intent.health-missing': {
      const player = (spec.nodes2D || []).find((n) => n.id === issue.targetId);
      if (!player) return null;
      player.health = { max: 3, invulnerableSeconds: 0.8 };
      return `Gave "${player.name}" 3 health, as the design says`;
    }
    case 'intent.hud-health-missing': {
      spec.hud = spec.hud || [];
      if (spec.hud.length >= MAX_HUD) return null;
      let id = 'hud-health';
      for (let i = 2; spec.hud.some((h) => h.id === id); i++) id = `hud-health-${i}`;
      spec.hud.push({ id, kind: 'bar', source: 'health', anchor: 'top-left' });
      return 'Added a health bar to the HUD';
    }
    case 'intent.timer-missing': {
      if (!spec.gameRules) return null;
      spec.gameRules.timeLimitSeconds = design.timeLimitSeconds && design.timeLimitSeconds > 0 ? design.timeLimitSeconds : 30;
      return `Set the time limit to ${spec.gameRules.timeLimitSeconds}s`;
    }
    case 'intent.variable-missing': {
      const v = (design.variables || []).find((x) => x.id === issue.targetId);
      if (!v) return null;
      spec.variables = [...(spec.variables || []), { id: v.id, label: v.label, initial: 0 }];
      return `Declared the counter "${v.id}"`;
    }
    default:
      return null;
  }
}
