import React from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
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

export const StageCanvas: React.FC = () => {
  const cameraSpec = useStudioStore((s) => s.sceneSpec.camera);
  const setCanvasElement = useStudioStore((s) => s.setCanvasElement);

  return (
    <div className="relative w-full h-full select-none">
      <Canvas
        shadows={!isSoftwareGl}
        dpr={isSoftwareGl ? 1 : [1, 2]}
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
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
          setCanvasElement(gl.domElement);
        }}
      >
        <SceneDirector />
      </Canvas>
    </div>
  );
};
