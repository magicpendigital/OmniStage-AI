/**
 * Publish → Godot 4 project: converts every scene into a Godot 4.x project (tscn + GDScript + embedded GLB / images).
 * Features Godot cannot receive are listed before the download and written to OMNISTAGE_EXPORT_NOTES.md.
 */
import React from 'react';
import { AlertCircle, Box, Check, Download, Loader2 } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { previewOrder } from '../playtest/previewOrder';
import { downloadBlob, slugifyTitle } from '../exporter/mediaExporter';
import { defaultFetcher } from '../exporter/playerHtml';
import { formatBytes } from '../exporter/playableBundle';
import { buildGodotZip, GODOT_NOTES_FILE, GodotAssetFile, godotAssetUrls } from '../exporter/godotExport';

type Prepared = Awaited<ReturnType<typeof buildGodotZip>>;

export const GodotExportPanel: React.FC<{ onNotice: (msg: string) => void }> = ({ onNotice }) => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenes = useStudioStore((s) => s.scenes);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [prepared, setPrepared] = React.useState<Prepared | null>(null);

  const all = React.useMemo(() => (scenes.length ? scenes.map((s) => (s.id === sceneSpec.id ? sceneSpec : s)) : [sceneSpec]), [scenes, sceneSpec]);
  // Any edit invalidates the prepared project, so the download always matches the studio.
  React.useEffect(() => setPrepared(null), [all]);

  const projectName = all.length > 1 ? sceneSpec.sequence?.storyboardTitle || sceneSpec.title : sceneSpec.title;
  const fileName = `${slugifyTitle(projectName || 'omnistage')}-godot.zip`;

  const prepare = async () => {
    setBusy('Downloading models and images…');
    setError(null);
    try {
      const assets: Record<string, GodotAssetFile> = {};
      const failedAssets: Array<{ url: string; reason: string }> = [];
      await Promise.all(
        godotAssetUrls(all).map(async (url) => {
          try {
            assets[url] = await defaultFetcher(url);
          } catch (e) {
            failedAssets.push({ url, reason: e instanceof Error ? e.message : String(e) });
          }
        })
      );
      setBusy('Writing Godot scenes…');
      const mainSceneId = previewOrder(all, sceneSpec.id)[0] || sceneSpec.id;
      setPrepared(await buildGodotZip(all, { projectName, mainSceneId, assets, failedAssets }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    if (!prepared) return;
    downloadBlob(new Blob([prepared.zip as BlobPart], { type: 'application/zip' }), fileName);
    onNotice(`Godot project saved as ${fileName}.`);
  };

  const byScene = React.useMemo(() => {
    const map = new Map<string, Prepared['warnings']>();
    for (const w of prepared?.warnings || []) map.set(w.scene, [...(map.get(w.scene) || []), w]);
    return [...map.entries()];
  }, [prepared]);

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-bold text-white">Godot 4 project</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Converts {all.length === 1 ? 'this scene' : `all ${all.length} scenes`} into a Godot 4.3+ project: one <code className="text-slate-300">.tscn</code> per
          scene with cameras, lights, environment, collision shapes, sprites and labels, plus fixed GDScript for movement, score, collectibles, win / lose and
          scene links. GLB models and images are copied into the project. Anything Godot cannot receive is listed below and in{' '}
          <code className="text-slate-300">{GODOT_NOTES_FILE}</code>.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={prepare}
            disabled={!!busy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-semibold text-white"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5" />}
            {busy || (prepared ? 'Prepare again' : 'Prepare Godot project')}
          </button>
          {prepared && (
            <button
              onClick={download}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
            >
              <Download className="w-3.5 h-3.5" />
              Download ZIP ({formatBytes(prepared.zip.byteLength)})
            </button>
          )}
        </div>
        {error && (
          <div className="flex items-start gap-2 text-xs text-rose-300">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {prepared && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide">Scenes</h4>
            <ul className="space-y-1">
              {prepared.scenes.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-xs text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{s.title}</span>
                  <span className="text-slate-500">
                    {s.engineType.toUpperCase()} · {s.mode}
                  </span>
                  {s.path === prepared.mainScene && <span className="text-[10px] px-1.5 rounded bg-sky-900/60 text-sky-300">main</span>}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500 pt-1">
              {prepared.files.length} files. Open <code>project.godot</code> in Godot 4.3 or newer and press F5.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide">
              Not converted ({prepared.warnings.length})
            </h4>
            {prepared.warnings.length === 0 ? (
              <p className="text-xs text-emerald-300">Every feature in these scenes has a Godot equivalent.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                {byScene.map(([scene, list]) => (
                  <div key={scene} className="space-y-1">
                    <div className="text-[11px] font-semibold text-slate-400">{scene}</div>
                    {list.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-amber-200/90">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                        <span>
                          <span className="font-semibold">{w.feature}:</span> {w.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
