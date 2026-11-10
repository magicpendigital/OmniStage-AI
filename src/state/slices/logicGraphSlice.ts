/**
 * Phase 7C store slice — Node graph editing, execution console and agent auto-fix requests.
 * Composed into the single studio store in src/state/useStudioStore.ts.
 */
import { cloneSceneSpec } from '../../registry/assetRegistry';
import { ActorClickAction, AnimationType, CameraMode, ExecutionLogEntry, LogicEdge, LogicGraphSpec, LogicNode, SceneSpec, SkyboxPreset, WeatherType } from '../../types/scene.schema';
import { syncGraphWithScene } from '../../runtime/graphSync';
import type { StudioGet, StudioSet, StudioSlice } from '../studioTypes';

export const createLogicGraphSlice = (set: StudioSet, get: StudioGet): StudioSlice => ({

  // ================= PHASE 5: NODE GRAPH & EXECUTION CONSOLE ACTIONS =================
  setWorkspaceView: (workspaceView) => set({ workspaceView }),

  setFocusedLogicNodeId: (focusedLogicNodeId) =>
    set((state) => ({
      focusedLogicNodeId,
      workspaceView:
        focusedLogicNodeId && state.workspaceView === 'viewport' ? 'split' : state.workspaceView,
    })),

  setConsoleOpen: (isConsoleOpen) => set({ isConsoleOpen }),

  addLogicNode: (nodeInput) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      const graph: LogicGraphSpec = nextSpec.logicGraph || { nodes: [], edges: [] };
      const newNode: LogicNode = {
        ...nodeInput,
        id: nodeInput.id || `node-${Date.now().toString(36)}`,
        status: nodeInput.status || 'idle',
        runCount: nodeInput.runCount ?? 0,
      };
      graph.nodes.push(newNode);
      nextSpec.logicGraph = graph;
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));

      const logEntry: ExecutionLogEntry = {
        id: `log-add-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'info',
        nodeId: newNode.id,
        message: `Added [${newNode.type.toUpperCase()}] node "${newNode.title}" to Logic Graph.`,
      };

      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        focusedLogicNodeId: newNode.id,
        executionLogs: [...state.executionLogs.slice(-99), logEntry],
      };
    }),

  updateLogicNode: (nodeId, partial) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      const graph = nextSpec.logicGraph!;
      const idx = graph.nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) return state;

      const prevNode = graph.nodes[idx];
      const mergedParams = partial.params
        ? { ...prevNode.params, ...partial.params }
        : prevNode.params;

      const updatedNode: LogicNode = {
        ...prevNode,
        ...partial,
        params: mergedParams,
      };
      graph.nodes[idx] = updatedNode;

      // Bidirectional Sync: Apply node parameter edits directly to SceneSpec!
      let syncLogMessage: string | null = null;

      if (partial.params) {
        const p = mergedParams;
        const targetActorId = p.actorId || state.selectedActorId || nextSpec.actors[0]?.id;
        const actorIdx = nextSpec.actors.findIndex((a) => a.id === targetActorId);

        if (actorIdx !== -1 && updatedNode.category === 'actor-action') {
          const actor = nextSpec.actors[actorIdx];
          if (p.animation && p.animation !== actor.activeAnimation) {
            actor.activeAnimation = p.animation as AnimationType;
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" animation = ${p.animation}`;
          }
          if (p.activeClip && p.activeClip !== actor.activeClip) {
            actor.activeClip = String(p.activeClip);
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" GLTF skeletal clip = ${p.activeClip}`;
          }
          if (p.speed !== undefined) {
            const spd = Number(p.speed);
            if (!Number.isNaN(spd) && spd > 0) {
              actor.animationSpeed = spd;
              syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" animationSpeed = ${spd}x`;
            }
          }
          if (p.scoreDelta !== undefined) {
            actor.scoreValue = Number(p.scoreDelta) || 0;
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" scoreValue = +${actor.scoreValue} PTS`;
          }
          if (p.onClickAction) {
            actor.onClickAction = p.onClickAction as ActorClickAction;
            syncLogMessage = `Synced Node [${updatedNode.title}] -> Actor "${actor.name}" onClickAction = ${p.onClickAction}`;
          }
        }

        if (p.cameraMode && p.cameraMode !== nextSpec.camera.mode) {
          nextSpec.camera.mode = p.cameraMode as CameraMode;
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Camera Rig mode = ${p.cameraMode}`;
        }

        if (p.fov !== undefined && Number(p.fov) !== nextSpec.camera.fov) {
          nextSpec.camera.fov = Math.max(20, Math.min(110, Number(p.fov) || 45));
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Camera FOV = ${nextSpec.camera.fov}°`;
        }

        if (p.targetScore !== undefined && updatedNode.category === 'logic-gate') {
          nextSpec.gameRules.targetScore = Math.max(10, Number(p.targetScore) || 100);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> GameRule targetScore = ${nextSpec.gameRules.targetScore} PTS`;
        }

        if (p.timeLimitSeconds !== undefined && updatedNode.category === 'logic-gate') {
          nextSpec.gameRules.timeLimitSeconds = Math.max(5, Number(p.timeLimitSeconds) || 30);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> GameRule timeLimit = ${nextSpec.gameRules.timeLimitSeconds}s`;
        }

        if (p.skybox && p.skybox !== nextSpec.world.skybox) {
          nextSpec.world.skybox = p.skybox as SkyboxPreset;
          syncLogMessage = `Synced Node [${updatedNode.title}] -> World skybox = ${p.skybox}`;
        }

        if (p.weatherType && p.weatherType !== nextSpec.world.weather.type) {
          nextSpec.world.weather.type = p.weatherType as WeatherType;
          syncLogMessage = `Synced Node [${updatedNode.title}] -> World weather = ${p.weatherType}`;
        }

        if (p.headline !== undefined && updatedNode.type === 'media-pipeline') {
          nextSpec.marketingOverlay.headline = String(p.headline);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Marketing Headline = "${p.headline}"`;
        }

        if (p.ctaText !== undefined && updatedNode.type === 'media-pipeline') {
          nextSpec.marketingOverlay.ctaText = String(p.ctaText);
          syncLogMessage = `Synced Node [${updatedNode.title}] -> Marketing CTA = "${p.ctaText}"`;
        }

        if (updatedNode.type === 'robot-hardware') {
          const angle = Number(p.servoAngle ?? 45);
          if (angle < 0 || angle > 180) {
            updatedNode.status = 'error';
            updatedNode.errorMessage = `Servo angle ${angle}° exceeds safe mechanical range [0°..180°]`;
            syncLogMessage = `Hardware Limit Fault on [${updatedNode.title}]: Servo angle ${angle}° out of bounds [0°..180°]!`;
          } else {
            updatedNode.status = 'success';
            updatedNode.errorMessage = undefined;
            syncLogMessage = `Phygital I/O Sync [${updatedNode.title}]: ${p.servoChannel || 'Ch 1'} -> ${angle}°, OLED="${p.oledExpression || 'cyber-happy'}"`;
          }
        }
      }

      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      const nextLogs = [...state.executionLogs];

      if (syncLogMessage) {
        nextLogs.push({
          id: `log-sync-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          sceneTime: Number(state.currentTime.toFixed(2)),
          level: updatedNode.status === 'error' ? 'error' : 'action',
          nodeId: updatedNode.id,
          actorId: mergedParams.actorId,
          message: syncLogMessage,
          payload: mergedParams,
        });
      }

      return {
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        executionLogs: nextLogs.slice(-100),
      };
    }),

  removeLogicNode: (id) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      const target = nextSpec.logicGraph.nodes.find((n) => n.id === id);
      nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.filter((n) => n.id !== id);
      nextSpec.logicGraph.edges = nextSpec.logicGraph.edges.filter(
        (e) => e.sourceNodeId !== id && e.targetNodeId !== id
      );
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      const nextLogs = [
        ...state.executionLogs.slice(-99),
        {
          id: `log-rm-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          sceneTime: Number(state.currentTime.toFixed(2)),
          level: 'warn' as const,
          message: `Removed logic node "${target?.title || id}" and disconnected its wires.`,
        },
      ];
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        executionLogs: nextLogs,
      };
    }),

  connectLogicEdge: (edgeInput) =>
    set((state) => {
      if (edgeInput.sourceNodeId === edgeInput.targetNodeId) return state;
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      const graph = nextSpec.logicGraph!;
      const exists = graph.edges.some(
        (e) =>
          e.sourceNodeId === edgeInput.sourceNodeId &&
          e.sourcePortId === edgeInput.sourcePortId &&
          e.targetNodeId === edgeInput.targetNodeId &&
          e.targetPortId === edgeInput.targetPortId
      );
      if (exists) return state;

      const newEdge: LogicEdge = {
        ...edgeInput,
        id: edgeInput.id || `edge-${Date.now().toString(36)}`,
        active: true,
      };
      graph.edges.push(newEdge);

      const srcNode = graph.nodes.find((n) => n.id === newEdge.sourceNodeId);
      const dstNode = graph.nodes.find((n) => n.id === newEdge.targetNodeId);

      const logEntry: ExecutionLogEntry = {
        id: `log-wire-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        sceneTime: Number(state.currentTime.toFixed(2)),
        level: 'info',
        nodeId: dstNode?.id,
        message: `Connected wire: [${srcNode?.title || newEdge.sourceNodeId}] -> [${dstNode?.title || newEdge.targetNodeId}].`,
      };

      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        pastSpecs: [...state.pastSpecs.slice(-19), cloneSceneSpec(state.sceneSpec)],
        futureSpecs: [],
        sceneSpec: nextSpec,
        scenes: updatedScenes,
        executionLogs: [...state.executionLogs.slice(-99), logEntry],
      };
    }),

  removeLogicEdge: (edgeId) =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      nextSpec.logicGraph.edges = nextSpec.logicGraph.edges.filter((e) => e.id !== edgeId);
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        sceneSpec: nextSpec,
        scenes: updatedScenes,
      };
    }),

  autoLayoutLogicGraph: () =>
    set((state) => {
      const nextSpec = syncGraphWithScene(state.sceneSpec);
      if (!nextSpec.logicGraph) return state;
      const columnMap: Record<LogicNode['type'], number> = {
        trigger: 60,
        condition: 380,
        action: 700,
        'media-pipeline': 1020,
        'robot-hardware': 1020,
      };
      const rowCounters: Record<number, number> = {};

      nextSpec.logicGraph.nodes = nextSpec.logicGraph.nodes.map((node) => {
        const colX = columnMap[node.type] ?? 380;
        const rowIndex = rowCounters[colX] ?? 0;
        rowCounters[colX] = rowIndex + 1;
        return {
          ...node,
          position: {
            x: colX,
            y: 60 + rowIndex * 230,
          },
        };
      });
      const updatedScenes = state.scenes.map((s) => (s.id === state.activeSceneId ? nextSpec : s));
      return {
        sceneSpec: nextSpec,
        scenes: updatedScenes,
      };
    }),

  simulateNodeExecution: (nodeId) => {
    const state = get();
    const graph = state.sceneSpec.logicGraph;
    if (!graph) return;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Validate potential errors so debugger & AI Auto-Fix can be tested
    if (
      node.type === 'robot-hardware' &&
      (Number(node.params.servoAngle) < 0 || Number(node.params.servoAngle) > 180)
    ) {
      state.markNodeExecution(
        node.id,
        'error',
        `Servo angle ${node.params.servoAngle}° out of safe bounds [0°..180°]`
      );
      state.appendLog({
        level: 'error',
        nodeId: node.id,
        message: `Execution Error in [${node.title}]: Servo angle ${node.params.servoAngle}° exceeds hardware limit [0°..180°].`,
        payload: node.params,
      });
      return;
    }

    if (
      node.category === 'actor-action' &&
      node.params.actorId &&
      !state.sceneSpec.actors.some((a) => a.id === node.params.actorId)
    ) {
      state.markNodeExecution(node.id, 'error', `Missing target actor ID: ${node.params.actorId}`);
      state.appendLog({
        level: 'error',
        nodeId: node.id,
        actorId: node.params.actorId,
        message: `Null Actor Reference in [${node.title}]: Target actor '${node.params.actorId}' no longer exists on stage.`,
        payload: node.params,
      });
      return;
    }

    // Normal execution pulse
    state.markNodeExecution(node.id, 'success');

    if (node.category === 'actor-action') {
      const targetActor =
        state.sceneSpec.actors.find((a) => a.id === node.params.actorId) ||
        state.sceneSpec.actors[0];
      if (targetActor) {
        state.triggerActorInteraction(targetActor);
      }
    } else if (node.type === 'condition') {
      const met = state.gameScore >= (Number(node.params.targetScore) || 100);
      state.appendLog({
        level: met ? 'trigger' : 'warn',
        nodeId: node.id,
        message: `Evaluated [${node.title}]: Score ${state.gameScore} / ${node.params.targetScore || 100} -> ${met ? 'TRUE (Goal Met)' : 'FALSE (Below Threshold)'}.`,
        payload: { currentScore: state.gameScore, targetScore: node.params.targetScore },
      });
    } else {
      state.appendLog({
        level: node.type === 'trigger' ? 'trigger' : 'action',
        nodeId: node.id,
        message: `Executed node [${node.title}] (${node.category}) successfully.`,
        payload: node.params,
      });
    }
  },

  triggerAgentAutoFix: (logEntry) =>
    set((state) => {
      const brokenNode = state.sceneSpec.logicGraph?.nodes.find((n) => n.id === logEntry.nodeId);
      const fixPrompt = `Auto-Fix Execution Issue on Node "${brokenNode?.title || logEntry.nodeId || 'Stage Logic'}": ${logEntry.message} (Please update the SceneSpec actors, gameRules, or logicGraph parameters so this node executes cleanly without warnings or errors).`;
      return {
        pendingAgentFixPrompt: fixPrompt,
      };
    }),

  clearPendingAgentFixPrompt: () => set({ pendingAgentFixPrompt: null }),
});
