import React, { useEffect, useLayoutEffect, useState } from 'react';
import { defaultGuideLang, GuideLang } from '../guide/guideContent';
import { START_TOUR_EVENT } from '../guide/guideActions';
import { useStudioStore } from '../state/useStudioStore';

const DONE_KEY = 'omnistage-tour-done-v1';

interface TourStep {
  target: string; // data-tour attribute value
  title: Record<GuideLang, string>;
  body: Record<GuideLang, string>;
}

const STEPS: TourStep[] = [
  {
    target: 'engine-mode',
    title: { vi: '1. Chọn bạn đang làm gì', en: '1. Choose what you are making' },
    body: {
      vi: '3D hoặc 2D, rồi Game Mode (game) hoặc Cinema / Media (phim, quảng cáo, motion graphics).',
      en: '3D or 2D, then Game Mode (games) or Cinema / Media (films, ads, motion graphics).',
    },
  },
  {
    target: 'chat',
    title: { vi: '2. Mô tả ý tưởng cho AI Director', en: '2. Describe your idea to the AI Director' },
    body: {
      vi: 'Ví dụ: "Tạo game 2D nhảy qua chướng ngại vật 3 màn, màu pastel, có âm thanh". AI dựng cảnh và tự kiểm tra.',
      en: 'For example: "Make a 3-level 2D platformer, pastel colours, with sound". The AI builds the scene and checks it.',
    },
  },
  {
    target: 'viewport',
    title: { vi: '3. Xem và chỉnh trực tiếp', en: '3. See it and edit directly' },
    body: {
      vi: 'Kéo thả nhân vật trong viewport. Cột trái có Outliner (các đối tượng), World (địa hình, âm thanh, phụ đề) và Library (asset của bạn).',
      en: 'Drag things in the viewport. The left column has the Outliner (objects), World (terrain, sound, captions) and Library (your assets).',
    },
  },
  {
    target: 'play',
    title: { vi: '4. Chơi thử / Xem trước', en: '4. Play test / Preview' },
    body: {
      vi: 'Game Mode: ▶ Play Test chạy đúng bản sẽ xuất bản, kể cả trên điện thoại qua mã QR. Media: ▶ Preview phát toàn bộ các cảnh.',
      en: 'Game Mode: ▶ Play Test runs the exact build you publish, also on your phone via QR. Media: ▶ Preview plays every scene.',
    },
  },
  {
    target: 'projects',
    title: { vi: '5. Lưu thành dự án', en: '5. Save it as a project' },
    body: {
      vi: 'Projects lưu game trên máy bạn và tự lưu sau mỗi thay đổi. Extensions bổ sung skill, hiệu ứng, công cụ (bạn duyệt trước khi cài).',
      en: 'Projects saves games on your computer and autosaves. Extensions add skills, effects and tools (you approve every install).',
    },
  },
  {
    target: 'guide',
    title: { vi: '6. Cần giúp? Mở Guide', en: '6. Need help? Open the Guide' },
    body: {
      vi: 'Guide giải thích từng tính năng. Bạn cũng có thể hỏi trong chat: "làm sao xuất bản lên TikTok?"',
      en: 'The Guide explains every feature. You can also ask in the chat: "how do I publish to TikTok?"',
    },
  },
];

/** Phase 6 batch 2 — first-run tour: highlights the main areas of the studio, one step at a time. */
export const WelcomeTour: React.FC = () => {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const lang = defaultGuideLang();

  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(DONE_KEY) === '1';
    } catch {
      done = true; // no storage: don't nag on every load
    }
    if (!done) {
      const t = window.setTimeout(() => setStep(0), 1200);
      return () => window.clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const start = () => setStep(0);
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  useLayoutEffect(() => {
    if (step === null) return;
    const update = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [step]);

  if (step === null) return null;
  const s = STEPS[step];

  const finish = () => {
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // ignore
    }
    setStep(null);
  };

  // Card goes below the highlighted area when there is room, else above; centred when the target is missing.
  const cardWidth = 340;
  let cardStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const below = rect.bottom + 12;
    const top = below + 190 < window.innerHeight ? below : Math.max(12, rect.top - 190);
    const left = Math.min(window.innerWidth - cardWidth - 12, Math.max(12, rect.left + rect.width / 2 - cardWidth / 2));
    cardStyle = { left, top };
  }

  return (
    <div className="fixed inset-0 z-[95] text-xs" role="dialog" aria-modal="true" aria-label="Welcome tour">
      {rect ? (
        <div
          className="absolute rounded-xl border-2 border-cyan-400 pointer-events-none transition-all duration-300"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 9999px rgba(2,6,23,0.72)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/70" />
      )}
      <div className="absolute rounded-xl bg-[#0B1220] border border-cyan-500/40 shadow-2xl p-4 space-y-2" style={{ ...cardStyle, width: cardWidth }}>
        <div className="text-[10px] font-mono text-cyan-400">{lang === 'vi' ? 'Chào mừng đến OmniStage' : 'Welcome to OmniStage'} · {step + 1}/{STEPS.length}</div>
        <div className="font-bold text-slate-100 text-sm">{s.title[lang]}</div>
        <p className="text-slate-300 leading-relaxed">{s.body[lang]}</p>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={finish} className="text-slate-400 hover:text-slate-200">{lang === 'vi' ? 'Bỏ qua' : 'Skip'}</button>
          <div className="ml-auto flex gap-1.5">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="px-2.5 py-1 rounded border border-slate-700 text-slate-200">←</button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => setStep(step + 1)} className="px-3 py-1 rounded bg-cyan-500 text-slate-950 font-semibold">{lang === 'vi' ? 'Tiếp' : 'Next'}</button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  finish();
                  useStudioStore.getState().openGuide('getting-started');
                }}
                className="px-3 py-1 rounded bg-cyan-500 text-slate-950 font-semibold"
              >
                {lang === 'vi' ? 'Mở Guide' : 'Open the Guide'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
