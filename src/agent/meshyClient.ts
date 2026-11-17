/**
 * Browser client for the local Meshy connector (`/api/meshy/*`, see server/generate/meshyRoutes.ts).
 * The server drives the user's own Meshy CLI session; this file only talks to that loopback API and never sees a credential.
 */
import type { LibraryAsset } from '../workspace/workspaceClient';

export interface MeshyStatus {
  state: 'ready' | 'login_required' | 'unverified' | 'runner_unavailable';
  runner: { available: boolean; kind?: string; version?: string; error?: string; code?: string };
  balance: number | null;
  login: MeshyLogin;
}

export interface MeshyLogin {
  state: 'idle' | 'waiting' | 'logged_in' | 'failed' | 'expired';
  url?: string;
  code?: string;
  message?: string;
}

export interface MeshyEstimate {
  credits?: number;
  source: 'cli-dry-run' | 'unknown';
  balance?: number;
  steps: string[];
  notes: string[];
}

export interface MeshyJob {
  id: string;
  prompt: string;
  name: string;
  scope: string;
  status: 'running' | 'succeeded' | 'failed';
  stage: 'queued' | 'preview' | 'remesh' | 'retexture' | 'refine' | 'rigging' | 'downloading' | 'saving' | 'done';
  progress: number;
  error?: string;
  errorCode?: string;
  consumedCredits: number | null;
  asset?: LibraryAsset;
  clips?: string[];
  warnings: string[];
}

export class MeshyError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/meshy${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  } catch {
    throw new MeshyError('The OmniStage server is not reachable.', 'offline');
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new MeshyError(String(data?.error || `Request failed (${res.status})`), data?.code, res.status);
  return data as T;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export const meshyApi = {
  status: () => call<MeshyStatus>('/status'),
  startLogin: () => call<MeshyLogin>('/login', post()),
  login: () => call<MeshyLogin>('/login'),
  cancelLogin: () => call<MeshyLogin>('/login', { method: 'DELETE' }),
  estimate: (prompt: string) => call<MeshyEstimate>('/estimate', post({ prompt })),
  /** Spends credits: only call after the user agreed to the estimate. */
  generateCharacter: (input: { prompt: string; name?: string }) => call<MeshyJob>('/characters', post({ ...input, confirm: true })),
  job: (id: string) => call<MeshyJob>(`/jobs/${encodeURIComponent(id)}`),
};

/** Human wording for the codes the connector returns. */
export function describeMeshyError(e: unknown): string {
  const err = e as MeshyError;
  switch (err?.code) {
    case 'login_required': return 'Meshy is not signed in. Connect it first.';
    case 'session_unverified': return 'Meshy could not verify the saved session. Reconnect it.';
    case 'insufficient_credit': return 'Not enough Meshy credits for this model.';
    case 'too_many_jobs': return 'Two models are already being generated. Wait for one to finish.';
    case 'node_too_old': return 'The Meshy CLI needs Node 22.12 or newer on this computer.';
    case 'npm_missing': return 'npm was not found, so the Meshy CLI cannot be started.';
    case 'wait_timeout': return 'Meshy is taking too long. Check your Meshy dashboard before trying again, so you are not charged twice.';
    case 'submission_unknown': return 'Meshy may or may not have started the model. Check your Meshy dashboard before trying again.';
    case 'too_dense': return 'The model has too many faces to rig. Simplify the look and try again.';
    case 'offline': return err.message;
    default: return err?.message || 'Meshy request failed.';
  }
}
