# OmniStage: game đa nền tảng (iOS/Android) và auto-rig nhân vật 3D (2026-11-10)

Hai câu hỏi cần trả lời:
1. Ở Game Mode, nếu tầm nhìn là làm game đa nền tảng có cả iOS và Android, năng lực hiện tại của OmniStage có đáp ứng được không? Hướng phát triển có đang lệch không?
2. Khi import model 3D (nhiều model do AI tạo), engine có thể tự nhận diện, gắn xương (rig) và tạo chuyển động chính xác bằng code không? LLM nên làm phần nào?

Nguồn tham khảo được liệt kê ở cuối. Những thông tin đến từ blog của nhà cung cấp hoặc chưa đối chiếu được với tài liệu chính thức đều được ghi chú rõ.

---

## Phần 1. iOS và Android

### 1.1 Kết luận ngắn

**Hướng đi không lệch, nhưng còn một khoảng trống lớn chưa được lên kế hoạch.** Nền TypeScript + `SceneSpec` + runtime web chính là con đường hợp lý nhất để lên iOS và Android: bọc runtime web vào app native (Capacitor). Đây cũng là cách cộng đồng Phaser vẫn dùng để đưa game HTML5 lên store. Playable ads của OmniStage vốn đã chạy trên điện thoại, bên trong app TikTok và Meta (MRAID, cảm ứng, `viewport-fit=cover`).

Điều đang thiếu không nằm ở ngôn ngữ hay engine, mà ở **ba thứ chưa từng có trong roadmap**:

1. **Chơi thử trên điện thoại thật.** Hiện chỉ chơi thử được trong viewport trên desktop, và studio chưa nhận thao tác cảm ứng.
2. **Xuất project native**: Android (AAB/APK) và iOS (Xcode project/IPA), kèm ký số và phát hành.
3. **Runtime đạt chuẩn app mobile**: safe-area, xoay màn hình, pause/resume, lưu tiến độ, ngân sách hiệu năng theo máy, và các tính năng native (haptics, Game Center / Play Games, mua trong app, quảng cáo, chạy offline). Các tính năng native này cũng là điều kiện để không bị Apple từ chối theo guideline 4.2.

### 1.2 Năng lực hiện tại theo từng kênh

| Kênh | Hiện trạng | Ghi chú |
| --- | --- | --- |
| Web desktop / itch.io | Có | ZIP + HTML offline |
| Playable ads (chạy trong app mobile) | Có | MRAID cho TikTok, Meta; nút cảm ứng (dpad, nhảy); có báo cáo dung lượng |
| Telegram Mini App | Có | |
| Web trên trình duyệt điện thoại | Một phần | File export chạy được; chưa có PWA (manifest, service worker, cài lên màn hình chính) |
| **Android app (AAB/APK)** | **Không** | |
| **iOS app (IPA / Xcode)** | **Không** | |
| **Chơi thử trên điện thoại** | **Không** | Chưa có QR / LAN preview; viewport studio chưa xử lý cảm ứng |
| Tính năng native (haptics, lưu game, IAP, ads SDK, leaderboard) | Không | Chỉ có haptics của Telegram trong file export |
| Độ trung thực 3D khi export | Thấp | Actor là khối bát diện giữ chỗ, chưa có GLB/world; đã nêu trong đánh giá nền tảng |

### 1.3 Các con đường lên iOS và Android

| Con đường | Ưu điểm | Nhược điểm | Đánh giá |
| --- | --- | --- | --- |
| **PWA** | Rẻ, không cần store, dùng đúng runtime web | Không lên App Store/Play; trên iOS bị giới hạn | Nên làm như **bước 1**: phục vụ chơi thử trên điện thoại và phân phối nhanh |
| **Capacitor (WebView + native shell)** | Một runtime cho mọi nền tảng; ra AAB/IPA; plugin native (haptics, Game Center/Play Games, IAP, AdMob, lưu file) | WebGL render hơi khác giữa WebKit (iOS) và Chromium (Android); vỏ native thêm khoảng 2–5 MB; build iOS cần Mac hoặc dịch vụ build cloud; app chỉ là "bọc web" dễ bị từ chối theo Apple 4.2 | **Khuyến nghị chính** cho game nhỏ và vừa, đúng với nhóm người dùng của OmniStage |
| **Xuất sang engine native** (ví dụ dịch `SceneSpec` sang project Godot) | Hiệu năng native, mở được console/Steam | Phải viết lại runtime trong engine khác; khối lượng lớn | Giai đoạn sau, dạng **plugin exporter**, cho game 3D nặng |
| Viết lại bằng Unity/Unreal hoặc React Native | | Phá vỡ lợi thế một ngôn ngữ, một contract | Không nên |

