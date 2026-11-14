# OmniStage: vì sao video AI tạo ra chưa hấp dẫn, và cách nâng cấp (2026-11-11)

Bối cảnh: người dùng yêu cầu "phim 3D 3 cảnh về chú robot phiêu lưu trong rừng". Agent tạo được 3 cảnh nối nhau, nhưng:

- nhân vật gần như chỉ có một chuyển động (cảnh 1: clip *Sitting* + motion *idle* suốt 10 giây);
- bối cảnh trống (sàn lưới, một cây, bầu trời);
- không có thoại, nhạc hay tiếng động;
- hiệu ứng rất ít.

## 1. Chẩn đoán: lỗi nằm ở năng lực, không chỉ ở prompt

Đọc mã nguồn cho thấy phần lớn những thứ người dùng muốn **không thể mô tả được** trong `SceneSpec`. Dù model AI giỏi đến đâu cũng không viết ra được.

| Triệu chứng | Nguyên nhân trong mã | Hệ quả |
| --- | --- | --- |
| Nhân vật đứng yên một chỗ, một động tác | `ActorNode` chỉ có **một** `activeClip` / `activeAnimation` cho cả cảnh. Không có quỹ đạo vị trí hay hướng nhìn theo thời gian, không có chuỗi động tác (đi → dừng → vẫy tay). `timelineTracks` chỉ là nhãn hiển thị. | AI không thể viết "robot đi tới gốc cây rồi ngồi xuống". |
| Một góc máy cho cả cảnh | `CameraRig` có một `mode` (orbit, dolly…) và keyframes, nhưng không có **nhiều shot / cắt cảnh** trong một scene. | Mỗi cảnh trông như một clip xoay quanh nhân vật. |
| Không có thoại | Có `captions` (phụ đề) nhưng không có giọng đọc, không gắn lời với nhân vật, không có cử động khi nói. | Phim câm. |
| Không có nhạc nền | `SceneAudioSpec` chỉ gồm tiếng động tổng hợp cho **sự kiện game** (collect, jump, win…). Không có nhạc nền, âm thanh môi trường (rừng, gió, suối) hay track âm thanh theo thời gian. | Phim media gần như im lặng. |
| Video xuất ra không có tiếng | `recordMultiSceneSequence` ghi **canvas** bằng MediaRecorder theo thời gian thực. Không có track âm thanh, và hình bị giật khi máy chậm. | Ngay cả khi có nhạc, file MP4 cũng không có. |
| Bối cảnh trống | `world` có sky, terrain, scatter (6 loại), mây, thời tiết nhưng luật storyboard không bắt buộc dùng. Thư viện có khoảng 10 model GLB, cây cối chỉ là "pine-trees". Không có ảnh nền 360° theo chủ đề. | AI chọn mặc định an toàn: sàn lưới. |
| Không ai chấm "độ hay" | Bộ kiểm tra (`sceneVerifier`) chỉ kiểm **chơi được / hợp lệ**: nhảy tới được, đủ điểm… Không kiểm nhịp phim, chuyển động, âm thanh, độ đầy khung hình. | Vòng tự sửa (Phase 7C) không có tín hiệu nào để cải thiện chất lượng nghệ thuật. |
| Thiếu bước biên kịch | Storyboard gồm 2 bước: lập kế hoạch nhịp → dựng từng cảnh. Không có **kịch bản** (lời thoại, hành động từng giây) hay **shot list**. | Mỗi cảnh chỉ là "một tableau đẹp", không có diễn biến. |

**Kết luận:** cần nâng cấp theo 4 lớp, theo thứ tự: **hợp đồng** (SceneSpec mô tả được diễn xuất, shot, âm thanh) → **công cụ** (tạo giọng, nhạc, nền, động tác) → **skill** (ngữ pháp điện ảnh) → **giám khảo** (chấm chất lượng và quay lại vòng sửa). Chỉ thêm skill hay sửa prompt sẽ không đủ.

## 2. Thiết kế đề xuất

### 2.1 Mở rộng hợp đồng SceneSpec (nền móng, không tốn phí ngoài)

- **`actor.performance[]`**: chuỗi hành động theo thời gian. Ví dụ:
  - `{ t: 0, clip: "Sitting" }`
  - `{ t: 2, clip: "StandUp" }`
  - `{ t: 3, moveTo: [2,0,1], clip: "Walk", speed }`
  - `{ t: 6, lookAt: "actor-fox" }`
  - `{ t: 7, clip: "Wave" }`

  Runtime nội suy vị trí và hướng, crossfade giữa các clip (đã có `animationCrossFade`), bám mặt đất bằng `computeTerrainHeight`.
