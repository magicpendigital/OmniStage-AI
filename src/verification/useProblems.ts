import { useEffect, useMemo, useState } from 'react';
import { useStudioStore } from '../state/useStudioStore';
import { verifySceneSpec } from './sceneVerifier';
import type { SceneSpec, VerificationReport } from '../types/scene.schema';

/** One report per spec object, shared by the dock badge and the Problems panel. */
const cache = new WeakMap<SceneSpec, { scenes: SceneSpec[]; report: VerificationReport }>();

function reportFor(spec: SceneSpec, scenes: SceneSpec[]): VerificationReport {
  const hit = cache.get(spec);
  if (hit && hit.scenes === scenes) return hit.report;
  const report = verifySceneSpec(spec, { scenes });
  cache.set(spec, { scenes, report });
  return report;
}

/**
 * Live verifier result for the open scene. The check re-runs shortly after edits stop (not on every slider tick) and is
 * the same `verifySceneSpec` the AI Director and Export use, so what you see here is what would block a publish.
 */
export function useProblems(delayMs = 350): { report: VerificationReport; spec: SceneSpec; scenes: SceneSpec[] } {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const scenesState = useStudioStore((s) => s.scenes);
  const [settled, setSettled] = useState(sceneSpec);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(sceneSpec), delayMs);
    return () => window.clearTimeout(t);
  }, [sceneSpec, delayMs]);
  const scenes = useMemo(() => (scenesState.length ? scenesState.map((s) => (s.id === settled.id ? settled : s)) : [settled]), [scenesState, settled]);
  const report = useMemo(() => reportFor(settled, scenes), [settled, scenes]);
  return { report, spec: settled, scenes };
}
