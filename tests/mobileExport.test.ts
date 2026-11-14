import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlankSceneSpec, SCENE_TEMPLATES } from '../src/registry/assetRegistry';
import type { Node2D, SceneSpec } from '../src/types/scene.schema';
import { generatePlayerHTML } from '../src/exporter/playerHtml';
import {
  ANDROID_TARGET_SDK,
  appPlayerOptions,
  AppIconSet,
  buildCapacitorProject,
  buildPrivacyPolicy,
  buildPwaFiles,
  buildServiceWorker,
  buildWebManifest,
  CAPACITOR_PACKAGES,
  dataSafetyFor,
  defaultAppIdentity,
  orientationForAspect,
  storeChecklist,
  storeFiles,
  validateAppIdentity,
} from '../src/exporter/mobileExport';
import { emptyProgress, parseProgress, progressKey, recordRound, resumeSceneFor } from '../src/runtime/progress';
import { createNativeBridge } from '../src/player/native';
import { autoFixSceneSpec, mobileStageGeometry, verifySceneSpec } from '../src/verification/sceneVerifier';

const ICONS: AppIconSet = {
  icon192: new Uint8Array([1]),
  icon512: new Uint8Array([2]),
  maskable512: new Uint8Array([3]),
  icon1024: new Uint8Array([4]),
  splash2732: new Uint8Array([5]),
};
const RUNTIME = 'var OmniPlayer={createOmniPlayer:function(){}};';

function scene(aspect: SceneSpec['aspectRatio'] = '9:16'): SceneSpec {
  const s = createBlankSceneSpec('2d', 'Star Hopper Deluxe');
  s.aspectRatio = aspect;
  s.mode = 'game';
  return s;
}

function html(kind: 'pwa' | 'native', s = scene()) {
  const id = defaultAppIdentity(s);
  id.appId = 'com.acme.starhopper';
  return { id, html: generatePlayerHTML(s, 'itch', [s], { playerRuntimeSource: RUNTIME, ...appPlayerOptions(id, kind) }) };
}

const text = (files: { name: string; content: string | Uint8Array }[], name: string) => {
  const f = files.find((x) => x.name === name);
  assert.ok(f, `missing ${name}`);
  return String(f.content);
};

// --- saved progress -------------------------------------------------------

test('progress: records best score, cleared levels and resume level; parses defensively', () => {
  let p = emptyProgress();
  let r = recordRound(p, { sceneId: 'l1', score: 50, won: true, nextSceneId: 'l2' });
  assert.equal(r.newBest, true);
  p = r.progress;
  assert.deepEqual(p.cleared, ['l1']);
  assert.equal(p.resumeSceneId, 'l2');
  r = recordRound(p, { sceneId: 'l2', score: 10, won: false });
  assert.equal(r.progress.best.l2, 10);
  assert.equal(r.progress.resumeSceneId, 'l2', 'a loss keeps the resume level');
  r = recordRound(r.progress, { sceneId: 'l1', score: 30, won: true, nextSceneId: 'l2' });
  assert.equal(r.newBest, false);
  assert.equal(r.progress.best.l1, 50);
  assert.deepEqual(r.progress.cleared, ['l1']);

  const round = parseProgress(JSON.stringify(r.progress));
  assert.deepEqual(round, r.progress);
  assert.deepEqual(parseProgress('not json'), emptyProgress());
  assert.deepEqual(parseProgress('{"version":2}'), emptyProgress());
  assert.deepEqual(parseProgress('{"version":1,"best":{"a":"x","b":3},"cleared":[1,"b"]}').best, { b: 3 });
  assert.equal(resumeSceneFor(round, ['l1', 'l2'], 'l1'), 'l2');
  assert.equal(resumeSceneFor(round, ['l1'], 'l1'), 'l1', 'deleted level falls back to the start scene');
  assert.equal(progressKey('com.acme/../x'), 'omnistage.progress.com.acme_.._x');
});

// --- native bridge ---------------------------------------------------------

