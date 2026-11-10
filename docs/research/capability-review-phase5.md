# Đánh giá năng lực OmniStage sau Phase 5 (2026-11-10)

Phạm vi: năng lực **tạo Game** và **tạo Media** của OmniStage khi agent (AI director trong app, hoặc Claude Code/Codex qua MCP) điều khiển, tính đến hết Phase 5.
Thang điểm 1–5: 1 = chưa có, 3 = dùng được cho sản phẩm nhỏ có giới hạn rõ, 5 = cạnh tranh với công cụ chuyên dụng.

## Bằng chứng đã kiểm

- `npm run verify`: tsc sạch, **40/40 test** gồm verifier, skills, easing, SFX, spritesheet, particle, captions, ZIP DEFLATE, budget, exporter và MCP server.
- `vite build` thành công. Runtime Three.js nhúng tách thành chunk lazy 554 KB (140 KB gzip).
- Các hàm runtime được inline vào export (SFX, particle, caption) đã được trích từ **bundle đã minify** và dựng lại chạy được.
- MCP server chạy thật qua stdio: handshake, 11 tool, tạo project, verify, và trả lỗi parse đúng chuẩn JSON-RPC.
- Verifier không có false positive trên 6 template, 12 màn/cảnh do generator offline tạo và 3 prompt heuristic.
- Trình duyệt: badge VERIFIED, Save as skill, panel âm thanh, particle confetti và phụ đề hiển thị khi phát. Không có lỗi runtime mới.
- **Chưa kiểm**:
  - Chạy file playable đã xuất trong trình duyệt hay trên mạng quảng cáo thật (chỉ kiểm cú pháp và nội dung).
  - Nhặt vật phẩm bằng bàn phím trong trình duyệt.
  - Hiệu năng trên điện thoại.
  - Giới hạn dung lượng chính thức của từng mạng quảng cáo (đang dùng ngưỡng "điển hình").

## 1. Năng lực tạo Game

| Hạng mục | Điểm | Có gì | Thiếu gì |
| --- | --- | --- | --- |
| Thể loại và cơ chế | **2.5** | 2D platformer/top-down (nhảy, nền, nhặt sao, bouncing); 3D arena WASD ±5.5 m (nhặt, hazard trừ điểm, tap-to-unbox, click actions); luật thắng: collect-all / score / survive / unbox; logic graph cho luật tùy biến | 2D chỉ **một màn hình 1000×600**, không camera cuộn; không có kẻ địch, máu/mạng, checkpoint hay nền di động; 2D không có hazard; 3D không có engine vật lý (Rapier mới nằm trong backlog) |
| Tiến trình nhiều màn | **3.5** | Storyboard "game 2D 3 màn" → các màn được nối `nextSceneId`; nút Next Level; độ khó tăng dần ở generator offline; MCP `link_scenes` | Chưa có màn chọn level, lưu tiến độ hay điểm tổng |
| Bảo đảm chơi được | **4** | Verifier tất định dùng đúng vật lý nhảy (step-up 125 px, khoảng cách 309 px), kiểm vật phẩm với tới được, `targetScore` đạt được, arena 3D; tự sửa và cho AI sửa thêm một vòng; **export nay dùng chung hằng số vật lý** (đã sửa lệch 118 px so với 153 px) | Chưa kiểm hazard, độ khó và thời gian hoàn thành; chưa có playtest bot mô phỏng |
| Cảm giác chơi (juice) | **3** | 10 SFX thủ tục, 8 preset particle 2D, burst VFX, popup điểm, easing | Không có nhạc nền, screen shake, hit-stop; SFX chưa gắn vào sự kiện của logic graph |
| Asset | **3** | 7 GLB rig có clip, cross-fade; Online Asset Hub (Poly Pizza, Sketchfab, Poly Haven); spritesheet 2D có clip idle/run/jump; import PNG/SVG/GLB | Chưa tạo sprite hay nhân vật bằng AI; chưa có retarget animation |
| Phát hành (playable ad) | **3** | HTML một file **chạy offline** (Three.js nhúng), MRAID/Meta/Telegram, báo cáo dung lượng theo mạng, ZIP DEFLATE, SFX/particle/caption/easing giống studio | **3D xuất ra chỉ là khối bát diện giữ chỗ**: không GLB, không world/terrain shader, không VFX 3D. Runtime export là bản viết lại riêng nên dễ lệch với studio (vừa bắt được một lỗi lệch vật lý) |

