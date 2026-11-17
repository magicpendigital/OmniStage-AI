import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.OMNISTAGE_HOME = mkdtempSync(join(tmpdir(), 'omnistage-meshy-home-'));

const runnerMod = await import('../server/generate/meshyRunner');
const cliMod = await import('../server/generate/meshyCli');
const routesMod = await import('../server/generate/meshyRoutes');
const { AssetStore } = await import('../server/workspace/assets');
const { buildGlb, parseGlb, mergeGlbAnimations } = await import('../server/generate/glbMerge');
import type { MeshyRunner, RunResult, LineListener } from '../server/generate/meshyRunner';

const { resolveRunner, quoteForWindowsShell, scrub, MeshyError, parseJsonLoose } = runnerMod;
const { createMeshyService, cleanMeshyPrompt, parseDeviceLine, validateVerificationUrl } = cliMod;

const SECRET = 'msy_SUPERSECRETTOKEN1234567890abcdef';
const ok = (over: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', timedOut: false, truncated: false, ...over });
const json = (v: unknown, over: Partial<RunResult> = {}) => ok({ stdout: JSON.stringify(v), ...over });

// ---------------------------------------------------------------------------------------------- GLB fixtures
function rigGlb(names = ['Hips', 'Spine']): Buffer {
  const bin = Buffer.alloc(16, 7);
  return buildGlb(
    {
      asset: { version: '2.0' },
      nodes: names.map((name, i) => ({ name, ...(i === 0 ? { children: [1] } : {}) })),
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }],
      accessors: [],
    },
    bin
  );
}
function clipGlb(names = ['Hips', 'Spine'], animName = 'Armature|Walk'): Buffer {
  const bin = Buffer.alloc(8 + 24);
  bin.writeFloatLE(0, 0);
  bin.writeFloatLE(1, 4);
  [0.1, 0.2, 0.3, 1.1, 1.2, 1.3].forEach((v, i) => bin.writeFloatLE(v, 8 + i * 4));
  return buildGlb(
    {
      asset: { version: '2.0' },
      nodes: names.map((name) => ({ name })),
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
      ],
      animations: [{ name: animName, samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
    },
    bin
  );
}

// ---------------------------------------------------------------------------------------------- fake runner
type Handler = (args: string[], call: number) => RunResult | Promise<RunResult>;
class FakeRunner implements MeshyRunner {
  kind = 'injected' as const;
  describe = 'fake-meshy';
  version = '0.4.0';
  calls: string[][] = [];
  longCalls: string[][] = [];
  killed = 0;
  longLines: Array<['stdout' | 'stderr', string]> = [];
  longExit: Promise<RunResult> = new Promise(() => undefined);
  constructor(public handler: Handler) {}
  async run(args: string[]) {
    this.calls.push(args);
    return this.handler(args, this.calls.length);
  }
  spawnLong(args: string[]) {
    this.longCalls.push(args);
    const listeners: LineListener[] = [];
    queueMicrotask(() => this.longLines.forEach(([s, l]) => listeners.forEach((f) => f(s, l))));
    return { onLine: (l: LineListener) => void listeners.push(l), wait: () => this.longExit, kill: () => void this.killed++ };
  }
  count(...words: string[]) {
    return this.calls.filter((c) => words.every((w) => c.includes(w))).length;
  }
}

const argOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

interface Scenario {
  rigged?: Buffer;
  walk?: Buffer;
  run?: Buffer;
  /** Override a command (matched on joined args); return undefined to fall through to the default. */
  override?: (args: string[], call: number) => RunResult | undefined;
}

/** Fake Meshy CLI that behaves like the documented one, including writing downloaded files. */
function meshyHandler(s: Scenario = {}): Handler {
  const ids: Record<string, string> = { preview: 'prevtask01', refine: 'refinetask1', rigging: 'rigtask001' };
  const credits: Record<string, number> = { prevtask01: 5, refinetask1: 10, rigtask001: 5, remeshtask1: 5, textask001: 10 };
  const rigged = s.rigged ?? rigGlb();
  const walk = s.walk ?? clipGlb(undefined, 'Armature|Walk');
  const run = s.run ?? clipGlb(undefined, 'Armature|Run');
  return (args, call) => {
    const o = s.override?.(args, call);
    if (o) return o;
    const [a, b] = args;
    if (a === 'auth' && b === 'status') return json({ authenticated: true, verified: true, source: 'oauth', access_token: SECRET });
    if (a === 'balance') return json({ ok: true, result: { balance: 1234 } });
    if (a === 'make') return json({ ok: true, result: { estimated_credits: 30, steps: [{ name: 'text-to-3d preview', estimated_credits: 5 }, { name: 'text-to-3d refine', estimated_credits: 25 }] } });
    if (a === 'text-to-3d' && b === 'create') return json({ ok: true, result: { submission: { task_id: ids[argOf(args, '--mode') as string] } } });
    if (a === 'remesh' && b === 'create') return json({ ok: true, result: { submission: { task_id: 'remeshtask1' } } });
    if (a === 'retexture' && b === 'create') return json({ ok: true, result: { submission: { task_id: 'textask001' } } });
    if (a === 'rigging' && b === 'create') return json({ ok: true, result: { submission: { task_id: ids.rigging } } });
    if (a === 'project' && b === 'init') {
      const dir = join(argOf(args, '--root'), 'proj');
      mkdirSync(dir, { recursive: true });
      return json({ ok: true, result: { project_dir: dir } });
    }
    if (b === 'wait') return json({ ok: true, result: { task: { id: args[2], status: 'SUCCEEDED', consumed_credits: credits[args[2]] } } });
    if (a === 'inspect') return json({ ok: true, result: { faces: 28000 } });
    if (a === 'download') {
      const out = argOf(args, '--output');
      const asset = argOf(args, '--asset');
      const data = asset?.includes('walking') ? walk : asset?.includes('running') ? run : rigged;
      writeFileSync(out, data);
      return json({ ok: true, result: { downloads: { files: [out] } } });
    }
    return ok({ code: 1, stderr: `unexpected command ${args.join(' ')}` });
  };
}

function setup(s: Scenario = {}, handler?: Handler) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'omnistage-meshy-tmp-'));
  const store = new AssetStore(mkdtempSync(join(tmpdir(), 'omnistage-meshy-lib-')));
  const runner = new FakeRunner(handler ?? meshyHandler(s));
  const service = createMeshyService({ runner, storeFor: (scope) => { if (scope !== 'personal') throw new MeshyError('bad scope'); return store; }, tmpRoot, sleep: async () => undefined });
  return { tmpRoot, store, runner, service };
}

