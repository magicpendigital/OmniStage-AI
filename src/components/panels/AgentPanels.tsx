import React from 'react';
import { CheckCircle2, Trash2, Wand2 } from 'lucide-react';
import { useStudioStore } from '../../state/useStudioStore';
import {
  ActorClickAction,
  AnimationType,
  EnterEffect,
  VisionQAReport,
} from '../../types/scene.schema';

/** Vision QA diagnostic card shown under an assistant message. */
export const VisionReportCard: React.FC<{ report: VisionQAReport }> = ({ report }) => {
  const latestVisionReport = useStudioStore((s) => s.latestVisionReport);
  const applyVisionFixes = useStudioStore((s) => s.applyVisionFixes);

  return (
    <div className="mt-3 p-3 rounded-lg bg-slate-950/90 border border-cyan-500/40 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-display font-bold uppercase text-cyan-300">
          Vision QA Spatial Report
        </span>
        <span className="text-xs font-mono font-semibold text-amber-400 tabular-nums">
          Score: {report.overallScore}/100
        </span>
      </div>

      {report.screenshotDataUrl && (
        <div className="rounded overflow-hidden border border-slate-800 bg-black max-h-28 flex items-center justify-center">
          <img
            src={report.screenshotDataUrl}
            alt="Captured Stage Snapshot"
            referrerPolicy="no-referrer"
            className="h-28 object-contain"
          />
        </div>
      )}

      {report.actorCoordinates &&
        report.actorCoordinates.length > 0 && (
          <div className="p-2 rounded bg-slate-900/90 border border-slate-800/90 space-y-1">
            <div className="text-[10px] font-mono uppercase text-slate-400">
              Inspected World Coordinates & BBoxes:
            </div>
            {report.actorCoordinates.map((ac) => (
              <div
                key={ac.id}
                className="flex items-center justify-between text-[10px] font-mono text-slate-300 tabular-nums"
              >
                <span className="truncate max-w-[140px]">{ac.name}</span>
                <span className="text-cyan-300">
                  [{ac.worldPosition.map((v) => v.toFixed(1)).join(', ')}] ·{' '}
                  {ac.boundingBox.width}×{ac.boundingBox.depth}m
                </span>
              </div>
            ))}
          </div>
        )}

      <div className="space-y-1.5">
        {report.issues.map((issue) => (
          <div
            key={issue.id}
            className="p-2 rounded bg-slate-900 border border-slate-800 text-[11px]"
          >
            <div className="flex items-center justify-between font-semibold text-slate-200">
              <span>{issue.title}</span>
              <span className="text-[10px] font-mono uppercase text-amber-400">
                {issue.category}
              </span>
            </div>
            <p className="text-slate-400 mt-0.5">{issue.description}</p>
            <div className="text-cyan-300 font-mono text-[10px] mt-1">
              Fix: {issue.suggestedFixSummary}
            </div>
          </div>
        ))}
      </div>

      {latestVisionReport?.applied || report.applied ? (
        <div className="w-full py-1.5 px-3 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Spatial Fixes Applied to SceneSpec</span>
        </div>
      ) : (
        <button
          onClick={() => applyVisionFixes(report)}
          className="w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>Apply Recommended Fixes</span>
        </button>
      )}
    </div>
  );
};

