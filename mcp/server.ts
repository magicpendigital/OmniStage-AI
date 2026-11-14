#!/usr/bin/env node
/**
 * Phase 5 — OmniStage MCP server (stdio, newline-delimited JSON-RPC 2.0, no SDK dependency).
 *
 *   npx tsx mcp/server.ts --project ./projects/demo.scenespec.json [--root .]
 *
 * Register with Claude Code:
 *   claude mcp add omnistage -- npx tsx mcp/server.ts --project ./projects/demo.scenespec.json
 *
 * Only `initialize`, `ping`, `tools/list` and `tools/call` are implemented (tools capability only).
 * stdout carries protocol messages exclusively; diagnostics go to stderr.
 */
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { callTool, OMNISTAGE_TOOLS, ToolContext } from './projectTools';

const SERVER_INFO = { name: 'omnistage', version: '5.0.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function parseArgs(argv: string[]): ToolContext {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const rootDir = resolve(get('--root') || process.env.OMNISTAGE_ROOT || process.cwd());
  const project = get('--project') || process.env.OMNISTAGE_PROJECT || 'omnistage-project.scenespec.json';
  return { rootDir, projectPath: resolve(rootDir, project) };
}

type JsonRpcId = string | number | null;

export async function handleMessage(msg: any, ctx: ToolContext): Promise<object | null> {
  const id: JsonRpcId = msg?.id ?? null;
  const isNotification = msg?.id === undefined;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : fail(-32600, 'Invalid Request');
  }
  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'OmniStage authors 2D/3D games and media as declarative SceneSpec JSON. Call omnistage_contract first, ' +
          'omnistage_director_skills for craft rules, then create/patch scenes; every patch is verified and auto-fixed.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: OMNISTAGE_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !t.mutates && !t.name.startsWith('omnistage_export'), destructiveHint: false },
        })),
      });
    case 'tools/call': {
      const { text, isError } = await callTool(String(msg.params?.name), msg.params?.arguments, ctx);
      return reply({ content: [{ type: 'text', text }], isError });
    }
    default:
      if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

async function main() {
  const ctx = parseArgs(process.argv.slice(2));
  process.stderr.write(`[omnistage-mcp] project=${ctx.projectPath} root=${ctx.rootDir}\n`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serialise calls so two mutations never race on the project file.
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
        return;
      }
      const response = await handleMessage(msg, ctx);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    });
  });
  rl.on('close', () => {
    queue.then(() => process.exit(0));
  });
}

const invokedDirectly = process.argv[1] && /mcp[\\/]server\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) main();
