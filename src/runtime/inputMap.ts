/**
 * Phase 7C — input remapping: a scene can name extra keys for its player actions (`SceneSpec.input.bindings`). The shared runtime
 * (2D controller, the 3D walk) reads the canonical keys — arrows and Space — so every host just passes its pressed keys through
 * `applyInputMap`, which adds the canonical key for each action whose bound key is held. WASD, the arrows, Space, the on-screen
 * controls and gamepads keep working (they all produce canonical keys), so a remap can never lock a player out.
 *
 * Pure: no DOM, no store.
 */
import type { InputAction, InputConfig, SceneSpec } from '../types/scene.schema';

export const INPUT_ACTIONS: readonly InputAction[] = ['left', 'right', 'up', 'down', 'jump'];
/** The key the runtime reads for each action. */
export const CANONICAL_KEY: Record<InputAction, string> = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', jump: ' ' };
export const MAX_KEYS_PER_ACTION = 6;
export const TOUCH_STYLES = ['auto', 'buttons', 'joystick'] as const;

/** Keys the player must not rebind: the browser or the studio owns them. */
const RESERVED = new Set(['escape', 'tab', 'f5', 'f11', 'f12', 'meta', 'control', 'alt', 'contextmenu']);

/** `KeyboardEvent.key` spelling → the name scenes use ('space' and ' ' are the same key). */
export function normalizeKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  if (key === ' ') return ' ';
  const k = key.trim().toLowerCase();
  if (!k || k.length > 16) return null;
  if (k === 'space' || k === 'spacebar') return ' ';
  return k;
}

/** Per action, the valid normalised extra keys (reserved keys, duplicates and non-strings dropped). */
export function resolveBindings(input: InputConfig | undefined): Partial<Record<InputAction, string[]>> {
  const out: Partial<Record<InputAction, string[]>> = {};
  const bindings = input?.bindings;
  if (!bindings || typeof bindings !== 'object') return out;
  for (const action of INPUT_ACTIONS) {
    const raw = (bindings as Record<string, unknown>)[action];
    if (!Array.isArray(raw)) continue;
    const keys: string[] = [];
    for (const r of raw) {
      const k = normalizeKey(r);
      if (k && !RESERVED.has(k) && !keys.includes(k)) keys.push(k);
      if (keys.length >= MAX_KEYS_PER_ACTION) break;
    }
    if (keys.length) out[action] = keys;
  }
  return out;
}

/**
 * The keys the runtime should see: `keys` plus the canonical key of every action one of whose bound keys is held. Returns `keys`
 * itself (no allocation) when the scene has no remap, which is every frame of nearly every scene.
 */
export function applyInputMap(input: InputConfig | undefined, keys: Set<string>): Set<string> {
  if (!input?.bindings || keys.size === 0) return keys;
  const bindings = resolveBindings(input);
  let out: Set<string> | null = null;
  for (const action of INPUT_ACTIONS) {
    const bound = bindings[action];
    if (!bound) continue;
    for (const k of bound) {
      if (!keys.has(k)) continue;
      out ??= new Set(keys);
      out.add(CANONICAL_KEY[action]);
      break;
    }
  }
  return out ?? keys;
}

/** What is wrong with `spec.input` (empty = fine). */
export function inputProblems(spec: Pick<SceneSpec, 'input'>): string[] {
  const out: string[] = [];
  const input = spec.input;
  if (input === undefined) return out;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['input must be an object'];
  if (input.touch !== undefined && !(TOUCH_STYLES as readonly string[]).includes(input.touch as string)) out.push(`input.touch must be one of ${TOUCH_STYLES.join(', ')}`);
  const b = input.bindings;
  if (b === undefined) return out;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return [...out, 'input.bindings must be an object'];
  for (const [action, list] of Object.entries(b)) {
    if (!(INPUT_ACTIONS as readonly string[]).includes(action)) {
      out.push(`unknown action "${action}" (use ${INPUT_ACTIONS.join(', ')})`);
      continue;
    }
    if (!Array.isArray(list)) {
      out.push(`bindings.${action} must be a list of keys`);
      continue;
    }
    if (list.length > MAX_KEYS_PER_ACTION) out.push(`bindings.${action}: at most ${MAX_KEYS_PER_ACTION} keys`);
    for (const k of list) {
      const n = normalizeKey(k);
      if (!n) out.push(`bindings.${action}: ${JSON.stringify(k)} is not a key name`);
      else if (RESERVED.has(n)) out.push(`bindings.${action}: "${n}" is reserved`);
    }
  }
  return out;
}

