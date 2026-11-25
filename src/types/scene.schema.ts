/**
 * CORE CONTRACT: SceneSpec & Multi-Coding-Agent Schema Definitions (Phase 3 + Phase 5)
 * Unifies 3D WebGL Authoring + 2D Vector/Sprite Authoring, Real GLTF Skeletal Models,
 * Procedural World/Terrain/Weather Systems, Multi-Scene Storyboards, Studio Settings,
 * Bidirectional Visual Logic Node Graphs (n8n/ComfyUI Style), and Real-Time Execution Logs.
 */

import type { ParticleRecipe, SfxRecipe } from '../extensions/types';

export type EngineType = '3d' | '2d';

export type StudioMode = 'game' | 'media';

export type WorkspaceViewMode = 'viewport' | 'node-graph' | 'split';

export type AspectRatioPreset = '16:9' | '9:16' | '1:1';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export type LightingPresetId =
  | 'clean-apple-studio'
  | 'cyberpunk-neon'
  | 'sunset-cinematic'
  | 'arcade-vibrant';

export type CameraMode =
  | 'orbit-360'
  | 'dolly-zoom-in'
  | 'crane-reveal'
  | 'top-down-isometric'
  | 'first-person-follow'
  | 'orbit'
  | 'cinematic-flythrough'
  | 'follow-target'
  | 'isometric-game';

export type AnimationType =
  | 'idle'
  | 'bounce'
  | 'spin'
  | 'walk'
  | 'attack'
  | 'float';

export type PhysicsRole = 'static' | 'dynamic' | 'collectible' | 'player' | 'hazard';

export type ActorClickAction =
  | 'none'
  | 'collect'
  | 'collect-score'
  | 'destroy'
  | 'bounce'
  | 'jump-boost'
  | 'trigger-vfx'
  | 'trigger-cta'
  | 'cta-redirect'
  | 'unbox-tap';

export type EnterEffect = 'pop-in' | 'slide-up' | 'fade' | 'none';

export type VFXType =
  | 'sparkles'
  | 'shockwave'
  | 'floating-3d-badge'
  | 'laser-beam'
  | 'confetti';

export type Vector3Tuple = [number, number, number];

// ============================================================================
// PHASE 5: BIDIRECTIONAL VISUAL LOGIC NODE GRAPH & EXECUTION LOGS
// ============================================================================

export type LogicNodeType =
  | 'trigger'
  | 'condition'
  | 'action'
  | 'media-pipeline'
  | 'robot-hardware';

export type LogicNodeCategory =
  | 'event-trigger'
  | 'logic-gate'
  | 'actor-action'
  | 'camera-vfx'
  | 'audio-caption'
  | 'robot-servo-io';

export type LogicPortDataType = 'flow' | 'actor' | 'number' | 'signal';

export interface LogicNodePort {
  id: string;
  label: string;
  dataType: LogicPortDataType;
}

export interface LogicNode {
  id: string;
  type: LogicNodeType;
  title: string;
  category: LogicNodeCategory;
  position: { x: number; y: number };
  inputs: Array<{ id: string; label: string; dataType: LogicPortDataType }>;
  outputs: Array<{ id: string; label: string; dataType: LogicPortDataType }>;
  params: Record<string, any>;
  status?: 'idle' | 'running' | 'success' | 'error';
  runCount?: number;
  errorMessage?: string;
}

export interface LogicEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  active?: boolean;
}

export interface LogicGraphSpec {
  nodes: LogicNode[];
  edges: LogicEdge[];
}

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  sceneTime: number;
  level: 'info' | 'trigger' | 'action' | 'warn' | 'error';
  nodeId?: string;
  actorId?: string;
  message: string;
  payload?: Record<string, any>;
}

// ============================================================================
// PHASE 3: WORLD & SPATIAL ENVIRONMENT SCHEMA (WorldSpec)
// ============================================================================

export type SkyboxPreset =
  | 'daylight-sky'
  | 'sunset-atmosphere'
  | 'night-stars'
  | 'cyber-void'
  | 'studio-hdri'
  | 'overcast';

export type TerrainType =
  | 'flat-grid'
  | 'grassy-hills'
  | 'desert-dunes'
  | 'snow-mountains'
  | 'ocean-island'
  | 'city-asphalt'
  | 'none';

export type WeatherType =
  | 'clear'
  | 'rain'
  | 'snow'
  | 'floating-embers'
  | 'foggy-mist';

export type ScatterObjectType =
  | 'pine-trees'
  | 'cyber-buildings'
  | 'rocks-boulders'
  | 'street-lights'
  | 'ancient-pillars'
  | 'crystal-clusters'
  // Phase 10B: natural dressing that fills the frame
  | 'broadleaf-trees'
  | 'bushes'
  | 'flowers'
  | 'grass-tufts'
  | 'palm-trees'
  | 'cacti';

/** Phase 10B: one-word location presets that dress a whole world (sky, terrain, props, water, ambience). */
export type BiomeId =
  | 'forest'
  | 'meadow'
  | 'beach'
  | 'desert'
  | 'snowy-peaks'
  | 'waterfall-valley'
  | 'night-forest'
  | 'city-night';

/** Phase 10B: animated water landmarks built by the shared world builder. */
export type WorldFeatureType = 'waterfall' | 'river' | 'pond';

export interface WorldFeatureSpec {
  id: string;
  type: WorldFeatureType;
  /** Base position on the ground (y follows the terrain). A waterfall's cliff faces +z rotated by rotationDeg. */
  position: Vector3Tuple;
  rotationDeg?: number;
  /** Scale, default 1 (waterfall ~6 m wide x 5 m tall; river 3 m wide x 40 m long; pond radius 3 m). */
  size?: number;
}

export interface ScatterLayerSpec {
  id: string;
  type: ScatterObjectType;
  count: number;
  spreadRadius: number;
  scaleRange: [number, number];
  color?: string;
}

