import { clickRunsBuiltIn } from '../runtime/gameSlice';
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
import { buildCompositeActor } from '../render3d/compositeActors';
import { disposeObject } from '../render3d/h';
import { createActorBadge } from '../render3d/vfx3d';
import { Built } from './Built';
import { actorBadgeText, actorMotion } from '../render3d/actorMotion';
import { matchClipName, performedActor } from '../runtime/cinematics';

interface ActorRendererProps {
  actor: ActorNode;
  isSelected: boolean;
  onRuntimeClick?: (actorId: string) => boolean;
}

function CanvasBadgeSprite({ text, position }: { text: string; position: [number, number, number] }) {
  return (
    <group position={position}>
      <Built factory={() => createActorBadge(text)} deps={[text]} />
    </group>
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

    // Phase 10A: shared fuzzy matching (Walk → Walking, Sit → Sitting…), same as the Player.
    const requestedClip = matchClipName(actor.activeClip || (actor.activeAnimation !== 'idle' ? actor.activeAnimation : undefined), names);
    const target = requestedClip ? actions[requestedClip] : undefined;
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
function CompositeProceduralMesh({ actor, unboxTapCount = 0 }: { actor: ActorNode; unboxTapCount?: number }) {
  const key = [actor.assetId, actor.primaryColor, actor.secondaryColor, actor.metalness, actor.roughness, unboxTapCount].join('|');
  const object = useMemo(() => buildCompositeActor(actor, unboxTapCount), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeObject(object), [object]);
  return <primitive object={object} />;
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
  // Phase 10A: in media mode the actor's performance (walk paths, clip changes, facing) drives what is drawn.
  const sceneActors = useStudioStore((s) => s.sceneSpec.actors);
  const sceneWorld = useStudioStore((s) => s.sceneSpec.world);
  const sceneDialogue = useStudioStore((s) => s.sceneSpec.dialogue);
  const performed = useMemo(
    () => performedActor(actor, { mode, actors: sceneActors, world: sceneWorld, dialogue: sceneDialogue }, currentTime),
    [actor, mode, sceneActors, sceneWorld, sceneDialogue, currentTime]
  );

  // Check timeline window visibility in Media mode
  const isWithinTimelineWindow =
    mode === 'game' ||
    ((actor.startTime === undefined || currentTime >= actor.startTime) &&
      (actor.endTime === undefined || currentTime <= actor.endTime));

  useFrame((state, delta) => {
    if (!outerGroupRef.current || !animGroupRef.current) return;

    // Sync outer group to SceneSpec when user is NOT actively dragging the TransformControls gizmo
    if (!isDraggingGizmo) {
      outerGroupRef.current.position.set(performed.position[0], performed.position[1], performed.position[2]);
      outerGroupRef.current.rotation.set(performed.rotation[0], performed.rotation[1], performed.rotation[2]);
      outerGroupRef.current.scale.set(actor.scale[0], actor.scale[1], actor.scale[2]);
    }

    const anim = animGroupRef.current;
    const motion = actorMotion(performed, mode, currentTime, !!gltfUrl, clickPulse, state.clock.getElapsedTime(), hovered);
    const [offsetX, offsetY, offsetZ] = motion.offset;
    const [rotX, rotY, rotZ] = motion.rotation;
    if (clickPulse > 0.01) setClickPulse((prev) => Math.max(0, prev - delta * 3.0));

    anim.position.x = THREE.MathUtils.damp(anim.position.x, offsetX, 10, delta);
    anim.position.y = THREE.MathUtils.damp(anim.position.y, offsetY, 10, delta);
    anim.position.z = THREE.MathUtils.damp(anim.position.z, offsetZ, 10, delta);

    anim.rotation.x = THREE.MathUtils.damp(anim.rotation.x, rotX, 10, delta);
    anim.rotation.y = THREE.MathUtils.damp(anim.rotation.y, rotY, 10, delta);
    anim.rotation.z = THREE.MathUtils.damp(anim.rotation.z, rotZ, 10, delta);

    anim.scale.setScalar(THREE.MathUtils.damp(anim.scale.x, motion.scale, 10, delta));
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectActor(actor.id);
    setClickPulse(1.0);
    const graphHandled = isPlaying && !!onRuntimeClick?.(actor.id);
    if (clickRunsBuiltIn(actor, mode, graphHandled)) triggerActorInteraction(actor);
  };

  if (actor.visible === false || !isWithinTimelineWindow) return null;

  const fallbackMesh = <CompositeProceduralMesh actor={actor} unboxTapCount={unboxTapCount} />;

  // Attach interactive 3D TransformControls gizmo when selected, unlocked, and NOT actively playing Game Mode
  const showTransformGizmo = isSelected && !actor.locked && !(mode === 'game' && isPlaying);

  const actorContent = (
    <group
      ref={outerGroupRef}
      position={performed.position}
      rotation={performed.rotation}
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
              <RiggedGltfModel key={gltfUrl} url={gltfUrl} actor={performed} />
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
          text={actorBadgeText(actor, unboxTapCount)}
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
