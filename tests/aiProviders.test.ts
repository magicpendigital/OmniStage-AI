import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJSON, sanitizeModelId } from '../server/ai/types';
import { antigravityStdin, composeCliPrompt, parseAntigravityEvents, parseClaudeOutput, parseOpenCodeEvents, shellArg } from '../server/ai/cliProviders';
import { isLoopbackRequest, resolveProviderConfig, generate } from '../server/ai/index';
import { aiHeaders, effectiveModel } from '../src/agent/aiClient';

test('extractJSON tolerates fences, prose and braces inside strings', () => {
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJSON('Sure! Here it is:\n{"text":"a } tricky { string","n":[1,2]}\nHope this helps.'), { text: 'a } tricky { string', n: [1, 2] });
  assert.throws(() => extractJSON('no json here'), /no JSON/);
  assert.throws(() => extractJSON('{"a": {"b": 1}'), /truncated/);
});

test('model ids are sanitised before reaching a shell', () => {
  assert.equal(sanitizeModelId(' opencode/big-pickle '), 'opencode/big-pickle');
  assert.equal(sanitizeModelId('claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(sanitizeModelId(''), undefined);
  for (const bad of ['x; rm -rf /', 'a && b', '$(whoami)', 'a"b', 'a b']) assert.throws(() => sanitizeModelId(bad), /Invalid model id/);
});

test('CLI output parsers (shapes captured from real runs)', () => {
  assert.equal(parseClaudeOutput('{"type":"result","is_error":false,"result":"{\\"ok\\":true}"}'), '{"ok":true}');
  assert.throws(() => parseClaudeOutput('{"is_error":true,"result":"Not logged in"}'), /Not logged in/);
  const oc = [
    '{"type":"step_start","part":{}}',
    '{"type":"text","part":{"text":"{\\"ok\\":"}}',
    '{"type":"text","part":{"text":"true}"}}',
    'INFO some log line',
    '{"type":"step_finish","part":{}}',
  ].join('\n');
  assert.equal(parseOpenCodeEvents(oc), '{"ok":true}');
  assert.throws(() => parseOpenCodeEvents('{"type":"error","error":{"name":"APIError","data":{"message":"No endpoints found"}}}'), /No endpoints found/);
  // Shapes captured from `agy` 1.5.4 stream-json runs.
  const agy = [
    '{"event":"init","conversation_id":"c","init":{"tools":[]}}',
    '{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"{\\"ok\\":true}"}}',
    '{"event":"result","result":{"status":"SUCCESS","response":"{\\"ok\\":true}\\n"}}',
  ].join('\n');
  assert.equal(parseAntigravityEvents(agy).trim(), '{"ok":true}');
  assert.equal(parseAntigravityEvents(agy.split('\n').slice(0, 2).join('\n')), '{"ok":true}', 'falls back to text deltas');
  assert.throws(() => parseAntigravityEvents('{"event":"result","result":{"status":"ERROR","error":"stream input message is missing the \\"event\\" field"}}'), /missing/);
  assert.deepEqual(JSON.parse(antigravityStdin('hi')), { event: 'user', message: { content: 'hi' } });
  const prompt = composeCliPrompt({ system: 'SYS', user: 'USER' });
  assert.ok(prompt.indexOf('SYS') < prompt.indexOf('USER') && /ONE JSON object/.test(prompt));
  assert.equal(shellArg(''), process.platform === 'win32' ? '""' : '');
});

function fakeReq(headers: Record<string, string>, remoteAddress = '127.0.0.1'): any {
  return { headers, socket: { remoteAddress } };
}

test('provider resolution from headers, legacy body model and env', () => {
  assert.deepEqual(resolveProviderConfig(fakeReq({}), 'gemini-3.1-flash-lite'), { provider: 'gemini', model: 'gemini-3.1-flash-lite', apiKey: undefined, baseUrl: undefined });
  const cfg = resolveProviderConfig(fakeReq({ 'x-ai-provider': 'openrouter', 'x-ai-model': 'anthropic/claude-sonnet-5.5', 'x-ai-key': 'k' }));
  assert.equal(cfg.provider, 'openrouter');
  assert.equal(cfg.model, 'anthropic/claude-sonnet-5.5');
  assert.equal(resolveProviderConfig(fakeReq({ 'x-ai-provider': 'evil' })).provider, 'gemini');
});

test('CLI providers refuse non-local and forwarded requests', async () => {
  assert.equal(isLoopbackRequest(fakeReq({})), true);
  assert.equal(isLoopbackRequest(fakeReq({}, '::ffff:127.0.0.1')), true);
  assert.equal(isLoopbackRequest(fakeReq({}, '192.168.1.20')), false);
  assert.equal(isLoopbackRequest(fakeReq({ 'x-forwarded-for': '8.8.8.8' })), false);
  await assert.rejects(
    generate({ provider: 'cli-claude' }, { system: 's', user: 'u' }, fakeReq({}, '10.0.0.5')),
    /only available when OmniStage is opened on this computer/
  );
});

test('client headers follow Settings → AI', () => {
  const base = { aiProvider: 'openai-compatible' as const, aiModels: { 'openai-compatible': 'llama3.3' }, aiApiKeys: {}, aiBaseUrl: 'http://localhost:11434/v1', geminiModel: 'gemini-3.8-flash' as const };
  assert.deepEqual(aiHeaders(base), {
    'Content-Type': 'application/json',
    'x-ai-provider': 'openai-compatible',
    'x-ai-model': 'llama3.3',
    'x-ai-base-url': 'http://localhost:11434/v1',
  });
  const gem = { ...base, aiProvider: 'gemini' as const, aiModels: {}, aiApiKeys: { gemini: 'secret' } };
  assert.equal(effectiveModel(gem), 'gemini-3.8-flash');
  assert.equal(aiHeaders(gem)['x-ai-key'], 'secret');
  assert.equal(aiHeaders(gem)['x-ai-base-url'], undefined);
});
