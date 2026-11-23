/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { TopNavBar } from './components/TopNavBar';
import { IconRail, PanelFlyout } from './components/LeftAssetDrawer';
import { CenterViewport } from './components/CenterViewport';
import { PublishModal } from './components/PublishModal';
import { SettingsModal } from './components/SettingsModal';
import { useShellStore } from './state/useShellStore';
import { ProjectHubModal } from './components/ProjectHubModal';
import { ExtensionsModal } from './components/ExtensionsModal';
import { ExtensionReviewDialog } from './components/ExtensionReviewDialog';
import { PlayTestModal } from './components/PlayTestModal';
import { FullPreviewOverlay } from './components/FullPreviewOverlay';
import { GuideModal } from './components/GuideModal';
import { WritersRoomModal } from './components/WritersRoomModal';
import { WelcomeTour } from './components/WelcomeTour';
import { useStudioStore } from './state/useStudioStore';
import { useProjectAutosave } from './workspace/useProjectAutosave';
import { useUndoShortcuts } from './state/useUndoShortcuts';
import { usePlayShortcuts } from './state/usePlayShortcuts';
import { StartScreen } from './components/StartScreen';
import { StaleDraftsDialog } from './components/StaleDraftsDialog';
import { PropertiesDock } from './components/panels/PropertiesPanel';

/**
 * Adaptive Docking Studio shell:
 *   top bar · 48px icon rail · pinned-or-floating panel flyout · workspace (stage / node graph)
 *   with the AI Director floating over it · Properties dock on the right · unified bottom dock.
 */
export default function App() {
  const focusMode = useShellStore((s) => s.focusMode);
  const railPanel = useShellStore((s) => s.railPanel);
  const flyoutPinned = useShellStore((s) => s.flyoutPinned);
  const showFlyout = !focusMode && railPanel !== null;

  // Phase 6: connect to the local workspace (projects, extensions, memory) and autosave the open game.
  useEffect(() => {
    // After the workspace has reopened the last draft, an empty first launch gets the start screen.
    useStudioStore
      .getState()
      .initWorkspace()
      .finally(() => {
        const s = useStudioStore.getState();
        if (!s.activeGameId && !s.activeDraftId && s.pastSpecs.length === 0 && s.chatMessages.length <= 1) useShellStore.getState().setStartOpen(true);
      });
  }, []);
  useProjectAutosave();
  useUndoShortcuts();
  usePlayShortcuts();

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-bg text-fg">
      {!focusMode && <TopNavBar />}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {!focusMode && <IconRail />}
        {showFlyout && flyoutPinned && <PanelFlyout />}

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <CenterViewport />
          {showFlyout && !flyoutPinned && <PanelFlyout />}
        </div>
        {/* Docked Play Test renders here (portal) so the stage stays editable beside it. */}
        <div id="play-dock-slot" className="flex shrink-0 empty:hidden" />
        {!focusMode && <PropertiesDock />}
      </div>

      {/* Distribution & Export Modal */}
      <PublishModal />

      {/* Studio Settings & External Asset Hub Modal */}
      <SettingsModal />

      {/* Phase 6: projects, extensions and the install approval gate */}
      <ProjectHubModal />
      <StaleDraftsDialog />
      <ExtensionsModal />
      <ExtensionReviewDialog />

      {/* Phase 6 batch 2: play test, full preview, guide + first-run tour */}
      <PlayTestModal />
      <FullPreviewOverlay />
      <GuideModal />
      <WritersRoomModal />
      <StartScreen />
      <WelcomeTour />
    </div>
  );
}
