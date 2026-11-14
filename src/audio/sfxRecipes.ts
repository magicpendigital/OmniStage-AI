/**
 * Phase 4 / 10B — built-in procedural SFX recipes (sfxr-style). One table shared by the live WebAudio player
 * (src/audio/sfxRuntime.ts) and the offline soundtrack renderer (src/audio/soundtrack.ts), so a cue sounds the same
 * in Preview, in the Player and in the MP4 export.
 *
 * wave: oscillator type or 'noise'; f0 → f1 frequency sweep; notes = arpeggio (Hz) stepped every `step` s;
 * lp0 → lp1 = low-pass cutoff sweep (Hz); layer = a second voice mixed at 60 %. All times in seconds.
 */
export interface SfxRecipeDef {
  wave: 'square' | 'sine' | 'triangle' | 'sawtooth' | 'noise';
  dur: number;
  vol: number;
  f0?: number;
  f1?: number;
  notes?: number[];
  step?: number;
  lp0?: number;
  lp1?: number;
  attack?: number;
  layer?: Partial<SfxRecipeDef>;
}

export const BUILTIN_SFX_RECIPES: Record<string, SfxRecipeDef> = {
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
  // Phase 10B foley
  chime: { wave: 'sine', notes: [1568, 2093, 2637, 3136], step: 0.09, dur: 1.1, vol: 0.2 },
  splash: { wave: 'noise', dur: 0.7, vol: 0.42, lp0: 5200, lp1: 380, attack: 0.012 },
  footstep: { wave: 'noise', dur: 0.1, vol: 0.32, lp0: 900, lp1: 180, layer: { wave: 'sine', f0: 110, f1: 60 } },
  pop: { wave: 'sine', f0: 380, f1: 980, dur: 0.09, vol: 0.32 },
};
