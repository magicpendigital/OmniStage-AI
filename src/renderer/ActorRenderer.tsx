import React, { Suspense, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ActorNode } from '../types/scene.schema';
import { useStudioStore } from '../state/useStudioStore';

interface ActorRendererProps {
  actor: ActorNode;
  isSelected: boolean;
}

/**
 * Optional Custom GLB Sub-Loader with Error Boundary Fallback
 */
function CustomGlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene.clone()} />;
}

class GlbErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
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
function CompositeProceduralMesh({ actor }: { actor: ActorNode }) {
  const primary = actor.primaryColor || '#06B6D4';
  const secondary = actor.secondaryColor || '#F59E0B';
  const metalness = actor.metalness ?? 0.8;
  const roughness = actor.roughness ?? 0.22;

  switch (actor.assetId) {
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
          {/* 1-2: Sabaton Greaves */}
          <mesh position={[-0.26, 0.42, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.15, 0.13, 0.84, 16]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.92} roughness={0.22} />
          </mesh>
          <mesh position={[0.26, 0.42, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.15, 0.13, 0.84, 16]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.92} roughness={0.22} />
          </mesh>
          {/* 3: Royal Tunic & Cuirass */}
          <mesh position={[0, 1.32, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.46, 0.38, 1.05, 18]} />
            <meshStandardMaterial color={primary} metalness={0.65} roughness={0.35} />
          </mesh>
          {/* 4-5: Golden Pauldrons */}
          <mesh position={[-0.58, 1.72, 0]} castShadow>
            <sphereGeometry args={[0.24, 18, 18]} />
            <meshStandardMaterial color={secondary} metalness={0.92} roughness={0.18} />
          </mesh>
          <mesh position={[0.58, 1.72, 0]} castShadow>
            <sphereGeometry args={[0.24, 18, 18]} />
            <meshStandardMaterial color={secondary} metalness={0.92} roughness={0.18} />
          </mesh>
          {/* 6: Greathelm */}
          <mesh position={[0, 2.1, 0]} castShadow>
            <cylinderGeometry args={[0.28, 0.3, 0.48, 20]} />
            <meshStandardMaterial color="#E2E8F0" metalness={0.95} roughness={0.15} />
          </mesh>
          {/* 7: Helmet Plume */}
          <mesh position={[0, 2.46, -0.08]} rotation={[-0.3, 0, 0]} castShadow>
            <coneGeometry args={[0.16, 0.42, 14]} />
            <meshStandardMaterial color={secondary} roughness={0.5} metalness={0.2} />
          </mesh>
          {/* 8: Tower Shield (Left Hand) */}
          <mesh position={[-0.74, 1.25, 0.28]} rotation={[0, -0.35, 0]} castShadow>
            <boxGeometry args={[0.12, 1.05, 0.68]} />
            <meshStandardMaterial color={primary} metalness={0.82} roughness={0.25} />
          </mesh>
          {/* 9: Energy Broadsword (Right Hand) */}
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
          {/* 1: Illuminated Showcase Plinth */}
          <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.15, 1.25, 0.24, 32]} />
            <meshStandardMaterial color="#0F172A" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.02, 1.12, 32]} />
            <meshStandardMaterial color={secondary} emissive={secondary} emissiveIntensity={1.8} />
          </mesh>
          {/* Sneaker Assembly floating above plinth */}
          <group position={[0, 0.62, 0]}>
            {/* 2: Sculpted Foam Midsole */}
            <mesh position={[0, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.95, 0.28, 0.82]} />
              <meshStandardMaterial color="#F8FAFC" roughness={0.35} metalness={0.1} />
            </mesh>
            {/* 3: Translucent Nitro Air Unit */}
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
            {/* 4: Main Breathable Knit Upper */}
            <mesh position={[-0.12, 0.34, 0]} rotation={[0, 0, -0.14]} castShadow>
              <boxGeometry args={[1.45, 0.52, 0.76]} />
              <meshStandardMaterial color={primary} roughness={0.45} metalness={0.25} />
            </mesh>
            {/* 5: Aerodynamic Toe Box */}
            <mesh position={[0.58, 0.2, 0]} castShadow>
              <boxGeometry args={[0.68, 0.28, 0.74]} />
              <meshStandardMaterial color={primary} roughness={0.35} metalness={0.3} />
            </mesh>
            {/* 6: Carbon Heel Counter Clip */}
            <mesh position={[-0.78, 0.32, 0]} castShadow>
              <boxGeometry args={[0.32, 0.48, 0.8]} />
              <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.2} />
            </mesh>
            {/* 7: Dynamic Side Vector Stripe */}
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
          {/* 1: Brushed Gold Base Pedestal */}
          <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.72, 0.78, 0.2, 32]} />
            <meshStandardMaterial color="#1E293B" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* 2: Faceted Crystal Outer Flacon */}
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
          {/* 3: Inner Golden Amber Elixir Core */}
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
          {/* 4: Embossed Metallic Front Plaque */}
          <mesh position={[0, 0.98, 0.34]}>
            <boxGeometry args={[0.64, 0.56, 0.04]} />
            <meshStandardMaterial color={secondary} metalness={0.95} roughness={0.12} />
          </mesh>
          {/* 5: Atomizer Gold Neck Collar */}
          <mesh position={[0, 1.84, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.22, 0.24, 24]} />
            <meshStandardMaterial color={primary} metalness={0.96} roughness={0.1} />
          </mesh>
          {/* 6: Jewel-Cut Octagonal Stopper Cap */}
          <mesh position={[0, 2.16, 0]} castShadow>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial color="#0F172A" metalness={0.92} roughness={0.14} />
          </mesh>
        </group>
      );

    case 'gold-coin-collectible':
      return (
        <group position={[0, 0.75, 0]}>
          {/* 1: Main Coin Disc */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.58, 0.58, 0.16, 32]} />
            <meshStandardMaterial color={primary} metalness={0.95} roughness={0.14} />
          </mesh>
          {/* 2: Raised Bevel Rim */}
          <mesh>
            <torusGeometry args={[0.54, 0.06, 16, 32]} />
            <meshStandardMaterial color={secondary} metalness={0.98} roughness={0.1} />
          </mesh>
          {/* 3: Center Emblem Star */}
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
          {/* 1: Octahedral Crystal Core */}
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
          {/* 2-3: Orbiting Energy Gimbal Rings */}
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
          {/* 1: Lower Aero Splitter & Chassis */}
          <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.65, 0.34, 3.3]} />
            <meshStandardMaterial color={primary} metalness={metalness} roughness={roughness} />
          </mesh>
          {/* 2: Sculpted Cockpit Canopy */}
          <mesh position={[0, 0.64, -0.15]} castShadow>
            <boxGeometry args={[1.28, 0.34, 1.55]} />
            <meshPhysicalMaterial
              color="#0F172A"
              metalness={0.9}
              roughness={0.08}
              clearcoat={1}
            />
          </mesh>
          {/* 3: Rear GT Aero Wing */}
          <mesh position={[0, 0.78, -1.48]} castShadow>
            <boxGeometry args={[1.58, 0.06, 0.32]} />
            <meshStandardMaterial color="#0F172A" metalness={0.85} roughness={0.2} />
          </mesh>
          {/* 4-7: Four Alloy Wheels */}
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
          {/* 8: Front LED Headlight Strip */}
          <mesh position={[0, 0.36, 1.66]}>
            <boxGeometry args={[1.38, 0.08, 0.04]} />
            <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={2.5} />
          </mesh>
          {/* 9: Rear Diffuser Tail Light Strip */}
          <mesh position={[0, 0.4, -1.66]}>
            <boxGeometry args={[1.42, 0.08, 0.04]} />
            <meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={2.5} />
          </mesh>
        </group>
      );

    case 'scifi-warp-portal':
      return (
        <group>
          {/* 1: Stepped Heavy Gate Pedestal */}
          <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.8, 0.32, 1.1]} />
            <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.3} />
          </mesh>
          {/* 2: Outer Metallic Stargate Ring */}
          <mesh position={[0, 1.78, 0]} castShadow>
            <torusGeometry args={[1.45, 0.18, 20, 48]} />
            <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.22} />
          </mesh>
          {/* 3: Inner Glowing Conduit Ring */}
          <mesh position={[0, 1.78, 0]}>
            <torusGeometry args={[1.25, 0.06, 16, 48]} />
            <meshStandardMaterial
              color={secondary}
              emissive={secondary}
              emissiveIntensity={2.2}
            />
          </mesh>
          {/* 4: Swirling Quantum Event Horizon Disc */}
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
          {/* 1: Grounded Stepped Studio Pedestal */}
          <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.92, 1.05, 0.24, 32]} />
            <meshStandardMaterial color="#1E293B" metalness={0.85} roughness={0.25} />
          </mesh>
          {/* 2: Luminous Calibration Rim */}
          <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.78, 0.88, 32]} />
            <meshStandardMaterial color={primary} emissive={primary} emissiveIntensity={1.6} />
          </mesh>
          {/* 3: Brushed Pillar Core */}
          <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.42, 0.56, 0.82, 24]} />
            <meshStandardMaterial color="#0F172A" metalness={0.9} roughness={0.18} />
          </mesh>
          {/* 4: Floating Faceted Hero Polyhedron */}
          <mesh position={[0, 1.55, 0]} castShadow>
            <icosahedronGeometry args={[0.48, 0]} />
            <meshPhysicalMaterial
              color={primary}
              metalness={metalness}
              roughness={roughness}
              clearcoat={1}
            />
          </mesh>
          {/* 5: Outer Gyro Ring */}
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

