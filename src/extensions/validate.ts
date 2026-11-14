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
import { GENERATION_PROVIDERS, PERMISSION_INFO, SPRITE_SHEET_FRAMES } from './types';

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

// ------------------------------------------------------------------ recipe sanitizer (manifests + AI-authored recipes)
/** Recipe ids an AI / extension may add to a scene's particleLibrary / sfxLibrary. */
export const RECIPE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** Most custom recipes one scene may carry per library. */
export const MAX_SCENE_RECIPES = 24;

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
const range = (v: unknown, lo: number, hi: number): [number, number] | undefined => {
  if (!isRange(v)) return undefined;
  const a = Math.max(lo, Math.min(hi, v[0]));
  const b = Math.max(lo, Math.min(hi, v[1]));
  return a <= b ? [a, b] : [b, a];
};
function put<T extends object>(out: T, key: keyof T, value: unknown) {
  if (value !== undefined) (out as any)[key] = value;
}

/**
 * Clean copy of a particle recipe: only known fields, numbers clamped into the ranges the runtime handles, no extra
 * keys (so nothing executable rides along). Null when the required fields are missing or unusable.
 */
export function sanitizeParticleRecipe(r: any): ParticleRecipe | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const rate = num(r.rate, 0.1, 400);
  const life = num(r.life, 0.05, 10);
  const speed = range(r.speed, 0, 2000);
  const angle = range(r.angle, -720, 720);
  const size = range(r.size, 0.5, 200);
  const colors = Array.isArray(r.colors) ? r.colors.filter((c: unknown) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 8) : [];
  if (rate === undefined || life === undefined || !speed || !angle || !size || !SHAPES.includes(r.shape) || !colors.length) return null;
  const out: ParticleRecipe = { rate, life, speed, angle, size, shape: r.shape, colors };
  put(out, 'gravity', num(r.gravity, -3000, 3000));
  put(out, 'alpha', num(r.alpha, 0, 1));
  put(out, 'spread', num(r.spread, 0, 1000));
  put(out, 'drift', num(r.drift, -1000, 1000));
  put(out, 'orbit', num(r.orbit, -50, 50));
  put(out, 'spin', num(r.spin, -50, 50));
  put(out, 'burst', num(r.burst, 0, 400));
  for (const flag of ['fade', 'shrink', 'grow', 'additive', 'area'] as const) if (typeof r[flag] === 'boolean') out[flag] = r[flag];
  return out;
}

/** Clean copy of an SFX synth recipe (same rules as `sanitizeParticleRecipe`). */
export function sanitizeSfxRecipe(r: any): SfxRecipe | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const dur = num(r.dur, 0.01, 4);
  const vol = num(r.vol, 0.01, 1);
  if (!WAVES.includes(r.wave) || dur === undefined || vol === undefined) return null;
  const out: SfxRecipe = { wave: r.wave, dur, vol };
  put(out, 'f0', num(r.f0, 21, 19999));
  put(out, 'f1', num(r.f1, 21, 19999));
  if (Array.isArray(r.notes)) {
    const notes = r.notes.filter((n: unknown) => typeof n === 'number' && n > 20 && n < 20000).slice(0, 16);
    if (notes.length) out.notes = notes;
  }
  put(out, 'step', num(r.step, 0.01, 1));
  put(out, 'lp0', num(r.lp0, 50, 20000));
  put(out, 'lp1', num(r.lp1, 50, 20000));
  put(out, 'attack', num(r.attack, 0, 4));
  return out;
}

/** Order-independent comparison of a recipe with its sanitized copy (true = nothing was dropped or clamped). */
export function sameRecipe(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])) : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
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
    if (g?.input !== undefined && g.input !== 'text' && g.input !== 'image') errors.push(`${label}: input must be "text" or "image"`);
    if (g?.input === 'image' && info && !info.imageInput) errors.push(`${label}: ${info.label} cannot start from a picture`);
    if (g?.frames !== undefined) {
      const okFrames = Number.isInteger(g.frames) && g.frames >= SPRITE_SHEET_FRAMES.min && g.frames <= SPRITE_SHEET_FRAMES.max;
      if (!okFrames) errors.push(`${label}: frames must be a whole number from ${SPRITE_SHEET_FRAMES.min} to ${SPRITE_SHEET_FRAMES.max}`);
      if (info && info.output !== 'image') errors.push(`${label}: sprite-sheet frames only apply to image generators`);
    }
    if (g?.audio !== undefined) {
      if (g.audio !== 'sfx' && g.audio !== 'music') errors.push(`${label}: audio must be "sfx" or "music"`);
      if (info && info.output !== 'audio') errors.push(`${label}: audio only applies to audio generators`);
    }
    if (g?.durationSeconds !== undefined && !(typeof g.durationSeconds === 'number' && g.durationSeconds >= 0.5 && g.durationSeconds <= 300)) {
      errors.push(`${label}: durationSeconds must be between 0.5 and 300`);
    }
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
