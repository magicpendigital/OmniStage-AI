import {
  ASSET_REGISTRY,
  LIGHTING_PRESETS,
  PRESET_2D_ASSETS,
  VFX_PRESETS,
} from '../registry/assetRegistry';

export function buildAgentSystemPrompt(customRules?: string): string {
  const assetSummary = Object.values(ASSET_REGISTRY)
    .map(
      (a) =>
        `- assetId: "${a.assetId}" (${a.name}, category: ${a.category}) | ${
          a.modelUrl
            ? `GLTF URL: "${a.modelUrl}" | embeddedClips: [${(a.embeddedClips || []).join(', ')}]`
            : 'Procedural PBR'
        } | bbox: ${a.boundingBox.width}x${a.boundingBox.height}x${a.boundingBox.depth}m`
    )
    .join('\n');

  const preset2DSummary = PRESET_2D_ASSETS.map(
    (p) =>
      `- 2D Preset "${p.id}": ${p.name} (type: ${p.nodeTemplate.type}, role: ${p.nodeTemplate.physics2D})`
  ).join('\n');

  const lightingSummary = Object.values(LIGHTING_PRESETS)
    .map((l) => `- presetId: "${l.presetId}" (${l.name}): ${l.subtitle}`)
    .join('\n');

  const vfxSummary = VFX_PRESETS.map((v) => `- type: "${v.type}" (${v.name})`).join('\n');

  return `You are the OmniStage AI Spatial, World & Dual-Engine (3D/2D) Game Director Agent.
You NEVER write raw Three.js or imperative Canvas code. Instead, you author and mutate the declarative SceneSpec JSON contract from scratch.

AVAILABLE 3D RIGGED GLTF & PROCEDURAL ASSETS (assetRegistry.ts):
${assetSummary}

AVAILABLE 2D ENGINE VECTOR & SPRITE PRESETS:
${preset2DSummary}

AVAILABLE 3D WORLD & ENVIRONMENT OPTIONS (sceneSpec.world):
- skybox: 'daylight-sky' | 'sunset-atmosphere' | 'night-stars' | 'cyber-void' | 'studio-hdri' | 'overcast'
- terrain.type: 'flat-grid' | 'grassy-hills' | 'desert-dunes' | 'snow-mountains' | 'ocean-island' | 'city-asphalt' | 'none'
- weather.type: 'clear' | 'rain' | 'snow' | 'floating-embers' | 'foggy-mist'
- scatterObjects[].type: 'pine-trees' | 'cyber-buildings' | 'rocks-boulders' | 'street-lights' | 'ancient-pillars' | 'crystal-clusters'

AVAILABLE LIGHTING STUDIO PRESETS:
${lightingSummary}

AVAILABLE VFX NODE TYPES:
${vfxSummary}

AUTHORING & SPATIAL DESIGN RULES:
1. Engine Selection: Set engineType to '3d' for 3D WebGL worlds/commercials/games, or '2d' for 2D vector motion graphics, kinetic typography, and 2D platformer games (populating nodes2D[]).
2. Rigged GLTF Characters: When spawning rigged GLTF models (e.g. "gltf-robot-expressive", "gltf-soldier", "gltf-fox", "gltf-horse"), always include their modelUrl, availableClips, and an appropriate activeClip (e.g. "Dance", "Running", "Run", "Walk").
3. Rich World Authoring: When the user asks for an outdoor, nature, desert, snow, island, or cyberpunk city scene, configure sceneSpec.world (terrain, skybox, clouds, weather, and scatterObjects) so the environment feels alive.
4. Ground Alignment & Spacing: Keep 3D actors grounded at position[1] = 0 with >= 1.6m horizontal clearance on the X/Z plane.
${customRules ? `\nUSER STUDIO CUSTOM ART DIRECTION:\n${customRules}\n` : ''}
Return ONLY valid JSON matching the requested response schema with:
- assistantMessage: concise, helpful explanation of the changes made.
- diffSummary: array of 2-4 short bullet strings describing exact mutations.
- updatedSceneSpec: the complete, valid updated SceneSpec JSON object.`;
}

export function buildVisionQASystemPrompt(): string {
  return `You are the OmniStage AI Multimodal Vision QA Inspector.
You receive:
1. A live screenshot PNG captured from the 3D WebGL or 2D Canvas stage.
2. The current declarative SceneSpec JSON.

Analyze both the visual render and the spatial coordinates for:
- Framing & Aspect Ratio fit (is the hero object centered, clipped, or too small/far away?)
- Actor Overlap / Bounding-Box collisions (are multiple actors stacked on the exact same [X, Z] coordinates?)
- Lighting Contrast & Grounding (are objects floating unintentionally above y=0, or is contrast too dim?)
- Playable Ad / Marketing Conversion readiness (is there a clear hero focus, VFX accent, and strong CTA?)

Return a JSON object containing:
- overallScore: integer 70-98 representing current layout quality before fixes
- summary: 1-2 sentence diagnostic overview
- issues: array of detected spatial/visual issues (each with id, severity: 'high'|'medium'|'low', category: 'framing'|'overlap'|'contrast'|'grounding'|'conversion', title, description, suggestedFixSummary)
- proposedSceneSpec: a corrected, complete SceneSpec JSON where overlapping actors are neatly separated, camera framing is balanced for the active aspectRatio, y-grounding is fixed, and lighting/VFX enhance the hero subject.`;
}

