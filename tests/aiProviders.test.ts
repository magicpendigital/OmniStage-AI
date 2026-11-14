import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJSON, sanitizeModelId } from '../server/ai/types';
import { antigravityStdin, composeCliPrompt, parseAntigravityEvents, parseClaudeOutput, parseOpenCodeEvents, shellArg } from '../server/ai/cliProviders';
import { isLoopbackRequest, resolveProviderConfig, generate, generateJSON, aiErrorStatus } from '../server/ai/index';
import { aiHeaders, effectiveModel, fallbackChain } from '../src/agent/aiClient';
import { ProviderUnavailableError } from '../server/ai/types';
import {
  AllProvidersFailedError,
  buildChain,
  classifyFailure,
  COOLDOWN_MS,
  encodeFallbackHeader,
  fallbackNote,
  parseFallbackHeader,
  ProviderHealth,
  providerHealth,
  runWithFallback,
} from '../server/ai/fallback';

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

// ---------------------------------------------------------------------------
// Phase 6: connection fallback chain
// ---------------------------------------------------------------------------

test('fallback header round-trips and drops invalid entries', () => {
  const list = [{ provider: 'cli-claude', model: 'sonnet' }, { provider: 'evil' }, { provider: 'openrouter', apiKey: 'k' }] as any[];
  const parsed = parseFallbackHeader(encodeFallbackHeader(list));
  assert.deepEqual(parsed.map((c) => c.provider), ['cli-claude', 'openrouter']);
  assert.equal(parsed[0].model, 'sonnet');
  assert.deepEqual(parseFallbackHeader('not base64 json'), []);
  assert.deepEqual(parseFallbackHeader(undefined), []);
  // Duplicates of the primary are removed.
  const chain = buildChain({ provider: 'gemini' }, [{ provider: 'gemini' }, { provider: 'cli-codex' }]);
  assert.deepEqual(chain.map((c) => c.provider), ['gemini', 'cli-codex']);
});

test('failures are classified for cooldowns', () => {
  assert.equal(classifyFailure(new ProviderUnavailableError('no key')), 'unavailable');
  assert.equal(classifyFailure(new Error('https://x returned 429: Too Many Requests')), 'rate-limit');
  assert.equal(classifyFailure(new Error('RESOURCE_EXHAUSTED: quota exceeded')), 'rate-limit');
  assert.equal(classifyFailure(new Error('Claude Code: Not logged in')), 'auth');
  assert.equal(classifyFailure(new Error('Codex CLI timed out')), 'timeout');
  assert.equal(classifyFailure(new Error('Model response contains no JSON object')), 'bad-output');
  assert.equal(classifyFailure(new Error('boom')), 'error');
});

test('runWithFallback moves to the next connection and records every attempt', async () => {
  const health = new ProviderHealth();
  let t = 1000;
  const now = () => t;
  const calls: string[] = [];
  const outcome = await runWithFallback(
    [{ provider: 'gemini' }, { provider: 'anthropic' }, { provider: 'cli-claude' }],
    async (cfg) => {
      calls.push(cfg.provider);
      if (cfg.provider === 'gemini') throw new Error('returned 429: quota');
      if (cfg.provider === 'anthropic') throw new ProviderUnavailableError('Anthropic API key not configured');
      return 'ok';
    },
    { health, now }
  );
  assert.equal(outcome.value, 'ok');
  assert.equal(outcome.used.provider, 'cli-claude');
  assert.deepEqual(calls, ['gemini', 'anthropic', 'cli-claude']);
  assert.deepEqual(
    outcome.attempts.map((a) => [a.provider, a.ok, a.kind]),
    [
      ['gemini', false, 'rate-limit'],
      ['anthropic', false, 'unavailable'],
      ['cli-claude', true, undefined],
    ]
  );
  assert.match(fallbackNote(outcome) || '', /gemini failed \(rate-limit\).*→ used cli-claude/);

  const okOnly = async (cfg: { provider: string }) => {
    calls.push(cfg.provider);
    return 'ok';
  };
  // Next request: the rate-limited connection is cooling down and is tried last; the unconfigured one has no cooldown.
  calls.length = 0;
  t += 10_000;
  await runWithFallback([{ provider: 'gemini' }, { provider: 'cli-claude' }], okOnly, { health, now });
  assert.deepEqual(calls, ['cli-claude']);
  assert.equal(health.snapshot(t)[0]?.provider, 'gemini');

  // After the cooldown it is first again.
  calls.length = 0;
  t += COOLDOWN_MS['rate-limit'];
  await runWithFallback([{ provider: 'gemini' }, { provider: 'cli-claude' }], okOnly, { health, now });
  assert.deepEqual(calls, ['gemini']);
  assert.equal(fallbackNote({ used: { provider: 'gemini' }, attempts: [{ provider: 'gemini', ok: true, ms: 1 }] }), undefined);
});

