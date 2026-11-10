import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_CATALOG } from '../src/extensions/catalog';
import { reviewExtension, validateManifest } from '../src/extensions/validate';
import { attachExtensionRecipes, enabledContributions, recommendExtensions } from '../src/extensions/registry';
import { buildSandboxDocument } from '../src/extensions/sandboxHost';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';
import { autoFixSceneSpec, verifySceneSpec } from '../src/verification/sceneVerifier';
import { createParticle2DRuntime } from '../src/vfx/particles2D';
import { createOmniSfxPlayer } from '../src/audio/sfxRuntime';
import { generateStandaloneHTMLContent } from '../src/exporter/mediaExporter';
import { PLAYER_RUNTIME } from '../src/exporter/generated/playerRuntime';
import { buildMemoryContext, parseExplicitMemory, selectMemories, suggestMemory } from '../src/agent/memory';
import type { InstalledExtension } from '../src/extensions/types';

test('every catalog extension is valid and reviewed', () => {
  for (const m of EXTENSION_CATALOG) {
    assert.deepEqual(validateManifest(m), [], m.id);
    const r = reviewExtension(m);
    assert.equal(r.risk, m.mainSource ? 'medium' : 'low', m.id);
  }
});

test('review flags risky code and validation catches bad manifests', () => {
  const evil = { ...EXTENSION_CATALOG[4], id: 'evil', mainSource: 'eval(atob("x")); fetch("https://x.y"); parent.document.cookie' };
  const r = reviewExtension(evil);
  assert.equal(r.risk, 'high');
  assert.ok(r.findings.some((f) => /eval/.test(f.message)));
  assert.ok(r.findings.some((f) => /network/.test(f.message)));
  const errors = validateManifest({ id: 'x', name: '', version: '1', kind: 'weird', permissions: ['network', 'root'], contributes: { particlePresets: { 'Bad Id': { rate: 9999 } } } });
  assert.ok(errors.length >= 6, errors.join(' | '));
});

function installed(id: string, enabled = true): InstalledExtension {
  const manifest = EXTENSION_CATALOG.find((m) => m.id === id)!;
  return { manifest, enabled, installedAt: '', source: 'builtin-catalog', approvedPermissions: manifest.permissions || [] };
}

test('contributions respect enable switches and project overrides', () => {
  const list = [installed('pixel-retro-pack'), installed('cozy-game-design', false), installed('level-layout-tool')];
  const c = enabledContributions(list);
  assert.ok(c.particlePresets['coin-shower'] && c.sfxPresets['8bit-coin']);
  assert.ok(c.skills.some((s) => s.id === 'ext-pixel-retro-pack-pixel-art-direction'));
  assert.ok(!c.skills.some((s) => s.id.includes('cozy')));
  assert.equal(c.commands.length, 2);
  assert.ok(enabledContributions(list, ['cozy-game-design']).skills.some((s) => s.id.includes('cozy')), 'project can enable a globally disabled extension');
});

test('extension presets travel with the scene: verifier, runtime and export', () => {
  const c = enabledContributions([installed('pixel-retro-pack')]);
  const spec = createBlankSceneSpec('2d');
  spec.nodes2D.push({ id: 'fx', name: 'FX', type: 'particle-emitter', x: 500, y: 300, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '', stroke: '', physics2D: 'none', emitter: { preset: 'coin-shower' } });
  spec.audio = { enabled: true, masterVolume: 0.5, cues: { collect: '8bit-coin' } };
  assert.ok(verifySceneSpec(spec).issues.some((i) => i.code === '2d.unknown-particle'), 'unknown before recipes are attached');
  assert.deepEqual(attachExtensionRecipes(spec, c).sort(), ['8bit-coin', 'coin-shower']);
  assert.equal(verifySceneSpec(spec).issues.length, 0, JSON.stringify(verifySceneSpec(spec).issues));
  assert.equal(autoFixSceneSpec(spec).spec.audio!.cues.collect, '8bit-coin', 'auto-fix keeps library cues');

  const rt = createParticle2DRuntime(spec.particleLibrary);
  assert.ok(rt.presets.includes('coin-shower'));
  assert.ok(rt.particlesAt('coin-shower', 1, 0.5, 100, 100).length > 0);
  assert.ok(createOmniSfxPlayer(spec.sfxLibrary).presets.includes('8bit-coin'));

  const html = generateStandaloneHTMLContent(spec, 'universal', [spec], { playerRuntimeSource: PLAYER_RUNTIME });
  assert.ok(html.includes('"coin-shower"') && html.includes('"8bit-coin"'), 'export inlines the scene libraries');
});

test('recommendations match prompt / project tags and skip installed ones', () => {
  const ctx = { engineType: '2d', mode: 'game' };
  const recs = recommendExtensions('Make a retro pixel platformer with 8-bit sounds', ctx, EXTENSION_CATALOG, []);
  assert.equal(recs[0].manifest.id, 'pixel-retro-pack');
  assert.ok(recs[0].reason.length > 0);
  assert.equal(recommendExtensions('Make a retro pixel platformer', ctx, EXTENSION_CATALOG, ['pixel-retro-pack']).some((r) => r.manifest.id === 'pixel-retro-pack'), false);
  assert.ok(recommendExtensions('a calm game', { ...ctx, projectTags: ['cozy', 'farming'] }, EXTENSION_CATALOG, []).some((r) => r.manifest.id === 'cozy-game-design'));
  assert.deepEqual(recommendExtensions('rename the scene', ctx, EXTENSION_CATALOG, []), []);
});

test('sandbox document blocks network via CSP and neutralises </script>', () => {
  const doc = buildSandboxDocument('omni.log("</script><script>alert(1)</script>")');
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"/);
  assert.ok(!doc.includes('</script><script>alert(1)'), 'plugin cannot break out of its script tag');
  assert.ok(doc.includes('window.omni'));
});

test('memory: explicit commands, suggestions, relevance and prompt rendering', () => {
  assert.equal(parseExplicitMemory('nhớ rằng tôi làm game cho trẻ em'), 'tôi làm game cho trẻ em');
  assert.equal(parseExplicitMemory('Remember: my brand colour is teal.'), 'my brand colour is teal');
  assert.equal(parseExplicitMemory('make a forest scene'), null);
  assert.equal(suggestMemory('Tạo màn mới. Tôi luôn thích bảng màu pastel cho game của mình.')?.text, 'Tôi luôn thích bảng màu pastel cho game của mình');
  assert.equal(suggestMemory('I prefer short 15 second ads')?.kind, 'preference');
  assert.equal(suggestMemory('add three stars'), null);

  const base = { source: 'explicit' as const, uses: 0, createdAt: '', updatedAt: '2026-01-01' };
  const entries = [
    { ...base, id: 'a', kind: 'style' as const, text: 'Pastel palette for every cozy game', scope: 'global', pinned: false },
    { ...base, id: 'b', kind: 'constraint' as const, text: 'No violence', scope: 'global', pinned: true },
    { ...base, id: 'c', kind: 'fact' as const, text: 'Neon runner uses cyan and magenta', scope: 'neon-runner', pinned: false },
    { ...base, id: 'd', kind: 'fact' as const, text: 'Other project secret', scope: 'other', pinned: false },
  ];
  const picked = selectMemories('make a cozy farm level with pastel colours', entries, 'neon-runner').map((e) => e.id);
  assert.equal(picked[0], 'b', 'pinned first');
  assert.equal(picked[1], 'a', 'keyword overlap next');
  assert.ok(!picked.includes('d'), 'other projects never leak');
  assert.match(buildMemoryContext(entries.slice(0, 2)), /\[constraint\] No violence/);
});