export interface WorldSpec {
  skybox: SkyboxPreset;
  sunPosition: Vector3Tuple;
  clouds: {
    enabled: boolean;
    density: number;
    speed: number;
    color: string;
  };
  terrain: {
    type: TerrainType;
    elevationScale: number;
    roughness: number;
    color: string;
    waterLevel?: number;
  };
  weather: {
    type: WeatherType;
    intensity: number;
  };
  scatterObjects: ScatterLayerSpec[];
  /** Phase 10B: the biome preset this world was dressed from (also picks the 'auto' ambience). */
  biome?: BiomeId;
  /** Phase 10B: waterfalls, rivers and ponds. */
  features?: WorldFeatureSpec[];
  /** Optional image-based lighting from an external HDRI (e.g. Poly Haven via /api/assets proxy). */
  hdri?: WorldHDRISpec;
}

export interface WorldHDRISpec {
  url: string;
  name: string;
  source: OnlineAssetProvider | 'custom';
  /** When true the HDRI replaces the procedural skybox as the visible background. */
  showBackground: boolean;
  intensity: number;
  /** 'image' = an 8-bit equirectangular JPEG/PNG/WebP (e.g. a Blockade Labs skybox); default 'hdr' (Radiance .hdr). */
  format?: 'hdr' | 'image';
}

// ============================================================================
// PHASE 3: 2D VECTOR, SPRITE & PLATFORMER ENGINE SCHEMA (Node2D)
// ============================================================================

export type Node2DType =
  | 'vector-shape'
  | 'svg-path'
  | 'sprite-actor'
  | 'text-kinetic'
  | 'parallax-layer'
  | 'tile-platform'
  | 'particle-emitter';

export type Physics2DRole =
  /** One-way platform: the player lands on it from above and jumps up through it. */
  | 'static-platform'
  /** Phase 2: solid block / wall — blocks the player from every side. */
  | 'solid'
  /** Phase 2: touching it sends the player back to the last checkpoint (or the start). */
  | 'hazard'
  /** Phase 2: touching it moves the respawn point here. */
  | 'checkpoint'
  | 'player-platformer'
  | 'player-topdown'
  | 'bouncing'
  | 'collectible'
  | 'none';

/** Phase 2: tuning for a `player-platformer` / `player-topdown` node. Every field is optional; see `PLATFORMER_DEFAULTS`. */
export interface PlatformerController2D {
  /** px/s while a direction is held (default 320). */
  runSpeed?: number;
  /** px/s upward at jump start (default 520, about 153 px apex). */
  jumpVelocity?: number;
  /** Multiplier on the scene gravity (default 1). */
  gravityScale?: number;
  /** Seconds a jump still works after leaving a ledge (default 0.1). */
  coyoteTime?: number;
  /** Seconds an early jump press is remembered (default 0.1). */
  jumpBuffer?: number;
  /** 1 = single jump, 2 = double jump, 3 = triple (default 1). */
  maxJumps?: number;
  /** Releasing jump early shortens it (default true). */
  variableJump?: boolean;
  /** 0..1 steering while airborne (default 1). */
  airControl?: number;
}

/** Phase 2: hit box override, relative to the node centre (defaults to the node's own size x scale). */
export interface Collider2D {
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
}

/** Phase 2: moving platform. Ping-pongs along one axis at constant speed as a pure function of timeline time. */
export interface Mover2D {
  axis: 'x' | 'y';
  /** px travelled from the authored position (negative = the other way first). */
  distance: number;
  /** px/s. */
  speed: number;
  /** 0..1 fraction of a full cycle to start offset by. */
  phase?: number;
}

/** Phase 2: world size of a 2D scene (default 1000x600 = one screen). */
export interface World2DSpec {
  width: number;
  height: number;
}

/** Phase 2: the 2D camera. Defaults: fixed on a one-screen world, following the player on a bigger one. */
export interface Camera2DSpec {
  mode?: 'fixed' | 'follow';
  zoom?: number;
  /** Seconds to catch up with the player (default 0.15, 0 = glued). */
  smoothing?: number;
  deadzoneX?: number;
  deadzoneY?: number;
  /** px the camera leads in the running direction (default 80). */
  lookAhead?: number;
}

// ============================================================================
// PHASE 4: MOTION EASING, PROCEDURAL GAME AUDIO, DIRECTOR SKILLS & VERIFICATION
// ============================================================================

/** Timeline easing curves (GSAP-style names, implemented in src/animation/easing.ts). */
export type EaseId =
  | 'linear'
  | 'sine.inOut'
  | 'power1.out'
  | 'power2.inOut'
  | 'power3.out'
  | 'expo.out'
  | 'back.out'
  | 'elastic.out'
  | 'bounce.out';

/** Procedural (sfxr-style) sound presets synthesised in WebAudio — no audio files, works offline in playable ads. */
export type SfxPresetId =
  | 'coin'
  | 'jump'
  | 'hit'
  | 'powerup'
  | 'explosion'
  | 'laser'
  | 'win'
  | 'lose'
  | 'click'
  | 'whoosh'
  // Phase 10B foley for film cues
  | 'chime'
  | 'splash'
  | 'footstep'
  | 'pop';

/** Gameplay / media events that can trigger a sound cue. */
export type GameAudioEvent = 'collect' | 'jump' | 'hit' | 'win' | 'lose' | 'click' | 'scene-start';

export interface SceneAudioSpec {
  enabled: boolean;
  /** 0..1 */
  masterVolume: number;
  /** Built-in SfxPresetId, 'none', or an id from SceneSpec.sfxLibrary. */
  cues: Partial<Record<GameAudioEvent, SfxPresetId | 'none' | (string & {})>>;
}

/** Phase 10B: procedural film score moods (synthesised, no audio files). */
export type MusicMood = 'none' | 'calm' | 'happy' | 'playful' | 'adventure' | 'epic' | 'tense' | 'sad' | 'mysterious';

/** Phase 10B: procedural background ambience. 'auto' follows the world (biome, water features, weather, sky). */
export type AmbienceId =
  | 'none'
  | 'auto'
  | 'forest'
  | 'meadow'
  | 'beach'
  | 'river'
  | 'waterfall'
  | 'rain'
  | 'wind'
  | 'night'
  | 'city'
  | 'cave'
  | 'space';

/** Skinning cost of one rigged model: bones in its skeleton, skinned vertices and its largest texture side (px). */
export interface RigCost {
  bones: number;
  vertices: number;
  textureSize?: number;
}

