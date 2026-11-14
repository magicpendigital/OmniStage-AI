import React, { useState } from 'react';
import { Archive, Clock, Trash2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { workspacePath } from '../workspace/workspaceClient';

/**
 * Drafts (autosaved work without a project) untouched for 30+ days: the user decides, one by one or all at once, whether to
 * keep them (the 30-day clock restarts) or delete them (moved to ~/OmniStage/.trash). Nothing is deleted without this choice.
 */
export const StaleDraftsDialog: React.FC = () => {
  const staleDrafts = useStudioStore((s) => s.staleDrafts);
  const resolveStaleDraft = useStudioStore((s) => s.resolveStaleDraft);
  const openDraft = useStudioStore((s) => s.openDraft);
  const workspaceHome = useStudioStore((s) => s.workspaceHome);
  const [busy, setBusy] = useState(false);
  if (!staleDrafts.length) return null;

  const all = async (action: 'keep' | 'delete') => {
    setBusy(true);
    for (const d of [...staleDrafts]) await resolveStaleDraft(d.id, action);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="stale-drafts-title">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4 text-slate-100">
        <div className="space-y-1">
          <h2 id="stale-drafts-title" className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Old drafts not saved to a project
          </h2>
          <p className="text-xs text-slate-400">
            These drafts have not been edited for 30 days or more. Keep the ones you still need (or open one and save it into a
            project); deleted drafts go to <span className="font-mono">{workspacePath(workspaceHome, '.trash')}</span>.
          </p>
        </div>
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {staleDrafts.map((d) => (
            <li key={d.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-slate-100">{d.title}</div>
                <div className="text-[11px] text-slate-500">
                  {d.sceneCount} scene{d.sceneCount === 1 ? '' : 's'} · last edited {new Date(d.updatedAt).toLocaleDateString()} ({d.idleDays} days ago)
                </div>
              </div>
              <button disabled={busy} onClick={() => openDraft(d.id).then(() => resolveStaleDraft(d.id, 'keep'))}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200" title="Open it in the studio (kept)">Open</button>
              <button disabled={busy} onClick={() => resolveStaleDraft(d.id, 'keep')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-600/30">
                <Archive className="w-3 h-3" /> Keep
              </button>
              <button disabled={busy} onClick={() => resolveStaleDraft(d.id, 'delete')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-rose-600/15 border border-rose-500/40 text-rose-200 hover:bg-rose-600/25">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </li>
          ))}
        </ul>
        {staleDrafts.length > 1 && (
          <div className="flex justify-end gap-2 text-xs">
            <button disabled={busy} onClick={() => all('keep')} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700">Keep all</button>
            <button disabled={busy} onClick={() => all('delete')} className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white">Delete all</button>
          </div>
        )}
      </div>
    </div>
  );
};
