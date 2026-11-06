import React, { useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Eye,
  MessageSquareCode,
  Send,
  Sliders,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { mutateSceneWithAgent, runVisionQAInspection } from '../agent/studioAgent';
import { ActorClickAction, AnimationType } from '../types/scene.schema';

type RightTab = 'chat' | 'inspector' | 'json';

const QUICK_PROMPTS = [
  'Build a 9:16 Cyber Mecha coin collector playable game',
  'Create a Sunset Golden Hour sneaker commercial showcase',
  'Spawn a Red GT Hypercar and make all actors spin',
  'Load the Quantum Warp Gate RPG boss raid with laser VFX',
];

export const RightAgentChat: React.FC = () => {
  const [activeTab, setActiveTab] = useState<RightTab>('chat');
  const [promptInput, setPromptInput] = useState('');

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const chatMessages = useStudioStore((s) => s.chatMessages);
  const isAgentThinking = useStudioStore((s) => s.isAgentThinking);
  const isVisionRunning = useStudioStore((s) => s.isVisionRunning);
  const latestVisionReport = useStudioStore((s) => s.latestVisionReport);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);
  const addChatMessage = useStudioStore((s) => s.addChatMessage);
  const setAgentThinking = useStudioStore((s) => s.setAgentThinking);
  const setVisionRunning = useStudioStore((s) => s.setVisionRunning);
  const setLatestVisionReport = useStudioStore((s) => s.setLatestVisionReport);
  const applyVisionFixes = useStudioStore((s) => s.applyVisionFixes);
  const selectActor = useStudioStore((s) => s.selectActor);
  const updateActor = useStudioStore((s) => s.updateActor);
  const removeActor = useStudioStore((s) => s.removeActor);

  const selectedActor =
    sceneSpec.actors.find((a) => a.id === selectedActorId) || sceneSpec.actors[0] || null;

  const handleSendPrompt = async (textToUse?: string) => {
    const query = (textToUse ?? promptInput).trim();
    if (!query || isAgentThinking) return;
    if (!textToUse) setPromptInput('');

    const userMsgId = `msg-u-${Date.now()}`;
    addChatMessage({
      id: userMsgId,
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    setAgentThinking(true);
    try {
      const prevSnapshot = JSON.parse(JSON.stringify(sceneSpec));
      const result = await mutateSceneWithAgent(query, sceneSpec);
      setSceneSpec(result.updatedSceneSpec, result.diffSummary);
      addChatMessage({
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        content: result.assistantMessage,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        diffSummary: result.diffSummary,
        previousSpecSnapshot: prevSnapshot,
        updatedSpecSnapshot: result.updatedSceneSpec,
      });
    } finally {
      setAgentThinking(false);
    }
  };

  const handleTriggerVisionCheck = async () => {
    if (isVisionRunning) return;
    setVisionRunning(true);
    try {
      const report = await runVisionQAInspection(canvasElement, sceneSpec);
      setLatestVisionReport(report);
      addChatMessage({
        id: `msg-vqa-${Date.now()}`,
        role: 'assistant',
        content: `Vision QA Spatial Audit complete (${report.overallScore}/100). Found ${report.issues.length} optimization item(s). Review the diagnostic card and click "Apply Recommended Fixes" when ready.`,
        timestamp: report.timestamp,
        visionReport: report,
      });
    } finally {
      setVisionRunning(false);
    }
  };

  return (
    <aside className="w-96 bg-[#0F172A] border-l border-slate-800/90 flex flex-col h-full shrink-0">
      {/* Top Panel Navigation */}
      <div className="p-3.5 border-b border-slate-800/90">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h2 className="font-display font-semibold text-xs uppercase tracking-wider text-slate-200">
              AI Director & Inspector
            </h2>
          </div>
          <button
            onClick={handleTriggerVisionCheck}
            disabled={isVisionRunning}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-[11px] font-medium text-cyan-300 transition-colors"
          >
            <Eye className="w-3 h-3" />
            <span>{isVisionRunning ? 'Scanning...' : 'Vision QA'}</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800/80">
          {[
            { id: 'chat', label: 'AI Agent', icon: <MessageSquareCode className="w-3.5 h-3.5" /> },
            { id: 'inspector', label: 'Inspector', icon: <Sliders className="w-3.5 h-3.5" /> },
            { id: 'json', label: 'SceneSpec', icon: <Code2 className="w-3.5 h-3.5" /> },
          ].map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as RightTab)}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: CONVERSATIONAL CODING AGENT + VISION QA DIAGNOSTICS */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages List */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 rounded-lg border text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan-950/40 border-cyan-500/30 text-slate-100 ml-6'
                    : 'bg-slate-900/90 border-slate-800 text-slate-200 mr-2'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>{msg.role === 'user' ? 'YOU' : 'OMNISTAGE DIRECTOR'}</span>
                  <span>{msg.timestamp}</span>
                </div>
                <p>{msg.content}</p>

                {/* Structured Mutation Summary */}
                {msg.diffSummary && msg.diffSummary.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-1">
                    <div className="text-[10px] font-mono uppercase text-cyan-400">
                      SceneSpec Mutations:
                    </div>
                    {msg.diffSummary.map((line, i) => (
                      <div key={i} className="text-[11px] font-mono text-slate-300 flex gap-1.5">
                        <span className="text-cyan-400">•</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Vision QA Diagnostic Report Card with One-Click Apply Fixes */}
                {msg.visionReport && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-950/90 border border-cyan-500/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-display font-bold uppercase text-cyan-300">
                        Vision QA Spatial Report
                      </span>
                      <span className="text-xs font-mono font-semibold text-amber-400 tabular-nums">
                        Score: {msg.visionReport.overallScore}/100
                      </span>
                    </div>

                    {msg.visionReport.screenshotDataUrl && (
                      <div className="rounded overflow-hidden border border-slate-800 bg-black max-h-28 flex items-center justify-center">
                        <img
                          src={msg.visionReport.screenshotDataUrl}
                          alt="Captured 3D WebGL Stage Snapshot"
                          referrerPolicy="no-referrer"
                          className="h-28 object-contain"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      {msg.visionReport.issues.map((issue) => (
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

                    {latestVisionReport?.applied || msg.visionReport.applied ? (
                      <div className="w-full py-1.5 px-3 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium flex items-center justify-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Spatial Fixes Applied to SceneSpec</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => applyVisionFixes(msg.visionReport!)}
                        className="w-full py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Apply Recommended Fixes</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {isAgentThinking && (
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono text-cyan-300">
                Computing declarative SceneSpec mutations...
              </div>
            )}
          </div>

          {/* Quick Prompt Suggestions */}
          <div className="px-3.5 py-2 border-t border-slate-800/80 bg-slate-950/50">
            <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5">
              Quick Director Prompts
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSendPrompt(q)}
                  className="text-left px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-cyan-300 transition-colors truncate max-w-full"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendPrompt();
            }}
            className="p-3 border-t border-slate-800 flex items-center gap-2 bg-slate-950"
          >
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="Ask AI to spawn actors, change lighting, or animate..."
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!promptInput.trim() || isAgentThinking}
              className="p-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 transition-colors shrink-0"
              title="Send Instruction"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: LIVE ACTOR & MARKETING INSPECTOR */}
      {activeTab === 'inspector' && (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
          {/* Actor Selector Dropdown */}
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

              {/* Position [X, Y, Z] */}
              <div className="space-y-1">
                <span className="text-[11px] font-mono text-slate-400">Position [X, Y, Z] (m)</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                    <div key={axis} className="flex items-center bg-slate-950 rounded border border-slate-800 px-2 py-1">
                      <span className="text-[10px] font-mono text-slate-400 mr-1.5">{axis}</span>
                      <input
                        type="number"
                        step={0.2}
                        value={selectedActor.position[idx]}
                        onChange={(e) => {
                          const nextPos = [...selectedActor.position] as [number, number, number];
                          nextPos[idx] = parseFloat(e.target.value) || 0;
                          updateActor(selectedActor.id, { position: nextPos });
                        }}
                        className="w-full bg-transparent text-xs font-mono text-slate-100 focus:outline-none tabular-nums"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Uniform Scale */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
                  <span>Scale Factor</span>
                  <span>{selectedActor.scale[0].toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={2.4}
                  step={0.05}
                  value={selectedActor.scale[0]}
                  onChange={(e) => {
                    const s = parseFloat(e.target.value);
                    updateActor(selectedActor.id, { scale: [s, s, s] });
                  }}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* Primary & Secondary PBR Colors */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[11px] font-mono text-slate-400">Primary Finish</span>
                  <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded border border-slate-800">
                    <input
                      type="color"
                      value={selectedActor.primaryColor}
                      onChange={(e) =>
                        updateActor(selectedActor.id, { primaryColor: e.target.value })
                      }
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                    />
                    <span className="font-mono text-[11px] text-slate-300">
                      {selectedActor.primaryColor}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] font-mono text-slate-400">Accent / Emissive</span>
                  <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded border border-slate-800">
                    <input
                      type="color"
                      value={selectedActor.secondaryColor || '#F59E0B'}
                      onChange={(e) =>
                        updateActor(selectedActor.id, { secondaryColor: e.target.value })
                      }
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                    />
                    <span className="font-mono text-[11px] text-slate-300">
                      {selectedActor.secondaryColor || '#F59E0B'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Procedural Animation Loop */}
              <div className="space-y-1">
                <span className="text-[11px] font-mono text-slate-400">Procedural Animation</span>
                <select
                  value={selectedActor.activeAnimation}
                  onChange={(e) =>
                    updateActor(selectedActor.id, {
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

              {/* Playable Ad On-Click Behavior */}
              <div className="space-y-1">
                <span className="text-[11px] font-mono text-slate-400">
                  Playable Tap / Click Behavior
                </span>
                <select
                  value={selectedActor.onClickAction}
                  onChange={(e) =>
                    updateActor(selectedActor.id, {
                      onClickAction: e.target.value as ActorClickAction,
                    })
                  }
                  className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                >
                  <option value="collect-score">Collect Score (+PTS)</option>
                  <option value="jump-boost">Jump Boost Impulse</option>
                  <option value="trigger-vfx">Trigger VFX Pulse</option>
                  <option value="cta-redirect">Open Marketing CTA</option>
                  <option value="none">Static / None</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 text-center">
              No actor selected. Spawn an asset from the Left Drawer.
            </div>
          )}

          {/* Marketing CTA Banner Editor */}
          <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2.5">
            <span className="text-[11px] font-mono uppercase text-amber-400 block">
              Marketing Overlay & CTA
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
      )}

      {/* TAB 3: LIVE DECLARATIVE SCENESPEC JSON CONTRACT VIEWER */}
      {activeTab === 'json' && (
        <div className="flex-1 flex flex-col min-h-0 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">
              src/types/scene.schema.ts (Live State)
            </span>
            <span className="text-[10px] font-mono text-cyan-400">100% Data-Driven</span>
          </div>
          <pre className="flex-1 overflow-auto p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-200/90 leading-relaxed">
            {JSON.stringify(sceneSpec, null, 2)}
          </pre>
        </div>
      )}
    </aside>
  );
};
