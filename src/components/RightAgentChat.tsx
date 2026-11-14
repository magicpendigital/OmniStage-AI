import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookmarkPlus,
  Brain,
  Cpu,
  Code2,
  Puzzle,
  ShieldAlert,
  ShieldCheck,
  MessageSquare,
  PanelBottom,
  PanelRightOpen,
  ScanEye,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { StoryboardJobState, useStudioStore } from '../state/useStudioStore';
import { AgentIntentMode, useShellStore } from '../state/useShellStore';
import type { StoryboardIntent } from '../agent/studioAgent';
import {
  detectStoryboardIntent,
  generateStoryboardWithAgent,
  mutateSceneWithAgent,
  runVisionQAInspection,
} from '../agent/studioAgent';
import { createBlankSceneSpec } from '../registry/assetRegistry';
import { BUILTIN_DIRECTOR_SKILLS, mergeSystemPrompt } from '../agent/directorSkills';
import { buildDirectorContext } from '../agent/studioAgent';
import { parseExplicitMemory, suggestMemory } from '../agent/memory';
import { recommendExtensions } from '../extensions/registry';
import { EXTENSION_CATALOG } from '../extensions/catalog';
import { formatGuideAnswer, guideLangFor, guideTopic, matchGuideQuestion } from '../guide/guideContent';
import { runGuideAction } from '../guide/guideActions';
import type { ChatMessage } from '../types/scene.schema';
import { ActorInspectorPanel, VisionReportCard } from './panels/AgentPanels';
import { Dropdown, IconBtn, Segmented } from './ui';
import { AIConnectionPicker } from './AIConnectionPicker';
import { providerLabel } from '../agent/aiClient';

type DrawerTab = 'chat' | 'inspector' | 'json';

const QUICK_PROMPTS = [
  'Build a 3D Forest Valley with pine trees, boulders & a running Fox (.glb)',
  'Build a Cyberpunk Rain City with a dancing Expressive Robot (.glb)',
  'Create a 2D Neon Platformer Game with jump physics & star pickups',
  'Create a Snow Mountain world with falling snow & a Vanguard Soldier (.glb)',
  'Làm một bộ phim 3D gồm 3 cảnh về chú robot phiêu lưu trong rừng',
  'Tạo game 2D vượt chướng ngại vật 3 màn',
  'Make it a playable ad with a strong hook, CTA and juicy sound effects',
];

