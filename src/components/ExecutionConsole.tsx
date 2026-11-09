import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Terminal,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { ExecutionLogEntry } from '../types/scene.schema';

type LogFilter = 'all' | 'triggers' | 'actions' | 'errors';

export const ExecutionConsole: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<LogFilter>('all');

  const executionLogs = useStudioStore((s) => s.executionLogs);
  const isConsoleOpen = useStudioStore((s) => s.isConsoleOpen);
  const sceneSpec = useStudioStore((s) => s.sceneSpec);

  const setConsoleOpen = useStudioStore((s) => s.setConsoleOpen);
  const clearLogs = useStudioStore((s) => s.clearLogs);
  const setFocusedLogicNodeId = useStudioStore((s) => s.setFocusedLogicNodeId);
  const triggerAgentAutoFix = useStudioStore((s) => s.triggerAgentAutoFix);
  const markNodeExecution = useStudioStore((s) => s.markNodeExecution);
  const appendLog = useStudioStore((s) => s.appendLog);

  const filteredLogs = useMemo(() => {
    return executionLogs
      .filter((entry) => {
        if (activeFilter === 'triggers') return entry.level === 'trigger';
        if (activeFilter === 'actions') return entry.level === 'action' || entry.level === 'info';
        if (activeFilter === 'errors') return entry.level === 'error' || entry.level === 'warn';
        return true;
      })
      .slice()
      .reverse();
  }, [executionLogs, activeFilter]);

  const errorAndWarnCount = useMemo(
    () => executionLogs.filter((l) => l.level === 'error' || l.level === 'warn').length,
    [executionLogs]
  );

  const handleSimulateDiagnosticFault = () => {
    const targetNode =
      sceneSpec.logicGraph?.nodes.find((n) => n.type === 'robot-hardware') ||
      sceneSpec.logicGraph?.nodes[0];
    if (!targetNode) return;
    const errMsg = `Servo Ch 1 target angle 215° exceeds mechanical limit [0°..180°] and targetScore (${sceneSpec.gameRules.targetScore}) requires more collectible actors.`;
    markNodeExecution(targetNode.id, 'error', errMsg);
    appendLog({
      level: 'error',
      nodeId: targetNode.id,
      message: `Fault on [${targetNode.title}]: ${errMsg}`,
      payload: { nodeId: targetNode.id, servoAngle: 215 },
    });
    setConsoleOpen(true);
    setActiveFilter('errors');
  };

  const getBadgeStyle = (level: ExecutionLogEntry['level']) => {
    switch (level) {
      case 'trigger':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'action':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      case 'warn':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'error':
        return 'bg-rose-500/25 text-rose-300 border-rose-500/50';
      case 'info':
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <section className="w-full bg-[#090D16] border-t border-slate-800/90 shrink-0 z-30 flex flex-col">
      {/* Console Header Bar */}
      <div className="px-3.5 py-2 flex items-center justify-between gap-2 bg-[#070A12] border-b border-slate-800/80 flex-wrap">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setConsoleOpen(!isConsoleOpen)}
            className="flex items-center gap-1.5 text-xs font-display font-bold uppercase tracking-wider text-slate-200 hover:text-cyan-300 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Real-Time Execution Console</span>
            {isConsoleOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>

          {errorAndWarnCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono font-semibold text-amber-300 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span>{errorAndWarnCount} Issue(s)</span>
            </span>
          )}
        </div>

        {/* Filter Pills + Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            {(
              [
                { id: 'all', label: `All (${executionLogs.length})` },
                { id: 'triggers', label: 'Triggers' },
                { id: 'actions', label: 'Actions' },
                { id: 'errors', label: `Errors / Warns (${errorAndWarnCount})` },
              ] as { id: LogFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveFilter(tab.id);
                  if (!isConsoleOpen) setConsoleOpen(true);
                }}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                  activeFilter === tab.id
                    ? 'bg-slate-800 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleSimulateDiagnosticFault}
            title="Inject a test node fault to test AI Auto-Fix"
            className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/40 text-[11px] font-mono text-rose-300 flex items-center gap-1 transition-colors"
          >
            <Bug className="w-3 h-3" />
            <span>Test Fault</span>
          </button>

          <button
            onClick={clearLogs}
            title="Clear Execution Logs"
            className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible Log Entries Table */}
      {isConsoleOpen && (
        <div className="h-36 overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs">
              No execution logs matching filter "{activeFilter.toUpperCase()}". Interact with the
              stage or fire a node in the Logic Graph.
            </div>
          ) : (
            filteredLogs.map((entry) => {
              const isIssue = entry.level === 'warn' || entry.level === 'error';
              return (
                <div
                  key={entry.id}
                  className={`px-3.5 py-2 flex items-center justify-between gap-3 hover:bg-slate-900/60 transition-colors ${
                    entry.level === 'error'
                      ? 'bg-rose-950/25'
                      : entry.level === 'warn'
                        ? 'bg-amber-950/15'
                        : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                      [{entry.sceneTime.toFixed(1).padStart(4, '0')}s]
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border shrink-0 ${getBadgeStyle(
                        entry.level
                      )}`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-slate-200 truncate" title={entry.message}>
                      {entry.message}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.nodeId && (
                      <button
                        onClick={() => setFocusedLogicNodeId(entry.nodeId!)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-cyan-300 flex items-center gap-1 transition-colors"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>Focus Node</span>
                      </button>
                    )}

                    {isIssue && (
                      <button
                        onClick={() => triggerAgentAutoFix(entry)}
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-sans font-bold text-[11px] flex items-center gap-1 shadow-sm transition-colors"
                      >
                        <Wand2 className="w-3 h-3" />
                        <span>Auto-Fix with AI Agent</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
};
