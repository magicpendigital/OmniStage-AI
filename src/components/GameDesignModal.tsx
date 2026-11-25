import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Gamepad2, Loader2, RotateCcw, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import {
  coerceGameDesign,
  GAME_DESIGN_PASS_SCORE,
  GAME_GENRES,
  GAME_VERBS,
  gameDesignForProduction,
  lintGameDesign,
  relintGameDesign,
  writeGameDesign,
  type GameDesignIssue,
} from '../agent/gameDesign';
import { makeGameDesignAsk, produceFromGameDesign } from '../agent/gameDesignClient';
import type { GameDesign, GameGenre, GameVerb } from '../types/scene.schema';

const inputCls = 'w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 focus:border-cyan-500 outline-none';
const WINS: GameDesign['win'][] = ['collect-all', 'score-threshold', 'survive-timer', 'variable-threshold'];
const LOSES: GameDesign['lose'][] = ['health', 'hazard-reset', 'timer'];

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
    {children}
  </label>
);

/**
 * Phase 4: the game designer's review step. The design (genre, core loop, win / lose, verbs, a teaching ramp per level) is
 * written first, you read and edit it, and only then are the levels authored against it.
 */
export const GameDesignModal: React.FC = () => {
  const session = useStudioStore((s) => s.gameDesignSession);
  const setSession = useStudioStore((s) => s.setGameDesignSession);
  const settings = useStudioStore((s) => s.settings);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedFor = useRef<string | null>(null);

  const levelCount = session?.intent.sceneCount ?? 3;

  // Write the first draft when a session opens.
  useEffect(() => {
    if (!session || session.status !== 'writing') return;
    const key = `${session.prompt}|${session.intent.sceneCount}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    const controller = new AbortController();
    abortRef.current = controller;
    void writeGameDesign({
      prompt: session.prompt,
      intent: session.intent,
      ask: makeGameDesignAsk(settings, session.prompt, session.intent, controller.signal),
    }).then((written) => {
      if (controller.signal.aborted) return;
      setSession((cur) =>
        cur && cur.status === 'writing'
          ? { ...cur, status: 'review', design: written.design, score: written.lint.score, issues: written.lint.issues, source: written.source, notes: written.notes }
          : cur
      );
    });
    return () => {
      // A re-render with the same session must not cancel the draft; closing the modal does (see close()).
    };
  }, [session, settings, setSession]);

  if (!session) return null;

  const close = () => {
    abortRef.current?.abort();
    startedFor.current = null;
    setSession(null);
  };

  const design = session.design;
  const edit = (patch: Partial<GameDesign>) => {
    if (!design) return;
    const next = { ...design, ...patch };
    const lint = relintGameDesign(next, levelCount);
    setSession((cur) => (cur ? { ...cur, design: next, score: lint.score, issues: lint.issues } : cur));
  };
  const editLevel = (i: number, patch: Partial<GameDesign['levels'][number]>) => {
    if (!design) return;
    edit({ levels: design.levels.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  };
  const toggleVerb = (v: GameVerb) => {
    if (!design) return;
    edit({ mechanics: design.mechanics.includes(v) ? design.mechanics.filter((x) => x !== v) : [...design.mechanics, v] });
  };

  const rewrite = async () => {
    if (!design || busy) return;
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const ask = makeGameDesignAsk(settings, session.prompt, session.intent, controller.signal);
      const findings: GameDesignIssue[] = [
        ...(note.trim() ? [{ code: 'user.note', severity: 'error' as const, message: `The user asks: ${note.trim()}` }] : []),
        ...lintGameDesign(design, levelCount).issues,
      ];
      const next = coerceGameDesign(await ask({ draft: design, findings }), levelCount);
      if (next) {
        const lint = relintGameDesign(next, levelCount);
        setSession((cur) => (cur ? { ...cur, design: next, score: lint.score, issues: lint.issues, source: 'ai', notes: [...cur.notes, 'rewritten with your note'] } : cur));
        setNote('');
      } else {
        setSession((cur) => (cur ? { ...cur, notes: [...cur.notes, 'the AI returned no usable design; your version is unchanged'] } : cur));
      }
    } catch {
      setSession((cur) => (cur ? { ...cur, notes: [...cur.notes, 'the rewrite failed (is an AI connection configured?); your version is unchanged'] } : cur));
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    if (!design) return;
    const final = gameDesignForProduction(design, levelCount);
    if (produceFromGameDesign(session, final)) {
      startedFor.current = null;
      setSession(null);
    }
  };

  const score = session.score ?? 0;
  const scoreColor = score >= GAME_DESIGN_PASS_SCORE ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10';
  const errors = (session.issues || []).filter((i) => i.severity === 'error');

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Game design">
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800">
          <div className="flex items-start gap-2 min-w-0">
            <Gamepad2 className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-100">Game design</h2>
              <p className="text-slate-400 truncate" title={session.prompt}>{session.prompt}</p>
              <p className="text-slate-500 mt-0.5">
                {levelCount} levels
                {session.source === 'local' && <span className="text-amber-300"> · offline template (no AI answered)</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {design && (
              <div className={`px-2.5 py-1 rounded-lg border text-center ${scoreColor}`} title="Design rubric: pitch, core loop, win / lose, verbs taught one at a time, rising difficulty">
                <div className="text-lg font-bold leading-none">{busy ? '…' : score}</div>
                <div className="text-[10px] uppercase tracking-wide opacity-80">design score</div>
              </div>
            )}
            <button type="button" onClick={close} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-100"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {!design ? (
          <div className="p-10 flex items-center justify-center gap-2 text-slate-300"><Loader2 className="w-4 h-4 animate-spin" /> The game designer is writing the design…</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Title"><input className={inputCls} value={design.title} onChange={(e) => edit({ title: e.target.value })} /></Field>
              <Field label="Genre">
                <select className={inputCls} value={design.genre} onChange={(e) => edit({ genre: e.target.value as GameGenre })}>
                  {GAME_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Pitch"><textarea className={`${inputCls} resize-y`} rows={2} value={design.pitch} onChange={(e) => edit({ pitch: e.target.value })} /></Field>
            <Field label="Core loop (what the player repeats)"><input className={inputCls} value={design.coreLoop} onChange={(e) => edit({ coreLoop: e.target.value })} /></Field>
            <Field label="Player goal"><input className={inputCls} value={design.goal} onChange={(e) => edit({ goal: e.target.value })} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Win">
                <select className={inputCls} value={design.win} onChange={(e) => edit({ win: e.target.value as GameDesign['win'] })}>
                  {WINS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Lose">
                <select className={inputCls} value={design.lose} onChange={(e) => edit({ lose: e.target.value as GameDesign['lose'], ...(e.target.value === 'health' ? { usesHealth: true } : {}) })}>
                  {LOSES.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Time limit (s)">
                <input type="number" min={5} max={600} className={inputCls} value={design.timeLimitSeconds ?? ''} placeholder="none" onChange={(e) => edit({ timeLimitSeconds: e.target.value ? Number(e.target.value) : undefined })} />
              </Field>
            </div>
            <label className="inline-flex items-center gap-1.5 text-slate-300">
              <input type="checkbox" checked={design.usesHealth} onChange={(e) => edit({ usesHealth: e.target.checked })} /> The player has health (damage instead of instant respawn)
            </label>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Verbs the game uses</div>
              <div className="flex flex-wrap gap-1.5">
                {GAME_VERBS.map((v) => (
                  <button key={v} type="button" onClick={() => toggleVerb(v)} aria-pressed={design.mechanics.includes(v)} className={`px-2 py-1 rounded-lg border ${design.mechanics.includes(v) ? 'border-cyan-500/70 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>{v}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Levels: one new thing each</div>
              <div className="space-y-1.5">
                {design.levels.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1.5rem_1fr_1.4fr_4rem] gap-2 items-center">
                    <span className="text-slate-500 text-center">{i + 1}</span>
                    <input className={inputCls} value={l.name} onChange={(e) => editLevel(i, { name: e.target.value })} aria-label={`Level ${i + 1} name`} />
                    <input className={inputCls} value={l.teaches} placeholder={l.introduces.join(', ') || 'what it teaches'} onChange={(e) => editLevel(i, { teaches: e.target.value })} aria-label={`Level ${i + 1} teaches`} />
                    <input type="number" min={1} max={5} className={inputCls} value={l.difficulty} onChange={(e) => editLevel(i, { difficulty: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} aria-label={`Level ${i + 1} difficulty`} />
                  </div>
                ))}
              </div>
            </div>

            {(session.issues || []).length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-amber-200"><AlertTriangle className="w-3.5 h-3.5" /> Design editor</div>
                {(session.issues || []).map((i, idx) => <div key={idx} className={i.severity === 'error' ? 'text-red-300' : 'text-amber-200'}>• {i.message}</div>)}
              </div>
            )}
            {session.notes.length > 0 && <div className="text-slate-500">{session.notes.join(' · ')}</div>}

            <div className="flex gap-2 items-end">
              <div className="flex-1"><Field label="Ask the designer to change something"><input className={inputCls} value={note} placeholder="e.g. make it a survival game with turrets" onChange={(e) => setNote(e.target.value)} /></Field></div>
              <button type="button" onClick={rewrite} disabled={busy} className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:border-slate-500 disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Rewrite
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 p-3 border-t border-slate-800">
          <span className="text-slate-500">{errors.length ? `${errors.length} problem(s) will be repaired automatically when you build.` : 'Levels are written against this design and checked against it.'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={close} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:border-slate-500">Cancel</button>
            <button type="button" onClick={approve} disabled={!design || busy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Build the game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
