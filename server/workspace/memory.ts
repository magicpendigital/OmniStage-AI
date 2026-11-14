/**
 * Phase 6 — User memory: durable facts about the creator (taste, goals, constraints, feedback) that the AI
 * director reads on every turn. Stored only on this computer (~/OmniStage/memory/memory.json), fully editable.
 */
import { join } from 'node:path';
import { nowIso, omniHome, readJSON, WorkspaceError, writeJSON } from './store';

export type MemoryKind = 'preference' | 'style' | 'goal' | 'constraint' | 'feedback' | 'fact';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  /** 'global' or a project id. */
  scope: string;
  source: 'explicit' | 'confirmed-suggestion' | 'learned';
  pinned: boolean;
  uses: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFile {
  enabled: boolean;
  entries: MemoryEntry[];
}

const KINDS: MemoryKind[] = ['preference', 'style', 'goal', 'constraint', 'feedback', 'fact'];
const MAX_ENTRIES = 300;

function memoryPath() {
  return join(omniHome(), 'memory', 'memory.json');
}

export async function readMemory(): Promise<MemoryFile> {
  const file = await readJSON<MemoryFile>(memoryPath(), { enabled: true, entries: [] });
  return { enabled: file.enabled !== false, entries: Array.isArray(file.entries) ? file.entries : [] };
}

async function write(file: MemoryFile) {
  await writeJSON(memoryPath(), file);
}

function clean(input: Partial<MemoryEntry>): Pick<MemoryEntry, 'kind' | 'text' | 'scope'> {
  const text = String(input.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) throw new WorkspaceError('Memory text is required');
  const kind = KINDS.includes(input.kind as MemoryKind) ? (input.kind as MemoryKind) : 'preference';
  const scope = input.scope && /^(global|[a-z0-9][a-z0-9-]{0,63})$/.test(input.scope) ? input.scope : 'global';
  return { kind, text, scope };
}

export async function addMemory(input: Partial<MemoryEntry>): Promise<MemoryEntry> {
  const file = await readMemory();
  const base = clean(input);
  const dup = file.entries.find((e) => e.text.toLowerCase() === base.text.toLowerCase() && e.scope === base.scope);
  if (dup) return dup;
  const entry: MemoryEntry = {
    id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ...base,
    source: input.source === 'learned' || input.source === 'confirmed-suggestion' ? input.source : 'explicit',
    pinned: !!input.pinned,
    uses: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  file.entries = [entry, ...file.entries].slice(0, MAX_ENTRIES);
  await write(file);
  return entry;
}

export async function updateMemory(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
  const file = await readMemory();
  const entry = file.entries.find((e) => e.id === id);
  if (!entry) throw new WorkspaceError('Memory not found', 404);
  if (patch.text !== undefined || patch.kind !== undefined || patch.scope !== undefined) {
    Object.assign(entry, clean({ ...entry, ...patch }));
  }
  if (patch.pinned !== undefined) entry.pinned = !!patch.pinned;
  entry.updatedAt = nowIso();
  await write(file);
  return entry;
}

export async function deleteMemory(id: string): Promise<void> {
  const file = await readMemory();
  const next = file.entries.filter((e) => e.id !== id);
  if (next.length === file.entries.length) throw new WorkspaceError('Memory not found', 404);
  await write({ ...file, entries: next });
}

export async function setMemoryEnabled(enabled: boolean): Promise<MemoryFile> {
  const file = await readMemory();
  file.enabled = !!enabled;
  await write(file);
  return file;
}

export async function markMemoriesUsed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const file = await readMemory();
  let changed = false;
  for (const e of file.entries) {
    if (ids.includes(e.id)) {
      e.uses += 1;
      changed = true;
    }
  }
  if (changed) await write(file);
}