test('native bridge uses Capacitor plugins inside the app shell', async () => {
  const calls: string[] = [];
  const listeners: Record<string, () => void> = {};
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        Haptics: { impact: (o: any) => calls.push(`impact:${o.style}`), notification: (o: any) => calls.push(`notify:${o.type}`) },
        Preferences: { get: async ({ key }: any) => ({ value: key === 'k' ? 'saved' : null }), set: async (o: any) => calls.push(`set:${o.key}=${o.value}`) },
        App: { addListener: (ev: string, cb: () => void) => { listeners[ev] = cb; return Promise.resolve({ remove: () => calls.push(`remove:${ev}`) }); } },
      },
    },
    document: { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined },
    navigator: { vibrate: () => calls.push('vibrate') },
  };
  const b = createNativeBridge(win);
  assert.equal(b.isNative, true);
  b.haptic('light');
  b.haptic('success');
  b.save('k', 'v');
  assert.equal(await b.load('k'), 'saved');
  let paused = 0;
  let resumed = 0;
  const off = b.onLifecycle(() => paused++, () => resumed++);
  await new Promise((r) => setTimeout(r, 0));
  listeners.pause();
  listeners.resume();
  off();
  assert.deepEqual([paused, resumed], [1, 1]);
  assert.deepEqual(calls.filter((c) => !c.startsWith('remove')), ['impact:LIGHT', 'notify:SUCCESS', 'set:k=v']);
  assert.ok(calls.includes('remove:pause') && calls.includes('remove:resume'));
});

test('native bridge falls back to web APIs and never throws', async () => {
  const store: Record<string, string> = {};
  const vib: unknown[] = [];
  let onVis: (() => void) | null = null;
  const doc = { hidden: false, addEventListener: (_: string, cb: () => void) => { onVis = cb; }, removeEventListener: () => { onVis = null; } };
  const win = {
    document: doc,
    navigator: { vibrate: (p: unknown) => vib.push(p) },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
  };
  const b = createNativeBridge(win);
  assert.equal(b.isNative, false);
  b.haptic('heavy');
  b.save('a', '1');
  assert.equal(await b.load('a'), '1');
  const states: string[] = [];
  const off = b.onLifecycle(() => states.push('pause'), () => states.push('resume'));
  doc.hidden = true;
  onVis!();
  doc.hidden = false;
  onVis!();
  off();
  assert.deepEqual(states, ['pause', 'resume']);
  assert.deepEqual(vib, [35]);

  const broken = createNativeBridge({ document: doc, localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
  assert.equal(await broken.load('x'), null);
  assert.doesNotThrow(() => broken.save('x', 'y'));
  assert.doesNotThrow(() => broken.haptic('error'));
});

// --- identity --------------------------------------------------------------

test('app identity: defaults follow the scene, validation catches store-breaking values', () => {
  const s = scene('16:9');
  const id = defaultAppIdentity(s);
  assert.equal(id.orientation, 'landscape');
  assert.equal(orientationForAspect('9:16'), 'portrait');
  assert.equal(orientationForAspect('1:1'), 'any');
  assert.match(id.appId, /^com\.mystudio\.[a-z][a-z0-9]*$/);
  assert.ok(validateAppIdentity(id).every((i) => i.severity === 'warning'), 'defaults only warn about the placeholder domain');
  const bad = { ...id, appId: 'com.new.1game', appName: 'x'.repeat(31), version: '1.0', versionCode: 0, themeColor: 'red' };
  const fields = validateAppIdentity(bad).filter((i) => i.severity === 'error').map((i) => i.field).sort();
  assert.deepEqual(fields, ['appId', 'appName', 'themeColor', 'version', 'versionCode']);
  assert.ok(validateAppIdentity({ ...id, appId: 'com.acme.new' }).some((i) => i.field === 'appId' && /keyword/.test(i.message)));
  assert.deepEqual(validateAppIdentity({ ...id, appId: 'com.acme.game' }), []);
});

// --- PWA ---------------------------------------------------------------------

test('PWA: manifest, offline service worker and HTML wiring', () => {
  const { id, html: page } = html('pwa');
  assert.match(page, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(page, /serviceWorker\.register\("sw\.js"\)/);
  assert.match(page, new RegExp(`<meta name="theme-color" content="${id.themeColor}"`));
  assert.match(page, /"app":\{"saveKey":"com\.acme\.starhopper","haptics":true,"saves":true\}/);
  // Every inline script still parses.
  for (const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));

  const files = buildPwaFiles(page, id, ICONS);
  assert.deepEqual(files.map((f) => f.name).sort(), ['README.md', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'index.html', 'manifest.webmanifest', 'sw.js']);
  const manifest = JSON.parse(text(files, 'manifest.webmanifest'));
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.orientation, 'portrait');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.short_name.length <= 12);
  assert.deepEqual(manifest.icons.map((i: any) => i.purpose), ['any', 'any', 'maskable']);
  assert.deepEqual(buildWebManifest(id), manifest);
  const sw = text(files, 'sw.js');
  assert.doesNotThrow(() => new Function(sw));
  assert.match(sw, /omnistage-com\.acme\.starhopper-1\.0\.0-1/);
  assert.notEqual(buildServiceWorker({ ...id, versionCode: 2 }), sw, 'a new build number busts the cache');
  // Ad exports stay untouched.
  const ad = generatePlayerHTML(scene(), 'meta', [scene()], { playerRuntimeSource: RUNTIME });
  assert.doesNotMatch(ad, /manifest|serviceWorker|"app":/);
  assert.throws(() => buildPwaFiles(ad, id, ICONS), /appPlayerOptions/);
  // Unsafe hrefs / colours are dropped.
  const evil = generatePlayerHTML(scene(), 'itch', [scene()], { playerRuntimeSource: RUNTIME, pwa: { manifestHref: '"><script>', serviceWorkerHref: 'sw.js' }, themeColor: 'red"><x' });
  assert.doesNotMatch(evil, /<link rel="manifest"/);
  assert.match(evil, /content="#05070d"/);
});

