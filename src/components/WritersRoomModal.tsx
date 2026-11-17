import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ClipboardList, Clapperboard, Film, Loader2, Lock, MessageSquarePlus, Plus, RotateCcw, Trash2, Unlock, Users, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import {
  answerQuestion,
  applyUserEdit,
  bibleForProduction,
  roleById,
  ROOM_ROLES,
  ROOM_TEAMS,
  roomReady,
  runEditor,
  runRoom,
  reviseDesk,
  setDeskLock,
  type RoomDesk,
  type RoomRoleId,
  type RoomTeamId,
  type WritersRoomSession,
} from '../agent/writersRoom';
import { castInventory, characterClips, MAX_LINES_PER_BEAT, STORY_TEMPLATES, STORY_BIBLE_PASS_SCORE } from '../agent/storyBible';
import { makeRoomAsk, secondOpinionSettings } from '../agent/roomClient';
import { produceFromRoom } from '../agent/roomBridge';
import { MeshyCastPanel } from './MeshyCastPanel';
import { BIOME_IDS } from '../runtime/biomes';
import type { StoryBible, StoryTemplateId } from '../types/scene.schema';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const STATUS_STYLE: Record<RoomDesk['status'], { dot: string; label: string }> = {
  waiting: { dot: 'bg-slate-600', label: 'Waiting' },
  working: { dot: 'bg-cyan-400 animate-pulse', label: 'Working' },
  done: { dot: 'bg-emerald-400', label: 'Done' },
  'needs-you': { dot: 'bg-amber-400', label: 'Needs you' },
  error: { dot: 'bg-red-400', label: 'Problem' },
};

const SOURCE_LABEL: Record<NonNullable<RoomDesk['source']>, string> = { ai: 'AI', local: 'offline template', user: 'edited by you', rules: 'rules' };

const inputCls = 'w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 focus:border-cyan-500 outline-none';

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
  </label>
);

const Text: React.FC<{ value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean }> = ({ value, onChange, rows = 1, placeholder, disabled }) =>
  rows > 1 ? (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} disabled={disabled} className={`${inputCls} resize-y`} />
  ) : (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className={inputCls} />
  );

