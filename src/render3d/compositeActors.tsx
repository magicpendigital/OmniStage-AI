/** @jsxRuntime classic */
/** @jsx h */
/**
 * Phase 7B — procedural composite actors (built-in asset ids) as plain Three.js objects, shared by the studio viewport
 * (wrapped in <primitive>) and the OmniStage Player. JSX here is compiled by the local `h` factory, not React.
 */
import * as THREE from 'three';
import { h } from './h';
import type { ActorNode } from '../types/scene.schema';

export function buildCompositeActor(actor: ActorNode, unboxTapCount = 0): THREE.Object3D {
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
