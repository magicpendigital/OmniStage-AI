import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Bone as BoneIcon, Loader2, RotateCcw, Save, Upload, X } from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import { workspaceApi } from '../workspace/workspaceClient';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import type { CharacterCategory } from '../rig/analyze';
import { sampleHumanoid, sampleQuadruped } from '../rig/fixtures';
import type { RigSkeleton } from '../rig/skeleton';
import { stressPoses } from '../rig/skin';
import { exportRiggedGlb, rerig, rigCharacter, RigResult } from '../rig/omnirig3d';

type Source = { name: string; root: THREE.Object3D };
const REST = '__rest';

const SAMPLE_MODELS = ['gltf-soldier', 'gltf-robot-expressive', 'gltf-fox', 'gltf-horse'].filter((id) => ASSET_REGISTRY[id]?.modelUrl);

function sampleObject(kind: 'humanoid' | 'quadruped'): THREE.Object3D {
  const data = kind === 'humanoid' ? sampleHumanoid() : sampleQuadruped();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  g.setIndex(Array.from(data.indices));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: kind === 'humanoid' ? '#60a5fa' : '#f59e0b', roughness: 0.6 }));
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

const GRADE_COLOR: Record<string, string> = { A: 'text-emerald-300', B: 'text-lime-300', C: 'text-amber-300', D: 'text-rose-300' };

/**
 * Phase 9 — OmniRig: auto-rig a character model (humanoid / quadruped / prop), check it with stress poses, fix joints by
 * dragging them, preview the generated clips, then save the rigged GLB (+ rig.json) to My Library and place it.
 */