- **`camera.shots[]`**: nhiều shot trong một cảnh `{ start, end, type: wide|medium|close|over-shoulder|tracking, subject, move }`. Các loại shot là mẫu khai báo, máy tự tính vị trí. AI chọn "close-up robot lúc nói" thay vì tự viết toạ độ.
- **`dialogue[]`**: `{ speaker: actorId, text, start, voice, emotion }`. Mỗi câu sinh ra giọng nói, phụ đề và cử động khi nói (gật đầu, nhún nhẹ; nhép môi khi model có blendshape).
- **`soundtrack`**: `{ music: { assetId | generated, mood, volume, ducking }, ambience: [...], sfx: [{ t, preset }] }`. Có hai cách tạo âm thanh:
  - **Tự tạo không cần mạng:** nhạc nền và âm thanh môi trường do OmniStage tự sinh. Cách này mở rộng `sfxRuntime`, nên chạy được cả trong file playable xuất ra.
  - **Dùng file có sẵn:** lấy từ thư viện hoặc extension.
- **`transition`** giữa các cảnh: cut, fade, crossfade, wipe. Preview và bản xuất video dùng chung.

Mỗi mục: kiểu trong `scene.schema.ts` → builder dùng chung (`src/render3d`, `src/runtime`) → prompt → luật kiểm tra (theo quy ước trong CLAUDE.md).

### 2.2 "Production Tools": công cụ agent gọi được, chọn nhà cung cấp như AI provider

Từ Phase 7C, agent đã chạy **vòng tool-use**. Bước tiếp theo là cho nó gọi các công cụ sản xuất. Mỗi công cụ có **bản miễn phí, chạy offline** làm mặc định, và **bản trả phí** cắm vào bằng khoá API trong Settings hoặc qua Extension.

| Công cụ | Mặc định (miễn phí, chạy trên máy) | Nâng cấp (khoá API của người dùng) |
| --- | --- | --- |
| **Giọng đọc / thoại** | Piper TTS chạy trong trình duyệt (ONNX Runtime Web). Có giọng tiếng Việt (VAIS-1000), đã có dự án mẫu NGHI-TTS. | ElevenLabs, Gemini TTS, OpenAI TTS: nhiều giọng, cảm xúc tốt hơn. |
| **Nhạc nền** | Bộ sinh nhạc theo mood (vòng hợp âm, nhịp, nhạc cụ tổng hợp), xuất kèm playable. Thêm thư viện nhạc CC0. | Eleven Music API. Lưu ý: gói tự phục vụ **không** cho dùng trong phim/TV/game studio; phải đọc điều khoản trước. |
| **Tiếng động / môi trường** | Mở rộng bộ preset tổng hợp: gió, rừng, suối, bước chân, máy móc. | ElevenLabs Sound Effects (text → SFX), thương mại được ở gói trả phí. |
| **Bối cảnh / nền 360°** | HDRI Poly Haven (đã có proxy). Thêm bộ "biome" có sẵn (rừng, suối, đồi, đêm) ghép terrain, scatter, sky, mây, thời tiết. | Blockade Labs Skybox AI (text → nền 360° equirectangular 8K) dùng làm `world.hdri`. |
| **Động tác nhân vật** | Thư viện Quaternius Universal Animation Library (120+ clip, **CC0**, glTF) retarget sang nhân vật có rig, kết hợp đi bộ theo quỹ đạo. | Meshy rig + animation (đã có Meshy trong thư viện tài nguyên), OmniRig (Phase 9). |
| **Model 3D** | Thư viện sẵn có, Poly Pizza, Sketchfab. | Meshy text/image → 3D (đã có). |
| **Xuất video** | Render **từng khung hình một** qua Player `step()` (đã có từ 7C), mã hoá bằng **WebCodecs + Mediabunny** thành MP4. Kèm track âm thanh đã trộn (thoại, nhạc, SFX), mượt kể cả máy yếu, 1080p 30/60 fps. | (không cần) |

Các nhà cung cấp trả phí đi qua máy chủ local giống AI provider: khoá gửi trong header, không ghi log, không lưu vào SceneSpec. File sinh ra được lưu vào thư viện dự án để chạy offline và xuất bản lại.

### 2.3 Skills cho đạo diễn (prompt, không phải mã)

Bổ sung Director Skills, chọn tự động theo yêu cầu:

- **Biên kịch ngắn:** 3 hồi cho phim 30–60 giây; mỗi cảnh có mục tiêu, trở ngại và cảm xúc; thoại ≤ 12 từ mỗi câu.
- **Ngữ pháp máy quay:** wide mở cảnh → medium → close-up lúc cảm xúc; quy tắc 180°; mỗi 2–4 giây một shot.
- **Diễn xuất nhân vật:** luôn có hành động mở, giữa và kết; nhìn theo đối tượng; phản ứng khi bạn diễn nói.
- **Âm thanh:** nhạc theo mood từng hồi, giảm nhạc khi có thoại (ducking), có âm thanh môi trường theo biome.
- **Bối cảnh:** lấp đầy khung hình bằng ba lớp gần, giữa, xa; ánh sáng theo giờ trong ngày.

### 2.4 Giám khảo chất lượng: nối vào vòng sửa có sẵn

