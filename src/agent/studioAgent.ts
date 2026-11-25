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
import { checkScene, type AssetHit } from './tools/sceneTools';
import { aiHeaders } from './aiClient';
import {
  createRepairContext,
  ensureMechanicLogicGraph,
  finalizeLogicGraph,
  repairActorReferences,
  repairAnimations,
  repairCollisionThresholds,
  repairConnectivity,
  repairEdges,
  repairScoreGoal,
  repairServoAngles,
  type RepairContext,
} from './logicFinalize';
import { inferSkillContext, mergeSystemPrompt, selectDirectorSkills } from './directorSkills';
import { buildMemoryContext, selectMemories } from './memory';
import { describeGameDesign } from './gameDesign';
import { attachExtensionRecipes, buildExtensionPresetContext, enabledContributions } from '../extensions/registry';
import { workspaceApi } from '../workspace/workspaceClient';
import { autoFixSceneSpec, describeIssuesForAgent } from '../verification/sceneVerifier';
import { createDefaultAudioSpec } from '../audio/audioBus';
import { captionsFromScript } from '../media/captions';
import type { Particle2DPreset } from '../types/scene.schema';

export { ensureMechanicLogicGraph, finalizeLogicGraph };
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
  /**
   * Where this result came from, so the UI never presents a canned answer as the AI's work:
   * `ai` = a model produced it; `offline` = no AI connection, built-in keyword director; `error` = the AI call
   * failed and the scene was left unchanged (`updatedSceneSpec` is the input spec).
   */
  aiSource?: { source: 'ai' | 'offline' | 'error'; reason?: string };
  /** Director D: the tool calls of a tool-use edit (name + short input / result), when that mode produced this result. */
  toolTranscript?: Array<{ turn: number; tool: string; input: string; result: string; isError: boolean }>;
}

/** Why an AI call did not produce a result (503 = no connection configured; anything else is a real failure). */
interface AiDiag {
  unavailable: boolean;
  failure?: string;
}

async function describeHttpFailure(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    if (body && typeof body.error === 'string' && body.error) return `HTTP ${res.status}: ${body.error.slice(0, 160)}`;
  } catch {
    /* body was not JSON */
  }
  return `HTTP ${res.status}`;
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


// ---------------------------------------------------------------------------
// AI-assisted execution repair
// ---------------------------------------------------------------------------

async function fetchAgentMutation(
  prompt: string,
  currentSpec: SceneSpec,
  skills: DirectorSkill[] = [],
  extraContext: string[] = [],
  diag?: AiDiag,
  signal?: AbortSignal
): Promise<AgentMutationResult | null> {
  const settings = useStudioStore.getState().settings;
  try {
    const response = await fetch('/api/agent/mutate', {
      method: 'POST',
      headers: aiHeaders(settings),
      signal,
      body: JSON.stringify({
        prompt,
        sceneSpec: currentSpec,
        model: settings.geminiModel,
        customSystemPrompt: mergeSystemPrompt(settings.customSystemPrompt, skills, extraContext),
      }),
    });
    if (!response.ok) {
      if (diag) {
        if (response.status === 503) diag.unavailable = true;
        else diag.failure = await describeHttpFailure(response);
      }
      return null;
    }
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
    if (diag && !signal?.aborted) diag.failure = 'network error (is the OmniStage server running?)';
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
  // Phase 4: a level authored against a game design keeps honouring it when you edit it in place.
  const design = store.sceneSpec?.gameDesign;
  const designContext = design ? `${describeGameDesign(design, store.sceneSpec.sequence?.kind === 'game-levels' ? store.sceneSpec.sequence.index : undefined)}\nEdits must keep every verb of this level and must not remove what the design promises.` : '';
  const extraContext = [buildMemoryContext(memories), buildExtensionPresetContext(contributions), designContext].filter(Boolean);
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
  verifyOpts: { scenes: SceneSpec[] },
  diag: AiDiag,
  signal?: AbortSignal
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
          signal,
          body: JSON.stringify({ ...turn, sceneSpec: turn.spec, spec: undefined, model: settings.geminiModel, customSystemPrompt }),
        });
        if (res.status === 503) {
          unavailable = true;
          diag.unavailable = true;
        }
        if (!res.ok) {
          if (res.status !== 503) diag.failure = await describeHttpFailure(res);
          return null;
        }
        const data = await res.json();
        if (!data || typeof data !== 'object') return null;
        if (!providerLabel && data.provider) providerLabel = `${data.provider}${data.model ? ` · ${data.model}` : ''}`;
        if (typeof data.fallbackNote === 'string' && data.fallbackNote) fallbackNotes.add(data.fallbackNote);
        return data as PatchProposal;
      } catch {
        if (!signal?.aborted) diag.failure = 'network error (is the OmniStage server running?)';
        return null;
      }
    },
    // The shared check path (src/agent/tools/sceneTools.ts): recipes -> finalizeLogicGraph -> autoFix -> verify.
    check: (spec) => {
      const checked = checkScene(spec, {
        scenes: verifyOpts.scenes,
        recipes: (draft) => {
          const names = attachExtensionRecipes(draft, contributions);
          names.forEach((n) => presets.add(n));
          return names;
        },
      });
      checked.notes.forEach((n) => graphNotes.add(n));
      return checked;
    },
  });
  if (signal?.aborted) throw new DOMException('Stopped by user', 'AbortError');
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

