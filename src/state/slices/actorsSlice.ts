/**
 * Phase 7C store slice — 3D actors, gizmos, asset spawning and custom assets.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { ASSET_REGISTRY, cloneSceneSpec } from '../../registry/assetRegistry';
import { ActorNode, ExecutionLogEntry, Node2D, SemanticAssetEntry } from '../../types/scene.schema';
import { syncGraphWithScene } from '../../runtime/graphSync';
import { findUnoccupiedPosition } from '../storeHelpers';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createActorsSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({

  // ================= 3D ACTOR & GIZMO ACTIONS =================
  selectActor: (id) => set({ selectedActorId: id }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setIsDraggingGizmo: (isDraggingGizmo) => set({ isDraggingGizmo }),

  updateActorTransform: (actorId, position, rotation, scale) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx === -1 || nextSpec.actors[idx].locked) return state;
      nextSpec.actors[idx] = {
        ...nextSpec.actors[idx],
        position: [
          Number(position[0].toFixed(2)),
          Number(Math.max(0, position[1]).toFixed(2)),
          Number(position[2].toFixed(2)),
        ],
        rotation: [
          Number(rotation[0].toFixed(2)),
          Number(rotation[1].toFixed(2)),
          Number(rotation[2].toFixed(2)),
        ],
        scale: [
          Number(Math.max(0.1, scale[0]).toFixed(2)),
          Number(Math.max(0.1, scale[1]).toFixed(2)),
          Number(Math.max(0.1, scale[2]).toFixed(2)),
        ],
      };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
      };
    }),

  updateActorProperty: (actorId, partialProps) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx === -1) return state;
      nextSpec.actors[idx] = { ...nextSpec.actors[idx], ...partialProps };
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
      };
    }),

  updateActor: (actorId, patch) => get().updateActorProperty(actorId, patch),

  registerActorClips: (actorId, clipNames) =>
    set((state) => {
      const actor = state.sceneSpec.actors.find((a) => a.id === actorId);
      if (!actor) return state;
      const existing = actor.availableClips || [];
      if (existing.length === clipNames.length && existing.every((c, i) => c === clipNames[i])) {
        return state;
      }
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const idx = nextSpec.actors.findIndex((a) => a.id === actorId);
      if (idx !== -1) {
        nextSpec.actors[idx].availableClips = clipNames;
        if (!nextSpec.actors[idx].activeClip && clipNames.length > 0) {
          nextSpec.actors[idx].activeClip = clipNames[0];
        }
      }
      return { sceneSpec: syncGraphWithScene(nextSpec) };
    }),

  duplicateActor: (actorId) =>
    set((state) => {
      const source = state.sceneSpec.actors.find((a) => a.id === actorId);
      if (!source) return state;
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      const newPos = findUnoccupiedPosition(nextSpec.actors);
      const copy: ActorNode = {
        ...JSON.parse(JSON.stringify(source)),
        id: `actor-${Date.now().toString(36)}`,
        name: `${source.name} Copy`,
        position: newPos,
      };
      nextSpec.actors.push(copy);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
        selectedActorId: copy.id,
      };
    }),

  spawnAsset: (assetId, customGlbUrl, customName) =>
    set((state) => {
      const customFound = state.customRegistryAssets.find((c) => c.assetId === assetId);
      const entry =
        customFound ?? ASSET_REGISTRY[assetId] ?? ASSET_REGISTRY['starter-primitive-showcase'];
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      nextSpec.engineType = '3d';
      const spawnPos = findUnoccupiedPosition(nextSpec.actors);
      const newActor: ActorNode = {
        id: `actor-${Date.now().toString(36)}`,
        name: customName || `${entry.name}`,
        assetId: entry.assetId,
        modelUrl: customGlbUrl || entry.modelUrl,
        customGlbUrl,
        position: spawnPos,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        primaryColor: entry.defaultPrimaryColor,
        secondaryColor: entry.defaultSecondaryColor,
        metalness: entry.defaultMetalness,
        roughness: entry.defaultRoughness,
        activeAnimation: entry.defaultAnimation,
        activeClip: entry.defaultClip,
        availableClips: entry.embeddedClips,
        animationSpeed: 1,
        physicsRole: entry.defaultPhysicsRole,
        onClickAction: entry.defaultClickAction,
        scoreValue: entry.defaultScoreValue,
        startTime: 0,
        endTime: nextSpec.durationSeconds || 8,
        enterEffect: 'pop-in',
        unboxTapsRequired: entry.assetId === 'mystery-gift-box' ? 3 : undefined,
        revealAssetId: entry.assetId === 'mystery-gift-box' ? 'sports-sneaker-pro' : undefined,
      };
      nextSpec.actors.push(newActor);

      // Automatically add an Action node for the newly spawned actor in the LogicGraph
      if (nextSpec.logicGraph) {
        const nodeCount = nextSpec.logicGraph.nodes.length;
        const newNodeId = `node-actor-${newActor.id}`;
        nextSpec.logicGraph.nodes.push({
          id: newNodeId,
          type: 'action',
          title: `Actor · ${newActor.name}`,
          category: 'actor-action',
          position: { x: 370, y: 120 + (nodeCount % 4) * 190 },
          inputs: [
            { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
            { id: 'in-actor', label: 'Actor Ref', dataType: 'actor' },
          ],
          outputs: [
            { id: 'out-flow', label: 'Next Action', dataType: 'flow' },
            { id: 'out-score', label: 'Score Delta', dataType: 'number' },
          ],
          params: {
            actorId: newActor.id,
            actorName: newActor.name,
            animation: newActor.activeAnimation,
            activeClip: newActor.activeClip || 'Idle',
            speed: 1,
            scoreDelta: newActor.scoreValue ?? 25,
            onClickAction: newActor.onClickAction,
          },
          status: 'success',
          runCount: 1,
        });
        nextSpec.logicGraph.edges.push({
          id: `edge-spawn-${newActor.id}`,
          sourceNodeId: 'node-actor-interact',
          sourcePortId: 'out-flow',
          targetNodeId: newNodeId,
          targetPortId: 'in-flow',
          active: true,
        });
      }

      const spawnLog: ExecutionLogEntry = {
        id: `log-spawn-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'action',
        actorId: newActor.id,
        nodeId: `node-actor-${newActor.id}`,
        message: `Spawned 3D Actor "${newActor.name}" at [${spawnPos.join(', ')}] and linked Action Node in Logic Graph.`,
      };

      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId: newActor.id,
        executionLogs: [...state.executionLogs.slice(-99), spawnLog],
      };
    }),

  registerAndSpawnCustomAsset: (name, url, fileType) => {
    const state = get();
    if (fileType === 'glb') {
      const customId = `custom-glb-${Date.now().toString(36)}`;
      const newEntry: SemanticAssetEntry = {
        assetId: customId,
        name: name || 'Imported GLTF Asset',
        category: 'gltf-rigged',
        description: 'User-imported custom .GLB / .GLTF 3D model.',
        modelUrl: url,
        defaultPrimaryColor: '#06B6D4',
        defaultSecondaryColor: '#F59E0B',
        defaultMetalness: 0.6,
        defaultRoughness: 0.3,
        defaultAnimation: 'idle',
        defaultPhysicsRole: 'dynamic',
        defaultClickAction: 'bounce',
        defaultScoreValue: 25,
        boundingBox: { width: 1.5, height: 2.0, depth: 1.5 },
        attachmentSockets: { ground: [0, 0, 0], top_badge: [0, 2.3, 0] },
        supportedAnimations: ['idle', 'spin', 'float', 'bounce'],
      };
      set((s) => ({
        customRegistryAssets: [newEntry, ...s.customRegistryAssets],
      }));
      get().spawnAsset(customId, url, name);
    } else {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.engineType = '2d';
      const newNode: Node2D = {
        id: `node2d-${Date.now().toString(36)}`,
        name: name || 'Imported 2D Sprite',
        type: 'sprite-actor',
        x: 480,
        y: 280,
        width: 110,
        height: 110,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        fill: '#06B6D4',
        stroke: '#F8FAFC',
        imageUrl: url,
        physics2D: 'bouncing',
        scoreValue: 25,
      };
      nextSpec.nodes2D.push(newNode);
      set((s) => ({
        pastSpecs: [...s.pastSpecs.slice(-19), cloneSceneSpec(s.sceneSpec)],
        futureSpecs: [],
        sceneSpec: syncGraphWithScene(nextSpec),
        selectedNode2DId: newNode.id,
      }));
    }
  },

  removeActor: (actorId) =>
    set((state) => {
      const nextSpec = cloneSceneSpec(state.sceneSpec);
      nextSpec.actors = nextSpec.actors.filter((a) => a.id !== actorId);
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        selectedActorId:
          state.selectedActorId === actorId
            ? (nextSpec.actors[0]?.id ?? null)
            : state.selectedActorId,
      };
    }),
});
