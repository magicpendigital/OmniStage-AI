# OmniStage — Đánh giá UI/UX, Engine game/video và AI Director (2026-11-23)

Nguồn: 4 đợt khảo sát code (đọc source, không chạy AI live), 1 lần chạy app thật ở 1440×900, và nghiên cứu web.
Các phát hiện tôi đã tự kiểm tra lại được đánh dấu **[đã kiểm]**; còn lại là kết quả đọc code của agent khảo sát, cần xác nhận khi sửa.

---

## 0. Tóm tắt

1. **UI khó dùng vì mật độ và vị trí, không phải vì thiếu tính năng.** ~80–90 điều khiển hiện cùng lúc, chữ 9–11px, Inspector bị giấu trong tab thứ 3 của khung AI, không có Ctrl+Z **[đã kiểm]**, Play Test không theo kịp chỉnh sửa.
2. **Engine chưa đủ để làm game thật.** Không có engine vật lý **[đã kiểm: package.json không có Rapier/Cannon/Matter/Planck/Ammo]**. Game 3D không có trọng lực, nhảy, va chạm cứng. Không có spawn lúc chạy, biến, máu/mạng, HUD tuỳ biến. Mảng **film/video mạnh hơn game rất nhiều**.
3. **Trần chất lượng của AI Director nằm ở hai chỗ:** (a) nó chỉ có feedback tĩnh, chưa bao giờ *chạy* game; (b) nó chỉ có thể ghép những gì engine cho phép. Vì vậy **nâng engine và nâng Director phải đi cùng nhau**, engine trước một bước.
4. **Phát hiện nghiêm trọng nhất, sửa trong vài giờ:** khi AI lỗi/không có key, hệ thống âm thầm dùng engine offline theo từ khoá và vẫn trả lời "Updated SceneSpec…" **[đã kiểm: `src/agent/studioAgent.ts:1721-1733`]**. Người dùng không phân biệt được "AI yếu" với "AI không chạy".

---

## 1. UI/UX

### 1.1 Số đo thực tế (app chạy ở 1440×900)
- 82 điều khiển hiển thị trên màn hình đầu; 43 cái < 28px.
- Cỡ chữ: 11px ×67, 10px ×18, 12px ×17, 9px ×13. Trong code: 349 chỗ dùng `text-[9px|10px|11px]`.
- 4 nút chỉ có icon, không tooltip/nhãn.
- Khung 3D nhỏ, thanh Move/Rotate/Scale nổi đè lên model; ô Director nhỏ ở đáy.

### 1.2 Vấn đề xếp theo tác động

