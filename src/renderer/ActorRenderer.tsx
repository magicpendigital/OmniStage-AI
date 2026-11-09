import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree, ThreeEvent } from '@react-three/fiber';
import { TransformControls, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { configureActorLoader } from './actorLoader';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationCrossFade } from './animationCrossFade';
import { ActorNode } from '../types/scene.schema';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { useStudioStore } from '../state/useStudioStore';

interface ActorRendererProps {
  actor: ActorNode;
  isSelected: boolean;
  onRuntimeClick?: (actorId: string) => boolean;
}

function CanvasBadgeSprite({
  text,
  position,
  borderColor = '#06B6D4',
  textColor = '#67E8F9',
}: {
  text: string;
  position: [number, number, number];
  borderColor?: string;
  textColor?: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 14);
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 22px "JetBrains Mono", monospace';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.slice(0, 38), canvas.width / 2, canvas.height / 2 + 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [text, borderColor, textColor]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <sprite position={position} scale={[2.6, 0.36, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

function RiggedGltfModel({
  url,
  actor,
}: {
  url: string;
  actor: ActorNode;
}) {
  const gl = useThree((s) => s.gl);
  const configureLoader = useMemo(() => (loader: GLTFLoader) => configureActorLoader(loader, gl), [gl]);
  const { scene, animations } = useLoader(GLTFLoader, url, configureLoader);
  const isPlaying = useStudioStore((s) => s.isPlaying);

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  const { ref, actions, names, mixer } = useAnimations(animations, clonedScene);
  const crossFade = useMemo(() => new AnimationCrossFade(mixer), [mixer, animations]);

  useEffect(() => () => {
    // SkeletonUtils shares geometry/materials with the cache, but bone textures
    // belong to this instance and must be released when the actor is removed.
    const skeletons = new Set<THREE.Skeleton>();
    clonedScene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((child as THREE.SkinnedMesh).skeleton);
    });
    skeletons.forEach((skeleton) => skeleton.dispose());
  }, [clonedScene]);

  // Clip discovery must not rewrite future graph actions via syncGraphWithScene.
  useEffect(() => {
    useStudioStore.setState((state) => {
      const current = state.sceneSpec.actors.find((a) => a.id === actor.id);
      if (!current || (current.availableClips?.length === names.length &&
          current.availableClips.every((clip, index) => clip === names[index]))) return state;
      return { sceneSpec: { ...state.sceneSpec, actors: state.sceneSpec.actors.map((a) => a.id === actor.id
        ? { ...a, availableClips: [...names], activeClip: a.activeClip || names[0] } : a) } };
    });
  }, [actor.id, names]);

  // Clip selection is independent from pause/speed: neither should reset bones.
  useEffect(() => {
    if (!actions || names.length === 0) return;

    const requestedClip =
      actor.activeClip && actions[actor.activeClip]
        ? actor.activeClip
        : names.find((n) => n.toLowerCase().includes(actor.activeAnimation.toLowerCase())) ||
          names[0];

    const target = actions[requestedClip];
    if (target) crossFade.select(target);
  }, [actions, names, actor.activeClip, actor.activeAnimation, crossFade]);

  useEffect(() => {
    mixer.timeScale = isPlaying ? 1 : 0;
  }, [mixer, isPlaying]);

  useEffect(() => {
    Object.values(actions).forEach((action) => action?.setEffectiveTimeScale(actor.animationSpeed ?? 1));
  }, [actions, actor.animationSpeed]);

  useFrame(() => crossFade.update());
  useEffect(() => () => crossFade.dispose(), [crossFade]);

  const defaultScale = ASSET_REGISTRY[actor.assetId]?.defaultScale ?? 1;

  return (
    <group ref={ref as any} scale={defaultScale} dispose={null}>
      <primitive object={clonedScene} />
    </group>
  );
}

