import React, { useRef } from 'react';
import {
  BookOpen,
  Box,
  Check,
  FolderKanban,
  Play,
  Puzzle,
  ChevronDown,
  Clapperboard,
  Columns2,
  Copy,
  FilePlus2,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Layers,
  Monitor,
  Redo2,
  Save,
  Settings,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { SCENE_TEMPLATES } from '../registry/assetRegistry';
import {
  AspectRatioPreset,
  EngineType,
  SceneSpec,
  StudioMode,
  WorkspaceViewMode,
} from '../types/scene.schema';
import { slugifyTitle } from '../exporter/mediaExporter';
import { workspacePath } from '../workspace/workspaceClient';
import { startPreview } from '../guide/guideActions';
import { Dropdown, IconBtn, Segmented } from './ui';

const PROJECT_FORMAT = 'omnistage-project';

/**
 * 44px studio bar in four zones:
 *   1. Project & scene   2. Production mode (Game / Media)   3. Workspace view   4. Engine, settings & export
 */
export const TopNavBar: React.FC = () => {
  const loadInputRef = useRef<HTMLInputElement | null>(null);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const activeSceneId = useStudioStore((s) => s.activeSceneId);
  const projectName = useStudioStore((s) => s.projectName);
  const workspaceView = useStudioStore((s) => s.workspaceView);
  const canUndo = useStudioStore((s) => s.pastSpecs.length > 0);
  const canRedo = useStudioStore((s) => s.futureSpecs.length > 0);

  const setProjectName = useStudioStore((s) => s.setProjectName);
  const setEngineType = useStudioStore((s) => s.setEngineType);
  const createNewBlankScene = useStudioStore((s) => s.createNewBlankScene);
  const switchScene = useStudioStore((s) => s.switchScene);
  const duplicateScene = useStudioStore((s) => s.duplicateScene);
  const deleteScene = useStudioStore((s) => s.deleteScene);
  const loadProjectBundle = useStudioStore((s) => s.loadProjectBundle);
  const loadTemplate = useStudioStore((s) => s.loadTemplate);
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);
  const setMode = useStudioStore((s) => s.setMode);
  const setAspectRatio = useStudioStore((s) => s.setAspectRatio);
  const setWorkspaceView = useStudioStore((s) => s.setWorkspaceView);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const setPublishModalOpen = useStudioStore((s) => s.setPublishModalOpen);
  const setSettingsModalOpen = useStudioStore((s) => s.setSettingsModalOpen);
  const appendLog = useStudioStore((s) => s.appendLog);

  // Workspace projects (Phase 6): hub, autosave state, drafts; play test, guide and extensions.
  const activeProject = useStudioStore((s) => s.activeProject);
  const activeGameId = useStudioStore((s) => s.activeGameId);
  const projectSaveState = useStudioStore((s) => s.projectSaveState);
  const activeDraftId = useStudioStore((s) => s.activeDraftId);
  const draftSaveState = useStudioStore((s) => s.draftSaveState);
  const draftSavedAt = useStudioStore((s) => s.draftSavedAt);
  const workspaceHome = useStudioStore((s) => s.workspaceHome);
  const setProjectHubOpen = useStudioStore((s) => s.setProjectHubOpen);
  const setExtensionsOpen = useStudioStore((s) => s.setExtensionsOpen);
  const saveActiveGame = useStudioStore((s) => s.saveActiveGame);
  const openPlayTest = useStudioStore((s) => s.openPlayTest);
  const openGuide = useStudioStore((s) => s.openGuide);
  const activeGame = activeProject?.games.find((g) => g.id === activeGameId);
  const isGameMode = sceneSpec.mode === 'game';
  const projectLabel = activeProject ? activeProject.name + (activeGame ? ' / ' + activeGame.name : '') : 'Projects';
  const saveLabel = { saving: 'Saving…', dirty: 'Unsaved', error: 'Save failed', saved: 'Saved', idle: 'Saved' }[projectSaveState];
  const saveTone = projectSaveState === 'error' ? 'text-err' : projectSaveState === 'saved' || projectSaveState === 'idle' ? 'text-ok' : 'text-mute';

  const engine: EngineType = sceneSpec.engineType || '3d';
  const activeIndex = Math.max(0, scenes.findIndex((s) => s.id === activeSceneId));

  const handleSaveProject = () => {
    // The active scene's live edits only reach scenes[] on a scene switch, so fold them in here.
    const allScenes: SceneSpec[] = scenes.map((s) => (s.id === activeSceneId ? sceneSpec : s));
    const payload = {
      format: PROJECT_FORMAT,
      version: 1,
      projectName,
      savedAt: new Date().toISOString(),
      activeSceneId,
      scenes: allScenes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugifyTitle(projectName, 'omnistage-project')}.omnistage`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    appendLog({ level: 'info', message: `Saved project "${projectName}" (${allScenes.length} scenes) as .omnistage.` });
  };

  const handleLoadProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
        loadProjectBundle(parsed.scenes, parsed.activeSceneId || parsed.id);
        if (typeof parsed.projectName === 'string' && parsed.projectName.trim()) {
          setProjectName(parsed.projectName);
        } else {
          setProjectName(file.name.replace(/\.[^/.]+$/, ''));
        }
        appendLog({ level: 'info', message: `Loaded project "${file.name}" (${parsed.scenes.length} scenes).` });
      } else if (parsed && (parsed.actors || parsed.nodes2D) && parsed.environment) {
        setSceneSpec(parsed);
        appendLog({ level: 'info', message: `Loaded single scene from "${file.name}".` });
      } else {
        appendLog({ level: 'error', message: `"${file.name}" is not an OmniStage project or SceneSpec file.` });
      }
    } catch {
      appendLog({ level: 'error', message: `Could not read "${file.name}": the file is not valid JSON.` });
    }
  };

  return (
    <header className="topbar">
      {/* ZONE 1 · Project & Scene */}
      <div className="topbar-zone shrink-0">
        <span className="brand" title="OmniStage AI">OS</span>
        <button
          type="button"
          className="btn"
          data-tour="projects"
          onClick={() => setProjectHubOpen(true)}
          title="Projects: create, open and organise your games"
        >
          <FolderKanban size={14} className="text-accent" />
          <span className="max-w-[160px] truncate">{projectLabel}</span>
        </button>
        {!activeProject && (
          <input
            className="proj hidden xl:block"
            aria-label="Project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={(e) => !e.target.value.trim() && setProjectName('Untitled Project')}
            spellCheck={false}
          />
        )}
        {!activeGameId && activeDraftId && (
          <button
            type="button"
            className={`chip font-mono ${draftSaveState === 'error' ? 'text-err' : 'text-warn'}`}
            onClick={() => setProjectHubOpen(true)}
            title={`Not in a project yet: autosaved as a draft in ${workspacePath(workspaceHome, 'drafts')}. Open Projects to save it into a project.`}
          >
            {draftSaveState === 'saving'
              ? 'Saving draft…'
              : draftSaveState === 'error'
                ? 'Draft save failed'
                : `Draft · ${draftSavedAt ? new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'autosave'}`}
          </button>
        )}
        {activeGameId && (
          <button type="button" className={`chip font-mono ${saveTone}`} onClick={() => saveActiveGame()} title="Save now (autosaves a few seconds after each change)">
            {saveLabel}
          </button>
        )}

        <Dropdown
          panelClass="w-72"
          trigger={({ toggle, open }) => (
            <button type="button" className="btn" onClick={toggle} aria-expanded={open} title="Active scene / level">
              <span className="font-mono text-[10px] text-accent">
                {String(activeIndex + 1).padStart(2, '0')}/{String(scenes.length).padStart(2, '0')}
              </span>
              <span className="max-w-[90px] truncate xl:max-w-[130px]">{sceneSpec.title}</span>
              <ChevronDown size={13} className="text-dim" />
            </button>
          )}
        >
          {({ close }) => (
            <div className="max-h-[70vh] overflow-y-auto">
              <div className="menu-h">Scenes / Levels</div>
              {scenes.map((sc, idx) => {
                const active = sc.id === activeSceneId;
                return (
                  <div key={sc.id} className={`menu-i ${active ? 'on' : ''}`}>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => {
                        switchScene(sc.id);
                        close();
                      }}
                    >
                      <span className="font-mono text-[10px] text-dim">{String(idx + 1).padStart(2, '0')}</span>
                      <span className="font-mono text-[9px] uppercase text-mute">{sc.engineType || '3d'}</span>
                      <span className="truncate">{active ? sceneSpec.title : sc.title}</span>
                      {active && <Check size={13} className="ml-auto shrink-0" />}
                    </button>
                    <IconBtn small label="Duplicate scene" onClick={() => duplicateScene(sc.id)}>
                      <Copy size={12} />
                    </IconBtn>
                    {scenes.length > 1 && (
                      <IconBtn small danger label="Delete scene" onClick={() => deleteScene(sc.id)}>
                        <Trash2 size={12} />
                      </IconBtn>
                    )}
                  </div>
                );
              })}
              <div className="my-1 h-px bg-line2" />
              <button
                type="button"
                className="menu-i"
                onClick={() => {
                  createNewBlankScene('3d', `3D Scene ${scenes.length + 1}`);
                  close();
                }}
              >
                <FilePlus2 size={13} className="text-accent" /> New blank 3D scene
              </button>
              <button
                type="button"
                className="menu-i"
                onClick={() => {
                  createNewBlankScene('2d', `2D Level ${scenes.length + 1}`);
                  close();
                }}
              >
                <FilePlus2 size={13} className="text-media" /> New blank 2D level
              </button>
              <div className="menu-h">Example projects</div>
              {Object.values(SCENE_TEMPLATES).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="menu-i"
                  title={tpl.description}
                  onClick={() => {
                    loadTemplate(tpl.id);
                    close();
                  }}
                >
                  <span className="font-mono text-[9px] uppercase text-mute">
                    {tpl.engineType || '3d'}·{tpl.mode}
                  </span>
                  <span className="truncate">{tpl.title}</span>
                </button>
              ))}
            </div>
          )}
        </Dropdown>

        <IconBtn label="Export project file (.omnistage)" onClick={handleSaveProject}>
          <Save size={15} />
        </IconBtn>
        <IconBtn label="Import project file (.omnistage / .json)" onClick={() => loadInputRef.current?.click()}>
          <FolderOpen size={15} />
        </IconBtn>
        <input
          ref={loadInputRef}
          type="file"
          accept=".omnistage,.json,application/json"
          className="hidden"
          onChange={(e) => {
            handleLoadProject(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <span className="topbar-sep" />

      {/* ZONE 2 · Primary production mode */}
      <span data-tour="engine-mode" className="inline-flex">
        <Segmented<StudioMode>
          label="Production mode"
          className="mode-seg"
          value={sceneSpec.mode}
          onChange={setMode}
          options={[
            {
              value: 'game',
              label: 'Game Mode',
              title: 'Game Mode: score target, timer, player physics, win / lose triggers, playable CTA',
              icon: <Gamepad2 size={15} />,
              className: 'game',
              labelClass: 'hidden lg:inline',
            },
            {
              value: 'media',
              label: 'Media Mode',
              title: 'Media Mode: cinematic camera tracks, keyframe sequencer, post-processing, captions',
              icon: <Clapperboard size={15} />,
              className: 'media',
              labelClass: 'hidden lg:inline',
            },
          ]}
        />
      </span>

      <div className="flex-1" />

      {/* ZONE 3 · Workspace view */}
      <Segmented<WorkspaceViewMode>
        label="Workspace view"
        className="ws-seg"
        value={workspaceView}
        onChange={setWorkspaceView}
        options={[
          { value: 'viewport', label: 'Stage', title: 'Stage: full 3D / 2D canvas', icon: <Monitor size={14} />, labelClass: 'hidden 2xl:inline' },
          { value: 'node-graph', label: 'Node Graph', title: 'Node Graph with a live stage picture-in-picture', icon: <GitBranch size={14} />, labelClass: 'hidden 2xl:inline' },
          { value: 'split', label: 'Split View', title: 'Split View: stage and node graph side by side', icon: <Columns2 size={14} />, labelClass: 'hidden 2xl:inline' },
        ]}
      />

      <div className="flex-1" />

      {/* ZONE 4 · Engine, settings & export */}
      <div className="topbar-zone shrink-0">
        <Segmented<EngineType>
          label="Engine"
          small
          value={engine}
          onChange={setEngineType}
          options={[
            { value: '3d', label: '3D', title: '3D WebGL engine', icon: <Box size={13} /> },
            { value: '2d', label: '2D', title: '2D vector / sprite engine', icon: <Layers size={13} /> },
          ]}
        />
        <Segmented<AspectRatioPreset>
          label="Aspect ratio"
          small
          className="hidden sm:inline-flex"
          value={sceneSpec.aspectRatio}
          onChange={setAspectRatio}
          options={[
            { value: '16:9', label: '16:9', labelClass: 'font-mono' },
            { value: '9:16', label: '9:16', labelClass: 'font-mono' },
            { value: '1:1', label: '1:1', labelClass: 'font-mono' },
          ]}
        />
        <div className="hidden items-center md:flex">
          <IconBtn label="Undo" disabled={!canUndo} onClick={undo}>
            <Undo2 size={15} />
          </IconBtn>
          <IconBtn label="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2 size={15} />
          </IconBtn>
        </div>
        <button
          type="button"
          className="btn ok"
          data-tour="play"
          onClick={() => (isGameMode ? openPlayTest() : startPreview())}
          title={isGameMode ? 'Play Test: run the exact build you publish (also on your phone)' : 'Preview: play every scene from start to end'}
        >
          <Play size={14} />
          <span className="hidden lg:inline">{isGameMode ? 'Play Test' : 'Preview'}</span>
        </button>
        <span data-tour="guide" className="inline-flex">
          <IconBtn label="Guide: how OmniStage works" onClick={() => openGuide()}>
            <BookOpen size={15} />
          </IconBtn>
        </span>
        <IconBtn label="Extensions: skills, VFX/SFX packs, asset libraries and tools" onClick={() => setExtensionsOpen(true)}>
          <Puzzle size={15} />
        </IconBtn>
        <IconBtn
          label="Settings: AI model, asset hub API keys, CDN manifest, render quality"
          onClick={() => setSettingsModalOpen(true)}
        >
          <Settings size={15} />
        </IconBtn>
        <button type="button" className="btn primary" onClick={() => setPublishModalOpen(true)}>
          <Share2 size={14} />
          <span className="hidden lg:inline">Publish</span>
        </button>
      </div>
    </header>
  );
};
