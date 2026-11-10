/**
 * Phase 7C — AI edits as JSON Patch inside a provider-agnostic tool-use loop.
 *
 * Instead of rewriting the whole SceneSpec every turn, the model returns small edits:
 *   { assistantMessage, diffSummary, mergePatch?, ops?: JsonPatchOp[], done? }
 * OmniStage is the "tool": it applies the patch, runs the deterministic repair + verifier, and sends the result
 * back as a TOOL RESULT. The model answers with another patch until the verifier passes, it says done, or the round
 * budget runs out. The loop is plain JSON, so it works the same for every provider (API and local CLIs).
 *
 * Pure module (no React, no store, no fetch): the caller injects `propose` (one model round) and `check`
 * (finalize + auto-fix + verify), which keeps it testable and reusable from the MCP server.
 */
import { applyJsonPatch, JsonPatchError, JsonPatchOp, mergePatch } from '../utils/jsonPatch';
import type { SceneSpec, VerificationReport } from '../types/scene.schema';

export interface PatchProposal {
  assistantMessage?: string;
  diffSummary?: string[];
  mergePatch?: Record<string, unknown>;
  ops?: JsonPatchOp[];
  /** Escape hatch: a model that ignored the format and returned a full spec. Accepted, but noted. */
  updatedSceneSpec?: SceneSpec;
  /** The model believes no more edits are needed. */
  done?: boolean;
}

export interface PatchTurn {
  prompt: string;
  /** The working spec the patch must apply to (already includes earlier rounds). */
  spec: SceneSpec;
  /** 0-based round index. */
  round: number;
  /** TOOL RESULT messages from earlier rounds, oldest first. */
  toolResults: string[];
}

export interface PatchCheck {
  spec: SceneSpec;
  report: VerificationReport;
  fixes: string[];
}

export interface PatchRoundLog {
  round: number;
  ops: number;
  merged: boolean;
  fullSpec: boolean;
  /** Patch application error (nothing from this round was applied). */
  rejected?: string;
  errorsAfter?: number;
}

export interface PatchLoopResult {
  spec: SceneSpec;
  report: VerificationReport;
  assistantMessage: string;
  diffSummary: string[];
  fixes: string[];
  rounds: PatchRoundLog[];
  /** True when at least one round changed the scene. */
  changed: boolean;
}

export interface PatchLoopOptions {
  prompt: string;
  spec: SceneSpec;
  propose: (turn: PatchTurn) => Promise<PatchProposal | null>;
  check: (spec: SceneSpec) => PatchCheck;
  maxRounds?: number;
  /** Optional progress callback (e.g. "Round 2: fixing 1 verifier error"). */
  onRound?: (log: PatchRoundLog) => void;
}

export const DEFAULT_PATCH_ROUNDS = 3;
const MAX_OPS_PER_ROUND = 200;

/** Applies one proposal to a spec. Throws JsonPatchError when the patch does not fit the document. */
export function applyPatchProposal(spec: SceneSpec, p: PatchProposal): SceneSpec {
  if (p.updatedSceneSpec && Array.isArray(p.updatedSceneSpec.actors)) return JSON.parse(JSON.stringify(p.updatedSceneSpec));
  let next: SceneSpec = JSON.parse(JSON.stringify(spec));
  if (p.mergePatch && typeof p.mergePatch === 'object' && !Array.isArray(p.mergePatch)) {
    if ('id' in p.mergePatch) throw new JsonPatchError('The scene id cannot be changed');
    next = mergePatch(next, p.mergePatch);
  }
  if (p.ops !== undefined) {
    if (!Array.isArray(p.ops)) throw new JsonPatchError('"ops" must be an array of JSON Patch operations');
    if (p.ops.length > MAX_OPS_PER_ROUND) throw new JsonPatchError(`Too many ops (${p.ops.length}); keep each round under ${MAX_OPS_PER_ROUND}`);
    if (p.ops.length) next = applyJsonPatch(next, p.ops);
  }
  if (!next || typeof next !== 'object' || !Array.isArray((next as SceneSpec).actors)) {
    throw new JsonPatchError('The patch removed required SceneSpec fields (actors must stay an array)');
  }
  return next;
}

function hasEdits(p: PatchProposal): boolean {
  return !!p.updatedSceneSpec || (Array.isArray(p.ops) && p.ops.length > 0) || (!!p.mergePatch && Object.keys(p.mergePatch).length > 0);
}

/** Short verifier summary the model can act on. */
export function describeReportForModel(report: VerificationReport, limit = 8): string {
  const errors = report.issues.filter((i) => i.severity === 'error');
  if (!errors.length) return `Verifier passed${report.warnings ? ` (${report.warnings} warning(s))` : ''}.`;
  const lines = errors.slice(0, limit).map((i) => `- [${i.code}]${i.targetId ? ` (${i.targetId})` : ''} ${i.message}`);
  return `Verifier found ${errors.length} error(s):\n${lines.join('\n')}${errors.length > limit ? `\n- …${errors.length - limit} more` : ''}`;
}