/** Numeric actor inspector: transform, timeline window, clips, tap behaviour and CTA copy. */
export const ActorInspectorPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectActor = useStudioStore((s) => s.selectActor);
  const updateActorProperty = useStudioStore((s) => s.updateActorProperty);
  const removeActor = useStudioStore((s) => s.removeActor);
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);

  const selectedActor =
    sceneSpec.actors.find((a) => a.id === selectedActorId) || sceneSpec.actors[0] || null;

  return (
    <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
      <div className="space-y-1.5">
        <label className="text-[11px] font-mono uppercase text-slate-400">
          Selected Stage Actor ({sceneSpec.actors.length})
        </label>
        <select
          value={selectedActor?.id || ''}
          onChange={(e) => selectActor(e.target.value)}
          className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
        >
          {sceneSpec.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.assetId})
            </option>
          ))}
        </select>
      </div>

      {selectedActor ? (
        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-semibold text-slate-100">{selectedActor.name}</span>
            <button
              onClick={() => removeActor(selectedActor.id)}
              className="text-rose-400 hover:text-rose-300 flex items-center gap-1 text-[11px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-mono text-slate-400">Position [X, Y, Z] (m)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <div
                  key={axis}
                  className="flex items-center bg-slate-950 rounded border border-slate-800 px-2 py-1"
                >
                  <span className="text-[10px] font-mono text-slate-400 mr-1.5">{axis}</span>
                  <input
                    type="number"
                    step={0.2}
                    value={selectedActor.position[idx]}
                    onChange={(e) => {
                      const nextPos = [...selectedActor.position] as [number, number, number];
                      nextPos[idx] = parseFloat(e.target.value) || 0;
                      updateActorProperty(selectedActor.id, { position: nextPos });
                    }}
                    className="w-full bg-transparent text-xs font-mono text-slate-100 focus:outline-none tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <div>
              <span className="text-[10px] font-mono text-slate-400 block mb-1">Start (s)</span>
              <input
                type="number"
                step={0.5}
                min={0}
                max={sceneSpec.durationSeconds}
                value={selectedActor.startTime ?? 0}
                onChange={(e) =>
                  updateActorProperty(selectedActor.id, {
                    startTime: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 tabular-nums"
              />
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 block mb-1">End (s)</span>
              <input
                type="number"
                step={0.5}
                min={0.5}
                max={sceneSpec.durationSeconds}
                value={selectedActor.endTime ?? sceneSpec.durationSeconds}
                onChange={(e) =>
                  updateActorProperty(selectedActor.id, {
                    endTime: parseFloat(e.target.value) || sceneSpec.durationSeconds,
                  })
                }
                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 tabular-nums"
              />
            </div>
            <div>
              <span className="text-[10px] font-mono text-slate-400 block mb-1">Enter FX</span>
              <select
                value={selectedActor.enterEffect ?? 'pop-in'}
                onChange={(e) =>
                  updateActorProperty(selectedActor.id, {
                    enterEffect: e.target.value as EnterEffect,
                  })
                }
                className="w-full px-1.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
              >
                <option value="pop-in">pop-in</option>
                <option value="slide-up">slide-up</option>
                <option value="fade">fade</option>
                <option value="none">none</option>
              </select>
            </div>
          </div>

          {selectedActor.availableClips && selectedActor.availableClips.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-mono text-emerald-400">
                GLTF Skeletal Animation Clip ({selectedActor.availableClips.length})
              </span>
              <select
                value={selectedActor.activeClip || selectedActor.availableClips[0]}
                onChange={(e) =>
                  updateActorProperty(selectedActor.id, { activeClip: e.target.value })
                }
                className="w-full px-2.5 py-1.5 rounded bg-emerald-950/40 border border-emerald-500/40 text-xs font-mono text-emerald-200"
              >
                {selectedActor.availableClips.map((clip) => (
                  <option key={clip} value={clip}>
                    {clip}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <span className="text-[11px] font-mono text-slate-400">
              Procedural Motion Offset
            </span>
            <select
              value={selectedActor.activeAnimation}
              onChange={(e) =>
                updateActorProperty(selectedActor.id, {
                  activeAnimation: e.target.value as AnimationType,
                })
              }
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
            >
              {(['idle', 'float', 'spin', 'bounce', 'walk', 'attack'] as AnimationType[]).map(
                (anim) => (
                  <option key={anim} value={anim}>
                    {anim.toUpperCase()}
                  </option>
                )
              )}
            </select>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-mono text-slate-400">
              Playable Tap / Click Behavior
            </span>
            <select
              value={selectedActor.onClickAction}
              onChange={(e) =>
                updateActorProperty(selectedActor.id, {
                  onClickAction: e.target.value as ActorClickAction,
                })
              }
              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
            >
              <option value="collect">collect (+PTS & Respawn)</option>
              <option value="unbox-tap">unbox-tap (3x Tap Product Reveal)</option>
              <option value="destroy">destroy (Remove Obstacle)</option>
              <option value="bounce">bounce (Jump Impulse)</option>
              <option value="trigger-vfx">trigger-vfx</option>
              <option value="trigger-cta">trigger-cta (Open End-Card)</option>
              <option value="none">none</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 text-center">
          No actor selected. Click any actor in the 3D stage or spawn one from the Left Drawer.
        </div>
      )}

      <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2.5">
        <span className="text-[11px] font-mono uppercase text-amber-400 block">
          End-Card & Marketing CTA Overlay
        </span>
        <input
          type="text"
          value={sceneSpec.marketingOverlay.headline}
          onChange={(e) => {
            const next = JSON.parse(JSON.stringify(sceneSpec));
            next.marketingOverlay.headline = e.target.value;
            setSceneSpec(next);
          }}
          placeholder="Headline"
          className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
        />
        <input
          type="text"
          value={sceneSpec.marketingOverlay.ctaText}
          onChange={(e) => {
            const next = JSON.parse(JSON.stringify(sceneSpec));
            next.marketingOverlay.ctaText = e.target.value;
            setSceneSpec(next);
          }}
          placeholder="CTA Button Label"
          className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
        />
      </div>
    </div>
  );
};