/** Phase 10B: a timed sound effect on the film timeline (seconds from the scene start). */
export interface SoundtrackCue {
  time: number;
  /** Built-in SfxPresetId or an id from SceneSpec.sfxLibrary. */
  sfx: SfxPresetId | (string & {});
  /** 0..1, default 0.8 */
  volume?: number;
}

/**
 * Phase 10B: the scene's sound — mood music, ambience and timed SFX. Rendered deterministically to PCM
 * (src/audio/soundtrack.ts), so Preview, the Player and the MP4 export all hear the same thing.
 */
export interface SoundtrackSpec {
  music?: { mood: MusicMood; /** 0..1, default 0.55 */ volume?: number; /** BPM override */ tempo?: number };
  ambience?: { type: AmbienceId; /** 0..1, default 0.5 */ volume?: number };
  cues?: SoundtrackCue[];
  /** Footsteps synced to the performers' walks (src/audio/footsteps.ts). Default on; false = silent feet. */
  footsteps?: boolean;
  /** Overall 0..1, default 0.9 */
  volume?: number;
}

/** Reusable director guidance injected into the AI prompt (built-in or learned from a user-approved result). */
export interface DirectorSkill {
  id: string;
  title: string;
  description: string;
  /** Lower-case keywords (VI/EN) matched against the user prompt. */
  triggers: string[];
  engine: EngineType | 'any';
  mode: StudioMode | 'any';
  /** Prompt rules appended to the system prompt when the skill is selected. */
  guidance: string;
  source: 'builtin' | 'learned';
  createdAt?: string;
  uses?: number;
}

export type VerificationSeverity = 'error' | 'warning';

export interface VerificationIssue {
  code: string;
  severity: VerificationSeverity;
  message: string;
  targetId?: string;
  /** true when autoFixSceneSpec() can repair it deterministically. */
  fixable: boolean;
}

export interface VerificationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: VerificationIssue[];
}

// ============================================================================
// PHASE 5: 2D SPRITESHEETS, PROCEDURAL 2D PARTICLES & CAPTIONS
// ============================================================================

export interface SpriteClipRange {
  /** First and last frame index (inclusive). */
  start: number;
  end: number;
  fps?: number;
  loop?: boolean;
}

/** Grid spritesheet drawn from `Node2D.imageUrl`. Frames are read left→right, top→bottom. */
export interface SpriteSheetSpec {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frameCount: number;
  fps: number;
  loop?: boolean;
  /** Named clips, e.g. idle / run / jump. Player nodes auto-select idle, run and jump when present. */
  clips?: Record<string, SpriteClipRange>;
  activeClip?: string;
}

export type Particle2DPreset =
  | 'sparkle'
  | 'confetti'
  | 'fire'
  | 'smoke'
  | 'rain'
  | 'snow'
  | 'pixel-burst'
  | 'magic-trail';

/** Deterministic (seeded, time-sampled) particle emitter for `Node2D.type === 'particle-emitter'`. */
export interface Particle2DEmitterSpec {
  /** Built-in preset or an id from SceneSpec.particleLibrary (extension preset). */
  preset: Particle2DPreset | (string & {});
  seed?: number;
  /** Particles per second override. */
  rate?: number;
  /** Single colour override (otherwise the preset palette). */
  color?: string;
}

export interface CaptionCue {
  id?: string;
  start: number;
  end: number;
  text: string;
  position?: 'bottom' | 'top' | 'center';
  style?: 'subtitle' | 'title';
  /** When true the cue is also read aloud (Web Speech synthesis in the studio) as it starts. */
  speak?: boolean;
}

export interface Keyframe2D {
  time: number;
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  /** Easing applied from this keyframe to the next one (default 'linear'). */
  ease?: EaseId;
}

export interface Node2D {
  id: string;
  name: string;
  type: Node2DType;
  x: number; // Normalized 0..1000 canvas coordinate space
  y: number; // Normalized 0..600 canvas coordinate space
  width: number;
  height: number;
  rotation: number; // Degrees
  scaleX: number;
  scaleY: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth?: number;
  shapeKind?: 'rect' | 'circle' | 'star' | 'capsule' | 'triangle';
  text?: string;
  fontSize?: number;
  svgContent?: string;
  imageUrl?: string;
  parallaxFactor?: number;
  physics2D: Physics2DRole;
  scoreValue?: number;
  visible?: boolean;
  locked?: boolean;
  keyframeTrack?: Keyframe2D[];
  /** Phase 5: animate `imageUrl` as a grid spritesheet. */
  spriteSheet?: SpriteSheetSpec;
  /** Phase 5: settings for `type: 'particle-emitter'`. */
  emitter?: Particle2DEmitterSpec;
  /** Phase 9: behaviour state machine (game mode), run by src/runtime/stateMachine.ts. */
  stateMachine?: ActorStateMachine;
  /** Phase 2: player movement tuning (`player-platformer` / `player-topdown`). */
  controller?: PlatformerController2D;
  /** Phase 2: hit box override for any collidable role. */
  collider?: Collider2D;
  /** Phase 2: moving platform (`static-platform` / `solid`). */
  mover?: Mover2D;
  /** Phase 3: hit points. Damage and healing go through the store (`damageEntity` / `healEntity`), 0 kills the entity. */
  health?: HealthSpec;
  /** Phase 3: hit points taken by a player that touches this node (enemy, spikes). Needs `health` on the player. */
  contactDamage?: number;
  /** Phase 3: spawns clones of the `prefab` node `spawner.prefabId` while the game plays. */
  spawner?: Spawner2D;
  /** Phase 3: moves in a straight line and dies on a solid / after its lifetime (put it on a `prefab` node). */
  projectile?: Projectile2D;
  /** Phase 3: a template — hidden and non-colliding while playing, cloned by spawners / the `spawn` logic action. */
  prefab?: boolean;
}

// ----------------------------------------------------------------------------
// Phase 3 — game state: variables, health, spawning, declarative HUD
// ----------------------------------------------------------------------------

/** A named number the logic graph and the HUD share (a counter, a flag as 0/1, a resource). */
export interface GameVariable {
  id: string;
  label?: string;
  initial: number;
  min?: number;
  max?: number;
}

export interface HealthSpec {
  max: number;
  /** Seconds of immunity after a hit (default 0.6). */
  invulnerableSeconds?: number;
}

