/**
 * Phase 8 — Native bridge for app builds (PWA, Android / iOS through Capacitor).
 *
 * Uses the Capacitor plugins the exported project installs (Haptics, Preferences, App) when the Player runs inside the
 * native shell, and plain web APIs otherwise (navigator.vibrate, localStorage, visibilitychange). Nothing here is
 * required: every call is guarded, so a missing plugin or a blocked storage just does nothing.
 */

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'error';

export interface NativeBridge {
  /** true inside the Capacitor shell (Android / iOS app). */
  isNative: boolean;
  haptic: (kind: HapticKind) => void;
  load: (key: string) => Promise<string | null>;
  save: (key: string, value: string) => void;
  /** Calls `pause` when the app goes to the background and `resume` when it returns. Returns an unsubscribe. */
  onLifecycle: (pause: () => void, resume: () => void) => () => void;
}

const VIBRATE_MS: Record<HapticKind, number | number[]> = { light: 10, medium: 20, heavy: 35, success: [15, 40, 25], error: [40, 30, 40] };

function plugins(win: any): Record<string, any> {
  const cap = win.Capacitor;
  if (!cap || (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform())) return {};
  return cap.Plugins || {};
}

export function createNativeBridge(win: any = window): NativeBridge {
  const p = plugins(win);
  const isNative = !!win.Capacitor && typeof win.Capacitor.isNativePlatform === 'function' && win.Capacitor.isNativePlatform();
  const quiet = (fn: () => unknown) => {
    try {
      const r = fn() as any;
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      /* optional capability */
    }
  };

  const haptic = (kind: HapticKind) => {
    if (p.Haptics) {
      quiet(() =>
        kind === 'success' || kind === 'error'
          ? p.Haptics.notification({ type: kind === 'success' ? 'SUCCESS' : 'ERROR' })
          : p.Haptics.impact({ style: kind.toUpperCase() })
      );
      return;
    }
    quiet(() => win.navigator?.vibrate?.(VIBRATE_MS[kind]));
  };

  const load = async (key: string): Promise<string | null> => {
    if (p.Preferences) {
      try {
        const r = await p.Preferences.get({ key });
        return typeof r?.value === 'string' ? r.value : null;
      } catch {
        return null;
      }
    }
    try {
      return win.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  const save = (key: string, value: string) => {
    if (p.Preferences) {
      quiet(() => p.Preferences.set({ key, value }));
      return;
    }
    quiet(() => win.localStorage?.setItem(key, value));
  };

  const onLifecycle = (pause: () => void, resume: () => void) => {
    const doc = win.document;
    const onVisibility = () => (doc.hidden ? pause() : resume());
    doc?.addEventListener?.('visibilitychange', onVisibility);
    const handles: any[] = [];
    if (p.App?.addListener) {
      quiet(() => Promise.resolve(p.App.addListener('pause', pause)).then((h: any) => handles.push(h)));
      quiet(() => Promise.resolve(p.App.addListener('resume', resume)).then((h: any) => handles.push(h)));
    }
    return () => {
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      for (const h of handles) quiet(() => h?.remove?.());
    };
  };

  return { isNative, haptic, load, save, onLifecycle };
}
