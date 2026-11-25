import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TOOL_CALLS,
  MAX_TOOL_LOOP_TURNS,
  resolveToolLoopConnection,
  runToolLoop,
  ToolLoopClient,
  ToolLoopRequest,
  ToolLoopResponse,
} from '../server/ai/toolLoop';
import { sanitizeExtraAssets } from '../server/ai/toolRoute';
import { SceneToolbox } from '../src/agent/tools/sceneTools';
import { createBlankSceneSpec } from '../src/registry/assetRegistry';

let nextId = 1;
const use = (name: string, input: unknown) => ({ type: 'tool_use' as const, id: `tu_${nextId++}`, name, input });
const reply = (content: ToolLoopResponse['content'], stop_reason = 'tool_use', usage?: ToolLoopResponse['usage']): ToolLoopResponse => ({ content, stop_reason, model: 'fake-model', usage });

/** A scripted fake: each call pops the next response (or runs a function with the request). */
function scripted(steps: Array<ToolLoopResponse | ((req: ToolLoopRequest) => ToolLoopResponse)>): ToolLoopClient & { requests: ToolLoopRequest[] } {
  const requests: ToolLoopRequest[] = [];
  return {
    requests,
    async send(req) {
      // Snapshot: the loop keeps appending to the same messages array.
      requests.push({ ...req, messages: JSON.parse(JSON.stringify(req.messages)) });
      const step = steps[requests.length - 1];
      if (!step) throw new Error('script exhausted');
      return typeof step === 'function' ? step(req) : step;
    },
  };
}

const base = (client: ToolLoopClient, spec = createBlankSceneSpec('3d'), extra: Partial<Parameters<typeof runToolLoop>[0]> = {}) => {
  const toolbox = new SceneToolbox(spec);
  return { toolbox, opts: { client, model: 'fake-model', system: 'SYSTEM', userPrompt: toolbox.buildUserPrompt('move the hero'), toolbox, ...extra } };
};

test('multi-turn happy path with parallel tool calls and tool_result messages', async () => {
  const spec = createBlankSceneSpec('3d');
  const hero = spec.actors[0].id;
  const client = scripted([
    reply([{ type: 'text', text: 'Let me look.' }, use('get_scene_slice', { sections: ['actors'], ids: [hero] }), use('search_assets', { query: 'robot' })], 'tool_use', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 }),
    reply([use('apply_patch', { ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [3, 0, 0] }] })], 'tool_use', { input_tokens: 120, output_tokens: 20 }),
    reply([use('verify', {}), use('finish', { summary: 'Moved the hero to x=3.' })]),
  ]);
  const { opts } = base(client, spec);
  const events: string[] = [];
  const result = await runToolLoop({ ...opts, onEvent: (e) => events.push(e.type) });

  assert.equal(result.stopped, 'finish');
  assert.equal(result.turns, 3);
  assert.equal(result.toolCalls, 5);
  assert.deepEqual(result.spec.actors[0].position, [3, 0, 0]);
  assert.ok(result.changed && result.report.ok);
  assert.equal(result.assistantMessage, 'Moved the hero to x=3.');
  assert.deepEqual(result.transcript.map((t) => t.tool), ['get_scene_slice', 'search_assets', 'apply_patch', 'verify', 'finish']);
  assert.ok(result.transcript.every((t) => !t.isError));
  assert.match(result.diffSummary[0], /3 turn\(s\), 5 tool call\(s\), 1 patch\(es\) kept/);
  assert.deepEqual(result.usage, { inputTokens: 220, outputTokens: 30, cacheReadTokens: 50, cacheCreationTokens: 0 });
  assert.equal(result.model, 'fake-model');
  assert.ok(events.includes('turn') && events.includes('tool') && events.includes('text'));

  // Request shape: static system + tool definitions every turn, first message is a summary (not the spec).
  assert.equal(client.requests.length, 3);
  assert.equal(client.requests[0].system, 'SYSTEM');
  assert.deepEqual(client.requests[0].tools.map((t) => t.name), ['get_scene_slice', 'apply_patch', 'verify', 'search_assets', 'finish']);
  assert.equal(typeof client.requests[0].messages[0].content, 'string');
  // Turn 2 carries the assistant turn plus one user message with BOTH tool_results, matched by id.
  const second = client.requests[1].messages;
  assert.deepEqual(second.map((m) => m.role), ['user', 'assistant', 'user']);
  const results = second[2].content as any[];
  assert.deepEqual(results.map((r) => r.type), ['tool_result', 'tool_result']);
  assert.deepEqual(results.map((r) => r.tool_use_id), (second[1].content as any[]).filter((b) => b.type === 'tool_use').map((b) => b.id));
  assert.match(results[0].content, /"actors"/);
});

test('stops at the turn limit when the model never finishes', async () => {
  const client = scripted(Array.from({ length: 30 }, () => reply([use('verify', {})])));
  const { opts } = base(client);
  const result = await runToolLoop({ ...opts, maxTurns: 99 });
  assert.equal(result.stopped, 'max-turns');
  assert.equal(result.turns, MAX_TOOL_LOOP_TURNS);
  assert.equal(client.requests.length, MAX_TOOL_LOOP_TURNS, 'maxTurns is capped at the hard limit');
  assert.match(result.diffSummary.join(' '), /turn limit/);

  const small = scripted(Array.from({ length: 5 }, () => reply([use('verify', {})])));
  const r2 = await runToolLoop({ ...base(small).opts, maxTurns: 2 });
  assert.equal(r2.turns, 2);
});

