# Renderer: shaders và rigging

- `ActorRenderer.tsx` dùng `GLTFLoader` với Draco, Meshopt và KTX2/Basis. Decoder WASM/JS được Vite đóng gói và phục vụ cùng ứng dụng, chỉ tải khi cần. Worker pool dùng chung, tối đa 2 worker cho mỗi loại decoder; KTX2 nhận diện khả năng texture của renderer.
- Mỗi actor có skeleton/mixer riêng qua `SkeletonUtils.clone`. Geometry/material dùng chung với cache; bone texture riêng được giải phóng khi xóa actor.
- `animationCrossFade.ts` chuyển clip trong 0,3 giây bằng `action.crossFadeTo`, giữ trọng số khi ngắt một lần chuyển đang diễn ra. Pause dừng mixer; đổi tốc độ không reset clip. Idle/Walk/Attack của rig không bị chồng thêm chuyển động procedural.
- Nước dùng planar reflection render target, Fresnel, ba lớp sóng pháp tuyến và solar highlight. Chất lượng draft/high/ultra chọn độ phân giải 256/512/1024. Render target được giải phóng khi ẩn nước hoặc đổi chất lượng.
- Sky gradient theo preset, sun position và chu kỳ timeline. Nước, mây và GPU particles dùng `currentTime`, nên có thể pause/scrub. Skeletal clip chạy theo mixer riêng; thay đổi này không thêm tính năng scrub skeletal animation.
- Mưa, tuyết, tàn lửa, sương, sparkles, confetti và collision burst dùng shader hạt với seed cố định. Không cập nhật buffer vị trí từng frame; tối đa 4096 hạt mỗi emitter. Badge giữ nguyên WebGL sprite, không dùng DOM portal.

## Kiểm tra

```powershell
npm run lint
npm run test:renderer
npm run build
npm run dev
# Trong terminal khác:
npx --yes --package @playwright/cli playwright-cli open http://localhost:3000 --browser=chrome
npx --yes --package @playwright/cli playwright-cli run-code --filename tests/renderer.browser.js
```

Smoke test cần mạng để tải model mẫu chính thức, kiểm tra HTTP/CORS của registry và tải CLI nếu chưa có. CLI in kết quả JSON; ảnh nằm trong `output/playwright/` (được Git bỏ qua). Đợt kiểm tra ngày 2026-11-07 đã lưu thêm `renderer-report.json` tại đây: 6/6 test animation đạt, không có lỗi runtime/shader trong smoke test, 8/8 URL registry trả 200 với CORS `*`, số texture giữ ở 10 qua 4 lần bật/tắt nước. Test xác minh hai rig độc lập, buffer GPU không upload lại, chất lượng phản chiếu, Draco `LittlestTokyo` (193125 vertex) và Meshopt + KTX2 `coffeemat` (177247 vertex). Build đạt, còn cảnh báo bundle lớn và cấu hình Vite `__dirname` có sẵn.

Các decoder xử lý những extension trên; không bảo đảm mọi GLB bất kể extension, dữ liệu hỏng, tài nguyên ngoài bị chặn CORS hoặc kích thước vượt RAM/VRAM. Chưa có benchmark thiết bị di động hoặc kiểm chứng file Blender/Sketchfab của người dùng. Exporter standalone có renderer riêng và không tự nhận những shader này.
