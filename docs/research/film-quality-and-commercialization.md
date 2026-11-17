# OmniStage: chất lượng phim AI Director và hướng thương mại hóa (2026-11-16)

Phạm vi: (A) chẩn đoán vì sao phim hoạt hình do AI Director tạo ra chưa hấp dẫn, (B) hướng cải thiện theo thứ tự ưu tiên,
(C) định vị khách hàng và mô hình kiếm tiền, (D) hướng phát triển bản cài đặt, (E) kênh marketing 0đ.

**Độ tin cậy của tài liệu này**
- Phần A–B dựa trên **đọc mã nguồn** (`storyboardAgent.ts`, `systemPrompts.ts`, `directorSkills.ts`, `cinematics.ts`, `assetRegistry.ts`, `plan.md`)
  và mô tả của bạn. Tôi **chưa chạy lại đúng bộ phim của bạn**, nên mục "nhiều lỗi chưa mượt" chỉ phân tích được các lỗi có gốc trong mã.
  Hãy gửi project `.scenespec.json` hoặc ảnh chụp để đối chiếu từng lỗi cụ thể.
- Phần C–E dựa trên tìm kiếm web. Nguồn chủ yếu là blog của chính các nhà cung cấp (thiên vị), nên giá và số liệu chỉ dùng làm mốc tham khảo.
  Mục nào ghi **(cần kiểm tra)** là chưa có nguồn xác nhận.

---

## A. Chẩn đoán

### A1. Chuyển cảnh không liền mạch

| Gốc rễ trong mã | Biểu hiện |
| --- | --- |
| Mỗi cảnh là một `SceneSpec` độc lập, AI viết lần lượt. Prompt dặn "Do not reference other scenes by id". Thông tin nối cảnh chỉ là `summarizeSceneForContinuity`: tên, loại shot, sky/terrain/weather, vị trí cuối và clip cuối của nhân vật, script. | Không có: thoại đã nói, cảm xúc nhân vật, đạo cụ đang cầm, hướng sáng, tư thế camera cuối cảnh trước, tiết tấu nhạc. |
| Bối cảnh được AI **sinh lại ở mỗi cảnh** (biome, scatter, seed). Không có khái niệm "địa điểm" dùng chung giữa các cảnh. | Cùng một khu rừng nhưng cây, sông, thác đổi chỗ giữa hai cảnh. |
| `transitionOverlay()` chỉ là **tấm phủ màu**: `fade` = đen 450 ms, `fade-white` = trắng 450 ms, `crossfade` = đen 300 ms (thực chất là dip-to-black), `wipe` rơi về mặc định đen. | Không có cross-dissolve thật, không có match cut, không có whip-pan. Mọi bước chuyển đều trông giống nhau. |
| Âm thanh: nhạc chỉ liền khi hai cảnh **cùng mood**, và mood do AI chọn theo từng cảnh. Không có J-cut / L-cut (âm thanh cảnh sau vào trước hình). | Đổi mood là nhạc đứt đột ngột. |
| Transition do bước lập kế hoạch chọn **một lần**, trước khi biết shot đầu/cuối thực tế của hai cảnh. | Chọn "cut" cho hai cảnh mà shot cuối và shot đầu không khớp trục hay cỡ khung. |
| Không có bước "dựng phim": sau khi tạo xong N cảnh, không ai xem lại chỗ nối. Verifier và Director QA đều chạy **trong từng cảnh**. | Lỗi nằm ở ranh giới cảnh không bao giờ bị phát hiện. |

### A2. Kịch bản không ăn khớp

- Bước lập kế hoạch là **một lần gọi LLM**, trả về `title / description / beat / script`. Không có logline, chủ đề, hồ sơ nhân vật
  (muốn gì, sợ gì, điểm yếu, giọng nói), không có "gieo – gặt" (setup / payoff), không có vòng phản biện.
  Quy tắc "establish → rising → climax → resolution" chỉ là một dòng trong prompt.
- **Biên kịch không biết diễn viên làm được gì.** Rô-bốt có 13 clip, Soldier 3, Fox 3, ngựa / hồng hạc / vẹt mỗi con 1 clip.
  Kịch bản viết "cô cáo hái hoa đặt lên bàn" nhưng không có clip, đạo cụ hay tương tác tương ứng. AI hoặc bỏ qua, hoặc giả bằng clip gần đúng,
  khiến hình lệch với lời.
