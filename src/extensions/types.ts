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
  | 'ui:notify';

export const PERMISSION_INFO: Record<ExtensionPermission, { label: string; risk: 'low' | 'medium' | 'high' }> = {
  'scene:read': { label: 'Read the open scene (SceneSpec JSON)', risk: 'low' },
  'scene:write': { label: 'Change the open scene (verified, undoable)', risk: 'medium' },
  'library:read': { label: 'List assets in your personal library', risk: 'medium' },
  network: { label: 'Fetch from the declared hosts via OmniStage', risk: 'high' },
  'ui:notify': { label: 'Show notifications in the studio', risk: 'low' },
};

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
