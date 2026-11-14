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
  | 'static-platform'
  | 'player-platformer'
  | 'player-topdown'
  | 'bouncing'
  | 'collectible'
  | 'none';

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
   * Phase 10C (runtime only, never authored): 0..1 speaking level at the current time, set by performedActor so the
   * renderers can add talk motion. Not saved.
   */
  talkLevel?: number;
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
export type SceneTransition = 'cut' | 'fade' | 'crossfade' | 'fade-white' | 'wipe';

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
  winCondition: 'collect-all' | 'score-threshold' | 'survive-timer' | 'unbox-reveal';
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
   * Phase 7C: how the AI director edits scenes. 'patch' (default) = small JSON Patch edits in a verify loop;
   * 'full' = the model rewrites the whole SceneSpec (for models that cannot follow the patch format).
   */
  aiEditMode?: 'patch' | 'full';
  /** Phase 6: built-in director skills the user switched off. */
  disabledSkills: string[];
  geminiModel: 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-flash-latest';
  polyPizzaApiKey: string;
  sketchfabApiToken: string;
  /**
   * Phase 10D: vision-model director QA after AI film shots (needs a vision-capable connection). Default on.
   * Shots scoring under `directorQAThreshold` (default 70) get one extra patch round driven by the director's notes.
   */
  directorQA?: boolean;
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
}
