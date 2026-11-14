/**
 * Phase 6 batch 2 — In-app Guide content (Vietnamese + English) and "How do I…?" matching for the chat.
 * Pure data + functions so the Help center, the welcome tour and the AI chat share one source of truth.
 */

export type GuideLang = 'vi' | 'en';

export type GuideAction = 'playtest' | 'phone' | 'preview' | 'projects' | 'extensions' | 'settings-ai' | 'settings-memory' | 'publish' | 'tour';

export interface GuideTopic {
  id: string;
  icon: string;
  title: Record<GuideLang, string>;
  summary: Record<GuideLang, string>;
  steps: Record<GuideLang, string[]>;
  tips?: Record<GuideLang, string[]>;
  /** Lower-case words (VI + EN) used to answer "how do I…?" questions in the chat. */
  keywords: string[];
  action?: { id: GuideAction; label: Record<GuideLang, string> };
}

export const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'getting-started',
    icon: '🚀',
    title: { vi: 'Bắt đầu trong 3 bước', en: 'Get started in 3 steps' },
    summary: {
      vi: 'Chọn loại dự án, mô tả ý tưởng cho AI Director, rồi chơi thử ngay.',
      en: 'Pick what you are making, describe it to the AI Director, then play it right away.',
    },
    steps: {
      vi: [
        'Trên thanh trên cùng chọn 3D Engine hoặc 2D Engine, rồi chọn Game Mode (game) hoặc Cinema / Media (phim, quảng cáo, motion graphics).',
        'Gõ ý tưởng vào ô chat bên phải, ví dụ: "Tạo game 2D nhảy qua chướng ngại vật 3 màn, có âm thanh". AI sẽ dựng cảnh và tự kiểm tra (huy hiệu VERIFIED).',
        'Bấm ▶ Play Test (Game Mode) hoặc ▶ Preview (Media) trên thanh trên cùng để chơi / xem toàn màn hình.',
        'Mở Projects để lưu thành dự án: OmniStage tự lưu vài giây sau mỗi thay đổi.',
      ],
      en: [
        'In the top bar choose 3D Engine or 2D Engine, then Game Mode (games) or Cinema / Media (films, ads, motion graphics).',
        'Type your idea in the chat on the right, e.g. "Make a 3-level 2D platformer with sound". The AI builds the scene and checks it (VERIFIED badge).',
        'Press ▶ Play Test (Game Mode) or ▶ Preview (Media) in the top bar to play / watch full screen.',
        'Open Projects to save it as a project: OmniStage autosaves a few seconds after each change.',
      ],
    },
    keywords: ['start', 'begin', 'bắt đầu', 'mới dùng', 'người mới', 'getting started', 'first'],
    action: { id: 'tour', label: { vi: 'Xem tour giới thiệu', en: 'Take the tour' } },
  },
  {
    id: 'play-test',
    icon: '🎮',
    title: { vi: 'Chơi thử game (Play Test)', en: 'Play test your game' },
    summary: {
      vi: 'Chạy đúng bản game sẽ được xuất bản, toàn màn hình, với mọi màn chơi.',
      en: 'Runs exactly the build you will publish, full screen, with every level.',
    },
    steps: {
      vi: [
        'Bật Game Mode rồi bấm ▶ Play Test trên thanh trên cùng.',
        'Điều khiển: A/D hoặc ←/→ để chạy, W/↑/Space để nhảy (2D); WASD để di chuyển (3D). Trên màn hình cảm ứng có nút ảo.',
        'Chọn màn bắt đầu ở ô "Start from", bấm ↻ để chơi lại từ đầu.',
        'Đổi khung thiết bị (Desktop / Phone dọc / Phone ngang / Tablet) để xem bố cục trên điện thoại.',
        'Bật FPS để xem tốc độ khung hình; các chip màu cho biết từng màn có qua bộ kiểm tra (verifier) không.',
      ],
      en: [
        'Turn on Game Mode and press ▶ Play Test in the top bar.',
        'Controls: A/D or ←/→ to run, W/↑/Space to jump (2D); WASD to move (3D). Touch screens get virtual buttons.',
        'Pick the first level in "Start from", press ↻ to restart.',
        'Switch the device frame (Desktop / Phone portrait / Phone landscape / Tablet) to check phone layouts.',
        'Turn on FPS to see the frame rate; coloured chips show whether each level passes the verifier.',
      ],
    },
    tips: {
      vi: ['Nút ▶ trong dock timeline chỉ chạy cảnh đang mở trong viewport để chỉnh sửa nhanh; Play Test mới là bản chạy giống hệt khi xuất bản.'],
      en: ['The ▶ in the timeline dock only runs the open scene inside the editor; Play Test runs the same build you export.'],
    },
    keywords: ['play test', 'playtest', 'chơi thử', 'test game', 'thử game', 'play', 'chơi', 'kiểm tra game'],
    action: { id: 'playtest', label: { vi: 'Mở Play Test', en: 'Open Play Test' } },
  },
  {
    id: 'phone-preview',
    icon: '📱',
    title: { vi: 'Chơi thử trên điện thoại', en: 'Play on your phone' },
    summary: {
      vi: 'Quét mã QR để mở game trên iPhone/Android cùng mạng Wi-Fi, không cần cài app.',
      en: 'Scan a QR code to open the game on an iPhone/Android on the same Wi-Fi, no install needed.',
    },
    steps: {
      vi: [
        'Mở ▶ Play Test rồi bấm "📱 Play on phone".',
        'Điện thoại và máy tính phải dùng chung một mạng Wi-Fi. Quét mã QR bằng camera điện thoại.',
        'Lần đầu Windows có thể hỏi cho phép Node.js truy cập mạng: chọn "Private networks".',
        'Link chỉ mở được bản game đó (chỉ đọc) và hết hạn sau 4 giờ. Dữ liệu dự án vẫn chỉ ở máy tính của bạn.',
      ],
      en: [
        'Open ▶ Play Test and press "📱 Play on phone".',
        'Phone and computer must be on the same Wi-Fi. Scan the QR code with the phone camera.',
        'The first time, Windows may ask to let Node.js use the network: allow "Private networks".',
        'The link only serves that build (read-only) and expires after 4 hours. Your project data stays on your computer.',
      ],
    },
    // Phrases ("trên điện thoại", "on my phone") outweigh the generic "chơi thử / play" of the Play Test topic.
    keywords: ['phone', 'điện thoại', 'trên điện thoại', 'on my phone', 'on a phone', 'on phone', 'mobile', 'iphone', 'android', 'qr', 'di động', 'ios'],
    action: { id: 'phone', label: { vi: 'Mở Play Test để lấy mã QR', en: 'Open Play Test for the QR code' } },
  },
  {
    id: 'media-preview',
    icon: '🎬',
    title: { vi: 'Xem trước toàn bộ phim / storyboard', en: 'Preview the whole film / storyboard' },
    summary: {
      vi: 'Phát lần lượt mọi cảnh từ đầu đến cuối, có chuyển cảnh, phụ đề và âm thanh.',
      en: 'Plays every scene from start to end with transitions, captions and sound.',
    },
    steps: {
      vi: [
        'Chọn Cinema / Media rồi bấm ▶ Preview trên thanh trên cùng.',
        'Nếu cảnh thuộc một storyboard (ví dụ "phim 3D gồm 3 cảnh"), Preview chạy đúng thứ tự storyboard; nếu không, chạy mọi cảnh trong dự án.',
        'Phím tắt: Space tạm dừng, ←/→ cảnh trước/sau, Esc thoát.',
        'Muốn xuất video: Export & Publish → Multi-Scene Sequencer.',
      ],
      en: [
        'Choose Cinema / Media and press ▶ Preview in the top bar.',
        'If the scene belongs to a storyboard (e.g. "a 3-scene 3D film"), Preview follows the storyboard order; otherwise it plays every scene in the project.',
        'Shortcuts: Space pause, ←/→ previous/next scene, Esc exit.',
        'To export a video: Export & Publish → Multi-Scene Sequencer.',
      ],
    },
    keywords: ['preview', 'xem trước', 'phim', 'film', 'storyboard', 'toàn bộ', 'full', 'video', 'xem phim'],
    action: { id: 'preview', label: { vi: 'Bắt đầu Preview', en: 'Start Preview' } },
  },
  {
    id: 'ai-director',
    icon: '🤖',
    title: { vi: 'Làm việc với AI Director', en: 'Working with the AI Director' },
    summary: {
      vi: 'Mô tả mục tiêu và cảm giác bạn muốn; AI dựng cảnh, kiểm tra và giải thích thay đổi.',
      en: 'Describe the goal and feel you want; the AI builds the scene, checks it and explains the changes.',
    },
    steps: {
      vi: [
        'Nói "cái gì" và "vì sao": "game cho trẻ 6-10 tuổi, màu pastel, nhảy nhẹ nhàng" tốt hơn liệt kê từng thông số.',
        '"Phim 3D gồm 3 cảnh…" hoặc "game 2D 4 màn…" tạo cả storyboard nhiều cảnh trong một lần.',
        'Huy hiệu VERIFIED nghĩa là cảnh chơi được (với tới mọi vật phẩm, đủ điểm thắng…); nếu báo lỗi, AI đã tự sửa phần có thể sửa.',
        'Thích kết quả? Bấm "Save as skill" để AI nhớ công thức đó cho lần sau.',
        'Nút Undo / Redo trên thanh trên cùng hoàn tác mọi thay đổi của AI.',
      ],
      en: [
        'Say what and why: "a game for kids 6-10, pastel colours, gentle jumps" works better than listing numbers.',
        '"A 3-scene 3D film…" or "a 4-level 2D game…" creates a whole multi-scene storyboard at once.',
        'VERIFIED means the scene is playable (every pickup reachable, winnable score…); if errors remain, the AI already fixed what it could.',
        'Like a result? Press "Save as skill" so the AI reuses that recipe next time.',
        'Undo / Redo in the top bar reverts any AI change.',
      ],
    },
    keywords: ['ai', 'director', 'prompt', 'chat', 'trợ lý', 'ra lệnh', 'skill', 'verified', 'storyboard'],
  },
  {
    id: 'providers',
    icon: '🔌',
    title: { vi: 'Chọn AI (API key hoặc CLI đã cài)', en: 'Choose the AI (API key or installed CLI)' },
    summary: {
      vi: 'Dùng Gemini, Claude, OpenRouter, mô hình cục bộ hoặc Claude Code / Codex / Antigravity / OpenCode đã đăng nhập trên máy.',
      en: 'Use Gemini, Claude, OpenRouter, local models, or Claude Code / Codex / Antigravity / OpenCode already signed in on this computer.',
    },
    steps: {
      vi: [
        'Mở Settings → AI. Chọn một ô provider (chấm xanh = sẵn sàng).',
        'Provider API: dán API key (chỉ lưu trong trình duyệt này) và tuỳ chọn model.',
        'Provider CLI: cài và đăng nhập CLI trước (chạy CLI một lần trong terminal); OmniStage tự phát hiện. CLI chậm hơn API (1–3 phút mỗi lượt sửa cảnh lớn).',
        'Bấm "Test connection" để kiểm tra.',
      ],
      en: [
        'Open Settings → AI and pick a provider tile (green dot = ready).',
        'API providers: paste an API key (stored in this browser only) and optionally a model.',
        'CLI providers: install and sign in to the CLI first (run it once in a terminal); OmniStage detects it. CLIs are slower than APIs (1–3 minutes for a large scene edit).',
        'Press "Test connection" to check.',
      ],
    },
    keywords: ['api', 'key', 'provider', 'gemini', 'claude', 'openrouter', 'codex', 'antigravity', 'opencode', 'cli', 'model', 'mô hình'],
    action: { id: 'settings-ai', label: { vi: 'Mở Settings → AI', en: 'Open Settings → AI' } },
  },
  {
    id: 'projects',
    icon: '📁',
    title: { vi: 'Dự án và lưu tự động', en: 'Projects and autosave' },
    summary: {
      vi: 'Mỗi dự án là một game, hoặc một bộ sưu tập game nhỏ dùng chung asset. Lưu trên máy bạn.',
      en: 'Each project is one game, or a collection of small games sharing assets. Saved on your computer.',
    },
    steps: {
      vi: [
        'Bấm Projects ở thanh trên cùng → New project (đặt tên, loại, tag, mô tả tầm nhìn: AI đọc phần này).',
        'Add a game: tạo từ cảnh đang mở hoặc cảnh trống 2D/3D; bấm Open để mở.',
        'Nhãn "Saved / Unsaved" cạnh tên dự án cho biết trạng thái; Ctrl+S để lưu ngay.',
        'Xoá dự án/game chỉ chuyển vào thư mục ~/OmniStage/.trash, có thể khôi phục.',
      ],
      en: [
        'Click Projects in the top bar → New project (name, type, tags, vision description: the AI reads it).',
        'Add a game from the open scene or a blank 2D/3D scene; press Open to load it.',
        'The "Saved / Unsaved" badge next to the project name shows the state; Ctrl+S saves now.',
        'Deleting only moves files to ~/OmniStage/.trash, so they can be restored.',
      ],
    },
    keywords: ['project', 'dự án', 'save', 'lưu', 'autosave', 'mở game', 'open', 'collection'],
    action: { id: 'projects', label: { vi: 'Mở Projects', en: 'Open Projects' } },
  },
  {
    id: 'library',
    icon: '🗂️',
    title: { vi: 'Thư viện asset riêng', en: 'Your own asset library' },
    summary: {
      vi: 'Lưu model 3D, ảnh, sprite, âm thanh của bạn để dùng lại ở mọi dự án.',
      en: 'Keep your 3D models, images, sprites and sounds to reuse in every project.',
    },
    steps: {
      vi: [
        'Tab Library (cột trái) → My Library → Add files (.glb, .png, .svg, .mp3…).',
        'Personal: dùng cho mọi dự án. Project: chỉ dùng chung giữa các game của dự án đang mở.',
        'Bấm + để đặt asset vào cảnh. Model 3D phải có xương sẵn để chạy animation (tự động gắn xương có trong lộ trình).',
      ],
      en: [
        'Library tab (left column) → My Library → Add files (.glb, .png, .svg, .mp3…).',
        'Personal: for every project. Project: shared by the games of the open project.',
        'Press + to place an asset in the scene. 3D models need an existing rig to animate (auto-rigging is on the roadmap).',
      ],
    },
    keywords: ['library', 'thư viện', 'asset', 'import', 'upload', 'model', 'glb', 'ảnh', 'sprite', 'tải lên'],
  },
  {
    id: 'extensions',
    icon: '🧩',
    title: { vi: 'Extensions: skill, hiệu ứng, công cụ', en: 'Extensions: skills, effects, tools' },
    summary: {
      vi: 'Bật đúng những gì game của bạn cần; mọi lần cài đều phải bạn duyệt.',
      en: 'Turn on only what your game needs; every install needs your approval.',
    },
    steps: {
      vi: [
        'Bấm Extensions → Catalog → Review & install. Hộp duyệt cho biết mức rủi ro và từng quyền; tick các quyền rồi Install.',
        'Add / Create with AI: mô tả phong cách game, AI soạn một gói skill/hiệu ứng/âm thanh để bạn duyệt.',
        'AI Director cũng có thể gợi ý extension ngay trong chat (thẻ "Suggested extension").',
        'Installed: bật/tắt, chạy lệnh của plugin, gỡ cài. Built-in skills: tắt skill có sẵn không cần.',
      ],
      en: [
        'Click Extensions → Catalog → Review & install. The review shows the risk and each permission; tick them, then Install.',
        'Add / Create with AI: describe your game style and the AI drafts a skill/effect/sound pack for you to review.',
        'The AI Director can also suggest extensions in the chat ("Suggested extension" cards).',
        'Installed: enable/disable, run plugin commands, uninstall. Built-in skills: switch off skills you don\'t need.',
      ],
    },
    keywords: ['extension', 'plugin', 'skill', 'cài', 'install', 'hiệu ứng', 'effect', 'vfx', 'sfx', 'gói'],
    action: { id: 'extensions', label: { vi: 'Mở Extensions', en: 'Open Extensions' } },
  },
  {
    id: 'memory',
    icon: '🧠',
    title: { vi: 'AI ghi nhớ bạn (Memory)', en: 'Memory: the AI remembers you' },
    summary: {
      vi: 'Sở thích, phong cách và ràng buộc của bạn được dùng trong mọi yêu cầu sau.',
      en: 'Your preferences, style and constraints are used in every later request.',
    },
    steps: {
      vi: [
        'Gõ trong chat: "nhớ rằng game của tôi dành cho trẻ em, không bạo lực".',
        'Khi bạn nói về sở thích lâu dài, AI hỏi "Remember this?"; bấm Remember để lưu.',
        'Settings → Memory: xem, ghim (luôn dùng), sửa, xoá, hoặc tắt hẳn Memory. Chỉ lưu trên máy bạn.',
      ],
      en: [
        'Type in the chat: "remember: my games are for kids, no violence".',
        'When you mention a lasting preference the AI asks "Remember this?"; press Remember to keep it.',
        'Settings → Memory: view, pin (always used), edit, delete, or turn Memory off. Stored only on your computer.',
      ],
    },
    keywords: ['memory', 'nhớ', 'ghi nhớ', 'remember', 'sở thích', 'preference'],
    action: { id: 'settings-memory', label: { vi: 'Mở Settings → Memory', en: 'Open Settings → Memory' } },
  },
  {
    id: 'editing',
    icon: '🛠️',
    title: { vi: 'Chỉnh tay: cảnh, thế giới, âm thanh, phụ đề', en: 'Edit by hand: scene, world, audio, captions' },
    summary: {
      vi: 'Mọi thứ AI làm đều chỉnh được bằng tay.',
      en: 'Everything the AI does can also be edited by hand.',
    },
    steps: {
      vi: [
        'Outliner (cột trái): thêm nhân vật, nền, vật phẩm, chữ, hiệu ứng hạt; ẩn/khoá/nhân bản/xoá.',
        'Kéo thả trực tiếp trong viewport; với 3D dùng gizmo di chuyển/xoay/thu phóng.',
        'Tab World: địa hình, bầu trời, thời tiết, Procedural Game Audio (âm thanh từng sự kiện) và Captions (phụ đề, xuất .vtt/.srt).',
        'Logic Node Graph: xem và sửa luật chơi dạng sơ đồ trigger → condition → action.',
      ],
      en: [
        'Outliner (left column): add heroes, platforms, pickups, text, particle effects; hide/lock/duplicate/delete.',
        'Drag directly in the viewport; in 3D use the move/rotate/scale gizmo.',
        'World tab: terrain, sky, weather, Procedural Game Audio (a sound per event) and Captions (export .vtt/.srt).',
        'Logic Node Graph: view and edit game rules as trigger → condition → action diagrams.',
      ],
    },
    keywords: ['edit', 'chỉnh', 'sửa', 'outliner', 'gizmo', 'world', 'âm thanh', 'sound', 'phụ đề', 'caption', 'particle', 'hạt', 'node graph', 'logic'],
  },
  {
    id: 'export',
    icon: '📦',
    title: { vi: 'Xuất bản và chia sẻ', en: 'Export and share' },
    summary: {
      vi: 'HTML một file chạy offline, ZIP cho itch.io, quảng cáo playable cho TikTok/Meta, video, ảnh.',
      en: 'Single-file offline HTML, ZIP for itch.io, playable ads for TikTok/Meta, video, images.',
    },
    steps: {
      vi: [
        'Bấm Export & Publish → Standalone Game Bundler, chọn mạng (Meta, TikTok, Telegram, itch…).',
        'Sau khi xuất, thẻ báo cáo cho biết dung lượng so với giới hạn của mạng và có chạy offline không.',
        'Video: Multi-Scene Sequencer quay mọi cảnh thành .webm.',
        'App iOS/Android chưa có: đang trong lộ trình (Phase 8). Hiện có thể chơi trên điện thoại qua Play on phone hoặc file HTML.',
      ],
      en: [
        'Click Export & Publish → Standalone Game Bundler and pick a network (Meta, TikTok, Telegram, itch…).',
        'After exporting, the report card shows the size against the network limit and whether it runs offline.',
        'Video: the Multi-Scene Sequencer records every scene to .webm.',
        'Native iOS/Android apps are not available yet: they are on the roadmap (Phase 8). Today, play on phones via Play on phone or the HTML file.',
      ],
    },
    keywords: ['export', 'xuất', 'publish', 'xuất bản', 'html', 'zip', 'itch', 'tiktok', 'meta', 'quảng cáo', 'ads', 'share', 'chia sẻ', 'apk', 'app store'],
    action: { id: 'publish', label: { vi: 'Mở Export & Publish', en: 'Open Export & Publish' } },
  },
  {
    id: 'coding-agents',
    icon: '🧑‍💻',
    title: { vi: 'Dùng cùng Claude Code / Codex (MCP)', en: 'Use with Claude Code / Codex (MCP)' },
    summary: {
      vi: 'Coding agent bên ngoài có thể dựng game OmniStage qua MCP server, không cần mở giao diện.',
      en: 'External coding agents can build OmniStage games through the MCP server, without the UI.',
    },
    steps: {
      vi: [
        'Trong thư mục OmniStage, Claude Code tự đề xuất bật server "omnistage" từ file .mcp.json.',
        'Trỏ --project tới file game của dự án (~/OmniStage/projects/<dự án>/games/<game>.scenespec.json) để agent sửa đúng game đó.',
        'Mở lại game trong Projects để thấy thay đổi. Chi tiết: docs/mcp-server.md.',
      ],
      en: [
        'Inside the OmniStage folder, Claude Code offers to enable the "omnistage" server from .mcp.json.',
        'Point --project at a project game file (~/OmniStage/projects/<project>/games/<game>.scenespec.json) so the agent edits that game.',
        'Reopen the game from Projects to see the changes. Details: docs/mcp-server.md.',
      ],
    },
    keywords: ['mcp', 'claude code', 'codex', 'agent', 'coding agent', 'terminal'],
  },
];

