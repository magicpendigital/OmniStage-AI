/**
 * Phase 4 — Game audio bus. Maps gameplay events to procedural SFX cues declared in `SceneSpec.audio`.
 * Store-driven: subscribes to score / win / end transitions so both the 3D and 2D engines get sound
 * without the renderers knowing about audio (only the 2D jump calls playSceneSfx directly).
 */
import type { GameAudioEvent, SceneAudioSpec, SceneSpec, SfxPresetId } from '../types/scene.schema';
import { createOmniSfxPlayer } from './sfxRuntime';

export const SFX_PRESET_IDS: SfxPresetId[] = [
  'coin',
  'jump',
  'hit',
  'powerup',
  'explosion',
  'laser',
  'win',
  'lose',
  'click',
  'whoosh',
];

export const GAME_AUDIO_EVENTS: GameAudioEvent[] = ['collect', 'jump', 'hit', 'win', 'lose', 'click', 'scene-start'];

export const DEFAULT_AUDIO_CUES: Record<GameAudioEvent, SfxPresetId | 'none'> = {
  collect: 'coin',
  jump: 'jump',
  hit: 'hit',
  win: 'win',
  lose: 'lose',
  click: 'click',
  'scene-start': 'none',
};

export function createDefaultAudioSpec(enabled = true): SceneAudioSpec {
  return { enabled, masterVolume: 0.6, cues: { ...DEFAULT_AUDIO_CUES } };
}

/** Effective audio spec: explicit `spec.audio`, else defaults (enabled for game mode, muted for media). */
export function resolveAudioSpec(spec: Pick<SceneSpec, 'audio' | 'mode'>): SceneAudioSpec {
  if (spec.audio) {
    return {
      enabled: spec.audio.enabled !== false,
      masterVolume: Math.max(0, Math.min(1, Number(spec.audio.masterVolume ?? 0.6))),
      cues: { ...DEFAULT_AUDIO_CUES, ...(spec.audio.cues || {}) },
    };
  }
  return createDefaultAudioSpec(spec.mode === 'game');
}

export function cueFor(spec: Pick<SceneSpec, 'audio' | 'mode'>, event: GameAudioEvent): string | null {
  const audio = resolveAudioSpec(spec);
  if (!audio.enabled) return null;
  const cue = audio.cues[event];
  return cue && cue !== 'none' ? cue : null;
}

const players = new Map<string, ReturnType<typeof createOmniSfxPlayer>>();
/** One player per SFX library (built-ins + a scene's extension presets). AudioContexts are shared per player. */
function getPlayer(library?: Record<string, unknown>) {
  const key = library && Object.keys(library).length ? JSON.stringify(library) : '';
  let p = players.get(key);
  if (!p) {
    p = createOmniSfxPlayer(key ? (library as Record<string, any>) : undefined);
    if (players.size > 8) players.clear();
    players.set(key, p);
  }
  return p;
}

export function previewSfx(presetId: string, volume = 0.6, library?: Record<string, unknown>) {
  const p = getPlayer(library);
  p.unlock();
  p.play(presetId, volume);
}

export function playSceneSfx(spec: Pick<SceneSpec, 'audio' | 'mode' | 'sfxLibrary'>, event: GameAudioEvent) {
  const cue = cueFor(spec, event);
  if (!cue) return;
  getPlayer(spec.sfxLibrary).play(cue, resolveAudioSpec(spec).masterVolume);
}

/** Built-in preset ids plus the scene's extension presets. */
export function availableSfxPresets(spec?: Pick<SceneSpec, 'sfxLibrary'>): string[] {
  return [...SFX_PRESET_IDS, ...Object.keys(spec?.sfxLibrary || {}).filter((k) => !(SFX_PRESET_IDS as string[]).includes(k))];
}

interface AudioRelevantState {
  sceneSpec: SceneSpec;
  gameScore: number;
  gameWon: boolean;
  gameEnded: boolean;
  gameTimeRemaining: number;
  isPlaying: boolean;
  currentTime: number;
}

/** Pure transition → events mapping (unit tested). */
export function detectAudioEvents(prev: AudioRelevantState, next: AudioRelevantState): GameAudioEvent[] {
  const events: GameAudioEvent[] = [];
  const sameScene = prev.sceneSpec.id === next.sceneSpec.id;
  if (!prev.isPlaying && next.isPlaying && next.currentTime < 0.05) events.push('scene-start');
  if (!sameScene || next.sceneSpec.mode !== 'game') return events;
  const isReset = next.gameTimeRemaining > prev.gameTimeRemaining + 0.5;
  if (next.gameScore > prev.gameScore) events.push('collect');
  else if (next.gameScore < prev.gameScore && !isReset && !next.gameEnded) events.push('hit');
  if (!prev.gameWon && next.gameWon) events.push('win');
  else if (!prev.gameEnded && next.gameEnded && !next.gameWon) events.push('lose');
  return events;
}

interface SubscribableStore<S> {
  getState: () => S;
  subscribe: (listener: (state: S, prev: S) => void) => () => void;
}

/** Wires the store to the SFX player. Returns an unsubscribe function. */
export function installAudioBus<S extends AudioRelevantState>(store: SubscribableStore<S>): () => void {
  const unlock = () => getPlayer().unlock();
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }
  const unsubscribe = store.subscribe((state, prev) => {
    for (const event of detectAudioEvents(prev, state)) playSceneSfx(state.sceneSpec, event);
  });
  return () => {
    unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
}