export interface Spawner2D {
  /** id of a node with `prefab: true`. */
  prefabId: string;
  everySeconds: number;
  /** Most clones alive at once (default 5). */
  max?: number;
  /** Seconds before the first spawn (default = everySeconds). */
  startDelay?: number;
  offsetX?: number;
  offsetY?: number;
  /** Deterministic spread (px) around the offset. */
  jitterX?: number;
  jitterY?: number;
}

export interface Projectile2D {
  /** px/s. */
  vx: number;
  vy: number;
  /** Seconds alive (default 3). */
  lifetimeSeconds?: number;
  /** Hit points taken from what it hits when that has `health`. */
  damage?: number;
  /** Disappears on the first hit (default true). */
  destroyOnHit?: boolean;
  /** px/s², pulls it down (default 0). */
  gravity?: number;
  /** Who it can hurt: the player, enemies (other nodes with health) or both (default). */
  target?: 'player' | 'enemy' | 'any';
}

export type HudSource = 'score' | 'time' | 'variable' | 'health';
export type HudKind = 'counter' | 'bar' | 'text';
export type HudAnchor = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** One piece of in-game HUD, bound to the score, the clock, a variable or an entity's health. */
export interface HudElement {
  id: string;
  kind: HudKind;
  source: HudSource;
  /** `source: 'variable'`. */
  variableId?: string;
  /** `source: 'health'`: node / actor id (default: the player). */
  actorId?: string;
  label?: string;
  anchor: HudAnchor;
  color?: string;
  /** Full-bar value for `kind: 'bar'` (variables and score; health and time use their own maximum). */
  max?: number;
}

// ============================================================================
// CORE 3D CAMERA, ENVIRONMENT, ACTOR & SCENE CONTRACTS
// ============================================================================

export interface CameraKeyframe {
  id?: string;
  time: number;
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov?: number;
  label?: string;
  /** Easing applied from this keyframe to the next one (default 'linear'). */
  ease?: EaseId;
}

export interface CameraRig {
  mode: CameraMode;
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov: number;
  followActorId?: string;
  keyframes: CameraKeyframe[];
  /** Phase 10A: shot list for media scenes. When present it drives the camera instead of `mode`. */
  shots?: CameraShot[];
}

export interface EnvironmentConfig {
  presetId: LightingPresetId;
  backgroundColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  groundGrid: boolean;
  groundColor: string;
  reflectivePedestal?: boolean;
  ambientIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  rimLightColor: string;
}

export interface ActorNode {
  id: string;
  name: string;
  assetId: string;
  modelUrl?: string; // Real CORS-safe GLTF/GLB URL
  customGlbUrl?: string;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  primaryColor: string;
  secondaryColor?: string;
  metalness?: number;
  roughness?: number;
  activeAnimation: AnimationType;
  activeClip?: string; // Embedded GLTF Skeletal Animation Clip Name (e.g. 'Idle', 'Walking', 'Dance')
  availableClips?: string[];
  animationSpeed?: number;
  physicsRole: PhysicsRole;
  onClickAction: ActorClickAction;
  scoreValue?: number;
  visible?: boolean;
  locked?: boolean;
  startTime?: number;
  endTime?: number;
  enterEffect?: EnterEffect;
  unboxTapsRequired?: number;
  revealAssetId?: string;
  /**
   * Phase 10A: acting over time (media mode). Steps are applied in time order from the actor's base position:
   * walk to points, switch clips, face another actor. Shared by the studio and the Player (src/runtime/cinematics.ts).
   */
  performance?: PerformanceStep[];
  /** Phase 10C: how this character sounds when it speaks dialogue lines. */
  voice?: ActorVoice;
  /**
   * Phase 8/9: measured skinning cost of a rigged model (set when an OmniRig character is placed), used by the mobile budget
   * (`mobile.rig-cost`). Never authored by the AI.
   */
  rigCost?: RigCost;
  /**
   * Phase 10C (runtime only, never authored): 0..1 speaking level at the current time, set by performedActor so the
   * renderers can add talk motion. Not saved.
   */
  talkLevel?: number;
  /** Phase 6 Batch 3: one of the fixed, reviewed shader looks (never shader code), see src/runtime/shaderEffects.ts. */
  shaderEffect?: ShaderEffect;
  /** Phase 9: behaviour state machine (game mode), run by src/runtime/stateMachine.ts. */
  stateMachine?: ActorStateMachine;
  /** Phase 3: hit points (logic graph damage / heal, HUD health bar). */
  health?: HealthSpec;
}

// ============================================================================
// PHASE 9: BEHAVIOUR STATE MACHINES (AI-authored data, interpreted by src/runtime/stateMachine.ts — never code)
// ============================================================================

/** How an actor moves while in a state. `points` are [x, y, z] in 3D or [x, y] in the 2D 1000x600 space. */
export type StateMachineMove = 'stay' | 'patrol' | 'move-to' | 'chase-player' | 'flee-player' | 'return-home';

/** Transition guard. Distances are metres (3D, x/z plane) or design px (2D). */
export type StateMachineCondition =
  | { type: 'player-near'; distance: number }
  | { type: 'player-far'; distance: number }
  /** Seconds spent in the current state. */
  | { type: 'timer'; seconds: number }
  /** move-to / return-home reached, patrol lap finished, chase caught up, 'stay' at once. */
  | { type: 'arrived' }
  /** The machine's own health (starts at `health`, changed by 'add-health'). */
  | { type: 'health-below'; value: number }
  | { type: 'score-at-least'; value: number }
  /** Sent by a 'send-signal' action of any machine, or a logic-graph action { actionType: 'send-signal', signal }. */
  | { type: 'signal'; name: string }
  /** Touching the player. */
  | { type: 'collided' }
  /** Tapped / clicked. */
  | { type: 'clicked' }
  /** Seeded roll every `every` s (default 1) with probability `chance` (0..1). */
  | { type: 'random'; chance: number; every?: number };

/** Runs once when a state is entered. */
export type StateMachineAction =
  | { type: 'add-score'; amount: number }
  /** Changes the machine's health; with `health` on the entity it is the entity's real hit points. */
  | { type: 'add-health'; amount: number }
  | { type: 'spawn-vfx'; vfx: VFXType; color?: string }
  | { type: 'play-sfx'; sound: GameAudioEvent }
  | { type: 'send-signal'; name: string }
  | { type: 'set-visible'; visible: boolean }
  | { type: 'end-game'; won: boolean };

