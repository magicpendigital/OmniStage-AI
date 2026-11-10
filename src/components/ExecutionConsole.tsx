import React, { useMemo, useState } from 'react';
import { Bug, Crosshair, Trash2, Wand2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { ExecutionLogEntry } from '../types/scene.schema';
import { Segmented } from './ui';

type LogFilter = 'all' | 'triggers' | 'actions' | 'errors';

const LEVEL_COLOR: Record<ExecutionLogEntry['level'], string> = {
  trigger: 'text-ok',
  action: 'text-accent',
  warn: 'text-warn',
  error: 'text-err',
  info: 'text-mute',
};

/** Counts shown as badges on the dock's Logs tab. */
export function useLogIssueCounts() {
  const executionLogs = useStudioStore((s) => s.executionLogs);
  return useMemo(
    () => ({
      errors: executionLogs.filter((l) => l.level === 'error').length,
      warnings: executionLogs.filter((l) => l.level === 'warn').length,
    }),
    [executionLogs]
  );
}

/** Execution Logs tab of the bottom dock: runtime trigger / action / error feed with AI Auto-Fix. */
export const ExecutionConsole: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<LogFilter>('all');

  const executionLogs = useStudioStore((s) => s.executionLogs);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const workspaceView = useStudioStore((s) => s.workspaceView);

  const clearLogs = useStudioStore((s) => s.clearLogs);
  const setFocusedLogicNodeId = useStudioStore((s) => s.setFocusedLogicNodeId);
  const setWorkspaceView = useStudioStore((s) => s.setWorkspaceView);
  const triggerAgentAutoFix = useStudioStore((s) => s.triggerAgentAutoFix);
  const markNodeExecution = useStudioStore((s) => s.markNodeExecution);
  const appendLog = useStudioStore((s) => s.appendLog);

  const filteredLogs = useMemo(
    () =>
      executionLogs
        .filter((entry) => {
          if (activeFilter === 'triggers') return entry.level === 'trigger';
          if (activeFilter === 'actions') return entry.level === 'action' || entry.level === 'info';
          if (activeFilter === 'errors') return entry.level === 'error' || entry.level === 'warn';
          return true;
        })
        .slice()
        .reverse(),
    [executionLogs, activeFilter]
  );

  const issueCount = executionLogs.filter((l) => l.level === 'error' || l.level === 'warn').length;

  const handleSimulateDiagnosticFault = () => {
    const targetNode =
      sceneSpec.logicGraph?.nodes.find((n) => n.type === 'robot-hardware') || sceneSpec.logicGraph?.nodes[0];
    if (!targetNode) return;
    const errMsg = `Servo Ch 1 target angle 215° exceeds mechanical limit [0°..180°] and targetScore (${sceneSpec.gameRules.targetScore}) requires more collectible actors.`;
    markNodeExecution(targetNode.id, 'error', errMsg);
    appendLog({
      level: 'error',
      nodeId: targetNode.id,
      message: `Fault on [${targetNode.title}]: ${errMsg}`,
      payload: { nodeId: targetNode.id, servoAngle: 215 },
    });
    setActiveFilter('errors');
  };

  const focusNode = (nodeId: string) => {
    if (workspaceView === 'viewport') setWorkspaceView('split');
    setFocusedLogicNodeId(nodeId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1">
        <Segmented<LogFilter>
          label="Log filter"
          small
          value={activeFilter}
          onChange={setActiveFilter}
          options={[
            { value: 'all', label: `All ${executionLogs.length}` },
            { value: 'triggers', label: 'Triggers' },
            { value: 'actions', label: 'Actions' },
            { value: 'errors', label: `Issues ${issueCount}` },
          ]}
        />
        <div className="flex-1" />
        <button
          type="button"
          className="btn ghost sm"
          onClick={handleSimulateDiagnosticFault}
          title="Inject a test node fault to try AI Auto-Fix"
        >
          <Bug size={12} className="text-err" /> Test fault
        </button>
        <button type="button" className="ibtn sm" onClick={clearLogs} title="Clear logs" aria-label="Clear logs">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="grid h-full place-items-center p-4 text-center text-[11px] text-dim">
            No log entries for this filter. Interact with the stage or fire a node in the logic graph.
          </div>
        ) : (
          filteredLogs.map((entry) => {
            const isIssue = entry.level === 'warn' || entry.level === 'error';
            return (
              <div key={entry.id} className={`log-r ${entry.level}`}>
                <span className="text-dim">{entry.sceneTime.toFixed(1).padStart(4, '0')}s</span>
                <span className={`log-lv ${LEVEL_COLOR[entry.level]}`}>{entry.level}</span>
                <span className="truncate text-fg" title={entry.message}>
                  {entry.message}
                </span>
                <span className="flex items-center gap-1">
                  {entry.nodeId && (
                    <button type="button" className="btn ghost sm" onClick={() => focusNode(entry.nodeId!)}>
                      <Crosshair size={11} /> Node
                    </button>
                  )}
                  {isIssue && (
                    <button type="button" className="btn warn sm" onClick={() => triggerAgentAutoFix(entry)}>
                      <Wand2 size={11} /> AI Auto-Fix
                    </button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
