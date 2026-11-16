# Đo hiệu năng trên điện thoại thật (Phase 8 — device tiers)

Bản app (PWA / Android / iOS) của OmniStage Player tự chọn **hạng máy** (low / mid / high) khi khởi động và có một
**bộ điều tốc chất lượng** (adaptive governor) hạ / nâng chất lượng theo thời gian khung hình đo được. Các con số ngân sách
hiện tại là **ước lượng tham khảo**, chưa đo trên máy thật. Tài liệu này hướng dẫn đo và điền số thật.

Mã nguồn:

| Phần | File |
| --- | --- |
| Bảng hạng máy, ngân sách, thang chất lượng, nhận diện hạng | `src/runtime/deviceProfiles.ts` |
| Governor + báo cáo | `src/runtime/qualityGovernor.ts` |
| Đọc tín hiệu trình duyệt, overlay, lưu báo cáo | `src/player/perf.ts` |
| Áp dụng chất lượng vào 3D (pixel ratio, bóng, hạt, bloom) | `src/player/view3d.ts` (`applySettings`) |
| Kiểm tra ngân sách theo hạng | `verifySceneSpec(spec, { target: 'mobile', deviceTier })` |
| Test | `tests/deviceProfiles.test.ts` |

## 1. Cách hệ thống hoạt động

- **Nhận diện hạng** (`detectDeviceTier`): dùng `navigator.hardwareConcurrency`, `navigator.deviceMemory` (chỉ Chrome),
  chuỗi GPU (`WEBGL_debug_renderer_info`), kích thước màn hình. GPU phần mềm / GPU cấp thấp / ≤ 3 GB RAM / ≤ 4 nhân → `low`.
  GPU cao cấp + ≥ 6 GB + ≥ 6 nhân → `high`. Còn lại → `mid`. Safari (iPhone) giấu GPU và RAM nên thường ra `mid`;
  governor sẽ tự chỉnh từ đó.
- **Thang chất lượng** (`QUALITY_LADDER`, tốt → rẻ): bloom → pixel ratio → bóng (full = shadow map + contact shadows,
  basic = chỉ shadow map, off) → tỉ lệ hạt. `high` bắt đầu ở bậc 0, `mid` ở bậc 2, `low` ở bậc 4.
- **Governor**: trung bình thời gian khung trong 90 khung. Chậm hơn ngân sách × 1,2 → hạ một bậc. Đạt mục tiêu 4 cửa sổ
  liền → nâng một bậc (không vượt bậc khởi đầu của hạng). Sau mỗi bước: bỏ một cửa sổ, chờ 3 giây. Nếu vừa nâng mà phải hạ
  lại trong 20 giây thì khoá trần ở bậc thấp đó (không dao động). Khung > 250 ms (chuyển tab, GC, tải) bị bỏ qua.
- **Shader effect** (`actors[].shaderEffect`): governor không tắt hiệu ứng shader (chúng là một phần của giao diện nhân vật), nhưng verifier
  mobile cảnh báo `mobile.heavy-scene` khi số actor có shader effect vượt `maxShaderEffects` của hạng (low 2 / mid 5 / high 12).
- **Không ảnh hưởng xuất xác định**: governor chỉ chạy trong vòng `requestAnimationFrame` của bản app. Bản quảng cáo
  (không có `app`), MP4 (`manual(true)` + `step()`) và test E2E không bao giờ đổi chất lượng.
- 2D: canvas 2D cố định 1000×600 nên governor chỉ đo và báo cáo, chưa có gì để hạ (hạt 2D vẫn theo `rate` của scene).

## 2. Chuẩn bị

1. Xuất bản app: Publish → Mobile App → **Download PWA** (nhanh nhất) hoặc **Android / iOS project**.
2. PWA: đưa thư mục lên một host HTTPS (hoặc `npx serve` trong mạng LAN rồi mở bằng IP máy tính trên điện thoại).
3. Android debug APK: `npm run android:debug`, cài APK, bật USB debugging, mở `chrome://inspect` trên máy tính.
4. Chọn **scene chuẩn** để đo (giữ nguyên giữa các máy), ví dụ:
   - S1: 3D game nhẹ (template coin rush, ~10 actor).
   - S2: 3D film nhiều nhân vật rig (4–8 nhân vật OmniRig, có bóng, có nước / biome).
   - S3: 2D platformer + 2–3 particle emitter.
