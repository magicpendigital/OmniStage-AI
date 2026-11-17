/**
 * Phase 11B — the Writers' Room modal lives at the app root while storyboard generation lives in the chat panel. The chat
 * registers how to produce a film from an approved bible; the modal calls it when you press "Produce".
 */
import type { StoryBible } from '../types/scene.schema';
import type { WritersRoomSession } from './writersRoom';

export type RoomProducer = (session: WritersRoomSession, bible: StoryBible | undefined) => void;

let producer: RoomProducer | null = null;

export function registerRoomProducer(fn: RoomProducer | null): void {
  producer = fn;
}

/** Returns false when nothing is registered (the chat panel is not mounted). */
export function produceFromRoom(session: WritersRoomSession, bible: StoryBible | undefined): boolean {
  if (!producer) return false;
  producer(session, bible);
  return true;
}
