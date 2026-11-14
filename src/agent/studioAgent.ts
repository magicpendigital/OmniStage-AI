import {
  ASSET_REGISTRY,
  cloneSceneSpec,
  createBlankSceneSpec,
  DEFAULT_WORLD_SPEC,
  SCENE_TEMPLATES,
} from '../registry/assetRegistry';
import {
  ActorCoordinateSummary,
  ActorNode,
  AnimationType,
  ExecutionLogEntry,
  LogicEdge,
  LogicGraphSpec,
  LogicNode,
  LogicNodePort,
  LogicNodeType,
  PhysicsRole,
  DirectorSkill,
  SceneSpec,
  VerificationReport,
  VisionQAIssue,
  VisionQAReport,
} from '../types/scene.schema';
import { useStudioStore } from '../state/useStudioStore';
import { buildExecutionRepairPrompt } from './systemPrompts';
import { DEFAULT_PATCH_ROUNDS, PatchProposal, runPatchLoop } from './patchLoop';
import { aiHeaders } from './aiClient';
import { inferSkillContext, mergeSystemPrompt, selectDirectorSkills } from './directorSkills';
import { buildMemoryContext, selectMemories } from './memory';
import { attachExtensionRecipes, buildExtensionPresetContext, enabledContributions } from '../extensions/registry';
import { workspaceApi } from '../workspace/workspaceClient';
import { autoFixSceneSpec, describeIssuesForAgent } from '../verification/sceneVerifier';
import { createDefaultAudioSpec } from '../audio/audioBus';
import { captionsFromScript } from '../media/captions';
import type { Particle2DPreset } from '../types/scene.schema';

export {
  detectStoryboardIntent,
  generateStoryboardWithAgent,
  normalizeGeneratedSceneSpec,
} from './storyboardAgent';
export type { StoryboardIntent, StoryboardGenerationResult } from './storyboardAgent';

export interface AgentMutationResult {
  assistantMessage: string;
  diffSummary: string[];
  updatedSceneSpec: SceneSpec;
  /** Phase 4: Director Skill ids injected into this turn. */
  skillsUsed?: string[];
  /** Phase 4: verification report of updatedSceneSpec after the deterministic/AI repair loop. */
  verification?: VerificationReport;
}

const AUDIO_PROMPT = /\b(sfx|sound|sounds|audio)\b|âm thanh|tiếng động|hiệu ứng âm/i;
const CAPTION_PROMPT = /\b(captions?|subtitles?)\b|phụ đề|lời thoại/i;
const PARTICLE_PROMPTS: Array<[RegExp, Particle2DPreset]> = [
  [/\bfire\b|lửa/i, 'fire'],
  [/\bsmoke\b|khói/i, 'smoke'],
  [/\bconfetti\b|pháo giấy/i, 'confetti'],
  [/\brain\b|mưa/i, 'rain'],
  [/\bsnow\b|tuyết/i, 'snow'],
  [/\bpixel\b/i, 'pixel-burst'],
  [/\bmagic\b|phép thuật/i, 'magic-trail'],
  [/\bsparkles?\b|\bparticles?\b|lấp lánh/i, 'sparkle'],
];

export function extractActorCoordinateSummaries(spec: SceneSpec): ActorCoordinateSummary[] {
  return spec.actors.map((a) => ({
    id: a.id,
    name: a.name,
    assetId: a.assetId,
    physicsRole: a.physicsRole,
    worldPosition: a.position,
    scale: a.scale,
    boundingBox: ASSET_REGISTRY[a.assetId]?.boundingBox || {
      width: 1.4,
      height: 1.8,
      depth: 1.4,
    },
  }));
}

/**
 * Deterministic Local Scene Authoring & Mutator Engine (Supports From-Scratch 3D Worlds, Rigged GLTFs & 2D Platformers).
 * Every result is passed through `finalizeLogicGraph` so mechanics always arrive as connected trigger -> condition -> action nodes.
 */
export function applyLocalHeuristicMutation(
  prompt: string,
  currentSpec: SceneSpec
): AgentMutationResult {
  const result = applyLocalHeuristicMutationCore(prompt, currentSpec);
  if (AUDIO_PROMPT.test(prompt) && !result.updatedSceneSpec.audio?.enabled) {
    result.updatedSceneSpec.audio = createDefaultAudioSpec(true);
    result.diffSummary = [...result.diffSummary, 'Enabled procedural SFX cues (collect=coin, jump, hit, win, lose)'];
  }
  const draft = result.updatedSceneSpec;
  if (CAPTION_PROMPT.test(prompt) && !draft.captions?.length) {
    draft.captions = captionsFromScript(`${draft.title}. ${draft.description || ''}`, Math.max(2, draft.durationSeconds || 8));
    result.diffSummary = [...result.diffSummary, `Added ${draft.captions.length} timed caption cue(s) (WebVTT-exportable)`];
  }
  const particle = draft.engineType === '2d' ? PARTICLE_PROMPTS.find(([re]) => re.test(prompt))?.[1] : undefined;
  if (particle && !draft.nodes2D.some((n) => n.type === 'particle-emitter' && n.emitter?.preset === particle)) {
    const area = particle === 'rain' || particle === 'snow';
    draft.nodes2D.push({
      id: `node2d-fx-${particle}-${Date.now().toString(36)}`,
      name: `${particle} FX`,
      type: 'particle-emitter',
      x: 500,
      y: area ? 300 : 420,
      width: area ? 1000 : 160,
      height: area ? 600 : 140,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      fill: 'transparent',
      stroke: '#A78BFA',
      physics2D: 'none',
      emitter: { preset: particle, seed: 42 },
    });
    result.diffSummary = [...result.diffSummary, `Added a deterministic "${particle}" 2D particle emitter`];
  }
  const { spec, notes } = finalizeLogicGraph(result.updatedSceneSpec);
  return {
    ...result,
    updatedSceneSpec: spec,
    diffSummary: notes.length ? [...result.diffSummary, ...notes] : result.diffSummary,
  };
}

