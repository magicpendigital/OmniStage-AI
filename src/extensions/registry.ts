/**
 * Phase 6 — Client-side view of installed extensions: what is enabled, what it contributes, and which catalog
 * extensions the AI should *propose* for a prompt (the user still approves every install).
 */
import type { DirectorSkill, SceneSpec } from '../types/scene.schema';
import type { ExtensionAssetItem, ExtensionManifest, InstalledExtension, ParticleRecipe, SfxRecipe } from './types';
import { PARTICLE_2D_PRESETS } from '../vfx/particles2D';
import { SFX_PRESET_IDS } from '../audio/audioBus';

export interface EnabledContributions {
  skills: DirectorSkill[];
  particlePresets: Record<string, ParticleRecipe>;
  sfxPresets: Record<string, SfxRecipe>;
  assetLibraries: Array<{ extensionId: string; id: string; name: string; items: ExtensionAssetItem[] }>;
  commands: Array<{ extensionId: string; extensionName: string; id: string; title: string; description: string }>;
}

export function enabledContributions(installed: InstalledExtension[], projectExtensions?: string[]): EnabledContributions {
  const out: EnabledContributions = { skills: [], particlePresets: {}, sfxPresets: {}, assetLibraries: [], commands: [] };
  for (const ext of Array.isArray(installed) ? installed : []) {
    if (!ext.enabled && !projectExtensions?.includes(ext.manifest.id)) continue;
    const c = ext.manifest.contributes || {};
    for (const s of c.skills || []) {
      out.skills.push({ ...s, id: `ext-${ext.manifest.id}-${s.id}`, title: s.title, source: 'learned', uses: 0 } as DirectorSkill);
    }
    for (const [id, r] of Object.entries(c.particlePresets || {})) if (!PARTICLE_2D_PRESETS.includes(id)) out.particlePresets[id] = r;
    for (const [id, r] of Object.entries(c.sfxPresets || {})) if (!(SFX_PRESET_IDS as string[]).includes(id)) out.sfxPresets[id] = r;
    for (const lib of c.assetLibraries || []) out.assetLibraries.push({ extensionId: ext.manifest.id, ...lib });
    for (const cmd of c.commands || []) out.commands.push({ extensionId: ext.manifest.id, extensionName: ext.manifest.name, ...cmd });
  }
  // Extension skills rank like learned skills but are marked so the UI can label them.
  out.skills = out.skills.map((s) => ({ ...s, source: 'learned' as const }));
  return out;
}

/** Prompt text telling the AI which extension presets it may use (recipes are attached after generation). */
export function buildExtensionPresetContext(c: EnabledContributions): string {
  const particles = Object.keys(c.particlePresets);
  const sfx = Object.keys(c.sfxPresets);
  if (!particles.length && !sfx.length) return '';
  return [
    'INSTALLED EXTENSION PRESETS (usable like built-ins):',
    particles.length ? `- extra particle-emitter presets: ${particles.map((p) => `'${p}'`).join(', ')}` : '',
    sfx.length ? `- extra audio cue presets: ${sfx.map((p) => `'${p}'`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Copies recipes of every extension preset the scene uses into particleLibrary / sfxLibrary (portable scene). */
export function attachExtensionRecipes(spec: SceneSpec, c: Pick<EnabledContributions, 'particlePresets' | 'sfxPresets'>): string[] {
  const attached: string[] = [];
  for (const n of spec.nodes2D || []) {
    const id = n.type === 'particle-emitter' ? n.emitter?.preset : undefined;
    if (id && c.particlePresets[id] && !spec.particleLibrary?.[id]) {
      spec.particleLibrary = { ...(spec.particleLibrary || {}), [id]: c.particlePresets[id] };
      attached.push(id);
    }
  }
  for (const cue of Object.values(spec.audio?.cues || {})) {
    if (cue && c.sfxPresets[cue] && !spec.sfxLibrary?.[cue]) {
      spec.sfxLibrary = { ...(spec.sfxLibrary || {}), [cue]: c.sfxPresets[cue] };
      attached.push(cue);
    }
  }
  return attached;
}

export interface ExtensionRecommendation {
  manifest: ExtensionManifest;
  reason: string;
  score: number;
}

/**
 * Deterministic recommendation of catalog extensions for a prompt / project (no model call). The AI director
 * surfaces these as "Suggested extension" cards; installing still needs the user's approval.
 */
export function recommendExtensions(
  prompt: string,
  ctx: { engineType: string; mode: string; projectTags?: string[] },
  catalog: ExtensionManifest[],
  installedIds: string[],
  max = 2
): ExtensionRecommendation[] {
  const text = ` ${prompt.toLowerCase()} ${(ctx.projectTags || []).join(' ')} `;
  return catalog
    .filter((m) => !installedIds.includes(m.id))
    .map((m) => {
      const words = [...(m.tags || []), ...(m.targets?.genres || []), ...(m.contributes?.skills || []).flatMap((s) => s.triggers)];
      const hits = [...new Set(words.map((w) => w.toLowerCase()))].filter((w) => w.length >= 3 && new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(text));
      let score = hits.length * 10;
      if (m.targets?.engines && !m.targets.engines.includes(ctx.engineType as any)) score -= 8;
      if (m.targets?.modes && !m.targets.modes.includes(ctx.mode as any)) score -= 4;
      return { manifest: m, score, reason: hits.length ? `Matches "${hits.slice(0, 3).join('", "')}"` : '' };
    })
    .filter((r) => r.score >= 10)
    .sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id))
    .slice(0, max);
}