- Kịch bản (bước 1) và thực thi (bước 2) là hai lần dịch. Không có luật kiểm tra "mọi hành động trong script đều có `performance` / shot / thoại tương ứng".
- Mỗi cảnh 8–12 giây, 2–5 câu thoại, tối đa 14 từ. Phim 3 cảnh dài khoảng 34 giây. Đó là độ dài của một **trò đùa hình ảnh**, không đủ cho một chuyến phiêu lưu có thoại.
- Khi nhà cung cấp AI lỗi, hệ thống rơi về offline director (mẫu cố định) nên cốt truyện rập khuôn.

### A3. Chuyển động nhân vật đơn điệu

Toàn bộ "diễn xuất" hiện nay là: **chọn clip có sẵn** + `moveTo` nội suy (mặc định `sine.inOut`) + xoay mặt (0,35 s).

| Thiếu | Hệ quả |
| --- | --- |
| Kho clip nhỏ (xem A2). Thư viện Quaternius CC0 (120+ clip) ghi trong `plan.md` là **chưa làm**. | AI chỉ có vài cử chỉ để chọn, mọi cảnh trông giống nhau. |
| Không có lớp "sống động" cộng thêm lên clip: thở, dồn trọng tâm, nhìn theo (gaze), chớp mắt, chuẩn bị – quá đà (anticipation / overshoot), squash & stretch. | Nhân vật như con rối chạy clip. |
| Không thấy biểu cảm khuôn mặt, nhép môi. Theo grep, `dialogue.emotion` chỉ đổi giọng / ElevenLabs, không thấy ảnh hưởng đến `cinematics.ts` hay `render3d`. | Nói "excited" nhưng thân người không đổi. Giọng Piper phẳng. |
| Tốc độ clip đi bộ không gắn với quãng đường (`moveTo` ease theo thời gian, clip `Walk` chạy tốc độ cố định). | Chân trượt trên đất, đặc biệt lúc tăng tốc và dừng. |
| `moveTo` là đường thẳng, không có đường cong, không tránh vật cản. Không có tương tác đạo cụ (cầm, ngồi, chạm). | Nhân vật chỉ "đi tới rồi đứng" chứ không "làm việc". |
| Camera chỉ có cắt cứng giữa các shot và 5 kiểu chuyển động. | Thiếu nhịp dựng. |

### A4. Lỗi chưa mượt và rủi ro kỹ thuật

- **Model 3D tải từ CDN, nhánh `dev`**: `THREE_CDN = jsdelivr/gh/mrdoob/three.js@dev/...`. Nhánh `dev` có thể đổi hoặc mất file. Mất mạng thì phim không dựng được.
  `assetRegistry.ts` cũng **không có trường giấy phép** cho từng model (xem D3).
- **Verifier đo "hợp lệ", chưa đo "hay"**: chỉ có 4 mã craft (`media.hero-static`, `single-shot`, `bare-stage`, `silent`).
  Luật "hero ≥ 3 hành động" khuyến khích AI **thêm clip cho đủ số**, không cần có mục đích.
- **Director QA bị bỏ qua khi dùng CLI login** (Claude Code, Codex…), vì các CLI này không có vision. Đây lại là đường rẻ nhất mà người dùng hay chọn.
  Khi chạy, nó chỉ chụp 1 khung giữa mỗi shot (tối đa 4) và sửa **một vòng**. Không có đánh giá chuyển động hay ranh giới giữa các cảnh.
- **Không có bộ kiểm thử chất lượng phim** (golden prompts). Mỗi lần sửa prompt không biết phim tốt lên hay tệ đi.

### A5. Truyện không hấp dẫn

Nguyên nhân gộp từ A1–A4, cộng thêm:
- Không có bước **phát triển truyện** (premise → xung đột → bước ngoặt → kết thúc có dư vị). LLM mặc định viết kiểu "nhân vật khám phá, gặp bạn, vui vẻ".
- Không có **hook 3 giây đầu**, không có **được – mất** (stakes), không có thay đổi của nhân vật.
- Thể loại chọn sai so với năng lực: phim phiêu lưu có thoại cần diễn xuất tinh tế, trong khi công cụ mạnh ở **hài hình thể, ít thoại, nhạc, bố cục**.
  Phim ngắn Pixar hay Wallace & Gromit thành công đúng nhờ cách đó.

---

## B. Hướng cải thiện (theo thứ tự ưu tiên)

