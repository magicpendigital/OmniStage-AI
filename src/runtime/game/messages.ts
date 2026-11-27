/**
 * Phase 7D — in-game messages: a line of dialogue or a hint shown in a box at the bottom of the stage ("The door is locked", "Guard:
 * Halt!"). Scenes raise one from a logic-graph action or a state-machine action (`show-message`); the runtime store keeps it
 * (`gameMessage`) until its scene time is up, so pausing and scrubbing stay deterministic. Pure helpers only.
 */

export const MAX_MESSAGE_CHARS = 160;
export const MAX_SPEAKER_CHARS = 24;
export const DEFAULT_MESSAGE_SECONDS = 3;
export const MIN_MESSAGE_SECONDS = 0.5;
export const MAX_MESSAGE_SECONDS = 20;

export interface GameMessage {
  text: string;
  speaker?: string;
  /** Scene time (seconds) when the box goes away. */
  until: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const squash = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Validates raw action params: null when there is nothing to show. Text and speaker are trimmed and capped, seconds clamped. */
export function cleanMessage(raw: { text?: unknown; speaker?: unknown; seconds?: unknown }): { text: string; speaker?: string; seconds: number } | null {
  if (!raw || typeof raw.text !== 'string') return null;
  const text = squash(raw.text).slice(0, MAX_MESSAGE_CHARS);
  if (!text) return null;
  const speaker = typeof raw.speaker === 'string' ? squash(raw.speaker).slice(0, MAX_SPEAKER_CHARS) : '';
  const seconds = finite(raw.seconds) ? Math.min(MAX_MESSAGE_SECONDS, Math.max(MIN_MESSAGE_SECONDS, raw.seconds)) : DEFAULT_MESSAGE_SECONDS;
  return { text, ...(speaker ? { speaker } : {}), seconds };
}

/** The message to draw at scene time `now` (null = none, or its time is up). */
export function activeMessage(message: GameMessage | null | undefined, now: number): GameMessage | null {
  return message && now < message.until ? message : null;
}