// --- Capacitor ---------------------------------------------------------------

test('Capacitor project: Capacitor 8, SDK 36, scripts and secrets kept out of git', () => {
  const { id, html: page } = html('native');
  assert.doesNotMatch(page, /serviceWorker/);
  const files = buildCapacitorProject(page, id, ICONS);
  const names = files.map((f) => f.name);
  for (const n of ['package.json', 'capacitor.config.json', 'omnistage.app.json', 'www/index.html', 'resources/icon.png', 'resources/splash.png', 'scripts/configure-native.mjs', 'scripts/gradle.mjs', 'codemagic.yaml', '.gitignore', 'README.md', 'keystore.properties.example']) {
    assert.ok(names.includes(n), n);
  }
  const pkg = JSON.parse(text(files, 'package.json'));
  assert.equal(pkg.dependencies['@capacitor/core'], CAPACITOR_PACKAGES.dependencies['@capacitor/core']);
  for (const v of Object.values({ ...pkg.dependencies, ...pkg.devDependencies }) as string[]) assert.match(v, /^\^\d+\.\d+\.\d+$/);
  assert.ok(Object.entries(pkg.dependencies).filter(([k]) => k.startsWith('@capacitor/')).every(([, v]) => String(v).startsWith('^8.')));
  const cap = JSON.parse(text(files, 'capacitor.config.json'));
  assert.equal(cap.appId, 'com.acme.starhopper');
  assert.equal(cap.webDir, 'www');
  assert.match(text(files, '.gitignore'), /keystore\.properties/);
  assert.match(text(files, '.gitignore'), /\*\.keystore/);
  assert.match(text(files, 'codemagic.yaml'), /bundle_identifier: com\.acme\.starhopper/);
  assert.match(text(files, 'README.md'), new RegExp(`SDK ${ANDROID_TARGET_SDK}`));
  assert.doesNotThrow(() => new Function(text(files, 'www/index.html').match(/<script>\s*\(function[\s\S]*?<\/script>/)![0].replace(/<\/?script>/g, '')));

  // Capabilities trim the plugin list.
  const lean = JSON.parse(text(buildCapacitorProject(page, id, ICONS, ['pause']), 'package.json'));
  assert.equal(lean.dependencies['@capacitor/haptics'], undefined);
  assert.equal(lean.dependencies['@capacitor/preferences'], undefined);
  assert.ok(lean.dependencies['@capacitor/app']);

  assert.throws(() => buildCapacitorProject(html('pwa').html, id, ICONS), /service worker/);
  assert.throws(() => buildCapacitorProject(page, { ...id, appId: 'bad id' }, ICONS), /appId/);
});

test('configure-native.mjs applies SDK 36, version, orientation and signing to fresh native projects', () => {
  const { id, html: page } = html('native', scene('16:9'));
  const files = buildCapacitorProject(page, { ...id, version: '1.2.3', versionCode: 7 }, ICONS);
  const dir = mkdtempSync(join(tmpdir(), 'omni-cap-'));
  try {
    for (const f of files) {
      if (typeof f.content !== 'string') continue;
      mkdirSync(join(dir, f.name, '..'), { recursive: true });
      writeFileSync(join(dir, f.name), f.content);
    }
    const put = (rel: string, body: string) => {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), body);
    };
    put('android/variables.gradle', 'ext {\n    minSdkVersion = 24\n    compileSdkVersion = 35\n    targetSdkVersion = 35\n}\n');
    put('android/app/build.gradle', "apply plugin: 'com.android.application'\n\nandroid {\n    defaultConfig {\n        versionCode 1\n        versionName \"1.0\"\n    }\n    buildTypes {\n        release {\n            minifyEnabled false\n        }\n    }\n}\n");
    put('android/app/src/main/AndroidManifest.xml', '<manifest>\n<application>\n<activity android:name=".MainActivity" android:exported="true">\n</activity>\n</application>\n</manifest>\n');
    put('ios/App/App/Info.plist', '<dict>\n\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>\n\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>\n</dict>\n');
    put('ios/App/App.xcodeproj/project.pbxproj', 'MARKETING_VERSION = 1.0;\nCURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0;\n');

    const run = () => spawnSync(process.execPath, ['scripts/configure-native.mjs'], { cwd: dir, encoding: 'utf8' });
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
    assert.match(read('android/variables.gradle'), /compileSdkVersion = 36/);
    assert.match(read('android/variables.gradle'), /targetSdkVersion = 36/);
    assert.match(read('android/variables.gradle'), /minSdkVersion = 24/);
    const gradle = read('android/app/build.gradle');
    assert.match(gradle, /versionCode 7/);
    assert.match(gradle, /versionName "1\.2\.3"/);
    assert.match(gradle, /signingConfigs \{/);
    assert.match(gradle, /release \{\n\s+if \(omniKeystoreFile\.exists\(\)\) \{ signingConfig signingConfigs\.release \}/);
    assert.match(read('android/app/src/main/AndroidManifest.xml'), /<activity android:screenOrientation="sensorLandscape" android:name=".MainActivity"/);
    const plist = read('ios/App/App/Info.plist');
    assert.equal((plist.match(/UIInterfaceOrientationLandscapeLeft/g) || []).length, 2);
    assert.doesNotMatch(plist, /UIInterfaceOrientationPortrait/);
    assert.equal((read('ios/App/App.xcodeproj/project.pbxproj').match(/MARKETING_VERSION = 1\.2\.3;/g) || []).length, 2);

    // Idempotent: a second run changes nothing (no duplicated signing block).
    const before = gradle;
    assert.equal(run().status, 0);
    assert.equal(read('android/app/build.gradle'), before);
    assert.doesNotMatch(r.stdout + r.stderr, /password/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- store assistant ---------------------------------------------------------

test('store assistant: data safety, privacy draft and checklist follow the scenes', () => {
  const s = scene();
  s.marketingOverlay = { ...s.marketingOverlay, enabled: true, ctaUrl: 'https://acme.example/game', ctaText: 'Get it' };
  const report = dataSafetyFor([s], ['haptics', 'saves'], ['https://cdn.example.com/a.glb']);
  assert.equal(report.collectsData, false);
  assert.deepEqual(report.externalLinks, ['https://acme.example/game']);
  assert.deepEqual(report.networkAccess, ['cdn.example.com']);
  assert.equal(report.storesOnDevice.length, 1);
  const id = { ...defaultAppIdentity(s), appId: 'com.acme.starhopper' };
  const policy = buildPrivacyPolicy(id, report);
  assert.match(policy, /does not collect/);
  assert.match(policy, /cdn\.example\.com/);
  assert.match(policy, /acme\.example/);
  assert.match(buildPrivacyPolicy(id, dataSafetyFor([scene()], [])), /works fully offline/);

  const items = storeChecklist({ identity: { ...id, orientation: 'landscape' }, scenes: [s], mobileIssues: 2, onlineAssets: ['https://cdn.example.com/a.glb'] });
  const byId = Object.fromEntries(items.map((i) => [i.id, i.status]));
  assert.equal(byId.orientation, 'warn');
  assert.equal(byId['mobile-verify'], 'warn');
  assert.equal(byId.offline, 'warn');
  assert.equal(byId.identity, 'ok');
  assert.equal(byId.signing, 'todo');
  const out = storeFiles(id, items, report, [new Uint8Array([9])]);
  assert.deepEqual(out.map((f) => f.name), ['store/checklist.md', 'store/data-safety.md', 'store/privacy-policy.md', 'store/screenshot-1.png']);
  assert.match(String(out[1].content), /Data Not Collected/);
});

// --- mobile verifier ---------------------------------------------------------

function textNode(id: string, x: number, y: number, fontSize: number): Node2D {
  return { id, name: id, type: 'text-kinetic', text: 'Score', x, y, width: 200, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#fff', stroke: '#000', physics2D: 'none', fontSize };
}

test('mobile geometry: phone scale, minimum font / touch sizes and safe-area margins', () => {
  const portrait = mobileStageGeometry('9:16');
  assert.ok(Math.abs(portrait.scale - 0.36) < 1e-9);
  assert.equal(portrait.minFont, 34);
  assert.equal(portrait.minTouch, 123);
  assert.deepEqual(portrait.margin, { top: 0, bottom: 0, left: 23, right: 23 });
  const landscape = mobileStageGeometry('16:9');
  assert.equal(landscape.minFont, 20);
  assert.equal(landscape.margin.left, 0, 'the letterbox already clears the notch');
  assert.ok(landscape.margin.bottom > 0, 'home indicator');
});

test('mobile rules only run for target mobile and auto-fix text, tap targets and edges', () => {
  const s = scene('9:16');
  s.nodes2D.push(textNode('tiny', 500, 300, 18), textNode('edge', 60, 300, 40));
  s.nodes2D.push({ id: 'btn', name: 'Button', type: 'vector-shape', x: 500, y: 450, width: 60, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#0f0', stroke: '#000', physics2D: 'none' });
  s.logicGraph = {
    nodes: [
      { id: 't1', type: 'trigger', title: 'Tap', category: 'event', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: { eventType: 'on-click-actor', actorId: 'btn' } },
      { id: 't2', type: 'trigger', title: 'Key E', category: 'event', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: { eventType: 'on-key-press', key: 'e' } },
      { id: 't3', type: 'trigger', title: 'Space', category: 'event', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: { eventType: 'on-key-press', key: 'space' } },
    ],
    edges: [],
  } as any;

  const plain = verifySceneSpec(s);
  assert.ok(!plain.issues.some((i) => i.code.startsWith('mobile.')), 'no mobile codes without target');

  const codes = (spec: SceneSpec) => verifySceneSpec(spec, { target: 'mobile' }).issues.filter((i) => i.code.startsWith('mobile.')).map((i) => `${i.code}:${i.targetId ?? ''}`).sort();
  assert.deepEqual(codes(s), ['mobile.edge-ui:edge', 'mobile.keyboard-only:', 'mobile.text-small:tiny', 'mobile.touch-target:btn']);

  const { spec, fixes } = autoFixSceneSpec(s, { target: 'mobile' });
  assert.ok(fixes.length >= 3, fixes.join(' | '));
  assert.deepEqual(codes(spec), ['mobile.keyboard-only:'], 'only the non-fixable keyboard hint remains');
  const byId = Object.fromEntries(spec.nodes2D.map((n) => [n.id, n]));
  assert.equal(byId.tiny.fontSize, 34);
  assert.ok(byId.btn.height >= 123 && byId.btn.width / byId.btn.height === 60 / 40 || Math.abs(byId.btn.width / byId.btn.height - 1.5) < 0.05);
  assert.ok(byId.edge.x - byId.edge.width / 2 >= 23);
  assert.equal(s.nodes2D.find((n) => n.id === 'tiny')!.fontSize, 18, 'auto-fix does not mutate the input');
});

test('mobile rules: every scene template stays clean of errors and mobile auto-fix converges', () => {
  for (const [name, t] of Object.entries(SCENE_TEMPLATES)) {
    const report = verifySceneSpec(t, { target: 'mobile' });
    assert.ok(report.issues.filter((i) => i.code.startsWith('mobile.')).every((i) => i.severity === 'warning'), name);
    const fixed = autoFixSceneSpec(t, { target: 'mobile' }).report;
    assert.ok(!fixed.issues.some((i) => i.code.startsWith('mobile.') && i.fixable), `${name}: ${fixed.issues.map((i) => i.code).join(',')}`);
  }
});
