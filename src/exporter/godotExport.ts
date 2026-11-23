/**
 * Exporter plugin: SceneSpec → Godot 4.x project (zip).
 *
 * Pure builder (no DOM, no network): the caller fetches remote assets and passes their bytes in `options.assets`.
 * Every scene becomes a text scene (.tscn). Its values (score target, timer, instructions, translated logic rules,
 * actor metadata) are written as escaped properties, so the three GDScript files in `godotTemplates.ts` stay fixed and
 * never contain user text. Features with no clean Godot equivalent are listed in OMNISTAGE_EXPORT_NOTES.md inside the
 * zip and returned as warnings, so nothing is dropped silently.
 *
 * Coordinates: Three.js and Godot are both Y-up, right-handed, with the camera looking down -Z, so positions copy 1:1.
 * Rotations are written as basis matrices built from the Three.js Euler order (XYZ), which avoids Godot's YXZ Euler.
 * 2D uses the OmniStage 1000 x 600 stage (y down, node x / y are centres), the same as Godot 2D.
 */
import type {
  ActorNode,
  ActorStateMachine,
  LogicNode,
  Node2D,
  SceneSpec,
  ShaderEffect,
  Vector3Tuple,
} from '../types/scene.schema';
import { ASSET_REGISTRY } from '../registry/assetRegistry';
import { resolveWorld } from '../runtime/physics/camera2d';
import { buildZip, crc32, type ZipInput } from './playableBundle';
import { slugifyTitle } from './mediaExporter';
import { collectAssetUrls } from './playerHtml';
import { GODOT_GAME_SCRIPT, GODOT_ICON_SVG, GODOT_PLAYER_2D_SCRIPT, GODOT_PLAYER_3D_SCRIPT } from './godotTemplates';

export interface GodotAssetFile {
  bytes: Uint8Array;
  contentType?: string | null;
}

export interface GodotExportOptions {
  projectName?: string;
  /** Scene opened by "Run project" (default: the first scene). */
  mainSceneId?: string;
  /** Remote asset URL → downloaded bytes (data: URLs are decoded here). */
  assets?: Record<string, GodotAssetFile>;
  /** Downloads that failed before the build (reported in the notes). */
  failedAssets?: Array<{ url: string; reason: string }>;
}

export interface GodotExportWarning {
  /** Scene title, or 'Project' for project-wide notes. */
  scene: string;
  feature: string;
  detail: string;
}

export interface GodotSceneSummary {
  id: string;
  title: string;
  path: string;
  engineType: '2d' | '3d';
  mode: string;
}

export interface GodotProjectBuild {
  files: ZipInput[];
  warnings: GodotExportWarning[];
  mainScene: string;
  scenes: GodotSceneSummary[];
}

export const GODOT_NOTES_FILE = 'OMNISTAGE_EXPORT_NOTES.md';
const STAGE_2D = { width: 1000, height: 600 };
const ANIMATED_CAMERA_MODES = new Set(['orbit-360', 'dolly-zoom-in', 'crane-reveal', 'cinematic-flythrough']);
const FOLLOW_CAMERA_MODES = new Set(['follow-target', 'first-person-follow', 'isometric-game']);
const EVENT_ALIASES: Record<string, string> = {
  'on-scene-start': 'scene-start', 'on-click-actor': 'actor-click', 'on-actor-click': 'actor-click',
  'on-collision': 'collision', 'on-key-press': 'key-press', 'on-timeline-keyframe': 'timeline-cue',
  'timeline-keyframe': 'timeline-cue', 'on-timeline-cue': 'timeline-cue',
};
const RUNTIME_EVENTS = new Set(['scene-start', 'actor-click', 'collision', 'key-press', 'timeline-cue']);

// ============================================================================
// Godot text-resource values (all user strings go through gdString)
// ============================================================================

/** A value written verbatim (only for numbers / constructors this module builds, never user text). */
export class GdRaw {
  constructor(readonly text: string) {}
}
const raw = (text: string) => new GdRaw(text);

export type GdValue = string | number | boolean | null | GdRaw | GdValue[] | { [key: string]: GdValue };

/** Quotes a string for a Godot .tscn / project.godot file (\\, \", control characters escaped). */
export function gdString(value: string): string {
  let out = '"';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + '"';
}

/** Finite number in plain decimal notation (no exponent, no -0). */
export function gdNumber(value: number, fallback = 0): string {
  const n = Number.isFinite(value) ? value : fallback;
  const fixed = Number(n.toFixed(6));
  return Object.is(fixed, -0) ? '0' : String(fixed);
}

