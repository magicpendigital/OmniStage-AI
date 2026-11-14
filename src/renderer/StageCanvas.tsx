import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { configureRenderer } from '../render3d/stage3d';
import { createBloom } from '../render3d/postfx';
import { useStudioStore } from '../state/useStudioStore';
import { SceneDirector } from './SceneDirector';

const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
})();

/** Takes over R3F's render loop (useFrame priority 1) and renders through the shared bloom composer. */
function StudioBloom() {
  const { gl, scene, camera, size, viewport } = useThree();
  const fx = React.useMemo(() => createBloom(gl, scene, camera), [gl, scene]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => fx.dispose(), [fx]);
  React.useEffect(() => fx.setSize(size.width, size.height, viewport.dpr), [fx, size.width, size.height, viewport.dpr]);
  useFrame((_, delta) => {
    fx.setCamera(camera);
    fx.render(delta);
  }, 1);
  return null;
}

export const StageCanvas: React.FC = () => {
  const cameraSpec = useStudioStore((s) => s.sceneSpec.camera);
  const setCanvasElement = useStudioStore((s) => s.setCanvasElement);
  // Phase 7B: the viewport quality selector — draft = DPR 1, no shadows (what weak phones get in the Player).
  const quality = useStudioStore((s) => s.settings.renderQuality);
  const draft = isSoftwareGl || quality === 'draft';
  // Phase 7C: Ultra quality adds bloom (the same post-processing the Player uses at quality=ultra).
  const bloom = useStudioStore((s) => s.settings.renderQuality === 'ultra-postprocessing' && s.settings.enableBloom) && !draft;

  return (
    <div className="relative w-full h-full select-none">
      <Canvas
        shadows={!draft}
        dpr={draft ? 1 : [1, 2]}
        camera={{
          position: cameraSpec.position,
          fov: cameraSpec.fov || 45,
          near: 0.1,
          far: 100,
        }}
        gl={{
          preserveDrawingBuffer: true, // Mandatory for instant PNG snapshot & MediaRecorder video capture
          antialias: !isSoftwareGl,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl }) => {
          configureRenderer(gl); // same colour pipeline as the OmniStage Player
          setCanvasElement(gl.domElement);
        }}
      >
        <SceneDirector />
        {bloom && <StudioBloom />}
      </Canvas>
    </div>
  );
};