Nguyên tắc: không chạy đua độ chân thực với Kling / Veo / Sora. Lợi thế của OmniStage là **nhân vật nhất quán, chỉnh sửa được, tất định,
chạy offline, không tốn tiền mỗi clip, xuất được playable / tương tác, agent điều khiển được qua MCP**. Hãy nâng chất lượng trong phạm vi đó.

### B1. Nhóm P0: sửa trực tiếp 5 triệu chứng (ước 3–5 tuần)

| # | Việc | Chạm vào | Triệu chứng giải quyết |
| --- | --- | --- | --- |
| 1 | **Story Bible + phòng biên kịch.** Chuỗi: logline → chủ đề → hồ sơ nhân vật (muốn gì, sợ gì, điểm yếu, giọng, **cử chỉ đặc trưng**) → bảng nhịp 3 hồi có hook, bước ngoặt giữa phim, payoff → **vòng phản biện bằng rubric** (hook ≤ 3 s, có stakes, nhân vật thay đổi, mỗi cảnh kết bằng câu hỏi hoặc ngoặt) → sửa. Lưu `StoryBible` ở cấp storyboard và gửi **nguyên văn** cho mọi cảnh (không chỉ bản tóm tắt). Thêm vài **khuôn truyện ngắn**: trò đùa hình ảnh, hành trình nhỏ, gặp gỡ, tiết lộ / đảo chiều, quảng cáo kể chuyện. | `storyboardAgent.ts`, `systemPrompts.ts`, `scene.schema.ts` (sequence) | A2, A5 |
| 2 | **Biên kịch biết năng lực diễn viên.** Đưa cho planner danh sách clip thật của từng nhân vật và đạo cụ có sẵn. Mỗi dòng script có `id`. Cảnh phải trả về hành động / shot / thoại gắn `scriptLineId`. Verifier thêm luật `script.unperformable` và `script.uncovered`. UI hiển thị "Độ phủ kịch bản 9/10". | planner, verifier, StoryboardPanel | A2 |
| 3 | **Bước "Dựng phim" sau khi có đủ cảnh.** (a) Lint tất định: giờ trong ngày tiến triển hợp lý, vị trí đầu cảnh sau = vị trí cuối cảnh trước, cùng một chiều sáng, quy tắc 180° qua điểm cắt, nhảy cỡ khung quá lớn, nhạc / tempo liền. (b) Một vòng patch của "editor" chỉ chạm vào **1,5 giây cuối cảnh trước và 1,5 giây đầu cảnh sau**. (c) Chụp cặp khung cuối A + đầu B cho vision QA. | mới: `filmEditor.ts` | A1 |
| 4 | **Chuyển cảnh thật.** (a) Cross-dissolve thật: giữ khung cuối cảnh trước làm texture, mờ dần trên khung đầu cảnh sau (Player và MP4 đều chạy theo từng khung nên dễ làm). (b) `sequence.carry`: cảnh sau **kế thừa** tư thế camera và nhân vật từ cảnh trước, để "cut" trong hành động liên tục thật sự liền. (c) J-cut / L-cut: ambience và nhạc cảnh sau vào sớm 0,5–1 s, đuôi thoại chồng sang. (d) Thêm whip-pan, iris, wipe thật. (e) **Bảng cue nhạc cho cả phim** (một khóa + tempo, mood đổi theo hồi) thay vì mood theo từng cảnh. | `cinematics.ts`, Player, `filmExport.ts`, `soundtrack.ts` | A1 |
| 5 | **Địa điểm dùng chung.** Storyboard có `locations[]` (biome, features, seed bố trí). Mỗi cảnh trỏ tới `locationId`, đổi góc máy chứ không dựng lại nền. | schema, biomes, storyboard | A1 |
| 6 | **Bộ đánh giá phim (eval harness).** 10 prompt chuẩn × điểm rubric (tất định + vision) × chụp contact sheet, chạy bằng một lệnh, lưu lịch sử điểm. Cho phép CLI provider đọc contact sheet bằng đường dẫn tệp (cần thử: Claude Code đọc được ảnh). **Không có thứ này thì mọi chỉnh prompt đều là đoán mò.** | `scripts/`, `directorQA.ts` | A4 |

### B2. Nhóm P1: chuyển động (ước 3–4 tuần, song song được với P0)

1. **Lớp sống động cộng thêm** (additive, theo seed nên tất định): thở, dồn trọng tâm, nhìn theo (đầu / mắt hướng về `lookAt`), chớp mắt,
   chuẩn bị – quá đà ở đầu và cuối mỗi `moveTo`, squash & stretch nhẹ cho nhân vật hoạt hình.
