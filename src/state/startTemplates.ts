/**
 * Start-screen templates: each one is a complete, verified SceneSpec in the right mode (game / media) and engine,
 * so "New project" never lands a game maker in a film scene. Pure (no store): `StartScreen` applies the result.
 */
import { SCENE_TEMPLATES, cloneSceneSpec, createBlankSceneSpec } from '../registry/assetRegistry';
import { autoFixSceneSpec } from '../verification/sceneVerifier';
import type { SceneSpec } from '../types/scene.schema';

export type StartTemplateId = 'playable-ad' | 'platformer-2d' | 'showcase-3d' | 'short-film';

export interface StartTemplate {
  id: StartTemplateId;
  title: string;
  blurb: string;
  /** Chips shown on the card. */
  tags: string[];
  /** Example sentence offered in "Describe it" when this card is the current pick. */
  example: string;
  /** Director intent for the Describe box when this card is picked. */
  intent: 'patch' | 'storyboard';
}

export const START_TEMPLATES: StartTemplate[] = [
  {
    id: 'playable-ad',
    title: 'Playable ad',
    blurb: 'A tap-to-play mobile ad with a score, a timer and a call-to-action end card.',
    tags: ['3D', 'Game', '9:16'],
    example: 'Make a 30-second playable ad for a sneaker brand: tap to collect glowing coins, big CTA at the end.',
    intent: 'patch',
  },
  {
    id: 'platformer-2d',
    title: '2D platformer',
    blurb: 'Run, jump and collect stars on platforms. Add levels and hazards with the AI.',
    tags: ['2D', 'Game', '16:9'],
    example: 'Make a 3-level 2D platformer with moving platforms, spikes and a boss at the end, pastel colours.',
    intent: 'patch',
  },
  {
    id: 'showcase-3d',
    title: '3D showcase',
    blurb: 'A cinematic product or character turntable with camera moves and captions.',
    tags: ['3D', 'Film', '9:16'],
    example: 'A luxury perfume bottle on a mirror pedestal, slow dolly-in, gold sparkles, caption "Pure. Bold. You."',
    intent: 'patch',
  },
  {
    id: 'short-film',
    title: 'Short film',
    blurb: 'A multi-scene story: the AI writes the script, then builds and cuts each scene.',
    tags: ['3D', 'Film', '16:9'],
    example: 'A 4-scene short film: a lonely robot finds a flower in a ruined city and carries it home.',
    intent: 'storyboard',
  },
];

function template(id: string): SceneSpec {
  const t = SCENE_TEMPLATES[id];
  if (!t) throw new Error(`Unknown scene template "${id}"`);
  const copy = cloneSceneSpec(t);
  copy.logicGraph = undefined; // regenerated from the scene on load
  return copy;
}

/** The scene a start card opens with (already auto-fixed, so it verifies clean). */
export function buildStartScene(id: StartTemplateId): SceneSpec {
  let spec: SceneSpec;
  switch (id) {
    case 'playable-ad':
      spec = template('coin-rush-playable');
      break;
    case 'showcase-3d':
      spec = template('luxury-product-commercial');
      break;
    case 'platformer-2d': {
      spec = createBlankSceneSpec('2d', '2D Platformer');
      spec.mode = 'game';
      spec.aspectRatio = '16:9';
      spec.gameRules = {
        ...spec.gameRules,
        winCondition: 'score-threshold',
        targetScore: (spec.nodes2D.find((n) => n.physics2D === 'collectible')?.scoreValue ?? 10) || 10,
        timeLimitSeconds: 60,
        instructions: 'A / D to run, Space to jump. Collect the star!',
      };
      break;
    }
    case 'short-film':
    default:
      spec = createBlankSceneSpec('3d', 'Short film');
      spec.mode = 'media';
      spec.aspectRatio = '16:9';
      spec.durationSeconds = 12;
      break;
  }
  return autoFixSceneSpec(spec).spec;
}

/** Which card best fits a free-text idea (used by the "Describe it" box; the AI then reshapes the scene). */
export function pickTemplate(idea: string): StartTemplate {
  const t = idea.toLowerCase();
  const by = (id: StartTemplateId) => START_TEMPLATES.find((x) => x.id === id)!;
  if (/\b(film|movie|story|scenes?|trailer|cinematic short|short film|episode)\b/.test(t)) return by('short-film');
  if (/\b(2d|platformer|side[- ]scroll|pixel|runner|metroidvania)\b/.test(t)) return by('platformer-2d');
  if (/\b(showcase|product|turntable|commercial|render|logo|reveal|unbox)\b/.test(t) && !/\b(game|playable|tap|collect)\b/.test(t)) return by('showcase-3d');
  return by('playable-ad');
}
