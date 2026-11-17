# Truyện tranh và truyện tranh tương tác: có hợp với OmniStage không? (2026-11-17)

Câu hỏi: thêm một loại nội dung mới (truyện tranh, hoặc truyện tranh tương tác) có phù hợp định hướng và chiến lược của OmniStage không, khi cả media lẫn game đều cần một bước storyboard ban đầu?

**Kết luận ngắn:** *Chưa* thêm "truyện tranh" như một loại nội dung độc lập (một sản phẩm, một đường đi riêng). *Nên* làm ngay phần chung mà cả phim, game và truyện tranh đều dùng (storyboard đã duyệt: Story Bible + Writers' Room, đã có). Sau đó thêm **xuất truyện tranh như một định dạng đầu ra của storyboard đã có**, làm thử nhỏ và có điều kiện dừng. Truyện tranh tương tác chỉ làm khi bản tĩnh chứng minh có người dùng.

Phân tích dưới đây tách rõ phần suy ra từ mã nguồn (chắc chắn) với phần giả thuyết thị trường (**tôi không có số liệu**, cần kiểm chứng).

## 1. Điều đã đúng: bước storyboard là hạ tầng chung

Từ Phase 11 trở đi, đường đi là: yêu cầu → Writers' Room (kiến trúc sư, nhân vật, bối cảnh, thoại, tính liên tục, biên tập viên) → `StoryBible` đã duyệt → từng cảnh. Bible chứa chính các thứ truyện tranh cần: logline, nhịp từng cảnh (mục đích, xung đột, cảm xúc đầu và cuối, câu kéo sang cảnh sau), nhân vật có "look", bối cảnh từng cảnh, đạo cụ, lời thoại theo người nói.

Nghĩa là **phần khó nhất của truyện tranh (kịch bản có cấu trúc, nhân vật nhất quán) đã có**. Chi phí cho "một đầu ra nữa" thấp hơn nhiều so với "một sản phẩm nữa".

## 2. Lợi thế thật và hạn chế thật

**Lợi thế (suy ra từ cách OmniStage vận hành):**
- Truyện tranh sinh bằng model ảnh thường hỏng ở một điểm: nhân vật đổi mặt, đổi trang phục giữa các khung. OmniStage dựng từ **cùng một rig và cùng một model** (kể cả model Meshy đã sinh), nên nhân vật nhất quán *theo cấu trúc*, không phải nhờ may mắn. Đây là điểm khác biệt có cơ sở.
- Mỗi khung là một ảnh chụp từ cảnh khai báo (camera shot đã có trong `SceneSpec`), nên chỉnh góc máy, đổi bối cảnh hay đổi lời thoại không cần sinh lại cả trang.
- Cùng một nguồn cho nhiều định dạng: phim, playable ad, trang truyện tranh, trailer. Hợp với hướng "một SceneSpec, nhiều đầu ra".

**Hạn chế (cần làm thật, không miễn phí):**
- **Chưa có "nhìn như truyện tranh":** cần render nét viền / toon shading, nền phẳng, bảng màu. Hiện renderer hướng tới ảnh 3D thật. Đây là phần kỹ thuật lớn nhất.
- Chưa có bố cục trang (khung to nhỏ, đọc từ trái sang phải hoặc cuộn dọc kiểu webtoon), bong bóng thoại, chữ hiệu ứng, và cách cắt "khoảnh khắc đáng vẽ" (phim chạy theo thời gian, truyện tranh chọn *một khoảnh khắc* cho mỗi khung).
- Khung hình phim không tự thành khung truyện tranh: góc máy phim (đẩy máy, lia) cần được đổi thành góc tĩnh có sức kể.
- Chất lượng nét vẽ của 3D toon so với truyện vẽ tay hoặc ảnh sinh model: người đọc truyện tranh thường kén phong cách. **Chưa có bằng chứng** rằng đích đến (3D toon) được nhóm đọc chấp nhận.

## 3. Hợp với chiến lược đã chọn đến đâu

Chiến lược trong `docs/research/film-quality-and-commercialization.md`: động cơ doanh thu là nhóm studio game mobile / đội UA (playable ad, trailer từ một SceneSpec); phim hoạt hình là phễu lan truyền; rủi ro lớn nhất là **dàn trải** (mục F).

| Tiêu chí | Truyện tranh tĩnh | Truyện tranh tương tác |
| --- | --- | --- |
| Dùng lại hạ tầng đã làm | Cao (bible, rig, camera, thoại, xuất ảnh) | Cao (thêm Player, logic graph, rẽ nhánh) |
| Phục vụ nhóm 1 (UA, playable ad) | Thấp: ít ai mua "trang truyện" để chạy quảng cáo. Có thể dùng làm creative tĩnh hoặc storyboard gửi khách duyệt | **Có thể** (quảng cáo kể chuyện chọn nhánh) nhưng là giả thuyết |
| Phục vụ nhóm 2 (nhà sáng tạo, phễu) | Trung bình: truyện ngắn đăng mạng xã hội, nhưng cạnh tranh với công cụ miễn phí | Trung bình – cao nếu dễ chia sẻ |
| Phục vụ nhóm 3 (giáo dục) | Trung bình: truyện minh họa bài học | **Cao:** bài học dạng truyện có câu hỏi, xuất HTML5 là lợi thế riêng |
| Rủi ro dàn trải | Vừa nếu chỉ là định dạng xuất; cao nếu thành sản phẩm riêng | Cao: thêm mô hình tác giả, rẽ nhánh, kiểm thử đường đi |
| Giá trị cho "storyboard trước khi sản xuất" | **Cao ngay lập tức**, độc lập với việc bán truyện tranh | Như bên trái |

Điểm quan trọng nhất: **giá trị lớn và chắc chắn nhất của "truyện tranh" không phải là một mặt hàng mới, mà là một cách xem storyboard**. Người dùng duyệt kịch bản dễ hơn khi thấy các khung hình có chữ, thay vì đọc bảng chữ. Việc này giúp trực tiếp mục tiêu "đầu ra đúng ý" mà bạn đặt ra cho Writers' Room, và giúp cả game lẫn media.

## 4. Khuyến nghị theo giai đoạn (có điều kiện dừng)

**Giai đoạn 0 (làm cùng Writers' Room, ~1 tuần):** "Xem dạng storyboard". Với mỗi beat, chụp một khung từ cảnh (bằng camera shot đầu tiên), ghép thành lưới có chú thích (mục đích, thoại). Không cần toon shading, không bán. Giá trị: người dùng duyệt nhanh hơn. Đo: tỷ lệ người dùng sửa ở Writers' Room *sau khi* xem lưới so với trước.

**Giai đoạn 1 (thử nghiệm, ~2–3 tuần, chỉ làm nếu GĐ0 được dùng):** "Xuất trang truyện" từ chính storyboard: render toon (viền + màu phẳng), bố cục lưới/webtoon, bong bóng thoại, xuất PNG/PDF/chuỗi ảnh. Chưa tương tác.
- *Điều kiện dừng:* đưa 5–10 trang mẫu cho 10 người thuộc nhóm đích (người làm truyện ngắn, giáo viên). Nếu dưới 3 người nói họ sẽ dùng thật, dừng ở đây và giữ GĐ0 như tính năng duyệt.

**Giai đoạn 2 (chỉ khi GĐ1 qua cổng):** truyện tranh tương tác trên Player sẵn có: chạm để sang khung, lựa chọn rẽ nhánh dùng logic graph và rule của runtime hiện tại, xuất HTML5. Cần thêm: verifier cho đường đi (không có nhánh cụt, mọi nhánh tới được kết), và "SceneSpec cho truyện" (danh sách khung + nhánh) thay vì nhồi vào cảnh game.
- Thị trường đầu tiên nên thử: giáo dục (nhóm 3), vì xuất HTML5 tương tác là lợi thế riêng, hơn là cạnh tranh trực tiếp với ứng dụng đọc truyện.

**Không nên làm lúc này:** một "chế độ Truyện tranh" riêng trong studio với trình dựng trang, thư viện bong bóng, kho phong cách, cộng đồng đăng truyện. Đó là một sản phẩm khác, trong khi mục F của chiến lược cảnh báo đúng điều này.

## 5. Rủi ro và điều chưa biết

- **Không có số liệu thị trường** trong tài liệu này về quy mô, mức trả tiền hay thị hiếu của người đọc truyện tranh 3D toon tại Việt Nam / Đông Nam Á. Tôi cố tình không đưa số. Cần phỏng vấn trước khi đầu tư quá GĐ0.
- Rủi ro chất lượng: nếu nét 3D toon trông "rẻ", người đọc sẽ bỏ qua dù kịch bản tốt. GĐ1 phải thử với người đọc thật, không tự đánh giá.
- Bản quyền và nội dung: truyện tranh dùng nhân vật sinh bằng công cụ bên thứ ba (Meshy). Điều khoản giấy phép của tài khoản người dùng quyết định họ được bán gì; OmniStage ghi nguồn và giấy phép vào thư viện nhưng không bảo đảm quyền thương mại.
- Chi phí credit: mỗi nhân vật thật sinh qua Meshy tốn credit của người dùng, truyện nhiều nhân vật tốn nhiều. Luôn hiện ước lượng và hỏi xác nhận (đã làm trong luồng kết nối Meshy).
- Rủi ro dàn trải (mục F): mỗi giai đoạn trên có điều kiện dừng riêng để không biến thành một phase mở vô hạn.

## 6. Quyết định cần bạn xác nhận

1. Đồng ý làm **Giai đoạn 0 (xem storyboard dạng lưới khung)** ngay sau Writers' Room? Đây là phần chắc chắn có ích và rủi ro thấp.
2. Giai đoạn 1 chỉ mở sau khi có phản hồi của 10 người dùng thật, chứ không mở theo cảm hứng. Đồng ý với điều kiện dừng ở trên chứ?
3. Nhóm đích đầu tiên để thử truyện tương tác: giáo dục (khuyến nghị) hay nhà sáng tạo nội dung?