export const OmniRigModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const registerAndSpawnCustomAsset = useStudioStore((s) => s.registerAndSpawnCustomAsset);
  const workspaceAvailable = useStudioStore((s) => s.workspaceAvailable);
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<RigResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clip, setClip] = useState<string>('Idle');
  const [stress, setStress] = useState<string | null>(null);
  const [name, setName] = useState('My character');
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; mixer?: THREE.AnimationMixer; content?: THREE.Object3D; joints: THREE.Mesh[]; raf: number } | null>(null);
  const editedSkeleton = useRef<RigSkeleton | null>(null);

  // ---------------------------------------------------------------- 3D preview
  useEffect(() => {
    const host = canvasHost.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1020');
    scene.add(new THREE.HemisphereLight('#ffffff', '#334155', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(2, 4, 3);
    scene.add(key, new THREE.GridHelper(4, 16, '#334155', '#1e293b'));
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(1.6, 1.4, 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    const clock = new THREE.Clock();
    const state = { renderer, scene, camera, controls, joints: [] as THREE.Mesh[], raf: 0 };
    view.current = state;
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const loop = () => {
      state.raf = requestAnimationFrame(loop);
      (view.current as any)?.mixer?.update(clock.getDelta());
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    // joint dragging: move along the camera plane, re-rig on release
    const ray = new THREE.Raycaster();
    let drag: { mesh: THREE.Mesh; plane: THREE.Plane } | null = null;
    const ndc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const down = (e: PointerEvent) => {
      ray.setFromCamera(ndc(e), camera);
      const hit = ray.intersectObjects(state.joints.filter((j) => j.visible), false)[0];
      if (!hit) return;
      controls.enabled = false;
      const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
      drag = { mesh: hit.object as THREE.Mesh, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.object.position) };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      ray.setFromCamera(ndc(e), camera);
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(drag.plane, p)) {
        drag.mesh.position.copy(p);
        // keep left / right symmetric
        const twin = state.joints.find((j) => j.userData.bone === mirrorName(drag!.mesh.userData.bone));
        if (twin && twin !== drag.mesh) twin.position.set(-p.x, p.y, p.z);
      }
    };
    const up = () => {
      if (!drag) return;
      controls.enabled = true;
      drag = null;
      const sk = editedSkeleton.current;
      if (!sk) return;
      for (const j of state.joints) {
        const b = sk.bones.find((x) => x.name === j.userData.bone);
        if (b) b.head = [j.position.x, j.position.y, j.position.z];
      }
      window.dispatchEvent(new CustomEvent('omnirig-joints-moved'));
    };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    return () => {
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      host.replaceChildren();
      view.current = null;
    };
  }, []);

  // show the current result (or the raw source)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.content) v.scene.remove(v.content);
    v.joints = [];
    v.mixer = undefined;
    if (!result) {
      if (source) {
        v.content = source.root;
        v.scene.add(source.root);
      }
      return;
    }
    const group = new THREE.Group();
    group.add(result.object);
    group.add(new THREE.SkeletonHelper(result.object));
    const jointMat = new THREE.MeshBasicMaterial({ color: '#fbbf24', depthTest: false, transparent: true, opacity: 0.9 });
    const r = result.report.height * 0.018;
    for (const b of result.skeleton.bones) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), jointMat);
      s.position.set(...b.head);
      s.renderOrder = 10;
      s.userData.bone = b.name;
      group.add(s);
      v.joints.push(s);
    }
    v.content = group;
    v.scene.add(group);
    v.controls.target.set(0, result.report.height * 0.5, 0);
    v.camera.position.set(result.report.height * 0.9, result.report.height * 0.8, result.report.height * 1.9);
    v.mixer = new THREE.AnimationMixer(result.object);
    editedSkeleton.current = { ...result.skeleton, bones: result.skeleton.bones.map((b) => ({ ...b, head: [...b.head] as typeof b.head })) };
  }, [result, source]);

  // play the chosen clip or hold a stress pose
  useEffect(() => {
    const v = view.current;
    if (!v?.mixer || !result) return;
    v.mixer.stopAllAction();
    result.object.traverse((o) => { if ((o as THREE.Bone).isBone) (o as THREE.Bone).quaternion.identity(); });
    if (stress) {
      const pose = stressPoses(result.skeleton).find((p) => p.name === stress);
      result.object.traverse((o) => {
        const q = pose?.pose[o.name];
        if (q && (o as THREE.Bone).isBone) (o as THREE.Bone).quaternion.set(q[0], q[1], q[2], q[3]);
      });
      return;
    }
    const c = result.animations.find((a) => a.name === clip);
    if (c) v.mixer.clipAction(c).reset().play();
  }, [clip, stress, result]);

  // joint handles only in the rest pose (they mark the rest joints, so they would float while a clip plays)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const editing = clip === REST && !stress;
    for (const j of v.joints) j.visible = editing;
  }, [clip, stress, result]);

  // ---------------------------------------------------------------- pipeline
  const run = (src: Source, forceCategory?: CharacterCategory) => {
    setBusy('Analysing and rigging…');
    setError(null);
    setNotice(null);
    setStress(null);
    setTimeout(() => {
      try {
        const res = rigCharacter(src.root, { forceCategory });
        setResult(res);
        // doubtful joints → open in the joint editor, otherwise show the idle clip
        const doubtful = Object.values(res.skeleton.confidence).some((c) => c < 0.6) || res.validation.grade === 'D';
        setClip(doubtful ? REST : 'Idle');
      } catch (e) {
        setError((e as Error).message || 'Rigging failed');
      } finally {
        setBusy(null);
      }
    }, 30);
  };

  useEffect(() => {
    const onMoved = () => {
      if (!result || !editedSkeleton.current) return;
      setBusy('Re-rigging with your joints…');
      setTimeout(() => {
        try {
          setResult(rerig(result, editedSkeleton.current!));
        } finally {
          setBusy(null);
        }
      }, 30);
    };
    window.addEventListener('omnirig-joints-moved', onMoved);
    return () => window.removeEventListener('omnirig-joints-moved', onMoved);
  }, [result]);

  const loadFile = async (file: File) => {
    setBusy('Loading model…');
    try {
      const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
      const src = { name: file.name.replace(/\.[^.]+$/, ''), root: gltf.scene };
      setName(src.name);
      setSource(src);
      setResult(null);
      run(src);
    } catch (e) {
      setBusy(null);
      setError(`Could not read ${file.name}: ${(e as Error).message}`);
    }
  };

  const loadUrl = async (assetId: string) => {
    const entry = ASSET_REGISTRY[assetId];
    setBusy('Loading model…');
    try {
      const gltf = await new GLTFLoader().loadAsync(entry.modelUrl!);
      const src = { name: entry.name, root: gltf.scene };
      setName(`${entry.name} (OmniRig)`);
      setSource(src);
      setResult(null);
      run(src);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
    }
  };

  const save = async () => {
    if (!result) return;
    setBusy('Exporting rigged GLB…');
    setError(null);
    try {
      const glb = await exportRiggedGlb(result);
      const file = new File([glb], `${name.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 40) || 'character'}.glb`, { type: 'model/gltf-binary' });
      const box = new THREE.Box3().setFromObject(result.mesh);
      const size = box.getSize(new THREE.Vector3());
      const entry = {
        category: 'gltf-rigged' as const,
        description: `OmniRig ${result.report.category} (grade ${result.validation.grade}).`,
        embeddedClips: result.clips.map((c) => c.name),
        defaultClip: 'Idle',
        defaultPhysicsRole: 'static' as const,
        defaultClickAction: 'none' as const,
        boundingBox: { width: +size.x.toFixed(2), height: +size.y.toFixed(2), depth: +size.z.toFixed(2) },
        attachmentSockets: { ground: [0, 0, 0] as [number, number, number], top_badge: [0, +(size.y + 0.3).toFixed(2), 0] as [number, number, number] },
      };
      if (workspaceAvailable) {
        const asset = await workspaceApi.uploadToLibrary('personal', file, { tags: ['rigged', 'omnirig', result.report.category], source: 'omnirig' });
        await workspaceApi.updateAsset('personal', asset.id, { name, kind: 'model', meta: { rig: result.rigJson } });
        registerAndSpawnCustomAsset(name, workspaceApi.assetUrl('personal', asset.id), 'glb', entry);
        setNotice(`Saved to My Library (rigged GLB + rig.json, grade ${result.validation.grade}) and added to the scene.`);
      } else {
        registerAndSpawnCustomAsset(name, URL.createObjectURL(file), 'glb', entry);
        setNotice('Added to the scene (My Library needs OmniStage running locally to keep the file).');
      }
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const r = result;
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="OmniRig">
      <div className="w-full max-w-5xl h-[86vh] flex flex-col rounded-2xl bg-[#090D16] border border-slate-800 shadow-2xl text-xs text-slate-200">
        <div className="flex items-center justify-between p-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <BoneIcon className="w-5 h-5 text-amber-300" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">OmniRig — auto-rig a character</h2>
              <p className="text-slate-400">GLB in → skeleton, skin weights, stress-pose check and animations out. Drag the yellow joints to fix them.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_300px]">
          <div className="relative min-h-[260px]">
            <div ref={canvasHost} className="absolute inset-0" />
            {!source && !busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <p className="text-slate-400">Load a character (.glb) — T- or A-pose humanoids, four-legged animals or props.</p>
              </div>
            )}
            {busy && (
              <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" /> {busy}
              </div>
            )}
          </div>
          <div className="border-l border-slate-800 p-3 space-y-3 overflow-y-auto">
            <div className="space-y-1.5">
              <label className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-100 cursor-pointer hover:bg-amber-500/25">
                <Upload className="w-3.5 h-3.5" /> Load .glb / .gltf
                <input type="file" accept=".glb,.gltf" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
              </label>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" onClick={() => { const s = { name: 'Sample humanoid', root: sampleObject('humanoid') }; setName(s.name); setSource(s); run(s); }}>Sample humanoid</button>
                <button type="button" className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" onClick={() => { const s = { name: 'Sample quadruped', root: sampleObject('quadruped') }; setName(s.name); setSource(s); run(s); }}>Sample quadruped</button>
                {SAMPLE_MODELS.map((id) => (
                  <button key={id} type="button" className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" onClick={() => loadUrl(id)} title="Re-rig a built-in model">{ASSET_REGISTRY[id].name.replace(/\s*\(.*\)/, '')}</button>
                ))}
              </div>
            </div>

            {error && <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-rose-200">{error}</div>}
            {notice && <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-200">{notice}</div>}

            {r && (
              <>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">Analysis</span>
                    <span className={`text-lg font-black ${GRADE_COLOR[r.validation.grade]}`} title={`Rig quality ${r.validation.score}/100`}>{r.validation.grade}</span>
                  </div>
                  <div className="text-slate-400">{r.report.triangles.toLocaleString()} triangles · up {r.report.frame.upAxis} · facing {r.report.frame.facingAxis} · symmetry {Math.round(r.report.symmetry * 100)} %</div>
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-400">Type</span>
                    <select value={r.report.category} onChange={(e) => source && run(source, e.target.value as CharacterCategory)} className="flex-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700">
                      <option value="humanoid">Humanoid</option>
                      <option value="quadruped">Four-legged</option>
                      <option value="prop">Prop (one piece)</option>
                    </select>
                    <span className="text-slate-500">{Math.round(r.report.categoryConfidence * 100)} %</span>
                  </label>
                  {r.report.categoryConfidence < 0.7 && <p className="text-amber-300">Not sure about the type — pick the right one above.</p>}
                  {[...r.report.warnings, ...r.skeleton.warnings].map((w) => <p key={w} className="text-amber-200/90">• {w}</p>)}
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <div className="font-semibold text-slate-100">Stress test · {r.validation.score}/100</div>
                  {r.validation.poses.map((p) => (
                    <button key={p.name} type="button" onClick={() => setStress(stress === p.name ? null : p.name)}
                      className={`w-full flex justify-between px-1.5 py-0.5 rounded ${stress === p.name ? 'bg-amber-500/20' : 'hover:bg-slate-800'}`}
                      title={`stretch ${(p.stretchP95 * 100).toFixed(1)} % · volume ${(p.volumeChange * 100).toFixed(1)} % · flipped ${(p.flipped * 100).toFixed(1)} %`}>
                      <span>{p.name}</span><span className="font-mono">{Math.round(p.score)}</span>
                    </button>
                  ))}
                  <div className="text-[10px] text-slate-500">Joint confidence: {Object.entries(r.skeleton.confidence).map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(' · ')}</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-slate-100">Animations</div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => { setStress(null); setClip(REST); }}
                      className={`px-2 py-0.5 rounded ${!stress && clip === REST ? 'bg-amber-500/30 text-amber-100' : 'bg-slate-800 hover:bg-slate-700'}`}
                      title="Stop and show the joints: drag a yellow joint to move it (left / right stay mirrored), the rig is rebuilt when you let go">
                      Rest pose · edit joints
                    </button>
                    {r.clips.map((c) => (
                      <button key={c.name} type="button" onClick={() => { setStress(null); setClip(c.name); }}
                        className={`px-2 py-0.5 rounded ${!stress && clip === c.name ? 'bg-cyan-500/30 text-cyan-100' : 'bg-slate-800 hover:bg-slate-700'}`}>{c.name}</button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700" placeholder="Character name" />
                  <button type="button" onClick={save} disabled={!!busy} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold disabled:opacity-50">
                    <Save className="w-3.5 h-3.5" /> Save to My Library & add to scene
                  </button>
                  <button type="button" onClick={() => source && run(source, r.report.category)} disabled={!!busy} className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50">
                    <RotateCcw className="w-3.5 h-3.5" /> Re-rig from scratch
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function mirrorName(n: string): string {
  if (n.includes('Left')) return n.replace('Left', 'Right');
  if (n.includes('Right')) return n.replace('Right', 'Left');
  return n;
}
