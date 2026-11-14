/** Phase 6 batch 2 — "Try it" buttons in the Guide and chat answers. */
import { useStudioStore } from '../state/useStudioStore';
import type { GuideAction } from './guideContent';

export const START_TOUR_EVENT = 'omnistage:start-tour';
export const SETTINGS_TAB_EVENT = 'omnistage:settings-tab';

/** Starts the full-screen preview from the editor (switches the workspace back to the viewport first). */
export function startPreview() {
  const s = useStudioStore.getState();
  if (s.workspaceView === 'node-graph') s.setWorkspaceView('viewport');
  s.startFullPreview();
}

export function runGuideAction(action: GuideAction) {
  const s = useStudioStore.getState();
  s.closeGuide();
  switch (action) {
    case 'playtest':
    case 'phone':
      s.openPlayTest();
      break;
    case 'preview':
      startPreview();
      break;
    case 'projects':
      s.setProjectHubOpen(true);
      break;
    case 'extensions':
      s.setExtensionsOpen(true);
      break;
    case 'publish':
      s.setPublishModalOpen(true);
      break;
    case 'settings-ai':
    case 'settings-memory':
      s.setSettingsModalOpen(true);
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(SETTINGS_TAB_EVENT, { detail: action === 'settings-ai' ? 'ai' : 'memory' })), 0);
      break;
    case 'tour':
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(START_TOUR_EVENT)), 0);
      break;
  }
}