test('stops at the tool call budget and answers excess calls with an error result', async () => {
  const many = (n: number) => reply(Array.from({ length: n }, () => use('verify', {})));
  const client = scripted([many(25), many(25)]);
  const result = await runToolLoop(base(client).opts);
  assert.equal(result.stopped, 'tool-budget');
  assert.equal(result.toolCalls, MAX_TOOL_CALLS);
  assert.equal(result.transcript.length, 50);
  assert.equal(result.transcript.filter((t) => t.isError).length, 10);
  assert.match(result.transcript[49].result, /budget/);
});

test('end_turn without tool calls ends quietly and keeps the model text', async () => {
  const client = scripted([reply([{ type: 'text', text: 'Nothing to change.' }], 'end_turn')]);
  const result = await runToolLoop(base(client).opts);
  assert.equal(result.stopped, 'end-turn');
  assert.equal(result.changed, false);
  assert.equal(result.assistantMessage, 'Nothing to change.');
});

test('abort: a signal aborted before or during a call stops the loop with AbortError', async () => {
  const ac = new AbortController();
  ac.abort();
  const never = scripted([]);
  await assert.rejects(() => runToolLoop({ ...base(never).opts, signal: ac.signal }), (e: any) => e.name === 'AbortError');
  assert.equal(never.requests.length, 0);

  const ac2 = new AbortController();
  const client = scripted([() => { ac2.abort(); return reply([use('verify', {})]); }]);
  await assert.rejects(() => runToolLoop({ ...base(client).opts, signal: ac2.signal }), (e: any) => e.name === 'AbortError');
});

test('tool errors are fed back as tool_result with is_error, and the model can recover', async () => {
  const spec = createBlankSceneSpec('3d');
  const hero = spec.actors[0].id;
  const client = scripted([
    reply([use('apply_patch', { ops: [{ op: 'replace', path: '/actors/@ghost/position', value: [0, 0, 0] }] }), use('no_such_tool', {}), use('get_scene_slice', { sections: ['bogus'] })]),
    reply([use('apply_patch', { ops: [{ op: 'replace', path: `/actors/@${hero}/position`, value: [1, 0, 1] }] }), use('finish', { summary: 'ok' })]),
  ]);
  const result = await runToolLoop(base(client, spec).opts);
  const second = client.requests[1].messages[2].content as any[];
  assert.equal(second.length, 3);
  assert.ok(second.every((r) => r.is_error === true));
  assert.match(second[0].content, /PATCH REJECTED/);
  assert.match(second[1].content, /Unknown tool/);
  assert.match(second[2].content, /Unknown section/);
  assert.deepEqual(result.spec.actors[0].position, [1, 0, 1]);
  assert.equal(result.transcript.filter((t) => t.isError).length, 3);
  assert.match(result.diffSummary[0], /1 patch\(es\) kept.*1 rejected or reverted/);
});

test('a refusal or a client failure rejects so the caller can fall back to the patch loop', async () => {
  const refused = scripted([{ content: [], stop_reason: 'refusal', stop_details: { category: 'policy' } }]);
  await assert.rejects(() => runToolLoop(base(refused).opts), /declined/);
  const broken = scripted([]);
  await assert.rejects(() => runToolLoop(base(broken).opts), /script exhausted/);
});

test('transcripts and results are short; no secrets are involved', async () => {
  const client = scripted([reply([use('apply_patch', { mergePatch: { description: 'x'.repeat(5000) } }), use('finish', { summary: 's' })])]);
  const result = await runToolLoop(base(client).opts);
  assert.ok(result.transcript.every((t) => t.input.length <= 220 && t.result.length <= 320));
});

test('eligibility: only an Anthropic primary with a key uses tools; everything else returns null', () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.deepEqual(resolveToolLoopConnection({ provider: 'anthropic', apiKey: ' sk-test ', model: 'claude-x' }), { apiKey: 'sk-test', model: 'claude-x' });
    assert.equal(resolveToolLoopConnection({ provider: 'anthropic', apiKey: 'sk-test' })?.model, 'claude-opus-5-5', 'default model');
    assert.equal(resolveToolLoopConnection({ provider: 'anthropic' }), null, 'no key anywhere');
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    assert.deepEqual(resolveToolLoopConnection({ provider: 'anthropic' }), { apiKey: 'sk-env', model: 'claude-opus-5-5' });
    for (const provider of ['gemini', 'openrouter', 'openai-compatible', 'cli-claude', 'cli-codex', 'cli-antigravity', 'cli-opencode'] as const) {
      assert.equal(resolveToolLoopConnection({ provider, apiKey: 'sk-test' }), null, provider);
    }
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('route helper: extra assets from the client are sanitised and capped', () => {
  const out = sanitizeExtraAssets([
    { id: 'a', name: 'Dragon', kind: '3d', url: '/api/library/file/a.glb', tags: ['x'] },
    { id: 'b', name: 'Evil', kind: 'weird', url: 'javascript:alert(1)' },
    { name: 'no id' },
    null,
    ...Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, name: `N${i}` })),
  ]);
  assert.equal(out[0].url, '/api/library/file/a.glb');
  assert.equal(out[1].url, undefined, 'non-https, non-library urls are dropped');
  assert.equal(out[1].kind, '3d', 'unknown kinds default');
  assert.equal(out.length, 80);
  assert.deepEqual(sanitizeExtraAssets('nope'), []);
});
