import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useStudioStore } from '../state/useStudioStore';
import { ActorRenderer } from './ActorRenderer';
import { VFXRenderer } from './VFXRenderer';

const _targetVec = new THREE.Vector3();
const _camPosVec = new THREE.Vector3();

export const SceneDirector: React.FC = () => {
  const { gl, scene, camera } = useThree();
  const controlsRef = useRef<any>(null);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  const selectActor = useStudioStore((s) => s.selectActor);
  const advanceTimeline = useStudioStore((s) => s.advanceTimeline);
  const currentTime = useStudioStore((s) => s.currentTime);
  const isPlaying = useStudioStore((s) => s.isPlaying);

  // Initialize procedural studio PMREM environment reflection once
  useEffect(() => {
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(envScene, 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();
    return () => {
      envTexture.dispose();
    };
  }, [gl, scene]);

  // Sync background color & horizon fog with SceneSpec
  useEffect(() => {
    scene.background = new THREE.Color(sceneSpec.environment.backgroundColor || '#0B101B');
    scene.fog = new THREE.Fog(
      sceneSpec.environment.fogColor || sceneSpec.environment.backgroundColor || '#0B101B',
      sceneSpec.environment.fogNear || 14,
      sceneSpec.environment.fogFar || 45
    );
  }, [
    scene,
    sceneSpec.environment.backgroundColor,
    sceneSpec.environment.fogColor,
    sceneSpec.environment.fogNear,
    sceneSpec.environment.fogFar,
  ]);

  // Sync camera FOV
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = sceneSpec.camera.fov || 45;
      camera.updateProjectionMatrix();
    }
  }, [camera, sceneSpec.camera.fov]);

  // Per-frame Timeline Clock & Camera Choreography
  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.1);
    advanceTimeline(clampedDelta);

    const camMode = sceneSpec.camera.mode;
    const keyframes = sceneSpec.camera.keyframes || [];

    if (camMode === 'cinematic-flythrough' && keyframes.length >= 2 && isPlaying) {
      // Interpolate between keyframes based on currentTime
      const sorted = [...keyframes].sort((a, b) => a.time - b.time);
      let k0 = sorted[0];
      let k1 = sorted[sorted.length - 1];

      for (let i = 0; i < sorted.length - 1; i++) {
        if (currentTime >= sorted[i].time && currentTime <= sorted[i + 1].time) {
          k0 = sorted[i];
          k1 = sorted[i + 1];
          break;
        }
      }

      const span = Math.max(0.001, k1.time - k0.time);
      const alpha = THREE.MathUtils.clamp((currentTime - k0.time) / span, 0, 1);
      const smoothAlpha = THREE.MathUtils.smoothstep(alpha, 0, 1);

      _camPosVec.set(
        THREE.MathUtils.lerp(k0.position[0], k1.position[0], smoothAlpha),
        THREE.MathUtils.lerp(k0.position[1], k1.position[1], smoothAlpha),
        THREE.MathUtils.lerp(k0.position[2], k1.position[2], smoothAlpha)
      );
      _targetVec.set(
        THREE.MathUtils.lerp(k0.target[0], k1.target[0], smoothAlpha),
        THREE.MathUtils.lerp(k0.target[1], k1.target[1], smoothAlpha),
        THREE.MathUtils.lerp(k0.target[2], k1.target[2], smoothAlpha)
      );

      camera.position.lerp(_camPosVec, 0.08);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(_targetVec, 0.08);
        controlsRef.current.update();
      } else {
        camera.lookAt(_targetVec);
      }
    } else if (camMode === 'follow-target') {
      const targetActor =
        sceneSpec.actors.find((a) => a.id === sceneSpec.camera.followActorId) ||
        sceneSpec.actors.find((a) => a.id === selectedActorId) ||
        sceneSpec.actors[0];
      if (targetActor && controlsRef.current) {
        _targetVec.set(
          targetActor.position[0],
          targetActor.position[1] + 1.1,
          targetActor.position[2]
        );
        controlsRef.current.target.lerp(_targetVec, 0.08);
        controlsRef.current.update();
      }
    }
  });

  const env = sceneSpec.environment;

  return (
    <group onPointerMissed={() => selectActor(null)}>
      {/* 3-Point Calibrated Studio Lighting Rig */}
      <hemisphereLight
        color={env.keyLightColor || '#FFFBEB'}
        groundColor={env.groundColor || '#0F172A'}
        intensity={env.ambientIntensity ?? 0.75}
      />

      {/* Warm Key Light with Shadow Mapping */}
      <directionalLight
        position={[5.5, 8.5, 6.0]}
        color={env.keyLightColor || '#FFFBEB'}
        intensity={env.keyLightIntensity ?? 2.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0005}
      />

      {/* Cool Fill Light */}
      <directionalLight position={[-5.0, 4.0, 3.5]} color="#93C5FD" intensity={0.85} />

      {/* High-Contrast Rim / Backlight */}
      <spotLight
        position={[0, 6.5, -6.5]}
        color={env.rimLightColor || '#38BDF8'}
        intensity={3.2}
        angle={0.65}
        penumbra={0.8}
      />

      {/* Ground Plane & Contact Shadows */}
      <mesh
        position={[0, -0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial
          color={env.groundColor || '#0F172A'}
          roughness={0.85}
          metalness={0.15}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {env.groundGrid && (
        <Grid
          position={[0, 0.005, 0]}
          args={[30, 30]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#1E293B"
          sectionSize={5}
          sectionThickness={1.1}
          sectionColor={env.rimLightColor || '#06B6D4'}
          fadeDistance={24}
          fadeStrength={1.2}
        />
      )}

      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.5}
        scale={16}
        blur={2.2}
        far={5}
        color="#000000"
      />

      {/* Declarative 3D Actors from SceneSpec */}
      {sceneSpec.actors.map((actor) => (
        <ActorRenderer
          key={actor.id}
          actor={actor}
          isSelected={actor.id === selectedActorId}
        />
      ))}

      {/* Declarative VFX & 3D Marketing Callouts from SceneSpec */}
      {sceneSpec.vfx.map((vfx) => (
        <VFXRenderer key={vfx.id} vfx={vfx} />
      ))}

      {/* Interactive Camera Controls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.07}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={2.2}
        maxDistance={22}
        target={sceneSpec.camera.target}
      />
    </group>
  );
};
