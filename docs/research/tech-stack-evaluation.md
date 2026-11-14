# Đánh giá nền tảng công nghệ OmniStage (2026-11-10, sau Phase 6 đợt 1)

Câu hỏi: nền tảng công nghệ và ngôn ngữ OmniStage đang dùng đã đúng hướng chưa, và có giải được bài toán của tầm nhìn dài hạn không? Tầm nhìn đó là một coding agent đa năng cho người có ý tưởng làm game/media nhưng không biết lập trình.

## 1. Hiện trạng

| Lớp | Công nghệ |
| --- | --- |
| Ngôn ngữ | TypeScript cho toàn bộ: studio, server, MCP, exporter, test |
| Studio UI | React 19, Zustand, Tailwind 4, Vite 8 |
| Render | Three.js r187 qua React Three Fiber (3D); Canvas2D tự viết (2D); WebAudio (SFX thủ tục) |
| Hợp đồng dữ liệu | `SceneSpec` JSON khai báo, có verifier tất định |
| Server cục bộ | Express + tsx: proxy AI (Gemini, Anthropic SDK, OpenAI-compatible, OpenRouter, 4 CLI), workspace trên đĩa, proxy asset |
| Agent bên ngoài | MCP server (stdio) dùng chung contract |
| Xuất bản | HTML một file chạy offline (Three.js nhúng), ZIP DEFLATE, WebM |
| Kiểm thử | `node:test` qua tsx: 58 test; CI verify + build |

## 2. Những điểm đã đúng hướng

1. **TypeScript cho mọi lớp là lựa chọn đúng nhất.** Verifier, runtime particle/SFX/easing/caption và vật lý platformer được dùng chung nguyên văn giữa studio, server, MCP và file playable. Lỗi vật lý bị lệch ở Phase 5 bắt được chính vì có một nguồn hằng số duy nhất. LLM cũng viết và sửa TypeScript/JSON tốt nhất, điều quan trọng khi AI là "lập trình viên" chính.
2. **`SceneSpec` khai báo là nền móng đúng cho người không biết code.** AI, người dùng (UI), plugin và agent ngoài (MCP) cùng sửa một tài liệu JSON có kiểm chứng; không ai phải đọc code engine. Nhờ đó có verify/auto-fix, undo, và về lâu dài có thể xuất sang nhiều đích khác nhau.
3. **Web là đích phát hành tự nhiên** cho playable ads, HTML5 game, Telegram Mini App và itch.io, và người chơi không phải cài gì.
4. **Chạy trên máy cá nhân với server Node** là đủ để gọi CLI của coding agent, lưu dự án trên đĩa và chạy plugin; nhưng vẫn cho phép đóng gói desktop sau này.
5. **Lớp AI không phụ thuộc nhà cung cấp** (API key, OpenRouter hoặc CLI đăng nhập sẵn), có skills, memory và verifier: hướng của một "agent có tay nghề", không phải chatbot.

## 3. Rủi ro và giới hạn cần xử lý (xếp theo mức ảnh hưởng)

| # | Vấn đề | Vì sao quan trọng | Đề xuất |
| --- | --- | --- | --- |
| 1 | **Hai runtime song song**: studio (React/R3F) và player xuất ra (viết tay, actor 3D chỉ là khối bát diện) | Thứ người dùng thấy trong studio khác thứ họ phát hành, và mỗi tính năng phải làm hai lần | **Tách một "OmniStage Player" duy nhất** (TypeScript thuần + Three.js + Canvas2D, không React) dùng cho cả preview, chơi thử và export; studio chỉ phủ thêm gizmo/inspector lên trên. Đây là thay đổi kiến trúc quan trọng nhất. |
| 2 | **AI sinh lại toàn bộ SceneSpec mỗi lượt** | Tốn token và chậm (khoảng 90 s qua CLI), dễ làm mất chi tiết | Chuyển sang **AI trả JSON Patch** (RFC 6902, MCP đã hỗ trợ) và vòng tool-use (verify, chạy lệnh plugin) |
| 3 | File quá lớn: `useStudioStore.ts` ~2.600 dòng, `studioAgent.ts` ~1.700 dòng | Khó cho cả người lẫn agent khi sửa | Tách store thành slice (scene, playback, game, workspace, ai) và tách agent theo chức năng |
| 4 | Chưa có engine vật lý và cấu trúc game cho game lớn | Chỉ làm tốt game nhỏ một màn hình | Thêm Rapier (WASM) cho 3D; dùng ECS nhẹ (miniplex/bitecs) bên trong Player |
| 5 | Người không biết code khó chạy `npm run dev` | Cản trở đúng nhóm người dùng mục tiêu | **Đóng gói Electron** (server Node có sẵn, gọi được CLI); cân nhắc Tauri sau nếu cần gọn hơn |
| 6 | Chỉ xuất ra web | Không lên được store mobile hay Steam | Giai đoạn đầu: bọc web (Capacitor cho mobile, Electron cho Steam). Về lâu dài: **exporter dạng plugin** từ SceneSpec, ví dụ sang scene Godot |
| 7 | Lưu bằng file JSON | Ổn cho một người; không hợp cho cộng tác | SQLite cho chỉ mục và tìm kiếm; Yjs/CRDT nếu cần làm chung thời gian thực |
| 8 | Chưa có test E2E trình duyệt | UI và file playable mới được kiểm bằng tay | Thêm Playwright cho các luồng chính và để chạy file playable đã xuất |

## 4. Có nên đổi ngôn ngữ hay engine?

- **Không nên đổi sang C#/Unity hay C++/Unreal.** Chúng mạnh cho game AAA nhưng nặng, khó cho AI thao tác qua JSON/text, không xuất được playable ads nhỏ gọn, và mâu thuẫn với lợi thế "một ngôn ngữ, một contract".
- **Rust/WASM chỉ dùng cho các phần nóng** (vật lý qua Rapier, sau này có thể là pathfinding hoặc xử lý ảnh), gọi từ TypeScript.
- **Godot nên là đích xuất, không phải nền tảng chính**: khi người dùng cần game desktop/mobile lớn, xuất SceneSpec sang Godot là hướng hợp lý, giữ studio và AI trên TypeScript.
- **WebGPU** (Three.js r187 đã có `WebGPURenderer`/TSL) cho VFX nặng ở giai đoạn sau; WebGL2 vẫn là mặc định vì playable ads cần tương thích rộng.

## 5. Kết luận

Nền tảng **đúng hướng**: TypeScript + SceneSpec khai báo + web + agent đa nhà cung cấp phù hợp với sản phẩm "AI làm game cho người không code". Để đi được đường dài, thứ tự đầu tư nên là:

1. **Một Player runtime duy nhất** (studio, chơi thử và export dùng chung).
2. **AI chỉnh sửa bằng patch + vòng tool-use** thay cho sinh lại toàn bộ.
3. **Đóng gói desktop (Electron)** để người không code cài một lần là dùng.
4. Tách store/agent; thêm Rapier + ECS; test E2E.
5. Exporter dạng plugin (Godot/Capacitor/Electron) khi cần đích ngoài web.
