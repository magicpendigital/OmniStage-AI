import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Small shared primitives for the docking shell (segmented control, dropdown menu, drag + size hooks). */

export function useClickAway(ref: React.RefObject<HTMLElement | null>, onAway: () => void, enabled = true) {
  const cb = useRef(onAway);
  cb.current = onAway;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [enabled, ref]);
}

export function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Pointer-drag helper: returns an onPointerDown handler that reports the cumulative delta
 * from the press point until release. Uses pointer capture so the drag survives leaving the handle.
 */
export function startDrag(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void
) {
  if (e.button !== 0) return;
  e.preventDefault();
  const target = e.currentTarget as HTMLElement;
  const sx = e.clientX;
  const sy = e.clientY;
  const pointerId = e.pointerId;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // capture is best-effort
  }
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // already released
    }
    onEnd?.();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

export interface SegOption<T extends string> {
  value: T;
  label?: string;
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  /** Tailwind classes for the label, e.g. to hide it below a breakpoint. */
  labelClass?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  small,
  className = '',
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegOption<T>[];
  small?: boolean;
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`seg ${small ? 'seg-sm' : ''} ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          title={o.title || o.label}
          onClick={() => onChange(o.value)}
          className={`seg-b ${value === o.value ? 'on' : ''} ${o.className || ''}`}
        >
          {o.icon}
          {o.label && <span className={o.labelClass || ''}>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Dropdown({
  trigger,
  children,
  align = 'left',
  up = false,
  panelClass = '',
  className = '',
}: {
  trigger: (ctx: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((ctx: { close: () => void }) => React.ReactNode);
  align?: 'left' | 'right';
  up?: boolean;
  panelClass?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickAway(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div ref={ref} className={`relative ${className}`}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`menu ${align === 'right' ? 'right-0' : 'left-0'} ${up ? 'menu-up' : ''} ${panelClass}`}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="kbd">{children}</kbd>
);

export const IconBtn: React.FC<{
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, onClick, active, danger, disabled, small, className = '', children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active === undefined ? undefined : active}
    disabled={disabled}
    onClick={onClick}
    className={`ibtn ${small ? 'sm' : ''} ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''} ${className}`}
  >
    {children}
  </button>
);
