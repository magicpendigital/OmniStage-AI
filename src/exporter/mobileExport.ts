/**
 * Phase 8 — Mobile native exports: installable PWA and a Capacitor project for Android (AAB / APK) and iOS.
 *
 * Pure helpers (no DOM): they take the Player HTML built by `buildStandalonePlayable` (with `app` / `pwa` options) and
 * icon PNG bytes, and return the files of a ZIP. Building the native binaries happens on the user's machine (Android
 * Studio / Gradle) or a Mac / cloud Mac (Codemagic) — OmniStage never signs or uploads anything.
 */
import type { SceneSpec } from '../types/scene.schema';
import type { ZipInput } from './playableBundle';
import { slugifyTitle } from './mediaExporter';

export type AppOrientation = 'portrait' | 'landscape' | 'any';

export interface AppIdentity {
  appName: string;
  /** Reverse-DNS id: Android applicationId and iOS bundle identifier. */
  appId: string;
  /** User-visible version (x.y.z). */
  version: string;
  /** Android versionCode / iOS build number; must grow with every upload. */
  versionCode: number;
  orientation: AppOrientation;
  themeColor: string;
  backgroundColor: string;
}

/** Native features an app build can use. Only `ready` ones are wired into the Player today. */
export interface NativeCapability {
  id: 'haptics' | 'saves' | 'pause' | 'ads' | 'iap' | 'push' | 'leaderboards';
  label: string;
  status: 'ready' | 'deferred';
  /** npm package added to the Capacitor project (ready capabilities only). */
  plugin?: string;
  note: string;
}

export const NATIVE_CAPABILITIES: NativeCapability[] = [
  { id: 'haptics', label: 'Haptics', status: 'ready', plugin: '@capacitor/haptics', note: 'Light tap on score, success / error buzz at the end of a round. navigator.vibrate in the PWA.' },
  { id: 'saves', label: 'Saved progress', status: 'ready', plugin: '@capacitor/preferences', note: 'Best score per level and the level to resume, stored on the device only. localStorage in the PWA.' },
  { id: 'pause', label: 'Pause in background', status: 'ready', plugin: '@capacitor/app', note: 'Stops frames and the soundtrack when the app goes to the background, resumes where it was.' },
  { id: 'ads', label: 'Ads (AdMob)', status: 'deferred', note: 'Needs an ad account, consent (UMP) flow and store disclosures; add a community AdMob plugin to the exported project yourself.' },
  { id: 'iap', label: 'In-app purchases', status: 'deferred', note: 'Needs store products and server receipt checks; not part of the SceneSpec yet.' },
  { id: 'push', label: 'Push notifications', status: 'deferred', note: 'Needs Firebase / APNs credentials and a sending server.' },
  { id: 'leaderboards', label: 'Leaderboards', status: 'deferred', note: 'No Game Center / Play Games plugin verified against Capacitor 8 yet.' },
];

/** Capacitor 8 packages (major pinned; npm picks the newest 8.x). Android target / compile SDK: 36. */
export const CAPACITOR_PACKAGES = {
  dependencies: {
    '@capacitor/android': '^8.0.0',
    '@capacitor/app': '^8.0.0',
    '@capacitor/core': '^8.0.0',
    '@capacitor/haptics': '^8.0.0',
    '@capacitor/ios': '^8.0.0',
    '@capacitor/preferences': '^8.0.0',
  },
  devDependencies: {
    '@capacitor/assets': '^3.0.5',
    '@capacitor/cli': '^8.0.0',
  },
};
export const ANDROID_TARGET_SDK = 36;

export function orientationForAspect(aspect: SceneSpec['aspectRatio']): AppOrientation {
  return aspect === '9:16' ? 'portrait' : aspect === '16:9' ? 'landscape' : 'any';
}

function storyName(scene: SceneSpec): string {
  return (scene.sequence?.storyboardTitle || scene.title || 'OmniStage Game').trim();
}

export function defaultAppIdentity(scene: SceneSpec): AppIdentity {
  const name = storyName(scene).slice(0, 30).trim() || 'OmniStage Game';
  const pkg = slugifyTitle(name, 'game').replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '') || 'game';
  const brand = scene.marketingOverlay?.brandColor;
  return {
    appName: name,
    appId: `com.mystudio.${pkg.slice(0, 40)}`,
    version: '1.0.0',
    versionCode: 1,
    orientation: orientationForAspect(scene.aspectRatio),
    themeColor: brand && /^#[0-9a-fA-F]{6}$/.test(brand) ? brand : '#05070d',
    backgroundColor: '#05070d',
  };
}