2. **Đồng bộ bước chân.** `timeScale` của clip đi bộ = vận tốc thực / độ dài bước. OmniRig đã tính độ dài bước từ chiều dài chân, tái dùng cho GLB.
3. **Cảm xúc → thân người.** Ánh xạ `emotion` sang clip + biến đổi tư thế (nghiêng đầu, cúi vai, nảy lên). Nhép môi dạng nhẹ theo `talkLevel`
   (xương hàm hoặc morph target nếu model có, nếu không thì "nảy nhẹ khi nói").
4. **Thư viện cử chỉ có gắn nhãn ngữ nghĩa** (explain, shrug, point, think, laugh, cry, sit-down, pick-up…). Nguồn: Quaternius UAL (CC0) + Mixamo
   (đã có bộ nhập clip) retarget qua OmniRig. AI chọn theo nhãn, không đoán tên clip. Đây là **đòn bẩy lớn nhất cho "đơn điệu"**.
5. **Đạo cụ và tương tác:** `performance.interact { prop, socket }` (cầm, đặt, ngồi). `attachmentSockets` đã có trong registry.
6. `moveTo` theo đường cong, dừng có "chạm đất" nhẹ.

### B3. Nhóm P2: dàn diễn viên và thể loại

- **Dàn diễn viên khởi điểm**: khoảng 6 nhân vật đồng bộ phong cách (low-poly / stylized thống nhất), mỗi nhân vật ≥ 15 clip, **đóng gói cục bộ, kèm giấy phép**.
  Đồng bộ phong cách quan trọng hơn độ chi tiết: ghép model từ nhiều nguồn là nguyên nhân khiến phim "rẻ tiền".
- **Gói mẫu theo khách hàng**: quảng cáo 30 s cho sản phẩm, truyện thiếu nhi, trailer game, linh vật thương hiệu, bài giảng tương tác tiếng Việt.
  Mẫu "phim câm hài hình thể + nhạc" (không thoại) nên là mặc định vì ít lộ điểm yếu nhất.
- Thoại dài chỉ bật khi người dùng có giọng ElevenLabs hoặc giọng cục bộ đủ tốt.

### B4. Đo mức "đủ thuyết phục"

Tiêu chí gợi ý trước khi dùng phim làm nội dung marketing hay bán: với 10 prompt chuẩn, ≥ 7/10 phim đạt điểm rubric ≥ 80 **và** 5 người lạ
xem xong có ≥ 3 người nói "muốn xem tiếp / muốn tạo phim của mình". Đừng chuyển sang tính năng mới khi chưa đạt.

---

## C. Khách hàng mục tiêu và mô hình kiếm tiền

### C1. Chọn nhóm khách hàng

| Nhóm | Vì sao hợp / không hợp | Khả năng trả tiền |
| --- | --- | --- |
| **1. Studio game mobile và đội UA (playable ad + trailer từ cùng một SceneSpec)** | Phần "đã làm xong" mạnh nhất: Player dùng chung, xuất theo ngân sách dung lượng từng mạng, MCP, kiểm tra tất định. Chất lượng phim điện ảnh **không phải thứ họ mua**. Họ mua tốc độ ra biến thể. Nguồn ngành cho thấy các đội thắng ship 10+ biến thể mỗi tuần. | **Cao.** Mốc giá công cụ (vendor tự công bố): Segwise từ $10/tháng, PlayableMaker €129–599/tháng, Unity Playworks Pro và Playable Factory là báo giá. |
| 2. Nhà sáng tạo nội dung ngắn (TikTok / Shorts / Reels, kênh kể chuyện, giáo dục) | Lượng lớn, nhưng ARPU thấp và nhạy cảm giá. Đối thủ miễn phí rất mạnh (CapCut / Dreamina). Chỉ thắng bằng **nhân vật xuyên suốt cả loạt phim**, giọng tiếng Việt, không tính tiền theo clip. | Thấp – trung bình. Mốc: LTX Studio $15 / $35 / $125 mỗi tháng, Atlabs $12 / $29 / $79. |
| 3. Giáo dục, bài giảng tương tác | Nhỏ nhưng gắn bó lâu. Xuất HTML5 tương tác là lợi thế riêng. | Trung bình, bán theo trường / tổ chức, chu kỳ dài. |
| 4. Lập trình viên indie, người làm agent (MCP) | Thích công cụ mở, khó thu tiền trực tiếp, nhưng tạo uy tín và lan truyền. | Thấp, dùng làm kênh phân phối. |
| 5. Robot / OLED (logic graph có node phần cứng) | Quá ngách so với phần còn lại. | Tạm gác. |

