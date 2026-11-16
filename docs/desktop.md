# OmniStage AI Desktop (Electron)

Ứng dụng desktop cho người không biết lập trình: cài đặt như phần mềm bình thường, mở lên là có studio — không cần
terminal, Node.js hay `npm run dev`. Bên trong là đúng server OmniStage (API, workspace, CLI providers, Play on phone)
chạy trên `127.0.0.1`, và một cửa sổ Electron hiển thị studio.

## Cách hoạt động

| Thành phần | File | Ghi chú |
| --- | --- | --- |
| Studio (giao diện) | `dist/` từ `npm run build` | Đóng gói vào `resources/studio` |
| Server | `dist-server/server.mjs` từ `npm run build:server` | `server.ts` + `server/*` + thư viện npm gom thành 1 file ESM bằng esbuild (không cần `node_modules`, không cần `tsx`). Đóng gói vào `resources/server` |
| Main process | `desktop/main.cjs` | Chạy server trong Electron `utilityProcess`, chờ `/api/health`, mở cửa sổ |
| PATH cho AI CLI | `desktop/cliPath.cjs` | Bổ sung thư mục cài CLI vào PATH của server |
| Cài đặt | `desktop/settings.cjs` | `%APPDATA%/OmniStage AI/settings.json` (macOS: `~/Library/Application Support/OmniStage AI`) |

Khởi động:

1. Đọc `settings.json` (thư mục workspace, cổng, LAN).
2. Chọn cổng: cổng đã lưu (mặc định `39217`) nếu còn trống, nếu không thì một cổng ngẫu nhiên và lưu lại. Cổng cố định
   giữ nguyên origin `http://127.0.0.1:<port>` nên các cài đặt studio lưu trong trình duyệt (khóa API, tuỳ chọn) không mất giữa các lần mở.
3. Chạy `server.mjs --prod` với `NODE_ENV=production`, `PORT`, `HOST=127.0.0.1` (hoặc `0.0.0.0` khi bật LAN),
   `OMNISTAGE_HOME=<workspace>`, `OMNISTAGE_DIST_DIR=<studio>`. Log: `%APPDATA%/OmniStage AI/logs/server.log`.
4. Chờ `GET /api/health` trả `{status:"ok"}` (tối đa 30 giây), rồi mở cửa sổ.
5. Thoát: app gửi `omnistage:shutdown` qua `parentPort`, server `close()` rồi thoát; quá 3 giây thì bị kill.

`npm run dev` / `npm start` không thay đổi (vẫn `tsx server.ts`). `server.ts` chỉ thêm các biến môi trường tuỳ chọn
`HOST` và `OMNISTAGE_DIST_DIR`, và xử lý tắt êm (SIGTERM/SIGINT/parentPort).

### Workspace

Mặc định `Documents/OmniStage` (dự án, thư viện, extension, memory, drafts). Đổi bằng **File → Change Workspace Folder…**
(server tự khởi động lại). **File → Open Workspace Folder** mở thư mục trong Explorer/Finder. Muốn đặt khóa API phía
server: tạo file `.env` trong thư mục workspace (server chạy với cwd = workspace).

### AI CLI (Claude Code, Codex, Antigravity, OpenCode)

Ứng dụng mở từ Start menu / Dock không thừa hưởng PATH của shell, nên CLI cài bằng `npm i -g` hay Homebrew có thể bị
coi là "chưa cài". App thêm vào PATH của server các thư mục tồn tại trong số:

- Windows: `%APPDATA%\npm`, `%USERPROFILE%\.local\bin` (Claude native installer), `%LOCALAPPDATA%\agy\bin`
  (Antigravity), `%LOCALAPPDATA%\pnpm`, `~\.bun\bin`, `~\scoop\shims`, Volta, `NVM_SYMLINK`, `Program Files\nodejs`.
