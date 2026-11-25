# Xuất SceneSpec sang dự án Godot 4

**Publish → Godot 4 project** chuyển mọi cảnh trong dự án (2D và 3D) thành một dự án Godot 4.x dạng ZIP. Mở `project.godot` bằng Godot 4.3 trở lên rồi bấm F5.

- Mã: `src/exporter/godotExport.ts` (builder thuần, không cần DOM) và `src/exporter/godotTemplates.ts` (GDScript cố định).
- Giao diện: `src/components/GodotExportPanel.tsx`.
- Kiểm thử: `tests/godotExport.test.ts`.

## Nội dung file ZIP

| File | Nội dung |
| --- | --- |
| `project.godot` | Tên dự án, cảnh chính, kích thước cửa sổ theo `aspectRatio` (9:16 → 720×1280 dọc, 1:1 → 960×960, còn lại 1280×720; dự án chỉ có 2D → 1000×600 với GL Compatibility) |
| `scenes/NN-<slug>.tscn` | Mỗi cảnh một file, theo thứ tự `scenes[]` |
| `scripts/omni_game.gd` | Luật chơi: điểm, vật phẩm, thắng/thua, hẹn giờ, HUD, CTA, chuyển cảnh, luật từ logic graph |
| `scripts/omni_player_3d.gd`, `scripts/omni_player_2d.gd` | Điều khiển nhân vật (WASD/mũi tên/kéo chuột; 2D platformer hoặc top-down) |
| `models/*.glb`, `textures/*` | GLB và ảnh nhúng được (data URL hoặc tải về khi xuất) |
| `OMNISTAGE_EXPORT_NOTES.md` | Danh sách những gì đã chuyển và **chưa chuyển** được, theo từng cảnh |

## Những gì được chuyển

- **3D:** `Camera3D` (fov, vị trí, hướng nhìn), `WorldEnvironment` (bầu trời procedural hoặc panorama HDRI, màu nền, sương mù depth, ACES), `DirectionalLight3D` (mặt trời và rim light), mặt đất `StaticBody3D`.
- **Actor 3D:** player thành `CharacterBody3D`, collectible/hazard thành `Area3D`, dynamic thành `RigidBody3D`, còn lại là `StaticBody3D`. Mỗi actor có `CollisionShape3D` và một model GLB (nếu nhúng được) hoặc mesh nguyên khối (capsule/sphere/box) giữ màu, metalness và roughness.
- **2D:** `Camera2D` khớp sân khấu 1000×600 và nền `ColorRect`. Nhân vật thành `CharacterBody2D`, nền đỡ thành `StaticBody2D` (one-way), vật phẩm thành `Area2D`. Hình vẽ thành `Polygon2D` + `Line2D`, chữ thành `Label`, ảnh thành `Sprite2D`.
- **Luật chơi:** `gameRules` (mục tiêu điểm, giới hạn thời gian, điều kiện thắng), điểm của vật phẩm, hazard trừ điểm và đẩy lùi, hộp quà mở theo số lần chạm, overlay kết thúc với CTA (chỉ http/https), `sequence.nextSceneId` → nút chuyển cảnh.
- **Logic graph:** được biên dịch tĩnh thành các luật dữ liệu (sự kiện → các bước), chạy bằng script cố định. Hỗ trợ:
  - sự kiện scene-start, actor-click, key-press, collision, mốc timeline;
  - điều kiện score/cooldown/distance, với nhánh true/false;
  - cộng điểm, di chuyển, đổi clip, đổi fov.

## Cách chuyển toạ độ

- Three.js và Godot đều dùng hệ tay phải với Y hướng lên, -Z hướng tới trước, nên vị trí giữ nguyên.
- Góc quay Euler XYZ của Three.js (R = Rx·Ry·Rz) được ghi thẳng thành ma trận `Transform3D`, để tránh lệch thứ tự Euler (Godot mặc định dùng YXZ).
- Toạ độ 2D giữ nguyên pixel. `rotation` đổi từ độ sang radian.

## Những gì chưa chuyển (luôn có cảnh báo)

Builder **không bỏ qua im lặng** bất cứ thứ gì. Mọi tính năng không có tương đương đều xuất hiện trong danh sách cảnh báo trên giao diện (trước khi tải) và trong `OMNISTAGE_EXPORT_NOTES.md`. Các nhóm chính:

- VFX/hạt, âm thanh (soundtrack, audioTracks, sfx), hội thoại, phụ đề.
- Camera keyframe/shot/chế độ cinematic, thời tiết, mây, scatter, terrain đặc biệt.
- Model procedural (thay bằng khối nguyên thuỷ), animation procedural, keyframe 2D, spritesheet động, parallax.
- Node logic graph về phần cứng robot hoặc media pipeline (nhánh dừng tại đó, giống runtime).
- Model `.gltf` rời hoặc tải thất bại.
- Trạng thái game (giai đoạn 3): biến, máu, sát thương chạm, spawner, đạn, HUD khai báo và các action `set-variable` / `damage` / `spawn` / `win` ... không có tương đương Godot: cảnh báo theo từng thứ; node `prefab` (mẫu để spawn) bị bỏ khỏi scene; luật thắng `variable-threshold` xuất thành `score-threshold`.

## Bảo mật nội dung

- Mọi chuỗi người dùng (tên, tiêu đề, hướng dẫn, id) chỉ nằm trong `.tscn`/`project.godot` dưới dạng chuỗi đã escape.
- Tên node được làm sạch các ký tự Godot cấm.
- File GDScript là template cố định, không ghép mã từ dữ liệu người dùng.

## Kiểm tra bằng Godot thật

- `npm run verify` chạy `tests/godotExport.test.ts`.
- Có thêm một bài kiểm tra tuỳ chọn chạy `godot --headless --import` và `--check-only` cho các script, nếu có `godot` trên PATH (hoặc đặt biến `GODOT_BIN`).
- Nếu không có Godot, bài này được bỏ qua và báo "skipped".