export function gdValue(value: GdValue): string {
  if (value instanceof GdRaw) return value.text;
  if (value === null) return 'null';
  if (typeof value === 'string') return gdString(value);
  if (typeof value === 'number') return gdNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(gdValue).join(', ')}]`;
  const entries = Object.entries(value).map(([k, v]) => `${gdString(k)}: ${gdValue(v)}`);
  return entries.length ? `{\n${entries.join(',\n')}\n}` : '{}';
}

/** Node names may not contain . : @ / " % or control characters. */
export function godotNodeName(value: string, fallback = 'Node'): string {
  const cleaned = String(value || '')
    .replace(/[.:@/"%\\[\]\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

const vec2 = (x: number, y: number) => raw(`Vector2(${gdNumber(x)}, ${gdNumber(y)})`);
const vec3 = (v: readonly number[]) => raw(`Vector3(${gdNumber(v[0])}, ${gdNumber(v[1])}, ${gdNumber(v[2])})`);

/** '#rgb' / '#rrggbb' / '#rrggbbaa' → Color(...) (sRGB, as both engines store authored colours). */
export function gdColor(hex: string | undefined, fallback = '#ffffff', alpha?: number): GdRaw {
  const parse = (h: string) => {
    const m = /^#?([0-9a-f]{3,8})$/i.exec((h || '').trim());
    if (!m) return null;
    let s = m[1];
    if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
    if (s.length !== 6 && s.length !== 8) return null;
    const n = (i: number) => parseInt(s.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), s.length === 8 ? n(6) : 1];
  };
  const c = parse(hex || '') || parse(fallback) || [1, 1, 1, 1];
  const a = alpha ?? c[3];
  return raw(`Color(${gdNumber(c[0])}, ${gdNumber(c[1])}, ${gdNumber(c[2])}, ${gdNumber(Math.max(0, Math.min(1, a)))})`);
}

// ============================================================================
// Transforms
// ============================================================================

type Rows = [[number, number, number], [number, number, number], [number, number, number]];

/** Basis rows of a Three.js Euler (order 'XYZ': R = Rx · Ry · Rz). */
export function threeEulerToBasisRows(rotation: readonly number[]): Rows {
  const [x, y, z] = [rotation[0] || 0, rotation[1] || 0, rotation[2] || 0];
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [
    [c * e, -c * f, d],
    [a * f + b * e * d, a * e - b * f * d, -b * c],
    [b * f - a * e * d, b * e + a * f * d, a * c],
  ];
}

/** Rows of a basis whose -Z looks from `eye` towards `target` (Godot cameras and lights face -Z). */
export function lookAtBasisRows(eye: readonly number[], target: readonly number[]): Rows {
  const sub = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  const len = Math.hypot(sub[0], sub[1], sub[2]);
  if (len < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const z = sub.map((v) => v / len);
  const cross = (p: number[], q: number[]) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  let up = [0, 1, 0];
  if (Math.abs(z[1]) > 0.9999) up = [0, 0, -1];
  let x = cross(up, z);
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = x.map((v) => v / xl);
  const y = cross(z, x);
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
}

/** `Transform3D(...)`: the 12 numbers are the three basis rows, then the origin (Godot's text format). */
export function transform3D(rows: Rows, origin: readonly number[], scale: readonly number[] = [1, 1, 1]): GdRaw {
  const values: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) values.push(rows[i][j] * (scale[j] ?? 1));
  values.push(origin[0] || 0, origin[1] || 0, origin[2] || 0);
  return raw(`Transform3D(${values.map((v) => gdNumber(v)).join(', ')})`);
}

const IDENTITY: Rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// ============================================================================
// .tscn writer
// ============================================================================

type Props = Array<[string, GdValue]>;

class TscnBuilder {
  private ext: Array<{ type: string; path: string; id: string }> = [];
  private subs: Array<{ type: string; id: string; props: Props }> = [];
  private nodes: string[] = [];
  private names = new Map<string, Set<string>>();

  extResource(type: string, path: string): GdRaw {
    let entry = this.ext.find((e) => e.path === path);
    if (!entry) {
      entry = { type, path, id: `${this.ext.length + 1}_${type.toLowerCase().replace(/[^a-z0-9]/g, '')}` };
      this.ext.push(entry);
    }
    return raw(`ExtResource(${gdString(entry.id)})`);
  }

  subResource(type: string, props: Props): GdRaw {
    const id = `${type}_${this.subs.length + 1}`;
    this.subs.push({ type, id, props });
    return raw(`SubResource(${gdString(id)})`);
  }

  /** Unique child name under `parent` ('' = the root itself). */
  uniqueName(parent: string, wanted: string): string {
    const used = this.names.get(parent) || new Set<string>();
    this.names.set(parent, used);
    let name = wanted;
    for (let i = 2; used.has(name); i++) name = `${wanted}_${i}`;
    used.add(name);
    return name;
  }

  node(name: string, type: string | null, parent: string | null, props: Props = [], extra: { groups?: string[]; instance?: GdRaw } = {}): string {
    const attrs = [`name=${gdString(name)}`];
    if (type) attrs.push(`type=${gdString(type)}`);
    if (parent !== null) attrs.push(`parent=${gdString(parent)}`);
    if (extra.instance) attrs.push(`instance=${extra.instance.text}`);
    if (extra.groups?.length) attrs.push(`groups=${gdValue(extra.groups)}`);
    const lines = [`[node ${attrs.join(' ')}]`];
    for (const [key, value] of props) lines.push(`${key} = ${gdValue(value)}`);
    this.nodes.push(lines.join('\n'));
    return parent === null ? '.' : parent === '.' ? name : `${parent}/${name}`;
  }

  toString(): string {
    const out = [`[gd_scene load_steps=${this.ext.length + this.subs.length + 1} format=3]`];
    for (const e of this.ext) out.push(`[ext_resource type=${gdString(e.type)} path=${gdString(e.path)} id=${gdString(e.id)}]`);
    for (const s of this.subs) {
      const lines = [`[sub_resource type=${gdString(s.type)} id=${gdString(s.id)}]`];
      for (const [key, value] of s.props) lines.push(`${key} = ${gdValue(value)}`);
      out.push(lines.join('\n'));
    }
    out.push(...this.nodes);
    return out.join('\n\n') + '\n';
  }
}

// ============================================================================
// Assets (GLB models, textures, HDRI) — bytes only, sniffed by magic numbers
// ============================================================================

type AssetKind = 'glb' | 'gltf' | 'png' | 'jpg' | 'webp' | 'svg' | 'gif' | 'hdr' | 'exr' | 'unknown';

function decodeDataUrl(url: string): Uint8Array | null {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    if (m[2]) {
      const bin = atob(m[3].replace(/\s+/g, ''));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(m[3]));
  } catch {
    return null;
  }
}

function sniffAsset(bytes: Uint8Array): AssetKind {
  const ascii = (start: number, len: number) => String.fromCharCode(...bytes.subarray(start, start + len));
  if (bytes.length >= 4 && ascii(0, 4) === 'glTF') return 'glb';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && ascii(0, 3) === 'GIF') return 'gif';
  if (bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) return 'exr';
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith('#?RADIANCE') || head.startsWith('#?RGBE')) return 'hdr';
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head) || /<svg[\s>]/i.test(head)) return 'svg';
  if (head.startsWith('{') && head.includes('"asset"')) return 'gltf';
  return 'unknown';
}

/** Pixel size of PNG / JPEG / WebP / SVG images (null when unknown). */
export function imageSize(bytes: Uint8Array, kind: AssetKind): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u32be = (i: number) => ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  try {
    if (kind === 'png' && bytes.length >= 24) return { width: u32be(16), height: u32be(20) };
    if (kind === 'jpg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: u16be(i + 7), height: u16be(i + 5) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        i += 2 + u16be(i + 2);
      }
      return null;
    }
    if (kind === 'webp' && bytes.length >= 30) {
      const chunk = String.fromCharCode(...bytes.subarray(12, 16));
      if (chunk === 'VP8 ') return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = bytes.subarray(21, 25);
        return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
      }
      if (chunk === 'VP8X') return { width: 1 + u24le(24), height: 1 + u24le(27) };
      return null;
    }
    if (kind === 'svg') {
      const head = new TextDecoder().decode(bytes.subarray(0, 4096));
      const tag = /<svg\b[^>]*>/i.exec(head)?.[0] || '';
      const attr = (name: string) => Number(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?["']`, 'i').exec(tag)?.[1]);
      const w = attr('width'), h = attr('height');
      if (w > 0 && h > 0) return { width: w, height: h };
      const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag);
      if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return { width: Number(vb[1]), height: Number(vb[2]) };
    }
  } catch {
    return null;
  }
  return null;
}

interface ResolvedAsset {
  path: string;
  kind: AssetKind;
  size: { width: number; height: number } | null;
}

class AssetStore {
  readonly files = new Map<string, Uint8Array>();
  private resolved = new Map<string, ResolvedAsset | { error: string }>();

  constructor(private assets: Record<string, GodotAssetFile>, private failed: Map<string, string>) {}

  /** Copies the asset into the project once; returns its res:// path or an error explaining why it was not embedded. */
  resolve(url: string, want: 'model' | 'image' | 'hdri'): ResolvedAsset | { error: string } {
    const key = `${want}\u0000${url}`;
    const cached = this.resolved.get(key);
    if (cached) return cached;
    const result = this.load(url, want);
    this.resolved.set(key, result);
    return result;
  }