**Tổng Game: ≈ 3/5.** Phù hợp cho **playable ad hyper-casual và mini-game 2D một màn hình**, kể cả chuỗi nhiều màn. Chưa đủ cho game indie hoàn chỉnh: thiếu kẻ địch, camera cuộn, vật lý 3D và độ trung thực khi xuất 3D.

## 2. Năng lực tạo Media

| Hạng mục | Điểm | Có gì | Thiếu gì |
| --- | --- | --- | --- |
| Dàn cảnh 3D điện ảnh | **3.5** | 9 chế độ camera + keyframe spline có easing đúng thời gian; world thủ tục (terrain, nước phản chiếu, sky, mây, thời tiết, scatter, HDRI); nhân vật GLB rig; VFX hạt GPU; skill "shot grammar" | Không có DOF, motion blur hay post-FX (bloom chỉ là cài đặt); không cắt cảnh trong một scene |
| Motion graphics 2D | **3.5** | Kinetic typography, keyframe + 9 đường easing, particle tất định, spritesheet, parallax, phụ đề vẽ vào canvas | Chưa có stagger, path animation hay mask; font giới hạn |
| Kể chuyện nhiều cảnh | **3.5** | Storyboard VI/EN → kế hoạch → từng cảnh có tóm tắt liên tục; sequencer nhiều cảnh với transition; skill learned | Chưa có giao diện shot list; chưa có lời thoại hay TTS |
| Âm thanh | **1.5** | SFX thủ tục cho sự kiện game | **Video xuất ra không có tiếng**; không nhạc nền, voice-over hay mixing |
| Xuất bản | **2.5** | PNG, WebM 60 fps thời gian thực, sequencer nhiều cảnh (crossfade/fade-to-black, watermark), WebVTT/SRT | Render **thời gian thực** nên chất lượng phụ thuộc máy và có thể rớt khung; MP4 tùy trình duyệt; phụ đề 3D không được ghi vào video |

**Tổng Media: ≈ 3/5.** Phù hợp cho **clip quảng cáo/teaser ngắn và motion graphics không cần tiếng**, dùng file .vtt cho nền tảng. Hai điểm yếu lớn nhất: không có audio trong video, và render chưa tất định.

## 3. Năng lực "coding agent" (điểm mạnh nhất)

| Hạng mục | Điểm | Ghi chú |
| --- | --- | --- |
| Agent trong app | **3.5** | Director Skills (5 built-in + learned), vòng verify → auto-fix → AI sửa một vòng, có chế độ offline. **Nhưng** server chỉ gọi Gemini và client không gửi `x-ai-key`/`x-ai-model`, nên phần chọn nhà cung cấp trong Settings chưa có tác dụng |
| Agent bên ngoài | **4** | MCP server với 11 tool, cùng contract, verifier và exporter như studio; file project mở lại được trong studio; ghi file an toàn |
| Kỷ luật phát triển | **4** | `CLAUDE.md` dạng mục lục, rules theo phạm vi, subagent review, CI verify + build, review headless `claude -p`, 40 test |

## 4. Rủi ro kỹ thuật chính

1. **Hai runtime song song** (studio React/R3F và runtime export viết tay): rủi ro lệch lớn nhất. Phase 5 đã gom SFX, easing, particle, sprite, caption và hằng số vật lý về mã dùng chung. Vật lý va chạm, logic graph và render 3D vẫn còn tách.
2. **Ghi video thời gian thực**: không tái lập được, không có audio.
3. **Phụ thuộc nhà cung cấp AI**: UI hứa nhiều provider nhưng backend chỉ có Gemini.
4. **Bundle**: main chunk 1.85 MB (519 KB gzip), cảnh báo đã có từ trước.

## 5. Ưu tiên tiếp theo (Phase 6)

1. **Độ trung thực khi xuất 3D**: nhúng GLB trong ngân sách dung lượng và dùng chung renderer world. Đây là điều kiện để bán playable 3D.
2. **Audio trong video và render tất định**: dùng WebCodecs theo bước thời gian cố định, trộn SFX/nhạc vào track.
3. **Chiều sâu game**: hazard/enemy 2D, máu/mạng, camera cuộn và màn dài hơn một màn hình, cùng luật verifier tương ứng.
4. **Đồng nhất provider AI**: gửi header từ Settings và thêm adapter OpenAI-compatible/Anthropic.
5. **Cầu nối MCP trực tiếp** tới tab studio đang mở, và playtest bot mô phỏng để chấm độ khó.
