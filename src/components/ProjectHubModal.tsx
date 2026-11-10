import React, { useEffect, useState } from 'react';
import { FolderOpen, FolderPlus, Gamepad2, Film, Layers, Loader2, Plus, Trash2, X } from 'lucide-react';
import { buildProjectBundle, useStudioStore } from '../state/useStudioStore';
import { createBlankSceneSpec } from '../registry/assetRegistry';
import { ProjectMeta, workspaceApi } from '../workspace/workspaceClient';

const KIND_ICON = { game: Gamepad2, media: Film, collection: Layers };

/**
 * Phase 6 — Project Hub. A project is one game / media product, or a collection of small games sharing one
 * asset folder. Each game is a multi-scene bundle saved under ~/OmniStage/projects/<project>/games/.
 */
export const ProjectHubModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isProjectHubOpen);
  const setOpen = useStudioStore((s) => s.setProjectHubOpen);
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const workspaceHome = useStudioStore((s) => s.workspaceHome);
  const activeProject = useStudioStore((s) => s.activeProject);
  const activeGameId = useStudioStore((s) => s.activeGameId);
  const openProjectGame = useStudioStore((s) => s.openProjectGame);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', kind: 'game' as ProjectMeta['kind'], tags: '' });
  const [newGame, setNewGame] = useState({ name: '', from: 'current' as 'current' | 'blank-2d' | 'blank-3d' });

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await workspaceApi.listProjects();
      setProjects(list);
      setSelectedId((cur) => cur ?? activeProject?.id ?? list[0]?.id ?? null);
    } catch (e: any) {
      setError(e?.message || 'Could not load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && workspaceAvailable) reload();
  }, [isOpen, workspaceAvailable]);

  if (!isOpen) return null;
  const selected = projects.find((p) => p.id === selectedId) || null;

  const createProject = async () => {
    try {
      const p = await workspaceApi.createProject({
        name: form.name,
        description: form.description,
        kind: form.kind,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setForm({ name: '', description: '', kind: 'game', tags: '' });
      await reload();
      setSelectedId(p.id);
    } catch (e: any) {
      setError(e?.message || 'Could not create project');
    }
  };

  const createGame = async () => {
    if (!selected) return;
    const state = useStudioStore.getState();
    const bundle =
      newGame.from === 'current'
        ? buildProjectBundle(state)
        : (() => {
            const scene = createBlankSceneSpec(newGame.from === 'blank-2d' ? '2d' : '3d', newGame.name || 'Untitled');
            scene.mode = selected.kind === 'media' ? 'media' : 'game';
            return { ...scene, projectBundleVersion: '3.1.0', activeSceneId: scene.id, scenes: [scene] };
          })();
    try {
      const { project, game } = await workspaceApi.createGame(selected.id, newGame.name || 'Untitled game', bundle);
      setNewGame({ name: '', from: 'current' });
      await openProjectGame(project, game.id);
    } catch (e: any) {
      setError(e?.message || 'Could not create game');
    }
  };

  const deleteGame = async (gameId: string) => {
    if (!selected || !window.confirm('Move this game to ~/OmniStage/.trash?')) return;
    await workspaceApi.deleteGame(selected.id, gameId);
    if (activeGameId === gameId) useStudioStore.getState().closeProject();
    await reload();
  };

  const deleteProject = async () => {
    if (!selected || !window.confirm(`Move project "${selected.name}" and all its games to ~/OmniStage/.trash?`)) return;
    await workspaceApi.deleteProject(selected.id);
    if (activeProject?.id === selected.id) useStudioStore.getState().closeProject();
    setSelectedId(null);
    await reload();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Projects">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">Projects</h2>
              <p className="text-slate-400">{workspaceHome ? `Saved on this computer in ${workspaceHome}` : 'Local workspace'}</p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {workspaceAvailable === false ? (
          <div className="p-6 text-amber-200">Projects are saved on your computer, so they are only available when OmniStage runs locally (npm run dev, then open http://localhost:3000).</div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_1fr]">
            <div className="border-r border-slate-800 p-3 space-y-2 overflow-y-auto">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="font-semibold text-slate-100 flex items-center gap-1"><FolderPlus className="w-3.5 h-3.5 text-cyan-300" /> New project</div>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Neon Runner)" className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600" />
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ProjectMeta['kind'] })} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100">
                  <option value="game">One game</option>
                  <option value="collection">Collection of small games (shared assets)</option>
                  <option value="media">Media / film</option>
                </select>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Tags: platformer, pixel-art" className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600" />
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Vision / pitch (the AI director reads this)" className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 resize-none" />
                <button type="button" onClick={createProject} disabled={!form.name.trim()} className="w-full py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold disabled:opacity-40">Create</button>
              </div>
              {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
              {projects.map((p) => {
                const Icon = KIND_ICON[p.kind] || Gamepad2;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left p-2 rounded-lg border ${selectedId === p.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-slate-100"><Icon className="w-3.5 h-3.5 text-slate-400" /> {p.name}</div>
                    <div className="text-[10px] text-slate-500">{p.games.length} game(s) · {new Date(p.updatedAt).toLocaleDateString()}</div>
                  </button>
                );
              })}
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              {error && <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-rose-200">{error}</div>}
              {!selected ? (
                <p className="text-slate-400">Create a project on the left. A project keeps your games, shared assets, enabled extensions and the AI's memory of your vision together.</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-100">{selected.name}</h3>
                      <p className="text-slate-400">{selected.description || 'No description yet.'}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selected.tags.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400">{t}</span>)}
                      </div>
                    </div>
                    <button type="button" onClick={deleteProject} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-rose-300">
                      <Trash2 className="w-3 h-3" /> Delete project
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {selected.games.length === 0 && <p className="text-slate-500">No games yet.</p>}
                    {selected.games.map((g) => (
                      <div key={g.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${activeGameId === g.id && activeProject?.id === selected.id ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900'}`}>
                        <div className="flex-1">
                          <div className="font-semibold text-slate-100">{g.name}</div>
                          <div className="text-[10px] text-slate-500">{(g.engineType || '?').toUpperCase()} · {g.mode} · {g.sceneCount} scene(s) · saved {new Date(g.updatedAt).toLocaleString()}</div>
                        </div>
                        <button type="button" onClick={() => openProjectGame(selected, g.id)} className="px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 font-semibold">Open</button>
                        <button type="button" onClick={() => deleteGame(g.id)} aria-label={`Delete ${g.name}`} className="p-1 text-slate-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                    <div className="font-semibold text-slate-100 flex items-center gap-1"><Plus className="w-3.5 h-3.5 text-cyan-300" /> Add a game to this project</div>
                    <div className="flex flex-wrap gap-1.5">
                      <input value={newGame.name} onChange={(e) => setNewGame({ ...newGame, name: e.target.value })} placeholder="Game name" className="flex-1 min-w-[140px] px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600" />
                      <select value={newGame.from} onChange={(e) => setNewGame({ ...newGame, from: e.target.value as any })} className="px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100">
                        <option value="current">From what's open now</option>
                        <option value="blank-2d">Blank 2D</option>
                        <option value="blank-3d">Blank 3D</option>
                      </select>
                      <button type="button" onClick={createGame} className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold">Create & open</button>
                    </div>
                    <p className="text-[10px] text-slate-500">Games in the same project share the project asset library (Library tab → Project).</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