class GlbErrorBoundary extends React.Component<
  { resetKey?: string; fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { resetKey?: string; fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prevProps: { resetKey?: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * Multi-Part Procedural PBR Composite Meshes (3–12 distinct parts per asset)
 * All models pivot at bottom-center (y = 0) so they sit flush on the studio floor.
 */
function CompositeProceduralMesh({
  actor,
  unboxTapCount = 0,
}: {
  actor: ActorNode;
  unboxTapCount?: number;
}) {
  const primary = actor.primaryColor || '#06B6D4';
  const secondary = actor.secondaryColor || '#F59E0B';
  const metalness = actor.metalness ?? 0.8;
  const roughness = actor.roughness ?? 0.22;

  switch (actor.assetId) {
    case 'mystery-gift-box': {
      const glowBoost = 0.6 + unboxTapCount * 1.1;
      const lidLift = unboxTapCount * 0.14;
      return (
        <group>
          {/* 1: Main Luxury Vault Cube */}
          <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.42, 1.44, 1.42]} />
            <meshStandardMaterial color={primary} metalness={0.65} roughness={0.28} />
          </mesh>
          {/* 2-3: Crossed Golden Satin Ribbons */}
          <mesh position={[0, 0.72, 0]} castShadow>
            <boxGeometry args={[1.46, 1.46, 0.26]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={glowBoost}
              metalness={0.92}
              roughness={0.14}
            />
          </mesh>
          <mesh position={[0, 0.72, 0]} castShadow>
            <boxGeometry args={[0.26, 1.46, 1.46]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={glowBoost}
              metalness={0.92}
              roughness={0.14}
            />
          </mesh>
          {/* 4: Stepped Vault Lid (lifts slightly as user taps) */}
          <group position={[0, 1.48 + lidLift, 0]}>
            <mesh castShadow>
              <boxGeometry args={[1.54, 0.24, 1.54]} />
              <meshStandardMaterial color={primary} metalness={0.78} roughness={0.2} />
            </mesh>
            {/* 5-6: Top Ribbon Bow Loops */}
            <mesh position={[-0.22, 0.24, 0]} rotation={[0, 0, Math.PI / 4]}>
              <torusGeometry args={[0.2, 0.055, 14, 28]} />
              <meshStandardMaterial
                color={secondary}
                emissive={secondary}
                emissiveIntensity={glowBoost}
                metalness={0.95}
                roughness={0.12}
              />
            </mesh>
            <mesh position={[0.22, 0.24, 0]} rotation={[0, 0, -Math.PI / 4]}>
              <torusGeometry args={[0.2, 0.055, 14, 28]} />
              <meshStandardMaterial
                color={secondary}
                emissive={secondary}
                emissiveIntensity={glowBoost}
                metalness={0.95}
                roughness={0.12}
              />
            </mesh>
          </group>
          {/* 7: Internal Mystery Core Glow */}
          <pointLight
            position={[0, 1.2, 0]}
            color={secondary}
            intensity={1.5 + unboxTapCount * 2.5}
            distance={4}
          />
        </group>
      );
    }

    case 'hazard-laser-mine':
      return (
        <group position={[0, 0.58, 0]}>
          {/* 1: Core Hazard Sphere */}
          <mesh castShadow>
            <icosahedronGeometry args={[0.42, 1]} />
            <meshStandardMaterial color="#1E293B" metalness={0.9} roughness={0.25} />
          </mesh>
          {/* 2: Glowing Warning Equatorial Ring */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.48, 0.05, 12, 32]} />
            <meshStandardMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={2.4}
            />
          </mesh>
          {/* 3-6: Warning Spikes */}
          {[
            [0, 0.55, 0],
            [0, -0.55, 0],
            [0.55, 0, 0],
            [-0.55, 0, 0],
          ].map((pos, i) => (
            <mesh key={i} position={pos as [number, number, number]}>
              <octahedronGeometry args={[0.14, 0]} />
              <meshStandardMaterial
                color={secondary}
                emissive={primary}
                emissiveIntensity={1.6}
              />
            </mesh>
          ))}
        </group>
      );

    case 'cyber-mecha-bot':
      return (
        <group>
          {/* 1-2: Armored Feet / Boots */}
          <mesh position={[-0.32, 0.14, 0.05]} castShadow receiveShadow>
            <boxGeometry args={[0.32, 0.28, 0.52]} />
            <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.35} />
          </mesh>
          <mesh position={[0.32, 0.14, 0.05]} castShadow receiveShadow>
            <boxGeometry args={[0.32, 0.28, 0.52]} />
            <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.35} />
          </mesh>
          {/* 3-4: Lower Legs */}
          <mesh position={[-0.32, 0.58, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.14, 0.12, 0.65, 16]} />
            <meshStandardMaterial color={primary} metalness={metalness} roughness={roughness} />
          </mesh>
          <mesh position={[0.32, 0.58, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.14, 0.12, 0.65, 16]} />
            <meshStandardMaterial color={primary} metalness={metalness} roughness={roughness} />
          </mesh>
          {/* 5: Armored Pelvis Chassis */}
          <mesh position={[0, 0.96, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.88, 0.24, 0.52]} />
            <meshStandardMaterial color="#0F172A" metalness={0.75} roughness={0.42} />
          </mesh>
          {/* 6: Main Torso Hull */}
          <mesh position={[0, 1.48, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.05, 0.85, 0.68]} />
            <meshStandardMaterial color={primary} metalness={metalness} roughness={roughness} />
          </mesh>
          {/* 7: Glowing Chest Arc Reactor */}
          <mesh position={[0, 1.52, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.08, 24]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={2.2}
              roughness={0.1}
            />
          </mesh>
          {/* 8-9: Shoulder Pauldrons & Arms */}
          <mesh position={[-0.72, 1.56, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.36, 0.72, 0.44]} />
            <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[0.72, 1.56, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.36, 0.72, 0.44]} />
            <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* 10: Mecha Head Unit */}
          <mesh position={[0, 2.15, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.62, 0.46, 0.56]} />
            <meshStandardMaterial color={primary} metalness={metalness} roughness={roughness} />
          </mesh>
          {/* 11: Luminous Cyber Visor */}
          <mesh position={[0, 2.16, 0.29]}>
            <boxGeometry args={[0.52, 0.14, 0.06]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={2.5}
              roughness={0.1}
            />
          </mesh>
          {/* 12: Dual Telemetry Antennas */}
          <mesh position={[-0.22, 2.5, -0.08]} rotation={[0, 0, 0.15]} castShadow>
            <cylinderGeometry args={[0.02, 0.03, 0.36, 8]} />
            <meshStandardMaterial color={secondary} metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0.22, 2.5, -0.08]} rotation={[0, 0, -0.15]} castShadow>
            <cylinderGeometry args={[0.02, 0.03, 0.36, 8]} />
            <meshStandardMaterial color={secondary} metalness={0.9} roughness={0.15} />
          </mesh>
        </group>
      );

    case 'fantasy-knight':
      return (
        <group>
          <mesh position={[-0.26, 0.42, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.15, 0.13, 0.84, 16]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.92} roughness={0.22} />
          </mesh>
          <mesh position={[0.26, 0.42, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.15, 0.13, 0.84, 16]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.92} roughness={0.22} />
          </mesh>
          <mesh position={[0, 1.32, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.46, 0.38, 1.05, 18]} />
            <meshStandardMaterial color={primary} metalness={0.65} roughness={0.35} />
          </mesh>
          <mesh position={[-0.58, 1.72, 0]} castShadow>
            <sphereGeometry args={[0.24, 18, 18]} />
            <meshStandardMaterial color={secondary} metalness={0.92} roughness={0.18} />
          </mesh>
          <mesh position={[0.58, 1.72, 0]} castShadow>
            <sphereGeometry args={[0.24, 18, 18]} />
            <meshStandardMaterial color={secondary} metalness={0.92} roughness={0.18} />
          </mesh>
          <mesh position={[0, 2.1, 0]} castShadow>
            <cylinderGeometry args={[0.28, 0.3, 0.48, 20]} />
            <meshStandardMaterial color="#E2E8F0" metalness={0.95} roughness={0.15} />
          </mesh>
          <mesh position={[0, 2.46, -0.08]} rotation={[-0.3, 0, 0]} castShadow>
            <coneGeometry args={[0.16, 0.42, 14]} />
            <meshStandardMaterial color={secondary} roughness={0.5} metalness={0.2} />
          </mesh>
          <mesh position={[-0.74, 1.25, 0.28]} rotation={[0, -0.35, 0]} castShadow>
            <boxGeometry args={[0.12, 1.05, 0.68]} />
            <meshStandardMaterial color={primary} metalness={0.82} roughness={0.25} />
          </mesh>
          <group position={[0.78, 1.35, 0.35]} rotation={[0.45, 0, -0.15]}>
            <mesh position={[0, 0.55, 0]} castShadow>
              <boxGeometry args={[0.08, 1.25, 0.18]} />
              <meshStandardMaterial
                color="#38BDF8"
                emissive="#0284C7"
                emissiveIntensity={1.2}
                metalness={0.9}
                roughness={0.1}
              />
            </mesh>
            <mesh position={[0, -0.05, 0]}>
              <boxGeometry args={[0.42, 0.09, 0.14]} />
              <meshStandardMaterial color={secondary} metalness={0.92} roughness={0.18} />
            </mesh>
          </group>
        </group>
      );

    case 'sports-sneaker-pro':
      return (
        <group>
          <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.15, 1.25, 0.24, 32]} />
            <meshStandardMaterial color="#0F172A" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.02, 1.12, 32]} />
            <meshStandardMaterial color={secondary} emissive={secondary} emissiveIntensity={1.8} />
          </mesh>
          <group position={[0, 0.62, 0]}>
            <mesh position={[0, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.95, 0.28, 0.82]} />
              <meshStandardMaterial color="#F8FAFC" roughness={0.35} metalness={0.1} />
            </mesh>
            <mesh position={[-0.48, -0.02, 0]}>
              <boxGeometry args={[0.76, 0.16, 0.86]} />
              <meshPhysicalMaterial
                color={secondary}
                emissive={secondary}
                emissiveIntensity={0.8}
                roughness={0.1}
                metalness={0.2}
                clearcoat={1}
              />
            </mesh>
            <mesh position={[-0.12, 0.34, 0]} rotation={[0, 0, -0.14]} castShadow>
              <boxGeometry args={[1.45, 0.52, 0.76]} />
              <meshStandardMaterial color={primary} roughness={0.45} metalness={0.25} />
            </mesh>
            <mesh position={[0.58, 0.2, 0]} castShadow>
              <boxGeometry args={[0.68, 0.28, 0.74]} />
              <meshStandardMaterial color={primary} roughness={0.35} metalness={0.3} />
            </mesh>
            <mesh position={[-0.78, 0.32, 0]} castShadow>
              <boxGeometry args={[0.32, 0.48, 0.8]} />
              <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.2} />
            </mesh>
            <mesh position={[0.05, 0.34, 0.39]} rotation={[0, 0, 0.18]}>
              <boxGeometry args={[0.95, 0.12, 0.04]} />
              <meshStandardMaterial
                color={secondary}
                emissive={secondary}
                emissiveIntensity={1.1}
                metalness={0.8}
                roughness={0.15}
              />
            </mesh>
          </group>
        </group>
      );

    case 'luxury-perfume-bottle':
      return (
        <group>
          <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.72, 0.78, 0.2, 32]} />
            <meshStandardMaterial color="#1E293B" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.98, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.18, 1.48, 0.66]} />
            <meshPhysicalMaterial
              color="#FFFFFF"
              transparent
              opacity={0.42}
              roughness={0.06}
              metalness={0.1}
              clearcoat={1}
              reflectivity={1}
            />
          </mesh>
          <mesh position={[0, 0.88, 0]}>
            <boxGeometry args={[0.96, 1.12, 0.48]} />
            <meshStandardMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={0.45}
              metalness={0.65}
              roughness={0.15}
            />
          </mesh>
          <mesh position={[0, 0.98, 0.34]}>
            <boxGeometry args={[0.64, 0.56, 0.04]} />
            <meshStandardMaterial color={secondary} metalness={0.95} roughness={0.12} />
          </mesh>
          <mesh position={[0, 1.84, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.22, 0.24, 24]} />
            <meshStandardMaterial color={primary} metalness={0.96} roughness={0.1} />
          </mesh>
          <mesh position={[0, 2.16, 0]} castShadow>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial color="#0F172A" metalness={0.92} roughness={0.14} />
          </mesh>
        </group>
      );

    case 'gold-coin-collectible':
      return (
        <group position={[0, 0.75, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.58, 0.58, 0.16, 32]} />
            <meshStandardMaterial color={primary} metalness={0.95} roughness={0.14} />
          </mesh>
          <mesh>
            <torusGeometry args={[0.54, 0.06, 16, 32]} />
            <meshStandardMaterial color={secondary} metalness={0.98} roughness={0.1} />
          </mesh>
          <mesh position={[0, 0, 0.09]}>
            <octahedronGeometry args={[0.24, 0]} />
            <meshStandardMaterial
              color={secondary}
              emissive={primary}
              emissiveIntensity={0.9}
              metalness={0.9}
              roughness={0.12}
            />
          </mesh>
          <mesh position={[0, 0, -0.09]}>
            <octahedronGeometry args={[0.24, 0]} />
            <meshStandardMaterial
              color={secondary}
              emissive={primary}
              emissiveIntensity={0.9}
              metalness={0.9}
              roughness={0.12}
            />
          </mesh>
        </group>
      );

    case 'plasma-gem':
      return (
        <group position={[0, 0.9, 0]}>
          <mesh castShadow>
            <octahedronGeometry args={[0.52, 0]} />
            <meshPhysicalMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={1.1}
              metalness={0.4}
              roughness={0.08}
              clearcoat={1}
            />
          </mesh>
          <mesh rotation={[Math.PI / 4, Math.PI / 4, 0]}>
            <torusGeometry args={[0.72, 0.03, 12, 36]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={1.8}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 4, Math.PI / 3, 0]}>
            <torusGeometry args={[0.84, 0.025, 12, 36]} />
            <meshStandardMaterial color={primary} emissive={primary} emissiveIntensity={1.4} />
          </mesh>
        </group>
      );

    case 'gt-sports-car':
      return (
        <group>
          <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.65, 0.34, 3.3]} />
            <meshStandardMaterial color={primary} metalness={metalness} roughness={roughness} />
          </mesh>
          <mesh position={[0, 0.64, -0.15]} castShadow>
            <boxGeometry args={[1.28, 0.34, 1.55]} />
            <meshPhysicalMaterial
              color="#0F172A"
              metalness={0.9}
              roughness={0.08}
              clearcoat={1}
            />
          </mesh>
          <mesh position={[0, 0.78, -1.48]} castShadow>
            <boxGeometry args={[1.58, 0.06, 0.32]} />
            <meshStandardMaterial color="#0F172A" metalness={0.85} roughness={0.2} />
          </mesh>
          {[
            [-0.84, 0.28, 1.05],
            [0.84, 0.28, 1.05],
            [-0.84, 0.28, -1.05],
            [0.84, 0.28, -1.05],
          ].map((pos, idx) => (
            <mesh
              key={idx}
              position={pos as [number, number, number]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.28, 0.28, 0.22, 24]} />
              <meshStandardMaterial color="#1E293B" metalness={0.7} roughness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, 0.36, 1.66]}>
            <boxGeometry args={[1.38, 0.08, 0.04]} />
            <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={2.5} />
          </mesh>
          <mesh position={[0, 0.4, -1.66]}>
            <boxGeometry args={[1.42, 0.08, 0.04]} />
            <meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={2.5} />
          </mesh>
        </group>
      );

    case 'scifi-warp-portal':
      return (
        <group>
          <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.8, 0.32, 1.1]} />
            <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.3} />
          </mesh>
          <mesh position={[0, 1.78, 0]} castShadow>
            <torusGeometry args={[1.45, 0.18, 20, 48]} />
            <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.22} />
          </mesh>
          <mesh position={[0, 1.78, 0]}>
            <torusGeometry args={[1.25, 0.06, 16, 48]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={2.2}
            />
          </mesh>
          <mesh position={[0, 1.78, 0]}>
            <circleGeometry args={[1.22, 40]} />
            <meshStandardMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={1.5}
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      );

    case 'starter-primitive-showcase':
    default:
      return (
        <group>
          <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.92, 1.05, 0.24, 32]} />
            <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.78, 0.88, 32]} />
            <meshStandardMaterial color={primary} emissive={primary} emissiveIntensity={1.6} />
          </mesh>
          <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.42, 0.56, 0.82, 24]} />
            <meshStandardMaterial color="#0F172A" metalness={0.9} roughness={0.18} />
          </mesh>
          <mesh position={[0, 1.55, 0]} castShadow>
            <icosahedronGeometry args={[0.48, 0]} />
            <meshPhysicalMaterial
              color={primary}
              metalness={metalness}
              roughness={roughness}
              clearcoat={1}
            />
          </mesh>
          <mesh position={[0, 1.55, 0]} rotation={[Math.PI / 4, Math.PI / 4, 0]}>
            <torusGeometry args={[0.76, 0.04, 16, 40]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={1.2}
              metalness={0.95}
              roughness={0.12}
            />
          </mesh>
        </group>
      );
  }
}

