import React from 'react';
import { CheckCircle2, Wand2 } from 'lucide-react';
import { useStudioStore } from '../../state/useStudioStore';
import { VisionQAReport } from '../../types/scene.schema';

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