export interface StateMachineTransition {
  to: string;
  when: StateMachineCondition;
}

export interface StateMachineState {
  /** 3D: skeletal clip (one of availableClips); 2D: spriteSheet clip. Moving states default to Walk / Run, 'stay' to Idle. */
  clip?: string;
  /** Procedural motion (non-rigged 3D actors). */
  animation?: AnimationType;
  move?: StateMachineMove;
  /** patrol waypoints (looped) or the move-to target (first point). */
  points?: Array<[number, number] | [number, number, number]>;
  /** m/s in 3D (default 1.5), px/s in 2D (default 120). */
  speed?: number;
  onEnter?: StateMachineAction[];
  /** Checked in order each frame; the first true one fires (at most one transition per frame). */
  transitions?: StateMachineTransition[];
}

export interface ActorStateMachine {
  initial: string;
  states: Record<string, StateMachineState>;
  /** Starting health for 'health-below' / 'add-health' (default 100). */
  health?: number;
  /** Seed for 'random' conditions (default 1). */
  seed?: number;
}

/** Phase 6 Batch 3 — parameterised shader presets drawn by src/render3d/shaderEffects.ts (GLSL) and its TSL twin. */
export type ShaderEffectPreset = 'hologram' | 'dissolve' | 'toon' | 'forcefield' | 'lava' | 'rainbow';

export interface ShaderEffect {
  preset: ShaderEffectPreset;
  /** Effect colour (#rrggbb); default per preset. */
  color?: string;
  /** Strength 0..3 (default 1). */
  intensity?: number;
  /** Animation speed 0..5 (default 1). */
  speed?: number;
  /** Dissolve amount 0 (whole) .. 1 (gone); default 0. Ignored by the other presets. */
  progress?: number;
  /** Animate progress from → to over [start, start + duration] seconds (overrides progress), e.g. a dissolve-out. */
  progressTween?: { from: number; to: number; start: number; duration: number };
}

/**
 * Phase 10C: 'piper' = real neural voice synthesised in the studio (downloaded once); 'babble' = procedural voice, no download.
 * Phase 10D: 'elevenlabs' = ElevenLabs TTS with the creator's own key (paid tool; licence recorded in the project library).
 */
export type VoiceEngine = 'piper' | 'babble' | 'elevenlabs';

export interface ActorVoice {
  engine?: VoiceEngine;
  /** Piper voice id, e.g. 'vi_VN-vais1000-medium' (default picked from the line's language). */
  voiceId?: string;
  /** Phase 10D: ElevenLabs voice id used when the engine is 'elevenlabs' (default: a stock multilingual voice). */
  elevenLabsVoiceId?: string;
  /** Semitones, -8..8 (small creatures higher, giants lower). */
  pitch?: number;
  /** Speaking rate 0.7..1.4 (babble only; Piper keeps its natural pace). */
  rate?: number;
}

export type DialogueEmotion = 'neutral' | 'happy' | 'excited' | 'sad' | 'angry' | 'scared' | 'whisper';

/** Phase 10C: one spoken line. Captions, talk motion and the voice track are all derived from it. */
export interface DialogueLine {
  id: string;
  /** Start, seconds from the scene start. */
  time: number;
  /** actorId of the speaker. */
  speaker: string;
  text: string;
  emotion?: DialogueEmotion;
  /** actorId the speaker turns to while talking (when standing still). */
  listener?: string;
  /** Phase 10D: voice engine for this line only (overrides the speaker's engine, e.g. one ElevenLabs line among Piper ones). */
  engine?: VoiceEngine;
  /** Spoken length in seconds — filled in when the voice is generated (else estimated from the text). */
  duration?: number;
  /** Key of the generated voice clip (content hash) — filled in when the voice is generated. */
  clip?: string;
}

/** Phase 10A — one beat of an actor's performance. */
export interface PerformanceStep {
  /** Seconds from scene start when this step begins. */
  time: number;
  /** Skeletal clip to play from this step (rigged GLB), e.g. 'Walk', 'Wave', 'Sitting'. Matched case-insensitively. */
  clip?: string;
  /** Procedural motion for non-rigged actors (and as a hint for rigs without that clip). */
  animation?: AnimationType;
  /** Walk / run to this point. Arrives after `duration` s (default: when the next step starts, else 2 s). */
  moveTo?: Vector3Tuple;
  duration?: number;
  /** Clip once `moveTo` has arrived (default 'Idle'). While moving without `clip`, Walk/Run is chosen from the speed. */
  arriveClip?: string;
  /** Face another actor (id) or a point; ignored while walking (actors face where they walk). */
  lookAt?: string | Vector3Tuple;
  /** Explicit facing in degrees (0 = towards +z / the default camera). */
  faceDeg?: number;
  /** Clip playback speed. */
  speed?: number;
  /** Easing of the walk (default 'sine.inOut'). */
  ease?: EaseId;
  /** Short note for the editor ("wakes up", "waves at fox"). */
  label?: string;
}

/** Phase 10A — framing presets the director composes shots from (positions are computed from the subject). */
export type ShotType = 'establishing' | 'wide' | 'medium' | 'close-up' | 'over-shoulder' | 'low-angle' | 'high-angle' | 'tracking';
export type ShotMove = 'static' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'crane-up' | 'orbit';

/** Phase 10A — one camera shot. Consecutive shots are hard cuts. */
export interface CameraShot {
  start: number;
  /** Default: next shot's start, else the scene end. */
  end?: number;
  type: ShotType;
  /** Actor the shot frames (default: the hero = player or first actor). */
  subject?: string;
  /** over-shoulder: the actor whose shoulder we look over (in the foreground); the subject is the face we see. */
  partner?: string;
  /** Where the camera stands relative to where the subject faces. */
  angle?: 'front' | 'three-quarter-left' | 'three-quarter-right' | 'left' | 'right' | 'back';
  move?: ShotMove;
  /** Lens (degrees). The camera distance compensates, so the shot type still sets the framing. */
  fov?: number;
  label?: string;
}

