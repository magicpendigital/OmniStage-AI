/**
 * JSON Merge Patch (RFC 7386) and JSON Patch (RFC 6902: add / replace / remove / test / move / copy).
 * Shared by the AI director's patch loop, the MCP server and the extension sandbox host.
 *
 * OmniStage extension (Phase 7C): inside an array, a path segment `@<id>` addresses the item whose `id` equals <id>
 * (e.g. `/actors/@hero/position`). A non-numeric segment that matches an item id is accepted the same way, because
 * models often write `/actors/hero/position`. This keeps AI edits stable when array order changes.
 */
export class JsonPatchError extends Error {}

export function mergePatch(target: any, patch: any): any {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove' | 'test' | 'move' | 'copy';
  path: string;
  value?: unknown;
  /** Source pointer for move / copy. */
  from?: string;
}

function decodePointer(path: string): string[] {
  if (typeof path !== 'string') throw new JsonPatchError('Every op needs a string "path"');
  if (path === '') return [];
  if (!path.startsWith('/')) throw new JsonPatchError(`Invalid JSON pointer "${path}" (must start with "/")`);
  return path
    .slice(1)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Resolves one segment inside an array: index, "-" (end), "@id" or a bare id. Returns -1 when not found. */
function arrayIndex(arr: unknown[], seg: string, allowEnd: boolean): number {
  if (seg === '-') return allowEnd ? arr.length : -1;
  if (/^\d+$/.test(seg)) return Number(seg);
  const id = seg.startsWith('@') ? seg.slice(1) : seg;
  return arr.findIndex((item) => !!item && typeof item === 'object' && (item as { id?: unknown }).id === id);
}

function child(parent: any, seg: string, path: string): any {
  if (Array.isArray(parent)) {
    const i = arrayIndex(parent, seg, false);
    if (i < 0 || i >= parent.length) throw new JsonPatchError(`Path not found: ${path} (no array item "${seg}")`);
    return parent[i];
  }
  if (parent && typeof parent === 'object' && seg in parent) return parent[seg];
  throw new JsonPatchError(`Path not found: ${path}`);
}

function locate(root: any, path: string): { parent: any; key: string } {
  const parts = decodePointer(path);
  if (!parts.length) throw new JsonPatchError('Patching the document root is not allowed; use mergePatch.');
  const key = parts.pop()!;
  let parent = root;
  for (const p of parts) parent = child(parent, p, path);
  if (parent === null || typeof parent !== 'object') throw new JsonPatchError(`Path not found: ${path}`);
  return { parent, key };
}

function read(root: any, path: string): any {
  let cur = root;
  for (const p of decodePointer(path)) cur = child(cur, p, path);
  return cur;
}

function add(parent: any, key: string, value: unknown, path: string) {
  if (Array.isArray(parent)) {
    const idx = arrayIndex(parent, key, true);
    if (idx < 0 || idx > parent.length) throw new JsonPatchError(`Invalid array index in ${path}`);
    parent.splice(idx, 0, value);
  } else parent[key] = value;
}

function remove(parent: any, key: string, path: string): unknown {
  if (Array.isArray(parent)) {
    const idx = arrayIndex(parent, key, false);
    if (idx < 0 || idx >= parent.length) throw new JsonPatchError(`Cannot remove missing ${path}`);
    return parent.splice(idx, 1)[0];
  }
  if (!(key in parent)) throw new JsonPatchError(`Cannot remove missing ${path}`);
  const old = parent[key];
  delete parent[key];
  return old;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function applyJsonPatch(doc: any, ops: JsonPatchOp[]): any {
  if (!Array.isArray(ops)) throw new JsonPatchError('"ops" must be an array');
  const root = clone(doc);
  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') throw new JsonPatchError(`ops[${i}] is not an object`);
    try {
      const { parent, key } = locate(root, op.path);
      switch (op.op) {
        case 'add':
          add(parent, key, clone(op.value), op.path);
          break;
        case 'replace': {
          if (Array.isArray(parent)) {
            const idx = arrayIndex(parent, key, false);
            if (idx < 0 || idx >= parent.length) throw new JsonPatchError(`Cannot replace missing ${op.path}`);
            parent[idx] = clone(op.value);
          } else {
            if (!(key in parent)) throw new JsonPatchError(`Cannot replace missing ${op.path} (use "add")`);
            parent[key] = clone(op.value);
          }
          break;
        }
        case 'remove':
          remove(parent, key, op.path);
          break;
        case 'test':
          if (JSON.stringify(read(root, op.path)) !== JSON.stringify(op.value)) throw new JsonPatchError(`Test failed at ${op.path}`);
          break;
        case 'move': {
          if (typeof op.from !== 'string') throw new JsonPatchError('"move" needs "from"');
          const src = locate(root, op.from);
          const value = remove(src.parent, src.key, op.from);
          const dst = locate(root, op.path);
          add(dst.parent, dst.key, value, op.path);
          break;
        }
        case 'copy': {
          if (typeof op.from !== 'string') throw new JsonPatchError('"copy" needs "from"');
          add(parent, key, clone(read(root, op.from)), op.path);
          break;
        }
        default:
          throw new JsonPatchError(`Unsupported op "${(op as any).op}"`);
      }
    } catch (e) {
      if (e instanceof JsonPatchError) throw new JsonPatchError(`ops[${i}] ${op.op} ${op.path}: ${e.message}`);
      throw e;
    }
  });
  return root;
}