| # | Vấn đề | Cách sửa |
|---|---|---|
| 1 | AI lỗi bị che giấu (xem mục 0.4). `handleSendPrompt` còn thiếu `catch`. | Trả kết quả có kiểu `{source:'ai'|'offline', reason}`; banner thường trực "Offline — chưa kết nối AI [Kết nối]"; nếu provider đã cấu hình mà lỗi thì báo lỗi, không thay thế ngầm. |
| 2 | Không có Ctrl+Z/Y **[đã kiểm: chỉ có Ctrl+S trong `useProjectAutosave.ts`]**. Lịch sử 20 bản clone; mỗi phím gõ/tick slider tốn 1 bước; `updateNode2D` không ghi history; đổi scene xoá lịch sử. | Phím tắt toàn cục; gộp history theo (đối tượng, trường) ~400ms hoặc commit khi blur/pointerup; ghi history cho 2D; nâng cap lên ~100 bằng patch thay vì clone; toast "Đã hoàn tác: …". |
| 3 | Inspector bị giấu (tab thứ 3 của khung AI), thiếu rotation/scale/màu/tên; không có inspector cho 2D node, VFX, camera, ánh sáng. | Dock "Properties" cố định bên phải, theo selection, có đủ transform/material/behaviour. |
| 4 | Vòng sửa→chơi chậm: Play Test là modal toàn màn hình, **không rebuild khi scene đổi**; ▶ ở dock và Play Test có nghĩa khác nhau. | Play Test live (debounce rebuild theo `sceneSpec`), có chế độ chơi ngay trong viewport; đổi tên ▶ thành "Xem timeline"; một phím Space/F5. |
| 5 | Thanh trên + ModeBar quá tải; trùng lặp: target score/timer/win ×2, CTA ×3, chất lượng render ×3; "Save" (tải file) khác chip autosave. | Gom thành menu File/Scene; chuyển engine/aspect/quality/bloom/gravity/CTA vào mục "Scene settings" của Properties; luôn hiện Undo/Redo/Play/Publish. |
| 6 | Chưa có luồng lần đầu: dữ liệu demo của dev còn sót (log giả, lời chào "Phase 5"), tour nói "chat bên phải" nhưng chat ở thanh dưới, template giấu trong dropdown, scene trống mặc định mode Media. | Màn hình bắt đầu: 4–6 thẻ template ("Quảng cáo playable", "Platformer 2D", "Showcase 3D", "Phim ngắn") + ô "Mô tả game/video của bạn". Xoá seed giả; viết lại tour. |
| 7 | Timeline chỉ hiển thị: không kéo/trim clip, không kéo keyframe, không zoom/snap; keyframe 2D không tương tác. | Kéo/resize có snap, inspector keyframe (easing), zoom, Space = play. |
| 8 | Viewport thiếu cơ bản: không snap, không multi-select, không copy/paste/Delete, W/E/R chết mặc định (vì `isPlaying` mặc định true), thả asset bỏ qua vị trí con trỏ, scene lặp liên tục khi đang chỉnh. | Bổ sung theo danh sách; tạm dừng loop khi đang chỉnh; thả theo raycast xuống mặt đất. |
| 9 | Logic: form "New rule" chỉ có 5 When/3 Do cố định; graph 1254 dòng thiếu multi-select/Delete/minimap/tìm node. Node robot-hardware không giải thích cho người làm game. | Sửa rule inline (tham số, điều kiện, "+ Then"); palette có tìm kiếm; badge lỗi trên node; ẩn node phần cứng khỏi người dùng game. |
| 10 | Asset/generate rải rác (Library, My Library, Generate, Online Hub, Meshy chỉ trong Writers' Room, OmniRig ở 2 nơi, SFX/music trong Settings). Job generate mất khi đóng panel. | Một panel "Assets" có tab Library/Generate/Online; danh sách Jobs có cancel/retry và lưu qua reload. |
| 11 | Director: không Stop, không đếm giờ, reply cắt 3 dòng, không nút Revert theo thay đổi, intent Patch/Replace/Storyboard không giải thích, 2 quick prompt tiếng Việt lẫn trong UI tiếng Anh. | Nút Stop + timer + nhãn bước ("Planning → Patching → Verifying 1/3"); thẻ kết quả mở rộng có Keep/Revert; tooltip intent. |
| 12 | Không có ErrorBoundary toàn cục (lỗi render ở 1 panel làm trắng cả studio); xoá actor không xác nhận/không toast; dùng `window.confirm` ở 5 chỗ. | ErrorBoundary theo panel + "Khôi phục autosave"; xoá có undo-toast. |
| 13 | Kết quả verifier chỉ là chip nhỏ + tooltip. | Panel "Problems" (click để chọn, nút auto-fix), badge ở dock, marker trên actor/node. |
| 14 | Truy cập/đọc: `--dim` ≈ 4.2:1 (dưới AA 4.5:1), phần lớn modal không đóng bằng Esc/không giữ focus, stage/timeline/graph chỉ dùng chuột. | Tối thiểu 12px cho điều khiển; component `Modal` chung; tablist có phím mũi tên; cài đặt UI scale. |
| 15 | Hai hệ style (token `.btn/.field/.card` và Tailwind cũ), chiều cao/bo góc không đồng nhất; flyout cố định 300px. | Chuyển dần panel cũ sang token; menu overflow cho thanh trên; flyout kéo giãn được. |

### 1.3 Gợi ý cấu trúc lại không gian làm việc
Mục tiêu: **một vòng lặp rõ ràng — Mô tả → Xem → Chỉnh → Chơi thử → Xuất.**
- Trái: Outliner/Assets. Giữa: Stage (lớn hơn, không đè gizmo). Phải: **Properties** (cố định). Dưới: Timeline/Problems/Logs. **Director là một panel/khung chat chính thức**, không phải thanh nổi.
- Chế độ "Đơn giản/Nâng cao": ẩn Logic graph, World nâng cao, extension khi người dùng mới.

---

## 2. Engine: đủ để làm game/video chưa?

### 2.1 Kết luận
- **Video/film:** gần đủ. Có camera shots (8 kiểu, 7 chuyển động), diễn xuất theo thời gian, 7 kiểu chuyển cảnh, thoại + TTS, nhạc/ambience/SFX, J/L-cut, phụ đề, xuất MP4 chính xác từng khung. Thiếu: timeline NLE đa track (`timelineTracks[]` hiện không được runtime đọc), keyframe 3D theo thuộc tính, speed ramp, overlay video/ảnh, color grading, DOF/motion blur, lip-sync, thư viện cử chỉ.
- **Game:** mới ở mức "arcade thu thập + một bước platformer viết tay".

### 2.2 Ma trận game (theo khảo sát code)

| Năng lực | Hiện trạng |
|---|---|
| Vật lý rigid body, khối lượng, ma sát, nảy, joint | Không có. `'dynamic'`/`'bouncing'` chỉ là tag, không có hành vi |
| Trọng lực/nhảy 3D | Không (người chơi chỉ trượt x/z, arena ±5.5 m) |
| Va chạm cứng | Không. Chỉ phát hiện chồng lấn (vòng tròn XZ 3D; AABB 2D, bỏ qua xoay), O(n²) mỗi khung |
| Collider tự định nghĩa / sensor / layer-mask / raycast / CCD | Không (chỉ có lọc theo role) |
| Platformer 2D | Một bước viết tay, chỉ player, chỉ platform một chiều, không coyote time/nhảy đôi, khung cố định 1000×600, không camera cuộn |
| Spawn/destroy lúc chạy, đạn, spawner, wave | Không |
| Biến/cờ, máu, mạng, inventory, power-up | Không (chỉ có điểm, thời gian, thắng/thua) |
| Logic graph | 5 loại node; **dây số không được thực thi**; không có node biến/toán/delay/random/loop |
| Điều kiện `tap-count` | AI sinh ra (`studioAgent.ts:978`, prompt `systemPrompts.ts:39`) nhưng interpreter ném lỗi ở nhánh mặc định **[đã kiểm: `logicGraph.ts:274`]** — cần xác nhận có đường xử lý riêng cho unbox hay không |
| AI kẻ địch | State machine: patrol/chase/flee; không pathfinding, tầm nhìn, tấn công tầm xa |
| HUD | Cố định (điểm, thời gian, CTA, end card); không có widget tuỳ biến, thanh máu, menu |
| Input | Phím/touch/gamepad cố định; không remap, không mouse-look, không joystick ảo |
| Cutscene trong game | Không (`performance` và `camera.shots` chỉ chạy ở media mode) |

**Thể loại làm được:** thu thập điểm, tap-to-unbox, platformer 1 màn, né/đuổi top-down đơn giản, phim ngắn.
**Không làm được:** shooter, racing, tower defense, puzzle vật lý, platformer cuộn màn, RPG, 3D platformer, endless runner (khó).

### 2.3 So sánh với Buildbox (độ tin cậy hạn chế)
Trang chính thức của Buildbox bị chặn khi nghiên cứu; dữ liệu đến từ Wikipedia và báo chí. Đã xác minh được: node logic (v3 thêm ~40 node), 14 "smart assets", thanh trượt vật lý + collision editor, scene editor, 20.000+ asset, AI (v4) tạo asset/scene/node, quảng cáo/monetization, xuất iOS/Android/PC/Steam. **Không xác minh được:** character controller, camera, HUD builder, AI enemy, template theo thể loại.
Bài học áp dụng: Buildbox thành công vì **kho "hành vi dựng sẵn có tham số"** — đúng triết lý union-literal của OmniStage. Đừng sao chép "custom node bằng code" (vi phạm invariant 1); thay bằng quy trình đề xuất union literal mới qua review.

### 2.4 Bổ sung đề xuất (theo thứ tự phụ thuộc)

Mọi mục đều theo CLAUDE.md: union literal trong `scene.schema.ts` → renderer/runtime/store → prompt → verifier rule + test → chạy được trong export (tự chứa).

**Giai đoạn E1 — Nền tảng chuyển động & va chạm (chặn mọi thể loại khác)**
1. Bộ giải vật lý **tất định, nhỏ, tự viết** dùng chung cho Studio/Player/export: collider box/circle/capsule, sensor/trigger, layer+mask, trọng lực theo body, ma sát, restitution, kinematic character controller (nhảy, coyote time, nhảy biến thiên, dốc/bậc), raycast/sweep. Đặt ở `src/runtime/physics/*`.
2. Sửa `PLATFORMER_PHYSICS` đang nhân đôi thủ công giữa `stage2d.ts` và `sceneVerifier.ts` — dùng chung một nguồn.
3. Quyết định Rapier: *chỉ* cân nhắc làm tầng tuỳ chọn "rigid-body" cho export không phải playable ad, sau khi **đo kích thước WASM so với ngân sách quảng cáo** (chưa đo trong đợt này). Playable ad nên dùng bộ giải nhỏ.
4. Camera 2D (cuộn, theo dõi, zoom), thế giới lớn hơn 1000×600, tile đặc/một chiều, platform di động, checkpoint. Camera 3D: follow mượt, deadzone, shake.

**Giai đoạn E2 — Trạng thái & logic game**
5. Biến/cờ/bộ đếm toàn cục + theo thực thể; máu/mạng; sự kiện thua trong logic graph; node so sánh/toán/delay/random/lặp/rẽ nhánh; thực thi dây số.
6. Spawn/despawn lúc chạy: spawner, prefab, đạn (vận tốc, vòng đời, va chạm-huỷ), wave.
7. HUD khai báo (thanh máu, bộ đếm, nút, menu, pause, hộp thoại) gắn với biến; joystick ảo; remap input, mouse-look, kéo/vuốt.
8. Pathfinding lưới/navmesh, line-of-sight, tấn công tầm xa, nhóm kẻ địch.
9. Cutscene trong game: cho phép `performance`/`camera.shots` trong game scene + hành động khoá input; tween thuộc tính 3D/2D (đủ xoay/scale/opacity), di chuyển theo spline.

**Giai đoạn E3 — Video**
10. Timeline đa track thật (dùng `timelineTracks[]`), keyframe 3D theo thuộc tính, speed ramp, overlay ảnh/video, color grading/LUT, DOF/motion blur, cubic-bezier easing.
11. Lip-sync cơ bản, thư viện cử chỉ theo cảm xúc, đường đi cong cho `performance.moveTo`.

**Giai đoạn E4 — Bộ khung thể loại (cần E1–E2)**
Runner, top-down shooter, platformer cuộn, tower defense, puzzle vật lý, match-3: mỗi bộ = SceneSpec khung đã verified + skill + rule verifier.

**Dọn ngay (không cần engine mới):** triển khai `tap-count`; xoá/ghi chú rõ các role `dynamic`/`bouncing`, `parallaxFactor`, hành động `jump-boost`/`bounce` mà prompt hứa nhưng runtime không làm; role `hazard` 2D; player top-down đang dùng code hạ cánh platform.

---

## 3. AI Director: tái cấu trúc

### 3.1 Hiện trạng
- Là **bộ sinh JSON không trạng thái** bọc trong vòng verify/auto-fix tất định. Không có gọi tool gốc của LLM, không có lịch sử hội thoại, không bao giờ chạy game, không sinh asset giữa chừng.
- Sửa cảnh mặc định: vòng JSON Patch tối đa 3 vòng, "tool" duy nhất là verifier tĩnh. Mỗi vòng gửi **toàn bộ SceneSpec** + prompt hệ thống ~25k ký tự (~7k token), **không prompt caching**.
- Film có pipeline giàu (Story Bible, Writers' Room, plan, từng cảnh, polish, Director QA bằng vision, cut QA, eval 0–100). **Game thì gần như không có**: `game-levels` bỏ qua bible/polish/QA — plan rồi N lần one-shot cả SceneSpec rồi auto-fix.
- Chất lượng chỉ được đo bằng luật tĩnh. Verifier chỉ chứng minh khả năng đạt cho platformer 2D và "tổng điểm ≥ target" cho 3D; **không có eval cho game/quảng cáo**; vision chỉ cho film 3D, ảnh tĩnh, ≤4 khung, không chạy trên Claude Code CLI.
- Provider CLI chạy với tool bị tắt (`--tools ""`), nên toàn bộ là text-in/JSON-out.
- MCP server (11 tool) đã có hình dạng tool-calling đúng (đọc, patch+verify+autofix, export), nhưng thiếu `finalizeLogicGraph`, không có vision/playtest/asset/memory.

### 3.2 Về QuadcodeAI
`quadcode.ai` là ứng dụng desktop **đa dụng** (agent chuyên biệt, định tuyến nhiều model, duyệt kế hoạch, MCP cho Unity/Figma), **không phải coding agent chuyên game** và không công bố kiến trúc chất lượng game. Vì vậy phương án dưới đây dựa trên các hệ **có tài liệu**: OpenGame, Roblox Studio agentic, Unity AI Assistant, các MCP playtest của Godot, Rosebud, benchmark GBQA — **không** dựa trên "cách làm của QuadcodeAI".

Các mẫu lặp lại ở nhiều nguồn: (1) lập kế hoạch có thể sửa trước khi build; (2) bộ khung/skill tái sử dụng; (3) vai chuyên biệt dưới một director; (4) sửa nhỏ qua tool call có phân quyền; (5) vòng playtest tự động chạy→chụp→đọc log→sửa; (6) nhật ký lỗi/sửa và bộ nhớ dài hạn; (7) bộ eval. **Cảnh báo:** verdict "pass" tự động hay sai (beta Roblox báo pass dù bằng chứng fail; QA agent tốt nhất của GBQA chỉ tìm 48,4% lỗi) → phải yêu cầu bằng chứng, và cho agent QA xem cả spec/plan.

### 3.3 Kiến trúc mục tiêu

```
Prompt ─► Intake (làm rõ, ≤2 câu) ─► GameDesign (GDD-lite có kiểu, người duyệt)
        ─► Build planner (thứ tự dựng) ─► Builder (vòng tool-use, patch nhỏ)
        ─► Verifier tĩnh ─► Playtest bot (chạy runtime thật) ─► Critic (spec+plan+trace+ảnh)
        ─► Sửa (vòng có giới hạn) ─► Người duyệt / Revert
        └── Bộ nhớ dự án: GDD, nhật ký quyết định, nhật ký "lỗi→cách sửa đã kiểm"
```

**A. Trung thực & nền tảng (S, làm trước)**
- Kết quả có kiểu `source`; banner offline; xử lý lỗi provider.
- Prompt caching cho phần prompt tĩnh; streaming tiến độ; nút Stop.
- Chia prompt hệ thống 25k ký tự thành module nạp theo nhu cầu (logic graph, state machine, shots, dialogue… chỉ nạp khi liên quan).
- Sửa `Auto-Fix` đang ép mọi logic node `status:'success'` (có thể che lỗi — `RightAgentChat.tsx:419-438`).

**B. Giai đoạn thiết kế cho game (M)**
- Kiểu `GameDesign` (thể loại, vòng lặp lõi, thắng/thua, thực thể, tiến trình, mục tiêu độ khó, ngân sách asset). Tái dùng cơ chế Story Bible: draft → lint → một vòng revise → fallback offline; người dùng xem/sửa trước khi build.
- Verifier "Intent alignment": so SceneSpec với GameDesign (có đủ thực thể, điều kiện thắng khớp…).
- Lưu GDD vào dự án như bộ nhớ dài hạn, thay cho tóm tắt `previousScenes` mất thông tin.

**C. Bộ khung thể loại + dựng tăng dần (M–L, cần E1–E2 của engine)**
- Mỗi bộ khung = SceneSpec verified + skill + luật verifier. Director **chọn khung rồi tham số hoá/patch**, không viết từ đầu.
- Thứ tự dựng cố định: thế giới → người chơi/điều khiển → cơ chế lõi → kẻ địch/chướng ngại → HUD → cân bằng → juice/âm thanh. Mỗi bước verify trước khi sang bước sau.

**D. Vòng agent dùng tool (L)**
- Tầng tool dùng chung cho app và MCP (`finalizeLogicGraph` + `autoFix` + verify trong cùng một đường). Tool: `get_scene_slice`, `apply_patch`, `add_from_kit`, `search_assets` (thấy cả thư viện cá nhân/hub), `generate_asset` (**giữ bước xác nhận chi phí của người dùng**, như `MeshyCastPanel` hiện tại), `verify`, `playtest`, `screenshot`.
- Dùng tool-calling gốc của API provider (Anthropic/OpenAI/Gemini). **Giữ vòng patch JSON hiện tại làm đường fallback** cho CLI provider và chế độ offline — đúng quy tắc trong `.claude/rules/agent-and-verification.md` (offline director phải dùng được khi không có key).
- Gửi lát cắt SceneSpec liên quan thay vì toàn bộ.

**E. Playtest bot tất định (L — đòn bẩy lớn nhất)**
- Player đã có `step(dt)`/`manual(true)`/`window.__omniPlayer` và e2e dùng nó. Chạy headless trên **runtime dùng chung** (để khớp bản export): bot theo chiến lược (tiến về mục tiêu, ngẫu nhiên có seed, tránh nguy hiểm).
- Số liệu trả về cho model: có thể thắng không, thời gian tới lần tương tác đầu, thời gian thắng, điểm chết, số entity, xung đột spawn trong collider, input không gắn hành động nào.
- Lưu chuỗi input có thể phát lại + assert (kiểu Beckett của Godot) làm test hồi quy.
- **Không tin "pass" trơn**: mỗi verdict phải kèm trace.

**F. Vision & eval cho game/ad (M)**
- Mở rộng Director QA sang game: ảnh theo mốc từ playtest, rubric 3 trục (build health, khả dụng thị giác, khớp ý định), không giới hạn điểm 70–98 như prompt hiện tại.
- Mở rộng `eval:film` thành bộ eval prompt→SceneSpec cho game/ad: verifier pass, thắng-được trong bot, điểm VLM; theo dõi qua các lần chạy.

**G. Vai trò & bộ nhớ (S–M)**
- Vai (designer, builder, artist, QA, hook-and-pacing cho ad/video) là **profile prompt trên cùng SceneSpec**, không cần hạ tầng đa agent nặng. Chia sẻ artefact (bảng màu, id asset).
- Nhật ký "lỗi verifier → patch đã kiểm" (ý tưởng Debug Skill của OpenGame), nhật ký quyết định ("người dùng thích/bác bỏ gì"). Nối vào `src/agent/memory.ts`.
- Checkpoint con người: duyệt GDD, duyệt patch lớn, Revert 1 chạm; phân quyền kiểu Ask/Plan/Agent.

### 3.4 Ràng buộc từ invariant hiện có
- Vẫn không `eval` code; không có "custom node bằng code" kiểu Buildbox 4. Mở rộng năng lực = union literal mới qua review schema.
- Mỗi luật gameplay mới = luật verifier + test; mọi thứ chạy trong export phải tự chứa.
- Skill vẫn chỉ là văn bản prompt (không mã, không URL).
- Chạy `npm run verify`, `npm run test:e2e`, `npm run build:player` khi chạm Player/runtime.

---

## 4. Lộ trình đề xuất

| Giai đoạn | Nội dung | Cỡ | Ghi chú |
|---|---|---|---|
| **0 — Sửa nhanh** | Banner/kết quả AI có kiểu + `catch`; Ctrl+Z/Y và gộp history; sửa W/E/R; xoá seed demo; `tap-count`; prompt caching; tăng cỡ chữ/độ tương phản; nút Stop | S | Giá trị cao, rủi ro thấp |
| **1 — Không gian làm việc** | Properties dock; Play Test live; gom menu thanh trên; màn hình bắt đầu + template; Problems panel | M | Giải quyết cảm giác "khó dùng" |
| **2 — Engine E1** | Bộ giải vật lý tất định, camera 2D/3D, tile/platform, character controller | L | Mở khoá mọi thể loại |
| **3 — Engine E2** | Biến, máu, spawn, HUD khai báo, input, pathfinding | L | Đã làm (2D): biến, máu/sát thương, spawner/đạn/prefab, HUD khai báo, node logic mới, luật thắng theo biến. Chưa làm: pathfinding/LOS, input remap/joystick ảo, wave, menu/pause/hội thoại HUD, đạn & sát thương chạm 3D |
| **4 — Director B + D** | GameDesign + tầng tool dùng chung + vòng tool-use | L | Đã làm: GameDesign (lint/revise/offline, màn review, verifier intent-alignment, nối vào planner + từng màn + context chỉnh sửa); tầng tool dùng chung cho app + MCP (`checkScene`, 5 tool), vòng tool-use Anthropic (opt-in `aiEditMode: 'tools'`, chưa chạy thật với API, fallback patch loop). Chưa làm: playtest bot, vision/eval cho game, genre kit (`add_from_kit`), tool `generate_asset` / `screenshot` / `playtest`, role profile, log lỗi→sửa thành memory, tách prompt thành module, quyền Ask/Plan/Agent |
| **5 — Director C + E + F** | Bộ khung thể loại, playtest bot, eval game/ad | L | Đã làm (2D): 4 bộ khung thể loại (platformer, key-hunt, turret-dodge, survival; `src/agent/genreKits.ts`) — verify sạch và bot thắng ở mọi độ khó, director offline dựng màn từ chúng; playtest bot tất định chạy trên runtime dùng chung (`src/playtest/*`, bằng chứng + băng input phát lại được; "won" là bằng chứng, "not-won" chỉ là cảnh báo); tool `playtest` + `add_from_kit` (studio tool loop + MCP); eval game (`npm run eval:game`, `eval/game-prompts.json`). Sửa lỗi bot tìm ra: round game đứng im ở `durationSeconds`; finalizer nối chuỗi nhặt vật phẩm kiểu 3D cho 2D (vật phẩm không biến mất, có thể farm điểm) và gắn tham số animation 3D vào action 2D. Chưa làm: bot cho 3D, VLM đánh giá game, kit ngoài 4 thể loại. |
| **6 — Video E3, timeline** | NLE đa track, grading, DOF, lip-sync | L | Độc lập với game. Đã làm (3D): màu & ống kính khai báo `SceneSpec.grade` (preset + exposure/contrast/saturation/warmth/tint/fade/vignette/grain/split toning; pass hiển thị cuối cùng, GLSL + TSL + tham chiếu CPU, có trong Studio, Play Test và export, hạt nhiễu theo frame nên xuất video lặp lại đúng; Godot map sang Environment adjustments), một phim dùng chung một look (`unifyFilmGrade`), easing cubic-bezier `bezier(x1,y1,x2,y2)` ở mọi chỗ có `ease` (cả runtime export), timeline nhiều track suy ra từ scene (shots, từng bước diễn của actor, caption + thoại, nhạc, ambience, SFX, VFX, look; click để nhảy, cảnh báo chồng clip). **6B đã làm:** kéo / resize / snap / zoom clip trên timeline (kéo mép để đổi độ dài, Shift = kéo tự do, phím mũi tên để nhích; mỗi lần kéo là một bước undo, ghi ngược về đúng trường trong SceneSpec qua `applyClipEdit`), và độ sâu trường ảnh `grade.dof` + `grade.focusDistance` (0 = tự lấy nét vào chủ thể của shot; preset `portrait`; GLSL + TSL + tham chiếu CPU, tất định theo pixel nên xuất video lặp lại đúng). Chưa làm: speed ramp / remap thời gian, motion blur, overlay ảnh-video, LUT thật, lip-sync, keyframe 3D theo thuộc tính, grade cho 2D, DOF cho vật trong suốt (không ghi depth) |

Giai đoạn 2–3 và 4 có thể làm song song vì ít chạm chung file (engine/runtime vs agent/server), nhưng 5 phải đợi cả hai.

---

## 5. Độ tin cậy và giới hạn

- Khảo sát code là đọc source; chưa chạy AI live, chưa đo kích thước WASM, chưa dùng thử toàn bộ UI (Settings, Publish, Extensions, Writers' Room, OmniRig, Online Browser chỉ xem cấu trúc).
- Tôi đã tự kiểm 4 điểm: không có thư viện vật lý, không có Ctrl+Z, nhánh fallback offline im lặng, `tap-count` không có case trong interpreter. Phần còn lại (số dòng, số đếm) là của agent khảo sát.
- Hành vi trình duyệt (số điều khiển, cỡ chữ) đo ở viewport mô phỏng 1440×900.
- Buildbox: thông tin tính năng chủ yếu từ nguồn thứ cấp. QuadcodeAI: không xác minh được kiến trúc game.
- Một số nguồn nghiên cứu web được đọc qua mô hình tóm tắt, không phải nguyên văn.