/** Phase 10A — how this scene starts when it follows another scene (Preview, Player, video export). */
/** 'crossfade' is a real dissolve (Player + MP4); 'whip-pan' flings the old shot off with blur; 'iris' closes to black on the old shot and opens on the new one. */
export type SceneTransition = 'cut' | 'fade' | 'crossfade' | 'fade-white' | 'wipe' | 'whip-pan' | 'iris';

export interface VFXNode {
  id: string;
  name: string;
  type: VFXType;
  position: Vector3Tuple;
  color: string;
  intensity: number;
  scale?: number;
  labelText?: string;
  visible?: boolean;
  startTime?: number;
  endTime?: number;
  enterEffect?: EnterEffect;
}

export interface MarketingOverlayConfig {
  enabled: boolean;
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaUrl?: string;
  brandColor: string;
  badgeText?: string;
  triggerCondition: 'always' | 'on-win' | 'after-3s';
}

export interface GameRule {
  winCondition: 'collect-all' | 'score-threshold' | 'survive-timer' | 'unbox-reveal' | 'variable-threshold';
  /** Phase 3: with `winCondition: 'variable-threshold'` the game is won when this variable reaches `atLeast`. */
  winVariable?: { id: string; atLeast: number };
  targetScore: number;
  timeLimitSeconds: number;
  instructions: string;
}

export interface TimelineTrack {
  id: string;
  label: string;
  type: 'camera' | 'actor-anim' | 'vfx-cue' | 'marketing-cta';
  startTime: number;
  endTime: number;
  color: string;
}

// ============================================================================
// PHASE 3: MULTI-SCENE STORYBOARD SEQUENCING
// ============================================================================

export type StoryboardKind = 'film' | 'game-levels' | 'ad-sequence';

// ----------------------------------------------------------------------------
// Phase 11A — Story Bible: the writers' room output every scene of a film is authored against
// ----------------------------------------------------------------------------

/** Short-story shapes the writer picks from (see STORY_TEMPLATES in src/agent/storyBible.ts). */
export type StoryTemplateId = 'visual-gag' | 'mini-journey' | 'meet-cute' | 'reveal-twist' | 'story-ad';

export interface StoryCharacter {
  /** Stable actor id the scenes must use for this character (e.g. "hero"). */
  actorId: string;
  /** ASSET_REGISTRY id of the rig that plays this character. */
  assetId: string;
  name: string;
  /** What the character is trying to get (drives every scene it is in). */
  want: string;
  /** What goes wrong for it: its flaw / what it fears. */
  flaw: string;
  /** How it talks and moves, in a few words ("shy, whispers, tiny steps"). */
  manner: string;
  /** The gesture the audience will remember, in plain words. */
  signatureGesture: string;
  /** Exact clip of the rig that performs the gesture (checked against the asset's clips). */
  signatureClip?: string;
  /** Voice pitch offset (-8..8) so characters sound different. */
  pitch?: number;
  /** Phase 11B: what the character looks like, written as a prompt for a 3D character generator (English, <= 300 chars). */
  look?: string;
  /**
   * Phase 11B: set once a generated model (e.g. Meshy) replaced the stock rig. `clips` are the animation names that model can
   * perform (the writer and the lint use them instead of ASSET_REGISTRY); `modelUrl` is where the studio loads it from.
   */
  generated?: { provider: string; clips: string[]; modelUrl?: string; libraryAssetId?: string };
}

/** Phase 11B: a spoken line sketched by the dialogue writer (the scene author turns it into timed dialogue). */
export interface StoryLine {
  /** actorId of a bible character. */
  speaker: string;
  text: string;
  emotion?: string;
}

/** Phase 11B: a set piece worth a real model (not a primitive). */
export interface StoryProp {
  id: string;
  name: string;
  /** Prompt for a 3D generator, English, <= 300 chars. */
  look: string;
  /** Scenes (1-based) the prop appears in. */
  scenes: number[];
  /** Set once a generated model replaced the placeholder. */
  generated?: { provider: string; modelUrl?: string; libraryAssetId?: string };
}

export interface StoryBibleBeat {
  /** 1-based scene number this beat belongs to. */
  scene: number;
  /** What changes for the hero in this scene. */
  purpose: string;
  /** What stands in the way. */
  conflict: string;
  emotionStart: string;
  emotionEnd: string;
  /** The image / question / turn the scene ends on (pulls the viewer into the next scene). */
  endsOn: string;
  /** Phase 11B (world desk): where this scene happens, in a sentence. */
  setting?: string;
  /** Phase 11B: one of BIOME_IDS the set is dressed with. */
  biome?: string;
  /** Phase 11B: ids of `bible.props` that appear here. */
  props?: string[];
  /** Phase 11D: id of the `bible.locations` entry this scene happens in (scenes at one location share one world). */
  location?: string;
  /** Phase 11B (dialogue desk): the lines of this scene (0-4). */
  lines?: StoryLine[];
}

/** Phase 11D: a place the film returns to. Every scene at a location is dressed once and reuses that world; only the camera changes. */
export interface StoryLocation {
  id: string;
  name: string;
  /** One sentence a camera can show. */
  setting: string;
  /** One of BIOME_IDS. */
  biome?: string;
}

/** A planted object / line that must come back (setup → payoff). */
export interface StoryMotif {
  what: string;
  setupScene: number;
  payoffScene: number;
}

export interface StoryBible {
  template?: StoryTemplateId;
  logline: string;
  theme: string;
  tone: string;
  /** What the viewer sees in the first seconds that makes them stay. */
  hook: string;
  /** Second of the film the hook lands (must be <= 3). */
  hookSeconds: number;
  /** What is lost if the hero fails. */
  stakes: string;
  /** The reversal around the middle of the film. */
  turn: string;
  /** The final image that pays everything off. */
  payoff: string;
  characters: StoryCharacter[];
  beats: StoryBibleBeat[];
  motifs?: StoryMotif[];
  /** Phase 11B (world desk): props that deserve their own model. */
  props?: StoryProp[];
  /** Phase 11D (world desk): the places of the film; beats point at them with `location`. */
  locations?: StoryLocation[];
}

