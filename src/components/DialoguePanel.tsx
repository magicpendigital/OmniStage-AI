import React, { useState } from 'react';
import { MessageSquare, Mic, Play, Plus, Trash2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { DIALOGUE_EMOTIONS, dialogueTimeline, getVoiceClip, PIPER_VOICES, pitchedClip, renderBabble, voiceFor } from '../audio/voices';
import type { DialogueEmotion, DialogueLine, VoiceEngine } from '../types/scene.schema';

let previewCtx: AudioContext | null = null;
function playPcm(data: Float32Array, sampleRate: number) {
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return;
  previewCtx = previewCtx || new Ctor();
  const ctx = previewCtx!;
  void ctx.resume();
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

/** Phase 10C — dialogue editor: lines (speaker, text, emotion, listener), character voices and voice generation. */
export const DialoguePanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const currentTime = useStudioStore((s) => s.currentTime);
  const setDialogue = useStudioStore((s) => s.setDialogue);
  const applyDialogueVoices = useStudioStore((s) => s.applyDialogueVoices);
  const updateActorVoice = useStudioStore((s) => s.updateActorVoice);
  const setDialogueCaptions = useStudioStore((s) => s.setDialogueCaptions);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lines = sceneSpec.dialogue || [];
  const actors = sceneSpec.actors;
  const duration = Math.max(1, sceneSpec.durationSeconds || 8);
  const timed = new Map(dialogueTimeline(sceneSpec).map((t) => [t.line.id, t]));
  const speakers = actors.filter((a) => lines.some((l) => l.speaker === a.id));
  // Voices are generated for the whole storyboard of this scene (or just this scene).
  const storyboardId = sceneSpec.sequence?.storyboardId;
  const targetScenes = storyboardId ? scenes.filter((s) => s.sequence?.storyboardId === storyboardId).map((s) => (s.id === sceneSpec.id ? sceneSpec : s)) : [sceneSpec];
  const pending = targetScenes.reduce((n, s) => n + (s.dialogue || []).filter((l) => !getVoiceClip(l.clip) && voiceFor(s.actors.find((a) => a.id === l.speaker), l.text).engine === 'piper').length, 0);

  const update = (i: number, patch: Partial<DialogueLine>) => {
    const next = lines.map((l, j) => {
      if (j !== i) return l;
      const merged = { ...l, ...patch };
      // Text / speaker / emotion changes make the old voice clip stale.
      if (patch.text !== undefined || patch.speaker !== undefined || patch.emotion !== undefined) {
        delete merged.clip;
        delete merged.duration;
      }
      return merged;
    });
    setDialogue(next);
  };

  const addLine = () => {
    const speaker = actors[0]?.id;
    if (!speaker) return;
    const time = Math.min(duration - 0.5, Math.round(currentTime * 10) / 10);
    setDialogue([...lines, { id: `line-${Date.now().toString(36)}`, time: Math.max(0, time), speaker, text: 'Xin chào!' }]);
  };

  const preview = (line: DialogueLine) => {
    const tl = timed.get(line.id);
    const voice = voiceFor(actors.find((a) => a.id === line.speaker), line.text);
    const clip = getVoiceClip(line.clip);
    if (clip && line.clip) playPcm(pitchedClip(line.clip, clip, 32000, voice.pitch), 32000);
    else playPcm(renderBabble(line, voice, 32000, /robot/i.test(tl?.speaker?.assetId || '')), 32000);
  };

  const generate = async () => {
    setBusy('Preparing voices…');
    setNotice(null);
    try {
      const { generateDialogueVoices } = await import('../audio/piperVoice');
      const res = await generateDialogueVoices(targetScenes, (p) => setBusy(`${p.label} ${Math.round(p.ratio * 100)}%`));
      applyDialogueVoices(res.dialogue);
      setNotice(res.failed.length ? `Some lines kept the babble voice: ${res.failed[0]}` : `Voices ready (${res.generated} new).`);
    } catch (e) {
      setNotice(`Voice generation failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-100">
          <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
          <span>Dialogue</span>
        </div>
        <button
          onClick={addLine}
          disabled={!actors.length}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 hover:border-sky-500/60 text-[11px] text-slate-200 disabled:opacity-40"
          title="Add a line at the playhead"
        >
          <Plus className="w-3 h-3" /> line at {currentTime.toFixed(1)}s
        </button>
      </div>

      {lines.map((line, i) => {
        const tl = timed.get(line.id);
        return (
          <div key={line.id} className="space-y-1 p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={0} max={duration} step={0.1} value={line.time}
                onChange={(e) => update(i, { time: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-14 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-slate-100"
                title="Start (s)"
              />
              <select value={line.speaker} onChange={(e) => update(i, { speaker: e.target.value })}
                className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100" title="Speaker">
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={line.emotion || 'neutral'} onChange={(e) => update(i, { emotion: e.target.value as DialogueEmotion })}
                className="w-20 px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-100" title="Emotion">
                {DIALOGUE_EMOTIONS.map((em) => <option key={em} value={em}>{em}</option>)}
              </select>
              <button onClick={() => preview(line)} className="text-slate-400 hover:text-sky-300" title="Hear this line"><Play className="w-3.5 h-3.5" /></button>
              <button onClick={() => setDialogue(lines.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-400" title="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <textarea
              value={line.text} rows={2}
              onChange={(e) => update(i, { text: e.target.value })}
              className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 resize-none"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <label className="flex items-center gap-1">
                to
                <select value={line.listener || ''} onChange={(e) => update(i, { listener: e.target.value || undefined })}
                  className="px-1 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
                  <option value="">(nobody)</option>
                  {actors.filter((a) => a.id !== line.speaker).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <span>{tl ? `${tl.start.toFixed(1)}–${tl.end.toFixed(1)}s` : 'outside the scene'} · {getVoiceClip(line.clip) ? 'voice ready' : 'babble'}</span>
            </div>
          </div>
        );
      })}

      {speakers.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-slate-800">
          <div className="text-[11px] text-slate-400">Voices</div>
          {speakers.map((a) => {
            const v = voiceFor(a, lines.find((l) => l.speaker === a.id)?.text || '');
            const set = (patch: Partial<typeof v>) => updateActorVoice(a.id, { ...(a.voice || {}), ...patch });
            return (
              <div key={a.id} className="grid grid-cols-[4.5rem_1fr] items-center gap-1.5 text-[11px]">
                <span className="truncate text-slate-300" title={a.name}>{a.name}</span>
                <div className="flex items-center gap-1">
                  <select value={v.engine} onChange={(e) => set({ engine: e.target.value as VoiceEngine })}
                    className="px-1 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-100" title="Voice engine">
                    <option value="piper">Real voice</option>
                    <option value="babble">Babble</option>
                  </select>
                  {v.engine === 'piper' && (
                    <select value={v.voiceId} onChange={(e) => set({ voiceId: e.target.value })}
                      className="flex-1 min-w-0 px-1 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-100" title="Piper voice">
                      {PIPER_VOICES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  )}
                  <input type="range" min={-8} max={8} step={1} value={v.pitch} onChange={(e) => set({ pitch: parseInt(e.target.value, 10) })}
                    className="w-14 accent-sky-500" title={`Pitch ${v.pitch > 0 ? '+' : ''}${v.pitch}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lines.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-slate-800">
          <button
            onClick={generate}
            disabled={!!busy}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-sky-600/20 border border-sky-500/50 text-[11px] text-sky-100 hover:bg-sky-600/30 disabled:opacity-60"
            title="Runs Piper in this browser; the first time downloads the voice model (~60 MB)"
          >
            <Mic className="w-3.5 h-3.5" />
            {busy || (pending ? `Generate real voices (${pending} line${pending === 1 ? '' : 's'})` : 'Voices up to date — regenerate')}
          </button>
          <label className="flex items-center justify-between text-[11px] text-slate-300">
            <span>Show as captions</span>
            <input type="checkbox" checked={sceneSpec.dialogueCaptions !== false}
              onChange={(e) => setDialogueCaptions(e.target.checked)}
              className="accent-sky-500" />
          </label>
          {notice && <p className="text-[10px] text-slate-400">{notice}</p>}
        </div>
      )}
    </div>
  );
};