const JAVA_KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' ')
);

export interface IdentityIssue {
  field: keyof AppIdentity;
  severity: 'error' | 'warning';
  message: string;
}

export function validateAppIdentity(id: AppIdentity): IdentityIssue[] {
  const issues: IdentityIssue[] = [];
  const name = id.appName.trim();
  if (!name) issues.push({ field: 'appName', severity: 'error', message: 'App name is required.' });
  else if (name.length > 30) issues.push({ field: 'appName', severity: 'error', message: 'App name must be 30 characters or fewer (Play / App Store limit).' });
  if (/[<>"&\\]/.test(name)) issues.push({ field: 'appName', severity: 'error', message: 'App name cannot contain < > " & or backslashes.' });

  const segs = id.appId.split('.');
  if (id.appId.length > 150 || segs.length < 2 || !segs.every((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s))) {
    issues.push({ field: 'appId', severity: 'error', message: 'App id must be reverse-DNS, e.g. com.yourstudio.mygame (letters, digits, _; each part starts with a letter).' });
  } else if (segs.some((s) => JAVA_KEYWORDS.has(s))) {
    issues.push({ field: 'appId', severity: 'error', message: 'App id parts cannot be Java keywords (new, class, …); Android rejects them.' });
  } else if (/^(com\.example|com\.mystudio|io\.ionic\.starter)\./.test(id.appId)) {
    issues.push({ field: 'appId', severity: 'warning', message: 'Replace the placeholder with a domain you own; the id cannot change after the first store upload.' });
  }
  if (!/^\d+\.\d+\.\d+$/.test(id.version)) issues.push({ field: 'version', severity: 'error', message: 'Version must look like 1.0.0.' });
  if (!Number.isInteger(id.versionCode) || id.versionCode < 1 || id.versionCode > 2100000000) {
    issues.push({ field: 'versionCode', severity: 'error', message: 'Build number must be a whole number from 1 to 2100000000 and grow with every upload.' });
  }
  for (const f of ['themeColor', 'backgroundColor'] as const) {
    if (!/^#[0-9a-fA-F]{6}$/.test(id[f])) issues.push({ field: f, severity: 'error', message: 'Colours must be #RRGGBB.' });
  }
  return issues;
}

export function assertValidIdentity(id: AppIdentity) {
  const errors = validateAppIdentity(id).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join(' '));
}

/** App icon / splash PNGs (rendered in the browser by mobileAssets.ts). */
export interface AppIconSet {
  icon192: Uint8Array;
  icon512: Uint8Array;
  /** Full-bleed 512 icon with the art inside the 80 % safe zone (Android adaptive / maskable). */
  maskable512: Uint8Array;
  icon1024: Uint8Array;
  splash2732: Uint8Array;
}

/** Options the Player HTML of an app build needs (pass to buildStandalonePlayable). */
export function appPlayerOptions(id: AppIdentity, kind: 'pwa' | 'native', capabilities: NativeCapability['id'][] = ['haptics', 'saves', 'pause']) {
  return {
    app: { saveKey: id.appId, haptics: capabilities.includes('haptics'), saves: capabilities.includes('saves') },
    themeColor: id.themeColor,
    ...(kind === 'pwa' ? { pwa: { manifestHref: 'manifest.webmanifest', serviceWorkerHref: 'sw.js' } } : {}),
  };
}

// ---------------------------------------------------------------------------
// PWA
// ---------------------------------------------------------------------------

export function buildWebManifest(id: AppIdentity) {
  return {
    name: id.appName,
    short_name: id.appName.length <= 12 ? id.appName : id.appName.slice(0, 12).trim(),
    id: './',
    start_url: './',
    scope: './',
    display: 'fullscreen',
    orientation: id.orientation === 'any' ? 'any' : id.orientation,
    background_color: id.backgroundColor,
    theme_color: id.themeColor,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export const PWA_PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];

/** Cache-first service worker: the whole game is one HTML file, so precaching it makes the PWA fully offline. */
export function buildServiceWorker(id: AppIdentity): string {
  const cache = `omnistage-${id.appId}-${id.version}-${id.versionCode}`;
  return `// OmniStage PWA service worker (generated). Bump the version in OmniStage to ship an update.
const CACHE = ${JSON.stringify(cache)};
const PRECACHE = ${JSON.stringify(PWA_PRECACHE)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
`;
}

export function buildPwaFiles(html: string, id: AppIdentity, icons: AppIconSet): ZipInput[] {
  assertValidIdentity(id);
  if (!html.includes('manifest.webmanifest') || !html.includes('sw.js')) {
    throw new Error('PWA HTML must be built with appPlayerOptions(identity, "pwa") so it links the manifest and service worker');
  }
  const readme = `# ${id.appName} — installable web app (PWA)

Exported from OmniStage. Everything is in this folder and works offline after the first visit.

## Publish
1. Upload the folder (unzipped) to any HTTPS host: itch.io, GitHub Pages, Netlify, Cloudflare Pages, your own server.
   Service workers need HTTPS (or http://localhost); opening index.html from disk plays the game but cannot install it.
2. Open the URL on a phone: Android Chrome shows "Install app"; on iPhone use Share → Add to Home Screen.

## Update
Raise the version or build number in OmniStage and export again. The new service worker replaces the old cache
(${PWA_PRECACHE.length} files) on the next visit.

Saved progress (best scores, current level) lives in the browser's localStorage on the player's device.
`;
  return [
    { name: 'index.html', content: html },
    { name: 'manifest.webmanifest', content: JSON.stringify(buildWebManifest(id), null, 2) },
    { name: 'sw.js', content: buildServiceWorker(id) },
    { name: 'icons/icon-192.png', content: icons.icon192 },
    { name: 'icons/icon-512.png', content: icons.icon512 },
    { name: 'icons/maskable-512.png', content: icons.maskable512 },
    { name: 'README.md', content: readme },
  ];
}

// ---------------------------------------------------------------------------
// Capacitor project (Android + iOS)
// ---------------------------------------------------------------------------

/**
 * Node script shipped in the project: applies omnistage.app.json to the generated native projects after
 * `npx cap add android|ios` (target SDK 36, version, orientation, release signing from keystore.properties).
 * It reads only local files and never prints passwords.
 */
export const CONFIGURE_NATIVE_SCRIPT = `#!/usr/bin/env node
// Generated by OmniStage. Re-run after changing omnistage.app.json or re-adding a platform:  npm run configure
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = JSON.parse(readFileSync(join(root, 'omnistage.app.json'), 'utf8'));
const TARGET_SDK = ${ANDROID_TARGET_SDK};

function edit(rel, fn) {
  const file = join(root, rel);
  if (!existsSync(file)) { console.log('skip  ' + rel + ' (platform not added yet)'); return; }
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) { writeFileSync(file, after); console.log('updated ' + rel); }
  else console.log('ok    ' + rel);
}

// Android: SDK levels, version, orientation, release signing.
edit('android/variables.gradle', (s) => s
  .replace(/compileSdkVersion\\s*=\\s*\\d+/, 'compileSdkVersion = ' + TARGET_SDK)
  .replace(/targetSdkVersion\\s*=\\s*\\d+/, 'targetSdkVersion = ' + TARGET_SDK));

edit('android/app/build.gradle', (s) => {
  let out = s
    .replace(/versionCode\\s+\\d+/, 'versionCode ' + app.versionCode)
    .replace(/versionName\\s+"[^"]*"/, 'versionName "' + app.version + '"');
  if (!out.includes('omnistage-signing')) {
    out = out.replace(/^android\\s*\\{/m, [
      '// omnistage-signing: release signing from keystore.properties (never commit that file)',
      'def omniKeystoreFile = rootProject.file("../keystore.properties")',
      'def omniKeystore = new Properties()',
      'if (omniKeystoreFile.exists()) { omniKeystoreFile.withInputStream { omniKeystore.load(it) } }',
      '',
      'android {',
      '    signingConfigs {',
      '        release {',
      '            if (omniKeystoreFile.exists()) {',
      '                storeFile rootProject.file("../" + omniKeystore["storeFile"])',
      '                storePassword omniKeystore["storePassword"]',
      '                keyAlias omniKeystore["keyAlias"]',
      '                keyPassword omniKeystore["keyPassword"]',
      '            }',
      '        }',
      '    }',
    ].join('\\n'));
    out = out.replace(/(buildTypes\\s*\\{\\s*release\\s*\\{)/, '$1\\n            if (omniKeystoreFile.exists()) { signingConfig signingConfigs.release }');
  }
  return out;
});
if (existsSync(join(root, 'android/app/build.gradle.kts'))) console.log('note  build.gradle.kts found: set versionCode / signing in Android Studio');

const androidOrientation = app.orientation === 'portrait' ? 'portrait' : app.orientation === 'landscape' ? 'sensorLandscape' : 'unspecified';
edit('android/app/src/main/AndroidManifest.xml', (s) => s.replace(/<activity\\b[^>]*>/, (tag) => {
  const clean = tag.replace(/\\s+android:screenOrientation="[^"]*"/, '');
  return clean.replace(/<activity\\b/, '<activity android:screenOrientation="' + androidOrientation + '"');
}));

// iOS: orientation (Info.plist) and version / build number (Xcode project).
const iosOrientations = app.orientation === 'portrait'
  ? ['UIInterfaceOrientationPortrait']
  : app.orientation === 'landscape'
    ? ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']
    : ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
const plistArray = '<array>\\n' + iosOrientations.map((o) => '\\t\\t<string>' + o + '</string>').join('\\n') + '\\n\\t</array>';
edit('ios/App/App/Info.plist', (s) => s.replace(/(<key>UISupportedInterfaceOrientations(?:~ipad)?<\\/key>\\s*)<array>[\\s\\S]*?<\\/array>/g, (_m, key) => key + plistArray));
edit('ios/App/App.xcodeproj/project.pbxproj', (s) => s
  .replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + app.version + ';')
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, 'CURRENT_PROJECT_VERSION = ' + app.versionCode + ';'));

console.log('Done. Android target SDK ' + TARGET_SDK + ', version ' + app.version + ' (' + app.versionCode + '), orientation ' + app.orientation + '.');
`;

/** Runs a Gradle task with the right wrapper for the OS (gradlew.bat on Windows). */
export const GRADLE_SCRIPT = `#!/usr/bin/env node
// Generated by OmniStage:  node scripts/gradle.mjs bundleRelease
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const task = process.argv[2];
if (!/^[a-zA-Z:]+$/.test(task || '')) { console.error('usage: node scripts/gradle.mjs <task>'); process.exit(1); }
const dir = join(process.cwd(), 'android');
if (!existsSync(dir)) { console.error('Run "npx cap add android" first.'); process.exit(1); }
const win = process.platform === 'win32';
const r = spawnSync(win ? 'gradlew.bat' : './gradlew', [task], { cwd: dir, stdio: 'inherit', shell: win });
process.exit(r.status ?? 1);
`;

export function buildCodemagicYaml(id: AppIdentity): string {
  return `# Codemagic: build the iOS app on a cloud Mac and send it to TestFlight (no Mac needed).
# 1. Push this project to a Git repo and add it in codemagic.io.
# 2. Teams → Integrations → App Store Connect: add an API key and put its name below.
# 3. Code signing identities: let Codemagic fetch / create the App Store profile for ${id.appId}.
workflows:
  ios-testflight:
    name: iOS TestFlight
    max_build_duration: 60
    instance_type: mac_mini_m2
    integrations:
      app_store_connect: YOUR_APP_STORE_CONNECT_KEY_NAME
    environment:
      ios_signing:
        distribution_type: app_store
        bundle_identifier: ${id.appId}
      node: 22
      xcode: latest
      cocoapods: default
    scripts:
      - name: Install packages
        script: npm ci || npm install
      - name: Add the iOS platform
        script: test -d ios || npx cap add ios
      - name: Apply OmniStage settings
        script: node scripts/configure-native.mjs
      - name: Generate icons and splash
        script: npx capacitor-assets generate --ios
      - name: Sync web build
        script: npx cap sync ios
      - name: Signing profiles
        script: xcode-project use-profiles
      - name: Build IPA
        script: |
          if [ -d ios/App/App.xcworkspace ]; then
            xcode-project build-ipa --workspace ios/App/App.xcworkspace --scheme App
          else
            xcode-project build-ipa --project ios/App/App.xcodeproj --scheme App
          fi
    artifacts:
      - build/ios/ipa/*.ipa
    publishing:
      app_store_connect:
        auth: integration
        submit_to_testflight: true
`;
}

export function buildCapacitorProject(html: string, id: AppIdentity, icons: AppIconSet, capabilities: NativeCapability['id'][] = ['haptics', 'saves', 'pause']): ZipInput[] {
  assertValidIdentity(id);
  if (html.includes('serviceWorker.register')) throw new Error('Native builds must not register a service worker; build the HTML with appPlayerOptions(identity, "native")');
  const slug = slugifyTitle(id.appName, 'omnistage-app');
  const deps: Record<string, string> = { ...CAPACITOR_PACKAGES.dependencies };
  const pluginFor: Record<string, string> = { haptics: '@capacitor/haptics', saves: '@capacitor/preferences', pause: '@capacitor/app' };
  for (const [cap, pkg] of Object.entries(pluginFor)) if (!capabilities.includes(cap as NativeCapability['id'])) delete deps[pkg];

  const pkg = {
    name: slug,
    version: id.version,
    private: true,
    description: `${id.appName} — built with OmniStage`,
    type: 'module',
    scripts: {
      configure: 'node scripts/configure-native.mjs',
      assets: 'capacitor-assets generate',
      sync: 'cap sync',
      'android:open': 'cap open android',
      'android:debug': 'cap sync android && node scripts/gradle.mjs assembleDebug',
      'android:release': 'cap sync android && node scripts/gradle.mjs bundleRelease',
      'ios:open': 'cap open ios',
    },
    dependencies: deps,
    devDependencies: CAPACITOR_PACKAGES.devDependencies,
  };
  const capConfig = {
    appId: id.appId,
    appName: id.appName,
    webDir: 'www',
    backgroundColor: id.backgroundColor,
    android: { backgroundColor: id.backgroundColor },
    ios: { backgroundColor: id.backgroundColor, contentInset: 'never' },
  };
  const appJson = {
    appName: id.appName,
    appId: id.appId,
    version: id.version,
    versionCode: id.versionCode,
    orientation: id.orientation,
    themeColor: id.themeColor,
    backgroundColor: id.backgroundColor,
    capabilities,
  };
  const readme = `# ${id.appName} — Android & iOS app (Capacitor 8)

Exported from OmniStage. The game is \`www/index.html\` (works offline); Capacitor wraps it in a native app.
App id: \`${id.appId}\` · version ${id.version} (build ${id.versionCode}) · ${id.orientation}

## You need
- Node.js 22+.
- Android: Android Studio (latest) with the Android SDK ${ANDROID_TARGET_SDK} platform and a JDK 21.
- iOS: a Mac with Xcode, or the cloud Mac in \`codemagic.yaml\` (no Mac needed).

## First build (Android)
\`\`\`
npm install
npx cap add android
npm run configure        # target SDK ${ANDROID_TARGET_SDK}, version, orientation, signing hook
npm run assets           # icons + splash from resources/
npm run android:debug    # android/app/build/outputs/apk/debug/app-debug.apk
\`\`\`
Install the APK on a phone with USB debugging (\`adb install -r ...apk\`) or open the project with \`npm run android:open\`.

## Release for Google Play (AAB)
1. Create an upload key once and keep it safe (losing it means asking Google for a key reset):
   \`keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000\`
2. Copy \`keystore.properties.example\` to \`keystore.properties\` and fill it in. Both files stay out of git.
3. \`npm run configure\` (once, adds the signing config) then \`npm run android:release\`.
   The bundle is \`android/app/build/outputs/bundle/release/app-release.aab\`; upload it in Play Console (Play App Signing on).

## iOS
- On a Mac: \`npx cap add ios && npm run configure && npm run assets && npx cap sync ios && npm run ios:open\`, then
  Product → Archive in Xcode.
- Without a Mac: push this folder to Git and run the \`ios-testflight\` workflow in \`codemagic.yaml\`.

## Every update
Change the game in OmniStage, raise the version / build number, export again and copy the new \`www/\` and
\`omnistage.app.json\` over this project, then \`npm run configure && npx cap sync\`.

## Store listing
\`store/checklist.md\` lists what the stores still need from you; \`store/privacy-policy.md\` and
\`store/data-safety.md\` are drafts generated from what the game does — review them before you publish.

Android ${ANDROID_TARGET_SDK} note: on tablets and foldables (600 dp+) Android may ignore the orientation lock, so the game
letterboxes to keep its aspect ratio.
`;
  return [
    { name: 'package.json', content: JSON.stringify(pkg, null, 2) },
    { name: 'capacitor.config.json', content: JSON.stringify(capConfig, null, 2) },
    { name: 'omnistage.app.json', content: JSON.stringify(appJson, null, 2) },
    { name: 'www/index.html', content: html },
    { name: 'resources/icon.png', content: icons.icon1024 },
    { name: 'resources/splash.png', content: icons.splash2732 },
    { name: 'resources/splash-dark.png', content: icons.splash2732 },
    { name: 'scripts/configure-native.mjs', content: CONFIGURE_NATIVE_SCRIPT },
    { name: 'scripts/gradle.mjs', content: GRADLE_SCRIPT },
    { name: 'keystore.properties.example', content: 'storeFile=upload.keystore\nstorePassword=\nkeyAlias=upload\nkeyPassword=\n' },
    { name: 'codemagic.yaml', content: buildCodemagicYaml(id) },
    { name: '.gitignore', content: 'node_modules/\nandroid/app/build/\nandroid/.gradle/\nios/App/Pods/\n*.keystore\n*.jks\nkeystore.properties\n' },
    { name: 'README.md', content: readme },
  ];
}

// ---------------------------------------------------------------------------
// Store assistant: data-safety answers, privacy policy draft, release checklist
// ---------------------------------------------------------------------------

export interface DataSafetyReport {
  collectsData: false;
  sharesData: false;
  storesOnDevice: string[];
  externalLinks: string[];
  networkAccess: string[];
  answers: Array<{ question: string; answer: string }>;
}

/** What the app does with data, derived from the scenes (OmniStage apps collect nothing and have no SDKs). */
export function dataSafetyFor(scenes: SceneSpec[], capabilities: NativeCapability['id'][], onlineAssets: string[] = []): DataSafetyReport {
  const links = [...new Set(scenes.map((s) => (s.marketingOverlay?.enabled ? s.marketingOverlay.ctaUrl : '') || '').filter((u) => /^https?:\/\//i.test(u)))];
  const hosts = [...new Set(onlineAssets.map((u) => { try { return new URL(u).host; } catch { return ''; } }).filter(Boolean))];
  const storesOnDevice = capabilities.includes('saves') ? ['Best score per level and the level to resume (on the device only, never sent anywhere)'] : [];
  const answers = [
    { question: 'Does your app collect or share any of the required user data types?', answer: 'No. The app has no accounts, analytics, ads or tracking SDKs and sends no user data.' },
    { question: 'Is all of the user data collected by your app encrypted in transit?', answer: 'Not applicable: no user data is collected.' },
    { question: 'Do you provide a way for users to request that their data is deleted?', answer: 'Not applicable: nothing leaves the device. Uninstalling the app (or clearing its storage) removes saved progress.' },
    { question: 'App Store privacy label', answer: 'Data Not Collected.' },
  ];
  return { collectsData: false, sharesData: false, storesOnDevice, externalLinks: links, networkAccess: hosts, answers };
}

export function buildPrivacyPolicy(id: AppIdentity, report: DataSafetyReport, contact = '[your contact email]'): string {
  const lines = [
    `# Privacy Policy — ${id.appName}`,
    '',
    `${id.appName} (${id.appId}) is a game. It does not collect, store on a server, sell or share personal data.`,
    '',
    '## What stays on your device',
    ...(report.storesOnDevice.length ? report.storesOnDevice.map((s) => `- ${s}`) : ['- Nothing is saved.']),
    '',
    '## Network',
    report.networkAccess.length
      ? `The game downloads public game files from ${report.networkAccess.join(', ')}. No personal data is sent with these requests beyond what any web request includes (such as your IP address, seen by that host).`
      : 'The game works fully offline and makes no network requests.',
    '',
    ...(report.externalLinks.length
      ? ['## Links', `Buttons in the game can open ${report.externalLinks.join(', ')} in your browser. Those sites have their own privacy policies.`, '']
      : []),
    '## Children',
    'The app does not knowingly collect data from anyone, including children.',
    '',
    '## Contact',
    `Questions: ${contact}`,
    '',
    '_Draft generated by OmniStage. Review it, add your contact details and host it at a public URL before publishing._',
  ];
  return lines.join('\n');
}

export interface ChecklistItem {
  id: string;
  status: 'ok' | 'warn' | 'todo';
  text: string;
}

export function storeChecklist(input: {
  identity: AppIdentity;
  scenes: SceneSpec[];
  /** Mobile verifier issues (verifySceneSpec with target 'mobile'). */
  mobileIssues: number;
  onlineAssets?: string[];
}): ChecklistItem[] {
  const { identity: id, scenes } = input;
  const idIssues = validateAppIdentity(id);
  const errors = idIssues.filter((i) => i.severity === 'error');
  const aspect = scenes[0]?.aspectRatio;
  const expected = aspect ? orientationForAspect(aspect) : id.orientation;
  const items: ChecklistItem[] = [
    { id: 'identity', status: errors.length ? 'warn' : idIssues.length ? 'warn' : 'ok', text: errors.length ? `Fix the app details: ${errors[0].message}` : idIssues.length ? idIssues[0].message : 'App name, id and version are valid.' },
    { id: 'orientation', status: expected === 'any' || expected === id.orientation ? 'ok' : 'warn', text: expected === 'any' || expected === id.orientation ? `Orientation (${id.orientation}) matches the ${aspect} stage.` : `The stage is ${aspect} but the app is locked to ${id.orientation}.` },
    { id: 'mobile-verify', status: input.mobileIssues ? 'warn' : 'ok', text: input.mobileIssues ? `${input.mobileIssues} mobile check(s) need attention (text size, touch targets, safe area).` : 'Mobile checks pass (text size, touch targets, safe area).' },
    { id: 'offline', status: input.onlineAssets?.length ? 'warn' : 'ok', text: input.onlineAssets?.length ? `${input.onlineAssets.length} asset(s) still load from the internet; the app needs a connection for them.` : 'Everything is embedded; the app works offline.' },
    { id: 'target-sdk', status: 'ok', text: `Android target SDK ${ANDROID_TARGET_SDK} is set by npm run configure.` },
    { id: 'signing', status: 'todo', text: 'Create an upload keystore and keystore.properties (Android) / an App Store Connect API key (iOS).' },
    { id: 'icon', status: 'ok', text: 'Icon 1024×1024, adaptive / maskable icon and splash are generated (replace resources/*.png with your own art if you have it).' },
    { id: 'screenshots', status: 'todo', text: 'Store screenshots: at least 2 phone shots for Play and 6.9" iPhone shots for the App Store (use "Capture screenshot").' },
    { id: 'privacy', status: 'todo', text: 'Host store/privacy-policy.md at a public URL and paste it into both store listings.' },
    { id: 'data-safety', status: 'todo', text: 'Answer Play Data safety and the App Store privacy label with store/data-safety.md (no data collected).' },
    { id: 'rating', status: 'todo', text: 'Complete the content rating questionnaire (IARC on Play, age rating on the App Store).' },
    { id: 'testing', status: 'todo', text: 'New Play developer accounts must run a closed test with 12+ testers for 14 days before production.' },
  ];
  return items;
}

export function checklistMarkdown(id: AppIdentity, items: ChecklistItem[], report: DataSafetyReport): { checklist: string; dataSafety: string } {
  const mark = { ok: '[x]', warn: '[ ] ⚠', todo: '[ ]' } as const;
  const checklist = [`# Store checklist — ${id.appName}`, '', ...items.map((i) => `- ${mark[i.status]} ${i.text}`), ''].join('\n');
  const dataSafety = [
    `# Data safety / privacy label — ${id.appName}`,
    '',
    ...report.answers.flatMap((a) => [`**${a.question}**`, a.answer, '']),
    ...(report.storesOnDevice.length ? ['On-device only:', ...report.storesOnDevice.map((s) => `- ${s}`), ''] : []),
    ...(report.externalLinks.length ? ['External links (not data collection):', ...report.externalLinks.map((s) => `- ${s}`), ''] : []),
  ].join('\n');
  return { checklist, dataSafety };
}

/** store/ folder added to the Capacitor ZIP. */
export function storeFiles(id: AppIdentity, items: ChecklistItem[], report: DataSafetyReport, screenshots: Uint8Array[] = []): ZipInput[] {
  const { checklist, dataSafety } = checklistMarkdown(id, items, report);
  return [
    { name: 'store/checklist.md', content: checklist },
    { name: 'store/data-safety.md', content: dataSafety },
    { name: 'store/privacy-policy.md', content: buildPrivacyPolicy(id, report) },
    ...screenshots.map((bytes, i) => ({ name: `store/screenshot-${i + 1}.png`, content: bytes })),
  ];
}