/** Links a scene into an ordered storyboard (film shots or game levels). */
export interface SceneSequenceMeta {
  storyboardId: string;
  storyboardTitle: string;
  kind: StoryboardKind;
  index: number; // 0-based position in the storyboard
  total: number;
  /** Next scene to advance to when this level is won / this shot ends. */
  nextSceneId?: string;
  /** Narrative beat or level objective that this scene fulfils. */
  beat?: string;
  /** Phase 10A: transition INTO this scene from the previous one (default 'fade'). */
  transition?: SceneTransition;
  /** Phase 10A: short script of this shot (screenwriter step), kept for continuity and editing. */
  script?: string;
  /** Phase 11A: the film's story bible (same object on every scene of the storyboard). */
  bible?: StoryBible;
  /** Phase 11E J-cut: seconds (0-1.5) this scene's ambience / music arrives BEFORE its picture (MP4 soundtrack). */
  audioLead?: number;
  /** Phase 11E L-cut: seconds (0-1.5) the previous scene's sound (a line still being spoken, its ambience) runs on over this scene's picture. */
  audioTail?: number;
}

export interface StoryboardBeat {
  title: string;
  description: string;
  engineType: EngineType;
  mode: StudioMode;
  beat: string;
  difficulty?: number; // 1..N, used for game level escalation
  /** Phase 10A screenwriter: timed actions + shot list in plain words (media beats). */
  script?: string;
  /** Phase 10A: transition into this beat. */
  transition?: SceneTransition;
}

export interface StoryboardPlan {
  storyboardTitle: string;
  kind: StoryboardKind;
  engineType: EngineType;
  beats: StoryboardBeat[];
  /** Phase 11A: story bible the beats were written from (films and ads). */
  bible?: StoryBible;
}

export interface SceneSpec {
  id: string;
  title: string;
  description: string;
  engineType: EngineType;
  mode: StudioMode;
  aspectRatio: AspectRatioPreset;
  durationSeconds: number;
  environment: EnvironmentConfig;
  world: WorldSpec;
  camera: CameraRig;
  actors: ActorNode[];
  nodes2D: Node2D[];
  /** Phase 2: 2D world size (default 1000x600, one screen). Bigger worlds scroll. */
  world2D?: World2DSpec;
  /** Phase 2: 2D camera (fixed / follow, zoom, dead zone, look-ahead). */
  camera2D?: Camera2DSpec;
  /** Phase 3: variables shared by the logic graph and the HUD. */
  variables?: GameVariable[];
  /** Phase 3: declarative in-game HUD. */
  hud?: HudElement[];
  vfx: VFXNode[];
  marketingOverlay: MarketingOverlayConfig;
  gameRules: GameRule;
  timelineTracks: TimelineTrack[];
  logicGraph?: LogicGraphSpec;
  sequence?: SceneSequenceMeta;
  /** Phase 4: procedural sound cues for gameplay events (also embedded in standalone playable exports). */
  audio?: SceneAudioSpec;
  /** Phase 10B: film soundtrack (music, ambience, timed SFX). Plays in Preview, the Player and MP4 exports. */
  soundtrack?: SoundtrackSpec;
  /** Phase 10C: spoken lines (voice, auto captions, talk motion). */
  dialogue?: DialogueLine[];
  /** Phase 10C: show dialogue as captions (default true). */
  dialogueCaptions?: boolean;
  /** Phase 5: timed captions / subtitles (drawn on the 2D canvas, overlaid in 3D, exportable as WebVTT). */
  captions?: CaptionCue[];
  /** Phase 6: particle presets from extensions used by this scene (recipes copied in, so the scene is portable). */
  particleLibrary?: Record<string, ParticleRecipe>;
  /** Phase 6: SFX presets from extensions used by this scene. */
  sfxLibrary?: Record<string, SfxRecipe>;
  /** Music, SFX and voice clips mixed against the timeline clock. */
  audioTracks?: AudioTrackSpec[];
}

export type AudioTrackKind = 'music' | 'sfx' | 'voice';

export interface AudioTrackSpec {
  id: string;
  name: string;
  url: string;
  kind: AudioTrackKind;
  startTime: number;
  volume: number; // 0..1
  muted?: boolean;
  loop?: boolean;
}

// ============================================================================
// USER ASSET LIBRARY: Local Folder Mounts, Favorites & Custom Label Collections
// ============================================================================

export type AssetDefinitionKind = 'model' | 'image' | 'svg' | 'audio' | 'hdri';

export type AssetDefinitionSource = 'local-folder' | 'local-file' | 'url' | OnlineAssetProvider;

/** An asset the user brought into the library: mounted from disk, by URL, or bookmarked from the Online Hub. */
export interface AssetDefinition {
  id: string;
  name: string;
  kind: AssetDefinitionKind;
  /** Loadable URL. Empty for hub bookmarks that still need a resolve step (see `online`). */
  url: string;
  source: AssetDefinitionSource;
  /** Sub-folder the file was found in when mounted from a local directory. */
  folder?: string;
  tags: string[];
  thumbnailUrl?: string;
  author?: string;
  license?: string;
  sourcePageUrl?: string;
  sizeBytes?: number;
  addedAt: number;
  /** Original hub search result, kept so the download can be resolved again later. */
  online?: OnlineAssetResult;
}

export interface AssetCollection {
  id: string;
  name: string;
  color: string;
  assetIds: string[];
}

export interface BoundingBoxSpec {
  width: number;
  height: number;
  depth: number;
}

export interface AttachmentSockets {
  head?: Vector3Tuple;
  hand_r?: Vector3Tuple;
  ground: Vector3Tuple;
  top_badge: Vector3Tuple;
}

export interface SemanticAssetEntry {
  assetId: string;
  name: string;
  category:
    | 'gltf-rigged'
    | 'character'
    | 'product'
    | 'collectible'
    | 'vehicle'
    | 'environment-prop';
  description: string;
  modelUrl?: string;
  defaultScale?: number;
  embeddedClips?: string[];
  defaultClip?: string;
  defaultPrimaryColor: string;
  defaultSecondaryColor: string;
  defaultMetalness: number;
  defaultRoughness: number;
  defaultAnimation: AnimationType;
  defaultPhysicsRole: PhysicsRole;
  defaultClickAction: ActorClickAction;
  defaultScoreValue: number;
  boundingBox: BoundingBoxSpec;
  attachmentSockets: AttachmentSockets;
  supportedAnimations: AnimationType[];
}

// ============================================================================
// PHASE 3: ONLINE ASSET HUB (Poly Pizza / Sketchfab / Poly Haven via server proxy)
// ============================================================================