function applyLocalHeuristicMutationCore(
  prompt: string,
  currentSpec: SceneSpec
): AgentMutationResult {
  const lower = prompt.toLowerCase();
  const next = cloneSceneSpec(currentSpec);
  if (!next.world) next.world = JSON.parse(JSON.stringify(DEFAULT_WORLD_SPEC));
  const diffs: string[] = [];

  // 1. Check 2D Engine / Platformer / Vector requests
  if (
    lower.includes('2d') ||
    lower.includes('platformer') ||
    lower.includes('vector') ||
    lower.includes('sprite')
  ) {
    const preset2d = createBlankSceneSpec('2d', 'Neon 2D Vector Platformer');
    preset2d.mode = 'game';
    preset2d.nodes2D.push(
      {
        id: 'node2d-plat-upper',
        name: 'Upper Neon Ledge',
        type: 'tile-platform',
        x: 680,
        y: 350,
        width: 280,
        height: 28,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        fill: '#1E293B',
        stroke: '#EC4899',
        strokeWidth: 2,
        shapeKind: 'rect',
        physics2D: 'static-platform',
      },
      {
        id: 'node2d-star-top',
        name: 'Upper Star Bonus',
        type: 'vector-shape',
        x: 680,
        y: 285,
        width: 46,
        height: 46,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        fill: '#FBBF24',
        stroke: '#FEF08A',
        strokeWidth: 2,
        shapeKind: 'star',
        physics2D: 'collectible',
        scoreValue: 50,
      }
    );
    return {
      assistantMessage:
        'Built a 2D Vector Platformer & Motion Scene from scratch with a playable 2D Cyber Runner, multi-tier solid neon platforms, and floating star collectibles.',
      diffSummary: [
        'Switched engineType to "2d" (1000×600 Vector & Sprite Canvas)',
        'Spawned 2D Hero Runner (WASD/Space jump physics) + multi-tier solid platforms',
        'Added floating Star Collectibles (+25/+50 PTS) in Game Mode',
      ],
      updatedSceneSpec: preset2d,
    };
  }

  // 2. Check Forest / Nature / Fox / Island World From Scratch requests
  if (
    lower.includes('forest') ||
    lower.includes('fox') ||
    lower.includes('nature') ||
    lower.includes('hills') ||
    lower.includes('trees')
  ) {
    const foxPreset = cloneSceneSpec(SCENE_TEMPLATES['open-world-nature-island']);
    return {
      assistantMessage:
        'Authored an Open-World 3D Forest Valley from scratch featuring procedural grassy hills, 28 scattered pine trees, 16 boulders, drifting clouds, and a rigged Wild Arctic Fox (.GLB) running across the clearing.',
      diffSummary: [
        'Generated "grassy-hills" 3D terrain + "daylight-sky" & volumetric clouds',
        'Scattered 28 Pine Trees and 16 Mossy Boulders around the valley',
        'Spawned Rigged Arctic Fox (.glb) playing skeletal "Run" clip + Soaring Flamingo',
      ],
      updatedSceneSpec: foxPreset,
    };
  }

  if (lower.includes('unbox') || lower.includes('mystery')) {
    const preset = cloneSceneSpec(SCENE_TEMPLATES['tap-to-unbox-minigame']);
    return {
      assistantMessage:
        'Loaded the Tap-to-Unbox Mini-Game (1:1) with an interactive Mystery Vault Box that shakes on tap and reveals a prize after 3 taps.',
      diffSummary: [
        'Switched to "game" mode (1:1) with dolly-zoom-in camera',
        'Mounted Mystery Vault Loot Box (3 taps -> AeroPulse Sneaker reveal)',
        'Configured confetti burst & Playable End-Card CTA',
      ],
      updatedSceneSpec: preset,
    };
  }

  if (
    lower.includes('coin rush') ||
    lower.includes('robot') ||
    lower.includes('dance') ||
    lower.includes('cyberpunk')
  ) {
    const preset = cloneSceneSpec(SCENE_TEMPLATES['coin-rush-playable']);
    if (lower.includes('rain') || lower.includes('dance') || lower.includes('city')) {
      preset.world.weather = { type: 'rain', intensity: 0.8 };
      if (preset.actors[0]) {
        preset.actors[0].activeClip = 'Dance';
      }
    }
    return {
      assistantMessage:
        'Built a Cyberpunk City Stage with urban asphalt terrain, neon skyscrapers, and a rigged Expressive AI Robot (.GLB) with embedded skeletal animations.',
      diffSummary: [
        'Set world terrain to "city-asphalt" with "cyber-buildings" scatter',
        `Spawned Rigged Expressive Robot (.glb) with skeletal clip "${preset.actors[0]?.activeClip || 'Running'}"`,
        'Configured Playable Coins, Aether Gem & Electro Hazard',
      ],
      updatedSceneSpec: preset,
    };
  }

  if (
    lower.includes('luxury') ||
    lower.includes('helmet') ||
    lower.includes('commercial') ||
    lower.includes('perfume')
  ) {
    const preset = cloneSceneSpec(SCENE_TEMPLATES['luxury-product-commercial']);
    return {
      assistantMessage:
        'Set up the Luxury Product 3D Commercial (9:16 Media) on a reflective studio pedestal with an orbit-360 camera reveal.',
      diffSummary: [
        'Enabled reflective studio pedestal & sunset-cinematic lighting',
        'Mounted Noir Élixir Flacon & AeroPulse Sneaker',
        'Configured "orbit-360" camera sequencer & 3D 50% OFF badge',
      ],
      updatedSceneSpec: preset,
    };
  }

  // World & Terrain mutations
  if (lower.includes('snow') || lower.includes('mountain') || lower.includes('winter')) {
    next.world.terrain.type = 'snow-mountains';
    next.world.terrain.color = '#64748b';
    next.world.terrain.elevationScale = 2.0;
    next.world.weather = { type: 'snow', intensity: 0.8 };
    diffs.push('Generated "snow-mountains" terrain with active snowfall weather');
  } else if (lower.includes('desert') || lower.includes('dune')) {
    next.world.terrain.type = 'desert-dunes';
    next.world.terrain.color = '#b45309';
    next.world.skybox = 'sunset-atmosphere';
    diffs.push('Generated "desert-dunes" terrain under a "sunset-atmosphere" skybox');
  } else if (lower.includes('island') || lower.includes('ocean') || lower.includes('water')) {
    next.world.terrain.type = 'ocean-island';
    next.world.terrain.waterLevel = 0.25;
    next.world.skybox = 'daylight-sky';
    diffs.push('Generated "ocean-island" terrain with animated water plane');
  } else if (lower.includes('rain') || lower.includes('storm')) {
    next.world.weather = { type: 'rain', intensity: 0.75 };
    next.world.skybox = 'overcast';
    diffs.push('Enabled "rain" precipitation and "overcast" skybox');
  }

  // Rigged GLTF & Procedural Asset Spawning
  const assetKeywords: Array<{ kw: string[]; id: string; clip?: string }> = [
    { kw: ['soldier', 'trooper', 'guard'], id: 'gltf-soldier', clip: 'Run' },
    { kw: ['horse', 'stallion'], id: 'gltf-horse', clip: 'horse_A_' },
    { kw: ['flamingo', 'bird'], id: 'gltf-flamingo', clip: 'flamingo_flyA_' },
    { kw: ['parrot'], id: 'gltf-parrot', clip: 'parrot_A_' },
    { kw: ['car', 'hypercar', 'vehicle'], id: 'gt-sports-car' },
    { kw: ['knight', 'paladin'], id: 'fantasy-knight' },
    { kw: ['coin'], id: 'gold-coin-collectible' },
    { kw: ['gem', 'crystal'], id: 'plasma-gem' },
  ];

  for (const item of assetKeywords) {
    if (item.kw.some((k) => lower.includes(k))) {
      const entry = ASSET_REGISTRY[item.id];
      if (!entry) continue;
      const offsetX = next.actors.length % 2 === 0 ? 1.8 : -1.8;
      next.actors.push({
        id: `actor-${Date.now().toString(36)}`,
        name: entry.name,
        assetId: entry.assetId,
        modelUrl: entry.modelUrl,
        activeClip: item.clip || entry.defaultClip,
        availableClips: entry.embeddedClips ? [...entry.embeddedClips] : undefined,
        position: [next.actors.length === 0 ? 0 : offsetX, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        primaryColor: entry.defaultPrimaryColor,
        secondaryColor: entry.defaultSecondaryColor,
        metalness: entry.defaultMetalness,
        roughness: entry.defaultRoughness,
        activeAnimation: entry.defaultAnimation,
        animationSpeed: 1.0,
        physicsRole: entry.defaultPhysicsRole,
        onClickAction: entry.defaultClickAction,
        scoreValue: entry.defaultScoreValue,
        startTime: 0,
        endTime: next.durationSeconds || 8,
        enterEffect: 'pop-in',
      });
      diffs.push(`Spawned ${entry.name}${entry.modelUrl ? ' (Rigged GLTF)' : ''} at y = 0`);
    }
  }

  // Camera track mutations
  if (lower.includes('crane')) {
    next.camera.mode = 'crane-reveal';
    diffs.push('Switched camera track to "crane-reveal"');
  } else if (lower.includes('dolly') || lower.includes('zoom')) {
    next.camera.mode = 'dolly-zoom-in';
    diffs.push('Switched camera track to "dolly-zoom-in"');
  } else if (lower.includes('360') || lower.includes('orbit')) {
    next.camera.mode = 'orbit-360';
    diffs.push('Switched camera track to "orbit-360"');
  }

  if (diffs.length === 0) {
    const entry = ASSET_REGISTRY['gltf-robot-expressive'];
    next.world.terrain.type = 'grassy-hills';
    next.world.skybox = 'daylight-sky';
    next.actors.push({
      id: `actor-${Date.now().toString(36)}`,
      name: entry.name,
      assetId: entry.assetId,
      modelUrl: entry.modelUrl,
      activeClip: 'Wave',
      availableClips: entry.embeddedClips,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      primaryColor: entry.defaultPrimaryColor,
      secondaryColor: entry.defaultSecondaryColor,
      metalness: entry.defaultMetalness,
      roughness: entry.defaultRoughness,
      activeAnimation: 'idle',
      animationSpeed: 1,
      physicsRole: 'player',
      onClickAction: 'bounce',
      scoreValue: 25,
      startTime: 0,
      endTime: 8,
      enterEffect: 'pop-in',
    });
    diffs.push(
      'Generated "grassy-hills" 3D terrain under "daylight-sky"',
      'Spawned Rigged Expressive Robot (.glb) playing skeletal "Wave" animation'
    );
  }

  return {
    assistantMessage: `Updated SceneSpec with ${diffs.length} authoring mutation(s): ${diffs.join('; ')}.`,
    diffSummary: diffs,
    updatedSceneSpec: next,
  };
}

/**
 * Deterministic Spatial Audit & Auto-Corrector using World Coordinates + Bounding Boxes
 */
export function buildSpatialVisionAudit(
  currentSpec: SceneSpec,
  screenshotDataUrl?: string
): VisionQAReport {
  const proposed = cloneSceneSpec(currentSpec);
  const issues: VisionQAIssue[] = [];
  const actorCoordinates = extractActorCoordinateSummaries(currentSpec);

  for (let i = 0; i < proposed.actors.length; i++) {
    for (let j = i + 1; j < proposed.actors.length; j++) {
      const a = proposed.actors[i];
      const b = proposed.actors[j];
      const boxA = ASSET_REGISTRY[a.assetId]?.boundingBox || { width: 1.4, height: 1.8, depth: 1.4 };
      const boxB = ASSET_REGISTRY[b.assetId]?.boundingBox || { width: 1.4, height: 1.8, depth: 1.4 };
      const minSafeDist = (Math.max(boxA.width, boxA.depth) + Math.max(boxB.width, boxB.depth)) * 0.45;
      const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);

      if (dist < minSafeDist) {
        issues.push({
          id: `issue-overlap-${i}-${j}`,
          severity: 'high',
          category: 'overlap',
          title: `Bounding-Box Collision: ${a.name} & ${b.name}`,
          description: `Actors "${a.name}" [${a.position.join(', ')}] and "${b.name}" [${b.position.join(', ')}] are ${dist.toFixed(2)}m apart (min safe clearance: ${minSafeDist.toFixed(2)}m).`,
          suggestedFixSummary: `Reposition ${b.name} to [${(b.position[0] + 1.85).toFixed(1)}, 0, ${b.position[2].toFixed(1)}]`,
        });
        b.position = [Number((b.position[0] + 1.85).toFixed(2)), 0, b.position[2]];
      }
    }
  }

  proposed.actors.forEach((actor) => {
    if (Math.abs(actor.position[1]) > 0.15) {
      issues.push({
        id: `issue-ground-${actor.id}`,
        severity: 'medium',
        category: 'grounding',
        title: `Unintended Vertical Offset on ${actor.name}`,
        description: `${actor.name} is floating at Y = ${actor.position[1].toFixed(2)}m instead of resting on the studio floor (Y = 0).`,
        suggestedFixSummary: `Snap ${actor.name} flush to Y = 0.0m`,
      });
      actor.position[1] = 0;
    }
  });

  if (proposed.aspectRatio === '9:16' && proposed.camera.position[2] < 6.4) {
    issues.push({
      id: 'issue-vertical-framing',
      severity: 'medium',
      category: 'framing',
      title: '9:16 Vertical Safe-Zone Framing',
      description: `Camera Z (${proposed.camera.position[2].toFixed(1)}m) is too tight for 9:16 framing and clips lateral actor bounding boxes.`,
      suggestedFixSummary: 'Pull camera Z back to 7.4m and center target at [0, 1.15, 0]',
    });
    proposed.camera.position = [0, 3.8, 7.4];
    proposed.camera.target = [0, 1.15, 0];
  }

  if (issues.length === 0) {
    issues.push({
      id: 'issue-camera-polish',
      severity: 'low',
      category: 'framing',
      title: 'Cinematic Specular Angle Refinement',
      description:
        'All actor bounding boxes are grounded and collision-free. Refining camera elevation and rim contrast sharpens silhouette separation.',
      suggestedFixSummary: 'Refine camera position to [1.4, 2.5, 6.2] and boost rim contrast',
    });
    proposed.camera.position = [1.4, 2.5, 6.2];
  }

  const scorePenalty = issues.reduce(
    (acc, iss) => acc + (iss.severity === 'high' ? 12 : iss.severity === 'medium' ? 7 : 4),
    0
  );

  return {
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    overallScore: Math.max(68, 96 - scorePenalty),
    summary: `Vision QA inspected the ${currentSpec.aspectRatio} stage + ${actorCoordinates.length} actor bounding boxes and prepared ${issues.length} spatial fix(es).`,
    screenshotDataUrl,
    actorCoordinates,
    issues,
    proposedSceneSpec: proposed,
    applied: false,
  };
}

