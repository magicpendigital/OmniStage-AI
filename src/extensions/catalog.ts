/**
 * Phase 6 — Built-in extension catalog (curated, ships with OmniStage). Installing still goes through the same
 * review & approval dialog as third-party extensions, so users see exactly what each pack adds.
 */
import type { ExtensionManifest } from './types';

const LEVEL_TOOL_SOURCE = String.raw`
// Level Layout Tool — runs inside OmniStage's sandbox. It only talks to the studio through window.omni.
const STEP_UP = 95;   // stays under the verifier's 125 px step-up
const GAP = 150;      // stays under the verifier's 309 px gap

function platform(id, x, y, w) {
  return { id, name: 'Ledge ' + id.slice(-2), type: 'tile-platform', x, y, width: w, height: 28, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#1E293B', stroke: '#22D3EE', strokeWidth: 2, shapeKind: 'rect', physics2D: 'static-platform' };
}
function star(id, x, y, value) {
  return { id, name: 'Star ' + id.slice(-2), type: 'vector-shape', x, y, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, fill: '#FBBF24', stroke: '#FEF08A', strokeWidth: 2, shapeKind: 'star', physics2D: 'collectible', scoreValue: value };
}

omni.registerCommand('staircase', async (args) => {
  const scene = await omni.scene.get();
  if (scene.engineType !== '2d') { await omni.notify('Switch to a 2D scene first.'); return 'skipped: not a 2D scene'; }
  const steps = Math.max(2, Math.min(6, Number(args && args.steps) || 4));
  const ground = scene.nodes2D.filter((n) => n.physics2D === 'static-platform').sort((a, b) => b.y - a.y)[0];
  const baseTop = ground ? ground.y - ground.height / 2 : 560;
  const added = [];
  let x = 260;
  for (let i = 0; i < steps; i++) {
    const w = 150;
    const y = baseTop - STEP_UP * (i + 1) + 14;
    const id = 'lvl-step-' + Date.now().toString(36) + '-' + i;
    added.push(platform(id, x + w / 2, y, w));
    added.push(star(id + '-star', x + w / 2, y - 60, 25));
    x += w + GAP;
    if (x > 900) x = 120;
  }
  const nodes = scene.nodes2D.concat(added);
  const total = nodes.filter((n) => n.physics2D === 'collectible').reduce((s, n) => s + (n.scoreValue || 25), 0);
  await omni.scene.applyPatch({ nodes2D: nodes, mode: 'game', gameRules: Object.assign({}, scene.gameRules, { targetScore: total }) }, 'Staircase level (' + steps + ' steps)');
  return 'Added ' + steps + ' ledges with stars; target score ' + total;
});

omni.registerCommand('star-trail', async () => {
  const scene = await omni.scene.get();
  if (scene.engineType !== '2d') return 'skipped: not a 2D scene';
  const plats = scene.nodes2D.filter((n) => n.physics2D === 'static-platform');
  const extra = plats.map((p, i) => star('trail-' + Date.now().toString(36) + '-' + i, p.x, p.y - p.height / 2 - 55, 10));
  await omni.scene.applyPatch({ nodes2D: scene.nodes2D.concat(extra) }, 'Star trail over every platform');
  return 'Added ' + extra.length + ' stars';
});
`;

