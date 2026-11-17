/**
 * Shared locations (Phase 11D, P0 #5): scenes of a film that happen in the same place are dressed ONCE.
 *
 * Every scene is authored on its own, so a film that returns to the forest gets three different forests (other sky, other trees,
 * other light), and the film editor cannot tell the scenes belong together. The bible names the places (`bible.locations`, each beat
 * points at one); this module makes every later scene at a location reuse the world of the first one. Only the camera, the blocking
 * and the weather stay the scene's own. Pure: returns copies, never touches the input.
 */
import type { SceneSpec, StoryBible } from '../types/scene.schema';

/** World fields that make a place recognisable (weather and clouds are story beats, not geography, so they stay per scene). */
const PLACE_KEYS = ['skybox', 'sunPosition', 'terrain', 'scatterObjects', 'biome', 'features', 'hdri'] as const;
/** Environment fields that belong to the place (the ground and the haze); the lighting preset stays per scene. */
const PLACE_ENV_KEYS = ['groundColor', 'groundGrid', 'reflectivePedestal', 'fogNear', 'fogFar'] as const;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const isFilmScene = (s: SceneSpec) => s.mode === 'media' && s.engineType === '3d';

/** The location id of a scene, from the bible beat of its position in the storyboard. */
export function locationOf(scene: SceneSpec, bible: StoryBible | undefined): string | undefined {
  const index = scene.sequence?.index;
  return index === undefined ? undefined : bible?.beats?.[index]?.location;
}

/** Copy of `scene` with the place of `anchor` (world + ground / haze), keeping the scene's weather, clouds, lighting and camera. */
export function dressAs(anchor: SceneSpec, scene: SceneSpec): SceneSpec {
  const world = { ...scene.world } as Record<string, unknown>;
  for (const k of PLACE_KEYS) {
    const v = (anchor.world as unknown as Record<string, unknown>)[k];
    if (v === undefined) delete world[k];
    else world[k] = clone(v);
  }
  const environment = { ...scene.environment } as Record<string, unknown>;
  for (const k of PLACE_ENV_KEYS) {
    const v = (anchor.environment as unknown as Record<string, unknown>)?.[k];
    if (v !== undefined) environment[k] = v;
  }
  return { ...scene, world: world as unknown as SceneSpec['world'], environment: environment as unknown as SceneSpec['environment'] };
}

const samePlace = (a: SceneSpec, b: SceneSpec) =>
  PLACE_KEYS.every((k) => JSON.stringify((a.world as any)?.[k]) === JSON.stringify((b.world as any)?.[k])) &&
  PLACE_ENV_KEYS.every((k) => (a.environment as any)?.[k] === undefined || (a.environment as any)?.[k] === (b.environment as any)?.[k]);

/**
 * Dresses `scene` like the first earlier scene at the same location. No location, no earlier scene there, or the scene already
 * matches: the scene comes back unchanged (same object) and there is no note.
 */
export function shareLocationWorld(earlier: SceneSpec[], scene: SceneSpec, bible: StoryBible | undefined): { scene: SceneSpec; note?: string } {
  if (!bible?.locations?.length || !isFilmScene(scene)) return { scene };
  const id = locationOf(scene, bible);
  if (!id) return { scene };
  const anchor = earlier.find((s) => isFilmScene(s) && locationOf(s, bible) === id);
  if (!anchor || samePlace(anchor, scene)) return { scene };
  const name = bible.locations.find((l) => l.id === id)?.name || id;
  return { scene: dressAs(anchor, scene), note: `scene ${(scene.sequence?.index ?? 0) + 1} reuses the set of scene ${(anchor.sequence?.index ?? 0) + 1} (${name})` };
}

/** `shareLocationWorld` down a finished film, in order (the bible rides on every scene's `sequence`). */
export function shareLocationWorlds(scenes: SceneSpec[]): { scenes: SceneSpec[]; notes: string[] } {
  const bible = scenes.find((s) => s.sequence?.bible)?.sequence?.bible;
  const notes: string[] = [];
  const out: SceneSpec[] = [];
  for (const scene of scenes) {
    const r = shareLocationWorld(out, scene, bible);
    if (r.note) notes.push(r.note);
    out.push(r.scene);
  }
  return { scenes: out, notes };
}