export const WritersRoomModal: React.FC = () => {
  const session = useStudioStore((s) => s.writersRoom);
  const setSession = useStudioStore((s) => s.setWritersRoom);
  const settings = useStudioStore((s) => s.settings);
  const [selected, setSelected] = useState<RoomRoleId>('showrunner');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const sessionId = session?.id;

  useEffect(() => {
    setSelected('showrunner');
    setNotes({});
  }, [sessionId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!session) return null;
  const second = secondOpinionSettings(settings);
  const busy = session.busy;
  const desk = session.desks[selected];
  const role = roleById(selected);

  const makeCtx = () => {
    const ac = new AbortController();
    abortRef.current = ac;
    return { ask: makeRoomAsk(settings, ac.signal), askEditor: makeRoomAsk(second.settings, ac.signal), update: (s: WritersRoomSession) => setSession(s), signal: ac.signal };
  };
  const guarded = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      if (abortRef.current?.signal.aborted) return;
      setSession((cur) => (cur ? { ...cur, busy: false } : cur));
    }
  };

  const start = () => {
    setSelected('architect');
    void guarded(() => runRoom(session, makeCtx()));
  };
  const revise = (r: RoomRoleId) => {
    if (r === 'showrunner' || r === 'continuity' || r === 'editor') return;
    void guarded(() => reviseDesk(session, r, notes[r] || '', makeCtx()));
  };
  const askEditorAgain = () => {
    setSession((cur) => (cur ? { ...cur, busy: true } : cur));
    void guarded(async () => {
      const done = await runEditor(session, makeCtx());
      setSession({ ...done, busy: false });
    });
  };
  const edit = (r: RoomRoleId, change: (b: StoryBible) => void) =>
    setSession((cur) => {
      if (!cur) return cur;
      const next = clone(cur.bible);
      change(next);
      return applyUserEdit(cur, r, next);
    });
  const close = () => {
    abortRef.current?.abort();
    setSession(null);
  };
  const produce = (useRoom: boolean) => {
    const bible = useRoom ? bibleForProduction(session) : undefined;
    abortRef.current?.abort();
    setSession(null);
    produceFromRoom(session, bible);
  };

  const ready = roomReady(session);
  const scoreColor = session.score >= STORY_BIBLE_PASS_SCORE ? 'text-emerald-300 border-emerald-500/50' : session.score >= 60 ? 'text-amber-300 border-amber-500/50' : 'text-red-300 border-red-500/50';
  const deskFindings = session.findings.filter((f) => f.desk === selected);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Writers' Room">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800">
          <div className="flex items-start gap-2 min-w-0">
            <Clapperboard className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-100">Writers’ Room</h2>
              <p className="text-slate-400 truncate" title={session.prompt}>{session.prompt}</p>
              <p className="text-slate-500 mt-0.5">
                {session.intent.sceneCount} scenes · shape: {STORY_TEMPLATES.find((t) => t.id === session.template)?.title || session.template}
                {session.source !== 'ai' && session.stage !== 'briefing' && <span className="text-amber-300"> · {session.source === 'local' ? 'offline templates (no AI answered)' : 'part offline'}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {session.stage !== 'briefing' && (
              <div className={`px-2.5 py-1 rounded-lg border text-center ${scoreColor}`} title="Story rubric + continuity rules (blended with the editor's own score)">
                <div className="text-lg font-bold leading-none">{busy ? '…' : session.score}</div>
                <div className="text-[10px] uppercase tracking-wide opacity-80">story score</div>
              </div>
            )}
            <button type="button" onClick={close} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-100"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[270px_1fr]">
          {/* Team rail */}
          <div className="border-r border-slate-800 p-3 space-y-3 overflow-y-auto">
            {(['story', 'look', 'quality'] as RoomTeamId[]).map((team) => (
              <div key={team}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5"><Users className="w-3 h-3" /> {ROOM_TEAMS[team].title}</div>
                <div className="space-y-1.5">
                  {ROOM_ROLES.filter((r) => r.team === team).map((r) => {
                    const d = session.desks[r.id];
                    const st = STATUS_STYLE[d.status];
                    const active = selected === r.id;
                    const count = session.findings.filter((f) => f.desk === r.id).length;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelected(r.id)}
                        className={`w-full text-left p-2 rounded-xl border transition ${active ? 'border-cyan-500/70 bg-cyan-500/10' : 'border-slate-800 bg-slate-900/70 hover:border-slate-600'}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                          <span className="font-semibold text-slate-100">{r.title}</span>
                          {d.locked && <Lock className="w-3 h-3 text-cyan-300" aria-label="Locked" />}
                          {count > 0 && <span className="ml-auto px-1.5 rounded bg-amber-500/20 text-amber-200">{count}</span>}
                        </div>
                        <div className="mt-0.5 text-slate-400 line-clamp-2">{d.summary}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500">{st.label}{d.source ? ` · ${SOURCE_LABEL[d.source]}` : ''}{d.ms ? ` · ${(d.ms / 1000).toFixed(1)}s` : ''}{d.revisions ? ` · rev ${d.revisions}` : ''}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Desk detail */}
          <div className="p-4 overflow-y-auto space-y-3 min-h-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">{role.title} <span className="font-normal text-slate-500">· {ROOM_TEAMS[role.team].title}</span></h3>
                <p className="text-slate-400">{role.mission}</p>
                {role.kind === 'critic' && <p className="text-slate-500 mt-0.5">Runs on: {second.label}{second.independent ? ' (independent second opinion)' : ' (same connection as the writers: add a backup connection in Settings → AI for a true second opinion)'}.</p>}
              </div>
              {role.kind === 'writer' && (
                <button type="button" onClick={() => setSession((cur) => (cur ? setDeskLock(cur, selected, !cur.desks[selected].locked) : cur))} className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border ${desk.locked ? 'border-cyan-500/60 text-cyan-200 bg-cyan-500/10' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`} title="Locked desks are never re-run or overwritten; the others treat their text as approved">
                  {desk.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />} {desk.locked ? 'Locked' : 'Lock'}
                </button>
              )}
            </div>

            {deskFindings.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-amber-200"><AlertTriangle className="w-3.5 h-3.5" /> Sent to this desk</div>
                {deskFindings.map((f, i) => (
                  <div key={`${f.code}-${i}`} className="text-slate-300"><span className={f.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{f.severity}</span> · {f.message}</div>
                ))}
              </div>
            )}
            {desk.status === 'error' && desk.error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-2.5 text-red-200">{desk.error}</div>}
            {desk.notes.length > 0 && selected !== 'continuity' && <div className="text-slate-500">{desk.notes.slice(-3).join(' · ')}</div>}

            <DeskBody session={session} selected={selected} busy={busy} edit={edit} onAnswer={(id, a) => setSession((cur) => (cur ? answerQuestion(cur, id, a) : cur))} onTemplate={(t) => setSession((cur) => (cur ? { ...cur, template: t } : cur))} onAskEditor={askEditorAgain} />

            {role.kind === 'writer' && session.stage !== 'briefing' && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200"><MessageSquarePlus className="w-3.5 h-3.5 text-cyan-300" /> Note to the {role.title.toLowerCase()}</div>
                <Text value={notes[selected] || ''} onChange={(v) => setNotes((n) => ({ ...n, [selected]: v }))} rows={2} placeholder="e.g. Make the ending sadder. The fox should be the one who is afraid." disabled={busy} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => revise(selected)} disabled={busy || desk.locked} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold disabled:opacity-40">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Revise this desk
                  </button>
                  <span className="text-slate-500">Desks that read it re-run too; locked desks stay as they are.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t border-slate-800">
          <div className="text-slate-400 flex items-center gap-1.5">
            {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300" /> The room is working…</> : session.stage === 'briefing' ? 'Answer the showrunner if you want, then start the room.' : ready.ok ? <><Check className="w-3.5 h-3.5 text-emerald-300" /> Review the desks, edit anything, then produce the film.</> : ready.reason}
          </div>
          <div className="flex items-center gap-2">
            {session.stage === 'briefing' ? (
              <button type="button" onClick={start} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold"><ClipboardList className="w-4 h-4" /> Start the room</button>
            ) : (
              <button type="button" onClick={() => produce(true)} disabled={!ready.ok} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold disabled:opacity-40"><Film className="w-4 h-4" /> Produce film ({session.intent.sceneCount} scenes)</button>
            )}
            <button type="button" onClick={() => produce(false)} disabled={busy} className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40" title="Skip the room: the Director writes the story itself in one step">Skip the room</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------------------------- desk bodies

interface BodyProps {
  session: WritersRoomSession;
  selected: RoomRoleId;
  busy: boolean;
  edit: (role: RoomRoleId, change: (b: StoryBible) => void) => void;
  onAnswer: (id: string, answer: string) => void;
  onTemplate: (t: StoryTemplateId) => void;
  onAskEditor: () => void;
}

const DeskBody: React.FC<BodyProps> = ({ session, selected, busy, edit, onAnswer, onTemplate, onAskEditor }) => {
  const b = session.bible;
  const locked = session.desks[selected].locked;
  const dis = busy || locked;

  if (selected === 'showrunner') {
    return (
      <div className="space-y-3">
        <Field label="Story shape" hint={STORY_TEMPLATES.find((t) => t.id === session.template)?.structure}>
          <select value={session.template} onChange={(e) => onTemplate(e.target.value as StoryTemplateId)} disabled={session.stage !== 'briefing'} className={inputCls}>
            {STORY_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        {session.questions.length === 0 ? (
          <p className="text-slate-400">The request is clear: the showrunner has no questions.</p>
        ) : (
          <div className="space-y-2">
            <div className="font-semibold text-slate-200">Questions only you can answer (optional)</div>
            {session.questions.map((q) => (
              <Field key={q.id} label={q.text}>
                <Text value={q.answer} onChange={(v) => onAnswer(q.id, v)} rows={2} disabled={session.stage !== 'briefing'} />
              </Field>
            ))}
          </div>
        )}
        <div className="text-slate-500">The showrunner plans and briefs the desks. It never writes the story itself.</div>
      </div>
    );
  }

  if (selected === 'architect') {
    return (
      <div className="space-y-3">
        <Field label="Logline" hint="Who wants what, what stands in the way, what is at stake."><Text value={b.logline} onChange={(v) => edit('architect', (x) => { x.logline = v; })} rows={2} disabled={dis} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Theme"><Text value={b.theme} onChange={(v) => edit('architect', (x) => { x.theme = v; })} disabled={dis} /></Field>
          <Field label="Tone"><Text value={b.tone} onChange={(v) => edit('architect', (x) => { x.tone = v; })} disabled={dis} /></Field>
        </div>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label="Hook (first seconds)"><Text value={b.hook} onChange={(v) => edit('architect', (x) => { x.hook = v; })} disabled={dis} /></Field>
          <Field label="Lands at (s)"><input type="number" step="0.5" min={0} value={Number.isFinite(b.hookSeconds) ? b.hookSeconds : ''} onChange={(e) => edit('architect', (x) => { x.hookSeconds = Number(e.target.value); })} disabled={dis} className={inputCls} /></Field>
        </div>
        <Field label="Stakes"><Text value={b.stakes} onChange={(v) => edit('architect', (x) => { x.stakes = v; })} disabled={dis} /></Field>
        <Field label="Turn (reversal near the middle)"><Text value={b.turn} onChange={(v) => edit('architect', (x) => { x.turn = v; })} disabled={dis} /></Field>
        <Field label="Payoff (final image)"><Text value={b.payoff} onChange={(v) => edit('architect', (x) => { x.payoff = v; })} disabled={dis} /></Field>
        <div className="space-y-2">
          <div className="font-semibold text-slate-200">Beats</div>
          {b.beats.map((beat, i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
              <div className="font-semibold text-cyan-300">Scene {beat.scene}</div>
              <Field label="What changes"><Text value={beat.purpose} onChange={(v) => edit('architect', (x) => { x.beats[i].purpose = v; })} disabled={dis} /></Field>
              <Field label="What stands in the way"><Text value={beat.conflict} onChange={(v) => edit('architect', (x) => { x.beats[i].conflict = v; })} disabled={dis} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Feels at start"><Text value={beat.emotionStart} onChange={(v) => edit('architect', (x) => { x.beats[i].emotionStart = v; })} disabled={dis} /></Field>
                <Field label="Feels at end"><Text value={beat.emotionEnd} onChange={(v) => edit('architect', (x) => { x.beats[i].emotionEnd = v; })} disabled={dis} /></Field>
              </div>
              <Field label="Ends on (pulls into the next scene)"><Text value={beat.endsOn} onChange={(v) => edit('architect', (x) => { x.beats[i].endsOn = v; })} disabled={dis} /></Field>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="font-semibold text-slate-200">Motifs that come back</div>
          {(b.motifs || []).map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_70px_28px] gap-1.5 items-end">
              <Field label="What"><Text value={m.what} onChange={(v) => edit('architect', (x) => { x.motifs![i].what = v; })} disabled={dis} /></Field>
              <Field label="Planted"><input type="number" min={1} max={b.beats.length} value={m.setupScene} onChange={(e) => edit('architect', (x) => { x.motifs![i].setupScene = Number(e.target.value); })} disabled={dis} className={inputCls} /></Field>
              <Field label="Pays off"><input type="number" min={1} max={b.beats.length} value={m.payoffScene} onChange={(e) => edit('architect', (x) => { x.motifs![i].payoffScene = Number(e.target.value); })} disabled={dis} className={inputCls} /></Field>
              <button type="button" disabled={dis} onClick={() => edit('architect', (x) => { x.motifs = (x.motifs || []).filter((_, k) => k !== i); })} className="p-1.5 text-slate-500 hover:text-red-300" aria-label="Remove motif"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button type="button" disabled={dis || (b.motifs?.length || 0) >= 4} onClick={() => edit('architect', (x) => { x.motifs = [...(x.motifs || []), { what: '', setupScene: 1, payoffScene: b.beats.length }]; })} className="flex items-center gap-1 text-cyan-300 disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add motif</button>
        </div>
      </div>
    );
  }

  if (selected === 'character') {
    const cast = castInventory();
    return (
      <div className="space-y-3">
        {b.characters.length === 0 && <p className="text-slate-400">No cast yet.</p>}
        {b.characters.map((c, i) => {
          const clips = characterClips(c);
          return (
            <div key={`${c.actorId}-${i}`} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-cyan-300">{c.name || c.actorId}</span>
                <span className="text-slate-500">id: {c.actorId}</span>
                {c.generated && <span className="px-1.5 rounded bg-emerald-500/20 text-emerald-200">custom 3D model · {c.generated.provider}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name"><Text value={c.name} onChange={(v) => edit('character', (x) => { x.characters[i].name = v; })} disabled={dis} /></Field>
                <Field label={c.generated ? 'Model' : 'Stand-in rig'}>
                  {c.generated ? <div className={`${inputCls} text-slate-400`} title={`Scenes are written with ${c.assetId} as the stand-in, then swapped for your model.`}>Meshy model {c.generated.libraryAssetId?.slice(0, 8) || ''} (stand-in: {c.assetId})</div> : (
                    <select value={c.assetId} onChange={(e) => edit('character', (x) => { x.characters[i].assetId = e.target.value; x.characters[i].signatureClip = undefined; })} disabled={dis} className={inputCls}>
                      {!cast.some((a) => a.assetId === c.assetId) && <option value={c.assetId}>{c.assetId}</option>}
                      {cast.map((a) => <option key={a.assetId} value={a.assetId}>{a.name} ({a.clips.length} clips)</option>)}
                    </select>
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Wants"><Text value={c.want} onChange={(v) => edit('character', (x) => { x.characters[i].want = v; })} disabled={dis} /></Field>
                <Field label="Flaw"><Text value={c.flaw} onChange={(v) => edit('character', (x) => { x.characters[i].flaw = v; })} disabled={dis} /></Field>
              </div>
              <Field label="Manner (how it moves and talks)"><Text value={c.manner} onChange={(v) => edit('character', (x) => { x.characters[i].manner = v; })} disabled={dis} /></Field>
              <div className="grid grid-cols-[1fr_180px_70px] gap-2">
                <Field label="Signature gesture"><Text value={c.signatureGesture} onChange={(v) => edit('character', (x) => { x.characters[i].signatureGesture = v; })} disabled={dis} /></Field>
                <Field label="Clip that performs it">
                  <select value={c.signatureClip || ''} onChange={(e) => edit('character', (x) => { x.characters[i].signatureClip = e.target.value || undefined; })} disabled={dis} className={inputCls}>
                    <option value="">(none)</option>
                    {clips.map((cl) => <option key={cl} value={cl}>{cl}</option>)}
                  </select>
                </Field>
                <Field label="Pitch"><input type="number" min={-8} max={8} value={c.pitch ?? 0} onChange={(e) => edit('character', (x) => { x.characters[i].pitch = Number(e.target.value); })} disabled={dis} className={inputCls} /></Field>
              </div>
              <Field label="Look (prompt for a 3D character generator)" hint="English, up to 300 characters. Humanoid characters with two arms and two legs rig best.">
                <Text value={c.look || ''} onChange={(v) => edit('character', (x) => { x.characters[i].look = v || undefined; })} rows={2} disabled={dis} />
              </Field>
              {!c.generated && (
                <MeshyCastPanel
                  look={c.look || ''}
                  name={c.name || c.actorId}
                  disabled={dis}
                  onDone={(r) => edit('character', (x) => {
                    const ch = x.characters.find((q) => q.actorId === c.actorId);
                    if (!ch) return;
                    ch.signatureClip = undefined;
                    ch.generated = { provider: 'meshy', clips: r.clips, modelUrl: r.modelUrl, libraryAssetId: r.assetId };
                  })}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (selected === 'world') {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="font-semibold text-slate-200">Where each scene happens</div>
          {b.beats.map((beat, i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
              <div className="font-semibold text-cyan-300">Scene {beat.scene}</div>
              <div className="grid grid-cols-[1fr_170px] gap-2">
                <Field label="Setting"><Text value={beat.setting || ''} onChange={(v) => edit('world', (x) => { x.beats[i].setting = v || undefined; })} disabled={dis} /></Field>
                <Field label="Biome">
                  <select value={beat.biome || ''} onChange={(e) => edit('world', (x) => { x.beats[i].biome = e.target.value || undefined; })} disabled={dis} className={inputCls}>
                    <option value="">(none)</option>
                    {BIOME_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                </Field>
              </div>
              {(b.props || []).length > 0 && (
                <div className="flex flex-wrap gap-2 text-slate-300">
                  {(b.props || []).map((p) => (
                    <label key={p.id} className="flex items-center gap-1">
                      <input type="checkbox" disabled={dis} checked={!!beat.props?.includes(p.id)} onChange={(e) => edit('world', (x) => {
                        const set = new Set(x.beats[i].props || []);
                        if (e.target.checked) set.add(p.id); else set.delete(p.id);
                        x.beats[i].props = set.size ? [...set] : undefined;
                        const prop = x.props!.find((q) => q.id === p.id)!;
                        prop.scenes = x.beats.map((bb, k) => (bb.props?.includes(p.id) ? k + 1 : 0)).filter(Boolean);
                      })} /> {p.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="font-semibold text-slate-200">Props worth a real model</div>
          {(b.props || []).length === 0 && <p className="text-slate-500">No props: biomes already provide the scenery.</p>}
          {(b.props || []).map((p, i) => (
            <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-cyan-300">{p.name}</span>
                <span className="text-slate-500">scenes {p.scenes.join(', ') || '—'}</span>
                {p.generated && <span className="px-1.5 rounded bg-emerald-500/20 text-emerald-200">custom 3D model</span>}
                <button type="button" disabled={dis} onClick={() => edit('world', (x) => { const id = x.props![i].id; x.props = x.props!.filter((_, k) => k !== i); x.beats.forEach((bb) => { bb.props = bb.props?.filter((q) => q !== id); if (!bb.props?.length) delete bb.props; }); if (!x.props.length) delete x.props; })} className="ml-auto p-1 text-slate-500 hover:text-red-300" aria-label="Remove prop"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <Field label="Name"><Text value={p.name} onChange={(v) => edit('world', (x) => { x.props![i].name = v; })} disabled={dis} /></Field>
              <Field label="Look (prompt for a 3D generator)"><Text value={p.look} onChange={(v) => edit('world', (x) => { x.props![i].look = v; })} rows={2} disabled={dis} /></Field>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (selected === 'dialogue') {
    return (
      <div className="space-y-3">
        {b.beats.map((beat, i) => (
          <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-cyan-300">Scene {beat.scene}</span>
              <span className="text-slate-500 truncate">{beat.purpose}</span>
            </div>
            {(beat.lines || []).length === 0 && <p className="text-slate-500">Silent: acting carries this scene.</p>}
            {(beat.lines || []).map((l, k) => (
              <div key={k} className="grid grid-cols-[110px_1fr_110px_28px] gap-1.5 items-center">
                <select value={l.speaker} onChange={(e) => edit('dialogue', (x) => { x.beats[i].lines![k].speaker = e.target.value; })} disabled={dis} className={inputCls}>
                  {!b.characters.some((c) => c.actorId === l.speaker) && <option value={l.speaker}>{l.speaker} (?)</option>}
                  {b.characters.map((c) => <option key={c.actorId} value={c.actorId}>{c.name || c.actorId}</option>)}
                </select>
                <Text value={l.text} onChange={(v) => edit('dialogue', (x) => { x.beats[i].lines![k].text = v; })} disabled={dis} />
                <Text value={l.emotion || ''} onChange={(v) => edit('dialogue', (x) => { x.beats[i].lines![k].emotion = v || undefined; })} placeholder="emotion" disabled={dis} />
                <button type="button" disabled={dis} onClick={() => edit('dialogue', (x) => { x.beats[i].lines = x.beats[i].lines!.filter((_, q) => q !== k); if (!x.beats[i].lines!.length) delete x.beats[i].lines; })} className="p-1 text-slate-500 hover:text-red-300" aria-label="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button type="button" disabled={dis || (beat.lines?.length || 0) >= MAX_LINES_PER_BEAT || !b.characters.length} onClick={() => edit('dialogue', (x) => { x.beats[i].lines = [...(x.beats[i].lines || []), { speaker: x.characters[0].actorId, text: '' }]; })} className="flex items-center gap-1 text-cyan-300 disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add line</button>
          </div>
        ))}
      </div>
    );
  }

  if (selected === 'continuity') {
    const items = session.findings.filter((f) => f.code.startsWith('room.'));
    return (
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-emerald-300">Everything lines up: speakers exist, props are placed, nobody is forgotten.</p> : items.map((f, i) => (
          <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <span className={f.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{f.severity}</span> · to {roleById(f.desk).title}: {f.message}
          </div>
        ))}
        <p className="text-slate-500">These checks are plain rules, no AI. Fix the problem in the desk named above, or send that desk a note.</p>
      </div>
    );
  }

  // editor
  const items = session.findings;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onAskEditor} disabled={busy || session.stage === 'briefing'} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:border-slate-500 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Ask the editor again
        </button>
        <span className="text-slate-500">Score {session.score}/100{session.editorScore !== undefined ? ` · editor ${session.editorScore}` : ''} · pass mark {STORY_BIBLE_PASS_SCORE}</span>
      </div>
      {items.length === 0 ? <p className="text-emerald-300">No notes: the editor is happy.</p> : items.map((f, i) => (
        <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
          <span className={f.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{f.severity}</span> · to {roleById(f.desk).title}: {f.message}
        </div>
      ))}
    </div>
  );
};
