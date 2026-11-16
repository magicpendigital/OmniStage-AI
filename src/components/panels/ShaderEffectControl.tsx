import React from 'react';
import type { ActorNode, ShaderEffect, ShaderEffectPreset } from '../../types/scene.schema';
import { SHADER_EFFECT_INFO, SHADER_EFFECT_PRESETS, isShaderEffectPreset } from '../../runtime/shaderEffects';

/** Phase 6 Batch 3 — actor shader effect: one of the fixed presets plus its colour / intensity (and dissolve progress). */
export const ShaderEffectControl: React.FC<{
  actor: ActorNode;
  onChange: (shaderEffect: ShaderEffect | undefined) => void;
}> = ({ actor, onChange }) => {
  const fx = actor.shaderEffect;
  const set = (patch: Partial<ShaderEffect>) => fx && onChange({ ...fx, ...patch });
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-mono text-slate-400">Shader Effect</span>
      <select
        value={fx?.preset ?? 'none'}
        onChange={(e) => {
          const v = e.target.value;
          onChange(isShaderEffectPreset(v) ? { ...(fx || {}), preset: v as ShaderEffectPreset } : undefined);
        }}
        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
      >
        <option value="none">none</option>
        {SHADER_EFFECT_PRESETS.map((p) => (
          <option key={p} value={p} title={SHADER_EFFECT_INFO[p].hint}>
            {SHADER_EFFECT_INFO[p].label}
          </option>
        ))}
      </select>
      {fx && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          <input
            type="color"
            value={fx.color || SHADER_EFFECT_INFO[fx.preset].color}
            onChange={(e) => set({ color: e.target.value })}
            className="w-7 h-6 rounded bg-slate-950 border border-slate-800"
            title="Effect colour"
          />
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
            Intensity
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={fx.intensity ?? 1}
              onChange={(e) => set({ intensity: parseFloat(e.target.value) })}
              className="flex-1"
            />
          </label>
          {fx.preset === 'dissolve' && !fx.progressTween && (
            <label className="col-span-2 flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
              Progress
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={fx.progress ?? 0}
                onChange={(e) => set({ progress: parseFloat(e.target.value) })}
                className="flex-1"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
};
