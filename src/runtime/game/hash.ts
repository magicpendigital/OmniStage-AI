/** Stable hashing for deterministic spawn jitter (shared by spawners and waves). */
/** FNV-1a -> [0, 1): the same id and index always give the same number, so spawns replay identically. */
export function hash01(text: string, index: number): number {
  let h = 0x811c9dc5;
  const s = `${text}:${index}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Murmur3 finaliser: FNV alone spreads sequential suffixes poorly.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
