/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { TopNavBar } from './components/TopNavBar';
import { LeftAssetDrawer } from './components/LeftAssetDrawer';
import { CenterViewport } from './components/CenterViewport';
import { RightAgentChat } from './components/RightAgentChat';
import { PublishModal } from './components/PublishModal';
import { SettingsModal } from './components/SettingsModal';
import { ProjectHubModal } from './components/ProjectHubModal';
import { ExtensionsModal } from './components/ExtensionsModal';
import { ExtensionReviewDialog } from './components/ExtensionReviewDialog';
import { useStudioStore } from './state/useStudioStore';
import { useProjectAutosave } from './workspace/useProjectAutosave';

export default function App() {
  // Phase 6: connect to the local workspace (projects, extensions, memory) and autosave the open game.
  useEffect(() => {
    useStudioStore.getState().initWorkspace();
  }, []);
  useProjectAutosave();

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#090D16] text-slate-100 flex flex-col select-none">
      {/* Top Studio Bar */}
      <TopNavBar />

      {/* Main 3-Column Docked 3D/2D Workstation */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <LeftAssetDrawer />
        <CenterViewport />
        <RightAgentChat />
      </div>

      {/* Distribution & Export Modal */}
      <PublishModal />

      {/* Studio Settings & External Asset Hub Modal */}
      <SettingsModal />

      {/* Phase 6: projects, extensions and the install approval gate */}
      <ProjectHubModal />
      <ExtensionsModal />
      <ExtensionReviewDialog />
    </div>
  );
}