// ============================================================================
// VISUAL LOGIC GRAPH: MECHANIC WIRING, STRUCTURAL VALIDATION & EXECUTION REPAIR
// ============================================================================

const GRAPH_COLUMN_X: Record<LogicNodeType, number> = {
  trigger: 60,
  condition: 380,
  action: 700,
  'media-pipeline': 1020,
  'robot-hardware': 1020,
};

// Flow always runs left -> right, so linking only from a strictly lower rank can never create a cycle.
const GRAPH_RANK: Record<LogicNodeType, number> = {
  trigger: 0,
  condition: 1,
  action: 2,
  'media-pipeline': 3,
  'robot-hardware': 3,
};

const GRAPH_ROW_HEIGHT = 230;
const VALID_ANIMATIONS: AnimationType[] = ['idle', 'bounce', 'spin', 'walk', 'attack', 'float'];
const CINEMATIC_CAMERA_MODES = ['orbit-360', 'dolly-zoom-in', 'crane-reveal', 'cinematic-flythrough'];

const round1 = (n: number) => Math.round(n * 10) / 10;
const port = (id: string, label: string, dataType: LogicNodePort['dataType']): LogicNodePort => ({
  id,
  label,
  dataType,
});
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'item';

function pickPort(ports: LogicNodePort[], id: string, dataType: LogicNodePort['dataType']) {
  return ports.find((p) => p.id === id) ?? ports.find((p) => p.dataType === dataType);
}

/** Mutable helper for adding nodes / edges to a graph with unique ids and collision-free grid placement. */
class GraphBuilder {
  nodes: LogicNode[];
  edges: LogicEdge[];
  added: LogicNode[] = [];
  row = 0;
  private usedIds: Set<string>;
  private occupied = new Set<string>();

  constructor(graph: LogicGraphSpec) {
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.usedIds = new Set(graph.nodes.map((n) => n.id));
    const maxY = graph.nodes.reduce((m, n) => Math.max(m, n.position?.y ?? 0), -Infinity);
    this.row = graph.nodes.length ? Math.ceil((maxY + GRAPH_ROW_HEIGHT - 60) / GRAPH_ROW_HEIGHT) : 0;
  }

  uid(base: string): string {
    let id = base;
    for (let i = 2; this.usedIds.has(id); i++) id = `${base}-${i}`;
    this.usedIds.add(id);
    return id;
  }

  node(
    base: string,
    type: LogicNodeType,
    category: LogicNode['category'],
    title: string,
    inputs: LogicNodePort[],
    outputs: LogicNodePort[],
    params: Record<string, any>
  ): LogicNode {
    const x = GRAPH_COLUMN_X[type];
    let y = 60 + this.row * GRAPH_ROW_HEIGHT;
    while (this.occupied.has(`${x}:${y}`)) y += GRAPH_ROW_HEIGHT;
    this.occupied.add(`${x}:${y}`);
    const node: LogicNode = {
      id: this.uid(base),
      type,
      title,
      category,
      position: { x, y },
      inputs,
      outputs,
      params,
      status: 'idle',
      runCount: 0,
    };
    this.nodes.push(node);
    this.added.push(node);
    return node;
  }

  link(src: LogicNode, srcPortId: string, tgt: LogicNode, tgtPortId: string): void {
    const from = pickPort(src.outputs, srcPortId, 'flow');
    const to = pickPort(tgt.inputs, tgtPortId, from?.dataType ?? 'flow');
    if (!from || !to || from.dataType !== to.dataType || src.id === tgt.id) return;
    if (
      this.edges.some(
        (e) =>
          e.sourceNodeId === src.id &&
          e.sourcePortId === from.id &&
          e.targetNodeId === tgt.id &&
          e.targetPortId === to.id
      )
    ) {
      return;
    }
    this.edges.push({
      id: `edge-${src.id}-${from.id}-${tgt.id}-${to.id}`,
      sourceNodeId: src.id,
      sourcePortId: from.id,
      targetNodeId: tgt.id,
      targetPortId: to.id,
      active: true,
    });
  }
}

function actorRadius(a: ActorNode): number {
  const bb = ASSET_REGISTRY[a.assetId]?.boundingBox || { width: 1.4, height: 1.8, depth: 1.4 };
  const s = (Math.abs(a.scale?.[0] ?? 1) + Math.abs(a.scale?.[2] ?? 1)) / 2;
  return (Math.max(bb.width, bb.depth) / 2) * s;
}

/** Distance (m) at which two actors' bounding boxes touch. Any collision / distance check below this can never fire. */
function contactDistanceFor(spec: SceneSpec, actor: ActorNode): number {
  const others = spec.actors.filter(
    (a) =>
      a.id !== actor.id &&
      (a.physicsRole === 'player' ||
        a.physicsRole === 'collectible' ||
        a.physicsRole === 'hazard' ||
        a.physicsRole === 'dynamic')
  );
  const biggestOther = others.reduce((m, a) => Math.max(m, actorRadius(a)), 0.5);
  return actorRadius(actor) + biggestOther;
}

interface MechanicSubject {
  role: 'collectible' | 'hazard' | 'boss' | 'unbox' | 'player';
  kind: '3d' | '2d';
  name: string;
  slug: string;
  ids: string[];
  scoreValue: number;
  clip?: string;
  animation: string;
  onClickAction: string;
  tapsRequired: number;
  contact: number;
}

function collectMechanicSubjects(spec: SceneSpec): MechanicSubject[] {
  const groups = new Map<string, MechanicSubject>();
  const add = (key: string, make: () => MechanicSubject, id: string) => {
    const existing = groups.get(key);
    if (existing) existing.ids.push(id);
    else groups.set(key, make());
  };

  for (const a of spec.actors) {
    let role: MechanicSubject['role'] | null = null;
    if (a.onClickAction === 'unbox-tap') role = 'unbox';
    else if (a.physicsRole === 'hazard') role = /boss|dragon|titan|golem|overlord/i.test(a.name) ? 'boss' : 'hazard';
    else if (a.physicsRole === 'collectible') role = 'collectible';
    else if (a.physicsRole === 'player') role = 'player';
    if (!role) continue;
    const r = role;
    add(
      `${r}:${a.assetId}`,
      () => ({
        role: r,
        kind: '3d',
        name: a.name,
        slug: slugify(`${r}-${a.name}`),
        ids: [a.id],
        scoreValue: a.scoreValue ?? (r === 'collectible' ? 25 : 0),
        clip: a.activeClip || a.availableClips?.[0],
        animation: a.activeAnimation || 'idle',
        onClickAction: a.onClickAction,
        tapsRequired: a.unboxTapsRequired ?? 3,
        contact: contactDistanceFor(spec, a),
      }),
      a.id
    );
  }

  for (const n of spec.nodes2D || []) {
    const role: MechanicSubject['role'] | null =
      n.physics2D === 'collectible'
        ? 'collectible'
        : n.physics2D === 'player-platformer' || n.physics2D === 'player-topdown'
          ? 'player'
          : null;
    if (!role) continue;
    add(
      `2d-${role}:${n.type}:${n.shapeKind ?? ''}`,
      () => ({
        role,
        kind: '2d',
        name: n.name,
        slug: slugify(`${role}-${n.name}`),
        ids: [n.id],
        scoreValue: n.scoreValue ?? (role === 'collectible' ? 25 : 0),
        animation: 'idle',
        onClickAction: 'none',
        tapsRequired: 3,
        contact: Math.max(n.width, n.height) / 100 + 0.6,
      }),
      n.id
    );
  }
  return [...groups.values()];
}

function isSubjectWired(graph: LogicGraphSpec, s: MechanicSubject): boolean {
  return graph.nodes.some((n) => {
    const p = n.params || {};
    return (
      s.ids.includes(p.actorId) ||
      s.ids.includes(p.node2DId) ||
      (Array.isArray(p.actorIds) && p.actorIds.some((id: string) => s.ids.includes(id)))
    );
  });
}

/**
 * Wires every un-represented gameplay mechanic (collecting, hazards / boss, tap-to-unbox, player control,
 * camera cutscene, world stage) into connected trigger -> condition -> action chains on `spec.logicGraph`.
 * Existing nodes (and the user's tweaks to them) are never touched. Returns human-readable notes.
 */