const GOOD = { prompt: 'A brave knight in silver armor', confirm: true } as const;

// ---------------------------------------------------------------------------------------------- tests
test('runner resolution: pinned meshy on PATH, else the pinned npm exec package (npm.cmd on Windows)', async () => {
  const exec = (responses: Record<string, RunResult | Error>) => async (command: string, args: string[]) => {
    const r = responses[`${command} ${args.join(' ')}`];
    if (!r) throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    if (r instanceof Error) throw r;
    return r;
  };
  const path = await resolveRunner({ exec: exec({ 'meshy --version': ok({ stdout: '0.4.0\n' }) }), platform: 'linux', nodeVersion: '22.12.0' });
  assert.equal(path.kind, 'path');
  assert.equal(path.describe, 'meshy');

  const other = await resolveRunner({ exec: exec({ 'meshy --version': ok({ stdout: '0.3.9\n' }), 'npm --version': ok({ stdout: '10.0.0' }) }), platform: 'linux', nodeVersion: '24.1.0' });
  assert.equal(other.kind, 'npm-exec');
  assert.equal(other.describe, 'npm exec --yes --package=meshy-cli@0.4.0 -- meshy');
  const tenFour = await resolveRunner({ exec: exec({ 'meshy --version': ok({ stdout: '10.4.0\n' }), 'npm --version': ok({ stdout: '10' }) }), platform: 'linux', nodeVersion: '22.12.0' });
  assert.equal(tenFour.kind, 'npm-exec', '10.4.0 must not be mistaken for 0.4.0');

  const win = await resolveRunner({ exec: exec({ 'npm.cmd --version': ok({ stdout: '10.0.0' }) }), platform: 'win32', nodeVersion: '22.12.0' });
  assert.equal(win.kind, 'npm-exec', 'no meshy at all: falls back to npm exec');

  await assert.rejects(() => resolveRunner({ exec: exec({}), platform: 'linux', nodeVersion: '22.11.9' }), (e: any) => e.code === 'node_too_old');
  await assert.rejects(() => resolveRunner({ exec: exec({ 'meshy --version': ok({ stdout: '0.3.0' }) }), platform: 'linux', nodeVersion: '22.12.0' }), (e: any) => e.code === 'npm_missing');
});

