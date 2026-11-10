import React from 'react';
import { Copy, Lock, Maximize2, Move, RotateCw, Trash2, Trophy, Unlock } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import {
  ActorNode,
  AnimationType,
  Node2D,
  Physics2DRole,
  TransformMode,
} from '../types/scene.schema';

/** Floating 3D actor inspector: gizmo mode, skeletal clip, motion, color, lock / duplicate / delete. */
export const ActorInspectorPill: React.FC<{ selectedActor: ActorNode }> = ({ selectedActor }) => {
  const transformMode = useStudioStore((s) => s.transformMode);
  const setTransformMode = useStudioStore((s) => s.setTransformMode);
  const updateActorProperty = useStudioStore((s) => s.updateActorProperty);
  const duplicateActor = useStudioStore((s) => s.duplicateActor);
  const removeActor = useStudioStore((s) => s.removeActor);

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl bg-[#090D16F2] border border-cyan-500/40 shadow-2xl flex items-center gap-2 z-20 max-w-[95%] overflow-x-auto">
      <span className="text-xs font-semibold text-cyan-300 whitespace-nowrap pr-1 border-r border-slate-800">
        {selectedActor.name}
      </span>

      <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
        {(
          [
            { id: 'translate', label: 'Move [W]', icon: <Move className="w-3 h-3" /> },
            {
              id: 'rotate',
              label: 'Rotate [E]',
              icon: <RotateCw className="w-3 h-3" />,
            },
            {
              id: 'scale',
              label: 'Scale [R]',
              icon: <Maximize2 className="w-3 h-3" />,
            },
          ] as { id: TransformMode; label: string; icon: React.ReactNode }[]
        ).map((g) => (
          <button
            key={g.id}
            onClick={() => setTransformMode(g.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
              transformMode === g.id
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {g.icon}
            <span>{g.label}</span>
          </button>
        ))}
      </div>

      {selectedActor.availableClips && selectedActor.availableClips.length > 0 && (
        <select
          value={selectedActor.activeClip || selectedActor.availableClips[0]}
          onChange={(e) =>
            updateActorProperty(selectedActor.id, { activeClip: e.target.value })
          }
          title="Select Embedded GLTF Skeletal Animation Clip"
          className="px-2 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 focus:outline-none focus:border-emerald-400"
        >
          {selectedActor.availableClips.map((clip) => (
            <option key={clip} value={clip}>
              Clip: {clip}
            </option>
          ))}
        </select>
      )}

      <select
        value={selectedActor.activeAnimation}
        onChange={(e) =>
          updateActorProperty(selectedActor.id, {
            activeAnimation: e.target.value as AnimationType,
          })
        }
        className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
      >
        {(
          ['idle', 'bounce', 'spin', 'walk', 'attack', 'float'] as AnimationType[]
        ).map((anim) => (
          <option key={anim} value={anim}>
            Motion: {anim}
          </option>
        ))}
      </select>

      <label
        title="Change Actor Primary Color"
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800 cursor-pointer shrink-0"
      >
        <input
          type="color"
          value={selectedActor.primaryColor}
          onChange={(e) =>
            updateActorProperty(selectedActor.id, { primaryColor: e.target.value })
          }
          className="w-4 h-4 rounded cursor-pointer bg-transparent border-0"
        />
        <span className="text-[10px] font-mono text-slate-300">
          {selectedActor.primaryColor}
        </span>
      </label>

      <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
        <button
          onClick={() =>
            updateActorProperty(selectedActor.id, { locked: !selectedActor.locked })
          }
          title={
            selectedActor.locked ? 'Unlock Actor Transform' : 'Lock Actor Transform'
          }
          className={`p-1.5 rounded transition-colors ${
            selectedActor.locked
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-400'
          }`}
        >
          {selectedActor.locked ? (
            <Lock className="w-3.5 h-3.5" />
          ) : (
            <Unlock className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={() => duplicateActor(selectedActor.id)}
          title="Duplicate Actor"
          className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => removeActor(selectedActor.id)}
          title="Delete Actor"
          className="p-1.5 rounded bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

/** Floating 2D layer inspector: text, fill, physics role, duplicate / delete. */
export const Node2DInspectorPill: React.FC<{ selectedNode2D: Node2D }> = ({ selectedNode2D }) => {
  const updateNode2D = useStudioStore((s) => s.updateNode2D);
  const duplicateNode2D = useStudioStore((s) => s.duplicateNode2D);
  const removeNode2D = useStudioStore((s) => s.removeNode2D);

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl bg-[#090D16F2] border border-fuchsia-500/40 shadow-2xl flex items-center gap-2 z-20 max-w-[95%] overflow-x-auto">
      <span className="text-xs font-semibold text-fuchsia-300 whitespace-nowrap pr-1 border-r border-slate-800">
        {selectedNode2D.name}
      </span>

      {selectedNode2D.type === 'text-kinetic' && (
        <input
          type="text"
          value={selectedNode2D.text || ''}
          onChange={(e) => updateNode2D(selectedNode2D.id, { text: e.target.value })}
          placeholder="Text content..."
          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-100 w-36 focus:outline-none focus:border-fuchsia-400"
        />
      )}

      <label
        title="2D Node Fill Color"
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800 cursor-pointer shrink-0"
      >
        <input
          type="color"
          value={selectedNode2D.fill}
          onChange={(e) => updateNode2D(selectedNode2D.id, { fill: e.target.value })}
          className="w-4 h-4 rounded cursor-pointer bg-transparent border-0"
        />
        <span className="text-[10px] font-mono text-slate-300">
          {selectedNode2D.fill}
        </span>
      </label>

      <select
        value={selectedNode2D.physics2D}
        onChange={(e) =>
          updateNode2D(selectedNode2D.id, {
            physics2D: e.target.value as Physics2DRole,
          })
        }
        className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-fuchsia-400"
      >
        <option value="none">Role: None / UI</option>
        <option value="player-platformer">Role: 2D Platformer Player</option>
        <option value="player-topdown">Role: 2D Top-Down Player</option>
        <option value="static-platform">Role: Solid Platform</option>
        <option value="collectible">Role: Collectible (+PTS)</option>
        <option value="bouncing">Role: Bouncing Orb</option>
      </select>

      <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
        <button
          onClick={() => duplicateNode2D(selectedNode2D.id)}
          title="Duplicate 2D Layer"
          className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-fuchsia-300 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => removeNode2D(selectedNode2D.id)}
          title="Delete 2D Layer"
          className="p-1.5 rounded bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

/** Playable end card shown when a Game Mode session is won or times out. */
export const EndCard: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const gameScore = useStudioStore((s) => s.gameScore);
  const gameWon = useStudioStore((s) => s.gameWon);
  const advanceToNextScene = useStudioStore((s) => s.advanceToNextScene);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);
  const resetGameSession = useStudioStore((s) => s.resetGameSession);
  const dismissEndCard = useStudioStore((s) => s.dismissEndCard);

  return (
    <div className="absolute inset-0 bg-black/75 flex items-center justify-center p-6 z-30">
      <div className="w-full max-w-md p-6 rounded-2xl bg-[#090D16] border-2 border-amber-400/80 shadow-2xl flex flex-col items-center text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400">
          <Trophy className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-400">
            {gameWon ? 'PLAYABLE GOAL UNLOCKED' : 'TIME UP · PLAYABLE END-CARD'}
          </div>
          <h3 className="font-display font-bold text-xl text-white">
            {sceneSpec.marketingOverlay.headline}
          </h3>
          <p className="text-xs text-slate-300">
            {sceneSpec.marketingOverlay.subheadline}
          </p>
        </div>

        <div className="w-full py-2.5 px-4 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-around text-xs font-mono tabular-nums">
          <div>
            <span className="text-slate-400 block text-[10px]">FINAL SCORE</span>
            <span className="text-amber-400 font-bold text-sm">{gameScore} PTS</span>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div>
            <span className="text-slate-400 block text-[10px]">TARGET GOAL</span>
            <span className="text-cyan-300 font-bold text-sm">
              {sceneSpec.gameRules.targetScore} PTS
            </span>
          </div>
        </div>

        {gameWon &&
          sceneSpec.sequence?.nextSceneId &&
          scenes.some((s) => s.id === sceneSpec.sequence?.nextSceneId) && (
            <button
              onClick={() => advanceToNextScene()}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-display font-bold text-xs uppercase tracking-wider text-slate-950 transition-colors"
            >
              {sceneSpec.sequence.kind === 'game-levels'
                ? `Next Level → ${sceneSpec.sequence.index + 2}/${sceneSpec.sequence.total}`
                : 'Next Scene →'}
            </button>
          )}

        <div className="w-full flex flex-col sm:flex-row gap-2.5 pt-1">
          <button
            onClick={() => setPublishModalOpen(true)}
            className="flex-1 py-2.5 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider text-slate-950 shadow-lg transition-transform active:scale-95"
            style={{
              backgroundColor: sceneSpec.marketingOverlay.brandColor || '#F59E0B',
            }}
          >
            {sceneSpec.marketingOverlay.ctaText}
          </button>
          <button
            onClick={resetGameSession}
            className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
          >
            Replay Game
          </button>
          <button
            onClick={dismissEndCard}
            className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Edit Stage
          </button>
        </div>
      </div>
    </div>
  );
};

/** Programmatic marketing CTA banner pinned to the bottom of the stage frame. */
export const CtaBanner: React.FC<{ raised?: boolean }> = ({ raised }) => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 w-[min(460px,92%)] px-4 py-2.5 rounded-xl bg-[#090D16EB] border border-slate-800 shadow-xl flex items-center justify-between gap-4 z-10 transition-all ${
        raised ? 'bottom-20' : 'bottom-4'
      }`}
    >
      <div className="min-w-0">
        {sceneSpec.marketingOverlay.badgeText && (
          <div
            className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-0.5"
            style={{ color: sceneSpec.marketingOverlay.brandColor || '#F59E0B' }}
          >
            {sceneSpec.marketingOverlay.badgeText}
          </div>
        )}
        <div className="font-display font-bold text-sm text-slate-100 truncate">
          {sceneSpec.marketingOverlay.headline}
        </div>
        <div className="text-xs text-slate-400 truncate">
          {sceneSpec.marketingOverlay.subheadline}
        </div>
      </div>
      <button
        onClick={() => setPublishModalOpen(true)}
        className="px-3.5 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-wide text-slate-950 shrink-0 transition-transform active:scale-95"
        style={{ backgroundColor: sceneSpec.marketingOverlay.brandColor || '#F59E0B' }}
      >
        {sceneSpec.marketingOverlay.ctaText}
      </button>
    </div>
  );
};