export function ensureMechanicLogicGraph(spec: SceneSpec): string[] {
  const notes: string[] = [];
  if (!spec.logicGraph) spec.logicGraph = { nodes: [], edges: [] };
  const graph = spec.logicGraph;
  const fresh = graph.nodes.length === 0;
  const b = new GraphBuilder(graph);
  const hasIntent = (pred: (n: LogicNode) => boolean) => graph.nodes.some(pred);

  let sceneStart = graph.nodes.find((n) => n.params?.eventType === 'scene-start');
  let gate = graph.nodes.find(
    (n) => n.id === 'node-score-gate' || (n.type === 'condition' && n.params?.conditionType === 'score-threshold')
  );
  let endCard = graph.nodes.find(
    (n) => n.id === 'node-cta-endcard' || (n.type === 'media-pipeline' && n.category === 'audio-caption')
  );

  const getSceneStart = () =>
    (sceneStart ??= b.node(
      'node-scene-start',
      'trigger',
      'event-trigger',
      'On Scene Start',
      [],
      [port('out-flow', 'Exec Flow', 'flow'), port('out-signal', 'Init Signal', 'signal')],
      { eventType: 'scene-start', engineType: spec.engineType, autoPlay: true }
    ));
  const getEndCard = () =>
    (endCard ??= b.node(
      'node-cta-endcard',
      'media-pipeline',
      'audio-caption',
      'Trigger CTA & MRAID Output',
      [port('in-flow', 'On Goal Met', 'flow')],
      [],
      {
        headline: spec.marketingOverlay?.headline ?? '',
        ctaText: spec.marketingOverlay?.ctaText ?? 'Play Now',
        exportFormat: 'TikTok MRAID 3.0 / WebM 60fps',
      }
    ));
  const getGate = () => {
    if (!gate) {
      gate = b.node(
        'node-score-gate',
        'condition',
        'logic-gate',
        'If Score >= Target Goal',
        [port('in-flow', 'Check Flow', 'flow'), port('in-val', 'Current Score', 'number')],
        [port('out-true', 'Goal Met (True)', 'flow'), port('out-false', 'Keep Playing', 'flow')],
        {
          conditionType: 'score-threshold',
          targetScore: spec.gameRules.targetScore || 100,
          timeLimitSeconds: spec.gameRules.timeLimitSeconds || 30,
        }
      );
    }
    b.link(gate, 'out-true', getEndCard(), 'in-flow');
    return gate;
  };

  const refParams = (s: MechanicSubject): Record<string, any> => {
    const key = s.kind === '3d' ? 'actorId' : 'node2DId';
    const ref: Record<string, any> = { [key]: s.ids[0] };
    if (s.kind === '3d') ref.actorName = s.name;
    if (s.ids.length > 1) ref.actorIds = [...s.ids];
    return ref;
  };
  const playAnimation = (id: string, title: string, s: MechanicSubject, extra: Record<string, any>) =>
    b.node(
      id,
      'action',
      'actor-action',
      title,
      [port('in-flow', 'Exec In', 'flow'), port('in-actor', 'Target Actor', 'actor')],
      [port('out-flow', 'Next Action', 'flow'), port('out-score', 'Score Delta', 'number')],
      {
        ...refParams(s),
        animation: s.animation,
        activeClip: s.clip,
        speed: 1,
        scoreDelta: s.scoreValue,
        onClickAction: s.onClickAction,
        ...extra,
      }
    );
  const vfxNode = (id: string, title: string, vfxType: string, s?: MechanicSubject) =>
    b.node(
      id,
      'action',
      'camera-vfx',
      title,
      [port('in-flow', 'Exec In', 'flow')],
      [port('out-flow', 'Next Flow', 'flow')],
      { cameraMode: spec.camera.mode, fov: spec.camera.fov || 45, vfxType, ...(s ? refParams(s) : {}) }
    );
  const collisionTrigger = (s: MechanicSubject, targetRole: string) =>
    b.node(
      `node-${s.slug}-collision`,
      'trigger',
      'event-trigger',
      `On Collision · ${s.name}`,
      [],
      [port('out-flow', 'Hit Flow', 'flow'), port('out-actor', 'Other Actor', 'actor')],
      { eventType: 'collision', targetRole, ...refParams(s) }
    );
  const rangeCondition = (s: MechanicSubject) => {
    const meters = round1(Math.max(1.2, s.contact + 0.6));
    return b.node(
      `node-${s.slug}-range`,
      'condition',
      'logic-gate',
      `Distance Check < ${meters}m · ${s.name}`,
      [port('in-flow', 'Exec In', 'flow'), port('in-actor', 'Actor Ref', 'actor')],
      [port('out-true', 'Within Range', 'flow'), port('out-false', 'Out of Range', 'flow')],
      { conditionType: 'distance-check', distanceMeters: meters, ...refParams(s) }
    );
  };
  const cooldownCondition = (s: MechanicSubject, ms: number) =>
    b.node(
      `node-${s.slug}-cooldown`,
      'condition',
      'logic-gate',
      'Cooldown Gate',
      [port('in-flow', 'Exec In', 'flow')],
      [port('out-flow', 'Ready Flow', 'flow')],
      { conditionType: 'cooldown', cooldownMs: ms }
    );

  const subjects = collectMechanicSubjects(spec).filter((s) => !isSubjectWired(graph, s));

  if (fresh) {
    const world = b.node(
      'node-world-stage',
      'media-pipeline',
      'camera-vfx',
      'World Stage & Atmosphere',
      [port('in-flow', 'Init Flow', 'flow')],
      [port('out-flow', 'Stage Ready', 'flow')],
      {
        skybox: spec.world?.skybox || 'daylight-sky',
        terrainType: spec.world?.terrain?.type || 'flat-grid',
        weatherType: spec.world?.weather?.type || 'clear',
        aspectRatio: spec.aspectRatio,
      }
    );
    b.link(getSceneStart(), 'out-flow', world, 'in-flow');
    notes.push('Logic graph: added On Scene Start -> World Stage chain');
  }

  const wantsCutscene =
    spec.engineType === '3d' &&
    !hasIntent((n) => n.params?.cameraMode !== undefined) &&
    (CINEMATIC_CAMERA_MODES.includes(spec.camera.mode) || (spec.camera.keyframes?.length ?? 0) > 1);
  if (wantsCutscene) {
    b.row += fresh ? 1 : 0;
    const trig = b.node(
      'node-camera-cue',
      'trigger',
      'event-trigger',
      'On Timeline At (s)',
      [],
      [port('out-flow', 'Cue Flow', 'flow')],
      { eventType: 'timeline-cue', cueTimeSeconds: spec.camera.keyframes?.[1]?.time ?? 0.5 }
    );
    const cd = b.node(
      'node-camera-cue-gate',
      'condition',
      'logic-gate',
      'Cooldown Gate',
      [port('in-flow', 'Exec In', 'flow')],
      [port('out-flow', 'Ready Flow', 'flow')],
      { conditionType: 'cooldown', cooldownMs: 500 }
    );
    const cam = b.node(
      'node-camera-track',
      'action',
      'camera-vfx',
      'Switch Camera & Spawn VFX',
      [port('in-flow', 'Stage Flow', 'flow')],
      [port('out-flow', 'Render Out', 'flow')],
      {
        cameraMode: spec.camera.mode,
        fov: spec.camera.fov || 45,
        vfxId: spec.vfx[0]?.id || '',
        vfxType: spec.vfx[0]?.type || 'sparkles',
      }
    );
    b.link(trig, 'out-flow', cd, 'in-flow');
    b.link(cd, 'out-flow', cam, 'in-flow');
    notes.push(`Logic graph: wired camera cutscene (${spec.camera.mode}) as timeline cue -> cooldown -> camera`);
  }

  for (const s of subjects) {
    b.row += 1;
    if (s.role === 'collectible') {
      const trig = collisionTrigger(s, 'collectible');
      const range = rangeCondition(s);
      const collect = playAnimation(`node-${s.slug}-collect`, `Collect · ${s.name}`, s, {
        animation: 'bounce',
        speed: 1.2,
        onClickAction: s.kind === '3d' ? s.onClickAction : 'collect',
      });
      const g = getGate();
      b.link(trig, 'out-flow', range, 'in-flow');
      b.link(trig, 'out-actor', range, 'in-actor');
      b.link(range, 'out-true', collect, 'in-flow');
      b.link(collect, 'out-flow', g, 'in-flow');
      b.link(collect, 'out-score', g, 'in-val');
      notes.push(`Logic graph: wired "${s.name}" collection (collision -> range check -> +${s.scoreValue} score -> goal gate)`);
    } else if (s.role === 'hazard' || s.role === 'boss') {
      const trig = collisionTrigger(s, 'hazard');
      const range = rangeCondition(s);
      const hit = playAnimation(`node-${s.slug}-hit`, `Hit · ${s.name}`, s, {});
      const vfx = vfxNode(`node-${s.slug}-vfx`, `Impact VFX · ${s.name}`, 'shockwave', s);
      b.link(trig, 'out-flow', range, 'in-flow');
      b.link(trig, 'out-actor', range, 'in-actor');
      b.link(range, 'out-true', hit, 'in-flow');
      b.link(hit, 'out-flow', vfx, 'in-flow');
      if (s.role === 'boss') {
        b.row += 1;
        const cue = b.node(
          `node-${s.slug}-attack-cue`,
          'trigger',
          'event-trigger',
          `On Timeline At (s) · ${s.name} attacks`,
          [],
          [port('out-flow', 'Cue Flow', 'flow')],
          { eventType: 'timeline-cue', cueTimeSeconds: 3, ...refParams(s) }
        );
        const cd = cooldownCondition({ ...s, slug: `${s.slug}-attack` }, 1500);
        const attack = playAnimation(`node-${s.slug}-attack`, `Attack · ${s.name}`, s, { animation: 'attack' });
        b.link(cue, 'out-flow', cd, 'in-flow');
        b.link(cd, 'out-flow', attack, 'in-flow');
        b.link(attack, 'out-flow', vfx, 'in-flow');
      }
      notes.push(`Logic graph: wired ${s.role} "${s.name}" (${s.role === 'boss' ? 'timeline attack + ' : ''}collision -> range check -> hit -> VFX)`);
    } else if (s.role === 'unbox') {
      const tap = b.node(
        `node-${s.slug}-tap`,
        'trigger',
        'event-trigger',
        `On Actor Click/Tap · ${s.name}`,
        [],
        [port('out-flow', 'Tap Flow', 'flow'), port('out-actor', 'Clicked Actor', 'actor')],
        { eventType: 'actor-click', inputKey: 'Pointer / Tap', ...refParams(s) }
      );
      const counter = b.node(
        `node-${s.slug}-taps`,
        'condition',
        'logic-gate',
        `Tap Counter >= ${s.tapsRequired} · ${s.name}`,
        [port('in-flow', 'Exec In', 'flow')],
        [port('out-true', 'Unlocked (True)', 'flow'), port('out-false', 'Keep Tapping', 'flow')],
        { conditionType: 'tap-count', tapsRequired: s.tapsRequired, ...refParams(s) }
      );
      const reveal = playAnimation(`node-${s.slug}-reveal`, `Reveal · ${s.name}`, s, { animation: 'bounce' });
      const confetti = vfxNode(`node-${s.slug}-confetti`, 'Confetti Burst', 'confetti', s);
      b.link(tap, 'out-flow', counter, 'in-flow');
      b.link(counter, 'out-true', reveal, 'in-flow');
      b.link(reveal, 'out-flow', confetti, 'in-flow');
      b.link(confetti, 'out-flow', getEndCard(), 'in-flow');
      notes.push(`Logic graph: wired tap-to-unbox "${s.name}" (tap -> ${s.tapsRequired}-tap counter -> reveal -> confetti -> end card)`);
    } else if (s.role === 'player') {
      const key = b.node(
        `node-${s.slug}-input`,
        'trigger',
        'event-trigger',
        `On Key Press (WASD) · ${s.name}`,
        [],
        [port('out-flow', 'Move Flow', 'flow')],
        { eventType: 'key-press', keyCombo: 'WASD / Arrows', ...refParams(s) }
      );
      const cd = cooldownCondition(s, 120);
      const move = playAnimation(`node-${s.slug}-move`, `Move · ${s.name}`, s, {
        animation: s.kind === '3d' ? 'walk' : 'idle',
        scoreDelta: 0,
      });
      b.link(key, 'out-flow', cd, 'in-flow');
      b.link(cd, 'out-flow', move, 'in-flow');
      notes.push(`Logic graph: wired player "${s.name}" controls (key press -> cooldown -> animation)`);
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Structural validation & repair (shared by the AI-output sanitizer and fixExecutionIssue)
// ---------------------------------------------------------------------------

interface RepairContext {
  draft: SceneSpec;
  focus?: LogicNode;
  scope: LogicNode[];
  message: string;
  touched: Set<string>;
  fixes: string[];
  unresolved: string[];
}

function createRepairContext(draft: SceneSpec, focus: LogicNode | undefined, message: string): RepairContext {
  const nodes = draft.logicGraph?.nodes ?? [];
  return { draft, focus, scope: focus ? [focus] : nodes, message, touched: new Set(), fixes: [], unresolved: [] };
}

function describeNode(n: LogicNode) {
  return `[${n.title}]`;
}

function matchClip(wanted: string | undefined, clips: string[]): string | undefined {
  if (!wanted) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const w = norm(wanted);
  if (!w) return undefined;
  return (
    clips.find((c) => norm(c) === w) ??
    clips.find((c) => norm(c).length >= 3 && (norm(c).includes(w) || w.includes(norm(c)))) ??
    (w.length >= 4 ? clips.find((c) => norm(c).startsWith(w.slice(0, 4))) : undefined) // "Dancing" -> "Dance"
  );
}

function resolveActorForNode(draft: SceneSpec, node: LogicNode): ActorNode | undefined {
  const p = node.params || {};
  const byId = draft.actors.find((a) => a.id === p.actorId);
  if (byId) return byId;
  const name = String(p.actorName || '').toLowerCase().trim();
  if (name) {
    const byName =
      draft.actors.find((a) => a.name.toLowerCase() === name) ??
      draft.actors.find((a) => a.name.toLowerCase().includes(name) || name.includes(a.name.toLowerCase()));
    if (byName) return byName;
  }
  const role = p.targetRole as PhysicsRole | undefined;
  return (
    (role ? draft.actors.find((a) => a.physicsRole === role) : undefined) ??
    draft.actors.find((a) => a.physicsRole === 'player') ??
    draft.actors[0]
  );
}

/** Missing / stale actor references on nodes (and on the follow-camera). */
function repairActorReferences(ctx: RepairContext): void {
  const { draft } = ctx;
  for (const node of ctx.scope) {
    const id = node.params?.actorId;
    if (id && !draft.actors.some((a) => a.id === id)) {
      const replacement = resolveActorForNode(draft, node);
      if (!replacement) {
        ctx.unresolved.push(`${describeNode(node)} targets missing actor "${id}" and the scene has no actors to rebind to.`);
      } else {
        node.params = { ...node.params, actorId: replacement.id, actorName: replacement.name };
        ctx.touched.add(node.id);
        ctx.fixes.push(
          `${describeNode(node)} targeted missing actor "${id}" -> rebound to "${replacement.name}" (${replacement.id})`
        );
      }
    }
    if (Array.isArray(node.params?.actorIds)) {
      const alive = node.params.actorIds.filter((x: string) => draft.actors.some((a) => a.id === x));
      if (alive.length !== node.params.actorIds.length) {
        node.params = { ...node.params, actorIds: alive };
        ctx.touched.add(node.id);
        ctx.fixes.push(`${describeNode(node)} dropped ${node.params.actorIds.length === 0 ? 'all' : 'stale'} deleted actor ids from actorIds`);
      }
    }
  }
  const follow = draft.camera.followActorId;
  if (!ctx.focus && follow && !draft.actors.some((a) => a.id === follow)) {
    const next = draft.actors.find((a) => a.physicsRole === 'player') ?? draft.actors[0];
    if (next) draft.camera.followActorId = next.id;
    else delete draft.camera.followActorId;
    ctx.fixes.push(`Camera followed missing actor "${follow}" -> now follows ${next ? `"${next.name}"` : 'nothing'}`);
  }
}

/** Wrong animation clip names / invalid AnimationType on actors and the nodes that play them. */
function repairAnimations(ctx: RepairContext): void {
  const { draft } = ctx;
  const actorIds = new Set<string>();
  ctx.scope.forEach((n) => n.params?.actorId && actorIds.add(n.params.actorId));
  if (!ctx.focus) draft.actors.forEach((a) => actorIds.add(a.id));

  for (const id of actorIds) {
    const actor = draft.actors.find((a) => a.id === id);
    if (!actor) continue;
    const registry = ASSET_REGISTRY[actor.assetId];
    if (!actor.availableClips?.length && registry?.embeddedClips?.length) {
      actor.availableClips = [...registry.embeddedClips];
    }
    const clips = actor.availableClips ?? [];

    if (!VALID_ANIMATIONS.includes(actor.activeAnimation)) {
      ctx.fixes.push(`"${actor.name}" had invalid animation "${actor.activeAnimation}" -> "idle"`);
      actor.activeAnimation = 'idle';
    }
    if (!clips.length) continue;

    const fallbackClip = () =>
      (actor.activeClip && clips.includes(actor.activeClip) ? actor.activeClip : undefined) ??
      (registry?.defaultClip && clips.includes(registry.defaultClip) ? registry.defaultClip : undefined) ??
      clips[0];

    if (actor.activeClip && !clips.includes(actor.activeClip)) {
      const next = matchClip(actor.activeClip, clips) ?? fallbackClip();
      ctx.fixes.push(`"${actor.name}" played unknown clip "${actor.activeClip}" -> "${next}" (available: ${clips.join(', ')})`);
      actor.activeClip = next;
    }

    for (const node of ctx.scope) {
      if (node.params?.actorId !== actor.id || node.category !== 'actor-action') continue;
      if (node.params.activeClip && !clips.includes(node.params.activeClip)) {
        const next = matchClip(node.params.activeClip, clips) ?? fallbackClip();
        ctx.fixes.push(
          `${describeNode(node)} used wrong clip "${node.params.activeClip}" -> "${next}" (available: ${clips.join(', ')})`
        );
        node.params = { ...node.params, activeClip: next };
        actor.activeClip = next; // the store re-syncs node params from the actor, so keep both aligned
        ctx.touched.add(node.id);
      }
      if (node.params.animation && !VALID_ANIMATIONS.includes(node.params.animation)) {
        ctx.fixes.push(`${describeNode(node)} had invalid animation "${node.params.animation}" -> "${actor.activeAnimation}"`);
        node.params = { ...node.params, animation: actor.activeAnimation };
        ctx.touched.add(node.id);
      }
    }
  }
}

function repairServoAngles(ctx: RepairContext): void {
  for (const node of ctx.scope) {
    if (node.type !== 'robot-hardware' || node.params?.servoAngle === undefined) continue;
    const raw = Number(node.params.servoAngle);
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(180, raw)) : 90;
    if (clamped !== raw) {
      ctx.fixes.push(`${describeNode(node)} servo angle ${node.params.servoAngle}° out of [0°..180°] -> ${clamped}°`);
      node.params = { ...node.params, servoAngle: clamped };
      ctx.touched.add(node.id);
    }
  }
}

function spawnRegistryActor(spec: SceneSpec, assetId: string, index: number): ActorNode | undefined {
  const entry = ASSET_REGISTRY[assetId];
  if (!entry) return undefined;
  return {
    id: `actor-${assetId}-${Date.now().toString(36)}-${index}`,
    name: entry.name,
    assetId: entry.assetId,
    modelUrl: entry.modelUrl,
    activeClip: entry.defaultClip,
    availableClips: entry.embeddedClips ? [...entry.embeddedClips] : undefined,
    position: [-3 + index * 1.8, 0, -2.4],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    primaryColor: entry.defaultPrimaryColor,
    secondaryColor: entry.defaultSecondaryColor,
    metalness: entry.defaultMetalness,
    roughness: entry.defaultRoughness,
    activeAnimation: entry.defaultAnimation,
    animationSpeed: 1,
    physicsRole: entry.defaultPhysicsRole,
    onClickAction: entry.defaultClickAction,
    scoreValue: entry.defaultScoreValue,
    startTime: 0,
    endTime: spec.durationSeconds || 8,
    enterEffect: 'pop-in',
  };
}

/** Score goals that can never be reached, collectibles worth 0, and timers that are already expired. */
function repairScoreGoal(ctx: RepairContext): void {
  const { draft } = ctx;
  const rules = draft.gameRules;
  const collectibles3d = draft.actors.filter((a) => a.physicsRole === 'collectible');
  const collectibles2d = (draft.nodes2D || []).filter((n) => n.physics2D === 'collectible');

  for (const a of collectibles3d) {
    if (!(Number(a.scoreValue) > 0)) {
      ctx.fixes.push(`Collectible "${a.name}" was worth ${a.scoreValue ?? 0} points -> 25`);
      a.scoreValue = 25;
    }
  }
  for (const n of collectibles2d) {
    if (!(Number(n.scoreValue) > 0)) {
      ctx.fixes.push(`2D collectible "${n.name}" was worth ${n.scoreValue ?? 0} points -> 25`);
      n.scoreValue = 25;
    }
  }

  const sum = () =>
    collectibles3d.reduce((s, a) => s + (a.scoreValue ?? 0), 0) +
    collectibles2d.reduce((s, n) => s + (n.scoreValue ?? 0), 0);
  let total = sum();

  const needsGoal = rules.winCondition === 'collect-all' || rules.winCondition === 'score-threshold';
  if (needsGoal && rules.targetScore > total) {
    const original = rules.targetScore;
    const coinValue = ASSET_REGISTRY['gold-coin-collectible']?.defaultScoreValue || 25;
    const needed = Math.ceil((original - total) / coinValue);
    const canSpawn = draft.engineType === '3d' && !!ASSET_REGISTRY['gold-coin-collectible'];
    if (canSpawn && (needed <= 4 || total === 0)) {
      const count = Math.min(needed, 4);
      for (let i = 0; i < count; i++) {
        const coin = spawnRegistryActor(draft, 'gold-coin-collectible', collectibles3d.length + i);
        if (coin) {
          draft.actors.push(coin);
          collectibles3d.push(coin);
        }
      }
      total = sum();
      ctx.fixes.push(`Target score ${original} was unreachable (max ${total - count * coinValue}) -> spawned ${count} Gold Coin collectible(s) (+${coinValue} each)`);
      if (original > total) {
        rules.targetScore = total;
        ctx.fixes.push(`Target score still above reachable total -> lowered to ${total}`);
      }
    } else if (total > 0) {
      rules.targetScore = total;
      ctx.fixes.push(`Target score ${original} exceeded the reachable ${total} -> lowered to ${total}`);
    } else {
      ctx.unresolved.push(`Target score ${original} is unreachable: the scene has no collectibles to award points.`);
    }
  }
  if (rules.winCondition === 'survive-timer' && !(rules.timeLimitSeconds > 0)) {
    ctx.fixes.push(`Survive-timer goal had time limit ${rules.timeLimitSeconds}s -> 30s`);
    rules.timeLimitSeconds = 30;
  }

  for (const node of draft.logicGraph?.nodes ?? []) {
    if (node.type !== 'condition' || node.params?.conditionType !== 'score-threshold') continue;
    if (node.params.targetScore !== rules.targetScore || node.params.timeLimitSeconds !== rules.timeLimitSeconds) {
      ctx.fixes.push(`${describeNode(node)} goal ${node.params.targetScore} -> synced to gameRules (${rules.targetScore})`);
      node.params = {
        ...node.params,
        targetScore: rules.targetScore,
        timeLimitSeconds: rules.timeLimitSeconds,
      };
      ctx.touched.add(node.id);
    }
  }
}

/** Distance checks smaller than the actors' touching distance, and collision triggers that target a role nobody has. */
function repairCollisionThresholds(ctx: RepairContext): void {
  const { draft } = ctx;
  for (const node of ctx.scope) {
    if (node.params?.conditionType === 'distance-check') {
      const actor = draft.actors.find((a) => a.id === node.params.actorId);
      const raw = Number(node.params.distanceMeters);
      if (!actor) {
        if (!Number.isFinite(raw) || raw <= 0) {
          node.params = { ...node.params, distanceMeters: 2 };
          ctx.touched.add(node.id);
          ctx.fixes.push(`${describeNode(node)} distance ${node.params.distanceMeters} was invalid -> 2m`);
        }
        continue;
      }
      const contact = contactDistanceFor(draft, actor);
      let next = raw;
      if (!Number.isFinite(raw) || raw < contact) next = round1(contact + 0.6);
      else if (raw > 25) next = 25;
      if (next !== raw) {
        ctx.fixes.push(
          `${describeNode(node)} threshold ${node.params.distanceMeters}m is below the ${round1(contact)}m bounding-box contact distance (can never trigger) -> ${next}m`
        );
        node.params = {
          ...node.params,
          distanceMeters: next,
        };
        node.title = node.title.replace(/<\s*[\d.]+\s*m/, `< ${next}m`);
        ctx.touched.add(node.id);
      }
    }
    if (node.params?.eventType === 'collision' && node.params.targetRole) {
      const role = node.params.targetRole as PhysicsRole;
      if (!draft.actors.some((a) => a.physicsRole === role)) {
        const alt = (['collectible', 'hazard', 'dynamic'] as PhysicsRole[]).find((r) =>
          draft.actors.some((a) => a.physicsRole === r)
        );
        if (alt) {
          node.params = { ...node.params, targetRole: alt };
          ctx.touched.add(node.id);
          ctx.fixes.push(`${describeNode(node)} listened for "${role}" but no such actor exists -> now listens for "${alt}"`);
        } else {
          ctx.unresolved.push(`${describeNode(node)} listens for "${role}" collisions but the scene has no collidable actors.`);
        }
      }
    }
  }
}

/** Edges that point at deleted nodes / ports or join incompatible port types. */
function repairEdges(ctx: RepairContext): void {
  const graph = ctx.draft.logicGraph;
  if (!graph) return;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inScope = (e: LogicEdge) =>
    !ctx.focus || e.sourceNodeId === ctx.focus.id || e.targetNodeId === ctx.focus.id;
  let removed = 0;
  let remapped = 0;

  graph.edges = graph.edges.filter((edge) => {
    if (!inScope(edge)) return true;
    const src = byId.get(edge.sourceNodeId);
    const tgt = byId.get(edge.targetNodeId);
    if (!src || !tgt || src.id === tgt.id) {
      removed++;
      return false;
    }
    let from = src.outputs.find((p) => p.id === edge.sourcePortId);
    let to = tgt.inputs.find((p) => p.id === edge.targetPortId);
    if (!from && to) from = src.outputs.find((p) => p.dataType === to!.dataType);
    if (!to && from) to = tgt.inputs.find((p) => p.dataType === from!.dataType);
    if (from && to && from.dataType !== to.dataType) to = tgt.inputs.find((p) => p.dataType === from!.dataType);
    if (!from || !to) {
      removed++;
      return false;
    }
    if (from.id !== edge.sourcePortId || to.id !== edge.targetPortId) {
      edge.sourcePortId = from.id;
      edge.targetPortId = to.id;
      remapped++;
    }
    return true;
  });
  if (removed) ctx.fixes.push(`Removed ${removed} broken edge(s) pointing at missing nodes / ports / incompatible types`);
  if (remapped) ctx.fixes.push(`Re-pointed ${remapped} edge(s) to valid ports of the same data type`);
}

/** Orphans: nodes with nothing feeding them, and triggers that feed nothing. Links only run low rank -> high rank. */
function repairConnectivity(ctx: RepairContext): void {
  const graph = ctx.draft.logicGraph;
  if (!graph) return;
  const b = new GraphBuilder(graph);
  const flowOut = (n: LogicNode) =>
    n.outputs.find((o) => o.dataType === 'flow' && o.id !== 'out-false') ?? n.outputs.find((o) => o.dataType === 'flow');
  const flowIn = (n: LogicNode) => n.inputs.find((i) => i.dataType === 'flow');
  const hasIncoming = (n: LogicNode) => graph.edges.some((e) => e.targetNodeId === n.id);
  const hasOutgoing = (n: LogicNode) => graph.edges.some((e) => e.sourceNodeId === n.id);
  const same = (n: LogicNode, o: LogicNode) =>
    !!n.params?.actorId && n.params.actorId === o.params?.actorId ? 0 : 1;

  for (const node of ctx.scope) {
    if (node.type !== 'trigger' && flowIn(node) && !hasIncoming(node)) {
      const rank = GRAPH_RANK[node.type];
      const upstream = graph.nodes
        .filter((o) => o.id !== node.id && GRAPH_RANK[o.type] < rank && flowOut(o))
        .sort(
          (a, c) =>
            GRAPH_RANK[c.type] - GRAPH_RANK[a.type] ||
            same(node, a) - same(node, c) ||
            Math.abs(a.position.y - node.position.y) - Math.abs(c.position.y - node.position.y)
        )[0];
      if (upstream) {
        b.link(upstream, flowOut(upstream)!.id, node, flowIn(node)!.id);
        ctx.touched.add(node.id);
        ctx.fixes.push(`${describeNode(node)} had no incoming connection -> wired from ${describeNode(upstream)}`);
      } else {
        ctx.unresolved.push(`${describeNode(node)} is unreachable and the graph has no upstream trigger to connect it to.`);
      }
    } else if (node.type === 'trigger' && !hasOutgoing(node) && flowOut(node)) {
      const downstream = graph.nodes
        .filter((o) => o.id !== node.id && o.type !== 'trigger' && flowIn(o))
        .sort(
          (a, c) =>
            Number(hasIncoming(a)) - Number(hasIncoming(c)) ||
            same(node, a) - same(node, c) ||
            GRAPH_RANK[a.type] - GRAPH_RANK[c.type]
        )[0];
      if (downstream) {
        b.link(node, flowOut(node)!.id, downstream, flowIn(downstream)!.id);
        ctx.touched.add(node.id);
        ctx.fixes.push(`${describeNode(node)} triggered nothing -> wired to ${describeNode(downstream)}`);
      }
    }
  }
}

/** Structure-only sanitizer used on freshly generated scenes (no gameplay rebalancing). */
function sanitizeLogicGraph(draft: SceneSpec): string[] {
  const ctx = createRepairContext(draft, undefined, '');
  repairActorReferences(ctx);
  repairAnimations(ctx);
  repairServoAngles(ctx);
  repairEdges(ctx);
  repairConnectivity(ctx);
  return ctx.fixes;
}

/**
 * Post-processes any generated SceneSpec (Gemini or local heuristics): validates the logic graph and wires every
 * mechanic that has no node yet, so non-coders always get connected trigger -> condition -> action chains to inspect.
 */
export function finalizeLogicGraph(spec: SceneSpec): { spec: SceneSpec; notes: string[] } {
  const next = cloneSceneSpec(spec);
  const notes: string[] = [];
  if (next.logicGraph && !Array.isArray(next.logicGraph.nodes)) next.logicGraph = undefined;
  if (next.logicGraph) {
    next.logicGraph.edges = Array.isArray(next.logicGraph.edges) ? next.logicGraph.edges : [];
    const fixes = sanitizeLogicGraph(next);
    if (fixes.length) notes.push(`Logic graph auto-repaired: ${fixes.length} issue(s) (${fixes[0]}${fixes.length > 1 ? ', ...' : ''})`);
  }
  notes.push(...ensureMechanicLogicGraph(next));
  return { spec: next, notes };
}

// ---------------------------------------------------------------------------
// AI-assisted execution repair
// ---------------------------------------------------------------------------

async function fetchAgentMutation(
  prompt: string,
  currentSpec: SceneSpec,
  skills: DirectorSkill[] = [],
  extraContext: string[] = []
): Promise<AgentMutationResult | null> {
  const settings = useStudioStore.getState().settings;
  try {
    const response = await fetch('/api/agent/mutate', {
      method: 'POST',
      headers: aiHeaders(settings),
      body: JSON.stringify({
        prompt,
        sceneSpec: currentSpec,
        model: settings.geminiModel,
        customSystemPrompt: mergeSystemPrompt(settings.customSystemPrompt, skills, extraContext),
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.updatedSceneSpec && Array.isArray(data.updatedSceneSpec.actors)) {
      return {
        assistantMessage: data.assistantMessage || `Updated SceneSpec via ${data.provider || settings.aiProvider}${data.model ? ` · ${data.model}` : ''}.`,
        diffSummary: [
          ...(Array.isArray(data.diffSummary) ? data.diffSummary : ['Updated SceneSpec state']),
          ...(data.fallbackNote ? [`AI connection fallback: ${data.fallbackNote}`] : []),
        ],
        updatedSceneSpec: data.updatedSceneSpec,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function runExecutionRepairs(draft: SceneSpec, focus: LogicNode | undefined, message: string): RepairContext {
  const ctx = createRepairContext(draft, focus, message);
  const scoreRelated = !focus || focus.type === 'condition' || focus.type === 'media-pipeline' || /score|target|goal|collect/i.test(message);
  repairActorReferences(ctx);
  repairAnimations(ctx);
  repairServoAngles(ctx);
  repairCollisionThresholds(ctx);
  if (scoreRelated) repairScoreGoal(ctx);
  repairEdges(ctx);
  repairConnectivity(ctx);
  return ctx;
}

/**
 * Diagnoses a failed / misbehaving Execution Console entry, repairs the broken LogicNode and/or the ActorNode / gameRules
 * it depends on, and appends a confirmation log. Returns the repaired SceneSpec (the caller applies it via the store).
 *
 * 1. Deterministic repair engine (missing target actor id, wrong clip name, servo range, unreachable score goal,
 *    collision threshold below bounding-box contact distance, dangling edges, orphan nodes).
 * 2. When the engine finds nothing, or the user supplied feedback, Gemini gets a focused repair brief
 *    (log entry + faulty node + target actor + edges + hints) and its result is re-validated by the same engine.
 */
export async function fixExecutionIssue(
  scene: SceneSpec,
  logEntry: ExecutionLogEntry,
  userFeedback?: string
): Promise<SceneSpec> {
  const feedback = userFeedback?.trim() || undefined;
  const baseline = JSON.stringify(scene);
  let draft = cloneSceneSpec(scene);
  const focusId = logEntry.nodeId;
  let focus = focusId ? draft.logicGraph?.nodes.find((n) => n.id === focusId) : undefined;
  const diagnosisMessage = `${logEntry.message} ${feedback ?? ''}`;

  const ctx = runExecutionRepairs(draft, focus, diagnosisMessage);
  const fixes = [...ctx.fixes];
  const unresolved = [...ctx.unresolved];
  const touched = new Set(ctx.touched);
  let source: 'rules' | 'gemini' = 'rules';

  if (fixes.length === 0 || feedback) {
    const actor = draft.actors.find(
      (a) => a.id === (focus?.params?.actorId || logEntry.actorId)
    );
    const prompt = buildExecutionRepairPrompt({
      logLevel: logEntry.level,
      logMessage: logEntry.message,
      logPayload: logEntry.payload,
      sceneTime: logEntry.sceneTime,
      nodeJson: focus,
      actorJson: actor,
      neighborEdges: (draft.logicGraph?.edges ?? []).filter(
        (e) => focus && (e.sourceNodeId === focus.id || e.targetNodeId === focus.id)
      ),
      autoDiagnosis: [
        ...fixes.map((f) => `already auto-fixed: ${f}`),
        ...unresolved.map((u) => `could not auto-fix: ${u}`),
      ],
      userFeedback: feedback,
    });
    const result = await fetchAgentMutation(prompt, draft);
    if (result) {
      const ai = cloneSceneSpec(result.updatedSceneSpec);
      ai.id = draft.id;
      if (!ai.logicGraph?.nodes?.length) ai.logicGraph = draft.logicGraph;
      if (ai.logicGraph && !Array.isArray(ai.logicGraph.edges)) ai.logicGraph.edges = [];
      draft = ai;
      focus = focusId ? draft.logicGraph?.nodes.find((n) => n.id === focusId) : undefined;
      const second = runExecutionRepairs(draft, focus, diagnosisMessage);
      fixes.push(...result.diffSummary, ...second.fixes);
      second.touched.forEach((id) => touched.add(id));
      unresolved.length = 0;
      unresolved.push(...second.unresolved);
      source = 'gemini';
    }
  }

  const changed = fixes.length > 0 || JSON.stringify(draft) !== baseline;
  const label =
    focus?.title ??
    draft.actors.find((a) => a.id === logEntry.actorId)?.name ??
    (focusId ? `node ${focusId}` : 'Stage Logic');

  if (changed) {
    if (focus) touched.add(focus.id);
    if (draft.logicGraph) {
      draft.logicGraph.nodes = draft.logicGraph.nodes.map((n) =>
        touched.has(n.id) ? { ...n, status: 'idle' as const, errorMessage: undefined } : n
      );
    }
    useStudioStore.getState().appendLog({
      level: 'action',
      nodeId: focus?.id,
      actorId: logEntry.actorId ?? focus?.params?.actorId,
      message: `${source === 'gemini' ? 'AI Agent' : 'Auto-Fix'} repaired ${label}: ${fixes.slice(0, 3).join(' | ')}${
        fixes.length > 3 ? ` (+${fixes.length - 3} more)` : ''
      }. Re-run the node to confirm.`,
      payload: { source, fixes, unresolved },
    });
    return draft;
  }

  useStudioStore.getState().appendLog({
    level: 'warn',
    nodeId: focus?.id,
    actorId: logEntry.actorId,
    message: `Auto-Fix found nothing it could safely change for ${label}${
      unresolved.length ? `: ${unresolved[0]}` : '. Describe what you expected in the feedback box and try again.'
    }`,
    payload: { source, unresolved },
  });
  return cloneSceneSpec(scene);
}

export interface DirectorContext {
  skills: DirectorSkill[];
  extraContext: string[];
  memoryIds: string[];
  contributions: ReturnType<typeof enabledContributions>;
}

/**
 * Phase 6: everything the director knows for this turn — matching skills (built-in, learned, extension),
 * relevant memories of the creator, and the extension presets it may use.
 */
export function buildDirectorContext(prompt: string, current: { engineType: SceneSpec['engineType']; mode: SceneSpec['mode'] }): DirectorContext {
  const store = useStudioStore.getState();
  const contributions = enabledContributions(store.installedExtensions, store.activeProject?.extensions);
  const skills = selectDirectorSkills(
    prompt,
    inferSkillContext(prompt, current),
    [...store.learnedSkills, ...contributions.skills],
    3,
    store.settings.disabledSkills || []
  );
  const memories = store.memoryEnabled ? selectMemories(prompt, store.memories, store.activeProject?.id) : [];
  const extraContext = [buildMemoryContext(memories), buildExtensionPresetContext(contributions)].filter(Boolean);
  return { skills, extraContext, memoryIds: memories.map((m) => m.id), contributions };
}

/** Max AI repair rounds after deterministic auto-fix (verification loop). */
const MAX_AI_VERIFY_ROUNDS = 1;

function verificationNotes(fixes: string[], report: VerificationReport): string[] {
  const notes: string[] = [];
  if (fixes.length) notes.push(`Verifier auto-fixed ${fixes.length} issue(s): ${fixes.slice(0, 2).join('; ')}${fixes.length > 2 ? '; ...' : ''}`);
  if (report.errors) notes.push(`Verifier: ${report.errors} error(s) still need attention (${report.issues.find((i) => i.severity === 'error')?.code})`);
  else notes.push(`Verifier passed${report.warnings ? ` with ${report.warnings} warning(s)` : ''}`);
  return notes;
}

/**
 * Phase 7C: one director turn as a JSON Patch tool-use loop (src/agent/patchLoop.ts). Each round the server asks the
 * model for a patch; here we apply it, finalize the logic graph, attach extension recipes, auto-fix and verify, and
 * send the verifier's findings back as the next TOOL RESULT.
 * Returns 'unavailable' when no provider is configured (503), null when the model never produced a usable patch.
 */
async function runPatchEdit(
  prompt: string,
  currentSpec: SceneSpec,
  skills: DirectorSkill[],
  extraContext: string[],
  contributions: ReturnType<typeof enabledContributions>,
  verifyOpts: { scenes: SceneSpec[] }
): Promise<Omit<AgentMutationResult, 'skillsUsed'> | 'unavailable' | null> {
  const settings = useStudioStore.getState().settings;
  const customSystemPrompt = mergeSystemPrompt(settings.customSystemPrompt, skills, extraContext);
  let unavailable = false;
  let providerLabel = '';
  const fallbackNotes = new Set<string>();
  const graphNotes = new Set<string>();
  const presets = new Set<string>();

  const loop = await runPatchLoop({
    prompt,
    spec: currentSpec,
    maxRounds: DEFAULT_PATCH_ROUNDS,
    propose: async (turn) => {
      try {
        const res = await fetch('/api/agent/patch', {
          method: 'POST',
          headers: aiHeaders(settings),
          body: JSON.stringify({ ...turn, sceneSpec: turn.spec, spec: undefined, model: settings.geminiModel, customSystemPrompt }),
        });
        if (res.status === 503) unavailable = true;
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || typeof data !== 'object') return null;
        if (!providerLabel && data.provider) providerLabel = `${data.provider}${data.model ? ` · ${data.model}` : ''}`;
        if (typeof data.fallbackNote === 'string' && data.fallbackNote) fallbackNotes.add(data.fallbackNote);
        return data as PatchProposal;
      } catch {
        return null;
      }
    },
    check: (spec) => {
      const draft = cloneSceneSpec(spec);
      for (const name of attachExtensionRecipes(draft, contributions)) presets.add(name);
      const { spec: finalized, notes } = finalizeLogicGraph(draft);
      notes.forEach((n) => graphNotes.add(n));
      return autoFixSceneSpec(finalized, verifyOpts);
    },
  });
  if (!loop) return unavailable ? 'unavailable' : null;
  if (!loop.changed && loop.rounds.some((r) => r.rejected)) return null; // never produced a valid patch: try a full rewrite

  const ops = loop.rounds.reduce((n, r) => n + r.ops, 0);
  const rejected = loop.rounds.filter((r) => r.rejected).length;
  return {
    assistantMessage: loop.assistantMessage || (loop.changed ? `Updated the scene via ${providerLabel || settings.aiProvider}.` : 'No changes were needed.'),
    diffSummary: [
      ...loop.diffSummary,
      `AI edit loop: ${loop.rounds.length} round(s), ${ops} patch op(s)${rejected ? `, ${rejected} rejected patch(es) retried` : ''}`,
      ...[...fallbackNotes].map((n) => `AI connection fallback: ${n}`),
      ...graphNotes,
      ...(presets.size ? [`Embedded extension presets: ${[...presets].join(', ')}`] : []),
      ...verificationNotes(loop.fixes, loop.report),
    ],
    updatedSceneSpec: loop.spec,
    verification: loop.report,
  };
}

/**
 * AI director turn with Phase 4 skills + verification loop:
 * 1. Select Director Skills for the prompt and inject them into the system prompt.
 * 2. Generate (Gemini, or the offline heuristic engine) and finalize the logic graph.
 * 3. Verify the SceneSpec deterministically, auto-fix what is mechanical, and when errors remain ask the
 *    model once more with the exact verifier findings (closed loop instead of eyeballing the result).
 */
export async function mutateSceneWithAgent(
  prompt: string,
  currentSpec: SceneSpec
): Promise<AgentMutationResult> {
  const store = useStudioStore.getState();
  const director = buildDirectorContext(prompt, { engineType: currentSpec.engineType, mode: currentSpec.mode });
  const { skills, extraContext, contributions } = director;
  const skillsUsed = skills.map((s) => s.id);
  store.markSkillsUsed(skillsUsed.filter((id) => id.startsWith('learned-')));
  if (director.memoryIds.length) workspaceApi.markMemoriesUsed(director.memoryIds).catch(() => undefined);
  const verifyOpts = { scenes: store.scenes };

  // Phase 7C: small JSON Patch edits in a verify loop (default). Falls back to a full rewrite when the model can't
  // follow the patch format, and to the offline director when no provider is configured.
  let providerUnavailable = false;
  if ((store.settings.aiEditMode || 'patch') === 'patch') {
    const patched = await runPatchEdit(prompt, currentSpec, skills, extraContext, contributions, verifyOpts);
    if (patched === 'unavailable') providerUnavailable = true;
    else if (patched) return { ...patched, skillsUsed };
  }

  const result = providerUnavailable ? null : await fetchAgentMutation(prompt, currentSpec, skills, extraContext);
  if (!result) {
    const local = applyLocalHeuristicMutation(prompt, currentSpec);
    attachExtensionRecipes(local.updatedSceneSpec, contributions);
    const checked = autoFixSceneSpec(local.updatedSceneSpec, verifyOpts);
    return {
      ...local,
      updatedSceneSpec: checked.spec,
      diffSummary: [...local.diffSummary, ...verificationNotes(checked.fixes, checked.report)],
      skillsUsed,
      verification: checked.report,
    };
  }

  // Keep the user's existing graph if the model dropped it, then validate and wire any mechanic left without nodes.
  const incoming = cloneSceneSpec(result.updatedSceneSpec);
  if (!incoming.logicGraph?.nodes?.length && currentSpec.logicGraph?.nodes?.length) {
    incoming.logicGraph = JSON.parse(JSON.stringify(currentSpec.logicGraph));
  }
  // Keep extension presets portable: copy recipes for any extension particle / SFX preset the model used.
  for (const lib of ['particleLibrary', 'sfxLibrary'] as const) {
    if (!incoming[lib] && currentSpec[lib]) (incoming as any)[lib] = JSON.parse(JSON.stringify(currentSpec[lib]));
  }
  const attachedPresets = attachExtensionRecipes(incoming, contributions);
  const { spec, notes } = finalizeLogicGraph(incoming);
  let checked = autoFixSceneSpec(spec, verifyOpts);
  const fixes = [...checked.fixes];

  for (let round = 0; round < MAX_AI_VERIFY_ROUNDS && !checked.report.ok; round++) {
    const repairPrompt = `VERIFICATION LOOP — the SceneSpec you produced for "${prompt}" fails OmniStage's deterministic verifier.
Fix ONLY these problems, keep everything else identical:
${describeIssuesForAgent(checked.report)}`;
    const repaired = await fetchAgentMutation(repairPrompt, checked.spec, skills, extraContext);
    if (!repaired) break;
    const candidate = autoFixSceneSpec(finalizeLogicGraph(cloneSceneSpec(repaired.updatedSceneSpec)).spec, verifyOpts);
    if (candidate.report.errors >= checked.report.errors) break; // no progress: keep the better spec
    fixes.push(`AI repair round ${round + 1} resolved ${checked.report.errors - candidate.report.errors} error(s)`, ...candidate.fixes);
    checked = candidate;
  }

  return {
    ...result,
    updatedSceneSpec: checked.spec,
    diffSummary: [
      ...result.diffSummary,
      ...notes,
      ...(attachedPresets.length ? [`Embedded extension presets: ${attachedPresets.join(', ')}`] : []),
      ...verificationNotes(fixes, checked.report),
    ],
    skillsUsed,
    verification: checked.report,
  };
}

export async function runVisionQAInspection(
  canvas: HTMLCanvasElement | null,
  currentSpec: SceneSpec
): Promise<VisionQAReport> {
  const screenshotDataUrl = canvas ? canvas.toDataURL('image/png') : undefined;
  const actorCoordinates = extractActorCoordinateSummaries(currentSpec);
  const baselineReport = buildSpatialVisionAudit(currentSpec, screenshotDataUrl);

  if (!screenshotDataUrl) {
    return baselineReport;
  }

  try {
    const response = await fetch('/api/agent/vision-qa', {
      method: 'POST',
      headers: aiHeaders(useStudioStore.getState().settings),
      body: JSON.stringify({
        screenshotDataUrl,
        actorCoordinates,
        sceneSpec: currentSpec,
      }),
    });

    if (!response.ok) {
      return baselineReport;
    }

    const data = await response.json();
    if (
      data &&
      Array.isArray(data.issues) &&
      data.issues.length > 0 &&
      data.proposedSceneSpec &&
      Array.isArray(data.proposedSceneSpec.actors)
    ) {
      return {
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        overallScore: typeof data.overallScore === 'number' ? data.overallScore : baselineReport.overallScore,
        summary: data.summary || baselineReport.summary,
        screenshotDataUrl,
        actorCoordinates,
        issues: data.issues,
        proposedSceneSpec: {
          ...data.proposedSceneSpec,
          logicGraph: data.proposedSceneSpec.logicGraph ?? currentSpec.logicGraph,
        },
        applied: false,
      };
    }
    return baselineReport;
  } catch {
    return baselineReport;
  }
}
