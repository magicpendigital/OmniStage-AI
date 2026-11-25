import React from 'react';
import { COMPARE_OPS, resolveVariables } from '../runtime/game/state';
import type { LogicNode, SceneSpec } from '../types/scene.schema';

/** Phase 3 logic nodes (variables, health, spawning, win / lose). Their inline controls live here instead of the per-category blocks. */
export const STATE_CONDITIONS = ['variable-compare', 'health-check', 'random-chance'];
export const STATE_ACTIONS = ['set-variable', 'add-variable', 'damage', 'heal', 'win', 'lose', 'spawn', 'despawn'];

export function isStateNode(node: Pick<LogicNode, 'params'>): boolean {
  const p = node.params || {};
  return STATE_CONDITIONS.includes(String(p.conditionType)) || STATE_ACTIONS.includes(String(p.actionType));
}

const INPUT = 'w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 font-mono tabular-nums';
const CAP = 'text-slate-400 font-mono text-[10px] block mb-0.5';

export const StateNodeFields: React.FC<{ node: LogicNode; spec: SceneSpec; onChange: (params: Record<string, unknown>) => void }> = ({ node, spec, onChange }) => {
  const p = node.params || {};
  const kind = String(p.conditionType || p.actionType);
  const variables = resolveVariables(spec);
  const entities = spec.engineType === '2d' ? spec.nodes2D.filter((n) => !n.prefab) : spec.actors;
  const prefabs = spec.nodes2D.filter((n) => n.prefab);

  const num = (key: string, label: string, step = 1, fallback = 0) => (
    <div>
      <span className={CAP}>{label}</span>
      <input type="number" step={step} aria-label={label} value={p[key] ?? fallback} onChange={(e) => onChange({ [key]: Number(e.target.value) })} className={INPUT} />
    </div>
  );
  const optNum = (key: string, label: string) => (
    <div>
      <span className={CAP}>{label}</span>
      <input type="number" step={10} aria-label={label} placeholder="prefab's own" value={p[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })} className={INPUT} />
    </div>
  );
  const variable = (
    <div>
      <span className={CAP}>Variable</span>
      <select aria-label="Variable" value={String(p.variableId ?? '')} onChange={(e) => onChange({ variableId: e.target.value })} className={INPUT}>
        <option value="">(pick one)</option>
        {variables.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label || v.id}
          </option>
        ))}
      </select>
    </div>
  );
  const op = (
    <div>
      <span className={CAP}>Compare</span>
      <select aria-label="Comparison" value={String(p.op ?? '>=')} onChange={(e) => onChange({ op: e.target.value })} className={INPUT}>
        {COMPARE_OPS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
  const entity = (label: string, key = 'actorId') => (
    <div>
      <span className={CAP}>{label}</span>
      <select aria-label={label} value={String(p[key] ?? '')} onChange={(e) => onChange({ [key]: e.target.value || undefined })} className={INPUT}>
        <option value="">the player</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );

  let body: React.ReactNode = null;
  switch (kind) {
    case 'variable-compare':
      body = <div className="grid grid-cols-3 gap-1.5">{variable}{op}{num('value', 'Value')}</div>;
      break;
    case 'health-check':
      body = <div className="grid grid-cols-3 gap-1.5">{entity('Entity')}{op}{num('value', 'Health')}</div>;
      break;
    case 'random-chance':
      body = <div className="grid grid-cols-2 gap-1.5">{num('chance', 'Chance (0-1)', 0.05, 0.5)}</div>;
      break;
    case 'set-variable':
    case 'add-variable':
      body = <div className="grid grid-cols-2 gap-1.5">{variable}{num('value', kind === 'set-variable' ? 'Set to' : 'Add')}</div>;
      break;
    case 'damage':
    case 'heal':
      body = <div className="grid grid-cols-2 gap-1.5">{entity('Entity')}{num('amount', 'Amount', 1, 1)}</div>;
      break;
    case 'spawn':
      body = (
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <span className={CAP}>Prefab</span>
            <select aria-label="Prefab" value={String(p.prefabId ?? '')} onChange={(e) => onChange({ prefabId: e.target.value })} className={INPUT}>
              <option value="">(pick one)</option>
              {prefabs.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          {optNum('x', 'X')}
          {optNum('y', 'Y')}
        </div>
      );
      break;
    case 'despawn':
      body = <div className="grid grid-cols-1 gap-1.5">{entity('Entity')}</div>;
      break;
    case 'win':
      body = <div className="text-slate-400">Ends the game as a win.</div>;
      break;
    case 'lose':
      body = <div className="text-slate-400">Ends the game as a loss.</div>;
      break;
    default:
      return null;
  }
  return <div className="space-y-1.5">{body}</div>;
};