Các ràng buộc thực tế (2026), theo kết quả nghiên cứu:
- **Android**: từ 31/08/2026, app mới và bản cập nhật trên Google Play phải target **Android 16 (API 36)**. Project Capacitor OmniStage sinh ra phải đặt đúng giá trị này. Nguồn chủ yếu là blog bên thứ ba; trang chính thức của Google chỉ được xem qua đoạn trích.
- **iOS**: build và ký bắt buộc cần Xcode trên macOS, hoặc dịch vụ build cloud (Codemagic, Capawesome Cloud, Capgo Build). Một số nguồn nói Appflow ngừng nhận khách hàng mới, chưa xác minh với Ionic. Thông tin "bắt buộc Xcode 26 khi upload từ 04/2026" đến từ blog, chưa đối chiếu với Apple.
- **Apple guideline 4.2 (Minimum Functionality)**: app chỉ bọc web rất hay bị từ chối. Cách giảm rủi ro: chạy offline, có tính năng native (haptics, Game Center, push), trình bày như app thật. Các nguồn tìm được đều là bên thứ ba và diễn đàn; cần đọc bản guideline hiện hành của Apple trước khi nộp.
- **WebGPU**: đã bật mặc định trong Safari của iOS 26. Chưa xác minh được WKWebView (thứ Capacitor dùng) có cùng mức hỗ trợ không, nên runtime mobile vẫn dùng **WebGL2 làm mặc định**, WebGPU là tuỳ chọn.
- **Thử trên máy thật là bắt buộc**: simulator không phản ánh đúng hiệu năng GPU.

### 1.4 Có lệch hướng không?

**Không lệch về nền tảng, nhưng lệch về thứ tự ưu tiên.** Các phase trước tập trung vào AI, playable ads và media, nên mobile chưa bao giờ là mục tiêu tường minh. Điều quan trọng: mọi con đường mobile đều **phụ thuộc vào một "OmniStage Player" runtime duy nhất** (đã đề xuất trong đánh giá nền tảng). Nếu không có nó, sẽ phải viết và kiểm tra lại game lần thứ ba cho mobile. Vì vậy thứ tự đúng là:

1. **Player runtime duy nhất**, có lớp input chung cho phím, chuột, cảm ứng và tay cầm.
2. **Chơi thử** trên desktop và **trên điện thoại** qua mạng LAN (quét QR) hoặc PWA.
3. **Export Android** trước (không cần Mac), sau đó **iOS** (Mac hoặc build cloud); plugin tính năng native; trợ lý phát hành store.

---

## Phần 2. Auto-rig và animation cho model 3D do AI tạo

### 2.1 Nhận định của anh/chị là đúng

LLM (kể cả LLM đọc được ảnh) rất hợp để **ra quyết định ngữ nghĩa dưới dạng JSON**: đây có phải hình người không, mặt nhìn hướng nào, đâu là đuôi hay cánh, nên dùng mẫu xương nào, nhân vật cần những trạng thái chuyển động nào (idle, chạy, nhảy, tấn công) và chuyển giữa chúng ra sao.

Còn **độ chính xác hình học phải do code tất định đảm nhiệm**: chuẩn hoá mesh, tìm khớp, đặt và định hướng xương, tính trọng số skin, retarget animation, IK và chuyển động thủ tục. Đây cũng chính là nguyên tắc OmniStage đang theo (LLM ra JSON → verifier/code đảm bảo đúng), áp dụng cho nhân vật.

### 2.2 Hiện trạng các công cụ (nghiên cứu)

