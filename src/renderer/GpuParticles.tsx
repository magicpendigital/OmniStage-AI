import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStudioStore } from '../state/useStudioStore';

type ParticleKind = 'rain' | 'snow' | 'floating-embers' | 'foggy-mist' | 'sparkles' | 'confetti' | 'burst';
const KINDS: ParticleKind[] = ['rain', 'snow', 'floating-embers', 'foggy-mist', 'sparkles', 'confetti', 'burst'];

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uKind;
  uniform float uSize;
  uniform float uViewportHeight;
  uniform float uMaxPointSize;
  attribute vec4 aSeed;
  varying float vAlpha;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    vec3 p = position;
    float t = uTime;
    float speed = 0.6 + aSeed.w * 0.8;
    vSeed = aSeed.w;
    vAlpha = 1.0;
    if (uKind < 0.5) {
      p.y = mod(position.y - t * 18.0 * speed, 24.0);
      p.x = mod(position.x - t * 1.5 + 24.0, 48.0) - 24.0;
    } else if (uKind < 1.5) {
      p.y = mod(position.y - t * 2.6 * speed, 24.0);
      p.x += sin(t * 0.6 + aSeed.x * 6.283) * 0.8;
      p.z += cos(t * 0.4 + aSeed.z * 6.283) * 0.5;
    } else if (uKind < 2.5) {
      p.y = mod(position.y + t * 2.2 * speed, 24.0);
      p.x += sin(t + aSeed.x * 6.283) * 0.6;
      vAlpha = sin(p.y / 24.0 * 3.14159);
    } else if (uKind < 3.5) {
      p.x += sin(t * 0.2 + aSeed.x * 6.283) * 2.0;
      p.y *= 0.25;
      vAlpha = 0.2;
    } else if (uKind < 4.5) {
      p += vec3(sin(t * 0.7 + aSeed.x * 6.283), cos(t * 0.5 + aSeed.y * 6.283), sin(t * 0.4 + aSeed.z * 6.283)) * 0.3;
      vAlpha = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * 2.0 + aSeed.w * 20.0), 3.0);
    } else if (uKind < 5.5) {
      p.y = mod(position.y - t * speed, 3.6);
      p.x += sin(t + aSeed.x * 6.283) * 0.5;
    } else {
      float age = clamp(t, 0.0, 1.0);
      p = normalize(vec3(aSeed.x - 0.5, aSeed.y * 0.7 + 0.1, aSeed.z - 0.5)) * age * (1.5 + aSeed.w * 2.0);
      p.y -= age * age * 1.6;
      vAlpha = (1.0 - age) * (1.0 - age);
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float worldScale = length(modelMatrix[0].xyz);
    gl_PointSize = clamp(uSize * worldScale * uViewportHeight * projectionMatrix[1][1] * 0.5 / max(0.1, -mvPosition.z), 1.0, uMaxPointSize);
    if (uSize <= 0.0) vAlpha = 0.0;
    if (mvPosition.z >= 0.0) gl_PointSize = 0.0;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uKind;
  varying float vAlpha;
  varying float vSeed;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float alpha;
    vec3 color = uColor;
    if (uKind < 0.5) {
      alpha = (1.0 - smoothstep(0.025, 0.10, abs(p.x))) * (1.0 - smoothstep(0.3, 0.5, abs(p.y)));
    } else if (uKind > 4.5 && uKind < 5.5) {
      float a = vSeed * 6.283;
      p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
      alpha = (1.0 - smoothstep(0.22, 0.28, abs(p.x))) * (1.0 - smoothstep(0.1, 0.16, abs(p.y)));
      color = mix(uColor, 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + vSeed * 6.283), 0.7);
    } else {
      alpha = pow(max(0.0, 1.0 - length(p) * 2.0), 2.0);
    }
    alpha *= vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Immutable seed buffers; all motion, recycling and fading run in the vertex shader. */
export function GpuParticles({ kind, count, color, size, spread = 48, scale = 1, startTime = 0, createdAt }: {
  kind: ParticleKind;
  count: number;
  color: string;
  size: number;
  spread?: number;
  scale?: number;
  startTime?: number;
  createdAt?: number;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const safeCount = Math.min(4096, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  const { positions, seeds } = useMemo(() => {
    const positions = new Float32Array(safeCount * 3);
    const seeds = new Float32Array(safeCount * 4);
    // Stable seed sequence makes timeline scrubbing and screenshot comparisons reproducible.
    let seed = 1234567;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < safeCount; i++) {
      const x = random(), y = random(), z = random(), w = random();
      seeds.set([x, y, z, w], i * 4);
      positions.set([(x - 0.5) * spread, y * (spread > 10 ? 24 : 3.6), (z - 0.5) * spread], i * 3);
    }
    return { positions, seeds };
  }, [safeCount, spread]);

  const uniforms = useMemo(() => THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uTime: { value: 0 }, uKind: { value: 0 }, uSize: { value: 1 }, uViewportHeight: { value: 1 },
      uMaxPointSize: { value: 64 }, uColor: { value: new THREE.Color() } },
  ]), []);

  useFrame(({ gl, size: viewportSize }) => {
    if (!material.current) return;
    const u = material.current.uniforms;
    u.uTime.value = createdAt === undefined
      ? Math.max(0, useStudioStore.getState().currentTime - startTime)
      : Math.max(0, (Date.now() - createdAt) / 600);
    u.uKind.value = KINDS.indexOf(kind);
    u.uSize.value = size;
    u.uColor.value.set(color);
    u.uViewportHeight.value = viewportSize.height * gl.getPixelRatio();
  });

  return (
    <points name={`GPU-${kind}`} scale={scale} frustumCulled={false}>
      <bufferGeometry key={`${safeCount}-${spread}`}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 4]} />
      </bufferGeometry>
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader}
        transparent depthWrite={false} fog
        blending={kind === 'floating-embers' || kind === 'sparkles' || kind === 'burst' ? THREE.AdditiveBlending : THREE.NormalBlending} />
    </points>
  );
}
