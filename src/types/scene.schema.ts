/**
 * CORE CONTRACT: SceneSpec & Multi-Coding-Agent Schema Definitions (Phase 3)
 * Unifies 3D WebGL Authoring + 2D Vector/Sprite Authoring, Real GLTF Skeletal Models,
 * Procedural World/Terrain/Weather Systems, Multi-Scene Storyboards, and Studio Settings.
 */

export type EngineType = '3d' | '2d';

export type StudioMode = 'game' | 'media';

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
  | 'crystal-clusters';

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
  | 'tile-platform';

export type Physics2DRole =
  | 'static-platform'
  | 'player-platformer'
  | 'player-topdown'
  | 'bouncing'
  | 'collectible'
  | 'none';

export interface Keyframe2D {
  time: number;
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
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
}

export interface CameraRig {
  mode: CameraMode;
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov: number;
  followActorId?: string;
  keyframes: CameraKeyframe[];
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
}

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

export interface SettingsConfig {
  geminiModel: 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-flash-latest';
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
}
