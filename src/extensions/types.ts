/**
 * Phase 6 — OmniStage Extensions (plugins + skill packs + asset libraries).
 *
 * An extension is a manifest (`omnistage-extension.json`) with declarative contributions and, optionally, a JS
 * `main` that runs in a sandboxed iframe (no DOM/storage/network access; host API via postMessage, gated by
 * the permissions the user approved at install). AI agents may draft or recommend extensions, but installing
 * one always goes through the review & approval dialog.
 */
import type { DirectorSkill, EngineType, StudioMode } from '../types/scene.schema';

export type ExtensionKind = 'skill-pack' | 'vfx-pack' | 'sfx-pack' | 'asset-library' | 'tool' | 'mixed';

export type ExtensionPermission =
  | 'scene:read'
  | 'scene:write'
  | 'library:read'
  | 'network'
  | 'ui:notify'
  | 'generate';

export const PERMISSION_INFO: Record<ExtensionPermission, { label: string; risk: 'low' | 'medium' | 'high' }> = {
  'scene:read': { label: 'Read the open scene (SceneSpec JSON)', risk: 'low' },
  'scene:write': { label: 'Change the open scene (verified, undoable)', risk: 'medium' },
  'library:read': { label: 'List assets in your personal library', risk: 'medium' },
  network: { label: 'Fetch from the declared hosts via OmniStage', risk: 'high' },
  'ui:notify': { label: 'Show notifications in the studio', risk: 'low' },
  generate: { label: 'Generate assets with your own provider API key (uses your credits) and save them to your library', risk: 'medium' },
};

/**
 * Phase 6 Batch 3 — asset-generation providers. The provider's API hosts, auth scheme and result hosts live in
 * the server (server/generate/providers.ts), never in the manifest, so an extension cannot point a key elsewhere.
 */
export type GenerationProviderId = 'meshy' | 'tripo' | 'fal' | 'replicate';

export const GENERATION_PROVIDERS: Record<GenerationProviderId, { label: string; output: 'model' | 'image'; keyUrl: string; keyLabel: string }> = {
  meshy: { label: 'Meshy', output: 'model', keyUrl: 'https://www.meshy.ai/settings/api', keyLabel: 'Meshy API key (msy_…)' },
  tripo: { label: 'Tripo', output: 'model', keyUrl: 'https://platform.tripo3d.ai/api-keys', keyLabel: 'Tripo API key (tsk_…)' },
  fal: { label: 'fal.ai', output: 'image', keyUrl: 'https://fal.ai/dashboard/keys', keyLabel: 'fal.ai key (id:secret)' },
  replicate: { label: 'Replicate', output: 'image', keyUrl: 'https://replicate.com/account/api-tokens', keyLabel: 'Replicate API token (r8_…)' },
};

/** A text-to-asset generator contributed by an extension (needs the `generate` permission). */
export interface ExtensionGenerator {
  id: string;
  title: string;
  description?: string;
  provider: GenerationProviderId;
  output: 'model' | 'image';
  /** Image models only (fal / Replicate), e.g. "fal-ai/flux/schnell" or "black-forest-labs/flux-schnell". */
  model?: string;
  /** Meshy: run the texture (refine) stage after the mesh; fal: cut the background out for sprites. */
  texture?: boolean;
  removeBackground?: boolean;
  /** Add sprite framing words to the prompt (single centred subject, plain background). */
  sprite?: boolean;
}

/** Particle recipe — same fields the built-in presets use (see src/vfx/particles2D.ts). */
export interface ParticleRecipe {
  rate: number;
  life: number;
  speed: [number, number];
  angle: [number, number];
  gravity?: number;
  size: [number, number];
  shape: 'circle' | 'rect' | 'line' | 'pixel' | 'star';
  colors: string[];
  alpha?: number;
  fade?: boolean;
  shrink?: boolean;
  grow?: boolean;
  additive?: boolean;
  spread?: number;
  area?: boolean;
  drift?: number;
  orbit?: number;
  spin?: number;
  burst?: number;
}

/** SFX recipe — same fields the built-in synth uses (see src/audio/sfxRuntime.ts). */
export interface SfxRecipe {
  wave: 'square' | 'sine' | 'triangle' | 'sawtooth' | 'noise';
  dur: number;
  vol: number;
  f0?: number;
  f1?: number;
  notes?: number[];
  step?: number;
  lp0?: number;
  lp1?: number;
  attack?: number;
}

export interface ExtensionAssetItem {
  name: string;
  kind: 'model' | 'image' | 'spritesheet' | 'audio' | 'hdri';
  url: string;
  license: string;
  thumbnailUrl?: string;
  tags?: string[];
}

export interface ExtensionCommand {
  id: string;
  title: string;
  description: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  kind: ExtensionKind;
  tags?: string[];
  targets?: { engines?: EngineType[]; modes?: StudioMode[]; genres?: string[] };
  permissions?: ExtensionPermission[];
  networkHosts?: string[];
  contributes?: {
    skills?: Array<Omit<DirectorSkill, 'source' | 'createdAt' | 'uses'>>;
    particlePresets?: Record<string, ParticleRecipe>;
    sfxPresets?: Record<string, SfxRecipe>;
    assetLibraries?: Array<{ id: string; name: string; items: ExtensionAssetItem[] }>;
    commands?: ExtensionCommand[];
    generators?: ExtensionGenerator[];
  };
  /** Inline JS source of the sandboxed plugin (filled from main.js at install time). */
  mainSource?: string;
}

export interface ExtensionReview {
  risk: 'low' | 'medium' | 'high';
  findings: Array<{ level: 'info' | 'warn' | 'danger'; message: string }>;
  summary: string;
  /** Optional plain-language review written by the active AI provider. */
  aiSummary?: string;
  aiRisk?: 'low' | 'medium' | 'high';
}

export interface InstalledExtension {
  manifest: ExtensionManifest;
  enabled: boolean;
  installedAt: string;
  source: 'builtin-catalog' | 'url' | 'file' | 'ai-draft';
  approvedPermissions: ExtensionPermission[];
  review?: ExtensionReview;
}