export async function runPatchLoop(opts: PatchLoopOptions): Promise<PatchLoopResult | null> {
  const maxRounds = Math.max(1, opts.maxRounds ?? DEFAULT_PATCH_ROUNDS);
  const toolResults: string[] = [];
  const rounds: PatchRoundLog[] = [];
  const diffSummary: string[] = [];
  const fixes: string[] = [];
  let assistantMessage = '';
  let working = opts.spec;
  let best: PatchCheck | null = null;
  let changed = false;

  for (let round = 0; round < maxRounds; round++) {
    const proposal = await opts.propose({ prompt: opts.prompt, spec: working, round, toolResults: [...toolResults] });
    if (!proposal) {
      if (round === 0) return null; // provider failed outright: caller falls back
      break;
    }
    if (proposal.assistantMessage && !assistantMessage) assistantMessage = proposal.assistantMessage;
    const log: PatchRoundLog = {
      round,
      ops: Array.isArray(proposal.ops) ? proposal.ops.length : 0,
      merged: !!proposal.mergePatch,
      fullSpec: !!proposal.updatedSceneSpec,
    };

    if (!hasEdits(proposal)) {
      rounds.push(log);
      opts.onRound?.(log);
      if (round === 0 && !best) best = opts.check(working);
      break; // model has nothing (more) to change
    }

    let candidate: SceneSpec;
    try {
      candidate = applyPatchProposal(working, proposal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.rejected = msg;
      rounds.push(log);
      opts.onRound?.(log);
      toolResults.push(`Round ${round + 1}: PATCH REJECTED — ${msg}. Nothing from that round was applied; the CURRENT SCENESPEC below is unchanged. Send a corrected patch.`);
      continue;
    }

    const checked = opts.check(candidate);
    log.errorsAfter = checked.report.errors;
    rounds.push(log);
    opts.onRound?.(log);
    // Keep the best result: never let a later round make verification worse.
    if (best && checked.report.errors > best.report.errors) {
      toolResults.push(`Round ${round + 1}: patch applied but it made verification WORSE (${best.report.errors} → ${checked.report.errors} errors), so it was discarded.\n${describeReportForModel(checked.report)}`);
      continue;
    }
    changed = true;
    best = checked;
    working = checked.spec;
    fixes.push(...checked.fixes);
    for (const d of proposal.diffSummary || []) if (typeof d === 'string' && !diffSummary.includes(d)) diffSummary.push(d);
    if (proposal.updatedSceneSpec) diffSummary.push('Model returned a full SceneSpec instead of a patch (accepted)');

    if (checked.report.ok) break;
    toolResults.push(
      `Round ${round + 1}: patch applied (${log.ops} op(s)${log.merged ? ' + mergePatch' : ''}). OmniStage auto-fixed ${checked.fixes.length} issue(s).\n${describeReportForModel(checked.report)}\nFix ONLY these problems with another small patch against the CURRENT SCENESPEC.`
    );
  }

  const final = best ?? opts.check(working);
  return {
    spec: final.spec,
    report: final.report,
    assistantMessage,
    diffSummary,
    fixes,
    rounds,
    changed,
  };
}

/** Compact index of addressable ids so the model can write `/actors/@id/...` paths without guessing. */
export function buildIdIndex(spec: SceneSpec): string {
  const list = <T extends { id: string }>(items: T[] | undefined, label: (x: T) => string) =>
    (items || []).slice(0, 60).map((x) => `${x.id} (${label(x)})`).join(', ') || 'none';
  return [
    `actors: ${list(spec.actors, (a) => `${a.name} · ${a.assetId}`)}`,
    `nodes2D: ${list(spec.nodes2D, (n) => `${n.name || n.type}`)}`,
    `vfx: ${list(spec.vfx, (v) => v.type)}`,
    `logicGraph.nodes: ${list(spec.logicGraph?.nodes, (n) => `${n.type}: ${n.title}`)}`,
    `logicGraph.edges: ${(spec.logicGraph?.edges || []).length}`,
  ].join('\n');
}

/** User message for one round (server side). Compact JSON keeps input tokens down; tool results stay short. */
export function buildPatchUserPrompt(turn: PatchTurn): string {
  const results = turn.toolResults.filter((t) => typeof t === 'string').slice(-6).map((t) => t.slice(0, 3000));
  return `USER INSTRUCTION: "${turn.prompt.slice(0, 4000)}"
${results.length ? `\nTOOL RESULTS FROM EARLIER ROUNDS (this is round ${turn.round + 1}):\n${results.join('\n\n')}\n` : ''}
ADDRESSABLE IDS:
${buildIdIndex(turn.spec)}

CURRENT SCENESPEC JSON:
${JSON.stringify(turn.spec)}

Reply with the patch JSON object described in RESPONSE FORMAT.`;
}

export const PATCH_RESPONSE_FORMAT = `RESPONSE FORMAT — JSON PATCH EDITS (tool-use loop):
You EDIT the CURRENT SceneSpec with small patches; you never rewrite it. Return ONLY one JSON object:
{
  "assistantMessage": "short explanation for the creator (mention logic-graph chains you added or changed)",
  "diffSummary": ["2-4 short bullets of exact mutations"],
  "mergePatch": { optional RFC 7386 merge patch, applied first: objects merge, null deletes a key, arrays are replaced whole },
  "ops": [ RFC 6902 operations applied after mergePatch ],
  "done": true | false
}
- ops: { "op": "add" | "replace" | "remove" | "move" | "copy" | "test", "path": "/json/pointer", "value": ..., "from": "/for/move/copy" }.
- Address array items by id with "@": "/actors/@<actorId>/position", "/logicGraph/nodes/@<nodeId>/params/points". Append with "-": "/actors/-".
- Use "add" for new keys or new array items, "replace" only for keys that already exist.
- Send ONLY what changes. Never resend unchanged actors, nodes or the whole spec. New actors/nodes/edges need unique ids.
- mergePatch suits object tweaks (world, camera, gameRules, audio); ops suit array edits (actors, nodes2D, vfx, logic nodes/edges).
- A brand-new scene may replace whole top-level keys, e.g. {"op":"replace","path":"/actors","value":[...]}.
- OmniStage applies your patch, auto-repairs and runs its deterministic verifier. If problems remain you receive a TOOL RESULT
  and must reply with another small patch against the CURRENT SCENESPEC that fixes ONLY those problems.
- Set "done": true when no further edits are needed. An empty "ops" with "done": true means "nothing to change".`;