export type OnlineAssetProvider = 'polypizza' | 'sketchfab' | 'polyhaven';

export type OnlineAssetKind = 'model' | 'hdri';

export interface OnlineAssetResult {
  provider: OnlineAssetProvider;
  kind: OnlineAssetKind;
  id: string;
  name: string;
  thumbnailUrl?: string;
  author?: string;
  license?: string;
  animated?: boolean;
  triangleCount?: number;
  sourcePageUrl?: string;
  /** Proxied, CORS-safe URL ready for useGLTF / RGBELoader. Absent when a resolve step is needed (Sketchfab). */
  downloadUrl?: string;
}

export interface OnlineAssetSearchResponse {
  provider: OnlineAssetProvider;
  kind: OnlineAssetKind;
  query: string;
  total: number;
  results: OnlineAssetResult[];
}

/** Phase 6: AI providers (API keys) and local coding-agent CLIs (signed-in subscriptions). */
export type AIProviderId =
  | 'gemini'
  | 'openai-compatible'
  | 'openrouter'
  | 'anthropic'
  | 'cli-claude'
  | 'cli-codex'
  | 'cli-antigravity'
  | 'cli-opencode';

export interface SettingsConfig {
  /** Phase 6: active AI provider for the director, storyboard and vision QA. */
  aiProvider: AIProviderId;
  /** Model per provider (empty = provider default). */
  aiModels: Partial<Record<AIProviderId, string>>;
  /** API keys per provider, kept in this browser's localStorage and sent only to the local OmniStage server. */
  aiApiKeys: Partial<Record<AIProviderId, string>>;
  /** Base URL for 'openai-compatible' (OpenAI, Ollama, LM Studio, vLLM, Groq, DeepSeek...). */
  aiBaseUrl: string;
  /**
   * Phase 6: when the active connection fails (not configured, not signed in, rate limit, timeout, bad answer), try these
   * connections next, in order. The active provider is skipped if it is listed. Default on with an empty list.
   */
  aiFallbackEnabled?: boolean;
  aiFallbackOrder?: AIProviderId[];
  /**
   * Phase 7C: how the AI director edits scenes. 'patch' (default) = small JSON Patch edits in a verify loop;
   * 'full' = the model rewrites the whole SceneSpec (for models that cannot follow the patch format).
   */
  aiEditMode?: 'patch' | 'full';
  /** Phase 6: built-in director skills the user switched off. */
  disabledSkills: string[];
  geminiModel: 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-flash-latest';
  polyPizzaApiKey: string;
  sketchfabApiToken: string;
  /** Phase 6 Batch 3: BYO keys for generation providers (meshy, tripo, fal, replicate); localStorage only, sent as x-generate-key. */
  generationKeys?: Partial<Record<'meshy' | 'tripo' | 'rodin' | 'fal' | 'replicate' | 'openrouter' | 'elevenlabs' | 'blockade', string>>;
  /**
   * Phase 10D: vision-model director QA after AI film shots (needs a vision-capable connection). Default on.
   * Shots scoring under `directorQAThreshold` (default 70) get one extra patch round driven by the director's notes.
   */
  directorQA?: boolean;
  /** Phase 11B: open the Writers' Room (read, edit and approve the story) before a film or ad is produced. Default on. */
  writersRoomReview?: boolean;
  directorQAThreshold?: number;
  /**
   * Phase 10D: paid production tools, bring your own key. Kept in this browser's localStorage, sent only to the local
   * OmniStage server as a header (x-elevenlabs-key); never written into SceneSpec, projects or logs.
   */
  elevenLabsApiKey?: string;
  /** ElevenLabs TTS model id (default eleven_multilingual_v2). */
  elevenLabsModel?: string;
  customSystemPrompt: string;
  customAssetManifestUrl: string;
  enableThreeOfficialCdn: boolean;
  enableSketchfabHub: boolean;
  enablePolyPizzaHub: boolean;
  enablePolyHavenHub: boolean;
  defaultEngine: EngineType;
  renderQuality: 'draft' | 'high' | 'ultra-postprocessing';
  fpsCap: 30 | 60;
  enableShadows: boolean;
  enableBloom: boolean;
  physicsGravity: number;
}

export interface ActorCoordinateSummary {
  id: string;
  name: string;
  assetId: string;
  physicsRole: PhysicsRole;
  worldPosition: Vector3Tuple;
  scale: Vector3Tuple;
  boundingBox: BoundingBoxSpec;
}

export interface VisionQAIssue {
  id: string;
  severity: 'high' | 'medium' | 'low';
  category: 'framing' | 'overlap' | 'contrast' | 'grounding' | 'conversion';
  title: string;
  description: string;
  suggestedFixSummary: string;
}

export interface VisionQAReport {
  timestamp: string;
  overallScore: number;
  summary: string;
  screenshotDataUrl?: string;
  actorCoordinates?: ActorCoordinateSummary[];
  issues: VisionQAIssue[];
  proposedSceneSpec: SceneSpec;
  applied?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  diffSummary?: string[];
  previousSpecSnapshot?: SceneSpec;
  updatedSpecSnapshot?: SceneSpec;
  visionReport?: VisionQAReport;
  /** Phase 4: prompt that produced this assistant message (used by "Save as skill"). */
  sourcePrompt?: string;
  /** Phase 4: Director Skills injected into the prompt for this turn. */
  skillsUsed?: string[];
  /** Phase 4: deterministic verification result of updatedSpecSnapshot. */
  verification?: VerificationReport;
  /** Phase 6: a lasting preference spotted in the user's prompt, offered as a memory (user confirms). */
  memorySuggestion?: { text: string; kind: 'preference' | 'style' | 'goal' | 'constraint' | 'feedback' | 'fact' };
  /** Phase 6: catalog extensions the director suggests for this request (installed only after approval). */
  extensionSuggestions?: Array<{ id: string; name: string; reason: string }>;
  /** Phase 6 batch 2: this reply answers an app-usage question from the Guide (no AI call). */
  guideTopicId?: string;
  /** Where the reply came from: a model (`ai`), the built-in keyword director (`offline`), or a failed AI call (`error`). */
  aiSource?: { source: 'ai' | 'offline' | 'error'; reason?: string };
}