export const ActorRenderer: React.FC<ActorRendererProps> = ({ actor, isSelected }) => {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [clickPulse, setClickPulse] = useState(0);

  const selectActor = useStudioStore((s) => s.selectActor);
  const triggerActorInteraction = useStudioStore((s) => s.triggerActorInteraction);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const mode = useStudioStore((s) => s.sceneSpec.mode);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const g = groupRef.current;
    const speed = actor.animationSpeed ?? 1;
    const t = state.clock.getElapsedTime() * speed;

    // Base target transforms from declarative SceneSpec
    let targetX = actor.position[0];
    let targetY = actor.position[1];
    let targetZ = actor.position[2];
    let targetRotX = actor.rotation[0];
    let targetRotY = actor.rotation[1];
    let targetRotZ = actor.rotation[2];

    if (isPlaying) {
      switch (actor.activeAnimation) {
        case 'bounce':
          targetY += Math.abs(Math.sin(t * 3.2)) * 0.55;
          break;
        case 'float':
          targetY += Math.sin(t * 2.0) * 0.18 + 0.12;
          targetRotY += Math.sin(t * 0.9) * 0.25;
          break;
        case 'spin':
          targetRotY = actor.rotation[1] + t * 1.8;
          break;
        case 'walk':
          targetX += Math.sin(t * 2.2) * 0.35;
          targetRotZ = Math.sin(t * 4.4) * 0.08;
          break;
        case 'attack':
          targetRotY += Math.sin(t * 3.5) * 0.45;
          targetZ += Math.max(0, Math.sin(t * 3.5)) * 0.28;
          break;
        case 'idle':
        default:
          targetY += Math.sin(t * 1.5) * 0.04;
          break;
      }
    }

    // Interactive click jump-boost decay
    if (clickPulse > 0.01) {
      targetY += clickPulse * 0.65;
      targetRotY += clickPulse * 1.5;
      setClickPulse((prev) => Math.max(0, prev - delta * 3.2));
    }

    // Smooth exponential damping
    g.position.x = THREE.MathUtils.damp(g.position.x, targetX, 8, delta);
    g.position.y = THREE.MathUtils.damp(g.position.y, targetY, 8, delta);
    g.position.z = THREE.MathUtils.damp(g.position.z, targetZ, 8, delta);

    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetRotX, 8, delta);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetRotY, 8, delta);
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, targetRotZ, 8, delta);

    const pulseScale = hovered ? 1.04 : 1.0;
    g.scale.x = THREE.MathUtils.damp(g.scale.x, actor.scale[0] * pulseScale, 10, delta);
    g.scale.y = THREE.MathUtils.damp(g.scale.y, actor.scale[1] * pulseScale, 10, delta);
    g.scale.z = THREE.MathUtils.damp(g.scale.z, actor.scale[2] * pulseScale, 10, delta);
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectActor(actor.id);
    setClickPulse(1.0);
    if (mode === 'game' || actor.onClickAction !== 'none') {
      triggerActorInteraction(actor);
    }
  };

  if (actor.visible === false) return null;

  const fallbackMesh = <CompositeProceduralMesh actor={actor} />;

  return (
    <group
      ref={groupRef}
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
      {actor.customGlbUrl ? (
        <GlbErrorBoundary fallback={fallbackMesh}>
          <Suspense fallback={fallbackMesh}>
            <CustomGlbModel url={actor.customGlbUrl} />
          </Suspense>
        </GlbErrorBoundary>
      ) : (
        fallbackMesh
      )}

      {/* Grounded Selection & Hover Indicator Ring */}
      {(isSelected || hovered) && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.95, 1.06, 36]} />
          <meshBasicMaterial
            color={isSelected ? '#06B6D4' : '#F59E0B'}
            transparent
            opacity={isSelected ? 0.9 : 0.55}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Subtle Spatial Actor Label when Selected */}
      {isSelected && (
        <Html position={[0, 2.75, 0]} center distanceFactor={10} zIndexRange={[10, 0]}>
          <div className="pointer-events-none px-2 py-0.5 rounded bg-slate-950/90 border border-cyan-500/50 text-[11px] font-mono text-cyan-300 whitespace-nowrap shadow-lg">
            {actor.name} · [{actor.position.map((n) => n.toFixed(1)).join(', ')}]
          </div>
        </Html>
      )}
    </group>
  );
};
