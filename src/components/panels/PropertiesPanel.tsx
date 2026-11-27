import React, { useState } from 'react';
import { Box, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Layers, Lock, MousePointer2, PanelRightClose, SlidersHorizontal, Sparkles, Trash2, Unlock } from 'lucide-react';
import { useStudioStore } from '../../state/useStudioStore';
import { LIGHTING_PRESETS } from '../../registry/assetRegistry';
import { StateMachineBadge } from '../StateMachineBadge';
import { ShaderEffectControl } from './ShaderEffectControl';
import { useShellStore } from '../../state/useShellStore';
import { IconBtn, Kbd, Segmented } from '../ui';
import {
  ActorClickAction,
  ActorNode,
  AnimationType,
  AspectRatioPreset,
  Camera2DSpec,
  CameraMode,
  Collider2D,
  EngineType,
  EnterEffect,
  GameRule,
  GameVariable,
  HealthSpec,
  HudAnchor,
  HudElement,
  HudKind,
  HudSource,
  LightingPresetId,
  Mover2D,
  Node2D,
  Physics2DRole,
  PhysicsRole,
  PlatformerController2D,
  Projectile2D,
  SettingsConfig,
  Spawner2D,
  VFXNode,
  Vector3Tuple,
} from '../../types/scene.schema';
import { PLATFORMER_DEFAULTS } from '../../runtime/physics/constants';
import { GRADE_PRESET_IDS, GRADE_PRESETS, GRADE_RANGES, resolveGrade } from '../../runtime/colorGrade';
import { resolveCamera2D, resolveWorld, WORLD_LIMITS } from '../../runtime/physics/camera2d';

// ----------------------------------------------------------------------------
// Small field widgets
// ----------------------------------------------------------------------------
const round = (v: number) => Math.round(v * 1000) / 1000;
const DEG = 180 / Math.PI;

/** Number input that lets you type "-", "0." or an empty box without fighting the store, and nudges with the arrow keys. */
export const NumField: React.FC<{
  value: number;
  onChange: (v: number) => void;
  label?: string;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}> = ({ value, onChange, label, step = 0.1, min, max, disabled, title, ariaLabel }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const clampV = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <label className="pp-num" title={title}>
      {label && <span>{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        aria-label={ariaLabel || label}
        value={draft ?? String(round(value))}
        onFocus={(e) => {
          setDraft(String(round(value)));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(clampV(n));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const next = round(clampV(value + dir * step * (e.shiftKey ? 10 : 1)));
            setDraft(String(next));
            onChange(next);
          }
        }}
      />
    </label>
  );
};

const Vec3: React.FC<{
  label: string;
  value: Vector3Tuple;
  onChange: (v: Vector3Tuple) => void;
  step?: number;
  scale?: number;
  disabled?: boolean;
}> = ({ label, value, onChange, step = 0.1, scale = 1, disabled }) => (
  <div className="pp-row">
    <span className="pp-label">{label}</span>
    <div className="pp-vec">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumField
          key={axis}
          label={axis}
          ariaLabel={`${label} ${axis}`}
          step={step}
          disabled={disabled}
          value={value[i] * scale}
          onChange={(n) => {
            const next = [...value] as Vector3Tuple;
            next[i] = n / scale;
            onChange(next);
          }}
        />
      ))}
    </div>
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode; title?: string }> = ({ label, children, title }) => (
  <div className="pp-row" title={title}>
    <span className="pp-label">{label}</span>
    <div className="pp-ctl">{children}</div>
  </div>
);

const Color: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
  <label className="pp-color">
    <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'} onChange={(e) => onChange(e.target.value)} />
    <span className="font-mono">{value}</span>
  </label>
);

const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="pp-check">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

// Collapsed / expanded state survives re-mounts (selection changes swap whole sections).
const openState = new Map<string, boolean>();

const Section: React.FC<{ id: string; title: string; icon?: React.ReactNode; defaultOpen?: boolean; badge?: string; children: React.ReactNode }> = ({
  id,
  title,
  icon,
  defaultOpen = true,
  badge,
  children,
}) => {
  const [open, setOpen] = useState(openState.get(id) ?? defaultOpen);
  const toggle = () => {
    openState.set(id, !open);
    setOpen(!open);
  };
  return (
    <section className="pp-sec">
      <button type="button" className="pp-sec-h" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {badge && <span className="font-mono text-[11px] text-dim">{badge}</span>}
      </button>
      {open && <div className="pp-sec-b">{children}</div>}
    </section>
  );
};

const EnterFx: React.FC<{ value: EnterEffect | undefined; onChange: (v: EnterEffect) => void }> = ({ value, onChange }) => (
  <select className="field sm" aria-label="Enter effect" value={value ?? 'pop-in'} onChange={(e) => onChange(e.target.value as EnterEffect)}>
    <option value="pop-in">pop-in</option>
    <option value="slide-up">slide-up</option>
    <option value="fade">fade</option>
    <option value="none">none</option>
  </select>
);

