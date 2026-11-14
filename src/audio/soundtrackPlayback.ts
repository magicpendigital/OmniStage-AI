/**
 * Phase 10B — plays the active scene's procedural soundtrack in sync with the timeline (studio Preview / timeline
 * playback and the OmniStage Player). The track is rendered once per scene (src/audio/soundtrack.ts, cached by key)
 * and started at `currentTime`; pause, seek and scene switches restart or stop it. No AudioContext lives in renderers.
 */
import type { SceneSpec } from '../types/scene.schema';
import { renderSceneSoundtrack, soundtrackKey } from './soundtrack';

interface PlaybackState {
  sceneSpec: SceneSpec;
  isPlaying: boolean;
  currentTime: number;
}

interface Store<S> {
  getState: () => S;
  subscribe: (listener: (state: S, prev: S) => void) => () => void;
}

const LIVE_SAMPLE_RATE = 32000;
/** Restart when the timeline and the audio drift further apart than this (seconds), e.g. after a seek. */
const MAX_DRIFT = 0.3;

export function installSoundtrackPlayback<S extends PlaybackState>(store: Store<S>, isMuted: () => boolean): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return () => undefined;
  let ctx: AudioContext | null = null;
  const cache = new Map<string, AudioBuffer>();
  let playing: { key: string; source: AudioBufferSourceNode; startedAt: number; offset: number; wall: number } | null = null;

  const ensureCtx = () => {
    if (!ctx) ctx = new Ctor() as AudioContext;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };
  const unlock = () => {
    ensureCtx();
    sync(store.getState());
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const stop = () => {
    if (!playing) return;
    try {
      playing.source.stop();
    } catch {
      /* already stopped */
    }
    playing.source.disconnect();
    playing = null;
  };

  const bufferFor = (spec: SceneSpec, key: string) => {
    let buf = cache.get(key);
    if (!buf) {
      const pcm = renderSceneSoundtrack(spec, LIVE_SAMPLE_RATE);
      if (!pcm) return null;
      buf = ctx!.createBuffer(2, pcm.left.length, pcm.sampleRate);
      buf.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
      if (cache.size > 6) cache.clear();
      cache.set(key, buf);
    }
    return buf;
  };

  const sync = (s: PlaybackState) => {
    const key = s.isPlaying && !isMuted() ? soundtrackKey(s.sceneSpec) : '';
    if (!key) return stop();
    if (!ctx || ctx.state !== 'running') return; // waits for a user gesture (unlock)
    const duration = Math.max(0.1, s.sceneSpec.durationSeconds || 8);
    if (s.currentTime >= duration - 0.05) return stop();
    if (playing && playing.key === key) {
      // The audio clock only starts moving once the output device is open: don't chase it while it warms up.
      if (ctx.currentTime - playing.startedAt < 0.001 && performance.now() - playing.wall < 1000) return;
      const heard = playing.offset + (ctx.currentTime - playing.startedAt);
      if (Math.abs(heard - s.currentTime) < MAX_DRIFT) return;
    }
    stop();
    const buf = bufferFor(s.sceneSpec, key);
    if (!buf) return;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(ctx.destination);
    const offset = Math.max(0, Math.min(s.currentTime, buf.duration - 0.01));
    source.start(0, offset);
    playing = { key, source, startedAt: ctx.currentTime, offset, wall: performance.now() };
  };

  const unsubscribe = store.subscribe((state) => sync(state));
  return () => {
    unsubscribe();
    stop();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    void ctx?.close().catch(() => undefined);
  };
}
