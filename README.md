# OmniStage AI

Studio tạo **game 3D/2D, phim ngắn và quảng cáo chơi được (playable ads)** bằng cách trò chuyện với AI — không cần viết code.
Mọi thứ được mô tả bằng một bản thiết kế khai báo (`SceneSpec`); AI chỉ chỉnh bản thiết kế đó, OmniStage kiểm tra và tự sửa lỗi,
rồi dựng hình bằng cùng một bộ máy cho trình biên tập, Play Test, điện thoại và file xuất bản.

---

## 1. Yêu cầu

| Thành phần | Phiên bản |
| --- | --- |
| [Node.js](https://nodejs.org) | 20 trở lên (khuyến nghị bản LTS mới nhất) |
| Trình duyệt | Chrome hoặc Edge bản mới (cần WebGL; xuất video dùng MediaRecorder) |
| Git | để tải mã nguồn |

AI là **tuỳ chọn**: không có khoá API, trợ lý vẫn chạy ở chế độ offline (bộ đạo diễn dựng sẵn, kết quả đơn giản hơn).

## 2. Cài đặt

```bash
git clone https://github.com/magicpendigital/OmniStage-AI.git
cd OmniStage-AI
npm install
```

(Tuỳ chọn) tạo file cấu hình máy chủ:

```bash
cp .env.example .env
```

Trên Windows PowerShell dùng `Copy-Item .env.example .env`. Mọi biến trong `.env` đều tuỳ chọn — xem chú thích trong file.

## 3. Chạy

```bash
npm run dev
```

Mở **http://localhost:3000** trong Chrome/Edge. Đổi cổng: đặt `PORT=4000` trong `.env`.

> Chạy bản đã đóng gói (nhanh hơn, không hot-reload): `npm run build` rồi `npm start`.

## 4. Kết nối AI (tuỳ chọn)

Vào **Settings → AI** trong studio và chọn một nhà cung cấp:

- **Khoá API**: Google Gemini, Anthropic Claude, OpenRouter, hoặc bất kỳ máy chủ tương thích OpenAI (OpenAI, Ollama, LM Studio…).
  Khoá được lưu trong trình duyệt của bạn và chỉ gửi tới máy chủ OmniStage chạy trên máy bạn.
- **Dùng CLI đã đăng nhập sẵn trên máy** (không cần khoá): Claude Code, Codex CLI, Google Antigravity CLI, OpenCode.
  Chỉ hoạt động khi mở studio trên chính máy đó (`localhost`).

Bấm **Test connection** để kiểm tra. Mục "How the AI edits your scene" nên để mặc định *Small edits* (AI sửa từng phần nhỏ và
được kiểm tra tự động tối đa 3 vòng).

## 5. Dùng nhanh

1. Gõ yêu cầu vào khung **AI Director** bên phải, ví dụ:
   *"Làm một bộ phim 3D gồm 3 cảnh về chú robot phiêu lưu trong rừng"* hoặc *"Tạo game 2D vượt chướng ngại vật 3 màn"*.
2. Yêu cầu nhiều cảnh/màn sẽ tạo một **storyboard**: các cảnh được nối theo thứ tự, xem ở tab **Scenes** (cột trái).
3. Chỉnh tiếp bằng lời (*"cho tuyết rơi"*, *"thêm một đồng xu bên phải"*) hoặc trực tiếp trên khung hình / sơ đồ logic (**Logic Node Graph**).

### Xem cả bộ phim nhiều cảnh liền mạch

- Nút **▶ Preview** (màu xanh, thanh trên cùng, ở chế độ *Cinema / Media*) phát **toàn bộ storyboard của cảnh đang chọn** từ đầu
  đến cuối, tự chuyển cảnh. Nút ▶ trong *Timeline Sequencer* chỉ phát **một cảnh** đang mở (để chỉnh sửa), không chuyển cảnh.
- Với game (*Game Mode*), nút đó là **Play Test**: chạy đúng bản sẽ xuất bản, qua màn bằng cách thắng màn trước; có mã QR để chơi trên điện thoại cùng mạng Wi-Fi.

### Xuất bản

**Export & Publish**:
- **Video** (tab *Sequencer*): ghi cả storyboard thành **một file MP4/WebM** có chuyển cảnh — giống thứ tự của Preview.
  MP4 được dựng từng khung hình qua OmniStage Player (đúng thời gian dù máy chậm) và **có âm thanh**: nhạc theo cảm xúc, âm nền theo
  bối cảnh và hiệu ứng âm thanh theo thời gian (tab *World* → *Film Soundtrack*). Cần Chrome/Edge bản mới (WebCodecs); trình duyệt
  khác dùng chế độ ghi thời gian thực (WebM).
- **WebGPU**: khi xuất HTML5 có thể chọn *3D renderer → WebGPU where available*: máy/trình duyệt có WebGPU sẽ vẽ bằng WebGPU, máy
  khác tự quay về WebGL (file nặng hơn khoảng 640 KB). Mặc định vẫn là WebGL để file nhỏ nhất.
- **Tự rig nhân vật (OmniRig)** (tab *Assets* → *Auto-rig a character*): nạp file GLB (người tư thế chữ T/A, thú bốn chân hoặc đồ
  vật), OmniRig tự dựng khung xương, trọng số skin, chấm điểm bằng tư thế thử (A–D) và tạo sẵn các động tác (đứng, đi, chạy, vẫy tay,
  nhảy, gật/lắc đầu, ngồi, nhảy múa). Kéo các khớp màu vàng để sửa nếu cần, rồi lưu vào *My Library* và đưa vào cảnh.
- **Tự lưu**: đang mở dự án thì tự lưu vào thư mục dự án; chưa có dự án thì tự lưu thành **bản nháp** trong `~/OmniStage/drafts`
  và tự mở lại khi bạn quay lại studio. Khi lưu vào một dự án (*Projects* → *From what's open now*), bản nháp được chuyển vào đó.
  Nháp không đụng tới 30 ngày sẽ hiện hộp thoại để bạn chọn giữ hay xoá (xoá = chuyển vào `.trash`). Giọng nói đã tạo được lưu kèm.
- **Lời thoại** (tab *World* → *Dialogue*): nhân vật nói câu thoại có phụ đề tự động, quay sang người nghe và gật đầu khi nói.
  Bấm *Generate real voices* để tạo giọng thật tiếng Việt bằng Piper chạy ngay trong trình duyệt (lần đầu tải mô hình ~60MB);
  chưa tạo thì nhân vật nói bằng giọng "babble" mô phỏng thanh điệu. Giọng được nhúng vào MP4 và bản xuất HTML5.
- **Bối cảnh nhanh** (tab *World* → *Biome & Water*): rừng, đồng cỏ, bãi biển, sa mạc, núi tuyết, thung lũng thác nước, rừng đêm,
  thành phố đêm — kèm thác, sông, hồ có nước chảy thật.
  Giữ tab trình duyệt hiển thị trong lúc ghi.
- **HTML5 / ZIP**: game hoặc quảng cáo chơi được, chạy offline (TikTok, Meta, Telegram, itch.io…).
- **.scenespec.json**: bản thiết kế dự án để mở lại hoặc đưa cho agent khác.

Dự án, thư viện cá nhân, extension và trí nhớ của AI được lưu trong thư mục `~/OmniStage` (đổi bằng `OMNISTAGE_HOME`).

## 6. Lệnh cho nhà phát triển

| Lệnh | Việc làm |
| --- | --- |
| `npm run dev` | Máy chủ + studio có hot-reload (cổng 3000) |
| `npm run build` / `npm start` | Đóng gói vào `dist/` / chạy bản đóng gói |
| `npm run verify` | Kiểm tra kiểu TypeScript + toàn bộ unit test (phải thành công trước khi commit) |
| `npm run test:e2e` | Kiểm thử trình duyệt các file xuất bản bằng Playwright (dùng Chrome đã cài) |
| `npm run build:player` | Dựng lại OmniStage Player sau khi sửa `src/player`, `src/runtime`, `src/render3d` |
| `npm run mcp -- --project projects/x.scenespec.json` | Máy chủ MCP để agent khác (Claude Code, Codex…) soạn dự án — xem `docs/mcp-server.md` |

Kiến trúc và quy tắc cho người đóng góp: `CLAUDE.md`, `AGENTS.md`, lộ trình: `plan.md`.

## 7. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| `EADDRINUSE` khi chạy | Cổng 3000 đang bận: đặt `PORT=3001` trong `.env` hoặc tắt chương trình đang dùng cổng đó |
| Khung 3D đen / rất chậm | Bật tăng tốc phần cứng trong trình duyệt; chọn chất lượng **Draft** ở góc khung hình |
| AI trả lời "not configured" | Chưa nhập khoá hoặc chưa đăng nhập CLI — vào Settings → AI → Test connection. Trong lúc đó trợ lý dùng chế độ offline |
| CLI không xuất hiện | Cài và đăng nhập CLI đó một lần trong terminal, rồi bấm làm mới trong Settings → AI; mở studio bằng `localhost` |
| Video xuất ra bị giật | Đóng bớt tab, giữ tab studio hiển thị, chọn 720p |
