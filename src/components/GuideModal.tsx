import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { defaultGuideLang, GUIDE_TOPICS, GuideLang } from '../guide/guideContent';
import { runGuideAction } from '../guide/guideActions';

const LANG_KEY = 'omnistage-guide-lang';

function initialLang(): GuideLang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'vi' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return defaultGuideLang();
}

/** Phase 6 batch 2 — Help center: every feature explained step by step, with "Try it" buttons. */
export const GuideModal: React.FC = () => {
  const guide = useStudioStore((s) => s.guide);
  const closeGuide = useStudioStore((s) => s.closeGuide);
  const [lang, setLang] = useState<GuideLang>(initialLang);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(GUIDE_TOPICS[0].id);

  useEffect(() => {
    if (guide.open && guide.topicId) setSelected(guide.topicId);
  }, [guide.open, guide.topicId]);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GUIDE_TOPICS;
    return GUIDE_TOPICS.filter((t) => `${t.title[lang]} ${t.summary[lang]} ${t.steps[lang].join(' ')} ${t.keywords.join(' ')}`.toLowerCase().includes(q));
  }, [query, lang]);

  if (!guide.open) return null;
  const topic = GUIDE_TOPICS.find((t) => t.id === selected) || GUIDE_TOPICS[0];

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Guide">
      <div className="w-full max-w-4xl h-[85vh] flex flex-col rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs">
        <div className="flex items-center gap-2 p-4 border-b border-slate-800">
          <BookOpen className="w-5 h-5 text-cyan-400" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-100">{lang === 'vi' ? 'Hướng dẫn sử dụng OmniStage' : 'OmniStage Guide'}</h2>
            <p className="text-slate-400">{lang === 'vi' ? 'Bạn cũng có thể hỏi trong chat, ví dụ "làm sao chơi thử trên điện thoại?"' : 'You can also ask in the chat, e.g. "how do I play on my phone?"'}</p>
          </div>
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            {(['vi', 'en'] as GuideLang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} className={`px-2.5 py-1 font-semibold ${lang === l ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" onClick={closeGuide} aria-label="Close guide" className="p-1 text-slate-400 hover:text-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[240px_1fr]">
          <nav className="border-r border-slate-800 p-3 space-y-1 overflow-y-auto">
            <label className="flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-lg bg-slate-900 border border-slate-700">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={lang === 'vi' ? 'Tìm…' : 'Search…'} className="flex-1 bg-transparent text-slate-100 placeholder-slate-600 outline-none" />
            </label>
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className={`w-full text-left px-2 py-1.5 rounded-lg ${t.id === topic.id ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-900'}`}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.title[lang]}
              </button>
            ))}
          </nav>

          <article className="p-5 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-100">{topic.icon} {topic.title[lang]}</h3>
              <p className="text-slate-300 mt-1 text-sm">{topic.summary[lang]}</p>
            </div>
            <ol className="space-y-2">
              {topic.steps[lang].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-200 flex items-center justify-center font-bold text-[10px]">{i + 1}</span>
                  <span className="text-slate-200 leading-relaxed text-[13px]">{step}</span>
                </li>
              ))}
            </ol>
            {topic.tips && (
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-100 space-y-1">
                {topic.tips[lang].map((tip, i) => <p key={i}>💡 {tip}</p>)}
              </div>
            )}
            {topic.action && (
              <button type="button" onClick={() => runGuideAction(topic.action!.id)} className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold">
                {topic.action.label[lang]} →
              </button>
            )}
          </article>
        </div>
      </div>
    </div>
  );
};
