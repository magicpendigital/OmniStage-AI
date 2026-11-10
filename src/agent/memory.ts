/**
 * Phase 6 — How the director uses memory: pick the relevant entries for a prompt, render them into the system
 * prompt, recognise explicit "remember…" commands, and spot preference statements worth suggesting as memories.
 * Pure functions (unit tested); persistence lives in server/workspace/memory.ts.
 */
import type { MemoryEntry, MemoryKind } from '../workspace/workspaceClient';
import { extractKeywords } from './directorSkills';

export const MAX_MEMORIES_IN_PROMPT = 8;

/** Pinned entries always; then entries for this project or global, ranked by keyword overlap and usage. */
export function selectMemories(prompt: string, entries: MemoryEntry[], projectId?: string | null, max = MAX_MEMORIES_IN_PROMPT): MemoryEntry[] {
  const inScope = entries.filter((e) => e.scope === 'global' || (projectId && e.scope === projectId));
  const keywords = new Set(extractKeywords(prompt, 12));
  const scored = inScope.map((e) => {
    const words = extractKeywords(e.text, 12);
    const overlap = words.filter((w) => keywords.has(w)).length;
    const score = (e.pinned ? 100 : 0) + overlap * 10 + (e.scope !== 'global' ? 4 : 0) + Math.min(5, e.uses) + (e.kind === 'constraint' ? 3 : 0);
    return { e, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || b.e.updatedAt.localeCompare(a.e.updatedAt))
    .slice(0, max)
    .map((s) => s.e);
}

export function buildMemoryContext(entries: MemoryEntry[]): string {
  if (!entries.length) return '';
  return `WHAT YOU KNOW ABOUT THIS CREATOR (from their memory; respect it unless the current request says otherwise):\n${entries
    .map((e) => `- [${e.kind}] ${e.text}`)
    .join('\n')}`;
}

const EXPLICIT = /^\s*(?:please\s+)?(?:remember(?:\s+that)?|note(?:\s+that)?|hãy\s+nhớ(?:\s+(?:rằng|là))?|nhớ(?:\s+(?:rằng|là))?|ghi\s+nhớ(?:\s+(?:rằng|là))?)\s*[:,-]?\s+(.{3,})$/i;

/** "remember: I make cozy pixel games" → the memory text, else null. */
export function parseExplicitMemory(prompt: string): string | null {
  const m = EXPLICIT.exec(prompt.trim());
  return m ? m[1].trim().replace(/[.!]+$/, '') : null;
}

const PREFERENCE_PATTERNS: Array<{ re: RegExp; kind: MemoryKind }> = [
  { re: /\b(i (?:always|usually|prefer|like|love|hate|don't like|never))\b/i, kind: 'preference' },
  { re: /\b(my (?:game|games|style|audience|players|brand|studio))\b/i, kind: 'fact' },
  { re: /\b(target(?:ing)? (?:audience|players|platform))\b/i, kind: 'goal' },
  { re: /(tôi (?:luôn|thường|thích|rất thích|không thích|ghét|muốn game))/i, kind: 'preference' },
  { re: /(đừng bao giờ|không bao giờ|luôn luôn|lúc nào cũng)/i, kind: 'constraint' },
  { re: /(phong cách (?:của tôi|tôi thích)|game của tôi|khán giả của tôi|người chơi của tôi)/i, kind: 'style' },
];

/** If a prompt states a lasting preference, return a memory suggestion for the user to confirm. */
export function suggestMemory(prompt: string): { text: string; kind: MemoryKind } | null {
  const text = prompt.trim();
  if (text.length < 12 || text.length > 400 || parseExplicitMemory(text)) return null;
  for (const p of PREFERENCE_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    // Keep the sentence that contains the preference.
    const sentences = text.split(/(?<=[.!?。])\s+|\n+/);
    const sentence = sentences.find((s) => p.re.test(s)) || text;
    return { text: sentence.trim().replace(/[.!]+$/, '').slice(0, 300), kind: p.kind };
  }
  return null;
}
