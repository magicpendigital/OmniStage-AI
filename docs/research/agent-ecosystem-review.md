# Rà soát kỹ thuật coding agent & kho skill cho OmniStage (2026-11-10)

Mục tiêu: lọc ra những gì giúp OmniStage trở thành **coding agent mạnh về Game & Media**, và quyết định với từng ý tưởng: **lấy luôn** (dùng nguyên trạng / cài vào môi trường dev) hay **khai thác ý tưởng và tự code** trong OmniStage.

> Giới hạn: đánh giá dựa trên mô tả trong bảng tổng hợp và danh sách repo được cung cấp. Chưa mở từng repo để kiểm tra mã nguồn, license hay số sao. Trước khi vendor bất kỳ thứ gì vào repo phải kiểm tra license.

## 1. Ràng buộc quyết định của OmniStage

Các ràng buộc này giải thích vì sao phần lớn repo chỉ nên lấy ý tưởng:

1. **Runtime là trình duyệt, khai báo thuần**: mọi thứ đi qua `SceneSpec`; không `eval` code sinh ra lúc chạy.
2. **Playable ad một file, chạy offline**: thường dưới vài MB, không gọi mạng; TikTok, Meta và Telegram cấm `window.open`/`alert`.
3. **Không phụ thuộc nhà cung cấp**: Gemini là mặc định, có OpenAI/Anthropic qua Settings; chế độ offline (heuristic) phải luôn hoạt động.
4. **Đa agent (MCA)**: Claude Code, Codex, Antigravity và AI Studio cùng sửa một repo, nên quy tắc phải nằm trong file, không nằm trong đầu ai.

Hầu hết các repo trong danh sách thuộc một trong ba loại, và đều va chạm với các ràng buộc trên:

- **Skill cho coding agent**: file markdown hướng dẫn Claude Code. Hữu ích cho *người phát triển* OmniStage, nhưng không phải tính năng *trong sản phẩm*.
- **MCP tới ứng dụng desktop**: Blender, Unity, ComfyUI. Cần cài app hoặc GPU server, nên không chạy được trong trình duyệt hay playable ad.
- **Pipeline nặng hoặc API trả phí**: Remotion render server, headless Chrome, ElevenLabs, Suno, Seedance. Vi phạm ràng buộc offline và không phụ thuộc nhà cung cấp.

## 2. Kỹ thuật thực chiến

| Kỹ thuật | Giá trị cho OmniStage | Quyết định | Trạng thái |
| --- | --- | --- | --- |
| Pointer Index: `CLAUDE.md` ngắn + `.claude/rules/*.md` theo đường dẫn | Repo 18k+ dòng, nhiều agent; giảm context và giữ luật cục bộ | **Lấy luôn** | Xong: `CLAUDE.md`, 4 rule theo phạm vi |
| `.claudeignore` | Giảm nhiễu | **Thay thế**: chưa xác nhận được đây là tính năng chính thức của Claude Code. Dùng `.gitignore` và ghi rõ trong `CLAUDE.md` các thư mục sinh tự động; nếu cần chặn cứng thì dùng `permissions.deny` trong settings | Ghi trong `CLAUDE.md` |
| `/compact` sớm, `/rewind` khi lệch hướng | Thói quen thao tác | Áp dụng khi làm việc, không cần code | — |
| Prompt "What & Why" thay vì "How" | Áp dụng cho AI director trong sản phẩm | **Tự code**: Director Skills mô tả mục tiêu và ràng buộc (ví dụ "step-up ≤ 125px, CTA dạng động từ") thay vì liệt kê từng bước | Xong |
| Verification loop (chạy test/typecheck đến khi exit 0) | Hai tầng: dev và sản phẩm | **Lấy luôn** cho dev (`npm run verify`); **tự code** cho sản phẩm: `sceneVerifier` tất định + một vòng AI sửa lỗi | Xong |
| Headless CI `claude -p` | Review diff, quét code cũ | **Lấy luôn** khi có CI; cần secrets nên để Phase 5 | Phase 5 |
| Subagent `.claude/agents/` | Review độc lập (dual-harness) | **Lấy luôn** | Xong: `scene-contract-reviewer` |
| Hermes: skill tự tích lũy | Đạo diễn AI "học" từ kết quả được duyệt | **Tự code trong sản phẩm**: "Save as skill" chưng cất công thức SceneSpec thành skill (tất định, không gọi model) | Xong |
| Chạy cô lập (worktree/container) | Đang dùng worktree | Giữ nguyên | — |
| Codex batch jobs qua `AGENTS.md` | Refactor hàng loạt | Đã có `AGENTS.md`; bổ sung module Phase 4 | Xong |
| Agentic TDD (red → green) | Logic gameplay dễ hồi quy | Áp dụng: luật verifier và runtime mới đều có test `node:test` (28 test) | Xong |
| Dọn nợ kỹ thuật ban đêm (cron headless) | Nợ cảnh báo bundle, typing | Tùy chọn, cần routine/CI | Phase 5 |