1. **Luật kiểm tra media, chạy nhanh và cố định** (`sceneVerifier`, mức *warning* cho chế độ media):
   - nhân vật chính có ít nhất 2 hành động;
   - cảnh trên 6 giây phải có ít nhất 2 shot;
   - có nhạc hoặc âm thanh môi trường;
   - nền không trống (terrain + scatter hoặc HDRI);
   - thoại nằm trong thời lượng cảnh;
   - bước chuyển giữa các cảnh được khai báo.

   Vòng patch của 7C tự gửi các cảnh báo này lại cho AI sửa.
2. **Giám khảo bằng hình ảnh (tuỳ chọn):** render 3–4 khung hình quan trọng qua Player, gửi cho model có vision chấm theo thang điểm (bố cục, độ đầy khung hình, cảm xúc, liền mạch giữa các cảnh). Điểm thấp → một vòng patch nữa. Tận dụng Vision QA đã có.

## 3. Lộ trình đề xuất (Phase 10: Media Production), theo tác động trên công sức

| Đợt | Nội dung | Kết quả người dùng thấy | Chi phí ngoài |
| --- | --- | --- | --- |
| **10A** | `performance[]`, `camera.shots[]`, `transition` trong hợp đồng + runtime + Player. Bước "biên kịch" trong storyboard (kịch bản, hành động, shot list). Skill máy quay và diễn xuất. Luật kiểm tra media. | Nhân vật đi, ngồi, đứng dậy, nhìn nhau; có cắt cảnh và cận cảnh. | Không |
| **10B** | Xuất MP4 từng khung hình (WebCodecs + Mediabunny) **có âm thanh**. `soundtrack` tự sinh: nhạc theo mood, âm thanh môi trường theo biome, SFX theo thời gian. Bộ biome bối cảnh. | Video mượt, có nhạc và tiếng rừng; bối cảnh đầy đặn. | Không |
| **10C** | `dialogue[]` + Piper TTS trong trình duyệt (giọng Việt), phụ đề tự sinh, cử động khi nói. Thư viện động tác CC0 (Quaternius) retarget. | Nhân vật nói tiếng Việt, cử động tự nhiên. | Không (tải model giọng khoảng 60–75 MB một lần) |
| **10D** | Production Tools trả phí qua Settings / Extension: ElevenLabs (giọng, nhạc, SFX), Blockade Skybox, Meshy animation. Giám khảo bằng hình ảnh. | Chất lượng "studio" cho ai có khoá API. | Theo nhà cung cấp |

Ba đợt 10A–10C đã giải quyết gần hết các điểm người dùng nêu, **không cần dịch vụ trả phí**, và vẫn giữ nguyên tắc cốt lõi: mọi thứ khai báo trong SceneSpec, studio và file xuất bản chạy cùng một bộ máy.

## 4. Rủi ro và lưu ý

- **Giấy phép:**
  - Âm thanh và nhạc do AI tạo phải ghi nguồn và giấy phép vào thư viện dự án.
  - Eleven Music giới hạn phim/TV/game với gói thường.
  - Quaternius là CC0 nên an toàn.
- **Giọng tiếng Việt chạy local hiện chỉ có ít giọng** (Piper VAIS-1000). Chất lượng cảm xúc kém dịch vụ cloud, nên để lựa chọn cloud cho ai cần.
- **Trình duyệt:** WebCodecs chạy tốt trên Chrome/Edge; Safari cần đường dự phòng (giữ MediaRecorder).
- **Kích thước playable ad:** nhạc tự sinh không tốn dung lượng. File giọng đọc và nhạc sinh sẵn sẽ chiếm ngân sách, nên cần cảnh báo trong báo cáo dung lượng.

## Nguồn

- Piper TTS trong trình duyệt, giọng Việt: [NGHI-TTS](https://github.amrom.workers.dev/clackken-vni/nghitts), [voicechanger.live (VAIS-1000)](https://voicechanger.live/text-to-speech/vietnamese), [so sánh Kokoro/Piper](https://offlinetts.pages.dev/blog/browser-tts-showdown-kokoro-piper-kitten/)
- Xuất video: [Mediabunny](https://mediabunny.dev/guide/quick-start), [Remotion về Mediabunny](https://www.remotion.dev/blog/mediabunny)
- Âm nhạc / SFX: [Eleven Music API](https://elevenlabs.io/blog/eleven-music-now-available-in-the-api), [so sánh API nhạc AI và điều khoản thương mại](https://blog.segmind.com/ai-music-api-lyria-3-pro-vs-elevenlabs-music-vs-sonilo-and-which-are-safe-for-commercial-use/)
- Động tác: [Quaternius Universal Animation Library (CC0)](https://quaternius.com/packs/universalanimationlibrary.html)
- Nền 360°: [Skybox AI Quick Start](https://support.blockadelabs.com/hc/en-us/articles/30934112955026-Skybox-AI-Quick-Start-Introduction-To-Building-Application-With-Skybox-AI)
