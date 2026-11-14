/**
 * Phase 9 — OmniRig job protocol shared by the Web Worker and the main thread. `runRigJob` posts to the worker and falls
 * back to running inline when workers are unavailable (node tests, old browsers) or the worker fails to start.
 */
import type { CharacterCategory, MeshData } from './analyze';
import type { RigSkeleton } from './skeleton';
import { rigMeshData, skinStage, type CoreRigResult, type SkinStage } from './pipeline';

export type RigJob =
  | { id: number; kind: 'rig'; data: MeshData; opts: { forceCategory?: CharacterCategory; skeleton?: RigSkeleton } }
  | { id: number; kind: 'skin'; mesh: MeshData; skeleton: RigSkeleton };

export type RigReply = { id: number; ok: true; result: CoreRigResult | SkinStage } | { id: number; ok: false; error: string };

/** Runs one job; also lists the big buffers to transfer back instead of copying. */
export function handleRigJob(job: RigJob): { message: RigReply; transfer: Transferable[] } {
  try {
    const result = job.kind === 'rig' ? rigMeshData(job.data, job.opts) : skinStage(job.mesh, job.skeleton);
    const transfer: Transferable[] = [result.skin.indices.buffer, result.skin.weights.buffer];
    if (job.kind === 'rig') transfer.push((result as CoreRigResult).positions.buffer);
    return { message: { id: job.id, ok: true, result }, transfer };
  } catch (e) {
    return { message: { id: job.id, ok: false, error: (e as Error)?.message || String(e) }, transfer: [] };
  }
}

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (r: CoreRigResult | SkinStage) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = new Worker(new URL('./rig.worker.ts', import.meta.url), { type: 'module', name: 'omnirig' });
    worker.onmessage = (e: MessageEvent<RigReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      // a worker that cannot load (bundling / CSP) → reject what is waiting and use the main thread from now on
      e.preventDefault?.();
      worker?.terminate();
      worker = null;
      for (const [, p] of pending) p.reject(new Error('worker-failed'));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Where the last job ran (shown in the UI and used by the browser check). */
export let lastRigJobThread: 'worker' | 'main' = 'main';

function inline(job: Omit<RigJob, 'id'>): CoreRigResult | SkinStage {
  lastRigJobThread = 'main';
  const j = job as RigJob;
  return j.kind === 'rig' ? rigMeshData(j.data, j.opts) : skinStage(j.mesh, j.skeleton);
}

/** Runs a rig job in the worker (input arrays are copied, so the caller keeps its own). */
export function runRigJob(job: Omit<Extract<RigJob, { kind: 'rig' }>, 'id'>): Promise<CoreRigResult>;
export function runRigJob(job: Omit<Extract<RigJob, { kind: 'skin' }>, 'id'>): Promise<SkinStage>;
export function runRigJob(job: Omit<RigJob, 'id'>): Promise<CoreRigResult | SkinStage> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => inline(job));
  const id = nextId++;
  return new Promise<CoreRigResult | SkinStage>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...job, id });
  }).then(
    (r) => { lastRigJobThread = 'worker'; return r; },
    (e: Error) => (e.message === 'worker-failed' ? inline(job) : Promise.reject(e))
  );
}
