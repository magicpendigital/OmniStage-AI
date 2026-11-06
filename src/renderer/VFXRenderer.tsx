import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { VFXNode } from '../types/scene.schema';
import { useStudioStore } from '../state/useStudioStore';

interface VFXRendererProps {
  vfx: VFXNode;
}

export const VFXRenderer: React.FC<VFXRendererProps> = ({ vfx }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const confettiGroupRef = useRef<THREE.Group>(null);
  const isPlaying = useStudioStore((s) => s.isPlaying);

  const confettiItems = useMemo(() => {
    return Array.from({ length: 28 }).map((_, idx) => ({
      id: idx,
      offset: [
        (Math.sin(idx * 17.3) - 0.5) * 3.2,
        ((idx * 0.43) % 2.6) + 0.4,
        (Math.cos(idx * 23.1) - 0.5) * 3.2,
      ] as [number, number, number],
      speed: 0.8 + (idx % 5) * 0.25,
      color: ['#FBBF24', '#06B6D4', '#EC4899', '#10B981', '#8B5CF6'][idx % 5],
    }));
  }, []);

  useFrame((state) => {
    if (!isPlaying) return;
    const t = state.clock.getElapsedTime() * (vfx.intensity || 1);

    if (vfx.type === 'shockwave') {
      if (ringRef.current) {
        const phase = (t * 0.85) % 1;
        const scale = 0.5 + phase * 3.2 * (vfx.scale ?? 1);
        ringRef.current.scale.set(scale, scale, 1);
        const mat = ringRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - phase) * 0.85;
      }
      if (ring2Ref.current) {
        const phase2 = ((t * 0.85) + 0.5) % 1;
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

    if (vfx.type === 'confetti' && confettiGroupRef.current) {
      confettiGroupRef.current.rotation.y = t * 0.4;
    }
  });

  switch (vfx.type) {
    case 'sparkles':
      return (
        <group position={vfx.position}>
          <Sparkles
            count={42}
            scale={3.5 * (vfx.scale ?? 1)}
            size={3.2 * (vfx.intensity || 1)}
            speed={isPlaying ? 0.6 : 0}
            color={vfx.color || '#38BDF8'}
          />
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
          <Html center distanceFactor={9} zIndexRange={[20, 0]}>
            <div
              className="px-3.5 py-1.5 rounded-md border text-xs font-display font-bold tracking-wider uppercase whitespace-nowrap shadow-xl"
              style={{
                backgroundColor: '#090D16E6',
                borderColor: vfx.color || '#F59E0B',
                color: '#F8FAFC',
                boxShadow: `0 0 20px ${vfx.color || '#F59E0B'}40`,
              }}
            >
              <span style={{ color: vfx.color || '#F59E0B' }}>★ </span>
              {vfx.labelText || 'LIMITED DROP · 50% OFF'}
            </div>
          </Html>
        </group>
      );

    case 'confetti':
      return (
        <group ref={confettiGroupRef} position={vfx.position}>
          {confettiItems.map((item) => (
            <mesh key={item.id} position={item.offset} rotation={[item.id, item.id * 0.5, 0]}>
              <boxGeometry args={[0.12, 0.04, 0.08]} />
              <meshStandardMaterial
                color={item.color}
                emissive={item.color}
                emissiveIntensity={0.6}
                roughness={0.2}
              />
            </mesh>
          ))}
        </group>
      );

    default:
      return null;
  }
};
