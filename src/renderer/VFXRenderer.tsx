import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { GpuParticles } from './GpuParticles';
import * as THREE from 'three';
import { VFXNode } from '../types/scene.schema';
import { BurstVFXInstance, useStudioStore } from '../state/useStudioStore';

interface VFXRendererProps {
  vfx: VFXNode;
}

function FloatingPromoBadgeSprite({
  labelText,
  accentColor,
}: {
  labelText: string;
  accentColor: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
      ctx.strokeStyle = accentColor || '#F59E0B';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 18);
      ctx.fill();
      ctx.stroke();

      ctx.font = '800 28px "Space Grotesk", Inter, sans-serif';
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`★ ${labelText.toUpperCase()}`.slice(0, 34), canvas.width / 2, canvas.height / 2 + 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [labelText, accentColor]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <sprite scale={[3.4, 0.52, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

export const VFXRenderer: React.FC<VFXRendererProps> = ({ vfx }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  const isPlaying = useStudioStore((s) => s.isPlaying);
  const currentTime = useStudioStore((s) => s.currentTime);
  const mode = useStudioStore((s) => s.sceneSpec.mode);

  const isWithinWindow =
    mode === 'game' ||
    ((vfx.startTime === undefined || currentTime >= vfx.startTime) &&
      (vfx.endTime === undefined || currentTime <= vfx.endTime));

  useFrame(() => {
    if (!isPlaying || !isWithinWindow) return;
    const t = Math.max(0, useStudioStore.getState().currentTime - (vfx.startTime ?? 0)) * (vfx.intensity ?? 1);

    if (vfx.type === 'shockwave') {
      if (ringRef.current) {
        const phase = (t * 0.85) % 1;
        const scale = 0.5 + phase * 3.2 * (vfx.scale ?? 1);
        ringRef.current.scale.set(scale, scale, 1);
        const mat = ringRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - phase) * 0.85;
      }
      if (ring2Ref.current) {
        const phase2 = (t * 0.85 + 0.5) % 1;
        const scale2 = 0.5 + phase2 * 3.2 * (vfx.scale ?? 1);
        ring2Ref.current.scale.set(scale2, scale2, 1);
        const mat2 = ring2Ref.current.material as THREE.MeshBasicMaterial;
        mat2.opacity = (1 - phase2) * 0.7;
      }
    }
    if (vfx.type === 'laser-beam' && beamRef.current) {
      const pulse = 0.85 + Math.sin(t * 6) * 0.25;
      beamRef.current.scale.set(pulse, 1, pulse);
    }

  });

  if (!isWithinWindow || vfx.visible === false) return null;

  switch (vfx.type) {
    case 'sparkles':
      return (
        <group position={vfx.position}>
          <GpuParticles kind="sparkles" count={96} spread={3.6}
            scale={vfx.scale ?? 1} size={0.09 * Math.max(0, vfx.intensity ?? 1)}
            color={vfx.color || '#38BDF8'} startTime={vfx.startTime} />
        </group>
      );

    case 'shockwave':
      return (
        <group position={[vfx.position[0], Math.max(0.03, vfx.position[1]), vfx.position[2]]}>
          <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.7, 0.85, 48]} />
            <meshBasicMaterial
              color={vfx.color}
              transparent
              opacity={0.75}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh ref={ring2Ref} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.7, 0.82, 48]} />
            <meshBasicMaterial
              color={vfx.color}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </group>
      );

    case 'laser-beam':
      return (
        <group position={vfx.position}>
          <mesh ref={beamRef} position={[0, 3.2, 0]}>
            <cylinderGeometry args={[0.14, 0.28, 6.4, 24, 1, true]} />
            <meshBasicMaterial
              color={vfx.color}
              transparent
              opacity={0.42}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <pointLight position={[0, 1.5, 0]} color={vfx.color} intensity={2.5} distance={6} />
        </group>
      );

    case 'floating-3d-badge':
      return (
        <group position={vfx.position}>
          <FloatingPromoBadgeSprite
            labelText={vfx.labelText || 'LIMITED DROP · 50% OFF'}
            accentColor={vfx.color || '#F59E0B'}
          />
        </group>
      );

    case 'confetti':
      return (
        <group position={vfx.position}>
          <GpuParticles kind="confetti" count={Math.floor(160 * Math.max(0, vfx.intensity ?? 1))}
            spread={3.6} scale={vfx.scale ?? 1} size={0.22} color={vfx.color || '#fbbf24'}
            startTime={vfx.startTime} />
        </group>
      );

    default:
      return null;
  }
};

/**
 * Transient Collision / Pickup Burst Effect Ring
 */
export const CollisionBurstRenderer: React.FC<{ burst: BurstVFXInstance }> = ({ burst }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const age = (Date.now() - burst.createdAt) / 600;
    if (age > 1) {
      meshRef.current.visible = false;
      return;
    }
    const scale = 0.4 + age * 2.6;
    meshRef.current.scale.set(scale, scale, 1);
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, (1 - age) * 0.9);
  });

  return (
    <group position={burst.position}>
      <GpuParticles kind="burst" count={72} size={0.13} spread={1}
        color={burst.color} createdAt={burst.createdAt} />
      <mesh ref={meshRef} position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.65, 32]} />
        <meshBasicMaterial color={burst.color} transparent opacity={0.9}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
};
