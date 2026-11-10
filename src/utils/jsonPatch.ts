/**
 * JSON Merge Patch (RFC 7386) and a JSON Patch subset (RFC 6902): add / replace / remove / test.
 * Shared by the MCP server and the extension sandbox host.
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
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
}

function decodePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new JsonPatchError(`Invalid JSON pointer "${path}"`);
  return path
    .slice(1)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function applyJsonPatch(doc: any, ops: JsonPatchOp[]): any {
  const root = JSON.parse(JSON.stringify(doc));
  for (const op of ops) {
    const parts = decodePointer(op.path);
    if (!parts.length) throw new JsonPatchError('Patching the document root is not allowed; use mergePatch.');
    const key = parts.pop()!;
    let parent = root;
    for (const p of parts) {
      parent = Array.isArray(parent) ? parent[Number(p)] : parent?.[p];
      if (parent === undefined || parent === null) throw new JsonPatchError(`Path not found: ${op.path}`);
    }
    const isArr = Array.isArray(parent);
    const idx = key === '-' ? parent.length : Number(key);
    switch (op.op) {
      case 'add':
        if (isArr) parent.splice(idx, 0, op.value);
        else parent[key] = op.value;
        break;
      case 'replace':
        if (isArr ? !(idx in parent) : !(key in parent)) throw new JsonPatchError(`Cannot replace missing ${op.path}`);
        if (isArr) parent[idx] = op.value;
        else parent[key] = op.value;
        break;
      case 'remove':
        if (isArr) parent.splice(idx, 1);
        else delete parent[key];
        break;
      case 'test':
        if (JSON.stringify(isArr ? parent[idx] : parent[key]) !== JSON.stringify(op.value)) throw new JsonPatchError(`Test failed at ${op.path}`);
        break;
      default:
        throw new JsonPatchError(`Unsupported op ${(op as any).op}`);
    }
  }
  return root;
}