- macOS / Linux: PATH của login shell (`$SHELL -ilc`), `~/.local/bin`, `~/.claude/local`, `~/.npm-global/bin`, `~/.bun/bin`,
  `~/.volta/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, …

**Help → Diagnostics** hiển thị CLI nào tìm thấy (lấy từ `/api/ai/providers`, giống trang Settings), các thư mục đã thêm
vào PATH, cổng, workspace và đường dẫn log. Mỗi CLI vẫn phải đăng nhập một lần trong terminal (`claude`, `codex login`, …).

### Bảo mật cửa sổ

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, không có preload, không `<webview>`.
- Điều hướng bị khoá vào origin local; link ngoài (`http/https/mailto`) mở bằng trình duyệt hệ thống, các scheme khác bị chặn.
- Quyền (camera/mic, clipboard, fullscreen, pointer lock, notifications) chỉ cấp cho origin local; mọi quyền khác bị từ chối.
- Server chỉ nghe `127.0.0.1`. **File → Allow Play on Phone (LAN access)** chuyển sang `0.0.0.0` để điện thoại cùng Wi-Fi
  mở `/play/:token`; các route workspace/CLI vẫn chỉ nhận request từ localhost.
- Single-instance: mở app lần hai chỉ focus cửa sổ đang có.

## Chạy thử (dev)

```bash
npm run desktop:install   # 1 lần: cài electron + electron-builder vào desktop/node_modules (không đụng node_modules gốc)
npm run desktop:dev       # build studio + server bundle, mở app Electron
```

`desktop:install` chạy thêm `node desktop/node_modules/electron/install.js` vì npm 11 có thể chặn script tải binary
Electron. `npm start --prefix desktop` cũng tự gọi script này (không làm gì nếu đã có binary).

## Đóng gói bộ cài

```bash
npm run desktop:dist
```

= `npm run build` + `npm run build:server` + `electron-builder` (cấu hình `desktop/electron-builder.yml`). Kết quả trong
`desktop/release/`:

| Hệ điều hành | Đầu ra | Build trên |
| --- | --- | --- |
| Windows | `OmniStage-AI-Setup-<version>.exe` (NSIS, chọn thư mục cài, shortcut Desktop/Start) + `OmniStage-AI-Portable-<version>.exe` | Windows (hoặc Linux có Wine) |
| macOS | `OmniStage-AI-<version>-mac.dmg` (universal: Intel + Apple Silicon) | chỉ macOS |
| Linux | `OmniStage-AI-<version>-x86_64.AppImage` | Linux |

Chỉ build một nền tảng: `npx --prefix desktop electron-builder --config electron-builder.yml --win` (trong thư mục
`desktop/`; `--mac`, `--linux` tương tự). `npm run dist:dir --prefix desktop` tạo thư mục app chưa nén để kiểm tra nhanh.

Icon: `desktop/build/icon.png` (1024×1024) được vẽ bằng `npm run icon --prefix desktop` (`desktop/scripts/make-icon.mjs`);
electron-builder tự chuyển sang `.ico` / `.icns`.

### Ký số (tuỳ chọn)

Không bao giờ để chứng chỉ hay mật khẩu trong repo. electron-builder đọc từ biến môi trường:

| Biến | Dùng cho |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Chứng chỉ `.pfx` (Windows) / `.p12` Developer ID (macOS): đường dẫn, URL hoặc base64 |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Chứng chỉ riêng cho Windows khi build cả hai nền tảng trên một máy |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarize macOS bằng Apple ID |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Notarize macOS bằng App Store Connect API key |
| `CSC_IDENTITY_AUTO_DISCOVERY=false` | Tắt tự tìm chứng chỉ trong keychain (build không ký) |

Không có các biến này thì bộ cài không được ký: Windows SmartScreen sẽ cảnh báo ("More info → Run anyway"), macOS cần
chuột phải → Open lần đầu.

## Gỡ lỗi

- App báo "The studio is not built yet": chạy `npm run build && npm run build:server` rồi mở lại.
- Server không lên trong 30 giây: xem **Help → Open Server Log**.
- CLI hiện "missing" dù đã cài: **Help → Diagnostics** để xem PATH đã thêm; cài CLI vào một trong các thư mục trên hoặc
  thêm thư mục đó vào PATH hệ thống rồi mở lại app.
