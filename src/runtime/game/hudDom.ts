/**
 * Phase 3 — declarative HUD drawn with plain DOM + inline styles, so the studio viewport and the OmniStage Player
 * render the exact same elements without sharing a stylesheet. Fed by `resolveHud` (./state.ts).
 */
import type { HudAnchor } from '../../types/scene.schema';
import type { HudItem } from './state';
import { HUD_ANCHORS } from './state';

const ANCHOR_CSS: Record<HudAnchor, string> = {
  'top-left': 'top:0;left:0;align-items:flex-start',
  'top-center': 'top:0;left:50%;transform:translateX(-50%);align-items:center',
  'top-right': 'top:0;right:0;align-items:flex-end',
  'bottom-left': 'bottom:0;left:0;align-items:flex-start',
  'bottom-center': 'bottom:0;left:50%;transform:translateX(-50%);align-items:center',
  'bottom-right': 'bottom:0;right:0;align-items:flex-end',
};

export class GameHudView {
  readonly root: HTMLElement;
  private groups = new Map<HudAnchor, HTMLElement>();
  private key = '';
  private rows = new Map<string, { row: HTMLElement; label: HTMLElement; text: HTMLElement; fill: HTMLElement | null }>();

  constructor(parent: HTMLElement, opts: { top?: number } = {}) {
    this.root = document.createElement('div');
    this.root.setAttribute('data-omni-hud', '');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#f8fafc';
    for (const anchor of HUD_ANCHORS) {
      const g = document.createElement('div');
      // Top groups clear the studio / Player status pills.
      const clear = anchor.startsWith('top') ? opts.top ?? 0 : 0;
      g.style.cssText = `position:absolute;display:flex;flex-direction:column;gap:4px;padding:${10 + clear}px 10px 10px;${ANCHOR_CSS[anchor]}`;
      g.setAttribute('data-hud-anchor', anchor);
      this.groups.set(anchor, g);
      this.root.appendChild(g);
    }
    parent.appendChild(this.root);
  }

  /** Cheap per frame: the elements are rebuilt only when the set changes, otherwise just their text and bar fill. */
  update(items: HudItem[]) {
    const key = items.map((i) => `${i.id}:${i.kind}:${i.anchor}:${i.color}`).join('|');
    if (key !== this.key) {
      this.key = key;
      this.rows.clear();
      for (const g of this.groups.values()) g.replaceChildren();
      for (const item of items) this.build(item);
    }
    for (const item of items) {
      const r = this.rows.get(item.id);
      if (!r) continue;
      r.label.textContent = item.label;
      r.text.textContent = item.text;
      if (r.fill) r.fill.style.width = `${Math.round(item.fraction * 1000) / 10}%`;
    }
  }

  private build(item: HudItem) {
    const row = document.createElement('div');
    row.setAttribute('data-hud-id', item.id);
    row.style.cssText = 'background:rgba(2,6,23,.78);border:1px solid rgba(148,163,184,.35);border-radius:10px;padding:4px 10px;font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:8px;min-width:0';
    const label = document.createElement('span');
    label.style.cssText = `color:${item.color};font-size:11px;letter-spacing:.04em;text-transform:uppercase`;
    const text = document.createElement('span');
    let fill: HTMLElement | null = null;
    if (item.kind === 'bar') {
      const track = document.createElement('div');
      track.style.cssText = 'width:96px;height:8px;border-radius:4px;background:rgba(148,163,184,.25);overflow:hidden';
      fill = document.createElement('div');
      fill.style.cssText = `height:100%;width:0;background:${item.color};transition:width .12s linear`;
      track.appendChild(fill);
      row.append(label, track, text);
    } else if (item.kind === 'text') {
      row.append(text);
      label.style.display = 'none';
    } else {
      row.append(label, text);
    }
    this.groups.get(item.anchor)?.appendChild(row);
    this.rows.set(item.id, { row, label, text, fill });
  }

  dispose() {
    this.root.remove();
    this.rows.clear();
    this.groups.clear();
  }
}