export const ActorRenderer: React.FC<ActorRendererProps> = ({ actor, isSelected, onRuntimeClick }) => {
  const outerGroupRef = useRef<THREE.Group>(null);
  const animGroupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [clickPulse, setClickPulse] = useState(0);

  const selectActor = useStudioStore((s) => s.selectActor);
  const transformMode = useStudioStore((s) => s.transformMode);
  const isDraggingGizmo = useStudioStore((s) => s.isDraggingGizmo);
  const setIsDraggingGizmo = useStudioStore((s) => s.setIsDraggingGizmo);
  const updateActorTransform = useStudioStore((s) => s.updateActorTransform);
  const triggerActorInteraction = useStudioStore((s) => s.triggerActorInteraction);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const currentTime = useStudioStore((s) => s.currentTime);
  const mode = useStudioStore((s) => s.sceneSpec.mode);
  const unboxTapCount = useStudioStore((s) => s.unboxTapCounts[actor.id] || 0);
  const gltfUrl = actor.modelUrl || actor.customGlbUrl || ASSET_REGISTRY[actor.assetId]?.modelUrl;

  // Check timeline window visibility in Media mode
  const isWithinTimelineWindow =
    mode === 'game' ||
    ((actor.startTime === undefined || currentTime >= actor.startTime) &&
      (actor.endTime === undefined || currentTime <= actor.endTime));

  useFrame((state, delta) => {
    if (!outerGroupRef.current || !animGroupRef.current) return;

    // Sync outer group to SceneSpec when user is NOT actively dragging the TransformControls gizmo
    if (!isDraggingGizmo) {
      outerGroupRef.current.position.set(actor.position[0], actor.position[1], actor.position[2]);
      outerGroupRef.current.rotation.set(actor.rotation[0], actor.rotation[1], actor.rotation[2]);
      outerGroupRef.current.scale.set(actor.scale[0], actor.scale[1], actor.scale[2]);
    }

    const anim = animGroupRef.current;
    const speed = actor.animationSpeed ?? 1;
    const t = currentTime * speed;

    let offsetY = 0;
    let offsetX = 0;
    let offsetZ = 0;
    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;
    let enterScale = 1.0;

    // Enter Effect calculation during Media timeline playback
    if (mode === 'media' && actor.startTime !== undefined && actor.enterEffect && actor.enterEffect !== 'none') {
      const elapsedSinceStart = Math.max(0, currentTime - actor.startTime);
      const enterProgress = Math.min(1, elapsedSinceStart / 0.6);
      if (actor.enterEffect === 'pop-in') {
        enterScale = THREE.MathUtils.smoothstep(enterProgress, 0, 1);
      } else if (actor.enterEffect === 'slide-up') {
        offsetY -= (1 - THREE.MathUtils.smoothstep(enterProgress, 0, 1)) * 1.5;
      }
    }

    // A rig already contains walk/attack/idle motion. Avoid layering procedural
    // bobbing over its skeleton; retain explicit whole-object effects.
    if (!gltfUrl || actor.activeAnimation === 'bounce' || actor.activeAnimation === 'float' || actor.activeAnimation === 'spin') {
      switch (actor.activeAnimation) {
        case 'bounce':
          offsetY += Math.abs(Math.sin(t * 3.2)) * 0.48;
          break;
        case 'float':
          offsetY += Math.sin(t * 2.0) * 0.18 + 0.12;
          rotY += Math.sin(t * 0.9) * 0.25;
          break;
        case 'spin':
          rotY = t * 1.8;
          break;
        case 'walk':
          offsetY += Math.abs(Math.sin(t * 5.0)) * 0.12;
          rotZ = Math.sin(t * 5.0) * 0.08;
          break;
        case 'attack':
          rotY += Math.sin(t * 3.8) * 0.48;
          offsetZ += Math.max(0, Math.sin(t * 3.8)) * 0.32;
          break;
        case 'idle':
        default:
          offsetY += Math.sin(t * 1.5) * 0.04;
          break;
      }
    }

    // Interactive click jump-boost / unboxing shake
    if (clickPulse > 0.01) {
      if (actor.onClickAction === 'unbox-tap' || actor.assetId === 'mystery-gift-box') {
        // High-frequency unboxing shake
        rotZ += Math.sin(state.clock.getElapsedTime() * 45) * clickPulse * 0.28;
        rotX += Math.cos(state.clock.getElapsedTime() * 38) * clickPulse * 0.22;
        offsetY += clickPulse * 0.35;
      } else {
        offsetY += clickPulse * 0.6;
        rotY += clickPulse * 1.4;
      }
      setClickPulse((prev) => Math.max(0, prev - delta * 3.0));
    }

    anim.position.x = THREE.MathUtils.damp(anim.position.x, offsetX, 10, delta);
    anim.position.y = THREE.MathUtils.damp(anim.position.y, offsetY, 10, delta);
    anim.position.z = THREE.MathUtils.damp(anim.position.z, offsetZ, 10, delta);

    anim.rotation.x = THREE.MathUtils.damp(anim.rotation.x, rotX, 10, delta);
    anim.rotation.y = THREE.MathUtils.damp(anim.rotation.y, rotY, 10, delta);
    anim.rotation.z = THREE.MathUtils.damp(anim.rotation.z, rotZ, 10, delta);

    const hoverScale = (hovered ? 1.05 : 1.0) * enterScale;
    anim.scale.setScalar(THREE.MathUtils.damp(anim.scale.x, hoverScale, 10, delta));
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectActor(actor.id);
    setClickPulse(1.0);
    if (isPlaying && onRuntimeClick?.(actor.id)) return;
    if (mode === 'game' || actor.onClickAction !== 'none') {
      triggerActorInteraction(actor);
    }
  };

  if (actor.visible === false || !isWithinTimelineWindow) return null;

  const fallbackMesh = <CompositeProceduralMesh actor={actor} unboxTapCount={unboxTapCount} />;

  // Attach interactive 3D TransformControls gizmo when selected, unlocked, and NOT actively playing Game Mode
  const showTransformGizmo = isSelected && !actor.locked && !(mode === 'game' && isPlaying);

  const actorContent = (
    <group
      ref={outerGroupRef}
      position={actor.position}
      rotation={actor.rotation}
      scale={actor.scale}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <group ref={animGroupRef}>
        {gltfUrl ? (
          <GlbErrorBoundary resetKey={gltfUrl} fallback={fallbackMesh}>
            <Suspense fallback={fallbackMesh}>
              <RiggedGltfModel key={gltfUrl} url={gltfUrl} actor={actor} />
            </Suspense>
          </GlbErrorBoundary>
        ) : (
          fallbackMesh
        )}
      </group>

      {/* Grounded Selection & Hover Indicator Ring + Wireframe Bounding Highlight */}
      {(isSelected || hovered) && (
        <>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.95, 1.08, 36]} />
            <meshBasicMaterial
              color={isSelected ? '#06B6D4' : '#F59E0B'}
              transparent
              opacity={isSelected ? 0.92 : 0.55}
              side={THREE.DoubleSide}
            />
          </mesh>
          {isSelected && (
            <mesh position={[0, 1.15, 0]}>
              <boxGeometry args={[1.7, 2.3, 1.7]} />
              <meshBasicMaterial color="#06B6D4" wireframe transparent opacity={0.18} />
            </mesh>
          )}
        </>
      )}

      {/* Spatial Actor Coordinate & Tap-to-Unbox Badge (Pure WebGL Sprite) */}
      {(isSelected || actor.assetId === 'mystery-gift-box') && (
        <CanvasBadgeSprite
          position={[0, 2.75, 0]}
          text={
            actor.assetId === 'mystery-gift-box'
              ? `TAP TO UNBOX (${unboxTapCount}/${actor.unboxTapsRequired || 3})`
              : `${actor.name} · [${actor.position.map((n) => n.toFixed(1)).join(', ')}]`
          }
        />
      )}
    </group>
  );

  if (showTransformGizmo) {
    return (
      <TransformControls
        mode={transformMode}
        onMouseDown={() => setIsDraggingGizmo(true)}
        onMouseUp={(e: any) => {
          setIsDraggingGizmo(false);
          if (outerGroupRef.current) {
            const obj = outerGroupRef.current;
            updateActorTransform(
              actor.id,
              [obj.position.x, obj.position.y, obj.position.z],
              [obj.rotation.x, obj.rotation.y, obj.rotation.z],
              [obj.scale.x, obj.scale.y, obj.scale.z]
            );
          }
        }}
      >
        {actorContent}
      </TransformControls>
    );
  }

  return actorContent;
};
