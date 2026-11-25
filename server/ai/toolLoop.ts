/**
 * Phase 4 (Director D) — native tool-use edit loop for the Anthropic API provider.
 *
 * The model edits the scene through the shared toolbox (`src/agent/tools/sceneTools.ts`: get_scene_slice, apply_patch, verify,
 * search_assets, finish) instead of returning JSON patches as text. Every `apply_patch` goes through the same `checkScene` path
 * as the studio patch loop and the MCP server, and a patch that makes verification worse is reverted by the toolbox.
 *
 * Scope and fallback rules (see .claude/rules/agent-and-verification.md):
 *  - Only a PRIMARY connection of provider 'anthropic' with an API key is eligible (`resolveToolLoopConnection`); every other
 *    connection (Gemini, OpenAI-compatible, OpenRouter, CLI logins) gets `null` and the caller uses the JSON patch loop.
 *  - A failure of the tool loop that is not "no connection configured" makes the caller fall back to the patch loop.
 *  - `client` is injectable, so tests drive the loop with a scripted fake (no network, no key).
 *
 * This module has no runtime dependency on `src/` (the toolbox is passed in), so the server can load it lazily.
 * API keys are never logged and never appear in transcripts or events.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODELS, keyFor } from './apiProviders';
import type { ProviderConfig } from './types';
import type { SceneToolDefinition, ToolboxResult } from '../../src/agent/tools/sceneTools';

export const MAX_TOOL_LOOP_TURNS = 12;
export const MAX_TOOL_CALLS = 40;
const MAX_OUTPUT_TOKENS = 32_000;
const TRANSCRIPT_INPUT_CHARS = 220;
const TRANSCRIPT_RESULT_CHARS = 320;

// ---------------------------------------------------------------------------
// Client abstraction (the Anthropic SDK behind a tiny interface)
// ---------------------------------------------------------------------------

export type ToolLoopBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown };

export interface ToolLoopUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface ToolLoopResponse {
  content: ToolLoopBlock[];
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  model?: string;
  usage?: ToolLoopUsage;
}

export interface ToolLoopMessageParam {
  role: 'user' | 'assistant';
  content: string | ToolLoopBlock[];
}

export interface ToolLoopRequest {
  model: string;
  system: string;
  tools: SceneToolDefinition[];
  messages: ToolLoopMessageParam[];
  maxTokens: number;
}

export interface ToolLoopClient {
  send(request: ToolLoopRequest, signal?: AbortSignal): Promise<ToolLoopResponse>;
}

/**
 * The official SDK as a ToolLoopClient. Mirrors `callAnthropic` in apiProviders.ts: streaming (long outputs), server-side refusal
 * fallbacks, adaptive thinking, and cache breakpoints on the static tool definitions and system prompt.
 */
export function createAnthropicToolClient(apiKey: string, timeoutMs = 300_000): ToolLoopClient {
  const client = new Anthropic({ apiKey, timeout: timeoutMs });
  return {
    async send(request, signal) {
      const tools = request.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        ...(i === request.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));
      const message = await client.beta.messages
        .stream(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
            tools,
            messages: request.messages,
          } as any,
          signal ? { signal } : undefined
        )
        .finalMessage();
      return message as unknown as ToolLoopResponse;
    },
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * The connection the tool loop may use, or `null` when the caller must use the JSON patch loop. Only the PRIMARY connection is
 * considered (the fallback chain is not walked): provider 'anthropic' with a key from the header or ANTHROPIC_API_KEY.
 */