/** Library assets the tool loop may search (names only; the model is told to reuse urls verbatim). */
function libraryAssetsForTools(): AssetHit[] {
  const kinds: Record<string, AssetHit['kind']> = { model: '3d', image: 'image', svg: 'image', audio: 'audio', hdri: 'hdri' };
  return useStudioStore
    .getState()
    .savedExternalAssets.slice(0, 80)
    .map((a) => ({ id: a.id, name: a.name, kind: kinds[a.kind] || '3d', tags: a.tags, url: a.url || undefined, source: 'library' }));
}

/**
 * Director D: one director turn through native tool use (server/ai/toolLoop.ts, POST /api/agent/tools). The model reads slices of
 * the scene and edits it with apply_patch; the server verifies every patch with the shared `checkScene`. Here the final spec gets
 * the same post-step as the patch loop: extension recipes attached, logic graph finalized, auto-fixed and verified again.
 * Opt-in (aiEditMode 'tools') and Anthropic API only: returns null for every other connection and for any failure (including a
 * 503), so the caller falls through to the JSON patch loop, which also owns the "no connection configured" (503) decision.
 */
async function runToolEdit(
  prompt: string,
  currentSpec: SceneSpec,
  skills: DirectorSkill[],
  extraContext: string[],
  contributions: ReturnType<typeof enabledContributions>,
  verifyOpts: { scenes: SceneSpec[] },
  signal?: AbortSignal
): Promise<Omit<AgentMutationResult, 'skillsUsed'> | null> {
  const settings = useStudioStore.getState().settings;
  if ((settings.aiProvider || 'gemini') !== 'anthropic') return null; // only the Anthropic API gets tools
  const customSystemPrompt = mergeSystemPrompt(settings.customSystemPrompt, skills, extraContext);
  let data: any;
  try {
    const res = await fetch('/api/agent/tools', {
      method: 'POST',
      headers: aiHeaders(settings),
      signal,
      body: JSON.stringify({ prompt, sceneSpec: currentSpec, scenes: verifyOpts.scenes, customSystemPrompt, model: settings.geminiModel, extraAssets: libraryAssetsForTools() }),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    if (signal?.aborted) throw new DOMException('Stopped by user', 'AbortError');
    return null;
  }
  if (signal?.aborted) throw new DOMException('Stopped by user', 'AbortError');
  if (!data || typeof data !== 'object' || !data.updatedSceneSpec || !Array.isArray(data.updatedSceneSpec.actors)) return null;
  const message = typeof data.assistantMessage === 'string' ? data.assistantMessage : '';
  if (!data.changed && !message) return null; // the model neither edited nor answered: let the patch loop try

  const presets = new Set<string>();
  const checked = checkScene(data.updatedSceneSpec, {
    scenes: verifyOpts.scenes,
    recipes: (draft) => {
      const names = attachExtensionRecipes(draft, contributions);
      names.forEach((n) => presets.add(n));
      return names;
    },
  });
  const providerLabel = `${data.provider || 'anthropic'}${data.model ? ` · ${data.model}` : ''}`;
  const serverNotes: string[] = Array.isArray(data.notes) ? data.notes.filter((n: unknown) => typeof n === 'string') : [];
  const serverFixes: string[] = Array.isArray(data.fixes) ? data.fixes.filter((n: unknown) => typeof n === 'string') : [];
  return {
    assistantMessage: message || (data.changed ? `Updated the scene via ${providerLabel}.` : 'No changes were needed.'),
    diffSummary: [
      ...(Array.isArray(data.diffSummary) ? data.diffSummary.filter((d: unknown) => typeof d === 'string') : []),
      ...serverNotes,
      ...checked.notes,
      ...(presets.size ? [`Embedded extension presets: ${[...presets].join(', ')}`] : []),
      ...verificationNotes([...serverFixes, ...checked.fixes], checked.report),
    ],
    updatedSceneSpec: checked.spec,
    verification: checked.report,
    toolTranscript: Array.isArray(data.transcript) ? data.transcript.slice(0, 60) : undefined,
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
  currentSpec: SceneSpec,
  signal?: AbortSignal
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
  const diag: AiDiag = { unavailable: false };
  let providerUnavailable = false;
  const editMode = store.settings.aiEditMode || 'patch';
  let toolNote: string | undefined;
  if (editMode === 'tools') {
    // Director D (opt-in): native tool use on the Anthropic API; anything else or any failure continues with patches below.
    const tooled = await runToolEdit(prompt, currentSpec, skills, extraContext, contributions, verifyOpts, signal);
    if (tooled) return { ...tooled, skillsUsed, aiSource: { source: 'ai' } };
    toolNote = 'Tool-use loop unavailable (it needs the Anthropic API as the main connection) or it failed: used small edits instead';
  }
  if (editMode === 'patch' || editMode === 'tools') {
    const patched = await runPatchEdit(prompt, currentSpec, skills, extraContext, contributions, verifyOpts, diag, signal);
    if (patched === 'unavailable') providerUnavailable = true;
    else if (patched) {
      return { ...patched, diffSummary: toolNote ? [toolNote, ...patched.diffSummary] : patched.diffSummary, skillsUsed, aiSource: { source: 'ai' } };
    }
  }

  const result = providerUnavailable ? null : await fetchAgentMutation(prompt, currentSpec, skills, extraContext, diag, signal);
  if (signal?.aborted) throw new DOMException('Stopped by user', 'AbortError');
  if (!result) {
    // Only a missing AI connection (503) falls back to the built-in keyword director. A configured provider that
    // failed or returned nothing usable must NOT be papered over with a canned scene: report it and keep the scene.
    if (!diag.unavailable) {
      const detail = diag.failure ?? 'the model returned no usable edit';
      return {
        assistantMessage: `The AI request failed (${detail}). Your scene was not changed. Check the AI connection (CPU icon next to the prompt) or try again.`,
        diffSummary: [],
        updatedSceneSpec: currentSpec,
        skillsUsed,
        aiSource: { source: 'error', reason: detail },
      };
    }
    const local = applyLocalHeuristicMutation(prompt, currentSpec);
    attachExtensionRecipes(local.updatedSceneSpec, contributions);
    const checked = autoFixSceneSpec(local.updatedSceneSpec, verifyOpts);
    return {
      ...local,
      assistantMessage: `Offline director: no AI connection is set up, so this used built-in templates and keyword rules, not an AI model. ${local.assistantMessage}`,
      updatedSceneSpec: checked.spec,
      diffSummary: [...local.diffSummary, ...verificationNotes(checked.fixes, checked.report)],
      skillsUsed,
      verification: checked.report,
      aiSource: { source: 'offline', reason: 'no AI connection configured' },
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
    const repaired = await fetchAgentMutation(repairPrompt, checked.spec, skills, extraContext, undefined, signal);
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
    aiSource: { source: 'ai' },
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