**Khuyến nghị:** dùng nhóm 1 làm **động cơ doanh thu**, dùng phim hoạt hình (nhóm 2) làm **phễu lan truyền và thương hiệu**.
Lý do thẳng thắn: khoảng cách chất lượng với các model sinh video nền tảng sẽ còn nới ra theo từng tháng, còn playable / tương tác tất định
là nơi một engine khai báo như OmniStage có lợi thế thật. Chỉ nên hứa "làm phim hoạt hình" như sản phẩm chính khi điểm eval ở B4 đã đạt.
Phim cho linh vật thương hiệu, trailer game, quảng cáo kể chuyện là nhịp cầu giữa hai nhóm.

> Giả thuyết cần kiểm chứng trước khi đầu tư thêm: phỏng vấn 10 người ở nhóm 1 (studio mobile Việt Nam / Đông Nam Á, UA manager).
> Hỏi họ hiện làm playable thế nào, mất bao lâu, trả bao nhiêu. Tôi **không có số liệu** về cơ cấu chi tiêu thực tế của nhóm này tại Việt Nam.

### C2. Mô hình doanh thu

| Mô hình | Ưu | Nhược | Hợp khi |
| --- | --- | --- | --- |
| **Dịch vụ cầu nối** (làm 10 biến thể playable / phim linh vật cho studio, tính theo gói) | Có tiền và phản hồi ngay, không cần bản cài đặt hoàn chỉnh, tạo portfolio thật. | Không mở rộng được. | **Làm đầu tiên** để kiểm chứng. |
| **Open-core + giấy phép Pro** | Lõi mở (engine, Player, MCP) tạo lan truyền và niềm tin. Phần thu tiền: xuất không watermark, xuất cho từng mạng quảng cáo, MP4 1080p+, cast pack, template pack, đồng bộ nhóm. Chạy cục bộ nên **không tốn chi phí suy luận**. | Có thể bị fork. Lợi thế thật nằm ở hợp đồng SceneSpec, dàn diễn viên, mẫu và tốc độ cập nhật. | **Mô hình chính.** |
| Gói thuê bao so với mua đứt | Thuê bao ổn định doanh thu. Người dùng công cụ cài trên máy lại ghét thuê bao thuần. | | **Lai:** thuê bao theo năm, hết hạn thì **vẫn giữ bản đã nhận** (perpetual fallback). |
| Bán credit AI (OmniStage Credits) | Biên lợi nhuận, tiện cho người không có khóa API. | Cần hạ tầng, chống lạm dụng, rủi ro chi phí, trách nhiệm hoàn tiền. | Để sau. Hiện đã có BYO key + CLI login. |
| Chợ extension / asset / template (chia 70–80% cho tác giả) | Mở rộng hệ sinh thái. | Cần cộng đồng trước. | Giai đoạn sau. |

**Giá giả thuyết (cần thử):** Free (watermark liên kết, 720p, xuất giới hạn) · Pro $19–39/tháng hoặc ~$149–299/năm cho nhà sáng tạo ·
Studio $99–249 mỗi ghế cho đội UA, có xuất playable theo mạng. Đây là khoảng suy ra từ các mốc đối thủ ở trên, **chưa phải dữ liệu khách hàng**.

**Thanh toán.** Người bán ở Việt Nam bán toàn cầu nên cần Merchant of Record (lo thuế VAT / sales tax). Theo các nguồn so sánh (nhiều nguồn do bên bán MoR cạnh tranh viết):
- Lemon Squeezy và Paddle đều khoảng 5% + $0,50 mỗi giao dịch. Polar đã tăng về mức tương đương năm 2026.
- Lemon Squeezy và Polar có **license key tích hợp**; một nguồn ghi Paddle không có.
- Tháng 1/2026 Lemon Squeezy công bố Stripe Managed Payments, nên tương lai độc lập của nó chưa rõ.
- **(cần kiểm tra)** khả năng nhận tiền về tài khoản ở Việt Nam của từng nhà cung cấp, và thuế thu nhập của người bán.

---

## D. Hướng phát triển bản cài đặt

### D1. Khuyến nghị: Electron, không phải Tauri

