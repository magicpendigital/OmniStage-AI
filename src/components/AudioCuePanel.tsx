import React from 'react';
import { GAME_AUDIO_EVENTS, previewSfx, resolveAudioSpec, SFX_PRESET_IDS } from '../audio/audioBus';
import { enabledContributions } from '../extensions/registry';
import { useStudioStore } from '../state/useStudioStore';
import { SfxPresetId } from '../types/scene.schema';

/** Phase 4 — per-scene procedural SFX cue editor (World tab). */
export const AudioCuePanel: React.FC<{ icon?: React.ReactNode }> = ({ icon }) => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const updateSceneAudio = useStudioStore((s) => s.updateSceneAudio);
  const audio = resolveAudioSpec(sceneSpec);
  const installedExtensions = useStudioStore((s) => s.installedExtensions);
  const activeProject = useStudioStore((s) => s.activeProject);
  const extensionSfx = enabledContributions(installedExtensions, activeProject?.extensions).sfxPresets;
  const sceneOnly = Object.keys(sceneSpec.sfxLibrary || {}).filter((k) => !extensionSfx[k]);
  const previewLibrary = { ...extensionSfx, ...(sceneSpec.sfxLibrary || {}) };

  return (
    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
          {icon}
          <span>Procedural Game Audio</span>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={audio.enabled}
            onChange={(e) => updateSceneAudio({ enabled: e.target.checked })}
            className="accent-violet-500"
          />
          Enabled
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400 w-14">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={audio.masterVolume}
          onChange={(e) => updateSceneAudio({ masterVolume: parseFloat(e.target.value) })}
          className="flex-1 accent-violet-500"
        />
        <span className="font-mono text-[11px] text-slate-300 w-8 text-right">
          {Math.round(audio.masterVolume * 100)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        {GAME_AUDIO_EVENTS.map((event) => {
          const cue = audio.cues[event] ?? 'none';
          return (
            <div key={event} className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-400 w-20 shrink-0">{event}</span>
              <select
                value={cue}
                disabled={!audio.enabled}
                onChange={(e) => {
                  const id = e.target.value;
                  updateSceneAudio({ cues: { [event]: id as SfxPresetId | 'none' } }, extensionSfx[id] ? { [id]: extensionSfx[id] } : undefined);
                }}
                className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono text-[11px] text-slate-100 disabled:opacity-50"
              >
                <option value="none">none</option>
                {SFX_PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                {[...Object.keys(extensionSfx), ...sceneOnly].map((id) => (
                  <option key={`ext-${id}`} value={id}>
                    {id} (extension)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={cue === 'none'}
                onClick={() => cue !== 'none' && previewSfx(cue, audio.masterVolume || 0.6, previewLibrary)}
                title="Preview sound"
                aria-label={`Preview ${event} sound`}
                className="px-1.5 py-1 rounded border border-slate-700 text-slate-300 hover:border-violet-400 hover:text-violet-200 disabled:opacity-40"
              >
                ▶
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-500">
        Synthesised in WebAudio: no audio files, and it works offline inside exported playable ads.
      </p>
    </div>
  );
};
