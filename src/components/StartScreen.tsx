import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, Film, Gamepad2, Layers, Sparkles, Box, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { useShellStore } from '../state/useShellStore';
import { START_TEMPLATES, StartTemplate, StartTemplateId, buildStartScene, pickTemplate } from '../state/startTemplates';

const ICON: Record<StartTemplateId, React.ReactNode> = {
  'playable-ad': <Gamepad2 size={20} />,
  'platformer-2d': <Layers size={20} />,
  'showcase-3d': <Box size={20} />,
  'short-film': <Film size={20} />,
};

/** Replaces the open work with a fresh project built from a template (the previous project stays saved). */
export function startProject(template: StartTemplate, idea?: string) {
  const spec = buildStartScene(template.id);
  const s = useStudioStore.getState();
  s.closeProject();
  s.startNewDraft();
  s.loadProjectBundle([spec], spec.id);
  s.setProjectName(spec.title);
  // A new project starts with a clean undo history (the old project's steps must not be undoable here).
  useStudioStore.setState({ pastSpecs: [], futureSpecs: [], isPlaying: false, currentTime: 0 });
  useShellStore.getState().setAgentIntent(template.intent);
  useShellStore.getState().setStartOpen(false);
  if (idea?.trim()) useStudioStore.setState({ pendingAgentFixPrompt: idea.trim() });
}

/**
 * Start screen: four template cards and a "Describe it" box. Shown on a first, empty launch and from File → New project.
 * Picking a card opens a working scene in the right mode; describing an idea opens the closest card and hands the text
 * to the AI Director to reshape it.
 */
export const StartScreen: React.FC = () => {
  const open = useShellStore((s) => s.startOpen);
  const setOpen = useShellStore((s) => s.setStartOpen);
  const [idea, setIdea] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const guess = idea.trim() ? pickTemplate(idea) : null;

  const build = () => {
    if (!idea.trim()) return;
    startProject(pickTemplate(idea), idea);
    setIdea('');
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Start a project" data-testid="start-screen">
      <div className="card relative w-full max-w-[760px] p-5 sm:p-6">
        <button type="button" className="ibtn absolute right-3 top-3" onClick={() => setOpen(false)} aria-label="Close start screen" title="Close (Esc)">
          <X size={15} />
        </button>
        <div className="mb-1 flex items-center gap-2">
          <span className="brand">OS</span>
          <h1 className="text-[17px] font-semibold text-fg">What do you want to make?</h1>
        </div>
        <p className="mb-4 text-[12px] text-mute">Pick a starting point, or describe your idea and the AI Director builds it. You can change anything afterwards.</p>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {START_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => startProject(t)}
              className="group flex gap-3 rounded-xl border border-line bg-raised p-3 text-left transition-colors hover:border-accent hover:bg-hover"
              data-testid={`start-${t.id}`}
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">{ICON[t.id]}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                  {t.title}
                  {guess?.id === t.id && <span className="chip text-accent">best match</span>}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-mute">{t.blurb}</span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="rounded bg-bg px-1.5 py-0.5 font-mono text-[11px] text-dim">
                      {tag}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-line bg-panel p-3">
          <label htmlFor="start-idea" className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-fg">
            <Sparkles size={13} className="text-accent" /> Describe it
          </label>
          <textarea
            id="start-idea"
            ref={taRef}
            className="field min-h-[64px] w-full resize-y py-2"
            style={{ height: 'auto' }}
            placeholder={START_TEMPLATES[0].example}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                build();
              }
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {START_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="chip" onClick={() => setIdea(t.example)} title={t.example}>
                Try: {t.title}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" className="btn primary" disabled={!idea.trim()} onClick={build}>
              <Clapperboard size={14} /> Build it
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-dim">
          <span>Your work autosaves as a draft. Open Projects anytime to save it into a project.</span>
          <button type="button" className="underline hover:text-fg" onClick={() => setOpen(false)}>
            Skip, keep the blank scene
          </button>
        </div>
      </div>
    </div>
  );
};
