import React from 'react';
import { Music, Plus, Trash2 } from 'lucide-react';
import { previewSfx, SFX_PRESET_IDS } from '../audio/audioBus';
import { AMBIENCE_IDS, autoAmbience, DEFAULT_AMBIENCE_VOLUME, DEFAULT_MUSIC_VOLUME, MUSIC_MOODS } from '../audio/soundtrack';
import { useStudioStore } from '../state/useStudioStore';
import type { AmbienceId, MusicMood } from '../types/scene.schema';

/** Phase 10B — film soundtrack editor (World tab): mood music, ambience and timed SFX cues. Plays with the timeline. */
export const SoundtrackPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const updateSoundtrack = useStudioStore((s) => s.updateSoundtrack);
  const currentTime = useStudioStore((s) => s.currentTime);
  const st = sceneSpec.soundtrack;
  const duration = Math.max(1, sceneSpec.durationSeconds || 8);
  const library = Object.keys(sceneSpec.sfxLibrary || {});
  const cues = st?.cues || [];
  const autoLabel = autoAmbience(sceneSpec.world);

  return (
    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
          <Music className="w-3.5 h-3.5 text-pink-400" />
          <span>Film Soundtrack</span>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={!!st}
            onChange={(e) => updateSoundtrack(e.target.checked ? { music: { mood: 'calm' }, ambience: { type: 'auto' } } : null)}
            className="accent-pink-500"
          />
          On
        </label>
      </div>

      {st && (
        <>
          <div className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-1.5 text-[11px]">
            <span className="text-slate-400">Music</span>
            <select
              value={st.music?.mood ?? 'none'}
              onChange={(e) => updateSoundtrack({ music: { ...(st.music || {}), mood: e.target.value as MusicMood } })}
              className="px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
            >
              {MUSIC_MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              type="range" min={0} max={1} step={0.05} title="Music volume"
              value={st.music?.volume ?? DEFAULT_MUSIC_VOLUME}
              onChange={(e) => updateSoundtrack({ music: { mood: st.music?.mood ?? 'calm', volume: parseFloat(e.target.value) } })}
              className="accent-pink-500"
            />
            <span className="text-slate-400">Ambience</span>
            <select
              value={st.ambience?.type ?? 'auto'}
              onChange={(e) => updateSoundtrack({ ambience: { ...(st.ambience || {}), type: e.target.value as AmbienceId } })}
              className="px-2 py-1 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
            >
              {AMBIENCE_IDS.map((a) => <option key={a} value={a}>{a === 'auto' ? `auto (${autoLabel})` : a}</option>)}
            </select>
            <input
              type="range" min={0} max={1} step={0.05} title="Ambience volume"
              value={st.ambience?.volume ?? DEFAULT_AMBIENCE_VOLUME}
              onChange={(e) => updateSoundtrack({ ambience: { type: st.ambience?.type ?? 'auto', volume: parseFloat(e.target.value) } })}
              className="accent-pink-500"
            />
          </div>

          <div className="space-y-1 pt-1 border-t border-slate-800">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Timed SFX cues</span>
              <button
                onClick={() => updateSoundtrack({ cues: [...cues, { time: Math.min(duration - 0.1, Math.round(currentTime * 10) / 10), sfx: 'whoosh' }] })}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 hover:border-pink-500/60 text-slate-200"
                title="Add a cue at the playhead"
              >
                <Plus className="w-3 h-3" /> at {currentTime.toFixed(1)}s
              </button>
            </div>
            {cues.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="number" min={0} max={duration} step={0.1} value={c.time}
                  onChange={(e) => updateSoundtrack({ cues: cues.map((x, j) => (j === i ? { ...x, time: Math.max(0, parseFloat(e.target.value) || 0) } : x)) })}
                  className="w-14 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                />
                <select
                  value={c.sfx}
                  onChange={(e) => {
                    updateSoundtrack({ cues: cues.map((x, j) => (j === i ? { ...x, sfx: e.target.value } : x)) });
                    previewSfx(e.target.value, 0.6, sceneSpec.sfxLibrary);
                  }}
                  className="flex-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 font-mono text-slate-100"
                >
                  {[...SFX_PRESET_IDS, ...library].map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
                <button onClick={() => updateSoundtrack({ cues: cues.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-400" title="Remove cue">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <p className="text-[10px] text-slate-500">Plays with the timeline and Preview; mixed into the MP4 export.</p>
          </div>
        </>
      )}
    </div>
  );
};
