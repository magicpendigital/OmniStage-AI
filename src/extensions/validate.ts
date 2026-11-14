/**
 * Phase 6 — Extension manifest validation + static risk review (pure; shared by client, server and tests).
 * The review is what a non-programmer sees before approving an install, so findings are phrased in plain words.
 */
import type {
  ExtensionManifest,
  ExtensionPermission,
  ExtensionReview,
  ParticleRecipe,
  SfxRecipe,
} from './types';
import { GENERATION_PROVIDERS, PERMISSION_INFO } from './types';

/** owner/name model ids for fal.ai and Replicate (no traversal, no versions, no query strings). */
export const GENERATION_MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}(\/[a-z0-9][a-z0-9._-]{0,63}){1,3}$/;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const KINDS = ['skill-pack', 'vfx-pack', 'sfx-pack', 'asset-library', 'tool', 'mixed'];
const SHAPES = ['circle', 'rect', 'line', 'pixel', 'star'];
const WAVES = ['square', 'sine', 'triangle', 'sawtooth', 'noise'];
export const MAX_MAIN_SOURCE = 200 * 1024;

function isRange(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function validateParticleRecipe(r: any): r is ParticleRecipe {
  return (
    !!r &&
    typeof r.rate === 'number' && r.rate > 0 && r.rate <= 400 &&
    typeof r.life === 'number' && r.life > 0 && r.life <= 10 &&
    isRange(r.speed) && isRange(r.angle) && isRange(r.size) &&
    SHAPES.includes(r.shape) &&
    Array.isArray(r.colors) && r.colors.length > 0 && r.colors.every((c: unknown) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c))
  );
}

export function validateSfxRecipe(r: any): r is SfxRecipe {
  return (
    !!r &&
    WAVES.includes(r.wave) &&
    typeof r.dur === 'number' && r.dur > 0 && r.dur <= 4 &&
    typeof r.vol === 'number' && r.vol > 0 && r.vol <= 1 &&
    (r.notes === undefined || (Array.isArray(r.notes) && r.notes.length <= 16 && r.notes.every((n: unknown) => typeof n === 'number' && n > 20 && n < 20000)))
  );
}

