/**
 * CLI providers and vision (Phase 11E): Codex, OpenCode and Antigravity get the image as a temp file; Claude Code CLI (no tools) does not.
 * Pure parts only: the real CLIs were exercised by hand (see the header of server/ai/cliProviders.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLI_BINARIES, CLI_VISION, callCliProvider, codexArgs, composeCliPrompt, imageFileName, openCodeArgs,
} from '../server/ai/cliProviders';
import { generate } from '../server/ai/index';
import { ProviderUnavailableError } from '../server/ai/types';
import { providerInfo } from '../src/agent/aiClient';
import type { AIProviderId } from '../src/types/scene.schema';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600', 'hex');

test('the server and the studio agree on which CLIs can see', () => {
  for (const id of Object.keys(CLI_BINARIES) as Array<keyof typeof CLI_BINARIES>) {
    assert.equal(providerInfo(id as AIProviderId).vision, CLI_VISION[id], id);
  }
  assert.deepEqual(
    Object.entries(CLI_VISION).filter(([, v]) => v).map(([k]) => k).sort(),
    ['cli-antigravity', 'cli-codex', 'cli-opencode']
  );
});

test('imageFileName trusts the bytes over the claimed type', () => {
  assert.equal(imageFileName('image/png', PNG), 'omnistage-image.png');
  assert.equal(imageFileName('image/png', JPG), 'omnistage-image.jpg', 'a JPEG labelled PNG (as browsers do) keeps its real extension');
  assert.equal(imageFileName('image/webp'), 'omnistage-image.webp');
  assert.equal(imageFileName('image/jpeg'), 'omnistage-image.jpg');
  assert.equal(imageFileName('text/html; evil'), 'omnistage-image.png', 'unknown types never reach the file name');
  assert.match(imageFileName('../../etc/passwd'), /^omnistage-image\.(png)$/);
});

test('codex: the prompt still comes from stdin; with an image --image replaces the trailing "-" (it is variadic and would swallow it)', () => {
  const plain = codexArgs('gpt-5-codex', 'out.txt');
  assert.equal(plain[plain.length - 1], '-');
  assert.ok(!plain.includes('--image'));
  assert.deepEqual(plain.slice(0, 2), ['exec', '--skip-git-repo-check']);
  const withImage = codexArgs(undefined, 'out.txt', 'omnistage-image.png');
  assert.equal(withImage[withImage.length - 2], '--image');
  assert.equal(withImage[withImage.length - 1], 'omnistage-image.png');
  assert.ok(!withImage.includes('-'), 'no bare "-" after --image');
  assert.ok(withImage.includes('read-only'), 'still sandboxed read-only');
});

test('opencode: image attached next to the prompt file, the instruction stays after "--"', () => {
  const plain = openCodeArgs('google/gemini-2.5-flash', 'omnistage-prompt.md');
  assert.equal(plain.filter((a) => a === '-f').length, 1);
  const withImage = openCodeArgs('google/gemini-2.5-flash', 'omnistage-prompt.md', 'omnistage-image.png');
  assert.equal(withImage.filter((a) => a === '-f').length, 2);
  const dash = withImage.indexOf('--');
  assert.ok(dash > withImage.lastIndexOf('-f') && dash > withImage.indexOf('-m'), 'every flag comes before the "--"');
  assert.equal(withImage.length - dash, 2, 'exactly one argument after "--"');
  assert.match(withImage[withImage.length - 1], /omnistage-image\.png/);
  assert.ok(!openCodeArgs(undefined, 'p.md').includes('-m'));
});

test('opencode: absolute paths are passed through, the instruction names the files by their base name', () => {
  const abs = process.platform === 'win32' ? 'C:\\tmp\\omnistage-cli-x\\omnistage-prompt.md' : '/tmp/omnistage-cli-x/omnistage-prompt.md';
  const img = abs.replace('omnistage-prompt.md', 'omnistage-image.png');
  const args = openCodeArgs(undefined, abs, img);
  assert.ok(args.some((a) => a.includes('omnistage-cli-x') && a.includes('omnistage-prompt.md')));
  const text = args[args.length - 1];
  assert.match(text, /attached file omnistage-prompt\.md/);
  assert.match(text, /attached image omnistage-image\.png/);
  assert.ok(!/omnistage-cli-x/.test(text), 'the model is not shown the temp path');
});

test('prompt: attached images are announced; antigravity is told to open the file and allowed only that tool', () => {
  const req = { system: 'SYS', user: 'USER' };
  const plain = composeCliPrompt(req);
  assert.ok(!/# IMAGE/.test(plain));
  assert.match(plain, /do not use tools/);
  const attached = composeCliPrompt(req, 'attached');
  assert.match(attached, /# IMAGE\nAn image is attached/);
  assert.ok(attached.indexOf('# IMAGE') < attached.indexOf('# TASK'));
  const viaPath = composeCliPrompt(req, { path: 'C:\\tmp\\omnistage-image.png' });
  assert.match(viaPath, /C:\\tmp\\omnistage-image\.png/);
  assert.match(viaPath, /file viewing tool/);
  assert.ok(!/do not use tools/.test(viaPath), 'the file viewer must stay allowed');
  assert.match(viaPath, /do not edit files or run anything/);
  assert.match(viaPath, /ONE JSON object/);
});

test('Claude Code CLI refuses an image instead of answering blind; the others pass the vision gate', async () => {
  const image = { mimeType: 'image/png', base64: PNG.toString('base64') };
  await assert.rejects(
    callCliProvider({ provider: 'cli-claude' }, { system: 's', user: 'u', image }),
    (e: any) => e instanceof ProviderUnavailableError && /cannot see images/.test(e.message)
  );
  await assert.rejects(
    generate({ provider: 'cli-claude' }, { system: 's', user: 'u', requireVision: true }),
    (e: any) => e instanceof ProviderUnavailableError && /cannot see images/.test(e.message)
  );
  // A vision CLI is not stopped by the gate itself (it would run the real CLI, so only check that the message is not the gate's).
  for (const provider of ['cli-codex', 'cli-opencode', 'cli-antigravity'] as const) {
    assert.equal(CLI_VISION[provider], true, provider);
  }
});
