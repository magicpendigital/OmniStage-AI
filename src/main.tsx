import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAudioBus } from './audio/audioBus';
import { useStudioStore } from './state/useStudioStore';

// Phase 4: procedural SFX for gameplay events (collect / hit / win / lose / scene-start) in both engines.
installAudioBus(useStudioStore);

// Phase 10C: generated voices live in IndexedDB; register the ones the open scenes use (after a reload / project open).
let restoring = false;
let restoredFor = '';
useStudioStore.subscribe((s) => {
  const key = s.scenes.map((sc) => (sc.dialogue || []).map((l) => l.clip || '').join(',')).join('|');
  if (restoring || key === restoredFor || !key.replace(/[|,]/g, '')) return;
  restoring = true;
  restoredFor = key;
  void import('./audio/piperVoice')
    .then((m) => m.restoreVoiceClips(s.scenes))
    .finally(() => { restoring = false; });
});

createRoot(document.getElementById('root')!).render(<App />);
