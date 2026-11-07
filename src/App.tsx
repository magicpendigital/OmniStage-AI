/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TopNavBar } from './components/TopNavBar';
import { LeftAssetDrawer } from './components/LeftAssetDrawer';
import { CenterViewport } from './components/CenterViewport';
import { RightAgentChat } from './components/RightAgentChat';
import { PublishModal } from './components/PublishModal';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
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
    </div>
  );
}
