import React, { useRef } from 'react';
import { AudioLines, Captions, Mic, Plus, Trash2, Upload, Volume2, VolumeX } from 'lucide-react';
import { useStudioStore, withCaptionIds } from '../../state/useStudioStore';
import { DialoguePanel } from '../DialoguePanel';
import { SoundtrackPanel } from '../SoundtrackPanel';
import { AudioCuePanel } from '../AudioCuePanel';
import { CaptionsPanel } from '../CaptionsPanel';
import { useShellStore } from '../../state/useShellStore';
import { AudioTrackKind } from '../../types/scene.schema';

export const AUDIO_KIND_COLOR: Record<AudioTrackKind, string> = {
  music: '#7aa2ff',
  sfx: '#43d9c0',
  voice: '#f58fc0',
};

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speakText(text: string) {
  if (!canSpeak() || !text.trim()) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

/** Audio & Voiceover: the scene's audio tracks and spoken caption cues. */
export const AudioPanel: React.FC = () => {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const audioTracks = useStudioStore((s) => s.sceneSpec.audioTracks) || [];
  const captions = withCaptionIds(useStudioStore((s) => s.sceneSpec.captions));
  const libraryAudio = useStudioStore((s) => s.savedExternalAssets).filter((a) => a.kind === 'audio');

  const importLocalDirectoryAssets = useStudioStore((s) => s.importLocalDirectoryAssets);
  const spawnSavedAsset = useStudioStore((s) => s.spawnSavedAsset);
  const updateAudioTrack = useStudioStore((s) => s.updateAudioTrack);
  const removeAudioTrack = useStudioStore((s) => s.removeAudioTrack);
  const addCaption = useStudioStore((s) => s.addCaption);
  const updateCaption = useStudioStore((s) => s.updateCaption);
  const removeCaption = useStudioStore((s) => s.removeCaption);
  const setCurrentTime = useStudioStore((s) => s.setCurrentTime);
  const setBottomDockCollapsed = useStudioStore((s) => s.setBottomDockCollapsed);
  const setDockTab = useShellStore((s) => s.setDockTab);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const imported = importLocalDirectoryAssets(files).filter((a) => a.kind === 'audio');
    imported.forEach((a) => spawnSavedAsset(a.id));
  };

  return (
    <>
      <div className="grp">
        <AudioLines size={11} /> Audio tracks
        <span className="ml-auto font-mono normal-case tracking-normal">{audioTracks.length}</span>
      </div>
      <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
        <Upload size={14} className="text-accent" /> Import audio (.mp3 / .wav / .ogg)
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".mp3,.wav,.ogg,audio/*"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {audioTracks.length === 0 && (
        <p className="text-[11px] text-dim">
          No audio in this scene. Imported tracks play in sync with the timeline during playback.
        </p>
      )}
      {audioTracks.map((track) => (
        <div key={track.id} className="card space-y-1.5" style={{ padding: 8 }}>
          <div className="flex items-center gap-1.5">
            <i className="tag-dot" style={{ background: AUDIO_KIND_COLOR[track.kind] }} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium" title={track.name}>{track.name}</span>
            <button
              type="button"
              className={`orow-b keep ${track.muted ? 'text-warn' : ''}`}
              aria-pressed={Boolean(track.muted)}
              aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
              title={track.muted ? 'Unmute' : 'Mute'}
              onClick={() => updateAudioTrack(track.id, { muted: !track.muted })}
            >
              {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <button type="button" className="orow-b keep danger" aria-label={`Remove ${track.name}`} title="Remove track" onClick={() => removeAudioTrack(track.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-mute">
            <select
              className="field sm"
              aria-label="Track kind"
              value={track.kind}
              onChange={(e) => updateAudioTrack(track.id, { kind: e.target.value as AudioTrackKind })}
            >
              <option value="music">Music</option>
              <option value="sfx">SFX</option>
              <option value="voice">Voice</option>
            </select>
            <input
              type="range"
              className="rng min-w-0 flex-1"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={track.volume}
              onChange={(e) => updateAudioTrack(track.id, { volume: parseFloat(e.target.value) })}
            />
            <span className="w-8 text-right font-mono">{Math.round(track.volume * 100)}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-mute">
            <label className="flex items-center gap-1.5">
              Start
              <input
                type="number"
                className="field sm w-14 text-right font-mono"
                min={0}
                step={0.1}
                value={track.startTime}
                onChange={(e) => updateAudioTrack(track.id, { startTime: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
              s
            </label>
            <label className="ml-auto flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(track.loop)}
                onChange={(e) => updateAudioTrack(track.id, { loop: e.target.checked })}
                className="accent-[rgb(var(--accent))]"
              />
              Loop
            </label>
          </div>
        </div>
      ))}

      {libraryAudio.length > 0 && (
        <>
          <div className="grp">From your library</div>
          <div className="flex flex-wrap gap-1">
            {libraryAudio.map((a) => (
              <button key={a.id} type="button" className="tag" title="Add to this scene" onClick={() => spawnSavedAsset(a.id)}>
                <Plus size={10} /> {a.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="grp">
        <Mic size={11} /> Voiceover &amp; captions
        <span className="ml-auto font-mono normal-case tracking-normal">{captions.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className="btn" onClick={() => addCaption({ speak: canSpeak() })}>
          <Plus size={13} /> Add at playhead
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setDockTab('captions');
            setBottomDockCollapsed(false);
          }}
        >
          <Captions size={13} /> Open mixer
        </button>
      </div>
      {!canSpeak() && (
        <p className="text-[11px] text-warn">This browser has no speech synthesis, so cues display as captions only.</p>
      )}
      {captions.map((cue) => (
        <div key={cue.id} className="card space-y-1.5" style={{ padding: 8 }}>
          <textarea
            className="field w-full"
            rows={2}
            aria-label="Caption text"
            value={cue.text}
            onChange={(e) => updateCaption(cue.id, { text: e.target.value })}
          />
          <div className="flex items-center gap-1.5 text-[11px] text-mute">
            <button type="button" className="font-mono text-accent hover:underline" title="Jump playhead to this cue" onClick={() => setCurrentTime(cue.start)}>
              {cue.start.toFixed(1)}s–{cue.end.toFixed(1)}s
            </button>
            <label className="ml-auto flex items-center gap-1.5" title="Read this cue aloud when it starts">
              <input
                type="checkbox"
                checked={Boolean(cue.speak)}
                disabled={!canSpeak()}
                onChange={(e) => updateCaption(cue.id, { speak: e.target.checked })}
                className="accent-[rgb(var(--media))]"
              />
              Voice
            </label>
            <button type="button" className="orow-b keep" disabled={!canSpeak()} aria-label="Preview voiceover" title="Preview voiceover" onClick={() => speakText(cue.text)}>
              <Volume2 size={12} />
            </button>
            <button type="button" className="orow-b keep danger" aria-label="Delete caption" title="Delete caption" onClick={() => removeCaption(cue.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}

      {/* Phase 4 / 5 / 10C: dialogue lines, film soundtrack, game SFX cues, caption styling and WebVTT/SRT */}
      <div className="space-y-4 pt-2 text-xs">
        <DialoguePanel />
        <SoundtrackPanel />
        <AudioCuePanel icon={<Volume2 className="w-3.5 h-3.5 text-violet-400" />} />
        <CaptionsPanel />
      </div>
    </>
  );
};
