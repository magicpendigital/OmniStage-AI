/**
 * Phase 9 — OmniRig Web Worker: runs the pure pipeline (`pipeline.ts`) off the main thread so big meshes do not freeze
 * the studio. Messages: { id, kind: 'rig', data, opts } | { id, kind: 'skin', mesh, skeleton }.
 */
import { handleRigJob, type RigJob } from './rigJobs';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<RigJob>) => void) | null; postMessage: (msg: unknown, transfer?: Transferable[]) => void };

ctx.onmessage = (e) => {
  const reply = handleRigJob(e.data);
  ctx.postMessage(reply.message, reply.transfer);
};