/** Deterministic repair of `inputProblems` (mutates `spec`). Returns true when something changed. */
export function repairInput(spec: Pick<SceneSpec, 'input'>): boolean {
  if (spec.input === undefined) return false;
  const before = JSON.stringify(spec.input);
  const input = spec.input && typeof spec.input === 'object' && !Array.isArray(spec.input) ? spec.input : {};
  const next: InputConfig = {};
  if ((TOUCH_STYLES as readonly string[]).includes(input.touch as string) && input.touch !== 'auto') next.touch = input.touch;
  const bindings = resolveBindings(input);
  if (Object.keys(bindings).length) next.bindings = bindings;
  if (Object.keys(next).length) spec.input = next;
  else delete spec.input;
  return JSON.stringify(spec.input) !== before;
}

/** Actions that two different bindings both claim a key for (the same key bound to e.g. left and right: the runtime would cancel it out). */
export function bindingConflicts(input: InputConfig | undefined): string[] {
  const bindings = resolveBindings(input);
  const owner = new Map<string, InputAction>(Object.entries(BUILT_IN_OWNER) as Array<[string, InputAction]>);
  const out: string[] = [];
  for (const action of INPUT_ACTIONS) {
    for (const k of bindings[action] || []) {
      const prev = owner.get(k);
      // up and jump are the same press in a platformer, so sharing a key between them is fine.
      const same = prev && ((prev === 'up' && action === 'jump') || (prev === 'jump' && action === 'up'));
      if (prev && prev !== action && !same) out.push(`"${k}" is bound to both ${prev} and ${action}`);
      else if (!prev) owner.set(k, action);
    }
  }
  return out;
}

/** Repair for `bindingConflicts`: a key stays with the first action that claims it (mutates `spec`). Returns true when something changed. */
export function dropBindingConflicts(spec: Pick<SceneSpec, 'input'>): boolean {
  if (!spec.input?.bindings) return false;
  const bindings = resolveBindings(spec.input);
  const owner = new Map<string, InputAction>(Object.entries(BUILT_IN_OWNER) as Array<[string, InputAction]>);
  const next: Partial<Record<InputAction, string[]>> = {};
  for (const action of INPUT_ACTIONS) {
    for (const k of bindings[action] || []) {
      const prev = owner.get(k);
      const same = prev && ((prev === 'up' && action === 'jump') || (prev === 'jump' && action === 'up'));
      if (prev && prev !== action && !same) continue;
      if (!prev) owner.set(k, action);
      (next[action] ??= []).push(k);
    }
  }
  const before = JSON.stringify(spec.input.bindings);
  if (Object.keys(next).length) spec.input.bindings = next;
  else delete spec.input.bindings;
  return JSON.stringify(spec.input.bindings) !== before;
}

/** The keys the runtime itself reads for each action (WASD, arrows, Space): a binding may not steal one for a different action. */
const BUILT_IN_OWNER: Record<string, InputAction> = {
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', ' ': 'jump',
};

/** Logic-graph key-press events of a remapped key: the canonical key of every action `key` is bound to (so an on-key-press "space" also fires for a jump bound to K). */
export function canonicalKeysFor(input: InputConfig | undefined, key: string): string[] {
  if (!input?.bindings) return [];
  const bindings = resolveBindings(input);
  const out: string[] = [];
  for (const action of INPUT_ACTIONS) if (bindings[action]?.includes(key) && CANONICAL_KEY[action] !== key && !out.includes(CANONICAL_KEY[action])) out.push(CANONICAL_KEY[action]);
  return out;
}
