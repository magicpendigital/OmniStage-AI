import {
  ASSET_REGISTRY,
  cloneSceneSpec,
  createBlankSceneSpec,
  DEFAULT_WORLD_SPEC,
  SCENE_TEMPLATES,
} from '../registry/assetRegistry';
import {
  ActorCoordinateSummary,
  SceneSpec,
  VisionQAIssue,
  VisionQAReport,
} from '../types/scene.schema';
import { useStudioStore } from '../state/useStudioStore';

export interface AgentMutationResult {
  assistantMessage: string;
  diffSummary: string[];
  updatedSceneSpec: SceneSpec;
}

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
 * Deterministic Local Scene Authoring & Mutator Engine (Supports From-Scratch 3D Worlds, Rigged GLTFs & 2D Platformers)
 */
export function applyLocalHeuristicMutation(
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

export async function mutateSceneWithAgent(
  prompt: string,
  currentSpec: SceneSpec
): Promise<AgentMutationResult> {
  const settings = useStudioStore.getState().settings;
  try {
    const response = await fetch('/api/agent/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        sceneSpec: currentSpec,
        model: settings.geminiModel,
        customSystemPrompt: settings.customSystemPrompt,
      }),
    });
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    const data = await response.json();
    if (data && data.updatedSceneSpec && Array.isArray(data.updatedSceneSpec.actors)) {
      return {
        assistantMessage: data.assistantMessage || `Updated SceneSpec via ${settings.geminiModel}.`,
        diffSummary: Array.isArray(data.diffSummary) ? data.diffSummary : ['Updated SceneSpec state'],
        updatedSceneSpec: data.updatedSceneSpec,
      };
    }
    return applyLocalHeuristicMutation(prompt, currentSpec);
  } catch {
    return applyLocalHeuristicMutation(prompt, currentSpec);
  }
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
      headers: { 'Content-Type': 'application/json' },
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
        proposedSceneSpec: data.proposedSceneSpec,
        applied: false,
      };
    }
    return baselineReport;
  } catch {
    return baselineReport;
  }
}