test('runWithFallback: all unconfigured → 503 (offline director), real failures → 500 listing each', async () => {
  const health = new ProviderHealth();
  await assert.rejects(
    runWithFallback(
      [{ provider: 'gemini' }, { provider: 'anthropic' }],
      async () => {
        throw new ProviderUnavailableError('no key');
      },
      { health }
    ),
    (e: any) => e instanceof ProviderUnavailableError && aiErrorStatus(e) === 503
  );
  await assert.rejects(
    runWithFallback(
      [{ provider: 'gemini' }, { provider: 'cli-codex' }],
      async (cfg) => {
        throw cfg.provider === 'gemini' ? new ProviderUnavailableError('no key') : new Error('Codex CLI exited with code 1: boom');
      },
      { health }
    ),
    (e: any) => e instanceof AllProvidersFailedError && aiErrorStatus(e) === 500 && /gemini: no key \| cli-codex: Codex CLI exited/.test(e.message)
  );
});

test('client sends the fallback chain from Settings → AI', () => {
  const settings = {
    aiProvider: 'gemini' as const,
    aiModels: { 'cli-claude': 'sonnet' },
    aiApiKeys: { openrouter: 'or-key' },
    aiBaseUrl: 'http://localhost:11434/v1',
    geminiModel: 'gemini-3.8-flash' as const,
    aiFallbackEnabled: true,
    aiFallbackOrder: ['gemini', 'cli-claude', 'openrouter', 'cli-claude', 'openai-compatible'] as any,
  };
  assert.deepEqual(fallbackChain(settings), [
    { provider: 'cli-claude', model: 'sonnet' },
    { provider: 'openrouter', apiKey: 'or-key' },
    { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' },
  ]);
  const header = aiHeaders(settings)['x-ai-fallback'];
  assert.deepEqual(parseFallbackHeader(header).map((c) => c.provider), ['cli-claude', 'openrouter', 'openai-compatible']);
  assert.equal(aiHeaders({ ...settings, aiFallbackEnabled: false })['x-ai-fallback'], undefined);
  assert.equal(aiHeaders({ ...settings, aiFallbackOrder: [] })['x-ai-fallback'], undefined);
});

test('generateJSON walks the whole chain and names every failed connection', async () => {
  providerHealth.clear();
  const req: any = fakeReq({
    'x-ai-provider': 'openai-compatible',
    'x-ai-base-url': 'http://127.0.0.1:1/v1',
    'x-ai-fallback': encodeFallbackHeader([{ provider: 'cli-claude', model: 'not valid!' }, { provider: 'anthropic' }]),
  });
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    // Closed port, invalid model id (rejected before any CLI runs), no Anthropic key.
    await assert.rejects(generateJSON(req, { system: 's', user: 'u', timeoutMs: 3000 }), /All AI connections failed.*openai-compatible.*cli-claude.*Invalid model id.*anthropic/);
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    providerHealth.clear();
  }
});