// ----------------------------------------------------------------------------
// Selection editors
// ----------------------------------------------------------------------------
const ActorProps: React.FC<{ actor: ActorNode; duration: number }> = ({ actor, duration }) => {
  const update = useStudioStore((s) => s.updateActorProperty);
  const duplicate = useStudioStore((s) => s.duplicateActor);
  const remove = useStudioStore((s) => s.removeActor);
  const isGame = useStudioStore((s) => s.sceneSpec.mode === 'game');
  const set = (patch: Partial<ActorNode>) => update(actor.id, patch);
  const hidden = actor.visible === false;

  return (
    <>
      <div className="pp-head">
        <Box size={14} className="shrink-0 text-accent" />
        <input className="field sm min-w-0 flex-1" aria-label="Actor name" value={actor.name} onChange={(e) => set({ name: e.target.value })} />
        <IconBtn small label={hidden ? 'Show actor' : 'Hide actor'} onClick={() => set({ visible: hidden })}>
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconBtn>
        <IconBtn small label={actor.locked ? 'Unlock transform' : 'Lock transform'} active={!!actor.locked} onClick={() => set({ locked: !actor.locked })}>
          {actor.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </IconBtn>
        <IconBtn small label="Duplicate" onClick={() => duplicate(actor.id)}>
          <Copy size={13} />
        </IconBtn>
        <IconBtn small danger label="Delete" onClick={() => remove(actor.id)}>
          <Trash2 size={13} />
        </IconBtn>
      </div>

      <Section id="a-transform" title="Transform" badge={actor.locked ? 'locked' : undefined}>
        <Vec3 label="Position (m)" step={0.2} disabled={actor.locked} value={actor.position} onChange={(position) => set({ position })} />
        <Vec3 label="Rotation (°)" step={5} scale={DEG} disabled={actor.locked} value={actor.rotation} onChange={(rotation) => set({ rotation })} />
        <Vec3
          label="Scale"
          step={0.1}
          disabled={actor.locked}
          value={actor.scale}
          onChange={(scale) => set({ scale: scale.map((v) => Math.max(0.05, v)) as Vector3Tuple })}
        />
      </Section>

      <Section id="a-look" title="Look">
        <Row label="Color">
          <Color label="Primary color" value={actor.primaryColor} onChange={(primaryColor) => set({ primaryColor })} />
        </Row>
        <Row label="Accent">
          <Color label="Secondary color" value={actor.secondaryColor || actor.primaryColor} onChange={(secondaryColor) => set({ secondaryColor })} />
        </Row>
        <Row label="Metalness">
          <input type="range" className="rng" aria-label="Metalness" min={0} max={1} step={0.02} value={actor.metalness ?? 0.8} onChange={(e) => set({ metalness: parseFloat(e.target.value) })} />
        </Row>
        <Row label="Roughness">
          <input type="range" className="rng" aria-label="Roughness" min={0} max={1} step={0.02} value={actor.roughness ?? 0.22} onChange={(e) => set({ roughness: parseFloat(e.target.value) })} />
        </Row>
        <ShaderEffectControl actor={actor} onChange={(shaderEffect) => set({ shaderEffect })} />
      </Section>

      <Section id="a-motion" title="Animation">
        {actor.availableClips && actor.availableClips.length > 0 && (
          <Row label="Clip">
            <select className="field sm" aria-label="Skeletal clip" value={actor.activeClip || actor.availableClips[0]} onChange={(e) => set({ activeClip: e.target.value })}>
              {actor.availableClips.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Motion">
          <select className="field sm" aria-label="Procedural motion" value={actor.activeAnimation} onChange={(e) => set({ activeAnimation: e.target.value as AnimationType })}>
            {(['idle', 'float', 'spin', 'bounce', 'walk', 'attack'] as AnimationType[]).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Speed">
          <NumField step={0.1} min={0} max={10} ariaLabel="Animation speed" value={actor.animationSpeed ?? 1} onChange={(animationSpeed) => set({ animationSpeed })} />
        </Row>
        {actor.stateMachine && <StateMachineBadge id={actor.id} machine={actor.stateMachine} />}
      </Section>

      <Section id="a-behaviour" title="Behaviour" defaultOpen={isGame}>
        <Row label="Physics role" title="static: solid · dynamic: moves · collectible: picked up · player: you · hazard: hurts">
          <select className="field sm" aria-label="Physics role" value={actor.physicsRole} onChange={(e) => set({ physicsRole: e.target.value as PhysicsRole })}>
            {(['static', 'dynamic', 'collectible', 'player', 'hazard'] as PhysicsRole[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Row>
        <Row label="On tap / click">
          <select className="field sm" aria-label="Tap behaviour" value={actor.onClickAction} onChange={(e) => set({ onClickAction: e.target.value as ActorClickAction })}>
            {(['none', 'collect', 'collect-score', 'unbox-tap', 'destroy', 'bounce', 'jump-boost', 'trigger-vfx', 'trigger-cta', 'cta-redirect'] as ActorClickAction[]).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Score value">
          <NumField step={1} min={0} ariaLabel="Score value" value={actor.scoreValue ?? 0} onChange={(scoreValue) => set({ scoreValue })} />
        </Row>
        {isGame && <HealthProps health={actor.health} set={(health) => set({ health })} />}
        {actor.onClickAction === 'unbox-tap' && (
          <Row label="Taps to open">
            <NumField step={1} min={1} max={20} ariaLabel="Taps required" value={actor.unboxTapsRequired ?? 3} onChange={(unboxTapsRequired) => set({ unboxTapsRequired: Math.round(unboxTapsRequired) })} />
          </Row>
        )}
      </Section>

      <Section id="a-timing" title="Timing" defaultOpen={!isGame}>
        <Row label="Appears (s)">
          <NumField step={0.5} min={0} max={duration} ariaLabel="Start time" value={actor.startTime ?? 0} onChange={(startTime) => set({ startTime })} />
        </Row>
        <Row label="Leaves (s)">
          <NumField step={0.5} min={0.5} max={duration} ariaLabel="End time" value={actor.endTime ?? duration} onChange={(endTime) => set({ endTime })} />
        </Row>
        <Row label="Enter effect">
          <EnterFx value={actor.enterEffect} onChange={(enterEffect) => set({ enterEffect })} />
        </Row>
      </Section>
    </>
  );
};

const Node2DProps: React.FC<{ node: Node2D }> = ({ node }) => {
  const update = useStudioStore((s) => s.updateNode2D);
  const duplicate = useStudioStore((s) => s.duplicateNode2D);
  const remove = useStudioStore((s) => s.removeNode2D);
  const isGame = useStudioStore((s) => s.sceneSpec.mode === 'game');
  const set = (patch: Partial<Node2D>) => update(node.id, patch);
  const hidden = node.visible === false;

  return (
    <>
      <div className="pp-head">
        <Layers size={14} className="shrink-0 text-media" />
        <input className="field sm min-w-0 flex-1" aria-label="Layer name" value={node.name} onChange={(e) => set({ name: e.target.value })} />
        <IconBtn small label={hidden ? 'Show layer' : 'Hide layer'} onClick={() => set({ visible: hidden })}>
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconBtn>
        <IconBtn small label={node.locked ? 'Unlock layer' : 'Lock layer'} active={!!node.locked} onClick={() => set({ locked: !node.locked })}>
          {node.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </IconBtn>
        <IconBtn small label="Duplicate" onClick={() => duplicate(node.id)}>
          <Copy size={13} />
        </IconBtn>
        <IconBtn small danger label="Delete" onClick={() => remove(node.id)}>
          <Trash2 size={13} />
        </IconBtn>
      </div>

      <Section id="n-transform" title="Transform" badge={node.type}>
        <div className="pp-row">
          <span className="pp-label">Position</span>
          <div className="pp-vec two">
            <NumField label="X" step={5} disabled={node.locked} value={node.x} onChange={(x) => set({ x })} />
            <NumField label="Y" step={5} disabled={node.locked} value={node.y} onChange={(y) => set({ y })} />
          </div>
        </div>
        <div className="pp-row">
          <span className="pp-label">Size</span>
          <div className="pp-vec two">
            <NumField label="W" step={5} min={1} disabled={node.locked} value={node.width} onChange={(width) => set({ width })} />
            <NumField label="H" step={5} min={1} disabled={node.locked} value={node.height} onChange={(height) => set({ height })} />
          </div>
        </div>
        <div className="pp-row">
          <span className="pp-label">Scale</span>
          <div className="pp-vec two">
            <NumField label="X" step={0.1} disabled={node.locked} value={node.scaleX} onChange={(scaleX) => set({ scaleX })} />
            <NumField label="Y" step={0.1} disabled={node.locked} value={node.scaleY} onChange={(scaleY) => set({ scaleY })} />
          </div>
        </div>
        <Row label="Rotation (°)">
          <NumField step={5} disabled={node.locked} ariaLabel="Rotation" value={node.rotation} onChange={(rotation) => set({ rotation })} />
        </Row>
        <Row label="Opacity">
          <input type="range" className="rng" aria-label="Opacity" min={0} max={1} step={0.02} value={node.opacity} onChange={(e) => set({ opacity: parseFloat(e.target.value) })} />
        </Row>
      </Section>

      <Section id="n-look" title="Look">
        {node.type === 'text-kinetic' && (
          <>
            <Row label="Text">
              <input className="field sm" aria-label="Text" value={node.text || ''} onChange={(e) => set({ text: e.target.value })} />
            </Row>
            <Row label="Font size">
              <NumField step={2} min={6} max={400} ariaLabel="Font size" value={node.fontSize ?? 32} onChange={(fontSize) => set({ fontSize })} />
            </Row>
          </>
        )}
        {node.type === 'vector-shape' && (
          <Row label="Shape">
            <select className="field sm" aria-label="Shape" value={node.shapeKind || 'rect'} onChange={(e) => set({ shapeKind: e.target.value as Node2D['shapeKind'] })}>
              {['rect', 'circle', 'star', 'capsule', 'triangle'].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Fill">
          <Color label="Fill color" value={node.fill} onChange={(fill) => set({ fill })} />
        </Row>
        <Row label="Stroke">
          <Color label="Stroke color" value={node.stroke} onChange={(stroke) => set({ stroke })} />
        </Row>
        <Row label="Stroke width">
          <NumField step={1} min={0} max={40} ariaLabel="Stroke width" value={node.strokeWidth ?? 0} onChange={(strokeWidth) => set({ strokeWidth })} />
        </Row>
        {node.type === 'parallax-layer' && (
          <Row label="Parallax">
            <NumField step={0.1} min={0} max={2} ariaLabel="Parallax factor" value={node.parallaxFactor ?? 0.5} onChange={(parallaxFactor) => set({ parallaxFactor })} />
          </Row>
        )}
      </Section>

      <Section id="n-behaviour" title="Behaviour" defaultOpen={isGame}>
        <Row label="Physics role">
          <select className="field sm" aria-label="Physics role" value={node.physics2D} onChange={(e) => set({ physics2D: e.target.value as Physics2DRole })}>
            <option value="none">none / UI</option>
            <option value="player-platformer">platformer player</option>
            <option value="player-topdown">top-down player</option>
            <option value="static-platform">one-way platform (jump through from below)</option>
            <option value="solid">solid block (blocks every side)</option>
            <option value="hazard">hazard (spikes, lava: resets the player)</option>
            <option value="checkpoint">checkpoint (respawn point)</option>
            <option value="collectible">collectible (+pts)</option>
            <option value="bouncing">bouncing orb</option>
          </select>
        </Row>
        {node.physics2D === 'player-platformer' && <ControllerProps node={node} set={set} />}
        {(node.physics2D === 'static-platform' || node.physics2D === 'solid' || node.physics2D === 'hazard') && <MoverProps node={node} set={set} />}
        {node.physics2D !== 'none' && <ColliderProps node={node} set={set} />}
        {(node.physics2D === 'collectible' || node.scoreValue) && (
          <Row label="Score value">
            <NumField step={1} min={0} ariaLabel="Score value" value={node.scoreValue ?? 0} onChange={(scoreValue) => set({ scoreValue })} />
          </Row>
        )}
        {isGame && <GameStateProps node={node} set={set} />}
      </Section>
    </>
  );
};

const ControllerProps: React.FC<{ node: Node2D; set: (patch: Partial<Node2D>) => void }> = ({ node, set }) => {
  const c = node.controller ?? {};
  const d = PLATFORMER_DEFAULTS;
  const patch = (p: Partial<PlatformerController2D>) => set({ controller: { ...c, ...p } });
  return (
    <>
      <Row label="Run speed" title="px/s while a direction is held">
        <NumField step={10} min={40} max={1200} ariaLabel="Run speed" value={c.runSpeed ?? d.runSpeed} onChange={(runSpeed) => patch({ runSpeed })} />
      </Row>
      <Row label="Jump power" title="px/s upward at jump start">
        <NumField step={20} min={100} max={1400} ariaLabel="Jump power" value={c.jumpVelocity ?? d.jumpVelocity} onChange={(jumpVelocity) => patch({ jumpVelocity })} />
      </Row>
      <Row label="Jumps" title="1 = single, 2 = double jump, 3 = triple">
        <NumField step={1} min={1} max={3} ariaLabel="Max jumps" value={c.maxJumps ?? d.maxJumps} onChange={(maxJumps) => patch({ maxJumps: Math.round(maxJumps) })} />
      </Row>
      <Row label="Gravity ×" title="Multiplier on the scene gravity">
        <NumField step={0.1} min={0.2} max={3} ariaLabel="Gravity scale" value={c.gravityScale ?? 1} onChange={(gravityScale) => patch({ gravityScale })} />
      </Row>
      <Row label="Coyote (s)" title="A jump still works this long after leaving a ledge">
        <NumField step={0.02} min={0} max={0.3} ariaLabel="Coyote time" value={c.coyoteTime ?? d.coyoteTime} onChange={(coyoteTime) => patch({ coyoteTime })} />
      </Row>
      <Row label="Jump buffer (s)" title="An early jump press is remembered this long">
        <NumField step={0.02} min={0} max={0.3} ariaLabel="Jump buffer" value={c.jumpBuffer ?? d.jumpBuffer} onChange={(jumpBuffer) => patch({ jumpBuffer })} />
      </Row>
      <Row label="Air control" title="0..1 steering while airborne">
        <NumField step={0.1} min={0} max={1} ariaLabel="Air control" value={c.airControl ?? d.airControl} onChange={(airControl) => patch({ airControl })} />
      </Row>
      <Check checked={c.variableJump ?? true} onChange={(variableJump) => patch({ variableJump })} label="Variable jump height (release to cut)" />
    </>
  );
};

const MoverProps: React.FC<{ node: Node2D; set: (patch: Partial<Node2D>) => void }> = ({ node, set }) => {
  const m = node.mover;
  const patch = (p: Partial<Mover2D>) => set({ mover: { axis: 'x', distance: 160, speed: 80, ...m, ...p } });
  return (
    <>
      <Check checked={!!m} onChange={(on) => set({ mover: on ? { axis: 'x', distance: 160, speed: 80 } : undefined })} label="Moving platform (carries the player)" />
      {m && (
        <>
          <Row label="Axis">
            <select className="field sm" aria-label="Mover axis" value={m.axis} onChange={(e) => patch({ axis: e.target.value as Mover2D['axis'] })}>
              <option value="x">horizontal</option>
              <option value="y">vertical</option>
            </select>
          </Row>
          <Row label="Distance (px)" title="Negative goes the other way first">
            <NumField step={10} min={-2000} max={2000} ariaLabel="Mover distance" value={m.distance} onChange={(distance) => patch({ distance })} />
          </Row>
          <Row label="Speed (px/s)">
            <NumField step={10} min={10} max={600} ariaLabel="Mover speed" value={m.speed} onChange={(speed) => patch({ speed })} />
          </Row>
          <Row label="Phase" title="0..1 start offset within the cycle">
            <NumField step={0.1} min={0} max={1} ariaLabel="Mover phase" value={m.phase ?? 0} onChange={(phase) => patch({ phase })} />
          </Row>
        </>
      )}
    </>
  );
};

const ColliderProps: React.FC<{ node: Node2D; set: (patch: Partial<Node2D>) => void }> = ({ node, set }) => {
  const c = node.collider;
  const patch = (p: Partial<Collider2D>) => set({ collider: { ...c, ...p } });
  return (
    <>
      <Check checked={!!c} onChange={(on) => set({ collider: on ? {} : undefined })} label="Custom hit box (instead of the drawn size)" />
      {c && (
        <>
          <div className="pp-row">
            <span className="pp-label">Size</span>
            <div className="pp-vec two">
              <NumField label="W" step={5} min={1} ariaLabel="Hit box width" value={c.width ?? Math.abs(node.width * node.scaleX)} onChange={(width) => patch({ width })} />
              <NumField label="H" step={5} min={1} ariaLabel="Hit box height" value={c.height ?? Math.abs(node.height * node.scaleY)} onChange={(height) => patch({ height })} />
            </div>
          </div>
          <div className="pp-row">
            <span className="pp-label">Offset</span>
            <div className="pp-vec two">
              <NumField label="X" step={2} ariaLabel="Hit box offset X" value={c.offsetX ?? 0} onChange={(offsetX) => patch({ offsetX })} />
              <NumField label="Y" step={2} ariaLabel="Hit box offset Y" value={c.offsetY ?? 0} onChange={(offsetY) => patch({ offsetY })} />
            </div>
          </div>
        </>
      )}
    </>
  );
};

const HEALTH_DEFAULT = { max: 3, invulnerableSeconds: 0.8 };

/** Phase 3: hit points on any entity (the player loses the game at 0, an enemy is removed and pays its score value). */
const HealthProps: React.FC<{ health: HealthSpec | undefined; set: (health: HealthSpec | undefined) => void }> = ({ health, set }) => (
  <>
    <Check checked={!!health} onChange={(on) => set(on ? { ...HEALTH_DEFAULT } : undefined)} label="Has health (hit points)" />
    {health && (
      <>
        <Row label="Max health">
          <NumField step={1} min={1} max={1000} ariaLabel="Max health" value={health.max} onChange={(max) => set({ ...health, max: Math.max(1, Math.round(max)) })} />
        </Row>
        <Row label="Immune (s)" title="Seconds without damage after being hit">
          <NumField step={0.1} min={0} max={10} ariaLabel="Invulnerable seconds" value={health.invulnerableSeconds ?? 0} onChange={(invulnerableSeconds) => set({ ...health, invulnerableSeconds })} />
        </Row>
      </>
    )}
  </>
);

/** Phase 3 on a 2D node: health, damage dealt on touch, prefab (spawn template), spawner and projectile. */
const GameStateProps: React.FC<{ node: Node2D; set: (patch: Partial<Node2D>) => void }> = ({ node, set }) => {
  const nodes2D = useStudioStore((s) => s.sceneSpec.nodes2D);
  const prefabs = nodes2D.filter((n) => n.prefab && n.id !== node.id);
  const sp = node.spawner;
  const pr = node.projectile;
  const patchSpawner = (p: Partial<Spawner2D>) => set({ spawner: { prefabId: prefabs[0]?.id ?? '', everySeconds: 2, max: 5, ...sp, ...p } });
  const patchProj = (p: Partial<Projectile2D>) => set({ projectile: { vx: 300, vy: 0, damage: 1, lifetimeSeconds: 3, target: 'player', ...pr, ...p } });
  const isPlayer = node.physics2D === 'player-platformer' || node.physics2D === 'player-topdown';
  return (
    <>
      <HealthProps health={node.health} set={(health) => set({ health })} />
      {!isPlayer && (
        <Row label="Touch damage" title="Health taken from whoever touches it (a hazard defaults to 1)">
          <NumField step={1} min={0} max={1000} ariaLabel="Contact damage" value={node.contactDamage ?? 0} onChange={(v) => set({ contactDamage: v > 0 ? v : undefined })} />
        </Row>
      )}
      {!isPlayer && <Check checked={!!node.prefab} onChange={(prefab) => set({ prefab: prefab || undefined })} label="Prefab (spawn template: hidden while playing)" />}
      {!isPlayer && !node.prefab && (
        <>
          <Check checked={!!sp} onChange={(on) => set({ spawner: on ? { prefabId: prefabs[0]?.id ?? '', everySeconds: 2, max: 5 } : undefined })} label="Spawner (creates copies of a prefab)" />
          {sp && (
            <>
              <Row label="Spawns">
                <select className="field sm" aria-label="Spawner prefab" value={sp.prefabId} onChange={(e) => patchSpawner({ prefabId: e.target.value })}>
                  <option value="">(pick a prefab)</option>
                  {prefabs.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Every (s)">
                <NumField step={0.25} min={0.05} max={600} ariaLabel="Spawn interval" value={sp.everySeconds} onChange={(everySeconds) => patchSpawner({ everySeconds })} />
              </Row>
              <Row label="Max alive">
                <NumField step={1} min={1} max={64} ariaLabel="Spawn max alive" value={sp.max ?? 5} onChange={(max) => patchSpawner({ max: Math.round(max) })} />
              </Row>
              <Row label="Start delay (s)">
                <NumField step={0.5} min={0} max={600} ariaLabel="Spawn start delay" value={sp.startDelay ?? 0} onChange={(startDelay) => patchSpawner({ startDelay })} />
              </Row>
              <div className="pp-row">
                <span className="pp-label">Random offset</span>
                <div className="pp-vec two">
                  <NumField label="X" step={10} min={0} ariaLabel="Spawn jitter X" value={sp.jitterX ?? 0} onChange={(jitterX) => patchSpawner({ jitterX })} />
                  <NumField label="Y" step={10} min={0} ariaLabel="Spawn jitter Y" value={sp.jitterY ?? 0} onChange={(jitterY) => patchSpawner({ jitterY })} />
                </div>
              </div>
            </>
          )}
        </>
      )}
      {!isPlayer && (
        <>
          <Check checked={!!pr} onChange={(on) => set({ projectile: on ? { vx: 300, vy: 0, damage: 1, lifetimeSeconds: 3, target: 'player' } : undefined })} label="Projectile (flies on its own)" />
          {pr && (
            <>
              <div className="pp-row">
                <span className="pp-label">Velocity (px/s)</span>
                <div className="pp-vec two">
                  <NumField label="X" step={20} min={-4000} max={4000} ariaLabel="Projectile vx" value={pr.vx} onChange={(vx) => patchProj({ vx })} />
                  <NumField label="Y" step={20} min={-4000} max={4000} ariaLabel="Projectile vy" value={pr.vy} onChange={(vy) => patchProj({ vy })} />
                </div>
              </div>
              <Row label="Damage">
                <NumField step={1} min={0} max={1000} ariaLabel="Projectile damage" value={pr.damage ?? 1} onChange={(damage) => patchProj({ damage })} />
              </Row>
              <Row label="Lifetime (s)">
                <NumField step={0.5} min={0.1} max={60} ariaLabel="Projectile lifetime" value={pr.lifetimeSeconds ?? 3} onChange={(lifetimeSeconds) => patchProj({ lifetimeSeconds })} />
              </Row>
              <Row label="Gravity (px/s²)">
                <NumField step={50} min={-4000} max={4000} ariaLabel="Projectile gravity" value={pr.gravity ?? 0} onChange={(gravity) => patchProj({ gravity })} />
              </Row>
              <Row label="Hurts">
                <select className="field sm" aria-label="Projectile target" value={pr.target ?? 'any'} onChange={(e) => patchProj({ target: e.target.value as Projectile2D['target'] })}>
                  <option value="player">the player</option>
                  <option value="enemy">enemies</option>
                  <option value="any">anything with health</option>
                </select>
              </Row>
              <Check checked={pr.destroyOnHit ?? true} onChange={(destroyOnHit) => patchProj({ destroyOnHit })} label="Disappears on hit" />
            </>
          )}
        </>
      )}
    </>
  );
};

const HUD_ANCHOR_LABEL: Record<HudAnchor, string> = {
  'top-left': 'top left', 'top-center': 'top centre', 'top-right': 'top right',
  'bottom-left': 'bottom left', 'bottom-center': 'bottom centre', 'bottom-right': 'bottom right',
};

/** Phase 3: scene variables + the on-screen HUD that shows them (Player and studio draw the same thing). */
const GameStateSettings: React.FC = () => {
  const spec = useStudioStore((s) => s.sceneSpec);
  const setVariables = useStudioStore((s) => s.setSceneVariables);
  const setHud = useStudioStore((s) => s.setSceneHud);
  const updateGameRules = useStudioStore((s) => s.updateGameRules);
  const variables = spec.variables || [];
  const hud = spec.hud || [];
  const patchVar = (i: number, p: Partial<GameVariable>) => setVariables(variables.map((v, j) => (j === i ? { ...v, ...p } : v)));
  const patchHud = (i: number, p: Partial<HudElement>) => setHud(hud.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const freshVarId = () => {
    let n = variables.length + 1;
    while (variables.some((v) => v.id === 'var' + n)) n++;
    return 'var' + n;
  };
  const freshHudId = () => {
    let n = hud.length + 1;
    while (hud.some((h) => h.id === 'hud' + n)) n++;
    return 'hud' + n;
  };
  const hasHealth = [...spec.nodes2D, ...spec.actors].some((e) => (e as { health?: HealthSpec }).health);
  return (
    <>
      <div className="pp-label" style={{ marginTop: 6 }}>Variables (keys, ammo, lives ...)</div>
      {variables.map((v, i) => (
        <div key={i} className="pp-row">
          <input className="field sm w-20 font-mono" aria-label="Variable id" value={v.id} onChange={(e) => patchVar(i, { id: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) })} />
          <div className="pp-vec">
            <NumField label="start" step={1} ariaLabel={`${v.id} start`} value={v.initial} onChange={(initial) => patchVar(i, { initial })} />
            <NumField label="max" step={1} ariaLabel={`${v.id} max`} value={v.max ?? 0} onChange={(max) => patchVar(i, { max: max > 0 ? max : undefined })} />
          </div>
          <IconBtn small danger label={`Delete variable ${v.id}`} onClick={() => setVariables(variables.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </IconBtn>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setVariables([...variables, { id: freshVarId(), initial: 0 }])}>
        + Variable
      </button>
      {spec.gameRules.winCondition === 'variable-threshold' && (
        <>
          <Row label="Win when">
            <select
              className="field sm"
              aria-label="Win variable"
              value={spec.gameRules.winVariable?.id ?? ''}
              onChange={(e) => updateGameRules({ winVariable: { id: e.target.value, atLeast: spec.gameRules.winVariable?.atLeast ?? 3 } })}
            >
              <option value="">(pick a variable)</option>
              {variables.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
          </Row>
          <Row label="reaches">
            <NumField step={1} ariaLabel="Win variable target" value={spec.gameRules.winVariable?.atLeast ?? 3} onChange={(atLeast) => updateGameRules({ winVariable: { id: spec.gameRules.winVariable?.id ?? variables[0]?.id ?? '', atLeast } })} />
          </Row>
        </>
      )}
      <div className="pp-label" style={{ marginTop: 6 }}>HUD (drawn over the game)</div>
      {hud.map((h, i) => (
        <div key={h.id} className="pp-row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <select className="field sm" aria-label={`${h.id} shows`} value={h.source} onChange={(e) => patchHud(i, { source: e.target.value as HudSource, variableId: e.target.value === 'variable' ? variables[0]?.id : undefined })}>
            <option value="score">score</option>
            <option value="time">time left</option>
            <option value="health">health</option>
            <option value="variable">variable</option>
          </select>
          {h.source === 'variable' && (
            <select className="field sm" aria-label={`${h.id} variable`} value={h.variableId ?? ''} onChange={(e) => patchHud(i, { variableId: e.target.value })}>
              {variables.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
          )}
          <select className="field sm" aria-label={`${h.id} style`} value={h.kind} onChange={(e) => patchHud(i, { kind: e.target.value as HudKind })}>
            <option value="counter">counter</option>
            <option value="bar">bar</option>
            <option value="text">text</option>
          </select>
          <select className="field sm" aria-label={`${h.id} position`} value={h.anchor} onChange={(e) => patchHud(i, { anchor: e.target.value as HudAnchor })}>
            {(Object.keys(HUD_ANCHOR_LABEL) as HudAnchor[]).map((a) => (
              <option key={a} value={a}>
                {HUD_ANCHOR_LABEL[a]}
              </option>
            ))}
          </select>
          <input className="field sm w-16" aria-label={`${h.id} label`} placeholder="label" value={h.label ?? ''} onChange={(e) => patchHud(i, { label: e.target.value || undefined })} />
          <IconBtn small danger label={`Delete HUD element ${h.id}`} onClick={() => setHud(hud.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </IconBtn>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        <button type="button" className="btn sm" onClick={() => setHud([...hud, { id: freshHudId(), kind: 'counter', source: 'score', anchor: 'top-left' }])}>
          + Score
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={!hasHealth}
          title={hasHealth ? 'Shows the player health' : 'Give the player health first (Behaviour → Has health)'}
          onClick={() => setHud([...hud, { id: freshHudId(), kind: 'bar', source: 'health', anchor: 'top-left', color: '#ef4444' }])}
        >
          + Health bar
        </button>
        <button type="button" className="btn sm" onClick={() => setHud([...hud, { id: freshHudId(), kind: 'counter', source: 'time', anchor: 'top-center' }])}>
          + Timer
        </button>
      </div>
    </>
  );
};

const World2DProps: React.FC = () => {
  const spec = useStudioStore((s) => s.sceneSpec);
  const updateWorld = useStudioStore((s) => s.updateWorld2D);
  const updateCamera = useStudioStore((s) => s.updateCamera2D);
  const world = resolveWorld(spec.world2D);
  const cam = resolveCamera2D(spec.camera2D, world);
  const patchCam = (p: Partial<Camera2DSpec>) => updateCamera(p);
  return (
    <>
      <div className="pp-row">
        <span className="pp-label">World (px)</span>
        <div className="pp-vec two">
          <NumField label="W" step={100} min={WORLD_LIMITS.min} max={WORLD_LIMITS.max} ariaLabel="World width" value={world.width} onChange={(width) => updateWorld({ width: Math.round(width) })} />
          <NumField label="H" step={100} min={WORLD_LIMITS.min} max={WORLD_LIMITS.max} ariaLabel="World height" value={world.height} onChange={(height) => updateWorld({ height: Math.round(height) })} />
        </div>
      </div>
      <Row label="Camera" title="fixed: shows the whole screen · follow: tracks the player through a bigger world">
        <select className="field sm" aria-label="Camera mode" value={cam.mode} onChange={(e) => patchCam({ mode: e.target.value as 'fixed' | 'follow' })}>
          <option value="fixed">fixed</option>
          <option value="follow">follow player</option>
        </select>
      </Row>
      {cam.mode === 'follow' && (
        <>
          <Row label="Zoom">
            <NumField step={0.1} min={0.5} max={2} ariaLabel="Camera zoom" value={cam.zoom} onChange={(zoom) => patchCam({ zoom })} />
          </Row>
          <Row label="Smoothing (s)" title="Seconds to catch up with the player (0 = glued)">
            <NumField step={0.05} min={0} max={1} ariaLabel="Camera smoothing" value={cam.smoothing} onChange={(smoothing) => patchCam({ smoothing })} />
          </Row>
          <Row label="Look-ahead (px)">
            <NumField step={10} min={0} max={300} ariaLabel="Camera look-ahead" value={cam.lookAhead} onChange={(lookAhead) => patchCam({ lookAhead })} />
          </Row>
        </>
      )}
    </>
  );
};

const VfxProps: React.FC<{ vfx: VFXNode; duration: number }> = ({ vfx, duration }) => {
  const update = useStudioStore((s) => s.updateVFX);
  const remove = useStudioStore((s) => s.removeVFX);
  const selectVfx = useStudioStore((s) => s.selectVfx);
  const set = (patch: Partial<VFXNode>) => update(vfx.id, patch);
  const hidden = vfx.visible === false;
  return (
    <>
      <div className="pp-head">
        <Sparkles size={14} className="shrink-0 text-warn" />
        <input className="field sm min-w-0 flex-1" aria-label="Effect name" value={vfx.name} onChange={(e) => set({ name: e.target.value })} />
        <IconBtn small label={hidden ? 'Show effect' : 'Hide effect'} onClick={() => set({ visible: hidden })}>
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconBtn>
        <IconBtn
          small
          danger
          label="Delete"
          onClick={() => {
            remove(vfx.id);
            selectVfx(null);
          }}
        >
          <Trash2 size={13} />
        </IconBtn>
      </div>
      <Section id="v-main" title={`Effect · ${vfx.type}`}>
        <Vec3 label="Position (m)" step={0.2} value={vfx.position} onChange={(position) => set({ position })} />
        <Row label="Color">
          <Color label="Effect color" value={vfx.color} onChange={(color) => set({ color })} />
        </Row>
        <Row label="Intensity">
          <input type="range" className="rng" aria-label="Intensity" min={0} max={4} step={0.05} value={vfx.intensity} onChange={(e) => set({ intensity: parseFloat(e.target.value) })} />
        </Row>
        <Row label="Size">
          <NumField step={0.1} min={0.1} max={20} ariaLabel="Size" value={vfx.scale ?? 1} onChange={(scale) => set({ scale })} />
        </Row>
        {vfx.type === 'floating-3d-badge' && (
          <Row label="Label">
            <input className="field sm" aria-label="Badge label" value={vfx.labelText || ''} onChange={(e) => set({ labelText: e.target.value })} />
          </Row>
        )}
      </Section>
      <Section id="v-timing" title="Timing">
        <Row label="Appears (s)">
          <NumField step={0.5} min={0} max={duration} ariaLabel="Start time" value={vfx.startTime ?? 0} onChange={(startTime) => set({ startTime })} />
        </Row>
        <Row label="Leaves (s)">
          <NumField step={0.5} min={0.5} max={duration} ariaLabel="End time" value={vfx.endTime ?? duration} onChange={(endTime) => set({ endTime })} />
        </Row>
        <Row label="Enter effect">
          <EnterFx value={vfx.enterEffect} onChange={(enterEffect) => set({ enterEffect })} />
        </Row>
      </Section>
    </>
  );
};

// ----------------------------------------------------------------------------
// Scene-level editors (always available)
// ----------------------------------------------------------------------------
const CAMERA_MODES: CameraMode[] = ['orbit-360', 'dolly-zoom-in', 'crane-reveal', 'top-down-isometric', 'first-person-follow', 'follow-target', 'isometric-game', 'cinematic-flythrough'];

const CameraProps: React.FC = () => {
  const camera = useStudioStore((s) => s.sceneSpec.camera);
  const actors = useStudioStore((s) => s.sceneSpec.actors);
  const setCameraMode = useStudioStore((s) => s.setCameraMode);
  const updateCamera = useStudioStore((s) => s.updateCamera);
  const follows = camera.mode === 'follow-target' || camera.mode === 'first-person-follow';
  const modes = CAMERA_MODES.includes(camera.mode) ? CAMERA_MODES : [camera.mode, ...CAMERA_MODES];
  return (
    <Section id="s-camera" title="Camera" defaultOpen={false} badge={camera.mode}>
      <Row label="Mode">
        <select className="field sm" aria-label="Camera mode" value={camera.mode} onChange={(e) => setCameraMode(e.target.value as CameraMode)}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Field of view">
        <NumField step={1} min={10} max={120} ariaLabel="Field of view" value={camera.fov} onChange={(fov) => updateCamera({ fov })} />
      </Row>
      <Vec3 label="Position (m)" step={0.2} value={camera.position} onChange={(position) => updateCamera({ position })} />
      <Vec3 label="Looks at (m)" step={0.2} value={camera.target} onChange={(target) => updateCamera({ target })} />
      {follows && (
        <Row label="Follows">
          <select className="field sm" aria-label="Follow actor" value={camera.followActorId || ''} onChange={(e) => updateCamera({ followActorId: e.target.value || undefined })}>
            <option value="">(player)</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Row>
      )}
    </Section>
  );
};

/** Phase 6: the scene's colour grade and lens look (3D scenes). The preset sets the numbers; each slider overrides one. */
const GradeProps: React.FC = () => {
  const grade = useStudioStore((s) => s.sceneSpec.grade);
  const update = useStudioStore((s) => s.updateGrade);
  const resolved = resolveGrade(grade);
  const base = GRADE_PRESETS[grade?.preset ?? 'neutral'];
  const num = (key: keyof typeof GRADE_RANGES, label: string, step: number) => (
    <Row key={key} label={label}>
      <NumField
        ariaLabel={`Grade ${label}`}
        step={step}
        min={GRADE_RANGES[key][0]}
        max={GRADE_RANGES[key][1]}
        value={grade?.[key] ?? (base as unknown as Record<string, number>)[key]}
        onChange={(v) => update({ [key]: v })}
      />
    </Row>
  );
  return (
    <Section id="s-grade" title="Colour grade & lens" defaultOpen={false} badge={resolved ? grade?.preset ?? 'custom' : 'off'}>
      <Row label="Look" title="A named look; the sliders below override it">
        <select className="field sm" aria-label="Grade preset" value={grade?.preset ?? 'neutral'} onChange={(e) =>
            // Picking a look starts from that look: drop the old slider overrides (they would silently skew the new preset).
            update({
              preset: e.target.value as (typeof GRADE_PRESET_IDS)[number],
              exposure: undefined,
              contrast: undefined,
              saturation: undefined,
              temperature: undefined,
              tint: undefined,
              fade: undefined,
              vignette: undefined,
              grain: undefined,
              split: undefined,
              shadows: undefined,
              highlights: undefined,
            })
          }>
          {GRADE_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </Row>
      {num('exposure', 'Exposure', 0.1)}
      {num('contrast', 'Contrast', 0.05)}
      {num('saturation', 'Saturation', 0.05)}
      {num('temperature', 'Warmth', 0.05)}
      {num('tint', 'Tint', 0.05)}
      {num('fade', 'Fade', 0.02)}
      {num('vignette', 'Vignette', 0.05)}
      {num('grain', 'Film grain', 0.05)}
      {grade && (
        <Row label="Reset">
          <button className="btn sm" aria-label="Remove colour grade" onClick={() => update(null)}>
            Remove grade
          </button>
        </Row>
      )}
    </Section>
  );
};

const LightingProps: React.FC = () => {
  const env = useStudioStore((s) => s.sceneSpec.environment);
  const setLightingPreset = useStudioStore((s) => s.setLightingPreset);
  const update = useStudioStore((s) => s.updateEnvironment);
  return (
    <Section id="s-light" title="Lighting & background" defaultOpen={false} badge={env.presetId}>
      <Row label="Preset">
        <select className="field sm" aria-label="Lighting preset" value={env.presetId} onChange={(e) => setLightingPreset(e.target.value as LightingPresetId)}>
          {Object.keys(LIGHTING_PRESETS).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Background">
        <Color label="Background color" value={env.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} />
      </Row>
      <Row label="Ambient">
        <input type="range" className="rng" aria-label="Ambient intensity" min={0} max={3} step={0.05} value={env.ambientIntensity} onChange={(e) => update({ ambientIntensity: parseFloat(e.target.value) })} />
      </Row>
      <Row label="Key light">
        <Color label="Key light color" value={env.keyLightColor} onChange={(keyLightColor) => update({ keyLightColor })} />
      </Row>
      <Row label="Key intensity">
        <input type="range" className="rng" aria-label="Key light intensity" min={0} max={8} step={0.1} value={env.keyLightIntensity} onChange={(e) => update({ keyLightIntensity: parseFloat(e.target.value) })} />
      </Row>
      <Row label="Rim light">
        <Color label="Rim light color" value={env.rimLightColor} onChange={(rimLightColor) => update({ rimLightColor })} />
      </Row>
      <Row label="Fog (near / far)">
        <div className="pp-vec two">
          <NumField step={1} min={0} ariaLabel="Fog near" value={env.fogNear} onChange={(fogNear) => update({ fogNear })} />
          <NumField step={1} min={1} ariaLabel="Fog far" value={env.fogFar} onChange={(fogFar) => update({ fogFar })} />
        </div>
      </Row>
      <Row label="Ground">
        <Color label="Ground color" value={env.groundColor} onChange={(groundColor) => update({ groundColor })} />
      </Row>
      <Check checked={env.groundGrid} onChange={(groundGrid) => update({ groundGrid })} label="Show ground grid" />
    </Section>
  );
};

const SceneSettings: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const settings = useStudioStore((s) => s.settings);
  const setEngineType = useStudioStore((s) => s.setEngineType);
  const setAspectRatio = useStudioStore((s) => s.setAspectRatio);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const updateGameRules = useStudioStore((s) => s.updateGameRules);
  const setSceneDuration = useStudioStore((s) => s.setSceneDuration);
  const isGame = sceneSpec.mode === 'game';
  const engine: EngineType = sceneSpec.engineType || '3d';
  return (
    <Section id="s-scene" title="Scene settings" defaultOpen={false} badge={`${engine.toUpperCase()} · ${sceneSpec.aspectRatio}`}>
      <Row label="Engine">
        <Segmented<EngineType>
          label="Engine"
          small
          value={engine}
          onChange={setEngineType}
          options={[
            { value: '3d', label: '3D', title: '3D WebGL engine' },
            { value: '2d', label: '2D', title: '2D vector / sprite engine' },
          ]}
        />
      </Row>
      <Row label="Aspect ratio">
        <Segmented<AspectRatioPreset>
          label="Aspect ratio"
          small
          value={sceneSpec.aspectRatio}
          onChange={setAspectRatio}
          options={[
            { value: '16:9', label: '16:9', labelClass: 'font-mono' },
            { value: '9:16', label: '9:16', labelClass: 'font-mono' },
            { value: '1:1', label: '1:1', labelClass: 'font-mono' },
          ]}
        />
      </Row>
      {engine === '2d' && <World2DProps />}
      {isGame ? (
        <>
          <Row label="Gravity" title="Player physics: gravity used by the 2D platformer and jump impulses">
            <NumField step={0.1} ariaLabel="Gravity" value={settings.physicsGravity} onChange={(physicsGravity) => updateSettings({ physicsGravity })} />
          </Row>
          <Row label="Instructions" title="Hint shown over the stage while playing">
            <input
              className="field sm"
              aria-label="Instructions"
              value={sceneSpec.gameRules.instructions}
              onChange={(e) => updateGameRules({ instructions: e.target.value } as Partial<GameRule>)}
            />
          </Row>
          <GameStateSettings />
        </>
      ) : (
        <Row label="Duration (s)">
          <NumField step={1} min={2} max={120} ariaLabel="Scene duration" value={sceneSpec.durationSeconds} onChange={(n) => setSceneDuration(n)} />
        </Row>
      )}
      <Row label="Render quality">
        <select className="field sm" aria-label="Render quality" value={settings.renderQuality} onChange={(e) => updateSettings({ renderQuality: e.target.value as SettingsConfig['renderQuality'] })}>
          <option value="draft">draft</option>
          <option value="high">high</option>
          <option value="ultra-postprocessing">ultra + post</option>
        </select>
      </Row>
      <Check checked={settings.enableBloom} onChange={(enableBloom) => updateSettings({ enableBloom })} label="Bloom (glow)" />
    </Section>
  );
};

const CtaProps: React.FC = () => {
  const cta = useStudioStore((s) => s.sceneSpec.marketingOverlay);
  const update = useStudioStore((s) => s.updateMarketingOverlay);
  return (
    <Section id="s-cta" title="Call to action (end card)" defaultOpen={false} badge={cta.enabled ? 'on' : 'off'}>
      <Check checked={cta.enabled} onChange={(enabled) => update({ enabled })} label="Show CTA banner and end card" />
      <Row label="Headline">
        <input className="field sm" aria-label="Headline" value={cta.headline} onChange={(e) => update({ headline: e.target.value })} />
      </Row>
      <Row label="Subheadline">
        <input className="field sm" aria-label="Subheadline" value={cta.subheadline} onChange={(e) => update({ subheadline: e.target.value })} />
      </Row>
      <Row label="Button label">
        <input className="field sm" aria-label="CTA button label" value={cta.ctaText} onChange={(e) => update({ ctaText: e.target.value })} />
      </Row>
      <Row label="Button link">
        <input className="field sm" aria-label="CTA link" placeholder="https://…" value={cta.ctaUrl || ''} onChange={(e) => update({ ctaUrl: e.target.value })} />
      </Row>
      <Row label="Badge text">
        <input className="field sm" aria-label="Badge text" value={cta.badgeText || ''} onChange={(e) => update({ badgeText: e.target.value })} />
      </Row>
      <Row label="Brand color">
        <Color label="Brand color" value={cta.brandColor || '#F59E0B'} onChange={(brandColor) => update({ brandColor })} />
      </Row>
    </Section>
  );
};

// ----------------------------------------------------------------------------
// Panel
// ----------------------------------------------------------------------------
/** Everything you can change, grouped: the current selection first, then camera, lighting, scene settings and the CTA. */
export const PropertiesPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectedNode2DId = useStudioStore((s) => s.selectedNode2DId);
  const selectedVfxId = useStudioStore((s) => s.selectedVfxId);

  const is2D = sceneSpec.engineType === '2d';
  const duration = Math.max(2, sceneSpec.durationSeconds || 8);
  const actor = !is2D ? sceneSpec.actors.find((a) => a.id === selectedActorId) : undefined;
  const vfx = !is2D && !actor ? sceneSpec.vfx.find((v) => v.id === selectedVfxId) : undefined;
  const node = is2D ? (sceneSpec.nodes2D || []).find((n) => n.id === selectedNode2DId) : undefined;

  return (
    <div className="pp" data-testid="properties-panel">
      {actor ? (
        <ActorProps key={actor.id} actor={actor} duration={duration} />
      ) : vfx ? (
        <VfxProps key={vfx.id} vfx={vfx} duration={duration} />
      ) : node ? (
        <Node2DProps key={node.id} node={node} />
      ) : (
        <div className="pp-empty">
          <MousePointer2 size={16} className="text-dim" />
          <span>{is2D ? 'Select a layer on the stage or in the Scene Graph to edit it.' : 'Select an actor or effect on the stage or in the Scene Graph to edit it.'}</span>
        </div>
      )}

      <div className="pp-scene-h">Scene</div>
      {!is2D && <CameraProps />}
      {!is2D && <LightingProps />}
      {!is2D && <GradeProps />}
      <SceneSettings />
      <CtaProps />
    </div>
  );
};

/** Persistent right-hand Properties dock: always shows the selection (or the scene) so nothing is hidden behind a click. */
export const PropertiesDock: React.FC = () => {
  const open = useShellStore((s) => s.propsOpen);
  const setOpen = useShellStore((s) => s.setPropsOpen);
  const title = useStudioStore((s) => {
    if (s.sceneSpec.engineType === '2d') return (s.sceneSpec.nodes2D || []).find((n) => n.id === s.selectedNode2DId)?.name;
    return s.sceneSpec.actors.find((a) => a.id === s.selectedActorId)?.name || s.sceneSpec.vfx.find((v) => v.id === s.selectedVfxId)?.name;
  });

  if (!open) {
    return (
      <button type="button" className="pp-tab" onClick={() => setOpen(true)} title="Open Properties  [P]" aria-label="Open Properties panel">
        <SlidersHorizontal size={15} />
        <span>Properties</span>
      </button>
    );
  }
  return (
    <aside className="pp-dock" aria-label="Properties">
      <div className="pp-dock-head">
        <SlidersHorizontal size={14} className="text-accent" />
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg">{title ? `Properties · ${title}` : 'Properties'}</h2>
        <Kbd>P</Kbd>
        <IconBtn small label="Hide Properties  [P]" onClick={() => setOpen(false)}>
          <PanelRightClose size={14} />
        </IconBtn>
      </div>
      <div className="pp-dock-body">
        <PropertiesPanel />
      </div>
    </aside>
  );
};