| Yếu tố | Vì sao |
| --- | --- |
| `server.ts` là Express + Node, spawn CLI cục bộ, proxy ElevenLabs, ghi workspace | Electron chạy Node ngay trong tiến trình chính. Tauri cần dựng sidecar Node nên mất lợi thế nhẹ. |
| Phim dựa vào **WebCodecs (Mediabunny), WebGPU, onnxruntime-web, AudioContext** | Electron đóng gói **một phiên bản Chromium cố định**, nên hành vi giống hệt nhau trên mọi máy, đúng với môi trường bạn đã test E2E. Tauri dùng WebView hệ thống nên trên macOS (WKWebView) hỗ trợ WebCodecs / WebGPU có thể khác. |
| Khác biệt dung lượng (nguồn đo: ~85 MB so với ~3 MB cho "Hello World") | Không quan trọng với công cụ sáng tạo vốn đã tải model giọng ~60 MB. |
| Tự động cập nhật | Electron có hệ sinh thái `electron-updater` trưởng thành (nguồn tìm kiếm không đi sâu cả hai bên, **cần kiểm tra** khi triển khai). |

### D2. Thiết kế

1. **Chạy được ngay không cần khóa.** Mở app là dùng được bằng offline director + Piper (tải theo yêu cầu). Chọn kết nối AI ở bước sau.
   Giá trị đầu tiên trong 5 phút, không cần tài khoản.
2. **Biên dịch server** thành một tệp JS (esbuild) chứ không chạy `tsx` lúc runtime. Lắng nghe `127.0.0.1` với cổng ngẫu nhiên và token phiên.
   "Play on phone" qua LAN là chế độ bật riêng, có hộp thoại xác nhận.
3. **Đóng gói model 3D cục bộ**, bỏ CDN. Thư mục `licenses/` kèm theo. Thêm `license` và `source` vào `assetRegistry.ts`.
4. **Giấy phép phần mềm:** khóa trong JWT ký bằng khóa riêng, app kiểm bằng khóa công khai, **cho dùng offline 14–30 ngày** giữa hai lần xác minh, giới hạn 2–3 máy.
   Không DRM nặng: người trả tiền chủ yếu vì cập nhật và cast / template pack.
5. **Telemetry tùy chọn, mặc định tắt**, kèm "Xuất gói chẩn đoán" (prompt, SceneSpec, điểm eval, không có khóa API) để người dùng gửi khi phim lỗi.
   Đây là nguồn dữ liệu duy nhất để cải thiện chất lượng ngoài máy của bạn.
6. **Ký mã.** Windows không ký sẽ hiện SmartScreen và làm rớt phần lớn người cài thử. macOS bắt buộc ký + notarize (Apple Developer Program, có phí năm).
   **(cần kiểm tra)** giá hiện hành của chứng chỉ Windows hoặc Microsoft Store. Phải tính vào ngân sách trước khi mở bản beta công khai.
7. **Kênh phân phối ban đầu:** GitHub Releases (bản Free) + trang tải có license key. Cân nhắc Microsoft Store và itch.io cho bản chơi / demo.

### D3. Rủi ro pháp lý phải xử lý trước khi bán

| Mục | Vấn đề | Việc cần làm |
| --- | --- | --- |
| Model 3D trong registry (RobotExpressive, Soldier, Fox, Horse, Flamingo, Parrot, DamagedHelmet) lấy từ ví dụ của three.js | `assetRegistry.ts` không ghi giấy phép. Các model này có nguồn và giấy phép **khác nhau** (có thể gồm điều khoản ghi công hoặc phi thương mại). Tôi **không xác nhận được** trong phiên này. | Tra từng tệp, ghi vào registry. Thay bằng cast pack có giấy phép sạch (CC0 hoặc tự làm / mua). |
| Giọng Piper `vi_VN-vais1000-medium` | Mỗi giọng Piper có giấy phép dữ liệu riêng; phim xuất ra chứa chính giọng này. | **(cần kiểm tra)** có cho dùng thương mại không. Nếu không, tìm giọng khác hoặc bắt người dùng dùng ElevenLabs. |
| Mixamo, Quaternius, Poly Haven | Quaternius và Poly Haven là CC0. Mixamo có điều khoản riêng về việc phân phối lại. | Không đóng gói clip Mixamo trong bản cài. Để người dùng tự nhập (đã có tính năng). Đọc lại điều khoản hiện hành. |
| **Đăng nhập CLI (Claude Code, Codex, Gemini / Antigravity, OpenCode)** | Một sản phẩm thương mại gọi CLI gắn với gói thuê bao cá nhân của người dùng có thể vi phạm điều khoản của từng nhà cung cấp. | **(cần kiểm tra)** điều khoản từng bên trước khi quảng bá "dùng gói ChatGPT / Claude của bạn". Làm đường **API key riêng của người dùng** thành lựa chọn chính, CLI là tùy chọn nâng cao. |
| Nhạc / SFX do ElevenLabs sinh | Điều khoản thương mại khác nhau theo gói (đã ghi trong `media-production-upgrade.md`). | Giữ cơ chế ghi giấy phép vào thư viện. Cảnh báo ngay trong UI. |

