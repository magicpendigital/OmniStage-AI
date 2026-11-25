import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ASSET_REGISTRY, SCENE_TEMPLATES, cloneSceneSpec, createBlankSceneSpec } from '../src/registry/assetRegistry';
import { syncGraphWithScene } from '../src/runtime/graphSync';
import type { Node2D, SceneSpec } from '../src/types/scene.schema';
import {
  GODOT_NOTES_FILE,
  buildGodotProject,
  buildGodotZip,
  compileLogicRules,
  gdString,
  godotNodeName,
  lookAtBasisRows,
  threeEulerToBasisRows,
  transform3D,
} from '../src/exporter/godotExport';
import { GODOT_GAME_SCRIPT, GODOT_PLAYER_2D_SCRIPT, GODOT_PLAYER_3D_SCRIPT } from '../src/exporter/godotTemplates';

const text = (build: ReturnType<typeof buildGodotProject>, name: string) => {
  const file = build.files.find((f) => f.name === name);
  assert.ok(file, `missing ${name}`);
  return typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content);
};
const sceneFile = (build: ReturnType<typeof buildGodotProject>, index = 0) => text(build, build.scenes[index].path);

/** `[node ...]` headers → { name, type, parent } (string attributes unescaped). */
function nodeHeaders(tscn: string) {
  const attr = (line: string, key: string) => {
    const m = new RegExp(`\\s${key}="((?:[^"\\\\]|\\\\.)*)"`).exec(line);
    return m ? JSON.parse(`"${m[1]}"`) as string : undefined;
  };
  return tscn.split('\n').filter((l) => l.startsWith('[node ')).map((l) => ({ name: attr(l, 'name')!, type: attr(l, 'type'), parent: attr(l, 'parent'), line: l }));
}

/** Property block under the node with this name (and parent). */
function nodeBlock(tscn: string, name: string, parent?: string) {
  const blocks = tscn.split('\n\n');
  const block = blocks.find((b) => {
    const header = nodeHeaders(b)[0];
    return header && header.name === name && (parent === undefined || header.parent === parent);
  });
  assert.ok(block, `node ${name} not found`);
  return block;
}

/** Every line of a text resource keeps its quotes balanced (no raw newline inside a string). */
function assertBalancedQuotes(source: string) {
  for (const line of source.split('\n')) {
    let open = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && open) { i++; continue; }
      if (line[i] === '"') open = !open;
    }
    assert.equal(open, false, `unbalanced quotes in line: ${line}`);
  }
}

const coinRush = () => cloneSceneSpec(SCENE_TEMPLATES['coin-rush-playable']);