5. Sạc pin > 50 %, tắt chế độ tiết kiệm pin, để máy nguội 5 phút giữa các lần đo, độ sáng cố định.

## 3. Đo

Với mỗi máy và mỗi scene:

1. **Đo không governor** ở từng hạng để biết mỗi hạng thực sự chạy bao nhiêu fps:
   `index.html?omniPerf=1&omniGovernor=0&omniTier=low` (rồi `mid`, `high`). Chơi / xem 60 giây.
   Đọc trên overlay: `fps last · worst window · avg`.
2. **Đo có governor** (mặc định, hạng tự nhận diện): `index.html?omniPerf=1`. Chơi 2–3 phút. Ghi lại hạng được chọn,
   lý do (`why:`), bậc cuối cùng và danh sách bước (`↓` hạ, `↑` nâng).
3. Bấm **Copy JSON** trong overlay và dán vào bảng / issue (có `userAgent`, màn hình, DPR).
4. Bản app native (không sửa URL được): chạm **5 lần nhanh vào góc trên bên trái** để bật / tắt overlay; hoặc trong
   `chrome://inspect` gõ `__omniPlayer.perf()`. Nếu bật Saves, báo cáo cuối được lưu ở khoá `omnistage.perf.<app id>`.
5. Tuỳ chọn: Android `adb shell dumpsys gfxinfo <package>` hoặc Xcode Instruments để đối chiếu, và ghi nhiệt độ /
   tụt xung sau 10 phút (`adb shell dumpsys thermalservice`).

## 4. Bảng kết quả (điền số thật)

| Máy | SoC / GPU | RAM | Hạng tự nhận | S1 fps (low/mid/high) | S2 fps (low/mid/high) | S3 fps | Governor: bậc cuối, số bước | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _vd. Galaxy A14_ | _Mali-G52_ | _4 GB_ | | | | | | |
| _vd. Pixel 6a_ | _Mali-G78_ | _6 GB_ | | | | | | |
| _vd. iPhone 12_ | _Apple A14_ | _4 GB_ | | | | | | |
| _vd. Galaxy S23_ | _Adreno 740_ | _8 GB_ | | | | | | |

## 5. Cập nhật con số sau khi đo

- **Ngân sách nội dung** (`DEVICE_PROFILES[tier].budget`): tìm số actor / đỉnh skinned / số hạt tối đa mà máy tiêu biểu
  của hạng vẫn giữ `targetFps` ở bậc khởi đầu. Hạ ngân sách nếu `worst window` < 80 % mục tiêu.
- **Bậc khởi đầu** (`startRung`): nếu governor gần như luôn hạ ngay 1–2 bậc trên máy tiêu biểu, chuyển bậc khởi đầu xuống.
- **Nhận diện** (`classifyGpu`, ngưỡng RAM / nhân): nếu máy bị xếp sai hạng, thêm GPU vào regex và thêm một ca trong
  `tests/deviceProfiles.test.ts` (test "fake devices").
- **Governor** (`windowFrames`, `downFactor`, `upWindows`, `cooldownMs`): chỉnh nếu thấy hạ quá chậm (giật lâu) hoặc
  nâng / hạ qua lại.
- `mid` phải luôn bằng `MOBILE_REFERENCE` (test kiểm tra). Sau khi sửa: `npm run verify`, `npm run build:player`,
  `npm run test:e2e`, rồi ghi ngày đo vào `plan.md` (Phase 8).

## Chưa làm (cần máy thật hoặc làm sau)

- Toàn bộ số trong bảng hạng máy chưa được đo.
- Chưa nhớ bậc của lần chơi trước để khởi động thấp hơn trên máy đã biết là chậm.
- Chưa có giảm chất lượng cho 2D (độ phân giải canvas, mật độ hạt 2D).
- Chưa đo nhiệt / tụt xung dài hạn; governor chỉ phản ứng theo fps.