export function guideTopic(id: string | null | undefined): GuideTopic | undefined {
  return GUIDE_TOPICS.find((t) => t.id === id);
}

export function defaultGuideLang(): GuideLang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

const QUESTION = /(làm sao|làm thế nào|thế nào để|cách (nào|để)?|ở đâu|hướng dẫn|là gì|có thể .*không|\?$)|\b(how (do|can|to)|where (is|do|can)|what is|help|guide)\b/i;

/** Plain lower-case text for matching (keeps Vietnamese letters). */
function norm(text: string) {
  return ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
}

/**
 * Answers app-usage questions ("làm sao chơi thử trên điện thoại?", "how do I export?") from the Guide, without
 * an AI call. Creative requests ("make a forest level") are left to the director.
 */
export function matchGuideQuestion(prompt: string): GuideTopic | null {
  const text = prompt.trim();
  if (!text || text.length > 240 || !QUESTION.test(text)) return null;
  const n = norm(text);
  let best: { topic: GuideTopic; score: number } | null = null;
  for (const topic of GUIDE_TOPICS) {
    let score = 0;
    for (const k of topic.keywords) if (n.includes(k.includes(' ') ? k : ` ${k}`) || n.includes(`${k} `)) score += k.includes(' ') ? 2 : 1;
    if (score && (!best || score > best.score)) best = { topic, score };
  }
  return best?.topic ?? null;
}

const VIETNAMESE_LETTERS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

/** Answer in the language the user wrote in (Vietnamese diacritics → vi), else the browser language. */
export function guideLangFor(text: string): GuideLang {
  return VIETNAMESE_LETTERS.test(text) ? 'vi' : /[a-z]{3,}/i.test(text) ? 'en' : defaultGuideLang();
}

export function formatGuideAnswer(topic: GuideTopic, lang: GuideLang): string {
  return `${topic.icon} ${topic.title[lang]}\n${topic.steps[lang].map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