export const EXTENSION_CATALOG: ExtensionManifest[] = [
  {
    id: 'pixel-retro-pack',
    name: 'Pixel Retro Pack',
    version: '1.0.0',
    description: '8-bit particle effects, chiptune-style sounds and a pixel-art direction skill for retro games.',
    author: 'OmniStage',
    kind: 'mixed',
    tags: ['pixel', 'retro', '8-bit', 'arcade', 'platformer', 'chiptune'],
    targets: { engines: ['2d'], modes: ['game'], genres: ['platformer', 'arcade', 'shooter'] },
    contributes: {
      skills: [
        {
          id: 'pixel-art-direction',
          title: 'Pixel Art Direction',
          description: 'Keeps a retro game visually and sonically consistent.',
          triggers: ['pixel', 'retro', '8-bit', '8 bit', 'arcade', 'nes', 'gameboy', 'cổ điển'],
          engine: '2d',
          mode: 'any',
          guidance: `PIXEL ART DIRECTION:
- Use a limited palette (4-8 colours), hard edges: shapeKind 'rect', no gradients, opacity 1.
- Sizes on an 8 px grid (width/height multiples of 8); fonts large and blocky (fontSize 32-64).
- Use particle presets 'pixel-rain', 'coin-shower', 'retro-explosion' and sounds '8bit-coin', '8bit-power', '8bit-hurt'.
- Keep motion snappy: keyframe eases 'linear' or 'power1.out', 0.15-0.3 s per move.`,
        },
      ],
      particlePresets: {
        'pixel-rain': { rate: 90, life: 1.1, speed: [380, 460], angle: [90, 92], gravity: 0, size: [3, 5], shape: 'pixel', colors: ['#38BDF8', '#7DD3FC'], alpha: 0.8, area: true },
        'coin-shower': { rate: 26, life: 1.4, speed: [120, 220], angle: [-120, -60], gravity: 420, size: [6, 8], shape: 'pixel', colors: ['#FACC15', '#FDE047', '#F59E0B'], fade: true, spread: 0.2 },
        'retro-explosion': { rate: 90, life: 0.6, speed: [120, 300], angle: [0, 360], gravity: 200, size: [5, 9], shape: 'pixel', colors: ['#F97316', '#EF4444', '#FDE047', '#FFFFFF'], burst: 0.8, fade: true },
      },
      sfxPresets: {
        '8bit-coin': { wave: 'square', notes: [1319, 1976], step: 0.06, dur: 0.22, vol: 0.18 },
        '8bit-power': { wave: 'square', notes: [262, 330, 392, 523, 659, 784], step: 0.05, dur: 0.36, vol: 0.16 },
        '8bit-hurt': { wave: 'sawtooth', f0: 440, f1: 90, dur: 0.25, vol: 0.16 },
      },
    },
  },
  {
    id: 'cinematic-trailer-kit',
    name: 'Cinematic Trailer Kit',
    version: '1.0.0',
    description: 'Trailer pacing skill plus atmospheric particles (dust, rising embers) and impact / riser sounds.',
    author: 'OmniStage',
    kind: 'mixed',
    tags: ['trailer', 'cinematic', 'film', 'teaser', 'promo', 'atmosphere'],
    targets: { modes: ['media'] },
    contributes: {
      skills: [
        {
          id: 'trailer-pacing',
          title: 'Trailer Pacing',
          description: 'Three-act trailer rhythm with title cards and impact beats.',
          triggers: ['trailer', 'teaser', 'promo video', 'giới thiệu', 'quảng bá', 'cinematic'],
          engine: 'any',
          mode: 'media',
          guidance: `TRAILER PACING:
- Act 1 (0-30%): slow reveal, wide shot, ambient particles ('dust-motes'); no title yet.
- Act 2 (30-75%): faster cuts every 1-1.5 s, camera pushes ('power3.out'), rising tension.
- Act 3 (75-100%): impact beat (sound 'impact-boom'), hero shot, then a title caption (style 'title') and CTA.
- Captions: max 6 words, one idea each. Leave 0.5 s of silence/black before the final title.`,
        },
      ],
      particlePresets: {
        'dust-motes': { rate: 14, life: 5, speed: [6, 18], angle: [0, 360], gravity: -2, size: [1.5, 3.5], shape: 'circle', colors: ['#FDE68A', '#FFFFFF'], alpha: 0.5, area: true, drift: 12, fade: true },
        'embers-rise': { rate: 22, life: 2.6, speed: [30, 70], angle: [-100, -80], gravity: -30, size: [2, 4], shape: 'circle', colors: ['#F97316', '#FB923C', '#FACC15'], additive: true, area: true, drift: 16, fade: true },
      },
      sfxPresets: {
        'impact-boom': { wave: 'noise', dur: 1.2, vol: 0.7, lp0: 900, lp1: 60 },
        'riser': { wave: 'sawtooth', f0: 110, f1: 880, dur: 1.6, vol: 0.12, attack: 1.2 },
      },
    },
  },
  {
    id: 'cozy-game-design',
    name: 'Cozy Game Design',
    version: '1.0.0',
    description: 'Design rules for calm, cosy games: farming, collecting, decorating — gentle loops and soft feedback.',
    author: 'OmniStage',
    kind: 'skill-pack',
    tags: ['cozy', 'farming', 'casual', 'relaxing', 'life-sim', 'collect'],
    targets: { modes: ['game'], genres: ['cozy', 'casual', 'farming'] },
    contributes: {
      skills: [
        {
          id: 'cozy-loop',
          title: 'Cozy Game Loop',
          description: 'Low-stress loops: no fail state, soft rewards, warm palette.',
          triggers: ['cozy', 'farm', 'farming', 'relax', 'calm', 'nông trại', 'thư giãn', 'dễ thương', 'cute'],
          engine: 'any',
          mode: 'game',
          guidance: `COZY GAME LOOP:
- Prefer winCondition 'collect-all' with a generous timeLimitSeconds (>= 90) or 'survive-timer'; avoid hazards.
- Warm pastel palette (#FDE68A, #FBCFE8, #BBF7D0, #BFDBFE), rounded shapes ('capsule', 'circle').
- Feedback is soft: sounds 'click' / 'coin' at masterVolume 0.4, particle 'sparkle' only, eases 'sine.inOut'.
- Pace: one new idea per scene; captions that encourage ("Nice harvest!").`,
        },
      ],
    },
  },
  {
    id: 'puzzle-design',
    name: 'Puzzle Design',
    version: '1.0.0',
    description: 'Teaches the director to build fair puzzle levels: introduce, combine, twist.',
    author: 'OmniStage',
    kind: 'skill-pack',
    tags: ['puzzle', 'logic', 'brain', 'level-design'],
    targets: { modes: ['game'], genres: ['puzzle'] },
    contributes: {
      skills: [
        {
          id: 'puzzle-progression',
          title: 'Puzzle Progression',
          description: 'Fair difficulty ramp for puzzle levels.',
          triggers: ['puzzle', 'logic', 'brain', 'câu đố', 'giải đố', 'trí tuệ'],
          engine: 'any',
          mode: 'game',
          guidance: `PUZZLE PROGRESSION:
- Level 1 introduces ONE mechanic with an obvious solution; level 2 tests it; level 3 combines it with another; later levels twist it.
- Show the goal before the player can act (camera or caption at 0-2 s).
- Never require pixel-perfect timing; every collectible must be reachable (the verifier checks this).
- Use logic graph conditions for switches/doors so the designer can tweak them visually.`,
        },
      ],
    },
  },
  {
    id: 'level-layout-tool',
    name: 'Level Layout Tool',
    version: '1.0.0',
    description: 'Code plugin (sandboxed): one-click platformer staircases and star trails that respect the verifier limits.',
    author: 'OmniStage',
    kind: 'tool',
    tags: ['platformer', 'level', 'generator', 'tool', '2d'],
    targets: { engines: ['2d'], modes: ['game'], genres: ['platformer'] },
    permissions: ['scene:read', 'scene:write', 'ui:notify'],
    contributes: {
      commands: [
        { id: 'staircase', title: 'Generate staircase level', description: 'Adds 4 reachable ledges with a star on each and sets the target score.' },
        { id: 'star-trail', title: 'Star trail over platforms', description: 'Adds a 10-point star above every platform.' },
      ],
    },
    mainSource: LEVEL_TOOL_SOURCE,
  },
  // Phase 6 Batch 3 — generation providers (BYO key; the OmniStage server proxies every call).
  {
    id: 'meshy-3d-generator',
    name: 'Meshy 3D Generator',
    version: '1.0.0',
    description: 'Text to 3D model (GLB) with Meshy: a mesh preview, then PBR textures. Uses your own Meshy API key; results land in My Library.',
    author: 'OmniStage',
    homepage: 'https://www.meshy.ai',
    kind: 'tool',
    tags: ['3d', 'model', 'generate', 'meshy', 'glb', 'prop', 'character'],
    targets: { engines: ['3d'] },
    permissions: ['generate'],
    contributes: {
      generators: [
        { id: 'meshy-text-to-3d', title: 'Meshy · text → textured 3D', description: 'About 2–4 minutes. Mesh preview + PBR texture stage.', provider: 'meshy', output: 'model', texture: true },
        { id: 'meshy-text-to-mesh', title: 'Meshy · text → untextured mesh (fast)', description: 'About 1 minute, fewer credits. Grey mesh only.', provider: 'meshy', output: 'model', texture: false },
      ],
    },
  },
  {
    id: 'tripo-3d-generator',
    name: 'Tripo 3D Generator',
    version: '1.0.0',
    description: 'Text to textured 3D model (GLB) with Tripo. Uses your own Tripo API key; results land in My Library.',
    author: 'OmniStage',
    homepage: 'https://www.tripo3d.ai',
    kind: 'tool',
    tags: ['3d', 'model', 'generate', 'tripo', 'glb', 'prop', 'character'],
    targets: { engines: ['3d'] },
    permissions: ['generate'],
    contributes: {
      generators: [{ id: 'tripo-text-to-3d', title: 'Tripo · text → textured 3D', description: 'About 1–2 minutes.', provider: 'tripo', output: 'model', texture: true }],
    },
  },
  {
    id: 'fal-sprite-generator',
    name: 'fal.ai Sprite Generator',
    version: '1.0.0',
    description: '2D game sprites from a prompt with FLUX on fal.ai, background removed to a transparent PNG. Uses your own fal.ai key.',
    author: 'OmniStage',
    homepage: 'https://fal.ai',
    kind: 'tool',
    tags: ['2d', 'sprite', 'image', 'generate', 'fal', 'flux', 'png'],
    targets: { engines: ['2d', '3d'] },
    permissions: ['generate'],
    contributes: {
      generators: [
        { id: 'fal-sprite', title: 'fal.ai · sprite (transparent PNG)', description: 'FLUX schnell + background removal, ~10 s.', provider: 'fal', output: 'image', model: 'fal-ai/flux/schnell', sprite: true, removeBackground: true },
        { id: 'fal-image', title: 'fal.ai · image / backdrop', description: 'FLUX schnell, full frame (backgrounds, textures, cards).', provider: 'fal', output: 'image', model: 'fal-ai/flux/schnell', sprite: false, removeBackground: false },
      ],
    },
  },
  {
    id: 'replicate-sprite-generator',
    name: 'Replicate Sprite Generator',
    version: '1.0.0',
    description: '2D sprites and images from a prompt with FLUX on Replicate. Uses your own Replicate API token.',
    author: 'OmniStage',
    homepage: 'https://replicate.com',
    kind: 'tool',
    tags: ['2d', 'sprite', 'image', 'generate', 'replicate', 'flux', 'png'],
    targets: { engines: ['2d', '3d'] },
    permissions: ['generate'],
    contributes: {
      generators: [{ id: 'replicate-sprite', title: 'Replicate · sprite on plain background', description: 'FLUX schnell, ~5 s. Plain background (no cut-out).', provider: 'replicate', output: 'image', model: 'black-forest-labs/flux-schnell', sprite: true }],
    },
  },
];