## 3. Kho skill và repo

### 3.1 Khai thác ý tưởng và tự code (tính năng sản phẩm)

| Nguồn | Ý tưởng lấy | Cách OmniStage tự làm | Giai đoạn |
| --- | --- | --- | --- |
| DirectorSKILL, drama-skills, Seedance storyboard | Kịch bản → shot list → keyframe | Skill `cinematic-shot-grammar` ánh xạ loại shot sang `CameraMode`, nhãn và ease cho keyframe; storyboard pipeline có sẵn | **Phase 4 (xong)**; giao diện shot list: Phase 5 |
| Hermes skills | Skill tự tích lũy | Learned Director Skills (localStorage, xếp hạng theo số lần dùng) | **Phase 4 (xong)** |
| gamedev skills | Luật thiết kế game | Skill `platformer-level-design`, `game-juice`, `playable-ad-hook` | **Phase 4 (xong)** |
| elevenlabs skills, ai music skills | SFX/nhạc cho game | **Synth thủ tục WebAudio kiểu sfxr**: 10 preset, không file âm thanh, chạy offline trong playable ad. Adapter ElevenLabs (tự mang key, qua server proxy, nhúng base64 có ngân sách dung lượng) để sau | **Phase 4 (xong)**; adapter: Phase 5 |
| gsap skills | Easing và timeline | Thư viện easing tên kiểu GSAP (9 đường cong), không phụ thuộc GSAP; dùng cho keyframe 2D, camera 3D và exporter | **Phase 4 (xong)**; stagger/timeline label: Phase 5 |
| hyperframes, remotion, OpenMontage | Render video tất định từ code | Render theo từng khung với bước thời gian cố định (WebCodecs) thay cho MediaRecorder thời gian thực; thêm track phụ đề | Phase 5 |
| pixelfx | Thư viện hiệu ứng pixel | Bộ preset VFX 2D thủ tục cho Canvas2D (khai báo trong `SceneSpec`) | Phase 5 |
| sprite-gen | Sprite atlas và animation | `Node2D` hỗ trợ spritesheet (frame grid, fps, clip) | Phase 5 |
| shader-skills, webgpu skill | GLSL/TSL, nước, mây, SDF | Preset hậu kỳ (post-FX) và splatmap terrain; khớp mục Codex cũ | Phase 5 |
| blender-mcp, unity-mcp | Agent điều khiển công cụ 3D qua MCP | **Đảo chiều**: OmniStage cung cấp MCP server (`get_scene`, `apply_patch`, `verify`, `export`) để Claude Code/Codex dựng cảnh không cần UI | Phase 5 (ưu tiên cao cho MCA) |
| claude-animated-shorts | Nhân vật 2D trong thế giới 3D | Actor billboard 2.5D trong engine 3D | Phase 5 |

### 3.2 Lấy luôn (công cụ cho nhóm dev, không đưa vào sản phẩm)

Cài vào `.claude/skills/` của máy dev sau khi kiểm tra license, để coding agent viết code OmniStage tốt hơn:

- **shader-skills**, **webgpu skill**: khi làm Phase 5 post-FX/splatmap.
- **gsap skills**, **remotion skills**: làm tài liệu tham chiếu ngữ nghĩa easing/timeline và render tất định; không thêm thư viện vào bundle.
- **anthropic skills** (`frontend-design`) và **impeccable**: rà giao diện workstation.

### 3.3 Bỏ qua (lệch định hướng hoặc rủi ro)

- **universal-modder**: mod game PC, ngoài phạm vi và có rủi ro pháp lý.
- **herk edit kit**, **video-shotcraft**, **anything2explainer**: dựng video quay thật hoặc explainer có lời đọc; không khớp engine scene.
- **oil-motion**: animation theo scroll cho website.
- **anatomy**, **open-design**, **hallmark**: công cụ thiết kế chung.
- **comfyui-mcp**, **Suno pipeline**, **Seedance**: cần GPU hoặc API trả phí; chỉ cân nhắc như pipeline ngoài, tùy chọn.

## 4. Kết luận

- **Phương pháp làm việc** (pointer index, verification loop, subagent review, worktree): lấy luôn, chi phí thấp, đã áp dụng.
- **Tính năng sản phẩm**: tự code toàn bộ. Lý do: ràng buộc offline, một file, không `eval`, không phụ thuộc nhà cung cấp. Phần giá trị nhất của các repo là *tri thức chuyên môn* (shot grammar, level design, game juice, easing, sfxr), và tri thức đó đã được chuyển thành skill và luật verifier chạy được trong `SceneSpec`.
- **Bước chiến lược tiếp theo**: OmniStage MCP server. Nó biến OmniStage thành công cụ mà chính các coding agent dùng được, đúng với định hướng MCA.
