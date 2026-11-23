import React from 'react';
import { AlertTriangle, CheckCircle2, Crosshair, Wand2, XCircle } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { useShellStore } from '../state/useShellStore';
import { useProblems } from '../verification/useProblems';
import { autoFixSceneSpec, fixSceneIssue } from '../verification/sceneVerifier';
import type { VerificationIssue } from '../types/scene.schema';

/** Counts for the dock tab badge. */
export function useProblemCounts() {
  const { report } = useProblems();
  return { errors: report.errors, warnings: report.warnings };
}

/** Problems tab of the bottom dock: every verifier issue for the open scene, with select-it and one-click fixes. */
export const ProblemsPanel: React.FC = () => {
  const { report, spec, scenes } = useProblems();
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);
  const selectActor = useStudioStore((s) => s.selectActor);
  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const selectVfx = useStudioStore((s) => s.selectVfx);
  const appendLog = useStudioStore((s) => s.appendLog);
  const setPropsOpen = useShellStore((s) => s.setPropsOpen);

  const fixable = report.issues.filter((i) => i.fixable);
  const manual = report.issues.filter((i) => !i.fixable);
  const ordered = [...report.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));

  const targetKind = (id?: string): 'actor' | 'node' | 'vfx' | null => {
    if (!id) return null;
    if (spec.actors.some((a) => a.id === id)) return 'actor';
    if ((spec.nodes2D || []).some((n) => n.id === id)) return 'node';
    if (spec.vfx.some((v) => v.id === id)) return 'vfx';
    return null;
  };

  const select = (issue: VerificationIssue) => {
    const kind = targetKind(issue.targetId);
    if (!kind || !issue.targetId) return;
    if (kind === 'actor') selectActor(issue.targetId);
    else if (kind === 'node') selectNode2D(issue.targetId);
    else selectVfx(issue.targetId);
    setPropsOpen(true);
  };

  const fixOne = (issue: VerificationIssue) => {
    const { spec: next, fix } = fixSceneIssue(spec, issue, { scenes });
    if (!fix) return;
    setSceneSpec(next, [fix]);
    appendLog({ level: 'info', message: `Fixed: ${fix}` });
  };

  const fixAll = () => {
    const result = autoFixSceneSpec(spec, { scenes });
    if (!result.fixes.length) return;
    setSceneSpec(result.spec, result.fixes);
    appendLog({ level: 'info', message: `Fixed ${result.fixes.length} problem(s): ${result.fixes.join('; ')}` });
  };

  // Problems that need a creative choice go to the AI Director (picked up by the chat like an Auto-Fix request).
  const askDirector = () => {
    const list = manual.map((i) => `- ${i.message}`).join('\n');
    useStudioStore.setState({
      pendingAgentFixPrompt: `Fix these problems in the scene without changing what already works:\n${list}`,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="problems-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1">
        {report.issues.length === 0 ? (
          <span className="flex items-center gap-1.5 text-[11px] text-ok">
            <CheckCircle2 size={13} /> No problems. This scene passes every check Export runs.
          </span>
        ) : (
          <span className="text-[11px] text-mute">
            <span className="text-err">
              {report.errors} error{report.errors === 1 ? '' : 's'}
            </span>{' '}
            ·{' '}
            <span className="text-warn">
              {report.warnings} warning{report.warnings === 1 ? '' : 's'}
            </span>
          </span>
        )}
        <div className="flex-1" />
        {manual.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={askDirector} title="Ask the AI Director to fix the problems that need a creative choice">
            <Wand2 size={11} /> Ask AI to fix {manual.length}
          </button>
        )}
        {fixable.length > 0 && (
          <button type="button" className="btn warn sm" onClick={fixAll}>
            <Wand2 size={11} /> Fix all {fixable.length}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordered.map((issue, i) => {
          const kind = targetKind(issue.targetId);
          return (
            <div key={`${issue.code}-${issue.targetId ?? ''}-${i}`} className={`log-r pr-r ${issue.severity === 'error' ? 'error' : 'warn'}`}>
              <span className={issue.severity === 'error' ? 'text-err' : 'text-warn'}>
                {issue.severity === 'error' ? <XCircle size={13} /> : <AlertTriangle size={13} />}
              </span>
              <span className="font-mono text-[11px] text-dim">{issue.code}</span>
              <span className="truncate text-fg" title={issue.message}>
                {issue.message}
              </span>
              <span className="flex items-center gap-1">
                {kind && (
                  <button type="button" className="btn ghost sm" onClick={() => select(issue)}>
                    <Crosshair size={11} /> Select
                  </button>
                )}
                {issue.fixable && (
                  <button type="button" className="btn warn sm" onClick={() => fixOne(issue)}>
                    <Wand2 size={11} /> Fix
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
