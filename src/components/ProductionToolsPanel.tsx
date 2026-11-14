/**
 * Phase 10D — Settings → Production tools: Director QA (vision review of film shots) and paid tools you bring your own key
 * for (ElevenLabs voices / SFX / music). Keys stay in this browser and go to the local server as headers only.
 */
import React, { useState } from 'react';
import { AudioLines, Clapperboard, KeyRound, Loader2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { providerInfo } from '../agent/aiClient';
import { DEFAULT_ELEVENLABS_TTS_MODEL } from '../audio/elevenLabs';
import { workspaceApi } from '../workspace/workspaceClient';

const input = 'w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500';

export function ProductionToolsPanel() {
  const settings = useStudioStore((s) => s.settings);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const activeProject = useStudioStore((s) => s.activeProject);
  const addAudioTrack = useStudioStore((s) => s.addAudioTrack);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tool, setTool] = useState<'sfx' | 'music'>('sfx');
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(3);
  const vision = providerInfo(settings.aiProvider || 'gemini').vision;

  const test = async () => {
    setBusy('test');
    setStatus(null);
    try {
      const { elevenLabsStatus, listElevenLabsVoices } = await import('../audio/elevenLabsClient');
      const st = await elevenLabsStatus(settings);
      if (!st.configured) {
        setStatus('No key yet: paste your ElevenLabs API key above (or set ELEVENLABS_API_KEY for the local server).');
        return;
      }
      const voices = await listElevenLabsVoices(settings);
      setStatus(`Connected${st.serverKey && !settings.elevenLabsApiKey ? ' (server key)' : ''} · ${voices.length} voice(s) available.`);
    } catch (e: any) {
      setStatus(e?.message || 'ElevenLabs test failed');
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy('generate');
    setStatus(null);
    try {
      const { generateElevenLabsAudio, libraryScopeFor, recordElevenLabsAsset } = await import('../audio/elevenLabsClient');
      const blob = await generateElevenLabsAudio(tool, prompt, settings, seconds);
      const scope = libraryScopeFor(activeProject?.id);
      const asset = await recordElevenLabsAsset(scope, tool, blob, { prompt, name: prompt });
      if (asset) {
        addAudioTrack({ name: asset.name, url: workspaceApi.assetUrl(scope, asset.id), kind: tool === 'sfx' ? 'sfx' : 'music', startTime: 0, volume: 0.8, loop: tool === 'music' });
        setStatus(`Saved "${asset.name}" with its licence to the ${activeProject ? 'project' : 'personal'} library and added it as an audio track.`);
      } else {
        setStatus('Generated, but the local library is not reachable, so the file and licence were not saved.');
      }
    } catch (e: any) {
      setStatus(e?.message || 'Generation failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Clapperboard className="w-3.5 h-3.5 text-cyan-400" />
          <span>Director QA (film shots)</span>
        </div>
        <label className="flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={settings.directorQA !== false} onChange={(e) => updateSettings({ directorQA: e.target.checked })} />
          After the AI writes a 3D film shot, render its keyframes and let the AI review them like a director
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          Fix the shot when the score is under
          <input type="number" min={1} max={100} value={settings.directorQAThreshold ?? 70}
            onChange={(e) => updateSettings({ directorQAThreshold: Math.max(1, Math.min(100, Number(e.target.value) || 70)) })}
            className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100" />
          / 100 (one extra edit round)
        </label>
        <p className={`text-[11px] ${vision ? 'text-slate-400' : 'text-amber-300'}`}>
          {vision
            ? 'Works with your current AI connection (it can see images).'
            : 'Your current AI connection is a CLI and cannot see images, so Director QA is skipped. Use Gemini, Anthropic, OpenRouter or an OpenAI-compatible connection.'}
        </p>
      </div>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span>ElevenLabs (your own key)</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Paid voices, sound effects and music. The key is stored only in this browser and sent to the local OmniStage server as a header
          for each request; it is never saved in scenes or exports. Every generated file is saved to the library with its licence record.
          Paid ElevenLabs plans include commercial use; free plans need attribution.
        </p>
        <input type="password" autoComplete="off" value={settings.elevenLabsApiKey || ''} onChange={(e) => updateSettings({ elevenLabsApiKey: e.target.value })}
          placeholder="ElevenLabs API key" className={`${input} font-mono`} />
        <input value={settings.elevenLabsModel || ''} onChange={(e) => updateSettings({ elevenLabsModel: e.target.value.trim() })}
          placeholder={`Voice model (default ${DEFAULT_ELEVENLABS_TTS_MODEL}; eleven_v3 adds emotion tags)`} className={`${input} font-mono`} />
        <div className="flex items-center gap-2">
          <button onClick={test} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 disabled:opacity-50">
            {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Test connection'}
          </button>
          <span className="text-[11px] text-slate-400">Pick ElevenLabs voices per character (or per line) in the Dialogue panel.</span>
        </div>

        <div className="pt-2 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-1.5 text-slate-200">
            <AudioLines className="w-3.5 h-3.5 text-cyan-400" />
            <span>Generate a sound for this scene</span>
          </div>
          <div className="flex gap-2">
            <select value={tool} onChange={(e) => { const t = e.target.value as 'sfx' | 'music'; setTool(t); setSeconds(t === 'sfx' ? 3 : 30); }}
              className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100">
              <option value="sfx">Sound effect</option>
              <option value="music">Music</option>
            </select>
            <input type="number" min={tool === 'sfx' ? 0.5 : 10} max={tool === 'sfx' ? 22 : 300} step={tool === 'sfx' ? 0.5 : 5} value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value) || 0)} className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100" title="Seconds" />
            <span className="self-center text-slate-400">s</span>
          </div>
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} className={input}
            placeholder={tool === 'sfx' ? 'e.g. wooden door creaks open slowly' : 'e.g. gentle piano, warm and hopeful, 90 bpm'} />
          <button onClick={generate} disabled={!!busy || !prompt.trim()} className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50">
            {busy === 'generate' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Generate & add to scene'}
          </button>
        </div>
        {status && <p className="text-[11px] text-slate-300">{status}</p>}
      </div>
    </div>
  );
}
