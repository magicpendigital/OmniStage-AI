import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAudioBus } from './audio/audioBus';
import { useStudioStore } from './state/useStudioStore';

// Phase 4: procedural SFX for gameplay events (collect / hit / win / lose / scene-start) in both engines.
installAudioBus(useStudioStore);

createRoot(document.getElementById('root')!).render(<App />);