const INTENT_HELP: Record<AgentIntentMode, { label: string; title: string; placeholder: string }> = {
  patch: {
    label: 'Patch',
    title: 'Patch: edit the current scene in place',
    placeholder: 'Ask the Director to add actors, wire nodes or fix logic…',
  },
  replace: {
    label: 'Replace',
    title: 'Replace: rebuild this scene from a blank stage',
    placeholder: 'Describe a scene to build from scratch (replaces this one)…',
  },
  storyboard: {
    label: 'Storyboard',
    title: 'Storyboard: generate a linked multi-scene film or set of levels',
    placeholder: 'Describe a multi-scene film or multi-level game…',
  },
};

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Phase 4 / 6 extras under an assistant reply: verification + Director Skills, guide links, memory and extension suggestions. */
const MessageExtras: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const learnedSkills = useStudioStore((s) => s.learnedSkills);
  const saveLearnedSkill = useStudioStore((s) => s.saveLearnedSkill);
  const addMemoryEntry = useStudioStore((s) => s.addMemoryEntry);
  const installedExtensions = useStudioStore((s) => s.installedExtensions);
  const openExtensionReview = useStudioStore((s) => s.openExtensionReview);
  const appendLog = useStudioStore((s) => s.appendLog);
  const [skillSaved, setSkillSaved] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);

  if (msg.role !== 'assistant') return null;
  const skillTitle = (id: string) => [...BUILTIN_DIRECTOR_SKILLS, ...learnedSkills].find((sk) => sk.id === id)?.title || id;
  const topic = msg.guideTopicId ? guideTopic(msg.guideTopicId) : undefined;

  return (
    <>
      {(msg.skillsUsed?.length || msg.verification) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {msg.verification && (
            <span
              title={msg.verification.issues.map((i) => `${i.code}: ${i.message}`).join(' | ') || 'No issues'}
              className={`chip font-mono text-[10px] ${msg.verification.ok ? 'text-ok' : 'text-err'}`}
            >
              {msg.verification.ok ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
              {msg.verification.ok
                ? `VERIFIED${msg.verification.warnings ? ` · ${msg.verification.warnings} warn` : ''}`
                : `${msg.verification.errors} ERROR(S)`}
            </span>
          )}
          {msg.skillsUsed?.map((id) => (
            <span key={id} className="chip font-mono text-[10px] text-media">
              {skillTitle(id)}
            </span>
          ))}
          {msg.sourcePrompt && msg.updatedSpecSnapshot && (
            <button
              type="button"
              className="chip ml-auto font-mono text-[10px]"
              disabled={skillSaved}
              title="Save this result as a learned Director Skill reused for similar prompts"
              onClick={() => {
                const skill = saveLearnedSkill(msg.sourcePrompt!, msg.updatedSpecSnapshot!);
                setSkillSaved(true);
                appendLog({ level: 'info', message: `Saved learned Director Skill "${skill.title}" (triggers: ${skill.triggers.join(', ')}).` });
              }}
            >
              <BookmarkPlus size={11} />
              {skillSaved ? 'Skill saved' : 'Save as skill'}
            </button>
          )}
        </div>
      )}

      {msg.guideTopicId && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="btn sm" onClick={() => useStudioStore.getState().openGuide(msg.guideTopicId)}>
            Open in Guide
          </button>
          {topic?.action && (
            <button type="button" className="btn sm" onClick={() => runGuideAction(topic.action!.id)}>
              {topic.action.label[guideLangFor(msg.content)]}
            </button>
          )}
        </div>
      )}

      {msg.memorySuggestion && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-line p-2">
          <Brain size={13} className="mt-0.5 shrink-0 text-media" />
          <div className="flex-1 text-[11px]">
            Remember this for next time? <span className="italic">"{msg.memorySuggestion.text}"</span>
          </div>
          <button
            type="button"
            className="btn sm"
            disabled={memorySaved}
            onClick={async () => {
              await addMemoryEntry(msg.memorySuggestion!.text, msg.memorySuggestion!.kind, 'confirmed-suggestion', 'global');
              setMemorySaved(true);
            }}
          >
            {memorySaved ? 'Remembered' : 'Remember'}
          </button>
        </div>
      )}

      {msg.extensionSuggestions?.map((sug) => {
        const manifest = EXTENSION_CATALOG.find((m) => m.id === sug.id);
        if (!manifest) return null;
        const installed = installedExtensions.some((e) => e.manifest.id === sug.id);
        return (
          <div key={sug.id} className="mt-2 flex items-start gap-2 rounded-md border border-line p-2">
            <Puzzle size={13} className="mt-0.5 shrink-0 text-accent" />
            <div className="flex-1 text-[11px]">
              Suggested extension: <span className="font-semibold">{sug.name}</span>
              <div className="text-[10px] text-dim">
                {manifest.description} {sug.reason ? `(${sug.reason})` : ''}
              </div>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={installed}
              onClick={() => openExtensionReview({ manifest, source: 'builtin-catalog', reason: sug.reason })}
            >
              {installed ? 'Installed' : 'Review'}
            </button>
          </div>
        );
      })}
    </>
  );
};

/**
 * AI Director in two interchangeable shells: a compact floating command bar docked to the
 * bottom of the workspace, and a slide-over drawer with the full chat, inspector and SceneSpec.
 * Mounted once, so auto-fix requests are picked up whichever shell is showing.
 */