  private load(url: string, want: 'model' | 'image' | 'hdri'): ResolvedAsset | { error: string } {
    const bytes = url.startsWith('data:') ? decodeDataUrl(url) : this.assets[url]?.bytes;
    if (!bytes || !bytes.length) {
      const reason = this.failed.get(url);
      return { error: reason ? `download failed (${reason})` : 'file was not downloaded' };
    }
    const kind = sniffAsset(bytes);
    const allowed: Record<typeof want, AssetKind[]> = {
      model: ['glb'],
      image: ['png', 'jpg', 'webp', 'svg'],
      hdri: ['hdr', 'exr', 'png', 'jpg', 'webp'],
    };
    if (!allowed[want].includes(kind)) {
      const why = kind === 'gltf' ? '.gltf with external buffers cannot be embedded (use .glb)'
        : kind === 'gif' ? 'GIF images are not supported by Godot'
        : `unsupported file type (${kind})`;
      return { error: why };
    }
    const base = slugifyTitle(decodeURIComponent((url.startsWith('data:') ? '' : url.split(/[?#]/)[0].split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '')), want);
    const dir = want === 'model' ? 'models' : 'textures';
    const path = `${dir}/${base.slice(0, 40)}-${crc32(bytes).toString(16).padStart(8, '0')}.${kind}`;
    this.files.set(path, bytes);
    return { path: `res://${path}`, kind, size: imageSize(bytes, kind) };
  }
}

// ============================================================================
// Warnings
// ============================================================================

class WarningLog {
  readonly list: GodotExportWarning[] = [];
  private seen = new Set<string>();

  add(scene: string, feature: string, detail: string) {
    const key = `${scene}\u0000${feature}\u0000${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ scene, feature, detail });
  }
}

// ============================================================================
// Logic graph → rule dictionaries read by omni_game.gd
// ============================================================================

function normalizeKey(value: unknown): string {
  const key = String(value ?? '').toLowerCase().trim();
  if (/^key[a-z]$/.test(key)) return key.slice(3);
  if (/^digit[0-9]$/.test(key)) return key.slice(5);
  if (key === 'spacebar') return 'space';
  return key;
}

const finite = (value: unknown) => (value === undefined || value === null || value === '' ? NaN : Number(value));

/**
 * Translates trigger → condition → action chains, following the runtime's breadth-first walk over flow wires
 * (cycle check per path, 512-node budget). Untranslatable nodes are reported and, where the runtime would raise
 * an error, stop their branch exactly like the runtime does.
 */
export function compileLogicRules(scene: SceneSpec, warn: (feature: string, detail: string) => void): Array<Record<string, GdValue>> {
  const graph = scene.logicGraph;
  if (!graph?.nodes?.length) return [];
  const is2d = scene.engineType === '2d';
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges || []) {
    const source = nodes.get(edge.sourceNodeId)?.outputs.find((p) => p.id === edge.sourcePortId);
    const target = nodes.get(edge.targetNodeId)?.inputs.find((p) => p.id === edge.targetPortId);
    if (source?.dataType !== 'flow' || target?.dataType !== 'flow') continue;
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) || []), edge]);
  }
  const entityIds = new Set((is2d ? scene.nodes2D : scene.actors).map((e) => e.id));
  const label = (n: LogicNode) => `"${n.title || n.id}" (${n.id})`;
  const rules: Array<Record<string, GdValue>> = [];

  for (const root of graph.nodes) {
    if (root.type !== 'trigger') continue;
    const p = root.params || {};
    const event = EVENT_ALIASES[p.eventType] || p.eventType;
    if (!RUNTIME_EVENTS.has(event)) {
      warn('Logic graph', `Trigger ${label(root)} uses event "${String(p.eventType)}", which has no Godot equivalent; its chain was not exported.`);
      continue;
    }
    let time = -1;
    if (event === 'timeline-cue') {
      const keyframe = p.keyframeId ? scene.camera?.keyframes?.find((k) => k.id === p.keyframeId) : undefined;
      time = finite(p.cueTimeSeconds ?? p.time ?? keyframe?.time);
      if (!Number.isFinite(time) || time < 0) {
        warn('Logic graph', `Timeline trigger ${label(root)} has no valid cue time; its chain was not exported.`);
        continue;
      }
    }
    if (event === 'collision') {
      warn('Logic graph', `Collision trigger ${label(root)}: in Godot, contacts are reported between the player and collectibles / hazards (Area nodes) only.`);
    }
    const steps: Array<Record<string, GdValue>> = [];
    type Item = { node: LogicNode; path: Set<string>; needs: Array<[number, boolean]>; actor: string };
    const queue: Item[] = [{ node: root, path: new Set(), needs: [], actor: '' }];
    let budget = 512;
    while (queue.length) {
      const item = queue.shift()!;
      const { node } = item;
      if (--budget < 0) {
        warn('Logic graph', `Trigger ${label(root)} exceeds the 512-node execution budget; the rest of its chain was not exported.`);
        break;
      }
      if (item.path.has(node.id)) {
        warn('Logic graph', `Node ${label(node)} is part of a cycle; the loop is cut like in the OmniStage runtime.`);
        continue;
      }
      const np = node.params || {};
      const withNeeds = (step: Record<string, GdValue>) => {
        if (item.needs.length) step.needs = item.needs.map(([i, v]) => [i, v]);
        steps.push(step);
        return steps.length - 1;
      };
      let conditionIndex = -1;
      let stop = false;
      if (node.type === 'condition') {
        const kind = np.conditionType;
        if (kind === 'score-threshold') {
          const value = finite(np.targetScore ?? scene.gameRules?.targetScore);
          if (Number.isFinite(value)) conditionIndex = withNeeds({ type: 'score-gate', value });
        } else if (kind === 'cooldown') {
          const ms = finite(np.cooldownMs ?? 500);
          if (Number.isFinite(ms) && ms >= 0) conditionIndex = withNeeds({ type: 'cooldown', key: node.id, ms });
        } else if (kind === 'distance-check') {
          const distance = finite(np.distanceMeters ?? np.distance ?? 2);
          if (Number.isFinite(distance) && distance >= 0) {
            conditionIndex = withNeeds({ type: 'distance', actor: String(np.actorId || item.actor || ''),
              other: String(np.targetActorId || np.otherActorId || ''), distance });
          }
        }
        if (conditionIndex < 0) {
          warn('Logic graph', `Condition ${label(node)} ("${String(kind)}") cannot be translated; the branch after it was not exported.`);
          stop = true;
        }
      } else if (node.type !== 'trigger') {
        stop = compileAction(scene, node, item.actor, entityIds, withNeeds, (detail) => warn('Logic graph', `${label(node)}: ${detail}`));
      }
      if (stop) continue;
      const nextPath = new Set(item.path).add(node.id);
      for (const edge of outgoing.get(node.id) || []) {
        const target = nodes.get(edge.targetNodeId);
        if (!target || target.type === 'trigger') continue;
        const actorWire = (graph.edges || []).some((e) => e.sourceNodeId === node.id && e.targetNodeId === target.id &&
          node.outputs.some((o) => o.id === e.sourcePortId && o.dataType === 'actor') &&
          target.inputs.some((i) => i.id === e.targetPortId && i.dataType === 'actor'));
        const needs: Array<[number, boolean]> = conditionIndex >= 0
          ? [[conditionIndex, !edge.sourcePortId.toLowerCase().includes('false')]]
          : item.needs;
        queue.push({ node: target, path: nextPath, needs,
          actor: actorWire && node.type !== 'trigger' ? String(np.actorId || item.actor || '') : item.actor });
      }
    }
    rules.push({
      event,
      actor: String(p.actorId || ''),
      other: String(p.otherActorId || ''),
      target_role: String(p.targetRole || ''),
      key: event === 'key-press' ? normalizeKey(p.key ?? p.keyCombo ?? p.inputKey) : '',
      time,
      steps,
    });
  }
  return rules;
}

/** Returns true when the branch must stop (the runtime would raise an error here). */
function compileAction(
  scene: SceneSpec,
  node: LogicNode,
  inheritedActor: string,
  entityIds: Set<string>,
  push: (step: Record<string, GdValue>) => number,
  warn: (detail: string) => void,
): boolean {
  const p = node.params || {};
  const is2d = scene.engineType === '2d';
  if (node.type === 'robot-hardware') {
    warn('robot / hardware nodes need a connected hardware runtime and were not exported; the branch after it stops.');
    return true;
  }
  if (p.actionType === 'send-signal') {
    // Runtime: queues a signal for the behaviour state machines, then the chain continues.
    warn('"send-signal" only drives behaviour state machines, which are not exported; the signal is skipped and the chain continues.');
    return false;
  }
  if (p.actorId && !entityIds.has(p.actorId)) {
    warn(`references missing actor "${String(p.actorId)}"; the branch after it stops (same as the runtime).`);
    return true;
  }
  const actor = String(p.actorId || inheritedActor || '');
  const steps: Array<Record<string, GdValue>> = [];
  let changed = false;

  if (p.activeClip !== undefined || p.animation !== undefined) {
    if (is2d) {
      warn('skeletal / procedural animation is 3D-only (the runtime rejects it in 2D); the branch after it stops.');
      return true;
    }
    if (p.activeClip !== undefined) {
      const target = scene.actors.find((a) => a.id === actor);
      if (target && !target.availableClips?.includes(p.activeClip)) {
        warn(`clip "${String(p.activeClip)}" is not in the actor's clip list (the runtime rejects it); the branch after it stops.`);
        return true;
      }
      steps.push({ type: 'clip', actor, clip: String(p.activeClip) });
    }
    if (p.animation !== undefined) warn(`procedural animation "${String(p.animation)}" has no Godot equivalent and was skipped.`);
    changed = true;
  }

  const hasMove = p.position !== undefined || p.targetPosition !== undefined || p.x !== undefined || p.y !== undefined ||
    p.z !== undefined || p.impulseY !== undefined;
  if (hasMove) {
    const step: Record<string, GdValue> = { type: 'move', actor };
    const target = p.targetPosition ?? p.position;
    let valid = true;
    if (target !== undefined) {
      const v = Array.isArray(target) ? target.map(Number) : [];
      if (v.length < 2 || v.slice(0, is2d ? 2 : 3).some((n) => !Number.isFinite(n)) || (!is2d && v.length < 3)) valid = false;
      else step.position = is2d ? vec2(v[0], v[1]) : vec3(v);
    } else {
      for (const axis of is2d ? ['x', 'y'] : ['x', 'y', 'z']) {
        if (p[axis] === undefined) continue;
        const n = finite(p[axis]);
        if (!Number.isFinite(n)) valid = false;
        else step[axis] = n;
      }
    }
    if (p.impulseY !== undefined) {
      const n = finite(p.impulseY);
      if (!Number.isFinite(n)) valid = false;
      else step.impulse_y = n;
    }
    if (!valid) {
      warn('move target is not a valid position; the branch after it stops (same as the runtime).');
      return true;
    }
    steps.push(step);
    changed = true;
  }

  if (p.cameraMode !== undefined || p.fov !== undefined) {
    if (is2d) {
      warn('camera tracks are 3D-only (the runtime rejects them in 2D); the branch after it stops.');
      return true;
    }
    if (p.fov !== undefined) {
      const fov = finite(p.fov);
      if (!Number.isFinite(fov) || fov < 1 || fov > 179) {
        warn('camera FOV is out of range; the branch after it stops (same as the runtime).');
        return true;
      }
      steps.push({ type: 'fov', value: fov });
    }
    if (p.cameraMode !== undefined) warn(`camera move "${String(p.cameraMode)}" is not exported (the Godot camera keeps its framing).`);
    changed = true;
  }

  if (p.vfxType !== undefined || p.vfxId || p.actionType === 'spawn-vfx') {
    warn(`visual effect "${String(p.vfxType || p.vfxId || 'sparkles')}" is not exported.`);
    changed = true;
  }

  let scored = false;
  if (p.scoreDelta !== undefined || p.actionType === 'add-score') {
    const value = finite(p.scoreDelta ?? 0);
    if (!Number.isFinite(value)) {
      warn('score change is not a number; the branch after it stops (same as the runtime).');
      return true;
    }
    steps.push({ type: 'add-score', value: Math.round(value) });
    scored = true;
  }

  if (!changed && !scored) {
    if (node.type === 'media-pipeline' && (p.skybox || p.weatherType || p.terrainType)) return false; // world stage: already in the scene
    warn(node.type === 'media-pipeline'
      ? 'media-pipeline step needs an external output runtime and was not exported; the branch after it stops.'
      : `action "${String(p.actionType || node.title)}" has no runtime effect (unsupported); the branch after it stops.`);
    return true;
  }
  for (const step of steps) push(step);
  return false;
}

// ============================================================================
// Scenes
// ============================================================================

interface SceneContext {
  scene: SceneSpec;
  tscn: TscnBuilder;
  assets: AssetStore;
  warn: (feature: string, detail: string) => void;
  scenePaths: Map<string, string>;
  viewport: { width: number; height: number };
}

function gameRootProps(ctx: SceneContext, script: GdRaw, extra: Props): Props {
  const { scene } = ctx;
  const rules = scene.gameRules || ({} as SceneSpec['gameRules']);
  const overlay = scene.marketingOverlay;
  const ctaUrl = overlay?.ctaUrl && /^https?:\/\//i.test(overlay.ctaUrl) ? overlay.ctaUrl : '';
  if (overlay?.ctaUrl && !ctaUrl) ctx.warn('Marketing overlay', 'CTA link is not an http(s) URL and was left out.');
  const nextId = scene.sequence?.nextSceneId;
  const next = nextId ? ctx.scenePaths.get(nextId) : undefined;
  if (nextId && !next) ctx.warn('Scene link', `Next scene "${nextId}" is not part of this export; the link was left out.`);
  const logicRules = compileLogicRules(scene, ctx.warn);
  const props: Props = [
    ['script', script],
    ['mode', scene.mode === 'media' ? 'media' : 'game'],
    ['is_2d', scene.engineType === '2d'],
    ['win_condition', rules.winCondition || 'score-threshold'],
    ['target_score', Math.max(0, Math.round(Number(rules.targetScore) || 100))],
    ['time_limit', Number(rules.timeLimitSeconds) || 15],
    ['duration', Number(scene.durationSeconds) || 8],
    ['instructions', String(rules.instructions || '')],
    ['next_scene', next ? `res://${next}` : ''],
    ['end_headline', overlay?.enabled ? String(overlay.headline || '') : ''],
    ['cta_text', overlay?.enabled ? String(overlay.ctaText || '') : ''],
    ['cta_url', overlay?.enabled ? ctaUrl : ''],
    ...extra,
  ];
  if (logicRules.length) props.push(['logic_rules', logicRules]);
  return props;
}

function meta(entries: Record<string, GdValue | undefined>): Props {
  return Object.entries(entries)
    .filter((e): e is [string, GdValue] => e[1] !== undefined)
    .map(([k, v]) => [`metadata/${k}`, v]);
}

// ---------------------------------------------------------------- 3D

const SKY_COLORS: Record<string, { top: string; horizon: string; ground: string }> = {
  'daylight-sky': { top: '#3b7dd8', horizon: '#a9c8ea', ground: '#5b6b5a' },
  'sunset-atmosphere': { top: '#3b2a6b', horizon: '#f59e5b', ground: '#3d2f3a' },
  'night-stars': { top: '#020617', horizon: '#1e293b', ground: '#0b1020' },
  'cyber-void': { top: '#0b0420', horizon: '#6d28d9', ground: '#0b0420' },
  overcast: { top: '#8b98a8', horizon: '#c9d1da', ground: '#606a73' },
};

function build3DScene(ctx: SceneContext): string {
  const { scene, tscn, warn } = ctx;
  const env = scene.environment || ({} as SceneSpec['environment']);
  const world = scene.world || ({} as SceneSpec['world']);
  const players = scene.actors.filter((a) => a.physicsRole === 'player');

  // Camera follow (runtime: followActorId, else the player).
  const camera = scene.camera || ({ mode: 'orbit', position: [0, 4, 8], target: [0, 0, 0], fov: 45, keyframes: [] } as SceneSpec['camera']);
  const followActor = FOLLOW_CAMERA_MODES.has(camera.mode)
    ? scene.actors.find((a) => a.id === camera.followActorId) || players[0]
    : undefined;

  // Fixed node names are reserved first so actor names never collide with them.
  for (const fixed of ['WorldEnvironment', 'Sun', 'RimLight', 'Camera3D', 'Ground']) tscn.uniqueName('.', fixed);
  const actorNames = new Map<string, string>();
  for (const a of scene.actors) actorNames.set(a.id, tscn.uniqueName('.', godotNodeName(a.name || a.id, 'Actor')));

  const script = tscn.extResource('Script', 'res://scripts/omni_game.gd');
  const rootExtra: Props = [];
  if (followActor) rootExtra.push(['camera_follow', raw(`NodePath(${gdString(actorNames.get(followActor.id)!)})`)]);
  tscn.node(godotNodeName(scene.title, 'Scene'), 'Node3D', null, gameRootProps(ctx, script, rootExtra));

  // Environment: sky, ambient, fog.
  const envProps: Props = [];
  const hdri = world.hdri;
  let skyMaterial: GdRaw | null = null;
  let hdriSky = false;
  if (hdri?.url) {
    const asset = ctx.assets.resolve(hdri.url, 'hdri');
    if ('error' in asset) warn('HDRI', `HDRI "${hdri.name || hdri.url}" was not embedded (${asset.error}); a procedural sky is used.`);
    else {
      const texture = tscn.extResource('Texture2D', asset.path);
      skyMaterial = tscn.subResource('PanoramaSkyMaterial', [['panorama', texture], ['energy_multiplier', Number(hdri.intensity) || 1]]);
      hdriSky = true;
    }
  }
  const sky = SKY_COLORS[world.skybox];
  if (!skyMaterial && sky) {
    skyMaterial = tscn.subResource('ProceduralSkyMaterial', [
      ['sky_top_color', gdColor(sky.top)],
      ['sky_horizon_color', gdColor(sky.horizon)],
      ['ground_bottom_color', gdColor(sky.ground)],
      ['ground_horizon_color', gdColor(sky.horizon)],
    ]);
  }
  if (skyMaterial) {
    const skyRes = tscn.subResource('Sky', [['sky_material', skyMaterial]]);
    const showSky = !(hdriSky && hdri?.showBackground === false);
    envProps.push(['background_mode', showSky ? 2 : 1], ['sky', skyRes]);
    if (!showSky) envProps.push(['background_color', gdColor(env.backgroundColor, '#0b101b')]);
  } else {
    envProps.push(['background_mode', 1], ['background_color', gdColor(env.backgroundColor, '#0b101b')]);
  }
  envProps.push(
    ['ambient_light_source', 2],
    ['ambient_light_color', gdColor(env.keyLightColor, '#ffffff')],
    ['ambient_light_energy', Math.max(0, Number(env.ambientIntensity) || 0.5)],
    ['tonemap_mode', 3],
  );
  if (Number(env.fogFar) > 0) {
    envProps.push(
      ['fog_enabled', true],
      ['fog_mode', 1],
      ['fog_light_color', gdColor(env.fogColor, '#0b101b')],
      ['fog_density', 1],
      ['fog_depth_begin', Math.max(0, Number(env.fogNear) || 0)],
      ['fog_depth_end', Math.max(Number(env.fogNear) || 0, Number(env.fogFar))],
    );
  }
  const environment = tscn.subResource('Environment', envProps);
  tscn.node('WorldEnvironment', 'WorldEnvironment', '.', [['environment', environment]]);

  const sun = (world.sunPosition?.length === 3 ? world.sunPosition : [18, 24, 14]) as Vector3Tuple;
  tscn.node('Sun', 'DirectionalLight3D', '.', [
    ['transform', transform3D(lookAtBasisRows(sun, [0, 0, 0]), sun)],
    ['light_color', gdColor(env.keyLightColor, '#ffffff')],
    ['light_energy', Math.max(0, Number(env.keyLightIntensity) || 1)],
    ['shadow_enabled', true],
  ]);
  const rim: Vector3Tuple = [-sun[0], Math.abs(sun[1]) * 0.6 + 2, -sun[2]];
  tscn.node('RimLight', 'DirectionalLight3D', '.', [
    ['transform', transform3D(lookAtBasisRows(rim, [0, 0, 0]), rim)],
    ['light_color', gdColor(env.rimLightColor, '#88ccff')],
    ['light_energy', 0.6],
  ]);

  tscn.node('Camera3D', 'Camera3D', '.', [
    ['transform', transform3D(lookAtBasisRows(camera.position, camera.target), camera.position)],
    ['current', true],
    ['fov', Math.min(179, Math.max(1, Number(camera.fov) || 45))],
  ]);
  if (ANIMATED_CAMERA_MODES.has(camera.mode)) warn('Camera', `Camera move "${camera.mode}" is not exported; the Godot camera holds the start framing.`);
  if (camera.keyframes?.length) warn('Camera', `${camera.keyframes.length} camera keyframe(s) are not exported (no camera animation).`);
  if (camera.shots?.length) warn('Camera', `${camera.shots.length} cinematic shot(s) are not exported (no shot list / cuts).`);

  // Ground.
  const terrain = world.terrain;
  if (!terrain || terrain.type !== 'none') {
    const groundMat = tscn.subResource('StandardMaterial3D', [['albedo_color', gdColor(terrain?.color || env.groundColor, '#1e293b')], ['roughness', 0.9]]);
    const plane = tscn.subResource('PlaneMesh', [['material', groundMat], ['size', vec2(60, 60)]]);
    const box = tscn.subResource('BoxShape3D', [['size', vec3([60, 0.2, 60])]]);
    tscn.node('Ground', 'StaticBody3D', '.', [['metadata/omni_role', 'ground']]);
    tscn.node('Mesh', 'MeshInstance3D', 'Ground', [['mesh', plane]]);
    tscn.node('Shape', 'CollisionShape3D', 'Ground', [['transform', transform3D(IDENTITY, [0, -0.1, 0])], ['shape', box]]);
    if (terrain && terrain.type !== 'flat-grid' && terrain.type !== 'city-asphalt') {
      warn('World', `Terrain "${terrain.type}" is exported as a flat 60 x 60 m ground.`);
    }
    if (env.groundGrid) warn('World', 'The ground grid lines are not exported.');
  }
  if (world.weather && world.weather.type !== 'clear') warn('World', `Weather "${world.weather.type}" is not exported.`);
  if (world.clouds?.enabled) warn('World', 'Clouds are not exported.');
  if (world.scatterObjects?.length) warn('World', `${world.scatterObjects.length} scatter layer(s) (${world.scatterObjects.map((s) => s.type).join(', ')}) are not exported.`);
  if (world.features?.length) warn('World', `Water features (${world.features.map((f) => f.type).join(', ')}) are not exported.`);
  if (env.reflectivePedestal) warn('World', 'The reflective pedestal is not exported.');

  for (const actor of scene.actors) build3DActor(ctx, actor, actorNames.get(actor.id)!);

  return tscn.toString();
}

/** Phase 9 state machines and Phase 6 shader effects have no Godot equivalent: never drop them silently. */
function warnMachineAndShader(warn: (feature: string, detail: string) => void, entity: { stateMachine?: ActorStateMachine; shaderEffect?: ShaderEffect }, label: string) {
  if (entity.stateMachine) {
    const states = Object.keys(entity.stateMachine.states || {}).length;
    warn('State machines', `${label}: behaviour state machine (${states} state${states === 1 ? '' : 's'}, initial "${entity.stateMachine.initial}") is not converted; the node stays at its start pose. Recreate the behaviour with GDScript or an AnimationTree.`);
  }
  if (entity.shaderEffect) {
    warn('Shader effects', `${label}: shader effect "${entity.shaderEffect.preset}" is not converted; the model keeps its plain material. Recreate it as a Godot ShaderMaterial.`);
  }
}

function build3DActor(ctx: SceneContext, actor: ActorNode, name: string) {
  const { tscn, warn, scene } = ctx;
  const entry = ASSET_REGISTRY[actor.assetId];
  const box = entry?.boundingBox || { width: 1, height: 2, depth: 1 };
  const scale = (actor.scale?.length === 3 ? actor.scale : [1, 1, 1]).map((s) => Number(s) || 1) as Vector3Tuple;
  const position = (actor.position?.length === 3 ? actor.position : [0, 0, 0]) as Vector3Tuple;
  const rotation = (actor.rotation?.length === 3 ? actor.rotation : [0, 0, 0]) as Vector3Tuple;
  const role = actor.physicsRole || 'static';
  const label = `Actor "${actor.name || actor.id}"`;

  const bodyType = role === 'player' ? 'CharacterBody3D'
    : role === 'collectible' || role === 'hazard' ? 'Area3D'
    : role === 'dynamic' ? 'RigidBody3D'
    : 'StaticBody3D';
  const click = actor.assetId === 'mystery-gift-box' ? 'unbox-tap' : actor.onClickAction || 'none';
  const url = actor.customGlbUrl || actor.modelUrl || entry?.modelUrl;
  let model: { path: string } | null = null;
  if (url) {
    const asset = ctx.assets.resolve(url, 'model');
    if ('error' in asset) warn('Models', `${label}: model not embedded (${asset.error}); a primitive stands in.`);
    else model = asset;
  } else {
    warn('Models', `${label}: the procedural "${actor.assetId}" model is replaced by a coloured primitive.`);
  }
  const clip = model ? actor.activeClip || entry?.defaultClip : undefined;

  const props: Props = [['transform', transform3D(threeEulerToBasisRows(rotation), position)]];
  if (actor.visible === false) props.push(['visible', false]);
  const extra: { groups?: string[] } = {};
  if (role === 'player') {
    props.push(['script', tscn.extResource('Script', 'res://scripts/omni_player_3d.gd')], ['motion_mode', 1]);
    extra.groups = ['omni_player'];
  }
  props.push(...meta({
    omni_id: actor.id,
    omni_role: role,
    omni_click: click,
    omni_score: actor.scoreValue !== undefined && Number.isFinite(Number(actor.scoreValue)) ? Math.round(Number(actor.scoreValue)) : undefined,
    omni_clip: clip ? String(clip) : undefined,
    omni_unbox_taps: click === 'unbox-tap' ? Math.max(1, Math.round(Number(actor.unboxTapsRequired) || 3)) : undefined,
  }));
  const body = tscn.node(name, bodyType, '.', props, extra);

  const [w, h, d] = [box.width * Math.abs(scale[0]), box.height * Math.abs(scale[1]), box.depth * Math.abs(scale[2])];
  if (model) {
    const s = entry?.defaultScale ?? 1;
    const glb = tscn.extResource('PackedScene', model.path);
    tscn.node('Model', null, body, [['transform', transform3D(IDENTITY, [0, 0, 0], scale.map((v) => v * s))]], { instance: glb });
  } else {
    const material = tscn.subResource('StandardMaterial3D', [
      ['albedo_color', gdColor(actor.primaryColor, entry?.defaultPrimaryColor || '#94a3b8')],
      ['metallic', clamp01(actor.metalness ?? entry?.defaultMetalness ?? 0.2)],
      ['roughness', clamp01(actor.roughness ?? entry?.defaultRoughness ?? 0.5)],
    ]);
    const category = entry?.category;
    const mesh = category === 'character' || category === 'gltf-rigged' || role === 'player'
      ? tscn.subResource('CapsuleMesh', [['material', material], ['radius', Math.max(0.05, Math.min(box.width, box.depth) / 2)], ['height', Math.max(0.1, box.height)]])
      : category === 'collectible' || role === 'collectible'
        ? tscn.subResource('SphereMesh', [['material', material], ['radius', Math.max(0.05, Math.min(box.width, box.depth) / 2)], ['height', Math.max(0.1, box.height)]])
        : tscn.subResource('BoxMesh', [['material', material], ['size', vec3([box.width, box.height, box.depth])]]);
    tscn.node('Mesh', 'MeshInstance3D', body, [['transform', transform3D(IDENTITY, [0, h / 2, 0], scale.map(Math.abs))], ['mesh', mesh]]);
  }
  // Same contact volume as the runtime (cylinder of radius max(w, d) * 0.42) for gameplay roles, a box otherwise.
  const shape = role === 'player' || role === 'collectible' || role === 'hazard'
    ? tscn.subResource('CylinderShape3D', [['radius', Math.max(0.05, Math.max(w, d) * 0.42)], ['height', Math.max(0.05, h)]])
    : tscn.subResource('BoxShape3D', [['size', vec3([Math.max(0.05, w), Math.max(0.05, h), Math.max(0.05, d)])]]);
  tscn.node('Shape', 'CollisionShape3D', body, [['transform', transform3D(IDENTITY, [0, h / 2, 0])], ['shape', shape]]);

  if (actor.activeAnimation && actor.activeAnimation !== 'idle') warn('Animation', `${label}: procedural motion "${actor.activeAnimation}" is not exported.`);
  if (actor.activeClip && !model) warn('Animation', `${label}: clip "${actor.activeClip}" needs the GLB model, which was not embedded.`);
  if (actor.performance?.length) warn('Cinematics', `${label}: ${actor.performance.length} performance step(s) (walks, clip changes, look-at) are not exported.`);
  if (scene.mode === 'media' && (actor.startTime !== undefined || actor.endTime !== undefined)) warn('Cinematics', `${label}: appear / disappear times are not exported (the actor is always shown).`);
  if (actor.enterEffect && actor.enterEffect !== 'none') warn('Animation', `${label}: enter effect "${actor.enterEffect}" is not exported.`);
  if (actor.revealAssetId) warn('Gameplay', `${label}: the unbox reveal model swap ("${actor.revealAssetId}") is not exported; the box simply wins the game.`);
  if (click === 'trigger-vfx') warn('Gameplay', `${label}: click effect "trigger-vfx" is exported as a score tap without the visual effect.`);
  warnMachineAndShader(warn, actor, label);
  if (role === 'dynamic') warn('Physics', `${label}: "dynamic" becomes a Godot RigidBody3D (real gravity), which can move differently from OmniStage.`);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number(n) || 0));

// ---------------------------------------------------------------- 2D

function shapePoints(node: Node2D): Array<[number, number]> {
  const w = Math.max(1, Number(node.width) || 1), h = Math.max(1, Number(node.height) || 1);
  const pts: Array<[number, number]> = [];
  if (node.shapeKind === 'circle') {
    const r = Math.min(w, h) / 2;
    for (let i = 0; i < 32; i++) pts.push([Math.cos((i / 32) * Math.PI * 2) * r, Math.sin((i / 32) * Math.PI * 2) * r]);
    return pts;
  }
  if (node.shapeKind === 'star') {
    const outer = Math.min(w, h) / 2, inner = Math.min(w, h) / 4.2;
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI * 1.5 + (i * Math.PI) / 5;
      const r = i % 2 ? inner : outer;
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    return pts;
  }
  // Rounded rectangle (capsule / sprite-actor use a larger radius, like the 2D stage).
  const radius = Math.min(node.shapeKind === 'capsule' || node.type === 'sprite-actor' ? Math.min(w, h) * 0.35 : 8, w / 2, h / 2);
  const corners: Array<[number, number, number]> = [[w / 2 - radius, -h / 2 + radius, -Math.PI / 2], [w / 2 - radius, h / 2 - radius, 0],
    [-w / 2 + radius, h / 2 - radius, Math.PI / 2], [-w / 2 + radius, -h / 2 + radius, Math.PI]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= 4; i++) {
      const angle = start + (i / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
  }
  return pts;
}

const packedVec2 = (pts: Array<[number, number]>) => raw(`PackedVector2Array(${pts.map(([x, y]) => `${gdNumber(x)}, ${gdNumber(y)}`).join(', ')})`);

function build2DScene(ctx: SceneContext): string {
  const { scene, tscn, warn } = ctx;
  const env = scene.environment || ({} as SceneSpec['environment']);
  const script = tscn.extResource('Script', 'res://scripts/omni_game.gd');
  tscn.node(godotNodeName(scene.title, 'Scene'), 'Node2D', null, gameRootProps(ctx, script, []));
  tscn.uniqueName('.', 'Background');
  tscn.uniqueName('.', 'Camera2D');
  // Phase 2: the background covers the whole world; the Godot camera still frames the first screen (see the warning below).
  const world = resolveWorld(scene.world2D);
  tscn.node('Background', 'ColorRect', '.', [
    ['offset_right', world.width],
    ['offset_bottom', world.height],
    ['mouse_filter', 2],
    ['color', gdColor(env.backgroundColor, '#0b101b')],
  ]);
  // Fits the 1000 x 600 stage into the project window (zoom 1 when the window is the stage size).
  const zoom = Math.min(ctx.viewport.width / STAGE_2D.width, ctx.viewport.height / STAGE_2D.height);
  tscn.node('Camera2D', 'Camera2D', '.', [['position', vec2(STAGE_2D.width / 2, STAGE_2D.height / 2)], ['zoom', vec2(zoom, zoom)]]);

  for (const node of scene.nodes2D) build2DNode(ctx, node);
  if (world.width > STAGE_2D.width || world.height > STAGE_2D.height || (scene.camera2D && scene.camera2D.mode === 'follow')) {
    warn('2D camera', `The scrolling / following 2D camera is not exported: the Godot camera frames the first ${STAGE_2D.width}x${STAGE_2D.height} screen of the ${world.width}x${world.height} world.`);
  }
  if (scene.nodes2D.some((n) => !n.keyframeTrack?.length && (n.physics2D === 'collectible' || n.shapeKind === 'star'))) {
    warn('Animation', 'The idle spin of collectibles / stars and the pulse of kinetic text are not exported.');
  }
  return tscn.toString();
}

function build2DNode(ctx: SceneContext, node: Node2D) {
  const { tscn, warn } = ctx;
  const label = `Node "${node.name || node.id}"`;
  const name = tscn.uniqueName('.', godotNodeName(node.name || node.id, 'Node'));
  const w = Math.max(1, Number(node.width) || 1), h = Math.max(1, Number(node.height) || 1);
  const sx = Number(node.scaleX ?? 1) || 1, sy = Number(node.scaleY ?? 1) || 1;
  const role = node.physics2D || 'none';
  const isPlayer = role === 'player-platformer' || role === 'player-topdown';
  // Phase 2: 'solid' is a StaticBody2D that blocks from every side (no one-way flag); hazards / checkpoints are Areas.
  const isSensor = role === 'collectible' || role === 'hazard' || role === 'checkpoint';
  const type = isPlayer ? 'CharacterBody2D' : role === 'static-platform' || role === 'solid' ? 'StaticBody2D' : isSensor ? 'Area2D' : 'Node2D';

  const props: Props = [
    ['position', vec2(Number(node.x) || 0, Number(node.y) || 0)],
    ['rotation', ((Number(node.rotation) || 0) * Math.PI) / 180],
  ];
  if (node.visible === false) props.push(['visible', false]);
  const opacity = Number(node.opacity ?? 1);
  if (Number.isFinite(opacity) && opacity < 1) props.push(['modulate', raw(`Color(1, 1, 1, ${gdNumber(Math.max(0, opacity))})`)]);
  const extra: { groups?: string[] } = {};
  if (isPlayer) {
    props.push(['script', tscn.extResource('Script', 'res://scripts/omni_player_2d.gd')],
      ['control', role === 'player-topdown' ? 'topdown' : 'platformer'],
      ['half_size', vec2((w * Math.abs(sx)) / 2, (h * Math.abs(sy)) / 2)]);
    if (role === 'player-topdown') props.push(['motion_mode', 1]);
    extra.groups = ['omni_player'];
  }
  props.push(...meta({
    omni_id: node.id,
    omni_role: role,
    omni_score: node.scoreValue !== undefined && Number.isFinite(Number(node.scoreValue)) ? Math.round(Number(node.scoreValue)) : undefined,
    omni_half: vec2((w * Math.abs(sx)) / 2, (h * Math.abs(sy)) / 2),
  }));
  const parent = tscn.node(name, type, '.', props, extra);

  // Visual child carries the node scale.
  const scaleProp: Props = sx !== 1 || sy !== 1 ? [['scale', vec2(sx, sy)]] : [];
  let drawn = false;
  if (node.type === 'particle-emitter') {
    warn('Particles', `${label}: particle emitter "${node.emitter?.preset || 'default'}" is not exported.`);
    drawn = true;
  } else if (node.imageUrl) {
    const asset = ctx.assets.resolve(node.imageUrl, 'image');
    if ('error' in asset) {
      warn('Images', `${label}: image not embedded (${asset.error}); a coloured box stands in.`);
    } else {
      const texture = tscn.extResource('Texture2D', asset.path);
      const sheet = node.spriteSheet;
      if (sheet && sheet.frameWidth > 0 && sheet.frameHeight > 0) {
        tscn.node('Sprite', 'Sprite2D', parent, [
          ['scale', vec2((w * sx) / sheet.frameWidth, (h * sy) / sheet.frameHeight)],
          ['texture', texture],
          ['region_enabled', true],
          ['region_rect', raw(`Rect2(0, 0, ${gdNumber(sheet.frameWidth)}, ${gdNumber(sheet.frameHeight)})`)],
        ]);
        warn('Animation', `${label}: spritesheet animation is exported as its first frame only.`);
      } else if (asset.size && asset.size.width > 0 && asset.size.height > 0) {
        tscn.node('Sprite', 'Sprite2D', parent, [['scale', vec2((w * sx) / asset.size.width, (h * sy) / asset.size.height)], ['texture', texture]]);
      } else {
        tscn.node('Sprite', 'TextureRect', parent, [
          ['offset_left', -w / 2], ['offset_top', -h / 2], ['offset_right', w / 2], ['offset_bottom', h / 2],
          ['pivot_offset', vec2(w / 2, h / 2)], ...scaleProp,
          ['mouse_filter', 2], ['texture', texture], ['expand_mode', 1], ['stretch_mode', 0],
        ]);
      }
      drawn = true;
    }
  } else if (node.type === 'text-kinetic') {
    const fontSize = Math.max(4, Math.round(Number(node.fontSize) || 34));
    tscn.node('Label', 'Label', parent, [
      ['offset_left', -w / 2], ['offset_top', -h / 2], ['offset_right', w / 2], ['offset_bottom', h / 2],
      ['grow_horizontal', 2], ['grow_vertical', 2], ['pivot_offset', vec2(w / 2, h / 2)], ...scaleProp,
      ['mouse_filter', 2],
      ['theme_override_colors/font_color', gdColor(node.fill, '#ffffff')],
      ...(node.stroke ? [['theme_override_colors/font_outline_color', gdColor(node.stroke, '#000000')] as [string, GdValue],
        ['theme_override_constants/outline_size', Math.round((Number(node.strokeWidth) || 2) * 2)] as [string, GdValue]] : []),
      ['theme_override_font_sizes/font_size', fontSize],
      ['text', String(node.text || node.name || '')],
      ['horizontal_alignment', 1],
      ['vertical_alignment', 1],
    ]);
    drawn = true;
  }
  if (!drawn) {
    const pts = shapePoints(node);
    tscn.node('Shape', 'Polygon2D', parent, [...scaleProp, ['color', gdColor(node.fill, '#38bdf8')], ['polygon', packedVec2(pts)]]);
    if (Number(node.strokeWidth) > 0) {
      tscn.node('Outline', 'Line2D', parent, [...scaleProp, ['points', packedVec2(pts)], ['closed', true],
        ['width', Number(node.strokeWidth)], ['default_color', gdColor(node.stroke, '#ffffff')]]);
    }
  }

  if (type !== 'Node2D') {
    const shape = node.shapeKind === 'circle' && !isPlayer
      ? tscn.subResource('CircleShape2D', [['radius', (Math.min(w, h) / 2) * Math.max(Math.abs(sx), Math.abs(sy))]])
      : tscn.subResource('RectangleShape2D', [['size', vec2(w * Math.abs(sx), h * Math.abs(sy))]]);
    const shapeProps: Props = [['shape', shape]];
    if (role === 'static-platform') shapeProps.push(['one_way_collision', true]);
    tscn.node('Collision', 'CollisionShape2D', parent, shapeProps);
  }

  if (node.keyframeTrack?.length) warn('Animation', `${label}: ${node.keyframeTrack.length} keyframe(s) are not exported (the node stays at its start pose).`);
  warnMachineAndShader(warn, node, label);
  if (node.type === 'parallax-layer') warn('2D', `${label}: parallax scrolling is not exported (static layer).`);
  if (role === 'bouncing') warn('Physics', `${label}: the "bouncing" role is not exported (static node).`);
  if (role === 'hazard') warn('Physics', `${label}: a hazard is exported as an Area2D; sending the player back to the checkpoint is not exported.`);
  if (role === 'checkpoint') warn('Physics', `${label}: a checkpoint is exported as an Area2D; remembering the respawn point is not exported.`);
  if (node.controller) warn('Physics', `${label}: the custom controller values (jump height, double jump, coyote time ...) are not exported; the Godot player uses its default movement.`);
  if (node.collider) warn('Physics', `${label}: the custom collider is not exported (the collision shape uses the node's size).`);
  if (node.mover) warn('Physics', `${label}: the moving platform is not exported (the node stays at its start position).`);
}

// ============================================================================
// Project
// ============================================================================

function viewportFor(scenes: SceneSpec[]): { width: number; height: number; portrait: boolean; expand: boolean } {
  const first3D = scenes.find((s) => s.engineType !== '2d');
  if (!first3D) return { ...STAGE_2D, portrait: false, expand: false };
  if (first3D.aspectRatio === '9:16') return { width: 720, height: 1280, portrait: true, expand: false };
  if (first3D.aspectRatio === '1:1') return { width: 960, height: 960, portrait: false, expand: true };
  return { width: 1280, height: 720, portrait: false, expand: false };
}

function projectGodot(name: string, mainScene: string, scenes: SceneSpec[], viewport: ReturnType<typeof viewportFor>): string {
  const only2d = scenes.every((s) => s.engineType === '2d');
  const clear = scenes[0]?.environment?.backgroundColor || '#0b101b';
  const lines = [
    '; Engine configuration file, generated by OmniStage AI (Godot 4 export).',
    '; Open this folder in Godot 4.3 or newer (Project Manager > Import).',
    '',
    'config_version=5',
    '',
    '[application]',
    '',
    `config/name=${gdString(name)}`,
    `run/main_scene=${gdString(`res://${mainScene}`)}`,
    `config/features=PackedStringArray("4.3", ${gdString(only2d ? 'GL Compatibility' : 'Forward Plus')})`,
    'config/icon="res://icon.svg"',
    '',
    '[display]',
    '',
    `window/size/viewport_width=${viewport.width}`,
    `window/size/viewport_height=${viewport.height}`,
    'window/stretch/mode="canvas_items"',
    `window/stretch/aspect=${gdString(viewport.expand ? 'expand' : 'keep')}`,
    ...(viewport.portrait ? ['window/handheld/orientation=1'] : []),
    '',
    '[input_devices]',
    '',
    'pointing/emulate_touch_from_mouse=true',
    '',
    '[physics]',
    '',
    'common/enable_object_picking=true',
    '',
    '[rendering]',
    '',
    ...(only2d ? ['renderer/rendering_method="gl_compatibility"', 'renderer/rendering_method.mobile="gl_compatibility"'] : []),
    `environment/defaults/default_clear_color=${gdColor(clear, '#0b101b').text}`,
    '',
  ];
  return lines.join('\n');
}

function sceneWarnings(scene: SceneSpec, warn: (feature: string, detail: string) => void) {
  if (scene.vfx?.length) warn('VFX', `${scene.vfx.length} visual effect(s) (${[...new Set(scene.vfx.map((v) => v.type))].join(', ')}) are not exported.`);
  if (scene.audio?.enabled) warn('Audio', 'Procedural sound cues (collect, jump, win, ...) are not exported; add AudioStreamPlayer nodes in Godot.');
  if (scene.soundtrack) warn('Audio', 'The film soundtrack (music, ambience, timed SFX) is not exported.');
  if (scene.audioTracks?.length) warn('Audio', `${scene.audioTracks.length} audio track(s) are not exported.`);
  if (scene.sfxLibrary && Object.keys(scene.sfxLibrary).length) warn('Audio', 'Extension SFX presets are not exported.');
  if (scene.particleLibrary && Object.keys(scene.particleLibrary).length) warn('Particles', 'Extension particle presets are not exported.');
  if (scene.dialogue?.length) warn('Dialogue', `${scene.dialogue.length} dialogue line(s) (voices, talk motion, auto captions) are not exported.`);
  if (scene.captions?.length) warn('Captions', `${scene.captions.length} caption(s) are not exported.`);
  const overlay = scene.marketingOverlay;
  if (overlay?.enabled && overlay.triggerCondition !== 'on-win') {
    warn('Marketing overlay', `The overlay is shown on the win screen only (OmniStage trigger: "${overlay.triggerCondition}").`);
  }
  if (overlay?.enabled && (overlay.subheadline || overlay.badgeText)) warn('Marketing overlay', 'Subheadline, badge and brand colour are not exported (headline and CTA button are).');
  if (scene.mode === 'game' && scene.gameRules?.winCondition === 'collect-all') {
    warn('Gameplay', '"collect-all" is exported like the runtime: the level is won when the score reaches the target.');
  }
}

function notesMarkdown(projectName: string, summaries: GodotSceneSummary[], mainScene: string, warnings: GodotExportWarning[]): string {
  const md = (s: string) => String(s).replace(/[\r\n]+/g, ' ').replace(/([\\`*_|<>[\]])/g, '\\$1');
  const lines = [
    `# ${md(projectName)}: Godot 4 export notes`,
    '',
    'Generated by OmniStage AI. Open the folder in **Godot 4.3+** (Project Manager > Import > `project.godot`).',
    'The first open imports the models and textures; then press F5 to run the main scene.',
    '',
    '## Scenes',
    '',
    '| # | Scene | File | Type |',
    '| --- | --- | --- | --- |',
    ...summaries.map((s, i) => `| ${i + 1} | ${md(s.title)}${s.path === mainScene ? ' (main)' : ''} | \`${s.path}\` | ${s.engineType.toUpperCase()} ${s.mode} |`),
    '',
    '## What was converted',
    '',
    '- 3D: Node3D scene, actors as physics bodies (player = CharacterBody3D, collectible / hazard = Area3D, dynamic = RigidBody3D, static = StaticBody3D) with collision shapes, GLB models copied into `models/` (or coloured primitives with StandardMaterial3D colour, metallic and roughness), Camera3D, sun and rim DirectionalLight3D, WorldEnvironment (sky, ambient light, depth fog).',
    '- 2D: Node2D scene on the 1000 x 600 stage, shapes (Polygon2D + Line2D outline), text (Label), images (Sprite2D), one-way platforms (StaticBody2D), players (CharacterBody2D), collectibles (Area2D).',
    '- Gameplay (`scripts/omni_game.gd`, the same file in every export): score and target, timer, win / lose, collectibles, hazards, click actions, unbox taps, scene links ("Next level"), end card with CTA, and the logic graph rules that map cleanly (stored per scene in `logic_rules`).',
    '- Movement: `scripts/omni_player_3d.gd` (WASD / arrows / drag, 4.2 m/s, arena +-5.5 m) and `scripts/omni_player_2d.gd` (platformer run 320, jump 520, gravity 882; or top-down).',
    '',
    '## Not converted (review these in Godot)',
    '',
  ];
  if (!warnings.length) lines.push('Nothing: every feature in these scenes has a Godot equivalent.', '');
  const byScene = new Map<string, GodotExportWarning[]>();
  for (const w of warnings) byScene.set(w.scene, [...(byScene.get(w.scene) || []), w]);
  for (const [scene, list] of byScene) {
    lines.push(`### ${md(scene)}`, '');
    for (const w of list) lines.push(`- **${md(w.feature)}**: ${md(w.detail)}`);
    lines.push('');
  }
  lines.push(
    '## Coordinates',
    '',
    '- 3D positions copy 1:1 (both engines are Y-up, right-handed, -Z forward, metres). Rotations are written as basis matrices from the OmniStage XYZ Euler angles, so they match exactly even though Godot\'s own Euler order is YXZ.',
    '- 2D uses the OmniStage stage coordinates (0..1000 x 0..600, y down, positions are node centres); a Camera2D fits the stage into the window.',
    '- Actor ids, roles, click actions and scores are kept as node metadata (`omni_id`, `omni_role`, `omni_click`, `omni_score`).',
    '',
  );
  return lines.join('\n');
}

/** Remote asset URLs to download before `buildGodotProject` (data: URLs are handled by the builder). */
export function godotAssetUrls(scenes: SceneSpec[]): string[] {
  return collectAssetUrls(scenes);
}

export function buildGodotProject(scenes: SceneSpec[], options: GodotExportOptions = {}): GodotProjectBuild {
  if (!scenes.length) throw new Error('Nothing to export: add at least one scene.');
  const log = new WarningLog();
  const failed = new Map((options.failedAssets || []).map((f) => [f.url, f.reason]));
  const assets = new AssetStore(options.assets || {}, failed);
  const projectName = String(options.projectName || scenes[0].title || 'OmniStage Export');
  const viewport = viewportFor(scenes);

  const scenePaths = new Map<string, string>();
  const summaries: GodotSceneSummary[] = scenes.map((s, i) => {
    const path = `scenes/${String(i + 1).padStart(2, '0')}-${slugifyTitle(s.title, 'scene').slice(0, 48)}.tscn`;
    scenePaths.set(s.id, path);
    return { id: s.id, title: s.title || `Scene ${i + 1}`, path, engineType: s.engineType === '2d' ? '2d' : '3d', mode: s.mode || 'game' };
  });
  const mainScene = scenePaths.get(options.mainSceneId || '') || summaries[0].path;

  const files: ZipInput[] = [];
  scenes.forEach((scene, i) => {
    const title = summaries[i].title;
    const warn = (feature: string, detail: string) => log.add(title, feature, detail);
    const ctx: SceneContext = { scene, tscn: new TscnBuilder(), assets, warn, scenePaths, viewport };
    const text = scene.engineType === '2d' ? build2DScene(ctx) : build3DScene(ctx);
    sceneWarnings(scene, warn);
    files.push({ name: summaries[i].path, content: text });
  });

  const has2D = scenes.some((s) => s.engineType === '2d');
  const has3D = scenes.some((s) => s.engineType !== '2d');
  if (has2D && has3D) log.add('Project', 'Window', `2D and 3D scenes share one window (${viewport.width} x ${viewport.height}); 2D scenes are scaled to fit.`);
  for (const [url, reason] of failed) log.add('Project', 'Downloads', `Could not download ${url} (${reason}).`);

  files.push(
    { name: 'project.godot', content: projectGodot(projectName, mainScene, scenes, viewport) },
    { name: 'icon.svg', content: GODOT_ICON_SVG },
    { name: '.gitignore', content: '.godot/\n' },
    { name: 'scripts/omni_game.gd', content: GODOT_GAME_SCRIPT },
    { name: 'scripts/omni_player_3d.gd', content: GODOT_PLAYER_3D_SCRIPT },
    { name: 'scripts/omni_player_2d.gd', content: GODOT_PLAYER_2D_SCRIPT },
  );
  for (const [path, bytes] of assets.files) files.push({ name: path, content: bytes });
  files.push({ name: GODOT_NOTES_FILE, content: notesMarkdown(projectName, summaries, mainScene, log.list) });

  return { files, warnings: log.list, mainScene, scenes: summaries };
}

export async function buildGodotZip(scenes: SceneSpec[], options: GodotExportOptions = {}) {
  const build = buildGodotProject(scenes, options);
  const zip = await buildZip(build.files);
  return { ...build, zip };
}