/** Returns a list of problems; empty = valid. */
export function validateManifest(m: any): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== 'object') return ['Manifest must be a JSON object'];
  if (!ID_RE.test(m.id || '')) errors.push('id must be a lower-case slug (a-z, 0-9, -)');
  if (!m.name || typeof m.name !== 'string') errors.push('name is required');
  if (!/^\d+\.\d+\.\d+/.test(m.version || '')) errors.push('version must look like 1.0.0');
  if (!m.description || typeof m.description !== 'string') errors.push('description is required');
  if (!KINDS.includes(m.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  for (const p of m.permissions || []) if (!(p in PERMISSION_INFO)) errors.push(`unknown permission "${p}"`);
  if (m.permissions?.includes('network') && !(Array.isArray(m.networkHosts) && m.networkHosts.length)) {
    errors.push('network permission requires networkHosts');
  }
  for (const h of m.networkHosts || []) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) errors.push(`invalid network host "${h}"`);
  const c = m.contributes || {};
  for (const s of c.skills || []) {
    if (!ID_RE.test(s.id || '') || !s.title || !s.guidance || !Array.isArray(s.triggers)) errors.push(`skill "${s.id || '?'}" needs id, title, triggers and guidance`);
    if (String(s.guidance || '').length > 6000) errors.push(`skill "${s.id}" guidance is longer than 6000 characters`);
  }
  for (const [id, r] of Object.entries(c.particlePresets || {})) {
    if (!ID_RE.test(id)) errors.push(`particle preset id "${id}" must be a slug`);
    if (!validateParticleRecipe(r)) errors.push(`particle preset "${id}" has invalid fields`);
  }
  for (const [id, r] of Object.entries(c.sfxPresets || {})) {
    if (!ID_RE.test(id)) errors.push(`sfx preset id "${id}" must be a slug`);
    if (!validateSfxRecipe(r)) errors.push(`sfx preset "${id}" has invalid fields`);
  }
  for (const lib of c.assetLibraries || []) {
    for (const item of lib.items || []) {
      if (!/^https:\/\//.test(item.url || '')) errors.push(`asset "${item.name}" must use an https URL`);
      if (!item.license) errors.push(`asset "${item.name}" needs a license`);
    }
  }
  for (const g of c.generators || []) {
    const label = `generator "${g?.id || '?'}"`;
    if (!ID_RE.test(g?.id || '') || !g.title) errors.push(`${label} needs an id (slug) and a title`);
    const info = GENERATION_PROVIDERS[g?.provider as keyof typeof GENERATION_PROVIDERS];
    if (!info) errors.push(`${label} has unknown provider "${g?.provider}" (use ${Object.keys(GENERATION_PROVIDERS).join(', ')})`);
    else if (g.output !== info.output) errors.push(`${label}: ${info.label} generates ${info.output}s`);
    if (g?.model !== undefined && (typeof g.model !== 'string' || !GENERATION_MODEL_RE.test(g.model) || g.model.includes('..'))) errors.push(`${label} has an invalid model id`);
  }
  if (c.generators?.length && !(m.permissions || []).includes('generate')) errors.push('generators need the "generate" permission');
  if (c.commands?.length && !m.mainSource) errors.push('commands need a main script');
  if (m.mainSource && typeof m.mainSource !== 'string') errors.push('mainSource must be a string');
  if (typeof m.mainSource === 'string' && m.mainSource.length > MAX_MAIN_SOURCE) errors.push('main script is larger than 200 KB');
  return errors;
}

const CODE_PATTERNS: Array<{ re: RegExp; level: 'warn' | 'danger'; message: string }> = [
  { re: /\beval\s*\(|new\s+Function\s*\(/, level: 'danger', message: 'Builds and runs code from text at runtime (eval / new Function).' },
  { re: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\b/, level: 'warn', message: 'Tries to use the network directly (blocked by the sandbox; only omni.fetch to declared hosts works).' },
  { re: /\b(window\.)?(parent|top|opener)\b\s*\./, level: 'warn', message: 'Tries to reach the studio window directly (blocked by the sandbox).' },
  { re: /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, level: 'warn', message: 'Tries to read browser storage (not available in the sandbox).' },
  { re: /\bimport\s*\(/, level: 'warn', message: 'Loads extra code dynamically (blocked by the sandbox).' },
  { re: /(atob|fromCharCode)\s*\([^)]{200,}/, level: 'danger', message: 'Contains a long encoded payload (possible obfuscated code).' },
];

/** Deterministic review shown in the approval dialog. */
export function reviewExtension(m: ExtensionManifest): ExtensionReview {
  const findings: ExtensionReview['findings'] = [];
  const perms = (m.permissions || []) as ExtensionPermission[];
  for (const p of perms) {
    const info = PERMISSION_INFO[p];
    findings.push({ level: info.risk === 'high' ? 'danger' : info.risk === 'medium' ? 'warn' : 'info', message: `Permission: ${info.label}${p === 'network' ? ` (${(m.networkHosts || []).join(', ')})` : ''}` });
  }
  const c = m.contributes || {};
  if (c.skills?.length) findings.push({ level: 'info', message: `Adds ${c.skills.length} director skill(s): ${c.skills.map((s) => s.title).join(', ')}` });
  if (c.particlePresets) findings.push({ level: 'info', message: `Adds particle presets: ${Object.keys(c.particlePresets).join(', ')}` });
  if (c.sfxPresets) findings.push({ level: 'info', message: `Adds sound presets: ${Object.keys(c.sfxPresets).join(', ')}` });
  if (c.assetLibraries?.length) {
    const hosts = new Set(c.assetLibraries.flatMap((l) => l.items.map((i) => { try { return new URL(i.url).host; } catch { return '?'; } })));
    findings.push({ level: 'warn', message: `Adds asset libraries loading files from: ${[...hosts].join(', ')}` });
  }
  if (c.generators?.length) {
    const names = [...new Set(c.generators.map((g) => GENERATION_PROVIDERS[g.provider]?.label || g.provider))];
    findings.push({ level: 'warn', message: `Sends your prompts to ${names.join(', ')} with your own API key (each generation uses your credits there).` });
  }
  if (m.mainSource) {
    findings.push({ level: 'warn', message: `Runs a script (${(m.mainSource.length / 1024).toFixed(1)} KB) in an isolated sandbox.` });
    for (const p of CODE_PATTERNS) if (p.re.test(m.mainSource)) findings.push({ level: p.level, message: p.message });
  }
  const danger = findings.some((f) => f.level === 'danger');
  const warn = findings.some((f) => f.level === 'warn');
  const risk: ExtensionReview['risk'] = danger ? 'high' : warn ? 'medium' : 'low';
  const summary =
    risk === 'low'
      ? 'Data-only extension (skills / presets). It cannot run code or reach the network.'
      : risk === 'medium'
        ? 'Can change your scene or load external files. Review the permissions below.'
        : 'Asks for powerful access or contains risky code. Install only if you trust the author.';
  return { risk, findings, summary };
}
