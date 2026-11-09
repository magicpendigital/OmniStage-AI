/**
 * CORE CONTRACT: SceneSpec & Multi-Coding-Agent Schema Definitions (Phase 3 + Phase 5)
 * Unifies 3D WebGL Authoring + 2D Vector/Sprite Authoring, Real GLTF Skeletal Models,
 * Procedural World/Terrain/Weather Systems, Multi-Scene Storyboards, Studio Settings,
 * Bidirectional Visual Logic Node Graphs (n8n/ComfyUI Style), and Real-Time Execution Logs.
 */

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
}

export interface StoryboardBeat {
  title: string;
  description: string;
  engineType: EngineType;
  mode: StudioMode;
  beat: string;
  difficulty?: number; // 1..N, used for game level escalation
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

export interface SettingsConfig {
  geminiModel: 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-flash-latest';
  polyPizzaApiKey: string;
  sketchfabApiToken: string;
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
