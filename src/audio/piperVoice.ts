/**
 * Phase 10C — real voices in the studio: Piper neural TTS running in the browser (onnxruntime-web + a Piper voice model,
 * downloaded once from Hugging Face and kept in the browser's private storage). Generated lines are cached as PCM in
 * IndexedDB by content key and registered in the voice-clip registry (src/audio/voices.ts), from where Preview, the
 * MP4 export and the exported Player (embedded WAV) play them. Studio-only: never imported by the Player bundle.
 */
import type { DialogueLine, SceneSpec } from '../types/scene.schema';
import { decodeWav, getVoiceClip, registerVoiceClip, voiceClipKey, voiceFor, VoiceClip, estimateLineDuration } from './voices';

const DB = 'omnistage-voices';
const STORE = 'clips';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet(key: string): Promise<VoiceClip | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => {
      const v = req.result as { sampleRate: number; data: Float32Array } | undefined;
      resolve(v && v.data ? { sampleRate: v.sampleRate, data: new Float32Array(v.data) } : undefined);
    };
    req.onerror = () => resolve(undefined);
  });
}

async function idbPut(key: string, clip: VoiceClip): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ sampleRate: clip.sampleRate, data: clip.data }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

const loadPiper = () => import('@mintplex-labs/piper-tts-web');

/** Piper voices already downloaded in this browser. */
export async function downloadedVoices(): Promise<string[]> {
  try {
    return await (await loadPiper()).stored();
  } catch {
    return [];
  }
}

/** Trims leading / trailing near-silence (Piper pads every sentence) so timing and lip motion line up. */
function trimSilence(clip: VoiceClip): VoiceClip {
  const th = 0.01;
  let a = 0;
  let b = clip.data.length - 1;
  while (a < b && Math.abs(clip.data[a]) < th) a++;
  while (b > a && Math.abs(clip.data[b]) < th) b--;
  const pad = Math.round(clip.sampleRate * 0.03);
  return { sampleRate: clip.sampleRate, data: clip.data.slice(Math.max(0, a - pad), Math.min(clip.data.length, b + pad)) };
}

/** Registers the stored clips the scenes refer to (after opening a project or reloading the page). */
export async function restoreVoiceClips(scenes: Array<Pick<SceneSpec, 'dialogue'>>): Promise<number> {
  let n = 0;
  for (const s of scenes) {
    for (const line of s.dialogue || []) {
      if (!line.clip || getVoiceClip(line.clip)) continue;
      const clip = await idbGet(line.clip);
      if (clip) {
        registerVoiceClip(line.clip, clip);
        n++;
      }
    }
  }
  return n;
}

export interface VoiceProgress {
  phase: 'download' | 'speak';
  /** 0..1 */
  ratio: number;
  label: string;
}

/**
 * Gives every dialogue line of the scenes its voice: Piper lines are synthesised (or taken from the cache), babble
 * lines get their exact length. Returns the updated dialogue per scene id (lines with `clip` / `duration`).
 */
export async function generateDialogueVoices(
  scenes: SceneSpec[],
  onProgress?: (p: VoiceProgress) => void
): Promise<{ dialogue: Record<string, DialogueLine[]>; generated: number; failed: string[] }> {
  const out: Record<string, DialogueLine[]> = {};
  const failed: string[] = [];
  let generated = 0;
  const total = scenes.reduce((n, s) => n + (s.dialogue?.length || 0), 0);
  let done = 0;
  let piper: Awaited<ReturnType<typeof loadPiper>> | null = null;
  for (const scene of scenes) {
    if (!scene.dialogue?.length) continue;
    const lines: DialogueLine[] = [];
    for (const line of scene.dialogue) {
      const speaker = scene.actors.find((a) => a.id === line.speaker);
      const voice = voiceFor(speaker, line.text);
      const next: DialogueLine = { ...line };
      if (voice.engine === 'babble' || !line.text.trim()) {
        delete next.clip;
        next.duration = Math.round(estimateLineDuration(line, voice) * 1000) / 1000;
      } else {
        const key = voiceClipKey(line, voice);
        let clip = getVoiceClip(key) || (await idbGet(key));
        if (!clip) {
          try {
            piper = piper || (await loadPiper());
            const stored = await piper.stored();
            const wav = await piper.predict({ text: line.text, voiceId: voice.voiceId }, (p: any) => {
              if (!stored.includes(voice.voiceId) && p?.total) onProgress?.({ phase: 'download', ratio: p.loaded / p.total, label: `Downloading voice ${voice.voiceId}` });
            });
            const decoded = decodeWav(new Uint8Array(await wav.arrayBuffer()));
            if (!decoded) throw new Error('unreadable voice audio');
            clip = trimSilence(decoded);
            await idbPut(key, clip);
            generated++;
          } catch (err) {
            failed.push(`${line.text.slice(0, 30)}: ${(err as Error)?.message || err}`);
          }
        }
        if (clip) {
          registerVoiceClip(key, clip);
          next.clip = key;
          // spoken length after the character's pitch shift (the renderer resamples by 2^(pitch/12))
          next.duration = Math.round((clip.data.length / clip.sampleRate / Math.pow(2, voice.pitch / 12)) * 1000) / 1000;
        } else {
          delete next.clip;
          next.duration = Math.round(estimateLineDuration(line, voice) * 1000) / 1000;
        }
      }
      lines.push(next);
      done++;
      onProgress?.({ phase: 'speak', ratio: done / Math.max(1, total), label: `Voicing line ${done}/${total}` });
    }
    out[scene.id] = lines;
  }
  return { dialogue: out, generated, failed };
}
