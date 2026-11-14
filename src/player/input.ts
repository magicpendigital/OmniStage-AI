/**
 * Phase 7 — Unified input for the OmniStage Player: keyboard, on-screen touch controls and gamepads all feed one
 * set of logical keys ('arrowleft', 'w', ' ', …) — the same key names the shared 2D/3D runtime reads.
 */

export interface InputOptions {
  onKeyPress?: (key: string, code: string) => void;
  /** Called on the first user gesture (unlock audio). */
  onFirstGesture?: () => void;
}

export class InputManager {
  readonly keys = new Set<string>();
  private keyboard = new Set<string>();
  private touch = new Set<string>();
  private pad = new Set<string>();
  private disposers: Array<() => void> = [];
  private gestured = false;

  constructor(private opts: InputOptions = {}) {
    const down = (e: KeyboardEvent) => {
      this.gesture();
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      this.keyboard.add(k);
      if (!e.repeat) this.opts.onKeyPress?.(k, e.code);
      this.sync();
    };
    const up = (e: KeyboardEvent) => {
      this.keyboard.delete(e.key.toLowerCase());
      this.sync();
    };
    const blur = () => {
      this.keyboard.clear();
      this.touch.clear();
      this.sync();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    const pointer = () => this.gesture();
    window.addEventListener('pointerdown', pointer);
    this.disposers.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', pointer);
    });
  }

  private gesture() {
    if (this.gestured) return;
    this.gestured = true;
    this.opts.onFirstGesture?.();
  }

  private sync() {
    this.keys.clear();
    for (const set of [this.keyboard, this.touch, this.pad]) for (const k of set) this.keys.add(k);
  }

  /** Bind an on-screen button to a logical key (press-and-hold). */
  bindTouchButton(el: HTMLElement, key: string) {
    const press = (e: PointerEvent) => {
      e.preventDefault();
      this.gesture();
      el.setPointerCapture?.(e.pointerId);
      if (!this.touch.has(key)) this.opts.onKeyPress?.(key, key);
      this.touch.add(key);
      el.classList.add('is-pressed');
      this.sync();
    };
    const release = () => {
      this.touch.delete(key);
      el.classList.remove('is-pressed');
      this.sync();
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', press);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('pointerleave', release);
    });
  }

  /** Programmatic key (tests, accessibility switches); merged like touch input. */
  setVirtualKey(key: string, down: boolean) {
    if (down && !this.touch.has(key)) this.opts.onKeyPress?.(key, key);
    if (down) this.touch.add(key);
    else this.touch.delete(key);
    this.sync();
  }

  /** Poll gamepads once per frame (left stick / d-pad → arrows, A → jump/space, B → action 'e'). */
  pollGamepads() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const next = new Set<string>();
    for (const pad of pads || []) {
      if (!pad) continue;
      const [ax = 0, ay = 0] = pad.axes;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      if (ax < -0.4 || b(14)) next.add('arrowleft');
      if (ax > 0.4 || b(15)) next.add('arrowright');
      if (ay < -0.4 || b(12)) next.add('arrowup');
      if (ay > 0.4 || b(13)) next.add('arrowdown');
      if (b(0)) next.add(' ');
      if (b(1)) next.add('e');
    }
    for (const k of next) if (!this.pad.has(k)) this.opts.onKeyPress?.(k, k);
    this.pad = next;
    this.sync();
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (('ontouchstart' in window) || (window.matchMedia?.('(pointer: coarse)').matches ?? false));
}
