import React from 'react';
import { Copy, Eye, EyeOff, Lock, Plus, Sparkles as SparklesIcon, Trash2, Unlock } from 'lucide-react';
import { useStudioStore } from '../../state/useStudioStore';

/** Scene Graph: from-scratch spawner plus the 3D actor / VFX and 2D layer outliner. */
export const OutlinerPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectedNode2DId = useStudioStore((s) => s.selectedNode2DId);

  const selectActor = useStudioStore((s) => s.selectActor);
  const updateActorProperty = useStudioStore((s) => s.updateActorProperty);
  const duplicateActor = useStudioStore((s) => s.duplicateActor);
  const removeActor = useStudioStore((s) => s.removeActor);
  const spawnAsset = useStudioStore((s) => s.spawnAsset);
  const spawnVFX = useStudioStore((s) => s.spawnVFX);
  const removeVFX = useStudioStore((s) => s.removeVFX);
  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const spawnPreset2D = useStudioStore((s) => s.spawnPreset2D);
  const updateNode2D = useStudioStore((s) => s.updateNode2D);
  const duplicateNode2D = useStudioStore((s) => s.duplicateNode2D);
  const removeNode2D = useStudioStore((s) => s.removeNode2D);

  const is2D = sceneSpec.engineType === '2d';
  const nodes2D = sceneSpec.nodes2D || [];

  return (
    <div className="space-y-3">
      {/* Quick Add From Scratch Bar */}
      <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase text-slate-400">
            + Add Node From Scratch
          </span>
          <span className="text-[10px] font-mono text-cyan-400">
            {is2D ? '2D Engine' : '3D Engine'}
          </span>
        </div>

        {!is2D ? (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => spawnAsset('gltf-robot-expressive')}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-[11px] font-medium text-cyan-300 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Rigged Robot</span>
            </button>
            <button
              onClick={() => spawnAsset('gltf-fox')}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] font-medium text-emerald-300 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Rigged Fox</span>
            </button>
            <button
              onClick={() => spawnAsset('starter-primitive-showcase')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>3D Primitive</span>
            </button>
            <button
              onClick={() => spawnVFX('sparkles')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-amber-300 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>VFX Emitter</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => spawnPreset2D('2d-hero-runner')}
              className="px-2.5 py-1.5 rounded-lg bg-fuchsia-500/15 hover:bg-fuchsia-500/25 border border-fuchsia-500/40 text-[11px] font-medium text-fuchsia-300 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>2D Player</span>
            </button>
            <button
              onClick={() => spawnPreset2D('2d-neon-platform')}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-[11px] font-medium text-cyan-300 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>2D Platform</span>
            </button>
            <button
              onClick={() => spawnPreset2D('2d-star-coin')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-amber-300 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Star Pickup</span>
            </button>
            <button
              onClick={() => spawnPreset2D('2d-kinetic-headline')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Kinetic Text</span>
            </button>
          </div>
        )}
      </div>

      {/* 3D Actors Outliner List */}
      {!is2D && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase text-slate-400">
            <span>3D Actors ({sceneSpec.actors.length})</span>
            <span>Click to Inspect</span>
          </div>

          {sceneSpec.actors.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-900/50 border border-dashed border-slate-800 text-center space-y-2">
              <p className="text-xs text-slate-400">
                Blank 3D Stage — Add a rigged GLTF character, primitive, or ask the AI Director to build a world from scratch.
              </p>
            </div>
          ) : (
            sceneSpec.actors.map((actor) => {
              const selected = actor.id === selectedActorId;
              const visible = actor.visible !== false;
              return (
                <div
                  key={actor.id}
                  onClick={() => selectActor(actor.id)}
                  className={`px-2.5 py-2 rounded-lg border cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    selected
                      ? 'bg-slate-900 border-cyan-500/70 text-cyan-200'
                      : 'bg-slate-900/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: actor.primaryColor || '#06b6d4' }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{actor.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">
                        {actor.activeClip
                          ? `GLTF Clip: ${actor.activeClip}`
                          : `${actor.physicsRole} · [${actor.position
                              .map((n) => n.toFixed(1))
                              .join(',')}]`}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() =>
                        updateActorProperty(actor.id, { visible: !visible })
                      }
                      title={visible ? 'Hide Actor' : 'Show Actor'}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                    >
                      {visible ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        updateActorProperty(actor.id, { locked: !actor.locked })
                      }
                      title={actor.locked ? 'Unlock Actor' : 'Lock Actor'}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-300"
                    >
                      {actor.locked ? (
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => duplicateActor(actor.id)}
                      title="Duplicate Actor"
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-300"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeActor(actor.id)}
                      title="Delete Actor"
                      className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {/* Active VFX & 3D Text Callouts in Outliner */}
          {sceneSpec.vfx.length > 0 && (
            <div className="pt-2 space-y-1.5">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                VFX & 3D Callouts ({sceneSpec.vfx.length})
              </div>
              {sceneSpec.vfx.map((vfx) => (
                <div
                  key={vfx.id}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <SparklesIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-mono text-slate-300 truncate">{vfx.name}</span>
                  </div>
                  <button
                    onClick={() => removeVFX(vfx.id)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2D Layers Outliner List */}
      {is2D && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase text-slate-400">
            <span>2D Canvas Layers ({nodes2D.length})</span>
            <span>1000×600 Space</span>
          </div>

          {nodes2D.map((node) => {
            const selected = node.id === selectedNode2DId;
            const visible = node.visible !== false;
            return (
              <div
                key={node.id}
                onClick={() => selectNode2D(node.id)}
                className={`px-2.5 py-2 rounded-lg border cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                  selected
                    ? 'bg-slate-900 border-fuchsia-500/70 text-fuchsia-200'
                    : 'bg-slate-900/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: node.fill }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{node.name}</div>
                    <div className="text-[10px] font-mono text-slate-400 truncate">
                      {node.type} · ({Math.round(node.x)}, {Math.round(node.y)})
                    </div>
                  </div>
                </div>

                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => updateNode2D(node.id, { visible: !visible })}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                  >
                    {visible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                    )}
                  </button>
                  <button
                    onClick={() => duplicateNode2D(node.id)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-fuchsia-300"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeNode2D(node.id)}
                    className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
