import React, { useState } from 'react';
import { Brain, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { MemoryKind, workspaceApi } from '../workspace/workspaceClient';

const KINDS: MemoryKind[] = ['preference', 'style', 'goal', 'constraint', 'feedback', 'fact'];

/** Phase 6 — Settings → Memory: everything the director remembers about the creator, fully editable. */
export const MemoryPanel: React.FC = () => {
  const memories = useStudioStore((s) => s.memories);
  const memoryEnabled = useStudioStore((s) => s.memoryEnabled);
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const refreshMemory = useStudioStore((s) => s.refreshMemory);
  const addMemoryEntry = useStudioStore((s) => s.addMemoryEntry);
  const activeProject = useStudioStore((s) => s.activeProject);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryKind>('preference');
  const [scope, setScope] = useState<'global' | 'project'>('global');

  if (workspaceAvailable === false) {
    return <p className="text-amber-200">Memory is stored on this computer; run OmniStage locally to use it.</p>;
  }

  const add = async () => {
    if (!text.trim()) return;
    await addMemoryEntry(text, kind, 'explicit', scope === 'project' && activeProject ? activeProject.id : 'global');
    setText('');
  };

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-slate-100"><Brain className="w-4 h-4 text-violet-300" /> Director memory</div>
          <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
            <input type="checkbox" checked={memoryEnabled} onChange={async (e) => { await workspaceApi.setMemoryEnabled(e.target.checked); await refreshMemory(); }} className="accent-violet-500" />
            Use memory
          </label>
        </div>
        <p className="text-slate-400">
          Up to 8 relevant memories (pinned first) are added to every AI request. Say "nhớ rằng …" / "remember …" in the chat, or confirm the
          suggestions the director offers. Stored only on this computer.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. My games target kids 6-10, bright colours, no violence" className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-600" />
        <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100">
          <option value="global">All projects</option>
          <option value="project" disabled={!activeProject}>{activeProject ? `Only ${activeProject.name}` : 'Only this project'}</option>
        </select>
        <button type="button" onClick={add} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500 text-white font-semibold"><Plus className="w-3 h-3" /> Remember</button>
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {memories.length === 0 && <p className="text-slate-500">No memories yet.</p>}
        {memories.map((m) => (
          <div key={m.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
            <div className="flex-1 min-w-0">
              <div className="text-slate-200">{m.text}</div>
              <div className="text-[10px] font-mono text-slate-500">{m.kind} · {m.scope === 'global' ? 'all projects' : m.scope} · {m.source} · used {m.uses}×</div>
            </div>
            <button type="button" onClick={async () => { await workspaceApi.updateMemory(m.id, { pinned: !m.pinned }); await refreshMemory(); }} aria-label={m.pinned ? 'Unpin' : 'Pin'} title={m.pinned ? 'Unpin' : 'Pin: always include'} className="p-1 text-slate-400 hover:text-violet-300">
              {m.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={async () => { await workspaceApi.deleteMemory(m.id); await refreshMemory(); }} aria-label="Forget" className="p-1 text-slate-400 hover:text-rose-300">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
