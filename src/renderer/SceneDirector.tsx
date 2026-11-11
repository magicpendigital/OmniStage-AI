import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from '../state/useStudioStore';
import { easedSplineProgress } from '../animation/easing';
import { ActorRenderer } from './ActorRenderer';
import { CollisionBurstRenderer, VFXRenderer } from './VFXRenderer';
import { WorldRenderer } from './WorldRenderer';
import { Built } from './Built';
import { applyBackgroundAndFog, applyStudioEnvironment, createAmbientDust, createGroundGrid, createLightingRig, createPedestal } from '../render3d/stage3d';
import { createContactShadows } from '../render3d/contactShadows';
import { findLogicContacts, useRuntimeLogicGraph } from './StageCanvas2D';
import { resolveShot } from '../runtime/cinematics';

const _targetVec = new THREE.Vector3();
const _camPosVec = new THREE.Vector3();

export const SceneDirector: React.FC = () => {
  const { gl, scene, camera } = useThree();
  const controlsRef = useRef<any>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const lastCollisionTimeRef = useRef<Record<string, number>>({});
  const logicRuntime = useRuntimeLogicGraph('3d');

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const selectedActorId = useStudioStore((s) => s.selectedActorId);
  // Phase 10A: Preview shows the film, not editor helpers (gizmo, selection ring, coordinate badge).
  const previewing = useStudioStore((s) => !!s.fullPreview);
  const isDraggingGizmo = useStudioStore((s) => s.isDraggingGizmo);
  const selectActor = useStudioStore((s) => s.selectActor);
  const setTransformMode = useStudioStore((s) => s.setTransformMode);
  const movePlayerActor = useStudioStore((s) => s.movePlayerActor);
  const handlePlayerCollision = useStudioStore((s) => s.handlePlayerCollision);
  const currentTime = useStudioStore((s) => s.currentTime);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const burstEffects = useStudioStore((s) => s.burstEffects);

  // Procedural studio reflections (shared with the OmniStage Player)
  useEffect(() => applyStudioEnvironment(gl, scene), [gl, scene]);

  // Keyboard Listeners: WASD / Arrows for Playable Game Player + W/E/R for 3D Gizmo Modes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;

      const key = e.key.toLowerCase();
      pressedKeysRef.current.add(key);
      if (!e.repeat) logicRuntime.emit('key-press', { key, code: e.code });

      // When not in active Game Mode, W / E / R switch TransformControls Gizmo modes
      if (!useStudioStore.getState().isPlaying && useStudioStore.getState().sceneSpec.mode !== 'game') {
        if (key === 'w') setTransformMode('translate');
        else if (key === 'e') setTransformMode('rotate');
        else if (key === 'r') setTransformMode('scale');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(e.key.toLowerCase());
    };
    const onBlur = () => pressedKeysRef.current.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [setTransformMode, logicRuntime]);

  // Background colour & horizon fog (shared with the OmniStage Player)
  useEffect(() => {
    applyBackgroundAndFog(scene, sceneSpec.environment);
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

  // Precompute CatmullRomCurve3 splines for custom camera keyframes
  const keyframeCurves = useMemo(() => {
    const kfs = sceneSpec.camera.keyframes || [];
    if (kfs.length < 2) return null;
    const sorted = [...kfs].sort((a, b) => a.time - b.time);
    const posPoints = sorted.map((k) => new THREE.Vector3(...k.position));
    const targetPoints = sorted.map((k) => new THREE.Vector3(...k.target));
    return {
      posCurve: new THREE.CatmullRomCurve3(posPoints),
      targetCurve: new THREE.CatmullRomCurve3(targetPoints),
    };
  }, [sceneSpec.camera.keyframes]);

  // Per-frame Timeline Sequencer, Camera Track Interpolation & Playable Bounding-Box Collision Loop
  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.1);
    const generation = logicRuntime.generation;
    logicRuntime.advance(clampedDelta);
    if (generation !== logicRuntime.generation) lastCollisionTimeRef.current = {};

    // Read after graph actions: animation/movement/camera changes apply this frame.
    const { sceneSpec, currentTime, isPlaying } = useStudioStore.getState();

    const duration = Math.max(2, sceneSpec.durationSeconds || 8);
    const progress = THREE.MathUtils.clamp(currentTime / duration, 0, 1);
    const camMode = sceneSpec.camera.mode;

    // 1. REAL PLAYABLE GAME LOOP: Player Keyboard Movement + Bounding-Sphere Collision Detection
    if (sceneSpec.mode === 'game' && isPlaying) {
      const keys = pressedKeysRef.current;
      let moveX = 0;
      let moveZ = 0;
      const moveSpeed = 4.2 * clampedDelta;

      if (keys.has('w') || keys.has('arrowup')) moveZ -= moveSpeed;
      if (keys.has('s') || keys.has('arrowdown')) moveZ += moveSpeed;
      if (keys.has('a') || keys.has('arrowleft')) moveX -= moveSpeed;
      if (keys.has('d') || keys.has('arrowright')) moveX += moveSpeed;

      if (moveX !== 0 || moveZ !== 0) {
        movePlayerActor(moveX, moveZ);
      }
    }

    if (isPlaying) {
      const actors = useStudioStore.getState().sceneSpec.actors.filter((a) => a.visible !== false &&
        (sceneSpec.mode === 'game' || ((a.startTime ?? 0) <= currentTime && (a.endTime ?? Infinity) >= currentTime)));
      const pairs = findLogicContacts(useStudioStore.getState().sceneSpec);
      const handled = logicRuntime.collisions(pairs);
      const now = performance.now();
      for (const [id, otherId] of pairs) {
        if (handled.has(otherId) || !actors.some((a) => a.id === id && a.physicsRole === 'player')) continue;
        const lastHit = lastCollisionTimeRef.current[otherId] ?? -Infinity;
        if (now - lastHit > 450) {
          lastCollisionTimeRef.current[otherId] = now;
          handlePlayerCollision(otherId);
        }
      }
    }

    // 2. CINEMATIC CAMERA SEQUENCER (Media Mode or Active Camera Tracks)
    // Phase 10A: a shot list drives the camera in media scenes (cuts, framing on the performers). Deterministic in time,
    // so the camera is set exactly (no smoothing) — the same frame the Player and video export render.
    // In Preview the shot also holds while paused / scrubbing (it is the film); in the editor a paused camera is free to orbit.
    const inPreview = !!useStudioStore.getState().fullPreview;
    const shotFrame = (isPlaying || inPreview) && !isDraggingGizmo && sceneSpec.mode === 'media' ? resolveShot(sceneSpec, currentTime) : null;
    const persp = camera as THREE.PerspectiveCamera;
    const wantFov = shotFrame ? shotFrame.fov : sceneSpec.camera.fov || 45;
    if (persp.isPerspectiveCamera && Math.abs(persp.fov - wantFov) > 0.01 && (shotFrame || isPlaying)) {
      persp.fov = wantFov;
      persp.updateProjectionMatrix();
    }
    if (shotFrame) {
      camera.position.set(...shotFrame.position);
      if (controlsRef.current) {
        controlsRef.current.target.set(...shotFrame.target);
        controlsRef.current.update();
      } else camera.lookAt(...shotFrame.target);
    } else if (isPlaying && !isDraggingGizmo && (sceneSpec.mode === 'media' || logicRuntime.controlsCamera)) {
      if (camMode === 'orbit') {
        camera.position.set(...sceneSpec.camera.position);
        if (controlsRef.current) {
          controlsRef.current.target.set(...sceneSpec.camera.target);
          controlsRef.current.update();
        }
      }
      if (camMode === 'orbit-360') {
        const angle = progress * Math.PI * 2;
        const radius = 6.2;
        _camPosVec.set(Math.sin(angle) * radius, 2.45, Math.cos(angle) * radius);
        _targetVec.set(0, 1.15, 0);
        camera.position.lerp(_camPosVec, 0.08);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(_targetVec, 0.08);
          controlsRef.current.update();
        }
      } else if (camMode === 'dolly-zoom-in') {
        const zDist = THREE.MathUtils.lerp(6.8, 3.6, progress);
        const yHeight = THREE.MathUtils.lerp(2.7, 1.65, progress);
        _camPosVec.set(Math.sin(progress * 0.8) * 1.1, yHeight, zDist);
        _targetVec.set(0, 1.1, 0);
        camera.position.lerp(_camPosVec, 0.08);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(_targetVec, 0.08);
          controlsRef.current.update();
        }
      } else if (camMode === 'crane-reveal') {
        const yHeight = THREE.MathUtils.lerp(0.85, 4.4, progress);
        const xPan = THREE.MathUtils.lerp(-2.6, 2.6, progress);
        _camPosVec.set(xPan, yHeight, 5.8);
        _targetVec.set(0, 1.3, 0);
        camera.position.lerp(_camPosVec, 0.08);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(_targetVec, 0.08);
          controlsRef.current.update();
        }
      } else if (camMode === 'top-down-isometric' || camMode === 'isometric-game') {
        _camPosVec.set(0, 6.2, 8.2);
        _targetVec.set(0, 0.9, 0);
        camera.position.lerp(_camPosVec, 0.08);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(_targetVec, 0.08);
          controlsRef.current.update();
        }
      } else if (camMode === 'first-person-follow' || camMode === 'follow-target') {
        const targetActor =
          sceneSpec.actors.find((a) => a.id === sceneSpec.camera.followActorId) ||
          sceneSpec.actors.find((a) => a.id === selectedActorId) ||
          sceneSpec.actors[0];
        if (targetActor && controlsRef.current) {
          _camPosVec.set(
            targetActor.position[0],
            targetActor.position[1] + 2.2,
            targetActor.position[2] + 3.8
          );
          _targetVec.set(
            targetActor.position[0],
            targetActor.position[1] + 1.2,
            targetActor.position[2]
          );
          camera.position.lerp(_camPosVec, 0.08);
          controlsRef.current.target.lerp(_targetVec, 0.08);
          controlsRef.current.update();
        }
      } else if (camMode === 'cinematic-flythrough' && keyframeCurves) {
        // Phase 4: honour keyframe times + per-keyframe easing (getPoint maps u evenly across control points).
        const u = easedSplineProgress(sceneSpec.camera.keyframes, currentTime);
        keyframeCurves.posCurve.getPoint(u, _camPosVec);
        keyframeCurves.targetCurve.getPoint(u, _targetVec);
        camera.position.lerp(_camPosVec, 0.1);
        if (controlsRef.current) {
          controlsRef.current.target.lerp(_targetVec, 0.1);
          controlsRef.current.update();
        }
      }
    }
  });

  const env = sceneSpec.environment;

  return (
    <group onPointerMissed={() => selectActor(null)}>
      {/* 3-point studio lighting rig (src/render3d/stage3d — identical in the OmniStage Player) */}
      <Built factory={() => createLightingRig(env, gl.shadowMap.enabled)}
        deps={[env.keyLightColor, env.groundColor, env.ambientIntensity, env.keyLightIntensity, env.rimLightColor, gl.shadowMap.enabled]} />

      {/* Subtle Ambient Studio Sparkle Dust (shared builder, also in the Player) */}
      <Built factory={() => createAmbientDust(env)} deps={[env.rimLightColor]} />

      {/* Rich 3D World Environment (Terrains, Skybox, Clouds, Weather, Scatter Props) */}
      <WorldRenderer />

      {/* Invisible/Interactive Ground Click Target for Game Mode Player Movement */}
      <mesh
        position={[0, 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        onClick={(e) => {
          // In Game Mode, clicking the arena floor moves the Player actor toward that spot!
          if (sceneSpec.mode === 'game' && isPlaying) {
            e.stopPropagation();
            const player = sceneSpec.actors.find((a) => a.physicsRole === 'player');
            if (player) {
              const dx = (e.point.x - player.position[0]) * 0.45;
              const dz = (e.point.z - player.position[2]) * 0.45;
              movePlayerActor(dx, dz);
            }
          }
        }}
      >
        <planeGeometry args={[90, 90]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {env.reflectivePedestal && <Built factory={() => createPedestal(env)} deps={[env.groundColor, env.rimLightColor]} />}

      {env.groundGrid && <Built factory={() => createGroundGrid(env)} deps={[env.rimLightColor]} />}

      {/* Phase 7C: shared builder (also used by the Player) instead of drei's <ContactShadows> */}
      <Built factory={() => createContactShadows({ scale: 16, far: 5, opacity: 0.55, blur: 2 })} deps={[]} />

      {/* Declarative 3D Actors from SceneSpec */}
      {sceneSpec.actors.map((actor) => (
        <ActorRenderer
          key={actor.id}
          actor={actor}
          isSelected={actor.id === selectedActorId && !previewing}
          onRuntimeClick={(actorId) => logicRuntime.emit('actor-click', { actorId })}
        />
      ))}

      {/* Declarative VFX & 3D Marketing Callouts from SceneSpec */}
      {sceneSpec.vfx.filter((vfx) => vfx.visible !== false &&
        currentTime >= (vfx.startTime ?? 0) && currentTime <= (vfx.endTime ?? Infinity)).map((vfx) => (
        <VFXRenderer key={vfx.id} vfx={vfx} />
      ))}

      {/* Real-time Playable Collision & Tap Bursts */}
      {burstEffects.map((b) => (
        <CollisionBurstRenderer key={b.id} burst={b} />
      ))}

      {/* Interactive Camera Controls (Automatically yields when dragging 3D Gizmo) */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!isDraggingGizmo}
        enableDamping
        dampingFactor={0.07}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={2.0}
        maxDistance={22}
        target={sceneSpec.camera.target}
      />
    </group>
  );
};