test('Windows shell quoting cannot be broken out of; helpers tolerate and scrub CLI output', () => {
  const q = quoteForWindowsShell('a knight & "evil" | calc %PATH% ^ \\');
  assert.equal(q.startsWith('"') && q.endsWith('"'), true);
  const inner = q.slice(1, -1);
  assert.equal(inner.includes('"'), false);
  assert.equal(inner.includes('%'), false);
  assert.equal(inner.endsWith('\\'), false);
  assert.equal(quoteForWindowsShell('--mode'), '--mode');
  assert.equal(quoteForWindowsShell(''), '""');

  assert.deepEqual(parseJsonLoose('npm notice x\n{"a":1}'), { a: 1 });
  assert.equal(parseJsonLoose('not json'), undefined);
  const dirty = scrub(`failed Bearer abc.def.ghi token=${SECRET} https://x.meshy.ai/f.glb?Signature=AAAABBBB&Expires=1 ${'z'.repeat(40)}`);
  for (const bad of [SECRET, 'abc.def.ghi', 'Signature=AAAA', 'z'.repeat(40)]) assert.equal(dirty.includes(bad), false, bad);
});

test('auth status: only documented fields leave the service; authenticated-but-unverified never starts a login', async () => {
  const a = setup();
  const st = await a.service.status();
  assert.equal(st.state, 'ready');
  assert.deepEqual(st.auth, { authenticated: true, verified: true, source: 'oauth' });
  assert.equal(st.balance, 1234);
  assert.equal(JSON.stringify(st).includes(SECRET), false);

  const none = setup({ override: (args) => (args[0] === 'auth' ? json({ authenticated: false, verified: false, source: 'none', hint: 'Run meshy auth login' }, { code: 3 }) : undefined) });
  const s2 = await none.service.status();
  assert.equal(s2.state, 'login_required');
  assert.equal(s2.auth?.hint, 'Run meshy auth login');
  assert.equal(s2.balance, null);

  const unverified = setup({ override: (args) => (args[0] === 'auth' ? json({ authenticated: true, verified: false, source: 'oauth', hint: `network error ${SECRET}` }, { code: 3 }) : undefined) });
  const s3 = await unverified.service.status();
  assert.equal(s3.state, 'unverified');
  assert.equal(s3.auth?.hint?.includes(SECRET), false);
  await assert.rejects(() => unverified.service.startCharacter(GOOD), (e: any) => e.code === 'session_unverified');
  assert.equal(unverified.runner.longCalls.length, 0, 'no login was started');
  assert.equal(unverified.runner.count('login'), 0);
  assert.equal(unverified.runner.count('create'), 0);
});

