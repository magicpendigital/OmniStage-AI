import React from 'react';
import { useStudioStore } from '../state/useStudioStore';
import type { ActorStateMachine } from '../types/scene.schema';

/** Phase 9: lists a behaviour state machine's states in the inspector and highlights the live one during Play. */
export const StateMachineBadge: React.FC<{ id: string; machine: ActorStateMachine }> = ({ id, machine }) => {
  const live = useStudioStore((s) => (s.isPlaying ? s.machineStates?.[id] : undefined));
  const names = Object.keys(machine.states || {});
  return (
    <div className="space-y-1">
      <span className="text-[11px] font-mono text-violet-300">Behaviour State Machine ({names.length})</span>
      <div className="flex flex-wrap gap-1">
        {names.map((name) => (
          <span
            key={name}
            className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${
              name === live
                ? 'bg-violet-500/30 border-violet-400 text-violet-100'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            {name === machine.initial ? '▶ ' : ''}
            {name}
          </span>
        ))}
      </div>
    </div>
  );
};