export function resolveToolLoopConnection(primary: ProviderConfig): { apiKey: string; model: string } | null {
  if (primary.provider !== 'anthropic') return null;
  const apiKey = keyFor(primary);
  if (!apiKey) return null;
  return { apiKey, model: primary.model || DEFAULT_MODELS.anthropic };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** What the loop needs from the toolbox (SceneToolbox satisfies this). */
export interface ToolLoopToolbox {
  readonly definitions: SceneToolDefinition[];
  readonly finished: boolean;
  run(name: string, input: unknown): string;
  result(): ToolboxResult;
}

export interface ToolTranscriptEntry {
  turn: number;
  tool: string;
  input: string;
  result: string;
  isError: boolean;
}

export type ToolLoopEvent =
  | { type: 'turn'; turn: number }
  | { type: 'text'; turn: number; text: string }
  | { type: 'tool'; turn: number; entry: ToolTranscriptEntry };

export interface ToolLoopOptions {
  client: ToolLoopClient;
  model: string;
  system: string;
  userPrompt: string;
  toolbox: ToolLoopToolbox;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (event: ToolLoopEvent) => void;
}

export type ToolLoopStop = 'finish' | 'end-turn' | 'max-turns' | 'tool-budget';

export interface ToolLoopResult {
  spec: ToolboxResult['spec'];
  report: ToolboxResult['report'];
  /** What changed, from the toolbox's own bookkeeping (kept in the order of the accepted patches). */
  fixes: string[];
  notes: string[];
  presets: string[];
  changed: boolean;
  transcript: ToolTranscriptEntry[];
  assistantMessage: string;
  diffSummary: string[];
  turns: number;
  toolCalls: number;
  stopped: ToolLoopStop;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
}

function short(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function stringifyInput(input: unknown): string {
  try {
    return short(JSON.stringify(input ?? {}), TRANSCRIPT_INPUT_CHARS);
  } catch {
    return '[unserializable input]';
  }
}

function abortError(): Error {
  const e = new Error('Stopped by user');
  e.name = 'AbortError';
  return e;
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxTurns = Math.max(1, Math.min(opts.maxTurns ?? MAX_TOOL_LOOP_TURNS, MAX_TOOL_LOOP_TURNS));
  const { toolbox, signal } = opts;
  const messages: ToolLoopMessageParam[] = [{ role: 'user', content: opts.userPrompt }];
  const transcript: ToolTranscriptEntry[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let sawUsage = false;
  let toolCalls = 0;
  let turns = 0;
  let lastText = '';
  let model: string | undefined;
  let stopped: ToolLoopStop = 'max-turns';

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (signal?.aborted) throw abortError();
    opts.onEvent?.({ type: 'turn', turn });
    const response = await opts.client.send(
      { model: opts.model, system: opts.system, tools: toolbox.definitions, messages, maxTokens: MAX_OUTPUT_TOKENS },
      signal
    );
    if (signal?.aborted) throw abortError();
    turns = turn;
    model = response.model || model;
    if (response.usage) {
      sawUsage = true;
      usage.inputTokens += response.usage.input_tokens ?? 0;
      usage.outputTokens += response.usage.output_tokens ?? 0;
      usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationTokens += response.usage.cache_creation_input_tokens ?? 0;
    }
    if (response.stop_reason === 'refusal') {
      throw new Error(`Anthropic declined the request${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}.`);
    }

    const content = Array.isArray(response.content) ? response.content : [];
    // The assistant turn goes back unchanged (thinking blocks included), as tool use requires.
    messages.push({ role: 'assistant', content });
    const text = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof (b as any).text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (text) {
      lastText = text;
      opts.onEvent?.({ type: 'text', turn, text });
    }

    const uses = content.filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use' && typeof (b as any).id === 'string');
    if (!uses.length) {
      stopped = 'end-turn';
      break;
    }

    const results: ToolLoopBlock[] = [];
    let overBudget = false;
    for (const use of uses) {
      let resultText: string;
      if (toolCalls >= MAX_TOOL_CALLS) {
        overBudget = true;
        resultText = `ERROR: tool call budget (${MAX_TOOL_CALLS}) used up. Stop editing and call finish.`;
      } else {
        toolCalls++;
        resultText = toolbox.run(use.name, use.input);
      }
      const isError = resultText.startsWith('ERROR:');
      const entry: ToolTranscriptEntry = { turn, tool: use.name, input: stringifyInput(use.input), result: short(resultText, TRANSCRIPT_RESULT_CHARS), isError };
      transcript.push(entry);
      opts.onEvent?.({ type: 'tool', turn, entry });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: resultText, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });

    if (toolbox.finished) {
      stopped = 'finish';
      break;
    }
    if (overBudget) {
      stopped = 'tool-budget';
      break;
    }
  }

  const result = toolbox.result();
  const kept = result.patches.filter((p) => p.ok);
  const dropped = result.patches.length - kept.length;
  const keptOps = kept.reduce((n, p) => n + p.ops, 0);
  const diffSummary = [
    `Tool-use edit: ${turns} turn(s), ${toolCalls} tool call(s), ${kept.length} patch(es) kept (${keptOps} op(s))${dropped ? `, ${dropped} rejected or reverted` : ''}`,
  ];
  if (stopped === 'max-turns') diffSummary.push(`Stopped at the ${maxTurns}-turn limit before the model called finish`);
  if (stopped === 'tool-budget') diffSummary.push(`Stopped at the ${MAX_TOOL_CALLS}-call tool budget before the model called finish`);

  return {
    spec: result.spec,
    report: result.report,
    fixes: result.fixes,
    notes: result.notes,
    presets: result.presets,
    changed: result.changed,
    transcript,
    assistantMessage: result.summary || lastText,
    diffSummary,
    turns,
    toolCalls,
    stopped,
    model,
    ...(sawUsage ? { usage } : {}),
  };
}