---

## E. Kênh marketing 0đ

Nguyên tắc: sản phẩm của bạn **tự tạo ra nội dung trực quan**. Mỗi tệp xuất ra là một mẩu quảng cáo. Hãy biến việc dùng thành việc lan truyền.

### E1. Kênh xếp theo kỳ vọng

| # | Kênh | Cách làm | Ghi chú |
| --- | --- | --- | --- |
| 1 | **Vòng lặp trong sản phẩm** | Bản Free gắn badge "Made with OmniStage" liên kết về trang tải trên HTML / MP4 xuất ra. Thêm trang "Thư viện mẫu" mỗi mẫu có playable chạy trực tiếp (vừa là SEO vừa là demo). | Chi phí 0, tăng dần theo lượng dùng. |
| 2 | **Video ngắn "1 prompt → phim + playable"** (TikTok, Reels, Shorts, Facebook) | Chuỗi cố định, có cả tiếng Việt lẫn tiếng Anh. Quay cả cảnh thất bại rồi sửa ("build in public"). | **Chỉ làm sau khi đạt B4**, nếu không sẽ quảng bá nhầm điểm yếu. Chuẩn bị 10 phim mẫu chọn lọc trước. |
| 3 | **GitHub mã nguồn mở + thư mục MCP** | README có GIF, topic `threejs / mcp / playable-ads / ai-agents / webgpu`. Gửi vào các danh sách MCP server và registry (OmniStage đã có MCP với 11 công cụ). | Trào lưu agent-native đang là điểm thu hút. Cần tài liệu cài đặt 5 phút. |
| 4 | **Bài đăng ra mắt** | **Show HN** (tiêu đề mô tả thẳng, bình luận đầu nêu hạn chế thật), Product Hunt (một đợt bùng nổ, đừng coi là phân phối lâu dài), Dev Hunt và các thư mục thay thế, Indie Hackers. Reddit: r/threejs, r/webgpu, r/gamedev, r/IndieDev, r/SideProject. | Nguồn tìm kiếm đều khuyên: tiêu đề không tính từ quảng cáo, kể câu chuyện thật. **Đọc luật tự quảng bá của từng subreddit trước khi đăng.** |
| 5 | **Bài kỹ thuật dài** (Viblo, dev.to, Medium, Three.js Discourse) | "Render phim AI từng khung bằng WebCodecs", "Vì sao LLM đạo diễn hỏng và vòng verifier sửa thế nào", "JSON Patch tool-use loop". | Tạo uy tín và backlink. Viblo cho độc giả Việt. |
| 6 | **Game jam và hackathon** (itch.io, Ludum Dare, GMTK, js13k, jam của Google / Anthropic và các cuộc thi trên Devpost) | Nộp playable làm bằng OmniStage, ghi công cụ trong mô tả. | Có phản hồi, người dùng đầu tiên, đôi khi có credit API miễn phí. |
| 7 | **Hướng dẫn YouTube theo ý định tìm kiếm** | "Cách làm playable ad miễn phí", "tạo phim hoạt hình 3D bằng AI chạy offline". | Tài liệu và video hướng dẫn cũng là SEO dài hạn. |
| 8 | **Tiếp cận trực tiếp studio mobile** (LinkedIn, X, email) | Tặng **một biến thể playable miễn phí** cho UA manager, hẹn 15 phút phản hồi. | Vừa là marketing vừa là phỏng vấn khách hàng và kênh doanh thu cầu nối (C2). Việt Nam có nhiều studio / publisher mobile, nhưng tôi chưa có danh sách đã xác thực. |
| 9 | **Cộng đồng Việt Nam** (nhóm Facebook về AI, làm phim, game dev, sáng tạo nội dung) | Chia sẻ mẫu miễn phí và bài hướng dẫn, đừng đăng quảng cáo thẳng. | Tìm kiếm của tôi **không ra tên nhóm cụ thể**. Cần bạn tự dò (hashtag #phimAI, các nhóm bạn đang tham gia). |
| 10 | **Sinh viên và giảng viên** | Miễn phí cho sinh viên, tài liệu giảng dạy. | Truyền miệng, dài hạn. |
| 11 | **Danh sách email** (gói miễn phí của Buttondown / Substack) từ ngày đầu | Mỗi bài, video, trang tải đều có ô đăng ký nhận bản beta. | Tài sản không phụ thuộc thuật toán nền tảng. |

Tránh: chạy quảng cáo trả tiền khi chưa có tỷ lệ giữ chân; đăng cùng một nội dung lên nhiều nhóm một lúc; coi Product Hunt là chiến lược duy nhất.

### E2. Kế hoạch 90 ngày (mục tiêu để chỉnh, không phải dự báo)

| Giai đoạn | Việc chính | Tín hiệu để qua giai đoạn |
| --- | --- | --- |
| Ngày 0–30 | P0 (B1 #1–#6) + P1 (#4 thư viện cử chỉ). Gỡ CDN, ghi giấy phép. Làm 10 phim mẫu. README, trang tải, danh sách email. Phỏng vấn 10 người nhóm 1. | Điểm eval ≥ 7/10, 5 người lạ xem phim muốn xem tiếp. |
| Ngày 31–60 | Ra mắt công khai (Show HN, Product Hunt, Reddit), 3–4 video ngắn mỗi tuần, 1 game jam. Làm **3 pilot** playable miễn phí → thu phí. Bản beta Electron có ký mã. | ≥ 3 studio muốn tiếp tục, có người sẵn sàng trả tiền. |
| Ngày 61–90 | Bật license (Pro), mở gói Studio cho đội UA, đo tỷ lệ cài → tạo phim đầu tiên → xuất → quay lại lần 2. | Có người trả tiền không do quen biết. Nếu không: quay lại phỏng vấn, đổi định vị, đừng thêm tính năng. |

---

## F. Rủi ro lớn nhất: dàn trải

`plan.md` có 10 phase: 3D, 2D, robot, playable, MCP, rigging, extension, WebGPU, mobile native… Mỗi phần đều được làm tốt, nhưng **chưa có một
trải nghiệm đủ sâu để khách trả tiền**. Đề xuất tạm hoãn Phase 8 (mobile native), WebGPU trong studio viewport, và các tính năng robot / OLED cho đến khi
một đường đi (prompt → phim / playable chất lượng → xuất cho mạng quảng cáo) đạt tiêu chí B4 và có khách thật.

## Nguồn tham khảo (blog nhà cung cấp, thiên vị; dùng làm mốc)

- Công cụ playable và giá: [Segwise – 9 playable ad generation tools 2026](https://segwise.ai/blog/playable-ad-generation-tools), [PlayTurbo – scaling playables 2026](https://www.playturbo.com/blog/scaling-playables-and-ai-creatives-in-2026), [AppSamurai – playable testing](https://appsamurai.com/blog/playable-ads-creative-testing/)
- Công cụ storyboard / phim AI và giá: [Atlabs – storyboard tools](https://www.atlabs.ai/blog/5-best-ai-storyboard-generator-tools-in-2026), [Morphic – 8 best AI storyboard tools](https://morphic.com/resources/tools/best-ai-storyboard-tools), [Dupple – LTX Studio review](https://dupple.com/reviews/ltx-studio)
- Merchant of Record: [DevToolPicks – Polar vs Lemon Squeezy vs Creem](https://devtoolpicks.com/blog/polar-vs-lemon-squeezy-vs-creem-2026), [Alex Cloudstar – MoR for indie SaaS 2026](https://alexcloudstar.com/blog/merchant-of-record-indie-saas-2026/)
- Tauri và Electron: [DevToolPicks](https://devtoolpicks.com/blog/tauri-vs-electron-indie-hackers-2026), [Capawesome](https://capawesome.io/docs/blog/electron-vs-tauri-for-capacitor-apps/), [Better Stack](https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/)
- Kênh ra mắt miễn phí: [DEV – free marketing channels for dev tools 2026](https://dev.to/huangyongshan46a11y/every-free-marketing-channel-for-developer-tools-in-2026-ranked-1fag), [DEV – where to list your indie product](https://dev.to/alexcloudstar/where-to-list-your-indie-product-and-what-to-skip-56gi), [Indie Hackers – first users for $0](https://www.indiehackers.com/post/how-to-acquire-your-first-users-for-0-0cb9d49a4e)
