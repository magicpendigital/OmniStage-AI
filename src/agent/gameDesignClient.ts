/**
 * Phase 4 — client side of the game designer: turns a GameDesignAskRequest into the call to /api/agent/game/design with the
 * user's AI connection headers, and hands the approved design from the review modal (app root) to the chat panel (which owns
 * storyboard generation), like the Writers' Room bridge.
 */
import { aiHeaders } from './aiClient';
import type { GameDesignAskRequest, GameDesignSession } from './gameDesign';
import type { GameDesign, SettingsConfig } from '../types/scene.schema';

export type GameDesignSettings = Pick<SettingsConfig, 'geminiModel' | 'customSystemPrompt' | 'aiProvider' | 'aiModels' | 'aiApiKeys' | 'aiBaseUrl' | 'aiFallbackEnabled' | 'aiFallbackOrder'>;

export function makeGameDesignAsk(
  settings: GameDesignSettings,
  prompt: string,
  intent: GameDesignSession['intent'],
  signal?: AbortSignal
): (req: GameDesignAskRequest) => Promise<unknown> {
  return async (req) => {
    const response = await fetch('/api/agent/game/design', {
      method: 'POST',
      headers: aiHeaders(settings),
      body: JSON.stringify({ prompt, intent, ...req, model: settings.geminiModel, customSystemPrompt: settings.customSystemPrompt }),
      signal,
    });
    if (!response.ok) throw new Error(`game design returned ${response.status}`);
    return response.json();
  };
}

export type GameDesignProducer = (session: GameDesignSession, design: GameDesign) => void;

let producer: GameDesignProducer | null = null;

export function registerGameDesignProducer(fn: GameDesignProducer | null): void {
  producer = fn;
}

/** Returns false when nothing is registered (the chat panel is not mounted). */
export function produceFromGameDesign(session: GameDesignSession, design: GameDesign): boolean {
  if (!producer) return false;
  producer(session, design);
  return true;
}