test('device login: stderr line parsed, URL validated, one login at a time, cancel', async () => {
  assert.deepEqual(parseDeviceLine('Enter code WXYZ-1234 at https://www.meshy.ai/device'), { code: 'WXYZ-1234', url: 'https://www.meshy.ai/device' });
  assert.deepEqual(parseDeviceLine('Enter code abcd-1234 at https://www.meshy.ai/device.'), { code: 'ABCD-1234', url: 'https://www.meshy.ai/device' });
  assert.equal(parseDeviceLine('npm notice New version available'), null);
  for (const bad of ['http://www.meshy.ai/device', 'https://meshy.ai.evil.com/device', 'https://evil.com/meshy.ai', 'https://u:p@www.meshy.ai/d', 'https://www.meshy.ai:8443/d', 'javascript:alert(1)']) {
    assert.equal(parseDeviceLine(`Enter code AAAA-1111 at ${bad}`) === 'bad_url' || validateVerificationUrl(bad) === null, true, bad);
  }
  assert.ok(validateVerificationUrl('https://meshy.ai/device'));

  const t = setup();
  let finish!: (r: RunResult) => void;
  t.runner.longExit = new Promise((r) => (finish = r));
  t.runner.longLines = [['stderr', 'npm warn exec The following package was not found'], ['stderr', 'Enter code WXYZ-1234 at https://www.meshy.ai/device']];
  const v = await t.service.startLogin();
  assert.deepEqual(v, { state: 'waiting', url: 'https://www.meshy.ai/device', code: 'WXYZ-1234' });
  assert.deepEqual(t.runner.longCalls[0], ['auth', 'login', '--device', '--format', 'json', '--no-update-check']);
  assert.equal(t.runner.longCalls[0].includes('--no-wait') || t.runner.longCalls[0].includes('--manual'), false);
  await t.service.startLogin();
  assert.equal(t.runner.longCalls.length, 1, 'only one login at a time');
  finish(ok({ stdout: '{"status":"logged_in","verified":true}' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.service.loginView().state, 'logged_in');
  assert.equal(JSON.stringify(t.service.loginView()).includes('meshy.ai/device'), false, 'url/code only while waiting');

  const c = setup();
  c.runner.longLines = [['stderr', 'Enter code AAAA-1111 at https://www.meshy.ai/device']];
  await c.service.startLogin();
  assert.equal(c.service.cancelLogin().state, 'idle');
  assert.equal(c.runner.killed, 1);

  const evil = setup();
  evil.runner.longLines = [['stderr', 'Enter code AAAA-1111 at https://meshy.ai.evil.com/device']];
  const ev = await evil.service.startLogin();
  assert.equal(ev.state, 'failed');
  assert.equal(ev.url, undefined);
  assert.equal(evil.runner.killed, 1);

  const expired = setup();
  expired.runner.longLines = [['stderr', 'Enter code AAAA-1111 at https://www.meshy.ai/device']];
  expired.runner.longExit = Promise.resolve(ok({ code: 8, stderr: 'code expired' }));
  await expired.service.startLogin();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(expired.service.loginView().state, 'expired');
});

test('estimate is free (dry run only) and says rigging is not covered', async () => {
  const t = setup();
  const e = await t.service.estimate({ prompt: 'a knight', rig: true });
  assert.equal(e.credits, 30);
  assert.equal(e.source, 'cli-dry-run');
  assert.equal(e.balance, 1234);
  assert.ok(e.steps.some((s) => /preview/.test(s)) && e.steps.some((s) => /Rigging/.test(s)));
  assert.ok(e.notes.some((n) => /not covered/.test(n)));
  assert.equal(t.runner.count('create'), 0);
  assert.ok(t.runner.calls.some((c) => c[0] === 'make' && c.includes('--dry-run') && c[1] === 'a knight'));

  const unknown = setup({ override: (args) => (args[0] === 'make' ? ok({ code: 1, stderr: 'boom' }) : undefined) });
  const u = await unknown.service.estimate({ prompt: 'a knight' });
  assert.equal(u.credits, undefined);
  assert.equal(u.source, 'unknown');
});

test('spend gate: nothing is created (or even run) without confirm === true', async () => {
  const t = setup();
  for (const confirm of [undefined, false, 'true', 1, 'yes']) {
    await assert.rejects(() => t.service.startCharacter({ prompt: 'a knight', confirm }), (e: any) => e.code === 'confirm_required' && e.status === 400);
  }
  assert.equal(t.runner.calls.length, 0, 'the CLI was never invoked');
  await assert.rejects(() => t.service.startCharacter({ ...GOOD, rig: true, textured: false }), (e: any) => e.code === 'rig_needs_texture');
  await assert.rejects(() => t.service.startCharacter({ ...GOOD, scope: 'elsewhere' }), /bad scope/);
  assert.equal(t.runner.calls.length, 0, 'validation failures cost nothing');
});

test('happy path: one paid create per stage, GLB checked, clips merged, assets in the store, temp dir removed, no secrets', async () => {
  const t = setup();
  const started = await t.service.startCharacter({ ...GOOD, name: 'Silver Knight', heightMeters: 1.8 });
  assert.equal(started.status, 'running');
  const job = await t.service.waitForJob(started.id);
  assert.equal(job.status, 'succeeded', job.error);
  assert.deepEqual(job.tasks, { preview: 'prevtask01', remesh: 'remeshtask1', retexture: 'textask001', rigging: 'rigtask001' });
  assert.equal(job.consumedCredits, 25);
  assert.deepEqual(job.clips, ['walking', 'running']);

  // exactly one paid create per stage, never repeated
  assert.equal(t.runner.count('text-to-3d', 'create', 'preview'), 1);
  assert.equal(t.runner.count('remesh', 'create'), 1);
  assert.equal(t.runner.count('retexture', 'create'), 1);
  assert.equal(t.runner.count('text-to-3d', 'create', 'refine'), 0, 'a rigged character is remeshed and retextured, not refined');
  assert.equal(t.runner.count('rigging', 'create'), 1);
  assert.equal(t.runner.calls.filter((c) => c.includes('create')).length, 4);

  // commands: prompt is ONE argv element, a-pose, height, pbr, workspace under tmpRoot
  const preview = t.runner.calls.find((c) => c.includes('create') && c.includes('preview'))!;
  assert.equal(argOf(preview, '--prompt'), 'A brave knight in silver armor');
  assert.equal(argOf(preview, '--pose-mode'), 'a-pose');
  assert.ok(preview.includes('--async') && preview.includes('--no-update-check') && argOf(preview, '--format') === 'json' && argOf(preview, '--output-schema') === 'v1');
  const remesh = t.runner.calls.find((c) => c[0] === 'remesh' && c[1] === 'create')!;
  assert.equal(argOf(remesh, '--input-task-id'), 'prevtask01');
  assert.equal(argOf(remesh, '--target-polycount'), '30000', 'under the 380,000-triangle rigging limit');
  assert.equal(argOf(remesh, '--topology'), 'triangle');
  const retex = t.runner.calls.find((c) => c[0] === 'retexture' && c[1] === 'create')!;
  assert.equal(argOf(retex, '--input-task-id'), 'remeshtask1');
  assert.equal(argOf(retex, '--text-style-prompt'), 'A brave knight in silver armor');
  assert.equal(argOf(retex, '--enable-pbr'), 'true');
  const rig = t.runner.calls.find((c) => c[0] === 'rigging' && c[1] === 'create')!;
  assert.equal(argOf(rig, '--input-task-id'), 'textask001', 'rigging starts from the textured, remeshed model');
  assert.equal(argOf(rig, '--height-meters'), '1.8');
  const ws = argOf(rig, '--workspace');
  assert.ok(ws.startsWith(t.tmpRoot), 'workspace is a per-job temp dir');
  assert.equal(t.runner.calls.some((c) => c.some((x) => x.includes('/.config/meshy') || /credentials/i.test(x))), false);
  assert.equal(readdirSync(t.tmpRoot).length, 0, 'job temp dir removed');

  // assets
  assert.equal(job.assets.length, 1);
  const asset = job.asset!;
  assert.equal(asset.kind, 'model');
  assert.equal(asset.source, 'meshy');
  assert.deepEqual(asset.tags, ['generated', 'meshy', '3d', 'character']);
  assert.match(asset.license!, /Meshy/);
  assert.equal(asset.meta!.generated, true);
  assert.equal(asset.meta!.provider, 'meshy');
  assert.equal(asset.meta!.prompt, 'A brave knight in silver armor');
  assert.deepEqual(asset.meta!.tasks, job.tasks);
  assert.equal(asset.meta!.consumedCredits, 25);
  assert.deepEqual(asset.meta!.clips, ['walking', 'running']);
  const { path } = await t.store.filePath(asset.id);
  const saved = parseGlb(readFileSync(path));
  assert.deepEqual(saved.json.animations.map((a: any) => a.name), ['walking', 'running']);
  const walking = saved.json.animations[0];
  const acc = saved.json.accessors[walking.samplers[0].output];
  const view = saved.json.bufferViews[acc.bufferView];
  assert.equal(saved.bin.readFloatLE(view.byteOffset), Math.fround(0.1), 'clip data copied byte for byte');
  assert.equal(walking.channels[0].target.node, 0);

  // nothing token-shaped in anything the UI can read
  const everything = JSON.stringify([job, await t.service.status(), t.service.listJobs()]);
  assert.equal(everything.includes(SECRET), false);
  assert.equal(t.service.getJob(job.id).id, job.id);
});

test('clips that do not match the skeleton are saved as separate linked assets, not half-merged', async () => {
  const t = setup({ walk: clipGlb(['Pelvis', 'Chest']), run: clipGlb(['Hips', 'Spine'], 'Run') });
  const job = await t.service.waitForJob((await t.service.startCharacter(GOOD)).id);
  assert.equal(job.status, 'succeeded', job.error);
  assert.deepEqual(job.clips, ['running']);
  assert.equal(job.assets.length, 2);
  const clipAsset = job.assets.find((a) => a.meta?.role === 'animation-clip')!;
  assert.equal(clipAsset.meta!.clip, 'walking');
  assert.deepEqual(job.asset!.meta!.clipAssets, { walking: clipAsset.id });
  assert.ok(job.warnings.some((w) => /walking clip was not merged/.test(w)));

  const direct = mergeGlbAnimations(rigGlb(), [{ name: 'a', glb: clipGlb(['X', 'Y']) }]);
  assert.deepEqual(direct.clips, []);
  assert.equal(direct.skipped.length, 1);
  const off = setup();
  const j2 = await off.service.waitForJob((await off.service.startCharacter({ ...GOOD, mergeClips: false })).id);
  assert.equal(j2.assets.length, 3);
  assert.equal(j2.clips, undefined);
});

test('exit 9 (insufficient credit) stops the job: no retry, no later stage', async () => {
  const t = setup({ override: (args) => (args[0] === 'remesh' && args.includes('create') ? json({ ok: false, error: { code: 'insufficient_credit', message: 'Not enough credits' } }, { code: 9 }) : undefined) });
  const job = await t.service.waitForJob((await t.service.startCharacter(GOOD)).id);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'insufficient_credit');
  assert.equal(job.tasks.preview, 'prevtask01');
  assert.equal(job.tasks.remesh, undefined);
  assert.equal(t.runner.count('remesh', 'create'), 1, 'not retried');
  assert.equal(t.runner.count('rigging', 'create'), 0);
  assert.equal(job.assets.length, 0);
  assert.equal(readdirSync(t.tmpRoot).length, 0);
});

test('unknown submission (exit 10) and wait timeouts never trigger another paid create', async () => {
  const unknown = setup({ override: (args) => (args[0] === 'text-to-3d' && args.includes('create') ? ok({ code: 10, stderr: 'submission_unknown' }) : undefined) });
  const j = await unknown.service.waitForJob((await unknown.service.startCharacter(GOOD)).id);
  assert.equal(j.errorCode, 'submission_unknown');
  assert.equal(unknown.runner.count('create'), 1);

  let waits = 0;
  const slow = setup({ override: (args) => (args[1] === 'wait' && args[2] === 'prevtask01' && ++waits <= 2 ? ok({ code: 8, stderr: 'timeout' }) : undefined) });
  const j2 = await slow.service.waitForJob((await slow.service.startCharacter(GOOD)).id);
  assert.equal(j2.status, 'succeeded', j2.error);
  assert.equal(slow.runner.calls.filter((c) => c[1] === 'wait' && c[2] === 'prevtask01').length, 3, 'the same wait was resumed');
  assert.equal(slow.runner.calls.filter((c) => c.includes('create')).length, 4, 'still one create per stage');

  const never = setup({ override: (args) => (args[1] === 'wait' ? ok({ code: 8 }) : undefined) });
  const j3 = await never.service.waitForJob((await never.service.startCharacter(GOOD)).id);
  assert.equal(j3.errorCode, 'wait_timeout');
  assert.equal(never.runner.count('create'), 1);
});

test('error text never carries tokens, signed URLs or the prompt environment', async () => {
  const t = setup({
    override: (args) =>
      args[0] === 'rigging' && args[1] === 'create'
        ? ok({ code: 1, stderr: `request failed Authorization: Bearer ${SECRET} see https://assets.meshy.ai/x.glb?Signature=ABCDEF123456&Expires=9 access_token=${SECRET}` })
        : undefined,
  });
  const job = await t.service.waitForJob((await t.service.startCharacter(GOOD)).id);
  assert.equal(job.status, 'failed');
  const blob = JSON.stringify(job);
  for (const bad of [SECRET, 'Signature=ABCDEF', 'Bearer ' + SECRET]) assert.equal(blob.includes(bad), false, bad);
  assert.ok(job.warnings.some((w) => /may have used credits/.test(w)));
  assert.equal(job.tasks.rigging, undefined);
});

test('prompts: control chars, leading dashes (flag injection) and length are sanitised; one argv element', async () => {
  assert.equal(cleanMeshyPrompt('--evil\u0000 \n flag\tknight'), 'evil flag knight');
  assert.equal(cleanMeshyPrompt('  -- a "quoted" & piped | knight $(rm -rf) '), 'a "quoted" & piped | knight $(rm -rf)');
  assert.equal(cleanMeshyPrompt('x'.repeat(5000)).length, 600);
  assert.throws(() => cleanMeshyPrompt('--'), /at least 3/);
  assert.throws(() => cleanMeshyPrompt('  '), /Describe/);

  const t = setup();
  await t.service.waitForJob((await t.service.startCharacter({ prompt: '--output /etc/passwd knight', confirm: true })).id);
  const preview = t.runner.calls.find((c) => c.includes('create') && c.includes('preview'))!;
  assert.equal(argOf(preview, '--prompt'), 'output /etc/passwd knight');
  assert.equal(preview.filter((x) => x.includes('passwd')).length, 1, 'the whole prompt is a single argument');
});

test('HTTP routes: loopback only, confirm required, status/job shapes', async () => {
  const t = setup();
  const app = express();
  app.use(express.json());
  routesMod.registerMeshyRoutes(app, { service: t.service });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/meshy`;
  try {
    const status = await (await fetch(`${base}/status`)).json();
    assert.equal(status.state, 'ready');
    assert.deepEqual(status.login, { state: 'idle' });
    assert.equal(JSON.stringify(status).includes(SECRET), false);

    const forwarded = await fetch(`${base}/status`, { headers: { 'x-forwarded-for': '10.0.0.5' } });
    assert.equal(forwarded.status, 403);

    const noConfirm = await fetch(`${base}/characters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a knight' }) });
    assert.equal(noConfirm.status, 400);
    assert.equal((await noConfirm.json()).code, 'confirm_required');
    assert.equal(t.runner.count('create'), 0);

    const est = await (await fetch(`${base}/estimate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a knight' }) })).json();
    assert.equal(est.credits, 30);

    const res = await fetch(`${base}/characters`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a knight', confirm: true }) });
    assert.equal(res.status, 200);
    const started = await res.json();
    assert.equal(started.status, 'running');
    const finished = await t.service.waitForJob(started.id);
    const polled = await (await fetch(`${base}/jobs/${started.id}`)).json();
    assert.equal(polled.status, finished.status);
    assert.equal(polled.status, 'succeeded');
    assert.equal((await (await fetch(`${base}/jobs`)).json()).length >= 1, true);
    assert.equal((await fetch(`${base}/jobs/nope`)).status, 404);
    assert.equal((await (await fetch(`${base}/login`)).json()).state, 'idle');
  } finally {
    server.close();
  }
});
