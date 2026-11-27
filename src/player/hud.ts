/**
 * Phase 7 — Player HUD (plain DOM): score / timer / level, sound + fullscreen, 3D captions, marketing CTA,
 * end cards (next level / retry / replay) and on-screen touch controls. Safe-area aware for phones.
 */
import { sceneCaptions } from '../audio/voices';
import { activeCaptions } from '../media/captions';
import { isSfxMuted, setSfxMuted } from '../audio/audioBus';
import type { PlayerState } from './playerStore';
import type { InputManager } from './input';
import { joystickKeys, touchButtons, touchLayoutFor, touchStyleFor, TouchLayout, TouchStyle } from '../runtime/touchLayout';
import { GameHudView } from '../runtime/game/hudDom';
import { resolveHud } from '../runtime/game/state';
import { activeMessage } from '../runtime/game/messages';

export const PLAYER_CSS = `
.omni-root{position:fixed;inset:0;background:#05070d;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#f8fafc;touch-action:none;user-select:none;-webkit-user-select:none}
.omni-frame{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);overflow:hidden;background:#0b101b}
.omni-stage{position:absolute;inset:0;width:100%;height:100%;display:block}
.omni-stage-2d{object-fit:contain}
.omni-hud{position:absolute;inset:0;pointer-events:none;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))}
.omni-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.omni-pill{background:rgba(2,6,23,.78);border:1px solid rgba(148,163,184,.35);border-radius:999px;padding:6px 12px;font-weight:700;font-size:13px;font-variant-numeric:tabular-nums}
.omni-btn{pointer-events:auto;background:rgba(2,6,23,.78);border:1px solid rgba(148,163,184,.4);color:#f8fafc;border-radius:10px;min-width:38px;height:38px;font-size:16px;cursor:pointer}
.omni-captions{position:absolute;left:0;right:0;bottom:12%;display:flex;flex-direction:column;align-items:center;gap:4px;padding:0 24px}
.omni-captions span{background:rgba(2,6,23,.78);padding:6px 12px;border-radius:8px;font-weight:600;font-size:clamp(13px,2.4vw,20px);text-align:center}
.omni-cta{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);pointer-events:auto;border:0;border-radius:999px;padding:12px 26px;font-weight:800;font-size:16px;color:#020617;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45)}
.omni-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.72);pointer-events:auto}
.omni-card>div{background:#0b1220;border:1px solid rgba(34,211,238,.4);border-radius:18px;padding:22px 26px;text-align:center;min-width:240px;max-width:86vw}
.omni-card h2{margin:0 0 6px;font-size:24px}.omni-card p{margin:0 0 14px;color:#94a3b8}
.omni-card button{margin:4px;border:0;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer}
.omni-primary{background:#22d3ee;color:#020617}.omni-secondary{background:#1e293b;color:#e2e8f0}
.omni-touch{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;align-items:flex-end;padding:0 max(16px,env(safe-area-inset-left)) max(18px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-right));pointer-events:none}
.omni-pad{display:grid;grid-template-columns:repeat(3,58px);grid-template-rows:repeat(2,58px);gap:6px}
.omni-key{pointer-events:auto;touch-action:none;border-radius:16px;background:rgba(15,23,42,.72);border:2px solid rgba(34,211,238,.55);color:#a5f3fc;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center}
.omni-key.is-pressed{background:rgba(34,211,238,.35);transform:scale(.94)}
.omni-jump{width:76px;height:76px;border-radius:38px;background:rgba(245,158,11,.85);border-color:#f59e0b;color:#020617;font-size:14px}
.omni-stick{position:relative;width:132px;height:132px;border-radius:66px;background:rgba(15,23,42,.55);border:2px solid rgba(34,211,238,.45);pointer-events:auto;touch-action:none}
.omni-knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:28px;background:rgba(34,211,238,.55);border:2px solid #22d3ee;pointer-events:none}
.omni-msg{position:absolute;left:50%;bottom:24%;transform:translateX(-50%);max-width:min(86%,560px);background:rgba(2,6,23,.88);border:1px solid rgba(34,211,238,.5);border-radius:12px;padding:10px 16px;font-size:clamp(13px,2.6vw,18px);line-height:1.35;text-align:left;pointer-events:none}
.omni-msg b{display:block;color:#67e8f9;font-size:.85em;margin-bottom:2px}
.omni-notice{position:absolute;left:50%;top:18%;transform:translateX(-50%);background:rgba(2,6,23,.9);border:1px solid #22d3ee;border-radius:10px;padding:8px 14px;font-size:13px;opacity:0;transition:opacity .25s}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface HudCallbacks {
  onNext: () => void;
  onRetry: () => void;
  onReplay: () => void;
  onCta: () => void;
  /** Phase 7D: pause menu — the ⏸ button / Escape, Resume and Restart. */
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
}

export class Hud {
  readonly root = el('div', 'omni-hud');
  private level = el('div', 'omni-pill');
  private score = el('div', 'omni-pill');
  private captions = el('div', 'omni-captions');
  private cta = el('button', 'omni-cta');
  private card = el('div', 'omni-card');
  private notice = el('div', 'omni-notice');
  private message = el('div', 'omni-msg');
  private pauseBtn = el('button', 'omni-btn', '⏸');
  private pauseCard = el('div', 'omni-card');
  private touch = el('div', 'omni-touch');
  private touchLayout = '';
  private gameHud: GameHudView;
  private cardKey = '';
  private startedAt = performance.now();

  constructor(parent: HTMLElement, private input: InputManager, private cb: HudCallbacks, private opts: { touch: boolean; fullscreenTarget: HTMLElement }) {
    const top = el('div', 'omni-row');
    const left = el('div', 'omni-row');
    left.append(this.level, this.score);
    const right = el('div', 'omni-row');
    const sound = el('button', 'omni-btn', isSfxMuted() ? '🔇' : '🔊');
    sound.setAttribute('aria-label', 'Toggle sound');
    sound.onclick = () => {
      setSfxMuted(!isSfxMuted());
      sound.textContent = isSfxMuted() ? '🔇' : '🔊';
    };
    const fs = el('button', 'omni-btn', '⛶');
    fs.setAttribute('aria-label', 'Full screen');
    fs.onclick = () => (document.fullscreenElement ? document.exitFullscreen?.() : opts.fullscreenTarget.requestFullscreen?.());
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.onclick = () => cb.onPause();
    this.pauseBtn.style.display = 'none';
    right.append(this.pauseBtn, sound, fs);
    top.append(left, right);
    this.cta.style.display = 'none';
    this.cta.onclick = () => cb.onCta();
    this.card.style.display = 'none';
    this.message.style.display = 'none';
    this.pauseCard.style.display = 'none';
    this.root.append(top, this.captions, this.message, this.touch, this.cta, this.card, this.pauseCard, this.notice);
    parent.appendChild(this.root);
    // Phase 3: the scene's declarative HUD (health bars, counters), below the score / sound row.
    this.gameHud = new GameHudView(this.root, { top: 40 });
  }

  showNotice(text: string) {
    this.notice.textContent = text;
    this.notice.style.opacity = '1';
    window.setTimeout(() => (this.notice.style.opacity = '0'), 2200);
  }

  private buildTouch(layout: string, style: TouchStyle = 'buttons') {
    this.touchLayout = `${layout}:${style}`;
    this.touch.replaceChildren();
    this.input.setStick([]);
    if (layout === 'none') return;
    if (style === 'joystick') {
      const buttons = touchButtons(layout as TouchLayout);
      const action = el('div', 'omni-key omni-jump', buttons.action![0]);
      this.input.bindTouchButton(action, buttons.action![1]);
      this.touch.append(this.buildStick(layout as TouchLayout), action);
      return;
    }
    const pad = el('div', 'omni-pad');
    const cell = (label: string, key: string, col: number, row: number) => {
      const b = el('div', 'omni-key', label);
      b.style.gridColumn = String(col);
      b.style.gridRow = String(row);
      this.input.bindTouchButton(b, key);
      pad.appendChild(b);
    };
    const buttons = touchButtons(layout as TouchLayout);
    for (const [label, key, col, row] of buttons.pad) cell(label, key, col, row);
    const action = el('div', 'omni-key omni-jump', buttons.action![0]);
    this.input.bindTouchButton(action, buttons.action![1]);
    this.touch.append(pad, action);
  }

  private setPauseCard(show: boolean) {
    if (!show) {
      this.pauseCard.style.display = 'none';
      this.pauseCard.replaceChildren();
      return;
    }
    if (this.pauseCard.style.display !== 'none') return;
    const box = el('div');
    box.append(el('h2', '', 'Paused'));
    const add = (label: string, cls: string, fn: () => void) => {
      const b = el('button', cls, label);
      b.onclick = fn;
      box.appendChild(b);
    };
    add('Resume ▶', 'omni-primary', this.cb.onResume);
    add('Restart ↻', 'omni-secondary', this.cb.onRestart);
    this.pauseCard.replaceChildren(box);
    this.pauseCard.style.display = 'flex';
  }

  /** A thumb stick: drag the knob; the offset becomes the logical arrow keys (see joystickKeys). */
  private buildStick(layout: TouchLayout) {
    const base = el('div', 'omni-stick');
    const knob = el('div', 'omni-knob');
    base.appendChild(knob);
    const radius = 52;
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      const r = base.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / radius;
      let dy = (e.clientY - (r.top + r.height / 2)) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      knob.style.transform = `translate(${dx * radius}px, ${dy * radius}px)`;
      this.input.setStick(joystickKeys(dx, dy, layout));
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      knob.style.transform = '';
      this.input.setStick([]);
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (active !== null) return;
      active = e.pointerId;
      base.setPointerCapture?.(e.pointerId);
      move(e);
    });
    base.addEventListener('pointermove', move);
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    return base;
  }

  update(s: PlayerState, sceneIndex: number, sceneCount: number) {
    const spec = s.sceneSpec;
    const game = spec.mode === 'game';
    this.level.textContent = sceneCount > 1 ? `${sceneIndex + 1}/${sceneCount} · ${spec.title}` : spec.title;
    this.score.style.display = game ? '' : 'none';
    if (game) this.score.textContent = `★ ${s.gameScore}/${spec.gameRules?.targetScore ?? 0} · ⏱ ${Math.max(0, Math.ceil(s.gameTimeRemaining))}s`;

    // Phase 7D: pause button + menu, and the message box (scene-time based, so pausing freezes it).
    this.pauseBtn.style.display = game && !s.gameEnded ? '' : 'none';
    this.setPauseCard(game && s.gamePaused && !s.gameEnded);
    const msg = game ? activeMessage(s.gameMessage, s.currentTime) : null;
    const msgKey = msg ? `${msg.speaker ?? ''}|${msg.text}` : '';
    if (this.message.dataset.key !== msgKey) {
      this.message.dataset.key = msgKey;
      this.message.replaceChildren(...(msg ? [...(msg.speaker ? [el('b', '', msg.speaker)] : []), document.createTextNode(msg.text)] : []));
    }
    this.message.style.display = msg ? '' : 'none';

    this.gameHud.update(game ? resolveHud(spec, { score: s.gameScore, timeRemaining: s.gameTimeRemaining, variables: s.gameVars, health: s.gameHealth, wave: s.gameWave }) : []);

    // On-screen controls only on touch devices, for game scenes with a player.
    const layout = this.opts.touch ? touchLayoutFor(spec, s.gameEnded) : 'none';
    const style = touchStyleFor(spec, layout);
    if (`${layout}:${style}` !== this.touchLayout) this.buildTouch(layout, style);

    // Captions (2D draws them into its canvas).
    const cues = spec.engineType === '3d' ? activeCaptions(sceneCaptions(spec), s.currentTime) : [];
    const capKey = cues.map((c) => c.text).join('|');
    if (this.captions.dataset.key !== capKey) {
      this.captions.dataset.key = capKey;
      this.captions.replaceChildren(...cues.map((c) => el('span', '', c.text)));
    }

    // Marketing CTA
    const m = spec.marketingOverlay;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const showCta = !!m?.enabled && (m.triggerCondition === 'always' || (m.triggerCondition === 'after-3s' && elapsed > 3) || (m.triggerCondition === 'on-win' && s.gameWon));
    this.cta.style.display = showCta && !s.gameEnded ? '' : 'none';
    if (showCta) {
      this.cta.textContent = m.ctaText || 'Play Now';
      this.cta.style.background = m.brandColor || '#22d3ee';
    }
  }

  /** End cards: game won / lost, or the end of a media sequence. */
  setCard(kind: 'none' | 'won' | 'lost' | 'media-end', hasNext: boolean, ctaText?: string) {
    const key = `${kind}:${hasNext}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    if (kind === 'none') {
      this.card.style.display = 'none';
      return;
    }
    const box = el('div');
    const title = kind === 'won' ? (hasNext ? 'Level complete! 🏆' : 'You win! 🏆') : kind === 'lost' ? "Time's up" : 'The end';
    box.append(el('h2', '', title), el('p', '', kind === 'lost' ? 'Try again?' : hasNext ? 'Ready for the next one?' : 'Thanks for playing'));
    const add = (label: string, cls: string, fn: () => void) => {
      const b = el('button', cls, label);
      b.onclick = fn;
      box.appendChild(b);
    };
    if (kind === 'won' && hasNext) add('Next level ▶', 'omni-primary', this.cb.onNext);
    if (kind === 'lost') add('Retry ↻', 'omni-primary', this.cb.onRetry);
    if ((kind === 'won' && !hasNext) || kind === 'media-end') add('Play again ↻', hasNext ? 'omni-secondary' : 'omni-primary', this.cb.onReplay);
    if (ctaText) add(ctaText, 'omni-secondary', this.cb.onCta);
    this.card.replaceChildren(box);
    this.card.style.display = 'flex';
  }
}
