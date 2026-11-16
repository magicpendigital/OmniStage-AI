/**
 * Phase 8 — Publish → Mobile App: installable PWA, Capacitor Android / iOS project, mobile checks and store assistant.
 */
import React from 'react';
import { AlertCircle, Check, Download, Gauge, Globe, ListChecks, Smartphone, Wand2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { buildZip } from '../exporter/playableBundle';
import { buildStandalonePlayable, downloadBlob, slugifyTitle } from '../exporter/mediaExporter';
import {
  appPlayerOptions,
  AppIdentity,
  buildCapacitorProject,
  buildPwaFiles,
  dataSafetyFor,
  defaultAppIdentity,
  NATIVE_CAPABILITIES,
  NativeCapability,
  storeChecklist,
  storeFiles,
  validateAppIdentity,
} from '../exporter/mobileExport';
import { renderAppIcons, renderStoreScreenshot } from '../exporter/mobileAssets';
import { autoFixSceneSpec, verifySceneSpec } from '../verification/sceneVerifier';
import { DEVICE_PROFILES, DEVICE_TIERS, DeviceTier, QUALITY_LADDER } from '../runtime/deviceProfiles';

type ReadyCap = NativeCapability['id'];

const field = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-cyan-500 outline-none';

export const MobileExportPanel: React.FC<{ onNotice: (msg: string) => void }> = ({ onNotice }) => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);
  const setSceneSpec = useStudioStore((s) => s.setSceneSpec);
  const canvasElement = useStudioStore((s) => s.canvasElement);

  const [identity, setIdentity] = React.useState<AppIdentity>(() => defaultAppIdentity(sceneSpec));
  const [caps, setCaps] = React.useState<ReadyCap[]>(['haptics', 'saves', 'pause']);
  const [screens, setScreens] = React.useState<Uint8Array[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tier, setTier] = React.useState<DeviceTier>('mid');

  const all = React.useMemo(() => (scenes.length ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s)) : [sceneSpec]), [scenes, sceneSpec]);
  const mobileReports = React.useMemo(
    () => all.map((s) => ({ scene: s, report: verifySceneSpec(s, { scenes: all, target: 'mobile', deviceTier: tier }) })),
    [all, tier]
  );
  const mobileIssues = mobileReports.flatMap((r) => r.report.issues.filter((i) => i.code.startsWith('mobile.')).map((i) => ({ ...i, sceneTitle: r.scene.title })));
  const activeFixable = mobileReports.find((r) => r.scene.id === sceneSpec.id)?.report.issues.some((i) => i.code.startsWith('mobile.') && i.fixable);
  const idIssues = validateAppIdentity(identity);
  const idErrors = idIssues.filter((i) => i.severity === 'error');
  const checklist = storeChecklist({ identity, scenes: all, mobileIssues: mobileIssues.length });

  const set = <K extends keyof AppIdentity>(k: K, v: AppIdentity[K]) => setIdentity((p) => ({ ...p, [k]: v }));
  const toggleCap = (id: ReadyCap) => setCaps((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const fixActive = () => {
    const { spec, fixes } = autoFixSceneSpec(sceneSpec, { scenes: all, target: 'mobile', deviceTier: tier });
    if (!fixes.length) return onNotice('Nothing to fix automatically in this scene.');
    setSceneSpec(spec, fixes);
    onNotice(`Applied ${fixes.length} phone fix(es) to "${sceneSpec.title}".`);
  };

  const captureScreenshot = async () => {
    if (!canvasElement) return setError('Open the viewport first: screenshots come from the stage canvas.');
    try {
      const shot = await renderStoreScreenshot(identity, canvasElement, identity.orientation === 'landscape' ? 'landscape' : 'portrait');
      setScreens((p) => [...p, shot].slice(-8));
      onNotice(`Screenshot ${screens.length + 1} captured for the store listing.`);
    } catch (e: any) {
      setError(`Screenshot failed: ${e?.message || e}`);
    }
  };

  const run = async (kind: 'pwa' | 'native') => {
    setError(null);
    if (idErrors.length) return setError(idErrors[0].message);
    setBusy(kind === 'pwa' ? 'Building PWA…' : 'Building the Android / iOS project…');
    try {
      const { html, budget } = await buildStandalonePlayable(sceneSpec, 'itch', all, {
        enableMobileTouchControls: true,
        enableProceduralAudio: true,
        renderer: 'webgl',
        ...appPlayerOptions(identity, kind, caps),
      });
      const icons = await renderAppIcons(identity, canvasElement);
      const slug = slugifyTitle(identity.appName, 'omnistage-app');
      let files;
      if (kind === 'pwa') files = buildPwaFiles(html, identity, icons);
      else {
        const report = dataSafetyFor(all, caps, budget.externalDependencies);
        const items = storeChecklist({ identity, scenes: all, mobileIssues: mobileIssues.length, onlineAssets: budget.externalDependencies });
        files = [...buildCapacitorProject(html, identity, icons, caps), ...storeFiles(identity, items, report, screens)];
      }
      const zip = await buildZip(files);
      downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${slug}-${kind === 'pwa' ? 'pwa' : 'capacitor'}.zip`);
      onNotice(kind === 'pwa' ? 'PWA ZIP ready: upload the folder to any HTTPS host.' : 'Capacitor project ZIP ready: follow README.md to build the APK / AAB / iOS app.');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-slate-900 to-cyan-500/10 border border-emerald-500/30">
        <h4 className="text-xs font-display font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
          <Smartphone className="w-4 h-4" />
          <span>Mobile App (PWA · Android · iOS)</span>
        </h4>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          Installable web app, or a Capacitor 8 project you build into an Android APK / AAB (target SDK 36) and an iOS app. The game runs on
          the same OmniStage Player, offline, with haptics, saved progress and pause in the background.
        </p>
      </div>

      {/* App identity */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
        <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">App details</h5>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-slate-400">App name</span>
            <input className={field} value={identity.appName} maxLength={40} onChange={(e) => set('appName', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">App id (reverse domain)</span>
            <input className={field} value={identity.appId} onChange={(e) => set('appId', e.target.value.trim())} />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Orientation</span>
            <select className={field} value={identity.orientation} onChange={(e) => set('orientation', e.target.value as AppIdentity['orientation'])}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
              <option value="any">Any</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Version</span>
            <input className={field} value={identity.version} onChange={(e) => set('version', e.target.value.trim())} />
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Build number (raise for every upload)</span>
            <input className={field} type="number" min={1} value={identity.versionCode} onChange={(e) => set('versionCode', Math.floor(Number(e.target.value) || 0))} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-slate-400">Theme</span>
              <input className={`${field} h-8 p-1`} type="color" value={identity.themeColor} onChange={(e) => set('themeColor', e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">Background</span>
              <input className={`${field} h-8 p-1`} type="color" value={identity.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} />
            </label>
          </div>
        </div>
        {idIssues.map((i) => (
          <p key={`${i.field}-${i.message}`} className={`text-[11px] flex items-center gap-1.5 ${i.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {i.message}
          </p>
        ))}
      </div>

      {/* Native capabilities */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
        <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Native features</h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {NATIVE_CAPABILITIES.map((c) => (
            <label
              key={c.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${c.status === 'ready' ? 'bg-slate-950 border-slate-800 cursor-pointer' : 'bg-slate-950/40 border-slate-900 opacity-60'}`}
            >
              <input type="checkbox" disabled={c.status !== 'ready'} checked={c.status === 'ready' && caps.includes(c.id)} onChange={() => toggleCap(c.id)} className="mt-0.5" />
              <div>
                <div className="font-semibold text-slate-200">
                  {c.label} {c.status === 'deferred' && <span className="text-[10px] text-slate-500 font-normal">(not yet)</span>}
                </div>
                <div className="text-[10px] text-slate-400">{c.note}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Mobile checks */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Phone checks</h5>
          <label className="ml-auto text-[11px] text-slate-400 flex items-center gap-1.5">
            Budget for
            <select className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-200" value={tier} onChange={(e) => setTier(e.target.value as DeviceTier)}>
              {DEVICE_TIERS.map((t) => (
                <option key={t} value={t}>{DEVICE_PROFILES[t].label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={fixActive}
            disabled={!activeFixable}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 disabled:opacity-40 flex items-center gap-1"
          >
            <Wand2 className="w-3.5 h-3.5" /> Fix this scene for phones
          </button>
        </div>
        {mobileIssues.length === 0 ? (
          <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Text size, touch targets, safe area and controls look good on phones.
          </p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {mobileIssues.map((i, idx) => (
              <li key={`${i.code}-${i.targetId}-${idx}`} className="text-[11px] text-amber-200">
                <span className="text-slate-500">{i.sceneTitle} ·</span> {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Performance profiles */}
      <details className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
        <summary className="text-xs font-semibold text-slate-200 uppercase tracking-wider cursor-pointer flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Performance profiles (device tiers)
        </summary>
        <p className="mt-2 text-slate-400">
          App builds detect the phone tier at start (cores, memory, GPU, screen) and adapt quality while playing: when frames stay
          slower than the target they lower post FX, pixel ratio, shadows and particles, and raise them again once the game runs
          smoothly. Ad exports and MP4 renders never change quality.
        </p>
        <table className="mt-2 w-full text-[10px]">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-normal">Tier</th>
              <th className="text-left font-normal">Target</th>
              <th className="text-left font-normal">3D actors / 2D nodes</th>
              <th className="text-left font-normal">Skinned verts · bones · tex</th>
              <th className="text-left font-normal">Particles · shader fx</th>
              <th className="text-left font-normal">Start quality</th>
            </tr>
          </thead>
          <tbody>
            {DEVICE_TIERS.map((t) => {
              const p = DEVICE_PROFILES[t];
              const q = QUALITY_LADDER[p.startRung];
              return (
                <tr key={t} className={t === tier ? 'text-cyan-200' : ''}>
                  <td title={p.examples}>{p.label}</td>
                  <td>{p.targetFps} fps</td>
                  <td>{p.budget.maxActors3D} / {p.budget.maxNodes2D}</td>
                  <td>{p.budget.maxSkinnedVertices / 1000}k · {p.budget.maxBones} · {p.budget.maxTextureSize}</td>
                  <td>{p.budget.maxParticles} · {p.budget.maxShaderEffects}</td>
                  <td>DPR ≤ {q.pixelRatioCap}, shadows {q.shadows}{q.postFx ? ', bloom' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 font-semibold text-slate-200">Read the profile report on a phone</p>
        <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
          <li>Tap the top-left corner of the game 5 times quickly: an overlay shows tier, fps (last / worst / average), the current quality and every step the governor took. "Copy JSON" copies the full report.</li>
          <li>PWA: open the URL with <code>?omniPerf=1</code>; force a tier with <code>?omniTier=low|mid|high</code>, keep the start quality with <code>?omniGovernor=0</code>.</li>
          <li>Debug APK: Chrome → <code>chrome://inspect</code> → console <code>__omniPlayer.perf()</code>. With saves on, the last report is also stored under <code>omnistage.perf.&lt;app id&gt;</code>.</li>
          <li>The budgets are reference estimates until measured: follow docs/mobile-performance.md and fill in real numbers.</li>
        </ul>
      </details>

      {/* Store assistant */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5 text-emerald-400" /> Store checklist
          </h5>
          <button onClick={captureScreenshot} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 border border-slate-700 text-slate-200">
            Capture screenshot ({screens.length})
          </button>
        </div>
        <ul className="space-y-1">
          {checklist.map((c) => (
            <li key={c.id} className={`text-[11px] flex items-start gap-1.5 ${c.status === 'ok' ? 'text-emerald-300' : c.status === 'warn' ? 'text-amber-300' : 'text-slate-300'}`}>
              <span className="w-3.5 shrink-0">{c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '○'}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-slate-500">The Capacitor ZIP includes store/checklist.md, a privacy policy draft and Data safety answers (no data collected).</p>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => void run('pwa')}
          disabled={!!busy}
          className="p-3 rounded-xl bg-slate-900 border border-emerald-500/40 hover:border-emerald-400 text-left disabled:opacity-50"
        >
          <div className="text-xs font-bold text-emerald-200 flex items-center gap-1.5">
            <Globe className="w-4 h-4" /> Download PWA (.zip)
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Manifest, offline service worker and icons. Host on HTTPS; players install it from the browser.</div>
        </button>
        <button
          onClick={() => void run('native')}
          disabled={!!busy}
          className="p-3 rounded-xl bg-slate-900 border border-cyan-500/40 hover:border-cyan-400 text-left disabled:opacity-50"
        >
          <div className="text-xs font-bold text-cyan-200 flex items-center gap-1.5">
            <Download className="w-4 h-4" /> Download Android / iOS project (.zip)
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Capacitor 8 project with build scripts, signing setup, Codemagic iOS workflow and store files.</div>
        </button>
      </div>
      {busy && <p className="text-[11px] text-slate-400">{busy}</p>}
    </div>
  );
};