| Nguồn | Năng lực | Giới hạn |
| --- | --- | --- |
| **Meshy Rigging + Animation API** | Rig nhân vật hình người, kèm sẵn đi/chạy; thư viện animation preset | Chỉ hình người; tối đa 300.000 mặt; model không có texture hoặc tay chân không rõ ràng sẽ thất bại |
| **Tripo API** | Rig mọi model (GLB/FBX/OBJ/STL, chuẩn `mixamo`), retarget 100+ preset | Phải theo đúng chuỗi generate → rig-check → rig → retarget; giới hạn số tác vụ song song chưa rõ |
| **UniRig** (VAST-AI, SIGGRAPH'25, mã nguồn mở) | Sinh khung xương cho nhiều loại model + dự đoán trọng số skin | Cần GPU CUDA ≥ 8 GB, chạy Python, không chạy trong trình duyệt |
| **Puppeteer, RigAnything, MagicArticulate** (2025) | Rig không cần mẫu cho nhiều loại; Puppeteer còn sinh animation | Chưa xác minh mã và weights đã công khai chưa; animation của Puppeteer không chạy realtime |
| **Pinocchio** (Baran & Popović 2007) | Khớp mẫu xương vào mesh + skin bằng "bone heat"; dưới 1 phút mỗi nhân vật | C++; chưa tìm thấy bản JS; dễ lỗi với mesh không kín |
| **MediaPipe Pose Landmarker** | 33 điểm khớp cơ thể từ ảnh, chạy được trong trình duyệt | Thiết kế cho ảnh người thật; với model hoạt hình hay chibi cần kiểm chứng; dữ liệu bị rung, cần làm mượt |
| **three.js `SkeletonUtils.retargetClip`** | Retarget clip giữa hai bộ xương | Cộng đồng báo nhiều lỗi (bóp méo skin, xương Mixamo ngược hướng); nên tự viết retargeter dựa trên rest-pose |

### 2.3 Thiết kế đề xuất: "OmniRig"

Chạy cục bộ là chính, nhà cung cấp cloud và ML là plugin tuỳ chọn:

```
Import GLB ─► 0. Chuẩn hoá ─► 1. Phân loại (LLM + hình học) ─► 2. Tìm khớp ─► 3. Khớp mẫu xương
          ─► 4. Trọng số skin ─► 5. Kiểm tra bằng tư thế thử ─► 6. Animation (retarget + thủ tục)
          ─► Lưu "Character" vào thư viện (GLB đã rig + rig.json + điểm chất lượng)
```

| Bước | Ai làm | Nội dung |
| --- | --- | --- |
| 0. Chuẩn hoá | Code | Gộp mesh, hàn đỉnh trùng, bỏ mặt hỏng, giảm mặt khi quá 300k, đưa về chiều cao 1, xác định trục đứng và hướng mặt (phân tích thành phần chính + mặt phẳng đối xứng), tạo bản voxel kín để tính trọng số |
| 1. Phân loại | **LLM đọc ảnh → JSON** + code kiểm chéo | Render 4–6 góc nhìn; LLM trả `{category: humanoid / quadruped / bird / serpent / prop, facing, parts:[...], confidence}`. Code kiểm bằng đối xứng và tỉ lệ; nếu mâu thuẫn thì hỏi người dùng |
| 2. Tìm khớp | Code (+ ML chạy trong trình duyệt) | Hình người: render ảnh chính diện → MediaPipe lấy điểm khớp 2D → chiếu ngược vào mesh (ray vào, ray ra, lấy điểm giữa làm tâm chi). Loài khác: LLM chấm điểm khớp trên ảnh render (JSON 2D) → code chiếu ngược; hoặc lấy trục giữa từ khối voxel (kiểu Pinocchio) |
| 3. Khớp mẫu xương | Code | Mẫu chuẩn: hình người tương thích **Mixamo/VRM**, bốn chân, chuỗi đuôi/cánh. Ràng buộc đối xứng và tỉ lệ xương; đặt trục xoay xương nhất quán, điều kiện để retarget chuẩn |
| 4. Trọng số skin | Code (TypeScript/WASM) | Bone heat (khuếch tán nhiệt Laplace) hoặc geodesic voxel binding trên bản voxel; tối đa 4 xương mỗi đỉnh; làm mượt, chuẩn hoá |
| 5. Kiểm tra | Code + **LLM đọc ảnh chấm điểm** | Ép các tư thế thử (giơ tay, ngồi xổm, bước dài); đo độ giãn, mất thể tích, tự xuyên. LLM xem ảnh render và chấm điểm. Tự sửa hoặc báo vùng lỗi |
| 6. Animation | **LLM → JSON trạng thái**; code sinh chuyển động | LLM chọn trạng thái và chuyển trạng thái (`idle → walk → run → jump`). Code: retarget clip từ thư viện (Mixamo-format, mocap có giấy phép phù hợp, preset của Meshy/Tripo), **chuyển động thủ tục** (bước chân theo chiều dài chân, IK đặt chân trên địa hình, nhìn theo mục tiêu, lò xo cho tóc/đuôi/áo kiểu VRM spring bone), trộn bằng `animationCrossFade` đã có |
| Chỉnh tay | Người dùng | Gizmo kéo khớp, tô trọng số đơn giản, nút "Rig lại" |
| Lựa chọn cloud / ML | Plugin (Extensions) | Meshy rig, Tripo rig + retarget (API key riêng); UniRig/Puppeteer qua "máy chủ ML cục bộ" khi có GPU |

### 2.4 Kỳ vọng độ chính xác

- **Hình người, model AI sạch, tư thế T/A**: tự động tốt, chỉ cần chỉnh nhỏ. Đây là trường hợp phổ biến nhất trong game.
- **Nhân vật cách điệu (chibi, đầu to), áo choàng hay váy dài, vũ khí dính liền tay, tay chân dính vào thân**: độ chính xác giảm; cần LLM giúp tách vùng và người dùng chỉnh.
- **Ngón tay và khuôn mặt**: khó nhất; giai đoạn đầu dùng bàn tay một khối và nét mặt bằng blendshape có sẵn hoặc texture.
- **Bốn chân, chim**: làm được với mẫu xương riêng; sinh vật nhiều chi hoặc dị dạng cần ML (UniRig/Puppeteer) hoặc chỉnh tay.
- **Không có hệ thống nào tự động 100%.** Một pipeline tốt đặt mục tiêu khoảng 80% tự động, phần còn lại có UI để sửa nhanh, và luôn có điểm chất lượng để người dùng biết khi nào cần xem lại.

### 2.5 Phụ thuộc kỹ thuật

- Player runtime duy nhất phải chạy được nhân vật đã rig cả trong file export, nếu không nhân vật chỉ sống trong studio.
- Thư viện cá nhân (đã có) lưu "Character" gồm GLB đã rig, `rig.json` và điểm chất lượng; khung extension (đã có) là nơi gắn Meshy, Tripo và ML cục bộ.
- Bone heat cần giải hệ tuyến tính thưa: viết bằng TypeScript cho model nhỏ, WASM (Rust) khi cần nhanh.

---

## Nguồn

- iOS/Android: [abratabia — Capacitor games](https://abratabia.com/native-wrappers/capacitor-games.php), [Phaser forum — Capacitor Android issues](https://phaser.discourse.group/t/phaser-3-capacitor-android-apk-white-screens-texture-rendering-failures-and-orientation-issues/15571), [capgo — web app on App Store](https://capgo.app/de/blog/how-to-put-a-web-app-on-the-app-store/), [fastplaygames — HTML5 vs mobile apps 2026](https://fastplaygames.com/blog/how-html5-games-compare-mobile-apps-2026), [Apple forums — 4.2 Minimum Functionality](https://developer.apple.com/forums/thread/704430), [abratabia — App Store submission](https://www.abratabia.com/native-wrappers/app-store-submission.php), [mobiloud — WebView wrapper guidelines](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper), [Google Play target API](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-419), [dev.to — API 36 deadline](https://dev.to/dainyjose/google-play-requires-android-16-api-level-36-by-august-31-2026-react-native-migration-guide-1d51), [Capawesome — iOS builds without a Mac](https://capawesome.io/blog/how-to-build-and-deploy-ios-apps-without-a-mac/), [capgo — CI/CD platforms for iOS](https://capgo.app/blog/comparing-ci-cd-platforms-for-ios-apps/), [web.dev — WebGPU in major browsers](https://web.dev/blog/webgpu-supported-major-browsers), [AppDeveloperMagazine — WebGPU in iOS 26](https://appdevelopermagazine.com/webgpu-in-ios-26/).
- Rigging: [Meshy Rigging & Animation API](https://docs.meshy.ai/api/rigging-and-animation), [fal.ai — Meshy multi-animation](https://fal.ai/models/fal-ai/meshy/rigging/multi-animation/api), [Tripo — rig](https://developers.tripo3d.com/en/models/rig), [Tripo — animation retargeting](https://developers.tripo3d.com/en/docs/animations-retarget), [UniRig (GitHub)](https://github.com/VAST-AI-Research/UniRig), [UniRig paper](https://arxiv.org/abs/2504.12451), [Puppeteer](https://arxiv.org/html/2508.10898v1), [RigAnything](https://arxiv.org/pdf/2502.09615v2), [Pinocchio paper](https://people.csail.mit.edu/ibaran/papers/2007-SIGGRAPH-Pinocchio.pdf), [Pinocchio code](https://www.github.com/pmolodo/Pinocchio), [MediaPipe Pose Landmarker](https://developers.google.cn/mediapipe/solutions/vision/pose_landmarker), [Kalidokit](https://cdn.jsdelivr.net/gh/yeemachine/kalidokit@main/README.md), [three.js SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html), [three.js forum — fixing retargetClip](https://discourse.threejs.org/t/fixing-skeletonutils-retarget-and-retargetclip-functions/65149), [retargeting-threejs](https://awesome.ecosyste.ms/projects/github.com%2Fupf-gti%2Fretargeting-threejs).
