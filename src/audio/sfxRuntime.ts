/**
 * Phase 4 — Procedural SFX runtime (sfxr-style WebAudio synthesis, zero assets, zero dependencies).
 * IMPORTANT: `createOmniSfxPlayer` must stay self-contained (no imports, no outer references) — tests rebuild it from
 * `toString()`. Its recipe table mirrors ./sfxRecipes (used by the offline soundtrack renderer); tests/soundtrack.test.ts
 * checks they match.
 */
export interface OmniSfxPlayer {
  /** Plays a preset. Volume 0..1. Silently no-ops when WebAudio is unavailable. */
  play: (presetId: string, volume?: number) => void;
  /** Creates / resumes the AudioContext; call from a user gesture. */
  unlock: () => void;
  presets: string[];
  /** Recipe table (tests check it matches BUILTIN_SFX_RECIPES). */
  recipes: Record<string, any>;
}

export function createOmniSfxPlayer(extraPresets?: Record<string, any>): OmniSfxPlayer {
  var RECIPES: Record<string, any> = {
    coin: { wave: 'square', notes: [988, 1319], step: 0.07, dur: 0.26, vol: 0.2 },
    jump: { wave: 'square', f0: 220, f1: 560, dur: 0.18, vol: 0.18 },
    hit: { wave: 'noise', dur: 0.22, vol: 0.45, lp0: 2200, lp1: 300, layer: { wave: 'sawtooth', f0: 220, f1: 55 } },
    powerup: { wave: 'triangle', notes: [523, 659, 784, 1047, 1319], step: 0.06, dur: 0.38, vol: 0.28 },
    explosion: { wave: 'noise', dur: 0.7, vol: 0.6, lp0: 1400, lp1: 120 },
    laser: { wave: 'sawtooth', f0: 1500, f1: 110, dur: 0.22, vol: 0.14 },
    win: { wave: 'square', notes: [523, 659, 784, 1047], step: 0.11, dur: 0.62, vol: 0.16 },
    lose: { wave: 'triangle', notes: [392, 330, 262, 196], step: 0.16, dur: 0.8, vol: 0.3 },
    click: { wave: 'sine', f0: 1250, f1: 880, dur: 0.06, vol: 0.25 },
    whoosh: { wave: 'noise', dur: 0.45, vol: 0.35, lp0: 300, lp1: 3200, attack: 0.18 },
    chime: { wave: 'sine', notes: [1568, 2093, 2637, 3136], step: 0.09, dur: 1.1, vol: 0.2 },
    splash: { wave: 'noise', dur: 0.7, vol: 0.42, lp0: 5200, lp1: 380, attack: 0.012 },
    footstep: { wave: 'noise', dur: 0.1, vol: 0.32, lp0: 900, lp1: 180, layer: { wave: 'sine', f0: 110, f1: 60 } },
    pop: { wave: 'sine', f0: 380, f1: 980, dur: 0.09, vol: 0.32 },
  };
  // Phase 6: presets contributed by extensions (copied into SceneSpec.sfxLibrary).
  if (extraPresets) for (var key in extraPresets) if (!RECIPES[key]) RECIPES[key] = extraPresets[key];
  var ctx: any = null;
  var noiseBuffer: any = null;

  function ensureContext(): any {
    if (typeof window === 'undefined') return null;
    var Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  function getNoise(ac: any): any {
    if (noiseBuffer) return noiseBuffer;
    var length = Math.floor(ac.sampleRate * 1.0);
    noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    // Deterministic LCG noise so every export sounds identical.
    var seed = 1337;
    for (var i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return noiseBuffer;
  }

  function voice(ac: any, r: any, out: any, t: number, vol: number) {
    var dur = r.dur;
    var gain = ac.createGain();
    var attack = r.attack || 0.004;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var src: any;
    if (r.wave === 'noise') {
      src = ac.createBufferSource();
      src.buffer = getNoise(ac);
      src.loop = true;
    } else {
      src = ac.createOscillator();
      src.type = r.wave;
      if (r.notes && r.notes.length) {
        for (var n = 0; n < r.notes.length; n++) src.frequency.setValueAtTime(r.notes[n], t + n * (r.step || 0.08));
      } else {
        src.frequency.setValueAtTime(r.f0 || 440, t);
        src.frequency.exponentialRampToValueAtTime(Math.max(20, r.f1 || r.f0 || 440), t + dur);
      }
    }
    var node: any = src;
    if (r.lp0) {
      var filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(r.lp0, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, r.lp1 || r.lp0), t + dur);
      node.connect(filter);
      node = filter;
    }
    node.connect(gain);
    gain.connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function play(presetId: string, volume?: number) {
    var r = RECIPES[presetId];
    if (!r) return;
    var ac = ensureContext();
    if (!ac) return;
    try {
      var v = Math.max(0, Math.min(1, volume === undefined ? 0.7 : volume));
      if (v <= 0) return;
      var t = ac.currentTime + 0.005;
      voice(ac, r, ac.destination, t, r.vol * v);
      if (r.layer) {
        var layer: any = {};
        for (var k in r.layer) layer[k] = r.layer[k];
        layer.dur = r.dur;
        voice(ac, layer, ac.destination, t, r.vol * v * 0.6);
      }
    } catch (e) {
      // Audio must never break gameplay.
    }
  }

  return { play: play, unlock: function () { ensureContext(); }, presets: Object.keys(RECIPES), recipes: RECIPES };
}