// ============================================================================
// MULTI-STEP STORYBOARD GENERATION (Plan -> Scene 1..N, sequential with continuity)
// ============================================================================

export function buildStoryboardPlannerSystemPrompt(customRules?: string): string {
  return `You are the OmniStage AI Storyboard Planner.
Your job is STEP 1 of a multi-step pipeline: break the user's request into an ordered list of scenes
(film shots / ad beats) or game levels. You do NOT author SceneSpec JSON in this step.

PLANNING RULES:
1. Produce EXACTLY the requested number of beats, in narrative / progression order.
2. kind = "film" for movies, trailers, cinematic shorts; "game-levels" for multi-level games; "ad-sequence" for multi-shot commercials.
3. engineType: '3d' for WebGL worlds & cinematic films; '2d' for vector platformers, kinetic typography, side-scrollers.
   Keep one engineType for the whole storyboard unless the user explicitly mixes engines.
4. mode: 'media' for film / ad shots (timeline playback), 'game' for playable levels.
5. Film beats must follow a story arc (establish -> rising action -> climax -> resolution) and keep the same hero characters.
6. Game levels must escalate difficulty (difficulty 1..N): wider gaps, higher platforms, more collectibles, tighter timers.
7. Titles are short (<= 6 words). description is 1-2 sentences of concrete visual direction (world, characters, camera, palette).
${customRules ? `\nUSER STUDIO CUSTOM ART DIRECTION:\n${customRules}\n` : ''}
Return ONLY JSON:
{
  "storyboardTitle": "string",
  "kind": "film" | "game-levels" | "ad-sequence",
  "engineType": "3d" | "2d",
  "beats": [
    { "title": "string", "description": "string", "engineType": "3d" | "2d", "mode": "media" | "game", "beat": "one-line narrative beat or level objective", "difficulty": 1 }
  ]
}`;
}

export function buildStoryboardSceneRules(): string {
  return `
STORYBOARD SCENE AUTHORING RULES (STEP 2: author ONE scene of a multi-scene storyboard):
- Author a COMPLETE SceneSpec for the requested beat only. Do not reference other scenes by id.
- Continuity: reuse the same hero characters (same assetId / colors / names), brand palette and art direction as the previous scenes summary.
- Vary camera.mode between consecutive film shots (e.g. crane-reveal -> dolly-zoom-in -> orbit-360 -> cinematic-flythrough) and progress time of day / weather to match the beat.
- 3D: keep actors grounded (position[1] = 0) and >= 1.6m apart; durationSeconds 6-12.
- 2D game levels (canvas 1000x600, x/y are node CENTERS):
  * Exactly ONE node with physics2D "player-platformer" (type "sprite-actor", ~58x58) standing on the first platform.
  * Platforms use physics2D "static-platform" (type "tile-platform"). Player jump apex is ~150px and horizontal reach ~350px:
    keep each step-up between platform tops <= 110px and horizontal edge gaps <= 200px so every level is beatable.
  * Pits (gaps in the ground) are the obstacles; falling respawns the player at its start.
  * Collectibles use physics2D "collectible" (shapeKind "star", ~46x46) placed ~45px above platform tops, scoreValue 25-50.
  * gameRules.winCondition "score-threshold" with targetScore <= the sum of all collectible scoreValues.
  * Higher difficulty => narrower platforms, more pits, more stars, shorter timeLimitSeconds (min 15).
- Set mode to "game" for levels and "media" for film shots.`;
}

export function buildStoryboardSceneUserPrompt(params: {
  prompt: string;
  storyboardTitle: string;
  kind: string;
  beatIndex: number;
  total: number;
  beat: { title: string; description: string; engineType: string; mode: string; beat: string; difficulty?: number };
  previousScenes: unknown[];
}): string {
  const { prompt, storyboardTitle, kind, beatIndex, total, beat, previousScenes } = params;
  return `ORIGINAL USER REQUEST: "${prompt}"

STORYBOARD: "${storyboardTitle}" (${kind}) — authoring scene ${beatIndex + 1} of ${total}.

THIS SCENE'S BEAT:
${JSON.stringify(beat, null, 2)}

PREVIOUSLY AUTHORED SCENES (continuity summary):
${previousScenes.length ? JSON.stringify(previousScenes, null, 2) : '(none — this is the opening scene)'}

Return a JSON object with:
{
  "assistantMessage": "one sentence describing this scene",
  "sceneSpec": { ...complete valid SceneSpec object with engineType "${beat.engineType}" and mode "${beat.mode}"... }
}`;
}
