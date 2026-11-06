/**
 * CORE CONTRACT: SceneSpec & Multi-Coding-Agent Schema Definitions
 * All 3D rendering, AI agent mutations, Vision QA diagnostics, and HTML5 exports
 * strictly adhere to this declarative schema.
 */

export type StudioMode = 'game' | 'media';

export type AspectRatioPreset = '16:9' | '9:16' | '1:1';

export type LightingPresetId =
  | 'clean-apple-studio'
  | 'cyberpunk-neon'
  | 'sunset-cinematic'
  | 'arcade-vibrant';

export type CameraMode =
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

export type PhysicsRole = 'static' | 'dynamic' | 'collectible' | 'player';

export type ActorClickAction =
  | 'none'
  | 'collect-score'
  | 'jump-boost'
  | 'trigger-vfx'
  | 'cta-redirect';

export type VFXType =
  | 'sparkles'
  | 'shockwave'
  | 'floating-3d-badge'
  | 'laser-beam'
  | 'confetti';

export type Vector3Tuple = [number, number, number];

export interface CameraKeyframe {
  id: string;
  time: number; // Seconds (0 to duration)
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
  ambientIntensity: number;
  keyLightColor: string;
  keyLightIntensity: number;
  rimLightColor: string;
}

export interface ActorNode {
  id: string;
  name: string;
  assetId: string;
  customGlbUrl?: string;
  position: Vector3Tuple;
  rotation: Vector3Tuple; // Euler radians [x, y, z]
  scale: Vector3Tuple;
  primaryColor: string;
  secondaryColor?: string;
  metalness?: number;
  roughness?: number;
  activeAnimation: AnimationType;
  animationSpeed?: number;
  physicsRole: PhysicsRole;
  onClickAction: ActorClickAction;
  scoreValue?: number;
  visible?: boolean;
}

export interface VFXNode {
  id: string;
  name: string;
  type: VFXType;
  position: Vector3Tuple;
  color: string;
  intensity: number;
  scale?: number;
  labelText?: string; // Used when type === 'floating-3d-badge'
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
  winCondition: 'collect-all' | 'score-threshold' | 'survive-timer';
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
  mode: StudioMode;
  aspectRatio: AspectRatioPreset;
  durationSeconds: number;
  environment: EnvironmentConfig;
  camera: CameraRig;
  actors: ActorNode[];
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
  category: 'character' | 'product' | 'collectible' | 'vehicle' | 'environment-prop';
  description: string;
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
