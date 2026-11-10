/**
 * Phase 7 — Logic graph ⇄ SceneSpec sync (moved out of the studio store so the OmniStage Player can use it).
 */
import { cloneSceneSpec } from '../registry/assetRegistry';
import type { LogicEdge, LogicGraphSpec, LogicNode, SceneSpec } from '../types/scene.schema';

/**
 * Bidirectional Sync Helper (`syncGraphWithScene`):
 * Populates a rich ComfyUI / n8n style visual LogicGraphSpec from any SceneSpec
 * if `scene.logicGraph` is missing or empty, and keeps actor/camera/rule references valid.
 */
export function syncGraphWithScene(scene: SceneSpec): SceneSpec {
  const cloned = cloneSceneSpec(scene);
  const existingNodes = cloned.logicGraph?.nodes || [];
  const existingEdges = cloned.logicGraph?.edges || [];

  if (existingNodes.length > 0) {
    // Sync existing node params with latest SceneSpec values
    const syncedNodes = existingNodes.map((node) => {
      const nextParams = { ...node.params };
      if (nextParams.actorId) {
        const actor = cloned.actors.find((a) => a.id === nextParams.actorId);
        if (actor) {
          nextParams.actorName = actor.name;
          if (node.category === 'actor-action') {
            nextParams.animation = actor.activeAnimation;
            nextParams.activeClip = actor.activeClip || actor.availableClips?.[0] || 'Idle';
            nextParams.speed = actor.animationSpeed ?? 1;
            nextParams.scoreDelta = actor.scoreValue ?? 25;
            nextParams.onClickAction = actor.onClickAction;
          }
        }
      }
      if (node.id === 'node-camera-track') {
        nextParams.cameraMode = cloned.camera.mode;
        nextParams.fov = cloned.camera.fov;
      }
      if (node.id === 'node-score-gate') {
        nextParams.targetScore = cloned.gameRules.targetScore;
        nextParams.timeLimitSeconds = cloned.gameRules.timeLimitSeconds;
      }
      if (node.id === 'node-world-stage') {
        nextParams.skybox = cloned.world?.skybox || 'daylight-sky';
        nextParams.weatherType = cloned.world?.weather?.type || 'clear';
        nextParams.terrainType = cloned.world?.terrain?.type || 'flat-grid';
      }
      return { ...node, params: nextParams };
    });

    cloned.logicGraph = {
      nodes: syncedNodes,
      edges: existingEdges,
    };
    return cloned;
  }

  // Build default visual node graph from SceneSpec
  const primaryActor = cloned.actors[0];
  const secondaryActor = cloned.actors[1] || cloned.actors[0];
  const firstVfx = cloned.vfx[0];

  const nodes: LogicNode[] = [
    {
      id: 'node-scene-start',
      type: 'trigger',
      title: 'On Scene Start',
      category: 'event-trigger',
      position: { x: 60, y: 70 },
      inputs: [],
      outputs: [
        { id: 'out-flow', label: 'Exec Flow', dataType: 'flow' },
        { id: 'out-signal', label: 'Init Signal', dataType: 'signal' },
      ],
      params: {
        eventType: 'scene-start',
        engineType: cloned.engineType,
        autoPlay: true,
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-actor-interact',
      type: 'trigger',
      title: 'On Actor Click / Tap',
      category: 'event-trigger',
      position: { x: 60, y: 300 },
      inputs: [],
      outputs: [
        { id: 'out-flow', label: 'Tap Flow', dataType: 'flow' },
        { id: 'out-actor', label: 'Clicked Actor', dataType: 'actor' },
      ],
      params: {
        eventType: 'actor-click',
        actorId: primaryActor?.id || '',
        actorName: primaryActor?.name || 'Stage Actor',
        inputKey: 'Pointer / WASD',
      },
      status: 'running',
      runCount: 2,
    },
    {
      id: 'node-world-stage',
      type: 'media-pipeline',
      title: 'World Stage & Atmosphere',
      category: 'camera-vfx',
      position: { x: 370, y: 50 },
      inputs: [{ id: 'in-flow', label: 'Init Flow', dataType: 'flow' }],
      outputs: [{ id: 'out-flow', label: 'Stage Ready', dataType: 'flow' }],
      params: {
        skybox: cloned.world?.skybox || 'daylight-sky',
        terrainType: cloned.world?.terrain?.type || 'flat-grid',
        weatherType: cloned.world?.weather?.type || 'clear',
        aspectRatio: cloned.aspectRatio,
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-actor-motion',
      type: 'action',
      title: `Play Animation · ${primaryActor?.name || 'Hero Rig'}`,
      category: 'actor-action',
      position: { x: 370, y: 270 },
      inputs: [
        { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
        { id: 'in-actor', label: 'Target Actor', dataType: 'actor' },
      ],
      outputs: [
        { id: 'out-flow', label: 'Next Action', dataType: 'flow' },
        { id: 'out-score', label: 'Score Delta', dataType: 'number' },
      ],
      params: {
        actorId: primaryActor?.id || '',
        actorName: primaryActor?.name || 'Hero Rig',
        animation: primaryActor?.activeAnimation || 'idle',
        activeClip: primaryActor?.activeClip || primaryActor?.availableClips?.[0] || 'Idle',
        speed: primaryActor?.animationSpeed ?? 1,
        scoreDelta: primaryActor?.scoreValue ?? 25,
        onClickAction: primaryActor?.onClickAction || 'collect',
      },
      status: 'running',
      runCount: 3,
    },
    {
      id: 'node-score-gate',
      type: 'condition',
      title: 'If Score >= Target Goal',
      category: 'logic-gate',
      position: { x: 690, y: 250 },
      inputs: [
        { id: 'in-flow', label: 'Check Flow', dataType: 'flow' },
        { id: 'in-val', label: 'Current Score', dataType: 'number' },
      ],
      outputs: [
        { id: 'out-true', label: 'Goal Met (True)', dataType: 'flow' },
        { id: 'out-false', label: 'Keep Playing', dataType: 'flow' },
      ],
      params: {
        conditionType: 'score-threshold',
        targetScore: cloned.gameRules.targetScore || 100,
        timeLimitSeconds: cloned.gameRules.timeLimitSeconds || 30,
        cooldownMs: 250,
      },
      status: 'idle',
      runCount: 2,
    },
    {
      id: 'node-camera-track',
      type: 'action',
      title: 'Switch Camera & Spawn VFX',
      category: 'camera-vfx',
      position: { x: 690, y: 40 },
      inputs: [{ id: 'in-flow', label: 'Stage Flow', dataType: 'flow' }],
      outputs: [{ id: 'out-flow', label: 'Render Out', dataType: 'flow' }],
      params: {
        cameraMode: cloned.camera.mode,
        fov: cloned.camera.fov || 45,
        vfxId: firstVfx?.id || '',
        vfxType: firstVfx?.type || 'sparkles',
        actorId: secondaryActor?.id || primaryActor?.id || '',
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-robot-servo',
      type: 'robot-hardware',
      title: 'Phygital Bridge · Servo & OLED',
      category: 'robot-servo-io',
      position: { x: 1000, y: 60 },
      inputs: [
        { id: 'in-flow', label: 'Sync Signal', dataType: 'flow' },
        { id: 'in-angle', label: 'Angle (deg)', dataType: 'number' },
      ],
      outputs: [{ id: 'out-telemetry', label: 'HW Telemetry', dataType: 'signal' }],
      params: {
        servoChannel: 'Ch 1 (Head Pan)',
        servoAngle: 45,
        oledExpression: 'cyber-happy',
        voiceTtsText: 'Target locked! Ready for action.',
      },
      status: 'success',
      runCount: 1,
    },
    {
      id: 'node-cta-endcard',
      type: 'media-pipeline',
      title: 'Trigger CTA & MRAID Output',
      category: 'audio-caption',
      position: { x: 1000, y: 280 },
      inputs: [{ id: 'in-flow', label: 'On Goal Met', dataType: 'flow' }],
      outputs: [],
      params: {
        headline: cloned.marketingOverlay.headline,
        ctaText: cloned.marketingOverlay.ctaText,
        exportFormat: 'TikTok MRAID 3.0 / WebM 60fps',
      },
      status: 'idle',
      runCount: 0,
    },
  ];

  const edges: LogicEdge[] = [
    {
      id: 'edge-start-world',
      sourceNodeId: 'node-scene-start',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-world-stage',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-world-cam',
      sourceNodeId: 'node-world-stage',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-camera-track',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-cam-robot',
      sourceNodeId: 'node-camera-track',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-robot-servo',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-tap-motion',
      sourceNodeId: 'node-actor-interact',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-actor-motion',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-tap-actor-ref',
      sourceNodeId: 'node-actor-interact',
      sourcePortId: 'out-actor',
      targetNodeId: 'node-actor-motion',
      targetPortId: 'in-actor',
      active: true,
    },
    {
      id: 'edge-motion-gate',
      sourceNodeId: 'node-actor-motion',
      sourcePortId: 'out-flow',
      targetNodeId: 'node-score-gate',
      targetPortId: 'in-flow',
      active: true,
    },
    {
      id: 'edge-score-val',
      sourceNodeId: 'node-actor-motion',
      sourcePortId: 'out-score',
      targetNodeId: 'node-score-gate',
      targetPortId: 'in-val',
      active: true,
    },
    {
      id: 'edge-gate-cta',
      sourceNodeId: 'node-score-gate',
      sourcePortId: 'out-true',
      targetNodeId: 'node-cta-endcard',
      targetPortId: 'in-flow',
      active: false,
    },
  ];

  cloned.logicGraph = { nodes, edges };
  return cloned;
}