export const RightAgentChat: React.FC<{ hidden?: boolean }> = ({ hidden }) => {
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('chat');
  const [promptInput, setPromptInput] = useState('');
  const [dismissedReplyId, setDismissedReplyId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const aiMode = useShellStore((s) => s.aiMode);
  const setAiMode = useShellStore((s) => s.setAiMode);
  const intent = useShellStore((s) => s.agentIntent);
  const setIntent = useShellStore((s) => s.setAgentIntent);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const chatMessages = useStudioStore((s) => s.chatMessages);
  const isAgentThinking = useStudioStore((s) => s.isAgentThinking);
  const storyboardJob = useStudioStore((s) => s.storyboardJob);
  const settings = useStudioStore((s) => s.settings);
  const isVisionRunning = useStudioStore((s) => s.isVisionRunning);
  const canvasElement = useStudioStore((s) => s.canvasElement);
  const pendingAgentFixPrompt = useStudioStore((s) => s.pendingAgentFixPrompt);

  const setStoryboardJob = useStudioStore((s) => s.setStoryboardJob);
  const appendStoryboardScene = useStudioStore((s) => s.appendStoryboardScene);
  const linkStoryboardScenes = useStudioStore((s) => s.linkStoryboardScenes);
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);
  const addChatMessage = useStudioStore((s) => s.addChatMessage);
  const setAgentThinking = useStudioStore((s) => s.setAgentThinking);
  const setVisionRunning = useStudioStore((s) => s.setVisionRunning);
  const setLatestVisionReport = useStudioStore((s) => s.setLatestVisionReport);
  const clearPendingAgentFixPrompt = useStudioStore((s) => s.clearPendingAgentFixPrompt);
  const appendLog = useStudioStore((s) => s.appendLog);
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const addMemoryEntry = useStudioStore((s) => s.addMemoryEntry);
  const memories = useStudioStore((s) => s.memories);
  const installedExtensions = useStudioStore((s) => s.installedExtensions);
  const activeProject = useStudioStore((s) => s.activeProject);

  /** Phase 6: memory + extension suggestions attached to the assistant reply for this prompt. */
  const suggestionsFor = (query: string, engineType: string, mode: string) => {
    const memorySuggestion = workspaceAvailable ? suggestMemory(query) : null;
    const known = memorySuggestion && memories.some((m) => m.text.toLowerCase() === memorySuggestion.text.toLowerCase());
    const extensionSuggestions = workspaceAvailable
      ? recommendExtensions(
          query,
          { engineType, mode, projectTags: activeProject?.tags },
          EXTENSION_CATALOG,
          installedExtensions.map((e) => e.manifest.id)
        ).map((r) => ({ id: r.manifest.id, name: r.manifest.name, reason: r.reason }))
      : [];
    return {
      memorySuggestion: known ? undefined : memorySuggestion || undefined,
      extensionSuggestions: extensionSuggestions.length ? extensionSuggestions : undefined,
    };
  };

  const runStoryboardGeneration = async (query: string, storyboardIntent: StoryboardIntent) => {
    setAgentThinking(true);
    let job: StoryboardJobState = {
      storyboardId: 'pending',
      title: 'Planning storyboard',
      status: 'planning',
      total: storyboardIntent.sceneCount,
      completed: 0,
      currentLabel: 'Planning storyboard beats',
      source: 'local',
    };
    setStoryboardJob(job);
    const patchJob = (patch: Partial<StoryboardJobState>) => {
      job = { ...job, ...patch };
      setStoryboardJob(job);
    };

    try {
      // Director Skills + extension context also steer every storyboard beat.
      const director = buildDirectorContext(query, { engineType: storyboardIntent.engineType, mode: sceneSpec.mode });
      const skilledSettings = {
        ...settings,
        customSystemPrompt: mergeSystemPrompt(settings.customSystemPrompt, director.skills, director.extraContext),
      };
      const result = await generateStoryboardWithAgent(query, storyboardIntent, skilledSettings, {
        onPlan: (plan, source) => patchJob({ title: plan.storyboardTitle, total: plan.beats.length, source }),
        onProgress: (p) =>
          patchJob({ status: p.phase, completed: p.completed, total: p.total, currentLabel: p.label }),
        onScene: (scene, index) => {
          if (job.storyboardId === 'pending' && scene.sequence) {
            patchJob({ storyboardId: scene.sequence.storyboardId });
          }
          // Show each scene on stage as soon as it is authored
          appendStoryboardScene(scene, true);
          patchJob({ completed: index + 1 });
        },
      });
      linkStoryboardScenes(result.storyboardId, true);
      patchJob({ status: 'done', completed: result.scenes.length, currentLabel: 'Storyboard ready' });
      addChatMessage({
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        content: result.assistantMessage,
        timestamp: now(),
        diffSummary: result.diffSummary,
      });
    } catch (e: any) {
      patchJob({ status: 'error', error: e?.message || 'Storyboard generation failed' });
      addChatMessage({
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        content: `Storyboard generation stopped: ${e?.message || 'unknown error'}.`,
        timestamp: now(),
      });
    } finally {
      setAgentThinking(false);
      const finishedJob = job;
      setTimeout(() => {
        if (useStudioStore.getState().storyboardJob === finishedJob) setStoryboardJob(null);
      }, 4000);
    }
  };

  const handleSendPrompt = async (textToUse?: string) => {
    const query = (textToUse ?? promptInput).trim();
    if (!query || isAgentThinking) return;
    if (!textToUse) setPromptInput('');

    const isAutoFix = query.startsWith('Auto-Fix Execution Issue');
    // Auto-fix repairs always patch the live scene, whatever intent the bar is set to.
    const mode: AgentIntentMode = isAutoFix ? 'patch' : intent;

    addChatMessage({
      id: `msg-u-${Date.now()}`,
      role: 'user',
      content: mode === 'patch' ? query : `[${INTENT_HELP[mode].label}] ${query}`,
      timestamp: now(),
    });

    // Phase 6 batch 2: "làm sao…?" / "how do I…?" about the app is answered from the Guide (no AI call).
    const helpTopic = isAutoFix ? null : matchGuideQuestion(query);
    if (helpTopic) {
      addChatMessage({
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        content: formatGuideAnswer(helpTopic, guideLangFor(query)),
        timestamp: now(),
        guideTopicId: helpTopic.id,
      });
      return;
    }

    // Phase 6: "nhớ rằng …" / "remember …" goes straight to memory (no AI call).
    const explicitMemory = isAutoFix ? null : parseExplicitMemory(query);
    if (explicitMemory) {
      const entry = workspaceAvailable ? await addMemoryEntry(explicitMemory, 'preference', 'explicit', 'global') : null;
      addChatMessage({
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        content: entry
          ? `Đã ghi nhớ: "${entry.text}". I'll use this in future requests (Settings → Memory to edit or remove).`
          : 'Memory needs the local workspace (run OmniStage on this computer).',
        timestamp: now(),
      });
      return;
    }

    // Multi-step storyboard: forced by Storyboard mode, or detected from the wording in Patch mode
    // ("phim 3D gồm 3 cảnh", "game 2D 3 màn", "a 4-level platformer"...).
    const detected = isAutoFix || mode === 'replace' ? null : detectStoryboardIntent(query);
    const storyboardIntent: StoryboardIntent | null =
      mode === 'storyboard'
        ? detected ?? {
            sceneCount: 3,
            kind: sceneSpec.mode === 'game' ? 'game-levels' : 'film',
            engineType: sceneSpec.engineType || '3d',
          }
        : detected;
    if (storyboardIntent) {
      await runStoryboardGeneration(query, storyboardIntent);
      return;
    }

    setAgentThinking(true);
    try {
      const prevSnapshot = JSON.parse(JSON.stringify(sceneSpec));
      // Replace hands the agent a blank stage that keeps this scene's identity and format.
      const baseSpec =
        mode === 'replace'
          ? {
              ...createBlankSceneSpec(sceneSpec.engineType || '3d', sceneSpec.title),
              id: sceneSpec.id,
              mode: sceneSpec.mode,
              aspectRatio: sceneSpec.aspectRatio,
              sequence: sceneSpec.sequence,
            }
          : sceneSpec;
      const result = await mutateSceneWithAgent(query, baseSpec);

      // If this was an Auto-Fix request from the Execution Console / Node Graph,
      // also repair any faulted LogicNode states in the updated SceneSpec.
      const nextSpec = JSON.parse(JSON.stringify(result.updatedSceneSpec));
      if (isAutoFix && nextSpec.logicGraph) {
        nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.map((n: any) => ({
          ...n,
          status: 'success',
          errorMessage: undefined,
          params: {
            ...n.params,
            servoAngle:
              n.params?.servoAngle !== undefined
                ? Math.max(0, Math.min(180, Number(n.params.servoAngle) || 90))
                : undefined,
            actorId: n.params?.actorId === 'missing-actor-id' ? nextSpec.actors[0]?.id : n.params?.actorId,
          },
        }));
        appendLog({
          level: 'action',
          message:
            'AI Director Auto-Fix applied: Clamped servo angles to [0°..180°], repaired actor bindings, and synchronized SceneSpec.',
        });
      }

      setSceneSpec(nextSpec, result.diffSummary);
      addChatMessage({
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        content: result.assistantMessage,
        timestamp: now(),
        diffSummary: result.diffSummary,
        previousSpecSnapshot: prevSnapshot,
        updatedSpecSnapshot: nextSpec,
        sourcePrompt: isAutoFix ? undefined : query,
        skillsUsed: result.skillsUsed,
        verification: result.verification,
        ...(isAutoFix ? {} : suggestionsFor(query, nextSpec.engineType, nextSpec.mode)),
      });
    } finally {
      setAgentThinking(false);
    }
  };

  // Automatically pick up "Auto-Fix with AI Agent" requests from ExecutionConsole or NodeGraphView
  useEffect(() => {
    if (!pendingAgentFixPrompt) return;
    const promptToRun = pendingAgentFixPrompt;
    clearPendingAgentFixPrompt();
    setDrawerTab('chat');
    handleSendPrompt(promptToRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAgentFixPrompt]);

  const handleTriggerVisionCheck = async () => {
    if (isVisionRunning) return;
    setVisionRunning(true);
    try {
      const activeCanvas =
        canvasElement && canvasElement.isConnected ? canvasElement : document.querySelector('canvas');
      const report = await runVisionQAInspection(activeCanvas, sceneSpec);
      setLatestVisionReport(report);
      addChatMessage({
        id: `msg-vqa-${Date.now()}`,
        role: 'assistant',
        content: `Vision QA Spatial Audit complete (${report.overallScore}/100). Analyzed the rendered canvas + ${report.actorCoordinates?.length || sceneSpec.actors.length} actor coordinates. Click "Apply Recommended Fixes" to auto-correct the stage.`,
        timestamp: report.timestamp,
        visionReport: report,
      });
    } finally {
      setVisionRunning(false);
    }
  };

  // Keep the newest message in view while the drawer chat is open.
  useEffect(() => {
    if (aiMode === 'drawer' && drawerTab === 'chat' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chatMessages.length, isAgentThinking, storyboardJob, aiMode, drawerTab]);

  if (hidden) return null;

  const intentSeg = (
    <Segmented<AgentIntentMode>
      label="Director intent"
      small
      value={intent}
      onChange={setIntent}
      options={(Object.keys(INTENT_HELP) as AgentIntentMode[]).map((id) => ({
        value: id,
        label: INTENT_HELP[id].label,
        title: INTENT_HELP[id].title,
      }))}
    />
  );

  const storyboardProgress = storyboardJob && (
    <div className="msg space-y-2" style={{ borderColor: 'rgb(var(--media) / 0.4)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold text-media">{storyboardJob.title}</span>
        <span className="shrink-0 font-mono text-[10px] text-mute">
          {storyboardJob.completed}/{storyboardJob.total} · {storyboardJob.source}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line2">
        <div
          className="h-full bg-media transition-all"
          style={{
            width: `${Math.round(
              ((storyboardJob.status === 'planning' ? 0.15 : storyboardJob.completed) /
                Math.max(1, storyboardJob.total)) *
                100
            )}%`,
          }}
        />
      </div>
      <div className="font-mono text-[11px] text-mute">
        {storyboardJob.status === 'planning' && 'Step 1 · Planning storyboard beats…'}
        {storyboardJob.status === 'generating' &&
          `Step 2 · Authoring scene ${Math.min(storyboardJob.completed + 1, storyboardJob.total)}: ${storyboardJob.currentLabel}`}
        {storyboardJob.status === 'done' && 'All scenes linked into the storyboard.'}
        {storyboardJob.status === 'error' && <span className="text-err">{storyboardJob.error}</span>}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Shell A · floating bottom command bar
  // ---------------------------------------------------------------------------
  if (aiMode === 'bar') {
    const lastAssistant = [...chatMessages].reverse().find((m) => m.role === 'assistant');
    const showReply = lastAssistant && lastAssistant.id !== dismissedReplyId && chatMessages.length > 1;

    return (
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-40 flex w-[min(760px,calc(100%-24px))] -translate-x-1/2 flex-col gap-2">
        {storyboardProgress && <div className="pointer-events-auto glass rounded-[14px]">{storyboardProgress}</div>}

        {isAgentThinking && !storyboardJob && (
          <div className="reply glass pointer-events-auto items-center">
            <Sparkles size={14} className="shrink-0 text-accent" />
            <span className="text-[12px] text-mute">Computing SceneSpec &amp; logic graph mutations</span>
            <span className="dots"><i /><i /><i /></span>
          </div>
        )}

        {showReply && !isAgentThinking && !storyboardJob && (
          <div className="reply glass pointer-events-auto">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 text-[12px] leading-relaxed text-fg">{lastAssistant.content}</p>
              {lastAssistant.diffSummary && lastAssistant.diffSummary.length > 0 && (
                <p className="mt-1 truncate font-mono text-[10px] text-mute">
                  {lastAssistant.diffSummary.length} change{lastAssistant.diffSummary.length === 1 ? '' : 's'} ·{' '}
                  {lastAssistant.diffSummary[0]}
                </p>
              )}
              {lastAssistant.visionReport && (
                <button type="button" className="btn warn sm mt-1.5" onClick={() => setAiMode('drawer')}>
                  Review Vision QA report ({lastAssistant.visionReport.overallScore}/100)
                </button>
              )}
            </div>
            <IconBtn small label="Dismiss reply" onClick={() => setDismissedReplyId(lastAssistant.id)}>
              <X size={13} />
            </IconBtn>
          </div>
        )}

        <form
          data-tour="chat"
          className="aibar glass pointer-events-auto"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt();
          }}
        >
          <Sparkles size={16} className="shrink-0 text-accent" />
          <input
            className="aibar-in"
            aria-label="AI Director prompt"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={INTENT_HELP[intent].placeholder}
          />
          <div className="hidden sm:block">{intentSeg}</div>
          <Dropdown
            up
            align="right"
            panelClass="w-96"
            trigger={({ toggle }) => (
              <IconBtn label={`AI connection: ${providerLabel(settings)}`} onClick={toggle}>
                <Cpu size={15} />
              </IconBtn>
            )}
          >
            {() => (
              <div className="space-y-1.5 p-2">
                <div className="menu-h">AI connection · {providerLabel(settings)}</div>
                <AIConnectionPicker />
              </div>
            )}
          </Dropdown>
          <Dropdown
            up
            align="right"
            panelClass="w-80"
            trigger={({ toggle }) => (
              <IconBtn label="Quick prompts" onClick={toggle}>
                <MessageSquare size={15} />
              </IconBtn>
            )}
          >
            {({ close }) => (
              <>
                <div className="menu-h">Quick director prompts</div>
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="menu-i"
                    onClick={() => {
                      close();
                      handleSendPrompt(q);
                    }}
                  >
                    <span className="line-clamp-2">{q}</span>
                  </button>
                ))}
              </>
            )}
          </Dropdown>
          <span className="aibar-sep" />
          <IconBtn
            label={isVisionRunning ? 'Vision QA scanning…' : 'Vision QA: scan the rendered canvas'}
            active={isVisionRunning}
            disabled={isVisionRunning}
            onClick={handleTriggerVisionCheck}
          >
            <ScanEye size={16} />
          </IconBtn>
          <IconBtn label="Open chat drawer (history, inspector, SceneSpec)" onClick={() => setAiMode('drawer')}>
            <PanelRightOpen size={16} />
          </IconBtn>
          <button type="submit" className="send" disabled={!promptInput.trim() || isAgentThinking} aria-label="Send instruction">
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Shell B · slide-over right chat drawer
  // ---------------------------------------------------------------------------
  return (
    <aside className="drawer glass" aria-label="AI Director">
      <div className="flyout-head">
        <Sparkles size={14} className="mr-1.5 shrink-0 text-accent" />
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold">AI Director</h2>
        <button
          type="button"
          className="btn sm"
          disabled={isVisionRunning}
          onClick={handleTriggerVisionCheck}
          title="Scan the rendered canvas and audit actor placement"
        >
          <ScanEye size={13} /> {isVisionRunning ? 'Scanning…' : 'Vision QA'}
        </button>
        <IconBtn small label="Collapse to floating command bar" onClick={() => setAiMode('bar')}>
          <PanelBottom size={14} />
        </IconBtn>
      </div>

      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <Segmented<DrawerTab>
          label="Drawer section"
          small
          value={drawerTab}
          onChange={setDrawerTab}
          options={[
            { value: 'chat', label: 'Chat', icon: <MessageSquare size={12} /> },
            { value: 'inspector', label: 'Inspector', icon: <Sliders size={12} /> },
            { value: 'json', label: 'SceneSpec', icon: <Code2 size={12} /> },
          ]}
        />
      </div>

      {drawerTab === 'chat' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`msg ${msg.role === 'user' ? 'user' : ''}`}>
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-dim">
                  <span>{msg.role === 'user' ? 'YOU' : 'DIRECTOR'}</span>
                  <span>{msg.timestamp}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                {msg.diffSummary && msg.diffSummary.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-line pt-2">
                    <div className="font-mono text-[10px] uppercase text-accent">SceneSpec mutations</div>
                    {msg.diffSummary.map((line, i) => (
                      <div key={i} className="flex gap-1.5 font-mono text-[11px] text-mute">
                        <span className="text-accent">•</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                )}
                <MessageExtras msg={msg} />
                {msg.visionReport && <VisionReportCard report={msg.visionReport} />}
              </div>
            ))}
            {storyboardProgress}
            {isAgentThinking && !storyboardJob && (
              <div className="msg flex items-center gap-2 font-mono text-[11px] text-accent">
                Computing SceneSpec &amp; logic graph mutations <span className="dots"><i /><i /><i /></span>
              </div>
            )}
          </div>

          <div className="border-t border-line px-3 py-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {QUICK_PROMPTS.map((q) => (
                <button key={q} type="button" className="chip max-w-[220px]" title={q} onClick={() => handleSendPrompt(q)}>
                  <span className="truncate">{q}</span>
                </button>
              ))}
            </div>
          </div>

          <form
            data-tour="chat"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendPrompt();
            }}
            className="space-y-2 border-t border-line p-3"
          >
            <div className="flex items-center justify-between gap-2">
              {intentSeg}
              <span className="truncate text-[10px] text-dim">{INTENT_HELP[intent].title.split(': ')[1]}</span>
            </div>
            <AIConnectionPicker />
            <div className="flex items-end gap-2">
              <textarea
                className="field min-w-0 flex-1"
                rows={2}
                aria-label="AI Director prompt"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                placeholder={INTENT_HELP[intent].placeholder}
              />
              <button type="submit" className="send" disabled={!promptInput.trim() || isAgentThinking} aria-label="Send instruction">
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
        </div>
      )}

      {drawerTab === 'inspector' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ActorInspectorPanel />
        </div>
      )}

      {drawerTab === 'json' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-center justify-between font-mono text-[10px] text-dim">
            <span>Live SceneSpec + logicGraph</span>
            <span className="text-accent">read-only</span>
          </div>
          <pre className="flex-1 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-mute">
            {JSON.stringify(sceneSpec, null, 2)}
          </pre>
        </div>
      )}
    </aside>
  );
};