function platformer2D(title = 'Platform Quest'): SceneSpec {
  const scene = createBlankSceneSpec('2d', title);
  scene.mode = 'game';
  scene.gameRules = { winCondition: 'score-threshold', targetScore: 50, timeLimitSeconds: 30, instructions: 'Run & jump' };
  const base: Omit<Node2D, 'id' | 'name' | 'type' | 'x' | 'y' | 'physics2D'> = {
    width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#FBBF24', stroke: '#FFFFFF',
  };
  scene.nodes2D.push(
    { ...base, id: 'coin-a', name: 'Coin A', type: 'vector-shape', x: 600, y: 440, shapeKind: 'star', physics2D: 'collectible', scoreValue: 30 },
    { ...base, id: 'title', name: 'Title', type: 'text-kinetic', x: 500, y: 80, width: 400, height: 60, rotation: 90, text: 'Level "One"', fontSize: 40, physics2D: 'none' },
    { ...base, id: 'img', name: 'Logo', type: 'sprite-actor', x: 900, y: 80, width: 64, height: 32, scaleX: 2, physics2D: 'none',
      // 1 x 1 PNG
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
  );
  return scene;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

test('Three.js XYZ Euler converts to Godot basis rows (handedness and order)', () => {
  const close = (a: number[][], b: number[][]) => a.flat().forEach((v, i) => assert.ok(Math.abs(v - b.flat()[i]) < 1e-9, `${a} vs ${b}`));
  // +90 deg about Y maps local +X to world -Z (right-handed, same in both engines).
  close(threeEulerToBasisRows([0, Math.PI / 2, 0]), [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]);
  close(threeEulerToBasisRows([Math.PI / 2, 0, 0]), [[1, 0, 0], [0, 0, -1], [0, 1, 0]]);
  // Order matters: XYZ = Rx * Ry * Rz (not Godot's default YXZ).
  const [x, y] = [0.4, 0.9];
  const rx = [[1, 0, 0], [0, Math.cos(x), -Math.sin(x)], [0, Math.sin(x), Math.cos(x)]];
  const ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const mul = (a: number[][], b: number[][]) => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
  close(threeEulerToBasisRows([x, y, 0]), mul(rx, ry));
  // Scale multiplies basis columns; origin is written last.
  assert.equal(transform3D(threeEulerToBasisRows([0, Math.PI / 2, 0]), [1, 2, 3], [2, 1, 1]).text, 'Transform3D(0, 0, 1, 0, 1, 0, -2, 0, 0, 1, 2, 3)');
  // A camera at (0, 4, 4) looking at the origin is pitched down 45 deg and faces -Z.
  const cam = lookAtBasisRows([0, 4, 4], [0, 0, 0]);
  close(cam, [[1, 0, 0], [0, Math.SQRT1_2, Math.SQRT1_2], [0, -Math.SQRT1_2, Math.SQRT1_2]]);
});

// ---------------------------------------------------------------------------
// 3D fixture
// ---------------------------------------------------------------------------

test('3D scene: project.godot, node types, transforms, materials and gameplay metadata', () => {
  const scene = coinRush();
  const coin = scene.actors.find((a) => a.physicsRole === 'collectible')!;
  coin.rotation = [0, Math.PI / 2, 0];
  coin.position = [1.5, 0.25, -2];
  const player = scene.actors.find((a) => a.physicsRole === 'player')!;
  const modelUrl = player.customGlbUrl || player.modelUrl || ASSET_REGISTRY[player.assetId]!.modelUrl!;
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
  const build = buildGodotProject([scene], { assets: { [modelUrl]: { bytes: glb } } });

  const project = text(build, 'project.godot');
  assert.match(project, /^config_version=5$/m);
  assert.match(project, new RegExp(`^run/main_scene="res://${build.scenes[0].path}"$`, 'm'));
  assert.match(project, /config\/features=PackedStringArray\("4\.3", "Forward Plus"\)/);
  assert.match(project, /window\/size\/viewport_width=720\nwindow\/size\/viewport_height=1280/); // 9:16 template
  assert.match(project, /window\/handheld\/orientation=1/);

  const tscn = sceneFile(build);
  assert.match(tscn, /^\[gd_scene load_steps=\d+ format=3\]/);
  const steps = Number(/load_steps=(\d+)/.exec(tscn)![1]);
  assert.equal(steps, (tscn.match(/^\[(ext|sub)_resource /gm) || []).length + 1);
  assertBalancedQuotes(tscn);
  const headers = nodeHeaders(tscn);
  assert.equal(headers[0].type, 'Node3D');
  assert.equal(headers[0].parent, undefined);
  const types = new Set(headers.map((h) => h.type));
  for (const t of ['WorldEnvironment', 'DirectionalLight3D', 'Camera3D', 'CharacterBody3D', 'Area3D', 'CollisionShape3D', 'MeshInstance3D', 'StaticBody3D']) {
    assert.ok(types.has(t), `missing ${t}`);
  }
  assert.match(tscn, /\[sub_resource type="Environment"[^\]]*\][^[]*fog_enabled = true/);
  assert.match(tscn, /\[sub_resource type="ProceduralSkyMaterial"/);

  // Coin: Area3D with the rotated basis rows and the authored position.
  const coinBlock = nodeBlock(tscn, coin.name, '.');
  assert.match(coinBlock, /type="Area3D"/);
  assert.match(coinBlock, /transform = Transform3D\(0, 0, 1, 0, 1, 0, -1, 0, 0, 1\.5, 0\.25, -2\)/);
  assert.match(coinBlock, /metadata\/omni_role = "collectible"/);
  assert.match(coinBlock, new RegExp(`metadata/omni_id = "${coin.id}"`));

  // Player: CharacterBody3D in the player group with the movement script and the embedded GLB.
  const playerBlock = nodeBlock(tscn, godotNodeName(player.name), '.');
  assert.match(playerBlock, /type="CharacterBody3D"/);
  assert.match(playerBlock, /groups=\["omni_player"\]/);
  assert.match(playerBlock, /script = ExtResource\("\d+_script"\)/);
  const glbFile = build.files.find((f) => f.name.startsWith('models/') && f.name.endsWith('.glb'));
  assert.ok(glbFile, 'GLB copied into the project');
  assert.match(tscn, new RegExp(`\\[ext_resource type="PackedScene" path="res://${glbFile.name}"`));
  assert.match(tscn, new RegExp(`\\[node name="Model" parent="${godotNodeName(player.name).replace(/[()]/g, '\\$&')}" instance=ExtResource`));

  // Primitive actors keep colour / metalness / roughness.
  const hazard = scene.actors.find((a) => a.physicsRole === 'hazard')!;
  assert.match(tscn, new RegExp(`metallic = ${hazard.metalness}\\nroughness = ${hazard.roughness}`));
  // Root carries the scene rules as exported properties.
  const root = nodeBlock(tscn, headers[0].name);
  assert.match(root, /mode = "game"/);
  assert.match(root, new RegExp(`target_score = ${scene.gameRules.targetScore}`));
  assert.match(root, /win_condition = "score-threshold"/);
});

test('3D: logic graph rules mirror the runtime walk (conditions, actor wires, unsupported nodes stop)', () => {
  const scene = syncGraphWithScene(coinRush());
  const warnings: string[] = [];
  const rules = compileLogicRules(scene, (_f, d) => warnings.push(d));
  const start = rules.find((r) => r.event === 'scene-start')!;
  const click = rules.find((r) => r.event === 'actor-click')!;
  assert.ok(start && click);
  // scene-start → world stage (declarative, no step) → camera track (fov) → robot servo (stops).
  assert.deepEqual((start.steps as any[]).map((s) => s.type), ['fov']);
  assert.ok(warnings.some((w) => w.includes('robot / hardware')));
  assert.ok(warnings.some((w) => w.includes('camera move')));
  // actor click → clip + score → score gate → (true) CTA media pipeline is not translatable.
  const steps = click.steps as any[];
  const types = steps.map((s) => s.type);
  assert.ok(types.includes('add-score'));
  assert.equal(types.at(-1), 'score-gate');
  assert.equal(click.actor, scene.actors[0].id);
  assert.ok(warnings.some((w) => w.includes('media-pipeline step')));
  // The tscn stores the rules on the root.
  const tscn = sceneFile(buildGodotProject([scene]));
  assert.match(tscn, /logic_rules = \[\{\n"event": "scene-start"/);
  assertBalancedQuotes(tscn);
});

test('3D: condition outputs become step requirements (true / false ports)', () => {
  const scene = coinRush();
  const flow = (id: string) => ({ id, label: id, dataType: 'flow' as const });
  scene.logicGraph = {
    nodes: [
      { id: 't', type: 'trigger', title: 'Key', category: 'event-trigger', position: { x: 0, y: 0 }, inputs: [], outputs: [flow('out')], params: { eventType: 'on-key-press', key: 'KeyJ' } },
      { id: 'c', type: 'condition', title: 'Gate', category: 'logic-gate', position: { x: 0, y: 0 }, inputs: [flow('in')], outputs: [flow('out-true'), flow('out-false')], params: { conditionType: 'score-threshold', targetScore: 40 } },
      { id: 'yes', type: 'action', title: 'Yes', category: 'actor-action', position: { x: 0, y: 0 }, inputs: [flow('in')], outputs: [], params: { scoreDelta: 5 } },
      { id: 'no', type: 'action', title: 'No', category: 'actor-action', position: { x: 0, y: 0 }, inputs: [flow('in')], outputs: [], params: { actorId: scene.actors[1].id, position: [1, 0, 2] } },
    ],
    edges: [
      { id: 'e1', sourceNodeId: 't', sourcePortId: 'out', targetNodeId: 'c', targetPortId: 'in' },
      { id: 'e2', sourceNodeId: 'c', sourcePortId: 'out-true', targetNodeId: 'yes', targetPortId: 'in' },
      { id: 'e3', sourceNodeId: 'c', sourcePortId: 'out-false', targetNodeId: 'no', targetPortId: 'in' },
    ],
  };
  const [rule] = compileLogicRules(scene, () => undefined);
  assert.equal(rule.event, 'key-press');
  assert.equal(rule.key, 'j');
  const steps = rule.steps as any[];
  assert.deepEqual(steps[0], { type: 'score-gate', value: 40 });
  assert.deepEqual(steps[1], { type: 'add-score', value: 5, needs: [[0, true]] });
  assert.equal(steps[2].type, 'move');
  assert.deepEqual(steps[2].needs, [[0, false]]);
  assert.equal(steps[2].position.text, 'Vector3(1, 0, 2)');
});

// ---------------------------------------------------------------------------
// 2D fixture
// ---------------------------------------------------------------------------

test('2D scene: Node2D root, platforms, player, collectible, label, sprite and radians', () => {
  const build = buildGodotProject([platformer2D()]);
  const project = text(build, 'project.godot');
  assert.match(project, /window\/size\/viewport_width=1000\nwindow\/size\/viewport_height=600/);
  assert.match(project, /GL Compatibility/);

  const tscn = sceneFile(build);
  assertBalancedQuotes(tscn);
  const headers = nodeHeaders(tscn);
  assert.equal(headers[0].type, 'Node2D');
  const byName = (name: string) => headers.find((h) => h.name === name && h.parent === '.')!;
  assert.equal(byName('Base Arena Platform').type, 'StaticBody2D');
  assert.equal(byName('2D Player Hero').type, 'CharacterBody2D');
  assert.equal(byName('Coin A').type, 'Area2D');
  assert.equal(byName('Title').type, 'Node2D');
  assert.ok(headers.some((h) => h.type === 'Camera2D'));
  assert.ok(headers.some((h) => h.type === 'ColorRect'));

  assert.match(nodeBlock(tscn, 'Collision', 'Base Arena Platform'), /one_way_collision = true/);
  const player = nodeBlock(tscn, '2D Player Hero', '.');
  assert.match(player, /position = Vector2\(240, 420\)/);
  assert.match(player, /control = "platformer"/);
  assert.match(player, /groups=\["omni_player"\]/);
  const coin = nodeBlock(tscn, 'Coin A', '.');
  assert.match(coin, /metadata\/omni_score = 30/);
  assert.match(nodeBlock(tscn, 'Shape', 'Coin A'), /type="Polygon2D"/);
  // Rotation in radians (90 deg) and escaped label text.
  const title = nodeBlock(tscn, 'Title', '.');
  assert.match(title, /rotation = 1\.570796/);
  assert.match(nodeBlock(tscn, 'Label', 'Title'), /text = "Level \\"One\\""/);
  // Embedded data: PNG → Sprite2D sized from the PNG header (1 x 1 px → 128 x 32 with scaleX 2).
  const png = build.files.find((f) => f.name.startsWith('textures/') && f.name.endsWith('.png'));
  assert.ok(png);
  const sprite = nodeBlock(tscn, 'Sprite', 'Logo');
  assert.match(sprite, /type="Sprite2D"/);
  assert.match(sprite, /scale = Vector2\(128, 32\)/);
  // Root: game rules.
  assert.match(nodeBlock(tscn, headers[0].name), /is_2d = true\n/);
});

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

test('user strings are escaped in tscn / project.godot and never reach the GDScript files', () => {
  const evil = 'Boss "Level"] \\ path\nline2\t@x:y/z%';
  const scene = coinRush();
  scene.title = evil;
  scene.gameRules.instructions = 'Line 1\nLine "2" [node name="Hack"]';
  scene.actors[0].name = evil;
  scene.actors[0].id = 'id "with" quotes\\';
  scene.marketingOverlay = { ...scene.marketingOverlay, enabled: true, ctaUrl: 'javascript:alert(1)', triggerCondition: 'on-win' };
  const build = buildGodotProject([scene]);
  const tscn = sceneFile(build);
  assertBalancedQuotes(tscn);
  assertBalancedQuotes(text(build, 'project.godot'));
  assert.equal(nodeHeaders(tscn).filter((h) => h.name === 'Hack').length, 0);
  assert.match(tscn, /instructions = "Line 1\\nLine \\"2\\" \[node name=\\"Hack\\"\]"/);
  assert.match(tscn, /metadata\/omni_id = "id \\"with\\" quotes\\\\"/);
  assert.match(text(build, 'project.godot'), /config\/name="Boss \\"Level\\"\] \\\\ path\\nline2\\t@x:y\/z%"/);
  // Node names drop the characters Godot forbids.
  const actorNode = nodeHeaders(tscn).find((h) => h.line.includes('CharacterBody3D'))!;
  assert.doesNotMatch(actorNode.name, /[.:@/"%\n]/);
  // Unsafe CTA links are dropped.
  assert.match(tscn, /cta_url = ""/);
  // Scripts are the fixed templates.
  assert.equal(text(build, 'scripts/omni_game.gd'), GODOT_GAME_SCRIPT);
  assert.equal(text(build, 'scripts/omni_player_3d.gd'), GODOT_PLAYER_3D_SCRIPT);
  assert.equal(text(build, 'scripts/omni_player_2d.gd'), GODOT_PLAYER_2D_SCRIPT);
  for (const script of [GODOT_GAME_SCRIPT, GODOT_PLAYER_2D_SCRIPT, GODOT_PLAYER_3D_SCRIPT]) {
    assert.ok(!script.includes('Boss'));
    assert.ok(!script.includes('${'));
    assert.match(script, /^extends /);
  }
  assert.equal(gdString('a"b\\c\nd\u0001'), '"a\\"b\\\\c\\nd\\u0001"');
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

test('unmapped features become warnings and are listed in the notes file', () => {
  const scene = syncGraphWithScene(coinRush());
  scene.soundtrack = { music: { mood: 'happy' } };
  scene.dialogue = [{ id: 'l1', time: 0, speaker: scene.actors[0].id, text: 'Hi' }];
  scene.captions = [{ start: 0, end: 1, text: 'Hello' }];
  scene.camera.keyframes = [{ time: 0, position: [0, 1, 5], target: [0, 0, 0] }];
  scene.world.weather = { type: 'rain', intensity: 0.5 };
  const build = buildGodotProject([scene]);
  const features = new Set(build.warnings.map((w) => w.feature));
  for (const f of ['VFX', 'Audio', 'Dialogue', 'Captions', 'Camera', 'World', 'Logic graph', 'Models']) assert.ok(features.has(f), `no ${f} warning`);
  const notes = text(build, GODOT_NOTES_FILE);
  assert.match(notes, /## Not converted/);
  for (const w of build.warnings) assert.ok(notes.includes(w.feature), `notes miss ${w.feature}`);
  assert.match(notes, /robot \/ hardware/);

  // A scene with nothing unmapped says so.
  const plain = createBlankSceneSpec('2d', 'Plain');
  plain.nodes2D = plain.nodes2D.filter((n) => n.physics2D !== 'collectible');
  const clean = buildGodotProject([plain]);
  assert.deepEqual(clean.warnings, []);
  assert.match(text(clean, GODOT_NOTES_FILE), /Nothing: every feature/);
});

test('state machines and shader effects are reported as not converted (3D and 2D)', () => {
  const scene = coinRush();
  scene.actors[0].stateMachine = { initial: 'idle', states: { idle: { transitions: [{ to: 'idle', when: { type: 'timer', seconds: 1 } }] } } };
  scene.actors[0].shaderEffect = { preset: 'hologram' };
  const build = buildGodotProject([scene]);
  const sm = build.warnings.find((w) => w.feature === 'State machines');
  const fx = build.warnings.find((w) => w.feature === 'Shader effects');
  assert.ok(sm && sm.detail.includes('not converted'), 'state machine warning');
  assert.ok(fx && fx.detail.includes('hologram'), 'shader warning');
  const notes = text(build, GODOT_NOTES_FILE);
  assert.match(notes, /State machines/);
  assert.match(notes, /Shader effects/);

  const flat = platformer2D();
  flat.nodes2D.find((n) => n.id === 'coin-a')!.stateMachine = { initial: 'a', states: { a: {} } };
  const flatBuild = buildGodotProject([flat]);
  assert.ok(flatBuild.warnings.some((w) => w.feature === 'State machines' && w.detail.includes('Coin A')));
  assert.ok(!flatBuild.warnings.some((w) => w.feature === 'Shader effects'));
});

test('logic-graph send-signal is reported and the chain continues', () => {
  const scene = syncGraphWithScene(coinRush());
  const graph = scene.logicGraph!;
  const trigger = graph.nodes.find((n) => n.type === 'trigger')!;
  const action = graph.nodes.find((n) => n.type !== 'trigger' && n.type !== 'condition' && n.outputs.length === 0)!;
  const signal = { ...action, id: 'sig', title: 'Signal', params: { actionType: 'send-signal', signal: 'alarm' } };
  graph.nodes.push(signal);
  graph.edges.push({ id: 'e-sig', sourceNodeId: trigger.id, sourcePortId: trigger.outputs[0].id, targetNodeId: 'sig', targetPortId: signal.inputs[0].id });
  const warnings: string[] = [];
  compileLogicRules(scene, (_f, d) => warnings.push(d));
  assert.ok(warnings.some((w) => w.includes('send-signal') && w.includes('state machines')), warnings.join(' | '));
  assert.ok(!warnings.some((w) => w.includes('send-signal') && w.includes('no runtime effect')), 'send-signal is a known action, not "unsupported"');
});

test('JPEG panorama skybox (hdri.format "image") is embedded as the panorama sky', () => {
  const scene = coinRush();
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 8, 0, 16, 1, 1, 17, 0, 0xff, 0xd9]);
  scene.world.hdri = { url: 'https://example.com/sky.jpg', name: 'Blockade sky', source: 'custom', showBackground: true, intensity: 1, format: 'image' };
  const build = buildGodotProject([scene], { assets: { 'https://example.com/sky.jpg': { bytes: jpg } } });
  assert.ok(!build.warnings.some((w) => w.feature === 'HDRI'), 'no HDRI warning');
  const tex = build.files.find((f) => /^textures\/sky-[0-9a-f]{8}\.jpg$/.test(f.name));
  assert.ok(tex, 'jpg texture copied into the project');
  const tscn = sceneFile(build);
  assert.match(tscn, /PanoramaSkyMaterial/);
  assert.ok(tscn.includes(`res://${tex.name}`));
  // Not embeddable (HTML error page saved as the sky): reported, procedural sky used.
  const bad = buildGodotProject([scene], { assets: { 'https://example.com/sky.jpg': { bytes: new TextEncoder().encode('<html>nope</html>') } } });
  assert.ok(bad.warnings.some((w) => w.feature === 'HDRI'));
});

test('failed downloads and non-embeddable models are reported, not dropped', () => {
  const scene = coinRush();
  const player = scene.actors.find((a) => a.physicsRole === 'player')!;
  player.customGlbUrl = 'https://example.com/hero.gltf';
  const build = buildGodotProject([scene], {
    assets: { 'https://example.com/hero.gltf': { bytes: new TextEncoder().encode('{"asset":{"version":"2.0"}}') } },
    failedAssets: [{ url: 'https://example.com/other.glb', reason: 'HTTP 404' }],
  });
  assert.ok(build.warnings.some((w) => w.feature === 'Models' && w.detail.includes('.gltf')));
  assert.ok(build.warnings.some((w) => w.feature === 'Downloads' && w.detail.includes('HTTP 404')));
  // The player still exists (primitive stand-in).
  assert.match(sceneFile(build), /type="CharacterBody3D"/);
});

// ---------------------------------------------------------------------------
// Multi-scene
// ---------------------------------------------------------------------------

test('multi-scene export: one tscn per scene, next-scene links, main scene and zip', async () => {
  const a = coinRush();
  a.id = 'level-1';
  a.title = 'Level 1';
  const b = platformer2D('Level 2');
  b.id = 'level-2';
  a.sequence = { storyboardId: 's', storyboardTitle: 'Run', kind: 'game-levels', index: 0, total: 2, nextSceneId: 'level-2' };
  b.sequence = { storyboardId: 's', storyboardTitle: 'Run', kind: 'game-levels', index: 1, total: 2, nextSceneId: 'missing-scene' };
  const result = await buildGodotZip([a, b], { mainSceneId: 'level-2', projectName: 'Two Levels' });
  assert.deepEqual(result.scenes.map((s) => s.path), ['scenes/01-level-1.tscn', 'scenes/02-level-2.tscn']);
  assert.equal(result.mainScene, 'scenes/02-level-2.tscn');
  assert.match(text(result, 'project.godot'), /run\/main_scene="res:\/\/scenes\/02-level-2\.tscn"/);
  assert.match(sceneFile(result, 0), /next_scene = "res:\/\/scenes\/02-level-2\.tscn"/);
  assert.match(sceneFile(result, 1), /next_scene = ""/);
  assert.ok(result.warnings.some((w) => w.feature === 'Scene link' && w.scene === 'Level 2'));
  assert.ok(result.warnings.some((w) => w.feature === 'Window'));
  // 2D scene inside a portrait 3D project: the Camera2D fits the stage (zoom = min(720/1000, 1280/600)).
  assert.match(sceneFile(result, 1), /zoom = Vector2\(0\.72, 0\.72\)/);
  // Valid zip with every file.
  const zip = result.zip;
  assert.equal(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true), 0x04034b50);
  const names = new TextDecoder().decode(zip);
  for (const f of result.files) assert.ok(names.includes(f.name), `zip misses ${f.name}`);
});

// ---------------------------------------------------------------------------
// Optional: real Godot import check (skipped when `godot` is not on PATH)
// ---------------------------------------------------------------------------

const godotBinary = process.env.GODOT_BIN || 'godot';
const hasGodot = spawnSync(godotBinary, ['--version'], { encoding: 'utf8' }).status === 0;

test('Godot headless imports the exported project', { skip: hasGodot ? false : 'godot binary not on PATH (set GODOT_BIN to run)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnistage-godot-'));
  try {
    const build = buildGodotProject([coinRush(), platformer2D()]);
    for (const f of build.files) {
      const path = join(dir, f.name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, f.content);
    }
    const run = spawnSync(godotBinary, ['--headless', '--path', dir, '--import'], { encoding: 'utf8', timeout: 180_000 });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, output);
    assert.doesNotMatch(output, /SCRIPT ERROR|Parse Error|Failed loading resource/, output);
    for (const script of ['omni_game.gd', 'omni_player_3d.gd', 'omni_player_2d.gd']) {
      const check = spawnSync(godotBinary, ['--headless', '--path', dir, '--check-only', '--script', `res://scripts/${script}`], { encoding: 'utf8', timeout: 60_000 });
      assert.doesNotMatch(`${check.stdout}\n${check.stderr}`, /SCRIPT ERROR|Parse Error/, script);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Phase 2 2D roles: solid blocks, hazards and checkpoints export; controller, mover, collider and the scrolling camera warn', () => {
  const scene = platformer2D('Phase Two');
  scene.world2D = { width: 3000, height: 600 };
  scene.camera2D = { mode: 'follow' };
  const base = { width: 60, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#334155', stroke: '#FFFFFF' };
  scene.nodes2D.push(
    { ...base, id: 'wall', name: 'Wall', type: 'tile-platform', x: 700, y: 500, physics2D: 'solid' },
    { ...base, id: 'spikes', name: 'Spikes', type: 'vector-shape', x: 800, y: 540, physics2D: 'hazard' },
    { ...base, id: 'flag', name: 'Flag', type: 'vector-shape', x: 900, y: 520, physics2D: 'checkpoint' },
    { ...base, id: 'lift', name: 'Lift', type: 'tile-platform', x: 1000, y: 500, physics2D: 'static-platform', mover: { axis: 'x', distance: 200, speed: 80 }, collider: { width: 50 } }
  );
  const hero = scene.nodes2D.find((n) => n.physics2D === 'player-platformer')!;
  hero.controller = { maxJumps: 2 };
  const build = buildGodotProject([scene]);
  const tscn = sceneFile(build);
  assertBalancedQuotes(tscn);
  const headers = nodeHeaders(tscn);
  const byName = (name: string) => headers.find((h) => h.name === name && h.parent === '.')!;
  assert.equal(byName('Wall').type, 'StaticBody2D');
  assert.equal(byName('Spikes').type, 'Area2D');
  assert.equal(byName('Flag').type, 'Area2D');
  assert.equal(byName('Lift').type, 'StaticBody2D');
  // Only the one-way platform is one-way; the solid block blocks from every side.
  assert.equal(tscn.split('one_way_collision = true').length - 1, tscn.split('one_way_collision').length - 1);
  const wallShape = tscn.slice(tscn.indexOf('[node name="Collision" type="CollisionShape2D" parent="Wall"'));
  assert.ok(!wallShape.slice(0, wallShape.indexOf('\n\n') > 0 ? wallShape.indexOf('\n\n') : 200).includes('one_way_collision'), 'solid is not one-way');
  const details = build.warnings.map((w) => `${w.feature}: ${w.detail}`).join('\n');
  for (const needle of ['scrolling / following 2D camera', 'custom controller', 'custom collider', 'moving platform', 'hazard is exported', 'checkpoint is exported']) {
    assert.ok(details.includes(needle), `warns about ${needle}`);
  }
});

test('Phase 3 game state is never dropped silently: variables, HUD, health, spawners, prefabs and new actions warn', () => {
  const scene = platformer2D('Phase Three');
  const base = { width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#334155', stroke: '#FFFFFF' };
  scene.variables = [{ id: 'keys', initial: 0, max: 3 }];
  scene.hud = [{ id: 'hp', kind: 'bar', source: 'health', anchor: 'top-left' }];
  scene.gameRules.winCondition = 'variable-threshold';
  scene.gameRules.winVariable = { id: 'keys', atLeast: 3 };
  const hero = scene.nodes2D.find((n) => n.physics2D === 'player-platformer')!;
  hero.health = { max: 3 };
  scene.nodes2D.push(
    { ...base, id: 'bullet', name: 'Bullet', type: 'vector-shape', x: 0, y: 0, physics2D: 'hazard', prefab: true, projectile: { vx: 200, vy: 0 } },
    { ...base, id: 'turret', name: 'Turret', type: 'tile-platform', x: 700, y: 500, physics2D: 'solid', contactDamage: 1, spawner: { prefabId: 'bullet', everySeconds: 2 } }
  );
  scene.logicGraph = {
    nodes: [
      { id: 't', type: 'trigger', title: 'Start', params: { eventType: 'game-start' } },
      { id: 'a', type: 'action', title: 'Add key', params: { actionType: 'add-variable', variableId: 'keys', value: 1 } },
    ],
    edges: [{ id: 'e', from: 't', to: 'a' }],
  } as never;
  const build = buildGodotProject([scene]);
  const tscn = sceneFile(build);
  assertBalancedQuotes(tscn);
  assert.ok(!nodeHeaders(tscn).some((h) => h.name === 'Bullet'), 'prefab templates are not part of the Godot scene');
  assert.ok(nodeHeaders(tscn).some((h) => h.name === 'Turret'));
  assert.ok(!tscn.includes('variable-threshold'), 'the enum export stays valid');
  const details = build.warnings.map((w) => `${w.feature}: ${w.detail}`).join('\n');
  for (const needle of ['game variable(s)', 'HUD element(s)', 'variable-threshold', 'health (max 3)', 'contact damage', 'spawner is not exported', 'a prefab is a spawn template']) {
    assert.ok(details.includes(needle), `warns about ${needle}`);
  }
});
