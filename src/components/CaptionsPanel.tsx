import React from 'react';
import { Captions, Download, Plus, Trash2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { CaptionCue } from '../types/scene.schema';
import { captionsToSRT, captionsToWebVTT } from '../media/captions';

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** Phase 5 — per-scene captions / subtitles editor with WebVTT and SRT export. */
export const CaptionsPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const currentTime = useStudioStore((s) => s.currentTime);
  const updateCaptions = useStudioStore((s) => s.updateCaptions);
  const captions = sceneSpec.captions || [];
  const duration = Math.max(1, sceneSpec.durationSeconds || 8);

  const patch = (index: number, change: Partial<CaptionCue>) =>
    updateCaptions(captions.map((c, i) => (i === index ? { ...c, ...change } : c)));

  const addCue = () => {
    const start = Math.min(duration - 0.5, Number(currentTime.toFixed(1)));
    updateCaptions([
      ...captions,
      { id: `cap-${Date.now().toString(36)}`, start, end: Math.min(duration, start + 2), text: 'New caption', position: 'bottom', style: 'subtitle' },
    ]);
  };

  const slug = (sceneSpec.title || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';

  return (
    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
          <Captions className="w-3.5 h-3.5 text-sky-400" />
          <span>Captions & Subtitles</span>
        </div>
        <button
          type="button"
          onClick={addCue}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-[11px] text-slate-200 hover:border-sky-400"
        >
          <Plus className="w-3 h-3" /> Cue at {currentTime.toFixed(1)}s
        </button>
      </div>

      {captions.length === 0 ? (
        <p className="text-[11px] text-slate-500">No captions. Add a cue, or ask the director to "add captions".</p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {captions.map((cue, i) => (
            <div key={cue.id || i} className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={cue.start}
                  onChange={(e) => patch(i, { start: parseFloat(e.target.value) || 0 })}
                  aria-label="Caption start (s)"
                  className="w-14 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-100"
                />
                <span className="text-slate-500 text-[11px]">→</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={cue.end}
                  onChange={(e) => patch(i, { end: parseFloat(e.target.value) || 0 })}
                  aria-label="Caption end (s)"
                  className="w-14 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] text-slate-100"
                />
                <select
                  value={cue.position || 'bottom'}
                  onChange={(e) => patch(i, { position: e.target.value as CaptionCue['position'] })}
                  aria-label="Caption position"
                  className="flex-1 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-100"
                >
                  <option value="bottom">bottom</option>
                  <option value="top">top</option>
                  <option value="center">center</option>
                </select>
                <select
                  value={cue.style || 'subtitle'}
                  onChange={(e) => patch(i, { style: e.target.value as CaptionCue['style'] })}
                  aria-label="Caption style"
                  className="flex-1 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-100"
                >
                  <option value="subtitle">subtitle</option>
                  <option value="title">title</option>
                </select>
                <button
                  type="button"
                  onClick={() => updateCaptions(captions.filter((_, j) => j !== i))}
                  aria-label="Remove caption"
                  className="p-1 rounded text-slate-400 hover:text-rose-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <input
                type="text"
                value={cue.text}
                onChange={(e) => patch(i, { text: e.target.value })}
                aria-label="Caption text"
                className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-100"
              />
            </div>
          ))}
        </div>
      )}

      {captions.length > 0 && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => download(captionsToWebVTT(captions), `${slug}.vtt`, 'text/vtt')}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded border border-slate-700 text-[11px] text-slate-200 hover:border-sky-400"
          >
            <Download className="w-3 h-3" /> .vtt
          </button>
          <button
            type="button"
            onClick={() => download(captionsToSRT(captions), `${slug}.srt`, 'application/x-subrip')}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded border border-slate-700 text-[11px] text-slate-200 hover:border-sky-400"
          >
            <Download className="w-3 h-3" /> .srt
          </button>
        </div>
      )}
      <p className="text-[10px] text-slate-500">
        2D captions are drawn into the canvas (included in WebM). 3D captions are an overlay: export .vtt for video.
      </p>
    </div>
  );
};
